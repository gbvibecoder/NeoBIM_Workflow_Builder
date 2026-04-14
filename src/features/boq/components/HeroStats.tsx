"use client";

import { IndianRupee, Ruler, Hammer, ShieldCheck, Check, AlertTriangle } from "lucide-react";
import { AnimatedNumber } from "@/features/boq/components/AnimatedNumber";
import { formatCrores } from "@/features/boq/components/recalc-engine";
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
}

function getCostPerM2Color(value: number, low: number, high: number): string {
  if (low === 0 && high === 0) return "#1A1A1A";
  if (value >= low && value <= high) return "#059669";
  if (value > high * 1.1 || value < low * 0.9) return "#DC2626";
  return "#D97706";
}

function getQualityThemeColor(score: number): { bg: string; text: string } {
  if (score >= 70) return { bg: "#ECFDF5", text: "#059669" };
  if (score >= 40) return { bg: "#FFFBEB", text: "#D97706" };
  return { bg: "#FEF2F2", text: "#DC2626" };
}

function BenchmarkBar({ value, low, high }: { value: number; low: number; high: number }) {
  if (low === 0 && high === 0) return null;

  const color = getCostPerM2Color(value, low, high);
  const isBelow = value < low;
  const isAbove = value > high;
  const isWithin = !isBelow && !isAbove;

  // Position on a scale from 0.5*low to 1.3*high
  const scaleMin = low * 0.5;
  const scaleMax = high * 1.3;
  const pos = Math.min(100, Math.max(0, ((value - scaleMin) / (scaleMax - scaleMin)) * 100));
  const lowPos = ((low - scaleMin) / (scaleMax - scaleMin)) * 100;
  const highPos = ((high - scaleMin) / (scaleMax - scaleMin)) * 100;

  const pctDiff = isBelow
    ? Math.round(((low - value) / low) * 100)
    : isAbove
    ? Math.round(((value - high) / high) * 100)
    : 0;

  return (
    <div className="mt-2">
      {/* Bar */}
      <div className="relative h-[6px] rounded-full" style={{ background: "rgba(0,0,0,0.04)" }}>
        {/* Benchmark range (green zone) */}
        <div
          className="absolute h-full rounded-full"
          style={{
            left: `${lowPos}%`,
            width: `${highPos - lowPos}%`,
            background: "rgba(5, 150, 105, 0.12)",
          }}
        />
        {/* Current value marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2"
          style={{
            left: `${pos}%`,
            transform: `translateX(-50%) translateY(-50%)`,
            background: color,
            borderColor: "#FFFFFF",
            boxShadow: `0 0 0 1px ${color}40, 0 1px 3px rgba(0,0,0,0.1)`,
            transition: "left 0.3s ease",
          }}
        />
      </div>
      {/* Status text */}
      <div className="flex items-center gap-1 mt-1.5">
        {isWithin ? (
          <Check size={9} color="#059669" />
        ) : (
          <AlertTriangle size={9} color={color} />
        )}
        <span className="text-[10px] font-medium" style={{ color }}>
          {isWithin
            ? "Within metro benchmark"
            : isBelow
            ? `${pctDiff}% below benchmark — add structural/MEP IFC for accuracy`
            : `${pctDiff}% above benchmark — review for optimization`}
        </span>
      </div>
    </div>
  );
}

