/**
 * Hard Verifier (TR-035, Phase Beta 3+4).
 *
 * Deterministic comparison of spec.furniture[*].parts vs actual IFC
 * entity counts. Calls the Python build-verifier endpoint on Railway.
 *
 * Phase Beta 4: source field tracks whether the report came from real
 * Railway parsing or heuristic fallback. Heuristic is now PESSIMISTIC
 * (verified=false, coverage=0) to force the Spec Patcher to iterate.
 */

import { verifierReportSchema } from "./types";
import type { BriefSpec, VerifierReport } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PARTS_MIN_FRACTION = 0.7;
const DEFAULT_DIM_TOLERANCE_M = 0.1;

/** Keywords indicating a composite furniture item (should have parts). */
const COMPOSITE_KEYWORDS = [
  "desk", "table", "machine", "stand", "kit", "array", "system",
  "rack", "unit", "station", "assembly", "fixture", "panel",
  "instrument", "appliance", "workstation", "console", "cabinet",
  "monitor", "tripod", "mannequin", "microphone", "speaker",
];

// ─── Types ──────────────────────────────────────────────────────────────

export interface VerifyBuildOptions {
  sandboxUrl?: string;
  timeoutMs?: number;
  partsMinFraction?: number;
  dimToleranceM?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function isCompositeName(name: string): boolean {
  const lower = name.toLowerCase();
  return COMPOSITE_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Main entry point ───────────────────────────────────────────────────

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
          tolerance: { dim_m: dimToleranceM, parts_min_fraction: partsMinFraction },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = verifierReportSchema.safeParse({ ...data, source: "railway" });
        if (parsed.success) {
          // eslint-disable-next-line no-console
          console.info("[hard-verifier] source=railway, verified=", parsed.data.verified, "parts_coverage=", parsed.data.parts_coverage);
          return parsed.data;
        }
        // eslint-disable-next-line no-console
        console.warn("[hard-verifier] Railway response failed schema validation, falling back to heuristic.");
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[hard-verifier] Railway returned ${res.status}, falling back to heuristic.`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[hard-verifier] Railway unreachable:", err instanceof Error ? err.message : err);
    }
  }

  // Fallback: pessimistic heuristic
  // eslint-disable-next-line no-console
  console.info("[hard-verifier] source=heuristic_fallback");
  return buildHeuristicReport(spec);
}

// ─── Pessimistic heuristic fallback ─────────────────────────────────────

function buildHeuristicReport(spec: BriefSpec): VerifierReport {
  const furniture = spec.furniture ?? [];
  const trim = spec.trim ?? [];

  let totalExpectedParts = 0;
  for (const item of furniture) {
    totalExpectedParts += item.parts?.length ?? 0;
  }

  const mismatches: VerifierReport["mismatches"] = [];

  // Global "unverified" mismatch — forces Spec Patcher to iterate
  mismatches.push({
    type: "unverified",
    item_id: "<global>",
    severity: "med",
    expected: "Railway verification",
    actual: "heuristic_fallback",
    description: "Hard Verifier could not parse IFC via Railway. Defaulting to unverified — Spec Patcher should iterate.",
    suggested_patch: "Retry build OR check Railway service health",
  });

  // Flag items with parts we can't verify
  for (const item of furniture) {
    if (item.parts && item.parts.length > 0) {
      mismatches.push({
        type: "missing_parts",
        item_id: item.id,
        item_type: item.type,
        expected: item.parts.length,
        actual: "unknown",
        severity: "med",
        description: `Cannot verify ${item.parts.length} parts for ${item.id} — Railway offline.`,
        suggested_patch: "force_parts",
      });
    }
  }

  // Flag composite-named items that have NO parts at all
  for (const item of furniture) {
    if ((!item.parts || item.parts.length === 0) && isCompositeName(item.type)) {
      mismatches.push({
        type: "missing_parts",
        item_id: item.id,
        item_type: item.type,
        expected: 3,
        actual: 0,
        severity: "high",
        description: `Composite item ${item.id} (${item.type}) has no parts — needs decomposition.`,
        suggested_patch: "force_parts",
      });
    }
  }

  return {
    verified: false,
    parts_coverage: 0,
    trim_coverage: 0,
    mismatches,
    summary: `Heuristic (pessimistic): ${totalExpectedParts} expected parts, ${trim.length} trim. Railway unavailable. ${mismatches.length} issue(s) flagged.`,
    verified_at: new Date().toISOString(),
    source: "heuristic_fallback",
  };
}
