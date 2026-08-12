import assert from "node:assert/strict";
import { test } from "vitest";

import type { TrackerIssue } from "../helpers/issueTracker.mts";
import {
  getRunTip,
  parseRunTipBranch,
  runImplementation,
  tipEvidence,
  type ImplementationSteps,
  type RunPrelude,
  type RunTip,
} from "./index.mts";

const tip: RunTip = {
  branch: "merge/2026-07-24-a" as RunTip["branch"],
  base: "main",
};

test("run tip branches accept time-based and legacy ordinal names", () => {
  assert.equal(parseRunTipBranch("merge/2026-07-28-1432"), "merge/2026-07-28-1432");
  assert.equal(parseRunTipBranch("merge/2026-07-24-a"), "merge/2026-07-24-a");
  assert.throws(() => parseRunTipBranch("merge/2026-07-28"));
  assert.throws(() => parseRunTipBranch("feature/2026-07-28-1432"));
});

function steps(plans: number[][], events: string[]): ImplementationSteps {
  let next = 0;
  return {
    planWave: async () => {
      const issues = plans[next++] ?? [];
      events.push(`plan:${issues.join(",")}`);
      return { issues };
    },
    runWave: async (plan) => void events.push(`run:${plan.issues.join(",")}`),
    finalize: async () => void events.push("finalize"),
  };
}

test("replans after each wave and preserves planner order", async () => {
  const events: string[] = [];
  await runImplementation({
    tip,
    steps: steps([[3, 1], [2], []], events),
    maxWaves: 5,
    tipIsEmpty: async () => false,
  });
  assert.deepEqual(events, [
    "plan:3,1",
    "run:3,1",
    "plan:2",
    "run:2",
    "plan:",
    "finalize",
  ]);
});

test("wave cap proceeds to finalization when integrated work exists", async () => {
  const events: string[] = [];
  await runImplementation({
    tip,
    steps: steps([[1], [2]], events),
    maxWaves: 1,
    tipIsEmpty: async () => false,
  });
  assert.deepEqual(events, ["plan:1", "run:1", "finalize"]);
});

test("empty tip skips finalization entirely", async () => {
  const events: string[] = [];
  await runImplementation({
    tip,
    steps: steps([[]], events),
    maxWaves: 2,
    tipIsEmpty: async () => true,
  });
  assert.deepEqual(events, ["plan:"]);
});

test("planned work that lands nothing is a loud failure, not a quiet completion", async () => {
  const events: string[] = [];
  await assert.rejects(
    runImplementation({
      tip,
      steps: steps([[1, 2], []], events),
      maxWaves: 3,
      tipIsEmpty: async () => true,
    }),
    /2 planned ticket\(s\) produced nothing[\s\S]*ready-for-human[\s\S]*in-review/,
  );
  assert.doesNotMatch(events.join("\n"), /finalize/);
});

// Which failures inside finalization are fatal is finalize's own contract; the
// lifecycle only owes the run a loud exit when it says so.
test("a fatal finalization fails the run", async () => {
  const events: string[] = [];
  const lifecycle = steps([[]], events);
  lifecycle.finalize = async () => {
    throw new Error("merge ticket unavailable");
  };
  await assert.rejects(
    runImplementation({
      tip,
      steps: lifecycle,
      maxWaves: 1,
      tipIsEmpty: async () => false,
    }),
    /merge ticket unavailable/,
  );
});

function prelude(
  tickets: string[],
  changeBranches: string[],
): RunPrelude & { created: string[] } {
  const created: string[] = [];
  return {
    created,
    findMergeTicketTips: async () => tickets,
    findIntegrationChangeBranches: async () => changeBranches,
    nextTipName: async () => "merge/2026-07-24-b",
    createTip: async (branch) => void created.push(branch),
  };
}

test("run tip reuses either durable source and rejects disagreement", async () => {
  assert.equal(
    (await getRunTip(prelude(["merge/2026-07-23-a"], []))).branch,
    "merge/2026-07-23-a",
  );
  assert.equal(
    (await getRunTip(prelude([], ["merge/2026-07-23-b"]))).branch,
    "merge/2026-07-23-b",
  );
  await assert.rejects(
    getRunTip(
      prelude(["merge/2026-07-23-a"], ["merge/2026-07-23-b"]),
    ),
    /does not match/,
  );
});

function issue(overrides: Partial<TrackerIssue> = {}): TrackerIssue {
  return {
    number: 7,
    title: "Merge merge/2026-07-24-a into main",
    description: "Run tip: merge/2026-07-24-a\nTarget: main",
    labels: [],
    ...overrides,
  };
}

test("tip evidence reads merge tickets, change branches, and in-review work", () => {
  const evidence = tipEvidence(
    [
      issue(),
      issue({ number: 8, title: "Add widget", labels: ["in-review"] }),
      issue({ number: 9, title: "Add gadget", labels: ["ready-for-agent"] }),
    ],
    ["merge/2026-07-24-a", "feat/issue-8"],
  );
  assert.deepEqual(evidence.tickets, ["merge/2026-07-24-a"]);
  // Only merge/* branches are integration change requests.
  assert.deepEqual(evidence.changeBranches, ["merge/2026-07-24-a"]);
  assert.deepEqual(evidence.inReview, [8]);
});

// Openness is the tracker's contract — `listIssues` only ever returns open
// issues — so it is not re-checked here.
test("a merge ticket must be unlabeled and titled to match its body", () => {
  assert.deepEqual(tipEvidence([issue({ labels: ["in-review"] })], []).tickets, []);
  assert.deepEqual(
    tipEvidence([issue({ title: "Merge something else" })], []).tickets,
    [],
  );
  assert.deepEqual(
    tipEvidence([issue({ description: "no run tip here" })], []).tickets,
    [],
  );
});
