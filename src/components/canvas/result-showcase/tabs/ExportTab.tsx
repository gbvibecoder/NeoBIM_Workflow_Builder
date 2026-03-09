"use client";

import { useCallback } from "react";
import { motion } from "framer-motion";
import { FileDown, Film, File, Download, Package } from "lucide-react";
import { useExecutionStore } from "@/stores/execution-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { formatBytes } from "@/lib/utils";
import { COLORS } from "../constants";
import type { ShowcaseData } from "../useShowcaseData";

interface ExportTabProps {
  data: ShowcaseData;
}

export function ExportTab({ data }: ExportTabProps) {
  const artifacts = useExecutionStore(s => s.artifacts);
  const nodes = useWorkflowStore(s => s.nodes);

  const handleGeneratePDF = useCallback(async () => {
    const { generatePDFReport } = await import("@/services/pdf-report");
    const labels = new Map<string, string>();
    nodes.forEach(n => labels.set(n.id, n.data.label));
    await generatePDFReport({
      workflowName: data.projectTitle,
      artifacts,
      nodeLabels: labels,
    });
  }, [artifacts, nodes, data.projectTitle]);

  const downloadCards: Array<{
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    color: string;
    action: (() => void) | string; // string = href
    primary?: boolean;
  }> = [];

  // PDF Report — always first
  downloadCards.push({
    icon: <FileDown size={20} />,
    title: "PDF Report",
    subtitle: "Full project report with all metrics and visuals",
    color: COLORS.CYAN,
    action: handleGeneratePDF,
    primary: true,
  });

  // Video download
  if (data.videoData) {
    downloadCards.push({
      icon: <Film size={20} />,
      title: "Video Walkthrough",
      subtitle: `${data.videoData.durationSeconds}s · ${data.videoData.shotCount} shots`,
      color: COLORS.VIOLET,
      action: data.videoData.downloadUrl,
    });
  }

  // File artifacts
  data.fileDownloads.forEach(file => {
    downloadCards.push({
      icon: <File size={20} />,
      title: file.name,
      subtitle: file.size > 0 ? formatBytes(file.size) : file.type || "File",
      color: COLORS.AMBER,
      action: file.downloadUrl ?? "#",
    });
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: COLORS.TEXT_PRIMARY,
        marginBottom: -8,
      }}>
        Download Center
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}>
        {downloadCards.map((card, i) => (
          <motion.div
            key={card.title + i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
          >
            {typeof card.action === "string" ? (
              <a
                href={card.action}
                download
                style={{ textDecoration: "none" }}
              >
                <DownloadCard {...card} />
              </a>
            ) : (
              <div onClick={card.action} style={{ cursor: "pointer" }}>
                <DownloadCard {...card} />
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Stats footer */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        paddingTop: 16,
        borderTop: `1px solid ${COLORS.GLASS_BORDER}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Package size={12} style={{ color: COLORS.TEXT_MUTED }} />
          <span style={{ fontSize: 11, color: COLORS.TEXT_MUTED }}>
            {data.totalArtifacts} total artifacts · {downloadCards.length} downloadable
          </span>
        </div>
      </div>
    </div>
  );
}

function DownloadCard({
  icon,
  title,
  subtitle,
  color,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  primary?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 18px",
        borderRadius: 10,
        background: primary ? `${color}08` : COLORS.GLASS_BG,
        border: `1px solid ${primary ? `${color}25` : COLORS.GLASS_BORDER}`,
        transition: "all 0.15s ease",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = primary ? `${color}14` : "rgba(255,255,255,0.05)";
        e.currentTarget.style.borderColor = `${color}40`;
        e.currentTarget.style.boxShadow = `0 0 20px ${color}10`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = primary ? `${color}08` : COLORS.GLASS_BG;
        e.currentTarget.style.borderColor = primary ? `${color}25` : COLORS.GLASS_BORDER;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: `${color}12`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: COLORS.TEXT_PRIMARY,
          marginBottom: 2,
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
      <Download size={16} style={{ color: COLORS.TEXT_MUTED, flexShrink: 0 }} />
    </div>
  );
}
