// Thin GitHub tracker wrappers, the `gh` counterpart to `glab.mts`. Flag
// spellings and the `cwd` convention live here, not at each call site.
//
// Loop code should import `helpers/issueTracker.mts` instead; reach for `gh`
// directly only when you specifically mean GitHub.
//
//   import { ghJson, issueComment } from "../helpers/gh.mts";

import { cliRunner } from "./cli.mts";

const cli = cliRunner("gh");

export const gh = cli.run;
export const ghJson = cli.json;

export function issueComment(cwd: string, issue: number, body: string): void {
  gh(cwd, "issue", "comment", String(issue), "--body", body);
}

export function issueRelabel(
  cwd: string,
  issue: number,
  change: { readonly add?: string; readonly remove?: string },
): void {
  gh(
    cwd,
    "issue",
    "edit",
    String(issue),
    ...(change.add ? ["--add-label", change.add] : []),
    ...(change.remove ? ["--remove-label", change.remove] : []),
  );
}
