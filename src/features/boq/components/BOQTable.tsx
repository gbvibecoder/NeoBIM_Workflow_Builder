"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { ChevronDown, ChevronUp, Pencil, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { BOQLineItem, BOQFilterTab, BOQSortKey, BOQSortDir, SourceType, RateOverride } from "@/features/boq/components/types";
import { formatINRFull, getDivisionCategory } from "@/features/boq/components/recalc-engine";
import { getLineConfidenceScore, getLineConfidenceColor } from "@/features/boq/constants/quality-thresholds";
import { ProvenanceTooltip } from "@/features/boq/components/ProvenanceTooltip";

/* ─── Props ─────────────────────────────────────────────────────────────────── */

interface BOQTableProps {
  lines: BOQLineItem[];
  rateOverrides: Map<string, RateOverride>;
  onRateOverride: (lineId: string, newRate: number, originalRate: number) => void;
  grandTotal?: number;
}

/* ─── Constants ─────────────────────────────────────────────────────────────── */

const TABS: { id: BOQFilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "structural", label: "Structural" },
  { id: "finishes", label: "Finishes" },
  { id: "mep", label: "MEP" },
  { id: "provisional", label: "Provisional" },
];

const SOURCE_BADGE: Record<SourceType, { label: string; color: string; bg: string }> = {
  "ifc-geometry": { label: "IFC Geometry", color: "#0D9488", bg: "#F0FDFA" },
  "ifc-derived": { label: "IFC Derived", color: "#D97706", bg: "#FEF3C7" },
  "benchmark": { label: "Benchmark", color: "#6B7280", bg: "#F3F4F6" },
  "provisional": { label: "Provisional", color: "#DC2626", bg: "#FEE2E2" },
};

const CONFIDENCE_THEME = {
  HIGH: { bg: "#ECFDF5", color: "#059669" },
  MEDIUM: { bg: "#FEF3C7", color: "#D97706" },
  LOW: { bg: "#FEE2E2", color: "#DC2626" },
};

const PAGE_SIZE = 25;

/* ─── ConfidenceBadge ───────────────────────────────────────────────────────── */

