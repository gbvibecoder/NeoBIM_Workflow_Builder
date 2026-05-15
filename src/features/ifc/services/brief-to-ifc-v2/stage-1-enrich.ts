/**
 * Stage 1 — Brief Enricher (Brief-to-IFC v2, Phase 2 queued pipeline).
 *
 * Downloads the uploaded brief from R2, extracts its text, and enriches
 * it into a tender-grade Markdown specification via Claude Opus 4.7. The
 * queued-pipeline twin of the Phase 1 `handlers/tr-024.ts` synchronous
 * handler — same faithfulness contract, same prompt — but:
 *   • Opus 4.7 instead of Sonnet 4.6 (Phase 2: Opus everywhere).
 *   • 64k max_tokens, with a one-shot 80k retry on `max_tokens` truncation.
 *   • Throws `BriefToIfcStageError` instead of returning an HTTP envelope —
 *     the orchestrator maps `.kind` to retry-vs-fail.
 *
 * Persists `enrichedSpec` + `briefSourceFormat` to the job row on success.
 * The Phase 1 handler is deliberately left untouched (parallel-alive).
 */

import { Buffer } from "node:buffer";

import type { PrismaClient } from "@prisma/client";

import { extractTextFromBriefFile } from "@/lib/brief-extractor";

import {
  createAnthropicClient,
  BRIEF_TO_IFC_V2_MODEL,
  OPUS_47_INPUT_COST_PER_MILLION,
  OPUS_47_OUTPUT_COST_PER_MILLION,
  estimateTokens,
  computeAnthropicCostUsd,
} from "./anthropic-client";
import {
  BRIEF_ENRICHER_SYSTEM_PROMPT,
  buildEnricherUserMessage,
} from "./enricher-prompt";
import { BriefToIfcStageError, toBriefToIfcStageError } from "./job-types";
import type { BriefToIfcJobLogger, StageTokenUsage } from "./job-logger";

const STAGE_NUMBER = 1;
const STAGE_NAME = "Brief Enricher";

/** Opus 4.7 streamed output ceiling. 64k everywhere (Phase 2). */
const ENRICHER_MAX_TOKENS = 64_000;
/** One-shot raised ceiling if 64k truncates — a truncated spec drops
 *  elements downstream (the ENRICHMENT_TRUNCATED failure on the SOL brief). */
const ENRICHER_RETRY_MAX_TOKENS = 80_000;
/** Per-call wall-clock cap — leaves headroom under the worker's 540s budget. */
const ENRICHER_TIMEOUT_MS = 540_000;
/** Reject briefs over this estimated input size rather than truncating. */
const ENRICHER_INPUT_TOKEN_CAP = 180_000;
/** Below this the "brief" is too short to be a real brief. */
const MIN_BRIEF_CHARS = 100;
/** Wall-clock cap for the R2 download of the brief file. */
const BRIEF_DOWNLOAD_TIMEOUT_MS = 60_000;

export interface EnrichStageArgs {
  jobId: string;
  prisma: PrismaClient;
  logger: BriefToIfcJobLogger;
}

export interface EnrichStageResult {
  enrichedSpec: string;
  tokenUsage: StageTokenUsage;
}

