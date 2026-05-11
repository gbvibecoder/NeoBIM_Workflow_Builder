/**
 * HTTP client for the IfcOpenShell Python microservice.
 *
 * Calls the Python FastAPI service to generate production-quality IFC4 files
 * via IfcOpenShell. Returns null on any failure so the caller can fall back
 * to the existing TypeScript IFC exporter.
 */

import type { MassingGeometry } from "@/types/geometry";

// ── Response types ──────────────────────────────────────────────────

export interface IFCServiceFile {
  discipline: string;
  file_name: string;
  download_url: string;
  size: number;
  schema_version: string;
  entity_count: number;
}

export interface IFCServiceResponse {
  // Python's neobim-ifc-service emits a tristate status:
  //   "success" — clean export, zero IDS violations
  //   "partial" — files generated AND IDS-validated, but one or more
  //               IDS rules flagged warnings/violations. Files ARE
  //               usable — the partial flag is a quality signal, not
  //               a failure signal. We must accept these (Python's
  //               richness >> our TS fallback even with violations).
  //   "error"   — Python could not produce files at all.
  status: "success" | "partial" | "error";
  files: IFCServiceFile[];
  metadata: {
    engine: string;
    ifcopenshell_version: string;
    generation_time_ms: number;
    validation_passed: boolean;
    entity_counts: Record<string, number>;
    // Phase 1 Slice 6 — populated when useParametricPipeline=true.
    // The full BuildingModel graph as JSON; the EX-001 TS handler
    // writes this to the BuildingModel table + R2 (Slice 7).
    building_model_json?: Record<string, unknown> | null;
    building_model_r2_key?: string | null;
    // IDS validation envelope (Phase 0 stage 2.5 + Slice 6 re-stamp)
    ids_validation?: Record<string, unknown> | null;
    ids_violations?: Array<Record<string, unknown>>;
  };
  error?: string;
}

// ── Client ──────────────────────────────────────────────────────────

const IFC_SERVICE_URL = process.env.IFC_SERVICE_URL;
const IFC_SERVICE_API_KEY = process.env.IFC_SERVICE_API_KEY;
const TIMEOUT_MS = 30_000;
const READY_PROBE_TIMEOUT_MS = 5_000;
const READY_CACHE_TTL_MS = 60_000;

// ═══════════════════════════════════════════════════════════════════════
// Pre-flight readiness probe (Phase 1 Track A.1)
// ═══════════════════════════════════════════════════════════════════════

export type ServiceReadinessReason =
  | "ok"
  | "not-configured"
  | "timeout"
  | "http-error"
  | "parse-error"
  | "network-error";

export interface ServiceReadinessResult {
  /** true only when the service replied 200 with a JSON body whose `ready === true`. */
  ready: boolean;
  /** Coarse classification for logs and UI — never free-form. */
  reason: ServiceReadinessReason;
  /** HTTP status when the probe got a response; undefined for network-layer failures. */
  statusCode?: number;
  /** Wall-clock latency of the probe in ms. 0 when reason is "not-configured". */
  latencyMs: number;
  /** Date.now() at the moment the result was finalized — feeds the 60 s cache. */
  checkedAt: number;
  /** Short error message for observability. Stack traces are never attached. */
  error?: string;
}

// Module-level cache keyed by IFC_SERVICE_URL. In Vercel serverless this
// only deduplicates probes within a single warm lambda — cold starts
// reset it, which is the right trade-off (a 5 s probe on cold start is
// cheaper than a 30 s export-ifc timeout on cold start).
const READINESS_CACHE = new Map<string, ServiceReadinessResult>();

/**
 * Probe the IFC service's /ready endpoint to confirm it can actually
 * generate IFC files before EX-001 invests in a full export request.
 *
 * Cache: 60 s per URL. Avoids hammering the service on bursts of EX-001
 * runs from the same process.
 *
 * Contract: never throws. Callers always get a ServiceReadinessResult
 * describing success or the failure mode. `reason` is a fixed set so
 * downstream code can branch on it without string-matching.
 *
 * Endpoint: GET {IFC_SERVICE_URL}/ready (public, no auth per
 * neobim-ifc-service/app/auth.py PUBLIC_PATHS). We deliberately do NOT
 * send the API key to keep the probe independent of auth correctness —
 * if API keys drift out of sync, the probe still works and the real
 * export call surfaces the auth failure later with a proper 401.
 */
