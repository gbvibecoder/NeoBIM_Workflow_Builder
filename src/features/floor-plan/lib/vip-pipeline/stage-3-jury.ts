/**
 * Stage 3: Extraction Readiness Jury
 *
 * Claude Sonnet 4.6 Vision evaluates the GPT Image 1.5 floor plan
 * for extraction-readiness: label legibility, room count, wall
 * completeness, etc. Returns PASS / RETRY / FAIL verdict.
 *
 * Single-image evaluation (GPT only). Imagen passes through
 * untouched for rendering use in Phase 1.10.
 *
 * Planned implementation: Phase 1.6
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Stage3Input, Stage3Output, JuryDimension } from "./types";
import type { VIPLogger } from "./logger";
import { Stage3RawOutputSchema } from "./schemas";
import { createAnthropicClient } from "./clients";

// ─── Constants ───────────────────────────────────────────────────

const INPUT_COST_PER_M = 3;
const OUTPUT_COST_PER_M = 15;
const API_TIMEOUT_MS = 60_000;
const MODEL = "claude-sonnet-4-6";

const DIMENSION_WEIGHTS: Record<JuryDimension, number> = {
  roomCountMatch: 2.0,
  labelLegibility: 2.0,
  noDuplicateLabels: 2.0,
  extractability: 2.0,
  orientation: 1.5,
  vastuCompliance: 1.5,
  wallCompleteness: 1.0,
  proportionalHierarchy: 1.0,
};

const PASS_THRESHOLD = 70;
const RETRY_THRESHOLD = 50;

// ─── Public Types ────────────────────────────────────────────────

export interface Stage3Metrics {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ─── Tool Schema ─────────────────────────────────────────────────

const TOOL_SCHEMA: Anthropic.Tool = {
  name: "produce_jury_verdict",
  description:
    "Evaluate a floor plan image for extraction-readiness and produce a scored verdict.",
  input_schema: {
    type: "object" as const,
    required: ["dimensions", "reasoning"],
    properties: {
      dimensions: {
        type: "object" as const,
        required: [
          "roomCountMatch",
          "labelLegibility",
          "noDuplicateLabels",
          "orientation",
          "vastuCompliance",
          "wallCompleteness",
          "proportionalHierarchy",
          "extractability",
        ],
        properties: {
          roomCountMatch: {
            type: "number" as const,
            description:
              "1-10: Does the image contain all rooms from the brief?",
          },
          labelLegibility: {
            type: "number" as const,
            description:
              "1-10: Can all room labels be read clearly without typos?",
          },
          noDuplicateLabels: {
            type: "number" as const,
            description:
              "1-10: Is each room labeled exactly once (no duplicates)?",
          },
          orientation: {
            type: "number" as const,
            description:
              "1-10: Is the entrance/porch on the correct facing side?",
          },
          vastuCompliance: {
            type: "number" as const,
            description:
              "1-10: If vastu required, is pooja NE, master SW, kitchen SE? If not required, score 8.",
          },
          wallCompleteness: {
            type: "number" as const,
            description:
              "1-10: Are exterior walls complete with no obvious gaps?",
          },
          proportionalHierarchy: {
            type: "number" as const,
            description:
              "1-10: Is master bedroom visually larger than other bedrooms?",
          },
          extractability: {
            type: "number" as const,
            description:
              "1-10: Could a vision model extract accurate room rectangles from this image?",
          },
        },
      },
      reasoning: {
        type: "string" as const,
        description:
          "2-4 sentence explanation of the overall assessment.",
      },
    },
  },
};

// ─── Score Calculator ────────────────────────────────────────────

const ALL_DIMS: JuryDimension[] = [
  "roomCountMatch",
  "labelLegibility",
  "noDuplicateLabels",
  "orientation",
  "vastuCompliance",
  "wallCompleteness",
  "proportionalHierarchy",
  "extractability",
];

function computeVerdict(
  dimensions: Record<JuryDimension, number>,
  reasoning: string,
): Stage3Output {
  let weightedSum = 0;
  let totalWeight = 0;
  const weakAreas: string[] = [];

  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS) as Array<
    [JuryDimension, number]
  >) {
    const score = Math.max(1, Math.min(10, dimensions[dim] ?? 5));
    weightedSum += score * weight;
    totalWeight += weight;
    if (score < 6) weakAreas.push(dim);
  }

  const score = Math.round((weightedSum / totalWeight) * 10);
  const recommendation =
    score >= PASS_THRESHOLD
      ? ("pass" as const)
      : score >= RETRY_THRESHOLD
        ? ("retry" as const)
        : ("fail" as const);

  return {
    verdict: { score, dimensions, reasoning, recommendation, weakAreas },
  };
}

// ─── System Prompt ───────────────────────────────────────────────

function buildSystemPrompt(brief: Stage3Input["brief"]): string {
  const roomNames = brief.roomList.map((r) => r.name).join(", ");
  const vastuNote = brief.styleCues.some((s) =>
    s.toLowerCase().includes("vastu"),
  )
    ? "Vastu compliance IS required. Check: pooja NE, master SW, kitchen SE."
    : "Vastu compliance is NOT required. Score vastuCompliance as 8 (neutral).";

  return `You are a senior architectural reviewer evaluating a 2D floor plan image for extraction-readiness.

The floor plan was generated for this brief:
- Plot: ${brief.plotWidthFt}ft × ${brief.plotDepthFt}ft, ${brief.facing}-facing entrance
- Rooms expected: ${roomNames}
- ${vastuNote}

Score each dimension 1-10 where:
  1-3 = poor (critical issues)
  4-5 = below average (notable problems)
  6-7 = acceptable (minor issues)
  8-9 = good (meets expectations)
  10  = excellent (exceeds expectations)

Be STRICT on extraction-critical dimensions (roomCountMatch, labelLegibility, noDuplicateLabels, extractability).
Be MODERATE on architectural dimensions (orientation, vastuCompliance, wallCompleteness, proportionalHierarchy).

Look carefully at the image. Count actual rooms. Read each label. Check for duplicates.`;
}

// ─── Main Entry Point ────────────────────────────────────────────

export async function runStage3ExtractionJury(
  input: Stage3Input,
  logger?: VIPLogger,
): Promise<{ output: Stage3Output; metrics: Stage3Metrics }> {
  const client = createAnthropicClient();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        system: buildSystemPrompt(input.brief),
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool" as const, name: "produce_jury_verdict" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: input.gptImage.base64!,
                },
              },
              {
                type: "text",
                text: "Evaluate this floor plan image for extraction-readiness. Score all 8 dimensions.",
              },
            ],
          },
        ],
      },
      { signal: ctrl.signal },
    );

    // ── Cost tracking ──
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costUsd =
      (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) /
      1_000_000;

    if (logger) logger.logStageCost(3, costUsd);

    // ── Extract tool_use block ──
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(
        "Stage 3: Claude did not use the tool. Raw: " +
          JSON.stringify(response.content).slice(0, 300),
      );
    }
    if (toolUse.name !== "produce_jury_verdict") {
      throw new Error(
        `Stage 3: Claude called wrong tool: "${toolUse.name}"`,
      );
    }

    // ── Validate LLM output against Zod schema ──
    const parsed = Stage3RawOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new Error(
        `Stage 3: LLM returned malformed output: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    const raw = parsed.data;

    // ── Clamp dimensions to 1-10, default missing to 5 ──
    const safeDimensions = {} as Record<JuryDimension, number>;
    for (const dim of ALL_DIMS) {
      const val = raw.dimensions[dim as keyof typeof raw.dimensions];
      safeDimensions[dim] =
        typeof val === "number" ? Math.max(1, Math.min(10, val)) : 5;
    }

    const output = computeVerdict(safeDimensions, raw.reasoning);

    return {
      output,
      metrics: { inputTokens, outputTokens, costUsd },
    };
  } finally {
    clearTimeout(timer);
  }
}
