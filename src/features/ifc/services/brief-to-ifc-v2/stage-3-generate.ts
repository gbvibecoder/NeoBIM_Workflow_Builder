/**
 * Stage 3 — AI IFC Generator with self-heal (Brief-to-IFC v2, Phase 3).
 *
 * Runs the IfcOpenShell builder script in the Railway sandbox. On a
 * SCRIPT-LEVEL failure (the script crashed in Python, the IFC was
 * invalid, the sandbox wall-timed-out) the stage feeds the original
 * script + the full traceback + the enriched spec back to Opus 4.7,
 * asks for a focused fix, parses the corrected Python out of the
 * fenced response, and runs it again. Up to two repair rounds (three
 * total sandbox attempts) before the stage gives up.
 *
 * Phase 1 still runs the same sandbox with no self-heal; only the
 * queued-pipeline Stage 3 here loops.
 *
 * Failure classification — what triggers self-heal vs. what doesn't:
 *
 *   SCRIPT-LEVEL  (self-heal candidate, counts toward attemptCount):
 *     • IFCOPENSHELL_RUNTIME_ERROR  — the bug we're targeting.
 *     • INVALID_IFC                 — output bytes don't parse as IFC.
 *     • MISSING_OUTPUT              — script exited 0 but wrote no file.
 *     • SANDBOX_TIMEOUT             — could be a runaway loop Opus can fix.
 *
 *   PERMANENT     (no self-heal — `error.kind = "permanent"`):
 *     • SANDBOX_NOT_CONFIGURED      — IFC_SERVICE_URL unset; retrying won't fix env.
 *     • OUTPUT_TOO_LARGE            — faithful script writing too much; Opus
 *                                     can't make the spec smaller.
 *     • SCRIPT_CORRUPT / SCRIPT_MISSING — DB-layer issue, no script to run.
 *
 *   TRANSIENT     (`error.kind = "transient"`, lets the global Phase 2
 *   transient-retry mechanism handle it instead of self-heal):
 *     • SANDBOX_UNAVAILABLE (http 5xx / network error / unparseable body).
 *
 * Persists `retryHistory` (with full scriptCode per attempt),
 * `attemptCount`, `errorTraceback`, `errorType` to the job row after
 * EVERY attempt — so a worker crash mid-loop leaves a partial diagnostic
 * trail in the DB rather than silent data loss.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createAnthropicClient,
  BRIEF_TO_IFC_V2_MODEL,
  OPUS_47_INPUT_COST_PER_MILLION,
  OPUS_47_OUTPUT_COST_PER_MILLION,
  computeAnthropicCostUsd,
} from "./anthropic-client";
import {
  executeBuilderScript,
  type ExecuteBuilderScriptResult,
} from "./ifc-sandbox-client";
import { ArchitectScriptDataSchema, type SandboxLog } from "./contracts";
import {
  BRIEF_TO_IFC_STAGE_3_MAX_ATTEMPTS,
  BRIEF_TO_IFC_REPAIR_TIMEOUT_MS,
  BRIEF_TO_IFC_REPAIR_MAX_TOKENS,
  BRIEF_TO_IFC_STAGE_3_WALL_BUDGET_MS,
  BriefToIfcStageError,
  toBriefToIfcStageError,
  type BriefToIfcAudit,
  type BriefToIfcRetryAttempt,
} from "./job-types";
import type { BriefToIfcJobLogger } from "./job-logger";

const STAGE_NUMBER = 3;
const STAGE_NAME = "AI IFC Generator";

export interface GenerateStageArgs {
  jobId: string;
  prisma: PrismaClient;
  logger: BriefToIfcJobLogger;
}

export interface GenerateStageResult {
  ifcR2Url: string;
  ifcEntityCount: number;
  ifcAudit: BriefToIfcAudit;
  attemptsUsed: number;
  retryHistory: BriefToIfcRetryAttempt[];
}

/** Discriminator over how `executeBuilderScript` came back. */
type SandboxOutcome =
  | {
      kind: "success";
      ifcR2Url: string;
      ifcEntityCount: number;
      ifcAudit: BriefToIfcAudit;
      durationMs: number;
    }
  | {
      kind: "script-failed";
      errorType: string;
      errorMessage: string;
      durationMs: number;
      sandboxLog: SandboxLog;
    }
  | {
      kind: "transient";
      errorType: string;
      message: string;
    }
  | {
      kind: "permanent";
      errorType: string;
      message: string;
    };

