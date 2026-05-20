"use client";

/* ═══════════════════════════════════════════════════════════════════════
   TemplatesHeroDeck — circular, info-rich 3D coverflow of real templates.

   Self-contained presentational component. Receives data + callbacks via
   props. Does NOT fetch, route, or know about billing — the page wires
   onUse to its existing handleUse (which owns lock/billing/telemetry).
   ═══════════════════════════════════════════════════════════════════════ */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lock,
} from "lucide-react";
import s from "./TemplatesHeroDeck.module.css";

export interface DeckTemplate {
  id: string;
  category: string;
  title: string;
  /** Short mono-caps caption rendered below each card title (e.g.
   *  ["Floor Plan","Render + Video Walkthrough"] joined with " → "). */
  chain: string[];
  chips: string[];
  /** Single-line humorous subtitle rendered in the info band above the
   *  chips. Optional — when absent, the line is simply not rendered. */
  tagline?: string;
  /** A `--rs-*` CSS variable name (with leading `--`), e.g. "--rs-burnt". */
  accentVar: string;
  badge?: string;
  Illus?: React.ComponentType;
  locked?: boolean;
}

export interface TemplatesHeroDeckCopy {
  useTemplate: string;
  preview: string;
  hint: string;
  empty: string;
  eyebrowSuffix: string;
  badgeNew: string;
  badgePopular: string;
  prev: string;
  next: string;
  filterAll: string;
}

export interface TemplatesHeroDeckProps {
  templates: DeckTemplate[];
  onUse: (id: string) => void;
  onPreview?: (id: string) => void;
  eyebrow: string;
  headline: React.ReactNode;
  copy: TemplatesHeroDeckCopy;
  /** If true, render in-hero category pills derived from `templates`. */
  showFilters?: boolean;
}

const AUTO_DRIFT_MS = 3500;
const POST_INTERACTION_MS = 5000;
/* Phase Z.2.4 — wider coverflow ring. Was X_STEP=180, Z_STEP=240,
 * ROT_DEG=44, VISIBLE=2.5 which clipped to ~1 visible side card per
 * side. New values surface 2 cards each side (≈5 on screen), with a
 * gentler rotation so off=2 cards stay readable, shallower depth per
 * step so they don't blur into the background, and VISIBLE bumped so
 * the |off|=2 card stays mounted through transitions. */
const X_STEP = 230;
const Z_STEP = 160;
const ROT_DEG = 30;
const VISIBLE = 2.6;
const NARROW_BREAKPOINT = 1100;
const SWIPE_THRESHOLD = 50;
const WHEEL_DEBOUNCE_MS = 380;

function clampN(n: number, max: number): number {
  if (max <= 0) return 0;
  return ((n % max) + max) % max;
}

function FallbackViz({ accentVar }: { accentVar: string }) {
  const style = { ["--card-accent" as string]: `var(${accentVar})` } as React.CSSProperties;
  return (
    <div className={s.fallbackViz} style={style} aria-hidden="true">
      <svg viewBox="0 0 80 80" fill="none">
        <rect x="14" y="14" width="52" height="52" rx="10" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
        <circle cx="40" cy="40" r="9" fill="currentColor" opacity="0.18" />
        <circle cx="40" cy="40" r="3" fill="currentColor" opacity="0.5" />
      </svg>
    </div>
  );
}

