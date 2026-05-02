"use client";

import s from "./page.module.css";

interface FounderNoteProps {
  avgReplyHours: number;
  locale: string;
}

export function FounderNote({ avgReplyHours, locale }: FounderNoteProps) {
  const isDE = locale === "de";

  return (
    <div className={s.section} style={{ paddingBottom: 80 }}>
      <div className={s.founder}>
        <div className={s.founderAvatar}>R</div>
        <div className={s.founderBody}>
          <p className={s.founderQuote}>
            {isDE
              ? "\u201EWir lesen jede einzelne Einreichung. Euer Feedback treibt unsere w\u00f6chentlichen Sprints an \u2014 buchst\u00e4blich. Unsere KI-Roadmap-Engine scannt eure Meldungen und priorisiert, was als N\u00e4chstes gebaut wird.\u201C"
              : "\u201CWe read every single submission. Your feedback drives our weekly sprints\u2009\u2014\u2009literally. Our AI roadmap engine scans your submissions and prioritises what gets built next.\u201D"}
          </p>
          <p className={s.founderSig}>
            <span className={s.founderSigName}>Rutik</span> &middot; {isDE ? "Gr\u00fcnder, BuildFlow" : "Founder, BuildFlow"}
          </p>
          <div className={s.founderStats}>
            <div className={s.founderStat}>
              <span className={s.founderStatValue}>{avgReplyHours}h</span>
              <span className={s.founderStatLabel}>{isDE ? "ANTWORTZEIT" : "AVG REPLY"}</span>
            </div>
            <div className={s.founderStat}>
              <span className={s.founderStatValue}>100%</span>
              <span className={s.founderStatLabel}>{isDE ? "GELESEN" : "READ RATE"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
