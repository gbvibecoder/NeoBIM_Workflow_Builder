import {
  NextResponse,
  generateId,
  formatErrorResponse,
  logger,
} from "./deps";
import type { NodeHandler } from "./types";
import { executeBuilderScript } from "@/features/ifc/services/brief-to-ifc-v2/ifc-sandbox-client";
import {
  ArchitectScriptDataSchema,
  type IfcGenerationData,
} from "@/features/ifc/services/brief-to-ifc-v2/contracts";
import { IFC_ARCHITECT_MODEL } from "@/features/ifc/services/brief-to-ifc-v2/anthropic-client";

/**
 * EX-006 — AI IFC Generator (Brief-to-IFC v2, Phase 1).
 *
 * Takes the IfcOpenShell Python script authored by TR-022, runs it in the
 * sandboxed Railway endpoint `POST /api/v1/execute-builder-script`, and
 * returns the generated IFC file. Terminal node of the v2 pipeline — its
 * `type: "file"` artifact is the user-facing IFC, openable in the existing
 * `/dashboard/ifc-viewer`.
 *
 * Failure modes are mapped to canvas-facing status codes (T5):
 *   • transport failure / service down → 503 SANDBOX_UNAVAILABLE
 *   • sandbox wall-timeout             → 408 SANDBOX_TIMEOUT
 *   • IFC > 50 MB                      → 413 OUTPUT_TOO_LARGE
 *   • script raised / no output / bad IFC → 422 IFCOPENSHELL_RUNTIME_ERROR
 */

export const handleEX006: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  // ── Resolve the builder script from the upstream TR-022 artifact ────
  let pythonCode: string | undefined;
  let expectedEntityCount = 0;
  const upstreamScript: unknown = inputData?._script;
  if (upstreamScript && typeof upstreamScript === "object") {
    const parsed = ArchitectScriptDataSchema.safeParse(upstreamScript);
    if (parsed.success) {
      pythonCode = parsed.data.python_code;
      expectedEntityCount = parsed.data.expected_entity_count;
    }
  }
  // Tolerate a bare `python_code` field for direct / manual wiring.
  if (!pythonCode && typeof inputData?.python_code === "string") {
    pythonCode = inputData.python_code;
  }

  if (!pythonCode || pythonCode.trim().length === 0) {
    return NextResponse.json(
      formatErrorResponse({
        title: "No builder script",
        message:
          "EX-006 needs an IFC builder script upstream. Connect an IFC " +
          "Architect (TR-022) node before this node.",
        code: "MISSING_SCRIPT",
      }),
      { status: 422 },
    );
  }

  const filePrefix = `ai-ifc-${(executionId ?? "local")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 24)}`;

  logger.info(
    `[EX-006] dispatching builder script to sandbox — scriptChars=${pythonCode.length} expectedEntities=${expectedEntityCount}`,
  );

  const result = await executeBuilderScript({
    pythonCode,
    filePrefix,
    expectedEntityCount,
  });

  // ── Transport failure — the sandbox itself was unreachable ──────────
  if (!result.ok) {
    logger.warn(
      `[EX-006] sandbox transport failure — kind=${result.kind} ${result.message}`,
    );
    return NextResponse.json(
      formatErrorResponse({
        title: "IFC sandbox unavailable",
        message:
          result.kind === "not-configured"
            ? "The Python sandbox is not configured (IFC_SERVICE_URL is unset)."
            : `The Python sandbox could not be reached: ${result.message}`,
        code: "SANDBOX_UNAVAILABLE",
      }),
      { status: 503 },
    );
  }

  const response = result.response;

  // ── Script-level failure — the sandbox ran but the script errored ──
  if (response.status === "failed" || !response.ifc_url) {
    const errorCode = response.error?.code ?? "IFCOPENSHELL_RUNTIME_ERROR";
    const errorMessage =
      response.error?.message ?? "The builder script did not produce an IFC.";
    const stderrTail = response.sandbox_log.stderr_tail.slice(-1200);

    let httpStatus = 422;
    if (errorCode === "SANDBOX_TIMEOUT") httpStatus = 408;
    else if (errorCode === "OUTPUT_TOO_LARGE") httpStatus = 413;

    logger.warn(
      `[EX-006] builder script failed — code=${errorCode} exit=${response.sandbox_log.exit_code} ${errorMessage}`,
    );

    // The structured `sandboxLog` rides alongside the standard error
    // envelope so a future Phase-2 refinement loop can consume the
    // stderr tail + exit code without a schema change.
    return NextResponse.json(
      {
        ...formatErrorResponse({
          title: "IFC generation failed",
          message:
            `${errorMessage}\n\nSandbox exit code: ${response.sandbox_log.exit_code}` +
            (stderrTail ? `\n\nstderr (tail):\n${stderrTail}` : ""),
          code: errorCode,
        }),
        sandboxLog: response.sandbox_log,
      },
      { status: httpStatus },
    );
  }

  // ── Success — the sandbox produced a valid IFC ──────────────────────
  const ifcUrl = response.ifc_url;
  const ifcSizeBytes = response.ifc_size_bytes ?? 0;
  const audit = response.audit ?? { total_entities: 0, by_class: {} };
  const entityCount = response.entity_count ?? audit.total_entities;
  const ifcFileName = `${filePrefix}.ifc`;

  const ifcData: IfcGenerationData = {
    entityCount,
    audit,
    sandboxLog: response.sandbox_log,
    expectedEntityCount,
  };

  logger.info(
    `[EX-006] IFC generated — entities=${entityCount} expected=${expectedEntityCount} ` +
      `sizeBytes=${ifcSizeBytes} execMs=${response.execution_time_ms}`,
  );

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "file",
    data: {
      files: [
        {
          name: ifcFileName,
          type: "IFC 4",
          size: ifcSizeBytes,
          downloadUrl: ifcUrl,
          label: "AI-Generated IFC",
          discipline: "architectural",
        },
      ],
      label: "AI-Powered IFC",
      totalSize: ifcSizeBytes,
      // Backward-compatible top-level fields (mirrors EX-001's artifact shape)
      name: ifcFileName,
      type: "IFC 4",
      size: ifcSizeBytes,
      downloadUrl: ifcUrl,
      _ifc: ifcData,
    },
    metadata: {
      engine: "ifcopenshell",
      real: true,
      schema: "IFC4",
      ifcServicePath: "ai-sandbox",
      aiArchitectModel: IFC_ARCHITECT_MODEL,
      entityCount,
      expectedEntityCount,
      executionTimeMs: response.execution_time_ms,
      sandboxExitCode: response.sandbox_log.exit_code,
    },
    createdAt: new Date(),
  };
};
