"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Download,
  FileDown,
  Film,
  Image as ImageIcon,
  Layers,
  Table2,
  Code2,
  FileText,
  File as FileIcon,
  Loader2,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { useExecutionStore } from "@/features/execution/stores/execution-store";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import { formatBytes } from "@/lib/utils";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { SectionHeader } from "@/features/result-page/components/sections/SectionHeader";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface ExportsSectionProps {
  data: ResultPageData;
}

interface DownloadCard {
  id: string;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  action: (() => void | Promise<void>) | string;
  primary?: boolean;
  ifcBadge?: { variant: "rich" | "lean"; tooltip?: string };
}

/**
 * Downloads grid in BOQ-visualizer aesthetic. RECOMMENDED chip is gone
 * (Phase 1's clutter); concept-level footer is gone. The Rich/Lean IFC
 * badge stays — that's signal, not jargon.
 */
export function ExportsSection({ data }: ExportsSectionProps) {
  const artifacts = useExecutionStore(s => s.artifacts);
  const nodes = useWorkflowStore(s => s.nodes);
  const [generating, setGenerating] = useState<string | null>(null);

  const handlePDF = useCallback(async () => {
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
      toast.success("PDF downloaded", { id: "result-pdf-gen" });
    } catch {
      toast.error("PDF generation failed", { id: "result-pdf-gen" });
    } finally {
      setGenerating(null);
    }
  }, [artifacts, nodes, data.projectTitle]);

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
    icon: <FileDown size={18} />,
    iconColor: "#0D9488",
    iconBg: "#F0FDFA",
    title: "Full PDF Report",
    subtitle: "All artifacts bundled for sharing with the client",
    action: handlePDF,
    primary: true,
  });

  if (data.videoData?.downloadUrl) {
    cards.push({
      id: "video",
      icon: <Film size={18} />,
      iconColor: "#7C3AED",
      iconBg: "#F5F3FF",
      title: "Video walkthrough · MP4",
      subtitle: `${data.videoData.durationSeconds}s · ${data.videoData.shotCount} shots`,
      action: data.videoData.downloadUrl,
    });
  }

  data.allImageUrls.forEach((url, i) => {
    cards.push({
      id: `image-${i}`,
      icon: <ImageIcon size={18} />,
      iconColor: "#0D9488",
      iconBg: "#F0FDFA",
      title: `Render ${data.allImageUrls.length > 1 ? i + 1 : ""}`.trim(),
      subtitle: "Hi-res concept render · PNG",
      action: url,
    });
  });

  if (data.svgContent) {
    cards.push({
      id: "svg",
      icon: <Layers size={18} />,
      iconColor: "#0D9488",
      iconBg: "#F0FDFA",
      title: "Floor plan · SVG",
      subtitle: "Scalable vector drawing",
      action: handleExportSvg,
    });
  }

  if (data.tableData.length > 0) {
    const totalRows = data.tableData.reduce((s, t) => s + t.rows.length, 0);
    cards.push({
      id: "csv",
      icon: <Table2 size={18} />,
      iconColor: "#1E40AF",
      iconBg: "#EFF6FF",
      title: "Table data · CSV",
      subtitle: `${data.tableData.length} tables · ${totalRows} rows`,
      action: () => {
        data.tableData.forEach((table, idx) => {
          const lines = [
            table.headers.join(","),
            ...table.rows.map(r =>
              r
                .map(c => {
                  const s = String(c);
                  return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
                })
                .join(","),
            ),
          ];
          downloadBlob(lines.join("\n"), `${table.label ?? `table_${idx + 1}`}.csv`, "text/csv");
        });
      },
    });
  }

  if (data.jsonData.length > 0 || data.kpiMetrics.length > 0 || data.tableData.length > 0) {
    cards.push({
      id: "json",
      icon: <Code2 size={18} />,
      iconColor: "#7C3AED",
      iconBg: "#F5F3FF",
      title: "Structured data · JSON",
      subtitle: "Programmatic export of all KPIs + tables",
      action: handleExportJson,
    });
  }

  if (data.textContent) {
    cards.push({
      id: "text",
      icon: <FileText size={18} />,
      iconColor: "#D97706",
      iconBg: "#FEF3C7",
      title: "Text report · TXT",
      subtitle: `${data.textContent.split(/\s+/).filter(Boolean).length} words`,
      action: handleExportText,
    });
  }

  data.fileDownloads.forEach((file, i) => {
    const fileName = ensureExt(file.name, file.type);
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
              ? "Generated via IfcOpenShell — full geometry."
              : `Python IFC service unavailable${
                  file.ifcServiceSkipReason ? ` (${file.ifcServiceSkipReason})` : ""
                }.`,
        }
      : undefined;
    cards.push({
      id: `file-${i}`,
      icon: <FileIcon size={18} />,
      iconColor: "#4B5563",
      iconBg: "#F3F4F6",
      title: fileName,
      subtitle: file.size > 0 ? formatBytes(file.size) : file.type || "File",
      action: blobAction ?? file.downloadUrl ?? "#",
      ifcBadge,
    });
  });

  if (cards.length === 0) return null;

  const [primary, ...rest] = cards;

  return (
    <ScrollReveal>
      <section style={{ padding: "0 clamp(12px, 3vw, 24px)" }}>
        <SectionHeader
          index={4}
          icon={<Download size={16} />}
          label="Exports"
          title="Take it with you"
          subtitle="Hand it off — to clients, to Revit, to anyone."
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {primary?.primary ? <PrimaryDownloadCard card={primary} isGenerating={generating === primary.id} /> : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 10,
            }}
          >
            {rest.map((c, i) => (
              <DownloadCardSmall key={c.id} card={c} isGenerating={generating === c.id} delay={0.04 * i} />
            ))}
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}

