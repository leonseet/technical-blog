// Unit tests for the planner logger and run-log tee.

import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logger, logsRoot } from "./log.mts";
import { runStamp, startRunLog, stripAnsi } from "./runLog.mts";

test("logsRoot anchors to the PRIMARY worktree, even from a linked worktree", () => {
  // Real repo + linked worktree: from inside the worktree, logsRoot() must
  // resolve to the primary worktree's .sandcastle/logs, not the worktree's.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "logsroot-")));
  const primary = join(root, "primary");
  const wt = join(root, "wt");
  const g = (cwd: string, args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" });

  execFileSync("git", ["init", "-q", primary], { encoding: "utf8" });
  g(primary, ["config", "user.email", "t@t"]);
  g(primary, ["config", "user.name", "t"]);
  g(primary, ["commit", "-q", "--allow-empty", "-m", "init"]);
  g(primary, ["worktree", "add", "-q", "-b", "feature/x", wt]);

  const cwd0 = process.cwd();
  try {
    process.chdir(wt);
    assert.equal(logsRoot(), join(primary, ".sandcastle", "logs"));
  } finally {
    process.chdir(cwd0);
  }
});

test("runStamp formats a sortable local YYYYMMDD-HHMMSS", () => {
  const d = new Date(2026, 5, 29, 13, 52, 22); // month index 5 = June
  assert.equal(runStamp(d), "20260629-135222");
});

test("stripAnsi removes SGR color codes but keeps the text", () => {
  const colored = "\x1b[2m13:52:22\x1b[0m  [\x1b[36mn9r\x1b[0m] → go";
  assert.equal(stripAnsi(colored), "13:52:22  [n9r] → go");
});

test("startRunLog tees a plain transcript and copies it to each touched dir", () => {
  const root = mkdtempSync(join(tmpdir(), "runlog-"));
  const rl = startRunLog("implement", {
    now: new Date(2026, 5, 29, 13, 52, 22),
    logsRoot: root,
  });

  // The staged file under .run/ exists immediately (crash artifact).
  assert.ok(existsSync(rl.stagePath), rl.stagePath);
  assert.equal(rl.fileName, "implement-20260629-135222.log");

  const featDir = join(root, "p-n9r.4");
  rl.addTarget(featDir);

  // Write colored output through a patched stream. Use stderr so the test
  // runner's TAP on stdout stays clean; both streams are teed.
  process.stderr.write("\x1b[36mhello\x1b[0m world\n");

  rl.finalize([]);

  const staged = readFileSync(rl.stagePath, "utf8");
  assert.match(staged, /hello world/);
  assert.ok(!staged.includes("\x1b["), "staged transcript must be ANSI-free");

  const copied = readFileSync(join(featDir, rl.fileName), "utf8");
  assert.match(copied, /hello world/);
});

test("run-log captures real logger lines + console.log blanks, ANSI-free", () => {
  const root = mkdtempSync(join(tmpdir(), "runlog-"));
  const prevForce = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "1"; // make logger emit color so we exercise stripping
  try {
    const rl = startRunLog("implement", {
      now: new Date(2026, 5, 29, 14, 0, 0),
      logsRoot: root,
    });
    const featDir = join(root, "p-n9r.4");
    rl.addTarget(featDir);

    const top = logger();
    const unit = logger("p-n9r.4");
    top.header("wave 1 · 1 unit worktree(s) in parallel");
    console.log(); // the stray blank line between waves
    unit.header("unit → feature/p-n9r.4");
    unit.ok("p-n9r.4.1 approved → committed → closed · cycle 1");

    rl.finalize([]);

    const out = readFileSync(join(featDir, rl.fileName), "utf8");
    assert.ok(!out.includes("\x1b["), "transcript must be ANSI-free");
    assert.match(out, /wave 1 · 1 unit worktree/);
    // logger() tags shorten the id to its last hyphen segment (short()).
    assert.match(out, /\[n9r\.4\].*unit → feature\/p-n9r\.4/);
    assert.match(out, /approved → committed → closed/);
    // The clock + tag structure is preserved (HH:MM:SS  [tag] at line start).
    assert.match(out, /^\d{2}:\d{2}:\d{2}\s+\[/m);
  } finally {
    if (prevForce === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = prevForce;
  }
});
