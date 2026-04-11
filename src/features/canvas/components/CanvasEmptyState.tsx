"use client";

import React from "react";
import { motion } from "framer-motion";
import { Layers3, Sparkles, BookOpen } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";

// ─── Mini workflow diagram (used inside CanvasEmptyState) ──────────────────

const DEMO_NODES = [
  { label: "PDF Upload",  color: "#00F5FF" },
  { label: "Doc Parser",  color: "#B87333" },
  { label: "Massing Gen", color: "#FFBF00" },
  { label: "IFC Export",  color: "#4FC3F7" },
];

export const MiniWorkflowDiagram = React.memo(function MiniWorkflowDiagram() {
  return (
    <div className="flex items-center gap-0 mb-2">
      {DEMO_NODES.map((node, i) => (
        <React.Fragment key={node.label}>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: `${node.color}18`,
              border: `1px solid ${node.color}40`,
              fontSize: 10,
              color: node.color,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {node.label}
          </div>
          {i < DEMO_NODES.length - 1 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 0,
              margin: "0 3px",
            }}>
              <div style={{ width: 14, height: 1, background: "rgba(184,115,51,0.3)" }} />
              <div style={{
                width: 0, height: 0,
                borderLeft: "4px solid rgba(184,115,51,0.3)",
                borderTop: "3px solid transparent",
                borderBottom: "3px solid transparent",
              }} />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
});

// ─── Canvas Empty State ────────────────────────────────────────────────────

interface EmptyStateProps {
  onPromptMode: () => void;
}

export const CanvasEmptyState = React.memo(function CanvasEmptyState({ onPromptMode }: EmptyStateProps) {
  const { t } = useLocale();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.25 } }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ zIndex: 5 }}
    >
      <div
        className="pointer-events-auto flex flex-col items-center text-center"
        style={{ maxWidth: 440 }}
      >
        {/* Mini diagram preview */}
        <div style={{
          padding: "16px 20px",
          borderRadius: 4,
          background: "rgba(10, 12, 14, 0.7)",
          border: "1px solid rgba(184,115,51,0.15)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          marginBottom: 24,
        }}>
          <MiniWorkflowDiagram />
          <div style={{ fontSize: 9, color: "rgba(184,115,51,0.4)", textAlign: "center", marginTop: 4, fontFamily: "'Space Mono', monospace", textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
            {t('canvas.examplePipeline')}
          </div>
        </div>

        {/* Icon */}
        <div style={{
          width: 52, height: 52, borderRadius: 4,
          background: "rgba(184,115,51,0.08)",
          border: "1px solid rgba(184,115,51,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 16,
        }}>
          <Layers3 size={22} style={{ color: "#B87333" }} strokeWidth={1.5} />
        </div>

        {/* Headline */}
        <h2 style={{
          fontSize: 22, fontWeight: 400,
          fontFamily: "'Playfair Display', serif",
          fontStyle: "italic",
          color: "#FFBF00", marginBottom: 8, lineHeight: 1.3,
          letterSpacing: "0.05em",
        }}>
          {t('canvas.emptyTitle')}
        </h2>

        {/* Subtitle */}
        <p style={{
          fontSize: 12, color: "rgba(255,255,255,0.4)",
          fontFamily: "'Space Mono', monospace",
          lineHeight: 1.6, marginBottom: 24, maxWidth: 320,
        }}>
          {t('canvas.emptyDesc')}
        </p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: 10 }}>
          <Link
            href="/dashboard/templates"
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "9px 18px", borderRadius: 4,
              border: "1px solid rgba(184,115,51,0.4)",
              background: "rgba(184,115,51,0.05)",
              fontSize: 10, fontWeight: 400, color: "#B87333",
              fontFamily: "'Space Mono', monospace",
              textTransform: "uppercase" as const,
              letterSpacing: "0.15em",
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(184,115,51,0.12)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(184,115,51,0.6)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(184,115,51,0.05)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(184,115,51,0.4)";
            }}
          >
            <BookOpen size={14} />
            {t('canvas.browseTemplates')}
          </Link>
          <button
            onClick={onPromptMode}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "9px 18px", borderRadius: 4,
              background: "transparent",
              border: "1px solid rgba(0,245,255,0.4)",
              fontSize: 10, fontWeight: 400, color: "#00F5FF",
              fontFamily: "'Space Mono', monospace",
              textTransform: "uppercase" as const,
              letterSpacing: "0.15em",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(0,245,255,0.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Sparkles size={14} />
            {t('canvas.tryAiPrompt')}
          </button>
        </div>
      </div>
    </motion.div>
  );
});
