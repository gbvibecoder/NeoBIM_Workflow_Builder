"use client";

import React, { useMemo } from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import {
  validateProgram,
  type ProgramValidationResult,
  type ProgramRequirement,
  type ProgramIssue,
} from "@/features/floor-plan/lib/program-validator";

export function ProgramPanel() {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const prompt = useFloorPlanStore((s) => s.originalPrompt);
  const setSelectedIds = useFloorPlanStore((s) => s.setSelectedIds);

  const result = useMemo<ProgramValidationResult | null>(() => {
    if (!floor) return null;
    return validateProgram(floor, prompt);
  }, [floor, prompt]);

  if (!result) {
    return (
      <div className="p-4 text-sm text-gray-400">
        No floor plan loaded.
      </div>
    );
  }

  const handleClickIssue = (issue: ProgramIssue) => {
    if (issue.roomId) setSelectedIds([issue.roomId]);
  };

  return (
    <div className="flex flex-col text-xs">
      {/* Score header */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Program Validation</h3>

        <div className="flex items-center gap-4">
          <ProgramScoreRing score={result.score} />
          <div className="flex-1">
            <p className="text-gray-600 mb-1">{result.summary}</p>
            {prompt && (
              <p className="text-gray-400 text-[10px] leading-relaxed line-clamp-2">
                Prompt: &ldquo;{prompt}&rdquo;
              </p>
            )}
            {!prompt && (
              <p className="text-gray-400 text-[10px]">
                No prompt available — showing architectural checks only
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Requirements checklist */}
      {result.requirements.length > 0 && (
        <div className="border-b border-gray-200 p-3">
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Requirements</h4>
          {result.requirements.map((req, i) => (
            <RequirementRow key={i} requirement={req} />
          ))}
        </div>
      )}

      {/* Issues list */}
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-450px)]">
        {result.issues.length === 0 ? (
          <div className="p-4 text-center text-gray-400">
            <div className="text-2xl mb-1">&#10003;</div>
            Plan matches all requirements!
          </div>
        ) : (
          <div className="p-3">
            <h4 className="text-[10px] font-semibold text-gray-500 uppercase mb-2">
              Issues ({result.issues.length})
            </h4>
            {result.issues.map((issue, i) => (
              <IssueItem key={i} issue={issue} onClick={() => handleClickIssue(issue)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function ProgramScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444";

  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r="28" fill="none" stroke="#f1f5f9" strokeWidth="4" />
        <circle
          cx="32" cy="32" r="28"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold" style={{ color }}>{score}</span>
        <span className="text-[8px] font-semibold text-gray-400 uppercase">Match</span>
      </div>
    </div>
  );
}

function RequirementRow({ requirement }: { requirement: ProgramRequirement }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <span className={`text-sm ${requirement.met ? "text-green-500" : "text-red-500"}`}>
        {requirement.met ? "\u2713" : "\u2717"}
      </span>
      <span className="flex-1 text-gray-700 font-medium">{requirement.label}</span>
      <span className="text-gray-400">{requirement.expected}</span>
      <span className="text-gray-300">&rarr;</span>
      <span className={requirement.met ? "text-green-600" : "text-red-600"}>
        {requirement.actual}
      </span>
    </div>
  );
}

function IssueItem({ issue, onClick }: { issue: ProgramIssue; onClick: () => void }) {
  const severityConfig = {
    error: { dot: "#ef4444", bg: "bg-red-50", text: "text-red-600" },
    warning: { dot: "#eab308", bg: "bg-yellow-50", text: "text-yellow-600" },
    suggestion: { dot: "#3b82f6", bg: "bg-blue-50", text: "text-blue-600" },
  };
  const cfg = severityConfig[issue.severity];

  return (
    <button
      onClick={onClick}
      className="w-full text-left mb-2 rounded border border-gray-100 p-2 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: cfg.dot }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`px-1 py-0 rounded text-[9px] font-medium ${cfg.bg} ${cfg.text}`}>
              {issue.severity.toUpperCase()}
            </span>
          </div>
          <p className="text-gray-600 leading-relaxed">{issue.message}</p>
          {issue.fixable && issue.fixDescription && (
            <p className="text-blue-500 mt-0.5 text-[10px]">{issue.fixDescription}</p>
          )}
        </div>
      </div>
    </button>
  );
}
