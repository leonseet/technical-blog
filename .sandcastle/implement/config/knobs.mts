// The knob surface: tune a repo by editing the values here in place — copier's
// 3-way merge keeps local edits across template updates. `.sandcastle/.env`
// stays reserved for secrets and per-machine facts.

// --- shared -----------------------------------------------------------------
export const BASE_BRANCH = "main";
export const CODING_AGENT_MAX_ITERATIONS = 5;
export const SANDBOX_IDLE_TIMEOUT_SECONDS = 600;
export const STRUCTURED_OUTPUT_MAX_RETRIES = 2;

/** Files copied from the main checkout into every ticket worktree — local,
 *  uncommitted configuration the repo's build needs (e.g. a backend `.env`).
 *  Every listed path must exist: a missing one fails the run at startup. */
export const COPY_TO_WORKTREE: string[] = [];

/** Commands run once inside a fresh coding sandbox before agents use it
 *  (dependency installs, codegen). Empty means no setup. */
export const SANDBOX_SETUP_COMMANDS: string[] = [];

/** Docker network mode for sandboxes. Host networking is Linux-only; Docker
 *  Desktop on macOS/Windows gets bridge. Override with a literal if the
 *  auto-detection picks wrong for your setup. */
export const SANDBOX_NETWORK: "host" | "bridge" =
  process.platform === "linux" ? "host" : "bridge";

/** The slice of `docs/agents/triage-labels.md` the loop itself writes. Prompts
 *  read that document; TypeScript spells the same strings here. */
export const READY_FOR_AGENT_LABEL = "ready-for-agent";
export const READY_FOR_HUMAN_LABEL = "ready-for-human";
export const IN_REVIEW_LABEL = "in-review";

// --- lifecycle --------------------------------------------------------------

export const LIFECYCLE_MAX_WAVES = 10;

// --- runTicket --------------------------------------------------------------

export const WAVE_MAX_PARALLEL_TICKETS = 4;
export const RUN_TICKET_MAKER_CHECKER_MAX_CYCLES = 5;

// --- foldWave ---------------------------------------------------------------

/** The strict checks a candidate branch must pass before it lands on the tip,
 *  as argv arrays. Empty means folds land unverified — the loop warns loudly
 *  at startup when so. */
export const FOLD_WAVE_VERIFY_CHECKS: string[][] = [];

/** The same checks as one shell line, rendered into prompts as
 *  `{{VERIFY_COMMAND}}` so agents run exactly what the fold will. */
export const VERIFY_COMMAND =
  FOLD_WAVE_VERIFY_CHECKS.map((check) => check.join(" ")).join(" && ") ||
  "(no verify checks configured)";

// --- publish ----------------------------------------------------------------

export const EXPLAINER_MAX_ITERATIONS = 3;
/** Where explainer HTML is written inside the worktree. The default sits in
 *  gitignored space so explainers never end up committed; point it at a
 *  tracked directory if your repo wants them in history. */
export const EXPLAINER_DIRECTORY = ".sandcastle/tmp/explainers";
