"use client";

import { useCallback, useRef } from "react";
import { Layers, Package, HardHat } from "lucide-react";
import type { PriceOverrides } from "./types";
import { PRICE_RANGES } from "./recalc-engine";

interface PriceControlsProps {
  prices: PriceOverrides;
  onChange: (prices: PriceOverrides) => void;
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
  },
  {
    key: "cement" as const,
    label: "Cement",
    icon: Package,
    color: "#B87333",
    range: PRICE_RANGES.cement,
    formatValue: (v: number) => `₹${v}/bag`,
  },
  {
    key: "mason" as const,
    label: "Mason",
    icon: HardHat,
    color: "#FFBF00",
    range: PRICE_RANGES.mason,
    formatValue: (v: number) => `₹${v}/day`,
  },
] as const;

export function PriceControls({ prices, onChange, market }: PriceControlsProps) {
  const rafRef = useRef<number>(0);

  const handleSliderChange = useCallback(
    (key: keyof PriceOverrides, raw: string) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        onChange({ ...prices, [key]: parseFloat(raw) });
      });
    },
    [prices, onChange]
  );

  const getSourceLabel = (key: string): string => {
    if (!market) return "";
    if (key === "steel") return `${market.steelSource} · ${market.steelConfidence}`;
    if (key === "cement") return `${market.cementBrand} · ${market.cementConfidence}`;
    return `${market.masonSource} · ${market.masonConfidence}`;
  };

  return (
    <div
      className="mx-6 rounded-xl overflow-hidden"
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
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

      {/* Sliders */}
      <div className="p-5 flex flex-col gap-5">
        {SLIDERS.map((slider) => {
          const value = prices[slider.key];
          const pct = ((value - slider.range.min) / (slider.range.max - slider.range.min)) * 100;

          return (
            <div key={slider.key} className="flex items-center gap-4">
              {/* Icon */}
              <div
                className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                style={{ background: `${slider.color}12` }}
              >
                <slider.icon size={16} color={slider.color} />
              </div>

              {/* Label + Source */}
              <div className="flex flex-col min-w-[100px]">
                <span className="text-xs font-medium" style={{ color: "#F0F0F5" }}>
                  {slider.label}
                </span>
                {market && (
                  <span className="text-[10px]" style={{ color: "#5C5C78" }}>
                    {getSourceLabel(slider.key)}
                  </span>
                )}
              </div>

              {/* Range label min */}
              <span className="text-[10px] shrink-0" style={{ color: "#5C5C78" }}>
                {slider.formatValue(slider.range.min)}
              </span>

              {/* Slider */}
              <div className="relative flex-1 h-8 flex items-center">
                {/* Track background */}
                <div
                  className="absolute left-0 right-0 h-[6px] rounded-full"
                  style={{ background: "rgba(255, 255, 255, 0.06)" }}
                />
                {/* Filled track */}
                <div
                  className="absolute left-0 h-[6px] rounded-full transition-all duration-75"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${slider.color}60, ${slider.color})`,
                    boxShadow: `0 0 12px ${slider.color}30`,
                  }}
                />
                {/* Native input */}
                <input
                  type="range"
                  min={slider.range.min}
                  max={slider.range.max}
                  step={slider.range.step}
                  value={value}
                  onChange={(e) => handleSliderChange(slider.key, e.target.value)}
                  className="boq-slider absolute w-full h-8 cursor-pointer"
                  style={{
                    appearance: "none",
                    WebkitAppearance: "none",
                    background: "transparent",
                    zIndex: 2,
                  }}
                />
              </div>

              {/* Range label max */}
              <span className="text-[10px] shrink-0" style={{ color: "#5C5C78" }}>
                {slider.formatValue(slider.range.max)}
              </span>

              {/* Current value */}
              <div
                className="text-sm font-bold shrink-0 min-w-[80px] text-right transition-colors duration-300"
                style={{ color: slider.color, fontVariantNumeric: "tabular-nums" }}
              >
                {slider.formatValue(value)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