function PrimaryDownloadCard({ card, isGenerating }: { card: DownloadCard; isGenerating: boolean }) {
  const node = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "20px 22px",
        background: "#FFFFFF",
        border: "1px solid rgba(13,148,136,0.22)",
        borderRadius: 16,
        boxShadow: "0 4px 14px rgba(13,148,136,0.08)",
        cursor: "pointer",
        transition: "all 0.2s",
        textDecoration: "none",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = "0 8px 22px rgba(13,148,136,0.14)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "0 4px 14px rgba(13,148,136,0.08)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: card.iconBg,
          color: card.iconColor,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isGenerating ? <Loader2 size={22} className="result-export-spin" /> : card.icon}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", letterSpacing: "-0.005em" }}>{card.title}</div>
        <div style={{ fontSize: 13, color: "#4B5563", marginTop: 4 }}>{card.subtitle}</div>
      </div>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 18px",
          borderRadius: 10,
          background: "#0D9488",
          color: "#FFFFFF",
          fontSize: 13,
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
    </div>
  );
  return wrapAction(card, node);
}

function DownloadCardSmall({
  card,
  isGenerating,
  delay,
}: {
  card: DownloadCard;
  isGenerating: boolean;
  delay: number;
}) {
  const inner = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 14,
        boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
        cursor: "pointer",
        textDecoration: "none",
        transition: "all 0.18s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = "0 6px 14px rgba(0,0,0,0.06)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.03)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: card.iconBg,
          color: card.iconColor,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isGenerating ? <Loader2 size={18} className="result-export-spin" /> : card.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#111827",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.title}
          </span>
          {card.ifcBadge ? <IfcEngineBadge variant={card.ifcBadge.variant} tooltip={card.ifcBadge.tooltip} /> : null}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#6B7280",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginTop: 2,
          }}
        >
          {card.subtitle}
        </div>
      </div>
      <Download size={14} aria-hidden="true" style={{ color: "#9CA3AF", flexShrink: 0 }} />
    </div>
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay }}
    >
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
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {node}
    </button>
  );
}

function IfcEngineBadge({ variant, tooltip }: { variant: "rich" | "lean"; tooltip?: string }) {
  const isRich = variant === "rich";
  const color = isRich ? "#059669" : "#D97706";
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
        background: isRich ? "#ECFDF5" : "#FEF3C7",
        color,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: tooltip ? "help" : "default",
      }}
    >
      <Icon size={9} />
      {isRich ? "Rich" : "Lean"}
    </span>
  );
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function ensureExt(name: string, fileType: string): string {
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
