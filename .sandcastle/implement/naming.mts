// Every branch name the loop creates or recognizes, in one module. These are
// the tool's own conventions, not configuration: a repo that wants different
// names edits this file, and the template's 3-way merge keeps the edit.

/** The per-ticket working branch. */
export const issueBranch = (number: number): string => `feat/issue-${number}`;

export function parseIssueBranch(branch: string): number | null {
  const match = /^feat\/issue-(\d+)$/.exec(branch);
  return match ? Number(match[1]) : null;
}

export const isMergeBranch = (branch: string): boolean =>
  branch.startsWith("merge/");

/** The run tip: one integration branch per run, named by local date and time
 *  (legacy tips used a letter suffix, still accepted). */
export type RunTipBranch = string & { readonly __runTipBranch: unique symbol };

export function parseRunTipBranch(value: string): RunTipBranch {
  if (!/^merge\/\d{4}-\d{2}-\d{2}-(?:\d{4}|[a-z]+)$/.test(value)) {
    throw new Error(`invalid run tip branch: ${value}`);
  }
  return value as RunTipBranch;
}

/** `merge/2026-07-25-1432` for a run started at 14:32 local on 2026-07-25. */
export function runTipName(now: Date): string {
  const date = now.toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `merge/${date}-${time}`;
}
