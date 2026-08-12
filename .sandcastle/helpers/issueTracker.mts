// The issue-tracker seam: one vocabulary for "issues and change requests", with
// a `glab` and a `gh` implementation behind it. Everything above this file talks
// about issues and *change requests* — never merge requests or pull requests —
// so the implement loop reads the same on either host.
//
// The prompt side keeps its own seam: agents read `docs/agents/issue-tracker.md`,
// which states the CLI conventions for whichever tracker this repo lives on.
//
//   import { createIssueTracker } from "../helpers/issueTracker.mts";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { z } from "zod";

import { ghJson, issueComment, issueRelabel as ghRelabel } from "./gh.mts";
import { git } from "./git.mts";
import { glabJson, issueNote, issueRelabel as glabRelabel } from "./glab.mts";

export type TrackerKind = "gitlab" | "github";

/** An open issue, normalized across trackers. `number` is the user-facing id
 *  (GitLab's `iid`, GitHub's `number`) — the one that `#42` refers to. */
export type TrackerIssue = {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly labels: readonly string[];
};

/** Bound to one repo checkout: `createIssueTracker` resolves the host from that
 *  checkout, so the methods cannot be pointed at a different one. */
export type IssueTracker = {
  /** The open issues only — closed ones never reach the loop. */
  listIssues(): readonly TrackerIssue[];
  /** Source branches of the open change requests (GitLab merge requests,
   *  GitHub pull requests). The loop only ever needs the branch. */
  listChangeRequestBranches(): readonly string[];
  /** Post a comment on an issue. GitLab calls these notes, GitHub comments. */
  comment(issue: number, body: string): void;
  /** Move an issue between triage labels. Both ends are optional so a pure add
   *  or a pure removal needs no placeholder. */
  relabel(issue: number, change: LabelChange): void;
};

export type LabelChange = {
  readonly add?: string;
  readonly remove?: string;
};

/** No labels named is not an error worth raising — it is simply nothing to do,
 *  and neither CLI accepts an update with no flags. */
const relabelWith =
  (apply: (issue: number, change: LabelChange) => void) =>
  (issue: number, change: LabelChange): void => {
    if (!change.add && !change.remove) return;
    apply(issue, change);
  };

// --- detection --------------------------------------------------------------

/** Host of the `origin` remote, for both scp-like (`git@host:path`) and URL
 *  (`https://host/path`, `ssh://git@host:port/path`) spellings. */
export function remoteHost(url: string): string | null {
  const scp = /^(?:[^@/]+@)?([^@/:]+):(?!\/)/.exec(url);
  if (scp) return scp[1]!.toLowerCase();
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export type DetectEnv = {
  readonly SANDCASTLE_ISSUE_TRACKER?: string | undefined;
  readonly GITLAB_HOST?: string | undefined;
  readonly GH_HOST?: string | undefined;
};

/** Pick the tracker for a repo. An explicit `SANDCASTLE_ISSUE_TRACKER` always
 *  wins; then a configured self-hosted host; then the public hostnames.
 *
 *  Self-hosted instances are why hostname sniffing alone is not enough — an
 *  origin like `git.corp.example` names neither tracker. */
export function detectTrackerKind(
  host: string | null,
  env: DetectEnv,
): TrackerKind {
  const explicit = env.SANDCASTLE_ISSUE_TRACKER?.trim().toLowerCase();
  if (explicit) {
    if (explicit === "gitlab" || explicit === "github") return explicit;
    throw new Error(
      `SANDCASTLE_ISSUE_TRACKER must be "gitlab" or "github", got "${explicit}"`,
    );
  }
  // A configured host may be spelled as a URL; `remoteHost` already knows how to
  // reduce one to a hostname, and a bare host falls through to itself.
  const configured = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    return remoteHost(trimmed) ?? trimmed.toLowerCase();
  };
  if (host) {
    if (configured(env.GITLAB_HOST) === host) return "gitlab";
    if (configured(env.GH_HOST) === host) return "github";
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  }
  throw new Error(
    `cannot tell which issue tracker ${host ?? "this repo"} uses; set ` +
      `SANDCASTLE_ISSUE_TRACKER=gitlab|github (or GITLAB_HOST / GH_HOST) in .sandcastle/.env`,
  );
}

// --- implementations --------------------------------------------------------

/** Both CLIs page at 30 by default; the loop needs every open ticket, so both
 *  list calls raise the page size explicitly. */
