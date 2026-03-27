"use client";

import React, { useMemo } from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { validateBuildingCode, type CodeReport } from "@/lib/floor-plan/code-validator";
import { CODE_CATEGORY_LABELS, type CodeCategory, type CodeViolation } from "@/lib/floor-plan/building-code-rules";

export function CodeCompliancePanel() {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const projectType = useFloorPlanStore((s) => s.project?.metadata.project_type ?? "residential");
  const setSelectedIds = useFloorPlanStore((s) => s.setSelectedIds);

  const report = useMemo<CodeReport | null>(() => {
    if (!floor) return null;
    return validateBuildingCode(floor, projectType);
  }, [floor, projectType]);

  if (!report) {
    return (
      <div className="p-4 text-sm text-gray-400">
        No floor plan loaded.
      </div>
    );
  }

  const handleClick = (v: CodeViolation) => {
    if (v.entity_id) setSelectedIds([v.entity_id]);
  };

  const categories = Object.keys(report.by_category) as CodeCategory[];
  const activeCategories = categories.filter((c) => report.by_category[c].length > 0);

  return (
    <div className="flex flex-col text-xs">
      {/* Summary Header */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">NBC 2016 Compliance</h3>

        {/* Stats bar */}
        <div className="flex items-center gap-3 mb-3">
          <Stat label="Checks" value={report.total_checks} color="#64748b" />
          <Stat label="Pass" value={report.passes} color="#22c55e" />
          <Stat label="Errors" value={report.errors} color="#ef4444" />
          <Stat label="Warnings" value={report.warnings} color="#eab308" />
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden flex">
          {report.total_checks > 0 && (
            <>
              <div
                className="h-full bg-green-500"
                style={{ width: `${(report.passes / report.total_checks) * 100}%` }}
              />
              <div
                className="h-full bg-yellow-400"
                style={{ width: `${(report.warnings / report.total_checks) * 100}%` }}
              />
              <div
                className="h-full bg-red-500"
                style={{ width: `${(report.errors / report.total_checks) * 100}%` }}
              />
            </>
          )}
        </div>

        <p className="text-gray-500 mt-2">{report.summary}</p>
      </div>

      {/* Violations by category */}
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-400px)]">
        {report.violations.length === 0 ? (
          <div className="p-4 text-center text-gray-400">
            <div className="text-2xl mb-1">&#10003;</div>
            All checks passed!
          </div>
        ) : (
          activeCategories.map((cat) => (
            <CategorySection
              key={cat}
              category={cat}
              violations={report.by_category[cat]}
              onClick={handleClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-lg font-bold" style={{ color }}>{value}</span>
      <span className="text-[9px] text-gray-400 uppercase">{label}</span>
    </div>
  );
}

function CategorySection({
  category,
  violations,
  onClick,
}: {
  category: CodeCategory;
  violations: CodeViolation[];
  onClick: (v: CodeViolation) => void;
}) {
  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warning").length;

  return (
    <div className="border-b border-gray-100">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
        <span className="text-[10px] font-semibold text-gray-500 uppercase">
          {CODE_CATEGORY_LABELS[category]}
        </span>
        <div className="flex items-center gap-2">
          {errors > 0 && (
            <span className="text-[10px] font-medium text-red-500">{errors} error{errors > 1 ? "s" : ""}</span>
          )}
          {warnings > 0 && (
            <span className="text-[10px] font-medium text-yellow-600">{warnings} warning{warnings > 1 ? "s" : ""}</span>
          )}
        </div>
      </div>

      {violations.map((v, i) => (
        <ViolationItem key={`${v.rule_id}-${v.entity_id}-${i}`} violation={v} onClick={() => onClick(v)} />
      ))}
    </div>
  );
}

function ViolationItem({ violation, onClick }: { violation: CodeViolation; onClick: () => void }) {
  const severityColor = violation.severity === "error" ? "#ef4444" : violation.severity === "warning" ? "#eab308" : "#94a3b8";
  const severityBg = violation.severity === "error" ? "bg-red-50" : violation.severity === "warning" ? "bg-yellow-50" : "bg-gray-50";

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-50"
    >
      <div className="flex items-start gap-2">
        <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: severityColor }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-medium text-gray-700">{violation.entity_name}</span>
            <span className={`px-1 py-0 rounded text-[9px] font-medium ${severityBg}`} style={{ color: severityColor }}>
              {violation.severity.toUpperCase()}
            </span>
          </div>
          <p className="text-gray-500 leading-relaxed">{violation.message}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-gray-400">Actual: {violation.actual_value}</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-400">Required: {violation.required_value}</span>
          </div>
          <p className="text-blue-500 mt-0.5 text-[10px]">{violation.suggestion}</p>
          <p className="text-gray-300 mt-0.5 text-[10px]">{violation.rule.code_ref}</p>
        </div>
      </div>
    </button>
  );
}
