"use client";

import { useState, useCallback, useRef } from "react";
import { Layers, Package, HardHat, Boxes, Mountain, TreePine, ChevronDown, TrendingDown, TrendingUp, RotateCcw } from "lucide-react";
import type { PriceOverrides } from "@/components/boq-visualizer/types";
import { PRICE_RANGES } from "@/components/boq-visualizer/recalc-engine";

interface PriceControlsProps {
  prices: PriceOverrides;
  basePrices: PriceOverrides;
  onChange: (prices: PriceOverrides) => void;
  totalSavings: number;
  market?: {
    steelSource: string;
    steelConfidence: string;
    cementBrand: string;
    cementConfidence: string;
    masonSource: string;
    masonConfidence: string;
  };
}

const SLIDERS = [
  {
    key: "steel" as const,
    label: "TMT Steel Fe500",
    icon: Layers,
    color: "#00F5FF",
    range: PRICE_RANGES.steel,
    formatValue: (v: number) => `₹${(v / 1000).toFixed(0)}K/t`,
    formatDelta: (v: number) => `${(v / 1000).toFixed(1)}K`,
  },
  {
    key: "cement" as const,
    label: "Cement",
    icon: Package,
    color: "#B87333",
    range: PRICE_RANGES.cement,
    formatValue: (v: number) => `₹${v}/bag`,
    formatDelta: (v: number) => `₹${Math.abs(v).toFixed(0)}`,
  },
  {
    key: "mason" as const,
    label: "Mason Daily Wage",
    icon: HardHat,
    color: "#FFBF00",
    range: PRICE_RANGES.mason,
    formatValue: (v: number) => `₹${v}/day`,
    formatDelta: (v: number) => `₹${Math.abs(v).toFixed(0)}`,
  },
  {
    key: "bricks" as const,
    label: "Bricks / Blocks",
    icon: Boxes,
    color: "#F59E0B",
    range: PRICE_RANGES.bricks,
    formatValue: (v: number) => `₹${v.toFixed(1)}/nos`,
    formatDelta: (v: number) => `₹${Math.abs(v).toFixed(1)}`,
  },
  {
    key: "sand" as const,
    label: "River Sand / M-Sand",
    icon: Mountain,
    color: "#8B5CF6",
    range: PRICE_RANGES.sand,
    formatValue: (v: number) => `₹${v}/cft`,
    formatDelta: (v: number) => `₹${Math.abs(v).toFixed(0)}`,
  },
  {
    key: "timber" as const,
    label: "Timber / Formwork",
    icon: TreePine,
    color: "#10B981",
    range: PRICE_RANGES.timber,
    formatValue: (v: number) => `₹${v.toLocaleString("en-IN")}/m²`,
    formatDelta: (v: number) => `₹${Math.abs(v).toFixed(0)}`,
  },
] as const;

