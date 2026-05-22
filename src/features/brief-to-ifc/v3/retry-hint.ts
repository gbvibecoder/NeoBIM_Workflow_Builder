/**
 * Retry Hint — Phase gamma.1 replacement for Spec Patcher.
 *
 * Generates plain-English feedback for the agent on iteration 2+.
 * Instead of JSON patches applied to the spec, we give the agent a
 * colleague's note in natural language. The agent reads it in its
 * "PREVIOUS ITERATION FEEDBACK" section and addresses each point.
 *
 * @module
 */

import Anthropic from "@anthropic-ai/sdk";
import type { VerifierReport, VisionReport } from "./types";
import { QUALITY_THRESHOLD, MAX_ITERATIONS } from "./constants";

// ─── Constants ──────────────────────────────────────────────────────

const HINT_MODEL = "claude-sonnet-4-6";
const HINT_MAX_TOKENS = 1_500;
const HINT_TIMEOUT_MS = 30_000;
const SONNET_INPUT_COST_PER_MILLION = 3;
const SONNET_OUTPUT_COST_PER_MILLION = 15;

// ─── Prompt ─────────────────────────────────────────────────────────

// Inline const — canonical .md copy at `./retry-hint-prompt.md`.
export const RETRY_HINT_PROMPT_TEMPLATE = `You are reviewing an IFC build that an architect just produced.
Quality came back at {{score}}/100. The architect will rebuild,
informed by your feedback.

Below are:
1. The original brief
2. Hard Verifier mismatches (deterministic checks)
3. Vision Inspector findings (Opus reviewed the rendered IFC)

Write a 200-400 word feedback note to the architect, in plain
English. No JSON. No patches. Just a colleague's note.

Structure:
  - Acknowledge what worked (1-2 sentences)
  - List specific issues with concrete fixes (3-7 bullets)
  - Encourage focus areas for the rebuild (1-2 sentences)

Examples of good feedback:
  "The cutting table came back as a single block. The brief
   calls for an oak top with a green felt covering — that's
   a parent IfcFurnishingElement with at least 2 child parts.
   On rebuild, add the green felt as an IfcCovering placed on
   top of the table surface."

  "The mannequin shows as a vertical cylinder. A mannequin
   on a tripod has at least 5 parts: torso form, neck, head
   form, pole, base. Build them as IfcRelAggregates children
   of the mannequin parent."

Avoid:
  - Generic statements like "improve quality"
  - JSON or schema references
  - Listing patch types

Be specific. Be technical. Be encouraging.`;

// ─── Types ──────────────────────────────────────────────────────────

export interface GenerateRetryHintOptions {
  brief: string;
  iteration: number;
  previousIfcUrl: string;
  verifierReport: VerifierReport;
  visionReport: VisionReport;
  qualityScore: number;
  /** Anthropic client factory for testing. */
  clientFactory?: () => Anthropic;
  timeoutMs?: number;
}

export interface RetryHintResult {
  hint: string;
  cost_usd: number;
  shouldIterate: boolean;
}

// ─── Client factory ─────────────────────────────────────────────────

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}

// ─── Main ───────────────────────────────────────────────────────────

/**
 * Generate a plain-English retry hint for the agent.
 *
 * Returns the hint text plus whether another iteration should occur
 * (quality < threshold AND iteration < max).
 */
