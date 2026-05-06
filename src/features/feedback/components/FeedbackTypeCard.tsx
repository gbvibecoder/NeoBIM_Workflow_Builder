"use client";

import { ArrowRight } from "lucide-react";
import type { FeedbackTypeMeta } from "../constants/feedback-types";
import s from "./page.module.css";

interface FeedbackTypeCardProps {
  meta: FeedbackTypeMeta;
  isActive: boolean;
  onClick: () => void;
  locale: string;
}

export function FeedbackTypeCard({ meta, isActive, onClick, locale }: FeedbackTypeCardProps) {
  const isDE = locale === "de";
  const Icon = meta.icon;

  return (
    <button
      className={s.typeCard}
      data-type={meta.key}
      data-active={isActive}
      onClick={onClick}
      type="button"
    >
      <div className={s.typeCardStripe} />
      <div className={s.typeCardHeader}>
        <span className={s.typeCardIdDot} />
        <span className={s.typeCardId}>{meta.nodeId}</span>
        <span className={s.typeCardStatus}>{isActive ? "ACTIVE" : "IDLE"}</span>
      </div>
      <div className={s.typeCardBody}>
        <div className={s.typeCardIcon}>
          <Icon size={20} strokeWidth={1.8} />
        </div>
        <div className={s.typeCardTagline}>{isDE ? meta.tagline.de : meta.tagline.en}</div>
        <div className={s.typeCardTitle}>{isDE ? meta.label.de : meta.label.en}</div>
        <div className={s.typeCardDesc}>{isDE ? meta.description.de : meta.description.en}</div>
        <div className={s.typeCardArrow}>
          <ArrowRight size={14} />
        </div>
      </div>
    </button>
  );
}
