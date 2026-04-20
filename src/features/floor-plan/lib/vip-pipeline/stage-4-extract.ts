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

function wordOverlapScore(a: string, b: string): number {
  const wordsA = a.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const wordsB = new Set(
    b.toLowerCase().split(/\s+/).filter((w) => w.length > 1),
  );
  if (wordsA.length === 0) return 0;
  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) matches++;
  }
  return matches / Math.max(wordsA.length, wordsB.size);
}

function bestMatchName(
  label: string,
  expectedNames: string[],
): { name: string; score: number } {
  let best = { name: label, score: 0 };
  for (const name of expectedNames) {
    const score = wordOverlapScore(label, name);
    if (score > best.score) best = { name, score };
  }
  return best;
}

// ─── System Prompt ───────────────────────────────────────────────

function buildSystemPrompt(brief: Stage4Input["brief"]): string {
  const roomNames = brief.roomList
    .map((r) => `"${r.name}" (${r.type})`)
    .join(", ");

  return `You are a precise computer vision system extracting room bounding boxes from a 2D architectural floor plan image.

The image is ${IMAGE_SIZE}×${IMAGE_SIZE} pixels. Pixel coordinate system: origin at top-left, X grows right, Y grows DOWN.

EXPECTED ROOMS: ${roomNames}

YOUR TASK:
1. Identify the exterior wall boundary (plot bounds) as a pixel rectangle.
2. For each visible room in the image, detect its bounding box rectangle in pixels.
3. Match each detected room label to the closest expected room name.
4. If a room label in the image doesn't match any expected name, use the label as-is for matchedName.
5. If duplicate labels exist (e.g., "Bedroom 2" appears twice), include BOTH with their individual bounding boxes. Set confidence lower (0.4-0.6) for duplicates.

RULES:
- ALL coordinates must be within [0, ${IMAGE_SIZE}] — no negative values, no values > ${IMAGE_SIZE}.
- x + w and y + h must not exceed ${IMAGE_SIZE}.
- Each room gets a tight bounding box around its interior (inside the walls, not including wall thickness).
- confidence: 0.9-1.0 for clear matches, 0.6-0.8 for approximate matches, 0.3-0.5 for uncertain.
- Include ALL rooms visible in the image, even if not in the expected list.
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

    // Fuzzy match name
    let name = r.matchedName;
    const match = bestMatchName(r.labelAsShown, expectedNames);
    if (match.score >= 0.5) {
      name = match.name;
    } else if (!expectedSet.has(r.matchedName.toLowerCase())) {
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
