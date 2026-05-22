/**
 * Layer 1 - Brief Enrichment.
 *
 * Free-text brief -> strict `BriefSpec` JSON via one Opus 4.7 call with
 * forced `tool_use` (the same forced-tool pattern Phase 1's TR-022
 * architect uses - it removes the "did the model produce parseable JSON
 * or did it surround it with prose?" failure mode entirely).
 *
 * The tool's input schema MIRRORS the zod `briefSpecSchema` so the
 * model's tool-input is structurally identical to what the generator
 * agent expects. We still run it through `briefSpecSchema.safeParse`
 * post-hoc - defensive against an Opus output that contains an extra
 * field, a wrongly-typed value, or a missing required.
 */

import Anthropic from "@anthropic-ai/sdk";

import { briefSpecSchema } from "./types";
import type { BriefEnrichmentResult, BriefSpec } from "./types";
import { withCoercionCollection } from "./telemetry";
import { zodToOpusToolSchema } from "./zod-to-opus-schema";
import { readThrough } from "@/lib/result-cache";

const BRIEF_ENRICHMENT_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;
const ENRICHMENT_MAX_TOKENS = 16_000;
const ENRICHMENT_TIMEOUT_MS = 180_000;
const TOOL_NAME = "submit_brief_spec";

const SYSTEM_PROMPT = `You are a senior architect translating a free-text architectural brief into a strict JSON specification a downstream IFC generator can author from. Read the brief carefully, then call \`${TOOL_NAME}\` with the structured spec.

FAITHFULNESS RULE (overrides everything below):
Your output spec MUST contain ONLY elements the brief explicitly mentions or directly implies. Do NOT add:
- Reception desks, plants, signage, accessories, decorations the brief didn't mention
- Ceiling fans, AC units, light fixtures the brief didn't ask for
- Rooms the brief didn't mention (no balconies, pooja niches, utility rooms, storage closets unless stated)
- Furniture beyond what the brief enumerates
If the brief says "8 workstations", your spec has exactly 8. Not 8 + chairs + monitors + accessories.
If the brief says "office", build an office with what the brief lists — NOT what is commonly in offices.
For parameters the brief leaves unspecified (wall thickness, material colors, ceiling height), pick sensible defaults and log them in \`assumptions_made[]\`.
The \`archetype\` field is a LABEL for the result page, not a behavior driver. Do NOT add archetype-typical features based on it.

CRITICAL RULES:

1. ASCII ONLY. Never use em-dashes (-), middle dots (.), curly quotes ('"), arrows (->) or any other non-ASCII character in any string field. Use plain hyphens, periods, straight quotes, and "->" / "<-" written out. STEP serialization downstream fails on a single non-ASCII byte.

2. PRESERVE WHAT THE BRIEF STATES. If the brief gives a dimension, location, material, or count, reproduce it exactly. Do not round, do not substitute. When the brief is silent, INFER reasonable defaults - but only what the IFC generator genuinely needs (a default storey height when only a footprint is given, a sensible material palette, a baseline occupancy).

3. EVERY ELEMENT NEEDS COORDINATES. The brief might say "four columns at the corners of the booth" - translate that to four explicit elements with explicit (x, y, z) origins. The IFC generator does NOT do spatial reasoning; it places where you tell it.

4. EVERY ELEMENT NEEDS A MATERIAL REFERENCE. The materials array is the source of truth; every element.material_id must match a material.id. Define at minimum 3-5 materials: structural, finish, accent, glass, ambient.

5. SPACE POLYGONS ARE COUNTERCLOCKWISE in world-XY coordinates with the site's south-west corner at (0, 0). A 5m x 5m booth has polygon [[0,0], [5,0], [5,5], [0,5]].

6. ELEMENT TYPES. Use the canonical set: slab, wall, column, beam, space, covering, furniture, lighting, proxy, door, window. Map exhibition-stand decor / signage / displays to "proxy" with a descriptive object_type. Map booth furniture / tables / counters to "furniture". Map spotlights / lamps to "lighting". Map ANY opening described as a "door", "entrance", "doorway" to type "door". Map ANY opening described as a "window" (fixed, sliding, or otherwise) to type "window". DO NOT route doors or windows to "proxy" or "furniture" — downstream BIM tools filter by IFC class, and only the typed "door" / "window" values yield IfcDoor / IfcWindow entities.

7. DO NOT INVENT GUIDs OR DATES. The generator handles those.

8. STAY FAITHFUL TO THE BRIEF'S BRAND LANGUAGE. If the brief uses approved terms (e.g. "Lounge", "Demo Bay"), use those exact strings. If it forbids terms, never emit them.

9. IRREGULAR FOOTPRINTS. If the brief describes a non-rectangular plan (L-shape, T-shape, U-shape, or any shape with a perpendicular extension), you MUST capture the actual perimeter polygon in the space's polygon_world_m field. Set site.bounds_m to the axis-aligned bounding box of the polygon (so site.bounds_m = [10, 8] for a 10m arm + 4m perpendicular extension that brings the AABB to 10×8). The polygon itself goes in space.polygon_world_m as counter-clockwise (x, y) vertices in metres. Example for the 10m arm + 4×4 right-angle extension: polygon_world_m: [[0,0], [10,0], [10,4], [4,4], [4,8], [0,8]]. DO NOT flatten the L-shape into a single rectangle (e.g. [14,4]) — the downstream generator builds perimeter walls along whichever polygon you give it, so a flattened polygon yields a flattened building. If the footprint is rectangular, keep polygon_world_m as the simple 4-vertex outline matching site.bounds_m.

10. ARCHETYPE FIELD. Set \`archetype\` to the best match: "office", "residential_2bhk", "residential_3bhk", "gym", "exhibition", "retail", "restaurant", "classroom", or "other". This drives which deterministic builder runs downstream. If unsure, use "other".

11. GLOBAL PARAMETERS. Fill \`global_parameters\` with construction defaults. If the brief specifies ceiling height, wall thickness, etc., use those values. Otherwise use sensible defaults (3.0m ceiling, 0.2m ext wall, 0.1m int wall, 0.15m slab, 2.1m door height, 0.9m window sill). Log every assumed value in \`assumptions_made[]\` with { field, assumed_value, reason }.

12. OPENINGS ARRAY. In addition to listing doors/windows in \`elements[]\`, also populate the \`openings[]\` array. Each opening MUST have: id, type ("door"|"window"), host_wall_id (the id of the wall element it cuts into), offset_m (metres from the wall's start along its axis), width_m, height_m, sill_m (0 for doors, 0.9 for typical windows), material_id. This lets the deterministic builder cut void openings without LLM guidance.

13. FURNITURE ARRAY. Populate \`furniture[]\` for items that follow a repeating pattern. Each entry has: id, type (e.g. "workstation", "meeting_chair"), count, layout ({ kind: "grid", rows, cols, pitch_x_m, pitch_y_m } or { kind: "explicit" }), anchor_space_id (which space it belongs to), bounding_box ([width, depth, height] in metres), material_id. Grid layouts are preferred for repeated items (e.g. 8 workstations in 2 rows of 4).

14. LIGHTING. Populate \`lighting\` with { strategy: "grid", zones: [...] }. Each zone has: anchor_space_id, fixture_type (e.g. "LED Panel"), count, layout (same as furniture), material_id. Use "grid" strategy for offices, "perimeter" for exhibition/retail.

15. ASSUMPTIONS. Every default you infer (wall thickness, ceiling height, material color, occupancy count, etc.) MUST be logged in \`assumptions_made[]\` with { field: "path.to.field", assumed_value: "the value", reason: "brief was silent on this" }.

Produce the spec by calling \`${TOOL_NAME}\` with the structured payload. Do not write prose outside the tool call.`;

