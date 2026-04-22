/**
 * Stage 4: Room Extraction
 *
 * GPT-4o Vision analyzes the GPT Image 1.5 floor plan and extracts
 * room bounding boxes in PIXEL coordinates (top-left origin, Y-down).
 * Phase 1.8 converts pixels → feet for Stage 5 synthesis.
 *
 * Uses OpenAI tools API with strict: true for server-side schema enforcement.
 *
 * Planned implementation: Phase 1.7
 */

import OpenAI from "openai";
import type {
  Stage4Input,
  Stage4Output,
  ExtractedRoom,
  ExtractedRooms,
  RectPx,
} from "./types";
import type { VIPLogger } from "./logger";
import { pickBestMatch } from "./stage-4-matcher";
import { applyStage4PostValidation } from "./stage-4-validators";

// ─── Constants ───────────────────────────────────────────────────

const INPUT_COST_PER_M = 2.5; // GPT-4o input
const OUTPUT_COST_PER_M = 10; // GPT-4o output
const IMAGE_TOKENS = 1400; // ~tokens for high-detail 1024x1024
const API_TIMEOUT_MS = 90_000;
const MODEL = "gpt-4o";
const IMAGE_SIZE = 1024;

// ─── Public Types ────────────────────────────────────────────────

export interface Stage4Metrics {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ─── OpenAI Client ───────────────────────────────────────────────

function createClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  return new OpenAI({ apiKey: key, timeout: API_TIMEOUT_MS, maxRetries: 0 });
}

// ─── Tool Schema ─────────────────────────────────────────────────

const TOOL_FUNCTION: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "extract_floor_plan_rooms",
    description:
      "Extract room bounding boxes from a 2D floor plan image. Return pixel coordinates with origin at top-left, Y growing down.",
    strict: true,
    parameters: {
      type: "object",
      required: ["plotBounds", "rooms"],
      additionalProperties: false,
      properties: {
        plotBounds: {
          type: "object",
          required: ["x", "y", "w", "h"],
          additionalProperties: false,
          description:
            "Bounding box of the exterior walls (plot boundary) in pixels.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
          },
        },
        rooms: {
          type: "array",
          items: {
            type: "object",
            required: [
              "labelAsShown",
              "matchedName",
              "x",
              "y",
              "w",
              "h",
              "confidence",
            ],
            additionalProperties: false,
            properties: {
              labelAsShown: {
                type: "string",
                description:
                  "The text label exactly as shown in the image.",
              },
              matchedName: {
                type: "string",
                description:
                  "The best-matching room name from the expected list.",
              },
              x: {
                type: "number",
                description: "Left edge of room bounding box in pixels.",
              },
              y: {
                type: "number",
                description:
                  "Top edge of room bounding box in pixels (Y grows down).",
              },
              w: {
                type: "number",
                description: "Width of room bounding box in pixels.",
              },
              h: {
                type: "number",
                description: "Height of room bounding box in pixels.",
              },
              confidence: {
                type: "number",
                description:
                  "Confidence 0.0-1.0. Lower if label ambiguous or boundary unclear.",
              },
            },
          },
        },
      },
    },
  },
};

// ─── Fuzzy Name Matching ─────────────────────────────────────────
//
// Phase 2.8 B1: the old word-overlap scorer tied "Master Bath" at 0.5
// against both "Master Bedroom" and "Master Bathroom" and let list order
// pick — consistently mismatching baths to bedrooms. Replaced with the
// discriminator-weighted `pickBestMatch` in stage-4-matcher.ts, which
// hard-zeros disjoint discriminators (bath ↔ bedroom) and prefers
// GPT-4o's own `matchedName` when it already hits an expected room.

// ─── System Prompt ───────────────────────────────────────────────
//
// Phase 2.8 A1/A2/A4 — Anchor GPT-4o Vision to:
//   A1: plot-in-feet ↔ image-in-pixels scale (so it doesn't default to
//       square-shaped rooms that lose the actual image proportions).
//   A2: expected areas per room (from Stage 1 brief) so it can self-check
//       dimension plausibility before returning.
//   A4: do-NOT-extract guidance for dimension lines, wall gaps, door
//       arcs, entry labels, and sub-16-sqft rectangles.
//
// Phase 2.10.1 — Tighten the room-shape contract so extraction mirrors
// the axis-aligned-rectangle contract Stage 5 downstream already
// enforces on Rect. Adds:
//   - Explicit "every room is a strict axis-aligned rectangle" clause
//     (with maximal-inscribed-rectangle guidance for L-shaped regions).
//   - Fixture exclusion: toilets, basins, sinks, stoves, counters are
//     room CONTENTS, not room boundaries. Do not subdivide around them.
//   - Window-stencil exclusion: the double parallel-line pattern on
//     exterior walls is NOT a room.
//   - Output-rules reiteration: "rectangle only; no polygons, no
//     rotated boxes" — belt-and-braces given the JSON tool schema
//     already rejects anything else (x/y/w/h scalars via strict:true).

