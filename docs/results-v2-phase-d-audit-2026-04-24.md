# Results V2 — Phase D Audit

**Date:** 2026-04-24
**Branch:** `feat/results-v2-cinematic`
**Depends on:** Phase A audit + Phase C build (already shipped, uncommitted).
**Status:** read-only; no source modified in this sub-phase.

---

## D.A.1 — Canvas → Results Surface Path (traced, single entry point)

| Step | File:line | What happens |
|---|---|---|
| Execution engine flips `isExecuting: true` while nodes run | `src/features/execution/hooks/useExecution.ts` | Canvas reads `isExecuting` from `useExecution({ onLog })` return (`WorkflowCanvas.tsx:423`). |
| Completion detection | `src/features/canvas/components/WorkflowCanvas.tsx:426–444` | The `useEffect` at 426 latches the `wasExecuting → !isExecuting && artifacts.size > 0` transition. Fires a 500ms `setTimeout(() => setShowShowcase(true))` at **line 441** — this is the *auto-open* path. |
| Overlay render | `WorkflowCanvas.tsx:987–992` | `<AnimatePresence>` wraps `{showShowcase && !isExecuting && artifacts.size > 0 && <ResultShowcase onClose={() => setShowShowcase(false)} />}` at **line 990**. |
| Manual re-open | `WorkflowCanvas.tsx:1000–1055` | The "View Results" FAB button — `onClick={() => setShowShowcase(true)}` at **line 1005**. |

**Other entry points to `ResultShowcase`:** grep of `src/` shows exactly **one consumer**:

```
src/features/canvas/components/ResultShowcase.tsx   ← re-export only
src/features/canvas/components/WorkflowCanvas.tsx:34   ← import
src/features/canvas/components/WorkflowCanvas.tsx:990  ← render site
```

No dashboard pages, no history page, no share-link route, no `/dashboard/results/*` route renders it. Rewire surface is exactly two lines (441, 1005) plus gating the render at 990.

**Mid-run vs post-run UX.** `setShowShowcase(true)` fires **after** `isExecuting` flips false. Mid-run, the canvas shows animated edges + running nodes directly, not a showcase. The legacy showcase does host "live-progress" for one specific case: post-pipeline completion while a `GN-009` video is still polling (the "Initializing — 5%" state in image-3). Under V2 this is handled by `HeroSkeleton` / `HeroVideo` when `video.status === "rendering"`, so the rewire preserves the semantic.

**Execution ID availability.** By the time `setShowShowcase(true)` fires, the DB execution exists:

- Line 245: `useExecutionStore.getState().setCurrentDbExecutionId(latest.id);` sets the persisted ID during reload-hydration.
- `useExecutionStore.currentExecution.id` is set by `startExecution()` before any artifact lands.

V2 redirect path uses `currentExecution?.id ?? currentDbExecutionId`. If neither is present, the flag-gate falls through to the legacy overlay as a safety net.

---

## D.A.2 — What the Canvas Needs After Rewire

1. **No store cleanup on redirect.** The canvas keeps the execution in its Zustand store after the user leaves to `/dashboard/results/[id]`. Back-button returns them to a still-populated canvas (good UX — they can click "Run again" without re-loading the workflow).
2. **Live-progress overlay stays unchanged.** Only the *post-completion* open (both auto + manual) redirects under V2. The canvas's own mid-run visual (animated edges) is untouched.
3. **"View result" shortcut.** After a successful run, if the user dismisses the showcase and comes back later in the same session, V2 should still give them a one-click way to their result. The existing "View Results" FAB at line 1005 fills that role — we just flag-gate its `onClick` to redirect instead of opening the overlay.
4. **Backwards-compat: `/dashboard/results/[id]` with flag OFF.** Per Phase C, this route renders `LegacyResultPage` which currently points users at `/dashboard`. That's weird UX for a deep link. Upgrade: server-side fetch the execution to get its `workflowId`, then `redirect(/dashboard/canvas?id=<workflowId>)`. The canvas loads the workflow, user sees their data (including artifacts if they arrive from the same session), and can click the "View Results" FAB to open the legacy overlay. No canvas changes required for this fallback — it piggybacks on existing canvas workflow-load semantics.

---

## D.A.3 — Missing Visual Depth Inventory (per Phase C component)

**Scoring basis:** ordinary vs extraordinary. Anything merely functional goes on this list.

### HeroVideo
- **Ambient glow** missing. Hero is a rectangle on a flat background; a dominant-color glow pulled from the video poster frame (8–10 % opacity radial, breathing 4 s) would integrate the hero into the page.
- **Chromatic-aberration flash** absent. A 120 ms RGB-split on first frame read = one frame of "cinema". Never run again.
- **Shot chips** — active state is too subtle (only opacity + border). Needs inner highlight + accent fill, not just border.
- **Container has no inner glow.** 1–2 px inset accent glow at 18 % makes the video feel premium.
- **Fullscreen button** — currently inside the `VideoControls` pill; hoisting a second corner-lock Maximize button (24 × 24, top-right of container) is a Vercel-dashboard-grade move.

