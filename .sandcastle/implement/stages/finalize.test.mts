import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  explainerPath,
  FINALIZE_LOG_NAMES,
  finalize,
  renderFailures,
  type FinalizeBoundary,
} from "./finalize.mts";
import type { RunTip } from "../index.mts";

const tip: RunTip = {
  branch: "merge/2026-07-24-a" as RunTip["branch"],
  base: "main",
};

const EXPLAINER =
  ".sandcastle/tmp/explainers/2026-07-24-a-implementation.html";
const EXPLAINER_URL =
  "https://s3.example.com/explainers/2026-07-24-a-implementation.html";

type Publication = Parameters<FinalizeBoundary["publish"]>[0];

function boundary(events: string[]): FinalizeBoundary & {
  published?: Publication;
} {
  const api: FinalizeBoundary & { published?: Publication } = {
    ensureMergeTicket: async () => {
      events.push("ticket");
      return 35;
    },
    simplify: async () => void events.push("simplify"),
    tipIsClean: async () => true,
    explain: async (path) => void events.push(`explain:${path}`),
    upload: async (path) => {
      events.push(`upload:${path}`);
      return EXPLAINER_URL;
    },
    qa: async () => void events.push("qa"),
    publish: async (input) => {
      events.push("publish");
      api.published = input;
    },
  };
  return api;
}

test("cleans, explains, uploads, then publishes against one merge ticket", async () => {
  const events: string[] = [];
  const api = boundary(events);
  await finalize(tip, api);
  assert.equal(explainerPath(tip), EXPLAINER);
  assert.deepEqual(events, [
    "ticket",
    "simplify",
    `explain:${EXPLAINER}`,
    `upload:${EXPLAINER}`,
    "qa",
    "publish",
  ]);
  assert.deepEqual(api.published, {
    tip,
    mergeTicket: 35,
    explainerUrl: EXPLAINER_URL,
    failures: [],
  });
});

test("a failed simplify is disclosed to the publisher and still publishes", async () => {
  const events: string[] = [];
  const api = boundary(events);
  api.simplify = async () => {
    throw new Error("make test failed");
  };
  await finalize(tip, api);
  assert.deepEqual(api.published?.failures, [
    { step: "simplify", reason: "make test failed" },
  ]);
  // Degraded, not skipped: the explainer still describes the tip as it stands.
  assert.equal(api.published?.explainerUrl, EXPLAINER_URL);
});

test("an unsafe tip stops the run before anything commits into it", async () => {
  for (const simplify of [
    async () => void 0,
    async () => {
      throw new Error("make test failed");
    },
  ]) {
    const events: string[] = [];
    const api = boundary(events);
    api.simplify = simplify;
    api.tipIsClean = async () => false;
    await assert.rejects(finalize(tip, api), /uncommitted changes/);
    assert.doesNotMatch(events.join("\n"), /explain|publish/);
  }
});

test("a failed explainer skips the upload and cannot suppress the change request", async () => {
  const events: string[] = [];
  const api = boundary(events);
  api.explain = async () => {
    throw new Error("explainer failed");
  };
  await finalize(tip, api);
  assert.deepEqual(api.published?.failures, [
    { step: "explainer", reason: "explainer failed" },
  ]);
  assert.equal(api.published?.explainerUrl, undefined);
  assert.doesNotMatch(events.join("\n"), /upload/);
});

test("a failed upload is disclosed and publishes without a link", async () => {
  const api = boundary([]);
  api.upload = async () => {
    throw new Error("bucket unreachable");
  };
  await finalize(tip, api);
  assert.deepEqual(api.published?.failures, [
    { step: "upload", reason: "bucket unreachable" },
  ]);
  assert.equal(api.published?.explainerUrl, undefined);
});

