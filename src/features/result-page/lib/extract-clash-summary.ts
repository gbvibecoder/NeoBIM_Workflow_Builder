/**
 * Pure helper: walks tile-result JSON for a TR-016 (Clash Detector) artifact
 * and produces the redesigned clash hero's display summary.
 *
 * The TR-016 handler emits a JSON payload of variable shape; this helper is
 * defensive — it tolerates missing severity buckets, list-of-clashes-only
 * outputs, and short-circuits to null when nothing recognizable is found.
 */

import type { ExecutionArtifact } from "@/types/execution";

export interface ClashSummary {
  total: number;
  critical: number;
  major: number;
  minor: number;
  /** Pass-through node id so the hero CTA can deep-link if desired */
  nodeId?: string;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

function lower(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase() : "";
}

function bucketize(severity: string): "critical" | "major" | "minor" | null {
  if (!severity) return null;
  if (severity.includes("critical") || severity === "high" || severity === "hard") return "critical";
  if (severity.includes("major") || severity === "medium" || severity === "moderate") return "major";
  if (severity.includes("minor") || severity === "low" || severity === "soft" || severity === "warning") return "minor";
  return null;
}

export function extractClashSummary(
  artifacts: Iterable<ExecutionArtifact>,
): ClashSummary | null {
  for (const art of artifacts) {
    if (art.type !== "json") continue;
    const data = (art.data ?? {}) as Record<string, unknown>;
    const meta = (art.metadata ?? {}) as Record<string, unknown>;
    const isClash =
      (typeof meta.catalogueId === "string" && meta.catalogueId === "TR-016") ||
      Array.isArray(data.clashes) ||
      data.clashCount !== undefined ||
      typeof data.severity === "object";
    if (!isClash) continue;

    let total = 0;
    let critical = 0;
    let major = 0;
    let minor = 0;

    // Path 1: explicit severity object
    const sev = data.severity as Record<string, unknown> | undefined;
    if (sev && typeof sev === "object") {
      critical = num(sev.critical) || num(sev.hard) || num(sev.high);
      major = num(sev.major) || num(sev.medium) || num(sev.moderate);
      minor = num(sev.minor) || num(sev.soft) || num(sev.low) || num(sev.warning);
    }

    // Path 2: top-level totalClashes / clashCount
    if (typeof data.totalClashes === "number") total = data.totalClashes;
    else if (typeof data.clashCount === "number") total = data.clashCount;

    // Path 3: walk clash list and tally severity
    const clashes = Array.isArray(data.clashes) ? data.clashes : null;
    if (clashes && clashes.length > 0) {
      total = total || clashes.length;
      // Recompute buckets only when severity object wasn't present
      if (critical === 0 && major === 0 && minor === 0) {
        for (const c of clashes) {
          if (!c || typeof c !== "object") continue;
          const cRec = c as Record<string, unknown>;
          const bucket = bucketize(lower(cRec.severity) || lower(cRec.type));
          if (bucket === "critical") critical++;
          else if (bucket === "major") major++;
          else if (bucket === "minor") minor++;
        }
      }
    }

    // Final reconcile: if we have buckets but no total, sum them
    if (total === 0 && (critical || major || minor)) {
      total = critical + major + minor;
    }

    if (total === 0 && critical === 0 && major === 0 && minor === 0) {
      // Looked like a clash artifact but had no usable counts
      return { total: 0, critical: 0, major: 0, minor: 0, nodeId: art.tileInstanceId };
    }

    return { total, critical, major, minor, nodeId: art.tileInstanceId };
  }

  return null;
}
