"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { SPRING } from "@/features/onboarding-survey/lib/scene-motion";

interface BackButtonProps {
  onBack: () => void;
  visible: boolean;
}

export function BackButton({ onBack, visible }: BackButtonProps) {
  const { t } = useLocale();

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key="back"
          type="button"
          onClick={onBack}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={SPRING.snappy}
          whileHover={{ x: -2 }}
          whileTap={{ scale: 0.97 }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 10,
            background: "rgba(18,18,30,0.6)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-secondary)",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <ArrowLeft size={13} />
          {t("survey.back")}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
