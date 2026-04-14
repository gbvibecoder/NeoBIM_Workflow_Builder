"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { ChevronDown, ChevronUp, Pencil, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { BOQLineItem, BOQFilterTab, BOQSortKey, BOQSortDir, SourceType, RateOverride } from "@/features/boq/components/types";
import { formatINRFull, getDivisionCategory } from "@/features/boq/components/recalc-engine";
import { getLineConfidenceScore, getLineConfidenceColor } from "@/features/boq/constants/quality-thresholds";
import { ProvenanceTooltip } from "@/features/boq/components/ProvenanceTooltip";

interface BOQTableProps {
  lines: BOQLineItem[];
  rateOverrides: Map<string, RateOverride>;
  onRateOverride: (lineId: string, newRate: number, originalRate: number) => void;
  grandTotal?: number;
}

const TABS: { id: BOQFilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "structural", label: "Structural" },
  { id: "finishes", label: "Finishes" },
  { id: "mep", label: "MEP" },
  { id: "provisional", label: "Provisional" },
];

const SOURCE_BADGE: Record<SourceType, { label: string; color: string; bg: string }> = {
  "ifc-geometry": { label: "IFC Geometry", color: "#0D9488", bg: "#F0FDFA" },
  "ifc-derived": { label: "IFC Derived", color: "#D97706", bg: "#FFFBEB" },
  "benchmark": { label: "Benchmark", color: "#6B7280", bg: "#F3F4F6" },
  "provisional": { label: "Provisional", color: "#DC2626", bg: "#FEF2F2" },
};

const CONFIDENCE_THEME = {
  HIGH: { bg: "#ECFDF5", color: "#059669" },
  MEDIUM: { bg: "#FFFBEB", color: "#D97706" },
  LOW: { bg: "#FEF2F2", color: "#DC2626" },
};

