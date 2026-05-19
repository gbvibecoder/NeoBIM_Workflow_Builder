"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import s from "./dashboard.module.css";

const SPLIT_MIN = 8;
const SPLIT_MAX = 92;
const AUTO_BASE = 30;
const AUTO_AMP = 25;
const AUTO_STEP = 0.012;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);
  return reduced;
}

export function NodesCanvas() {
  const { t } = useLocale();
  const prefersReducedMotion = usePrefersReducedMotion();

  const [split, setSplit] = useState<number>(50);
  const autoRef = useRef<boolean>(true);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef<boolean>(false);
  const canvasRowRef = useRef<HTMLDivElement | null>(null);

  const stopAuto = () => {
    if (!autoRef.current) return;
    autoRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => {
    if (prefersReducedMotion) {
      autoRef.current = false;
      return;
    }
    let t = 0;
    const step = () => {
      if (!autoRef.current) return;
      t += AUTO_STEP;
      setSplit(AUTO_BASE + AUTO_AMP * Math.sin(t));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [prefersReducedMotion]);

  const updateFromClientX = (clientX: number) => {
    const row = canvasRowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct));
    setSplit(clamped);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      updateFromClientX(e.clientX);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      e.preventDefault();
      updateFromClientX(touch.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, []);

  const onHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    stopAuto();
    draggingRef.current = true;
    updateFromClientX(e.clientX);
  };
  const onHandleTouchStart = (e: React.TouchEvent) => {
    stopAuto();
    draggingRef.current = true;
    const touch = e.touches[0];
    if (touch) updateFromClientX(touch.clientX);
  };
  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingRef.current) return;
    stopAuto();
    updateFromClientX(e.clientX);
  };

  const clipPath = `polygon(${split}% 0, 100% 0, 100% 100%, ${split}% 100%)`;

  return (
    <div className={s.heroV3Transform}>
      <div className={s.heroV3TransformStrip}>
        <div className={s.heroV3TransformStripL}>
          <span className={s.heroV3DotPlum} />
          <span>{t("dashboard.v2.transformInputTag")}</span>
        </div>
        <div className={s.heroV3TransformStripC}>
          <span>{t("dashboard.v2.transformAvg")}</span>
        </div>
        <div className={s.heroV3TransformStripR}>
          <span>{t("dashboard.v2.transformOutputTag")}</span>
          <span className={s.heroV3DotSagePulse} />
        </div>
      </div>

      <div
        ref={canvasRowRef}
        className={s.heroV3CanvasRow}
        onClick={onCanvasClick}
        role="presentation"
      >
        {/* Left pane — the PDF brief */}
        <div className={s.heroV3PaneBrief} aria-hidden="true">
          <div className={s.heroV3BriefInner}>
            <h3 className={s.heroV3BriefHead}>{t("dashboard.v2.briefTitle")}</h3>
            <p className={s.heroV3BriefMeta}>{t("dashboard.v2.briefMeta")}</p>
            <p className={s.heroV3BriefP}>{t("dashboard.v2.briefP1")}</p>
            <h4 className={s.heroV3BriefH}>{t("dashboard.v2.briefProgramH")}</h4>
            <ul className={s.heroV3BriefList}>
              <li>{t("dashboard.v2.briefProgram1")}</li>
              <li>{t("dashboard.v2.briefProgram2")}</li>
              <li>{t("dashboard.v2.briefProgram3")}</li>
            </ul>
            <h4 className={s.heroV3BriefH}>{t("dashboard.v2.briefConstraintsH")}</h4>
            <ul className={s.heroV3BriefList}>
              <li>{t("dashboard.v2.briefConstraint1")}</li>
              <li>{t("dashboard.v2.briefConstraint2")}</li>
              <li>{t("dashboard.v2.briefConstraint3")}</li>
            </ul>
          </div>
        </div>

        {/* Right pane — golden-hour render, clipped from split% rightward */}
        <div className={s.heroV3PaneRender} style={{ clipPath }} aria-hidden="true">
          <div className={s.heroV3Building}>
            <svg
              viewBox="0 0 380 320"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="xMidYMax meet"
            >
              {/* Ground shadow */}
              <ellipse cx="190" cy="305" rx="135" ry="10" fill="rgba(50,40,28,0.18)" />

              {/* Antenna / flag */}
              <line x1="220" y1="60" x2="220" y2="92" stroke="#5C5240" strokeWidth="2" />
              <polygon points="220,62 244,72 220,82" fill="#7A6F58" />

              {/* Back face (deepest) */}
              <polygon points="120,118 250,118 250,295 120,295" fill="#A89A7B" />
              {/* Right face (lit) */}
              <polygon points="250,118 304,140 304,295 250,295" fill="#B5A78A" />
              {/* Left face (shadow) */}
              <polygon points="76,140 120,118 120,295 76,295" fill="#8C8067" />

              {/* Stepped attic on top of back face */}
              <polygon points="150,92 230,92 250,118 130,118" fill="#7A6F58" />
              <polygon points="230,92 244,108 250,118" fill="#5C5240" />

              {/* Front-back wing (the taller front block on the right) */}
              <polygon points="200,150 290,150 290,295 200,295" fill="#B5A78A" />
              <polygon points="290,150 318,168 318,295 290,295" fill="#9C8E72" />
              <polygon points="200,150 218,138 290,138 290,150" fill="#C4B89A" />

              {/* Window grid — back face, 4 cols × 4 rows */}
              {[0, 1, 2, 3].map((row) =>
                [0, 1, 2, 3].map((col) => (
                  <rect
                    key={`bk-${row}-${col}`}
                    x={138 + col * 24}
                    y={150 + row * 32}
                    width="14"
                    height="20"
                    fill="#3F362A"
                  />
                )),
              )}

              {/* Window grid — right wing, 3 cols × 4 rows */}
              {[0, 1, 2, 3].map((row) =>
                [0, 1, 2].map((col) => (
                  <rect
                    key={`fw-${row}-${col}`}
                    x={214 + col * 24}
                    y={172 + row * 28}
                    width="14"
                    height="18"
                    fill="#3F362A"
                  />
                )),
              )}

              {/* Entrance — ground floor recessed door */}
              <rect x="244" y="262" width="22" height="33" fill="#2E2820" />
            </svg>
          </div>
          <div className={s.heroV3TimeMarker}>
            <span className={s.heroV3DotSagePulse} />
            <span>{t("dashboard.v2.transformAuto")}</span>
          </div>
        </div>

        {/* Slider handle */}
        <div
          className={s.heroV3Handle}
          style={{ left: `${split}%` }}
          onMouseDown={onHandleMouseDown}
          onTouchStart={onHandleTouchStart}
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(split)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reveal handle"
        >
          <span className={s.heroV3HandleLabelL}>{t("dashboard.v2.handleLabelL")}</span>
          <span className={s.heroV3HandleLabelR}>{t("dashboard.v2.handleLabelR")}</span>
          <span className={s.heroV3HandleGrip}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M5.5 3 L2 8 L5.5 13 M10.5 3 L14 8 L10.5 13"
                stroke="#FFFFFF"
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
