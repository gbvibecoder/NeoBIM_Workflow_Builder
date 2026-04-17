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
  status: "success" | "error";
  files: IFCServiceFile[];
  metadata: {
    engine: string;
    ifcopenshell_version: string;
    generation_time_ms: number;
    validation_passed: boolean;
    entity_counts: Record<string, number>;
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

    if (data.status !== "success" || !data.files?.length) {
      console.warn(`[IFC Service] Error response:`, data.error);
      return null;
    }

    return data;
  } catch (err) {
    // Network error, timeout, or JSON parse error → fall back to TS exporter
    console.warn(`[IFC Service] Unavailable, falling back to TS exporter:`, err);
    return null;
  }
}
