"use client";

import { Rocket, MessageSquare } from "lucide-react";
import s from "./page.module.css";

interface FeedbackSuccessCardProps {
  onSubmitMore: () => void;
  locale: string;
}

export function FeedbackSuccessCard({ onSubmitMore, locale }: FeedbackSuccessCardProps) {
  const isDE = locale === "de";

  return (
    <div className={s.section}>
      <div className={s.successCard}>
        <div className={s.successCardIcon}>
          <Rocket size={32} />
        </div>
        <h2 className={s.successCardTitle}>
          {isDE ? (
            <>Erfolgreich <em className={s.successCardTitleEm}>eingereicht</em></>
          ) : (
            <>Successfully <em className={s.successCardTitleEm}>submitted</em></>
          )}
        </h2>
        <p className={s.successCardDesc}>
          {isDE
            ? "Dein Feedback ist in unserer Pipeline. Unser Team pr\u00fcft jede einzelne Einreichung und du kannst den Status hier verfolgen."
            : "Your feedback has entered our pipeline. Our team reviews every submission and you can track its status here."}
        </p>
        <button className={s.successCardBtn} onClick={onSubmitMore} type="button">
          <MessageSquare size={14} />
          {isDE ? "Weiteres Feedback" : "Submit More Feedback"}
        </button>
      </div>
    </div>
  );
}
