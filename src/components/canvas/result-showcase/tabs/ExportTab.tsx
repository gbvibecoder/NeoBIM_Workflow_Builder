"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import {
  FileDown, Film, File, Download, Package, Image as ImageIcon,
  FileText, Table2, Code2, Layers, CheckCircle, Loader2,
} from "lucide-react";
import { useExecutionStore } from "@/stores/execution-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import { formatBytes } from "@/lib/utils";
import { COLORS } from "../constants";
import type { ShowcaseData } from "../useShowcaseData";

interface ExportTabProps {
  data: ShowcaseData;
}

export function ExportTab({ data }: ExportTabProps) {
  const { t } = useLocale();
  const artifacts = useExecutionStore(s => s.artifacts);
  const nodes = useWorkflowStore(s => s.nodes);
  const [generating, setGenerating] = useState<string | null>(null);

  // ─── PDF Generation ─────────────────────────────────────────────────
  const handleGeneratePDF = useCallback(async () => {
    setGenerating("pdf");
    try {
      const { generatePDFReport } = await import("@/services/pdf-report");
      const labels = new Map<string, string>();
      nodes.forEach(n => labels.set(n.id, n.data.label));
      await generatePDFReport({
        workflowName: data.projectTitle,
        artifacts,
        nodeLabels: labels,
      });
    } finally {
      setGenerating(null);
    }
  }, [artifacts, nodes, data.projectTitle]);

  // ─── CSV Export ─────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    setGenerating("csv");
    try {
      data.tableData.forEach((table, idx) => {
        const csvRows = [
          table.headers.join(","),
          ...table.rows.map(row =>
            row.map(cell => {
              const str = String(cell);
              return str.includes(",") || str.includes('"')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            }).join(",")
          ),
        ];
        const csvContent = csvRows.join("\n");
        downloadBlob(csvContent, `${table.label ?? `table_${idx + 1}`}.csv`, "text/csv");
      });
    } finally {
      setGenerating(null);
    }
  }, [data.tableData]);

  // ─── JSON Export ────────────────────────────────────────────────────
  const handleExportJSON = useCallback(() => {
    setGenerating("json");
    try {
      const exportData = {
        project: data.projectTitle,
        exportedAt: new Date().toISOString(),
        kpis: data.kpiMetrics,
        tables: data.tableData,
        jsonData: data.jsonData,
        pipeline: data.pipelineSteps,
        costBreakdown: data.costBreakdown,
        complianceItems: data.complianceItems,
      };
      const jsonStr = JSON.stringify(exportData, null, 2);
      downloadBlob(jsonStr, `${data.projectTitle.replace(/\s+/g, "_")}_data.json`, "application/json");
    } finally {
      setGenerating(null);
    }
  }, [data]);

  // ─── SVG Export ─────────────────────────────────────────────────────
  const handleExportSVG = useCallback(() => {
    if (!data.svgContent) return;
    downloadBlob(data.svgContent, "floor_plan.svg", "image/svg+xml");
  }, [data.svgContent]);

  // ─── Text Report Export ─────────────────────────────────────────────
  const handleExportText = useCallback(() => {
    if (!data.textContent) return;
    const report = `# ${data.projectTitle}\n# Generated: ${new Date().toLocaleDateString()}\n\n${data.textContent}`;
    downloadBlob(report, `${data.projectTitle.replace(/\s+/g, "_")}_report.txt`, "text/plain");
  }, [data]);

  // ─── Build Download Cards ──────────────────────────────────────────

  const downloadCards: Array<{
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    color: string;
    action: (() => void) | string;
    primary?: boolean;
    id: string;
    badge?: string;
  }> = [];

  // 1. PDF Report — always first and primary
  downloadCards.push({
    id: "pdf",
    icon: <FileDown size={20} />,
    title: t('showcase.pdfFullReport'),
    subtitle: t('showcase.pdfFullReportDesc'),
    color: COLORS.CYAN,
    action: handleGeneratePDF,
    primary: true,
    badge: "RECOMMENDED",
  });

  // 2. Video download
  if (data.videoData) {
    downloadCards.push({
      id: "video",
      icon: <Film size={20} />,
      title: t('showcase.videoWalkthroughTitle'),
      subtitle: `${data.videoData.durationSeconds}s · ${data.videoData.shotCount} shots · MP4`,
      color: "#8B5CF6",
      action: data.videoData.downloadUrl,
    });
  }

  // 3. Image downloads
  data.allImageUrls.forEach((url, i) => {
    downloadCards.push({
      id: `image-${i}`,
      icon: <ImageIcon size={20} />,
      title: `${t('showcase.conceptRenderTitle')} ${data.allImageUrls.length > 1 ? i + 1 : ""}`.trim(),
      subtitle: t('showcase.hiResRender'),
      color: COLORS.EMERALD,
      action: url,
    });
  });

  // 4. SVG Floor Plan
  if (data.svgContent) {
    downloadCards.push({
      id: "svg",
      icon: <Layers size={20} />,
      title: t('showcase.svgFloorPlan'),
      subtitle: t('showcase.svgFloorPlanDesc'),
      color: "#14B8A6",
      action: handleExportSVG,
    });
  }

  // 5. CSV Table Data
  if (data.tableData.length > 0) {
    const totalRows = data.tableData.reduce((sum, t) => sum + t.rows.length, 0);
    downloadCards.push({
      id: "csv",
      icon: <Table2 size={20} />,
      title: t('showcase.tableDataCsv'),
      subtitle: `${data.tableData.length} tables · ${totalRows} rows`,
      color: "#6366F1",
      action: handleExportCSV,
    });
  }

  // 6. JSON structured data
  if (data.jsonData.length > 0 || data.kpiMetrics.length > 0 || data.tableData.length > 0) {
    downloadCards.push({
      id: "json",
      icon: <Code2 size={20} />,
      title: t('showcase.jsonDataExport'),
      subtitle: t('showcase.jsonDataExportDesc'),
      color: "#EC4899",
      action: handleExportJSON,
    });
  }

  // 7. Text report
  if (data.textContent) {
    const wordCount = data.textContent.split(/\s+/).length;
    downloadCards.push({
      id: "text",
      icon: <FileText size={20} />,
      title: t('showcase.textReport'),
      subtitle: `${wordCount} words · TXT`,
      color: "#F59E0B",
      action: handleExportText,
    });
  }

  // 8. File artifacts
  data.fileDownloads.forEach((file, i) => {
    downloadCards.push({
      id: `file-${i}`,
      icon: <File size={20} />,
      title: file.name,
      subtitle: file.size > 0 ? formatBytes(file.size) : file.type || "File",
      color: "#64748B",
      action: file.downloadUrl ?? "#",
    });
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header with count */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: COLORS.TEXT_PRIMARY,
          }}>
            {t('showcase.downloadCenterTitle')}
          </div>
          <div style={{
            fontSize: 11,
            color: COLORS.TEXT_MUTED,
            marginTop: 2,
          }}>
            {downloadCards.length} {t('showcase.items')} available for download
          </div>
        </div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 6,
          background: `${COLORS.EMERALD}10`,
          border: `1px solid ${COLORS.EMERALD}20`,
        }}>
          <CheckCircle size={12} style={{ color: COLORS.EMERALD }} />
          <span style={{ fontSize: 10, color: COLORS.EMERALD, fontWeight: 600 }}>
            {t('showcase.executionComplete')}
          </span>
        </div>
      </div>

      {/* Primary action (PDF) — featured card */}
      {downloadCards.length > 0 && downloadCards[0].primary && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div
            onClick={typeof downloadCards[0].action === "function" ? downloadCards[0].action : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "20px 24px",
              borderRadius: 14,
              background: `linear-gradient(135deg, ${COLORS.CYAN}08, ${COLORS.CYAN}04)`,
              border: `1px solid ${COLORS.CYAN}25`,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = `${COLORS.CYAN}50`;
              e.currentTarget.style.boxShadow = `0 4px 30px ${COLORS.CYAN}15`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = `${COLORS.CYAN}25`;
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: `${COLORS.CYAN}15`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: COLORS.CYAN,
              flexShrink: 0,
            }}>
              {generating === "pdf" ? (
                <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
              ) : (
                <FileDown size={24} />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.TEXT_PRIMARY }}>
                  {downloadCards[0].title}
                </span>
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: COLORS.CYAN,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: `${COLORS.CYAN}15`,
                  letterSpacing: "0.05em",
                }}>
                  RECOMMENDED
                </span>
              </div>
              <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED, marginTop: 3, lineHeight: 1.4 }}>
                {downloadCards[0].subtitle}
              </div>
            </div>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              background: `${COLORS.CYAN}15`,
              color: COLORS.CYAN,
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}>
              {generating === "pdf" ? t('showcase.generating') : (
                <>
                  <Download size={14} />
                  PDF
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Other downloads grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 10,
      }}>
        {downloadCards.slice(1).map((card, i) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * i }}
          >
            {typeof card.action === "string" ? (
              <a href={card.action} download style={{ textDecoration: "none" }}>
                <DownloadCard {...card} isGenerating={generating === card.id} />
              </a>
            ) : (
              <div onClick={card.action} style={{ cursor: "pointer" }}>
                <DownloadCard {...card} isGenerating={generating === card.id} />
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Footer stats */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 16,
        borderTop: `1px solid ${COLORS.GLASS_BORDER}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Package size={12} style={{ color: COLORS.TEXT_MUTED }} />
          <span style={{ fontSize: 11, color: COLORS.TEXT_MUTED }}>
            {data.totalArtifacts} {t('showcase.totalArtifacts')} · {downloadCards.length} {t('showcase.downloadable')}
          </span>
        </div>
        <div style={{ fontSize: 9, color: COLORS.TEXT_MUTED, opacity: 0.5 }}>
          All exports are concept-level outputs
        </div>
      </div>

      {/* Spin animation for loader */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ─── Download Card Component ────────────────────────────────────────────────

function DownloadCard({
  icon,
  title,
  subtitle,
  color,
  isGenerating,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  primary?: boolean;
  isGenerating?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 10,
        background: COLORS.GLASS_BG,
        border: `1px solid ${COLORS.GLASS_BORDER}`,
        transition: "all 0.15s ease",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        e.currentTarget.style.borderColor = `${color}40`;
        e.currentTarget.style.boxShadow = `0 0 20px ${color}10`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = COLORS.GLASS_BG;
        e.currentTarget.style.borderColor = COLORS.GLASS_BORDER;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        background: `${color}12`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color,
        flexShrink: 0,
      }}>
        {isGenerating ? (
          <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
        ) : icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: COLORS.TEXT_PRIMARY,
          marginBottom: 2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {title}
        </div>
        <div style={{
          fontSize: 10,
          color: COLORS.TEXT_MUTED,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {subtitle}
        </div>
      </div>
      <Download size={15} style={{ color: COLORS.TEXT_MUTED, flexShrink: 0, opacity: 0.6 }} />
    </div>
  );
}

// ─── Utility: Download Blob ─────────────────────────────────────────────────

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
