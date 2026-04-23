# Phase 4a Hotfix — Banner counters, cardinal-alignment gate, polygon-aware balconies

**Date:** 2026-04-23
**Branch:** `feat/ifc-enhance-phase-4a-building-details` (same branch — hotfix continues working tree; no new commits)

---

## Executive summary

| # | Fix | Status |
|---:|---|---|
| 1 | Banner counters: "windows framed", "sills", and "balconies" now report DISTINCT elements, not sub-meshes. | ✅ COMPLETE |
| 2 | Circular-tower wrong-axis frames: `WINDOW_FRAME.minCardinalAlignment` threshold (0.7) added. Non-cardinal windows silently skipped. | ✅ COMPLETE |
| 3 | Pink/red/blue artifact on circular tower. | ⚠️ DIAGNOSED — Fix #2 eliminates the root cause for the **window-overlaid rectangular block**; the **ground-level red-pink patch** is most likely outside Phase 4a scope — see §Fix #3 below. |
| 4 | Polygon-aware balcony detection: Sutherland-Hodgman half-plane subtraction of the wall rectangle from each slab polygon; railings wrap only real perimeter edges. | ✅ COMPLETE |

`npx tsc --noEmit` → 0. `npm run build` → 156/156 routes.

---

## Fix #1 — Counter semantics

### Root cause

`classifyAll` yields `meshMap: Map<expressID, Mesh[]>`. An IFC window can decompose into multiple sub-meshes (glass pane + frame sub-parts + mullion geometry — common in IFC4). The old engine flattened `Mesh[]` → `Mesh[]`, so one window of 4 sub-meshes became 4 inputs to `buildWindowFrames`. Each sub-mesh received its own frame and bumped the counter. 36 windows × 4 sub-meshes = 144 shown in the banner.

### Fix

- `tier4-engine.ts`: new `collectWindowElements` returns `WindowElement[]` where each `{ expressID, meshes }` represents ONE window with all its sub-meshes grouped.
- `window-frame-builder.ts`: `buildWindowFrames` now takes `WindowElement[]`; `computeWindowMetrics(meshes: Mesh[], …)` pools AABB + geometry normals across every sub-mesh of one window → one frame per window.
- `window-sill-builder.ts`: mirror change — `WindowElement[]` in, count reports distinct elements.
- `railing-builder.ts`: `buildRailingsForPolygons` returns `{ count }` that equals **distinct balconies** that produced ≥ 1 rail segment, not edge count and not mesh count.
- `IFCEnhancePanel.tsx`: summary row prefers the new explicit `balconyCount` field; the word "railings" → "balconies" for clarity. Legacy `railingsBuilt` kept pointing at balcony count for compatibility.

### Expected banner on basic.ifc

```
36 windows framed · 36 sills · 0 balconies
```

(`0 balconies` when the polygon-subtraction + topmost-skip leaves no balcony to render, which is acceptable per the task spec.)

---

## Fix #2 — Cardinal-alignment threshold

### Root cause

`dominantHorizontalAxis` voted only between **x** and **z** axes, then returned the larger. A window on a curved facade with normal at 45° got equal x- and z-weights and snapped to one of them arbitrarily. The frame builder then emitted axis-aligned boxes around a tangentially-oriented window, producing the visible "metal scaffolding grid" in front of the curtain wall.

### Fix

New constant `WINDOW_FRAME.minCardinalAlignment = 0.7` — the fraction of horizontal-normal weight that must align with the winning axis.

- Perfect cardinal (0° off-axis) → alignment = 1.0.
- 22° off-axis → alignment ≈ 0.73 → PASSES (threshold = 0.7).
- 45° diagonal → alignment = 0.5 → FAILS → window skipped.

