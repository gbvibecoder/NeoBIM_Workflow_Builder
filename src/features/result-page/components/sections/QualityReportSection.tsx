"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, AlertCircle, AlertTriangle, Info } from "lucide-react";

import { MonoLabel } from "@/features/result-page/components/aec/MonoLabel";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface QualityReportSectionProps {
  data: ResultPageData;
}

const SEVERITY_CONFIG = {
  high: { color: "#DC2626", bg: "#FEF2F2", Icon: AlertCircle },
  med: { color: "#CA8A04", bg: "#FEFCE8", Icon: AlertTriangle },
  low: { color: "#2563EB", bg: "#EFF6FF", Icon: Info },
} as const;

export function isQualityReportEligible(data: ResultPageData): boolean {
  return data.visionIssues.length > 0 || data.qualityScore !== null;
}

export function QualityReportSection({ data }: QualityReportSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const reduce = useReducedMotion();
  const issues = data.visionIssues;

  return (
    <section data-testid="quality-report-section">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          background: "#FFFFFF",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: expanded ? "12px 12px 0 0" : 12,
          cursor: "pointer",
          transition: "border-radius 200ms ease",
        }}
        data-testid="quality-report-toggle"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MonoLabel>Quality Report</MonoLabel>
          <span
            style={{
              fontSize: 12,
              color: "#64748B",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            }}
          >
            {issues.length > 0 ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : "No issues found"}
          </span>
        </div>
        <ChevronDown
          size={16}
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms ease",
            color: "#64748B",
          }}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={reduce ? { opacity: 1 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid rgba(15,23,42,0.08)",
                borderTop: "none",
                borderRadius: "0 0 12px 12px",
                padding: "12px 20px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
              data-testid="quality-report-issues"
            >
              {issues.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    color: "#94A3B8",
                    fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                    padding: "8px 0",
                  }}
                >
                  No issues found
                </div>
              ) : (
                issues.map((issue, i) => {
                  const cfg = SEVERITY_CONFIG[issue.severity] ?? SEVERITY_CONFIG.low;
                  const Icon = cfg.Icon;
                  return (
                    <div
                      key={`issue-${i}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "8px 12px",
                        borderRadius: 8,
                        background: cfg.bg,
                      }}
                    >
                      <Icon
                        size={14}
                        style={{ color: cfg.color, flexShrink: 0, marginTop: 2 }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: cfg.color,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                            }}
                          >
                            {issue.type}
                          </span>
                          {issue.affected_element && (
                            <span
                              style={{
                                fontSize: 11,
                                color: "#64748B",
                                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                              }}
                            >
                              ({issue.affected_element})
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 13, color: "#334155", lineHeight: 1.4 }}>
                          {issue.description}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
