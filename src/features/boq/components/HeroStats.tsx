"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { IndianRupee, Ruler, Hammer, ShieldCheck, Check, AlertTriangle } from "lucide-react";
import { AnimatedNumber } from "@/features/boq/components/AnimatedNumber";
import { formatINR } from "@/features/boq/components/recalc-engine";
import { getIFCQualityLabel, getIFCQualityColor } from "@/features/boq/constants/quality-thresholds";

interface HeroStatsProps {
  totalCost: number;
  costPerM2: number;
  hardCosts: number;
  ifcQualityScore: number;
  benchmarkLow: number;
  benchmarkHigh: number;
  recalculated: boolean;
  costRange?: { totalLow: number; totalHigh: number; uncertaintyPercent: number };
  projectDate?: string;
  stalenessWarning?: { severity: string; years: number; message: string };
  marketDataConfidence?: "live" | "cached" | "escalated" | "static";
}

const CONFIDENCE_BADGE: Record<string, { label: string; color: string; bg: string; tooltip: string }> = {
  live:      { label: "LIVE",      color: "#059669", bg: "rgba(5,150,105,0.08)",  tooltip: "Market prices from AI web search — freshest available" },
  cached:    { label: "CACHED",    color: "#D97706", bg: "rgba(217,119,6,0.08)",  tooltip: "Recent market prices from cache (≤7 days old)" },
  escalated: { label: "ESCALATED", color: "#EA580C", bg: "rgba(234,88,12,0.08)",  tooltip: "Baseline rates escalated by inflation curves — no live market data" },
  static:    { label: "STATIC",    color: "#DC2626", bg: "rgba(220,38,38,0.08)",  tooltip: "Using CPWD DSR baseline rates — live market data unavailable" },
};

function getCostPerM2Color(value: number, low: number, high: number): string {
  if (low === 0 && high === 0) return "#1A1A1A";
  if (value >= low && value <= high) return "#059669";
  if (value > high * 1.1 || value < low * 0.9) return "#DC2626";
  return "#D97706";
}

// ─── Cost Range Gauge ────────────────────────────────────────────────────────
function CostRangeGauge({ low, best, high }: { low: number; high: number; best: number }) {
  if (low <= 0 || high <= 0) return null;
  const range = high - low;
  const bestPos = range > 0 ? ((best - low) / range) * 100 : 50;

  return (
    <div className="mt-4 px-1">
      {/* Labels — formatINR auto-switches Cr / L / raw based on magnitude
          so a ₹1.37 L estimate doesn't render as "₹0.01 Cr". */}
      <div className="flex justify-between mb-1.5">
        <span className="text-[10px] font-medium" style={{ color: "#6B7280" }}>
          {formatINR(low)}
        </span>
        <span className="text-[11px] font-bold" style={{ color: "#0D9488" }}>
          {formatINR(best)}
        </span>
        <span className="text-[10px] font-medium" style={{ color: "#6B7280" }}>
          {formatINR(high)}
        </span>
      </div>
      {/* Track */}
      <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, #D1FAE5, #FEF3C7, #FEE2E2)" }}>
        {/* Best estimate dot */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2"
          style={{ left: `${bestPos}%` }}
          initial={{ scale: 0, x: "-50%" }}
          animate={{ scale: 1, x: "-50%" }}
          transition={{ delay: 0.8, duration: 0.4, type: "spring", stiffness: 200 }}
        >
          <div
            className="w-4 h-4 rounded-full border-[2.5px] border-white"
            style={{
              background: "#0D9488",
              boxShadow: "0 0 0 3px rgba(13,148,136,0.2), 0 2px 4px rgba(0,0,0,0.1)",
              animation: "pulseGlow 2.5s ease-in-out infinite",
            }}
          />
        </motion.div>
      </div>
      <style>{`
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 0 3px rgba(13,148,136,0.2), 0 2px 4px rgba(0,0,0,0.1); }
          50% { box-shadow: 0 0 0 6px rgba(13,148,136,0.12), 0 2px 8px rgba(0,0,0,0.08); }
        }
      `}</style>
    </div>
  );
}

// ─── SVG Quality Ring ────────────────────────────────────────────────────────
function QualityRing({ score, label }: { score: number; label: string }) {
  const size = 96;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = getIFCQualityColor(score);

  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="#F3F4F6" strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, delay: 0.5, ease: "easeOut" }}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold" style={{ color, fontVariantNumeric: "tabular-nums" }}>
            {score}%
          </span>
        </div>
      </div>
      <div>
        <div className="text-xs font-medium" style={{ color: "#6B7280" }}>IFC Quality</div>
        <div className="text-sm font-bold mt-0.5" style={{ color }}>
          {label}
        </div>
      </div>
    </div>
  );
}

