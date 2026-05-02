"use client";

import s from "./page.module.css";

export function FeedbackPipelineConnector() {
  return (
    <div className={s.pipelineConnector}>
      <svg width="2" height="44" viewBox="0 0 2 44">
        <line
          x1="1" y1="0" x2="1" y2="44"
          stroke="var(--rs-rule-strong)"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
      </svg>
    </div>
  );
}
