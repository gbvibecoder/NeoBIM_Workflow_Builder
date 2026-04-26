"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  FileDown,
  Film,
  File as FileIcon,
  Download,
  Image as ImageIcon,
  FileText,
  Table2,
  Code2,
  Layers,
  Loader2,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { useExecutionStore } from "@/features/execution/stores/execution-store";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import { formatBytes } from "@/lib/utils";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface ExportTabProps {
  data: ResultPageData;
}

interface DownloadCard {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  action: (() => void | Promise<void>) | string;
  primary?: boolean;
  ifcBadge?: { variant: "rich" | "lean"; tooltip?: string };
}

/**
 * Export tab — jargon stripped per D2/D4:
 *  - Removed RECOMMENDED chip on the PDF card
 *  - Removed "All exports concept-level" footer
 *  - Kept Rich/Lean IFC engine badge (real signal for BIM pros, audit §4.4 row 1)
 */
export function ExportTab({ data }: ExportTabProps) {
  const artifacts = useExecutionStore(s => s.artifacts);
  const nodes = useWorkflowStore(s => s.nodes);
  const [generating, setGenerating] = useState<string | null>(null);

  const handleGeneratePDF = useCallback(async () => {
    setGenerating("pdf");
    toast.loading("Generating PDF report…", { id: "result-pdf-gen" });
    try {
      const { generatePDFReport } = await import("@/services/pdf-report");
      const labels = new Map<string, string>();
      nodes.forEach(n => labels.set(n.id, n.data.label));
      await generatePDFReport({
        workflowName: data.projectTitle,
        artifacts,
        nodeLabels: labels,
      });
      toast.success("PDF report downloaded", { id: "result-pdf-gen" });
    } catch {
      toast.error("PDF generation failed", { id: "result-pdf-gen" });
    } finally {
      setGenerating(null);
    }
  }, [artifacts, nodes, data.projectTitle]);

  const handleExportCsv = useCallback(() => {
    setGenerating("csv");
    try {
      data.tableData.forEach((table, idx) => {
        const lines = [
          table.headers.join(","),
          ...table.rows.map(row =>
            row
              .map(cell => {
                const s = String(cell);
                return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
              })
              .join(","),
          ),
        ];
        downloadBlob(lines.join("\n"), `${table.label ?? `table_${idx + 1}`}.csv`, "text/csv");
      });
    } finally {
      setGenerating(null);
    }
  }, [data.tableData]);

  const handleExportJson = useCallback(() => {
    setGenerating("json");
    try {
      const payload = {
        project: data.projectTitle,
        exportedAt: new Date().toISOString(),
        kpis: data.kpiMetrics,
        tables: data.tableData,
        jsonData: data.jsonData,
        pipeline: data.pipelineSteps,
      };
      downloadBlob(
        JSON.stringify(payload, null, 2),
        `${data.projectTitle.replace(/\s+/g, "_")}_data.json`,
        "application/json",
      );
    } finally {
      setGenerating(null);
    }
  }, [data]);

  const handleExportSvg = useCallback(() => {
    if (!data.svgContent) return;
    downloadBlob(data.svgContent, "floor_plan.svg", "image/svg+xml");
  }, [data.svgContent]);

  const handleExportText = useCallback(() => {
    if (!data.textContent) return;
    const report = `# ${data.projectTitle}\n# Generated: ${new Date().toLocaleDateString()}\n\n${data.textContent}`;
    downloadBlob(report, `${data.projectTitle.replace(/\s+/g, "_")}_report.txt`, "text/plain");
  }, [data]);

  const cards: DownloadCard[] = [];

  cards.push({
    id: "pdf",
    icon: <FileDown size={20} aria-hidden="true" />,
    title: "Full PDF Report",
    subtitle: "All artifacts bundled into a single shareable PDF",
    color: "#00F5FF",
    action: handleGeneratePDF,
    primary: true,
  });

  if (data.videoData?.downloadUrl) {
    cards.push({
      id: "video",
      icon: <Film size={20} aria-hidden="true" />,
      title: "Video walkthrough · MP4",
      subtitle: `${data.videoData.durationSeconds}s · ${data.videoData.shotCount} shots`,
      color: "#A78BFA",
      action: data.videoData.downloadUrl,
    });
  }

  data.allImageUrls.forEach((url, i) => {
    cards.push({
      id: `image-${i}`,
      icon: <ImageIcon size={20} aria-hidden="true" />,
      title: `Render ${data.allImageUrls.length > 1 ? i + 1 : ""}`.trim(),
      subtitle: "Hi-res render · PNG",
      color: "#10B981",
      action: url,
    });
  });

  if (data.svgContent) {
    cards.push({
      id: "svg",
      icon: <Layers size={20} aria-hidden="true" />,
      title: "Floor plan · SVG",
      subtitle: "Scalable vector drawing",
      color: "#14B8A6",
      action: handleExportSvg,
    });
  }

  if (data.tableData.length > 0) {
    const totalRows = data.tableData.reduce((sum, t) => sum + t.rows.length, 0);
    cards.push({
      id: "csv",
      icon: <Table2 size={20} aria-hidden="true" />,
      title: "Table data · CSV",
      subtitle: `${data.tableData.length} tables · ${totalRows} rows`,
      color: "#6366F1",
      action: handleExportCsv,
    });
  }

  if (data.jsonData.length > 0 || data.kpiMetrics.length > 0 || data.tableData.length > 0) {
    cards.push({
      id: "json",
      icon: <Code2 size={20} aria-hidden="true" />,
      title: "Structured data · JSON",
      subtitle: "Programmatic export of all metrics + tables",
      color: "#EC4899",
      action: handleExportJson,
    });
  }

  if (data.textContent) {
    cards.push({
      id: "text",
      icon: <FileText size={20} aria-hidden="true" />,
      title: "Text report · TXT",
      subtitle: `${data.textContent.split(/\s+/).filter(Boolean).length} words`,
      color: "#F59E0B",
      action: handleExportText,
    });
  }

  data.fileDownloads.forEach((file, i) => {
    const fileName = ensureFileExt(file.name, file.type);
    const needsBlob = !!file._rawContent || !!file.downloadUrl?.startsWith("data:");
    const blobAction = needsBlob
      ? () => {
          let blob: Blob;
          if (file._rawContent) blob = new Blob([file._rawContent], { type: "application/x-step" });
          else {
            const dataUri = file.downloadUrl ?? "";
            const [header, b64] = dataUri.split(",");
            const mime = header.split(":")[1]?.split(";")[0] ?? "application/octet-stream";
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
            blob = new Blob([bytes], { type: mime });
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 100);
        }
      : undefined;
    const ifcBadge: DownloadCard["ifcBadge"] = file.ifcEngine
      ? {
          variant: file.ifcEngine === "ifcopenshell" ? "rich" : "lean",
          tooltip:
            file.ifcEngine === "ifcopenshell"
              ? "Generated via IfcOpenShell (Python). Full geometry."
              : `Python IFC service unavailable${file.ifcServiceSkipReason ? ` (${file.ifcServiceSkipReason})` : ""}.`,
        }
      : undefined;
    cards.push({
      id: `file-${i}`,
      icon: <FileIcon size={20} aria-hidden="true" />,
      title: fileName,
      subtitle: file.size > 0 ? formatBytes(file.size) : file.type || "File",
      color: "#64748B",
      action: blobAction ?? file.downloadUrl ?? "#",
      ifcBadge,
    });
  });

  if (cards.length === 0) {
    return (
      <p style={{ padding: 60, textAlign: "center", color: "rgba(245,245,250,0.5)", fontSize: 13 }}>
        No downloadable artifacts for this run.
      </p>
    );
  }

  const [primary, ...rest] = cards;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {primary?.primary ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <DownloadCardLarge card={primary} isGenerating={generating === primary.id} />
        </motion.div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 10,
        }}
      >
        {rest.map((c, i) => (
          <DownloadCardSmall
            key={c.id}
            card={c}
            isGenerating={generating === c.id}
            delay={0.04 * i}
          />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: 11, color: "rgba(245,245,250,0.5)" }}>
          {data.totalArtifacts} artifacts · {cards.length} downloadable
        </span>
      </div>
    </div>
  );
}