/** Download the brief file from its R2 locator and base64-encode it. */
async function downloadBriefFile(
  locator: string,
): Promise<{ base64: string; declaredMimeType?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(locator);
  } catch {
    throw new BriefToIfcStageError({
      code: "BRIEF_LOCATOR_INVALID",
      message: "The stored brief locator is not a valid URL.",
      kind: "permanent",
      stageName: STAGE_NAME,
    });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BriefToIfcStageError({
      code: "BRIEF_LOCATOR_INVALID",
      message: "The brief locator must be an http(s) URL.",
      kind: "permanent",
      stageName: STAGE_NAME,
    });
  }

  let res: Response;
  try {
    res = await fetch(locator, {
      signal: AbortSignal.timeout(BRIEF_DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw new BriefToIfcStageError({
      code: "BRIEF_DOWNLOAD_FAILED",
      message: `Could not download the brief from storage: ${
        err instanceof Error ? err.message : String(err)
      }`,
      kind: "transient",
      stageName: STAGE_NAME,
    });
  }
  if (!res.ok) {
    // 5xx → storage hiccup, worth a retry. 4xx (incl. 404) → the object is
    // gone or unreadable; retrying won't help.
    throw new BriefToIfcStageError({
      code: "BRIEF_DOWNLOAD_FAILED",
      message: `Brief storage responded ${res.status} ${res.statusText}.`,
      kind: res.status >= 500 ? "transient" : "permanent",
      stageName: STAGE_NAME,
    });
  }

  const declaredMimeType = res.headers.get("content-type") ?? undefined;
  const arrayBuf = await res.arrayBuffer();
  return {
    base64: Buffer.from(arrayBuf).toString("base64"),
    declaredMimeType,
  };
}

export async function runEnrichStage(
  args: EnrichStageArgs,
): Promise<EnrichStageResult> {
  const { jobId, prisma, logger } = args;
  logger.startStage(STAGE_NUMBER, STAGE_NAME);

  try {
    const job = await prisma.briefToIfcJob.findUnique({
      where: { id: jobId },
      select: { briefFileR2Key: true },
    });
    if (!job) {
      throw new BriefToIfcStageError({
        code: "JOB_NOT_FOUND",
        message: `Job ${jobId} no longer exists.`,
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    // ── Download + extract the brief ──────────────────────────────────
    const { base64, declaredMimeType } = await downloadBriefFile(
      job.briefFileR2Key,
    );
    const extracted = await extractTextFromBriefFile(base64, declaredMimeType);
    if (!extracted.ok) {
      throw new BriefToIfcStageError({
        code:
          extracted.sourceFormat === "docx"
            ? "DOCX_EXTRACTION_FAILED"
            : "PDF_EXTRACTION_FAILED",
        message:
          `The ${extracted.sourceFormat.toUpperCase()} brief could not be ` +
          `parsed by any text extractor: ${extracted.errorSummary}`,
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }
    const briefText = extracted.text.trim();
    const sourceFormat = extracted.sourceFormat;

    // ── Gate: too short to be a real brief ────────────────────────────
    if (briefText.length < MIN_BRIEF_CHARS) {
      throw new BriefToIfcStageError({
        code: "BRIEF_TOO_SHORT",
        message: `The brief is too short to enrich (${briefText.length} chars).`,
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    // ── Gate: too large — fail loud, never silently truncate ──────────
    const estimatedInputTokens = estimateTokens(briefText);
    if (estimatedInputTokens > ENRICHER_INPUT_TOKEN_CAP) {
      throw new BriefToIfcStageError({
        code: "INPUT_TOO_LARGE",
        message:
          `The brief is approximately ${estimatedInputTokens.toLocaleString()} ` +
          `tokens, over the ${ENRICHER_INPUT_TOKEN_CAP.toLocaleString()}-token ` +
          "limit for the Brief Enricher. Split the brief into smaller documents.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    // ── Enrich via Opus 4.7 (streamed; system prompt cached) ──────────
    let client: ReturnType<typeof createAnthropicClient>;
    try {
      client = createAnthropicClient();
    } catch {
      throw new BriefToIfcStageError({
        code: "MISSING_API_KEY",
        message:
          "ANTHROPIC_API_KEY is not configured. The Brief Enricher needs it to run.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    const userMessage = buildEnricherUserMessage({ briefText, sourceFormat });
    const runEnricherCall = (maxTokens: number) => {
      const stream = client.messages.stream(
        {
          model: BRIEF_TO_IFC_V2_MODEL,
          max_tokens: maxTokens,
          system: [
            {
              type: "text",
              text: BRIEF_ENRICHER_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userMessage }],
        },
        { signal: AbortSignal.timeout(ENRICHER_TIMEOUT_MS) },
      );
      return stream.finalMessage();
    };

    // API/transport errors here are transient (network, 5xx, abort); the
    // `max_tokens` truncation check below is a permanent logic failure.
    const message = await (async () => {
      try {
        const first = await runEnricherCall(ENRICHER_MAX_TOKENS);
        if (first.stop_reason !== "max_tokens") return first;
        return await runEnricherCall(ENRICHER_RETRY_MAX_TOKENS);
      } catch (err) {
        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.name === "TimeoutError");
        throw new BriefToIfcStageError({
          code: isAbort ? "ENRICH_TIMEOUT" : "ENRICH_API_ERROR",
          message: `The Brief Enricher call failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          kind: "transient",
          stageName: STAGE_NAME,
        });
      }
    })();

    if (message.stop_reason === "max_tokens") {
      throw new BriefToIfcStageError({
        code: "ENRICHMENT_TRUNCATED",
        message:
          "The enriched specification exceeded the output limit even at the " +
          "raised ceiling. The brief is unusually large — split it into " +
          "smaller documents and re-run.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    const enrichedSpec = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!enrichedSpec) {
      throw new BriefToIfcStageError({
        code: "ENRICHMENT_EMPTY",
        message: "The Brief Enricher returned no text.",
        kind: "transient",
        stageName: STAGE_NAME,
      });
    }

    const tokenUsage: StageTokenUsage = {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      costUsd: computeAnthropicCostUsd({
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
        inputCostPerMillion: OPUS_47_INPUT_COST_PER_MILLION,
        outputCostPerMillion: OPUS_47_OUTPUT_COST_PER_MILLION,
      }),
    };

    // ── Persist the enriched spec ─────────────────────────────────────
    await prisma.briefToIfcJob.update({
      where: { id: jobId },
      data: { enrichedSpec, briefSourceFormat: sourceFormat },
    });

    logger.endStage(STAGE_NUMBER, "success", {
      tokenUsage,
      summary:
        `Enriched a ${briefText.length.toLocaleString()}-char ` +
        `${sourceFormat.toUpperCase()} brief into a ` +
        `${enrichedSpec.length.toLocaleString()}-char tender-grade spec.`,
    });
    return { enrichedSpec, tokenUsage };
  } catch (err) {
    const stageErr = toBriefToIfcStageError(err, STAGE_NAME);
    logger.endStage(STAGE_NUMBER, "failed", {
      error: `${stageErr.code}: ${stageErr.message}`,
    });
    throw stageErr;
  }
}
