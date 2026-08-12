import * as sandcastle from "@ai-hero/sandcastle";
import { z } from "zod";

import {
  RUN_TICKET_CHECKER_AGENT,
  RUN_TICKET_MAKER_AGENT,
} from "../config/agents.mts";
import {
  READY_FOR_AGENT_LABEL,
  READY_FOR_HUMAN_LABEL,
  RUN_TICKET_MAKER_CHECKER_MAX_CYCLES,
  WAVE_MAX_PARALLEL_TICKETS,
  COPY_TO_WORKTREE,
  VERIFY_COMMAND,
} from "../config/knobs.mts";
import { parseTagged } from "../../helpers/agentOutput.mts";
import { git, isDirty } from "../../helpers/git.mts";
import { codingSandbox } from "../../helpers/sandboxes.mts";
import type { ImplementContext } from "../context.mts";
import type { PlannedIssue, WavePlan } from "./planWave.mts";
import { issueBranch, removeBranchWorkspace } from "./planWave.mts";
import type { RunTip } from "../index.mts";

/** A ticket whose branch exists and passed its checker — ready to fold. */
export type CompletedBranch = PlannedIssue;

export function assertTicketCommit(worktree: string, baseHead: string): string {
  if (isDirty(worktree)) {
    throw new Error("maker left a dirty worktree");
  }
  // One `rev-list` yields both the count and the head commit.
  const commits = git(worktree, "rev-list", `${baseHead}..HEAD`)
    .split("\n")
    .filter((line) => line !== "");
  if (commits.length !== 1) {
    throw new Error(
      `ticket branch must be exactly one commit ahead; found ${commits.length}`,
    );
  }
  const commit = commits[0]!;
  if (
    !git(worktree, "diff-tree", "--no-commit-id", "--name-only", "-r", commit)
  ) {
    throw new Error("ticket commit is empty");
  }
  return commit;
}

export type TicketWorkspace = {
  readonly worktree: string;
  readonly sandbox: sandcastle.Sandbox;
  close(): Promise<void>;
};

export type TicketBoundary = {
  acquire(issue: PlannedIssue, tip: RunTip): Promise<TicketWorkspace>;
  runMaker(input: {
    issue: PlannedIssue;
    tip: RunTip;
    worktree: string;
    sandbox: sandcastle.Sandbox;
    cycle: number;
    amend: boolean;
  }): Promise<void>;
  /** Approved or not. The findings, the summary, and the label move all live in
   *  the checker's own comment; the loop needs nothing else from it. */
  runChecker(input: {
    issue: PlannedIssue;
    tip: RunTip;
    worktree: string;
    sandbox: sandcastle.Sandbox;
    commit: string;
    cycle: number;
  }): Promise<boolean>;
  /** Hand the ticket to a human. `cause` is omitted when the thread already
   *  explains itself — an exhausted budget is a wall of `CHECKER FAIL`. */
  halt(issue: PlannedIssue, worktree: string, cause?: string): Promise<void>;
};

export async function runTicket(
  issue: PlannedIssue,
  tip: RunTip,
  maxCycles: number,
  boundary: TicketBoundary,
): Promise<CompletedBranch | null> {
  let workspace: TicketWorkspace | undefined;
  try {
    workspace = await boundary.acquire(issue, tip);
    const baseHead = git(workspace.worktree, "rev-parse", tip.branch);
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      await boundary.runMaker({
        issue,
        tip,
        worktree: workspace.worktree,
        sandbox: workspace.sandbox,
        cycle,
        amend: cycle > 1,
      });
      const commit = assertTicketCommit(workspace.worktree, baseHead);
      const approved = await boundary.runChecker({
        issue,
        tip,
        worktree: workspace.worktree,
        sandbox: workspace.sandbox,
        commit,
        cycle,
      });
      if (approved) return issue;
    }
    // No cause: every cycle left its own `CHECKER FAIL` on the thread, so there
    // is nothing to say that is not already written directly above the halt.
    await boundary.halt(issue, workspace.worktree);
    return null;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    await boundary.halt(issue, workspace?.worktree ?? "", cause);
    return null;
  } finally {
    await workspace?.close().catch(() => undefined);
  }
}

