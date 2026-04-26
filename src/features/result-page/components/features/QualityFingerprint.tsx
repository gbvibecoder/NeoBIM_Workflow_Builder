"use client";

import { motion } from "framer-motion";
import { MonoLabel } from "@/features/result-page/components/aec/MonoLabel";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface QualityFingerprintProps {
  data: ResultPageData;
}

/**
 * Phase 3 functional addition · "Quality fingerprint."
 *
 * Compact 3-stat widget shown in the page header so an architect glancing
 * at an old run knows immediately whether it's worth re-opening:
 *   STEPS 3/3 · DURATION 36s · ARTIFACTS 7
 *
 * Visually: monospace tags separated by middle-dots, like a stamp on a
 * drawing's title block.
 */
export function QualityFingerprint({ data }: QualityFingerprintProps) {
  const totalSteps = data.totalNodes || data.pipelineSteps.length;
  const stepsLabel = totalSteps > 0 ? `${data.successNodes}/${totalSteps}` : "—";
  const stepsColor =
    totalSteps === 0
      ? "#94A3B8"
      : data.successNodes === totalSteps
        ? "#0D9488"
        : data.successNodes === 0
          ? "#DC2626"
          : "#D97706";

  const durationMs = data.executionMeta.durationMs;
  const durationLabel =
    durationMs == null
      ? "—"
      : durationMs < 1000
        ? `${durationMs}ms`
        : durationMs < 60_000
          ? `${(durationMs / 1000).toFixed(1)}s`
          : `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1000)}s`;

  const artifactsLabel = String(data.totalArtifacts);

  const items = [
    { tag: "STEPS", value: stepsLabel, color: stepsColor },
    { tag: "DURATION", value: durationLabel, color: "#475569" },
    { tag: "ARTIFACTS", value: artifactsLabel, color: data.totalArtifacts > 0 ? "#475569" : "#94A3B8" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 12px",
        borderRadius: 9999,
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      {items.map((item, i) => (
        <span key={item.tag} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <MonoLabel size={10} color="#94A3B8">
            {item.tag}
          </MonoLabel>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 12,
              fontWeight: 600,
              color: item.color,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.02em",
            }}
          >
            {item.value}
          </span>
          {i < items.length - 1 ? (
            <span aria-hidden="true" style={{ color: "#CBD5E1", fontSize: 12, fontWeight: 600 }}>
              ·
            </span>
          ) : null}
        </span>
      ))}
    </motion.div>
  );
}
