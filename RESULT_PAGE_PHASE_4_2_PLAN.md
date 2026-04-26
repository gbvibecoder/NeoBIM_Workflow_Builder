# Phase 4.2 — Plan of Attack

**Date:** 2026-04-26
**Branch:** `feat/showcase-redesign-v1` (HEAD `ee038eb`)
**Mission:** Bring BOQ-grade theater (cascade + donut + section structure) to every other workflow type.

## What I learned reading the codebase

- `formatINR` lives at `src/features/boq/components/recalc-engine.ts:177` (NOT `src/features/boq/utils/format-inr.ts` — brief was off-by-one). I'll use the real path.
- HeroSection lives at `src/features/result-page/components/sections/HeroSection.tsx` (NOT `…/components/HeroSection.tsx`).
- DataPreviewSection (NOT DataMetricsSection); PipelineTimelineSection (NOT PipelineSection); useResultPageData (NOT useShowcaseData/useHeroDetection — those are renames from earlier phases).
- Floor plan KPIs **are already labeled** (Rooms / Area / Walls / Floors at HeroSection.tsx:441-444). Rutik's "no label" complaint was likely about the JSON-dump card (`Object.keys(json).length} keys`) which renders unlabeled-looking. That's actually Fix 6.1 territory — kill the JSON bleed-through under the editor.
- The IFC viewer entry card already exists in `DedicatedVisualizerEntries.tsx` for IFC artifacts. Verify it surfaces consistently.

## Execution order (one commit per fix)

| # | Fix | Files |
|---|---|---|
| 1 | Floor Plan signature theater | + RoomScheduleCascade · + RoomAreaDonut · HeroSection.FloorPlanInteractiveVariant grid wrap |
| 2 | IFC signature theater | + ElementCategoryCascade · + ElementDistributionDonut · HeroSection.Model3DVariant grid wrap (IFC-aware) · derive-stat-strip schema row |
| 3 | Video signature theater | + ShotTimeline · + RenderStatsDonut · HeroSection.VideoVariant grid wrap |
| 4 | Image signature theater | + MetadataCascade · ImageVariant chip strip below render |
| 5 | Failure / Pending UX upgrade | HeroFailure recovery suggestions + Run-again CTA · HeroPending phase dots + ETA |
| 6 | Cross-cutting polish | Kill JSON dump under dedicated viewers · LiveStatusStrip workflow-tuning verify · normalize-region grep · KPI labels mandatory |

## Anti-scope

- No `StyleMoodBreakdown` (Fix 4 sub-piece) — data isn't present in image artifacts today. Document in report.
- No new dependencies. Everything SVG + framer-motion.
- No touching preservation list per audit §11.1.
- No physical browser test (env doesn't run a browser) — every workflow's behavior is derived from code-side verification + tsc/eslint/build. Manual test matrix in report explicitly says "predicted, not browser-verified."

## Ship sequence after verification

1. Push feature branch
2. Tag `pre-phase-4-2-merge-2026-04-26` on main as rollback parachute
3. Merge `--no-ff` into main with a merge commit
4. Tag `v4.2.0-result-page` on main
5. Push main + push tag

If Vercel red after main push → `git reset --hard pre-phase-4-2-merge-2026-04-26 && git push --force-with-lease origin main`.
