// Parsing of structured agent output shared by the loop runners. Agents emit a
// tagged, fenced JSON block (e.g. <review>…</review>); these helpers extract and
// validate it.
//
//   import { stripFences, parseTagged } from "../helpers/agentOutput.mts";

import { z } from "zod";

/** Strip ```json fences LLMs tend to wrap a block in, then trim. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?/, "")
    .replace(/```$/, "")
    .trim();
}

/** Extract the first <tag>…</tag> block, strip fences, JSON.parse, and validate
 *  against `schema`. Returns null on a missing block or any parse/validation
 *  failure (callers treat null as "agent flaked"). */
export function parseTagged<T>(
  stdout: string,
  tag: string,
  schema: z.ZodType<T>,
): T | null {
  const match = stdout.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!match) return null;
  try {
    return schema.parse(JSON.parse(stripFences(match[1]!)));
  } catch {
    return null;
  }
}