/** Convert the raw client result into one of the four outcome buckets. */
function classifyOutcome(
  result: ExecuteBuilderScriptResult,
  startedAt: number,
): SandboxOutcome {
  if (!result.ok) {
    if (result.kind === "not-configured") {
      return {
        kind: "permanent",
        errorType: "SANDBOX_NOT_CONFIGURED",
        message: result.message,
      };
    }
    // http-error 4xx (not 5xx) → permanent. Everything else (5xx, timeout,
    // network, parse) → transient — those are infrastructure faults, NOT
    // bugs in the script, so they must not consume a self-heal attempt.
    const isPermanent4xx =
      result.kind === "http-error" &&
      typeof result.statusCode === "number" &&
      result.statusCode >= 400 &&
      result.statusCode < 500;
    return {
      kind: isPermanent4xx ? "permanent" : "transient",
      errorType: "SANDBOX_UNAVAILABLE",
      message: result.message,
    };
  }

  const response = result.response;
  const durationMs = response.execution_time_ms;

  if (response.status === "failed" || !response.ifc_url) {
    const errorCode = response.error?.code ?? "IFCOPENSHELL_RUNTIME_ERROR";
    const errorMessage =
      response.error?.message ?? "Script did not produce an IFC.";
    // `OUTPUT_TOO_LARGE` is a faithfulness issue (the spec is genuinely
    // huge); a code repair won't make it smaller. Permanent.
    if (errorCode === "OUTPUT_TOO_LARGE") {
      return {
        kind: "permanent",
        errorType: errorCode,
        message: errorMessage,
      };
    }
    return {
      kind: "script-failed",
      errorType: errorCode,
      errorMessage,
      durationMs,
      sandboxLog: response.sandbox_log,
    };
  }

  // Success.
  const ifcAudit: BriefToIfcAudit = response.audit ?? {
    total_entities: 0,
    by_class: {},
  };
  const ifcEntityCount = response.entity_count ?? ifcAudit.total_entities;
  return {
    kind: "success",
    ifcR2Url: response.ifc_url,
    ifcEntityCount,
    ifcAudit,
    durationMs: durationMs || Date.now() - startedAt,
  };
}

/** Anthropic repair system prompt. The verbatim text the user spec'd. */
const REPAIR_SYSTEM_PROMPT = `You are an expert ifcopenshell + Python debugger. The user previously asked you to write a Python script that builds an IFC file faithful to a given enriched spec. Your script ran but crashed in the sandbox. Below is the full original script you wrote, the full Python traceback, and the enriched spec you were originally working from. Identify the bug, fix ONLY the specific code that crashed (preserve everything else), and return the complete corrected Python script as a single fenced \`\`\`python code block with no commentary. The script must run end-to-end and produce a valid .ifc file. Common bugs to check: (1) setting attributes that don't exist on a given IFC entity type, (2) IFC4 attribute on IFC2X3 entity or vice versa, (3) wrong argument order in ifcopenshell.api.run() calls, (4) missing required attributes on owner-history-bearing entities, (5) None values where required, (6) iterating over generators twice. Do not change the overall building topology. Fix the specific traceback only.`;

/** Build the user message — four labelled blocks per spec. */
function buildRepairUserMessage(args: {
  enrichedSpec: string;
  originalScript: string;
  traceback: string;
  attemptNumber: number;
}): string {
  return (
    `<enriched_spec>\n${args.enrichedSpec}\n</enriched_spec>\n\n` +
    `<original_script>\n${args.originalScript}\n</original_script>\n\n` +
    `<python_traceback>\n${args.traceback}\n</python_traceback>\n\n` +
    `<attempt_number>${args.attemptNumber}</attempt_number>`
  );
}

/** Pull a Python source string out of an Opus response. Tries
 *  ```python ... ``` → ``` ... ``` → "looks like Python" fallback. */