// ─── Benchmark Bar ───────────────────────────────────────────────────────────
function BenchmarkBar({ value, low, high }: { value: number; low: number; high: number }) {
  if (low === 0 && high === 0) return null;
  const color = getCostPerM2Color(value, low, high);
  const isBelow = value < low;
  const isAbove = value > high;
  const isWithin = !isBelow && !isAbove;
  const scaleMin = low * 0.5;
  const scaleMax = high * 1.3;
  const pos = Math.min(100, Math.max(0, ((value - scaleMin) / (scaleMax - scaleMin)) * 100));
  const lowPos = ((low - scaleMin) / (scaleMax - scaleMin)) * 100;
  const highPos = ((high - scaleMin) / (scaleMax - scaleMin)) * 100;
  const pctDiff = isBelow ? Math.round(((low - value) / low) * 100) : isAbove ? Math.round(((value - high) / high) * 100) : 0;

  return (
    <div className="mt-3">
      <div className="relative h-[6px] rounded-full" style={{ background: "#F3F4F6" }}>
        <div className="absolute h-full rounded-full" style={{ left: `${lowPos}%`, width: `${highPos - lowPos}%`, background: "rgba(5,150,105,0.15)" }} />
        <motion.div
          className="absolute top-1/2 w-2.5 h-2.5 rounded-full border-2 border-white"
          style={{ left: `${pos}%`, background: color, boxShadow: `0 0 0 2px ${color}30`, translateX: "-50%", translateY: "-50%" }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.6, type: "spring", stiffness: 300 }}
        />
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        {isWithin ? <Check size={9} color="#059669" /> : <AlertTriangle size={9} color={color} />}
        <span className="text-[10px] font-medium" style={{ color }}>
          {isWithin ? "Within benchmark" : isBelow ? `${pctDiff}% below benchmark` : `${pctDiff}% above benchmark`}
        </span>
      </div>
    </div>
  );
}

// ─── Card Wrapper with entrance animation ────────────────────────────────────
const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.98 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

