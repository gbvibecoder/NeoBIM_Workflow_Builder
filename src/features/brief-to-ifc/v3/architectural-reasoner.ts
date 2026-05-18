/**
 * Architectural Reasoner (TR-029, Phase Beta 2).
 *
 * For every furniture/equipment item in `briefSpec.furniture[]`, decides
 * its sensible room-relative position and orientation based on domain
 * logic for the archetype. Calls Opus ONCE with a focused prompt that
 * produces a `designRationale[]` array, which is attached to the spec
 * for downstream deterministic placement.
 *
 * Pattern mirrors `item-decomposer.ts` — same Anthropic client factory,
 * inline prompt const (NOT fs.readFileSync), and Zod validation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { designRationaleSchema } from "./types";
import type { BriefSpec, DesignRationale } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────

const REASONER_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_COST_USD = 0.15;
const MAX_TOKENS_PER_CALL = 8_000;

// ─── Prompt ─────────────────────────────────────────────────────────────

// Inline const — canonical .md copy at `./architectural-reasoner-prompt.md`.
// MUST stay byte-equal to that file; a vitest regression test enforces
// parity at CI (same pattern as decomposer-prompt-drift.test.ts).
//
// Why inline: Next.js Turbopack does NOT auto-bundle .md files referenced
// via __dirname, so fs.readFileSync fails during `next build`. Same
// pattern as item-decomposer.ts DECOMPOSER_PROMPT_TEMPLATE.
export const REASONER_PROMPT_TEMPLATE: string = `You are a senior architectural designer with 20+ years of experience. You receive a BRIEFSPEC describing a building. For EVERY named furniture/equipment item, decide its sensible position and orientation based on DOMAIN LOGIC for the archetype.

RETURN ONLY a JSON array of designRationale objects. No prose, no markdown, no fences. First character must be "[".

Schema per entry:
- itemId: string (matches a furniture item id in the brief)
- position: [x, y, z] in metres (room-relative, origin SW interior corner)
- rotation_z_rad: float (rotation about vertical axis)
- rationale: string max 500 chars — one sentence why this position

COORDINATE FRAME (room-relative):
- origin (0, 0, 0) = SW interior corner of the host space
- +X = east (room width direction)
- +Y = north (room depth direction)
- +Z = up (floor at 0, ceiling at room height)
- Items must stay within interior bounds minus 0.3m clearance from walls

ARCHETYPE-SPECIFIC PRINCIPLES:

photography_studio:
  Backdrop faces away from windows (subject lit from camera-side). Tripod 2-3m from backdrop. Stool well away from shooting axis.

office:
  Workstation faces window if available, else faces door. Chair behind workstation. Bookshelf on blank wall.

residential_bedroom:
  Bed headboard against non-window wall. Wardrobe on long blank wall. Bedside tables flanking bed.

restaurant:
  Kitchen at back. Dining tables in front 60%. Bar near entry.

retail:
  Display racks along perimeter. Cashier near entry. Fitting room at back.

gym:
  Heavy equipment along walls. Open floor in center. Mirrors on long wall.

classroom:
  Teacher desk at front. Student desks in rows. Whiteboard on front wall.

GENERAL RULES:
- Heaviest items along walls
- 300mm clearance around door swing
- 200mm clearance from windows
- Every position: 0.3 <= x <= room_width - 0.3, 0.3 <= y <= room_depth - 0.3, z = 0

FAITHFULNESS: only emit entries for items in the input brief. NEVER invent items.

Now produce the designRationale array for the input below.`;

// ─── Types ──────────────────────────────────────────────────────────────

export interface ReasonerMetrics {
  opus_calls: number;
  cost_usd: number;
  wall_time_ms: number;
  rationale_count: number;
}

export interface ReasonerResult {
  spec: BriefSpec;
  metrics: ReasonerMetrics;
}

export interface ReasonerOptions {
  /** Override the Anthropic client factory (for tests). */
  clientFactory?: () => Anthropic;
  /** Override max cost in USD. Default 0.15. */
  maxCostUsd?: number;
  /** Override timeout in ms. Default 60_000. */
  timeout?: number;
}

// ─── Zod schema for validating Opus's response ─────────────────────────

const rationaleArraySchema = z.array(designRationaleSchema).min(1);

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

// ─── User message builder ───────────────────────────────────────────────

