import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import { z } from "zod";

import { createExplainerHost } from "../../helpers/explainerHost.mts";
import {
  EXPLAINER_AGENT,
  MERGE_TICKET_AGENT,
  PUBLISH_AGENT,
  QA_AGENT,
  SIMPLIFY_AGENT,
} from "../config/agents.mts";
import {
  EXPLAINER_DIRECTORY,
  EXPLAINER_MAX_ITERATIONS,
  VERIFY_COMMAND,
} from "../config/knobs.mts";
import type { ImplementContext } from "../context.mts";
import type { RunTip } from "../index.mts";

/** A step that degraded rather than stopping the run. `step` is the stage that
 *  gave up, not the tool it was running. */
export type FinalizeFailure = {
  readonly step: "simplify" | "explainer" | "upload" | "qa";
  readonly reason: string;
};

export const FINALIZE_LOG_NAMES = {
  mergeTicket: "finalize/merge-ticket",
  simplify: "finalize/simplify",
  explainer: "finalize/explainer",
  upload: "finalize/upload",
  qa: "finalize/qa",
  publish: "finalize/publish",
} as const;

export type FinalizeBoundary = {
  ensureMergeTicket(tip: RunTip): Promise<number>;
  simplify(mergeTicket: number): Promise<void>;
  /** True when the tip has no uncommitted changes. */
  tipIsClean(): Promise<boolean>;
  /** Writes the explainer file at `path` inside the tip worktree — the
   *  directory is gitignored, so nothing commits. */
  explain(path: string): Promise<void>;
  /** Uploads the written explainer to the public bucket and returns its
   *  permanent URL. */
  upload(path: string): Promise<string>;
  /** Posts a verified hand-QA menu on the merge ticket. Advisory: a failure
   *  degrades rather than blocking approval. */
  qa(mergeTicket: number): Promise<void>;
  publish(input: {
    readonly tip: RunTip;
    readonly mergeTicket: number;
    readonly explainerUrl?: string;
    readonly failures: readonly FinalizeFailure[];
  }): Promise<void>;
};

/** `merge/2026-07-25-1432` → `<dir>/2026-07-25-1432-implementation.html`. The branch
 *  is already a validated `RunTipBranch`, so no re-parsing is needed. */
export function explainerPath(tip: RunTip): string {
  return `${EXPLAINER_DIRECTORY}/${tip.branch.slice("merge/".length)}-implementation.html`;
}

/** Records a degraded step instead of propagating, and reports whether the step
 *  got through. */
async function degrade(
  failures: FinalizeFailure[],
  step: FinalizeFailure["step"],
  run: () => Promise<void>,
): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    failures.push({
      step,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function finalize(
  tip: RunTip,
  boundary: FinalizeBoundary,
): Promise<void> {
  const mergeTicket = await boundary.ensureMergeTicket(tip);
  const failures: FinalizeFailure[] = [];

  await degrade(failures, "simplify", () => boundary.simplify(mergeTicket));
  if (!(await boundary.tipIsClean())) {
    throw new Error(
      `${tip.branch} has uncommitted changes after simplify; the tip is unsafe to explain or publish`,
    );
  }

  const path = explainerPath(tip);
  const explained = await degrade(failures, "explainer", () =>
    boundary.explain(path),
  );
  let explainerUrl: string | undefined;
  if (explained) {
    await degrade(failures, "upload", async () => {
      explainerUrl = await boundary.upload(path);
    });
  }

  await degrade(failures, "qa", () => boundary.qa(mergeTicket));

  await boundary.publish({
    tip,
    mergeTicket,
    ...(explainerUrl ? { explainerUrl } : {}),
    failures,
  });
}

/** The publisher reads one string, so structure survives only as far as the
 *  boundary. */
export function renderFailures(failures: readonly FinalizeFailure[]): string {
  return failures.length === 0
    ? "none"
    : failures.map(({ step, reason }) => `${step}: ${reason}`).join("\n");
}

export async function findOrCreateMergeTicket(
  tip: RunTip,
  context: ImplementContext,
): Promise<number> {
  const { number } = await context.headAgentOutput(
    {
      name: "merge-ticket",
      logName: FINALIZE_LOG_NAMES.mergeTicket,
      prompt: "merge-ticket",
      agent: MERGE_TICKET_AGENT,
      promptArgs: { RUN_TIP: tip.branch, BASE_BRANCH: tip.base },
    },
    "merge-ticket",
    z.object({ number: z.number().int().positive() }),
  );
  return number;
}

export async function runFinalize(
  tip: RunTip,
  context: ImplementContext,
): Promise<void> {
  return finalize(tip, {
    ensureMergeTicket: () => findOrCreateMergeTicket(tip, context),
    simplify: async (mergeTicket) => {
      const sandbox = await context.tipSandbox(tip);
      await context.sandboxAgent(sandbox, {
        name: "simplify",
        logName: FINALIZE_LOG_NAMES.simplify,
        prompt: "simplify",
        agent: SIMPLIFY_AGENT,
        maxIterations: 1,
        promptArgs: {
          BASE_BRANCH: tip.base,
          RUN_TIP: tip.branch,
          MERGE_TICKET: mergeTicket,
          VERIFY_COMMAND,
        },
      });
    },
    tipIsClean: async () => {
      const sandbox = await context.tipSandbox(tip);
      return context.git(sandbox.worktreePath, "status", "--porcelain") === "";
    },
    explain: async (path) => {
      const sandbox = await context.tipSandbox(tip);
      await context.sandboxAgent(sandbox, {
        name: "explainer",
        logName: FINALIZE_LOG_NAMES.explainer,
        prompt: "explainer",
        agent: EXPLAINER_AGENT,
        maxIterations: EXPLAINER_MAX_ITERATIONS,
        promptArgs: { RUN_TIP: tip.branch, BASE_BRANCH: tip.base, PATH: path },
      });
      if (!existsSync(join(sandbox.worktreePath, path))) {
        throw new Error("explainer was not written");
      }
    },
    upload: async (path) => {
      const sandbox = await context.tipSandbox(tip);
      const host = createExplainerHost(context.root);
      if (!host) {
        throw new Error(
          "explainer hosting is not configured; set EXPLAINER_HOST (and its EXPLAINER_* settings) in .sandcastle/.env",
        );
      }
      const url = await host.publish(
        join(sandbox.worktreePath, path),
        basename(path),
      );
      context.appendLog(FINALIZE_LOG_NAMES.upload, url);
      return url;
    },
    qa: async (mergeTicket) => {
      const sandbox = await context.tipSandbox(tip);
      try {
        await context.sandboxAgent(sandbox, {
          name: "qa",
          logName: FINALIZE_LOG_NAMES.qa,
          prompt: "qa",
          agent: QA_AGENT,
          maxIterations: 1,
          promptArgs: {
            BASE_BRANCH: tip.base,
            RUN_TIP: tip.branch,
            MERGE_TICKET: mergeTicket,
          },
        });
      } finally {
        context.git(sandbox.worktreePath, "reset", "--hard");
        context.git(sandbox.worktreePath, "clean", "-fd");
      }
    },
    publish: async (input) => {
      await context.headAgent({
        name: "publish",
        logName: FINALIZE_LOG_NAMES.publish,
        prompt: "publish",
        agent: PUBLISH_AGENT,
        promptArgs: {
          RUN_TIP: input.tip.branch,
          BASE_BRANCH: input.tip.base,
          MERGE_TICKET: input.mergeTicket,
          EXPLAINER: input.explainerUrl ?? "omitted",
          FAILURES: renderFailures(input.failures),
        },
      });
    },
  });
}
