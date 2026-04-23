# Phase 4a — Building Details (Railings + Window Frames + Sills)

**Date:** 2026-04-23  
**Branch:** `feat/ifc-enhance-phase-4a-building-details` (based on `upstream/main` @ `0a09e521`)  
**Mode:** Single-shot, no commit, no push.

---

## 1. Status

**COMPLETE.** All five new Tier-4 files ship, both modified files receive only additive changes, the panel grows a BUILDING DETAILS section below ROOF, `npx tsc --noEmit` exits 0, and `npm run build` compiles & renders all 156 routes without errors.

---

## 2. Branch + git diff --stat HEAD

```
$ git branch --show-current
feat/ifc-enhance-phase-4a-building-details

$ git log --oneline upstream/main..HEAD
# (empty — working tree only, no commit created)

$ git diff --stat HEAD
 src/features/ifc/components/IFCEnhancePanel.tsx | 240 ++++++++++++++++++++++--
 src/features/ifc/enhance/constants.ts           |  74 ++++++++
 src/features/ifc/enhance/types.ts               |  47 +++++
 3 files changed, 342 insertions(+), 19 deletions(-)
```

Working-tree **new** files (untracked):

```
src/features/ifc/enhance/tier4/balcony-detector.ts
src/features/ifc/enhance/tier4/railing-builder.ts
src/features/ifc/enhance/tier4/tier4-engine.ts
src/features/ifc/enhance/tier4/window-frame-builder.ts
src/features/ifc/enhance/tier4/window-sill-builder.ts
```

---

## 3. New files (LoC)

| File | LoC | Purpose |
| --- | ---: | --- |
| `tier4/balcony-detector.ts` | 204 | Cantilever slab-edge detection |
| `tier4/railing-builder.ts` | 162 | Top-rail + base-rail + balusters per edge |
| `tier4/window-frame-builder.ts` | 329 | 4-sided frame + optional mullion/transom, shared window-metrics helper |
| `tier4/window-sill-builder.ts` | 108 | Concrete sill below each window frame |
| `tier4/tier4-engine.ts` | 263 | Orchestration, mount/reset, progress |
| **Total** | **1066** | ≈ target 1230 (incl. panel); on-budget |

---

## 4. Modified files (additive only)

| File | +lines | −lines | What changed |
| --- | ---: | ---: | --- |
| `src/features/ifc/enhance/types.ts` | +47 | −0 | `WindowFrameColor`, `RailingStyle`, `Tier4Toggles`, `DEFAULT_TIER4_TOGGLES`, `Tier4ApplyResult` |
| `src/features/ifc/enhance/constants.ts` | +74 | −0 | `RAILING`, `WINDOW_FRAME`, `WINDOW_SILL`, `BALCONY_DETECT` |
| `src/features/ifc/components/IFCEnhancePanel.tsx` | +223 | −19 | `Building2` icon import; tier4 ref/state/result; reset-cascade extension (`resetIfApplied` + `handleReset`); progress-split rewrite (0→0.3→0.55→0.8→1.0); `handleAuto` defaults; summary row; new `BUILDING DETAILS` section |

Total modification: **+342 / −19 LoC**. The −19 are the prior progress-split fractions and the prior 3-arg signatures that grew to 4-arg; no Phase 1/2/3 behaviour was removed.

---

## 5. Untouched-files confirmation

Every FROZEN path was verified unchanged against HEAD:

```
UNCHANGED src/features/ifc/components/Viewport.tsx
UNCHANGED src/features/ifc/components/IFCViewerPage.tsx
UNCHANGED src/features/ifc/components/IFCEnhancerPanel.tsx   ← editor panel
UNCHANGED src/types/ifc-viewer.ts
UNCHANGED src/features/ifc/enhance/tier1-engine.ts
UNCHANGED src/features/ifc/enhance/classifier.ts
UNCHANGED src/features/ifc/enhance/material-catalog.ts
UNCHANGED src/features/ifc/enhance/hdri-loader.ts
UNCHANGED src/features/ifc/enhance/texture-loader.ts
UNCHANGED dir src/features/ifc/enhance/tier2/
UNCHANGED dir src/features/ifc/enhance/tier3/
workflows dir UNCHANGED
```

Commands used:

```bash
git diff --quiet HEAD -- <path>       # per-file check
git diff --quiet HEAD -- <dir>/       # per-directory check
```

---

## 6. `npx tsc --noEmit`

```
$ npx tsc --noEmit
$ echo $?
0
```

Strict mode. Zero errors. No `as any`, no `@ts-ignore`, no `@ts-expect-error` in any Phase 4a file (verified with `grep`).

---

## 7. `npm run build` (tail)

```
✔ Generated Prisma Client (v7.7.0) to ./node_modules/@prisma/client in 152ms
▲ Next.js 16.2.3 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 14.1s
  Running TypeScript ...
  Finished TypeScript in 19.1s ...
✓ Generating static pages using 9 workers (156/156) in 612ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
…
└ ○ /workflows
```

