"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, Download, Copy, Check, Pencil } from "lucide-react";
import { useExecutionStore } from "@/features/execution/stores/execution-store";
import type {
  ResultPageData,
  TableDataItem,
  KpiMetric,
} from "@/features/result-page/hooks/useResultPageData";

interface DataTabProps {
  data: ResultPageData;
}

/**
 * Data & Analysis tab — jargon stripped per D1/D4:
 *  - Removed CostBreakdownBars heuristic auto-derivation (false-positive landmine)
 *  - Compliance now lives in OverviewTab (real signal, not buried)
 *  - Quantity-correction edit flow for TR-007 tables ported verbatim from old DataTab
 */
export function DataTab({ data }: DataTabProps) {
  const hasAnything =
    data.kpiMetrics.length > 0 ||
    data.tableData.length > 0 ||
    data.jsonData.length > 0;

  if (!hasAnything) {
    return (
      <p style={{ padding: 60, textAlign: "center", color: "rgba(245,245,250,0.5)", fontSize: 13 }}>
        No structured data for this run.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {data.kpiMetrics.length > 0 ? (
        <section>
          <SectionTitle>Key metrics</SectionTitle>
          <KpiGrid metrics={data.kpiMetrics} />
        </section>
      ) : null}

      {data.tableData.length > 0 ? (
        <section>
          <SectionTitle>
            Tables{" "}
            <span style={{ fontSize: 11, color: "rgba(245,245,250,0.5)", marginLeft: 8 }}>
              {data.tableData.length} ·{" "}
              {data.tableData.reduce((s, t) => s + t.rows.length, 0)} rows
            </span>
          </SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.tableData.map((t, i) => (
              <TableView key={i} table={t} index={i} />
            ))}
          </div>
        </section>
      ) : null}

      {data.jsonData.length > 0 ? (
        <section>
          <SectionTitle>Structured data</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.jsonData.map((item, i) => (
              <JsonExplorer key={i} label={item.label} json={item.json} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        marginBottom: 14,
        fontSize: 14,
        fontWeight: 600,
        color: "#F5F5FA",
        display: "flex",
        alignItems: "center",
      }}
    >
      {children}
    </h3>
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
      {metrics.slice(0, 24).map((m, i) => (
        <motion.div
          key={`${m.label}-${i}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 * i }}
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#F5F5FA",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {typeof m.value === "number" ? m.value.toLocaleString("en-IN") : String(m.value)}
            {m.unit ? (
              <span style={{ fontSize: 12, color: "rgba(245,245,250,0.55)", marginLeft: 4, fontWeight: 400 }}>
                {m.unit}
              </span>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "rgba(245,245,250,0.55)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
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

function TableView({ table, index }: { table: TableDataItem; index: number }) {
  const [showAll, setShowAll] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const setQuantityOverride = useExecutionStore(s => s.setQuantityOverride);
  const quantityOverrides = useExecutionStore(s =>
    table.tileInstanceId ? s.quantityOverrides.get(table.tileInstanceId) : undefined,
  );
  const qtyColIndex = table.isQuantityTable
    ? table.headers.findIndex(h => h === "Qty" || h.toLowerCase() === "qty")
    : -1;

  const visibleRows = showAll ? table.rows : table.rows.slice(0, 15);

  const handleExportCsv = useCallback(() => {
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
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.label ?? `table_${index + 1}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [table, index]);

  // Grand total in last numeric column
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
    <div
      style={{
        background: "rgba(0,0,0,0.22)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(245,245,250,0.85)" }}>
            {table.label ?? `Table ${index + 1}`}
          </span>
          <span style={{ fontSize: 10, color: "rgba(245,245,250,0.5)" }}>
            {table.rows.length} rows × {table.headers.length} cols
          </span>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            borderRadius: 6,
            background: "rgba(0,245,255,0.10)",
            border: "1px solid rgba(0,245,255,0.25)",
            color: "#00F5FF",
            fontSize: 10,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Download size={11} aria-hidden="true" />
          Export CSV
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, color: "rgba(245,245,250,0.85)" }}>
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "10px 14px",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "rgba(245,245,250,0.55)",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    background: "rgba(0,0,0,0.4)",
                    whiteSpace: "nowrap",
                    position: "sticky",
                    top: 0,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                {row.map((cell, ci) => {
                  const isEditableQty = qtyColIndex >= 0 && ci === qtyColIndex && !!table.tileInstanceId;
                  const overrideValue = isEditableQty ? quantityOverrides?.get(ri) : undefined;
                  const displayValue = overrideValue !== undefined ? overrideValue : cell;
                  const isEditing = editingCell?.row === ri && editingCell?.col === ci;
                  const isOverridden = overrideValue !== undefined;
                  return (
                    <td
                      key={ci}
                      style={{
                        padding: "8px 14px",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        whiteSpace: "nowrap",
                        ...(isOverridden ? { background: "rgba(255,191,0,0.08)", color: "#FFBF00" } : {}),
                      }}
                    >
                      {isEditing ? (
                        <input
                          type="number"
                          defaultValue={String(displayValue)}
                          autoFocus
                          style={{
                            width: 84,
                            padding: "2px 6px",
                            borderRadius: 4,
                            border: "1px solid rgba(0,245,255,0.35)",
                            background: "rgba(0,0,0,0.6)",
                            color: "#FFBF00",
                            fontSize: 11,
                            fontFamily: "inherit",
                            outline: "none",
                          }}
                          onBlur={e => {
                            const val = parseFloat(e.target.value);
                            if (Number.isFinite(val) && val > 0 && table.tileInstanceId) {
                              setQuantityOverride(table.tileInstanceId, ri, val);
                              const originalVal = parseFloat(String(cell));
                              const rowData = table.rows[ri];
                              if (Number.isFinite(originalVal) && originalVal > 0 && rowData) {
                                fetch("/api/quantity-corrections", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    elementType: `Ifc${String(rowData[1] ?? "")
                                      .replace(/\s*[—\-].*/g, "")
                                      .trim()}`,
                                    extractedQty: originalVal,
                                    correctedQty: val,
                                    unit: String(rowData[7] ?? rowData[table.headers.length - 1] ?? "EA"),
                                  }),
                                })
                                  .then(res => {
                                    if (!res.ok && res.status !== 401) {
                                      toast.error("Couldn't save correction for future estimates");
                                    }
                                  })
                                  .catch(() => {
                                    toast.error("Network issue saving correction");
                                  });
                              }
                            }
                            setEditingCell(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingCell(null);
                          }}
                        />
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {displayValue}
                          {isEditableQty ? (
                            <Pencil
                              size={9}
                              style={{ opacity: 0.32, cursor: "pointer", flexShrink: 0 }}
                              onClick={e => {
                                e.stopPropagation();
                                setEditingCell({ row: ri, col: ci });
                              }}
                              aria-label="Edit quantity"
                            />
                          ) : null}
                          {isOverridden ? (
                            <span style={{ fontSize: 9, color: "#FFBF00", opacity: 0.6 }}>
                              (was {String(cell)})
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                  );
                })}
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
                      borderTop: "2px solid rgba(255,255,255,0.08)",
                      fontWeight: 700,
                      color: "#F5F5FA",
                      fontSize: 12,
                      background: "rgba(0,245,255,0.05)",
                    }}
                  >
                    {i === 0
                      ? "Total"
                      : i === table.headers.length - 1 && grandTotal !== null
                        ? grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {table.rows.length > 15 ? (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          style={{
            width: "100%",
            padding: "8px",
            background: "transparent",
            border: "none",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            color: "#00F5FF",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {showAll ? "Show less" : `Show all ${table.rows.length} rows`}
        </button>
      ) : null}
    </div>
  );
}

function JsonExplorer({ label, json }: { label: string; json: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(json, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error("Couldn't copy to clipboard");
    });
  }, [json]);

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px" }}>
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
            color: "#F5F5FA",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
            padding: 0,
          }}
        >
          {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          {label}
          <span style={{ fontSize: 10, color: "rgba(245,245,250,0.5)", fontWeight: 400 }}>
            {Object.keys(json).length} keys
          </span>
        </button>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy JSON"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: copied ? "#10B981" : "rgba(245,245,250,0.6)",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {expanded ? (
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: 360,
            overflow: "auto",
            background: "rgba(0,0,0,0.32)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            fontSize: 11,
            color: "rgba(245,245,250,0.85)",
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            lineHeight: 1.5,
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
