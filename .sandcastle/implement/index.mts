import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BASE_BRANCH,
  COPY_TO_WORKTREE,
  FOLD_WAVE_VERIFY_CHECKS,
  IN_REVIEW_LABEL,
  LIFECYCLE_MAX_WAVES,
  SANDBOX_NETWORK,
} from "./config/knobs.mts";
import { ImplementContext } from "./context.mts";
import { git, isAncestor } from "../helpers/git.mts";
import {
  parseRunTipBranch,
  runTipName,
  type RunTipBranch,
} from "./naming.mts";
import type { TrackerIssue } from "../helpers/issueTracker.mts";
import { runFinalize } from "./stages/finalize.mts";
import { foldCompletedBranches } from "./stages/foldWave.mts";
import {
  issueBranch,
  isMergeBranch,
  planNextWave,
} from "./stages/planWave.mts";
import type { WavePlan } from "./stages/planWave.mts";
import {
  runPlannedTickets,
  type CompletedBranch,
} from "./stages/runTicket.mts";

export type RunTip = {
  readonly branch: RunTipBranch;
  readonly base: string;
};

export { parseRunTipBranch, type RunTipBranch };

/** The counterpart to the body `prompts/merge-ticket.md` writes. Both sides must
 *  agree; `base` is the one knob that varies. */
export function parseMergeTicketRunTip(
  description: string,
  base = BASE_BRANCH,
): RunTipBranch | null {
  const match = new RegExp(
    `^Run tip:\\s*(merge/\\S+)\\nTarget:\\s*${base}\\s*$`,
    "m",
  ).exec(description);
  return match ? parseRunTipBranch(match[1]!) : null;
}

export type ImplementationSteps = {
  planWave(tip: RunTip): Promise<WavePlan>;
  runWave(plan: WavePlan, tip: RunTip): Promise<void>;
  finalize(tip: RunTip): Promise<void>;
};

export type RunPrelude = {
  findMergeTicketTips(): Promise<readonly string[]>;
  /** Source branches of the open integration change requests. */
  findIntegrationChangeBranches(): Promise<readonly string[]>;
  createTip(branch: string, base: string): Promise<void>;
  nextTipName(): Promise<string>;
};

export async function getRunTip(
  prelude: RunPrelude,
  base = BASE_BRANCH,
): Promise<RunTip> {
  const tickets = await prelude.findMergeTicketTips();
  const changeRequests = await prelude.findIntegrationChangeBranches();
  if (tickets.length > 1) {
    throw new Error(`multiple active merge tickets: ${tickets.join(", ")}`);
  }
  if (changeRequests.length > 1) {
    throw new Error(
      `multiple active integration change requests: ${changeRequests.join(", ")}`,
    );
  }
  const ticketTip = tickets[0] ? parseRunTipBranch(tickets[0]) : undefined;
  const changeTip = changeRequests[0]
    ? parseRunTipBranch(changeRequests[0])
    : undefined;
  if (ticketTip && changeTip && ticketTip !== changeTip) {
    throw new Error(
      `merge ticket run tip ${ticketTip} does not match integration change request source ${changeTip}`,
    );
  }
  const existing = ticketTip ?? changeTip;
  if (existing) return { branch: existing, base };

  const branch = parseRunTipBranch(await prelude.nextTipName());
  await prelude.createTip(branch, base);
  return { branch, base };
}

export type RunOptions = {
  readonly tip: RunTip;
  readonly steps: ImplementationSteps;
  readonly maxWaves: number;
  readonly tipIsEmpty: (tip: RunTip) => Promise<boolean>;
};

export async function runImplementation(options: RunOptions): Promise<void> {
  if (!Number.isInteger(options.maxWaves) || options.maxWaves < 1) {
    throw new Error("maxWaves must be a positive integer");
  }

  let planned = 0;
  for (let wave = 0; wave < options.maxWaves; wave++) {
    const plan = await options.steps.planWave(options.tip);
    if (plan.issues.length === 0) break;
    planned += plan.issues.length;
    await options.steps.runWave(plan, options.tip);
  }

  if (await options.tipIsEmpty(options.tip)) {
    // Nothing to integrate is the normal idle outcome. Having planned work and
    // still holding an empty tip means every ticket halted or every fold rolled
    // back, which previously reported as a clean lifecycle completion.
    if (planned > 0) {
      throw new Error(
        [
          `${planned} planned ticket(s) produced nothing on ${options.tip.branch}: every ticket halted or every fold was rolled back.`,
          "Next steps:",
          "- If issues are ready-for-human: read each HALTED comment, fix the cause, relabel ready-for-agent, then re-run.",
          "- If issues are still in-review: fix the fold/verify failure, then re-run so abandoned in-review branches fold onto the tip.",
        ].join("\n"),
      );
    }
    return;
  }
  await options.steps.finalize(options.tip);
}

