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
  "ifc-geometry": { label: "IFC Geometry", color: "#00F5FF", bg: "rgba(0,245,255,0.1)" },
  "ifc-derived": { label: "IFC Derived", color: "#FFBF00", bg: "rgba(255,191,0,0.1)" },
  "benchmark": { label: "Benchmark", color: "#9898B0", bg: "rgba(255,255,255,0.06)" },
  "provisional": { label: "Provisional", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
};

function ConfidenceBadge({ confidence, lineConfidence }: { confidence: number; lineConfidence?: BOQLineItem["lineConfidence"] }) {
  const score = lineConfidence?.score ?? getLineConfidenceScore(confidence);
  const label = score.toUpperCase();
  const color = getLineConfidenceColor(score);
  const factors = lineConfidence?.factors ?? [];
  return (
    <span className="relative group/conf inline-flex items-center gap-1.5">
      {/* Colored dot */}
      <span
        className="inline-block rounded-full shrink-0"
        style={{ width: 8, height: 8, background: color, boxShadow: `0 0 4px ${color}40` }}
      />
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: `${color}15`, color }}
      >
        {label}
      </span>
      {/* Tooltip on hover */}
      {factors.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-2 hidden group-hover/conf:block z-50"
          style={{
            background: "rgba(12,12,20,0.96)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            padding: "8px 10px",
            width: 240,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div className="text-[10px] font-semibold mb-1.5" style={{ color }}>
            {label} Confidence
          </div>
          {factors.map((f, i) => (
            <div key={i} className="text-[10px] leading-[1.4]" style={{ color: "#B0B0C8", marginBottom: 2 }}>
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
    return sortDir === "asc" ? <ChevronUp size={12} color="#00F5FF" /> : <ChevronDown size={12} color="#00F5FF" />;
  };

  return (
    <div
      className="mx-6 rounded-xl overflow-hidden"
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      {/* Hint + Tabs + Source Filter */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}
      >
        <div className="flex items-center gap-1.5 mr-3">
          <Pencil size={9} color="#5C5C78" />
          <span className="text-[10px]" style={{ color: "#5C5C78" }}>Click any Rate cell to override</span>
        </div>
      </div>
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}
      >
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                background: activeTab === tab.id ? "rgba(0, 245, 255, 0.1)" : "transparent",
                color: activeTab === tab.id ? "#00F5FF" : "#9898B0",
                border: activeTab === tab.id ? "1px solid rgba(0, 245, 255, 0.25)" : "1px solid transparent",
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
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "#9898B0",
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
            style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)", background: "rgba(255,255,255,0.01)" }}
          >
            <div className="flex items-center gap-4 text-[10px]">
              <span style={{ color: "#22C55E" }}>● {high} high</span>
              <span style={{ color: "#F59E0B" }}>● {med} medium</span>
              <span style={{ color: "#EF4444" }}>● {low} low</span>
            </div>
            <div className="flex items-center gap-4 text-[10px]" style={{ color: "#5C5C78" }}>
              {filtered.length} of {lines.length} items shown
            </div>
          </div>
        );
      })()}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
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
                  className={`px-3 py-3 text-left font-medium ${col.width} ${col.sortable ? "cursor-pointer select-none" : ""}`}
                  style={{ color: "#5C5C78" }}
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
                    borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                    opacity: rowsVisible ? 1 : 0,
                    transform: rowsVisible ? "translateY(0)" : "translateY(4px)",
                    transition: `opacity 0.3s ease ${i * 20}ms, transform 0.3s ease ${i * 20}ms, background-color 0.15s`,
                    backgroundColor: "transparent",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.02)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  {/* IS Code */}
                  <td className="px-3 py-2.5" style={{ color: "#5C5C78", fontFamily: "var(--font-jetbrains, monospace)", fontSize: 10 }}>
                    {line.isCode || "—"}
                  </td>

                  {/* Description */}
                  <td className="px-3 py-2.5" style={{ color: "#F0F0F5" }}>
                    {line.description}
                    {line.storey && (
                      <span className="ml-2 text-[10px]" style={{ color: "#5C5C78" }}>
                        {line.storey}
                      </span>
                    )}
                  </td>

                  {/* Unit */}
                  <td className="px-3 py-2.5" style={{ color: "#9898B0" }}>
                    {line.unit}
                  </td>

                  {/* Qty */}
                  <td className="px-3 py-2.5" style={{ color: "#F0F0F5", fontVariantNumeric: "tabular-nums" }}>
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
                            background: "rgba(0, 245, 255, 0.1)",
                            border: "1px solid rgba(0, 245, 255, 0.4)",
                            color: "#F0F0F5",
                          }}
                          autoFocus
                        />
                        <button onClick={() => confirmEdit(line)} className="p-0.5">
                          <Check size={12} color="#22C55E" />
                        </button>
                        <button onClick={cancelEdit} className="p-0.5">
                          <X size={12} color="#EF4444" />
                        </button>
                      </div>
                    ) : (
                      <ProvenanceTooltip line={line}>
                        <div
                          className="flex items-center gap-1 cursor-pointer group/rate"
                          onClick={() => startEdit(line)}
                        >
                          {hasOverride && (
                            <Pencil size={10} color="#00F5FF" className="shrink-0" />
                          )}
                          <span style={{
                            color: hasOverride ? "#00F5FF" : "#F0F0F5",
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            ₹{(override?.newRate ?? line.unitRate).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </span>
                          {hasOverride && (
                            <span className="text-[10px] line-through" style={{ color: "#5C5C78" }}>
                              ₹{line.unitRate.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            </span>
                          )}
                          <Pencil size={10} color="#5C5C78" className="opacity-0 group-hover/rate:opacity-100 transition-opacity shrink-0" />
                        </div>
                      </ProvenanceTooltip>
                    )}
                  </td>

                  {/* Amount */}
                  <td
                    className="px-3 py-2.5 font-medium transition-colors duration-300"
                    style={{ color: "#F0F0F5", fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatINRFull(line.totalCost)}
                  </td>

                  {/* Source */}
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium"
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
                borderTop: "2px solid rgba(0, 245, 255, 0.2)",
                background: "rgba(0, 245, 255, 0.03)",
              }}
            >
              <td className="px-3 py-3 font-bold" style={{ color: "#00F5FF" }}>
                TOTAL
              </td>
              <td colSpan={4} className="px-3 py-3" style={{ color: "#9898B0" }}>
                {filtered.length} line items
              </td>
              <td className="px-3 py-3 font-bold" style={{ color: "#00F5FF", fontVariantNumeric: "tabular-nums" }}>
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
          style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}
        >
          <span className="text-xs" style={{ color: "#5C5C78" }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-all"
              style={{
                background: page === 0 ? "transparent" : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                opacity: page === 0 ? 0.3 : 1,
                cursor: page === 0 ? "default" : "pointer",
              }}
            >
              <ChevronLeft size={14} color="#9898B0" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const pageNum = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3, totalPages - 7)) + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className="w-7 h-7 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: page === pageNum ? "rgba(0, 245, 255, 0.15)" : "transparent",
                    color: page === pageNum ? "#00F5FF" : "#9898B0",
                    border: page === pageNum ? "1px solid rgba(0, 245, 255, 0.3)" : "1px solid transparent",
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
                background: page >= totalPages - 1 ? "transparent" : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                opacity: page >= totalPages - 1 ? 0.3 : 1,
                cursor: page >= totalPages - 1 ? "default" : "pointer",
              }}
            >
              <ChevronRight size={14} color="#9898B0" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
