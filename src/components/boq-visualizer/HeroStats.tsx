"use client";

import { IndianRupee, Ruler, Hammer, ShieldCheck } from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";
import { formatCrores } from "./recalc-engine";

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
  if (value <= high && value >= low) return "#22C55E";
  if (value > high * 1.1 || value < low * 0.9) return "#EF4444";
  return "#F59E0B";
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
      label: "Total Project Cost",
      icon: IndianRupee,
      color: "#00F5FF",
      value: totalCost,
      formatter: (n: number) => `₹${formatCrores(n)} Cr`,
      large: true,
    },
    {
      label: "Cost per m²",
      icon: Ruler,
      color: costColor,
      value: costPerM2,
      formatter: (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      subtitle: benchmarkLow > 0 ? `Benchmark: ₹${benchmarkLow.toLocaleString("en-IN")}–₹${benchmarkHigh.toLocaleString("en-IN")}` : undefined,
    },
    {
      label: "Hard Cost Subtotal",
      icon: Hammer,
      color: "#B87333",
      value: hardCosts,
      formatter: (n: number) => `₹${formatCrores(n)} Cr`,
    },
    {
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
          key={card.label}
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

          {card.subtitle && (
            <div className="text-[10px] mt-1.5" style={{ color: "#5C5C78" }}>
              {card.subtitle}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
