/**
 * Item Decomposer (TR-028, Phase Alpha).
 *
 * For every furniture/equipment item in `briefSpec.furniture[]`, calls
 * Opus in PARALLEL with a focused decomposition prompt. Each call
 * returns a `parts[]` array (>= 6 parts for any non-trivial item).
 * The decomposer mutates the spec by embedding `parts[]` on each
 * furniture entry. The downstream IFC Agent Builder, when it sees
 * `parts[]`, builds a parent IfcFurnishingElement plus one element
 * per part plus IfcRelAggregates linking them.
 *
 * When `parts[]` is absent, the builder falls back to current
 * single-box behavior — backward compatible by design.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { furniturePartSchema } from "./types";
import type { BriefSpec, FurniturePart } from "./types";
import { MATERIAL_LIBRARY } from "./material-library";

// ─── Constants ──────────────────────────────────────────────────────────

const DECOMPOSER_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;

const MAX_CONCURRENT = 10;
const PER_CALL_TIMEOUT_MS = 30_000;
const MAX_COST_USD = 0.10;
const MAX_TOKENS_PER_CALL = 4_000;

/** Volume threshold in m^3 below which we skip decomposition. */
const TRIVIAL_VOLUME_M3 = 0.001;

// ─── Prompt ─────────────────────────────────────────────────────────────

