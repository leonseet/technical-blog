import assert from "node:assert/strict";
import { test } from "vitest";

import {
  detectTrackerKind,
  issueTrackerEnv,
  remoteHost,
} from "./issueTracker.mts";

test("remote host parses both scp-like and URL remotes", () => {
  assert.equal(
    remoteHost("git@gitlab.example.com:acme/widgets.git"),
    "gitlab.example.com",
  );
  assert.equal(remoteHost("https://github.com/owner/repo.git"), "github.com");
  assert.equal(
    remoteHost("ssh://git@gitlab.example.com:2222/owner/repo.git"),
    "gitlab.example.com",
  );
  assert.equal(remoteHost("not a remote"), null);
});

test("explicit SANDCASTLE_ISSUE_TRACKER wins over every hostname signal", () => {
  assert.equal(
    detectTrackerKind("github.com", { SANDCASTLE_ISSUE_TRACKER: "gitlab" }),
    "gitlab",
  );
  assert.equal(detectTrackerKind(null, { SANDCASTLE_ISSUE_TRACKER: "GitHub" }), "github");
  assert.throws(
    () => detectTrackerKind("github.com", { SANDCASTLE_ISSUE_TRACKER: "bitbucket" }),
    /must be "gitlab" or "github"/,
  );
});

test("a configured self-hosted host names the tracker", () => {
  // The case that hostname sniffing alone cannot solve — a self-hosted instance.
  assert.equal(
    detectTrackerKind("gitlab.example.com", { GITLAB_HOST: "gitlab.example.com" }),
    "gitlab",
  );
  assert.equal(
    detectTrackerKind("gitlab.example.com", { GITLAB_HOST: "https://gitlab.example.com/" }),
    "gitlab",
  );
  assert.equal(
    detectTrackerKind("git.corp.example", { GH_HOST: "git.corp.example" }),
    "github",
  );
});

test("public hostnames resolve without configuration", () => {
  assert.equal(detectTrackerKind("github.com", {}), "github");
  assert.equal(detectTrackerKind("gitlab.com", {}), "gitlab");
});

test("an unrecognized host fails loudly rather than guessing", () => {
  assert.throws(
    () => detectTrackerKind("gitlab.example.com", {}),
    /set SANDCASTLE_ISSUE_TRACKER=gitlab\|github/,
  );
  assert.throws(() => detectTrackerKind(null, {}), /cannot tell which issue tracker/);
});

test("real environment variables win over the project env file", () => {
  // No .sandcastle/.env under a temp dir, so only the environment is read.
  const resolved = issueTrackerEnv("/nonexistent", {
    GITLAB_HOST: "env.example",
    SANDCASTLE_ISSUE_TRACKER: "",
  });
  assert.equal(resolved.GITLAB_HOST, "env.example");
  // An empty value is not a setting; it must not shadow the file.
  assert.equal(resolved.SANDCASTLE_ISSUE_TRACKER, undefined);
});
