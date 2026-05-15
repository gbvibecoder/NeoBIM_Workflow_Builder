/**
 * Stage 3 — AI IFC Generator (Brief-to-IFC v2, Phase 2 queued pipeline).
 *
 * Takes the IfcOpenShell Python script authored by Stage 2 and runs it in
 * the sandboxed Railway endpoint, producing the final IFC file. The
 * queued-pipeline twin of the Phase 1 `handlers/ex-006.ts` synchronous
 * handler — same sandbox client, same response contract — but:
 *   • Reads its input from the job row (JSON-encoded `ArchitectScriptData`)
 *     instead of an upstream artifact.
 *   • Throws `BriefToIfcStageError` instead of an HTTP envelope, mapping
 *     the sandbox's two failure layers to retry-vs-fail:
 *       – transport down / timeout / 5xx / unparseable → transient
 *       – not-configured / 4xx                        → permanent
 *       – script raised / bad IFC / no output         → permanent
 *       – sandbox wall-timeout (SANDBOX_TIMEOUT)       → transient
 *
 * Persists `ifcR2Url`, `ifcEntityCount`, `ifcAudit` on success. The
 * Phase 1 handler is deliberately left untouched (parallel-alive).
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { executeBuilderScript } from "./ifc-sandbox-client";
import { ArchitectScriptDataSchema } from "./contracts";
import {
  BriefToIfcStageError,
  toBriefToIfcStageError,
  type BriefToIfcAudit,
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
}

export async function runGenerateStage(
  args: GenerateStageArgs,
): Promise<GenerateStageResult> {
  const { jobId, prisma, logger } = args;
  logger.startStage(STAGE_NUMBER, STAGE_NAME);

  try {
    const job = await prisma.briefToIfcJob.findUnique({
      where: { id: jobId },
      select: { architectScript: true },
    });
    if (!job) {
      throw new BriefToIfcStageError({
        code: "JOB_NOT_FOUND",
        message: `Job ${jobId} no longer exists.`,
        kind: "permanent",
        stageName: STAGE_NAME,
      });
    }

    // ── Resolve the builder script from Stage 2's persisted output ────
    if (!job.architectScript || job.architectScript.trim().length === 0) {
      throw new BriefToIfcStageError({
        code: "SCRIPT_MISSING",
        message:
          "The AI IFC Generator has no builder script to run. Stage 2 (IFC " +
          "Architect) did not produce usable output.",
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
    const { python_code, expected_entity_count } = parsedScript.data;

    // Deterministic R2 prefix keyed on jobId — re-running Stage 3 (transient
    // retry) overwrites the same object in place, no orphans.
    const filePrefix = `ai-ifc-${jobId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24)}`;

    const result = await executeBuilderScript({
      pythonCode: python_code,
      filePrefix,
      expectedEntityCount: expected_entity_count,
    });

    // ── Transport failure — the sandbox itself was unreachable ────────
    if (!result.ok) {
      // not-configured / http 4xx → permanent (retry won't help).
      // timeout / network / 5xx / unparseable → transient.
      const permanent =
        result.kind === "not-configured" ||
        (result.kind === "http-error" &&
          typeof result.statusCode === "number" &&
          result.statusCode < 500);
      throw new BriefToIfcStageError({
        code:
          result.kind === "not-configured"
            ? "SANDBOX_NOT_CONFIGURED"
            : "SANDBOX_UNAVAILABLE",
        message: `The Python sandbox could not be reached: ${result.message}`,
        kind: permanent ? "permanent" : "transient",
        stageName: STAGE_NAME,
      });
    }

    const response = result.response;

    // ── Script-level failure — the sandbox ran but the script errored ─
    if (response.status === "failed" || !response.ifc_url) {
      const errorCode = response.error?.code ?? "IFCOPENSHELL_RUNTIME_ERROR";
      const errorMessage =
        response.error?.message ?? "The builder script did not produce an IFC.";
      const stderrTail = response.sandbox_log.stderr_tail.slice(-800);
      // A wall-timeout can be a loaded sandbox — worth one retry. A runtime
      // error / oversized output / bad IFC is the script's own fault —
      // re-running the identical script reproduces it.
      const transient = errorCode === "SANDBOX_TIMEOUT";
      throw new BriefToIfcStageError({
        code: errorCode,
        message:
          `${errorMessage} (sandbox exit ${response.sandbox_log.exit_code})` +
          (stderrTail ? ` — stderr tail: ${stderrTail}` : ""),
        kind: transient ? "transient" : "permanent",
        stageName: STAGE_NAME,
      });
    }

    // ── Success — the sandbox produced a valid IFC ────────────────────
    const ifcR2Url = response.ifc_url;
    const ifcAudit: BriefToIfcAudit = response.audit ?? {
      total_entities: 0,
      by_class: {},
    };
    const ifcEntityCount = response.entity_count ?? ifcAudit.total_entities;

    await prisma.briefToIfcJob.update({
      where: { id: jobId },
      data: {
        ifcR2Url,
        ifcEntityCount,
        ifcAudit: ifcAudit as unknown as Prisma.InputJsonValue,
      },
    });

    logger.endStage(STAGE_NUMBER, "success", {
      summary:
        `Generated a ${ifcEntityCount.toLocaleString()}-entity IFC ` +
        `(expected ${expected_entity_count.toLocaleString()}) in ` +
        `${response.execution_time_ms.toLocaleString()} ms.`,
    });
    return { ifcR2Url, ifcEntityCount, ifcAudit };
  } catch (err) {
    const stageErr = toBriefToIfcStageError(err, STAGE_NAME);
    logger.endStage(STAGE_NUMBER, "failed", {
      error: `${stageErr.code}: ${stageErr.message}`,
    });
    throw stageErr;
  }
}