// Inline const — canonical .md copy at `./item-decomposer-prompt.md`.
// MUST stay byte-equal to that file; a vitest regression
// (`__tests__/decomposer-prompt-drift.test.ts`) enforces parity at CI.
//
// Why inline: Next.js Turbopack does NOT auto-bundle .md files referenced
// via __dirname, so fs.readFileSync fails during `next build`. Same
// pattern as generator/driver.ts GENERATOR_SYSTEM_PROMPT.
export const DECOMPOSER_PROMPT_TEMPLATE: string = `You decompose a single named furniture/equipment item into its physical
parts for IFC building generation. Output ONLY a JSON array. No prose.
No markdown. No code fences.

INPUT
- archetype: {archetype}
- item_name: {item_name}
- item_type: {item_type}
- bounding_box_m: {bbox}  (footprint x, footprint y, height z)
- material_hint: {material_hint}
- brief_excerpt: {brief_excerpt}

COORDINATE FRAME
- Origin at item floor center.
- +X = item's depth-forward (away from user / into the scene)
- +Y = item's width-right
- +Z = up
- All part origins MUST fit inside the bounding box.

PART SCHEMA (each entry)
- id: snake_case, unique within this item
- subtype: descriptive (e.g., "tripod_leg_lower", "backdrop_pole")
- origin_local_m: [x, y, z] floats
- dims_m: [x, y, z] floats  (for "cylinder" shape: x=radius, y=radius,
  z=height — first two MUST match)
- shape: "box" or "cylinder"
- rotation_z_rad: float, default 0
- material_id: ONE OF the ALLOWED MATERIALS below
- ifc_class: "IfcFurnishingElement" | "IfcSystemFurnitureElement" |
  "IfcDiscreteAccessory"
- notes: optional

ALLOWED MATERIALS
chrome_steel, black_steel, carbon_fiber, aluminium, glass_clear,
wood_teak, wood_dark, wood_oak, wood_pine, leather_black, leather_brown,
rubber_black, paper_neutral, fabric_neutral, fabric_grey, camera_black,
concrete_polished, concrete_structural, plastic_white, plastic_black,
copper, brass, stone_marble, ceramic_white, wall_paint_offwhite

RULES
1. Decompose realistically. A tripod is NEVER a single box. A backdrop
   stand has at least 2 poles + crossbar + 2 feet + hanging sheet.
2. Use "cylinder" for legs, columns, poles, lenses, wheels.
3. Use "box" for seats, frames, plates, screens, paper sheets, fabric.
4. Splay tripod legs at 120 degree intervals around center.
5. 5-star stool bases get 5 arms at 72 degree intervals + 5 caster wheels.
6. Workstations include: tabletop + 4 legs + monitor + keyboard + mouse
   + chair (with chair as separate composite if requested).
7. Beds include: mattress + bedframe + 2 side tables (if archetype is
   master bedroom) + 1 headboard.
8. Wardrobes include: carcass + 2 or more doors + interior shelves.
9. Output the JSON array DIRECTLY. First character must be "[".

WORKED EXAMPLES

Example 1 — "tripod", bbox [0.9, 0.9, 1.55]:
[
  {"id":"leg_1_lower","subtype":"tripod_leg_lower","origin_local_m":[0.4,0,0],"dims_m":[0.012,0.012,0.7],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_1_upper","subtype":"tripod_leg_upper","origin_local_m":[0.2,0,0.7],"dims_m":[0.012,0.012,0.55],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_2_lower","subtype":"tripod_leg_lower","origin_local_m":[-0.2,0.346,0],"dims_m":[0.012,0.012,0.7],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_2_upper","subtype":"tripod_leg_upper","origin_local_m":[-0.1,0.173,0.7],"dims_m":[0.012,0.012,0.55],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_3_lower","subtype":"tripod_leg_lower","origin_local_m":[-0.2,-0.346,0],"dims_m":[0.012,0.012,0.7],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_3_upper","subtype":"tripod_leg_upper","origin_local_m":[-0.1,-0.173,0.7],"dims_m":[0.012,0.012,0.55],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"column","subtype":"tripod_center_column","origin_local_m":[0,0,1.25],"dims_m":[0.014,0.014,0.2],"shape":"cylinder","rotation_z_rad":0,"material_id":"aluminium","ifc_class":"IfcFurnishingElement"},
  {"id":"ball_head","subtype":"tripod_ball_head","origin_local_m":[0,0,1.4],"dims_m":[0.045,0.045,0.06],"shape":"cylinder","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"plate","subtype":"quick_release_plate","origin_local_m":[0,0,1.46],"dims_m":[0.065,0.045,0.008],"shape":"box","rotation_z_rad":0,"material_id":"aluminium","ifc_class":"IfcDiscreteAccessory"},
  {"id":"camera_body","subtype":"camera_body","origin_local_m":[0,0,1.47],"dims_m":[0.15,0.1,0.105],"shape":"box","rotation_z_rad":0,"material_id":"camera_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"lens","subtype":"camera_lens","origin_local_m":[0,-0.13,1.52],"dims_m":[0.045,0.045,0.18],"shape":"cylinder","rotation_z_rad":1.5708,"material_id":"camera_black","ifc_class":"IfcDiscreteAccessory"}
]

Example 2 — "backdrop_stand", bbox [2.5, 0.32, 2.7]:
[
  {"id":"foot_l","subtype":"base_foot","origin_local_m":[-1.1,0,0],"dims_m":[0.6,0.08,0.04],"shape":"box","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"foot_r","subtype":"base_foot","origin_local_m":[1.1,0,0],"dims_m":[0.6,0.08,0.04],"shape":"box","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"pole_l","subtype":"vertical_pole","origin_local_m":[-1.1,0,0.04],"dims_m":[0.02,0.02,2.5],"shape":"cylinder","rotation_z_rad":0,"material_id":"aluminium","ifc_class":"IfcFurnishingElement"},
  {"id":"pole_r","subtype":"vertical_pole","origin_local_m":[1.1,0,0.04],"dims_m":[0.02,0.02,2.5],"shape":"cylinder","rotation_z_rad":0,"material_id":"aluminium","ifc_class":"IfcFurnishingElement"},
  {"id":"crossbar","subtype":"crossbar","origin_local_m":[0,0,2.54],"dims_m":[0.015,0.015,2.4],"shape":"cylinder","rotation_z_rad":1.5708,"material_id":"aluminium","ifc_class":"IfcFurnishingElement"},
  {"id":"paper_sheet","subtype":"backdrop_paper","origin_local_m":[0,0.05,0.3],"dims_m":[2.3,0.01,2.2],"shape":"box","rotation_z_rad":0,"material_id":"paper_neutral","ifc_class":"IfcFurnishingElement"}
]

Example 3 — "studio_stool", bbox [0.56, 0.56, 0.7]:
[
  {"id":"seat","subtype":"stool_seat","origin_local_m":[0,0,0.58],"dims_m":[0.35,0.35,0.05],"shape":"cylinder","rotation_z_rad":0,"material_id":"leather_black","ifc_class":"IfcFurnishingElement"},
  {"id":"plate","subtype":"underside_plate","origin_local_m":[0,0,0.55],"dims_m":[0.15,0.15,0.02],"shape":"cylinder","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"column","subtype":"gas_column","origin_local_m":[0,0,0.12],"dims_m":[0.03,0.03,0.43],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_1","subtype":"base_arm","origin_local_m":[0.24,0,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_2","subtype":"base_arm","origin_local_m":[0.074,0.228,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":1.2566,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_3","subtype":"base_arm","origin_local_m":[-0.194,0.141,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":2.5133,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_4","subtype":"base_arm","origin_local_m":[-0.194,-0.141,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":3.7699,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_5","subtype":"base_arm","origin_local_m":[0.074,-0.228,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":5.0265,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"wheel_1","subtype":"caster_wheel","origin_local_m":[0.24,0,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"wheel_2","subtype":"caster_wheel","origin_local_m":[0.074,0.228,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"wheel_3","subtype":"caster_wheel","origin_local_m":[-0.194,0.141,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"wheel_4","subtype":"caster_wheel","origin_local_m":[-0.194,-0.141,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"wheel_5","subtype":"caster_wheel","origin_local_m":[0.074,-0.228,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"}
]

Example 4 — "workstation_desk", bbox [1.4, 0.7, 1.2]:
[
  {"id":"tabletop","subtype":"desk_tabletop","origin_local_m":[0,0,0.72],"dims_m":[1.3,0.65,0.03],"shape":"box","rotation_z_rad":0,"material_id":"wood_oak","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_fl","subtype":"desk_leg","origin_local_m":[-0.6,-0.28,0],"dims_m":[0.04,0.04,0.72],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_fr","subtype":"desk_leg","origin_local_m":[0.6,-0.28,0],"dims_m":[0.04,0.04,0.72],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_bl","subtype":"desk_leg","origin_local_m":[-0.6,0.28,0],"dims_m":[0.04,0.04,0.72],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_br","subtype":"desk_leg","origin_local_m":[0.6,0.28,0],"dims_m":[0.04,0.04,0.72],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"monitor_stand","subtype":"monitor_arm","origin_local_m":[0,0.25,0.75],"dims_m":[0.06,0.06,0.3],"shape":"cylinder","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"monitor","subtype":"monitor_screen","origin_local_m":[0,0.28,1.0],"dims_m":[0.55,0.03,0.35],"shape":"box","rotation_z_rad":0,"material_id":"plastic_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"keyboard","subtype":"keyboard","origin_local_m":[0,-0.05,0.73],"dims_m":[0.44,0.15,0.02],"shape":"box","rotation_z_rad":0,"material_id":"plastic_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"mouse","subtype":"mouse","origin_local_m":[0.35,-0.05,0.73],"dims_m":[0.06,0.1,0.03],"shape":"box","rotation_z_rad":0,"material_id":"plastic_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"cable_tray","subtype":"cable_management_tray","origin_local_m":[0,0.2,0.65],"dims_m":[0.8,0.1,0.05],"shape":"box","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcDiscreteAccessory"}
]

Now decompose the input item above. Output ONLY the JSON array.`;

