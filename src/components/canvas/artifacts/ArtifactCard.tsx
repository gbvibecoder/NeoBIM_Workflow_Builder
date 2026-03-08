"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Download, ChevronDown, X, FileText, Image as ImageIcon, Database, BarChart2, Table2, File, LayoutGrid, Box, RefreshCw, Loader2 } from "lucide-react";
import DOMPurify from "dompurify";
import dynamic from "next/dynamic";

const MassingViewer = dynamic(() => import("./MassingViewer"), {
  ssr: false,
  loading: () => <div style={{ height: 220, background: "#0D0D1A", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#3A3A50" }}>Loading 3D viewer…</span></div>,
});

const FloorPlan3DViewer = dynamic(() => import("./FloorPlan3DViewer"), {
  ssr: false,
  loading: () => <div style={{ height: 400, background: "#07070e", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#3A3A50" }}>Loading 3D viewer…</span></div>,
});

import { formatBytes } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import type {
  ExecutionArtifact,
  ArtifactType,
  TextArtifactData,
  ImageArtifactData,
  KpiArtifactData,
  TableArtifactData,
  FileArtifactData,
  JsonArtifactData,
} from "@/types/execution";
import type { NodeCategory } from "@/types/nodes";

// ─── Category → color ────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<NodeCategory, string> = {
  input:     "#00F5FF",
  transform: "#B87333",
  generate:  "#FFBF00",
  export:    "#4FC3F7",
};

const TYPE_COLOR: Record<ArtifactType, string> = {
  text:  "#B87333",
  json:  "#00F5FF",
  image: "#B87333",
  kpi:   "#FFBF00",
  table: "#00F5FF",
  file:  "#B87333",
  "3d":  "#FFBF00",
  svg:   "#00F5FF",
};

const TYPE_ICON: Record<ArtifactType, React.ReactNode> = {
  text:  <FileText size={9} />,
  json:  <Database size={9} />,
  image: <ImageIcon size={9} />,
  kpi:   <BarChart2 size={9} />,
  table: <Table2 size={9} />,
  file:  <File size={9} />,
  "3d":  <Box size={9} />,
  svg:   <LayoutGrid size={9} />,
};

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

// ─── Quality badge config ──────────────────────────────────────────────────

interface QualityBadge {
  label: string;
  color: string;
  bg: string;
}

function getQualityBadge(artifact: ExecutionArtifact): QualityBadge | null {
  const meta = artifact.metadata ?? {};
  const isReal = !!meta.real;
  const isMock = !!meta.mock || meta.source === "mock";

  if (isMock) {
    return { label: "Sample Data", color: "#6B7280", bg: "rgba(107,114,128,0.12)" };
  }

  if (artifact.type === "image" && isReal) {
    return { label: "AI Generated · Concept", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" };
  }

  if (artifact.type === "table" && isReal) {
    return { label: "AI Estimate · ±15-20%", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" };
  }

  if ((artifact.type === "text" || artifact.type === "json" || artifact.type === "kpi") && isReal) {
    return { label: "AI Generated · Review", color: "#8B5CF6", bg: "rgba(139,92,246,0.12)" };
  }

  if (artifact.type === "3d" || artifact.type === "svg") {
    return { label: "AI Generated · Concept", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" };
  }

  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ArtifactCardProps {
  artifact: ExecutionArtifact;
  nodeLabel?: string;
  nodeCategory?: NodeCategory;
  onDismiss?: () => void;
  onRegenerate?: () => void;
  regenRemaining?: number;
  isRegenerating?: boolean;
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function ArtifactCard({ artifact, nodeLabel, nodeCategory, onDismiss, onRegenerate, regenRemaining, isRegenerating }: ArtifactCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const prefersReduced = useReducedMotion();
  const { t } = useLocale();

  const accentColor = nodeCategory ? CATEGORY_COLOR[nodeCategory] : "#4F8AFF";
  const typeColor   = TYPE_COLOR[artifact.type] ?? "#4F8AFF";
  const rgb         = hexToRgb(accentColor);
  const qualityBadge = getQualityBadge(artifact);
  const canRegenerate = onRegenerate && (regenRemaining === undefined || regenRemaining > 0);

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: prefersReduced ? 0 : 0.15 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32, duration: prefersReduced ? 0 : undefined }}
      style={{
        borderBottom: "1px solid rgba(184,115,51,0.1)",
        borderLeft: `3px solid ${accentColor}`,
        background: "rgba(7,8,9,0.95)",
        backdropFilter: "blur(40px)",
        WebkitBackdropFilter: "blur(40px)",
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        animation: prefersReduced ? "none" : "slide-up 0.4s ease-out",
      }}
    >
      {/* Header */}
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "10px 16px",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {/* Node name */}
        <span style={{
          fontSize: 11, fontWeight: 600, color: "#E0E0EA",
          fontFamily: "'Playfair Display', serif", fontStyle: "italic",
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {nodeLabel ?? t('artifact.nodeOutput')}
        </span>

        {/* Quality badge */}
        {qualityBadge && (
          <span style={{
            display: "flex", alignItems: "center", gap: 3,
            padding: "2px 7px", borderRadius: 6,
            background: qualityBadge.bg,
            fontSize: 8, fontWeight: 600, color: qualityBadge.color,
            letterSpacing: "0.02em",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}>
            {qualityBadge.label}
          </span>
        )}

        {/* Type badge */}
        <span style={{
          display: "flex", alignItems: "center", gap: 3,
          padding: "2px 8px", borderRadius: 6,
          background: `${typeColor}15`,
          fontSize: 9, fontWeight: 700, color: typeColor,
          fontFamily: "'Space Mono', monospace",
          textTransform: "uppercase" as const, letterSpacing: "0.05em",
          flexShrink: 0,
        }}>
          {TYPE_ICON[artifact.type]}
          {artifact.type}
        </span>

        {/* Regenerate button */}
        {canRegenerate && (
          <button
            onClick={e => { e.stopPropagation(); onRegenerate!(); }}
            disabled={isRegenerating}
            title={regenRemaining !== undefined ? `Regenerate (${regenRemaining} left)` : "Regenerate"}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "3px 8px", borderRadius: 6,
              background: isRegenerating ? "rgba(79,138,255,0.15)" : "rgba(79,138,255,0.08)",
              border: "1px solid rgba(79,138,255,0.2)",
              fontSize: 9, fontWeight: 600, color: "#4F8AFF",
              cursor: isRegenerating ? "not-allowed" : "pointer",
              flexShrink: 0,
              transition: "all 0.15s ease",
              opacity: isRegenerating ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!isRegenerating) { e.currentTarget.style.background = "rgba(79,138,255,0.15)"; e.currentTarget.style.borderColor = "rgba(79,138,255,0.4)"; } }}
            onMouseLeave={e => { if (!isRegenerating) { e.currentTarget.style.background = "rgba(79,138,255,0.08)"; e.currentTarget.style.borderColor = "rgba(79,138,255,0.2)"; } }}
          >
            {isRegenerating ? <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={9} />}
            {regenRemaining !== undefined ? `${regenRemaining}` : ""}
          </button>
        )}

        {/* Chevron */}
        <motion.div
          animate={{ rotate: collapsed ? -90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ color: "rgba(184,115,51,0.4)", display: "flex", flexShrink: 0 }}
        >
          <ChevronDown size={12} />
        </motion.div>

        {/* Dismiss */}
        {onDismiss && (
          <button
            onClick={e => { e.stopPropagation(); onDismiss(); }}
            aria-label={t('artifact.dismiss')}
            style={{
              width: 16, height: 16, borderRadius: 3, flexShrink: 0,
              background: "transparent", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#3A3A50", cursor: "pointer",
              transition: "color 0.1s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#EF4444"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
          >
            <X size={10} />
          </button>
        )}
      </div>

      {/* Body (collapsible) */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <ArtifactErrorBoundary fallbackType={artifact.type}>
              {artifact.type === "text"  && <TextBody  data={artifact.data as TextArtifactData}  />}
              {artifact.type === "json"  && <JsonBody  data={artifact.data as JsonArtifactData}  />}
              {artifact.type === "image" && <ImageBody data={artifact.data as ImageArtifactData} />}
              {artifact.type === "kpi"   && <KpiBody   data={artifact.data as KpiArtifactData}   accentColor={accentColor} />}
              {artifact.type === "table" && <TableBody data={artifact.data as TableArtifactData} />}
              {artifact.type === "file"  && <FileBody  data={artifact.data as FileArtifactData}  />}
              {artifact.type === "svg"   && <SvgBody   data={artifact.data as SvgArtifactData}   />}
              {artifact.type === "3d"    && <Massing3dBody data={artifact.data as Massing3dData} />}
            </ArtifactErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>

        {/* Type-specific disclaimer */}
        {!collapsed && (artifact.type === "table" || artifact.type === "kpi") && !!artifact.metadata?.real && (
          <div style={{ padding: "6px 14px 8px", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <p style={{ fontSize: 9, color: "#4A4A60", fontStyle: "italic", margin: 0 }}>
              Cost estimates are approximate, based on regional averages.
            </p>
          </div>
        )}
        {!collapsed && artifact.type === "image" && (
          <div style={{ padding: "6px 14px 8px", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <p style={{ fontSize: 9, color: "#4A4A60", fontStyle: "italic", margin: 0 }}>
              AI-generated concept visualization. Not architecturally accurate.
            </p>
          </div>
        )}
    </motion.div>
  );
}

// Error boundary for class-based catch
class ArtifactErrorBoundary extends React.Component<
  { children: React.ReactNode; fallbackType: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallbackType: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "8px 14px", fontSize: 11, color: "#EF4444" }}>
          Unable to render {this.props.fallbackType} artifact
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Body renderers ───────────────────────────────────────────────────────────

function TextBody({ data }: { data: TextArtifactData }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const text = data?.content ?? "";
  const isLong = text.length > 220;
  const display = isLong && !expanded ? text.slice(0, 220) + "…" : text;

  return (
    <div style={{ padding: "0 12px 10px 14px" }}>
      <p style={{
        fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6,
        fontFamily: "'Space Mono', monospace", fontStyle: "italic",
        borderLeft: "2px solid rgba(184,115,51,0.3)", paddingLeft: "10px",
        whiteSpace: "pre-wrap", margin: 0,
      }}>
        {display}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            marginTop: 6, background: "none", border: "none",
            fontSize: 10, color: "#00F5FF", cursor: "pointer", padding: 0,
          }}
        >
          {expanded ? t('artifact.showLess') : t('artifact.showMore')}
        </button>
      )}
    </div>
  );
}

function JsonBody({ data }: { data: JsonArtifactData }) {
  const json = JSON.stringify(data?.json, null, 2);
  return (
    <div style={{
      margin: "0 12px 10px 14px",
      background: "rgba(0,0,0,0.3)", borderRadius: 6, overflow: "auto",
      maxHeight: 180, padding: "8px 10px",
    }}>
      <pre style={{ fontSize: 10, color: "#00F5FF", margin: 0, fontFamily: "monospace", lineHeight: 1.5 }}>
        {json}
      </pre>
    </div>
  );
}

function ImageBody({ data }: { data: ImageArtifactData }) {
  const { t } = useLocale();
  return (
    <div>
      <div style={{ position: "relative", height: 160, background: "#07070D" }}>
        {data?.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={data.url}
            alt={data.label ?? "Artifact image"}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <span style={{ fontSize: 11, color: "#5C5C78" }}>{t('artifact.noPreview')}</span>
          </div>
        )}
      </div>
      {data?.style && (
        <div style={{ padding: "6px 14px 10px", fontSize: 10, color: "#5C5C78" }}>
          {data.style}
        </div>
      )}
    </div>
  );
}

function KpiBody({ data, accentColor }: { data: KpiArtifactData; accentColor: string }) {
  const rgb = hexToRgb(accentColor);
  const metrics = data?.metrics ?? [];
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: metrics.length > 2 ? "1fr 1fr" : "1fr",
      gap: 6, padding: "0 12px 10px 14px",
    }}>
      {metrics.map((m, i) => (
        <div key={i} style={{
          background: `rgba(${rgb}, 0.06)`,
          border: `1px solid rgba(${rgb}, 0.12)`,
          borderRadius: 7, padding: "8px 10px",
        }}>
          <div style={{
            fontSize: 20, fontWeight: 700, color: accentColor, fontFamily: "'Space Mono', monospace", lineHeight: 1.1,
          }}>
            {m.value}
            {m.unit && <span style={{ fontSize: 12, fontWeight: 400, color: "#5C5C78", marginLeft: 4 }}>{m.unit}</span>}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, fontFamily: "'Space Mono', monospace", textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
            {m.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function TableBody({ data }: { data: TableArtifactData }) {
  const { t } = useLocale();
  const headers = data?.headers ?? [];
  const rows = data?.rows ?? [];
  const isWide = headers.length > 6;
  const ext = data as unknown as Record<string, unknown>;
  const summary = ext?.summary as { grandTotal?: number; currency?: string; note?: string } | undefined;
  const content = ext?.content as string | undefined;
  const totalCost = ext?._totalCost as number | undefined;
  const disclaimer = ext?._disclaimer as string | undefined;
  const projectType = ext?._projectType as string | undefined;

  // For wide tables (BOQ with waste/M-L-E), show key columns
  const displayHeaders = isWide
    ? [headers[0], headers[2], headers[3], headers[4], headers[headers.length - 1]]
    : headers;
  const displayRows = isWide
    ? rows.map(row => [row[0], row[2], row[3], row[4], row[row.length - 1]])
    : rows;

  const isCostTable = !!(totalCost || disclaimer || (summary?.grandTotal != null));
  const grandTotal = totalCost ?? summary?.grandTotal;

  return (
    <div style={{ margin: "0 0 10px" }}>
      {/* Project type badge for cost tables */}
      {isCostTable && projectType && (
        <div style={{ padding: "4px 14px 2px", fontSize: 9, color: "#F59E0B", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {projectType} estimate · AACE Class 4
        </div>
      )}
      <div style={{ overflow: "auto", maxHeight: 200 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ background: "rgba(184,115,51,0.05)", position: "sticky", top: 0, zIndex: 1 }}>
              {displayHeaders.map((h, i) => (
                <th key={i} style={{
                  padding: "5px 10px", textAlign: i >= 3 ? "right" : "left",
                  color: "rgba(184,115,51,0.6)", fontWeight: 600, whiteSpace: "nowrap",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(184,115,51,0.05)",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(30,30,46,0.5)" }}>
                {row.map((cell, j) => (
                  <td key={j} style={{
                    padding: "5px 10px", color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap",
                    textAlign: j >= 3 ? "right" : "left",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Footer: totals + line count */}
      {(grandTotal != null || content) && (
        <div style={{
          padding: "6px 14px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 10,
        }}>
          <span style={{ color: "#5C5C78" }}>
            {rows.length} {t('artifact.lineItems')}{summary?.note ? ` · ${summary.note}` : ""}
          </span>
          {grandTotal != null && (
            <span style={{ color: "#FFBF00", fontWeight: 700 }}>
              {t('artifact.grandTotal')}: ${grandTotal.toLocaleString()}
            </span>
          )}
        </div>
      )}
      {/* Professional disclaimer for cost estimates */}
      {isCostTable && (
        <div style={{
          padding: "5px 14px 8px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          fontSize: 8.5,
          color: "#4A4A62",
          lineHeight: 1.5,
          fontStyle: "italic",
        }}>
          {disclaimer || "Preliminary estimate (±15-20% accuracy). Based on RSMeans 2024/2025. Valid 90 days. Not for contract pricing."}
        </div>
      )}
    </div>
  );
}

// SVG data shape from GN-004 floor plan generator
interface SvgArtifactData {
  svg: string;
  label?: string;
  roomList?: Array<{ name: string; area: number; unit: string }>;
  totalArea?: number;
  floors?: number;
}

function SvgBody({ data }: { data: SvgArtifactData }) {
  const { t } = useLocale();
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const svgHtml = data?.svg ?? "";
  const sanitizedSvg = useMemo(
    () => (typeof window !== "undefined" ? DOMPurify.sanitize(svgHtml, { USE_PROFILES: { svg: true, svgFilters: true } }) : ""),
    [svgHtml]
  );

  const hasRooms = data?.roomList && data.roomList.length > 0;

  return (
    <div>
      {/* View mode toggle */}
      {hasRooms && (
        <div style={{
          display: "flex",
          gap: 4,
          padding: "6px 12px 6px 14px",
        }}>
          <button
            onClick={() => setViewMode("2d")}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              background: viewMode === "2d" ? "rgba(0,245,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${viewMode === "2d" ? "rgba(0,245,255,0.3)" : "rgba(255,255,255,0.08)"}`,
              color: viewMode === "2d" ? "#00F5FF" : "#5C5C78",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            2D Plan
          </button>
          <button
            onClick={() => setViewMode("3d")}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              background: viewMode === "3d" ? "rgba(255,191,0,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${viewMode === "3d" ? "rgba(255,191,0,0.3)" : "rgba(255,255,255,0.08)"}`,
              color: viewMode === "3d" ? "#FFBF00" : "#5C5C78",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            View in 3D
          </button>
        </div>
      )}

      {viewMode === "2d" ? (
        <>
          <div
            style={{
              background: "#FAFAFA",
              borderRadius: 0,
              overflow: "auto",
              maxHeight: 240,
              padding: 4,
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
          {hasRooms && (
            <div style={{ padding: "6px 14px 10px", fontSize: 10, color: "#5C5C78" }}>
              {data.roomList!.length} {t('artifact.rooms')} · {data.totalArea ?? "?"} m² {t('artifact.total')}
              {data.floors ? ` · ${data.floors} ${t('artifact.floors')}` : ""}
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: "0 8px 10px 10px" }}>
          <FloorPlan3DViewer
            rooms={data.roomList!.map(r => ({
              name: r.name,
              area: r.area,
            }))}
            floors={data.floors}
            buildingHeight={data.floors ? data.floors * 3.2 : undefined}
          />
        </div>
      )}
    </div>
  );
}

// 3D massing data shape from GN-001
interface Massing3dData {
  floors: number;
  height: number;
  footprint: number;
  gfa: number;
  buildingType?: string;
  metrics?: Array<{ label: string; value: string | number; unit?: string }>;
}

function Massing3dBody({ data }: { data: Massing3dData }) {
  const { t } = useLocale();
  const [viewMode, setViewMode] = useState<"massing" | "floorplan">("massing");

  if (!data?.floors || !data?.height) {
    return <div style={{ padding: "8px 14px", fontSize: 11, color: "#5C5C78" }}>{t('artifact.noMassing')}</div>;
  }

  // Generate rooms from massing data for floor plan view
  const massingRooms = useMemo(() => {
    const fp = data.footprint ?? 500;
    const perFloor = fp * 0.85; // usable area
    const isMixed = data.buildingType?.toLowerCase().includes("mixed");
    if (isMixed) {
      return [
        { name: "Retail Space", area: Math.round(fp * 0.6), type: "retail" },
        { name: "Living Room", area: Math.round(perFloor * 0.3), type: "living" },
        { name: "Bedroom 1", area: Math.round(perFloor * 0.18), type: "bedroom" },
        { name: "Bedroom 2", area: Math.round(perFloor * 0.14), type: "bedroom" },
        { name: "Kitchen", area: Math.round(perFloor * 0.15), type: "kitchen" },
        { name: "Bathroom", area: Math.round(perFloor * 0.08), type: "bathroom" },
        { name: "Hallway", area: Math.round(perFloor * 0.15), type: "hallway" },
      ];
    }
    return [
      { name: "Living Room", area: Math.round(perFloor * 0.3), type: "living" },
      { name: "Bedroom 1", area: Math.round(perFloor * 0.2), type: "bedroom" },
      { name: "Bedroom 2", area: Math.round(perFloor * 0.15), type: "bedroom" },
      { name: "Kitchen", area: Math.round(perFloor * 0.15), type: "kitchen" },
      { name: "Bathroom", area: Math.round(perFloor * 0.08), type: "bathroom" },
      { name: "Hallway", area: Math.round(perFloor * 0.12), type: "hallway" },
    ];
  }, [data.footprint, data.buildingType]);

  return (
    <div style={{ padding: "0 8px 10px 10px" }}>
      {/* Toggle buttons */}
      <div style={{
        display: "flex",
        gap: 4,
        marginBottom: 6,
      }}>
        <button
          onClick={() => setViewMode("massing")}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            background: viewMode === "massing" ? "rgba(184,115,51,0.15)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${viewMode === "massing" ? "rgba(184,115,51,0.3)" : "rgba(255,255,255,0.08)"}`,
            color: viewMode === "massing" ? "#B87333" : "#5C5C78",
            fontSize: 10,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          Massing
        </button>
        <button
          onClick={() => setViewMode("floorplan")}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            background: viewMode === "floorplan" ? "rgba(255,191,0,0.15)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${viewMode === "floorplan" ? "rgba(255,191,0,0.3)" : "rgba(255,255,255,0.08)"}`,
            color: viewMode === "floorplan" ? "#FFBF00" : "#5C5C78",
            fontSize: 10,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          Floor Plan 3D
        </button>
      </div>

      {viewMode === "massing" ? (
        <MassingViewer
          floors={data.floors}
          height={data.height}
          footprint={data.footprint ?? 500}
          gfa={data.gfa ?? data.floors * (data.footprint ?? 500)}
          buildingType={data.buildingType}
        />
      ) : (
        <FloorPlan3DViewer
          rooms={massingRooms}
          floors={data.floors}
          buildingHeight={data.height}
        />
      )}

      {data.metrics && data.metrics.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          gap: 4, marginTop: 6,
        }}>
          {data.metrics.slice(0, 6).map((m, i) => (
            <div key={i} style={{
              background: "rgba(184,115,51,0.08)",
              border: "1px solid rgba(184,115,51,0.15)",
              borderRadius: 5, padding: "5px 7px", textAlign: "center",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F5", lineHeight: 1.1 }}>
                {m.value}
                {m.unit && <span style={{ fontSize: 8, fontWeight: 400, color: "#5C5C78", marginLeft: 2 }}>{m.unit}</span>}
              </div>
              <div style={{ fontSize: 8, color: "#5C5C78", marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.3px" }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileBody({ data }: { data: FileArtifactData }) {
  const { t } = useLocale();
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 10, padding: "0 12px 10px 14px",
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 11, fontWeight: 500, color: "#F0F0F5",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {data?.name}
        </div>
        <div style={{ fontSize: 10, color: "#5C5C78", marginTop: 2 }}>
          {data?.type} · {formatBytes(data?.size ?? 0)}
        </div>
      </div>
      <a
        href={data?.downloadUrl}
        download={data?.name}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 10px", borderRadius: 6,
          background: "rgba(0,245,255,0.08)",
          border: "1px solid rgba(0,245,255,0.2)",
          fontSize: 10, fontWeight: 500, color: "#00F5FF",
          textDecoration: "none", flexShrink: 0,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLAnchorElement).style.background = "rgba(0,245,255,0.15)";
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(0,245,255,0.4)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLAnchorElement).style.background = "rgba(0,245,255,0.08)";
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(0,245,255,0.2)";
        }}
      >
        <Download size={10} />
        {t('artifact.download')}
      </a>
    </div>
  );
}
