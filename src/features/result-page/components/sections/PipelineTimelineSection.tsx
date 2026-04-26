"use client";

import { motion } from "framer-motion";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2, Sparkles } from "lucide-react";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { SectionHeader } from "@/features/result-page/components/sections/SectionHeader";
import type { PipelineStep } from "@/features/result-page/hooks/useResultPageData";

interface PipelineTimelineSectionProps {
  steps: PipelineStep[];
}

const CATEGORY_COLOR: Record<string, { color: string; bg: string }> = {
  input: { color: "#0D9488", bg: "#F0FDFA" },
  transform: { color: "#7C3AED", bg: "#F5F3FF" },
  generate: { color: "#D97706", bg: "#FEF3C7" },
  export: { color: "#1E40AF", bg: "#EFF6FF" },
};

export function PipelineTimelineSection({ steps }: PipelineTimelineSectionProps) {
  if (steps.length < 2) return null;
  return (
    <ScrollReveal>
      <section style={{ padding: "0 clamp(12px, 3vw, 24px)" }}>
        <SectionHeader
          index={5}
          icon={<Activity size={16} />}
          label="Pipeline"
          title="The trail your run left"
          subtitle={`${steps.length} step${steps.length === 1 ? "" : "s"} · ${steps.filter(s => s.status === "success").length} succeeded · open Diagnostics for the deep trace`}
          iconColor="#7C3AED"
          iconBg="#F5F3FF"
        />
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.06)",
            borderRadius: 16,
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            padding: "16px 24px 20px",
          }}
        >
          {/* Phase 4 enrichment · aggregate strip — total time, node count, retries */}
          <PipelineAggregateStrip steps={steps} />
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 0,
              overflowX: "auto",
              paddingBottom: 8,
              paddingTop: 16,
              marginTop: 4,
              borderTop: "1px solid rgba(0,0,0,0.05)",
            }}
          >
            {steps.map((step, i) => {
              const cat = CATEGORY_COLOR[step.category] ?? { color: "#4B5563", bg: "#F3F4F6" };
              const Icon =
                step.status === "success"
                  ? CheckCircle2
                  : step.status === "error" || step.status === "failed"
                    ? XCircle
                    : step.status === "running"
                      ? Loader2
                      : Sparkles;
              const statusColor =
                step.status === "success"
                  ? "#059669"
                  : step.status === "error" || step.status === "failed"
                    ? "#DC2626"
                    : step.status === "running"
                      ? "#0D9488"
                      : "#9CA3AF";
              const showWarn = step.status === "warning";
              return (
                <motion.div
                  key={step.nodeId}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-30px" }}
                  transition={{ duration: 0.4, delay: 0.05 * i }}
                  style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 92,
                      maxWidth: 120,
                    }}
                  >
                    <span
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: cat.bg,
                        border: `1px solid ${cat.color}30`,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: statusColor,
                      }}
                    >
                      <Icon
                        size={15}
                        className={step.status === "running" ? "result-pipeline-spin" : undefined}
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#111827",
                        textAlign: "center",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 100,
                      }}
                    >
                      {step.label}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        color: cat.color,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {step.category}
                      {showWarn ? <AlertTriangle size={9} style={{ marginLeft: 4, display: "inline" }} aria-hidden="true" /> : null}
                    </span>
                  </div>
                  {i < steps.length - 1 ? (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 28,
                        height: 1.5,
                        marginTop: -28,
                        background: `linear-gradient(90deg, ${cat.color}55, ${
                          (CATEGORY_COLOR[steps[i + 1]?.category ?? ""] ?? { color: "#9CA3AF" }).color
                        }55)`,
                      }}
                    />
                  ) : null}
                </motion.div>
              );
            })}
          </div>
        </div>
        <style>{`
          .result-pipeline-spin { animation: result-pipeline-spin 0.9s linear infinite; }
          @keyframes result-pipeline-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </section>
    </ScrollReveal>
  );
}

function PipelineAggregateStrip({ steps }: { steps: PipelineStep[] }) {
  const succeeded = steps.filter(s => s.status === "success").length;
  const errored = steps.filter(s => s.status === "error" || s.status === "failed").length;
  const monoStyle = {
    fontFamily: "var(--font-jetbrains), ui-monospace, monospace" as const,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.06em",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span style={{ ...monoStyle, color: "#94A3B8", textTransform: "uppercase" }}>
        Aggregate
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ ...monoStyle, color: "#94A3B8", textTransform: "uppercase" }}>Steps</span>
        <span style={{ ...monoStyle, color: "#0F172A", fontWeight: 700 }}>{steps.length}</span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ ...monoStyle, color: "#94A3B8", textTransform: "uppercase" }}>Succeeded</span>
        <span style={{ ...monoStyle, color: succeeded === steps.length ? "#059669" : "#0F172A", fontWeight: 700 }}>
          {succeeded}
        </span>
      </span>
      {errored > 0 ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ ...monoStyle, color: "#94A3B8", textTransform: "uppercase" }}>Errored</span>
          <span style={{ ...monoStyle, color: "#DC2626", fontWeight: 700 }}>{errored}</span>
        </span>
      ) : null}
    </div>
  );
}
