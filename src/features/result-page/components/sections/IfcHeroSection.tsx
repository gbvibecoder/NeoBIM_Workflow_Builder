"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Box, Download, ExternalLink } from "lucide-react";

import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";
import { DraftingMarks } from "@/features/result-page/components/aec/DraftingMarks";
import { MonoLabel } from "@/features/result-page/components/aec/MonoLabel";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface IfcHeroSectionProps {
  data: ResultPageData;
}

/**
 * Hero card for the "ifc" hero kind — EX-007 produced a real
 * IFC2X3 file. Surfaces the file as the primary artifact with two
 * prominent CTAs: "Open in IFC Viewer" (in-app 3D viewer) and
 * "Download IFC" (raw R2 download). The PNG previews land below as
 * thumbnails via the existing GeneratedAssetsSection — this card
 * keeps the IFC itself above the fold.
 *
 * Replaces the image-hero / "Concept Renders" failure mode where
 * the .ifc file was hidden because EX-007 used to emit `type:
 * "image"`. Now that EX-007 emits `type: "file"`, the page picks
 * the "ifc" hero kind and renders this component.
 */
export function IfcHeroSection({ data }: IfcHeroSectionProps) {
  const ifc = data.ifcExport;
  // Defensive: the selectHero priority guarantees this is set when
  // the page renders this component, but the type is still nullable.
  if (!ifc) return null;
  const accent = getWorkflowAccent("ifc");
  const reduce = useReducedMotion();

  const bboxLabel = ifc.worldBbox
    ? `${ifc.worldBbox[0].toFixed(2)} × ${ifc.worldBbox[1].toFixed(2)} × ${ifc.worldBbox[2].toFixed(2)} m`
    : null;

  return (
    <motion.section
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        position: "relative",
        background: "#FFFFFF",
        border: `1px solid ${accent.ring}`,
        borderRadius: 16,
        overflow: "hidden",
      }}
      data-testid="ifc-hero-section"
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: accent.stripe,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 80% 0%, ${accent.halo} 0%, transparent 50%)`,
          pointerEvents: "none",
        }}
      />
      <DraftingMarks />

      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 24,
          padding: "32px clamp(20px, 4vw, 40px)",
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <MonoLabel>IFC EXPORT · v3</MonoLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: accent.tint,
                border: `1px solid ${accent.ring}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: accent.base,
                flexShrink: 0,
              }}
            >
              <Box size={22} strokeWidth={1.5} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <h2
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: "#0F172A",
                  margin: 0,
                  letterSpacing: "-0.01em",
                }}
              >
                Your IFC building model is ready
              </h2>
              <div
                style={{
                  fontSize: 13,
                  color: "#475569",
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  wordBreak: "break-all" as const,
                }}
              >
                {ifc.fileName}
              </div>
            </div>
          </div>
        </header>

        <KpiRow ifc={ifc} bboxLabel={bboxLabel} />

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
          }}
        >
          <Link
            href={ifc.ifcViewerUrl}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 20px",
              borderRadius: 10,
              background: accent.base,
              color: "#FFFFFF",
              fontWeight: 600,
              fontSize: 14,
              letterSpacing: "0.01em",
              textDecoration: "none",
              boxShadow: `0 6px 16px ${accent.ring}`,
              transition: "transform 120ms ease, box-shadow 120ms ease",
            }}
            data-testid="ifc-hero-open-viewer"
          >
            <ExternalLink size={16} strokeWidth={2} />
            Open in IFC Viewer
          </Link>
          <a
            href={ifc.downloadUrl}
            download={ifc.fileName}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 18px",
              borderRadius: 10,
              background: "#FFFFFF",
              color: accent.base,
              fontWeight: 600,
              fontSize: 14,
              letterSpacing: "0.01em",
              textDecoration: "none",
              border: `1px solid ${accent.ring}`,
            }}
            data-testid="ifc-hero-download"
          >
            <Download size={16} strokeWidth={2} />
            Download IFC
          </a>
        </div>
      </div>
    </motion.section>
  );
}

interface KpiRowProps {
  ifc: NonNullable<ResultPageData["ifcExport"]>;
  bboxLabel: string | null;
}

function KpiRow({ ifc, bboxLabel }: KpiRowProps) {
  const items: Array<{ label: string; value: string }> = [];
  if (typeof ifc.entityCount === "number" && ifc.entityCount > 0) {
    items.push({ label: "ENTITIES", value: ifc.entityCount.toLocaleString() });
  }
  if (bboxLabel) {
    items.push({ label: "BBOX (W×D×H)", value: bboxLabel });
  }
  if (ifc.lengthUnit) {
    items.push({ label: "UNIT", value: ifc.lengthUnit });
  }
  if (ifc.verdict) {
    items.push({
      label: "VERDICT",
      value: ifc.verdict === "OK" ? "✓ OK" : "✗ FAILED",
    });
  }
  if (items.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 12,
      }}
    >
      {items.map(item => (
        <div
          key={item.label}
          style={{
            background: "#FAFAF8",
            border: "1px solid rgba(15,23,42,0.06)",
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#64748B",
              letterSpacing: "0.10em",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#0F172A",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
