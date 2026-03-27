"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Download, ChevronDown, X, FileText, Image as ImageIcon, Database, BarChart2, Table2, File, LayoutGrid, Box, RefreshCw, Loader2, Video, ArrowRight } from "lucide-react";
import DOMPurify from "dompurify";
import dynamic from "next/dynamic";
import Link from "next/link";
import { formatBytes } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

function ArchitecturalViewerLoader() {
  const { t } = useLocale();
  return <div style={{ height: 400, background: "#0D0D1A", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#3A3A50" }}>{t('artifact.loadingViewer')}</span></div>;
}

function Building3DViewerLoader() {
  const { t } = useLocale();
  return <div style={{ height: 320, background: "#0D0D1A", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#3A3A50" }}>{t('artifact.loading3dViewer')}</span></div>;
}

function VideoBodyLoader() {
  const { t } = useLocale();
  return <div style={{ height: 180, background: "#0D0D1A", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#3A3A50" }}>{t('artifact.loadingVideoPlayer')}</span></div>;
}

const ArchitecturalViewer = dynamic(() => import("./architectural-viewer/ArchitecturalViewer"), {
  ssr: false,
  loading: () => <ArchitecturalViewerLoader />,
});

const Building3DViewer = dynamic(() => import("./Building3DViewer"), {
  ssr: false,
  loading: () => <Building3DViewerLoader />,
});

const VideoBody = dynamic(() => import("./VideoBody").then(m => ({ default: m.VideoBody })), {
  ssr: false,
  loading: () => <VideoBodyLoader />,
});
import type {
  ExecutionArtifact,
  ArtifactType,
  TextArtifactData,
  ImageArtifactData,
  KpiArtifactData,
  TableArtifactData,
  FileArtifactData,
  JsonArtifactData,
  VideoArtifactData,
} from "@/types/execution";
import type { NodeCategory } from "@/types/nodes";
import { CATEGORY_COLORS, hexToRgb } from "@/lib/ui-constants";

// ─── Category → color ────────────────────────────────────────────────────────

const CATEGORY_COLOR = CATEGORY_COLORS;

const TYPE_COLOR: Record<ArtifactType, string> = {
  text:  "#B87333",
  json:  "#00F5FF",
  image: "#B87333",
  kpi:   "#FFBF00",
  table: "#00F5FF",
  file:  "#B87333",
  "3d":  "#FFBF00",
  svg:   "#00F5FF",
  video: "#00F5FF",
  html:  "#00F5FF",
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
  video: <Video size={9} />,
  html:  <Box size={9} />,
};


// ─── Props ────────────────────────────────────────────────────────────────────

// ─── Quality badge config ──────────────────────────────────────────────────

interface QualityBadge {
  label: string;
  color: string;
  bg: string;
}

function getQualityBadge(artifact: ExecutionArtifact, t: (key: TranslationKey) => string): QualityBadge | null {
  const meta = artifact.metadata ?? {};
  const isReal = !!meta.real;
  const isMock = !!meta.mock || meta.source === "mock";

  if (isMock) {
    return { label: t('artifact.sampleData'), color: "#6B7280", bg: "rgba(107,114,128,0.12)" };
  }

  if (artifact.type === "image" && isReal) {
    return { label: t('artifact.aiConcept'), color: "#3B82F6", bg: "rgba(59,130,246,0.12)" };
  }

  if (artifact.type === "table" && isReal) {
    return { label: t('artifact.aiEstimate'), color: "#F59E0B", bg: "rgba(245,158,11,0.12)" };
  }

  if ((artifact.type === "text" || artifact.type === "json" || artifact.type === "kpi") && isReal) {
    return { label: t('artifact.aiReview'), color: "#8B5CF6", bg: "rgba(139,92,246,0.12)" };
  }

  if (artifact.type === "3d" || artifact.type === "svg") {
    return { label: t('artifact.aiConcept'), color: "#3B82F6", bg: "rgba(59,130,246,0.12)" };
  }

  if (artifact.type === "html") {
    return { label: t('artifact.interactiveThreejs'), color: "#00F5FF", bg: "rgba(0,245,255,0.12)" };
  }

  if (artifact.type === "video") {
    const d = artifact.data as Record<string, unknown> | undefined;
    const model = d?.usedOmni === true ? "Kling 3.0 Omni" : "Kling 2.6";
    return { label: `${t('artifact.aiGenerated')} · ${model}`, color: "#00F5FF", bg: "rgba(0,245,255,0.12)" };
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

function ArtifactCardInner({ artifact, nodeLabel, nodeCategory, onDismiss, onRegenerate, regenRemaining, isRegenerating }: ArtifactCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const prefersReduced = useReducedMotion();
  const { t } = useLocale();

  const accentColor = nodeCategory ? CATEGORY_COLOR[nodeCategory] : "#4F8AFF";
  const typeColor   = TYPE_COLOR[artifact.type] ?? "#4F8AFF";
  const rgb         = hexToRgb(accentColor);
  const qualityBadge = getQualityBadge(artifact, t);
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
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
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
            title={regenRemaining !== undefined ? `${t('artifact.regenerate')} (${regenRemaining} ${t('artifact.left')})` : t('artifact.regenerate')}
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
              {artifact.type === "video" && <VideoBody data={artifact.data as VideoArtifactData} nodeId={artifact.tileInstanceId} />}
              {artifact.type === "html"  && <HtmlBody  data={artifact.data as HtmlArtifactData} />}
            </ArtifactErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>

        {/* BOQ Visualizer CTA — shown for table artifacts that contain BOQ data */}
        {!collapsed && artifact.type === "table" && (() => {
          const d = artifact.data as Record<string, unknown> | undefined;
          const hasBOQ = d && (d._boqData || d._totalCost);
          if (!hasBOQ) return null;
          const totalCost = d._totalCost as number | undefined;
          const gfa = d._gfa as number | undefined;
          const region = (d._region as string) || "";
          const costLabel = totalCost && totalCost >= 10000000 ? `₹${(totalCost / 10000000).toFixed(1)} Cr` : totalCost ? `₹${(totalCost / 100000).toFixed(1)} L` : "";
          const subtitle = [costLabel, gfa ? `${gfa.toLocaleString("en-IN")}m²` : "", region].filter(Boolean).join(" · ");
          const execId = artifact.executionId || "demo";
          return (
            <Link href={`/dashboard/results/${execId}/boq`}>
              <div
                style={{
                  margin: "8px 14px 10px",
                  padding: "12px 16px",
                  borderRadius: 10,
                  background: "linear-gradient(135deg, rgba(0,245,255,0.08), rgba(0,245,255,0.03))",
                  border: "1px solid rgba(0,245,255,0.2)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "all 0.2s ease",
                  boxShadow: "0 0 16px rgba(0,245,255,0.06)",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = "rgba(0,245,255,0.4)";
                  e.currentTarget.style.boxShadow = "0 0 24px rgba(0,245,255,0.15)";
                  e.currentTarget.style.background = "linear-gradient(135deg, rgba(0,245,255,0.12), rgba(0,245,255,0.05))";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = "rgba(0,245,255,0.2)";
                  e.currentTarget.style.boxShadow = "0 0 16px rgba(0,245,255,0.06)";
                  e.currentTarget.style.background = "linear-gradient(135deg, rgba(0,245,255,0.08), rgba(0,245,255,0.03))";
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#00F5FF", display: "flex", alignItems: "center", gap: 6 }}>
                    Open BOQ Visualizer
                    <ArrowRight size={13} />
                  </div>
                  {subtitle && (
                    <div style={{ fontSize: 10, color: "#9898B0", marginTop: 2 }}>{subtitle}</div>
                  )}
                </div>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: "rgba(0,245,255,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <BarChart2 size={16} color="#00F5FF" />
                </div>
              </div>
            </Link>
          );
        })()}

        {/* Type-specific disclaimer */}
        {!collapsed && (artifact.type === "table" || artifact.type === "kpi") && !!artifact.metadata?.real && (
          <div style={{ padding: "6px 14px 8px", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <p style={{ fontSize: 9, color: "#4A4A60", fontStyle: "italic", margin: 0 }}>
              {t('artifact.costDisclaimer')}
            </p>
          </div>
        )}
        {!collapsed && artifact.type === "image" && (
          <div style={{ padding: "6px 14px 8px", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <p style={{ fontSize: 9, color: "#4A4A60", fontStyle: "italic", margin: 0 }}>
              {t('artifact.renderDisclaimer')}
            </p>
          </div>
        )}
        {!collapsed && artifact.type === "video" && (
          <div style={{ padding: "6px 14px 8px", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <p style={{ fontSize: 9, color: "#4A4A60", fontStyle: "italic", margin: 0 }}>
              {t('artifact.videoDisclaimer')}
            </p>
          </div>
        )}
    </motion.div>
  );
}

// Functional fallback for error boundary (supports i18n hooks)
function ArtifactErrorFallback({ type }: { type: string }) {
  const { t } = useLocale();
  return (
    <div style={{ padding: "8px 14px", fontSize: 11, color: "#EF4444" }}>
      {t('artifact.unableToRender')} {type} {t('artifact.artifact')}
    </div>
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
      return <ArtifactErrorFallback type={this.props.fallbackType} />;
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
          {projectType} {t('artifact.estimate')} · {t('artifact.aaceClass4')}
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
          {disclaimer || t('artifact.preliminaryEstimate')}
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
  const svgHtml = data?.svg ?? "";
  const sanitizedSvg = useMemo(
    () => (typeof window !== "undefined" ? DOMPurify.sanitize(svgHtml, { USE_PROFILES: { svg: true, svgFilters: true } }) : ""),
    [svgHtml]
  );

  const hasRooms = data?.roomList && data.roomList.length > 0;

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
      {hasRooms && (
        <div style={{ padding: "6px 14px 10px", fontSize: 10, color: "#5C5C78" }}>
          {data.roomList!.length} {t('artifact.rooms')} · {data.totalArea ?? "?"} m² {t('artifact.total')}
          {data.floors ? ` · ${data.floors} ${t('artifact.floors')}` : ""}
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
  style?: import("./architectural-viewer/types").BuildingStyle;
}

function Massing3dBody({ data }: { data: Massing3dData }) {
  const { t } = useLocale();
  const [show3D, setShow3D] = useState(false);

  // SAM 3D / Text-to-3D GLB model — render with Building3DViewer
  const glbData = data as unknown as Record<string, unknown>;
  if (glbData?.glbUrl && typeof glbData.glbUrl === "string") {
    const isTextTo3D = typeof glbData.sourceImageUrl === "string";
    const metaData = glbData.metadata as Record<string, unknown> | undefined;
    const pipeline = metaData?.pipeline as string | undefined;

    return (
      <div style={{ padding: "0 8px 10px 10px" }}>
        {/* Show source image for Text-to-3D pipeline */}
        {isTextTo3D && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#6A6A80", marginBottom: 4, fontWeight: 500 }}>
              {t('artifact.sourceImage')}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={glbData.sourceImageUrl as string}
              alt="Generated source image"
              style={{
                width: "100%",
                height: 160,
                objectFit: "cover",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            />
          </div>
        )}
        <div style={{ fontSize: 10, color: "#6A6A80", marginBottom: 4, fontWeight: 500 }}>
          {isTextTo3D ? t('artifact.model3dSam') : t('artifact.model3d')}
        </div>
        <Building3DViewer glbUrl={glbData.glbUrl as string} height={320} />
        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <a
            href={glbData.glbUrl as string}
            download="model.glb"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10, color: "#4FC3F7", textDecoration: "underline" }}
          >
            {t('artifact.downloadGlb')}
          </a>
          {typeof glbData.plyUrl === "string" && (
            <a
              href={glbData.plyUrl as string}
              download="model.ply"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 10, color: "#4FC3F7", textDecoration: "underline" }}
            >
              {t('artifact.downloadPly')}
            </a>
          )}
        </div>
        <div style={{ fontSize: 9, color: "#4A4A60", fontStyle: "italic", marginTop: 4 }}>
          {pipeline ? `${t('artifact.pipelineLabel')}: ${pipeline}` : t('artifact.generatedViaSam')} · {t('artifact.filesExpire')}
        </div>
      </div>
    );
  }

  if (!data?.floors || !data?.height) {
    return <div style={{ padding: "8px 14px", fontSize: 11, color: "#5C5C78" }}>{t('artifact.noMassing')}</div>;
  }

  return (
    <div style={{ padding: "0 8px 10px 10px" }}>
      {/* Lazy-load 3D viewer — only mount WebGL when user clicks */}
      {show3D ? (
        <ArchitecturalViewer
          floors={data.floors}
          height={data.height}
          footprint={data.footprint ?? 500}
          gfa={data.gfa ?? data.floors * (data.footprint ?? 500)}
          buildingType={data.buildingType}
          style={data.style}
        />
      ) : (
        <button
          onClick={() => setShow3D(true)}
          style={{
            width: "100%", height: 200, borderRadius: 12,
            background: "linear-gradient(145deg, #0D0D1A 0%, #111122 100%)",
            border: "1px solid rgba(184,115,51,0.15)",
            cursor: "pointer",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 12,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "rgba(184,115,51,0.35)";
            e.currentTarget.style.background = "linear-gradient(145deg, #0F0F1E 0%, #131328 100%)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "rgba(184,115,51,0.15)";
            e.currentTarget.style.background = "linear-gradient(145deg, #0D0D1A 0%, #111122 100%)";
          }}
        >
          {/* Isometric building icon */}
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <path d="M14 42 L14 18 L28 10 L28 34 Z" fill="rgba(184,115,51,0.08)" stroke="rgba(184,115,51,0.25)" strokeWidth="0.8" />
            <path d="M28 10 L42 18 L42 42 L28 34 Z" fill="rgba(184,115,51,0.04)" stroke="rgba(184,115,51,0.2)" strokeWidth="0.8" />
            <path d="M14 18 L28 10 L42 18 L28 26 Z" fill="rgba(184,115,51,0.1)" stroke="rgba(184,115,51,0.3)" strokeWidth="0.8" />
            {/* Floor lines */}
            <line x1="14" y1="26" x2="28" y2="18" stroke="rgba(184,115,51,0.12)" strokeWidth="0.5" />
            <line x1="14" y1="34" x2="28" y2="26" stroke="rgba(184,115,51,0.12)" strokeWidth="0.5" />
            <line x1="28" y1="18" x2="42" y2="26" stroke="rgba(184,115,51,0.1)" strokeWidth="0.5" />
            <line x1="28" y1="26" x2="42" y2="34" stroke="rgba(184,115,51,0.1)" strokeWidth="0.5" />
          </svg>

          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: "rgba(184,115,51,0.7)",
              marginBottom: 4, letterSpacing: "0.02em",
            }}>
              <Box size={12} style={{ display: "inline", verticalAlign: "-1px", marginRight: 5 }} />
              {t('artifact.load3dView')}
            </div>
            <div style={{ fontSize: 10, color: "#3A3A50" }}>
              {data.floors}F · {data.height.toFixed(1)}m · {data.footprint} m²
            </div>
          </div>
        </button>
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

// HTML iframe data shape from GN-011 Interactive 3D Viewer
interface HtmlArtifactData {
  html: string;
  width?: string;
  height?: string;
  label?: string;
  fileName?: string;
  downloadUrl?: string;
  mimeType?: string;
  roomCount?: number;
  wallCount?: number;
}

function HtmlBody({ data }: { data: HtmlArtifactData }) {
  const { t } = useLocale();
  const htmlString = data?.html ?? "";
  const downloadUrl = data?.downloadUrl;
  const fileName = data?.fileName ?? "3d-model.html";

  // Use blob URL to bypass parent CSP restrictions on external scripts
  const blobUrl = useMemo(() => {
    if (htmlString) {
      return URL.createObjectURL(new Blob([htmlString], { type: "text/html" }));
    }
    return null;
  }, [htmlString]);
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  return (
    <div style={{ padding: "0 8px 10px 10px" }}>
      {blobUrl ? (
        <iframe
          src={blobUrl}
          style={{
            width: data?.width || "100%",
            height: data?.height || "500px",
            border: "none",
            borderRadius: 8,
            background: "#07070D",
          }}
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
          title={data?.label ?? t('artifact.interactive3dModel')}
        />
      ) : (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#5C5C78", fontSize: 11 }}>
          {t('artifact.noHtmlContent')}
        </div>
      )}
      {/* Download link */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <div style={{ fontSize: 10, color: "#5C5C78" }}>
          {data?.roomCount ? `${data.roomCount} ${t('artifact.rooms')}` : ""}
          {data?.wallCount ? ` · ${data.wallCount} ${t('artifact.walls')}` : ""}
          {!data?.roomCount && !data?.wallCount ? t('artifact.interactive3dModel') : ""}
        </div>
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={fileName}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 6,
              background: "rgba(0,245,255,0.08)",
              border: "1px solid rgba(0,245,255,0.2)",
              fontSize: 10, fontWeight: 500, color: "#00F5FF",
              textDecoration: "none", flexShrink: 0,
            }}
          >
            <Download size={10} />
            {t('artifact.download')} .html
          </a>
        )}
      </div>
    </div>
  );
}

/** Ensure a filename has the correct extension based on file type */
function ensureFileExtension(name: string, fileType?: string): string {
  const typeExtMap: Record<string, string> = {
    "IFC 4": ".ifc",
    "IFC4": ".ifc",
    "IFC 2x3": ".ifc",
    "CSV Spreadsheet": ".csv",
    "Text Report": ".txt",
    "PNG Image": ".png",
    "PDF Report": ".pdf",
  };
  const expectedExt = (fileType && typeExtMap[fileType]) ?? "";
  if (expectedExt && !name.toLowerCase().endsWith(expectedExt)) {
    // Remove any wrong extension and add the correct one
    const dotIdx = name.lastIndexOf(".");
    const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
    return base + expectedExt;
  }
  return name;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  // Use setTimeout to ensure the element is in the DOM before clicking
  setTimeout(() => {
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }, 0);
}

function FileBody({ data }: { data: FileArtifactData }) {
  const { t } = useLocale();

  const handleDownload = useCallback(() => {
    const extData = data as FileArtifactData & { _ifcContent?: string };
    // Ensure filename always has proper extension
    const filename = ensureFileExtension(data?.name ?? "export", data?.type);

    // If we have raw IFC content, create a blob download
    if (extData._ifcContent) {
      const blob = new Blob([extData._ifcContent], { type: "application/x-step" });
      triggerBlobDownload(blob, filename);
      return;
    }

    // If downloadUrl is a data: URI, convert to blob for reliable download
    const downloadUrl = data?.downloadUrl ?? "";
    if (downloadUrl.startsWith("data:")) {
      try {
        const [header, b64] = downloadUrl.split(",");
        const mime = header.split(":")[1]?.split(";")[0] ?? "application/octet-stream";
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime });
        triggerBlobDownload(blob, filename);
        return;
      } catch {
        // Fall through to normal link
      }
    }

    // Normal HTTP URL — use standard link behavior
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  }, [data]);

  // Display a clean filename with proper extension
  const displayName = ensureFileExtension(data?.name ?? "export", data?.type);

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
          {displayName}
        </div>
        <div style={{ fontSize: 10, color: "#5C5C78", marginTop: 2 }}>
          {data?.type} · {formatBytes(data?.size ?? 0)}
        </div>
      </div>
      <button
        onClick={handleDownload}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 10px", borderRadius: 6,
          background: "rgba(0,245,255,0.08)",
          border: "1px solid rgba(0,245,255,0.2)",
          fontSize: 10, fontWeight: 500, color: "#00F5FF",
          cursor: "pointer", flexShrink: 0,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "rgba(0,245,255,0.15)";
          e.currentTarget.style.borderColor = "rgba(0,245,255,0.4)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "rgba(0,245,255,0.08)";
          e.currentTarget.style.borderColor = "rgba(0,245,255,0.2)";
        }}
      >
        <Download size={10} />
        {t('artifact.download')}
      </button>
    </div>
  );
}

export const ArtifactCard = React.memo(ArtifactCardInner);