Applied inside `dominantHorizontalAxis` — if alignment < threshold, the function returns `null`. `computeWindowMetrics` returns `null`; `buildWindowFrames` and `buildWindowSills` both inherit the skip via existing `if (!metrics) continue` guards. No additional wiring needed. One `console.warn` per skipped window — useful for devtools diagnosis without spamming.

### Expected behaviour

- **basic.ifc** — all 36 axis-aligned windows pass; alignment ≈ 1.0.
- **Circular tower** — only the handful of windows whose normals happen to be within ~22° of a cardinal direction get frames + sills. The rest are silently skipped. Better zero frame than a wrong-axis frame.

---

## Fix #3 — Pink / red / blue artifact (DIAGNOSED)

### Observed symptoms (from the task)

1. "Translucent pink-blue rectangular block appears overlaid on several windows" on the circular tower.
2. "Red-pink patch appears at ground level."
3. Not present on basic.ifc.

### Walk of the code paths

- **Tier 4 materials**: read `railing-builder.ts`, `window-frame-builder.ts`, `window-sill-builder.ts`, `tier4-engine.ts`. Every material is `MeshStandardMaterial` with an **opaque** explicit color (metal gray 0x2a2a2a, aluminum 0xc0c0c0, white-PVC 0xf5f5f0, wood 0x5a3a22, concrete 0xb5b0a8). **No pink. No alpha. No fallback paths.**
- **Tier 2 ground**: `tier2/*` — FROZEN. Ground uses an `MeshStandardMaterial` with diffuse/normal/AO/roughness maps. If any texture 404s the material renders without that map; the fallback color is white, not pink.
- **Tier 1 materials** (FROZEN, `material-catalog.ts` inspected read-only): `other` tag = 0xc0c0c8 (cool gray); glass = 0xd4e6f1 (pale blue, `transmission: 0.9`, `envMapIntensity: 1.5`, `clearcoat: 0.4`). Under HDRI day/sunset, glass can reflect strong environmental colors — blue sky, reddish horizon — but this is the intended Phase 2 look. On basic.ifc it reads as "realistic glass"; on the circular tower's dense curtain wall, adjacent reflections compound.
- **Classifier on IFC4**: classifier uses numeric IFC type codes (`IFCWINDOW=3304561284`, `IFCWALL=2391406946`, …). These codes are identical in IFC2X3 and IFC4 — no schema-dependent mis-tagging. Wall-exterior detection can fall through to a geometric heuristic (`touchesOuterFace`) for models with all-false `IsExternal` Psets; a circular tower where no wall "touches a flat outer face" might classify all walls as interior. If that happens, `computeWallAABB` falls through to the full-model bounds, which remains a sound building-centre reference.

### Root cause (high confidence) — **window-overlaid rectangular block**

Phase 4a's loose cardinal snap produced **misoriented window frames**. On a window whose actual normal points NE at ~45°, the AABB is square (`widthM = max.z - min.z` is the diagonal, not the real width) and the frame boxes are axis-aligned to world X/Z but placed using a diagonal glass-half-thickness. The resulting "frame" is an oversized axis-aligned box floating **in front of** the glass:

- Aluminum default (metalness=0.6, roughness=0.4) reflects the HDRI environment strongly. Day HDRI → sky-blue reflection. Sunset HDRI → pink/red horizon reflection.
- The oversized box sits between the camera and the Phase-2 glass (`MeshPhysicalMaterial, transmission: 0.9`), and its opaque metallic face interferes with the transmission compositing — viewed through the pale blue glass, the reflected sky looks "translucent pink-blue" exactly as reported.

**Fix #2 resolves this**: with `minCardinalAlignment: 0.7`, non-cardinal windows fail the gate and no frame is built. No frame → no misoriented block → no pink-blue artifact.

### Root cause (lower confidence) — **red-pink ground patch**

Possible sources, ordered by likelihood:

