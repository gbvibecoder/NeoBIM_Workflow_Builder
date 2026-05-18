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

const PER_CALL_TIMEOUT_MS = 45_000;
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
}> {
  const userContent = isRetry
    ? TRIM_PROMPT_TEMPLATE +
      "\n\n" +
      specJson +
      "\n\nRETURN ONLY A JSON ARRAY. First character must be '['. No prose. No markdown."
    : TRIM_PROMPT_TEMPLATE + "\n\n" + specJson;

  const stream = client.messages.stream(
    {
      model: TRIM_MODEL,
      max_tokens: MAX_TOKENS_PER_CALL,
      messages: [{ role: "user", content: userContent }],
    },
    { signal: AbortSignal.timeout(timeoutMs) },
  );
  const message = await stream.finalMessage();

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
