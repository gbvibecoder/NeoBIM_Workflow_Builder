"use client";

/**
 * Canvas Empty State — Studio Sketchbook
 * Phase Z.CANVAS.EMPTY-SKETCHBOOK
 *
 * Locked contracts (see report 2026-05-19 for the full list):
 *  C1  named export `CanvasEmptyState`, React.memo
 *  C2  prop signature `{ onPromptMode: () => void }`
 *  C3  re-exports `MiniWorkflowDiagram` (stub) for backwards-compat
 *  C4  outer overlay pointer-events: none — drops fall through to
 *      WorkflowCanvas.tsx:984 surface drop handler
 *  C5  framer-motion entry/exit preserved
 *  C9  prefers-reduced-motion honored via useReducedMotion()
 */

import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";
import s from "@/features/canvas/components/CanvasEmptyState.module.css";

// ─── Inline arrow used by each card's action ──────────────────────────────
function CardArrow() {
  return (
    <svg viewBox="0 0 22 14" aria-hidden focusable="false">
      <path d="M 1 7 L 19 7" />
      <path d="M 14 2 L 19 7 L 14 12" />
    </svg>
  );
}

// ─── Decorative SVG primitives (no a11y; pointer-events disabled) ──────────
function CoffeeRing() {
  return (
    <svg
      className={`${s.decoration} ${s.coffee}`}
      viewBox="0 0 100 100"
      aria-hidden
      focusable="false"
    >
      <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.08" />
      <circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.032" />
    </svg>
  );
}

function PencilDoodle() {
  return (
    <svg
      className={`${s.decoration} ${s.pencil}`}
      viewBox="0 0 180 36"
      aria-hidden
      focusable="false"
    >
      {/* eraser */}
      <rect x="2" y="10" width="22" height="16" rx="2" fill="#E89090" opacity="0.85" />
      {/* ferrule */}
      <rect x="24" y="10" width="8" height="16" fill="#C8B89A" opacity="0.85" />
      {/* shaft */}
      <rect x="32" y="10" width="112" height="16" fill="#E8A668" opacity="0.95" />
      <rect x="32" y="10" width="112" height="3" fill="#B87333" opacity="0.45" />
      {/* wood tip */}
      <polygon points="144,10 168,18 144,26" fill="#F4EDDF" stroke="#7A5F45" strokeWidth="0.5" opacity="0.95" />
      {/* lead */}
      <polygon points="160,15 170,18 160,21" fill="#1B1410" />
    </svg>
  );
}

function DoodleArrow() {
  return (
    <svg
      className={`${s.decoration} ${s.doodleArrow}`}
      viewBox="0 0 80 60"
      aria-hidden
      focusable="false"
    >
      {/* curved line that arcs from the margin region toward card 1 */}
      <path d="M 4 8 C 18 36, 38 52, 70 50" />
      {/* arrowhead */}
      <path d="M 62 44 L 72 50 L 64 56" />
    </svg>
  );
}

// ─── Sketched border (two-path SVG frame, one per card variant) ───────────
function SketchFrame({ variant }: { variant: 1 | 2 | 3 }) {
  // Slight per-card path irregularity to feel hand-drawn
  const outer =
    variant === 1 ? "M 2 3 L 99 1 L 98 99 L 1 97 Z"
    : variant === 2 ? "M 1 4 L 98 2 L 99 98 L 2 96 Z"
    : "M 3 2 L 99 3 L 97 98 L 2 96 Z";
  const inner =
    variant === 1 ? "M 5 6 L 96 4 L 95 96 L 4 94 Z"
    : variant === 2 ? "M 4 7 L 95 5 L 96 95 L 5 93 Z"
    : "M 6 5 L 96 6 L 94 95 L 5 93 Z";
  return (
    <svg
      className={s.frame}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <path className={s.outer} d={outer} />
      <path className={s.inner} d={inner} />
    </svg>
  );
}

// ─── MiniWorkflowDiagram — kept as a no-op stub for backwards-compat (C3)
// No external callers (the canvas/community/landing pages import a different
// MiniWorkflowDiagram from src/features/workflows/components/).
export const MiniWorkflowDiagram = React.memo(function MiniWorkflowDiagram() {
  return null;
});

// ─── CanvasEmptyState (Studio Sketchbook) ─────────────────────────────────

interface EmptyStateProps {
  onPromptMode: () => void;
}