export function gitTipIsEmpty(tip: RunTip, cwd = process.cwd()): boolean {
  return git(cwd, "rev-list", "--count", `${tip.base}..${tip.branch}`) === "0";
}

export type TipEvidence = {
  tickets: string[];
  changeBranches: string[];
  inReview: number[];
};

/** Reads the durable run-tip evidence off the tracker. Pure: the tracker's two
 *  reads are the only tracker access the prelude needs. */
export function tipEvidence(
  issues: readonly TrackerIssue[],
  changeRequestBranches: readonly string[],
): TipEvidence {
  const tickets = issues.flatMap((issue) => {
    if (issue.labels.length) return [];
    const branch = parseMergeTicketRunTip(issue.description);
    const expected = `Merge ${branch} into ${BASE_BRANCH}`;
    return branch && issue.title === expected ? [branch] : [];
  });
  const changeBranches = changeRequestBranches.filter(isMergeBranch);
  const inReview = issues.flatMap((issue) =>
    issue.labels.includes(IN_REVIEW_LABEL) ? [issue.number] : [],
  );
  return { tickets, changeBranches, inReview };
}

function nextTipName(context: ImplementContext): string {
  const branches = new Set(
    git(
      context.root,
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/merge",
      "refs/remotes/origin/merge",
    )
      .split("\n")
      .map((branch) => branch.replace(/^origin\//, "")),
  );
  const branch = runTipName(new Date());
  if (branches.has(branch)) {
    throw new Error(`run tip ${branch} already exists`);
  }
  return branch;
}

/** The knob checks that must hold before any sandbox or tracker work starts.
 *  A missing `COPY_TO_WORKTREE` path is a configuration error better raised
 *  here than as a mid-run surprise inside a ticket worktree. */
export function assertKnobsUsable(
  root: string,
  warn: (message: string) => void,
): void {
  const missing = COPY_TO_WORKTREE.filter(
    (file) => !existsSync(join(root, file)),
  );
  if (missing.length > 0) {
    throw new Error(
      `COPY_TO_WORKTREE names files that do not exist: ${missing.join(", ")} — fix .sandcastle/implement/config/knobs.mts`,
    );
  }
  if (FOLD_WAVE_VERIFY_CHECKS.length === 0) {
    warn(
      "no verify checks configured: folds land unverified — set FOLD_WAVE_VERIFY_CHECKS in .sandcastle/implement/config/knobs.mts",
    );
  }
}

export async function runLoop(): Promise<void> {
  const startedAt = Date.now();
  const context = new ImplementContext();
  assertKnobsUsable(context.root, (message) => context.log.warn(message));
  context.log.step(`sandbox network mode: ${SANDBOX_NETWORK}`);
  const tracker = context.issueTracker;
  const evidence = tipEvidence(
    tracker.listIssues(),
    tracker.listChangeRequestBranches(),
  );
  const tip = await getRunTip({
    findMergeTicketTips: async () => evidence.tickets,
    findIntegrationChangeBranches: async () => evidence.changeBranches,
    nextTipName: async () => nextTipName(context),
    createTip: async (branch, base) =>
      void git(context.root, "branch", branch, base),
  });

  try {
    // Already-built ticket branches that never landed on this tip.
    const abandoned = evidence.inReview.filter(
      (issue) => !isAncestor(context.root, issueBranch(issue), tip.branch),
    );
    await foldCompletedBranches(abandoned, tip, context);

    await runImplementation({
      tip,
      maxWaves: LIFECYCLE_MAX_WAVES,
      tipIsEmpty: async () => gitTipIsEmpty(tip, context.root),
      steps: {
        planWave: (runTip) => planNextWave(runTip, context),
        runWave: async (plan, runTip) => {
          const completed = await runPlannedTickets(plan, runTip, context);
          await foldCompletedBranches(
            completed.filter(
              (branch): branch is CompletedBranch => branch !== null,
            ),
            runTip,
            context,
          );
        },
        finalize: (runTip) => runFinalize(runTip, context),
      },
    });
    context.log.ok(`implementation lifecycle completed on ${tip.branch}`, {
      since: startedAt,
    });
  } finally {
    await context.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await runLoop();
}