// ─── Types ──────────────────────────────────────────────────────────────

export interface DecomposerMetrics {
  decomposed_items: number;
  skipped: number;
  retries: number;
  total_parts: number;
  opus_calls: number;
  wall_time_ms: number;
  cost_usd: number;
}

export interface DecomposerResult {
  spec: BriefSpec;
  metrics: DecomposerMetrics;
}

export interface DecomposerOptions {
  /** Override the Anthropic client factory (for tests). */
  clientFactory?: () => Anthropic;
  /** Override max cost in USD. Default 0.10. */
  maxCostUsd?: number;
  /** Override concurrency limit. Default 10. */
  concurrency?: number;
}

// ─── Zod schema for validating Opus's response ─────────────────────────

const partsArraySchema = z.array(furniturePartSchema).min(1);

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

// ─── Prompt interpolation ───────────────────────────────────────────────

function buildPrompt(
  item: { type: string; description?: string; bounding_box?: [number, number, number]; material_id: string },
  archetype: string,
): string {
  const bbox = item.bounding_box ?? [1.0, 1.0, 1.0];
  return DECOMPOSER_PROMPT_TEMPLATE
    .replace("{archetype}", archetype)
    .replace("{item_name}", item.type)
    .replace("{item_type}", item.type)
    .replace("{bbox}", JSON.stringify(bbox))
    .replace("{material_hint}", item.material_id)
    .replace("{brief_excerpt}", (item.description ?? item.type).slice(0, 200))
    .replace(
      "{MATERIAL_LIBRARY enum, listed below}",
      MATERIAL_LIBRARY.join(", "),
    );
}

// ─── Single item decomposition ──────────────────────────────────────────

async function decomposeItem(
  client: Anthropic,
  prompt: string,
  isRetry: boolean,
): Promise<{ parts: FurniturePart[] | null; inputTokens: number; outputTokens: number }> {
  const userContent = isRetry
    ? prompt + "\n\nRETURN ONLY A JSON ARRAY. First character must be '['. No prose."
    : prompt;

  const stream = client.messages.stream(
    {
      model: DECOMPOSER_MODEL,
      max_tokens: MAX_TOKENS_PER_CALL,
      messages: [{ role: "user", content: userContent }],
    },
    { signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS) },
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
    if (!match) return { parts: null, inputTokens, outputTokens };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { parts: null, inputTokens, outputTokens };
    }
  }

  // Validate against schema
  const result = partsArraySchema.safeParse(parsed);
  if (!result.success) return { parts: null, inputTokens, outputTokens };

  return { parts: result.data, inputTokens, outputTokens };
}

