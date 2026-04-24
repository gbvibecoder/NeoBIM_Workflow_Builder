"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

interface SkipLinkProps {
  onSkip: () => void;
  disabled?: boolean;
}

export function SkipLink({ onSkip, disabled }: SkipLinkProps) {
  const { t } = useLocale();

  return (
    <motion.button
      type="button"
      onClick={onSkip}
      disabled={disabled}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.4, duration: 0.4 }}
      whileHover={{ x: 2 }}
      className="survey-skip-link"
      style={{
        position: "fixed",
        bottom: 24,
        left: 24,
        zIndex: 40,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "10px 14px",
        borderRadius: 10,
        // Subtle fill + visible border so the button reads as an action,
        // not as chrome that blends into the backdrop. Matches the
        // emphasis level of the dashed "Try free" button above it.
        background: "rgba(255,255,255,0.045)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: "var(--text-secondary)",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "0.02em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        transition: "color 160ms ease, border-color 160ms ease, background-color 160ms ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.32)";
          e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-secondary)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
        e.currentTarget.style.background = "rgba(255,255,255,0.045)";
      }}
    >
      <span>{t("survey.skipToDashboard")}</span>
      <ArrowRight size={13} />
      <span aria-hidden="true" className="survey-skip-hint" style={{ marginLeft: 4, fontSize: 10, color: "var(--text-tertiary)" }}>
        Esc
      </span>
    </motion.button>
  );
}
