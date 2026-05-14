import {
  NextResponse,
  generateId,
  formatErrorResponse,
  logger,
} from "./deps";
import type { NodeHandler } from "./types";
import { extractTextFromBriefFile } from "@/lib/brief-extractor";
import {
  createAnthropicClient,
  BRIEF_ENRICHER_MODEL,
  BRIEF_ENRICHER_INPUT_COST_PER_MILLION,
  BRIEF_ENRICHER_OUTPUT_COST_PER_MILLION,
  estimateTokens,
  computeAnthropicCostUsd,
} from "@/features/ifc/services/brief-to-ifc-v2/anthropic-client";
import {
  BRIEF_ENRICHER_SYSTEM_PROMPT,
  buildEnricherUserMessage,
} from "@/features/ifc/services/brief-to-ifc-v2/enricher-prompt";
import type { EnrichedBriefData } from "@/features/ifc/services/brief-to-ifc-v2/contracts";

/**
 * TR-024 — Brief Enricher (Brief-to-IFC v2, Phase 1).
 *
 * Reads the user's brief — uploaded `.pdf`/`.docx` (from IN-002) or
 * upstream text — and enriches it into a tender-grade, IFC-ready Markdown
 * specification via Claude Sonnet 4.6. The *faithful-translation* front
 * half of the v2 pipeline: it preserves everything the brief states and
 * only ADDS missing structure, flagged `[INFERRED]`.
 *
 * Output `artifact.data.content` is the enriched Markdown — TR-022 (IFC
 * Architect) consumes it directly.
 */

/** base64 → ~20 MB raw ≈ 26.7 MB base64. Mirrors TR-001's upload cap. */
const MAX_UPLOAD_BASE64_LEN = 27 * 1024 * 1024;
/** Reject briefs over this estimated input size rather than truncating. */
const ENRICHER_INPUT_TOKEN_CAP = 150_000;
/** Sonnet 4.6 streamed output ceiling for the enriched spec. 16k output
 *  tokens ≈ 10-12k words — plenty for a tender-grade spec, and keeps the
 *  call comfortably inside the wall-clock cap. Phase 1.5: lowered from 48k. */
const ENRICHER_MAX_TOKENS = 16_000;
/** Wall-clock cap for the Anthropic call. Phase 1.5: raised from 180s — the
 *  180s AbortSignal was the actual cause of the prod "Request was aborted"
 *  failure. 540s uses the route's 600s maxDuration budget while leaving
 *  headroom for brief extraction + response handling. */
const ENRICHER_TIMEOUT_MS = 540_000;
/** Below this the "brief" is too short to be a real brief. */
const MIN_BRIEF_CHARS = 100;

/** Pull `[INFERRED]` lines out of the enriched Markdown for observability. */
function collectInferredFlags(markdown: string): string[] {
  const flags: string[] = [];
  for (const line of markdown.split("\n")) {
    if (line.includes("[INFERRED]")) {
      flags.push(line.trim());
    }
  }
  return flags;
}