export function buildSystemPrompt(brief: Stage4Input["brief"]): string {
  const plotW = brief.plotWidthFt;
  const plotD = brief.plotDepthFt;
  const pxPerFt = Math.max(1, Math.round(IMAGE_SIZE / Math.max(plotW, plotD)));

  // Phase 2.8 A2: emit each expected room with its approximate area
  // from the Stage 1 brief. When the brief omits an area, the line
  // drops the area suffix so the LLM doesn't have a fake 0-sqft anchor.
  const roomLines = brief.roomList
    .map((r) => {
      const areaSuffix = r.approxAreaSqft
        ? `, ~${Math.round(r.approxAreaSqft)} sqft`
        : "";
      return `  "${r.name}" (${r.type}${areaSuffix})`;
    })
    .join("\n");

  return `You are a precise computer vision system extracting room bounding boxes from a 2D architectural floor plan image.

The image is ${IMAGE_SIZE}×${IMAGE_SIZE} pixels and represents a ${plotW}×${plotD} ft plot.
Scale: approximately ${pxPerFt} pixels per foot.
Pixel coordinate system: origin at top-left, X grows right, Y grows DOWN.

EXPECTED ROOMS (with approximate areas from the architect's brief):
${roomLines}

ROOM SHAPE CONTRACT (⚠️ MANDATORY — applies to every room you return):
- Every room MUST be a strict AXIS-ALIGNED RECTANGLE expressed as {x, y, w, h} in pixels.
- NO L-shapes, NO T-shapes, NO U-shapes, NO curved boundaries, NO rotated boxes,
  NO overlapping extensions, NO polygon vertices.
- If a room is drawn as an L-shape in the image, return the MAXIMAL INSCRIBED
  axis-aligned rectangle that fits inside the L. Prefer the larger leg; do not
  emit two overlapping rectangles to represent the two legs.
- Rectangles MUST NOT overlap each other. If two drawn rooms share a wall, their
  edges TOUCH but do not cross.
- Interior fixtures (toilets, basins, sinks, stoves, counters, tubs, bedframes,
  furniture) are room CONTENTS, not room subdivisions. Do not split a bathroom
  around the toilet or a kitchen around the counter.

YOUR TASK:
1. Identify the exterior wall boundary (plot bounds) as a pixel rectangle.
2. For each visible room in the image, detect its bounding box rectangle in pixels.
3. Match each detected room label to the closest expected room name.
4. If a room label in the image doesn't match any expected name, use the label as-is for matchedName.
5. If duplicate labels exist (e.g., "Bedroom 2" appears twice), include BOTH with their individual bounding boxes. Set confidence lower (0.4-0.6) for duplicates.

MATCHING RULES:
- The label text in the image is the PRIMARY signal — use it first.
- BUT visual features override ambiguous labels:
    * A small room with plumbing / toilet fixtures → BATHROOM regardless of the text
    * A room with a bed icon or bedside furniture → BEDROOM
    * A room with a kitchen counter / sink → KITCHEN
- If a label could plausibly match multiple expected rooms (e.g. "Master Bath"
  could fuzzy-match both "Master Bedroom" and "Master Bathroom"), pick by
  the ROOM'S VISUAL TYPE — plumbing → bathroom, bed → bedroom. Do NOT
  resolve the ambiguity in favour of a longer word overlap.

DIMENSION RULES:
- Measure each room's bounding box PRECISELY. Rooms are rarely perfectly
  square. A room drawn as a 10×14 rectangle should come out roughly
  10×14 (${Math.round(10 * pxPerFt)}×${Math.round(14 * pxPerFt)} px at
  this scale), NOT 12×12 — do not default to square proportions when
  the drawing shows otherwise.
- Use the ${pxPerFt} px/ft scale as a sanity check: a "12×10 ft"
  expected room should be roughly ${Math.round(12 * pxPerFt)}×${Math.round(10 * pxPerFt)} px.
- Compare each extracted room's area against the approximate area in
  the EXPECTED ROOMS list. If your extracted area differs from the
  expected area by more than ±50%, re-examine the image carefully
  before returning.

DO NOT EXTRACT (these are NOT rooms):
- Dimension lines, measurement callouts, or plot-size annotations
  (e.g. the "40'0\\"" labels on the exterior edges of the image).
- Wall thickness gaps — the dark lines BETWEEN rooms.
- Door arc swept areas — the thin quarter-circles showing door swing.
- Window stencils — the double parallel-line pattern drawn on exterior
  walls to indicate a glazed opening. They are NOT a room.
- Door-frame outlines — small rectangles drawn inside door openings.
  They are NOT a room.
- Interior fixtures (toilets, basins, sinks, stoves, bathtubs, counters,
  beds, wardrobes, cabinets). These are room CONTENTS, never boundaries.
- Entrance labels like "ENTRY" or "PORCH" floating above the roofline
  without a clearly enclosed rectangular space around them.
- Any rectangle smaller than 4×4 ft (~${Math.round(4 * pxPerFt)} px on
  each side, ≈16 sqft) — likely a wall gap or artifact, not a room.

If you see a label but no clear enclosed room boundary around it, DO NOT
return it as a room.

OUTPUT RULES:
- ALL coordinates must be within [0, ${IMAGE_SIZE}] — no negative values, no values > ${IMAGE_SIZE}.
- x + w and y + h must not exceed ${IMAGE_SIZE}.
- Each room gets a tight AXIS-ALIGNED bounding RECTANGLE around its interior
  (inside the walls, not including wall thickness). No polygons, no rotated
  boxes — the only shape the schema accepts is {x, y, w, h}.
- confidence: 0.9-1.0 for clear matches, 0.6-0.8 for approximate matches, 0.3-0.5 for uncertain.
- plotBounds should encompass the entire building footprint (exterior wall to exterior wall).`;
}

