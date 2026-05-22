/**
 * KOS-local Anthropic SDK singleton.
 *
 * BuildFlow instantiates Anthropic per-module elsewhere (see
 * `pdf-text-extractor.ts`, `support-chat-service.ts`, the
 * brief-to-ifc generators, etc.) — there's no central singleton.
 * KOS keeps its own client inside `features/kos/` to respect the
 * "no cross-feature imports out of KOS" rule.
 *
 * Lazy initialisation: the client is only built on first use so a
 * KOS module loaded in a test environment without ANTHROPIC_API_KEY
 * doesn't crash at import time.
 */

import Anthropic from "@anthropic-ai/sdk";

import { KosError } from "@/features/kos/lib/kos-errors";

let _client: Anthropic | null = null;

export function getKosAnthropicClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length < 10) {
    throw new KosError(
      "KOS_BOT_010",
      "ANTHROPIC_API_KEY is not set — cannot reach Claude. Configure it in .env.local (dev) or the Vercel project (prod) before running the bot.",
      500,
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}
