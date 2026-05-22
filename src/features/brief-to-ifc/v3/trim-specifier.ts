/**
 * Trim Specifier (TR-030, Phase Beta 2).
 *
 * Calls Opus 4.7 ONCE with the full BriefSpec to generate architectural
 * trim and hardware items (skirting, door hinges/handles/strike plates,
 * window handles). Validates the response against `trimItemSchema` from
 * ./types. On validation failure, retries once with a stricter suffix.
 *
 * The result is attached to `spec.trim` and returned alongside cost /
 * timing metrics. Cost cap: $0.10. Timeout: 45 s.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { trimItemSchema } from "./types";
import type { BriefSpec, TrimItem } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────

const TRIM_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;

// Per-call Anthropic timeout. Raised from 45_000 to 150_000 (Path A fix,
// 2026-05-21): the prior 45s ceiling deterministically aborted on briefs
// that produce a large trim array (~110-130 items / ~5_000 output tokens
// on a 2-storey villa). 150s matches the node's real workload while
// sitting well under the route's 800s `maxDuration` cap and the client's
// 780s AbortController budget. The Brief Enricher precedent (180s in
// brief-enrichment.ts) covers an even larger output; 150s here keeps us
// under that ceiling by design. NEVER raise above 180_000 without a
// matching review of the client-side abort cap.
const PER_CALL_TIMEOUT_MS = 150_000;
const MAX_COST_USD = 0.10;
const MAX_TOKENS_PER_CALL = 8_000;

// ─── Prompt ─────────────────────────────────────────────────────────────

// Inline const — canonical .md copy at `./trim-specifier-prompt.md`.
// MUST stay byte-equal to that file; a vitest regression test enforces
// parity at CI.
//
// Why inline: Next.js Turbopack does NOT auto-bundle .md files referenced
// via __dirname, so fs.readFileSync fails during `next build`. Same
// pattern as item-decomposer.ts DECOMPOSER_PROMPT_TEMPLATE.
export const TRIM_PROMPT_TEMPLATE: string = `You add architectural trim and hardware to a building spec. You receive the spec; output ONLY a JSON array of trim items. First character "[".

RULES — MANDATORY for every brief:

FOR EACH SPACE with perimeter walls:
  Add ONE skirting per wall:
    - type: "skirting"
    - hostId: wall_id
    - dims_m: [wall_length, 0.018, 0.075]
    - origin_local_m: [0, 0, 0]
    - material_id: "wall_paint_offwhite" (modern) or "wood_pale" (heritage)
    - ifc_class: "IfcCovering"

FOR EACH DOOR in openings[] where type=door:
  Add 2 hinges:
    - type: "door_hinge", hostId: door_id
    - dims_m: [0.08, 0.012, 0.10]
    - Two entries: z=0.2 (bottom) and z=door_height-0.2 (top)
    - material_id: "brass"
    - ifc_class: "IfcDiscreteAccessory"
  Add 1 handle:
    - type: "door_handle", hostId: door_id
    - origin at 1.0m height
    - dims_m: [0.04, 0.04, 0.14]
    - material_id: "brass"
    - ifc_class: "IfcDiscreteAccessory"
  Add 1 strike plate:
    - type: "door_strike_plate", hostId: door_id
    - dims_m: [0.025, 0.003, 0.075]
    - material_id: "brass"
    - ifc_class: "IfcDiscreteAccessory"

FOR EACH WINDOW in openings[] where type=window:
  Add 1 handle:
    - type: "window_handle", hostId: window_id
    - mid-height of window
    - dims_m: [0.03, 0.05, 0.10]
    - material_id: "aluminium"
    - ifc_class: "IfcDiscreteAccessory"

DO NOT INVENT decorative items beyond standard hardware. Skirting + door hardware + window handle = baseline.

Now produce the trim array for the input spec below.`;

// ─── Types ──────────────────────────────────────────────────────────────

export interface TrimSpecifierMetrics {
  opus_calls: number;
  cost_usd: number;
  wall_time_ms: number;
  trim_count: number;
}

export interface TrimSpecifierResult {
  spec: BriefSpec;
  metrics: TrimSpecifierMetrics;
}

export interface TrimSpecifierOptions {
  /** Override the Anthropic client factory (for tests). */
  clientFactory?: () => Anthropic;
  /** Override max cost in USD. Default 0.10. */
  maxCostUsd?: number;
  /** Override timeout in ms. Default 45_000. */
  timeout?: number;
}

// ─── Zod schema for validating Opus's response ─────────────────────────

const trimArraySchema = z.array(trimItemSchema).min(1);

// ─── Anthropic client ───────────────────────────────────────────────────

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}

function computeCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * OPUS_INPUT_COST_PER_MILLION +
      outputTokens * OPUS_OUTPUT_COST_PER_MILLION) /
    1_000_000
  );
}

// ─── Single trim call ──────────────────────────────────────────────────