function ConfidenceBadge({ confidence, lineConfidence }: { confidence: number; lineConfidence?: BOQLineItem["lineConfidence"] }) {
  const score = lineConfidence?.score ?? getLineConfidenceScore(confidence);
  const label = score.toUpperCase() as keyof typeof CONFIDENCE_THEME;
  const _legacyColor = getLineConfidenceColor(score);
  const theme = CONFIDENCE_THEME[label] ?? CONFIDENCE_THEME.LOW;
  const factors = lineConfidence?.factors ?? [];
  return (
    <span className="relative group/conf inline-flex items-center gap-1.5">
      {/* Colored dot */}
      <span
        className="inline-block rounded-full shrink-0"
        style={{ width: 8, height: 8, background: theme.color }}
      />
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: theme.bg, color: theme.color }}
      >
        {label}
      </span>
      {/* Tooltip on hover */}
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
          <div className="text-[10px] font-semibold mb-1.5" style={{ color: theme.color }}>
            {label} Confidence
          </div>
          {factors.map((f, i) => (
            <div key={i} className="text-[10px] leading-[1.4]" style={{ color: "#4B5563", marginBottom: 2 }}>
              • {f}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

const PAGE_SIZE = 25;

export function BOQTable({ lines, rateOverrides, onRateOverride, grandTotal: grandTotalProp }: BOQTableProps) {
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

  // Filter
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

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "description") return dir * a.description.localeCompare(b.description);
      if (sortKey === "confidence") return dir * (a.confidence - b.confidence);
      return dir * (a.totalCost - b.totalCost);
    });
  }, [filtered, sortKey, sortDir]);

  // Pagination
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const filteredTotal = filtered.reduce((s, l) => s + l.totalCost, 0);
  const grandTotal = grandTotalProp ?? filteredTotal;

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [activeTab, sourceFilter, sortKey, sortDir]);

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
      className="mx-6 rounded-xl overflow-hidden"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
      }}
    >
      {/* Hint + Tabs + Source Filter */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid rgba(0, 0, 0, 0.06)" }}
      >
        <div className="flex items-center gap-1.5 mr-3">
          <Pencil size={9} color="#9CA3AF" />
          <span className="text-[10px]" style={{ color: "#9CA3AF" }}>Click any Rate cell to override</span>
        </div>
      </div>
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid rgba(0, 0, 0, 0.06)" }}
      >
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                background: activeTab === tab.id ? "#F0FDFA" : "transparent",
                color: activeTab === tab.id ? "#0D9488" : "#9CA3AF",
                border: activeTab === tab.id ? "1px solid rgba(13, 148, 136, 0.2)" : "1px solid transparent",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Source filter dropdown */}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceType | "all")}
          className="text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(0, 0, 0, 0.1)",
            color: "#4B5563",
          }}
        >
          <option value="all">All Sources</option>
          <option value="ifc-geometry">IFC Geometry</option>
          <option value="ifc-derived">IFC Derived</option>
          <option value="benchmark">Benchmark</option>
          <option value="provisional">Provisional</option>
        </select>
      </div>

      {/* Confidence Summary Bar */}
      {(() => {
        const high = filtered.filter(l => (l.lineConfidence?.score ?? getLineConfidenceScore(l.confidence)) === "high").length;
        const med = filtered.filter(l => (l.lineConfidence?.score ?? getLineConfidenceScore(l.confidence)) === "medium").length;
        const low = filtered.length - high - med;
        return (
          <div
            className="flex items-center justify-between px-5 py-2"
            style={{ borderBottom: "1px solid rgba(0, 0, 0, 0.06)", background: "#F9FAFB" }}
          >
            <div className="flex items-center gap-4 text-[10px]">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
                style={{ background: CONFIDENCE_THEME.HIGH.bg, color: CONFIDENCE_THEME.HIGH.color }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: CONFIDENCE_THEME.HIGH.color, display: "inline-block" }} />
                {high} high
              </span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
                style={{ background: CONFIDENCE_THEME.MEDIUM.bg, color: CONFIDENCE_THEME.MEDIUM.color }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: CONFIDENCE_THEME.MEDIUM.color, display: "inline-block" }} />
                {med} medium
              </span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
                style={{ background: CONFIDENCE_THEME.LOW.bg, color: CONFIDENCE_THEME.LOW.color }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: CONFIDENCE_THEME.LOW.color, display: "inline-block" }} />
                {low} low
              </span>
            </div>
            <div className="flex items-center gap-4 text-[10px]" style={{ color: "#9CA3AF" }}>
              {filtered.length} of {lines.length} items shown
            </div>
          </div>
        );
      })()}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(0, 0, 0, 0.06)" }}>
              {[
                { label: "IS Code", width: "w-24" },
                { label: "Description", width: "flex-1", sortable: "description" as BOQSortKey },
                { label: "Unit", width: "w-14" },
                { label: "Qty", width: "w-16" },
                { label: "Rate", width: "w-24" },
                { label: "Amount", width: "w-28", sortable: "amount" as BOQSortKey },
                { label: "Source", width: "w-24" },
                { label: "Confidence", width: "w-24", sortable: "confidence" as BOQSortKey },
              ].map((col) => (
                <th
                  key={col.label}
                  className={`px-3 py-3 text-left font-semibold ${col.width} ${col.sortable ? "cursor-pointer select-none" : ""}`}
                  style={{
                    color: "#9CA3AF",
                    fontSize: 10,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    position: "sticky",
                    top: 0,
                    background: "#FFFFFF",
                    zIndex: 10,
                  }}
                  onClick={col.sortable ? () => toggleSort(col.sortable!) : undefined}
                >
                  <span className="flex items-center gap-1">
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

              return (
                <tr
                  key={line.id}
                  className="group transition-colors duration-150"
                  style={{
                    borderBottom: "1px solid rgba(0, 0, 0, 0.04)",
                    opacity: rowsVisible ? 1 : 0,
                    transform: rowsVisible ? "translateY(0)" : "translateY(4px)",
                    transition: `opacity 0.3s ease ${i * 20}ms, transform 0.3s ease ${i * 20}ms, background-color 0.15s, border-left 0.15s`,
                    backgroundColor: i % 2 === 1 ? "#F9FAFB" : "#FFFFFF",
                    borderLeft: "3px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#F5F5F3";
                    e.currentTarget.style.borderLeft = "3px solid #0D9488";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = i % 2 === 1 ? "#F9FAFB" : "#FFFFFF";
                    e.currentTarget.style.borderLeft = "3px solid transparent";
                  }}
                >
                  {/* IS Code */}
                  <td className="px-3 py-2.5" style={{ color: "#9CA3AF", fontFamily: "var(--font-jetbrains, 'JetBrains Mono', monospace)", fontSize: 10 }}>
                    {line.isCode || "\u2014"}
                  </td>

                  {/* Description */}
                  <td className="px-3 py-2.5" style={{ color: "#1A1A1A" }}>
                    {line.description}
                    {line.storey && (
                      <span className="ml-2 text-[10px]" style={{ color: "#9CA3AF" }}>
                        {line.storey}
                      </span>
                    )}
                  </td>

                  {/* Unit */}
                  <td className="px-3 py-2.5" style={{ color: "#4B5563" }}>
                    {line.unit}
                  </td>

                  {/* Qty */}
                  <td className="px-3 py-2.5" style={{ color: "#1A1A1A", fontVariantNumeric: "tabular-nums" }}>
                    {line.adjustedQty.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </td>

                  {/* Rate (editable) */}
                  <td className="px-3 py-2.5">
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
                          className="w-16 px-1.5 py-0.5 rounded text-xs outline-none"
                          style={{
                            background: "#F0FDFA",
                            border: "1px solid #0D9488",
                            color: "#1A1A1A",
                          }}
                          autoFocus
                        />
                        <button onClick={() => confirmEdit(line)} className="p-0.5">
                          <Check size={12} color="#059669" />
                        </button>
                        <button onClick={cancelEdit} className="p-0.5">
                          <X size={12} color="#DC2626" />
                        </button>
                      </div>
                    ) : (
                      <ProvenanceTooltip line={line}>
                        <div
                          className="flex items-center gap-1 cursor-pointer group/rate"
                          onClick={() => startEdit(line)}
                        >
                          {hasOverride && (
                            <Pencil size={10} color="#0D9488" className="shrink-0" />
                          )}
                          <span style={{
                            color: hasOverride ? "#0D9488" : "#1A1A1A",
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            \u20B9{(override?.newRate ?? line.unitRate).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </span>
                          {hasOverride && (
                            <span className="text-[10px] line-through" style={{ color: "#9CA3AF" }}>
                              \u20B9{line.unitRate.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            </span>
                          )}
                          <Pencil size={10} color="#9CA3AF" className="opacity-0 group-hover/rate:opacity-100 transition-opacity shrink-0" />
                        </div>
                      </ProvenanceTooltip>
                    )}
                  </td>

                  {/* Amount */}
                  <td
                    className="px-3 py-2.5 font-bold transition-colors duration-300"
                    style={{ color: "#1A1A1A", fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatINRFull(line.totalCost)}
                  </td>

                  {/* Source */}
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                      style={{
                        background: SOURCE_BADGE[line.source].bg,
                        color: SOURCE_BADGE[line.source].color,
                      }}
                    >
                      {SOURCE_BADGE[line.source].label}
                    </span>
                  </td>

                  {/* Confidence */}
                  <td className="px-3 py-2.5">
                    <ConfidenceBadge confidence={line.confidence} lineConfidence={line.lineConfidence} />
                  </td>
                </tr>
              );
            })}

            {/* Grand Total Row */}
            <tr
              style={{
                borderTop: "2px solid rgba(13, 148, 136, 0.2)",
                background: "#F0FDFA",
              }}
            >
              <td className="px-3 py-3 font-bold" style={{ color: "#0D9488" }}>
                TOTAL
              </td>
              <td colSpan={4} className="px-3 py-3" style={{ color: "#4B5563" }}>
                {filtered.length} line items
              </td>
              <td className="px-3 py-3 font-bold" style={{ color: "#0D9488", fontVariantNumeric: "tabular-nums" }}>
                {formatINRFull(grandTotal)}
              </td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderTop: "1px solid rgba(0, 0, 0, 0.06)" }}
        >
          <span className="text-xs" style={{ color: "#9CA3AF" }}>
            Showing {page * PAGE_SIZE + 1}\u2013{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-all"
              style={{
                background: page === 0 ? "transparent" : "#F9FAFB",
                border: "1px solid rgba(0,0,0,0.08)",
                opacity: page === 0 ? 0.3 : 1,
                cursor: page === 0 ? "default" : "pointer",
              }}
            >
              <ChevronLeft size={14} color="#4B5563" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const pageNum = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3, totalPages - 7)) + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className="w-7 h-7 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: page === pageNum ? "#F0FDFA" : "transparent",
                    color: page === pageNum ? "#0D9488" : "#9CA3AF",
                    border: page === pageNum ? "1px solid rgba(13, 148, 136, 0.25)" : "1px solid transparent",
                  }}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-all"
              style={{
                background: page >= totalPages - 1 ? "transparent" : "#F9FAFB",
                border: "1px solid rgba(0,0,0,0.08)",
                opacity: page >= totalPages - 1 ? 0.3 : 1,
                cursor: page >= totalPages - 1 ? "default" : "pointer",
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
