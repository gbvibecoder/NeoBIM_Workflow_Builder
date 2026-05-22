/**
 * Vision Inspector (TR-032, Phase Beta 2).
 *
 * Sends two rendered PNGs (top-view + isometric) of a generated IFC to
 * Opus 4.7 with vision, alongside the BriefSpec. The model inspects the
 * renders against the brief and returns a structured `VisionReport` with
 * a quality score, pass/fail, and itemised issues.
 *
 * The caller (tr-032.ts handler) is responsible for obtaining the two
 * base64-encoded PNGs — this keeps the module testable without HTTP mocks.
 *
 * Cost cap: $0.20 per inspection. Timeout: 90 s per Opus call.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { visionReportSchema } from "./types";
import type { BriefSpec, VisionReport } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────

const INSPECTOR_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;

/**
 * Inspect timeout. Phase ε.5 (forensic-audit FIX 5): tightened from
 * 90s → 75s. Anthropic vision calls typically return in 20-60s; 75s
 * is still well above the median. Tighter cap defends the iteration's
 * 750s wall-clock budget — combined with the render-previews 45s
 * cap, vision adds at most ~120s post-finalize per iteration (vs
 * 150s pre-ε.5).
 */
const DEFAULT_TIMEOUT_MS = 75_000;
const DEFAULT_MAX_COST_USD = 0.20;
const MAX_TOKENS_PER_CALL = 4_000;

// ─── Prompt ─────────────────────────────────────────────────────────────

// Inline const — canonical .md copy at `./vision-inspector-prompt.md`.
// MUST stay byte-equal to that file; a vitest regression test enforces
// parity at CI (same pattern as DECOMPOSER_PROMPT_TEMPLATE in
// item-decomposer.ts).
//
// Why inline: Next.js Turbopack does NOT auto-bundle .md files referenced
// via __dirname, so fs.readFileSync fails during `next build`.
export const VISION_INSPECTOR_PROMPT_TEMPLATE: string = `You are a senior IFC reviewer inspecting BIM models against architectural briefs.

You receive:
- A briefSpec describing what the building SHOULD contain
- A top-view rendered PNG of the actual IFC
- An isometric rendered PNG of the actual IFC

Inspect the rendered IFC against the brief. Return ONLY a JSON object. No prose, no markdown.

OUTPUT JSON:
{
  "quality_score": 0-100,
  "pass": true if quality_score >= 70,
  "issues": [
    {
      "severity": "low" | "med" | "high",
      "type": "geometry" | "positioning" | "proportions" | "missing" | "collapsed" | "material" | "other",
      "description": "one sentence",
      "affected_element": "element id if known",
      "fixable": true | false,
      "recommended_patch_type": "force_parts" | "add_position" | "fix_size" | "add_trim" | "increase_decomposition" | "manual_review"
    }
  ],
  "summary": "one-sentence overall assessment",
  "inspected_at": "ISO 8601 timestamp"
}

ISSUE CATEGORIES:
- geometry: wall gaps, missing floor/roof, wrong footprint
- positioning: items overlap walls, items outside room, wrong placement
- proportions: dimensions don't match brief
- missing: furniture mentioned in brief not visible
- collapsed: composite item appears as single box (e.g. tripod = 1 box)
- material: wrong material appearance
- other: anything else

SEVERITY:
- high: blocks usability (missing element, door in wrong wall)
- med: visual quality (collapsed composite, wrong proportions)
- low: minor (small gap, slightly off positioning)

FIXABILITY GUIDE — for each issue also emit:
- fixable: true unless the issue requires a fundamental brief change (wrong archetype, impossible layout)
- recommended_patch_type:
  * force_parts — composite rendered as single box (collapsed type)
  * add_position — item in wrong place (overlaps wall, outside room)
  * fix_size — element dimensions clearly wrong vs brief
  * add_trim — missing skirting or hardware
  * increase_decomposition — item has too few parts (thin decomposition)
  * manual_review — issue is brief-level (wrong archetype, contradictory requirements)

SCORING:
- 90-100: all requirements met, no issues
- 70-89: minor issues only
- 50-69: medium issues, warrant rebuild
- 0-49: major issues, unusable

Now inspect the input below.`;

// ─── Types ──────────────────────────────────────────────────────────────

export interface InspectorMetrics {
  opus_calls: number;
  cost_usd: number;
  wall_time_ms: number;
}

export interface InspectorResult {
  report: VisionReport;
  metrics: InspectorMetrics;
}

export interface InspectorOptions {
  /** Override the Anthropic client factory (for tests). */
  clientFactory?: () => Anthropic;
  /** Override max cost in USD. Default 0.20. */
  maxCostUsd?: number;
  /** Override timeout in ms. Default 90_000. */
  timeout?: number;
}

// ─── Anthropic client ───────────────────────────────────────────────────

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}

function computeCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * OPUS_INPUT_COST_PER_MILLION +
      outputTokens * OPUS_OUTPUT_COST_PER_MILLION) /
    1_000_000
  );
}

// ─── Single inspection call ─────────────────────────────────────────────