### HeroImage
- **Parallax intensity fine, but no depth cue.** A subtle `backdrop-filter: contrast(1.05)` on the vignette band adds one layer of depth.
- **Navigation arrows** — currently static. Arrow press should `translateX` the incoming image from the correct side (currently it cross-fades — unclear direction).

### HeroViewer3D
- **Procedural fallback** — a single rotating ring. Serviceable but not memorable. Add a second ring at 60 % scale, counter-rotating; slow, restrained.
- **iframe mode** has no loading state while the src is warming up. Add HeroSkeleton-style shimmer until `iframe.onload` fires.

### HeroFloorPlan
- **SVG rendered flat.** Needs warm sunset tones (amber / rose radial) regardless of workflow accent — floor plans read as architectural blueprints, deserve that feel.
- **No stagger on room labels.** Already planned in B.2 doctrine, unimplemented in C.

### HeroKPI
- **Counter ease** is linear `ease-out-cubic`. Spring with micro-overshoot (stiffness 80, damping 14) lands with grace.
- **Gradient mesh** is the same `GradientMesh` used everywhere else — doesn't *breathe*. Needs 4-radial with prime-period drift.
- **Star metric** has no accent glow on the digit itself. `text-shadow` with 40 px accent at 40 % is the obvious move.

### HeroSkeleton
- **Copy is fixed.** Rotating through 4 lines every 6 s (or locking on "Almost there" past 85 %) is a nearly-free upgrade.
- **Shimmer is gray-ish.** Accent-color shimmer reads as intentional, not placeholder.
- **Single progress bar.** Dual: indeterminate 1.8 s sweep + determinate overlay when `progress` is known.
- **Background is a single 4-radial with lazy `intensity`.** Swap for the D.C.4 breathing mesh.

### ArtifactRibbon
- **Active chip** has background + border + glow but no *lift*. A 4 px Y-translate + 32 px accent-20 shadow is the difference between "selected" and "alive".
- **Hover thumbnail** missing. A 120 × 80 poster / SVG preview above the chip on hover is the "ok damn" moment.
- **No sticky-shadow.** When ribbon is scrolled past the hero, it floats alone. A drop-shadow fading in once `scrollY > 64` grounds it.
- **Mobile overflow** is `overflowX: auto` with hidden scrollbars. Add `scroll-snap-type: x mandatory` + `scroll-snap-align: start` on each chip for momentum-scroll feel.

### OverviewPanel / GeneratedAssetsPanel / BehindTheScenesPanel / DownloadCenterPanel / AINotesPanel
- **Entrance**: all panels share the same `opacity + y:16` fade-up. Upgrading to `blur(8px) → 0` + `scale(0.98) → 1` adds 2 frames of cinema at zero cost.
- **Staggered children** are only enforced in `GeneratedAssetsPanel` and `BehindTheScenesPanel`. Overview's metric cards and Downloads' file rows fade in together — boring. Stagger them.
- **No sticky mini-header** as the user scrolls past the hero title — Phase D doctrine's "hero title scales 1→0.85 and locks at y=64" would give the feeling of a layered deck.

### Primitives
- **`AnimatedCounter`** — ease-out-cubic is clean, a **spring** with `{ stiffness: 80, damping: 14 }` is *memorable*. A ~3 % overshoot before landing is the whole difference.
- **`ShotChip`** — no hover animation beyond color transition. Clip-path sweep of the accent fill L→R on hover (240 ms) adds delight without adding noise.
- **`GradientMesh`** — single transform loop. Multi-period independent drift is the D.C.4 upgrade.
- **`VideoControls`** — scrubber is functional but no hover-preview. The scrubber ticks are flat; a thin "about to land here" pip on pointer-hover is the premium move.

### Three micro-delights ceiling
Phase D caps micro-delights at 3. Candidates: status-pill completion scale-pulse (+1-frame edge flash), download-button arrow→check morph on click, share-click "Link copied · Expires never" tooltip. All three ship — nothing else.

---

## Handoff to D.B

With the path traced (only 3 lines to flag-gate in canvas) and the missing depth inventoried (one concrete list per component), D.B wires the redirect and D.C lights up the visuals.

- **D.B files that will be modified outside `results-v2/`**: exactly two —
  1. `src/features/canvas/components/WorkflowCanvas.tsx` (flag-gate the 2 call sites, import `useRouter` already present)
  2. `src/app/dashboard/results/[executionId]/LegacyResultPage.tsx` (convert to async server component; fetch execution; redirect to canvas).

- **D.B.4 "View result" chip**: reuses the existing FAB at lines 1000-1055. Under flag-ON it navigates; under flag-OFF it continues to open the overlay (byte-identical to today).
