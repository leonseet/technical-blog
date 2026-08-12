// Shared runtime for the implement pipeline: CLI ticket ids, git helpers,
// agent runs (head or tip-sandbox), and a lazily created tip-branch sandbox.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import * as sandcastle from "@ai-hero/sandcastle";
import type { z } from "zod";

import { type CodingAgentConfig } from "./config/agents.mts";
import {
  CODING_AGENT_MAX_ITERATIONS,
  SANDBOX_IDLE_TIMEOUT_SECONDS,
  STRUCTURED_OUTPUT_MAX_RETRIES,
  COPY_TO_WORKTREE,
} from "./config/knobs.mts";
import { git, mainWorktreeRoot } from "../helpers/git.mts";
import {
  createIssueTracker,
  type IssueTracker,
} from "../helpers/issueTracker.mts";
import { formatDuration, logger } from "../helpers/log.mts";
import {
  codingAgent,
  codingSandbox,
  trackerSandbox,
} from "../helpers/sandboxes.mts";
import type { RunTip } from "./index.mts";

export type PromptArgs = Record<string, string | number | boolean>;

/** One agent invocation. `name` labels the run; `logName` overrides the log
 *  path when the run belongs under a per-ticket or per-stage folder. */
export type AgentRun = {
  readonly name: string;
  readonly logName?: string;
  /** Prompt basename under `implement/prompts/`, without the `.md`. */
  readonly prompt: string;
  readonly promptArgs: PromptArgs;
  readonly agent: CodingAgentConfig;
  readonly maxIterations?: number;
};

/** The sandcastle run options one `AgentRun` expands to. Named so the timing
 *  wrapper can hand them to whichever runner the caller picked. */
type AgentRunOptions = {
  readonly agent: ReturnType<typeof codingAgent>;
  readonly name: string;
  readonly maxIterations: number;
  readonly idleTimeoutSeconds: number;
  readonly logging: { readonly type: "file"; readonly path: string };
  readonly promptFile: string;
  readonly promptArgs: PromptArgs;
};

export class ImplementContext {
  readonly root = mainWorktreeRoot(process.cwd());
  readonly ids = process.argv.slice(2).filter((arg) => /^\d+$/.test(arg));
  readonly log = logger();

  /** Anchored to `root` so building a log path costs no subprocess and does not
   *  depend on the process cwd. */
  readonly #logsRoot = join(this.root, ".sandcastle", "logs");

  #tipSandbox: sandcastle.Sandbox | undefined;
  #issueTracker: IssueTracker | undefined;

  /** Resolved on first use, so a run that never touches the tracker (and a repo
   *  whose tracker cannot be detected) does not fail at construction. */
  get issueTracker(): IssueTracker {
    return (this.#issueTracker ??= createIssueTracker(this.root));
  }

  git(cwd: string, ...args: string[]): string {
    return git(cwd, ...args);
  }

  logFile(name: string) {
    return {
      type: "file" as const,
      path: join(this.#logsRoot, `${name}.log`),
    };
  }

  appendLog(name: string, line: string): void {
    const { path } = this.logFile(name);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`);
  }

  promptFile(name: string): string {
    return `./.sandcastle/implement/prompts/${name}.md`;
  }

  #runOptions(run: AgentRun): AgentRunOptions {
    return {
      agent: codingAgent(run.agent),
      name: run.name,
      maxIterations: run.maxIterations ?? CODING_AGENT_MAX_ITERATIONS,
      idleTimeoutSeconds: SANDBOX_IDLE_TIMEOUT_SECONDS,
      logging: this.logFile(run.logName ?? run.name),
      promptFile: this.promptFile(run.prompt),
      promptArgs: run.promptArgs,
    };
  }

  /** Runs `exec` against the options for `run`, then stamps the wall-clock time
   *  onto the end of that run's log. The footer is best-effort and covers halted
   *  runs too, so a failed agent's log still says how long it burned. */
  async #timed<T>(
    run: AgentRun,
    exec: (options: AgentRunOptions) => Promise<T>,
  ): Promise<T> {
    const options = this.#runOptions(run);
    const started = Date.now();
    try {
      return await exec(options);
    } finally {
      try {
        // A run that dies before sandcastle opens its log leaves no file, and
        // the elapsed time is exactly what you want in that case.
        mkdirSync(dirname(options.logging.path), { recursive: true });
        appendFileSync(
          options.logging.path,
          `\nElapsed: ${formatDuration(Date.now() - started)}\n`,
        );
      } catch {
        /* the footer must never break a run */
      }
    }
  }

  /** Head runs only read git and write to the tracker, so no installs. */
  async headAgent(run: AgentRun) {
    return this.#timed(run, (options) =>
      sandcastle.run({
        cwd: this.root,
        branchStrategy: { type: "head" },
        ...trackerSandbox,
        ...options,
      }),
    );
  }

  /** A head-agent run whose answer is a validated `<tag>` JSON block. Structured
   *  output is single-shot by construction, so callers do not set iterations. */
  async headAgentOutput<T>(
    run: Omit<AgentRun, "maxIterations">,
    tag: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const result = await this.#timed({ ...run, maxIterations: 1 }, (options) =>
      sandcastle.run({
        cwd: this.root,
        branchStrategy: { type: "head" },
        ...trackerSandbox,
        ...options,
        output: sandcastle.Output.object({
          tag,
          schema,
          maxRetries: STRUCTURED_OUTPUT_MAX_RETRIES,
        }),
      }),
    );
    return (result as typeof result & { output: T }).output;
  }

  /** The same policy as `headAgent`, but inside an existing sandbox. */
  async sandboxAgent(sandbox: sandcastle.Sandbox, run: AgentRun) {
    return this.#timed(run, (options) => sandbox.run(options));
  }

  async tipSandbox(tip: RunTip): Promise<sandcastle.Sandbox> {
    if (this.#tipSandbox) return this.#tipSandbox;
    this.#tipSandbox = await sandcastle.createSandbox({
      cwd: this.root,
      branch: tip.branch,
      ...codingSandbox,
      copyToWorktree: COPY_TO_WORKTREE,
    });
    return this.#tipSandbox;
  }

  async close(): Promise<void> {
    await this.#tipSandbox?.close();
  }
}