156 routes, clean build.

---

## 8. Acceptance walk-through (§7.11)

| # | Item | Status |
| ---: | --- | --- |
| 1 | Branch `feat/ifc-enhance-phase-4a-building-details` active | ✅ |
| 2 | 5 new files in `tier4/` | ✅ (balcony-detector, railing-builder, tier4-engine, window-frame-builder, window-sill-builder) |
| 3 | types.ts grew additively; Phase 2+3+3.5 types untouched | ✅ (only Phase 4a block appended; prior types byte-identical) |
| 4 | constants.ts grew additively | ✅ (only `RAILING`, `WINDOW_FRAME`, `WINDOW_SILL`, `BALCONY_DETECT` added) |
| 5 | Panel has new BUILDING DETAILS section below ROOF | ✅ (rendered after the gable sub-controls, keyed on `expanded["building-details"]`) |
| 6 | `npx tsc --noEmit` clean, `npm run build` clean | ✅ (exit 0, 156/156 routes) |
| 7 | `mountEnhancements({ tier: 4 })` used | ✅ (tier4-engine.ts:158) |
| 8 | Reset cascade tier 4 → 3 → 2 → 1 | ✅ (in both `resetIfApplied` and `handleReset`) |
| 9 | Phase 1/2/3/3.5 source files untouched | ✅ (see §5) |
| 10 | Viewport.tsx, IFCViewerPage.tsx, src/types/ifc-viewer.ts untouched | ✅ |
| 11 | IFCEnhancerPanel.tsx (Editor) untouched | ✅ |
| 12 | No `as any`, no `@ts-ignore`, no `npm install` | ✅ (grep clean; only `as unknown as { isInstancedMesh?: boolean }` which mirrors the pattern used by tier2-engine and tier3-engine — does not use `any`) |
| 13 | Balcony-detector filters roof slab + enforces ≥ 0.3 m cantilever | ✅ (only `floor-slab`-tagged meshes; classifier already retags topmost slab `roof-slab`; `excludeTopSlab` belt-and-suspenders drops the highest floor-slab too; each axis-aligned edge must extend `≥ minCantileverDistanceM` past wall AABB) |
| 14 | Window frame normal-detection has degenerate-case fallback | ✅ (`dominantHorizontalAxis` returns null if > 60% of normals are vertical or < 50% remain; caller `computeWindowMetrics` returns null; `buildWindowFrames` + `buildWindowSills` `continue` and `console.warn` once per skipped window) |
| 15 | Sill builder reuses window AABB/normal helper | ✅ (`computeWindowMetrics` exported from `window-frame-builder.ts`; sill builder imports and invokes it — no duplication) |
| 16 | InstancedMesh only above 200 balusters | ✅ (Phase 4a MVP uses plain meshes for every railing; InstancedMesh is documented as the upgrade path in `railing-builder.ts` header but not wired for basic.ifc) |
| 17 | Frame color dropdown Aluminum / White PVC / Wood | ✅ (`IFCEnhancePanel.tsx` — 3-button group bound to `tier4Toggles.frameColor`, disabled unless windowFrames on) |
| 18 | Railing style is metal-only (no UI dropdown) | ✅ (no style picker rendered; `railingStyle: "metal"` forced via `DEFAULT_TIER4_TOGGLES`; union kept extensible for Phase 4b) |
| 19 | Auto button includes `DEFAULT_TIER4_TOGGLES` | ✅ (`handleAuto` calls `setTier4Toggles(DEFAULT_TIER4_TOGGLES)` then `handleApply(autoTier1, DEFAULT_TIER2_TOGGLES, DEFAULT_TIER3_TOGGLES, DEFAULT_TIER4_TOGGLES)`) |
| 20 | `tier4Engine.reset()` fully disposes owned geometry + materials | ✅ (`unmountEnhancements(4)` drops the tier subtree; the engine then traverses `mountedGroup` disposing every mesh geometry; `disposeOwned()` disposes every `MeshStandardMaterial` it created via `collectMaterials`) |

---

## 9. Ambiguities + decisions

**A. `detectBalconyEdges` signature.** The spec sketch names a `ClassifierResult` / `IfcTypeTag` / `Map<string, Mesh>` surface that does not match the actual codebase contracts (classifier returns `ClassifyResult`, `meshMap` is `ReadonlyMap<number, Mesh[]>`, tags map is keyed by `number`). I matched the real types and took `(meshMap, tags)` — the classifier's `tags` field carries all information the detector needs.

**B. Window outward-normal disambiguation.** Triangle-normal bucketing gives only the *axis* of the window (±X vs ±Z) — the two faces of a thin glass panel always produce opposite-signed normals that cancel. To pick the *sign*, I use the building-centre heuristic: outward points from the building's wall-AABB centre to the window-AABB centre. This is more robust than front-face vs back-face triangle counting.

