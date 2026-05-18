/**
 * Hard Verifier (TR-035, Phase Beta 3).
 *
 * Deterministic comparison of spec.furniture[*].parts vs actual IFC
 * entity counts. Calls the Python build-verifier endpoint on Railway
 * for proper ifcopenshell-based IFC parsing.
 *
 * When the Python endpoint is unreachable (local dev, Railway down),
 * falls back to a heuristic report based on spec analysis only.
 */

import { verifierReportSchema } from "./types";
import type { BriefSpec, VerifierReport } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PARTS_MIN_FRACTION = 0.7;
const DEFAULT_DIM_TOLERANCE_M = 0.1;

// ─── Types ──────────────────────────────────────────────────────────────

export interface VerifyBuildOptions {
  /** Override for the Railway sandbox URL. */
  sandboxUrl?: string;
  /** Timeout for the Python endpoint call. */
  timeoutMs?: number;
  /** Minimum fraction of spec parts that must be present. */
  partsMinFraction?: number;
  /** Dimensional tolerance in metres. */
  dimToleranceM?: number;
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * Verify a built IFC against its source BriefSpec.
 *
 * Calls the Python verifier endpoint for proper IFC parsing.
 * Returns a VerifierReport with parts/trim coverage and mismatches.
 */
export async function verifyBuild(
  ifcUrl: string,
  spec: BriefSpec,
  options?: VerifyBuildOptions,
): Promise<VerifierReport> {
  const sandboxUrl = options?.sandboxUrl ?? process.env.NEOBIM_IFC_SERVICE_URL ?? "";
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const partsMinFraction = options?.partsMinFraction ?? DEFAULT_PARTS_MIN_FRACTION;
  const dimToleranceM = options?.dimToleranceM ?? DEFAULT_DIM_TOLERANCE_M;

  // Try calling the Python endpoint
  if (sandboxUrl) {
    try {
      const res = await fetch(`${sandboxUrl}/api/v3/verifier/check-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ifc_url: ifcUrl,
          spec,
          tolerance: {
            dim_m: dimToleranceM,
            parts_min_fraction: partsMinFraction,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = verifierReportSchema.safeParse(data);
        if (parsed.success) return parsed.data;
        // eslint-disable-next-line no-console
        console.warn("[hard-verifier] Python response failed schema validation, falling back to heuristic.");
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[hard-verifier] Python endpoint returned ${res.status}, falling back to heuristic.`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[hard-verifier] Python endpoint unreachable:", err instanceof Error ? err.message : err);
    }
  }

  // Fallback: heuristic verification based on spec analysis
  return buildHeuristicReport(spec, partsMinFraction);
}

// ─── Heuristic fallback ─────────────────────────────────────────────────

/**
 * Build a heuristic verification report when the Python endpoint is
 * unavailable. Counts expected parts/trim from the spec and produces
 * a conservative estimate (always returns verified=false with a warning).
 */
function buildHeuristicReport(
  spec: BriefSpec,
  partsMinFraction: number,
): VerifierReport {
  const furniture = spec.furniture ?? [];
  const trim = spec.trim ?? [];

  let totalExpectedParts = 0;
  for (const item of furniture) {
    totalExpectedParts += item.parts?.length ?? 0;
  }

  const mismatches: VerifierReport["mismatches"] = [];

  // Flag items with parts that we can't verify
  for (const item of furniture) {
    if (item.parts && item.parts.length > 0) {
      mismatches.push({
        type: "missing_parts",
        item_id: item.id,
        item_type: item.type,
        expected: item.parts.length,
        actual: "unknown (Python verifier unavailable)",
        severity: "med",
        description: `Cannot verify ${item.parts.length} parts for ${item.id} — Python verifier offline.`,
        suggested_patch: "force_parts",
      });
    }
  }

  return {
    verified: false,
    parts_coverage: 0,
    trim_coverage: 0,
    mismatches,
    summary: `Heuristic report: ${totalExpectedParts} expected parts, ${trim.length} expected trim. Python verifier unavailable — cannot confirm IFC contents.`,
    verified_at: new Date().toISOString(),
  };
}