export const CanvasEmptyState = React.memo(function CanvasEmptyState({ onPromptMode }: EmptyStateProps) {
  const { t } = useLocale();
  const prefersReducedMotion = useReducedMotion();

  // Drag card → synthesize Cmd+K to open the existing QuickSearch palette.
  // Same pattern as SlimLibraryStrip.tsx:101-106. No new deps, no store
  // imports across feature boundaries.
  const openNodeSearch = React.useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    );
  }, []);

  // Header meta string: bold the lead word before the first "·" so the
  // screenshot's "BUILDFLOW · STUDIO NOTEBOOK" rhythm is preserved.
  const metaTitle = t("canvas.empty.metaTitle");
  const sepIdx = metaTitle.indexOf("·");
  const metaHead = sepIdx >= 0 ? metaTitle.slice(0, sepIdx).trim() : metaTitle;
  const metaTail = sepIdx >= 0 ? metaTitle.slice(sepIdx + 1).trim() : "";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: prefersReducedMotion ? 0 : 0.25 } }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }}
      className={s.root}
      style={{ zIndex: 5 }}
    >
      {/* Decorative chrome — pointer-events: none via CSS */}
      <CoffeeRing />
      <DoodleArrow />
      <PencilDoodle />

      {/* Inner content cluster — only opt-in children intercept events (C4) */}
      <div className={s.content}>
        {/* Header row: meta block + UNTITLED stamp */}
        <div className={`${s.headerRow} ${s.pointerThrough}`}>
          <div className={s.metaBlock}>
            <div>
              <span className={s.strong}>{metaHead}</span>
              {metaTail ? ` · ${metaTail}` : null}
            </div>
            <div>{t("canvas.empty.metaSheet")}</div>
          </div>
          <div className={s.stamp}>
            {t("canvas.empty.stampTitle")}
            <span className={s.stampSub}>{t("canvas.empty.stampSub")}</span>
          </div>
        </div>

        {/* Title block */}
        <div className={`${s.titleBlock} ${s.pointerThrough}`}>
          <div className={s.pretitle}>{t("canvas.empty.pretitle")}</div>
          <h1 className={s.title}>
            {t("canvas.empty.titleBefore")}{" "}
            <span className={s.titleAccent}>{t("canvas.empty.titleAccent")}</span>.
          </h1>
          <p className={s.note}>
            <span className={s.noteArrow} aria-hidden>↳</span>
            <span>{t("canvas.empty.note")}</span>
          </p>
        </div>

        {/* Choices row — three sketchbook cards */}
        <div className={s.choices}>
          {/* Card 1 — DRAG (synthesize Cmd+K to open node search) */}
          <button
            type="button"
            onClick={openNodeSearch}
            className={`${s.card} ${s.cardA}`}
            aria-label={`${t("canvas.empty.c1Title")} — ${t("canvas.empty.c1Action")}`}
          >
            <SketchFrame variant={1} />
            <span className={s.kbd} aria-hidden>⇧ + L</span>
            <div className={s.cardBody}>
              <div className={s.choiceNum}>{t("canvas.empty.c1Num")}</div>
              <div className={s.choiceTitle}>{t("canvas.empty.c1Title")}</div>
              <p className={s.choiceDesc}>{t("canvas.empty.c1Desc")}</p>
              <span className={s.choiceAction}>
                {t("canvas.empty.c1Action")} <CardArrow />
              </span>
            </div>
          </button>

          {/* Card 2 — AI (invokes onPromptMode — locked contract C7) */}
          <button
            type="button"
            onClick={onPromptMode}
            className={`${s.card} ${s.cardB}`}
            aria-label={`${t("canvas.empty.c2Title")} — ${t("canvas.empty.c2Action")}`}
          >
            <SketchFrame variant={2} />
            <span className={s.kbd} aria-hidden>⌘ K</span>
            <div className={s.cardBody}>
              <div className={s.choiceNum}>{t("canvas.empty.c2Num")}</div>
              <div className={s.choiceTitle}>{t("canvas.empty.c2Title")}</div>
              <p className={s.choiceDesc}>{t("canvas.empty.c2Desc")}</p>
              <span className={s.choiceAction}>
                {t("canvas.empty.c2Action")} <CardArrow />
              </span>
            </div>
          </button>

          {/* Card 3 — TEMPLATES (next/link — locked contract C7) */}
          <Link
            href="/dashboard/templates"
            className={`${s.card} ${s.cardC}`}
            aria-label={`${t("canvas.empty.c3Title")} — ${t("canvas.empty.c3Action")}`}
          >
            <SketchFrame variant={3} />
            <span className={s.kbd} aria-hidden>⇧ + T</span>
            <div className={s.cardBody}>
              <div className={s.choiceNum}>{t("canvas.empty.c3Num")}</div>
              <div className={s.choiceTitle}>{t("canvas.empty.c3Title")}</div>
              <p className={s.choiceDesc}>{t("canvas.empty.c3Desc")}</p>
              <span className={s.choiceAction}>
                {t("canvas.empty.c3Action")} <CardArrow />
              </span>
            </div>
          </Link>
        </div>
      </div>

      {/* Bottom metadata ribbon — decorative, no interactions. Right side
          renders the localized hint string verbatim so the ⌘K position
          stays correct in every language (EN: "Press ⌘K to search nodes";
          DE: "⌘K für Knoten-Suche"). */}
      <div className={s.ribbon} aria-hidden>
        <div>{t("canvas.empty.ribbonLeft")}</div>
        <div>{t("canvas.empty.ribbonRight")}</div>
      </div>
    </motion.div>
  );
});