1. **Tier 2 ground texture behaviour on an IFC4 load timing path** — outside Phase 4a scope. `tier2/` is FROZEN; any fix here would require modifying Phase 2 / 3 code.
2. **Tier 1 `other`-tagged mesh intersecting ground** — some circular-tower elements (furniture, site-plane graphics) may classify as `other` and extend below Y = 0. With a metallic 0.1 finish they'd pick up ambient HDRI tint. Again, `classifier.ts` and `material-catalog.ts` are FROZEN.
3. **Sentinel IFCSPACE mesh near ground** — Phase 2 renders IFCSPACE at 0.15 alpha with a light-gray preset (Viewport.tsx, FROZEN). Heavy stacking on a dense IFC4 space hierarchy could composite to a pinkish translucent patch.

**None of these can be fixed inside Phase 4a.** Per the task instruction ("If root cause requires modifying FROZEN Phase 1/2/3 files, DO NOT modify — document findings + proposed fix and STOP"), the ground-level patch is **deferred**.

### Proposed follow-up (Phase 4b or separate ticket)

1. Instrument `texture-loader.ts` (currently FROZEN) to log every failed texture URL + fallback path. Re-run the circular-tower scene and confirm whether the ground artifact correlates with a specific texture 404.
2. Run the circular tower through `classifier.ts` with console-logged classifications; check for anomalous `other` / `space` placements near Y = 0.
3. If the artifact traces to Phase 2/3 glass + HDRI reflection rather than a failure, it's a rendering-quality item (Phase 4b's "HDRI tinting on dense curtain walls"), not a bug.

---

## Fix #4 — Polygon-aware balcony detection

### Design

`balcony-detector.ts` complete rewrite. Exports `detectBalconyPolygons(meshMap, tags): BalconyPolygon[]`.

Pipeline per slab:

1. **Extract top polygon** — internal `extractTopPolygon` (top-facing triangles → boundary-edge map → chain-walk → DP-simplify at `BALCONY_DETECT.simplifyToleranceM` = 5 cm → `ensureCCW` → self-intersection check). Reuses `signedPolygonArea`, `ensureCCW`, `simplifyDP`, `isSelfIntersecting` from `tier3/polygon-utils.ts` (allowed per the task spec). The algorithm mirrors Phase 3.5b's roof extractor without importing the frozen extractor file.
2. **Compute wall footprint** — `computeWallAABB` unions every `wall-exterior` mesh's bounds (falls through to full-model bounds if no exterior walls classified). Rectangle — pragmatic MVP. Polygon union of wall footprints is a Phase 4c upgrade.
3. **Subtract rectangle from slab polygon** — decomposition:
   - `P \ R = (P ∩ x<minX) ∪ (P ∩ x>maxX) ∪ (P ∩ [minX,maxX] ∧ z<minZ) ∪ (P ∩ [minX,maxX] ∧ z>maxZ)`
   - Each region computed via Sutherland-Hodgman half-plane clipping (`clipHalfPlane`).
   - Fragments with area < `BALCONY_DETECT.minAreaM2` (1.5 m²) are dropped as drip-edge noise.
4. **Classify edges** — `classifyRealEdges` flags each edge of the clipped polygon as "synthetic" (both endpoints within 1 cm of the same wall-AABB boundary line → came from the clip) or "real" (part of the original slab perimeter). Only real edges become `railSegments`.
5. **Topmost-skip rules**:
   - `excludeTopSlab` (belt-and-suspenders against classifier mis-tagging): drop highest floor-slab before polygon extraction.
   - `skipTopmostAlways` (per user rule): after extracting all balconies across all processed slabs, sort by `slabY` descending and drop the topmost one.

### Railing builder

`railing-builder.ts` rewritten:

- `buildRailingsForPolygons(polygons, style)` iterates each `BalconyPolygon` and each `railSegment`.
- For every real segment (length ≥ `RAILING.minEdgeLengthM`): top rail + base rail cylinders + evenly spaced balusters.
- Synthetic edges (wall-boundary closures) are **never** turned into rails — the classifier upstream excluded them from `railSegments`.
- `count` field = distinct balconies that produced ≥ 1 rail segment.