async function callInspector(
  client: Anthropic,
  briefSpec: BriefSpec | null,
  topPngBase64: string,
  isoPngBase64: string,
  isRetry: boolean,
  timeoutMs: number,
): Promise<{
  report: VisionReport | null;
  inputTokens: number;
  outputTokens: number;
}> {
  const briefText = isRetry
    ? "BriefSpec:\n" +
      JSON.stringify(briefSpec) +
      "\n\nRETURN ONLY A JSON OBJECT. First character must be '{'. No prose. No markdown."
    : "BriefSpec:\n" + JSON.stringify(briefSpec);

  const stream = client.messages.stream(
    {
      model: INSPECTOR_MODEL,
      max_tokens: MAX_TOKENS_PER_CALL,
      system: VISION_INSPECTOR_PROMPT_TEMPLATE,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: briefText },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: topPngBase64,
              },
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: isoPngBase64,
              },
            },
          ],
        },
      ],
    },
    { signal: AbortSignal.timeout(timeoutMs) },
  );
  const message = await stream.finalMessage();

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  // Extract text content
  const textBlocks = message.content.filter(
    (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
  );
  const raw = textBlocks.map((b) => b.text).join("").trim();

  // Parse the JSON object from the response
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try to extract JSON object from surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { report: null, inputTokens, outputTokens };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { report: null, inputTokens, outputTokens };
    }
  }

  // Validate against schema
  const result = visionReportSchema.safeParse(parsed);
  if (!result.success) return { report: null, inputTokens, outputTokens };

  return { report: result.data, inputTokens, outputTokens };
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * Inspect a generated IFC against its BriefSpec using Opus 4.7 vision.
 *
 * @param briefSpec  The original brief specification the IFC was built from.
 * @param topPngBase64  Base64-encoded top-view render of the IFC (no data URI prefix).
 * @param isoPngBase64  Base64-encoded isometric render of the IFC (no data URI prefix).
 * @param options  Optional overrides for client, cost cap, and timeout.
 * @returns The structured VisionReport and cost/timing metrics.
 */
export async function inspectIFC(
  briefSpec: BriefSpec | null,
  topPngBase64: string,
  isoPngBase64: string,
  options?: InspectorOptions,
): Promise<InspectorResult> {
  const startedAt = Date.now();
  const maxCost = options?.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS;

  const metrics: InspectorMetrics = {
    opus_calls: 0,
    cost_usd: 0,
    wall_time_ms: 0,
  };

  let client: Anthropic;
  try {
    client = options?.clientFactory
      ? options.clientFactory()
      : createAnthropicClient();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[vision-inspector] Failed to create Anthropic client:",
      err instanceof Error ? err.message : err,
    );
    metrics.wall_time_ms = Date.now() - startedAt;
    return {
      report: {
        quality_score: 0,
        pass: false,
        issues: [
          {
            severity: "high",
            type: "other",
            description: "Vision inspector unavailable: Anthropic client creation failed.",
            fixable: false,
          },
        ],
        summary: "Inspection could not be performed.",
        inspected_at: new Date().toISOString(),
      },
      metrics,
    };
  }

  // First attempt
  let runningCost = 0;
  metrics.opus_calls++;
  try {
    const result = await callInspector(
      client,
      briefSpec,
      topPngBase64,
      isoPngBase64,
      false,
      timeoutMs,
    );
    runningCost += computeCost(result.inputTokens, result.outputTokens);

    if (result.report) {
      metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
      metrics.wall_time_ms = Date.now() - startedAt;
      return { report: result.report, metrics };
    }

    // Check cost guardrail before retry
    if (runningCost > maxCost) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vision-inspector] Cost guardrail hit: $${runningCost.toFixed(4)} > $${maxCost}. Skipping retry.`,
      );
      metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
      metrics.wall_time_ms = Date.now() - startedAt;
      return {
        report: {
          quality_score: 0,
          pass: false,
          issues: [
            {
              severity: "high",
              type: "other",
              description: "Vision inspector failed to produce valid JSON and cost guardrail prevents retry.",
              fixable: false,
            },
          ],
          summary: "Inspection failed.",
          inspected_at: new Date().toISOString(),
        },
        metrics,
      };
    }

    // Retry once with stricter instruction
    // eslint-disable-next-line no-console
    console.warn("[vision-inspector] First attempt produced invalid JSON. Retrying.");
    metrics.opus_calls++;
    const retry = await callInspector(
      client,
      briefSpec,
      topPngBase64,
      isoPngBase64,
      true,
      timeoutMs,
    );
    runningCost += computeCost(retry.inputTokens, retry.outputTokens);
    metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
    metrics.wall_time_ms = Date.now() - startedAt;

    if (retry.report) {
      return { report: retry.report, metrics };
    }

    // Both attempts failed
    // eslint-disable-next-line no-console
    console.warn("[vision-inspector] Both attempts failed to produce valid JSON.");
    return {
      report: {
        quality_score: 0,
        pass: false,
        issues: [
          {
            severity: "high",
            type: "other",
            description: "Vision inspector failed to produce valid JSON after retry.",
            fixable: false,
          },
        ],
        summary: "Inspection failed after two attempts.",
        inspected_at: new Date().toISOString(),
      },
      metrics,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[vision-inspector] Error during inspection: ${errMsg}`);
    metrics.cost_usd = Math.round(runningCost * 1_000_000) / 1_000_000;
    metrics.wall_time_ms = Date.now() - startedAt;
    return {
      report: {
        quality_score: 0,
        pass: false,
        issues: [
          {
            severity: "high",
            type: "other",
            description: `Vision inspection error: ${errMsg.slice(0, 200)}`,
            fixable: false,
          },
        ],
        summary: "Inspection failed due to an error.",
        inspected_at: new Date().toISOString(),
      },
      metrics,
    };
  }
}
