"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { LivingCard } from "@/features/onboarding-survey/components/primitives/LivingCard";
import { useKeyboardNav } from "@/features/onboarding-survey/hooks/useKeyboardNav";
import {
  DISCOVERY_OPTIONS,
} from "@/features/onboarding-survey/lib/survey-constants";
import {
  cardContainer,
  cardItem,
  textPullFocus,
  SPRING,
} from "@/features/onboarding-survey/lib/scene-motion";
import type {
  DiscoveryOption,
  SurveyPatch,
} from "@/features/onboarding-survey/types/survey";

interface Scene1Props {
  initial: { source: string | null; other: string | null };
  onHoverChange: (rgb: string | null) => void;
  onPatch: (p: SurveyPatch) => void;
  onAdvance: () => void;
  onTrack: (source: string) => void;
}

const AUTO_ADVANCE_MS = 720;

export function Scene1_Discovery({
  initial,
  onHoverChange,
  onPatch,
  onAdvance,
  onTrack,
}: Scene1Props) {
  const { t } = useLocale();
  const [selected, setSelected] = useState<string | null>(initial.source);
  const [otherText, setOtherText] = useState<string>(initial.other ?? "");
  const [showOtherInput, setShowOtherInput] = useState<boolean>(initial.source === "other");
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherInputRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSelect = useCallback(
    (opt: DiscoveryOption) => {
      setSelected(opt.id);
      onHoverChange(opt.colorRgb);
      onTrack(opt.id);

      if (opt.isOther) {
        onPatch({ discoverySource: opt.id, discoveryOther: otherText || null });
        setShowOtherInput(true);
        // Don't auto-advance — user needs to type + confirm
        return;
      }

      onPatch({ discoverySource: opt.id, discoveryOther: null });
      setShowOtherInput(false);

      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => {
        onHoverChange(null);
        onAdvance();
      }, AUTO_ADVANCE_MS);
    },
    [onAdvance, onHoverChange, onPatch, onTrack, otherText]
  );

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  // Focus textarea when "Something else" is chosen
  useEffect(() => {
    if (showOtherInput) {
      const t = setTimeout(() => otherInputRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [showOtherInput]);

  const handleOtherSubmit = useCallback(() => {
    if (!otherText.trim()) return;
    onPatch({ discoverySource: "other", discoveryOther: otherText.trim() });
    onHoverChange(null);
    onAdvance();
  }, [onAdvance, onHoverChange, onPatch, otherText]);

  // Keyboard shortcuts (1-9) to select
  useKeyboardNav({
    onNumber: (n) => {
      if (n >= 1 && n <= DISCOVERY_OPTIONS.length) {
        const opt = DISCOVERY_OPTIONS[n - 1];
        handleSelect(opt);
      }
    },
    enabled: !showOtherInput, // when input is focused, numbers should type
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40, alignItems: "center" }}>
      {/* Header */}
      <motion.div
        variants={textPullFocus}
        initial="initial"
        animate="animate"
        style={{ textAlign: "center", maxWidth: 680 }}
      >
        <div
          style={{
            display: "inline-block",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-jetbrains), monospace",
            marginBottom: 12,
          }}
        >
          {t("survey.scene1.eyebrow")}
        </div>
        <h1
          style={{
            fontSize: "clamp(1.8rem, 4.5vw, 2.75rem)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            margin: 0,
            background: "linear-gradient(135deg, #FFFFFF 0%, #E0E7FF 50%, #A5B4FC 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {t("survey.scene1.headline")}
        </h1>
        <p style={{ marginTop: 10, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 }}>
          {t("survey.scene1.subheadline")}
        </p>
      </motion.div>

      {/* Card grid */}
      <motion.div
        variants={cardContainer}
        initial="hidden"
        animate="visible"
        role="listbox"
        aria-label={t("survey.scene1.listAria")}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          width: "100%",
          maxWidth: 920,
        }}
      >
        {DISCOVERY_OPTIONS.map((opt, i) => (
          <motion.div key={opt.id} variants={cardItem}>
            <LivingCard
              option={opt}
              label={t(`${opt.labelKey}` as Parameters<typeof t>[0])}
              subtitle={t(`${opt.subtitleKey}` as Parameters<typeof t>[0])}
              selected={selected === opt.id}
              dimmed={!!selected && selected !== opt.id}
              shortcutNumber={i + 1}
              onHover={onHoverChange}
              onSelect={() => handleSelect(opt)}
            />
          </motion.div>
        ))}
      </motion.div>

      {/* Expandable "Something else" text input */}
      <AnimatePresence>
        {showOtherInput && (
          <motion.div
            key="other-input"
            initial={{ opacity: 0, y: 12, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 12, height: 0 }}
            transition={SPRING.smooth}
            style={{
              width: "100%",
              maxWidth: 620,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: 18,
                borderRadius: 14,
                background: "rgba(18,18,30,0.72)",
                border: "1px solid rgba(156,163,175,0.2)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              }}
            >
              <label
                htmlFor="scene1-other"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {t("survey.scene1.otherLabel")}
              </label>
              <textarea
                id="scene1-other"
                ref={otherInputRef}
                value={otherText}
                onChange={(e) => {
                  setOtherText(e.target.value);
                  onPatch({ discoverySource: "other", discoveryOther: e.target.value || null });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleOtherSubmit();
                  }
                }}
                placeholder={t("survey.scene1.otherPlaceholder")}
                rows={2}
                style={{
                  width: "100%",
                  background: "rgba(7,8,9,0.6)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: "var(--text-primary)",
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-disabled)", marginRight: "auto" }}>
                  {t("survey.scene1.otherHint")}
                </span>
                <motion.button
                  type="button"
                  onClick={handleOtherSubmit}
                  disabled={!otherText.trim()}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    padding: "8px 18px",
                    borderRadius: 10,
                    background: otherText.trim()
                      ? "linear-gradient(135deg, #4F8AFF, #6366F1, #8B5CF6)"
                      : "rgba(156,163,175,0.2)",
                    border: "none",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: otherText.trim() ? "pointer" : "not-allowed",
                    boxShadow: otherText.trim() ? "0 4px 14px rgba(79,138,255,0.35)" : "none",
                  }}
                >
                  {t("survey.continue")} →
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyboard hint (desktop only) */}
      <div className="survey-keyboard-hint" style={{ fontSize: 11, color: "var(--text-disabled)", letterSpacing: "0.05em" }}>
        {t("survey.scene1.keyboardHint")}
      </div>
    </div>
  );
}