// ─── Main entry point ───────────────────────────────────────────────────

export async function decomposeBriefSpecItems(
  spec: BriefSpec,
  classification: string | undefined,
  options?: DecomposerOptions,
): Promise<DecomposerResult> {
  const startedAt = Date.now();
  const maxCost = options?.maxCostUsd ?? MAX_COST_USD;
  const concurrency = options?.concurrency ?? MAX_CONCURRENT;
  const archetype = classification ?? spec.archetype ?? "other";

  const metrics: DecomposerMetrics = {
    decomposed_items: 0,
    skipped: 0,
    retries: 0,
    total_parts: 0,
    opus_calls: 0,
    wall_time_ms: 0,
    cost_usd: 0,
  };

  const furniture = spec.furniture;
  if (!furniture || furniture.length === 0) {
    metrics.wall_time_ms = Date.now() - startedAt;
    return { spec, metrics };
  }

  // Filter items needing decomposition
  const itemsToDecompose: Array<{ index: number; prompt: string }> = [];
  for (let i = 0; i < furniture.length; i++) {
    const item = furniture[i];
    // Skip if already decomposed
    if (item.parts && item.parts.length > 0) {
      metrics.skipped++;
      continue;
    }
    // Skip trivial items (volume < threshold)
    const bbox = item.bounding_box;
    if (bbox) {
      const volume = bbox[0] * bbox[1] * bbox[2];
      if (volume < TRIVIAL_VOLUME_M3) {
        metrics.skipped++;
        continue;
      }
    }
    itemsToDecompose.push({
      index: i,
      prompt: buildPrompt(item, archetype),
    });
  }

  if (itemsToDecompose.length === 0) {
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

  // Process items in batches with concurrency limit
  let runningCost = 0;
  let costGuardrailHit = false;

  const processItem = async (item: { index: number; prompt: string }): Promise<void> => {
    if (costGuardrailHit) {
      metrics.skipped++;
      return;
    }

    try {
      metrics.opus_calls++;
      const result = await decomposeItem(client, item.prompt, false);
      runningCost += computeCost(result.inputTokens, result.outputTokens);

      if (runningCost > maxCost) {
        costGuardrailHit = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[item-decomposer] Cost guardrail hit: $${runningCost.toFixed(4)} > $${maxCost}. Stopping further calls.`,
        );
      }

      if (result.parts) {
        furniture[item.index] = { ...furniture[item.index], parts: result.parts };
        metrics.decomposed_items++;
        metrics.total_parts += result.parts.length;
        return;
      }

      // Retry once with stricter instruction
      if (costGuardrailHit) {
        metrics.skipped++;
        return;
      }

      metrics.retries++;
      metrics.opus_calls++;
      const retry = await decomposeItem(client, item.prompt, true);
      runningCost += computeCost(retry.inputTokens, retry.outputTokens);

      if (runningCost > maxCost) {
        costGuardrailHit = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[item-decomposer] Cost guardrail hit on retry: $${runningCost.toFixed(4)} > $${maxCost}.`,
        );
      }

      if (retry.parts) {
        furniture[item.index] = { ...furniture[item.index], parts: retry.parts };
        metrics.decomposed_items++;
        metrics.total_parts += retry.parts.length;
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[item-decomposer] Failed to decompose item "${furniture[item.index].type}" after retry. Skipping.`,
        );
        metrics.skipped++;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[item-decomposer] Error decomposing "${furniture[item.index].type}":`,
        err instanceof Error ? err.message : err,
      );
      metrics.skipped++;
    }
  };

  // Execute with concurrency limit via chunked Promise.all
  let processedUpTo = 0;
  for (let i = 0; i < itemsToDecompose.length; i += concurrency) {
    if (costGuardrailHit) break;
    const batch = itemsToDecompose.slice(i, i + concurrency);
    await Promise.all(batch.map(processItem));
    processedUpTo = i + batch.length;
  }
  // Count remaining items that were never reached due to cost guardrail
  if (costGuardrailHit && processedUpTo < itemsToDecompose.length) {
    metrics.skipped += itemsToDecompose.length - processedUpTo;
  }

  metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
  metrics.wall_time_ms = Date.now() - startedAt;

  // Mutate spec with updated furniture
  const updatedSpec: BriefSpec = { ...spec, furniture };
  return { spec: updatedSpec, metrics };
}