const LIST_LIMIT = "200";

const gitlabIssuesSchema = z.array(
  z.object({
    iid: z.number().nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    labels: z.array(z.string()).nullish(),
    state: z.string().nullish(),
  }),
);

const gitlabChangeRequestsSchema = z.array(
  z.object({ source_branch: z.string().nullish() }),
);

function gitlabTracker(cwd: string): IssueTracker {
  return {
    listIssues: () =>
      glabJson(
        cwd,
        gitlabIssuesSchema,
        "issue",
        "list",
        "--per-page",
        LIST_LIMIT,
        "-O",
        "json",
      ).flatMap((issue) =>
        // `glab issue list` defaults to open issues; the state check holds the
        // contract even if that default ever moves.
        issue.iid == null || issue.state !== "opened"
          ? []
          : [
              {
                number: issue.iid,
                title: issue.title ?? `Issue ${issue.iid}`,
                description: issue.description ?? "",
                labels: issue.labels ?? [],
              },
            ],
      ),
    listChangeRequestBranches: () =>
      glabJson(
        cwd,
        gitlabChangeRequestsSchema,
        "mr",
        "list",
        "--per-page",
        LIST_LIMIT,
        "-F",
        "json",
      ).flatMap((mr) => (mr.source_branch ? [mr.source_branch] : [])),
    comment: (issue, body) => issueNote(cwd, issue, body),
    relabel: relabelWith((issue, change) => glabRelabel(cwd, issue, change)),
  };
}

const githubIssuesSchema = z.array(
  z.object({
    number: z.number().nullish(),
    title: z.string().nullish(),
    body: z.string().nullish(),
    labels: z.array(z.object({ name: z.string().nullish() })).nullish(),
  }),
);

const githubChangeRequestsSchema = z.array(
  z.object({ headRefName: z.string().nullish() }),
);

function githubTracker(cwd: string): IssueTracker {
  return {
    listIssues: () =>
      // `--state open` filters server-side, so every row here is an open issue.
      ghJson(
        cwd,
        githubIssuesSchema,
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        LIST_LIMIT,
        "--json",
        "number,title,body,labels",
      ).flatMap((issue) =>
        issue.number == null
          ? []
          : [
              {
                number: issue.number,
                title: issue.title ?? `Issue ${issue.number}`,
                description: issue.body ?? "",
                labels:
                  issue.labels?.flatMap((label) =>
                    label.name ? [label.name] : [],
                  ) ?? [],
              },
            ],
      ),
    listChangeRequestBranches: () =>
      ghJson(
        cwd,
        githubChangeRequestsSchema,
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        LIST_LIMIT,
        "--json",
        "headRefName",
      ).flatMap((pr) => (pr.headRefName ? [pr.headRefName] : [])),
    comment: (issue, body) => issueComment(cwd, issue, body),
    relabel: relabelWith((issue, change) => ghRelabel(cwd, issue, change)),
  };
}

const TRACKERS: Record<TrackerKind, (cwd: string) => IssueTracker> = {
  gitlab: gitlabTracker,
  github: githubTracker,
};

/** Sandcastle injects `.sandcastle/.env` into sandboxes, but the loop's own
 *  process never receives it — so detection reads the file itself. That file is
 *  also where the docs tell you to put the tracker settings. Real environment
 *  variables still win. */
export function issueTrackerEnv(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): DetectEnv {
  let file: NodeJS.Dict<string> = {};
  try {
    file = parseEnv(readFileSync(join(cwd, ".sandcastle", ".env"), "utf8"));
  } catch {
    // No project env file: environment variables are the only source.
  }
  return {
    SANDCASTLE_ISSUE_TRACKER:
      env.SANDCASTLE_ISSUE_TRACKER || file.SANDCASTLE_ISSUE_TRACKER,
    GITLAB_HOST: env.GITLAB_HOST || file.GITLAB_HOST,
    GH_HOST: env.GH_HOST || file.GH_HOST,
  };
}

/** Resolve the issue tracker for the repo rooted at `cwd`. */
export function createIssueTracker(
  cwd: string,
  env: DetectEnv = issueTrackerEnv(cwd),
): IssueTracker {
  let url: string;
  try {
    url = git(cwd, "remote", "get-url", "origin");
  } catch {
    url = "";
  }
  return TRACKERS[detectTrackerKind(remoteHost(url), env)](cwd);
}
