"use client";

import { useState, useCallback, useRef } from "react";
import { Layers, Package, HardHat, ChevronDown, TrendingDown, TrendingUp } from "lucide-react";
import type { PriceOverrides } from "./types";
import { PRICE_RANGES } from "./recalc-engine";

interface PriceControlsProps {
  prices: PriceOverrides;
  basePrices: PriceOverrides;
  onChange: (prices: PriceOverrides) => void;
  totalSavings: number; // positive = saving, negative = increase
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
    label: "Steel",
    icon: Layers,
    color: "#00F5FF",
    range: PRICE_RANGES.steel,
    formatValue: (v: number) => `₹${(v / 1000).toFixed(0)}K/t`,
    formatShort: (v: number) => `₹${(v / 1000).toFixed(0)}k/t`,
  },
  {
    key: "cement" as const,
    label: "Cement",
    icon: Package,
    color: "#B87333",
    range: PRICE_RANGES.cement,
    formatValue: (v: number) => `₹${v}/bag`,
    formatShort: (v: number) => `₹${v}/bag`,
  },
  {
    key: "mason" as const,
    label: "Mason",
    icon: HardHat,
    color: "#FFBF00",
    range: PRICE_RANGES.mason,
    formatValue: (v: number) => `₹${v}/day`,
    formatShort: (v: number) => `₹${v}/day`,
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

  const getSourceShort = (key: string): string => {
    if (!market) return "";
    if (key === "steel") return `${market.steelSource} · ${market.steelConfidence}`;
    if (key === "cement") return `${market.cementBrand} · ${market.cementConfidence}`;
    return `${market.masonSource} · ${market.masonConfidence}`;
  };

  const hasSavings = Math.abs(totalSavings) > 1000;
  const isSaving = totalSavings > 0;
  const savingsLabel = Math.abs(totalSavings) >= 100000
    ? `₹${(Math.abs(totalSavings) / 100000).toFixed(1)} L`
    : `₹${Math.abs(totalSavings).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

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

        {/* Savings indicator */}
        {hasSavings && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-300"
            style={{
              background: isSaving ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
              border: `1px solid ${isSaving ? "rgba(34, 197, 94, 0.25)" : "rgba(239, 68, 68, 0.25)"}`,
              color: isSaving ? "#22C55E" : "#EF4444",
            }}
          >
            {isSaving ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
            {isSaving ? `Save ${savingsLabel}` : `+${savingsLabel}`}
          </div>
        )}
      </div>

      {/* Sliders */}
      <div className="p-5 flex flex-col gap-4">
        {SLIDERS.map((slider) => {
          const value = prices[slider.key];
          const base = basePrices[slider.key];
          const pct = ((value - slider.range.min) / (slider.range.max - slider.range.min)) * 100;
          const isExpanded = expandedKey === slider.key;
          const hasChanged = value !== base;
          const delta = value - base;
          const deltaSign = delta > 0 ? "+" : "";

          return (
            <div key={slider.key}>
              {/* Row: icon + label/source + slider + value */}
              <div className="flex items-center gap-3">
                {/* Icon */}
                <div
                  className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                  style={{ background: `${slider.color}12` }}
                >
                  <slider.icon size={15} color={slider.color} />
                </div>

                {/* Label + clickable source */}
                <div className="flex flex-col min-w-[110px]">
                  <span className="text-xs font-medium" style={{ color: "#F0F0F5" }}>
                    {slider.label}
                  </span>
                  {market && (
                    <button
                      className="flex items-center gap-0.5 text-[10px] text-left"
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
                  )}
                </div>

                {/* Slider */}
                <div className="relative flex-1 h-7 flex items-center">
                  <div
                    className="absolute left-0 right-0 h-[5px] rounded-full"
                    style={{ background: "rgba(255, 255, 255, 0.06)" }}
                  />
                  <div
                    className="absolute left-0 h-[5px] rounded-full transition-all duration-75"
                    style={{
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${slider.color}60, ${slider.color})`,
                      boxShadow: `0 0 10px ${slider.color}25`,
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
                    style={{
                      appearance: "none",
                      WebkitAppearance: "none",
                      background: "transparent",
                      zIndex: 2,
                    }}
                  />
                </div>

                {/* Current value + delta */}
                <div className="shrink-0 min-w-[90px] text-right">
                  <div
                    className="text-sm font-bold transition-colors duration-300"
                    style={{ color: slider.color, fontVariantNumeric: "tabular-nums" }}
                  >
                    {slider.formatValue(value)}
                  </div>
                  {hasChanged && (
                    <div
                      className="text-[10px] font-medium transition-all duration-200"
                      style={{
                        color: delta < 0 ? "#22C55E" : "#EF4444",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {deltaSign}{slider.formatShort(delta)}
                    </div>
                  )}
                </div>
              </div>

              {/* Expandable reasoning (hidden by default) */}
              <div
                className="overflow-hidden transition-all duration-200"
                style={{
                  maxHeight: isExpanded ? 40 : 0,
                  opacity: isExpanded ? 1 : 0,
                }}
              >
                <p className="text-[10px] mt-1.5 ml-11 pr-4" style={{ color: "#5C5C78" }}>
                  Market rate sourced from {getSourceShort(slider.key)}.
                  Range: {slider.formatValue(slider.range.min)} – {slider.formatValue(slider.range.max)}.
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
