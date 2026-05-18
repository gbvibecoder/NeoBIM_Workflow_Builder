/**
 * Archetype classifier (Node 3) — standalone Sonnet 4.6 call.
 *
 * Runs BEFORE the enricher to classify the brief into one of the
 * supported archetypes. The classified archetype is passed as a hint
 * to the enricher's system prompt.
 *
 * Uses claude-sonnet-4-6 (cheaper than Opus, classification is easy).
 */

import Anthropic from "@anthropic-ai/sdk";

import type { archetypeSchema } from "./types";
import { z } from "zod";

export type Archetype = z.infer<typeof import("./types").archetypeSchema>;

export interface ClassificationResult {
  archetype: string;
  confidence: number;
  reasoning: string;
  costUsd: number;
  durationMs: number;
}

const CLASSIFIER_MODEL = "claude-sonnet-4-6";
const SONNET_INPUT_COST_PER_MILLION = 3;
const SONNET_OUTPUT_COST_PER_MILLION = 15;
const CLASSIFIER_MAX_TOKENS = 512;
const CLASSIFIER_TIMEOUT_MS = 15_000;
const TOOL_NAME = "classify_brief";

const CLASSIFIER_SYSTEM = `You are an AEC (Architecture Engineering Construction) brief classifier. Given a free-text architectural brief, classify it into exactly one archetype.

ARCHETYPES:
- "office" — corporate/commercial offices, co-working spaces, open-plan offices
- "residential_2bhk" — Indian 2BHK apartments (2 bedrooms, hall, kitchen)
- "residential_3bhk" — Indian 3BHK apartments (3 bedrooms, hall, kitchen)
- "gym" — fitness centers, gyms, yoga studios, sports facilities
- "exhibition" — trade show booths, exhibition stands, showrooms
- "retail" — shops, stores, boutiques, showrooms for sale
- "restaurant" — restaurants, cafes, food courts, bars
- "classroom" — schools, classrooms, training rooms, lecture halls
- "other" — anything that doesn't fit the above

Call the ${TOOL_NAME} tool with your classification. Be decisive — pick the BEST match even if the brief is ambiguous.`;

const CLASSIFY_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    archetype: {
      type: "string" as const,
      enum: [
        "office", "residential_2bhk", "residential_3bhk", "gym",
        "exhibition", "retail", "restaurant", "classroom", "other",
      ],
    },
    confidence: {
      type: "number" as const,
      minimum: 0,
      maximum: 1,
      description: "Confidence score 0-1. Use >= 0.8 for clear matches.",
    },
    reasoning: {
      type: "string" as const,
      description: "One sentence explaining the classification.",
    },
  },
  required: ["archetype", "confidence", "reasoning"] as string[],
};

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}

/**
 * Classify a free-text brief into an archetype using Sonnet 4.6.
 *
 * If confidence < 0.6, returns archetype = "other" so the caller
 * falls back to the agent loop for ambiguous briefs.
 */
export async function classifyBrief(brief: string): Promise<ClassificationResult> {
  const startedAt = Date.now();

  let client: Anthropic;
  try {
    client = createAnthropicClient();
  } catch {
    return {
      archetype: "other",
      confidence: 0,
      reasoning: "API key not configured",
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const stream = client.messages.stream(
      {
        model: CLASSIFIER_MODEL,
        max_tokens: CLASSIFIER_MAX_TOKENS,
        system: CLASSIFIER_SYSTEM,
        tools: [
          {
            name: TOOL_NAME,
            description: "Submit the archetype classification.",
            input_schema: CLASSIFY_TOOL_SCHEMA as Anthropic.Tool["input_schema"],
          },
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          {
            role: "user",
            content: `Classify this architectural brief:\n\n${brief}`,
          },
        ],
      },
      { signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS) },
    );

    const message = await stream.finalMessage();
    const costUsd = (
      message.usage.input_tokens * SONNET_INPUT_COST_PER_MILLION +
      message.usage.output_tokens * SONNET_OUTPUT_COST_PER_MILLION
    ) / 1_000_000;

    const toolUse = message.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );

    if (!toolUse) {
      return {
        archetype: "other",
        confidence: 0,
        reasoning: "No tool use in response",
        costUsd,
        durationMs: Date.now() - startedAt,
      };
    }

    const input = toolUse.input as {
      archetype?: string;
      confidence?: number;
      reasoning?: string;
    };

    let archetype = String(input.archetype ?? "other");
    const confidence = Number(input.confidence ?? 0);
    const reasoning = String(input.reasoning ?? "");

    // Low confidence → force "other" for agent-loop fallback
    if (confidence < 0.6) {
      archetype = "other";
    }

    return {
      archetype,
      confidence,
      reasoning,
      costUsd,
      durationMs: Date.now() - startedAt,
    };
  } catch {
    return {
      archetype: "other",
      confidence: 0,
      reasoning: "Classification failed",
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}