/** Auto-generated from the zod `briefSpecSchema` — no hand-maintained
 *  mirror that can drift (H11 audit finding). The `zodToOpusToolSchema`
 *  converter handles the full zod-v4 subset used by the spec, including
 *  `specular_rgb` and `polygon_local_m` fields that the hand-written
 *  schema previously omitted. */
function briefSpecJsonSchema(): Record<string, unknown> {
  return zodToOpusToolSchema(briefSpecSchema);
}

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}

function computeOpusCost(inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens * OPUS_INPUT_COST_PER_MILLION +
      outputTokens * OPUS_OUTPUT_COST_PER_MILLION) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export interface EnrichmentArgs {
  /** Free-text brief from the user. */
  brief: string;
  /** Hint for the project type. Passed through to the system prompt
   *  so Opus knows what kind of spec to produce when the brief is
   *  ambiguous. */
  projectType?: "exhibition_booth" | "office" | "residential" | "retail" | "gym" | "restaurant" | "classroom" | "studio" | "hotel" | "warehouse" | "hospital" | "other";
}

export async function enrichBrief(
  args: EnrichmentArgs,
): Promise<BriefEnrichmentResult> {
  // Read-through cache: same brief (+ projectType) hashed via SHA-256
  // returns the previously-stored BriefSpec without paying Anthropic.
  // Failures are NEVER cached — see `shouldCache` predicate below.
  const cached = await readThrough<BriefEnrichmentResult>({
    config: {
      namespace: "enrichBrief",
      // Editing the system prompt or the model literal auto-invalidates.
      promptVersion: [BRIEF_ENRICHMENT_MODEL, SYSTEM_PROMPT, TOOL_NAME],
    },
    input: {
      brief: args.brief.trim(),
      projectType: args.projectType ?? null,
    },
    compute: () => enrichBriefUncached(args),
    shouldCache: (r) => r.ok === true && r.brief !== null,
  });
  if (cached.cacheHit) {
    return {
      ...cached.value,
      costUsd: 0,
      cacheHit: true,
    };
  }
  return cached.value;
}