// ─── Post-call Validation ────────────────────────────────────────

function validateAndClamp(
  raw: {
    plotBounds: { x: number; y: number; w: number; h: number };
    rooms: Array<{
      labelAsShown: string;
      matchedName: string;
      x: number;
      y: number;
      w: number;
      h: number;
      confidence: number;
    }>;
  },
  brief: Stage4Input["brief"],
): ExtractedRooms {
  const issues: string[] = [];
  const expectedNames = brief.roomList.map((r) => r.name);
  const expectedSet = new Set(expectedNames.map((n) => n.toLowerCase()));

  // Clamp plotBounds
  let plotBoundsPx: RectPx | null = null;
  if (raw.plotBounds) {
    plotBoundsPx = clampRect(raw.plotBounds);
    if (plotBoundsPx.w < 50 || plotBoundsPx.h < 50) {
      issues.push(
        `plotBounds too small: ${plotBoundsPx.w}×${plotBoundsPx.h}px`,
      );
      plotBoundsPx = null;
    }
  } else {
    issues.push("plotBounds not detected — will approximate from room union");
  }

  // Process rooms
  const rooms: ExtractedRoom[] = [];
  const matchedNames = new Map<string, number>();
  const expectedRoomsMissing: string[] = [];
  const unexpectedRoomsFound: string[] = [];

  for (const r of raw.rooms) {
    const rect = clampRect({ x: r.x, y: r.y, w: r.w, h: r.h });
    if (rect.w < 5 || rect.h < 5) {
      issues.push(
        `Room "${r.labelAsShown}" too small: ${rect.w}×${rect.h}px — skipped`,
      );
      continue;
    }

    // Phase 2.8 B1: prefer GPT-4o's matchedName when it exactly hits an
    // expected room; otherwise fall back to discriminator-weighted fuzzy
    // match on labelAsShown. The new matcher treats "Master Bath" →
    // "Master Bedroom" as a hard NO-MATCH (different discriminators) so
    // we no longer produce the "Master Bedroom 2" duplicate bug.
    const match = pickBestMatch(r.labelAsShown, r.matchedName, expectedNames);
    let name = match.name;
    if (match.source === "fallback" && !expectedSet.has(r.matchedName.toLowerCase())) {
      unexpectedRoomsFound.push(r.labelAsShown);
    }

    // Track duplicates
    const count = matchedNames.get(name.toLowerCase()) ?? 0;
    matchedNames.set(name.toLowerCase(), count + 1);

    const confidence = Math.max(0, Math.min(1, r.confidence || 0.5));

    rooms.push({
      name,
      rectPx: rect,
      confidence: count > 0 ? Math.min(confidence, 0.6) : confidence,
      labelAsShown: r.labelAsShown,
    });
  }

  // Flag duplicates
  for (const [name, count] of matchedNames) {
    if (count > 1) {
      issues.push(
        `Duplicate: "${name}" detected ${count} times — both retained with reduced confidence`,
      );
    }
  }

  // Find missing rooms
  for (const expected of expectedNames) {
    if (!matchedNames.has(expected.toLowerCase())) {
      expectedRoomsMissing.push(expected);
    }
  }

  return {
    imageSize: { width: IMAGE_SIZE, height: IMAGE_SIZE },
    plotBoundsPx,
    rooms,
    issues,
    expectedRoomsMissing,
    unexpectedRoomsFound,
  };
}

