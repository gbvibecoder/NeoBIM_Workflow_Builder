"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, Download, Copy, Check, Table2, BarChart3, Code2, Pencil } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useExecutionStore } from "@/stores/execution-store";
import { COLORS } from "@/components/canvas/result-showcase/constants";
import { KpiStrip } from "@/components/canvas/result-showcase/sections/KpiStrip";
import { CostBreakdownBars } from "@/components/canvas/result-showcase/sections/CostBreakdownBars";
import { ComplianceBadges } from "@/components/canvas/result-showcase/sections/ComplianceBadges";
import type { ShowcaseData, TableDataItem } from "@/components/canvas/result-showcase/useShowcaseData";

interface DataTabProps {
  data: ShowcaseData;
}

export function DataTab({ data }: DataTabProps) {
  const { t } = useLocale();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Full KPI Dashboard */}
      {data.kpiMetrics.length > 0 && (
        <section>
          <SectionHeader
            icon={<BarChart3 size={14} />}
            title={t('showcase.kpiTitle')}
            subtitle={`${data.kpiMetrics.length} metrics`}
          />
          <KpiStrip metrics={data.kpiMetrics} maxItems={20} />
        </section>
      )}

      {/* Cost Breakdown */}
      {data.costBreakdown && (
        <section>
          <SectionHeader
            icon={<BarChart3 size={14} />}
            title={t('showcase.costBreakdown')}
          />
          <CostBreakdownBars items={data.costBreakdown} />
        </section>
      )}

      {/* Compliance */}
      {data.complianceItems && (
        <section>
          <SectionHeader
            icon={<Check size={14} />}
            title={t('showcase.complianceChecks')}
          />
          <ComplianceBadges items={data.complianceItems} />
        </section>
      )}

      {/* Tables */}
      {data.tableData.length > 0 && (
        <section>
          <SectionHeader
            icon={<Table2 size={14} />}
            title={t('showcase.tables')}
            subtitle={`${data.tableData.length} tables · ${data.tableData.reduce((s, t) => s + t.rows.length, 0)} total rows`}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {data.tableData.map((table, idx) => (
              <TableView key={idx} table={table} index={idx} />
            ))}
          </div>
        </section>
      )}

      {/* JSON Explorer */}
      {data.jsonData.length > 0 && (
        <section>
          <SectionHeader
            icon={<Code2 size={14} />}
            title={t('showcase.structuredData')}
            subtitle={`${data.jsonData.length} datasets`}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.jsonData.map((item, idx) => (
              <JsonExplorer key={idx} label={item.label} json={item.json} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {data.kpiMetrics.length === 0 && data.tableData.length === 0 && data.jsonData.length === 0 && (
        <div style={{
          padding: 60,
          textAlign: "center",
          color: COLORS.TEXT_MUTED,
          fontSize: 13,
        }}>
          {t('showcase.noDataAvailable')}
        </div>
      )}
    </div>
  );
}

// ─── Section Header ─────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 14,
    }}>
      <div style={{
        color: COLORS.CYAN,
        display: "flex",
        alignItems: "center",
      }}>
        {icon}
      </div>
      <span style={{
        fontSize: 14,
        fontWeight: 700,
        color: COLORS.TEXT_PRIMARY,
      }}>
        {title}
      </span>
      {subtitle && (
        <span style={{
          fontSize: 10,
          color: COLORS.TEXT_MUTED,
          marginLeft: 4,
        }}>
          {subtitle}
        </span>
      )}
      <div style={{
        flex: 1,
        height: 1,
        marginLeft: 12,
        background: `linear-gradient(90deg, ${COLORS.GLASS_BORDER}, transparent)`,
      }} />
    </div>
  );
}

// ─── Table Component ────────────────────────────────────────────────────────

