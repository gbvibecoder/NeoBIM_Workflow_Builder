"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Download, ChevronDown, X, FileText, Image as ImageIcon, Database, BarChart2, Table2, File, LayoutGrid, Box } from "lucide-react";
import DOMPurify from "dompurify";
import dynamic from "next/dynamic";

const MassingViewer = dynamic(() => import("./MassingViewer"), {
  ssr: false,
  loading: () => <div style={{ height: 220, background: "#0D0D1A", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#3A3A50" }}>Loading 3D viewer…</span></div>,
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
  input:     "#3B82F6",
  transform: "#8B5CF6",
  generate:  "#10B981",
  export:    "#F59E0B",
};

const TYPE_COLOR: Record<ArtifactType, string> = {
  text:  "#4F8AFF",
  json:  "#10B981",
  image: "#8B5CF6",
  kpi:   "#F59E0B",
  table: "#06B6D4",
  file:  "#F59E0B",
  "3d":  "#F59E0B",
  svg:   "#10B981",
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

interface ArtifactCardProps {
  artifact: ExecutionArtifact;
  nodeLabel?: string;
  nodeCategory?: NodeCategory;
  onDismiss?: () => void;
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function ArtifactCard({ artifact, nodeLabel, nodeCategory, onDismiss }: ArtifactCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const prefersReduced = useReducedMotion();
  const { t } = useLocale();

  const accentColor = nodeCategory ? CATEGORY_COLOR[nodeCategory] : "#4F8AFF";
  const typeColor   = TYPE_COLOR[artifact.type] ?? "#4F8AFF";
  const rgb         = hexToRgb(accentColor);

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: prefersReduced ? 0 : 0.15 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32, duration: prefersReduced ? 0 : undefined }}
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        borderLeft: `3px solid ${accentColor}`,
        background: "rgba(12,12,24,0.95)",
        backdropFilter: "blur(32px) saturate(1.3)",
        WebkitBackdropFilter: "blur(32px) saturate(1.3)",
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)",
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
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {nodeLabel ?? t('artifact.nodeOutput')}
        </span>

        {/* Type badge */}
        <span style={{
          display: "flex", alignItems: "center", gap: 3,
          padding: "2px 8px", borderRadius: 6,
          background: `${typeColor}15`,
          fontSize: 9, fontWeight: 700, color: typeColor,
          textTransform: "uppercase" as const, letterSpacing: "0.05em",
          flexShrink: 0,
        }}>
          {TYPE_ICON[artifact.type]}
          {artifact.type}
        </span>

        {/* Chevron */}
        <motion.div
          animate={{ rotate: collapsed ? -90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ color: "#3A3A50", display: "flex", flexShrink: 0 }}
        >
          <ChevronDown size={12} />
        </motion.div>

        {/* Dismiss */}
        {onDismiss && (
          <button
            onClick={e => { e.stopPropagation(); onDismiss(); }}
            aria-label="Dismiss"
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
        fontSize: 11, color: "#8888A0", lineHeight: 1.6,
        whiteSpace: "pre-wrap", margin: 0,
      }}>
        {display}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            marginTop: 6, background: "none", border: "none",
            fontSize: 10, color: "#4F8AFF", cursor: "pointer", padding: 0,
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
      <pre style={{ fontSize: 10, color: "#10B981", margin: 0, fontFamily: "monospace", lineHeight: 1.5 }}>
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
            fontSize: 20, fontWeight: 700, color: "#F0F0F5", lineHeight: 1.1,
          }}>
            {m.value}
            {m.unit && <span style={{ fontSize: 12, fontWeight: 400, color: "#5C5C78", marginLeft: 4 }}>{m.unit}</span>}
          </div>
          <div style={{ fontSize: 10, color: "#3a3a50", marginTop: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
            {m.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function TableBody({ data }: { data: TableArtifactData }) {
  const headers = data?.headers ?? [];
  const rows = data?.rows ?? [];
  const isWide = headers.length > 6;
  const summary = (data as unknown as Record<string, unknown>)?.summary as { grandTotal?: number; currency?: string; note?: string } | undefined;
  const content = (data as unknown as Record<string, unknown>)?.content as string | undefined;

  // For wide tables (BOQ), show simplified 5-column view
  const displayHeaders = isWide
    ? [headers[0], headers[2], headers[3], headers[4], headers[headers.length - 1]]
    : headers;
  const displayRows = isWide
    ? rows.map(row => [row[0], row[2], row[3], row[4], row[row.length - 1]])
    : rows;

  return (
    <div style={{ margin: "0 0 10px" }}>
      <div style={{ overflow: "auto", maxHeight: 200 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ background: "rgba(0,0,0,0.3)", position: "sticky", top: 0, zIndex: 1 }}>
              {displayHeaders.map((h, i) => (
                <th key={i} style={{
                  padding: "5px 10px", textAlign: i >= 3 ? "right" : "left",
                  color: "#5C5C78", fontWeight: 600, whiteSpace: "nowrap",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(0,0,0,0.3)",
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
                    padding: "5px 10px", color: "#8888A0", whiteSpace: "nowrap",
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
      {(summary?.grandTotal != null || content) && (
        <div style={{
          padding: "6px 14px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 10,
        }}>
          <span style={{ color: "#5C5C78" }}>
            {rows.length} line items{summary?.note ? ` · ${summary.note}` : ""}
          </span>
          {summary?.grandTotal != null && (
            <span style={{ color: "#10B981", fontWeight: 700 }}>
              Grand Total: ${summary.grandTotal.toLocaleString()}
            </span>
          )}
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
  const svgHtml = data?.svg ?? "";
  const sanitizedSvg = useMemo(
    () => (typeof window !== "undefined" ? DOMPurify.sanitize(svgHtml, { USE_PROFILES: { svg: true, svgFilters: true } }) : ""),
    [svgHtml]
  );

  return (
    <div>
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
      {data?.roomList && data.roomList.length > 0 && (
        <div style={{ padding: "6px 14px 10px", fontSize: 10, color: "#5C5C78" }}>
          {data.roomList.length} rooms · {data.totalArea ?? "?"} m² total
          {data.floors ? ` · ${data.floors} floors` : ""}
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
  if (!data?.floors || !data?.height) {
    return <div style={{ padding: "8px 14px", fontSize: 11, color: "#5C5C78" }}>{t('artifact.noMassing')}</div>;
  }
  return (
    <div style={{ padding: "0 8px 10px 10px" }}>
      <MassingViewer
        floors={data.floors}
        height={data.height}
        footprint={data.footprint ?? 500}
        gfa={data.gfa ?? data.floors * (data.footprint ?? 500)}
        buildingType={data.buildingType}
      />
      {data.metrics && data.metrics.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          gap: 4, marginTop: 6,
        }}>
          {data.metrics.slice(0, 6).map((m, i) => (
            <div key={i} style={{
              background: "rgba(79,138,255,0.06)",
              border: "1px solid rgba(79,138,255,0.1)",
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
          background: "rgba(79,138,255,0.08)",
          border: "1px solid rgba(79,138,255,0.2)",
          fontSize: 10, fontWeight: 500, color: "#4F8AFF",
          textDecoration: "none", flexShrink: 0,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLAnchorElement).style.background = "rgba(79,138,255,0.15)";
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(79,138,255,0.4)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLAnchorElement).style.background = "rgba(79,138,255,0.08)";
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(79,138,255,0.2)";
        }}
      >
        <Download size={10} />
        Download
      </a>
    </div>
  );
}