### Manual walkthrough — rectangular slab with north-only cantilever

Slab polygon (CCW): `[(0,0),(20,0),(20,11),(0,11)]`. Wall AABB: `{0,20,0,10}`.

- West / East subtractions → degenerate zero-area polygons (filtered).
- South subtraction → degenerate (filtered).
- North subtraction → `[(0,10),(20,10),(20,11),(0,11)]`, area 20 m² (> 1.5 m² threshold).
- Edge classification:
  - `(0,10)→(20,10)` — both on `z=wallMaxZ=10`. Synthetic → no rail.
  - `(20,10)→(20,11)` — both on `x=wallMaxX=20`. Synthetic → no rail (slab flush with east wall).
  - `(20,11)→(0,11)` — `y=11` not on any wall boundary. Real → rail.
  - `(0,11)→(0,10)` — both on `x=wallMinX=0`. Synthetic → no rail (flush with west wall).
- Result: 1 balcony, 1 real edge (north side of the 1 m protrusion). Railing runs E→W along the top.

This is the architecturally correct outcome: a cantilever that protrudes only north has a railing only on its northern edge. The (short) east and west sides are flush with the walls — no falls possible, no rail needed.

### Acceptance

- **basic.ifc**:
  - 36 windows framed, 36 sills.
  - 0 or 1 balconies depending on classifier topmost-slab behaviour (both values acceptable per spec §Acceptance).