function buildUserMessage(spec: BriefSpec): string {
  const archetype = spec.archetype ?? "other";
  const spaces = (spec.spaces ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    polygon_world_m: s.polygon_world_m,
    height_m: s.height_m,
  }));
  const furniture = (spec.furniture ?? []).map((f) => ({
    id: f.id,
    type: f.type,
    count: f.count,
    anchor_space_id: f.anchor_space_id,
    bounding_box: f.bounding_box,
    description: f.description,
  }));

  return JSON.stringify({ archetype, spaces, furniture }, null, 2);
}

// ─── Single reasoning call ──────────────────────────────────────────────

async function callReasoner(
  client: Anthropic,
  userMessage: string,
  isRetry: boolean,
  timeoutMs: number,
): Promise<{
  rationale: DesignRationale[] | null;
  inputTokens: number;
  outputTokens: number;
}> {
  const systemContent = isRetry
    ? REASONER_PROMPT_TEMPLATE +
      "\n\nPREVIOUS ATTEMPT FAILED VALIDATION. RETURN ONLY A JSON ARRAY. First character must be '['. No prose. No markdown fences."
    : REASONER_PROMPT_TEMPLATE;

  const stream = client.messages.stream(
    {
      model: REASONER_MODEL,
      max_tokens: MAX_TOKENS_PER_CALL,
      system: systemContent,
      messages: [{ role: "user", content: userMessage }],
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
    if (!match) return { rationale: null, inputTokens, outputTokens };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { rationale: null, inputTokens, outputTokens };
    }
  }

  // Validate against schema
  const result = rationaleArraySchema.safeParse(parsed);
  if (!result.success) return { rationale: null, inputTokens, outputTokens };

  return { rationale: result.data, inputTokens, outputTokens };
}

// ─── Main entry point ───────────────────────────────────────────────────

export async function applyArchitecturalReasoning(
  spec: BriefSpec,
  options?: ReasonerOptions,
): Promise<ReasonerResult> {
  const startedAt = Date.now();
  const maxCost = options?.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS;

  const metrics: ReasonerMetrics = {
    opus_calls: 0,
    cost_usd: 0,
    wall_time_ms: 0,
    rationale_count: 0,
  };

  const furniture = spec.furniture;
  if (!furniture || furniture.length === 0) {
    metrics.wall_time_ms = Date.now() - startedAt;
    return { spec, metrics };
  }

  // Skip if designRationale already populated
  if (spec.designRationale && spec.designRationale.length > 0) {
    metrics.rationale_count = spec.designRationale.length;
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

  const userMessage = buildUserMessage(spec);
  let runningCost = 0;

  // First attempt
  try {
    metrics.opus_calls++;
    const result = await callReasoner(client, userMessage, false, timeoutMs);
    runningCost += computeCost(result.inputTokens, result.outputTokens);

    if (result.rationale) {
      const updatedSpec: BriefSpec = {
        ...spec,
        designRationale: result.rationale,
      };
      metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
      metrics.rationale_count = result.rationale.length;
      metrics.wall_time_ms = Date.now() - startedAt;
      return { spec: updatedSpec, metrics };
    }

    // Cost guardrail check before retry
    if (runningCost > maxCost) {
      // eslint-disable-next-line no-console
      console.warn(
        `[architectural-reasoner] Cost guardrail hit: $${runningCost.toFixed(4)} > $${maxCost}. Skipping retry.`,
      );
      metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
      metrics.wall_time_ms = Date.now() - startedAt;
      return { spec, metrics };
    }

    // Retry once with stricter instructions
    metrics.opus_calls++;
    const retry = await callReasoner(client, userMessage, true, timeoutMs);
    runningCost += computeCost(retry.inputTokens, retry.outputTokens);

    if (retry.rationale) {
      const updatedSpec: BriefSpec = {
        ...spec,
        designRationale: retry.rationale,
      };
      metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
      metrics.rationale_count = retry.rationale.length;
      metrics.wall_time_ms = Date.now() - startedAt;
      return { spec: updatedSpec, metrics };
    }

    // Both attempts failed validation
    // eslint-disable-next-line no-console
    console.warn(
      "[architectural-reasoner] Failed to produce valid designRationale after retry. Returning spec unchanged.",
    );
    metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
    metrics.wall_time_ms = Date.now() - startedAt;
    return { spec, metrics };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[architectural-reasoner] Error during reasoning:",
      err instanceof Error ? err.message : err,
    );
    metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
    metrics.wall_time_ms = Date.now() - startedAt;
    return { spec, metrics };
  }
}
