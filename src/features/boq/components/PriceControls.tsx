"use client";

import { useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Layers, Package, HardHat, LayoutGrid, Mountain, TreePine, ChevronDown, TrendingDown, TrendingUp, RotateCcw } from "lucide-react";
import type { PriceOverrides } from "@/features/boq/components/types";
import { PRICE_RANGES } from "@/features/boq/components/recalc-engine";

interface PriceControlsProps {
  prices: PriceOverrides;
  basePrices: PriceOverrides;
  onChange: (prices: PriceOverrides) => void;
  totalSavings: number;
  baseTotal: number;
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
    color: "#0D9488",
    range: PRICE_RANGES.steel,
    formatValue: (v: number) => `\u20B9${(v / 1000).toFixed(0)}K/t`,
    formatDelta: (v: number) => `${(v / 1000).toFixed(1)}K`,
  },
  {
    key: "cement" as const,
    label: "Cement",
    icon: Package,
    color: "#B45309",
    range: PRICE_RANGES.cement,
    formatValue: (v: number) => `\u20B9${v}/bag`,
    formatDelta: (v: number) => `\u20B9${Math.abs(v).toFixed(0)}`,
  },
  {
    key: "mason" as const,
    label: "Mason Daily Wage",
    icon: HardHat,
    color: "#D97706",
    range: PRICE_RANGES.mason,
    formatValue: (v: number) => `\u20B9${v}/day`,
    formatDelta: (v: number) => `\u20B9${Math.abs(v).toFixed(0)}`,
  },
  {
    key: "bricks" as const,
    label: "Bricks / Blocks",
    icon: LayoutGrid,
    color: "#DC2626",
    range: PRICE_RANGES.bricks,
    formatValue: (v: number) => `\u20B9${v.toFixed(1)}/nos`,
    formatDelta: (v: number) => `\u20B9${Math.abs(v).toFixed(1)}`,
  },
  {
    key: "sand" as const,
    label: "River Sand / M-Sand",
    icon: Mountain,
    color: "#7C3AED",
    range: PRICE_RANGES.sand,
    formatValue: (v: number) => `\u20B9${v}/cft`,
    formatDelta: (v: number) => `\u20B9${Math.abs(v).toFixed(0)}`,
  },
  {
    key: "timber" as const,
    label: "Timber / Formwork",
    icon: TreePine,
    color: "#059669",
    range: PRICE_RANGES.timber,
    formatValue: (v: number) => `\u20B9${v.toLocaleString("en-IN")}/m\u00B2`,
    formatDelta: (v: number) => `\u20B9${Math.abs(v).toFixed(0)}`,
  },
] as const;