export function PriceControls({ prices, basePrices, onChange, totalSavings, market }: PriceControlsProps) {
  const rafRef = useRef<number>(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const handleSliderChange = useCallback(
    (key: keyof PriceOverrides, raw: string) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        onChange({ ...prices, [key]: parseFloat(raw) });
      });
    },
    [prices, onChange]
  );

  const handleReset = useCallback(() => {
    onChange({ ...basePrices });
  }, [basePrices, onChange]);

  const getSourceShort = (key: string): string => {
    if (!market) return "";
    if (key === "steel") return `${market.steelSource} · ${market.steelConfidence}`;
    if (key === "cement") return `${market.cementBrand} · ${market.cementConfidence}`;
    if (key === "mason") return `${market.masonSource} · ${market.masonConfidence}`;
    return "Benchmark rate";
  };

  const hasSavings = Math.abs(totalSavings) > 1000;
  const isSaving = totalSavings > 0;
  const savingsLabel = Math.abs(totalSavings) >= 100000
    ? `₹${(Math.abs(totalSavings) / 100000).toFixed(1)} L`
    : `₹${Math.abs(totalSavings).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const savingsPct = totalSavings !== 0 ? Math.abs(totalSavings / (totalSavings + Math.abs(totalSavings)) * 100).toFixed(1) : "0";

  const hasAnyChange = SLIDERS.some(s => prices[s.key] !== basePrices[s.key]);

  return (
    <div
      className="mx-6 rounded-xl overflow-hidden"
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: "#22C55E",
                boxShadow: "0 0 8px rgba(34, 197, 94, 0.5)",
                animation: "pulse-node 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
              }}
            />
          </div>
          <span className="text-sm font-semibold" style={{ color: "#F0F0F5" }}>
            Live Price Controls
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(34, 197, 94, 0.12)", color: "#22C55E" }}>
            LIVE
          </span>
        </div>

        {/* Reset button */}
        {hasAnyChange && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all duration-200"
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "#9898B0",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,245,255,0.3)"; e.currentTarget.style.color = "#00F5FF"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#9898B0"; }}
          >
            <RotateCcw size={10} />
            Reset all
          </button>
        )}
      </div>

      {/* Sliders — 2-column grid on desktop */}
      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        {SLIDERS.map((slider) => {
          const value = prices[slider.key];
          const base = basePrices[slider.key];
          const pct = ((value - slider.range.min) / (slider.range.max - slider.range.min)) * 100;
          const isExpanded = expandedKey === slider.key;
          const delta = value - base;
          const deltaPct = base > 0 ? ((delta / base) * 100).toFixed(1) : "0";
          const hasChanged = Math.abs(delta) > 0.01;

          return (
            <div key={slider.key}>
              <div className="flex items-center gap-3">
                {/* Icon */}
                <div
                  className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                  style={{ background: `${slider.color}12` }}
                >
                  <slider.icon size={14} color={slider.color} />
                </div>

                {/* Label + source toggle */}
                <div className="flex flex-col min-w-[100px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: "#F0F0F5" }}>
                      {slider.label}
                    </span>
                    {/* Delta badge */}
                    {hasChanged && (
                      <span
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded transition-all duration-200"
                        style={{
                          background: delta < 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                          color: delta < 0 ? "#22C55E" : "#EF4444",
                        }}
                      >
                        {delta < 0 ? `${deltaPct}% cheaper` : `+${deltaPct}% costlier`}
                      </span>
                    )}
                  </div>
                  <button
                    className="flex items-center gap-0.5 text-[10px] text-left w-fit"
                    style={{ color: "#5C5C78" }}
                    onClick={() => setExpandedKey(isExpanded ? null : slider.key)}
                  >
                    {getSourceShort(slider.key)}
                    <ChevronDown
                      size={8}
                      style={{
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.2s ease",
                      }}
                    />
                  </button>
                </div>

                {/* Value */}
                <div
                  className="text-sm font-bold shrink-0 text-right transition-colors duration-200"
                  style={{ color: slider.color, fontVariantNumeric: "tabular-nums", minWidth: 70 }}
                >
                  {slider.formatValue(value)}
                </div>
              </div>

              {/* Slider track */}
              <div className="relative h-7 flex items-center mt-1 ml-11">
                <div
                  className="absolute left-0 right-0 h-[5px] rounded-full"
                  style={{ background: "rgba(255, 255, 255, 0.06)" }}
                />
                <div
                  className="absolute left-0 h-[5px] rounded-full transition-all duration-75"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${slider.color}50, ${slider.color})`,
                    boxShadow: `0 0 10px ${slider.color}20`,
                  }}
                />
                <input
                  type="range"
                  min={slider.range.min}
                  max={slider.range.max}
                  step={slider.range.step}
                  value={value}
                  onChange={(e) => handleSliderChange(slider.key, e.target.value)}
                  className="boq-slider absolute w-full h-7 cursor-pointer"
                  style={{ appearance: "none", WebkitAppearance: "none", background: "transparent", zIndex: 2 }}
                />
                {/* Min/Max labels */}
                <span className="absolute -bottom-3 left-0 text-[8px]" style={{ color: "#3A3A50" }}>
                  {slider.formatValue(slider.range.min)}
                </span>
                <span className="absolute -bottom-3 right-0 text-[8px]" style={{ color: "#3A3A50" }}>
                  {slider.formatValue(slider.range.max)}
                </span>
              </div>

              {/* Expandable reasoning */}
              <div
                className="overflow-hidden transition-all duration-200"
                style={{ maxHeight: isExpanded ? 32 : 0, opacity: isExpanded ? 1 : 0 }}
              >
                <p className="text-[10px] mt-2 ml-11" style={{ color: "#5C5C78" }}>
                  Range: {slider.formatValue(slider.range.min)} – {slider.formatValue(slider.range.max)} · Base: {slider.formatValue(base)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Total impact bar */}
      {hasSavings && (
        <div
          className="px-5 py-3 flex items-center justify-between transition-all duration-300"
          style={{
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            background: isSaving ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.04)",
          }}
        >
          <div className="flex items-center gap-2">
            {isSaving ? <TrendingDown size={14} color="#22C55E" /> : <TrendingUp size={14} color="#EF4444" />}
            <span className="text-xs font-semibold" style={{ color: isSaving ? "#22C55E" : "#EF4444" }}>
              {isSaving ? `Save ${savingsLabel}` : `Extra ${savingsLabel}`}
            </span>
            <span className="text-[10px]" style={{ color: isSaving ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)" }}>
              ({isSaving ? "-" : "+"}{savingsPct}%)
            </span>
          </div>
          <span className="text-[10px]" style={{ color: "#5C5C78" }}>
            vs. base market rates
          </span>
        </div>
      )}
    </div>
  );
}
