"use client";

import { ArrowRight } from "lucide-react";
import type { FeedbackTypeKey } from "../constants/feedback-types";
import { FEEDBACK_TYPES } from "../constants/feedback-types";
import { FeedbackTypeCard } from "./FeedbackTypeCard";
import s from "./page.module.css";

interface FeedbackTypeCardsProps {
  selectedType: FeedbackTypeKey | null;
  onSelectType: (key: FeedbackTypeKey) => void;
  locale: string;
}

export function FeedbackTypeCards({ selectedType, onSelectType, locale }: FeedbackTypeCardsProps) {
  const isDE = locale === "de";

  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <div className={s.sectionEyebrow}>
          <span className={s.sectionNum}>01</span>
          <ArrowRight size={10} />
          <span>{isDE ? "WAS M\u00d6CHTEN SIE TEILEN?" : "WHAT WOULD YOU LIKE TO SHARE?"}</span>
        </div>
        <h2 className={s.sectionTitle}>
          {isDE ? (
            <>W\u00e4hle deinen <em className={s.sectionTitleEm}>Feedback-Typ</em></>
          ) : (
            <>Choose your <em className={s.sectionTitleEm}>feedback type</em></>
          )}
        </h2>
      </div>

      <div className={s.typeGrid}>
        {FEEDBACK_TYPES.map((ft) => (
          <FeedbackTypeCard
            key={ft.key}
            meta={ft}
            isActive={selectedType === ft.key}
            onClick={() => onSelectType(ft.key)}
            locale={locale}
          />
        ))}
      </div>
    </div>
  );
}
