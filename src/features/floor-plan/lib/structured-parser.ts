import { getClient } from "@/features/ai/services/openai";
import { logger } from "@/lib/logger";
import { auditConstraints, summarizeFindings, type AuditResult } from "./parser-audit";
import { getSurfaceForms, type RoomFunction } from "./room-vocabulary";
import { findRoomAnchors, dimNearAnchors, positionNearAnchors } from "./parser-text-utils";

export const PARSER_MODEL = "gpt-4o-2024-08-06";
export const PARSER_TEMPERATURE = 0;
export const PARSER_MAX_TOKENS = 4096;
export const PARSER_TIMEOUT_MS = 60_000;

export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type CenterDirection = CompassDirection | "CENTER";

export interface ParsedDoor {
  width_ft: number;
  leads_to_room_id: string | null;
  is_main_entrance: boolean;
}

export interface ParsedWindow {
  wall_direction: "N" | "S" | "E" | "W";
  is_large: boolean;
}

export interface ParsedRoom {
  id: string;
  name: string;
  function: RoomFunction;
  dim_width_ft: number | null;
  dim_depth_ft: number | null;
  position_type: "corner" | "zone" | "wall_centered" | "unspecified";
  position_direction: CenterDirection | null;
  attached_to_room_id: string | null;
  must_have_window_on: "N" | "S" | "E" | "W" | null;
  external_walls_ft: number | null;
  internal_walls_ft: number | null;
  doors: ParsedDoor[];
  windows: ParsedWindow[];
  is_wet: boolean;
  is_sacred: boolean;
  is_circulation: boolean;
  user_explicit_dims: boolean;
  user_explicit_position: boolean;
}

export interface ParsedAdjacency {
  room_a_id: string;
  room_b_id: string;
  relationship: "shared_wall" | "door_connects" | "attached_ensuite" | "leads_to" | "behind" | "flowing_into";
  user_explicit: boolean;
}

export interface ParsedSpecialFeature {
  feature: "porch" | "verandah" | "sit_out" | "balcony" | "terrace" | "courtyard" | "back_door" | "servant_entry" | "pooja" | "staircase";
  mentioned_verbatim: boolean;
}

export interface ConstraintBudget {
  dimensional: number;
  positional: number;
  adjacency: number;
  vastu: number;
  total: number;
}

export interface ParsedConstraints {
  plot: {
    width_ft: number | null;
    depth_ft: number | null;
    facing: CompassDirection | null;
    shape: "rectangular" | "L-shape" | "irregular" | "square" | null;
    total_built_up_sqft: number | null;
  };
  rooms: ParsedRoom[];
  adjacency_pairs: ParsedAdjacency[];
  vastu_required: boolean;
  special_features: ParsedSpecialFeature[];
  constraint_budget: ConstraintBudget;
  extraction_notes: string;
}

export interface ParseResult {
  constraints: ParsedConstraints;
  audit: AuditResult;
  first_attempt_findings: AuditResult["findings"];
  audit_attempts: number;
  raw_response: string;
  parser_model: string;
}

