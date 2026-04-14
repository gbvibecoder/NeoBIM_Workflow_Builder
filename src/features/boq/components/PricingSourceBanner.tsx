"use client";

import { Wifi, WifiOff, AlertTriangle } from "lucide-react";
import type { BOQData } from "@/features/boq/components/types";

interface PricingSourceBannerProps {
  metadata: NonNullable<BOQData["pricingMetadata"]>;
}

export function PricingSourceBanner({ metadata }: PricingSourceBannerProps) {
  const config = {
    market_intelligence: {
      icon: Wifi,
      color: "#0D9488",
      bg: "#FFFFFF",
      border: "rgba(0, 0, 0, 0.06)",
      leftBorder: "#0D9488",
      label: `Live Market Prices${metadata.cityUsed ? ` (${metadata.cityUsed}${metadata.stateUsed ? `, ${metadata.stateUsed}` : ""})` : ""}`,
      sub: metadata.lastMarketUpdate
        ? `Updated ${new Date(metadata.lastMarketUpdate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
        : undefined,
    },
    mixed: {
      icon: AlertTriangle,
      color: "#D97706",
      bg: "#FFFFFF",
      border: "rgba(0, 0, 0, 0.06)",
      leftBorder: "#D97706",
      label: "Mixed Pricing — some materials using static rates",
      sub: metadata.staleDateWarning,
    },
    cpwd_static: {
      icon: WifiOff,
      color: "#6B7280",
      bg: "#FFFFFF",
      border: "rgba(0, 0, 0, 0.06)",
      leftBorder: "#6B7280",
      label: `Using ${metadata.staticRateVersion} Static Rates`,
      sub: metadata.staleDateWarning || "Live pricing unavailable. Prices may differ by 5-15% from current market.",
    },
  }[metadata.source];

  const Icon = config.icon;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: config.bg,
      border: `1px solid ${config.border}`,
      borderLeft: `4px solid ${config.leftBorder}`,
      borderRadius: 10,
      padding: "10px 14px",
      boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
    }}>
      <Icon size={16} color={config.color} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: config.color }}>{config.label}</div>
        {config.sub && (
          <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>{config.sub}</div>
        )}
      </div>
      {/* Pulsing dot for live */}
      {metadata.source === "market_intelligence" && (
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "#0D9488",
          boxShadow: "0 0 6px rgba(13,148,136,0.5)",
          animation: "pulse 2s ease-in-out infinite",
        }} />
      )}
    </div>
  );
}