async function mapBounded<T, R>(
  values: readonly T[],
  parallelism: number,
  run: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(parallelism) || parallelism < 1) {
    throw new Error("parallelism must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await run(values[index]!);
    }
  };
  await Promise.allSettled(
    Array.from({ length: Math.min(parallelism, values.length) }, worker),
  );
  return results;
}

export async function runTicketsInParallel(
  plan: WavePlan,
  tip: RunTip,
  options: {
    readonly parallelism: number;
    readonly maxCycles: number;
    readonly boundary: TicketBoundary;
  },
): Promise<readonly (CompletedBranch | null)[]> {
  return mapBounded(plan.issues, options.parallelism, async (issue) => {
    try {
      return await runTicket(issue, tip, options.maxCycles, options.boundary);
    } catch {
      // A failed halt reporter is still isolated to this ticket. The sibling
      // workers and the planner-ordered fold must remain usable.
      return null;
    }
  });
}

export async function runPlannedTickets(
  plan: WavePlan,
  tip: RunTip,
  context: ImplementContext,
): Promise<readonly (CompletedBranch | null)[]> {
  const boundary: TicketBoundary = {
    acquire: async (issue, runTip) => {
      const branch = issueBranch(issue);
      removeBranchWorkspace(context.root, branch);
      const worktree = await sandcastle.createWorktree({
        branchStrategy: {
          type: "branch",
          branch,
          baseBranch: runTip.branch,
        },
        copyToWorktree: COPY_TO_WORKTREE,
      });
      const sandbox = await worktree.createSandbox({
        ...codingSandbox,
      });
      return {
        worktree: worktree.worktreePath,
        sandbox,
        close: async () => {
          await sandbox.close();
        },
      };
    },
    runMaker: async (input) => {
      await context.sandboxAgent(input.sandbox, {
        name: `maker-${input.issue}-${input.cycle}`,
        logName: `${input.issue}/maker-${input.cycle}`,
        prompt: "maker",
        agent: RUN_TICKET_MAKER_AGENT,
        promptArgs: {
          TASK_ID: input.issue,
          BRANCH: issueBranch(input.issue),
          RUN_TIP: input.tip.branch,
          CYCLE: input.cycle,
          VERIFY_COMMAND,
        },
      });
    },
    runChecker: async (input) => {
      const schema = z.object({ approved: z.boolean() });
      const result = await context.sandboxAgent(input.sandbox, {
        name: `checker-${input.issue}-${input.cycle}`,
        logName: `${input.issue}/checker-${input.cycle}`,
        prompt: "checker",
        agent: RUN_TICKET_CHECKER_AGENT,
        maxIterations: 1,
        promptArgs: {
          TASK_ID: input.issue,
          BRANCH: issueBranch(input.issue),
          RUN_TIP: input.tip.branch,
          COMMIT: input.commit,
          VERIFY_COMMAND,
        },
      });
      const verdict = parseTagged(result.stdout, "review", schema);
      if (!verdict)
        throw new Error("checker returned an invalid review verdict");
      return verdict.approved;
    },
    // The label is the halt signal. A comment goes up only for a cause nothing
    // else recorded — a crash, whose detail otherwise exists only in the logs.
    halt: async (issue, worktree, cause) => {
      if (cause) {
        context.issueTracker.comment(
          issue,
          `HALTED\nRun tip: ${tip.branch}\nBranch: ${issueBranch(issue)}\nWorktree: ${worktree}\nCause: ${cause}`,
        );
      }
      context.issueTracker.relabel(issue, {
        add: READY_FOR_HUMAN_LABEL,
        remove: READY_FOR_AGENT_LABEL,
      });
    },
  };

  return runTicketsInParallel(plan, tip, {
    parallelism: WAVE_MAX_PARALLEL_TICKETS,
    maxCycles: RUN_TICKET_MAKER_CHECKER_MAX_CYCLES,
    boundary,
  });
}
