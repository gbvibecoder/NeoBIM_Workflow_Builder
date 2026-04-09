"use client";

import { IndianRupee, Ruler, Hammer, ShieldCheck, Check, AlertTriangle } from "lucide-react";
import { AnimatedNumber } from "@/features/boq/components/AnimatedNumber";
import { formatCrores } from "@/features/boq/components/recalc-engine";

interface HeroStatsProps {
  totalCost: number;
  costPerM2: number;
  hardCosts: number;
  ifcQualityScore: number;
  benchmarkLow: number;
  benchmarkHigh: number;
  recalculated: boolean;
}

function getCostPerM2Color(value: number, low: number, high: number): string {
  if (low === 0 && high === 0) return "#F0F0F5";
  if (value >= low && value <= high) return "#22C55E";
  if (value > high * 1.1 || value < low * 0.9) return "#EF4444";
  return "#F59E0B";
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
      <div className="relative h-[6px] rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
        {/* Benchmark range (green zone) */}
        <div
          className="absolute h-full rounded-full"
          style={{
            left: `${lowPos}%`,
            width: `${highPos - lowPos}%`,
            background: "rgba(34, 197, 94, 0.15)",
          }}
        />
        {/* Current value marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2"
          style={{
            left: `${pos}%`,
            transform: `translateX(-50%) translateY(-50%)`,
            background: color,
            borderColor: `${color}80`,
            boxShadow: `0 0 8px ${color}40`,
            transition: "left 0.3s ease",
          }}
        />
      </div>
      {/* Status text */}
      <div className="flex items-center gap-1 mt-1.5">
        {isWithin ? (
          <Check size={9} color="#22C55E" />
        ) : (
          <AlertTriangle size={9} color={color} />
        )}
        <span className="text-[10px]" style={{ color }}>
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
}: HeroStatsProps) {
  const costColor = getCostPerM2Color(costPerM2, benchmarkLow, benchmarkHigh);
  const qualityLabel = ifcQualityScore >= 80 ? "EXCELLENT" : ifcQualityScore >= 60 ? "GOOD" : ifcQualityScore >= 40 ? "FAIR" : "LIMITED";
  const qualityColor = ifcQualityScore >= 80 ? "#22C55E" : ifcQualityScore >= 60 ? "#00F5FF" : ifcQualityScore >= 40 ? "#F59E0B" : "#EF4444";

  const cards = [
    {
      key: "total",
      label: "Total Project Cost",
      icon: IndianRupee,
      color: "#00F5FF",
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
      color: "#B87333",
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
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            animation: `fade-in 0.5s ease-out ${i * 0.1}s both`,
          }}
        >
          {/* Top glow line */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{ background: `linear-gradient(90deg, transparent, ${card.color}60, transparent)` }}
          />

          {/* Recalculated flash */}
          {recalculated && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `${card.color}08`,
                animation: "fade-in 0.2s ease-out",
              }}
            />
          )}

          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex items-center justify-center w-7 h-7 rounded-lg"
              style={{ background: `${card.color}15` }}
            >
              <card.icon size={14} color={card.color} />
            </div>
            <span className="text-xs font-medium" style={{ color: "#9898B0" }}>
              {card.label}
            </span>
          </div>

          <div className={`${card.large ? "text-2xl" : "text-xl"} font-bold`} style={{ color: card.color }}>
            {card.noAnimate ? (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {card.formatter(card.value)}
              </span>
            ) : (
              <AnimatedNumber value={card.value} formatter={card.formatter} duration={500} />
            )}
          </div>

          {/* Benchmark bar for cost/m² card */}
          {card.hasBenchmarkBar && (
            <BenchmarkBar value={costPerM2} low={benchmarkLow} high={benchmarkHigh} />
          )}
        </div>
      ))}
    </div>
  );
}
