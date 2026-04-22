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

import type Anthropic from "@anthropic-ai/sdk";
import type {
  Stage6Input,
  Stage6Output,
  QualityDimension,
} from "./types";
import type { VIPLogger } from "./logger";
import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { ArchitectBrief } from "./types";
import { Stage6RawOutputSchema } from "./schemas";
import { createAnthropicClient } from "./clients";
import { evaluateBedroomPrivacy, evaluateEntranceDoor } from "./quality-evaluators";

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
  adjacencyCompliance: 1.5,
  connectivity: 1.0,
  exteriorWindows: 1.0,
  // Phase 2.4 P0-B: scored locally from FloorPlanProject, not by LLM.
  bedroomPrivacy: 1.0,
  entranceDoor: 1.5,
};

/** LLM-scored dimensions (what the tool_use schema asks for). */
const LLM_DIMS = [
  "roomCountMatch",
  "noDuplicateNames",
  "dimensionPlausibility",
  "vastuCompliance",
  "orientationCorrect",
  "adjacencyCompliance",
  "connectivity",
  "exteriorWindows",
] as const;

/** Locally-scored dimensions (Phase 2.4 P0-B). */
const LOCAL_DIMS = ["bedroomPrivacy", "entranceDoor"] as const;

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
          "adjacencyCompliance",
          "connectivity",
          "exteriorWindows",
        ],
        properties: {
          roomCountMatch: { type: "number" as const, description: "1-10: Does the project contain all rooms from the brief?" },
          noDuplicateNames: {
            type: "number" as const,
            description:
              "1-10: Is every room's NAME (the human-readable label like \"Bedroom 1\", \"Bedroom 2\", \"Master Bedroom\") unique? Do NOT penalize rooms that share the same TYPE TAG (e.g. two rooms with type=\"bedroom\" is FINE — that's a category, not a duplicate name). Only penalize when two rooms have IDENTICAL NAMES. Score 10 if all names distinct; score 1 if ≥ 2 rooms share an exact name.",
          },
          dimensionPlausibility: { type: "number" as const, description: "1-10: Are room dimensions architecturally reasonable?" },
          vastuCompliance: { type: "number" as const, description: "1-10: If vastu required, check placements. If not, score 8." },
          orientationCorrect: { type: "number" as const, description: "1-10: Is the entrance on the correct facing side?" },
          adjacencyCompliance: { type: "number" as const, description: "1-10: Did Stage 5 honor the declared adjacencies? Use the ADJACENCY REPORT when provided (10 if compliancePct≥90, 8 if ≥70, 5 if ≥40, 3 otherwise). If no adjacencies declared, score 8." },
          connectivity: { type: "number" as const, description: "1-10: Can every room be reached via doors?" },
          exteriorWindows: { type: "number" as const, description: "1-10: Do habitable rooms have exterior windows?" },
        },
      },
      reasoning: { type: "string" as const, description: "2-4 sentence assessment." },
    },
  },
};

// ─── Phase 2.11.4 — Direction8 for per-room vastu placement ──────
//
// Stage 6's vastuCompliance scorer previously received no directional
// data — the LLM had to guess placements from dimensions alone and
// scored 4/10 "unverifiable" on the Phase 2.10 E2E. This helper maps a
// room's center (in mm, Y-up SW origin) to a compass octant relative
// to the plot center, so the summary can emit `(type, DIR)` per room
// and the LLM can check NE / SW / SE placements deterministically.

export type Direction8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "CENTER";

const CENTER_RADIUS_FT = 3; // rooms within 3 ft of plot center resolve to CENTER

export function computeDirection8(
  centerMm: { x: number; y: number },
  plotCenterMm: { x: number; y: number },
  centerRadiusMm = CENTER_RADIUS_FT * 304.8,
): Direction8 {
  const dx = centerMm.x - plotCenterMm.x;
  const dy = centerMm.y - plotCenterMm.y;
  // If the room's center sits within centerRadiusMm of the plot center,
  // return "CENTER" — architecturally meaningful for Brahmastan checks.
  if (Math.hypot(dx, dy) <= centerRadiusMm) return "CENTER";
  // atan2: 0 = east, π/2 = north (Y-up). Convert to degrees in [0, 360).
  const rawDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const deg = ((rawDeg % 360) + 360) % 360;
  if (deg < 22.5 || deg >= 337.5) return "E";
  if (deg < 67.5) return "NE";
  if (deg < 112.5) return "N";
  if (deg < 157.5) return "NW";
  if (deg < 202.5) return "W";
  if (deg < 247.5) return "SW";
  if (deg < 292.5) return "S";
  return "SE";
}

