/**
 * Stage 2 — IFC Architect (Brief-to-IFC v2, Phase 2 queued pipeline).
 *
 * Reads the enriched spec from Stage 1 and authors a complete IfcOpenShell
 * 0.8 Python builder script via Claude Opus 4.7, extracted through a
 * FORCED `tool_use` call. The queued-pipeline twin of the Phase 1
 * `handlers/tr-022.ts` synchronous handler — same prompt, same forced
 * tool, same schema validation — but:
 *   • 64k max_tokens (Phase 2: 64k everywhere).
 *   • Throws `BriefToIfcStageError` instead of an HTTP envelope.
 *
 * Persists the full validated `ArchitectScriptData` as JSON to the
 * `architectScript` column on success — Stage 3 parses it back. The
 * Phase 1 handler is deliberately left untouched (parallel-alive).
 */

import type { PrismaClient } from "@prisma/client";

import {
  createAnthropicClient,
  BRIEF_TO_IFC_V2_MODEL,
  OPUS_47_INPUT_COST_PER_MILLION,
  OPUS_47_OUTPUT_COST_PER_MILLION,
  estimateTokens,
  computeAnthropicCostUsd,
} from "./anthropic-client";
import {
  IFC_ARCHITECT_SYSTEM_PROMPT,
  IFC_ARCHITECT_TOOL_NAME,
  buildArchitectUserMessage,
  buildSubmitIfcBuilderScriptTool,
} from "./architect-prompt";
import { ArchitectScriptDataSchema } from "./contracts";
import { BriefToIfcStageError, toBriefToIfcStageError } from "./job-types";
import type { BriefToIfcJobLogger, StageTokenUsage } from "./job-logger";

const STAGE_NUMBER = 2;
const STAGE_NAME = "IFC Architect";

/** Opus 4.7 streamed output ceiling for the builder script. 64k (Phase 2). */
const ARCHITECT_MAX_TOKENS = 64_000;
/** Per-call wall-clock cap — Opus authoring a full script is the slowest
 *  LLM call in the pipeline; leaves headroom under the worker's 540s budget. */
const ARCHITECT_TIMEOUT_MS = 540_000;
/** Reject enriched specs over this estimated size rather than truncating. */
const ARCHITECT_INPUT_TOKEN_CAP = 200_000;
/** Below this the upstream "spec" is too thin to author an IFC from. */
const MIN_SPEC_CHARS = 50;

export interface ArchitectStageArgs {
  jobId: string;
  prisma: PrismaClient;
  logger: BriefToIfcJobLogger;
}

export interface ArchitectStageResult {
  /** JSON-encoded `ArchitectScriptData` — what was persisted to the column. */
  architectScriptJson: string;
  expectedEntityCount: number;
  tokenUsage: StageTokenUsage;
}

