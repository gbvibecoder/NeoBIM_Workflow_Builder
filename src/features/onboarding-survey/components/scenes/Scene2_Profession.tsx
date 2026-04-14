"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { HoneycombTile } from "@/features/onboarding-survey/components/primitives/HoneycombTile";
import { TypewriterText } from "@/features/onboarding-survey/components/primitives/TypewriterText";
import { useKeyboardNav } from "@/features/onboarding-survey/hooks/useKeyboardNav";
import { PROFESSION_OPTIONS } from "@/features/onboarding-survey/lib/survey-constants";
import {
  cardContainer,
  cardItem,
  SPRING,
  textPullFocus,
} from "@/features/onboarding-survey/lib/scene-motion";
import type {
  ProfessionOption,
  SurveyPatch,
} from "@/features/onboarding-survey/types/survey";

interface Scene2Props {
  initial: { profession: string | null; other: string | null };
  onPatch: (p: SurveyPatch) => void;
  onAdvance: () => void;
  onTrack: (profession: string) => void;
}

const AUTO_ADVANCE_MS = 780;

export function Scene2_Profession({ initial, onPatch, onAdvance, onTrack }: Scene2Props) {
  const { t } = useLocale();
  const [selected, setSelected] = useState<string | null>(initial.profession);
  const [otherText, setOtherText] = useState<string>(initial.other ?? "");
  const [showOtherInput, setShowOtherInput] = useState<boolean>(initial.profession === "other");
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherInputRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSelect = useCallback(
    (opt: ProfessionOption) => {
      setSelected(opt.id);
      onTrack(opt.id);

      if (opt.isOther) {
        onPatch({ profession: opt.id, professionOther: otherText || null });
        setShowOtherInput(true);
        return;
      }

      onPatch({ profession: opt.id, professionOther: null });
      setShowOtherInput(false);

      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => onAdvance(), AUTO_ADVANCE_MS);
    },
    [onAdvance, onPatch, onTrack, otherText]
  );

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (showOtherInput) {
      const id = setTimeout(() => otherInputRef.current?.focus(), 220);
      return () => clearTimeout(id);
    }
  }, [showOtherInput]);

  const handleOtherSubmit = useCallback(() => {
    if (!otherText.trim()) return;
    onPatch({ profession: "other", professionOther: otherText.trim() });
    onAdvance();
  }, [onAdvance, onPatch, otherText]);

  useKeyboardNav({
    onNumber: (n) => {
      if (n >= 1 && n <= PROFESSION_OPTIONS.length) {
        handleSelect(PROFESSION_OPTIONS[n - 1]);
      }
    },
    enabled: !showOtherInput,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 44, alignItems: "center" }}>
      {/* Header with typewriter headline */}
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
          {t("survey.scene2.eyebrow")}
        </div>
        <h1
          style={{
            fontSize: "clamp(1.8rem, 4.5vw, 2.75rem)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            margin: 0,
            background: "linear-gradient(135deg, #FFFFFF 0%, #E0E7FF 40%, #C084FC 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          <TypewriterText text={t("survey.scene2.headline")} startDelay={200} charMs={28} />
        </h1>
        <p style={{ marginTop: 10, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 }}>
          {t("survey.scene2.subheadline")}
        </p>
      </motion.div>

      {/* Honeycomb staggered grid — CSS offset on even rows gives the
         honeycomb feel without hexagonal clip-paths that fight accessibility. */}
      <div className="survey-honeycomb-grid" style={{ width: "100%", maxWidth: 1000 }}>
        <style>{`
          .survey-honeycomb-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
          }
          .survey-honeycomb-grid > .row-2 { transform: translateY(14px); }
          .survey-honeycomb-grid > .row-3 { transform: translateY(0); }
          @media (max-width: 720px) {
            .survey-honeycomb-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
            .survey-honeycomb-grid > .row-2 { transform: none; }
          }
          @media (max-width: 460px) {
            .survey-honeycomb-grid { grid-template-columns: 1fr; }
          }
        `}</style>
        <motion.div
          variants={cardContainer}
          initial="hidden"
          animate="visible"
          style={{ display: "contents" }}
          role="listbox"
          aria-label={t("survey.scene2.listAria")}
        >
          {PROFESSION_OPTIONS.map((opt, i) => {
            const row = Math.floor(i / 3) + 1;
            return (
              <motion.div key={opt.id} variants={cardItem} className={`row-${row}`}>
                <HoneycombTile
                  option={opt}
                  label={t(`${opt.labelKey}` as Parameters<typeof t>[0])}
                  subtitle={t(`${opt.subtitleKey}` as Parameters<typeof t>[0])}
                  selected={selected === opt.id}
                  dimmed={!!selected && selected !== opt.id}
                  shortcutNumber={i + 1}
                  onSelect={() => handleSelect(opt)}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* "Something cooler" textarea */}
      <AnimatePresence>
        {showOtherInput && (
          <motion.div
            key="other-input"
            initial={{ opacity: 0, y: 12, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 12, height: 0 }}
            transition={SPRING.smooth}
            style={{ width: "100%", maxWidth: 620, overflow: "hidden" }}
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
                htmlFor="scene2-other"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {t("survey.scene2.otherLabel")}
              </label>
              <textarea
                id="scene2-other"
                ref={otherInputRef}
                value={otherText}
                onChange={(e) => {
                  setOtherText(e.target.value);
                  onPatch({ profession: "other", professionOther: e.target.value || null });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleOtherSubmit();
                  }
                }}
                placeholder={t("survey.scene2.otherPlaceholder")}
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
                      ? "linear-gradient(135deg, #8B5CF6, #A855F7, #EC4899)"
                      : "rgba(156,163,175,0.2)",
                    border: "none",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: otherText.trim() ? "pointer" : "not-allowed",
                    boxShadow: otherText.trim() ? "0 4px 14px rgba(139,92,246,0.4)" : "none",
                  }}
                >
                  {t("survey.continue")} →
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