export function HeroStats({
  totalCost,
  costPerM2,
  hardCosts,
  ifcQualityScore,
  benchmarkLow,
  benchmarkHigh,
  recalculated,
  costRange,
}: HeroStatsProps) {
  const costColor = getCostPerM2Color(costPerM2, benchmarkLow, benchmarkHigh);
  const qualityLabel = getIFCQualityLabel(ifcQualityScore);
  const qualityColor = getIFCQualityColor(ifcQualityScore);
  const qualityTheme = getQualityThemeColor(ifcQualityScore);

  const cards = [
    {
      key: "total",
      label: "Total Project Cost",
      icon: IndianRupee,
      color: "#0D9488",
      value: totalCost,
      formatter: (n: number) => `₹${formatCrores(n)} Cr`,
      large: true,
    },
    {
      key: "costm2",
      label: "Cost per m²",
      icon: Ruler,
      color: costColor,
      value: costPerM2,
      formatter: (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      hasBenchmarkBar: true,
    },
    {
      key: "hard",
      label: "Hard Cost Subtotal",
      icon: Hammer,
      color: "#B45309",
      value: hardCosts,
      formatter: (n: number) => `₹${formatCrores(n)} Cr`,
    },
    {
      key: "quality",
      label: "IFC Quality Score",
      icon: ShieldCheck,
      color: qualityColor,
      value: ifcQualityScore,
      formatter: (n: number) => `${qualityLabel} ${Math.round(n)}%`,
      noAnimate: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-6">
      {cards.map((card, i) => (
        <div
          key={card.key}
          className="relative overflow-hidden rounded-xl p-4 transition-all duration-300"
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            opacity: 0,
            animation: `heroCardFadeIn 0.4s ease-out ${i * 0.08}s forwards`,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(0,0,0,0.05)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          {/* Top accent line — teal gradient */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{ background: "linear-gradient(90deg, transparent, #0D948860, transparent)" }}
          />

          {/* Recalculated glow — subtle teal */}
          {recalculated && (
            <div
              className="absolute inset-0 pointer-events-none transition-opacity duration-500"
              style={{
                background: "rgba(13, 148, 136, 0.04)",
              }}
            />
          )}

          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex items-center justify-center w-7 h-7 rounded-lg"
              style={{
                background: card.key === "quality" ? qualityTheme.bg :
                  card.key === "hard" ? "#FFFBEB" :
                  card.key === "total" ? "#CCFBF1" :
                  "rgba(0,0,0,0.03)",
              }}
            >
              <card.icon
                size={14}
                color={
                  card.key === "quality" ? qualityTheme.text :
                  card.key === "hard" ? "#B45309" :
                  card.key === "total" ? "#0D9488" :
                  card.color
                }
              />
            </div>
            <span className="text-xs font-medium" style={{ color: "#9CA3AF" }}>
              {card.label}
            </span>
          </div>

          <div
            className={`${card.large ? "text-2xl" : "text-xl"} font-bold`}
            style={{
              color: card.key === "total" ? "#0D9488" :
                card.key === "hard" ? "#B45309" :
                card.key === "quality" ? qualityTheme.text :
                "#1A1A1A",
            }}
          >
            {card.noAnimate ? (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {card.formatter(card.value)}
              </span>
            ) : (
              <AnimatedNumber value={card.value} formatter={card.formatter} duration={500} />
            )}
          </div>

          {/* Cr label in serif for total card */}
          {card.key === "total" && (
            <style>{`
              [data-card-total] .cr-label {
                font-family: var(--font-dm-serif, 'DM Serif Display', serif);
              }
            `}</style>
          )}

          {/* Cost range for total card */}
          {card.key === "total" && costRange && costRange.totalLow > 0 && (
            <div className="mt-2">
              <div className="text-[10px] font-medium" style={{ color: "#4B5563" }}>
                Range: ₹{formatCrores(costRange.totalLow)} — ₹{formatCrores(costRange.totalHigh)} Cr
              </div>
              <div className="text-[10px]" style={{ color: "#9CA3AF" }}>
                ±{costRange.uncertaintyPercent}% uncertainty
              </div>
            </div>
          )}

          {/* Quality label chip */}
          {card.key === "quality" && (
            <div className="mt-2">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{
                  background: qualityTheme.bg,
                  color: qualityTheme.text,
                }}
              >
                {qualityLabel}
              </span>
            </div>
          )}

          {/* Benchmark bar for cost/m² card */}
          {card.hasBenchmarkBar && (
            <BenchmarkBar value={costPerM2} low={benchmarkLow} high={benchmarkHigh} />
          )}
        </div>
      ))}

      {/* Simple opacity transition keyframes replacing the old dark fade-in */}
      <style>{`
        @keyframes heroCardFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