/** Centre (x, y) in mm of a Room's boundary polygon (axis-aligned or otherwise). */
function roomCenterMm(room: FloorPlanProject["floors"][number]["rooms"][number]): { x: number; y: number } {
  const pts = room.boundary.points;
  if (pts.length === 0) return { x: 0, y: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// ─── Project Summary Builder ─────────────────────────────────────

export function summarizeProject(project: FloorPlanProject, brief: ArchitectBrief): string {
  const floor = project.floors[0];
  if (!floor) return "No floors in project.";

  // Phase 2.11.4 — plot center in mm (Y-UP, SW origin). Used for per-room
  // Direction8 tagging below.
  const plotCenterMm = {
    x: (brief.plotWidthFt * 304.8) / 2,
    y: (brief.plotDepthFt * 304.8) / 2,
  };
  const vastuRequired = brief.styleCues.some((s) => s.toLowerCase().includes("vastu"));

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
    // Phase 2.11.4 — `dir` lets the vastu scorer check NE/SW/SE rules directly.
    const dir = computeDirection8(roomCenterMm(r), plotCenterMm);
    return `  - ${r.name} (${r.type}, ${dir}): ${wFt}×${hFt}ft, area=${r.area_sqm.toFixed(1)}m², doors=${doors}, windows=${windows}`;
  });

  const briefRoomNames = brief.roomList.map((r) => r.name).join(", ");

  // Phase 2.3: surface the Stage-5 adjacency compliance report so the LLM
  // can score the adjacencyCompliance dimension from objective data instead
  // of guessing. Falls through gracefully when no adjacencies were declared.
  const meta = project.metadata as unknown as Record<string, unknown>;
  const report = meta.adjacency_report as
    | {
        declared: number;
        satisfied: number;
        violated: number;
        unknown: number;
        compliancePct: number;
        checks?: Array<{
          declaration: { a: string; b: string; relationship: string };
          status: string;
          note: string;
        }>;
      }
    | undefined;
  let adjacencyBlock = "";
  if (report && report.declared > 0) {
    const detail = (report.checks ?? [])
      .map(
        (c) =>
          `  - ${c.status.toUpperCase()}: ${c.declaration.a} ↔ ${c.declaration.b} (${c.declaration.relationship}) — ${c.note}`,
      )
      .join("\n");
    adjacencyBlock = `\n\nADJACENCY REPORT (Stage 5 best-effort check):
Declared: ${report.declared}, satisfied: ${report.satisfied}, violated: ${report.violated}, unknown: ${report.unknown}, compliancePct: ${report.compliancePct}
${detail}`;
  } else {
    adjacencyBlock = `\n\nADJACENCY REPORT: no adjacencies declared by Stage 1 — score adjacencyCompliance as 8 (neutral).`;
  }

  // Phase 2.11.4 — emit a vastu placement reference table when vastu is
  // required. Gives the LLM a deterministic scoring basis: compare each
  // room's (type, DIR) tag against the ideal octant instead of guessing.
  const vastuBlock = vastuRequired
    ? `\n\nVASTU PLACEMENT REFERENCE (ideal octants — compare against each room's DIR tag above):
  - Pooja / prayer / mandir → NE (north-east)
  - Master Bedroom → SW (south-west)
  - Kitchen → SE (south-east); N / E acceptable alternative
  - Bathroom / toilet → NW or W (avoid NE, avoid SW)
  - Living Room → N / E / NE (front-facing preferred)
  - Dining → W or E (avoid NE)
  - Study → W or N
  - Entrance / main door → aligned with plot facing (${brief.facing})
Score vastuCompliance by matching each room's DIR tag against the ideal:
  10 = every key vastu-sensitive room (pooja, master bedroom, kitchen) in its ideal octant
  8  = most key rooms ideal, one off by one adjacent octant
  5  = half the key rooms off their ideal octant
  3  = pooja in SW or master in NE (hard vastu violations)
CENTER for any non-circulation room is a Brahmastan violation (score ≤ 3).`
    : "";

  // Phase 2.11.5 — deterministic name-uniqueness stamp. Scan the room
  // NAMES (not types) and emit either "All unique — score noDuplicateNames
  // as 10" or an explicit list of duplicates. This removes ambiguity
  // when the LLM otherwise conflates shared `type` tags with duplicate
  // names (the Phase 2.10 E2E failure mode).
  const nameCounts = new Map<string, number>();
  for (const r of floor.rooms) {
    const key = r.name.trim();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const duplicates = Array.from(nameCounts.entries())
    .filter(([, n]) => n > 1)
    .map(([name, n]) => `"${name}" (appears ${n} times)`);
  const nameUniquenessBlock = duplicates.length === 0
    ? `\nNAME UNIQUENESS: all ${floor.rooms.length} room NAMES are distinct — score noDuplicateNames as 10. Shared TYPE tags (e.g. three rooms typed "bedroom") are NOT duplicates.`
    : `\nNAME UNIQUENESS: the following NAMES appear more than once — score noDuplicateNames ≤ 4: ${duplicates.join(", ")}`;

  return `FLOOR PLAN SUMMARY:
Plot: ${brief.plotWidthFt}×${brief.plotDepthFt}ft, ${brief.facing}-facing
Vastu required: ${vastuRequired ? "YES" : "NO"}
Expected rooms (from brief): ${briefRoomNames}
Total walls: ${floor.walls.length}, doors: ${floor.doors.length}, windows: ${floor.windows.length}

ACTUAL ROOMS (${floor.rooms.length}):
${roomLines.join("\n")}${nameUniquenessBlock}${adjacencyBlock}${vastuBlock}`;
}

// ─── Score Calculator ────────────────────────────────────────────

const ALL_DIMS: QualityDimension[] = [
  "roomCountMatch",
  "noDuplicateNames",
  "dimensionPlausibility",
  "vastuCompliance",
  "orientationCorrect",
  "adjacencyCompliance",
  "connectivity",
  "exteriorWindows",
  "bedroomPrivacy",
  "entranceDoor",
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

NAME vs TYPE CLARIFICATION (Phase 2.11.5) — critical for noDuplicateNames:
- A room NAME is the human-readable label shown inside parentheses: "Master Bedroom", "Bedroom 2", "Bedroom 3", "Living Room".
- A room TYPE is the category tag after the name: (master_bedroom), (bedroom), (bedroom), (living). Multiple rooms legitimately SHARE a type — three bedrooms all typed "bedroom" is expected and correct.
- noDuplicateNames scores whether NAMES are unique. Bedroom 1 + Bedroom 2 + Bedroom 3 all have DIFFERENT names → noDuplicateNames = 10. Only score low when two or more rooms share an EXACT name string ("Bedroom" appearing twice, for example).

${input.brief.styleCues.some((s) => s.toLowerCase().includes("vastu"))
  ? "Vastu IS required. Use the VASTU PLACEMENT REFERENCE block at the end of the summary (if present) and each room's DIR tag to score vastuCompliance deterministically."
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
    for (const dim of LLM_DIMS) {
      const val = raw.dimensions[dim as keyof typeof raw.dimensions];
      safeDimensions[dim] = typeof val === "number" ? Math.max(1, Math.min(10, val)) : 5;
    }

    // Phase 2.4 P0-B: deterministic evaluators for bedroomPrivacy + entranceDoor.
    const privacyResult = evaluateBedroomPrivacy(input.project);
    const entranceResult = evaluateEntranceDoor(input.project, input.brief);
    safeDimensions.bedroomPrivacy = Math.max(1, Math.min(10, privacyResult.score));
    safeDimensions.entranceDoor = Math.max(1, Math.min(10, entranceResult.score));

    const mergedReasoning = `${raw.reasoning} | bedroomPrivacy: ${privacyResult.reason} | entranceDoor: ${entranceResult.reason}`;

    // LOCAL_DIMS is the intentional inclusion set — retained for callers/tests.
    void LOCAL_DIMS;

    return { output: computeVerdict(safeDimensions, mergedReasoning), metrics: { inputTokens, outputTokens, costUsd } };
  } finally {
    clearTimeout(timer);
  }
}