export const PARSER_SYSTEM_PROMPT = `You are a constraint extractor, not a designer. Your only job is to convert the user's prompt into a structured JSON object that lists what the user wrote. You make zero design decisions.

HARD RULES:
1. Do NOT add any room the user did not name. If the user said "bungalow" — do NOT add a verandah, porch, foyer, or staircase unless they wrote that word.
2. Extract dimensions only if the user gave them. If the user did not give a dimension for a room, set dim_width_ft: null and dim_depth_ft: null.
3. Extract positions only if the user gave them. If the user did not position a room, set position_type: "unspecified" and position_direction: null.
4. Do NOT consolidate, merge, or rename rooms. "Walk-in Wardrobe" stays "Walk-in Wardrobe". Never output "Walk-in Closet" if the user wrote "wardrobe". Never split "open-plan living-dining" into two rooms.
5. If the user mentions Vastu/Vaastu anywhere, set vastu_required: true.
6. Convert all dimensions to feet. 9 inches = 0.75 ft. Always include internal_walls_ft and external_walls_ft if user gives them.
7. Each room id is a slug like "bed-master", "bath-1", "kitchen", "living". Stable across the document. attached_to_room_id and adjacency_pairs reference these ids.

You DO NOT emit user_explicit_dims or user_explicit_position fields. A separate deterministic post-processor sets those flags by checking your output against the original prompt text. Just emit dim_width_ft / dim_depth_ft / position_direction values when the user provides them, and leave them null when they don't.

DIRECTION EXTRACTION EXAMPLES:
- "in the southwest corner" → position_type: "corner", position_direction: "SW"
- "in the northeast" / "northeast zone" → position_type: "zone", position_direction: "NE"
- "south-center" → position_type: "wall_centered", position_direction: "S"
- "centered on the north wall" → position_type: "wall_centered", position_direction: "N"
- "east-center with window on east wall" → position_type: "wall_centered", position_direction: "E", windows: [{wall_direction: "E", is_large: false}]
- "north-facing plot" → plot.facing: "N" (NOT a room position)

ATTACHMENT RULES:
- "attached <X>" or "ensuite <X>" → set attached_to_room_id of X to the parent room's id, and add adjacency_pairs[] with relationship: "attached_ensuite", user_explicit: true.
- "behind the kitchen" → position_direction: null, but add adjacency_pairs[] with relationship: "behind", room_a_id = utility, room_b_id = kitchen.
- "flowing east into" / "leads into" → adjacency_pairs[] with relationship: "flowing_into" or "leads_to", user_explicit: true.

CONSTRAINT BUDGET (count exactly):
- dimensional: each room with both dim_width_ft and dim_depth_ft set = 2; each with one set = 1
- positional: each room with position_direction set = 1; plot.facing set = 1
- adjacency: each adjacency_pairs[] with user_explicit: true = 1
- vastu: 5 if vastu_required else 0
- total: sum of the above

ROOM FUNCTION ENUM (use ONLY these strings for each room.function):
bedroom, master_bedroom, guest_bedroom, kids_bedroom,
living, dining, kitchen,
bathroom, master_bathroom, powder_room,
walk_in_wardrobe, walk_in_closet,
foyer, porch, verandah, balcony, corridor, staircase,
utility, store, pooja, study, servant_quarter, other

is_wet: true for bathroom/master_bathroom/powder_room/kitchen/utility
is_sacred: true for pooja
is_circulation: true for foyer/porch/corridor/staircase

If you find yourself wanting to add a room "for completeness" — DO NOT. Output exactly what the user wrote. If the user named exactly 6 rooms, output exactly 6 rooms.

BHK SHORTHAND (Indian usage): "NBHK" or "N BHK" means N bedrooms + 1 hall (living) + 1 kitchen. When you see "4BHK", you may emit 4 bedroom-class rooms (one master_bedroom + three bedroom) PLUS 1 living + 1 kitchen, even if not individually named — this is established meaning, not invention. But:
- The room.name field for these implicit rooms should be "Master Bedroom", "Bedroom 2", "Bedroom 3", etc.
- Leave dim_width_ft / dim_depth_ft / position_direction null unless the prompt explicitly states them
- DO NOT add bathrooms unless the prompt mentions them (Indian BHK does not strictly include bath count)

NEVER CREATE A ROOM FROM THE BUILDING TYPE: "5BHK Villa", "3BHK Apartment", "Penthouse", "Bungalow" describe the project, not a room. Never emit a room whose name is the building type. plot.shape and plot.facing capture project-level context.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["plot", "rooms", "adjacency_pairs", "vastu_required", "special_features", "constraint_budget", "extraction_notes"],
  properties: {
    plot: {
      type: "object",
      additionalProperties: false,
      required: ["width_ft", "depth_ft", "facing", "shape", "total_built_up_sqft"],
      properties: {
        width_ft: { type: ["number", "null"] },
        depth_ft: { type: ["number", "null"] },
        facing: { type: ["string", "null"], enum: ["N", "S", "E", "W", "NE", "NW", "SE", "SW", null] },
        shape: { type: ["string", "null"], enum: ["rectangular", "L-shape", "irregular", "square", null] },
        total_built_up_sqft: { type: ["number", "null"] },
      },
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "name", "function", "dim_width_ft", "dim_depth_ft",
          "position_type", "position_direction", "attached_to_room_id",
          "must_have_window_on", "external_walls_ft", "internal_walls_ft",
          "doors", "windows", "is_wet", "is_sacred", "is_circulation",
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          function: {
            type: "string",
            enum: [
              "bedroom", "master_bedroom", "guest_bedroom", "kids_bedroom",
              "living", "dining", "kitchen",
              "bathroom", "master_bathroom", "powder_room",
              "walk_in_wardrobe", "walk_in_closet",
              "foyer", "porch", "verandah", "balcony", "corridor", "staircase",
              "utility", "store", "pooja", "study", "servant_quarter", "other",
            ],
          },
          dim_width_ft: { type: ["number", "null"] },
          dim_depth_ft: { type: ["number", "null"] },
          position_type: { type: "string", enum: ["corner", "zone", "wall_centered", "unspecified"] },
          position_direction: { type: ["string", "null"], enum: ["N", "S", "E", "W", "NE", "NW", "SE", "SW", "CENTER", null] },
          attached_to_room_id: { type: ["string", "null"] },
          must_have_window_on: { type: ["string", "null"], enum: ["N", "S", "E", "W", null] },
          external_walls_ft: { type: ["number", "null"] },
          internal_walls_ft: { type: ["number", "null"] },
          doors: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["width_ft", "leads_to_room_id", "is_main_entrance"],
              properties: {
                width_ft: { type: "number" },
                leads_to_room_id: { type: ["string", "null"] },
                is_main_entrance: { type: "boolean" },
              },
            },
          },
          windows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["wall_direction", "is_large"],
              properties: {
                wall_direction: { type: "string", enum: ["N", "S", "E", "W"] },
                is_large: { type: "boolean" },
              },
            },
          },
          is_wet: { type: "boolean" },
          is_sacred: { type: "boolean" },
          is_circulation: { type: "boolean" },
        },
      },
    },
    adjacency_pairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["room_a_id", "room_b_id", "relationship", "user_explicit"],
        properties: {
          room_a_id: { type: "string" },
          room_b_id: { type: "string" },
          relationship: {
            type: "string",
            enum: ["shared_wall", "door_connects", "attached_ensuite", "leads_to", "behind", "flowing_into"],
          },
          user_explicit: { type: "boolean" },
        },
      },
    },
    vastu_required: { type: "boolean" },
    special_features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["feature", "mentioned_verbatim"],
        properties: {
          feature: {
            type: "string",
            enum: ["porch", "verandah", "sit_out", "balcony", "terrace", "courtyard", "back_door", "servant_entry", "pooja", "staircase"],
          },
          mentioned_verbatim: { type: "boolean" },
        },
      },
    },
    constraint_budget: {
      type: "object",
      additionalProperties: false,
      required: ["dimensional", "positional", "adjacency", "vastu", "total"],
      properties: {
        dimensional: { type: "integer" },
        positional: { type: "integer" },
        adjacency: { type: "integer" },
        vastu: { type: "integer" },
        total: { type: "integer" },
      },
    },
    extraction_notes: { type: "string" },
  },
} as const;

async function callParser(
  client: ReturnType<typeof getClient>,
  prompt: string,
  retryHint: string | null,
): Promise<{ constraints: ParsedConstraints; raw: string }> {
  const userMessage = retryHint
    ? `${prompt}\n\n=== AUDIT FAILURE ON PREVIOUS ATTEMPT ===\n${retryHint}\nRe-extract using ONLY the user's explicit text. Do not infer.`
    : prompt;

  const completion = await client.chat.completions.create({
    model: PARSER_MODEL,
    temperature: PARSER_TEMPERATURE,
    max_tokens: PARSER_MAX_TOKENS,
    response_format: {
      type: "json_schema",
      json_schema: { name: "floor_plan_constraints", strict: true, schema: SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      { role: "system", content: PARSER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Parser returned empty response");
  const parsed = JSON.parse(raw) as ParsedConstraints;
  for (const room of parsed.rooms) {
    room.user_explicit_dims = false;
    room.user_explicit_position = false;
  }
  inferExplicitFlags(parsed, prompt);
  return { constraints: parsed, raw };
}

/**
 * Deterministically set user_explicit_dims and user_explicit_position by
 * checking the original prompt text against each room's anchors. Replaces
 * the model's prior self-judged flags, which were unreliable on vague prompts.
 */
export function inferExplicitFlags(constraints: ParsedConstraints, originalPrompt: string): void {
  const promptLower = originalPrompt.toLowerCase();
  for (const room of constraints.rooms) {
    const forms = getSurfaceForms(room.function as RoomFunction);
    const m = findRoomAnchors(promptLower, room.name, forms);

    room.user_explicit_dims =
      room.dim_width_ft != null && room.dim_depth_ft != null
        ? dimNearAnchors(originalPrompt, room.dim_width_ft, room.dim_depth_ft, m.anchor_positions)
        : false;

    room.user_explicit_position =
      room.position_direction != null
        ? positionNearAnchors(originalPrompt, room.position_direction, m.anchor_positions)
        : false;
  }
}

export async function parseConstraints(
  prompt: string,
  userApiKey?: string,
): Promise<ParseResult> {
  const client = getClient(userApiKey, PARSER_TIMEOUT_MS);

  const first = await callParser(client, prompt, null);
  const firstAudit = auditConstraints(first.constraints, prompt);

  if (firstAudit.passed) {
    logger.debug(`[PARSER] First-attempt audit passed (${first.constraints.rooms.length} rooms)`);
    return {
      constraints: first.constraints,
      audit: firstAudit,
      first_attempt_findings: [],
      audit_attempts: 1,
      raw_response: first.raw,
      parser_model: PARSER_MODEL,
    };
  }

  const hint = summarizeFindings(firstAudit.findings);
  logger.debug(`[PARSER] First-attempt audit failed (${firstAudit.findings.length} findings) — retrying`);
  const second = await callParser(client, prompt, hint);
  const secondAudit = auditConstraints(second.constraints, prompt);

  return {
    constraints: second.constraints,
    audit: secondAudit,
    first_attempt_findings: firstAudit.findings,
    audit_attempts: 2,
    raw_response: second.raw,
    parser_model: PARSER_MODEL,
  };
}
