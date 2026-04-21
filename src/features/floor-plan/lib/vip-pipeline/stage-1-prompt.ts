/**
 * Stage 1: Prompt Intelligence
 *
 * Claude Sonnet 4.6 interprets the user's prompt and produces:
 *   1. ArchitectBrief — structured architectural interpretation
 *   2. imagePrompts[] — 1 prompt for GPT Image 1.5 (Imagen removed in Phase 2.0a)
 *
 * Uses Anthropic tool_use for guaranteed structured JSON output.
 * Reads ANTHROPIC_API_KEY from process.env (matches codebase pattern).
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Stage1Input, Stage1Output } from "./types";
import type { VIPLogger } from "./logger";
import { ARCHITECT_BRIEF_SYSTEM_PROMPT } from "./prompts/architect-brief";
import { Stage1OutputSchema } from "./schemas";
import { createAnthropicClient } from "./clients";

// ─── Cost Constants (Claude Sonnet 4.6) ──────────────────────────

const INPUT_COST_PER_M = 3; // $3 per million input tokens
const OUTPUT_COST_PER_M = 15; // $15 per million output tokens
const API_TIMEOUT_MS = 45_000;
const MODEL = "claude-sonnet-4-6";

// ─── Public Types ────────────────────────────────────────────────

export interface Stage1Metrics {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ─── Tool Schema (matches Stage1Output TypeScript type) ──────────

const TOOL_SCHEMA: Anthropic.Tool = {
  name: "produce_architect_brief",
  description:
    "Produce an architect brief and exactly 1 image generation prompt for a floor plan request. " +
    "Call this tool with the complete brief and the image prompt for gpt-image-1.5.",
  input_schema: {
    type: "object" as const,
    required: ["brief", "imagePrompts"],
    properties: {
      brief: {
        type: "object" as const,
        required: [
          "projectType",
          "roomList",
          "plotWidthFt",
          "plotDepthFt",
          "facing",
          "styleCues",
          "constraints",
        ],
        properties: {
          projectType: {
            type: "string" as const,
            description:
              "Building typology: residential, villa, apartment, bungalow, duplex, row-house, courtyard, or NOT_FLOOR_PLAN",
          },
          roomList: {
            type: "array" as const,
            items: {
              type: "object" as const,
              required: ["name", "type", "approxAreaSqft"],
              properties: {
                name: { type: "string" as const },
                type: { type: "string" as const },
                approxAreaSqft: {
                  type: "number" as const,
                  description: "Approximate area in square feet. ALWAYS provide this.",
                },
              },
            },
          },
          plotWidthFt: { type: "number" as const },
          plotDepthFt: { type: "number" as const },
          facing: { type: "string" as const },
          styleCues: {
            type: "array" as const,
            items: { type: "string" as const },
          },
          constraints: {
            type: "array" as const,
            items: { type: "string" as const },
            description:
              "Hard constraints and inferred assumptions. Prefix inferred items with 'inferred:', vastu with 'vastu:', warnings with 'warning:'.",
          },
          adjacencies: {
            type: "array" as const,
            description:
              "Phase 2.3: declared room-to-room relationships Stage 5 will honor and Stage 6 will score. Default to [] if none relevant.",
            items: {
              type: "object" as const,
              required: ["a", "b", "relationship"],
              properties: {
                a: { type: "string" as const, description: "First room name (must match a roomList entry)" },
                b: { type: "string" as const, description: "Second room name (must match a roomList entry)" },
                relationship: {
                  type: "string" as const,
                  enum: ["attached", "adjacent", "direct-access", "connected"],
                  description:
                    "attached = share wall + internal door from a; adjacent = share wall either side; direct-access = b's door opens into a; connected = reachable via corridor.",
                },
                reason: { type: "string" as const, description: "Optional short rationale." },
              },
            },
          },
        },
      },
      imagePrompts: {
        type: "array" as const,
        minItems: 1,
        maxItems: 1,
        items: {
          type: "object" as const,
          required: ["model", "prompt", "styleGuide"],
          properties: {
            model: { type: "string" as const },
            prompt: { type: "string" as const },
            negativePrompt: { type: "string" as const },
            styleGuide: { type: "string" as const },
          },
        },
        description: "Exactly 1 prompt for gpt-image-1.5.",
      },
    },
  },
};

// ─── User Message Builder ────────────────────────────────────────

function buildUserMessage(input: Stage1Input): string {
  const { prompt, parsedConstraints: pc } = input;
  const lines: string[] = [];

  lines.push(`USER PROMPT: "${prompt}"`);
  lines.push("");

  // Plot
  const w = pc.plot.width_ft;
  const d = pc.plot.depth_ft;
  const f = pc.plot.facing;
  if (w && d) {
    lines.push(`PARSED PLOT: ${w}ft × ${d}ft${f ? `, ${f}-facing` : ""}`);
  } else {
    lines.push(`PARSED PLOT: dimensions not specified${f ? `, ${f}-facing` : ""}`);
  }
  if (pc.plot.total_built_up_sqft) {
    lines.push(`BUILT-UP AREA: ${pc.plot.total_built_up_sqft} sqft`);
  }

  // Rooms
  if (pc.rooms.length > 0) {
    lines.push("");
    lines.push(`PARSED ROOMS (${pc.rooms.length}):`);
    for (const r of pc.rooms) {
      const dims =
        r.dim_width_ft && r.dim_depth_ft
          ? `${r.dim_width_ft}×${r.dim_depth_ft}ft`
          : "auto-size";
      const pos = r.position_direction ? ` @ ${r.position_direction}` : "";
      const flags: string[] = [];
      if (r.is_wet) flags.push("wet");
      if (r.is_sacred) flags.push("sacred");
      if (r.attached_to_room_id) flags.push(`attached:${r.attached_to_room_id}`);
      const fStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      lines.push(`  - ${r.name} (${r.function}) ${dims}${pos}${fStr}`);
    }
  }

  // Adjacency
  if (pc.adjacency_pairs.length > 0) {
    lines.push("");
    lines.push("ADJACENCY:");
    for (const a of pc.adjacency_pairs) {
      const dir = a.direction ? ` (${a.direction})` : "";
      lines.push(`  - ${a.room_a_id} ↔ ${a.room_b_id}: ${a.relationship}${dir}`);
    }
  }

  // Vastu
  if (pc.vastu_required) {
    lines.push("");
    lines.push("VASTU COMPLIANCE: Required");
  }

  // Special features
  if (pc.special_features.length > 0) {
    lines.push("");
    lines.push(
      `SPECIAL FEATURES: ${pc.special_features.map((sf) => sf.feature).join(", ")}`,
    );
  }

  lines.push("");
  lines.push(
    "Produce the architect brief and exactly 1 image generation prompt " +
      "for gpt-image-1.5.",
  );

  return lines.join("\n");
}

// ─── Main Entry Point ────────────────────────────────────────────

export async function runStage1PromptIntelligence(
  input: Stage1Input,
  logger?: VIPLogger,
): Promise<{ output: Stage1Output; metrics: Stage1Metrics }> {
  const client = createAnthropicClient();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        temperature: 0.2,
        system: ARCHITECT_BRIEF_SYSTEM_PROMPT,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool" as const, name: "produce_architect_brief" },
        messages: [{ role: "user", content: buildUserMessage(input) }],
      },
      { signal: ctrl.signal },
    );

    // ── Cost tracking ──
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costUsd =
      (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) /
      1_000_000;

    if (logger) logger.logStageCost(1, costUsd);

    // ── Extract tool_use block ──
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(
        "Stage 1: Claude did not use the tool. Raw response: " +
          JSON.stringify(response.content).slice(0, 300),
      );
    }
    if (toolUse.name !== "produce_architect_brief") {
      throw new Error(
        `Stage 1: Claude called wrong tool: "${toolUse.name}"`,
      );
    }

    // ── Validate LLM output against Zod schema ──
    const parsed = Stage1OutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new Error(
        `Stage 1: LLM returned malformed output: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    const output: Stage1Output = parsed.data;

    // ── Post-call validation ──
    if (output.brief.projectType === "NOT_FLOOR_PLAN") {
      throw new Error(
        `Stage 1: prompt is not a floor plan request: "${input.prompt.slice(0, 80)}"`,
      );
    }
    if (output.brief.roomList.length === 0) {
      throw new Error("Stage 1: Claude produced empty roomList");
    }
    if (output.imagePrompts.length !== 1) {
      throw new Error(
        `Stage 1: expected exactly 1 image prompt, got ${output.imagePrompts.length}`,
      );
    }

    return {
      output,
      metrics: { inputTokens, outputTokens, costUsd },
    };
  } finally {
    clearTimeout(timer);
  }
}