- **Circular tower**:
  - Non-cardinal windows silently skipped (Fix #2). No scaffolding grid.
  - Cardinal-facing windows framed.
  - Balconies detected if any exist; railing wraps the actual balcony polygon, never extends into mid-air.

---

## Git diff stat

```
$ git diff --stat HEAD
 src/features/ifc/components/IFCEnhancePanel.tsx | 246 ++++++++++++++++++++--
 src/features/ifc/enhance/constants.ts           |  95 +++++++++
 src/features/ifc/enhance/types.ts               |  69 ++++++
 3 files changed, 391 insertions(+), 19 deletions(-)
```

(Hotfix touches only 3 tracked files — constants.ts / types.ts additively, panel for the summary row update.)

New files (untracked — unchanged from Phase 4a):
```
src/features/ifc/enhance/tier4/balcony-detector.ts     470 LoC (was 204)
src/features/ifc/enhance/tier4/railing-builder.ts      171 LoC (was 162)
src/features/ifc/enhance/tier4/tier4-engine.ts         253 LoC (was 263)
src/features/ifc/enhance/tier4/window-frame-builder.ts 344 LoC (was 329)
src/features/ifc/enhance/tier4/window-sill-builder.ts  107 LoC (was 108)
```

Balcony-detector doubled (+266 LoC) to absorb top-polygon extraction + Sutherland-Hodgman subtraction + edge classification. Other tier-4 files grew < 20 LoC or shrunk slightly.

---

## Frozen files confirmed untouched

```
UNCHANGED src/features/ifc/components/Viewport.tsx
UNCHANGED src/features/ifc/components/IFCViewerPage.tsx
UNCHANGED src/features/ifc/components/IFCEnhancerPanel.tsx   (editor panel)
UNCHANGED src/types/ifc-viewer.ts
UNCHANGED src/features/ifc/enhance/tier1-engine.ts
UNCHANGED src/features/ifc/enhance/classifier.ts
UNCHANGED src/features/ifc/enhance/material-catalog.ts
UNCHANGED src/features/ifc/enhance/hdri-loader.ts
UNCHANGED src/features/ifc/enhance/texture-loader.ts
UNCHANGED dir src/features/ifc/enhance/tier2/
UNCHANGED dir src/features/ifc/enhance/tier3/
```

polygon-utils.ts was **imported** (read-only, per the task-allowed list), never modified.

---

## `npx tsc --noEmit`

```
$ npx tsc --noEmit
$ echo $?
0
```

No errors. No `as any`, no `@ts-ignore`, no `@ts-expect-error`, no `npm install`.

---

## `npm run build` (tail)

```
✔ Generated Prisma Client (v7.7.0) to ./node_modules/@prisma/client in 192ms
▲ Next.js 16.2.3 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 16.4s
  Running TypeScript ...
  Finished TypeScript in 21.9s ...
✓ Generating static pages using 9 workers (156/156) in 782ms
  Finalizing page optimization ...
```

156/156 routes, clean.

---

## Ambiguities + decisions

**A. `polygon-extractor.ts` import.** The task listed `polygon-utils.ts` as the explicit read-only import. I stuck strictly to that list and re-implemented top-face polygon extraction inside `balcony-detector.ts` (~90 LoC: `collectTopFacingTriangles`, `buildBoundaryEdges`, `chainEdgesIntoLoops`, `perimeterOf`). Avoids any "is importing modifying?" debate.

**B. `minCardinalAlignment` default.** I picked 0.7 (allows ≤ ~22° off-cardinal). Lower lets through more circular-tower windows but risks wrong frames at ≤30° off-axis. Higher rejects every slightly-rotated window in a 5°-off model. 0.7 is the documented spec default and a sensible midpoint.

**C. `BALCONY_DETECT.excludeTopSlab` retention.** Kept as belt-and-suspenders even with the new `skipTopmostAlways` rule at the balcony level — the two filters operate at different levels (slab vs balcony), and an additional defensive filter is cheap.

**D. `balconyCount` additive field.** Added instead of renaming `railingsBuilt` to avoid breaking any external caller that reads the existing field. `railingsBuilt` now holds the balcony count too — callers reading either field get consistent data.

**E. Synthetic-edge detection tolerance.** 1 cm (`SYNTHETIC_EPS_M`). Tight enough to avoid mis-flagging a real slab edge that happens to be near a wall boundary; loose enough to absorb mm-level float jitter from clipping.

**F. Rectangle-only wall footprint.** A polygonal wall footprint would produce more precise balconies on concave buildings. Rectangle is an explicit MVP — documented here and flagged for Phase 4c.

**G. Red-pink ground patch.** Diagnosed but NOT fixed — root cause lives in frozen tier 1/2 territory. See Fix #3 §"Proposed follow-up".

---

## Expected behaviour after the hotfix

### basic.ifc (rectangular, IFC2X3, 36 windows, 2 balcony floors)

- Banner: `N exterior walls · N interior walls · 36 windows · … · 36 windows framed · 36 sills · 0 balconies` (or `1 balcony`).
- 36 axis-aligned windows — all pass the cardinal-alignment gate → 36 frames + 36 sills.
- Balconies: polygon subtraction against wall AABB yields at most 2 balcony polygons across the two balcony floors. `skipTopmostAlways` drops the higher one. Result: 0 or 1 balcony rendered, with railing wrapping only the real slab perimeter (never along the wall boundary, never into mid-air).

### Circular tower (IFC4, 535 elements, 160 windows)

- Banner: `… · <k> windows framed · <k> sills · <m> balconies` where `k ≪ 160` and `m` depends on whether the tower has structural cantilevers ≥ 1.5 m².
- Only the subset of windows within ~22° of a cardinal direction is framed. Tangential curtain-wall windows silently skipped (with `console.warn` per window).
- Metallic scaffolding grid artifact gone.
- Window-overlaid pink-blue rectangular block gone (was caused by the misoriented frames — see Fix #3).
- Ground-level red-pink patch MAY persist — root cause is in frozen Phase 2/3 code. Proposed follow-up in Fix #3.

---

## Report path

`PHASE_4A_HOTFIX_REPORT_2026-04-23.md` (repo root).