export const handleTR024: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const uploadBase64: unknown = inputData?.fileData ?? inputData?.buffer ?? null;
  const passthroughText: unknown =
    inputData?.content ?? inputData?.prompt ?? inputData?.rawText ?? "";

  let briefText = typeof passthroughText === "string" ? passthroughText : "";
  let sourceFormat: EnrichedBriefData["sourceFormat"] = "text";

  // ── Resolve the brief text — from an uploaded file or upstream text ──
  if (uploadBase64 && typeof uploadBase64 === "string") {
    if (uploadBase64.length === 0) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Empty file",
          message:
            "The uploaded file is empty. Please select a valid PDF or DOCX brief.",
          code: "EMPTY_FILE",
        }),
        { status: 400 },
      );
    }
    if (uploadBase64.length > MAX_UPLOAD_BASE64_LEN) {
      return NextResponse.json(
        formatErrorResponse({
          title: "File too large",
          message: "File too large. Maximum brief size is 20MB.",
          code: "FILE_TOO_LARGE",
        }),
        { status: 413 },
      );
    }

    const extracted = await extractTextFromBriefFile(
      uploadBase64,
      typeof inputData?.mimeType === "string" ? inputData.mimeType : undefined,
    );
    logger.info(`[TR-024] brief-extract ${extracted.summary}`);

    if (extracted.ok) {
      briefText = extracted.text;
      sourceFormat = extracted.sourceFormat;
    } else if (extracted.sourceFormat === "docx") {
      console.error(
        "[TR-024] DOCX extraction failed — surfacing clear error to UI",
        extracted.errors,
      );
      return NextResponse.json(
        formatErrorResponse({
          title: "Could not read DOCX",
          message:
            `The DOCX brief could not be parsed. Try re-saving it as .docx, ` +
            `exporting a text-based PDF, or pasting the brief into a Text ` +
            `Prompt node.\n\nUnderlying parser error: ${extracted.errorSummary}`,
          code: "DOCX_EXTRACTION_FAILED",
        }),
        { status: 422 },
      );
    } else {
      console.error(
        "[TR-024] All PDF extractors failed — surfacing clear error to UI",
        extracted.errors,
      );
      return NextResponse.json(
        formatErrorResponse({
          title: "Could not read PDF",
          message:
            `The PDF brief could not be parsed by any text extractor. Try ` +
            `re-exporting it as a text-based PDF, or pasting the brief into a ` +
            `Text Prompt node.\n\nUnderlying parser errors: ${extracted.errorSummary}`,
          code: "PDF_EXTRACTION_FAILED",
        }),
        { status: 422 },
      );
    }
  }

  briefText = briefText.trim();

  // ── Gate: too short to be a real brief ──────────────────────────────
  if (briefText.length < MIN_BRIEF_CHARS) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Brief content too short",
        message:
          `The brief is too short to enrich (${briefText.length} chars). ` +
          "Upload a PDF/DOCX brief or paste the full brief into a Text Prompt node.",
        code: "BRIEF_TOO_SHORT",
      }),
      { status: 422 },
    );
  }

  // ── Gate: too large — fail loud, never silently truncate ────────────
  const estimatedInputTokens = estimateTokens(briefText);
  if (estimatedInputTokens > ENRICHER_INPUT_TOKEN_CAP) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Brief too large",
        message:
          `The brief is approximately ${estimatedInputTokens.toLocaleString()} ` +
          `tokens, over the ${ENRICHER_INPUT_TOKEN_CAP.toLocaleString()}-token ` +
          "limit for the Brief Enricher. Split the brief into smaller documents.",
        code: "INPUT_TOO_LARGE",
      }),
      { status: 413 },
    );
  }

  // ── Enrich via Claude Sonnet 4.6 (streamed; system prompt cached) ───
  logger.info(
    `[TR-024] enriching brief — source=${sourceFormat} chars=${briefText.length} ~tokens=${estimatedInputTokens}`,
  );

  let client: ReturnType<typeof createAnthropicClient>;
  try {
    client = createAnthropicClient();
  } catch {
    return NextResponse.json(
      formatErrorResponse({
        title: "API key required",
        message:
          "ANTHROPIC_API_KEY is not configured. The Brief Enricher needs it to run.",
        code: "MISSING_API_KEY",
      }),
      { status: 400 },
    );
  }

  let enrichedMarkdown: string;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  try {
    console.log(
      `[TR-024] starting Anthropic call · inputTokens=~${estimatedInputTokens} · maxTokens=${ENRICHER_MAX_TOKENS} · briefSize=${briefText.length}`,
    );
    const stream = client.messages.stream(
      {
        model: BRIEF_ENRICHER_MODEL,
        max_tokens: ENRICHER_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: BRIEF_ENRICHER_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: buildEnricherUserMessage({ briefText, sourceFormat }),
          },
        ],
      },
      { signal: AbortSignal.timeout(ENRICHER_TIMEOUT_MS) },
    );
    const message = await stream.finalMessage();
    console.log(
      `[TR-024] Anthropic call complete · outputTokens=${message.usage.output_tokens} · stopReason=${message.stop_reason}`,
    );

    inputTokens = message.usage.input_tokens;
    outputTokens = message.usage.output_tokens;
    cacheReadTokens = message.usage.cache_read_input_tokens ?? 0;
    cacheCreationTokens = message.usage.cache_creation_input_tokens ?? 0;

    if (message.stop_reason === "max_tokens") {
      // A truncated spec silently drops elements downstream — exactly the
      // "decorative brief" failure mode. Fail loud instead.
      return NextResponse.json(
        formatErrorResponse({
          title: "Enrichment truncated",
          message:
            "The enriched specification exceeded the output limit. The brief " +
            "is unusually large — split it into smaller documents and re-run.",
          code: "ENRICHMENT_TRUNCATED",
        }),
        { status: 500 },
      );
    }

    const textParts = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text);
    enrichedMarkdown = textParts.join("\n").trim();

    if (!enrichedMarkdown) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Enrichment failed",
          message:
            "The Brief Enricher returned no text. Please try running the node again.",
          code: "ENRICHMENT_EMPTY",
        }),
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("[TR-024] Anthropic enrichment call failed:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      formatErrorResponse({
        title: "Enrichment failed",
        message: `The Brief Enricher could not complete: ${message}`,
        code: "ENRICHMENT_FAILED",
      }),
      { status: 500 },
    );
  }

  const inferredFlags = collectInferredFlags(enrichedMarkdown);
  const costUsd = computeAnthropicCostUsd({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    inputCostPerMillion: BRIEF_ENRICHER_INPUT_COST_PER_MILLION,
    outputCostPerMillion: BRIEF_ENRICHER_OUTPUT_COST_PER_MILLION,
  });

  const enrichedData: EnrichedBriefData = {
    sourceCharCount: briefText.length,
    enrichedCharCount: enrichedMarkdown.length,
    sourceFormat,
    inferredFlags,
  };

  logger.info(
    `[TR-024] enriched — sourceChars=${briefText.length} enrichedChars=${enrichedMarkdown.length} ` +
      `inferred=${inferredFlags.length} tokensIn=${inputTokens} tokensOut=${outputTokens} ` +
      `cacheRead=${cacheReadTokens} costUsd=${costUsd}`,
  );

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "text",
    data: {
      content: enrichedMarkdown,
      label: "Enriched Spec",
      _enriched: enrichedData,
    },
    metadata: {
      model: BRIEF_ENRICHER_MODEL,
      real: true,
      sourceFormat,
      inferredFlagCount: inferredFlags.length,
      tokenCount: { input: inputTokens, output: outputTokens },
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
    },
    createdAt: new Date(),
  };
};
