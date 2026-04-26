"use client";

import { motion } from "framer-motion";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { ResultPageData, PipelineStep } from "@/features/result-page/hooks/useResultPageData";

interface OverviewTabProps {
  data: ResultPageData;
}

/**
 * Overview tab — jargon stripped per Phase 1 D2/D4:
 *  - No "AI-Generated Estimate" confidence pill
 *  - No "Powered by GPT-4o · DALL-E 3 · ..." TechChips
 *  - No "Also Generated" supporting cards (the hero + tabs already surface them)
 *  - No redundant CompactBanner (header already shows status pill + we render meta below)
 */
export function OverviewTab({ data }: OverviewTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {data.executionMeta.executedAt ? (
        <ExecutionMetaRow data={data} />
      ) : null}

      {data.pipelineSteps.length > 1 ? (
        <section>
          <SectionLabel title="Pipeline" />
          <PipelineStrip steps={data.pipelineSteps} />
        </section>
      ) : null}

      {data.complianceItems && data.complianceItems.length > 0 ? (
        <section>
          <SectionLabel title="Compliance" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.complianceItems.map(c => (
              <span
                key={c.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background:
                    c.status === "pass"
                      ? "rgba(16,185,129,0.10)"
                      : c.status === "fail"
                        ? "rgba(239,68,68,0.10)"
                        : "rgba(253,203,110,0.10)",
                  border: `1px solid ${
                    c.status === "pass"
                      ? "rgba(16,185,129,0.32)"
                      : c.status === "fail"
                        ? "rgba(239,68,68,0.32)"
                        : "rgba(253,203,110,0.32)"
                  }`,
                  color:
                    c.status === "pass" ? "#10B981" : c.status === "fail" ? "#EF4444" : "#FDCB6E",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span>{c.label}</span>
                {c.detail ? (
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{c.detail}</span>
                ) : null}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ExecutionMetaRow({ data }: { data: ResultPageData }) {
  const exec = data.executionMeta;
  const startedAt = exec.executedAt ? new Date(exec.executedAt) : null;
  const completedAt = exec.completedAt ? new Date(exec.completedAt) : null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 10,
      }}
    >
      {startedAt ? (
        <Tile label="Started" value={startedAt.toLocaleString()} />
      ) : null}
      {completedAt ? (
        <Tile label="Completed" value={completedAt.toLocaleString()} />
      ) : null}
      {exec.durationMs != null ? (
        <Tile
          label="Duration"
          value={
            exec.durationMs < 1000
              ? `${exec.durationMs}ms`
              : exec.durationMs < 60_000
                ? `${(exec.durationMs / 1000).toFixed(1)}s`
                : `${Math.floor(exec.durationMs / 60000)}m ${Math.floor((exec.durationMs % 60000) / 1000)}s`
          }
        />
      ) : null}
      {data.totalArtifacts > 0 ? (
        <Tile label="Outputs" value={String(data.totalArtifacts)} />
      ) : null}
    </motion.div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "rgba(245,245,250,0.55)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#F5F5FA",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const CATEGORY_COLOR: Record<string, string> = {
  input: "#00F5FF",
  transform: "#B87333",
  generate: "#FFBF00",
  export: "#4FC3F7",
};

function PipelineStrip({ steps }: { steps: PipelineStep[] }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        overflowX: "auto",
        paddingBottom: 8,
      }}
    >
      {steps.map((s, i) => {
        const accent = CATEGORY_COLOR[s.category] ?? "#9090A8";
        const StatusIcon =
          s.status === "success" ? CheckCircle2 : s.status === "running" ? Loader2 : XCircle;
        return (
          <div key={s.nodeId} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                minWidth: 88,
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: `${accent}15`,
                  border: `1.5px solid ${accent}55`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color:
                    s.status === "success"
                      ? "#10B981"
                      : s.status === "running"
                        ? "#00F5FF"
                        : "#EF4444",
                }}
              >
                <StatusIcon size={12} className={s.status === "running" ? "result-pipeline-spin" : undefined} />
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(245,245,250,0.6)",
                  textAlign: "center",
                  maxWidth: 96,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 1.5,
                  background: `linear-gradient(90deg, ${accent}55, ${
                    CATEGORY_COLOR[steps[i + 1]?.category ?? ""] ?? "#9090A8"
                  }55)`,
                  marginTop: -22,
                }}
              />
            ) : null}
          </div>
        );
      })}
      <style>{`
        .result-pipeline-spin { animation: result-pipeline-spin 0.8s linear infinite; }
        @keyframes result-pipeline-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "rgba(245,245,250,0.55)",
          textTransform: "uppercase",
          letterSpacing: "0.10em",
        }}
      >
        {title}
      </span>
      <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(255,255,255,0.10), transparent)" }} />
    </div>
  );
}