async function callTrimModel(
  client: Anthropic,
  specJson: string,
  isRetry: boolean,
  timeoutMs: number,
): Promise<{
  items: TrimItem[] | null;
  inputTokens: number;
  outputTokens: number;
  /** True when the Anthropic stream itself threw (abort/timeout/network).
   *  Signals to the caller to SKIP the parse-failure retry path — retrying
   *  a transport-layer abort would just burn another 150s and risk the
   *  client-side AbortController cap. The caller takes the graceful
   *  "spec unchanged" exit instead. */
  threw?: boolean;
}> {
  const userContent = isRetry
    ? TRIM_PROMPT_TEMPLATE +
      "\n\n" +
      specJson +
      "\n\nRETURN ONLY A JSON ARRAY. First character must be '['. No prose. No markdown."
    : TRIM_PROMPT_TEMPLATE + "\n\n" + specJson;

  let message: Anthropic.Messages.Message;
  try {
    const stream = client.messages.stream(
      {
        model: TRIM_MODEL,
        max_tokens: MAX_TOKENS_PER_CALL,
        messages: [{ role: "user", content: userContent }],
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    message = await stream.finalMessage();
  } catch (err) {
    // Anthropic stream threw — APIUserAbortError on AbortSignal.timeout
    // ("Request was aborted."), or a network/SDK error. Path A fix
    // (2026-05-21): convert into a signalled-null return so the caller's
    // existing graceful "spec unchanged" exit runs and the executor sees
    // this advisory node as a success. NEVER re-throw — TR-030 must be
    // incapable of killing the pipeline.
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[trim-specifier] Anthropic stream threw on ` +
      `${isRetry ? "retry" : "first"} attempt (${msg.slice(0, 160)}). ` +
      `Returning null + threw=true so the caller skips retry and the ` +
      `BriefSpec flows downstream unchanged.`,
    );
    return { items: null, inputTokens: 0, outputTokens: 0, threw: true };
  }

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  // Extract text content
  const textBlocks = message.content.filter(
    (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
  );
  const raw = textBlocks.map((b) => b.text).join("").trim();

  // Parse the JSON array from the response
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try to extract JSON array from surrounding text
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return { items: null, inputTokens, outputTokens };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { items: null, inputTokens, outputTokens };
    }
  }

  // Validate against schema
  const result = trimArraySchema.safeParse(parsed);
  if (!result.success) return { items: null, inputTokens, outputTokens };

  return { items: result.data, inputTokens, outputTokens };
}

// ─── Main entry point ───────────────────────────────────────────────────

export async function applyTrimSpecification(
  spec: BriefSpec,
  options?: TrimSpecifierOptions,
): Promise<TrimSpecifierResult> {
  const startedAt = Date.now();
  const maxCost = options?.maxCostUsd ?? MAX_COST_USD;
  const timeoutMs = options?.timeout ?? PER_CALL_TIMEOUT_MS;

  const metrics: TrimSpecifierMetrics = {
    opus_calls: 0,
    cost_usd: 0,
    wall_time_ms: 0,
    trim_count: 0,
  };

  // Nothing to trim if there are no elements or openings
  const hasWalls = spec.elements.some((e) => e.type === "wall");
  const hasOpenings = spec.openings && spec.openings.length > 0;
  if (!hasWalls && !hasOpenings) {
    metrics.wall_time_ms = Date.now() - startedAt;
    return { spec, metrics };
  }

  let client: Anthropic;
  try {
    client = options?.clientFactory
      ? options.clientFactory()
      : createAnthropicClient();
  } catch {
    metrics.wall_time_ms = Date.now() - startedAt;
    return { spec, metrics };
  }

  // Serialize spec for the prompt
  const specJson = JSON.stringify(spec);

  let runningCost = 0;

  // First attempt
  metrics.opus_calls++;
  const result = await callTrimModel(client, specJson, false, timeoutMs);
  runningCost += computeCost(result.inputTokens, result.outputTokens);

  if (result.items) {
    metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
    metrics.wall_time_ms = Date.now() - startedAt;
    metrics.trim_count = result.items.length;
    const updatedSpec: BriefSpec = { ...spec, trim: result.items };
    return { spec: updatedSpec, metrics };
  }

  // Path A fix (2026-05-21): if the first attempt threw (abort/network),
  // do NOT retry. The retry block exists for parse/schema failures only;
  // a second 150s stream attempt after a transport-layer failure would
  // waste budget and risk the client AbortController cap. Take the same
  // graceful "spec unchanged" exit the both-attempts-failed path uses.
  if (result.threw) {
    metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
    metrics.wall_time_ms = Date.now() - startedAt;
    return { spec, metrics };
  }

  // Cost guardrail check before retry
  if (runningCost > maxCost) {
    // eslint-disable-next-line no-console
    console.warn(
      `[trim-specifier] Cost guardrail hit: $${runningCost.toFixed(4)} > $${maxCost}. Skipping retry.`,
    );
    metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
    metrics.wall_time_ms = Date.now() - startedAt;
    return { spec, metrics };
  }

  // Retry once with stricter instruction
  metrics.opus_calls++;
  const retry = await callTrimModel(client, specJson, true, timeoutMs);
  runningCost += computeCost(retry.inputTokens, retry.outputTokens);

  if (retry.items) {
    metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
    metrics.wall_time_ms = Date.now() - startedAt;
    metrics.trim_count = retry.items.length;
    const updatedSpec: BriefSpec = { ...spec, trim: retry.items };
    return { spec: updatedSpec, metrics };
  }

  // Both attempts failed — return spec unchanged
  // eslint-disable-next-line no-console
  console.warn(
    "[trim-specifier] Failed to generate valid trim items after retry. Returning spec unchanged.",
  );
  metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
  metrics.wall_time_ms = Date.now() - startedAt;
  return { spec, metrics };
}