export async function isServiceReady(
  timeoutMs: number = READY_PROBE_TIMEOUT_MS,
): Promise<ServiceReadinessResult> {
  if (!IFC_SERVICE_URL) {
    return {
      ready: false,
      reason: "not-configured",
      latencyMs: 0,
      checkedAt: Date.now(),
    };
  }

  const cached = READINESS_CACHE.get(IFC_SERVICE_URL);
  if (cached && Date.now() - cached.checkedAt < READY_CACHE_TTL_MS) {
    return cached;
  }

  const start = Date.now();
  let result: ServiceReadinessResult;
  try {
    const response = await fetch(`${IFC_SERVICE_URL}/ready`, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      result = {
        ready: false,
        reason: "http-error",
        statusCode: response.status,
        latencyMs: Date.now() - start,
        checkedAt: Date.now(),
        error: `${response.status} ${response.statusText}`,
      };
    } else {
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (parseErr) {
        result = {
          ready: false,
          reason: "parse-error",
          statusCode: response.status,
          latencyMs: Date.now() - start,
          checkedAt: Date.now(),
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        };
        READINESS_CACHE.set(IFC_SERVICE_URL, result);
        return result;
      }

      const ready =
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as Record<string, unknown>).ready === true;

      result = {
        ready,
        reason: ready ? "ok" : "http-error",
        statusCode: response.status,
        latencyMs: Date.now() - start,
        checkedAt: Date.now(),
        error: ready ? undefined : "Service replied 200 but body.ready !== true",
      };
    }
  } catch (err) {
    const isAbort =
      err instanceof DOMException && err.name === "AbortError";
    result = {
      ready: false,
      reason: isAbort ? "timeout" : "network-error",
      latencyMs: Date.now() - start,
      checkedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  READINESS_CACHE.set(IFC_SERVICE_URL, result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Export generation (primary API — unchanged in Phase 1)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate IFC files via the Python IfcOpenShell microservice.
 *
 * @returns The service response with R2 download URLs, or `null` if the
 *          service is unavailable / errors out (triggering TS fallback).
 */
export async function generateIFCViaService(
  geometry: MassingGeometry,
  options: {
    projectName: string;
    buildingName: string;
    author?: string;
    /**
     * Phase 1 Track B — rich-mode hint forwarded to the Python service.
     * Currently untyped as `string` because:
     *   1. This is the boundary to an external service — loose is safer.
     *   2. Python `ExportOptions` (neobim-ifc-service/app/models/request.py)
     *      does NOT yet declare a `richMode` field. Pydantic v2's default
     *      `extra='ignore'` silently drops it — we can forward safely now,
     *      and Python will start acting on it once Track C adds the field
     *      + Phase 2+ builders actually consume it. Until then this is a
     *      no-op on the Python side; exists here so the channel is ready.
     */
    richMode?: string;
  },
  filePrefix: string,
): Promise<IFCServiceResponse | null> {
  if (!IFC_SERVICE_URL) {
    return null; // Service not configured — use TS fallback
  }

  try {
    const body = JSON.stringify({
      geometry: {
        buildingType: geometry.buildingType,
        floors: geometry.floors,
        totalHeight: geometry.totalHeight,
        footprintArea: geometry.footprintArea,
        gfa: geometry.gfa,
        footprint: geometry.footprint,
        storeys: geometry.storeys,
        boundingBox: geometry.boundingBox,
        metrics: geometry.metrics || [],
      },
      options: {
        projectName: options.projectName,
        buildingName: options.buildingName,
        author: options.author || "NeoBIM",
        disciplines: ["architectural", "structural", "mep", "combined"],
        // Phase 1 Track B — forward richMode. Python drops the unknown
        // field via Pydantic extra='ignore'; no-op until Track C + Phase 2+.
        ...(options.richMode ? { richMode: options.richMode } : {}),
      },
      filePrefix,
    });

    const response = await fetch(`${IFC_SERVICE_URL}/api/v1/export-ifc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(IFC_SERVICE_API_KEY
          ? { Authorization: `Bearer ${IFC_SERVICE_API_KEY}` }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(
        `[IFC Service] HTTP ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data: IFCServiceResponse = await response.json();

    // Python is the highest-priority IFC path. Only fall back to the
    // TS exporter when Python literally cannot produce files
    // (status="error" or empty files array). A "partial" response means
    // Python DID produce IFCs but flagged IDS violations — those files
    // are richer than anything the TS exporter will emit, so we use them.
    if (data.status === "error" || !data.files?.length) {
      console.warn(
        `[IFC Service] Hard failure — status="${data.status}", files=${
          data.files?.length ?? 0
        }, error:`,
        data.error,
      );
      return null;
    }

    if (data.status === "partial") {
      const violationCount = Array.isArray(data.metadata?.ids_violations)
        ? data.metadata.ids_violations.length
        : undefined;
      console.warn(
        `[IFC Service] Accepted partial response — ${data.files.length} ` +
          `IFC file(s) generated with ${
            violationCount ?? "unknown"
          } IDS violation(s). Python output used regardless.`,
      );
    }

    return data;
  } catch (err) {
    // Network error, timeout, or JSON parse error → fall back to TS exporter
    console.warn(`[IFC Service] Unavailable, falling back to TS exporter:`, err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Design-agent path — POST /api/v1/design/generate
//
// This is the RICH pipeline: brief PDF/text →
//   brief-analyst (LLM) → template-matcher (LLM) → adaptation-planner
//   (LLM) → extension-planner (LLM) → BuildingModel → IFC via
//   `build_ifc_from_building_model` (the parametric pipeline carrying
//   every P1.5 / P1.6 / 2B.2 / 2B.3 / P2 enrichment).
//
// Output is one rich IFC (5,000+ entities for a 3BHK duplex; named
// rooms; handrails; mullions; parapets; swing arcs; distinct door
// materials; etc.). Vastly richer than the `/api/v1/export-ifc`
// massing-input legacy path.
//
// Cost: ~$0.03–0.04 per cold call (4 Haiku 4.5 LLM stages); cache hits
// drop to ~$0.
// Latency: 15–25 s cold, <1 s warm.
//
// Gated by `USE_DESIGN_AGENT_PIPELINE` env in the caller — when false,
// callers stick to the legacy /export-ifc path.
// ═══════════════════════════════════════════════════════════════════════

const DESIGN_AGENT_TIMEOUT_MS = 60_000;

export interface DesignAgentResponse {
  // "generated" on success. Refusals come back as HTTP 422 — those
  // never have a status field populated here because they're errors,
  // not the success envelope.
  status: "generated";
  request_id: string;
  ifc_url: string;
  ifc_url_kind: "data-uri-base64" | "r2-url";
  ifc_size_bytes: number;
  match_result: {
    template_id?: string;
    parameters?: Record<string, unknown>;
    confidence?: number;
  } | null;
  adaptation_plan: Record<string, unknown> | null;
  adaptation_failed: Record<string, unknown> | null;
  extension_plan: Record<string, unknown> | null;
  extension_failed: Record<string, unknown> | null;
  ids_validation?: {
    passed: boolean;
    rules_evaluated: number;
    violations_count: number;
    warnings_count: number;
  };
  building_model_summary?: Record<string, unknown>;
  metadata?: {
    analyst?: Record<string, unknown>;
    matcher?: Record<string, unknown>;
    planner?: Record<string, unknown>;
    extension_planner?: Record<string, unknown>;
    total_cost_usd_estimated?: number;
  };
  warnings?: string[];
  elapsed_ms?: number;
}

export interface DesignAgentRefusal {
  refused: true;
  reason: string;
  refusalKind: "matcher" | "planner" | "validation" | "unknown";
  httpStatus: number;
}

/**
 * Call the design-agent pipeline. Returns one of:
 *   * `DesignAgentResponse` — success, rich IFC ready
 *   * `DesignAgentRefusal`  — LLM refused (unsupported brief / building type);
 *                             caller should surface a specific error to UI
 *                             instead of silently falling back
 *   * `null`                — network / timeout / 5xx; caller should
 *                             fall back to /export-ifc
 */
export async function generateIFCViaDesignAgent(
  briefText: string,
  options: {
    buildId: string;
    targetFidelity?: "design-development" | "schematic" | "construction";
  },
): Promise<DesignAgentResponse | DesignAgentRefusal | null> {
  if (!IFC_SERVICE_URL) {
    return null;
  }

  if (!briefText || briefText.trim().length === 0) {
    console.warn("[Design Agent] Skipped — empty briefText");
    return null;
  }

  const body = JSON.stringify({
    brief_text: briefText,
    target_fidelity: options.targetFidelity ?? "design-development",
    build_id: options.buildId,
  });

  const t0 = Date.now();
  try {
    const response = await fetch(`${IFC_SERVICE_URL}/api/v1/design/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(IFC_SERVICE_API_KEY
          ? { Authorization: `Bearer ${IFC_SERVICE_API_KEY}` }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(DESIGN_AGENT_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - t0;

    if (response.status === 422) {
      // Matcher / planner / validation refusal — the request is structurally
      // OK but the LLM declined to produce an output. The body carries a
      // structured reason; surface it to the UI verbatim so the user knows
      // exactly why their brief was rejected.
      let detail: { detail?: { error_code?: string; message?: string; reason?: string } } = {};
      try {
        detail = await response.json();
      } catch {
        /* swallow — fall through with empty detail */
      }
      const errCode = detail.detail?.error_code ?? "DESIGN_AGENT_REFUSED";
      const reason = detail.detail?.message ?? detail.detail?.reason ?? "No reason provided.";
      const refusalKind: DesignAgentRefusal["refusalKind"] = errCode.includes("MATCH")
        ? "matcher"
        : errCode.includes("PLAN")
          ? "planner"
          : errCode.includes("VALID")
            ? "validation"
            : "unknown";
      console.warn(
        `[Design Agent] Refusal (HTTP 422) kind=${refusalKind} ` +
          `errorCode=${errCode} reason=${reason}`,
      );
      return { refused: true, reason, refusalKind, httpStatus: 422 };
    }

    if (!response.ok) {
      console.warn(
        `[Design Agent] HTTP ${response.status} ${response.statusText} — ` +
          `falling back to legacy /export-ifc`,
      );
      return null;
    }

    const data = (await response.json()) as DesignAgentResponse;

    if (!data.ifc_url || data.ifc_size_bytes <= 0) {
      console.warn(
        `[Design Agent] Empty IFC in response — falling back to legacy.`,
      );
      return null;
    }

    // Cost monitoring (safeguard #4) — single structured line per call.
    const cost = data.metadata?.total_cost_usd_estimated ?? 0;
    const ids = data.ids_validation;
    console.warn(
      `[Design Agent] OK request_id=${data.request_id} ` +
        `template=${data.match_result?.template_id ?? "n/a"} ` +
        `ifc_size_kb=${(data.ifc_size_bytes / 1024).toFixed(1)} ` +
        `cost_usd=${cost.toFixed(4)} ` +
        `latency_ms=${latencyMs} ` +
        `ids_passed=${ids?.passed ?? "n/a"} ` +
        `ids_violations=${ids?.violations_count ?? "n/a"} ` +
        `warnings=${data.warnings?.length ?? 0}`,
    );

    return data;
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    console.warn(
      `[Design Agent] ${
        isAbort ? "Timeout" : "Network error"
      } — falling back to legacy:`,
      err,
    );
    return null;
  }
}

/**
 * Type-guard distinguishing the refusal envelope from the success envelope.
 */
export function isDesignAgentRefusal(
  result: DesignAgentResponse | DesignAgentRefusal | null,
): result is DesignAgentRefusal {
  return result !== null && (result as DesignAgentRefusal).refused === true;
}

/**
 * Adapt a DesignAgentResponse into the legacy IFCServiceResponse shape so
 * the EX-001 handler can consume both paths uniformly. The design-agent
 * path produces one rich combined IFC; legacy path produces a four-file
 * discipline split. We map "combined" → ex-001's combinedFile resolver
 * and let it use the single rich IFC for downloads + 3D preview.
 */
export function adaptDesignAgentToServiceResponse(
  data: DesignAgentResponse,
  filePrefix: string,
): IFCServiceResponse {
  const fileName = `${filePrefix}_combined.ifc`;
  return {
    status: "success",
    files: [
      {
        discipline: "combined",
        file_name: fileName,
        download_url: data.ifc_url,
        size: data.ifc_size_bytes,
        schema_version: "IFC4",
        entity_count: 0, // not surfaced by design-agent envelope yet
      },
    ],
    metadata: {
      engine: "ifcopenshell",
      ifcopenshell_version: "design-agent",
      generation_time_ms: data.elapsed_ms ?? 0,
      validation_passed: data.ids_validation?.passed ?? true,
      entity_counts: {},
      building_model_json:
        (data.building_model_summary as Record<string, unknown> | undefined) ??
        null,
      ids_validation: data.ids_validation as Record<string, unknown> | undefined,
    },
  };
}