function clampRect(r: {
  x: number;
  y: number;
  w: number;
  h: number;
}): RectPx {
  const x = Math.max(0, Math.min(IMAGE_SIZE, r.x));
  const y = Math.max(0, Math.min(IMAGE_SIZE, r.y));
  const w = Math.max(0, Math.min(IMAGE_SIZE - x, r.w));
  const h = Math.max(0, Math.min(IMAGE_SIZE - y, r.h));
  return { x, y, w, h };
}

// ─── Main Entry Point ────────────────────────────────────────────

export async function runStage4RoomExtraction(
  input: Stage4Input,
  logger?: VIPLogger,
): Promise<{ output: Stage4Output; metrics: Stage4Metrics }> {
  const client = createClient();

  const dataUrl = `data:image/png;base64,${input.image.base64}`;

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    tools: [TOOL_FUNCTION],
    tool_choice: {
      type: "function" as const,
      function: { name: "extract_floor_plan_rooms" },
    },
    messages: [
      { role: "system", content: buildSystemPrompt(input.brief) },
      {
        role: "user",
        content: [
          {
            type: "image_url" as const,
            image_url: { url: dataUrl, detail: "high" as const },
          },
          {
            type: "text" as const,
            text: "Extract all room bounding boxes from this floor plan image. Return pixel coordinates.",
          },
        ],
      },
    ],
  });

  // ── Cost tracking ──
  const inputTokens = (response.usage?.prompt_tokens ?? 0) + IMAGE_TOKENS;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  const costUsd =
    (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) /
    1_000_000;

  if (logger) logger.logStageCost(4, costUsd);

  // ── Extract tool call ──
  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") {
    throw new Error(
      "Stage 4: GPT-4o did not call the function tool. Raw: " +
        JSON.stringify(response.choices[0]?.message).slice(0, 300),
    );
  }
  if (toolCall.function.name !== "extract_floor_plan_rooms") {
    throw new Error(
      `Stage 4: GPT-4o called wrong function: "${toolCall.function.name}"`,
    );
  }

  let raw: {
    plotBounds: { x: number; y: number; w: number; h: number };
    rooms: Array<{
      labelAsShown: string;
      matchedName: string;
      x: number;
      y: number;
      w: number;
      h: number;
      confidence: number;
    }>;
  };
  try {
    raw = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error(
      "Stage 4: invalid JSON in tool arguments: " +
        toolCall.function.arguments.slice(0, 300),
    );
  }

  if (!raw.rooms || !Array.isArray(raw.rooms)) {
    throw new Error(
      "Stage 4: no rooms array in tool response: " +
        JSON.stringify(raw).slice(0, 300),
    );
  }

  const extraction = validateAndClamp(raw, input.brief);

  // Phase 2.8 B2 + B3: drop phantom rooms (area < 12 sqft with
  // exemption for pooja/store/powder) and flag out-of-band extractions
  // against the brief's approxAreaSqft. Both run post-clamp + post-
  // matcher so they operate on the final kept-rooms list.
  applyStage4PostValidation(extraction, input.brief);

  if (extraction.rooms.length === 0) {
    throw new Error(
      "Stage 4: extracted 0 rooms from image. Issues: " +
        extraction.issues.join("; "),
    );
  }

  return {
    output: { extraction },
    metrics: { inputTokens, outputTokens, costUsd },
  };
}
