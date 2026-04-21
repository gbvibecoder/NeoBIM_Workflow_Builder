/**
 * Shared API client factories for VIP pipeline stages.
 *
 * Extracted from stage-1-prompt.ts, stage-3-jury.ts, stage-6-quality.ts
 * which all had identical createAnthropicClient() implementations.
 */

import Anthropic from "@anthropic-ai/sdk";

/** Create an Anthropic client. Supports both standard and OAuth API keys. */
export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}