export default function TemplatesHeroDeck(props: TemplatesHeroDeckProps) {
  const { templates, onUse, onPreview, eyebrow, headline, copy, showFilters } = props;

  // ── In-hero category filter (deck-local; does NOT affect the grid below) ──
  // Derived from actual template categories so empty-after-filter is impossible
  // for any pill we render.
  const deckCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) set.add(t.category);
    return [copy.filterAll, ...Array.from(set)];
  }, [templates, copy.filterAll]);

  const [activeCat, setActiveCat] = useState<string>(copy.filterAll);
  const filtered = useMemo(() => {
    if (activeCat === copy.filterAll) return templates;
    return templates.filter((t) => t.category === activeCat);
  }, [activeCat, templates, copy.filterAll]);

  const N = filtered.length;

  // ── Front index (raw, may grow unbounded; clamped on read) ─────────────
  const [front, setFront] = useState(0);
  useEffect(() => {
    // After a filter change, if front overflows N, snap to 0 (no NaN risk).
    if (N === 0 || front >= N) setFront(0);
    // Intentionally only react to N changes; we want to keep position on N-stable updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N]);
  const safeFront = N > 0 ? clampN(front, N) : 0;

  // ── Viewport breakpoint (matchMedia) ───────────────────────────────────
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
    setIsNarrow(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ── Reduced-motion ─────────────────────────────────────────────────────
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ── Tab visibility ─────────────────────────────────────────────────────
  const [tabHidden, setTabHidden] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setTabHidden(document.hidden);
    setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── Pause on hover/focus ───────────────────────────────────────────────
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const interactedRef = useRef(false);

  // ── Auto-drift ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion || isNarrow || N < 3 || hovered || focused || tabHidden) return;
    const interval = interactedRef.current ? POST_INTERACTION_MS : AUTO_DRIFT_MS;
    const id = window.setInterval(() => {
      setFront((f) => f + 1);
    }, interval);
    return () => window.clearInterval(id);
  }, [reducedMotion, isNarrow, N, hovered, focused, tabHidden]);

  // ── Imperative controls ────────────────────────────────────────────────
  const advance = useCallback((dir: number) => {
    if (N === 0) return;
    interactedRef.current = true;
    setFront((f) => f + dir);
  }, [N]);

  const jumpTo = useCallback((idx: number) => {
    if (N === 0) return;
    interactedRef.current = true;
    setFront(idx);
  }, [N]);

  // ── Stage in-viewport detection (for scoped keyboard nav) ──────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageInView, setStageInView] = useState(true);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setStageInView(entries[0]?.isIntersecting ?? false),
      { rootMargin: "0px", threshold: 0.2 },
    );
    io.observe(stage);
    return () => io.disconnect();
  }, [isNarrow, N]);

  // ── Narrow viewport: scroll-driven front sync ─────────────────────────
  // On narrow, the user pans the scroll-snap track. Without this observer
  // the info band stays glued to the previous `front` after a swipe and
  // the Use button would launch the wrong template. Observe each card and
  // promote whichever one is most-visible to `front`.
  const narrowTrackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isNarrow || N === 0 || typeof IntersectionObserver === "undefined") return;
    const track = narrowTrackRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>("[data-card-idx]"));
    if (cards.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        let best: { idx: number; ratio: number } | null = null;
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.cardIdx ?? "-1");
          if (idx < 0) continue;
          if (!best || e.intersectionRatio > best.ratio) best = { idx, ratio: e.intersectionRatio };
        }
        if (best && best.ratio > 0.6) {
          setFront((f) => (clampN(f, N) === best.idx ? f : best.idx));
        }
      },
      { root: track, threshold: [0.4, 0.6, 0.8, 1] },
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [isNarrow, N]);

  // ── Keyboard navigation (scoped: in-view + no input focused) ───────────
  useEffect(() => {
    if (N < 2 || !stageInView) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName ?? "").toUpperCase();
      const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;
      if (editable) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        advance(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        advance(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stageInView, N, advance]);

  // ── Wheel (HORIZONTAL ONLY — never traps vertical scroll) ──────────────
  const wheelLockRef = useRef(0);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || isNarrow || N < 2) return;
    const handler = (e: WheelEvent) => {
      const ax = Math.abs(e.deltaX);
      const ay = Math.abs(e.deltaY);
      // Predominantly vertical → let the page scroll. Do NOT preventDefault.
      if (ax <= ay) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelLockRef.current < WHEEL_DEBOUNCE_MS) return;
      wheelLockRef.current = now;
      advance(e.deltaX > 0 ? 1 : -1);
    };
    // passive:false required to be able to preventDefault on horizontal.
    stage.addEventListener("wheel", handler, { passive: false });
    return () => stage.removeEventListener("wheel", handler);
  }, [isNarrow, N, advance]);

  // ── Pointer drag / swipe with axis-lock ────────────────────────────────
  const dragRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // Axis-lock: deck flick only if horizontal clearly dominates.
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      advance(dx < 0 ? 1 : -1);
    }
  };
  const onPointerCancel = () => {
    dragRef.current = null;
  };

  // ── Mouse parallax ─────────────────────────────────────────────────────
  const [parallax, setParallax] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const onMouseMoveStage = (e: React.MouseEvent) => {
    if (reducedMotion || isNarrow) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const py = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    setParallax({ x: px, y: py });
  };
  const onMouseEnterStage = () => setHovered(true);
  const onMouseLeaveStage = () => {
    setHovered(false);
    setParallax({ x: 0, y: 0 });
  };

  // ── Color wash via setProperty (spec-mandated) ─────────────────────────
  const activeAccentVar = N > 0 ? filtered[safeFront].accentVar : "--rs-blueprint";
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty("--accent", `var(${activeAccentVar})`);
    // Try the matching `-soft` token; fall back to a generic tinted shadow.
    root.style.setProperty(
      "--accent-soft",
      `var(${activeAccentVar}-soft, rgba(26,77,92,0.08))`,
    );
    root.style.setProperty(
      "--accent-glow",
      `var(${activeAccentVar}-glow, var(--rs-blueprint-glow))`,
    );
  }, [activeAccentVar]);

  // ── Focus tracking for pause-on-card-focus ─────────────────────────────
  const onFocusCapture = () => setFocused(true);
  const onBlurCapture = (e: React.FocusEvent) => {
    // Only un-pause when focus actually leaves the root.
    const next = e.relatedTarget as Node | null;
    if (!next || !rootRef.current?.contains(next)) setFocused(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  const front0 = N > 0 ? filtered[safeFront] : null;

  return (
    <div
      ref={rootRef}
      className={s.root}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
      data-narrow={isNarrow ? "true" : undefined}
    >
      {/* Top bar — eyebrow only (stats row removed Phase Z.2.2) */}
      <div className={s.topBar}>
        <div className={s.eyebrow}>
          <span className={s.eyebrowDot} />
          <span className={s.eyebrowText}>{eyebrow}</span>
          <span className={s.eyebrowSep}>·</span>
          <span className={s.eyebrowCount}>
            {N} {copy.eyebrowSuffix}
          </span>
        </div>
      </div>

      {/* Headline */}
      <h1 className={s.headline}>{headline}</h1>

      {/* In-hero filter pills (deck-only filter) */}
      {showFilters && deckCategories.length > 2 && (
        <div className={s.pills} role="tablist" aria-label="Deck filter">
          {deckCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={cat === activeCat}
              className={cat === activeCat ? s.pillActive : s.pill}
              onClick={() => {
                interactedRef.current = true;
                setActiveCat(cat);
                setFront(0);
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Stage */}
      {N === 0 ? (
        <div className={s.empty}>{copy.empty}</div>
      ) : isNarrow ? (
        /* ── Narrow fallback: horizontal scroll-snap row (no 3D) ── */
        <div ref={stageRef} className={s.narrowStage}>
          <div ref={narrowTrackRef} className={s.narrowTrack}>
            {filtered.map((tpl, i) => {
              const accent = { ["--card-accent" as string]: `var(${tpl.accentVar})` } as React.CSSProperties;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  data-card-idx={i}
                  className={i === safeFront ? `${s.narrowCard} ${s.narrowCardActive}` : s.narrowCard}
                  style={accent}
                  onClick={() => jumpTo(i)}
                  aria-current={i === safeFront ? "true" : undefined}
                >
                  <div className={s.cardHead}>
                    <div className={s.cardCat}>
                      <span className={s.cardCatDot} />
                      {tpl.category}
                    </div>
                    {tpl.badge ? <span className={s.cardBadge}>{tpl.badge}</span> : null}
                    {tpl.locked ? (
                      <span className={s.cardLock} aria-label="Locked">
                        <Lock size={10} />
                      </span>
                    ) : null}
                  </div>
                  <div className={s.cardViz}>
                    {tpl.Illus ? <tpl.Illus /> : <FallbackViz accentVar={tpl.accentVar} />}
                  </div>
                  <div className={s.cardTitle}>{tpl.title}</div>
                  {tpl.chain.length > 0 && (
                    <div className={s.cardChain}>{tpl.chain.slice(0, 4).join(" → ")}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── Wide: 3D coverflow ── */
        <div
          ref={stageRef}
          className={s.stage}
          onMouseMove={onMouseMoveStage}
          onMouseEnter={onMouseEnterStage}
          onMouseLeave={onMouseLeaveStage}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <div className={s.watermark} aria-hidden="true">
            {String(safeFront + 1).padStart(2, "0")}
          </div>

          <div
            className={s.deck}
            style={
              {
                transform: `perspective(1600px) rotateX(${parallax.y * 1.2}deg) rotateY(${parallax.x * -2}deg)`,
              } as React.CSSProperties
            }
          >
            {filtered.map((tpl, i) => {
              // ── Circular shortest-path offset ──
              const half = N / 2;
              let off = i - safeFront;
              if (off > half) off -= N;
              if (off < -half) off += N;
              const abs = Math.abs(off);
              const isFront = abs < 0.01;

              // ── Visibility (N=2 special-case: max abs is 1) ──
              const visibilityLimit = N === 2 ? 1 : VISIBLE;
              const visible = abs <= visibilityLimit;
              if (!visible) return null;

              // ── Transform (N=1 single card; N=2 toggle; N≥3 coverflow) ──
              let cardX = 0,
                cardZ = 0,
                cardRot = 0,
                cardY = 0,
                cardOpacity = 1;
              if (N === 1) {
                // Single card centered, no rotation.
              } else if (N === 2) {
                cardX = off * (X_STEP * 1.35);
                cardZ = -abs * 80;
                cardRot = off * -18;
                cardY = abs * 2;
              } else {
                cardX = off * X_STEP;
                cardZ = -abs * Z_STEP;
                cardRot = off * -ROT_DEG;
                cardY = abs * 4;
                /* Phase Z.2.4 — gentler falloff (was 0.18). At new
                 * VISIBLE=2.6: off=1 → 0.85, off=2 → 0.70 (clearly
                 * visible, not bleached). */
                cardOpacity = Math.max(0, 1 - abs * 0.15);
              }

              const cardStyle: React.CSSProperties = {
                transform: `translate(-50%, -50%) translate3d(${cardX}px, ${cardY}px, ${cardZ}px) rotateY(${cardRot}deg)`,
                opacity: cardOpacity,
                zIndex: 100 - Math.round(abs * 10),
                pointerEvents: visible ? "auto" : "none",
                ["--card-accent" as string]: `var(${tpl.accentVar})`,
              };

              return (
                <button
                  key={tpl.id}
                  type="button"
                  className={isFront ? `${s.card} ${s.cardFront}` : s.card}
                  style={cardStyle}
                  onClick={() => (isFront ? onUse(tpl.id) : jumpTo(i))}
                  aria-label={`${tpl.category}: ${tpl.title}`}
                  aria-current={isFront ? "true" : undefined}
                  tabIndex={isFront ? 0 : -1}
                >
                  <div className={s.cardHead}>
                    <div className={s.cardCat}>
                      <span className={s.cardCatDot} />
                      {tpl.category}
                    </div>
                    {tpl.badge ? <span className={s.cardBadge}>{tpl.badge}</span> : null}
                    {tpl.locked ? (
                      <span className={s.cardLock} aria-label="Locked">
                        <Lock size={10} />
                      </span>
                    ) : null}
                  </div>
                  <div className={s.cardViz}>
                    {tpl.Illus ? <tpl.Illus /> : <FallbackViz accentVar={tpl.accentVar} />}
                  </div>
                  <div className={s.cardTitle}>{tpl.title}</div>
                  {tpl.chain.length > 0 && (
                    <div className={s.cardChain}>{tpl.chain.slice(0, 4).join(" → ")}</div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Decorative floating spec tags */}
          <span className={`${s.floatTag} ${s.floatTag1}`} aria-hidden="true">
            <span className={s.floatTagDot} />
            Indian BOQ rates
          </span>
          <span className={`${s.floatTag} ${s.floatTag2}`} aria-hidden="true">
            <span className={s.floatTagDot} />
            IFC4 · BIM-ready
          </span>
          <span className={`${s.floatTag} ${s.floatTag3}`} aria-hidden="true">
            <span className={s.floatTagDot} />
            Photoreal renders
          </span>
        </div>
      )}

      {/* Info band — synced to front. Optional one-liner tagline above
          the chips (Phase Z.2.3 — humor pass). */}
      {front0 && (
        <div className={s.info} key={`info-${activeCat}-${safeFront}`}>
          {front0.tagline && (
            <p className={s.tagline}>{front0.tagline}</p>
          )}
          {front0.chips.length > 0 && (
            <div className={s.infoChips}>
              {front0.chips.slice(0, 5).map((chip, i) => (
                <span key={`${safeFront}-${chip}-${i}`} className={s.infoChip}>
                  <span className={s.infoChipDot} />
                  {chip}
                </span>
              ))}
            </div>
          )}
          <div className={s.infoActions}>
            {onPreview && (
              <button
                type="button"
                className={s.previewBtn}
                onClick={() => onPreview(front0.id)}
              >
                <Eye size={14} aria-hidden="true" />
                {copy.preview}
              </button>
            )}
            <button
              type="button"
              className={s.useBtn}
              onClick={() => onUse(front0.id)}
              aria-label={front0.locked ? `Upgrade to use ${front0.title}` : `Use ${front0.title}`}
            >
              {front0.locked ? <Lock size={14} aria-hidden="true" /> : null}
              {copy.useTemplate}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Controls (wide only) */}
      {N > 1 && !isNarrow && (
        <div className={s.controls}>
          <button
            type="button"
            className={s.navBtn}
            onClick={() => advance(-1)}
            aria-label={copy.prev}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className={s.counter}>
            {String(safeFront + 1).padStart(2, "0")} <span className={s.counterSep}>/</span> {String(N).padStart(2, "0")}
          </span>
          <button
            type="button"
            className={s.navBtn}
            onClick={() => advance(1)}
            aria-label={copy.next}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <div className={s.dots} role="tablist" aria-label="Template indicators">
            {filtered.map((tpl, i) => (
              <button
                key={tpl.id}
                type="button"
                role="tab"
                aria-selected={i === safeFront}
                aria-label={`${i + 1} of ${N}: ${tpl.title}`}
                className={i === safeFront ? s.dotActive : s.dot}
                onClick={() => jumpTo(i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Hint (wide + multi-card only) */}
      {N > 1 && !isNarrow && <div className={s.hint}>{copy.hint}</div>}
    </div>
  );
}
