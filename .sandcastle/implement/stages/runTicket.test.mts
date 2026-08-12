import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type * as sandcastle from "@ai-hero/sandcastle";

import {
  runTicket,
  runTicketsInParallel,
  type TicketBoundary,
} from "./runTicket.mts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "run-ticket-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "base.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  git(root, "branch", "merge/2026-07-24-a");
  return root;
}

const tip = {
  branch: "merge/2026-07-24-a" as import("../index.mts").RunTip["branch"],
  base: "main",
};

function boundary(root: string, verdicts: boolean[], events: string[]): TicketBoundary {
  const sandbox = {} as sandcastle.Sandbox;
  return {
    acquire: async (ticket) => {
      git(root, "checkout", "-b", `feat/issue-${ticket}`, tip.branch);
      return { worktree: root, sandbox, close: async () => {} };
    },
    runMaker: async ({ cycle, amend }) => {
      writeFileSync(join(root, "change.txt"), `cycle ${cycle}\n`);
      git(root, "add", ".");
      if (amend) git(root, "commit", "--amend", "--no-edit");
      else git(root, "commit", "-m", "feat(test): ticket");
      events.push(`maker:${cycle}:${amend}`);
    },
    runChecker: async () => {
      const approved = verdicts.shift() ?? false;
      events.push(approved ? "CHECKER PASS" : "CHECKER FAIL");
      return approved;
    },
    halt: async (_ticket, _worktree, cause) =>
      void events.push(cause ? `HALTED:${cause}` : "HALTED"),
  };
}

test("checker failure returns to maker and amends the one private commit", async () => {
  const root = repo();
  const events: string[] = [];
  const result = await runTicket(1, tip, 3, boundary(root, [false, true], events));
  assert.equal(result, 1);
  assert.equal(git(root, "rev-list", "--count", `${tip.branch}..HEAD`), "1");
  assert.deepEqual(events, [
    "maker:1:false",
    "CHECKER FAIL",
    "maker:2:true",
    "CHECKER PASS",
  ]);
});

test("exhaustion halts silently, leaving the findings on the thread", async () => {
  const root = repo();
  const events: string[] = [];
  const result = await runTicket(1, tip, 2, boundary(root, [false, false], events));
  assert.equal(result, null);
  assert.deepEqual(events, [
    "maker:1:false",
    "CHECKER FAIL",
    "maker:2:true",
    "CHECKER FAIL",
    "HALTED",
  ]);
});

test("maker and checker cycles reuse one ticket workspace until it closes", async () => {
  const root = repo();
  const events: string[] = [];
  const api = boundary(root, [false, true], events);
  let acquired = 0;
  let closed = 0;
  const handles: sandcastle.Sandbox[] = [];
  const acquire = api.acquire;
  api.acquire = async (...args) => {
    acquired++;
    const workspace = await acquire(...args);
    return {
      ...workspace,
      close: async () => {
        closed++;
        await workspace.close();
      },
    };
  };
  const runMaker = api.runMaker;
  api.runMaker = async (input) => {
    handles.push(input.sandbox);
    await runMaker(input);
  };
  const runChecker = api.runChecker;
  api.runChecker = async (input) => {
    handles.push(input.sandbox);
    return runChecker(input);
  };

  await runTicket(1, tip, 2, api);

  assert.equal(acquired, 1);
  assert.equal(closed, 1);
  assert.equal(new Set(handles).size, 1);
});

test("invalid maker state halts before checker", async () => {
  const root = repo();
  const events: string[] = [];
  const api = boundary(root, [true], events);
  api.runMaker = async () => void writeFileSync(join(root, "dirty.txt"), "dirty\n");
  const result = await runTicket(2, tip, 1, api);
  assert.equal(result, null);
  assert.doesNotMatch(events.join("\n"), /CHECKER/);
  // A crash is the one halt nothing else records, so it carries its cause.
  assert.match(events.join("\n"), /HALTED:maker left a dirty worktree/);
});

test("exhaustion halts and a failed sibling does not stop the wave", async () => {
  const roots = [repo(), repo()];
  const events: string[] = [];
  let index = 0;
  const apis = [
    boundary(roots[0]!, [false], events),
    boundary(roots[1]!, [true], events),
  ];
  const shared: TicketBoundary = {
    ...apis[0]!,
    acquire: async (ticket, runTip) => apis[index++]!.acquire(ticket, runTip),
    runMaker: async (input) =>
      apis[input.issue - 1]!.runMaker(input),
    runChecker: async (input) =>
      apis[input.issue - 1]!.runChecker(input),
    halt: async (ticket, worktree, cause) =>
      apis[ticket - 1]!.halt(ticket, worktree, cause),
  };
  const handles = new Map<number, sandcastle.Sandbox>();
  const acquire = shared.acquire;
  shared.acquire = async (ticket, runTip) => {
    const workspace = await acquire(ticket, runTip);
    handles.set(ticket, workspace.sandbox);
    return workspace;
  };
  const result = await runTicketsInParallel(
    { issues: [1, 2] },
    tip,
    { parallelism: 2, maxCycles: 1, boundary: shared },
  );
  assert.deepEqual(result, [null, 2]);
  assert.notEqual(handles.get(1), handles.get(2));
});
