"use client";

import type { ReactNode } from "react";

interface SectionHeaderProps {
  icon: ReactNode;
  iconColor?: string;
  iconBg?: string;
  label: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

/**
 * Shared section header — small uppercase label + bold title + optional subtitle,
 * matching the BOQ visualizer's layered title pattern.
 */
export function SectionHeader({
  icon,
  iconColor = "#0D9488",
  iconBg = "#F0FDFA",
  label,
  title,
  subtitle,
  right,
}: SectionHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 20,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 10,
            background: iconBg,
            color: iconColor,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: iconColor,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "#111827",
              letterSpacing: "-0.005em",
            }}
          >
            {title}
          </h2>
          {subtitle ? (
            <span style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>{subtitle}</span>
          ) : null}
        </div>
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
}
