"use client";

import { Info, Sparkles, Layers, AlertTriangle, type LucideIcon } from "lucide-react";

export type ConfidenceTone = "ai-estimate" | "ai-concept" | "experimental" | "preliminary";

interface ConfidenceBadgeProps {
  tone: ConfidenceTone;
  label: string;
  tooltip?: string;
  fullWidth?: boolean;
}

const TONE_STYLES: Record<
  ConfidenceTone,
  { bg: string; border: string; color: string; icon: LucideIcon }
> = {
  "ai-estimate": {
    bg: "rgba(253,203,110,0.08)",
    border: "rgba(253,203,110,0.22)",
    color: "#FDCB6E",
    icon: Info,
  },
  "ai-concept": {
    bg: "rgba(0,245,255,0.06)",
    border: "rgba(0,245,255,0.2)",
    color: "#00F5FF",
    icon: Sparkles,
  },
  experimental: {
    bg: "rgba(184,115,51,0.08)",
    border: "rgba(184,115,51,0.22)",
    color: "#D4956A",
    icon: Layers,
  },
  preliminary: {
    bg: "rgba(253,203,110,0.1)",
    border: "rgba(253,203,110,0.28)",
    color: "#FDCB6E",
    icon: AlertTriangle,
  },
};

export function ConfidenceBadge({ tone, label, tooltip, fullWidth = false }: ConfidenceBadgeProps) {
  const s = TONE_STYLES[tone];
  const Icon = s.icon;

  return (
    <div
      role="note"
      title={tooltip}
      aria-label={tooltip ? `${label}. ${tooltip}` : label}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        alignItems: fullWidth ? "flex-start" : "center",
        gap: 8,
        padding: fullWidth ? "10px 14px" : "4px 10px",
        borderRadius: fullWidth ? 10 : 999,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        fontSize: fullWidth ? 12.5 : 11.5,
        fontWeight: 600,
        lineHeight: 1.4,
        width: fullWidth ? "100%" : "auto",
        flexShrink: 0,
      }}
    >
      <Icon size={fullWidth ? 14 : 12} style={{ flexShrink: 0, marginTop: fullWidth ? 1 : 0 }} aria-hidden="true" />
      <div style={{ display: "flex", flexDirection: "column", gap: fullWidth ? 2 : 0, minWidth: 0 }}>
        <span style={{ color: s.color, fontWeight: 600 }}>{label}</span>
        {fullWidth && tooltip && (
          <span
            style={{
              color: "var(--text-secondary)",
              fontSize: 11.5,
              fontWeight: 400,
              lineHeight: 1.45,
            }}
          >
            {tooltip}
          </span>
        )}
      </div>
    </div>
  );
}