function ConfidenceBadge({ confidence, lineConfidence }: { confidence: number; lineConfidence?: BOQLineItem["lineConfidence"] }) {
  const score = lineConfidence?.score ?? getLineConfidenceScore(confidence);
  const label = score.toUpperCase() as keyof typeof CONFIDENCE_THEME;
  const _legacyColor = getLineConfidenceColor(score);
  const theme = CONFIDENCE_THEME[label] ?? CONFIDENCE_THEME.LOW;
  const factors = lineConfidence?.factors ?? [];
  return (
    <span className="relative group/conf inline-flex items-center gap-1.5">
      <span
        className="inline-block rounded-full shrink-0"
        style={{ width: 6, height: 6, background: theme.color }}
      />
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full font-medium"
        style={{ background: theme.bg, color: theme.color, fontSize: 10 }}
      >
        {label}
      </span>
      {factors.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-2 hidden group-hover/conf:block z-50"
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
            padding: "8px 10px",
            width: 240,
            boxShadow: "0 10px 25px rgba(0,0,0,0.1), 0 4px 10px rgba(0,0,0,0.05)",
          }}
        >
          <div className="font-semibold mb-1.5" style={{ color: theme.color, fontSize: 10 }}>
            {label} Confidence
          </div>
          {factors.map((f, i) => (
            <div key={i} className="leading-[1.4]" style={{ color: "#4B5563", marginBottom: 2, fontSize: 10 }}>
              • {f}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

/* ─── Column definitions ────────────────────────────────────────────────────── */

const COLUMNS: { label: string; sortable?: BOQSortKey }[] = [
  { label: "IS Code" },
  { label: "Description", sortable: "description" },
  { label: "Unit" },
  { label: "Qty" },
  { label: "Rate" },
  { label: "Amount", sortable: "amount" },
  { label: "Source" },
  { label: "Confidence", sortable: "confidence" },
];

/* ─── BOQTable ──────────────────────────────────────────────────────────────── */

export function BOQTable({ lines, rateOverrides, onRateOverride, grandTotal: grandTotalProp }: BOQTableProps) {
  /* State */
  const [activeTab, setActiveTab] = useState<BOQFilterTab>("all");
  const [sortKey, setSortKey] = useState<BOQSortKey>("amount");
  const [sortDir, setSortDir] = useState<BOQSortDir>("desc");
  const [page, setPage] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceType | "all">("all");
  const [rowsVisible, setRowsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setRowsVisible(true), 300);
    return () => clearTimeout(timer);
  }, []);

  /* Filter */
  const filtered = useMemo(() => {
    let result = lines;

    if (activeTab !== "all") {
      result = result.filter((l) => {
        const cat = getDivisionCategory(l.division, l.description).toLowerCase();
        if (activeTab === "provisional") return l.source === "provisional";
        return cat === activeTab;
      });
    }

    if (sourceFilter !== "all") {
      result = result.filter((l) => l.source === sourceFilter);
    }

    return result;
  }, [lines, activeTab, sourceFilter]);

  /* Sort */
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "description") return dir * a.description.localeCompare(b.description);
      if (sortKey === "confidence") return dir * (a.confidence - b.confidence);
      return dir * (a.totalCost - b.totalCost);
    });
  }, [filtered, sortKey, sortDir]);

  /* Pagination */
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const filteredTotal = filtered.reduce((s, l) => s + l.totalCost, 0);
  const grandTotal = grandTotalProp ?? filteredTotal;

  /* Reset page when filter changes */
  useEffect(() => { setPage(0); }, [activeTab, sourceFilter, sortKey, sortDir]);

  /* Confidence counts */
  const confidenceCounts = useMemo(() => {
    const high = filtered.filter(l => (l.lineConfidence?.score ?? getLineConfidenceScore(l.confidence)) === "high").length;
    const med = filtered.filter(l => (l.lineConfidence?.score ?? getLineConfidenceScore(l.confidence)) === "medium").length;
    const low = filtered.length - high - med;
    return { high, med, low };
  }, [filtered]);

  const toggleSort = useCallback((key: BOQSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }, [sortKey]);

  const startEdit = (line: BOQLineItem) => {
    setEditingId(line.id);
    const override = rateOverrides.get(line.id);
    setEditValue(String(override?.newRate ?? line.unitRate));
  };

  const confirmEdit = (line: BOQLineItem) => {
    const newRate = parseFloat(editValue);
    if (!isNaN(newRate) && newRate > 0) {
      onRateOverride(line.id, newRate, line.unitRate);
    }
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const SortIcon = ({ col }: { col: BOQSortKey }) => {
    if (sortKey !== col) return <ChevronDown size={12} style={{ opacity: 0.3 }} />;
    return sortDir === "asc" ? <ChevronUp size={12} color="#0D9488" /> : <ChevronDown size={12} color="#0D9488" />;
  };

  return (
    <div
      className="mx-6 rounded-2xl overflow-hidden"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      }}
    >
      {/* ── Hint Row ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center px-5"
        style={{
          borderBottom: "1px solid rgba(0, 0, 0, 0.06)",
          paddingTop: 10,
          paddingBottom: 10,
        }}
      >
        <Pencil size={10} color="#6B7280" className="shrink-0" />
        <span
          className="ml-1.5"
          style={{ color: "#6B7280", fontSize: 11 }}
        >
          Click any Rate cell to override
        </span>
      </div>

      {/* ── Filter Tabs + Source Dropdown ─────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid rgba(0, 0, 0, 0.06)" }}
      >
        <div className="flex items-center gap-1.5">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="rounded-full px-4 transition-all duration-200"
                style={{
                  paddingTop: 6,
                  paddingBottom: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  background: isActive ? "#0D9488" : "#FFFFFF",
                  color: isActive ? "#FFFFFF" : "#4B5563",
                  border: isActive ? "1px solid #0D9488" : "1px solid rgba(0, 0, 0, 0.08)",
                  boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "#F9FAFB";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "#FFFFFF";
                  }
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Source filter dropdown */}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceType | "all")}
          className="outline-none cursor-pointer"
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(0, 0, 0, 0.1)",
            color: "#4B5563",
            borderRadius: 8,
            fontSize: 12,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          <option value="all">All Sources</option>
          <option value="ifc-geometry">IFC Geometry</option>
          <option value="ifc-derived">IFC Derived</option>
          <option value="benchmark">Benchmark</option>
          <option value="provisional">Provisional</option>
        </select>
      </div>

      {/* ── Confidence Summary Bar ───────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-2"
        style={{ borderBottom: "1px solid rgba(0, 0, 0, 0.06)" }}
      >
        <div className="flex items-center gap-3">
          {/* High pill */}
          <span
            className="inline-flex items-center gap-1.5 px-2.5 rounded-full font-medium"
            style={{
              background: CONFIDENCE_THEME.HIGH.bg,
              color: CONFIDENCE_THEME.HIGH.color,
              fontSize: 11,
              paddingTop: 3,
              paddingBottom: 3,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: CONFIDENCE_THEME.HIGH.color, display: "inline-block", flexShrink: 0 }} />
            {confidenceCounts.high} high
          </span>
          {/* Medium pill */}
          <span
            className="inline-flex items-center gap-1.5 px-2.5 rounded-full font-medium"
            style={{
              background: CONFIDENCE_THEME.MEDIUM.bg,
              color: CONFIDENCE_THEME.MEDIUM.color,
              fontSize: 11,
              paddingTop: 3,
              paddingBottom: 3,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: CONFIDENCE_THEME.MEDIUM.color, display: "inline-block", flexShrink: 0 }} />
            {confidenceCounts.med} medium
          </span>
          {/* Low pill */}
          <span
            className="inline-flex items-center gap-1.5 px-2.5 rounded-full font-medium"
            style={{
              background: CONFIDENCE_THEME.LOW.bg,
              color: CONFIDENCE_THEME.LOW.color,
              fontSize: 11,
              paddingTop: 3,
              paddingBottom: 3,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: CONFIDENCE_THEME.LOW.color, display: "inline-block", flexShrink: 0 }} />
            {confidenceCounts.low} low
          </span>
        </div>
        <span style={{ color: "#6B7280", fontSize: 11 }}>
          {filtered.length} of {lines.length} items shown
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table style={{ width: "100%", minWidth: 960, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(0, 0, 0, 0.06)" }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  onClick={col.sortable ? () => toggleSort(col.sortable!) : undefined}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    color: "#6B7280",
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase" as const,
                    position: "sticky" as const,
                    top: 0,
                    background: "#FFFFFF",
                    zIndex: 10,
                    borderBottom: "1px solid rgba(0, 0, 0, 0.06)",
                    cursor: col.sortable ? "pointer" : "default",
                    userSelect: col.sortable ? "none" : undefined,
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && <SortIcon col={col.sortable} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {paginated.map((line, i) => {
              const override = rateOverrides.get(line.id);
              const isEditing = editingId === line.id;
              const hasOverride = !!override;
              const altBg = i % 2 === 1 ? "#FAFAF8" : "#FFFFFF";

              return (
                <tr
                  key={line.id}
                  className="group"
                  style={{
                    borderBottom: "1px solid rgba(0, 0, 0, 0.04)",
                    opacity: rowsVisible ? 1 : 0,
                    transform: rowsVisible ? "translateX(0)" : "translateX(-2px)",
                    transition: `opacity 0.3s ease ${i * 15}ms, transform 0.3s ease ${i * 15}ms, background-color 0.15s ease`,
                    backgroundColor: altBg,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#F0FDF9";
                    e.currentTarget.style.boxShadow = "inset 3px 0 0 0 #0D9488";
                    e.currentTarget.style.transform = "translateX(1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = altBg;
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "translateX(0)";
                  }}
                >
                  {/* IS Code — deemphasized, truncated */}
                  <td
                    title={line.isCode || undefined}
                    style={{
                      padding: "10px 12px",
                      color: "#9CA3AF",
                      fontSize: 10,
                      maxWidth: 100,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap" as const,
                    }}
                  >
                    {line.isCode || "\u2014"}
                  </td>

                  {/* Description + Storey */}
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ color: "#111827", fontSize: 13 }}>
                      {line.description}
                    </span>
                    {line.storey && (
                      <span style={{ color: "#6B7280", fontSize: 10, marginLeft: 8 }}>
                        {line.storey}
                      </span>
                    )}
                  </td>

                  {/* Unit */}
                  <td style={{ padding: "10px 14px", color: "#4B5563", fontSize: 13 }}>
                    {line.unit}
                  </td>

                  {/* Qty */}
                  <td
                    style={{
                      padding: "10px 14px",
                      color: "#111827",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 13,
                    }}
                  >
                    {line.adjustedQty.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </td>

                  {/* Rate (editable) */}
                  <td style={{ padding: "10px 14px" }}>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") confirmEdit(line);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="outline-none"
                          style={{
                            width: 72,
                            padding: "3px 6px",
                            borderRadius: 6,
                            fontSize: 12,
                            background: "#F0FDFA",
                            border: "1px solid #0D9488",
                            color: "#111827",
                          }}
                          autoFocus
                        />
                        <button
                          onClick={() => confirmEdit(line)}
                          style={{ padding: 2, display: "flex", alignItems: "center", cursor: "pointer", background: "none", border: "none" }}
                        >
                          <Check size={13} color="#059669" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          style={{ padding: 2, display: "flex", alignItems: "center", cursor: "pointer", background: "none", border: "none" }}
                        >
                          <X size={13} color="#DC2626" />
                        </button>
                      </div>
                    ) : (
                      <ProvenanceTooltip line={line}>
                        <div
                          className="group/rate"
                          onClick={() => startEdit(line)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            cursor: "pointer",
                            borderRadius: 6,
                            padding: "2px 4px",
                            marginLeft: -4,
                            transition: "background-color 0.15s ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#F0FDF9"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                        >
                          {hasOverride && (
                            <Pencil size={10} color="#0D9488" className="shrink-0" />
                          )}
                          <span
                            style={{
                              color: hasOverride ? "#0D9488" : "#111827",
                              fontVariantNumeric: "tabular-nums",
                              fontSize: 13,
                            }}
                          >
                            {"\u20B9"}{(override?.newRate ?? line.unitRate).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </span>
                          {hasOverride && (
                            <span
                              style={{
                                color: "#6B7280",
                                fontSize: 10,
                                textDecoration: "line-through",
                              }}
                            >
                              {"\u20B9"}{line.unitRate.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            </span>
                          )}
                          <Pencil
                            size={10}
                            color="#6B7280"
                            className="shrink-0 opacity-0 group-hover/rate:opacity-100 transition-opacity"
                          />
                        </div>
                      </ProvenanceTooltip>
                    )}
                  </td>

                  {/* Amount */}
                  <td
                    style={{
                      padding: "10px 14px",
                      color: "#111827",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 13,
                    }}
                  >
                    {formatINRFull(line.totalCost)}
                  </td>

                  {/* Source */}
                  <td style={{ padding: "10px 14px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRadius: 9999,
                        fontSize: 10,
                        fontWeight: 500,
                        background: SOURCE_BADGE[line.source].bg,
                        color: SOURCE_BADGE[line.source].color,
                        whiteSpace: "nowrap" as const,
                      }}
                    >
                      {SOURCE_BADGE[line.source].label}
                    </span>
                  </td>

                  {/* Confidence */}
                  <td style={{ padding: "10px 14px" }}>
                    <ConfidenceBadge confidence={line.confidence} lineConfidence={line.lineConfidence} />
                  </td>
                </tr>
              );
            })}

            {/* ── Grand Total Row ──────────────────────────────────────────────── */}
            <tr
              style={{
                borderTop: "2px solid rgba(13, 148, 136, 0.2)",
                background: "#F0FDFA",
              }}
            >
              <td
                style={{
                  padding: "12px 14px",
                  color: "#0D9488",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                TOTAL
              </td>
              <td
                colSpan={4}
                style={{
                  padding: "12px 14px",
                  color: "#4B5563",
                  fontSize: 12,
                }}
              >
                {filtered.length} line items
              </td>
              <td
                style={{
                  padding: "12px 14px",
                  color: "#0D9488",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 16,
                }}
              >
                {formatINRFull(grandTotal)}
              </td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderTop: "1px solid rgba(0, 0, 0, 0.06)" }}
        >
          <span style={{ color: "#6B7280", fontSize: 12 }}>
            Showing {page * PAGE_SIZE + 1}{"\u2013"}{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>

          <div className="flex items-center gap-1.5">
            {/* Prev arrow */}
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="flex items-center justify-center"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: page === 0 ? "#FFFFFF" : "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.06)",
                opacity: page === 0 ? 0.35 : 1,
                cursor: page === 0 ? "default" : "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <ChevronLeft size={14} color="#4B5563" />
            </button>

            {/* Page numbers */}
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const pageNum = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3, totalPages - 7)) + i;
              const isCurrent = page === pageNum;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    background: isCurrent ? "#0D9488" : "#FFFFFF",
                    color: isCurrent ? "#FFFFFF" : "#4B5563",
                    border: isCurrent ? "1px solid #0D9488" : "1px solid rgba(0,0,0,0.06)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {pageNum + 1}
                </button>
              );
            })}

            {/* Next arrow */}
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center justify-center"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.06)",
                opacity: page >= totalPages - 1 ? 0.35 : 1,
                cursor: page >= totalPages - 1 ? "default" : "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <ChevronRight size={14} color="#4B5563" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
