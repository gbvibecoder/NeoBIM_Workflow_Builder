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
        padding: "8px 12px",
        borderRadius: 10,
        background: "transparent",
        border: "1px solid rgba(255,255,255,0.06)",
        color: "var(--text-tertiary)",
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "0.02em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "color 160ms ease, border-color 160ms ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.color = "var(--text-secondary)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-tertiary)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
      }}
    >
      <span>{t("survey.skipToDashboard")}</span>
      <ArrowRight size={12} />
      <span aria-hidden="true" className="survey-skip-hint" style={{ marginLeft: 4, fontSize: 10, color: "var(--text-disabled)" }}>
        Esc
      </span>
    </motion.button>
  );
}