async function enrichBriefUncached(
  args: EnrichmentArgs,
): Promise<BriefEnrichmentResult> {
  const startedAt = Date.now();
  let client: Anthropic;
  try {
    client = createAnthropicClient();
  } catch (err) {
    return {
      ok: false, brief: null, costUsd: 0,
      durationMs: Date.now() - startedAt,
      inputTokens: 0, outputTokens: 0,
      error: {
        code: "MISSING_API_KEY",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const userMessage =
    `PROJECT TYPE HINT: ${args.projectType ?? "exhibition_booth"}\n\n` +
    `--- BEGIN BRIEF ---\n${args.brief}\n--- END BRIEF ---\n\n` +
    `Translate the above into a BriefSpec by calling ${TOOL_NAME}. ` +
    `ASCII strings only.`;

  let message: Anthropic.Messages.Message;
  try {
    const stream = client.messages.stream(
      {
        model: BRIEF_ENRICHMENT_MODEL,
        max_tokens: ENRICHMENT_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [
          {
            name: TOOL_NAME,
            description:
              "Submit the structured BriefSpec. The only valid output channel.",
            input_schema:
              briefSpecJsonSchema() as Anthropic.Tool["input_schema"],
          },
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: userMessage }],
      },
      { signal: AbortSignal.timeout(ENRICHMENT_TIMEOUT_MS) },
    );
    message = await stream.finalMessage();
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false, brief: null, costUsd: 0,
      durationMs: Date.now() - startedAt,
      inputTokens: 0, outputTokens: 0,
      error: {
        code: isAbort ? "ENRICHMENT_TIMEOUT" : "ENRICHMENT_API_ERROR",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== TOOL_NAME) {
    return {
      ok: false, brief: null,
      costUsd: computeOpusCost(message.usage.input_tokens, message.usage.output_tokens),
      durationMs: Date.now() - startedAt,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      error: {
        code: "MISSING_TOOL_USE",
        message: `expected ${TOOL_NAME}, got ${toolUse?.name ?? "none"}`,
      },
    };
  }

  // Phase δ.1a — wrap the parse in a coercion-collection async context.
  // Any tolerantEnum / tolerantRgb / tolerantPositive helper that fires
  // during the parse records into `coercions`; the caller can persist
  // them as BuildTelemetry.schemaCoercions or its own diagnostic log.
  const { result: parsed, coercions } = withCoercionCollection(() =>
    briefSpecSchema.safeParse(toolUse.input),
  );
  if (!parsed.success) {
    return {
      ok: false, brief: null,
      costUsd: computeOpusCost(message.usage.input_tokens, message.usage.output_tokens),
      durationMs: Date.now() - startedAt,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      coercions,
      error: {
        code: "INVALID_BRIEF_SPEC",
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
    };
  }

  const brief: BriefSpec = parsed.data;
  return {
    ok: true, brief,
    costUsd: computeOpusCost(message.usage.input_tokens, message.usage.output_tokens),
    durationMs: Date.now() - startedAt,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    coercions,
    error: null,
  };
}
