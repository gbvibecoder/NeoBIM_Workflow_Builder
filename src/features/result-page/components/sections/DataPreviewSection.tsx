"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { SectionHeader } from "@/features/result-page/components/sections/SectionHeader";
import type { ResultPageData, KpiMetric, TableDataItem } from "@/features/result-page/hooks/useResultPageData";

interface DataPreviewSectionProps {
  data: ResultPageData;
}

/**
 * KPI grid + table previews + JSON tree (collapsed by default). All
 * heuristic CostBreakdownBars derivation is REMOVED per Phase 2 P4 — that
 * was the false-positive landmine the audit flagged.
 */
export function DataPreviewSection({ data }: DataPreviewSectionProps) {
  // Skip BOQ table preview — already shown in HeroBoq
  const isBoqHero = !!data.boqSummary;
  const tablesToShow = isBoqHero
    ? data.tableData.filter(
        t =>
          !t.label?.toLowerCase().includes("bill of quantities") &&
          !t.label?.toLowerCase().includes("boq"),
      )
    : data.tableData;

  const hasContent =
    data.kpiMetrics.length > 0 ||
    tablesToShow.length > 0 ||
    data.jsonData.length > 0;

  if (!hasContent) return null;

  return (
    <ScrollReveal>
      <section style={{ padding: "0 clamp(12px, 3vw, 24px)" }}>
        <SectionHeader
          index={3}
          icon={<BarChart3 size={16} />}
          label="Data"
          title="By the numbers"
          subtitle="Metrics, tables, and structured payloads — the parts your downstream tools can read directly."
          iconColor="#1E40AF"
          iconBg="#EFF6FF"
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.kpiMetrics.length > 0 ? <KpiGrid metrics={data.kpiMetrics} /> : null}
          {tablesToShow.map((t, i) => (
            <TablePreview key={i} table={t} index={i} />
          ))}
          {data.jsonData.map((item, i) => (
            <JsonExplorer key={i} label={item.label} json={item.json} />
          ))}
        </div>
      </section>
    </ScrollReveal>
  );
}

function KpiGrid({ metrics }: { metrics: KpiMetric[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 10,
      }}
    >
      {metrics.slice(0, 12).map((m, i) => (
        <motion.div
          key={`${m.label}-${i}`}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4, delay: 0.04 * i, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.06)",
            borderRadius: 14,
            padding: "16px 18px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#111827",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {typeof m.value === "number" ? m.value.toLocaleString("en-IN") : String(m.value)}
            {m.unit ? (
              <span
                style={{
                  fontSize: 13,
                  color: "#6B7280",
                  marginLeft: 4,
                  fontWeight: 500,
                }}
              >
                {m.unit}
              </span>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#6B7280",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginTop: 6,
            }}
          >
            {m.label}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function TablePreview({ table, index }: { table: TableDataItem; index: number }) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? table.rows : table.rows.slice(0, 8);

  let grandTotal: number | null = null;
  if (table.rows.length > 0) {
    const lastIdx = table.headers.length - 1;
    const vals = table.rows.map(r => {
      const v = r[lastIdx];
      return typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
    });
    if (vals.every(v => Number.isFinite(v))) grandTotal = vals.reduce((a, b) => a + b, 0);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay: 0.04 * index }}
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 14,
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          background: "#FAFAF8",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{table.label ?? `Table ${index + 1}`}</span>
          <span style={{ fontSize: 11, color: "#6B7280" }}>
            {table.rows.length} rows · {table.headers.length} cols
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
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
            const blob = new Blob([lines.join("\n")], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${table.label ?? `table_${index + 1}`}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            borderRadius: 8,
            background: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.10)",
            color: "#4B5563",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Export CSV
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#111827" }}>
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "10px 14px",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "#6B7280",
                    background: "#F9FAFB",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    whiteSpace: "nowrap",
                    borderBottom: "1px solid rgba(0,0,0,0.06)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "#FFFFFF" : "#FAFAF8" }}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "9px 14px",
                      borderBottom: "1px solid rgba(0,0,0,0.04)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {grandTotal !== null ? (
            <tfoot>
              <tr>
                {table.headers.map((_, i) => (
                  <td
                    key={i}
                    style={{
                      padding: "10px 14px",
                      borderTop: "2px solid rgba(13,148,136,0.32)",
                      fontWeight: 700,
                      color: "#0D9488",
                      fontSize: 12,
                      background: "#F0FDFA",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {i === 0
                      ? "Total"
                      : i === table.headers.length - 1
                        ? grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {table.rows.length > 8 ? (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          style={{
            width: "100%",
            padding: "10px",
            background: "#FFFFFF",
            border: "none",
            borderTop: "1px solid rgba(0,0,0,0.06)",
            color: "#0D9488",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showAll ? "Show less" : `Show all ${table.rows.length} rows`}
        </button>
      ) : null}
    </motion.div>
  );
}

function JsonExplorer({ label, json }: { label: string; json: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(JSON.stringify(json, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      })
      .catch(() => {
        toast.error("Couldn't copy to clipboard");
      });
  };

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 14,
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px" }}>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "none",
            color: "#111827",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
            padding: 0,
          }}
        >
          {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          {label}
          <span style={{ fontSize: 11, color: "#6B7280", fontWeight: 500 }}>{Object.keys(json).length} keys</span>
        </button>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            borderRadius: 8,
            background: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.10)",
            color: copied ? "#059669" : "#4B5563",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {expanded ? (
        <pre
          style={{
            margin: 0,
            padding: 16,
            maxHeight: 420,
            overflow: "auto",
            background: "#FAFAF8",
            borderTop: "1px solid rgba(0,0,0,0.06)",
            fontSize: 11,
            color: "#4B5563",
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(json, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
