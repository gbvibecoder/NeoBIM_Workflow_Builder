"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Calendar, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";

const QUICK_PICKS = [
  { label: "Today", months: 0 },
  { label: "+3 mo", months: 3 },
  { label: "+6 mo", months: 6 },
  { label: "+1 yr", months: 12 },
  { label: "+2 yr", months: 24 },
  { label: "+5 yr", months: 60 },
];

function formatDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function yearsFromNow(iso: string): number {
  const d = new Date(iso);
  return (d.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000);
}

function getMinDate(): string {
  return new Date().toISOString().split("T")[0];
}

function getMaxDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 10);
  return d.toISOString().split("T")[0];
}

function addMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0];
}

export function ProjectDatePill() {
  const projectDate = useWorkflowStore(s => s.projectDate);
  const setProjectDate = useWorkflowStore(s => s.setProjectDate);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const yrs = yearsFromNow(projectDate);
  const pillColor = yrs > 4 ? "#DC2626" : yrs > 2 ? "#D97706" : "#6B7280";
  const pillBg = yrs > 4 ? "rgba(220,38,38,0.08)" : yrs > 2 ? "rgba(217,119,6,0.08)" : "rgba(107,114,128,0.06)";
  const showWarning = yrs > 2;

  const handleDateChange = useCallback((value: string) => {
    const today = getMinDate();
    const max = getMaxDate();
    if (value < today) {
      toast.error("Project date cannot be in the past");
      return;
    }
    if (value > max) {
      toast.error("Project date too far ahead — rate projections become unreliable beyond 10 years");
      return;
    }
    setProjectDate(value);
    setOpen(false);
  }, [setProjectDate]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Pill button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Construction start date — used for cost escalation"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          height: 32,
          padding: "0 10px",
          borderRadius: 8,
          border: `1px solid ${pillColor}20`,
          background: pillBg,
          color: pillColor,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        <Calendar size={13} />
        <span>{formatDateShort(projectDate)}</span>
        {showWarning && <AlertTriangle size={11} />}
      </button>

      {/* Popover */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: 38,
            right: 0,
            width: 280,
            background: "#FFFFFF",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 100,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
            Construction Start Date
          </div>
          <div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 12 }}>
            BOQ rates auto-escalate from CPWD DSR 2025-26 baseline to this date.
          </div>

          {/* Calendar input */}
          <input
            type="date"
            value={projectDate}
            min={getMinDate()}
            max={getMaxDate()}
            onChange={e => handleDateChange(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
              fontSize: 13,
              color: "#111827",
              marginBottom: 12,
              outline: "none",
            }}
          />

          {/* Quick picks */}
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", marginBottom: 6 }}>
            Quick picks
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {QUICK_PICKS.map(p => {
              const val = addMonths(p.months);
              const isActive = projectDate === val;
              return (
                <button
                  key={p.label}
                  onClick={() => handleDateChange(val)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: isActive ? "1px solid #0D9488" : "1px solid #E5E7EB",
                    background: isActive ? "#F0FDFA" : "#FAFAFA",
                    color: isActive ? "#0D9488" : "#4B5563",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.12s",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Staleness indicator */}
          {yrs > 2 && (
            <div
              style={{
                marginTop: 12,
                padding: "6px 10px",
                borderRadius: 8,
                background: yrs > 4 ? "rgba(220,38,38,0.06)" : "rgba(217,119,6,0.06)",
                borderLeft: `3px solid ${yrs > 4 ? "#DC2626" : "#D97706"}`,
                fontSize: 10,
                color: yrs > 4 ? "#991B1B" : "#92400E",
              }}
            >
              {yrs > 4
                ? `⚠ ${Math.round(yrs)} years ahead — estimates will be unreliable. Live market refresh recommended.`
                : `${Math.round(yrs)} years ahead — rates auto-escalated ~${Math.round((Math.pow(1.06, yrs) - 1) * 100)}% from baseline.`
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
