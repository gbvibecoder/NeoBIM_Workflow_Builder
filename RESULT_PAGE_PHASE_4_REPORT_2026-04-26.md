# Result Page · Phase 4 Report

**Date:** 2026-04-26
**Branch:** `feat/showcase-redesign-v1`
**Phase 3 ended at:** `ae45329` · "good now"
**Phase 4 commit:** on top of `ae45329`

The brief: per-workflow signature micro-moments + section enrichments that make BOQ feel like BOQ and IFC feel like IFC. Plays once, settles. No new deps. Reduced-motion safe.

---

## 1 · WHAT'S DIFFERENT FROM PHASE 3

| Workflow | Phase 3 hero | Phase 4 hero | Phase 4 ambient detail |
|---|---|---|---|
| **BOQ** | ₹1.37 L number + dimension line + Cost / m² / Region | Same — plus a 5-chip cascade (Concrete → Steel → Bricks → Labor → Finishings) that lights up as the number ticks up | StatStrip mono row + 4-segment Cost Composition bar |
| **IFC / 3D** | Stats grid + IFC viewer CTA | Same — plus an isometric wireframe building that draws itself stroke-by-stroke (1.5s) and settles at 10% opacity in the corner | StatStrip with Rich/Lean engine tag |
| **Video** | Full-bleed player + mono timecode caption | Same — plus a cinema shutter that retracts on first reveal (600ms) | StatStrip · DURATION / SHOTS / PIPELINE / FORMAT |
| **Floor Plan (CAD)** | FloorPlanViewer embed + stats | Same (FloorPlanViewer's own animations are the signature) | StatStrip · ROOMS / AREA / WALLS / OPENINGS |
| **Image-only** | Image with thumbnails | Same — primary image renders desaturated and develops to neutral over 850ms | (no extra strip — covered by hero) |
| **Clash** | Total count + severity chips | Same (Phase 3 already had the count animation) | StatStrip · TOTAL / CRITICAL / MAJOR / MINOR |
| **Failure** | Calm red card | Same | (no signature — restraint) |
| **Pending** | Progress bar + phase chips | Same — plus a rotating registration mark beside the progress text (only ambient loop on the page) | (existing dual-progress UI) |

Plus everywhere:
- **WorkflowTypeBadge** in the page header — small mono pill: `BOQ ESTIMATE`, `RENDER + VIDEO`, `IFC EXPORT`, `FLOOR PLAN · CAD`, `WALKTHROUGH`, `CLASH REPORT`, `3D MODEL`, `CONCEPT RENDERS`. Disambiguates runs at a glance.
- **PipelineAggregateStrip** — mono `Aggregate · Steps 6 · Succeeded 6 · [Errored N]` row above the pipeline beads.
- **StatStrip** — workflow-aware top-of-Data-section row (4 mono tiles).
- **CostCompositionBar** — BOQ-only. 4 colored segments showing % of total by Civil / MEP / Finishings / Labor+Equipment.

---

## 2 · CHOREOGRAPHY DECISIONS (timing reasoning)

Full storyboard at `docs/result-page-phase-4-choreography-2026-04-26.md`. Key picks:

- **240ms between BOQ chips** — slow enough that each chip registers as a discrete "step in the calculation," fast enough that all five complete before the eye gets impatient. Five × 240ms = 1.2s, which lines up with the 1.2s ease-out cubic on the existing BOQ `AnimatedNumber`.

- **180ms stagger between IFC paths** — wireframe has 7 paths; 7 × 180ms ≈ 1.26s plus the 320ms per-path duration overlapping into the next stagger ≈ 1.5s total. Long enough to feel like a building is being drawn, short enough that you don't watch it more than once.

- **Shutter ease `[0.83, 0, 0.17, 1]`** — sharp aperture-y ease. Slower starts/ends would feel curtain-y; this is camera-y.

- **Photo Develop 850ms** — slightly longer than the others because the curve is filter-driven (saturate/contrast/brightness). Faster and the eye misses the subtlety.

- **DimensionLine delay bumped from 0.55s (Phase 3) to 1.4s (Phase 4)** — to let the chip cascade lead. Now the order reads: chips light up → number lands → dimension line draws → "we just calculated this" feel completes.

---

## 3 · REDUCED-MOTION BEHAVIOR (per animation)

| Animation | Without reduced-motion | With reduced-motion |
|---|---|---|
| MaterialChipsCascade | Chips fade in + scale 0.94→1, dot pulses once. 240ms stagger. | All chips appear in final state immediately. No transitions. |
| IsometricBuilding | Each path draws via pathLength 0→1, staggered 180ms, 320ms each. | All paths render fully drawn at ambient 10% opacity immediately. |
| ShutterReveal | Two black bars retract over 600ms. | Component returns null — no overlay rendered. Video poster shows directly. |
| PhotoDevelop | Filter eases from desaturated to neutral over 850ms. | Filter starts at neutral, no transition. |
| RegistrationMark | Rotates 360° every 4s, infinite. | Renders static — no rotation. |
| DimensionLine (Phase 3) | Path draws in left-to-right via pathLength. | pathLength = 1 immediately. |
| StatStrip / CostCompositionBar | whileInView fades + segments grow widths. | whileInView still fires for opacity; widths render at final % immediately. |
| WorkflowTypeBadge | (no animation) | (no change — no animation to skip) |

Verification: `useReducedMotion()` is consulted in every animation primitive's render path. End state pixels are identical between the two paths.

---

## 4 · BUNDLE DELTA

**Zero new dependencies.** All animations are pure SVG + framer-motion (already in the bundle). Lib helpers are pure functions, no runtime deps. New code adds ~750 LOC across 11 new files; rendered cost is negligible since the components are tiny and pure-presentational.

---

## 5 · WHAT'S NOT IN PHASE 4 (intentional restraint)

Considered and **rejected**:

- **Annotation drop-in animation for the floor plan hero.** The embedded `FloorPlanViewer` (preservation list) already has its own settle-in behavior; adding a wrapper animation would conflict with the existing room-label rendering inside it.
- **Hover-preview thumbnails on dedicated visualizer CTAs.** Would require either a screenshot pipeline or a generated SVG mini-chart per CTA, both of which add complexity for a "nice to have." Phase 5 candidate.
- **Time-estimate captions** under each CTA (`~ 30 SECONDS TO REVIEW`). Felt patronizing in test copy. Cut.
- **Frame-counter on the video player.** The mono timecode caption already gives the architect-y signal without overlaying counters on the playing video.
- **Live-market dot pulse on BOQ.** Would loop. The brief said "no looping animations beyond the registration mark and the live-market dot pulse" — but the BOQ visualizer already shows the live-market source on the deep view. Doubling here felt redundant.
- **Send to Revit / Send to Excel** secondary actions. Real Revit deep-link doesn't exist; faking it with a copy-path-and-toast affordance would mislead. Skipped.
- **Element-count tick-up on IFC**. The wireframe drawing already gives the visual cue; adding a number tick would be motion-doubling.

---

## 6 · PHASE 5 BACKLOG (honest critique of what Phase 4 still leaves on the table)

1. **Floor plan workflow signature is the weakest.** It inherits the Phase 3 NorthArrow-rotates-on-page-load, but doesn't get its own intro choreography because `FloorPlanViewer` is a preservation-list component. To add personality, we'd need to either (a) wrap a thin overlay over the viewer with annotation labels that drop in, or (b) negotiate a hook into the viewer itself. Worth 30 min of design thinking before code.

2. **`CostCompositionBar` is heuristic-driven.** Keyword matching on BOQ line descriptions to bucket Civil / MEP / Finishings / Labor. The BOQ visualizer holds the canonical breakdown via `mepBreakdown` and division charts. A Phase 5 round could surface that data through to the wrapper instead of re-deriving — but it requires plumbing data through `useResultPageData`, and the current heuristic is "good enough" for an at-a-glance preview.

3. **WorkflowTypeBadge is hardcoded.** Each new workflow type needs a label tuple added to `pickLabel()`. Fine for now — there are 8 workflow types — but a future taxonomy change would break in one place. Acceptable.

4. **No "compare runs" yet.** Phase 3's deferred. Still deferred. Would be a Phase 5 feature once you decide whether to capture input deltas on Execution.

5. **Mobile signature animation timings haven't been re-tuned.** All animations work on mobile, but a 1.5s wireframe draw on a phone might feel slower than on desktop because of the smaller perceived viewport. If Rutik tests on phone and it feels off, we'd shave 100-150ms off the staggers.

---

## 7 · HONEST CRITIQUE — WHERE PHASE 4 MIGHT OVERDO IT, WHERE IT MIGHT UNDERDO IT

**Risks of overdoing it:**
- The BOQ hero now has: number tick-up + chip cascade + dimension line draw, all on first reveal. That's three discrete animations layered. If Rutik reads it as "too busy on entry," the easy fix is to drop the chip cascade and keep the dimension line. The chips are the most replaceable.
- The IsometricBuilding wireframe at 10% ambient opacity might be too subtle to notice (then why include it?) or too noticeable (then why is it there?). Bias toward subtle — a backdrop should reward inspection but not demand it.

**Risks of underdoing it:**
- Floor plan hero got nothing custom this phase (see §6 #1).
- Pipeline section's aggregate strip is tasteful but maybe too dry. Could benefit from a small color cue when there are errors (already has red `Errored N` mono, but the visual treatment doesn't escalate beyond color text).
- The signatures play **once, on first viewport entry, per page mount.** If a user navigates back to the same result page in the same session, the animations replay (because the component remounts). For frequently-revisited results, that could feel busy. A localStorage flag `seen-signature:<executionId>` could suppress repeats, but that's a UX-policy decision and possibly the right move only for power users.

**Net read:** Phase 4 makes the page distinctive without crossing into busy. The BOQ signature is the strongest move. The Video shutter is the second strongest. The IFC wireframe is the most ambient. Floor plan is the least personalized. Pending's registration mark is small but well-placed.

If you ship this and Rutik says *"I love everything except [X]"*, the easiest single-element rollbacks are:
- Drop chip cascade → re-tune DimensionLine delay back to 0.55s
- Drop wireframe → just remove the `<IsometricBuilding />` line in Model3DVariant
- Drop shutter → remove `<ShutterReveal />` line in VideoVariant
- Drop photo-develop → unwrap the `<img>` from `<PhotoDevelop>`
- Drop registration mark → remove the import + JSX line

Each is a 1-3 line surgical removal. None is structurally entangled.

— END REPORT —