export function PriceControls({ prices, basePrices, onChange, totalSavings, baseTotal, market }: PriceControlsProps) {
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
    if (key === "steel") return `${market.steelSource} \u00B7 ${market.steelConfidence}`;
    if (key === "cement") return `${market.cementBrand} \u00B7 ${market.cementConfidence}`;
    if (key === "mason") return `${market.masonSource} \u00B7 ${market.masonConfidence}`;
    return "Benchmark rate";
  };

  const hasSavings = Math.abs(totalSavings) > 1000;
  const isSaving = totalSavings > 0;
  const savingsLabel = Math.abs(totalSavings) >= 100000
    ? `\u20B9${(Math.abs(totalSavings) / 100000).toFixed(1)} L`
    : `\u20B9${Math.abs(totalSavings).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const savingsPct = totalSavings !== 0 && baseTotal > 0 ? (Math.abs(totalSavings) / baseTotal * 100).toFixed(1) : "0";

  const hasAnyChange = SLIDERS.some(s => prices[s.key] !== basePrices[s.key]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{
        background: "#FFFFFF",
        borderRadius: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        border: "1px solid rgba(0,0,0,0.06)",
        padding: "20px 24px",
        margin: "0 24px",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 16,
          marginBottom: 16,
          borderBottom: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#059669",
              boxShadow: "0 0 8px rgba(5,150,105,0.5)",
              animation: "pulse-node 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            }}
          />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#111827",
              letterSpacing: "-0.01em",
            }}
          >
            Live Price Controls
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 9999,
              background: "#ECFDF5",
              color: "#059669",
              letterSpacing: "0.04em",
            }}
          >
            LIVE
          </span>
        </div>

        {/* Reset button */}
        {hasAnyChange && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            onClick={handleReset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 500,
              background: "#FFFFFF",
              border: "1px solid rgba(0,0,0,0.1)",
              color: "#6B7280",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "#0D9488";
              e.currentTarget.style.color = "#0D9488";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "rgba(0,0,0,0.1)";
              e.currentTarget.style.color = "#6B7280";
            }}
          >
            <RotateCcw size={11} />
            Reset all
          </motion.button>
        )}
      </div>

      {/* Sliders -- 2-column grid on desktop */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(1, 1fr)",
          gap: "20px 32px",
        }}
        className="lg:!grid-cols-2"
      >
        {SLIDERS.map((slider, index) => {
          const value = prices[slider.key];
          const base = basePrices[slider.key];
          const pct = ((value - slider.range.min) / (slider.range.max - slider.range.min)) * 100;
          const isExpanded = expandedKey === slider.key;
          const delta = value - base;
          const deltaPct = base > 0 ? ((delta / base) * 100).toFixed(1) : "0";
          const hasChanged = Math.abs(delta) > 0.01;

          return (
            <motion.div
              key={slider.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.04 }}
            >
              {/* Top row: icon + label + value */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* Icon with colored background */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    flexShrink: 0,
                    background: `${slider.color}14`,
                  }}
                >
                  <slider.icon size={15} color={slider.color} strokeWidth={2} />
                </div>

                {/* Label + source toggle */}
                <div style={{ display: "flex", flexDirection: "column", minWidth: 100, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#111827",
                      }}
                    >
                      {slider.label}
                    </span>
                    {/* Delta badge */}
                    {hasChanged && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: delta < 0 ? "#D1FAE5" : "#FEF3C7",
                          color: delta < 0 ? "#059669" : "#D97706",
                        }}
                      >
                        {delta < 0 ? `${deltaPct}% cheaper` : `+${deltaPct}% costlier`}
                      </motion.span>
                    )}
                  </div>
                  <button
                    onClick={() => setExpandedKey(isExpanded ? null : slider.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 10,
                      color: "#6B7280",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                      width: "fit-content",
                    }}
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

                {/* Value -- right-aligned, slider color */}
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: slider.color,
                    flexShrink: 0,
                    textAlign: "right",
                    minWidth: 75,
                    fontVariantNumeric: "tabular-nums",
                    transition: "color 0.2s ease",
                  }}
                >
                  {slider.formatValue(value)}
                </div>
              </div>

              {/* Slider track */}
              <div
                style={{
                  position: "relative",
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  marginTop: 6,
                  marginLeft: 44,
                }}
              >
                {/* Background track */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    height: 5,
                    borderRadius: 9999,
                    background: "#F3F4F6",
                  }}
                />
                {/* Filled portion -- gradient */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    height: 5,
                    borderRadius: 9999,
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${slider.color}60, ${slider.color})`,
                    transition: "width 75ms ease",
                  }}
                />
                <input
                  type="range"
                  min={slider.range.min}
                  max={slider.range.max}
                  step={slider.range.step}
                  value={value}
                  onChange={(e) => handleSliderChange(slider.key, e.target.value)}
                  className="boq-slider"
                  style={{
                    position: "absolute",
                    width: "100%",
                    height: 28,
                    cursor: "pointer",
                    appearance: "none",
                    WebkitAppearance: "none",
                    background: "transparent",
                    zIndex: 2,
                  }}
                />
                {/* Min label */}
                <span
                  style={{
                    position: "absolute",
                    bottom: -4,
                    left: 0,
                    fontSize: 9,
                    color: "#D1D5DB",
                  }}
                >
                  {slider.formatValue(slider.range.min)}
                </span>
                {/* Max label */}
                <span
                  style={{
                    position: "absolute",
                    bottom: -4,
                    right: 0,
                    fontSize: 9,
                    color: "#D1D5DB",
                  }}
                >
                  {slider.formatValue(slider.range.max)}
                </span>
              </div>

              {/* Expandable reasoning */}
              <div
                style={{
                  overflow: "hidden",
                  maxHeight: isExpanded ? 36 : 0,
                  opacity: isExpanded ? 1 : 0,
                  transition: "all 0.2s ease",
                }}
              >
                <p
                  style={{
                    fontSize: 10,
                    marginTop: 8,
                    marginLeft: 44,
                    color: "#4B5563",
                  }}
                >
                  Range: {slider.formatValue(slider.range.min)} &ndash; {slider.formatValue(slider.range.max)} &middot; Base: {slider.formatValue(base)}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Total impact / savings bar */}
      {hasSavings && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 16,
            padding: "12px 16px",
            borderRadius: 12,
            background: isSaving ? "#F0FDF4" : "#FFFBEB",
            transition: "background 0.3s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isSaving ? (
              <TrendingDown size={14} color="#059669" />
            ) : (
              <TrendingUp size={14} color="#D97706" />
            )}
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: isSaving ? "#059669" : "#D97706",
              }}
            >
              {isSaving ? `Save ${savingsLabel}` : `Extra ${savingsLabel}`}
            </span>
            <span
              style={{
                fontSize: 10,
                color: isSaving ? "rgba(5,150,105,0.7)" : "rgba(217,119,6,0.7)",
              }}
            >
              ({isSaving ? "-" : "+"}{savingsPct}%)
            </span>
          </div>
          <span style={{ fontSize: 10, color: "#6B7280" }}>
            vs. base market rates
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}
