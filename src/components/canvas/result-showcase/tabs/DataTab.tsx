"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, ChevronDown } from "lucide-react";
import { COLORS } from "../constants";
import { KpiStrip } from "../sections/KpiStrip";
import { CostBreakdownBars } from "../sections/CostBreakdownBars";
import { ComplianceBadges } from "../sections/ComplianceBadges";
import type { ShowcaseData, TableDataItem } from "../useShowcaseData";

interface DataTabProps {
  data: ShowcaseData;
}

export function DataTab({ data }: DataTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Full KPI Dashboard */}
      {data.kpiMetrics.length > 0 && (
        <section>
          <SectionTitle>Key Performance Indicators</SectionTitle>
          <KpiStrip metrics={data.kpiMetrics} maxItems={20} />
        </section>
      )}

      {/* Cost Breakdown */}
      {data.costBreakdown && (
        <section>
          <CostBreakdownBars items={data.costBreakdown} />
        </section>
      )}

      {/* Compliance */}
      {data.complianceItems && (
        <section>
          <ComplianceBadges items={data.complianceItems} />
        </section>
      )}

      {/* Tables */}
      {data.tableData.length > 0 && (
        <section>
          <SectionTitle>Tables</SectionTitle>
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
          <SectionTitle>Structured Data</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.jsonData.map((item, idx) => (
              <JsonExplorer key={idx} label={item.label} json={item.json} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Table Component ────────────────────────────────────────────────────────

function TableView({ table, index }: { table: TableDataItem; index: number }) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? table.rows : table.rows.slice(0, 15);

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
      {table.label && (
        <div style={{
          padding: "10px 16px",
          fontSize: 11,
          fontWeight: 600,
          color: COLORS.TEXT_SECONDARY,
          borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
        }}>
          {table.label}
        </div>
      )}

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
                }}
              >
                {(row as (string | number)[]).map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "8px 14px",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cell}
                  </td>
                ))}
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
                    }}
                  >
                    {i === 0 ? "Total" : i === table.headers.length - 1
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
            border: "none",
            color: COLORS.CYAN,
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
            borderTop: `1px solid ${COLORS.GLASS_BORDER}`,
          }}
        >
          {showAll ? "Show less" : `Show all ${table.rows.length} rows`}
        </button>
      )}
    </motion.div>
  );
}

// ─── JSON Explorer ──────────────────────────────────────────────────────────

function JsonExplorer({ label, json }: { label: string; json: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: COLORS.GLASS_BG,
      border: `1px solid ${COLORS.GLASS_BORDER}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          background: "none",
          border: "none",
          color: COLORS.TEXT_PRIMARY,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
        <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED, fontWeight: 400 }}>
          {Object.keys(json).length} keys
        </span>
      </button>

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
      : typeof data === "boolean" ? COLORS.VIOLET
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 13,
      fontWeight: 600,
      color: COLORS.TEXT_PRIMARY,
      marginBottom: 14,
    }}>
      {children}
    </div>
  );
}
