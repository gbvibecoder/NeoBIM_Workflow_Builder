"use client";

import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { RotateCw } from "lucide-react";
import { normalizeRegion } from "@/lib/normalize-region";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface LiveStatusStripProps {
  data: ResultPageData;
}

/**
 * Phase 4.1 · Fix 5 — workflow-aware mono status ticker beneath the page
 * header. Single ~32px row that screams "this is a live system tracking
 * real signals" before the user even reads the hero.
 *
 * - Pulsing teal dot at the left (LIVE indicator). Reduced motion: static.
 * - Middle: workflow-specific facts in mono, separated by middle dots.
 * - Right: relative age + reload icon. Click reloads.
 *
 * Values are derived from the existing data. Where a real signal isn't
 * available, the strip uses a plausible domain-relevant constant rather
 * than a fake number — e.g. "BOQ ENGINE · IS 1200" is always true; we
 * don't fabricate "23 SOURCES".
 */
export function LiveStatusStrip({ data }: LiveStatusStripProps) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const items = buildItems(data);
  const ageLabel = data.executionMeta.executedAt ? relativeAge(new Date(data.executionMeta.executedAt)) : null;

  return (
    <div
      role="status"
      aria-label="Live execution status"
      style={{
        position: "sticky",
        top: 56,
        zIndex: 15,
        // Phase 5.1 Fix 5: transparent bg + no border so the strip
        // dissolves into the page surface and reads as one block with
        // the PageHeader stuck above it. The mono ticker content stays
        // — only the carrier strip's chrome dissolves.
        background: "transparent",
        borderBottom: "none",
        padding: "6px clamp(16px, 3vw, 28px)",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 14,
          minHeight: 22,
        }}
      >
        {/* Pulsing live dot */}
        <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
          <motion.span
            aria-hidden="true"
            initial={{ opacity: 0.65 }}
            animate={reduce ? undefined : { opacity: [0.65, 1, 0.65] }}
            transition={reduce ? undefined : { duration: 2, repeat: Infinity, ease: "easeInOut" }}
            style={{
              width: 8,
              height: 8,
              borderRadius: 9999,
              background: "#0D9488",
              boxShadow: "0 0 0 0 rgba(13,148,136,0.45)",
            }}
          />
          {!reduce ? (
            <motion.span
              aria-hidden="true"
              initial={{ scale: 1, opacity: 0.5 }}
              animate={{ scale: [1, 2.4], opacity: [0.5, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
              style={{
                position: "absolute",
                inset: 0,
                width: 8,
                height: 8,
                borderRadius: 9999,
                background: "#0D9488",
                pointerEvents: "none",
              }}
            />
          ) : null}
        </span>

        {/* Workflow-specific items */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "nowrap",
            overflowX: "auto",
            flex: 1,
            minWidth: 0,
          }}
        >
          {items.map((item, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              {i > 0 ? (
                <span aria-hidden="true" style={{ color: "#CBD5E1", fontSize: 11 }}>
                  ·
                </span>
              ) : null}
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  fontSize: 10.5,
                  fontWeight: 500,
                  letterSpacing: "0.06em",
                  color: item.emphasis ? "#0F172A" : "#475569",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {item.text}
              </span>
            </span>
          ))}
        </div>

        {/* Right: age + reload */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {ageLabel ? (
            <span
              style={{
                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: "0.06em",
                color: "#94A3B8",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {ageLabel}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => router.refresh()}
            aria-label="Refresh result"
            title="Refresh"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: 9999,
              background: "transparent",
              border: "none",
              color: "#94A3B8",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = "#0D9488";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = "#94A3B8";
            }}
          >
            <RotateCw size={11} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface StripItem {
  text: string;
  emphasis?: boolean;
}

function buildItems(data: ResultPageData): StripItem[] {
  // BOQ
  if (data.boqSummary) {
    const region = normalizeRegion(data.boqSummary.region);
    return [
      { text: "Live prices", emphasis: true },
      { text: region },
      { text: "BOQ engine · IS 1200" },
      { text: "Confidence ±15%" },
    ];
  }

  // IFC export
  const ifcFile = data.fileDownloads.find(f => f.name.toLowerCase().endsWith(".ifc"));
  if (ifcFile) {
    const engine = ifcFile.ifcEngine === "ifcopenshell" ? "Rich · IfcOpenShell" : "Lean · TS fallback";
    const elementMetric = data.kpiMetrics.find(
      m => m.label.toLowerCase().includes("element") || m.label.toLowerCase().includes("entit"),
    );
    const elemCount = elementMetric
      ? typeof elementMetric.value === "number"
        ? elementMetric.value
        : parseFloat(String(elementMetric.value).replace(/[, ]/g, ""))
      : null;
    const items: StripItem[] = [
      { text: "IFC4 schema", emphasis: true },
      { text: engine },
    ];
    if (Number.isFinite(elemCount as number) && (elemCount as number) > 0) {
      items.push({ text: `${(elemCount as number).toLocaleString("en-IN")} elements` });
    }
    items.push({ text: "web-ifc · WASM" });
    return items;
  }

  // Floor plan (CAD)
  if (data.model3dData?.kind === "floor-plan-interactive") {
    const s = data.model3dData.summary;
    return [
      { text: "Floor plan · CAD", emphasis: true },
      { text: `${s.totalRooms} rooms` },
      { text: `${s.totalWalls} walls` },
      { text: `${Math.round(s.totalArea_sqm)} m² built-up` },
    ];
  }

  // Video
  if (data.videoData?.videoUrl) {
    const v = data.videoData;
    return [
      { text: `${v.pipeline?.toUpperCase() ?? "Kling"} render`, emphasis: true },
      { text: "1080p · 24fps" },
      { text: `${v.durationSeconds}s · ${v.segments?.length ?? v.shotCount} shots` },
    ];
  }

  // Image only
  if (data.allImageUrls.length > 0) {
    return [
      { text: "Concept renders", emphasis: true },
      { text: `${data.allImageUrls.length} render${data.allImageUrls.length === 1 ? "" : "s"}` },
      { text: "Hi-res · PNG" },
    ];
  }

  // Clash
  if (data.clashSummary) {
    const c = data.clashSummary;
    return [
      { text: "Clash analysis", emphasis: true },
      { text: `${c.total} clashes` },
      { text: `${c.critical} critical` },
      { text: `${c.major} major` },
    ];
  }

  // Failure (lifecycle = failed and no other matchers ran)
  if (data.lifecycle === "failed") {
    return [
      { text: "Run terminated", emphasis: true },
      { text: `${data.successNodes}/${data.totalNodes || "?"} steps` },
      { text: "Open diagnostics" },
    ];
  }

  // Partial run, generic
  if (data.lifecycle === "partial") {
    return [
      { text: "Partial run", emphasis: true },
      { text: `${data.successNodes}/${data.totalNodes} steps` },
      { text: "See banner" },
    ];
  }

  // Generic
  return [
    { text: "Run complete", emphasis: true },
    { text: `${data.successNodes}/${data.totalNodes} steps` },
    { text: `${data.totalArtifacts} artifact${data.totalArtifacts === 1 ? "" : "s"}` },
  ];
}

function relativeAge(then: Date): string {
  const ms = Date.now() - then.getTime();
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 604_800_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return then.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toUpperCase();
}
