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

const BRIEF_ENRICHMENT_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;
const ENRICHMENT_MAX_TOKENS = 16_000;
const ENRICHMENT_TIMEOUT_MS = 180_000;
const TOOL_NAME = "submit_brief_spec";

const SYSTEM_PROMPT = `You are a senior architect translating a free-text architectural brief into a strict JSON specification a downstream IFC generator can author from. Read the brief carefully, then call \`${TOOL_NAME}\` with the structured spec.

CRITICAL RULES:

1. ASCII ONLY. Never use em-dashes (-), middle dots (.), curly quotes ('"), arrows (->) or any other non-ASCII character in any string field. Use plain hyphens, periods, straight quotes, and "->" / "<-" written out. STEP serialization downstream fails on a single non-ASCII byte.

2. PRESERVE WHAT THE BRIEF STATES. If the brief gives a dimension, location, material, or count, reproduce it exactly. Do not round, do not substitute. When the brief is silent, INFER reasonable defaults - but only what the IFC generator genuinely needs (a default storey height when only a footprint is given, a sensible material palette, a baseline occupancy).

3. EVERY ELEMENT NEEDS COORDINATES. The brief might say "four columns at the corners of the booth" - translate that to four explicit elements with explicit (x, y, z) origins. The IFC generator does NOT do spatial reasoning; it places where you tell it.

4. EVERY ELEMENT NEEDS A MATERIAL REFERENCE. The materials array is the source of truth; every element.material_id must match a material.id. Define at minimum 3-5 materials: structural, finish, accent, glass, ambient.

5. SPACE POLYGONS ARE COUNTERCLOCKWISE in world-XY coordinates with the site's south-west corner at (0, 0). A 5m x 5m booth has polygon [[0,0], [5,0], [5,5], [0,5]].

6. ELEMENT TYPES. Use the canonical set: slab, wall, column, beam, space, covering, furniture, lighting, proxy. Map exhibition-stand decor / signage / displays to "proxy" with a descriptive object_type. Map booth furniture / tables / counters to "furniture". Map spotlights / lamps to "lighting".

7. DO NOT INVENT GUIDs OR DATES. The generator handles those.

8. STAY FAITHFUL TO THE BRIEF'S BRAND LANGUAGE. If the brief uses approved terms (e.g. "Lounge", "Demo Bay"), use those exact strings. If it forbids terms, never emit them.

Produce the spec by calling \`${TOOL_NAME}\` with the structured payload. Do not write prose outside the tool call.`;

function briefSpecJsonSchema(): Record<string, unknown> {
  // Hand-written mirror of `briefSpecSchema`. We keep this in lockstep
  // with `types.ts` rather than synth-from-zod because zod-to-json-schema
  // isn't in the dependency tree and the surface is small.
  return {
    type: "object",
    properties: {
      project: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["exhibition_booth", "office", "residential", "retail"],
          },
          location: { type: "string" },
          description: { type: "string" },
        },
        required: ["name", "type", "location", "description"],
      },
      site: {
        type: "object",
        properties: {
          bounds_m: {
            type: "array",
            items: { type: "number" },
            minItems: 2,
            maxItems: 2,
          },
          height_limit_m: { type: "number" },
          coordinate_origin: { type: "string", enum: ["sw_corner"] },
        },
        required: ["bounds_m", "height_limit_m", "coordinate_origin"],
      },
      spaces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            long_name: { type: "string" },
            polygon_world_m: {
              anyOf: [
                {
                  type: "array",
                  items: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2, maxItems: 2,
                  },
                  minItems: 3,
                },
                { type: "null" },
              ],
            },
            circular_centre_radius: {
              type: "array",
              items: { type: "number" },
              minItems: 3, maxItems: 3,
            },
            height_m: { type: "number" },
            occupancy_type: { type: "string" },
          },
          required: ["id", "name", "long_name", "polygon_world_m", "height_m", "occupancy_type"],
        },
      },
      elements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: [
                "slab", "wall", "column", "beam", "space",
                "covering", "furniture", "lighting", "proxy",
              ],
            },
            origin_world_m: {
              type: "array", items: { type: "number" },
              minItems: 3, maxItems: 3,
            },
            dims_m: {
              type: "array", items: { type: "number" },
              minItems: 3, maxItems: 3,
            },
            radius_m: { type: "number" },
            rotation_z_rad: { type: "number" },
            material_id: { type: "string" },
            description: { type: "string" },
            object_type: { type: "string" },
            tag: { type: "string" },
            contained_in_space_id: { type: "string" },
          },
          required: ["id", "type", "origin_world_m", "material_id", "description", "object_type", "tag"],
        },
      },
      materials: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            rgb: {
              type: "array", items: { type: "number" },
              minItems: 3, maxItems: 3,
            },
            roughness: { type: "number" },
            method: {
              type: "string",
              enum: ["MATT", "METAL", "PHONG", "PLASTIC"],
            },
            category: { type: "string" },
          },
          required: ["id", "name", "rgb", "roughness", "method", "category"],
        },
      },
      brand_language: {
        type: "object",
        properties: {
          primary_text: { type: "string" },
          approved_terms: { type: "array", items: { type: "string" } },
          forbidden_terms: { type: "array", items: { type: "string" } },
        },
        required: ["primary_text", "approved_terms", "forbidden_terms"],
      },
    },
    required: ["project", "site", "spaces", "elements", "materials", "brand_language"],
  };
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
  projectType?: "exhibition_booth" | "office" | "residential" | "retail";
}

export async function enrichBrief(
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

  const parsed = briefSpecSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return {
      ok: false, brief: null,
      costUsd: computeOpusCost(message.usage.input_tokens, message.usage.output_tokens),
      durationMs: Date.now() - startedAt,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
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
    error: null,
  };
}
