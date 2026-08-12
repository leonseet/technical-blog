// Thin git wrappers shared by the loop runners.
//
//   import { git, isDirty } from "../helpers/git.mts";

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Run git and return trimmed stdout; throws on a non-zero exit. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export type GitResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
};

/** Run git without throwing, so callers can branch on the exit code instead of
 *  catching — a failing subprocess is a value here, not control flow. */
export function gitResult(cwd: string, ...args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

export function isDirty(cwd: string): boolean {
  return git(cwd, "status", "--porcelain").length > 0;
}

/** True when `ancestor` is contained in `descendant`. Exit 1 means "no"; any
 *  other non-zero exit is a real failure (missing ref, corrupt repo) and throws
 *  rather than being reported as a plain "no". */
export function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
): boolean {
  const result = gitResult(
    cwd,
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant,
  );
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new Error(
    `git merge-base --is-ancestor ${ancestor} ${descendant} failed: ${result.stderr.trim()}`,
  );
}

/** Paths with unmerged stages — the authoritative "did that merge conflict?"
 *  test, independent of git's message wording. */
export function hasConflicts(cwd: string): boolean {
  return git(cwd, "ls-files", "--unmerged").length > 0;
}

/** True while this worktree has a rebase in progress, whichever backend git
 *  picked — the state directory is the durable signal, not REBASE_HEAD. */
export function rebaseInProgress(cwd: string): boolean {
  return ["rebase-merge", "rebase-apply"].some((dir) =>
    existsSync(resolve(cwd, git(cwd, "rev-parse", "--git-path", dir))),
  );
}

export type Worktree = {
  readonly path: string;
  readonly branch: string | null;
};

/** Parse `git worktree list --porcelain`. The primary worktree is listed first;
 *  sandcastle anchors `.sandcastle/worktrees/` there. */
export function listWorktrees(cwd: string): Worktree[] {
  return git(cwd, "worktree", "list", "--porcelain")
    .split("\n\n")
    .flatMap((record) => {
      const lines = record.split("\n");
      const path = lines
        .find((line) => line.startsWith("worktree "))
        ?.slice("worktree ".length);
      if (!path) return [];
      const branch =
        lines
          .find((line) => line.startsWith("branch "))
          ?.slice("branch ".length) ?? null;
      return [{ path, branch }];
    });
}

/** The primary worktree's root (the repo root), resolved even when `cwd` is
 *  inside a linked worktree. */
export function mainWorktreeRoot(cwd: string): string {
  return listWorktrees(cwd)[0]?.path ?? cwd;
}

/** Remove any linked worktree holding `branch` checked out, so the branch can
 *  be rebased, deleted, or checked out elsewhere. The primary worktree is
 *  never removed. */
export function releaseBranchWorktrees(cwd: string, branch: string): void {
  for (const worktree of listWorktrees(cwd).slice(1)) {
    if (worktree.branch === `refs/heads/${branch}`) {
      git(cwd, "worktree", "remove", "--force", worktree.path);
    }
  }
}