function TableView({ table, index }: { table: TableDataItem; index: number }) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const setQuantityOverride = useExecutionStore(s => s.setQuantityOverride);
  const quantityOverrides = useExecutionStore(s =>
    table.tileInstanceId ? s.quantityOverrides.get(table.tileInstanceId) : undefined
  );

  // Determine which column is the "Qty" column for override support
  const qtyColIndex = table.isQuantityTable
    ? table.headers.findIndex(h => h === "Qty" || h.toLowerCase() === "qty")
    : -1;

  const visibleRows = showAll ? table.rows : table.rows.slice(0, 15);

  const handleExportCSV = useCallback(() => {
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
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.label ?? `table_${index + 1}`}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [table, index]);

  // Compute grand total if last column looks numeric
  let grandTotal: number | null = null;
  if (table.rows.length > 0) {
    const lastColIdx = table.headers.length - 1;
    const lastColValues = table.rows.map(r => {
      const val = r[lastColIdx];
      return typeof val === "number" ? val : parseFloat(String(val).replace(/[,$]/g, ""));
    });
    if (lastColValues.every(v => !isNaN(v))) {
      grandTotal = lastColValues.reduce((a, b) => a + b, 0);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index }}
      style={{
        background: "rgba(0,0,0,0.2)",
        border: `1px solid ${COLORS.GLASS_BORDER}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Table header with export button */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {table.label && (
            <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY }}>
              {table.label}
            </span>
          )}
          <span style={{ fontSize: 9, color: COLORS.TEXT_MUTED }}>
            {table.rows.length} {t('showcase.rows')} × {table.headers.length} cols
          </span>
        </div>
        <button
          onClick={handleExportCSV}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            borderRadius: 5,
            background: `${COLORS.CYAN}10`,
            border: `1px solid ${COLORS.CYAN}20`,
            color: COLORS.CYAN,
            fontSize: 9,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = `${COLORS.CYAN}20`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = `${COLORS.CYAN}10`;
          }}
        >
          <Download size={10} />
          {t('showcase.exportCsv')}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
          color: COLORS.TEXT_SECONDARY,
        }}>
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "10px 14px",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "#B0B0C5",
                    borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    position: "sticky",
                    top: 0,
                    background: "rgba(7,8,9,0.95)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "rgba(0,245,255,0.02)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)";
                }}
              >
                {(row as (string | number)[]).map((cell, ci) => {
                  const isEditableQty = qtyColIndex >= 0 && ci === qtyColIndex && table.tileInstanceId;
                  const overrideValue = isEditableQty && quantityOverrides?.get(ri);
                  const displayValue = overrideValue !== undefined ? overrideValue : cell;
                  const isEditing = editingCell?.row === ri && editingCell?.col === ci;
                  const isOverridden = overrideValue !== undefined;

                  return (
                    <td
                      key={ci}
                      style={{
                        padding: "8px 14px",
                        borderBottom: "1px solid rgba(255,255,255,0.03)",
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
                            width: 80, padding: "2px 4px", borderRadius: 3,
                            border: "1px solid rgba(0,245,255,0.3)", background: "rgba(0,0,0,0.6)",
                            color: "#FFBF00", fontSize: 11, fontFamily: "inherit", outline: "none",
                          }}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val > 0 && table.tileInstanceId) {
                              setQuantityOverride(table.tileInstanceId, ri, val);
                              // Persist correction to DB for learning loop
                              const originalVal = parseFloat(String(cell));
                              const rowData = table.rows[ri];
                              if (!isNaN(originalVal) && originalVal > 0 && rowData) {
                                // Persist correction to the analytical learning corpus.
                                // Local UI state is already saved separately via the
                                // execution-store debounced PATCH path, so this is a
                                // best-effort secondary save — failures don't block the
                                // edit but DO surface a toast so the user knows the
                                // future-prediction quality won't reflect this correction.
                                fetch("/api/quantity-corrections", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    elementType: `Ifc${String(rowData[1] ?? "").replace(/\s*[—\-].*/g, "").trim()}`,
                                    extractedQty: originalVal,
                                    correctedQty: val,
                                    unit: String(rowData[7] ?? rowData[table.headers.length - 1] ?? "EA"),
                                  }),
                                }).then(res => {
                                  // 401 is expected for not-signed-in users — quietly ignore
                                  if (!res.ok && res.status !== 401) {
                                    toast.error("Couldn't save correction for future estimates", { duration: 3000 });
                                  }
                                }).catch(() => {
                                  toast.error("Network issue saving correction", { duration: 3000 });
                                });
                              }
                            }
                            setEditingCell(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingCell(null);
                          }}
                        />
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {displayValue}
                          {isEditableQty && (
                            <Pencil
                              size={9}
                              style={{ opacity: 0.3, cursor: "pointer", flexShrink: 0 }}
                              onClick={(e) => { e.stopPropagation(); setEditingCell({ row: ri, col: ci }); }}
                              onMouseEnter={(e) => { (e.target as SVGElement).style.opacity = "0.8"; }}
                              onMouseLeave={(e) => { (e.target as SVGElement).style.opacity = "0.3"; }}
                            />
                          )}
                          {isOverridden && (
                            <span style={{ fontSize: 8, color: "#FFBF00", opacity: 0.6 }} title={`Original: ${cell}`}>
                              (was {cell})
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {grandTotal !== null && (
            <tfoot>
              <tr>
                {table.headers.map((_, i) => (
                  <td
                    key={i}
                    style={{
                      padding: "10px 14px",
                      borderTop: `2px solid ${COLORS.GLASS_BORDER}`,
                      fontWeight: 700,
                      color: COLORS.TEXT_PRIMARY,
                      fontSize: 12,
                      background: "rgba(0,245,255,0.03)",
                    }}
                  >
                    {i === 0 ? t('showcase.total') : i === table.headers.length - 1
                      ? grandTotal!.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {table.rows.length > 15 && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            width: "100%",
            padding: "8px",
            background: "none",
            borderTop: `1px solid ${COLORS.GLASS_BORDER}`,
            borderLeft: "none",
            borderRight: "none",
            borderBottom: "none",
            color: COLORS.CYAN,
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {showAll ? t('showcase.showLess') : `${t('showcase.showAllRows')} ${table.rows.length} ${t('showcase.rows')}`}
        </button>
      )}
    </motion.div>
  );
}

// ─── JSON Explorer ──────────────────────────────────────────────────────────

function JsonExplorer({ label, json }: { label: string; json: Record<string, unknown> }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(json, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label.replace(/\s+/g, "_").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [json, label]);

  return (
    <div style={{
      background: COLORS.GLASS_BG,
      border: `1px solid ${COLORS.GLASS_BORDER}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px",
      }}>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            color: COLORS.TEXT_PRIMARY,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
            padding: 0,
          }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {label}
          <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED, fontWeight: 400 }}>
            {Object.keys(json).length} {t('showcase.keys')}
          </span>
        </button>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={handleCopy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              padding: "3px 7px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${COLORS.GLASS_BORDER}`,
              color: copied ? COLORS.EMERALD : COLORS.TEXT_MUTED,
              fontSize: 9,
              cursor: "pointer",
            }}
            title={t('showcase.copyJson')}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? t('showcase.copied') : t('showcase.copyJson')}
          </button>
          <button
            onClick={handleDownload}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              padding: "3px 7px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${COLORS.GLASS_BORDER}`,
              color: COLORS.TEXT_MUTED,
              fontSize: 9,
              cursor: "pointer",
            }}
            title={t('showcase.downloadJson')}
          >
            <Download size={10} />
            JSON
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: "0 16px 14px",
          maxHeight: 400,
          overflow: "auto",
        }}>
          <JsonTree data={json} depth={0} />
        </div>
      )}
    </div>
  );
}