function parsePythonFromResponse(text: string): string | null {
  const labelled = text.match(/```python\s*\n([\s\S]*?)\n```/);
  if (labelled) return labelled[1].trim();
  const generic = text.match(/```\s*\n([\s\S]*?)\n```/);
  if (generic) return generic[1].trim();
  const trimmed = text.trim();
  if (/^(import |from |def |class |#!?|\s*#)/.test(trimmed)) return trimmed;
  return null;
}

interface RepairResult {
  fixedScript: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Call Opus 4.7 to fix a broken script. Throws on any failure to produce
 *  a parseable Python block — callers treat that as the end of self-heal. */
async function callRepairOpus(args: {
  enrichedSpec: string;
  originalScript: string;
  traceback: string;
  attemptNumber: number;
}): Promise<RepairResult> {
  const client = createAnthropicClient();
  const stream = client.messages.stream(
    {
      model: BRIEF_TO_IFC_V2_MODEL,
      max_tokens: BRIEF_TO_IFC_REPAIR_MAX_TOKENS,
      system: [
        {
          type: "text",
          text: REPAIR_SYSTEM_PROMPT,
          // Cache the (static) repair-system prompt across the up-to-2
          // repair calls within one stage-3 invocation. The spec block is
          // NOT cached — it's already inside `messages` and changes
          // structurally each call, so any cache hit would be too narrow
          // to be worth the breakpoint.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: buildRepairUserMessage(args),
        },
      ],
    },
    { signal: AbortSignal.timeout(BRIEF_TO_IFC_REPAIR_TIMEOUT_MS) },
  );
  const message = await stream.finalMessage();

  if (message.stop_reason === "max_tokens") {
    throw new BriefToIfcStageError({
      code: "REPAIR_TRUNCATED",
      message:
        "Opus repair response exceeded the output limit before finishing — fix likely incomplete.",
      kind: "permanent",
      stageName: STAGE_NAME,
    });
  }

  const responseText = message.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const fixedScript = parsePythonFromResponse(responseText);
  if (!fixedScript) {
    throw new BriefToIfcStageError({
      code: "REPAIR_UNPARSEABLE",
      message:
        "Opus repair response did not contain a parseable Python code block.",
      kind: "permanent",
      stageName: STAGE_NAME,
    });
  }

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  const cacheReadTokens = message.usage.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = message.usage.cache_creation_input_tokens ?? 0;
  const costUsd = computeAnthropicCostUsd({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    inputCostPerMillion: OPUS_47_INPUT_COST_PER_MILLION,
    outputCostPerMillion: OPUS_47_OUTPUT_COST_PER_MILLION,
  });

  return { fixedScript, inputTokens, outputTokens, costUsd };
}

/** Persist the cumulative retry diagnostics to the job row. Best-effort —
 *  a write failure must NOT abort the loop (the next attempt is still
 *  more valuable than perfect persistence on this one). */
async function persistRetryDiagnostics(
  prisma: PrismaClient,
  jobId: string,
  retryHistory: BriefToIfcRetryAttempt[],
  lastFailedAttempt: BriefToIfcRetryAttempt | null,
): Promise<void> {
  try {
    await prisma.briefToIfcJob.update({
      where: { id: jobId },
      data: {
        retryHistory: retryHistory as unknown as Prisma.InputJsonValue,
        attemptCount: retryHistory.length,
        errorTraceback: lastFailedAttempt?.errorTraceback ?? null,
        errorType: lastFailedAttempt?.errorType ?? null,
      },
    });
  } catch (err) {
    console.error(
      "[brief-to-ifc] stage-3 retry-diagnostics persist failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function runGenerateStage(
  args: GenerateStageArgs,
): Promise<GenerateStageResult> {
  const { jobId, prisma, logger } = args;
  logger.startStage(STAGE_NUMBER, STAGE_NAME);
  const stageStartedAt = Date.now();

  try {
    // ── Load + parse the original architect script ────────────────────
    const job = await prisma.briefToIfcJob.findUnique({
      where: { id: jobId },
      select: { architectScript: true, enrichedSpec: true },
    });
    if (!job) {
      throw new BriefToIfcStageError({
        code: "JOB_NOT_FOUND",
        message: `Job ${jobId} no longer exists.`,
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }
    if (!job.architectScript || job.architectScript.trim().length === 0) {
      throw new BriefToIfcStageError({
        code: "SCRIPT_MISSING",
        message:
          "Stage 2 (IFC Architect) did not produce a builder script — nothing to run.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }
    let scriptPayload: unknown;
    try {
      scriptPayload = JSON.parse(job.architectScript);
    } catch {
      throw new BriefToIfcStageError({
        code: "SCRIPT_CORRUPT",
        message: "The persisted builder script payload is not valid JSON.",
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }
    const parsedScript = ArchitectScriptDataSchema.safeParse(scriptPayload);
    if (!parsedScript.success) {
      throw new BriefToIfcStageError({
        code: "SCRIPT_CORRUPT",
        message:
          "The persisted builder script payload failed schema validation: " +
          parsedScript.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }
    const { python_code: originalScript, expected_entity_count } =
      parsedScript.data;

    // The enriched spec is essential for the repair Opus call (it tells
    // the model what the script was SUPPOSED to build). If it's somehow
    // missing, self-heal still works degrade-gracefully — we just pass
    // an empty string and let Opus rely on the script + traceback alone.
    const enrichedSpec = job.enrichedSpec ?? "";

    // Deterministic R2 prefix keyed on jobId — re-running Stage 3 (transient
    // retry OR a self-heal repair within the same invocation) overwrites
    // in place. No orphan IFCs.
    const filePrefix = `ai-ifc-${jobId
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 24)}`;

    // ── Self-heal loop ────────────────────────────────────────────────
    let currentScript = originalScript;
    const retryHistory: BriefToIfcRetryAttempt[] = [];

    for (
      let attempt = 1;
      attempt <= BRIEF_TO_IFC_STAGE_3_MAX_ATTEMPTS;
      attempt++
    ) {
      // Wall-clock budget check — bail before risking Vercel's hard kill.
      const elapsed = Date.now() - stageStartedAt;
      if (elapsed > BRIEF_TO_IFC_STAGE_3_WALL_BUDGET_MS) {
        const lastFailure =
          [...retryHistory].reverse().find((a) => a.status === "failed") ??
          null;
        await persistRetryDiagnostics(prisma, jobId, retryHistory, lastFailure);
        throw new BriefToIfcStageError({
          code: "STAGE_BUDGET_EXHAUSTED",
          message:
            `Stage 3 wall-clock budget (${Math.round(BRIEF_TO_IFC_STAGE_3_WALL_BUDGET_MS / 1000)}s) ` +
            `exhausted after ${retryHistory.length} attempt(s); the next sandbox run was skipped ` +
            "to avoid the worker timeout.",
          kind: "permanent",
          stageName: STAGE_NAME,
        });
      }

      const attemptStartedAt = Date.now();
      const result = await executeBuilderScript({
        pythonCode: currentScript,
        filePrefix,
        expectedEntityCount: expected_entity_count,
      });
      const outcome = classifyOutcome(result, attemptStartedAt);

      // Infra failures: persist what we have, throw with the right kind —
      // these MUST NOT consume a self-heal attempt.
      if (outcome.kind === "permanent") {
        const lastFailure =
          [...retryHistory].reverse().find((a) => a.status === "failed") ??
          null;
        await persistRetryDiagnostics(prisma, jobId, retryHistory, lastFailure);
        throw new BriefToIfcStageError({
          code: outcome.errorType,
          message: outcome.message,
          kind: "permanent",
          stageName: STAGE_NAME,
        });
      }
      if (outcome.kind === "transient") {
        const lastFailure =
          [...retryHistory].reverse().find((a) => a.status === "failed") ??
          null;
        await persistRetryDiagnostics(prisma, jobId, retryHistory, lastFailure);
        throw new BriefToIfcStageError({
          code: outcome.errorType,
          message: outcome.message,
          kind: "transient",
          stageName: STAGE_NAME,
        });
      }

      // Success → record + return.
      if (outcome.kind === "success") {
        const successEntry: BriefToIfcRetryAttempt = {
          attempt,
          status: "succeeded",
          scriptCode: currentScript,
          scriptLength: currentScript.length,
          durationMs: outcome.durationMs,
          errorType: null,
          errorTraceback: null,
          sandboxExitCode: null,
        };
        retryHistory.push(successEntry);

        await prisma.briefToIfcJob.update({
          where: { id: jobId },
          data: {
            ifcR2Url: outcome.ifcR2Url,
            ifcEntityCount: outcome.ifcEntityCount,
            ifcAudit: outcome.ifcAudit as unknown as Prisma.InputJsonValue,
            attemptCount: retryHistory.length,
            retryHistory: retryHistory as unknown as Prisma.InputJsonValue,
            // Clear stale diagnostics so the canvas success state isn't
            // confused by a previous attempt's red error fields.
            errorTraceback: null,
            errorType: null,
          },
        });

        const repairCount = retryHistory.length - 1;
        logger.endStage(STAGE_NUMBER, "success", {
          summary:
            `Generated a ${outcome.ifcEntityCount.toLocaleString()}-entity IFC ` +
            `(expected ${expected_entity_count.toLocaleString()}) in ` +
            `${outcome.durationMs.toLocaleString()} ms on attempt ${attempt} of ` +
            `${BRIEF_TO_IFC_STAGE_3_MAX_ATTEMPTS}${repairCount > 0 ? ` (${repairCount} self-heal repair${repairCount === 1 ? "" : "s"})` : ""}.`,
        });
        return {
          ifcR2Url: outcome.ifcR2Url,
          ifcEntityCount: outcome.ifcEntityCount,
          ifcAudit: outcome.ifcAudit,
          attemptsUsed: retryHistory.length,
          retryHistory,
        };
      }

      // Script-level failure → record + maybe call Opus repair.
      const failureEntry: BriefToIfcRetryAttempt = {
        attempt,
        status: "failed",
        scriptCode: currentScript,
        scriptLength: currentScript.length,
        durationMs: outcome.durationMs,
        errorType: outcome.errorType,
        errorTraceback: outcome.sandboxLog.stderr_tail.slice(-16_000),
        sandboxExitCode: outcome.sandboxLog.exit_code,
      };
      retryHistory.push(failureEntry);
      await persistRetryDiagnostics(prisma, jobId, retryHistory, failureEntry);

      // Last attempt failed → no repair, fall through and throw below.
      if (attempt >= BRIEF_TO_IFC_STAGE_3_MAX_ATTEMPTS) break;

      // Budget guard before spending an Opus call on a repair we won't
      // get to run.
      const elapsedBeforeRepair = Date.now() - stageStartedAt;
      if (
        elapsedBeforeRepair + BRIEF_TO_IFC_REPAIR_TIMEOUT_MS >
        BRIEF_TO_IFC_STAGE_3_WALL_BUDGET_MS
      ) {
        await persistRetryDiagnostics(
          prisma,
          jobId,
          retryHistory,
          failureEntry,
        );
        throw new BriefToIfcStageError({
          code: "STAGE_BUDGET_EXHAUSTED",
          message:
            "Stage 3 wall-clock budget would not survive another repair Opus call.",
          kind: "permanent",
          stageName: STAGE_NAME,
        });
      }

      // Call Opus to fix the script. Any failure here ends the loop —
      // we can't proceed without a fix. Persisted retryHistory already
      // captures what we tried.
      let repair: RepairResult;
      try {
        repair = await callRepairOpus({
          enrichedSpec,
          originalScript: currentScript,
          traceback: failureEntry.errorTraceback ?? "",
          attemptNumber: attempt + 1,
        });
      } catch (err) {
        const stageErr = toBriefToIfcStageError(err, STAGE_NAME);
        // Promote the repair failure into a stage failure carrying the
        // ORIGINAL sandbox error (more useful to the user than "repair
        // call timed out").
        throw new BriefToIfcStageError({
          code: "SELF_HEAL_FAILED",
          message:
            `Self-heal could not produce a fix after ${attempt} attempt(s): ` +
            `${stageErr.code}: ${stageErr.message}. ` +
            `Last sandbox error: ${failureEntry.errorType ?? "unknown"} — ` +
            `${failureEntry.errorTraceback?.slice(0, 200) ?? "no traceback"}.`,
          kind: "permanent",
          stageName: STAGE_NAME,
        });
      }
      currentScript = repair.fixedScript;
    }

    // ── Self-heal exhausted ───────────────────────────────────────────
    const lastFailure =
      [...retryHistory].reverse().find((a) => a.status === "failed") ?? null;
    await persistRetryDiagnostics(prisma, jobId, retryHistory, lastFailure);
    throw new BriefToIfcStageError({
      code: "SELF_HEAL_EXHAUSTED",
      message:
        `AI IFC pipeline failed after ${BRIEF_TO_IFC_STAGE_3_MAX_ATTEMPTS} attempts. ` +
        `Last error (${lastFailure?.errorType ?? "unknown"}): ` +
        `${lastFailure?.errorTraceback?.split("\n").slice(-3).join(" | ").slice(0, 240) ?? "no traceback"}. ` +
        "See errorTraceback for the full diagnostic and download the failed " +
        "script versions from the canvas artifact panel.",
      kind: "permanent",
      stageName: STAGE_NAME,
    });
  } catch (err) {
    const stageErr = toBriefToIfcStageError(err, STAGE_NAME);
    logger.endStage(STAGE_NUMBER, "failed", {
      error: `${stageErr.code}: ${stageErr.message}`,
    });
    throw stageErr;
  }
}
