"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronDown, ChevronUp, Download, FileDown,
  Box, Maximize2, CheckCircle2, Zap,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useExecutionStore } from "@/stores/execution-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { ExecutionArtifact } from "@/types/execution";
import type { FloorPlanRoom } from "./artifacts/FloorPlan3DViewer";

const FloorPlan3DViewer = dynamic(
  () => import("./artifacts/FloorPlan3DViewer"),
  { ssr: false }
);

// ─── Animated Number ─────────────────────────────────────────────────────────

function AnimatedNumber({ value, duration = 1500 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const progress = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [value, duration]);
  return <span>{display.toLocaleString()}</span>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findArtifactByType(artifacts: Map<string, ExecutionArtifact>, type: string): ExecutionArtifact | undefined {
  for (const a of artifacts.values()) {
    if (a.type === type) return a;
  }
  return undefined;
}

function findAllArtifactsByType(artifacts: Map<string, ExecutionArtifact>, type: string): ExecutionArtifact[] {
  const result: ExecutionArtifact[] = [];
  for (const a of artifacts.values()) {
    if (a.type === type) result.push(a);
  }
  return result;
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface ResultShowcaseProps {
  onClose: () => void;
}

export function ResultShowcase({ onClose }: ResultShowcaseProps) {
  const artifacts = useExecutionStore(s => s.artifacts);
  const nodes = useWorkflowStore(s => s.nodes);
  const currentWorkflow = useWorkflowStore(s => s.currentWorkflow);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  // Extract data from artifacts
  const textArtifact = findArtifactByType(artifacts, "text");
  const imageArtifact = findArtifactByType(artifacts, "image");
  const kpiArtifacts = findAllArtifactsByType(artifacts, "kpi");
  const svgArtifact = findArtifactByType(artifacts, "svg");
  const threeDArtifact = findArtifactByType(artifacts, "3d");
  const fileArtifacts = findAllArtifactsByType(artifacts, "file");
  const tableArtifacts = findAllArtifactsByType(artifacts, "table");

  // Get description text
  const description = textArtifact
    ? ((textArtifact.data as Record<string, unknown>)?.content as string) ?? ""
    : "";
  const descLines = description.split("\n");
  const shortDesc = descLines.slice(0, 4).join("\n");

  // Collect all KPI metrics
  const allMetrics: Array<{ label: string; value: string | number; unit?: string }> = [];
  kpiArtifacts.forEach(a => {
    const d = a.data as Record<string, unknown>;
    const metrics = (d?.metrics as Array<{ label: string; value: string | number; unit?: string }>) ?? [];
    allMetrics.push(...metrics);
  });

  // Get hero image
  const heroUrl = imageArtifact
    ? ((imageArtifact.data as Record<string, unknown>)?.url as string)
    : undefined;

  // 3D model data
  const modelData = threeDArtifact || svgArtifact;
  const modelRooms: FloorPlanRoom[] = modelData
    ? ((modelData.data as Record<string, unknown>)?.roomList as FloorPlanRoom[]) ?? []
    : [];

  // File downloads
  const downloadFiles = fileArtifacts.map(a => {
    const d = a.data as Record<string, unknown>;
    return {
      name: (d?.name as string) ?? "file",
      size: (d?.size as number) ?? 0,
      type: (d?.type as string) ?? "",
    };
  });

  // Project title from workflow name or first text
  const projectTitle = currentWorkflow?.name ?? "Workflow Results";

  const handleGeneratePDF = useCallback(async () => {
    const { generatePDFReport } = await import("@/services/pdf-report");
    const labels = new Map<string, string>();
    nodes.forEach(n => labels.set(n.id, n.data.label));
    await generatePDFReport({
      workflowName: projectTitle,
      artifacts,
      nodeLabels: labels,
    });
  }, [artifacts, nodes, projectTitle]);

  // 3D viewer fullscreen mode
  if (show3DViewer) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: "absolute", inset: 0, zIndex: 60,
          background: "rgba(4,4,8,0.98)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#F0F0F5" }}>
            3D Floor Plan
          </span>
          <button
            onClick={() => setShow3DViewer(false)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8,
              background: "rgba(255,255,255,0.06)", border: "none",
              color: "#8888A0", fontSize: 12, fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Back to Results
          </button>
        </div>
        <div style={{ flex: 1 }}>
          <FloorPlan3DViewer rooms={modelRooms} />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 40, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.97 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "absolute",
        top: "5%",
        right: "3%",
        width: "58%",
        height: "90%",
        background: "linear-gradient(145deg, rgba(12,14,24,0.95), rgba(8,10,18,0.98))",
        backdropFilter: "blur(40px)",
        WebkitBackdropFilter: "blur(40px)",
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 40px rgba(79,138,255,0.05)",
        overflow: "auto",
        zIndex: 50,
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "sticky", top: 16, float: "right",
          marginRight: 16, marginTop: 16,
          width: 32, height: 32, borderRadius: 8,
          background: "rgba(255,255,255,0.06)", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#5C5C78", cursor: "pointer", zIndex: 10,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#F0F0F5"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#5C5C78"; }}
      >
        <X size={14} />
      </button>

      <div style={{ padding: "32px 32px 24px" }}>

        {/* Status badge */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 12px", borderRadius: 20,
            background: "rgba(16,185,129,0.1)",
            border: "1px solid rgba(16,185,129,0.2)",
            marginBottom: 16,
          }}
        >
          <CheckCircle2 size={12} style={{ color: "#10B981" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#10B981" }}>
            Workflow Complete
          </span>
        </motion.div>

        {/* Project title */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          style={{
            fontSize: 28, fontWeight: 700, color: "#F0F0F5",
            lineHeight: 1.2, marginBottom: 24, letterSpacing: "-0.02em",
          }}
        >
          {projectTitle}
        </motion.h1>

        {/* Hero image */}
        {heroUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            style={{
              borderRadius: 16, overflow: "hidden",
              marginBottom: 24,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroUrl}
              alt="Concept render"
              style={{
                width: "100%", height: 280, objectFit: "cover",
                display: "block",
              }}
            />
          </motion.div>
        )}

        {/* KPI Bar */}
        {allMetrics.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(allMetrics.length, 5)}, 1fr)`,
              gap: 12,
              marginBottom: 24,
            }}
          >
            {allMetrics.slice(0, 6).map((m, i) => {
              const numericValue = typeof m.value === "number" ? m.value : parseFloat(String(m.value));
              const isNumeric = !isNaN(numericValue);
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 + i * 0.05 }}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 12,
                    padding: "14px 16px",
                    textAlign: "center",
                  }}
                >
                  <div style={{
                    fontSize: 24, fontWeight: 700, color: "#F0F0F5",
                    lineHeight: 1.1, marginBottom: 4,
                  }}>
                    {isNumeric ? <AnimatedNumber value={numericValue} duration={1200 + i * 200} /> : m.value}
                    {m.unit && (
                      <span style={{ fontSize: 12, color: "#5C5C78", marginLeft: 3 }}>{m.unit}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10, color: "#5C5C78", textTransform: "uppercase",
                    letterSpacing: "0.05em", fontWeight: 500,
                  }}>
                    {m.label}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Building Description */}
        {description && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            style={{ marginBottom: 24 }}
          >
            <div style={{
              fontSize: 13, color: "#8888A0", lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}>
              {descExpanded ? description : shortDesc}
              {descLines.length > 4 && (
                <button
                  onClick={() => setDescExpanded(e => !e)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    background: "none", border: "none",
                    color: "#4F8AFF", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", marginLeft: 8,
                  }}
                >
                  {descExpanded ? "Show less" : `Show more (+${descLines.length - 4} lines)`}
                  {descExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* Table preview */}
        {tableArtifacts.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            style={{ marginBottom: 24 }}
          >
            {tableArtifacts.map((ta, idx) => {
              const td = ta.data as Record<string, unknown>;
              const headers = (td?.headers as string[]) ?? [];
              const rows = (td?.rows as (string | number)[][]) ?? [];
              return (
                <div key={idx} style={{
                  background: "rgba(0,0,0,0.2)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  borderRadius: 12,
                  overflow: "hidden",
                }}>
                  <table style={{
                    width: "100%", borderCollapse: "collapse",
                    fontSize: 11, color: "#8888A0",
                  }}>
                    <thead>
                      <tr>
                        {headers.map((h, i) => (
                          <th key={i} style={{
                            padding: "10px 12px", textAlign: "left",
                            fontWeight: 600, color: "#B0B0C5",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            fontSize: 10, textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 8).map((row, ri) => (
                        <tr key={ri}>
                          {(row as (string | number)[]).map((cell, ci) => (
                            <td key={ci} style={{
                              padding: "8px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.03)",
                            }}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 8 && (
                    <div style={{ padding: "8px 12px", fontSize: 10, color: "#4F8AFF" }}>
                      +{rows.length - 8} more rows
                    </div>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}

        {/* 3D Model Button */}
        {modelRooms.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            onClick={() => setShow3DViewer(true)}
            style={{
              width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              padding: "16px",
              borderRadius: 14,
              background: "linear-gradient(135deg, rgba(79,138,255,0.1), rgba(99,102,241,0.1))",
              border: "1px solid rgba(79,138,255,0.25)",
              color: "#4F8AFF",
              fontSize: 15, fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              marginBottom: 20,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(79,138,255,0.15), rgba(99,102,241,0.15))";
              e.currentTarget.style.borderColor = "rgba(79,138,255,0.4)";
              e.currentTarget.style.boxShadow = "0 0 30px rgba(79,138,255,0.1)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(79,138,255,0.1), rgba(99,102,241,0.1))";
              e.currentTarget.style.borderColor = "rgba(79,138,255,0.25)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <Box size={18} />
            View 3D Floor Plan
            <Maximize2 size={14} style={{ opacity: 0.5 }} />
          </motion.button>
        )}

        {/* Download row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          style={{
            display: "flex", gap: 8, flexWrap: "wrap",
          }}
        >
          <button
            onClick={handleGeneratePDF}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "#8888A0", fontSize: 12, fontWeight: 500,
              cursor: "pointer", transition: "all 0.15s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#F0F0F5"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#8888A0"; }}
          >
            <FileDown size={12} /> PDF Report
          </button>
          {downloadFiles.map((f, i) => (
            <button
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#8888A0", fontSize: 12, fontWeight: 500,
                cursor: "pointer", transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#F0F0F5"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#8888A0"; }}
            >
              <Download size={12} />
              {f.name}
              {f.size > 0 && <span style={{ fontSize: 10, color: "#3A3A50" }}>{(f.size / 1024).toFixed(0)}KB</span>}
            </button>
          ))}
        </motion.div>

        {/* Stats footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          style={{
            display: "flex", alignItems: "center", gap: 16,
            marginTop: 24, paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Zap size={11} style={{ color: "#F59E0B" }} />
            <span style={{ fontSize: 11, color: "#5C5C78" }}>
              {artifacts.size} artifacts generated
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <CheckCircle2 size={11} style={{ color: "#10B981" }} />
            <span style={{ fontSize: 11, color: "#5C5C78" }}>
              {nodes.filter(n => n.data.status === "success").length}/{nodes.length} nodes
            </span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
