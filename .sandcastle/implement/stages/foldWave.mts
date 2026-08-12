import { FOLD_WAVE_RESOLVE_CONFLICT_AGENT } from "../config/agents.mts";
import { FOLD_WAVE_VERIFY_CHECKS } from "../config/knobs.mts";
import {
  git,
  gitResult,
  hasConflicts,
  isAncestor,
  isDirty,
  rebaseInProgress,
  releaseBranchWorktrees,
} from "../../helpers/git.mts";
import type { ImplementContext } from "../context.mts";
import type { RunTip } from "../index.mts";
import { issueBranch } from "./planWave.mts";
import type { CompletedBranch } from "./runTicket.mts";

type SandboxExecutor = {
  exec(
    command: string,
    options?: { readonly onLine?: (line: string) => void },
  ): Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
  }>;
};

/** Lines of failure output carried into the tracker comment. Test runners put
 *  their summary last, so the tail is the diagnostic part. */
const FAILURE_DETAIL_LINES = 40;

/** Both streams, tail-trimmed. Preferring one stream loses the diagnosis: a
 *  runner can write its summary to stdout while stderr holds only warnings. */
function failureDetail(stdout: string, stderr: string): string {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  const lines = combined.split("\n");
  return lines.slice(-FAILURE_DETAIL_LINES).join("\n");
}

export async function runStrictChecks(
  sandbox: SandboxExecutor,
  checks: readonly (readonly string[])[],
  onLine: (line: string) => void = () => undefined,
): Promise<string> {
  const commands: string[] = [];
  for (const check of checks) {
    const command = check.join(" ");
    commands.push(command);
    onLine(`$ ${command}`);
    const result = await sandbox.exec(`${command} 2>&1`, { onLine });
    if (result.exitCode !== 0) {
      const detail = failureDetail(result.stdout, result.stderr);
      throw new Error(
        `${command} failed with exit ${result.exitCode}${detail ? `: ${detail}` : ""}`,
      );
    }
  }
  return commands.join("; ");
}

export function rollbackBranch(
  worktree: string,
  before: string,
  tipBranch: string,
): void {
  // A failure after the rebase finished has no active rebase to abort.
  if (rebaseInProgress(worktree)) {
    git(worktree, "rebase", "--abort");
  }
  // A failed fold can strand the worktree on the candidate branch.
  git(worktree, "checkout", tipBranch);
  git(worktree, "reset", "--hard", before);
  git(worktree, "clean", "-fd");
  if (isDirty(worktree)) {
    throw new Error("branch rollback did not restore a clean worktree");
  }
}

export type FoldBoundary = {
  readonly worktree: string;
  verifyChecks(candidate: CompletedBranch): Promise<string>;
  recordFoldProgress(candidate: CompletedBranch, message: string): void;
  /** Resolve the in-progress conflicted rebase; returns the decision
   *  narrative. Verification is the fold's own concern, not the resolver's. */
  resolveConflict(candidate: CompletedBranch, tip: RunTip): Promise<string>;
  mergeNote(
    candidate: CompletedBranch,
    tip: RunTip,
    note: { readonly decision: string; readonly verification: string },
  ): Promise<void>;
  mergeFail(
    candidate: CompletedBranch,
    tip: RunTip,
    reason: string,
  ): Promise<void>;
};

export async function foldWave(
  branches: readonly CompletedBranch[],
  tip: RunTip,
  boundary: FoldBoundary,
): Promise<void> {
  for (const candidate of branches) {
    const branch = issueBranch(candidate);
    const before = git(boundary.worktree, "rev-parse", "HEAD");
    let decision: string | undefined;
    let verification: string;
    try {
      boundary.recordFoldProgress(candidate, `Folding ${branch}`);
      releaseBranchWorktrees(boundary.worktree, branch);
      const rebase = gitResult(
        boundary.worktree,
        "rebase",
        "--empty=drop",
        before,
        branch,
      );
      if (rebase.code !== 0) {
        // Unmerged paths are the authoritative conflict signal; any other
        // failure (bad ref, dirty tree) is a genuine error.
        if (!hasConflicts(boundary.worktree)) {
          throw new Error(
            `git rebase ${branch} failed: ${
              rebase.stderr.trim() || rebase.stdout.trim()
            }`,
          );
        }
        decision = await boundary.resolveConflict(candidate, tip);
        if (rebaseInProgress(boundary.worktree)) {
          throw new Error("conflict resolution left the rebase unfinished");
        }
      }
      git(boundary.worktree, "checkout", tip.branch);
      const forward = gitResult(
        boundary.worktree,
        "merge",
        "--ff-only",
        branch,
      );
      if (forward.code !== 0) {
        throw new Error(
          `git merge --ff-only ${branch} failed: ${
            forward.stderr.trim() || forward.stdout.trim()
          }`,
        );
      }
      verification = await boundary.verifyChecks(candidate);
      if (isDirty(boundary.worktree)) {
        throw new Error("fold left a dirty worktree");
      }
      if (!isAncestor(boundary.worktree, branch, "HEAD")) {
        throw new Error(`${branch} is not contained in the tip after the fold`);
      }
      boundary.recordFoldProgress(candidate, `Verified: ${verification}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      rollbackBranch(boundary.worktree, before, tip.branch);
      boundary.recordFoldProgress(candidate, `Rolled back: ${reason}`);
      try {
        await boundary.mergeFail(candidate, tip, reason);
      } catch {
        // Reporting failure cannot change the branch-scoped rollback or stop
        // later planner-ordered candidates.
      }
      continue;
    }
    if (decision !== undefined) {
      try {
        await boundary.mergeNote(candidate, tip, {
          decision,
          verification,
        });
      } catch {
        // Git already proved the fold. Narrative reporting must not undo it.
      }
    }
  }
}

export async function foldCompletedBranches(
  branches: readonly CompletedBranch[],
  tip: RunTip,
  context: ImplementContext,
): Promise<void> {
  const sandbox = await context.tipSandbox(tip);
  const appendCandidateLog = (
    candidate: CompletedBranch,
    line: string,
  ): void => {
    const branch = issueBranch(candidate).replace("/", "-");
    context.appendLog(`fold/${branch}`, line);
  };
  await foldWave(branches, tip, {
    worktree: sandbox.worktreePath,
    verifyChecks: async (candidate) =>
      runStrictChecks(sandbox, FOLD_WAVE_VERIFY_CHECKS, (line) =>
        appendCandidateLog(candidate, line),
      ),
    recordFoldProgress: appendCandidateLog,
    resolveConflict: async (candidate) => {
      await context.sandboxAgent(sandbox, {
        name: `resolve-${candidate}`,
        logName: `fold/resolve-${candidate}`,
        prompt: "resolve-conflict",
        agent: FOLD_WAVE_RESOLVE_CONFLICT_AGENT,
        promptArgs: {
          BRANCH: issueBranch(candidate),
          RUN_TIP: tip.branch,
        },
      });
      return `Resolved conflict for #${candidate}`;
    },
    mergeNote: async (candidate, runTip, note) => {
      context.issueTracker.comment(
        candidate,
        `MERGE NOTE\nRun tip: ${runTip.branch}\nRelated tickets: #${candidate}\nDecision: ${note.decision}\nVerification: ${note.verification}`,
      );
    },
    mergeFail: async (candidate, runTip, reason) => {
      context.issueTracker.comment(
        candidate,
        `MERGE FAIL\nRun tip: ${runTip.branch}\nBranch: ${issueBranch(candidate)}\nReason: ${reason}`,
      );
    },
  });
}
