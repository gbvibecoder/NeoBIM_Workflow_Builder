"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { ScalePill } from "@/features/onboarding-survey/components/primitives/ScalePill";
import { TeamIllustration } from "@/features/onboarding-survey/components/primitives/TeamIllustration";
import { useKeyboardNav } from "@/features/onboarding-survey/hooks/useKeyboardNav";
import { TEAM_SIZE_OPTIONS } from "@/features/onboarding-survey/lib/survey-constants";
import {
  cardContainer,
  cardItem,
  textPullFocus,
} from "@/features/onboarding-survey/lib/scene-motion";
import type {
  SurveyPatch,
  TeamSizeOption,
} from "@/features/onboarding-survey/types/survey";

interface Scene3Props {
  initial: { teamSize: string | null };
  onPatch: (p: SurveyPatch) => void;
  onAdvance: () => void;
  onTrack: (team_size: string) => void;
}

const AUTO_ADVANCE_MS = 820;

export function Scene3_TeamSize({ initial, onPatch, onAdvance, onTrack }: Scene3Props) {
  const { t } = useLocale();
  const [selected, setSelected] = useState<string | null>(initial.teamSize);
  // Drive the illustration from hover (for exploration) OR selection.
  const [previewVariant, setPreviewVariant] = useState<TeamSizeOption["illustrationKey"]>(
    initial.teamSize
      ? TEAM_SIZE_OPTIONS.find((o) => o.id === initial.teamSize)?.illustrationKey ?? "solo"
      : "solo"
  );
  const [previewRgb, setPreviewRgb] = useState<string>(
    initial.teamSize
      ? TEAM_SIZE_OPTIONS.find((o) => o.id === initial.teamSize)?.colorRgb ?? "79, 138, 255"
      : "79, 138, 255"
  );
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preview = useCallback((opt: TeamSizeOption) => {
    setPreviewVariant(opt.illustrationKey);
    setPreviewRgb(opt.colorRgb);
  }, []);

  const handleSelect = useCallback(
    (opt: TeamSizeOption) => {
      setSelected(opt.id);
      preview(opt);
      onTrack(opt.id);
      onPatch({ teamSize: opt.id });
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => onAdvance(), AUTO_ADVANCE_MS);
    },
    [onAdvance, onPatch, onTrack, preview]
  );

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  useKeyboardNav({
    onNumber: (n) => {
      if (n >= 1 && n <= TEAM_SIZE_OPTIONS.length) {
        handleSelect(TEAM_SIZE_OPTIONS[n - 1]);
      }
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 44, alignItems: "center" }}>
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
          {t("survey.scene3.eyebrow")}
        </div>
        <h1
          style={{
            fontSize: "clamp(1.8rem, 4.5vw, 2.75rem)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            margin: 0,
            background: "linear-gradient(135deg, #FFFFFF 0%, #D1FAE5 50%, #6EE7B7 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {t("survey.scene3.headline")}
        </h1>
        <p style={{ marginTop: 10, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 }}>
          {t("survey.scene3.subheadline")}
        </p>
      </motion.div>

      {/* Split: illustration (top on mobile, left on desktop) + pills (right) */}
      <div className="survey-scene3-split" style={{ width: "100%", maxWidth: 960 }}>
        <style>{`
          .survey-scene3-split {
            display: grid;
            grid-template-columns: 1.15fr 1fr;
            gap: 40px;
            align-items: center;
          }
          @media (max-width: 860px) {
            .survey-scene3-split { grid-template-columns: 1fr; gap: 24px; }
            .survey-scene3-illo { order: -1; justify-self: center; }
          }
        `}</style>

        <div className="survey-scene3-illo" style={{ display: "flex", justifyContent: "center" }}>
          <TeamIllustration variant={previewVariant} colorRgb={previewRgb} />
        </div>

        <motion.div
          variants={cardContainer}
          initial="hidden"
          animate="visible"
          role="listbox"
          aria-label={t("survey.scene3.listAria")}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {TEAM_SIZE_OPTIONS.map((opt, i) => (
            <motion.div key={opt.id} variants={cardItem}>
              <ScalePill
                option={opt}
                label={t(`${opt.labelKey}` as Parameters<typeof t>[0])}
                selected={selected === opt.id}
                dimmed={!!selected && selected !== opt.id}
                shortcutNumber={i + 1}
                onHover={() => preview(opt)}
                onSelect={() => handleSelect(opt)}
              />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
