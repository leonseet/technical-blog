// Thin GitLab tracker wrappers. Flag spellings and the `cwd` convention live
// here, not at each call site — GitLab's own asymmetries (`-O json` for issues,
// `-F json` for merge requests) never escape this module.
//
// Loop code should import `helpers/issueTracker.mts` instead: it picks this or
// the `gh` wrapper and normalizes both to one vocabulary. Reach for `glab`
// directly only when you specifically mean GitLab.
//
//   import { glabJson, issueNote } from "../helpers/glab.mts";

import { cliRunner } from "./cli.mts";

const cli = cliRunner("glab");

export const glab = cli.run;
export const glabJson = cli.json;

export function issueNote(cwd: string, issue: number, body: string): void {
  glab(cwd, "issue", "note", String(issue), "--message", body);
}

export function issueRelabel(
  cwd: string,
  issue: number,
  change: { readonly add?: string; readonly remove?: string },
): void {
  glab(
    cwd,
    "issue",
    "update",
    String(issue),
    ...(change.add ? ["--label", change.add] : []),
    ...(change.remove ? ["--unlabel", change.remove] : []),
  );
}
