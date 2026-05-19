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
          <svg
            viewBox="0 0 600 500"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
            className={s.heroV3Building}
          >
            <defs>
              <linearGradient id="bfSky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F4D9A8" />
                <stop offset="55%" stopColor="#E2A878" />
                <stop offset="100%" stopColor="#C58858" />
              </linearGradient>
              <linearGradient id="bfBrickLit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#B26142" />
                <stop offset="100%" stopColor="#7C3B22" />
              </linearGradient>
              <linearGradient id="bfBrickShade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#572D1D" />
                <stop offset="100%" stopColor="#3A1D11" />
              </linearGradient>
              <linearGradient id="bfGlass" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1A2632" />
                <stop offset="50%" stopColor="#2C3D52" />
                <stop offset="100%" stopColor="#0E1820" />
              </linearGradient>
              <linearGradient id="bfZinc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A8AEB2" />
                <stop offset="100%" stopColor="#62686E" />
              </linearGradient>
              <linearGradient id="bfGround" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A88B6C" />
                <stop offset="100%" stopColor="#6D5640" />
              </linearGradient>
              <radialGradient id="bfSunGlow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="#FFFAE1" stopOpacity="0.95" />
                <stop offset="45%" stopColor="#FFE6B4" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#FFDCA0" stopOpacity="0" />
              </radialGradient>
              <pattern id="bfBrickRows" patternUnits="userSpaceOnUse" width="40" height="8">
                <line x1="0" y1="8" x2="40" y2="8" stroke="rgba(0,0,0,0.10)" strokeWidth="0.5" />
              </pattern>
              <pattern id="bfZincSeam" patternUnits="userSpaceOnUse" width="12" height="60">
                <line x1="0" y1="0" x2="0" y2="60" stroke="rgba(0,0,0,0.22)" strokeWidth="0.5" />
              </pattern>
              <symbol id="bfWin" viewBox="0 0 30 22" width="30" height="22">
                <rect x="0" y="0" width="30" height="22" fill="url(#bfGlass)" />
                <rect x="0" y="0" width="30" height="22" fill="none" stroke="#E8DCC4" strokeWidth="0.7" />
                <line x1="15" y1="0" x2="15" y2="22" stroke="#E8DCC4" strokeWidth="0.5" />
                <polygon points="2,2 22,2 17,18 2,18" fill="rgba(255,250,228,0.12)" />
              </symbol>
            </defs>

            {/* Sky + sun + atmosphere */}
            <rect x="0" y="0" width="600" height="440" fill="url(#bfSky)" />
            <ellipse cx="500" cy="130" rx="130" ry="100" fill="url(#bfSunGlow)" />
            <circle cx="500" cy="130" r="22" fill="#FFFAE4" fillOpacity="0.7" />

            {/* Distant haze city for atmospheric depth */}
            <g opacity="0.28">
              <rect x="10" y="396" width="48" height="44" fill="#7A5C42" />
              <polygon points="10,396 58,396 34,386" fill="#6D5238" />
              <rect x="66" y="410" width="30" height="30" fill="#7A5C42" />
              <rect x="540" y="400" width="44" height="40" fill="#7A5C42" />
              <rect x="118" y="416" width="22" height="24" fill="#85614A" />
              <rect x="500" y="418" width="34" height="22" fill="#856246" />
            </g>

            {/* Ground + sidewalk paving lines */}
            <rect x="0" y="440" width="600" height="60" fill="url(#bfGround)" />
            <g stroke="rgba(0,0,0,0.16)" strokeWidth="0.5">
              <line x1="0" y1="448" x2="600" y2="448" />
              <line x1="50" y1="448" x2="50" y2="500" />
              <line x1="120" y1="448" x2="120" y2="500" />
              <line x1="210" y1="448" x2="210" y2="500" />
              <line x1="300" y1="448" x2="300" y2="500" />
              <line x1="385" y1="448" x2="385" y2="500" />
              <line x1="475" y1="448" x2="475" y2="500" />
              <line x1="555" y1="448" x2="555" y2="500" />
            </g>

            {/* Building cast shadow (long, to the left because sun is upper-right) */}
            <ellipse cx="225" cy="450" rx="200" ry="8" fill="rgba(0,0,0,0.32)" />

            {/* Side face (left, in shadow) */}
            <polygon points="180,210 162,222 162,440 180,432" fill="url(#bfBrickShade)" />
            <g fill="#0A111A">
              <rect x="167" y="254" width="6" height="14" />
              <rect x="167" y="290" width="6" height="14" />
              <rect x="167" y="326" width="6" height="14" />
              <rect x="167" y="362" width="6" height="14" />
            </g>

            {/* Main brick body (L1-L3) */}
            <rect x="180" y="242" width="300" height="190" fill="url(#bfBrickLit)" />
            <rect x="180" y="242" width="300" height="190" fill="url(#bfBrickRows)" />

            {/* L4 stepped attic (set back 20px each side) */}
            <rect x="200" y="210" width="260" height="32" fill="url(#bfBrickLit)" />
            <rect x="200" y="210" width="260" height="32" fill="url(#bfBrickRows)" />
            <polygon points="180,242 200,228 460,228 480,242" fill="rgba(255,235,200,0.22)" />
            <line x1="180" y1="242" x2="480" y2="242" stroke="rgba(0,0,0,0.22)" strokeWidth="0.6" />

            {/* L4 terrace glass railing */}
            <line x1="200" y1="234" x2="460" y2="234" stroke="#1E2632" strokeWidth="1.2" />
            <g fill="rgba(60,80,105,0.4)" stroke="#1E2632" strokeWidth="0.4">
              <rect x="204" y="226" width="36" height="8" />
              <rect x="244" y="226" width="36" height="8" />
              <rect x="284" y="226" width="36" height="8" />
              <rect x="324" y="226" width="36" height="8" />
              <rect x="364" y="226" width="36" height="8" />
              <rect x="404" y="226" width="36" height="8" />
              <rect x="444" y="226" width="12" height="8" />
            </g>

            {/* L4 attic windows (7 narrow horizontals) */}
            <g>
              <rect x="216" y="214" width="22" height="14" fill="url(#bfGlass)" />
              <rect x="216" y="214" width="22" height="14" fill="none" stroke="#E8DCC4" strokeWidth="0.6" />
              <rect x="252" y="214" width="22" height="14" fill="url(#bfGlass)" />
              <rect x="252" y="214" width="22" height="14" fill="none" stroke="#E8DCC4" strokeWidth="0.6" />
              <rect x="288" y="214" width="22" height="14" fill="url(#bfGlass)" />
              <rect x="288" y="214" width="22" height="14" fill="none" stroke="#E8DCC4" strokeWidth="0.6" />
              <rect x="324" y="214" width="22" height="14" fill="url(#bfGlass)" />
              <rect x="324" y="214" width="22" height="14" fill="none" stroke="#E8DCC4" strokeWidth="0.6" />
              <rect x="360" y="214" width="22" height="14" fill="url(#bfGlass)" />
              <rect x="360" y="214" width="22" height="14" fill="none" stroke="#E8DCC4" strokeWidth="0.6" />
              <rect x="396" y="214" width="22" height="14" fill="url(#bfGlass)" />
              <rect x="396" y="214" width="22" height="14" fill="none" stroke="#E8DCC4" strokeWidth="0.6" />
              <rect x="432" y="214" width="22" height="14" fill="url(#bfGlass)" />
              <rect x="432" y="214" width="22" height="14" fill="none" stroke="#E8DCC4" strokeWidth="0.6" />
            </g>

            {/* Zinc pitched roof + standing seams + chimney */}
            <polygon points="200,210 330,180 460,210" fill="url(#bfZinc)" />
            <polygon points="200,210 330,180 460,210" fill="url(#bfZincSeam)" />
            <line x1="200" y1="210" x2="330" y2="180" stroke="rgba(255,255,255,0.30)" strokeWidth="0.7" />
            <line x1="330" y1="180" x2="460" y2="210" stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" />
            <line x1="200" y1="210" x2="460" y2="210" stroke="#3A4046" strokeWidth="0.6" />
            <rect x="380" y="186" width="8" height="14" fill="#5A4030" />
            <rect x="378" y="184" width="12" height="3" fill="#3F2C1F" />

            {/* Floor band separators */}
            <g stroke="rgba(0,0,0,0.20)" strokeWidth="0.5">
              <line x1="180" y1="282" x2="480" y2="282" />
              <line x1="180" y1="320" x2="480" y2="320" />
              <line x1="180" y1="358" x2="480" y2="358" />
            </g>

            {/* L3, L2, L1 — 6 windows each + sills */}
            <use href="#bfWin" x="196" y="252" />
            <use href="#bfWin" x="240" y="252" />
            <use href="#bfWin" x="284" y="252" />
            <use href="#bfWin" x="328" y="252" />
            <use href="#bfWin" x="372" y="252" />
            <use href="#bfWin" x="416" y="252" />
            <g fill="#3A2820">
              <rect x="193" y="274" width="36" height="2" />
              <rect x="237" y="274" width="36" height="2" />
              <rect x="281" y="274" width="36" height="2" />
              <rect x="325" y="274" width="36" height="2" />
              <rect x="369" y="274" width="36" height="2" />
              <rect x="413" y="274" width="36" height="2" />
            </g>

            <use href="#bfWin" x="196" y="290" />
            <use href="#bfWin" x="240" y="290" />
            <use href="#bfWin" x="284" y="290" />
            <use href="#bfWin" x="328" y="290" />
            <use href="#bfWin" x="372" y="290" />
            <use href="#bfWin" x="416" y="290" />
            <g fill="#3A2820">
              <rect x="193" y="312" width="36" height="2" />
              <rect x="237" y="312" width="36" height="2" />
              <rect x="281" y="312" width="36" height="2" />
              <rect x="325" y="312" width="36" height="2" />
              <rect x="369" y="312" width="36" height="2" />
              <rect x="413" y="312" width="36" height="2" />
            </g>

            <use href="#bfWin" x="196" y="328" />
            <use href="#bfWin" x="240" y="328" />
            <use href="#bfWin" x="284" y="328" />
            <use href="#bfWin" x="328" y="328" />
            <use href="#bfWin" x="372" y="328" />
            <use href="#bfWin" x="416" y="328" />
            <g fill="#3A2820">
              <rect x="193" y="350" width="36" height="2" />
              <rect x="237" y="350" width="36" height="2" />
              <rect x="281" y="350" width="36" height="2" />
              <rect x="325" y="350" width="36" height="2" />
              <rect x="369" y="350" width="36" height="2" />
              <rect x="413" y="350" width="36" height="2" />
            </g>

            {/* Ground floor: tall café/retail glazing + plinth + entrance doors */}
            <rect x="180" y="412" width="300" height="28" fill="#3A2820" />
            <rect x="184" y="368" width="292" height="44" fill="url(#bfGlass)" />
            <g stroke="#0A0F16" strokeWidth="0.8">
              <line x1="234" y1="368" x2="234" y2="412" />
              <line x1="258" y1="368" x2="258" y2="412" />
              <line x1="308" y1="368" x2="308" y2="412" />
              <line x1="332" y1="368" x2="332" y2="412" />
              <line x1="382" y1="368" x2="382" y2="412" />
              <line x1="406" y1="368" x2="406" y2="412" />
            </g>
            <g>
              <rect x="234" y="364" width="24" height="48" fill="url(#bfGlass)" />
              <rect x="234" y="364" width="24" height="48" fill="none" stroke="#E8DCC4" strokeWidth="0.7" />
              <circle cx="252" cy="390" r="0.9" fill="#FFE6B4" />
              <rect x="308" y="364" width="24" height="48" fill="url(#bfGlass)" />
              <rect x="308" y="364" width="24" height="48" fill="none" stroke="#E8DCC4" strokeWidth="0.7" />
              <rect x="382" y="364" width="24" height="48" fill="url(#bfGlass)" />
              <rect x="382" y="364" width="24" height="48" fill="none" stroke="#E8DCC4" strokeWidth="0.7" />
            </g>
            <g fill="rgba(255,250,228,0.18)">
              <polygon points="190,374 226,374 220,408 190,408" />
              <polygon points="264,374 300,374 294,408 264,408" />
              <polygon points="338,374 374,374 368,408 338,408" />
              <polygon points="414,374 470,374 464,408 414,408" />
            </g>
            <rect x="180" y="360" width="80" height="6" fill="#7A3D22" />
            <polygon points="180,366 180,372 260,366" fill="#5A2A14" />
            <text x="190" y="358" fontFamily="Fraunces, serif" fontSize="9" fill="#3A2820" fontStyle="italic">café · oslo</text>
            <rect x="180" y="358" width="300" height="2" fill="rgba(0,0,0,0.15)" />

            {/* Trees for scale */}
            <g transform="translate(110, 420)">
              <rect x="-2" y="0" width="4" height="20" fill="#3F2D1E" />
              <circle cx="0" cy="-6" r="14" fill="#4D6A3F" />
              <circle cx="-10" cy="2" r="9" fill="#3F5C38" />
              <circle cx="9" cy="0" r="10" fill="#56794A" />
              <circle cx="-4" cy="-12" r="8" fill="#5A7848" />
              <circle cx="5" cy="-10" r="7" fill="#4A6840" />
            </g>
            <g transform="translate(520, 425)">
              <rect x="-1.5" y="0" width="3" height="15" fill="#3F2D1E" />
              <circle cx="0" cy="-4" r="10" fill="#4D6A3F" />
              <circle cx="-6" cy="2" r="7" fill="#3F5C38" />
              <circle cx="6" cy="-1" r="7" fill="#56794A" />
            </g>

            {/* Person silhouette for scale near café entrance */}
            <g transform="translate(280, 438)" fill="#2A1F18">
              <circle cx="0" cy="-22" r="3" />
              <path d="M-3,-19 L-3,-9 L-2.5,-1 L-1,-1 L-1,-9 L1,-9 L1,-1 L2.5,-1 L3,-9 L3,-19 Z" />
            </g>

            {/* Subtle warm atmospheric haze overlay */}
            <rect x="0" y="0" width="600" height="500" fill="rgba(255,225,180,0.03)" />
          </svg>
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
