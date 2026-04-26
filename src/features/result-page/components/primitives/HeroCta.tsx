"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkflowAccent } from "@/features/result-page/lib/workflow-accent";

interface HeroCtaProps {
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  accent: WorkflowAccent;
  href?: string;
  onClick?: () => void;
  external?: boolean;
  size?: "lg" | "xl";
}

/**
 * The giant "Open BOQ Visualizer →" / "Open in IFC Viewer" / "Explore 3D Model" button.
 * Replaces the 14px text pills the audit flagged as weak entry points.
 */
export function HeroCta({
  label,
  sublabel,
  icon,
  accent,
  href,
  onClick,
  external = false,
  size = "lg",
}: HeroCtaProps) {
  const isXl = size === "xl";
  const padding = isXl ? "20px 28px" : "16px 22px";
  const fontSize = isXl ? 18 : 16;

  const inner = (
    <motion.span
      whileHover={{ y: -2, scale: 1.005 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding,
        borderRadius: 14,
        background: accent.gradient,
        border: `1px solid ${accent.ring}`,
        color: accent.base,
        fontSize,
        fontWeight: 700,
        letterSpacing: "0.01em",
        textDecoration: "none",
        cursor: "pointer",
        boxShadow: accent.glow,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        minHeight: isXl ? 64 : 52,
        textAlign: "left",
      }}
    >
      {icon ? (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: isXl ? 44 : 36,
            height: isXl ? 44 : 36,
            borderRadius: 12,
            background: accent.tint,
            border: `1px solid ${accent.ring}`,
            color: accent.base,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      ) : null}
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#F5F5FA", fontWeight: 700, fontSize, letterSpacing: "-0.005em" }}>{label}</span>
          <ArrowRight size={isXl ? 20 : 17} aria-hidden="true" style={{ color: accent.base }} />
        </span>
        {sublabel ? (
          <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(245,245,250,0.62)", letterSpacing: 0 }}>
            {sublabel}
          </span>
        ) : null}
      </span>
    </motion.span>
  );

  if (href) {
    if (external) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={onClick} type="button" style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
      {inner}
    </button>
  );
}
