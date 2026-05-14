/**
 * Anthropic SDK factory + model constants for the Brief-to-IFC v2 pipeline.
 *
 * Mirrors `src/features/brief-renders/services/brief-pipeline/clients.ts`
 * exactly — same OAuth-vs-API-key handling — so credential handling stays
 * consistent across every Anthropic-calling pipeline in the repo.
 *
 * Two models, two roles:
 *   • TR-024 Brief Enricher  → Sonnet 4.6 (`claude-sonnet-4-6`)
 *   • TR-022 IFC Architect   → Opus 4.7  (`claude-opus-4-7`)
 *
 * Model IDs are the exact bare strings from the Anthropic model catalogue —
 * no date suffixes. Do NOT diverge without an architectural decision.
 */

import Anthropic from "@anthropic-ai/sdk";

/** TR-024 Brief Enricher model — Sonnet 4.6. */
export const BRIEF_ENRICHER_MODEL = "claude-sonnet-4-6";

/** TR-022 IFC Architect model — Opus 4.7. */
export const IFC_ARCHITECT_MODEL = "claude-opus-4-7";

/**
 * Published per-million-token rates. Co-located with the model constants
 * so a future model bump doesn't leave stale rates behind. Sonnet 4.6 =
 * $3 / $15; Opus 4.7 = $5 / $25.
 */
export const BRIEF_ENRICHER_INPUT_COST_PER_MILLION = 3;
export const BRIEF_ENRICHER_OUTPUT_COST_PER_MILLION = 15;
export const IFC_ARCHITECT_INPUT_COST_PER_MILLION = 5;
export const IFC_ARCHITECT_OUTPUT_COST_PER_MILLION = 25;

/**
 * Conservative chars→tokens estimate. English prose averages ~4 chars/token;
 * structured specs + code run denser, so `/ 3.5` errs on the safe side
 * (over-estimates token count → caps trigger earlier rather than later).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Compute USD cost from token usage at the given per-million rates.
 * Cache-read tokens are billed at ~0.1× input; cache-creation at ~1.25×.
 */
export function computeAnthropicCostUsd(args: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}): number {
  const {
    inputTokens,
    outputTokens,
    cacheReadTokens = 0,
    cacheCreationTokens = 0,
    inputCostPerMillion,
    outputCostPerMillion,
  } = args;
  const cost =
    (inputTokens * inputCostPerMillion +
      outputTokens * outputCostPerMillion +
      cacheReadTokens * inputCostPerMillion * 0.1 +
      cacheCreationTokens * inputCostPerMillion * 1.25) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Create an Anthropic client. Supports both standard and OAuth API keys. */
export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}
