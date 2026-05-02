"use client";

import s from "./billing.module.css";

/**
 * Floating dimension callouts scattered across the page backdrop.
 * Pure CSS float-up animation, no JS. Decorative only.
 */
export function BackdropFloaters() {
  return (
    <div className={s.backdrop} aria-hidden="true">
      <div className={`${s.floater} ${s.f1}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="0.6" />
          <line x1="1" y1="4" x2="1" y2="10" stroke="currentColor" strokeWidth="0.6" />
          <line x1="13" y1="4" x2="13" y2="10" stroke="currentColor" strokeWidth="0.6" />
        </svg>
        <span>40.0m</span>
      </div>
      <div className={`${s.floater} ${s.f2}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="0.6" />
          <line x1="4" y1="1" x2="10" y2="1" stroke="currentColor" strokeWidth="0.6" />
          <line x1="4" y1="13" x2="10" y2="13" stroke="currentColor" strokeWidth="0.6" />
        </svg>
        <span>22.5m</span>
      </div>
      <div className={`${s.floater} ${s.f3}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="0.6" />
          <line x1="1" y1="4" x2="1" y2="10" stroke="currentColor" strokeWidth="0.6" />
          <line x1="13" y1="4" x2="13" y2="10" stroke="currentColor" strokeWidth="0.6" />
        </svg>
        <span>18.3m</span>
      </div>
      <div className={`${s.floater} ${s.f4}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="0.6" />
          <line x1="7" y1="4" x2="7" y2="10" stroke="currentColor" strokeWidth="0.4" />
          <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="0.4" />
        </svg>
        <span>R 6.0m</span>
      </div>
    </div>
  );
}