function JsonTree({ data, depth }: { data: unknown; depth: number }) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  if (data === null || data === undefined) {
    return <span style={{ color: COLORS.TEXT_MUTED }}>null</span>;
  }

  if (typeof data !== "object") {
    const color = typeof data === "string" ? COLORS.EMERALD
      : typeof data === "number" ? COLORS.AMBER
      : typeof data === "boolean" ? "#8B5CF6"
      : COLORS.TEXT_SECONDARY;
    return (
      <span style={{ color, fontSize: 11 }}>
        {typeof data === "string" ? `"${data}"` : String(data)}
      </span>
    );
  }

  const entries = Array.isArray(data)
    ? data.map((v, i) => [String(i), v] as const)
    : Object.entries(data);

  return (
    <div style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
      {entries.map(([key, value]) => {
        const isObject = value !== null && typeof value === "object";
        const isOpen = openKeys.has(key);

        return (
          <div key={key} style={{ marginBottom: 2 }}>
            <div
              onClick={() => {
                if (!isObject) return;
                setOpenKeys(prev => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key); else next.add(key);
                  return next;
                });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                cursor: isObject ? "pointer" : "default",
                padding: "2px 0",
              }}
            >
              {isObject && (
                isOpen
                  ? <ChevronDown size={10} style={{ color: COLORS.TEXT_MUTED }} />
                  : <ChevronRight size={10} style={{ color: COLORS.TEXT_MUTED }} />
              )}
              <span style={{ color: COLORS.CYAN, fontSize: 11 }}>{key}:</span>
              {!isObject && (
                <span style={{ marginLeft: 4 }}>
                  <JsonTree data={value} depth={depth + 1} />
                </span>
              )}
              {isObject && !isOpen && (
                <span style={{ color: COLORS.TEXT_MUTED, fontSize: 10 }}>
                  {Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value as object).length}}`}
                </span>
              )}
            </div>
            {isObject && isOpen && <JsonTree data={value} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}
