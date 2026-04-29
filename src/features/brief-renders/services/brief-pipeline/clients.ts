/**
 * Anthropic SDK factory for the Brief-to-Renders pipeline.
 *
 * Mirrors `src/features/floor-plan/lib/vip-pipeline/clients.ts` exactly —
 * same OAuth-vs-API-key handling, same lazy initialization. Single source
 * across pipelines so credential handling stays consistent.
 *
 * The model identifier `BRIEF_RENDERS_ANTHROPIC_MODEL` matches VIP's
 * Stage 1 model (`claude-sonnet-4-6`) intentionally — both pipelines
 * call the same Sonnet 4.6 endpoint for tool_use structured extraction.
 * Bumping one bumps the other; we want them to stay in lockstep so
 * cost & quality observations transfer between pipelines.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Canonical model identifier for Brief-to-Renders pipeline calls.
 *
 * Matches VIP's `MODEL` constant in
 * `src/features/floor-plan/lib/vip-pipeline/stage-1-prompt.ts`. Do NOT
 * diverge without an architectural decision — see CLAUDE.md "single
 * source of truth" guidance for image models, same principle here for
 * structured-extraction models.
 */
export const BRIEF_RENDERS_ANTHROPIC_MODEL = "claude-sonnet-4-6";

/**
 * Cost rates for the configured Anthropic model. Sonnet 4.6 publishes
 * $3 / $15 per million input / output tokens. Co-located with the model
 * constant so a future model bump doesn't leave stale rates behind.
 */
export const BRIEF_RENDERS_INPUT_COST_PER_MILLION = 3;
export const BRIEF_RENDERS_OUTPUT_COST_PER_MILLION = 15;

/** Create an Anthropic client. Supports both standard and OAuth API keys. */
export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}
