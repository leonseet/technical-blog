import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { foldWave, runStrictChecks, type FoldBoundary } from "./foldWave.mts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const tip = {
  branch: "merge/2026-07-24-a" as import("../index.mts").RunTip["branch"],
  base: "main",
};

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "fold-wave-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "base.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  git(root, "branch", tip.branch);
  return root;
}

function addBranch(root: string, number: number, file = `issue-${number}.txt`) {
  git(root, "checkout", "-b", `feat/issue-${number}`, tip.branch);
  writeFileSync(join(root, file), `issue ${number}\n`);
  git(root, "add", ".");
  git(root, "commit", "-m", `issue ${number}`);
  git(root, "checkout", tip.branch);
}

function boundary(root: string, events: string[]): FoldBoundary {
  return {
    worktree: root,
    verifyChecks: async (item) => {
      events.push(`output:feat/issue-${item}:tests passed`);
      events.push("verify");
      return "tests passed";
    },
    resolveConflict: async () => {
      events.push("resolve");
      // During a rebase, --theirs is the candidate branch's commit.
      git(root, "checkout", "--theirs", "shared.txt");
      git(root, "add", "shared.txt");
      git(root, "-c", "core.editor=true", "rebase", "--continue");
      return "kept candidate behavior";
    },
    mergeNote: async (item) => void events.push(`note:feat/issue-${item}`),
    mergeFail: async (item) => void events.push(`fail:feat/issue-${item}`),
    recordFoldProgress: (item, message) =>
      void events.push(`log:feat/issue-${item}:${message}`),
  };
}

test("folds sequentially in planner order without an agent on the mechanical path", async () => {
  const root = repo();
  addBranch(root, 2);
  addBranch(root, 1);
  const events: string[] = [];
  await foldWave([2, 1], tip, boundary(root, events));
  assert.deepEqual(events, [
    "log:feat/issue-2:Folding feat/issue-2",
    "output:feat/issue-2:tests passed",
    "verify",
    "log:feat/issue-2:Verified: tests passed",
    "log:feat/issue-1:Folding feat/issue-1",
    "output:feat/issue-1:tests passed",
    "verify",
    "log:feat/issue-1:Verified: tests passed",
  ]);
  const subject = git(root, "log", "--format=%s", `${tip.base}..HEAD`);
  assert.ok(subject.indexOf("issue 1") < subject.indexOf("issue 2"));
  // The fold rebases and fast-forwards, so the tip history stays linear.
  assert.equal(
    git(root, "rev-list", "--merges", "--count", `${tip.base}..HEAD`),
    "0",
  );
});

test("a branch pinned by a leftover ticket worktree still folds", async () => {
  const root = repo();
  addBranch(root, 5);
  git(root, "worktree", "add", join(root, "wt-issue-5"), "feat/issue-5");
  const events: string[] = [];
  await foldWave([5], tip, boundary(root, events));
  git(root, "merge-base", "--is-ancestor", "feat/issue-5", "HEAD");
  assert.equal(existsSync(join(root, "wt-issue-5")), false);
});

test("conflicts invoke the resolver and record a merge note", async () => {
  const root = repo();
  git(root, "checkout", tip.branch);
  writeFileSync(join(root, "shared.txt"), "tip\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "tip");
  git(root, "checkout", "-b", "feat/issue-3", "main");
  writeFileSync(join(root, "shared.txt"), "candidate\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "issue 3");
  git(root, "checkout", tip.branch);
  const events: string[] = [];
  await foldWave([3], tip, boundary(root, events));
  assert.deepEqual(events, [
    "log:feat/issue-3:Folding feat/issue-3",
    "resolve",
    "output:feat/issue-3:tests passed",
    "verify",
    "log:feat/issue-3:Verified: tests passed",
    "note:feat/issue-3",
  ]);
  execFileSync("git", ["merge-base", "--is-ancestor", "feat/issue-3", "HEAD"], {
    cwd: root,
  });
});

test("a failed branch rolls back its artifacts and later branches still fold", async () => {
  const root = repo();
  addBranch(root, 1);
  addBranch(root, 2);
  const events: string[] = [];
  const api = boundary(root, events);
  let checks = 0;
  api.verifyChecks = async (item) => {
    if (checks++ === 0) {
      writeFileSync(join(root, "artifact.txt"), "partial\n");
      throw new Error("checks failed");
    }
    events.push(`output:feat/issue-${item}:passed`);
    return "passed";
  };
  await foldWave([1, 2], tip, api);
  assert.equal(existsSync(join(root, "artifact.txt")), false);
  assert.deepEqual(events, [
    "log:feat/issue-1:Folding feat/issue-1",
    "log:feat/issue-1:Rolled back: checks failed",
    "fail:feat/issue-1",
    "log:feat/issue-2:Folding feat/issue-2",
    "output:feat/issue-2:passed",
    "log:feat/issue-2:Verified: passed",
  ]);
  assert.throws(() =>
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", "feat/issue-1", "HEAD"],
      {
        cwd: root,
      },
    ),
  );
  execFileSync("git", ["merge-base", "--is-ancestor", "feat/issue-2", "HEAD"], {
    cwd: root,
  });
});

test("tracker-reporting failures neither undo proven folds nor stop later branches", async () => {
  const root = repo();
  addBranch(root, 1);
  addBranch(root, 2);
  const api = boundary(root, []);
  let checks = 0;
  api.verifyChecks = async () => {
    if (checks++ === 0) throw new Error("first fold failed");
    return "passed";
  };
  api.mergeFail = async () => {
    throw new Error("tracker unavailable");
  };
  await foldWave([1, 2], tip, api);
  execFileSync("git", ["merge-base", "--is-ancestor", "feat/issue-2", "HEAD"], {
    cwd: root,
  });
});

test("in-sandbox verification rejects a nonzero command result", async () => {
  const commands: string[] = [];
  const lines: string[] = [];
  await assert.rejects(
    runStrictChecks(
      {
        exec: async (command: string, options) => {
          commands.push(command);
          options?.onLine?.("running");
          return { stdout: "", stderr: "boom", exitCode: 7 };
        },
      },
      [["pnpm", "test"]],
      (line) => lines.push(line),
    ),
    /pnpm test.*exit 7.*boom/i,
  );
  assert.deepEqual(commands, ["pnpm test 2>&1"]);
  assert.deepEqual(lines, ["$ pnpm test", "running"]);
});

test("failure detail keeps stdout when stderr carries only noise", async () => {
  // The regression that made every merge failure read as a DeprecationWarning:
  // test runners summarise on stdout while stderr holds warnings.
  await assert.rejects(
    runStrictChecks(
      {
        exec: async () => ({
          stdout: "FAILED tests/docs/test_dataflow.py::test_shipped",
          stderr: "DeprecationWarning: swigvarlink has no __module__",
          exitCode: 2,
        }),
      },
      [["make", "test"]],
    ),
    (error: Error) =>
      error.message.includes(
        "FAILED tests/docs/test_dataflow.py::test_shipped",
      ) && error.message.includes("DeprecationWarning"),
  );
});

test("failure detail keeps the diagnostic tail of long output", async () => {
  const noise = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  await assert.rejects(
    runStrictChecks(
      {
        exec: async () => ({
          stdout: `${noise}\n2 failed, 300 passed`,
          stderr: "",
          exitCode: 1,
        }),
      },
      [["make", "test"]],
    ),
    (error: Error) =>
      error.message.includes("2 failed, 300 passed") &&
      !error.message.includes("line 0"),
  );
});
