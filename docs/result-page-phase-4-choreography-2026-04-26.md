# Result Page · Phase 4 — Choreography Storyboard

**Date:** 2026-04-26
**Branch:** `feat/showcase-redesign-v1`
**Goal:** per-workflow signature micro-moments, ≤ 2s each, plays once, settles into a quiet final state.

Each entry below is a **frame-by-frame mental model** for one signature animation. Timing is intentional — read it like a film cue sheet.

---

## 1 · BOQ — "The estimate coming together"

**Trigger:** hero variant `boq`, on first viewport entry. Plays ONCE per page mount.

**Total duration:** 1.20 s (animation) + 0.80 s (dimension line, already exists from Phase 3) = 2.00 s.

| t (ms) | Event |
|---|---|
| 0 | KPI number = 0. Material chip strip empty. Hero card visible (already faded in by Phase 2's blur-to-focus). |
| 0–1200 | Number ticks 0 → final value (e.g. ₹1.37 L) via existing `AnimatedNumber` (cubic ease-out, 1.2s). |
| 0 | First chip `concrete` placeholder slot appears — empty pill in light grey. |
| 240 | `concrete` chip activates: fades in (200ms), scales 0.94→1, dot pulses once. |
| 480 | `steel` chip activates. Same recipe. |
| 720 | `bricks` chip activates. |
| 960 | `labor` chip activates. |
| 1200 | `finishings` chip activates + KPI number lands at final value. |
| 1400 | Dimension line under KPI begins drawing (Phase 3's `DimensionLine`, delay 0.55s). |
| 1900 | Dimension line complete. Hero is fully settled. |

**Easing:** `[0.25, 0.46, 0.45, 0.94]` for chip entrance (matches BOQ visualizer's reveal). Number uses ease-out cubic.

**Reduced motion:** chips appear instantly in their final state. Number = final value immediately. Dimension line = static stroke.

---

## 2 · IFC / 3D — "The model comes into focus"

**Trigger:** hero variant `3d-model` when an IFC artifact is also present, OR fallback to all `3d-model` variants. Plays ONCE.

**Total duration:** 1.50 s.

The wireframe is a custom 7-path SVG isometric building outline (sides, roof, base, two windows). It draws path-by-path using `pathLength` 0→1.

| t (ms) | Event |
|---|---|
| 0 | Wireframe paths exist but invisible (`pathLength: 0`). Hero text already visible. |
| 0 | Path 1 (base outline) starts drawing. 200ms duration. |
| 200 | Path 2 (left wall) starts. 200ms. |
| 400 | Path 3 (right wall) starts. |
| 600 | Path 4 (back wall) starts. |
| 800 | Path 5 (roof line) starts. |
| 1000 | Paths 6, 7 (window panes) start in parallel. 200ms each. |
| 1200 | All paths complete. Wireframe sits at final 8% opacity as ambient backdrop. |
| 1500 | Animation done. Wireframe never animates again on this page. |

**Easing:** `easeOut` per path. Stagger driven by `delay` in `motion.path` props.

**Reduced motion:** all paths render at `pathLength: 1` immediately, full final-state.

---

## 3 · Video — "The reel spins up"

**Trigger:** hero variant `video`, on first viewport entry. Plays ONCE.

**Total duration:** 0.70 s.

Two horizontal black bars cover the video frame entirely. They retract — top bar slides up, bottom bar slides down — revealing the video poster like a cinema shutter opening. After the shutter completes, the timecode caption stays.

| t (ms) | Event |
|---|---|
| 0 | Video element loaded. Two black bars cover top half + bottom half (each `height: 50%`). |
| 0 | Timecode caption invisible. |
| 0–600 | Top bar `translateY(-100%)`, bottom bar `translateY(100%)` simultaneously. Easing: `[0.83, 0, 0.17, 1]` (a smooth shutter feel). |
| 600 | Shutters fully retracted. Video frame visible. Autoplay begins (existing IntersectionObserver behavior from Phase 2). |
| 700 | Timecode caption fades in (200ms). |
| 900 | Animation done. |

**Reduced motion:** shutter doesn't animate — bars are absent on first paint, video poster shows directly. Timecode caption appears with a 100ms fade only.

---

## 4 · Image-only — "The render develops"

**Trigger:** hero variant `image`, on first viewport entry. Plays ONCE.

**Total duration:** 0.80 s.

The primary image starts slightly desaturated (saturate(0.6)) and low-contrast (contrast(0.85)). Settles into full saturation/contrast over 800ms — a "print being developed" feel.

| t (ms) | Event |
|---|---|
| 0 | `<img>` rendered with `filter: saturate(0.6) contrast(0.85) brightness(0.95)`. |
| 0–800 | Filter eased to `saturate(1) contrast(1) brightness(1)`. Easing: `easeOut`. |
| 800 | Image at final color/contrast. |

**Reduced motion:** image renders at full saturation/contrast immediately.

---

## 5 · Pending video render — "Still composing"

**Trigger:** hero kind `pending`, while progress is in-flight. Loops forever (only ambient case).

**Element:** a small **registration mark** SVG (architectural alignment crosshair — circle with crosshair). Rotates 360° every 4s. Sits beside the progress text.

**Reduced motion:** registration mark renders static (no rotation).

---

## 6 · Failure — "Broken line"

**Trigger:** hero kind `failure`, on first viewport entry. Plays ONCE.

**Total duration:** 0.60 s.

A short SVG dimension line draws itself, then a `?` glyph appears at its end. Quiet, restrained.

| t (ms) | Event |
|---|---|
| 0 | Line at `pathLength: 0`. |
| 0–500 | Line draws from left→middle (50% of natural length). Easing: `easeOut`. |
| 500 | Line stops mid-stroke. Small `?` fades in (100ms) at the end of the partial line. |
| 600 | Settled. |

**Reduced motion:** line at full length, `?` already visible, no animation.

---

## Overall principles

- **Never block content.** All animations are decorative overlays. The page is interactive at t=0.
- **Settle, don't loop.** Only the registration mark loops (ambient signal that work is happening). Everything else plays once.
- **End state = static.** A user with reduced-motion enabled sees the exact same final pixels as a user without — only the journey differs.
- **No animation > 2s total.**
- **Stagger via `delay` props on `motion.*`** rather than chained `useEffect` setTimeouts. Cleaner unmount story and respects React lifecycle.

— END CHOREOGRAPHY DOC —
