"use client";

import type { ReactNode } from "react";
import { SectionIndex } from "@/features/result-page/components/aec/SectionIndex";

interface SectionHeaderProps {
  /** Architectural section number (01, 02, …) */
  index: number;
  icon: ReactNode;
  iconColor?: string;
  iconBg?: string;
  label: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

/**
 * Section header in architectural-drawing style:
 *   01 ·  [icon] LABEL
 *               Title
 *               subtitle
 *
 * The leading `01 ·` numeric marker is what construction drawings use to
 * paginate. It's why this page reads as "from a drawing-set" rather than
 * "from a SaaS template."
 */
export function SectionHeader({
  index,
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
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            paddingTop: 2,
          }}
        >
          <SectionIndex index={index} color="#94A3B8" />
        </div>
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
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 500,
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
              fontSize: 19,
              fontWeight: 600,
              color: "#0F172A",
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
            }}
          >
            {title}
          </h2>
          {subtitle ? (
            <span style={{ fontSize: 13, color: "#64748B", marginTop: 4, lineHeight: 1.55 }}>{subtitle}</span>
          ) : null}
        </div>
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
}
