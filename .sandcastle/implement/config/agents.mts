import * as sandcastle from "@ai-hero/sandcastle";

export type CodingAgentConfig =
  | {
      agent: "claude";
      modelId: string;
      reasoningEffort: NonNullable<sandcastle.ClaudeCodeOptions["effort"]>;
    }
  | {
      agent: "codex";
      modelId: string;
      reasoningEffort: NonNullable<sandcastle.CodexOptions["effort"]>;
    };

const claudeAgentConfig = (
  modelId: string,
  reasoningEffort: NonNullable<sandcastle.ClaudeCodeOptions["effort"]>,
): CodingAgentConfig => ({ agent: "claude", modelId, reasoningEffort });

const codexAgentConfig = (
  modelId: string,
  reasoningEffort: NonNullable<sandcastle.CodexOptions["effort"]>,
): CodingAgentConfig => ({ agent: "codex", modelId, reasoningEffort });

const GPT_LOW = codexAgentConfig("gpt-5.6", "low");
const GPT_MED = codexAgentConfig("gpt-5.6", "medium");
const CLAUDE_MED = claudeAgentConfig("claude-opus-5", "medium");
const CLAUDE_HIGH = claudeAgentConfig("claude-opus-5", "high");

// --- planWave ---------------------------------------------------------------

export const PLAN_WAVE_AGENT = CLAUDE_MED;

// --- runTicket --------------------------------------------------------------

export const RUN_TICKET_MAKER_AGENT = GPT_MED;
export const RUN_TICKET_CHECKER_AGENT = CLAUDE_HIGH;

// --- foldWave ---------------------------------------------------------------

export const FOLD_WAVE_RESOLVE_CONFLICT_AGENT = GPT_MED;

// --- finalize ---------------------------------------------------------------

export const MERGE_TICKET_AGENT = GPT_LOW;
export const SIMPLIFY_AGENT = CLAUDE_MED;
export const EXPLAINER_AGENT = GPT_MED;
export const QA_AGENT = CLAUDE_MED;
export const PUBLISH_AGENT = GPT_LOW;
