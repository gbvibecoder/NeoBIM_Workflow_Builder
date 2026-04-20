/**
 * Stage 6: Quality Gate
 *
 * Claude Sonnet 4.6 evaluates the FloorPlanProject across 7 weighted
 * dimensions. Returns score 0-100 + recommendation (pass/retry/fail).
 *
 * PASS (>=65): proceed to Stage 7 (delivery)
 * RETRY (45-64): retry once if first attempt, else deliver best
 * FAIL (<45): VipJob marked FAILED
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Stage6Input,
  Stage6Output,
  QualityDimension,
} from "./types";
import type { VIPLogger } from "./logger";
import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { ArchitectBrief } from "./types";
import { Stage6RawOutputSchema } from "./schemas";

// ─── Constants ───────────────────────────────────────────────────

const INPUT_COST_PER_M = 3;
const OUTPUT_COST_PER_M = 15;
const API_TIMEOUT_MS = 60_000;
const MODEL = "claude-sonnet-4-6";

const DIMENSION_WEIGHTS: Record<QualityDimension, number> = {
  roomCountMatch: 2.0,
  noDuplicateNames: 2.0,
  dimensionPlausibility: 2.0,
  vastuCompliance: 1.5,
  orientationCorrect: 1.5,
  connectivity: 1.0,
  exteriorWindows: 1.0,
};

const PASS_THRESHOLD = 65;
const RETRY_THRESHOLD = 45;

// ─── Public Types ────────────────────────────────────────────────

export interface Stage6Metrics {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ─── Tool Schema ─────────────────────────────────────────────────

const TOOL_SCHEMA: Anthropic.Tool = {
  name: "produce_quality_verdict",
  description:
    "Evaluate a floor plan project for architectural quality and produce a scored verdict.",
  input_schema: {
    type: "object" as const,
    required: ["dimensions", "reasoning"],
    properties: {
      dimensions: {
        type: "object" as const,
        required: [
          "roomCountMatch",
          "noDuplicateNames",
          "dimensionPlausibility",
          "vastuCompliance",
          "orientationCorrect",
          "connectivity",
          "exteriorWindows",
        ],
        properties: {
          roomCountMatch: { type: "number" as const, description: "1-10: Does the project contain all rooms from the brief?" },
          noDuplicateNames: { type: "number" as const, description: "1-10: Is every room uniquely named?" },
          dimensionPlausibility: { type: "number" as const, description: "1-10: Are room dimensions architecturally reasonable?" },
          vastuCompliance: { type: "number" as const, description: "1-10: If vastu required, check placements. If not, score 8." },
          orientationCorrect: { type: "number" as const, description: "1-10: Is the entrance on the correct facing side?" },
          connectivity: { type: "number" as const, description: "1-10: Can every room be reached via doors?" },
          exteriorWindows: { type: "number" as const, description: "1-10: Do habitable rooms have exterior windows?" },
        },
      },
      reasoning: { type: "string" as const, description: "2-4 sentence assessment." },
    },
  },
};

// ─── Anthropic Client ────────────────────────────────────────────

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}

// ─── Project Summary Builder ─────────────────────────────────────

function summarizeProject(project: FloorPlanProject, brief: ArchitectBrief): string {
  const floor = project.floors[0];
  if (!floor) return "No floors in project.";

  const roomLines = floor.rooms.map((r) => {
    const wMm = r.boundary.points.length >= 3
      ? Math.abs(r.boundary.points[2].x - r.boundary.points[0].x)
      : 0;
    const hMm = r.boundary.points.length >= 3
      ? Math.abs(r.boundary.points[2].y - r.boundary.points[0].y)
      : 0;
    const wFt = (wMm / 304.8).toFixed(1);
    const hFt = (hMm / 304.8).toFixed(1);
    const doors = floor.doors.filter(
      (d) => d.connects_rooms?.includes(r.id),
    ).length;
    const windows = floor.windows.filter((w) => w.wall_id && floor.walls.find(
      (wall) => wall.id === w.wall_id && (wall.left_room_id === r.id || wall.right_room_id === r.id),
    )).length;
    return `  - ${r.name} (${r.type}): ${wFt}×${hFt}ft, area=${r.area_sqm.toFixed(1)}m², doors=${doors}, windows=${windows}`;
  });

  const briefRoomNames = brief.roomList.map((r) => r.name).join(", ");
  const vastuRequired = brief.styleCues.some((s) => s.toLowerCase().includes("vastu"));

  return `FLOOR PLAN SUMMARY:
Plot: ${brief.plotWidthFt}×${brief.plotDepthFt}ft, ${brief.facing}-facing
Vastu required: ${vastuRequired ? "YES" : "NO"}
Expected rooms (from brief): ${briefRoomNames}
Total walls: ${floor.walls.length}, doors: ${floor.doors.length}, windows: ${floor.windows.length}

ACTUAL ROOMS (${floor.rooms.length}):
${roomLines.join("\n")}`;
}

// ─── Score Calculator ────────────────────────────────────────────

const ALL_DIMS: QualityDimension[] = [
  "roomCountMatch",
  "noDuplicateNames",
  "dimensionPlausibility",
  "vastuCompliance",
  "orientationCorrect",
  "connectivity",
  "exteriorWindows",
];

function computeVerdict(
  dimensions: Record<QualityDimension, number>,
  reasoning: string,
): Stage6Output {
  let weightedSum = 0;
  let totalWeight = 0;
  const weakAreas: string[] = [];

  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS) as Array<[QualityDimension, number]>) {
    const score = Math.max(1, Math.min(10, dimensions[dim] ?? 5));
    weightedSum += score * weight;
    totalWeight += weight;
    if (score < 6) weakAreas.push(dim);
  }

  const score = Math.round((weightedSum / totalWeight) * 10);
  const recommendation =
    score >= PASS_THRESHOLD ? ("pass" as const) :
    score >= RETRY_THRESHOLD ? ("retry" as const) :
    ("fail" as const);

  return { verdict: { score, dimensions, reasoning, recommendation, weakAreas } };
}

// ─── Main Entry Point ────────────────────────────────────────────

export async function runStage6QualityGate(
  input: Stage6Input,
  logger?: VIPLogger,
): Promise<{ output: Stage6Output; metrics: Stage6Metrics }> {
  const client = createAnthropicClient();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);

  try {
    const summary = summarizeProject(input.project, input.brief);

    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        system: `You are a senior architectural quality reviewer. Evaluate the floor plan project summary below. Score each dimension 1-10.

Be strict on critical dimensions (roomCountMatch, noDuplicateNames, dimensionPlausibility).
Be moderate on architectural dimensions (vastuCompliance, orientationCorrect).
Be lenient on nice-to-have dimensions (connectivity, exteriorWindows).

${input.brief.styleCues.some((s) => s.toLowerCase().includes("vastu"))
  ? "Vastu IS required. Check: Pooja NE, Master SW, Kitchen SE."
  : "Vastu is NOT required. Score vastuCompliance as 8 (neutral)."}`,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool" as const, name: "produce_quality_verdict" },
        messages: [{
          role: "user",
          content: summary + "\n\nEvaluate this floor plan. Score all 7 dimensions.",
        }],
      },
      { signal: ctrl.signal },
    );

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costUsd = (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000;
    if (logger) logger.logStageCost(6, costUsd);

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== "produce_quality_verdict") {
      throw new Error("Stage 6: Claude did not use the tool. Raw: " + JSON.stringify(response.content).slice(0, 300));
    }

    // ── Validate LLM output against Zod schema ──
    const parsed = Stage6RawOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new Error(
        `Stage 6: LLM returned malformed output: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    const raw = parsed.data;

    const safeDimensions = {} as Record<QualityDimension, number>;
    for (const dim of ALL_DIMS) {
      const val = raw.dimensions[dim as keyof typeof raw.dimensions];
      safeDimensions[dim] = typeof val === "number" ? Math.max(1, Math.min(10, val)) : 5;
    }

    return { output: computeVerdict(safeDimensions, raw.reasoning), metrics: { inputTokens, outputTokens, costUsd } };
  } finally {
    clearTimeout(timer);
  }
}
