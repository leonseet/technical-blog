import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");

/** The sandbox ends a run early only when the agent emits this. A prompt
 *  without it spends its whole iteration budget re-executing itself in a fresh
 *  sandbox: duplicate tracker comments, and one rewrite of the branch per
 *  iteration. */
const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

/** Prompts the pipeline runs with `maxIterations: 1`, where the answer is a
 *  parsed `<tag>` block rather than a finished side effect. Adding a prompt
 *  here is a claim that its caller pins it to a single iteration. */
const SINGLE_SHOT = new Set(["checker.md", "merge-ticket.md", "plan-wave.md"]);

test("every multi-iteration prompt can end its own run", () => {
  const missing = readdirSync(PROMPTS)
    .filter((name) => name.endsWith(".md") && !SINGLE_SHOT.has(name))
    .filter(
      (name) =>
        !readFileSync(join(PROMPTS, name), "utf8").includes(COMPLETION_SIGNAL),
    );
  assert.deepEqual(
    missing,
    [],
    `these prompts never signal completion, so they will burn every iteration: ${missing.join(", ")}`,
  );
});
