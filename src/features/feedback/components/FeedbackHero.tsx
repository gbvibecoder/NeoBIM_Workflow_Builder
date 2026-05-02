"use client";

import { FeedbackHeroIllustration } from "./FeedbackHeroIllustration";
import s from "./page.module.css";

interface FeedbackHeroProps {
  totalShipped: number;
  featuresFromFeedback: number;
  replyHours: number;
  locale: string;
}

export function FeedbackHero({ totalShipped, featuresFromFeedback, replyHours, locale }: FeedbackHeroProps) {
  const isDE = locale === "de";

  return (
    <div className={s.heroSection}>
      <div className={s.heroInner}>
        <div className={s.heroLeft}>
          <div className={s.heroBadge}>
            <span className={s.heroBadgeDot} />
            <span>{isDE ? "FEEDBACK-HUB" : "FEEDBACK HUB"}</span>
            <span className={s.heroBadgeV}>v2.0</span>
          </div>

          <h1 className={s.heroTitle}>
            {isDE ? (
              <>Gebaut mit <em className={s.heroTitleEm}>euch</em>,{" "}nicht f&uuml;r euch</>
            ) : (
              <>Built with <em className={s.heroTitleEm}>you</em>,{" "}not for you</>
            )}
          </h1>

          <p className={s.heroLead}>
            {isDE
              ? "Jedes Feedback formt BuildFlow. Bug-Fixes, Feature-Ideen, Branchenvisionen \u2014 euer Input baut die Zukunft."
              : "Every piece of feedback shapes BuildFlow. Bug fixes, feature ideas, industry visions \u2014 your input builds the future."}
          </p>

          <div className={s.heroStats}>
            <div className={s.heroStat}>
              <span className={s.heroStatNum}>
                <em className={s.heroStatNumEm}>{totalShipped}</em>
              </span>
              <span className={s.heroStatLabel}>{isDE ? "EINGEREICHT" : "SUBMITTED"}</span>
            </div>
            <span className={s.heroStatDot} />
            <div className={s.heroStat}>
              <span className={s.heroStatNum}>
                <em className={s.heroStatNumEm}>{featuresFromFeedback}</em>
              </span>
              <span className={s.heroStatLabel}>{isDE ? "UMGESETZT" : "SHIPPED"}</span>
            </div>
            <span className={s.heroStatDot} />
            <div className={s.heroStat}>
              <span className={s.heroStatNum}>
                <em className={s.heroStatNumEm}>{replyHours}h</em>
              </span>
              <span className={s.heroStatLabel}>{isDE ? "ANTWORTZEIT" : "AVG REPLY"}</span>
            </div>
          </div>
        </div>

        <div className={s.heroArt}>
          <FeedbackHeroIllustration />
        </div>
      </div>
    </div>
  );
}