export async function generateRetryHint(
  options: GenerateRetryHintOptions,
): Promise<RetryHintResult> {
  const {
    brief,
    iteration,
    verifierReport,
    visionReport,
    qualityScore,
    timeoutMs = HINT_TIMEOUT_MS,
  } = options;

  // Determine if we should iterate
  const shouldIterate =
    qualityScore < QUALITY_THRESHOLD &&
    iteration < MAX_ITERATIONS;

  // If quality is good enough, no hint needed
  if (!shouldIterate) {
    return {
      hint: "",
      cost_usd: 0,
      shouldIterate: false,
    };
  }

  // Build the system prompt with the actual score
  const systemPrompt = RETRY_HINT_PROMPT_TEMPLATE.replace(
    "{{score}}",
    String(qualityScore),
  );

  // Build user message with the review data
  const userMessage = [
    `## Original Brief\n\n${brief}`,
    `## Hard Verifier Mismatches\n\n${formatVerifierMismatches(verifierReport)}`,
    `## Vision Inspector Findings\n\n${formatVisionFindings(visionReport)}`,
    `## Quality Score: ${qualityScore}/100`,
  ].join("\n\n");

  let client: Anthropic;
  try {
    client = options.clientFactory
      ? options.clientFactory()
      : createAnthropicClient();
  } catch {
    // Fallback: generate a deterministic hint from the reports
    return {
      hint: generateDeterministicHint(verifierReport, visionReport, qualityScore),
      cost_usd: 0,
      shouldIterate,
    };
  }

  try {
    const stream = client.messages.stream(
      {
        model: HINT_MODEL,
        max_tokens: HINT_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    const message = await stream.finalMessage();

    const textBlocks = message.content.filter(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
    );
    const hint = textBlocks.map(b => b.text).join("").trim();

    const cost_usd =
      (message.usage.input_tokens * SONNET_INPUT_COST_PER_MILLION +
        message.usage.output_tokens * SONNET_OUTPUT_COST_PER_MILLION) /
      1_000_000;

    // eslint-disable-next-line no-console
    console.info(
      `[retry-hint] Generated hint for iteration ${iteration}, ` +
      `quality=${qualityScore}, hint_words=${hint.split(/\s+/).length}, ` +
      `cost=$${cost_usd.toFixed(4)}`,
    );

    return { hint, cost_usd, shouldIterate };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[retry-hint] LLM call failed: ${err instanceof Error ? err.message : String(err)}. ` +
      `Falling back to deterministic hint.`,
    );
    return {
      hint: generateDeterministicHint(verifierReport, visionReport, qualityScore),
      cost_usd: 0,
      shouldIterate,
    };
  }
}

// ─── Formatters ─────────────────────────────────────────────────────

function formatVerifierMismatches(report: VerifierReport): string {
  if (report.mismatches.length === 0) {
    return "No mismatches found. Verified: " + (report.verified ? "yes" : "no") +
      `. Parts coverage: ${(report.parts_coverage * 100).toFixed(0)}%. Trim coverage: ${(report.trim_coverage * 100).toFixed(0)}%.`;
  }
  return report.mismatches.map(m =>
    `- **${m.type}** (${m.severity}): ${m.description} [item: ${m.item_id}]`,
  ).join("\n");
}

function formatVisionFindings(report: VisionReport): string {
  if (report.issues.length === 0) {
    return `No issues. Quality score: ${report.quality_score}/100. ${report.summary}`;
  }
  return report.issues.map(issue =>
    `- **${issue.type}** (${issue.severity}): ${issue.description}` +
    (issue.affected_element ? ` [element: ${issue.affected_element}]` : ""),
  ).join("\n");
}

// ─── Deterministic fallback ─────────────────────────────────────────

function generateDeterministicHint(
  verifierReport: VerifierReport,
  visionReport: VisionReport,
  qualityScore: number,
): string {
  const parts: string[] = [];

  parts.push(
    `The build scored ${qualityScore}/100. Here's what needs attention:`,
  );

  // From verifier
  for (const m of verifierReport.mismatches) {
    if (m.type === "missing_parts" || m.type === "missing_aggregation") {
      parts.push(
        `- Item "${m.item_id}" appears to be collapsed into a single box. ` +
        `Build it with multi-part decomposition using IfcRelAggregates. ` +
        `Expected parts: ${m.expected}, found: ${m.actual}.`,
      );
    } else if (m.type === "missing_trim") {
      parts.push(
        `- Trim item "${m.item_id}" is missing from the IFC. ` +
        `Add it as an IfcCovering or IfcDiscreteAccessory.`,
      );
    } else if (m.type === "wrong_class") {
      parts.push(
        `- Item "${m.item_id}" uses the wrong IFC class. ` +
        `Expected: ${m.expected}, found: ${m.actual}. ` +
        `Use IfcFurnishingElement for furniture, never IfcBuildingElementProxy.`,
      );
    }
  }

  // From vision
  for (const issue of visionReport.issues) {
    if (issue.severity === "high" || issue.severity === "med") {
      parts.push(
        `- Vision: ${issue.description}` +
        (issue.affected_element ? ` (affects ${issue.affected_element})` : ""),
      );
    }
  }

  parts.push(
    `Focus on multi-part decomposition and correct IFC classes for the rebuild.`,
  );

  return parts.join("\n\n");
}
