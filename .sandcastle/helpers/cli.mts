// One exec convention for the tracker CLIs: `cwd`-scoped, UTF-8, throwing on a
// non-zero exit, with a JSON variant that validates before returning. `glab.mts`
// and `gh.mts` differ only in the binary they name and the flags they spell.
//
//   const cli = cliRunner("glab");

import { execFileSync } from "node:child_process";

import type { z } from "zod";

export type CliRunner = {
  run(cwd: string, ...args: string[]): string;
  /** Run a query that emits JSON and validate it against `schema`. */
  json<T>(cwd: string, schema: z.ZodType<T>, ...args: string[]): T;
};

export function cliRunner(bin: string): CliRunner {
  const run = (cwd: string, ...args: string[]): string =>
    execFileSync(bin, args, { cwd, encoding: "utf8" });
  return {
    run,
    json: (cwd, schema, ...args) => schema.parse(JSON.parse(run(cwd, ...args))),
  };
}
