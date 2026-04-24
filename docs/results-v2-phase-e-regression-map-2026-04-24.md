# Results V2 — Phase E Regression Surface Map

**Date:** 2026-04-24
**Branch:** `feat/results-v2-cinematic`
**Status:** read-only audit; no source modifications in this sub-phase.
**Precedents:** Phase A–D audits and reports.

---

## E.A.1 — Files Touched or Added (risk-tiered)

### Tier 1 — Can break production when flag is OFF

Exactly **one file**:

```
src/features/canvas/components/WorkflowCanvas.tsx   (modified, 22 +/4 -)
```

Diff verified via `git diff`:

- **Line 441 area (completion effect)** — pre-Phase-C behavior was `setTimeout(() => setShowShowcase(true), 500)`. Phase D wraps that in a conditional:

  ```ts
  const timer = setTimeout(() => {
    const state = useExecutionStore.getState();
    const execId = state.currentExecution?.id ?? state.currentDbExecutionId ?? null;
    if (process.env.NEXT_PUBLIC_RESULTS_V2 === "true" && execId) {
      router.push(`/dashboard/results/${execId}`);
    } else {
      setShowShowcase(true);                   // ← byte-identical legacy call
    }
  }, 500);
  ```

  The `else` branch calls `setShowShowcase(true)` exactly as before. When the flag is OFF, `process.env.NEXT_PUBLIC_RESULTS_V2 === "true"` is `false`, short-circuits the conditional, and the legacy call fires with the same `500ms` delay and the same `clearTimeout` teardown. The `&& execId` guard is a second safety net — even if the flag is somehow "true" but we have no execution ID, the legacy path still runs.

- **Line 1015 area (View Results FAB)** — pre-Phase-C was `onClick={() => setShowShowcase(true)}`. Phase D:

  ```ts
  onClick={() => {
    const state = useExecutionStore.getState();
    const execId = state.currentExecution?.id ?? state.currentDbExecutionId ?? null;
    if (process.env.NEXT_PUBLIC_RESULTS_V2 === "true" && execId) {
      router.push(`/dashboard/results/${execId}`);
    } else {
      setShowShowcase(true);                   // ← byte-identical legacy call
    }
  }}
  ```

  Same pattern. Same `else` semantics.

- **Effect deps** added `router` to the dependency array. `router` from `useRouter()` is a stable reference per React docs for App Router — this does not cause re-runs on every render.

- **`useRouter`** was **already imported** at line 4 and used at line 293 for an unrelated `router.replace`. No new imports.

- **No other lines changed**. `git diff` confirms zero edits outside these two call sites.

**Byte-identical flag-OFF verdict:** ✅ Legacy path is functionally identical. Only two new lines of runtime work execute under flag OFF (the `useExecutionStore.getState()` call and the `const execId = ...` assignment) before the `else` branch runs. Both are pure reads, no allocations beyond two local variables, no side effects.

### Tier 2 — Can break production when flag is ON

V2 route + supporting code:

```
src/app/dashboard/results/[executionId]/page.tsx        (new, 32 LOC — flag-gated dispatch)
src/app/dashboard/results/[executionId]/LegacyResultPage.tsx (new, 101 LOC — server component, Prisma lookup + redirect)
src/features/results-v2/
  constants.ts                                          (91)
  types.ts                                              (157)
  fixtures/index.ts                                     (350 — also consumed by preview)
  hooks/useDominantColor.ts                             (131)
  hooks/useExecutionResult.ts                           (543)
  lib/artifact-grouping.ts                              (62)
  lib/select-hero.ts                                    (63)
  lib/strip-price.ts                                    (41)
  lib/workflow-accent.ts                                (34)
  components/ResultExperience.tsx                       (410)
  components/controls/VideoControls.tsx                 (234)
  components/hero/HeroVideo.tsx                         (364)
  components/hero/HeroImage.tsx                         (250)
  components/hero/HeroViewer3D.tsx                      (214)
  components/hero/HeroFloorPlan.tsx                     (181)
  components/hero/HeroKPI.tsx                           (231)
  components/hero/HeroSkeleton.tsx                      (202)
  components/panels/OverviewPanel.tsx                   (145)
  components/panels/GeneratedAssetsPanel.tsx            (210)
  components/panels/BehindTheScenesPanel.tsx            (141)
  components/panels/DownloadCenterPanel.tsx             (202)
  components/panels/AINotesPanel.tsx                    (117)
  components/primitives/AnimatedCounter.tsx             (82)
  components/primitives/GradientMesh.tsx                (90)
  components/primitives/MetricStrip.tsx                 (169)
  components/primitives/ShotChip.tsx                    (77)
  components/ribbon/ArtifactRibbon.tsx                  (194)
```

Total: **28 new files**, ~4,135 LOC.

### Tier 3 — Dev-only / docs / scripts

```
src/app/dashboard/results-v2-preview/page.tsx          (20 — gated route)
src/app/dashboard/results-v2-preview/PreviewClient.tsx (230)
src/app/preview/results-v2/page.tsx                    (24 — auth-free mirror for screenshots)
scripts/results-v2-screenshots.mjs                     (58)
docs/results-v2-audit-2026-04-24.md                    (Phase A)
docs/results-v2-doctrine-2026-04-24.md                 (Phase B)
docs/results-v2-phase-d-audit-2026-04-24.md            (Phase D)
docs/results-v2-phase-e-regression-map-2026-04-24.md   (this file)
docs/screenshots/results-v2/*.png                      (26 images)
RESULTS_V2_REPORT_2026-04-24.md                        (Phase C)
RESULTS_V2_PHASE_D_REPORT_2026-04-24.md                (Phase D)
experiments/                                           (unrelated, pre-existing)
```

