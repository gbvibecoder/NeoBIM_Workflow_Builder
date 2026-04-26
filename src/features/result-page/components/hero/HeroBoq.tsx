"use client";

import { motion } from "framer-motion";
import { Calculator, Sparkles } from "lucide-react";
import { HeroCta } from "@/features/result-page/components/primitives/HeroCta";
import { PrimaryKpi } from "@/features/result-page/components/primitives/PrimaryKpi";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";
import type { PrimaryKpi as PrimaryKpiData } from "@/features/result-page/lib/select-primary-kpi";
import type { BoqSummary, TableDataItem } from "@/features/result-page/hooks/useResultPageData";

interface HeroBoqProps {
  boq: BoqSummary;
  kpi: PrimaryKpiData | null;
  tableData: TableDataItem[];
}

/** The BOQ entry promoted to a hero per Phase 1 D1.
 *  Massive ₹Cr KPI · 4-row table preview · giant "Open BOQ Visualizer →" CTA. */
export function HeroBoq({ boq, kpi, tableData }: HeroBoqProps) {
  const accent = getWorkflowAccent("boq");
  const previewTable = tableData.find(t => t.label?.toLowerCase().includes("bill of quantities") || t.label?.toLowerCase().includes("boq")) ?? tableData[0];
  const previewRows = (previewTable?.rows ?? []).slice(0, 4);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "relative",
        borderRadius: 24,
        overflow: "hidden",
        background: accent.gradient,
        border: `1px solid ${accent.ring}`,
        boxShadow: accent.glow,
        padding: "clamp(28px, 5vw, 56px)",
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: -60,
          background: `radial-gradient(circle at 30% 20%, ${accent.base}15 0%, transparent 55%), radial-gradient(circle at 75% 80%, ${accent.base}10 0%, transparent 60%)`,
          filter: "blur(50px)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", gap: 18 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 64,
            height: 64,
            borderRadius: 18,
            background: accent.tint,
            border: `1px solid ${accent.ring}`,
            color: accent.base,
            flexShrink: 0,
          }}
        >
          <Calculator size={28} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: accent.base,
            }}
          >
            BOQ · Cost Estimate
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 700,
              color: "#F5F5FA",
              letterSpacing: "-0.01em",
            }}
          >
            {boq.region ? `${boq.region} · live market rates` : "Live market-rate estimate"}
          </h2>
        </div>
      </div>

      {kpi ? (
        <div style={{ position: "relative", zIndex: 1 }}>
          <PrimaryKpi kpi={kpi} accent={accent} size="xl" />
        </div>
      ) : null}

      {previewTable && previewRows.length > 0 ? (
        <div
          style={{
            position: "relative",
            zIndex: 1,
            background: "rgba(0,0,0,0.32)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 18px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span style={{ fontSize: 11, color: "rgba(245,245,250,0.6)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
              Preview · first {previewRows.length} of {previewTable.rows.length} lines
            </span>
            <span style={{ fontSize: 11, color: accent.base, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Sparkles size={11} /> Live rates
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "rgba(245,245,250,0.85)" }}>
              <thead>
                <tr>
                  {previewTable.headers.slice(0, 5).map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: "10px 14px",
                        textAlign: i === previewTable.headers.length - 1 ? "right" : "left",
                        fontWeight: 600,
                        color: "rgba(245,245,250,0.55)",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        background: "rgba(0,0,0,0.4)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                    {row.slice(0, 5).map((cell, ci) => (
                      <td
                        key={ci}
                        style={{
                          padding: "9px 14px",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          textAlign: ci === row.length - 1 ? "right" : "left",
                          whiteSpace: "nowrap",
                          fontVariantNumeric: typeof cell === "number" ? "tabular-nums" : undefined,
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <HeroCta
          label="Open BOQ Visualizer"
          sublabel="Sliders, charts, full table, downloads"
          icon={<Calculator size={22} aria-hidden="true" />}
          accent={accent}
          href={`/dashboard/results/${boq.executionId}/boq`}
          size="xl"
        />
      </div>
    </motion.section>
  );
}
