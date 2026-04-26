"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        textAlign: "center",
        gap: 18,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          background: "#F3F4F6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6B7280",
        }}
      >
        {icon}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#111827", letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>{description}</p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {primaryHref && primaryLabel ? (
          <Link
            href={primaryHref}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              background: "#0D9488",
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {primaryLabel}
          </Link>
        ) : null}
        {secondaryHref && secondaryLabel ? (
          <Link
            href={secondaryHref}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              background: "#FFFFFF",
              border: "1px solid rgba(0,0,0,0.10)",
              color: "#4B5563",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {secondaryLabel}
          </Link>
        ) : null}
      </div>
    </motion.div>
  );
}