export async function runArchitectStage(
  args: ArchitectStageArgs,
): Promise<ArchitectStageResult> {
  const { jobId, prisma, logger } = args;
  logger.startStage(STAGE_NUMBER, STAGE_NAME);

  try {
    const job = await prisma.briefToIfcJob.findUnique({
      where: { id: jobId },
      select: { enrichedSpec: true },
    });
    if (!job) {
      throw new BriefToIfcStageError({
        code: "JOB_NOT_FOUND",
        message: `Job ${jobId} no longer exists.`,
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    const enrichedSpec = (job.enrichedSpec ?? "").trim();

    // ── Gate: no upstream spec — Stage 1 must have run ────────────────
    if (enrichedSpec.length < MIN_SPEC_CHARS) {
      throw new BriefToIfcStageError({
        code: "SPEC_MISSING",
        message:
          "The IFC Architect has no enriched specification to work from. " +
          "Stage 1 (Brief Enricher) did not produce usable output.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    // ── Gate: too large — fail loud, never silently truncate ──────────
    const estimatedInputTokens = estimateTokens(enrichedSpec);
    if (estimatedInputTokens > ARCHITECT_INPUT_TOKEN_CAP) {
      throw new BriefToIfcStageError({
        code: "INPUT_TOO_LARGE",
        message:
          `The enriched specification is approximately ` +
          `${estimatedInputTokens.toLocaleString()} tokens, over the ` +
          `${ARCHITECT_INPUT_TOKEN_CAP.toLocaleString()}-token limit for the ` +
          "IFC Architect.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    // ── Author the script via Opus 4.7 (streamed; forced tool_use) ────
    let client: ReturnType<typeof createAnthropicClient>;
    try {
      client = createAnthropicClient();
    } catch {
      throw new BriefToIfcStageError({
        code: "MISSING_API_KEY",
        message:
          "ANTHROPIC_API_KEY is not configured. The IFC Architect needs it to run.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    // API/transport errors here are transient; the post-call validation
    // failures below (truncation, missing/wrong tool, bad payload) are
    // permanent — re-running an identical call produces the same result.
    const message = await (async () => {
      try {
        const stream = client.messages.stream(
          {
            model: BRIEF_TO_IFC_V2_MODEL,
            max_tokens: ARCHITECT_MAX_TOKENS,
            system: [
              {
                type: "text",
                text: IFC_ARCHITECT_SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
              },
            ],
            tools: [buildSubmitIfcBuilderScriptTool()],
            tool_choice: { type: "tool", name: IFC_ARCHITECT_TOOL_NAME },
            messages: [
              { role: "user", content: buildArchitectUserMessage(enrichedSpec) },
            ],
          },
          { signal: AbortSignal.timeout(ARCHITECT_TIMEOUT_MS) },
        );
        return await stream.finalMessage();
      } catch (err) {
        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.name === "TimeoutError");
        throw new BriefToIfcStageError({
          code: isAbort ? "ARCHITECT_TIMEOUT" : "ARCHITECT_API_ERROR",
          message: `The IFC Architect call failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          kind: "transient",
          stageName: STAGE_NAME,
        });
      }
    })();

    if (message.stop_reason === "max_tokens") {
      throw new BriefToIfcStageError({
        code: "SCRIPT_TRUNCATED",
        message:
          "The IFC Architect's script exceeded the output limit before it " +
          "finished. The specification is unusually large — split the brief " +
          "into smaller documents and re-run.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    const toolUse = message.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    if (!toolUse) {
      throw new BriefToIfcStageError({
        code: "MISSING_TOOL_USE",
        message:
          "The IFC Architect did not return a builder script. Stop reason: " +
          `${message.stop_reason ?? "unknown"}.`,
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }
    if (toolUse.name !== IFC_ARCHITECT_TOOL_NAME) {
      throw new BriefToIfcStageError({
        code: "WRONG_TOOL_USE",
        message:
          `The IFC Architect called "${toolUse.name}" instead of ` +
          `"${IFC_ARCHITECT_TOOL_NAME}".`,
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    const parsed = ArchitectScriptDataSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new BriefToIfcStageError({
        code: "INVALID_SCRIPT_PAYLOAD",
        message:
          "The IFC Architect returned a malformed script payload: " +
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }
    const scriptData = parsed.data;

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

    // ── Persist the full validated script data as JSON ────────────────
    const architectScriptJson = JSON.stringify(scriptData);
    await prisma.briefToIfcJob.update({
      where: { id: jobId },
      data: { architectScript: architectScriptJson },
    });

    logger.endStage(STAGE_NUMBER, "success", {
      tokenUsage,
      summary:
        `Authored a ${scriptData.python_code.length.toLocaleString()}-char ` +
        `IfcOpenShell script — ${scriptData.expected_entity_count.toLocaleString()} ` +
        `expected entities across ${scriptData.elements_emitted.length} IFC classes.`,
    });
    return {
      architectScriptJson,
      expectedEntityCount: scriptData.expected_entity_count,
      tokenUsage,
    };
  } catch (err) {
    const stageErr = toBriefToIfcStageError(err, STAGE_NAME);
    logger.endStage(STAGE_NUMBER, "failed", {
      error: `${stageErr.code}: ${stageErr.message}`,
    });
    throw stageErr;
  }
}
