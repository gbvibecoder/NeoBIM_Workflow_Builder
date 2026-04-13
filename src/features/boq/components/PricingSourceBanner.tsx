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
      color: "#22C55E",
      bg: "rgba(34,197,94,0.06)",
      border: "rgba(34,197,94,0.15)",
      label: `Live Market Prices${metadata.cityUsed ? ` (${metadata.cityUsed}${metadata.stateUsed ? `, ${metadata.stateUsed}` : ""})` : ""}`,
      sub: metadata.lastMarketUpdate
        ? `Updated ${new Date(metadata.lastMarketUpdate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
        : undefined,
    },
    mixed: {
      icon: AlertTriangle,
      color: "#F59E0B",
      bg: "rgba(245,158,11,0.06)",
      border: "rgba(245,158,11,0.15)",
      label: "Mixed Pricing — some materials using static rates",
      sub: metadata.staleDateWarning,
    },
    cpwd_static: {
      icon: WifiOff,
      color: "#F97316",
      bg: "rgba(249,115,22,0.06)",
      border: "rgba(249,115,22,0.15)",
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
      borderRadius: 10,
      padding: "10px 14px",
    }}>
      <Icon size={16} color={config.color} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: config.color }}>{config.label}</div>
        {config.sub && (
          <div style={{ fontSize: 10, color: "#9898B0", marginTop: 2 }}>{config.sub}</div>
        )}
      </div>
      {/* Pulsing dot for live */}
      {metadata.source === "market_intelligence" && (
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "#22C55E",
          boxShadow: "0 0 6px rgba(34,197,94,0.5)",
          animation: "pulse 2s ease-in-out infinite",
        }} />
      )}
    </div>
  );
}