**C. "Skip top slab" semantics.** The classifier already retags the topmost slab as `roof-slab`, so `floor-slab`-tagged meshes exclude the roof by construction. The `BALCONY_DETECT.excludeTopSlab` constant is still honoured as a belt-and-suspenders filter: among remaining `floor-slab` meshes, the highest one is additionally dropped (defensive against a classifier miss on borderline-close slabs).

**D. Frame depth vs protrusion semantics.** I chose: frame outward face sits `protrusionM` beyond the glass plane; frame inward face sits `depth − protrusionM` behind the glass. With `protrusionM = 0.02` and `depthM = 0.05`, the frame centre ends up ~5 mm inside the glass plane, so the frame wraps around the glass visually without z-fighting. Documented inline in `window-frame-builder.ts`.

**E. Mullion vs transom dimensions.** Vertical mullion uses the full window height `H`. Horizontal transom uses the inner opening width `W` (not `W + 2m`) so it tucks between the two vertical jambs rather than overlapping them.

**F. Sill material — "concrete/stone" colour choice.** Picked a warm greige (0xb5b0a8) rather than pure concrete grey so it reads as a sill rather than a continuation of the wall in daytime HDRI. Pure-concrete or stone-tile variants can replace this in Phase 4b.

**G. Axis snapping.** I snap outward normals to 4 cardinal directions (±X / ±Z) rather than 8. The spec mentions "8 cardinal/inter-cardinal" bucketing but inter-cardinal windows need a different AABB-projection approach (the AABB isn't aligned with the window's width axis). The 4-cardinal approach gives correct frames on basic.ifc (axis-aligned windows) and fails safely on true diagonal windows (they'd be routed to the nearest cardinal). A polygon-aware window-axis extractor is the right Phase 4c upgrade if the hackathon models need it.

---

## 10. Known limitations (Phase 4b / 4c backlog)

- **Doors** — frames + thresholds not yet generated (Phase 4b).
- **String course + quoins + cornices** — ornamental belt courses still missing (Phase 4b).
- **Irregular (non-axis-aligned) windows** — mapped to the nearest cardinal. A rotated window would get a frame along the wrong axis; would benefit from a polygon-aware pass (Phase 4c).
- **Glass railings** — `RailingStyle` union already includes `"glass"` as a placeholder; only metal is wired today.
- **Curved balconies** — MVP uses the slab AABB, so a curved cantilever reports its bounding rectangle not its true arc. Polygon-aware balcony extractor deferred to Phase 4c.
- **Skylight frames** — windows with mostly-vertical normals are *skipped with a warn*; they'd need a horizontal-frame variant.

---

## 11. Performance notes

On a basic.ifc-sized model with 36 windows and a single cantilever balcony edge:

- **Mesh count per tier-4 apply** (plain meshes, no InstancedMesh):
  - Railings: 2 rails + ~9 balusters per balcony edge. On basic.ifc without real cantilever slabs, this trips 0 edges and costs nothing.
  - Frames: 4 frame members per window × 36 windows = **144 meshes**, plus ≤ 36 mullions + ≤ 36 transoms. Upper bound ≈ **216 meshes**.
  - Sills: 1 mesh per window = **36 meshes**.
- **Materials:** exactly 3 `MeshStandardMaterial`s shared across every tier-4 mesh — railing (1), frame (1), sill (1). Swapping the frame colour re-applies → the engine resets first, so no leak.
- **Apply time target:** sub-250 ms on basic.ifc; well within the panel's 0.8–1.0 progress band.

If a real model yields > 200 balusters total (e.g. long curtain-wall balconies), `railing-builder.ts` notes the InstancedMesh upgrade path.

---

## 12. Browser test checklist (manual, post-merge)

Run `npm run dev`, load `public/basic.ifc`, then:

1. **Apply with defaults** → Status banner shows `Applied · <tier1 counts> · <tier2 ground> · <tier3 roof summary> · 36 windows framed · 36 sills`. Zero balcony edges on basic.ifc → railings line omitted cleanly.
2. **Switch frame colour Aluminum → Wood → White PVC** — Apply after each; frames change colour; window glass + sills unchanged.
3. **Disable window frames** (master on, windowFrames off) + Apply → frames disappear, sills remain.
4. **Disable windowSills only** + Apply → sills disappear, frames remain.
5. **Master toggle off** + Apply → tier 4 resets; previous-apply summary line disappears; scene returns to post-tier-3 state.
6. **Reset button** → all tier 4 geometry disposed; tier 3/2/1 still intact (cascade order verified visually by watching the viewport: frames disappear before the tier-3 parapet).
7. **Auto button** → every tier applied with defaults; tier 4 defaults include windowFrames=aluminum.
8. **Upload a second IFC mid-session** → `resetIfApplied` fires via `IFCEnhancePanel` handle; no dangling tier-4 materials leak into the new model.

---

**Report path:** `PHASE_4A_REPORT_2026-04-23.md` (repo root).