test("a failed qa is advisory: disclosed, and everything else still ships", async () => {
  const api = boundary([]);
  api.qa = async () => {
    throw new Error("qa menu failed");
  };
  await finalize(tip, api);
  assert.deepEqual(api.published?.failures, [
    { step: "qa", reason: "qa menu failed" },
  ]);
  assert.equal(api.published?.explainerUrl, EXPLAINER_URL);
});

test("degradations accumulate in execution order", async () => {
  const api = boundary([]);
  api.simplify = async () => {
    throw new Error("make test failed");
  };
  api.explain = async () => {
    throw "not an Error";
  };
  api.qa = async () => {
    throw new Error("qa menu failed");
  };
  await finalize(tip, api);
  assert.deepEqual(api.published?.failures, [
    { step: "simplify", reason: "make test failed" },
    { step: "explainer", reason: "not an Error" },
    { step: "qa", reason: "qa menu failed" },
  ]);
  assert.equal(
    renderFailures(api.published?.failures ?? []),
    "simplify: make test failed\nexplainer: not an Error\nqa: qa menu failed",
  );
  assert.equal(renderFailures([]), "none");
});

test("the merge ticket is reused across runs on the same tip", async () => {
  const tickets = new Map<string, number>();
  let creates = 0;
  const api = boundary([]);
  api.ensureMergeTicket = async (runTip) => {
    const existing = tickets.get(runTip.branch);
    if (existing) return existing;
    const created = ++creates;
    tickets.set(runTip.branch, created);
    return created;
  };
  await finalize(tip, api);
  await finalize(tip, api);
  assert.equal(creates, 1);
});

test("no merge ticket stops the run before any disclosure", async () => {
  const events: string[] = [];
  const api = boundary(events);
  api.ensureMergeTicket = async () => {
    throw new Error("merge ticket unavailable");
  };
  await assert.rejects(finalize(tip, api), /merge ticket unavailable/);
  assert.deepEqual(events, []);
});

test("a failed publication is loud rather than swallowed", async () => {
  const api = boundary([]);
  api.publish = async () => {
    throw new Error("tracker unreachable");
  };
  await assert.rejects(finalize(tip, api), /tracker unreachable/);
});

test("publisher contract assigns ancestry, verdict, reuse, sections, and closing syntax", () => {
  const prompt = readFileSync(
    new URL("../prompts/publish.md", import.meta.url),
    "utf8",
  );
  for (const contract of [
    /Git alone proves landed tickets/,
    /merge ticket.*full thread/i,
    /Create or update/,
    /existing change request/,
    /Integration\s+notes.*only/is,
    /NOT APPROVED/,
    /QA MENU/,
    /`qa` is advisory/,
    /Closes #n/,
    /Closes #\{\{MERGE_TICKET\}\}/,
    /Never close implementation\s+tickets directly/i,
    /\{\{FAILURES\}\}/,
    /clickable link/,
    /fetching its\s+content is optional/,
  ]) {
    assert.match(prompt, contract);
  }
});

test("qa contract verifies by running, inlines scripts, and stays on the ticket", () => {
  const prompt = readFileSync(
    new URL("../prompts/qa.md", import.meta.url),
    "utf8",
  );
  for (const contract of [
    /\{\{BASE_BRANCH\}\}\.\.\.\{\{RUN_TIP\}\}/,
    /3–8 checks/,
    /run each runnable check.*paste\s+what you actually observed/is,
    /unverified/,
    /#\{\{MERGE_TICKET\}\}/,
    /## QA MENU/,
    /Not covered/,
    /Inline any helper script/,
    /Do not commit/,
  ]) {
    assert.match(prompt, contract);
  }
});

test("finalize agent logs live under their own stage folder", () => {
  assert.deepEqual(FINALIZE_LOG_NAMES, {
    mergeTicket: "finalize/merge-ticket",
    simplify: "finalize/simplify",
    explainer: "finalize/explainer",
    upload: "finalize/upload",
    qa: "finalize/qa",
    publish: "finalize/publish",
  });
});