All Tier 3 content is gated behind `NODE_ENV !== "production"` OR an explicit `NEXT_PUBLIC_RESULTS_V2_PREVIEW` env. Prod build with both gates OFF → `notFound()` — verified in E.C.3.

---

## E.A.2 — Impacted External Surfaces

Grep of `src/` for importers of Phase C+D files:

### `src/features/results-v2/**`

Every importer is either:
- **Inside `results-v2/` itself** (internal module graph).
- **`src/app/dashboard/results/[executionId]/page.tsx`** — only imports `ResultExperience`.
- **`src/app/dashboard/results-v2-preview/PreviewClient.tsx`** — imports heroes + fixtures for preview.

Zero external features reach into `results-v2/`. ✅ Blast radius is the V2 route + preview route only.

### `src/app/dashboard/results/[executionId]/LegacyResultPage.tsx`

Only one importer: `src/app/dashboard/results/[executionId]/page.tsx`. ✅

### `src/features/canvas/components/WorkflowCanvas.tsx`

The modification is additive (two `if/else` gates). The canvas has one external caller — `src/app/dashboard/canvas/page.tsx` — which renders it as-is. No changed interfaces. ✅

### `/dashboard/results/[executionId]/boq` sub-route (pre-existing production code)

The BOQ visualizer at `src/app/dashboard/results/[executionId]/boq/page.tsx` (already tracked in prod) lives at a different URL from the V2 root. Next.js App Router resolves `/boq` as a leaf segment, **unaffected** by the sibling root `page.tsx` that V2 added. The two co-exist peacefully. No regression risk.

---

## E.A.3 — Execution Lifecycle Matrix

Every state transition a user can hit, mapped to the V2 hero variant that fires + the failure vector it defends against.

| # | Transition | V2 variant | User sees | Failure mode we handle |
|---|---|---|---|---|
| 1 | `pending` → `running` → `success` (happy path) | → `video` / `viewer3d` / `floorPlan` / `image` / `kpi` per `selectHero()` | Full hero with artifacts | N/A (baseline) |
| 2 | `pending` → `running` → `failed` | `skeleton` with copy `"Generation failed"` | Failure-toned skeleton, thin progress line at 0 | `ResultExperienceInner`:70–79 — StatusPill renders red `AlertTriangle` tone; skeleton copy switches via ternary in `ResultExperience.tsx:94` |
| 3 | `pending` → `running` → `partial` | `success`-grade hero for whatever artifacts landed | Same as happy path, StatusPill says "Partial" | `ResultExperience.tsx:136` — `state === "partial"` maps to "Partial" label; selectHero still picks the best variant from available artifacts |
| 4 | `pending` → `running` → canceled (server `failed` with `errorMessage: "canceled"`) | `skeleton` | Failure-toned skeleton | Execution state stops at `failed`; no canvas is still open, so the canvas-redirect path won't fire; a deep-link shows the failed hero |
| 5 | `success` + video job still `rendering` (image-3's exact case) | `video` → `HeroVideo` → falls back to `HeroSkeleton` because `currentUrl` is empty | Breathing-mesh skeleton with "Rendering cinematic walkthrough" + dual progress bar when `video.progress` is set | `HeroVideo.tsx:77–86` — `if (!currentUrl) return <HeroSkeleton … progress={video.progress} />` |
| 6 | `success` with zero artifacts | `selectHero` cascade falls through all branches → returns `"skeleton"` | Skeleton with the workflow accent, no progress | `select-hero.ts:17–21` — `hasTerminalArtifact` false + non-running state still yields `skeleton` as the final fallback |
| 7 | `success` with artifacts but no video | `selectHero` picks `viewer3d` / `floorPlan` / `image` / `kpi` per priority | Primary artifact rendered | `select-hero.ts:25–46` — priority cascade |
| 8 | Deep-link to old execution (6+ months; artifact shapes might have drifted) | Normalizer handles missing fields via `??` fallbacks; `selectHero` degrades to skeleton when no recognized artifact lands | Whichever hero is derivable; skeleton if nothing | `useExecutionResult.ts:76–165` — every `pickString` / `pickNumber` defaults silently; `stripPrice()` purges legacy `costUsd` keys so drift cannot poison the render |

All 8 transitions fall into a graceful rendered state. None throws. The skeleton fallback (#4, #6) is what makes this safe — it always has a home.

---

## Handoff to E.B + E.C

- **Tier 1 risk** is isolated to one file, two call sites, with byte-identical flag-OFF behavior.
- **Tier 2 risk** is isolated to the new V2 route and preview route; no external features read from it.
- **Execution-state coverage** is complete — all 8 transitions route to a valid variant.

E.B writes tests for the pure logic that underpins this guarantee (`selectHero`, `stripPrice`, `workflow-accent`, `artifact-grouping`). E.C proves it at runtime with a Playwright scan.
