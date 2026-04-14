"use client";

import { useState } from "react";
import { ShieldAlert, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import type { BOQData } from "@/features/boq/components/types";

interface ModelQualityCardProps {
  report: NonNullable<BOQData["modelQualityReport"]>;
}

const GRADE_CONFIG = {
  A: { color: "#059669", label: "Excellent", bg: "#ECFDF5", border: "rgba(5,150,105,0.2)" },
  B: { color: "#2563EB", label: "Good", bg: "rgba(37,99,235,0.06)", border: "rgba(37,99,235,0.2)" },
  C: { color: "#D97706", label: "Fair", bg: "#FFFBEB", border: "rgba(217,119,6,0.2)" },
  D: { color: "#EA580C", label: "Needs Work", bg: "rgba(234,88,12,0.06)", border: "rgba(234,88,12,0.2)" },
  F: { color: "#DC2626", label: "Poor", bg: "#FEF2F2", border: "rgba(220,38,38,0.2)" },
} as const;

export function ModelQualityCard({ report }: ModelQualityCardProps) {
  const [expanded, setExpanded] = useState(false);
  const grade = GRADE_CONFIG[report.overallGrade];
  const { issuesFound } = report;
  const totalIssues = issuesFound.zeroVolumeElements.count
    + issuesFound.noMaterialElements.count
    + issuesFound.unassignedStoreyElements.count
    + issuesFound.duplicateElements.count
    + issuesFound.suspiciousDimensions.count;

  const showWarningBanner = report.overallGrade === "D" || report.overallGrade === "F";

  return (
    <div style={{
      background: "#FFFFFF",
      border: `1px solid rgba(0, 0, 0, 0.06)`,
      borderTop: `3px solid ${grade.color}`,
      borderRadius: 12,
      padding: 20,
      position: "relative",
      overflow: "hidden",
      boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ShieldAlert size={16} color={grade.color} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A" }}>IFC Model Quality</span>
        </div>
        {/* Grade badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: grade.bg,
          border: `1px solid ${grade.border}`,
          borderRadius: 20,
          padding: "4px 14px",
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: grade.color }}>{report.overallGrade}</span>
          <span style={{ fontSize: 11, color: grade.color, fontWeight: 500 }}>{grade.label}</span>
        </div>
      </div>

      {/* Warning banner for D/F grades */}
      {showWarningBanner && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "#FEF2F2",
          border: "1px solid rgba(220,38,38,0.12)",
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 12,
          fontSize: 12,
          color: "#DC2626",
        }}>
          <AlertTriangle size={14} />
          Model quality issues are affecting BOQ accuracy. See recommendations below.
        </div>
      )}

      {/* Summary */}
      <div style={{ fontSize: 12, color: "#4B5563", marginBottom: 12 }}>
        {totalIssues === 0
          ? <span style={{ color: "#059669" }}>No issues found — {report.totalElements} elements processed cleanly</span>
          : <span>{totalIssues} issue{totalIssues !== 1 ? "s" : ""} found across {report.totalElements} elements</span>
        }
      </div>

      {/* Expandable details */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", cursor: "pointer",
          fontSize: 11, color: "#0D9488", padding: 0,
        }}
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? "Hide details" : "Show details"}
      </button>

      {expanded && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Issue categories */}
          {issuesFound.zeroVolumeElements.count > 0 && (
            <IssueRow
              icon={<XCircle size={13} color="#DC2626" />}
              label={`${issuesFound.zeroVolumeElements.count} zero-volume elements`}
              detail={issuesFound.zeroVolumeElements.types.join(", ")}
            />
          )}
          {issuesFound.noMaterialElements.count > 0 && (
            <IssueRow
              icon={<AlertTriangle size={13} color="#D97706" />}
              label={`${issuesFound.noMaterialElements.count} elements without material`}
              detail={issuesFound.noMaterialElements.types.join(", ")}
            />
          )}
          {issuesFound.unassignedStoreyElements.count > 0 && (
            <IssueRow
              icon={<Info size={13} color="#D97706" />}
              label={`${issuesFound.unassignedStoreyElements.count} elements not assigned to storey`}
              detail="Floor-wise breakdown may be incomplete"
            />
          )}
          {issuesFound.duplicateElements.count > 0 && (
            <IssueRow
              icon={<AlertTriangle size={13} color="#EA580C" />}
              label={`${issuesFound.duplicateElements.count} potential duplicates`}
              detail={issuesFound.duplicateElements.estimatedImpact}
            />
          )}
          {issuesFound.suspiciousDimensions.count > 0 && (
            <IssueRow
              icon={<AlertTriangle size={13} color="#D97706" />}
              label={`${issuesFound.suspiciousDimensions.count} suspicious dimensions`}
              detail={issuesFound.suspiciousDimensions.details[0] || "Check wall/slab thicknesses"}
            />
          )}
          {issuesFound.unitInconsistencies && (
            <IssueRow
              icon={<Info size={13} color="#2563EB" />}
              label="Unit conversion applied"
              detail="Non-metric units detected and converted to metres"
            />
          )}
          {totalIssues === 0 && (
            <IssueRow
              icon={<CheckCircle2 size={13} color="#059669" />}
              label="All checks passed"
              detail="Model is well-structured for quantity takeoff"
            />
          )}

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 6 }}>Recommendations</div>
              {report.recommendations.map((rec, i) => (
                <div key={i} style={{
                  fontSize: 11, color: "#4B5563", lineHeight: 1.5,
                  paddingLeft: 12, borderLeft: "2px solid rgba(13,148,136,0.3)",
                  marginBottom: 4,
                }}>
                  {rec}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IssueRow({ icon, label, detail }: { icon: React.ReactNode; label: string; detail: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "6px 10px",
      background: "#F9FAFB",
      borderRadius: 6,
    }}>
      <div style={{ marginTop: 1 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 12, color: "#1A1A1A", fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 10, color: "#6B7280" }}>{detail}</div>
      </div>
    </div>
  );
}