// ─── Main Component ──────────────────────────────────────────────────────────
export function HeroStats({
  totalCost, costPerM2, hardCosts, ifcQualityScore,
  benchmarkLow, benchmarkHigh, recalculated, costRange,
  projectDate, stalenessWarning, marketDataConfidence,
}: HeroStatsProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-30px" });
  const prefersReduced = useReducedMotion();
  const shouldAnimate = isInView && !prefersReduced;
  const qualityLabel = getIFCQualityLabel(ifcQualityScore);

  return (
    <div ref={ref} className="px-6">
      {/* Project date + escalation banner */}
      {projectDate && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: stalenessWarning?.severity === "critical" ? "rgba(220,38,38,0.06)" : stalenessWarning?.severity === "warning" ? "rgba(217,119,6,0.06)" : "rgba(13,148,136,0.04)",
            borderLeft: `3px solid ${stalenessWarning?.severity === "critical" ? "#DC2626" : stalenessWarning?.severity === "warning" ? "#D97706" : "#0D9488"}`,
            fontSize: 12,
            color: "#374151",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>
              Estimate for construction starting {new Date(projectDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </span>
            {marketDataConfidence && (() => {
              const badge = CONFIDENCE_BADGE[marketDataConfidence] ?? CONFIDENCE_BADGE.static;
              return (
                <span
                  title={badge.tooltip}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 9999,
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                    color: badge.color, background: badge.bg,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: badge.color }} />
                  {badge.label}
                </span>
              );
            })()}
          </span>
          {stalenessWarning && (
            <span style={{ display: "block", marginTop: 3, fontSize: 11, color: stalenessWarning.severity === "critical" ? "#991B1B" : "#92400E" }}>
              {stalenessWarning.message}
            </span>
          )}
          {!stalenessWarning && (
            <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "#6B7280" }}>
              Rate library: CPWD DSR 2025-26 (baseline April 2026)
            </span>
          )}
        </div>
      )}
      {/* Row 1: Total Cost — big hero card */}
      <motion.div
        variants={cardVariants} custom={0}
        initial="hidden" animate={shouldAnimate ? "visible" : "hidden"}
        className="rounded-2xl p-6 mb-4 relative overflow-hidden transition-shadow duration-300"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.06)",
          boxShadow: recalculated
            ? "0 0 0 2px rgba(13,148,136,0.15), 0 4px 16px rgba(0,0,0,0.08)"
            : "0 4px 16px rgba(0,0,0,0.06)",
        }}
      >
        {/* Top accent gradient */}
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #0D9488, #0D948840, transparent)" }} />

        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl" style={{ background: "#F0FDFA" }}>
            <IndianRupee size={16} color="#0D9488" />
          </div>
          <span className="text-xs font-medium tracking-wide uppercase" style={{ color: "#6B7280", letterSpacing: "0.05em" }}>
            Total Project Cost
          </span>
          {costRange && costRange.uncertaintyPercent > 0 && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#FEF3C7", color: "#D97706" }}>
              ±{costRange.uncertaintyPercent}%
            </span>
          )}
        </div>
        <div className="text-5xl font-bold tracking-tight" style={{ color: "#0D9488", fontVariantNumeric: "tabular-nums" }}>
          <AnimatedNumber value={totalCost} formatter={formatINR} duration={1200} />
        </div>
        {/* Cost Range Gauge */}
        {costRange && costRange.totalLow > 0 && (
          <CostRangeGauge low={costRange.totalLow} best={totalCost} high={costRange.totalHigh} />
        )}
      </motion.div>

      {/* Row 2: Three metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Cost per m² */}
        <motion.div
          variants={cardVariants} custom={1}
          initial="hidden" animate={shouldAnimate ? "visible" : "hidden"}
          className="rounded-2xl p-5 transition-all duration-300 hover:shadow-md"
          style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#F3F4F6" }}>
              <Ruler size={14} color="#4B5563" />
            </div>
            <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Cost / m²</span>
          </div>
          <div className="text-2xl font-bold" style={{ color: "#111827", fontVariantNumeric: "tabular-nums" }}>
            <AnimatedNumber value={costPerM2} formatter={(n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} duration={800} />
          </div>
          <BenchmarkBar value={costPerM2} low={benchmarkLow} high={benchmarkHigh} />
        </motion.div>

        {/* Hard Costs */}
        <motion.div
          variants={cardVariants} custom={2}
          initial="hidden" animate={shouldAnimate ? "visible" : "hidden"}
          className="rounded-2xl p-5 transition-all duration-300 hover:shadow-md"
          style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#FEF3C7" }}>
              <Hammer size={14} color="#D97706" />
            </div>
            <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Hard Costs</span>
          </div>
          <div className="text-2xl font-bold" style={{ color: "#B45309", fontVariantNumeric: "tabular-nums" }}>
            <AnimatedNumber value={hardCosts} formatter={formatINR} duration={800} />
          </div>
        </motion.div>

        {/* IFC Quality — with SVG ring */}
        <motion.div
          variants={cardVariants} custom={3}
          initial="hidden" animate={shouldAnimate ? "visible" : "hidden"}
          className="rounded-2xl p-5 transition-all duration-300 hover:shadow-md"
          style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
        >
          <QualityRing score={ifcQualityScore} label={qualityLabel} />
        </motion.div>
      </div>
    </div>
  );
}