function DownloadCardLarge({ card, isGenerating }: { card: DownloadCard; isGenerating: boolean }) {
  const node = (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "20px 22px",
        borderRadius: 14,
        background: `linear-gradient(135deg, ${card.color}10 0%, ${card.color}03 100%)`,
        border: `1px solid ${card.color}40`,
        cursor: "pointer",
        textDecoration: "none",
      }}
    >
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: `${card.color}18`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: card.color,
          flexShrink: 0,
        }}
      >
        {isGenerating ? <Loader2 size={22} className="result-export-spin" /> : card.icon}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#F5F5FA" }}>{card.title}</span>
        <span style={{ fontSize: 12, color: "rgba(245,245,250,0.6)" }}>{card.subtitle}</span>
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderRadius: 10,
          background: `${card.color}18`,
          color: card.color,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <Download size={14} aria-hidden="true" />
        Download
      </span>
      <style>{`
        .result-export-spin { animation: result-export-spin 1s linear infinite; }
        @keyframes result-export-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </span>
  );
  return wrapAction(card, node);
}

function DownloadCardSmall({ card, isGenerating, delay }: { card: DownloadCard; isGenerating: boolean; delay: number }) {
  const inner = (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        cursor: "pointer",
        textDecoration: "none",
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `${card.color}14`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: card.color,
          flexShrink: 0,
        }}
      >
        {isGenerating ? <Loader2 size={18} className="result-export-spin" /> : card.icon}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#F5F5FA",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.title}
          </span>
          {card.ifcBadge ? <IfcEngineBadge variant={card.ifcBadge.variant} tooltip={card.ifcBadge.tooltip} /> : null}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "rgba(245,245,250,0.5)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.subtitle}
        </span>
      </span>
      <Download size={14} aria-hidden="true" style={{ color: "rgba(245,245,250,0.4)", flexShrink: 0 }} />
    </span>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      {wrapAction(card, inner)}
    </motion.div>
  );
}

function wrapAction(card: DownloadCard, node: React.ReactNode): React.ReactNode {
  const action = card.action;
  if (typeof action === "string") {
    return (
      <a href={action} download style={{ textDecoration: "none" }}>
        {node}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        void action();
      }}
      style={{ background: "transparent", border: "none", padding: 0, width: "100%", textAlign: "left", cursor: "pointer" }}
    >
      {node}
    </button>
  );
}

function IfcEngineBadge({ variant, tooltip }: { variant: "rich" | "lean"; tooltip?: string }) {
  const isRich = variant === "rich";
  const color = isRich ? "#10B981" : "#FDCB6E";
  const Icon = isRich ? Sparkles : AlertTriangle;
  return (
    <span
      title={tooltip}
      aria-label={isRich ? "Generated via IfcOpenShell" : "Generated via TypeScript fallback"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 4,
        background: `${color}20`,
        color,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        border: `1px solid ${color}40`,
        cursor: tooltip ? "help" : "default",
      }}
    >
      <Icon size={9} />
      {isRich ? "Rich" : "Lean"}
    </span>
  );
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function ensureFileExt(name: string, fileType: string): string {
  const map: Record<string, string> = {
    "IFC 4": ".ifc",
    "IFC4": ".ifc",
    "IFC 2x3": ".ifc",
    "CSV Spreadsheet": ".csv",
    "Text Report": ".txt",
    "PNG Image": ".png",
    "PDF Report": ".pdf",
  };
  const ext = map[fileType] ?? "";
  if (ext && !name.toLowerCase().endsWith(ext)) {
    const dot = name.lastIndexOf(".");
    return (dot > 0 ? name.slice(0, dot) : name) + ext;
  }
  return name;
}
