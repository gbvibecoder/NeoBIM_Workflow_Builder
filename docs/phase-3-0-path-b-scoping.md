# Phase 3.0 Path B — Scoping Report (polygon-closure filter)

**Date:** 2026-04-22
**Author:** Claude (research-only pass)
**Status:** SCOPING — no code written, no branches created, no commits made.
**Inputs read:**
- `docs/phase-3-0-spike-report.md` (parent spike; commit `6de8bb3`)
- `docs/phase-3-0-text-masking-spike.md` (sub-spike NO-GO; current branch `experiment/phase-3-0-text-masking`)
- `src/features/floor-plan/experiments/phase-3-0/**` (Pipeline A, Pipeline B, text-mask lib, pipeline-b-masked)
- `experiments/outputs/phase-3-0/**` (spike overlays + text-mask comparison PNGs + `metrics.json`)
- `src/features/floor-plan/lib/vip-pipeline/{types,stage-4-extract,stage-5-*}.ts` (production pipeline output contracts)
- `src/features/floor-plan/lib/strip-pack/types.ts` (`Rect` is strictly axis-aligned)

---

## 1. Executive summary

**Verdict: ⚠️ CONDITIONAL GO** — for a short (4–5 day) Path B *filter-only* spike.

**Do not commit to full Path B as a Stage 4 replacement without running that spike first.**

Two things are true simultaneously:

1. **The polygon-closure idea is geometrically sound and worth a short spike.** Pipeline B already emits wall segments with deterministic endpoints after the 16 px grid-snap. On every real image I inspected the *real* walls ARE mostly detected. They are drowning in door-arc / window / frame noise (55 detected vs ~26 GT on `real-04`). A minimum-cycle filter is a credible way to separate signal from symbol noise without writing three special-case detectors (arcs, windows, ticks) as Path A would.

2. **There is a first-order integration blocker the sub-spike's Section 8 did not flag.** Stage 5 (current production) consumes **axis-aligned rectangles only** — `Rect { x, y, width, depth }` in feet — and derives walls + doors + windows by scanning each rectangle's 4 edges (`stage-5-fidelity.ts` lines 172–270). Path B, as the sub-spike described it, produces **polygons** (possibly L-shaped, T-shaped, or with interior voids). Those cannot feed Stage 5 without either (a) approximating each polygon by its bounding rectangle — which loses the L-shape accuracy that motivated Path B in the first place, or (b) a multi-week Stage 5 refactor to accept polygon rooms.

The right move is: **spike the polygon-closure FILTER (wall-count reduction + shared-EP lift) as a standalone success criterion, without attempting Stage 5 integration in the same spike.** If the filter clears the gate on ≥7/10 real images, we then do a separate 1–2 week Stage-5-adapter spike. If the filter doesn't clear the gate, we fall back to Path A (symbol suppression) without having wasted time on production plumbing.

Effort for the Path B *filter-only* spike: **3–4 engineering days** (confidence: medium — cycle-enumeration is well-understood, the test rig + output conventions already exist from text-masking). Total time to a Phase 3.0 production decision: **~1 working week** end-to-end.

If a GO emerges, the honest Phase 3.0 timeline lengthens from the sub-spike's 5–6 weeks to **7–9 weeks** once Stage 5 polygon support is included. That's the number to quote stakeholders — not 5–6.

---

## 2. Codebase findings (one section per reading-list item)

### 2.1 `docs/phase-3-0-spike-report.md` — parent spike recap

- **What Pipeline B does:** preprocess → **Zhang-Suen thinning** → HoughLinesP → colinear merge (ε=3 px) → **16 px grid snap**. Output: `LineSegment[]` with `{x1,y1,x2,y2, length, orientation: "horizontal" | "vertical" | "diagonal"}` and a `CVPipelineResult` wrapper carrying timings + `rawHoughLineCount` + `postMergeCount`.
- **Synthetic F1 = 0.889 (2 of 3 cases at 1.000).** The `synthetic-6room-residential` case was 0.667 — the two missed walls sat near the "Hallway" / "Living / Kitchen" text labels and got consumed by the thinning of overlapping text strokes.
- **On real images, median wall count = 49.5** against an expected 18–25. Over-detection 2–3×.
- **Locked constants** (inherited directly by Path B):
  - `BINARY_THRESHOLD = 180`
  - `HOUGH`: ρ=1, θ=π/180, thresh=50, **minLineLength=40**, **maxLineGap=5**
  - `COLINEAR_EPS = 3 px`
  - `GRID = 16 px`
  - Zhang-Suen thinning max iterations = 30 (typical convergence 5–15)

### 2.2 `docs/phase-3-0-text-masking-spike.md` — the NO-GO that motivated Path B

- Circuit-broke at 5/5 fails. Text masking removed ~5–15 label-stroke segments per image but did nothing about the **35–55 architectural-symbol segments** per image.
- Section 4.1's headline — *"Architectural symbol noise, not text"* — is the key empirical input to Path B scoping. Door arcs alone account for 11 × ~4 = ~44 spurious walls on `real-04`.
- Section 8 proposes Path B explicitly: *"Keep Pipeline B as-is … Run polygon-formation pass (minimum-cycle graph) AFTER Hough. Discard any wall segment that's not an edge of at least one closed polygon."* This is the scoping target for this document.
- **What Section 8 DID NOT cover:** downstream integration with Stage 5. This is the gap §3.5/§4 (Q5) of this document closes.

### 2.3 Parent branch `experiment/phase-3-0-spike` files under `src/features/floor-plan/experiments/phase-3-0/`

Folder layout (current `experiment/phase-3-0-text-masking` branch retains these plus the text-mask additions):

```
experiments/phase-3-0/
├── cv-pipeline.ts       # Pipeline A (as-spec: Canny → Hough → merge → snap)
├── cv-pipeline-b.ts     # Pipeline B (+Zhang-Suen before Hough) ← Path B extends this
├── synthetic.ts         # programmatic ground-truth floor-plans (4-room grid, 6-room, with-arcs)
├── metrics.ts           # computeObjectiveMetrics / computeGroundTruthMetrics
├── overlay.ts           # side-by-side PNG compositor
├── lib/text-mask.ts     # tesseract Step 0 (added on current branch)
├── pipelines/
│   └── pipeline-b-masked.ts  # Step 0 + delegate to cv-pipeline-b
└── __tests__/
    └── text-mask-smoke.ts    # tsx-executable sanity check for lib/text-mask
```

**Wall output shape (`cv-pipeline.ts` lines 24–56):**

```ts
interface LineSegment {
  x1: number; y1: number; x2: number; y2: number;
  length: number;
  orientation: "horizontal" | "vertical" | "diagonal";
}
interface CVPipelineResult {
  walls: LineSegment[];
  rawHoughLineCount: number;   // diagnostic
  postMergeCount: number;      // diagnostic
  imageWidth: number; imageHeight: number;
  timings: { preprocessMs; cannyMs; houghMs; mergeMs; snapMs; totalMs };
  pipelineVersion: string;
}
```

The format is **flat line-segments, no metadata**. There is no `id`, no `junctionRefs`, no `roomIds`. Path B can append its own polygon metadata without breaking parent callers — the test rig currently reads only `walls` + `rawHoughLineCount`.

**Which step does grid-snap? Step E (after colinear-merge).** Sequence in `runCVPipelineB`: preprocess → thinning → Hough → `mergeColinear` (buckets by axis-coord rounded to `COLINEAR_EPS=3 px`, then merges overlapping intervals) → `gridSnap` (rounds each endpoint to the nearest 16 px multiple, filters segments with length < 20 px after snap).

**Colinear-merge happens BEFORE grid-snap.** That ordering matters for Path B:

- After merge, endpoints are still at sub-16-px resolution — two walls that "should" meet at the same grid node may have endpoints that drift by up to ±COLINEAR_EPS (3 px) from the midpoint.
- Grid-snap then pushes each endpoint to its nearest grid point — but **only if every endpoint is closer to grid-point-N than to grid-point-N+1**. If an endpoint sits at a 16.5 px offset from a grid point, it snaps one way; another endpoint of the same "true" junction at 15.5 px offset may snap the other way. That's a full 16 px wall-jog, enough to break a polygon cycle.
- This is confirmed empirically by the shared-EP ratios on real images (0.09–0.41 across all 10). A well-junctioned set of walls should score ≥ 0.8 — the current 0.27 median says endpoints are NOT consistently meeting.

**Implication for Path B:** a naive cycle-enumeration on the current output will miss cycles because many junctions don't actually coincide. Path B must add an **endpoint-clustering / bridging pass** (see §3.3 and §4 Q3) before cycle enumeration, OR it must tighten COLINEAR_EPS + GRID together.

### 2.4 Current Stage 4 extraction (`src/features/floor-plan/lib/vip-pipeline/stage-4-extract.ts`)

Stage 4 is **GPT-4o Vision** today — not CV. It emits:

```ts
interface ExtractedRooms {
  imageSize: { width: number; height: number };
  plotBoundsPx: RectPx | null;          // axis-aligned pixel rectangle
  rooms: ExtractedRoom[];
  issues: string[];
  expectedRoomsMissing: string[];
  unexpectedRoomsFound: string[];
}
interface ExtractedRoom {
  name: string;              // canonical, matched to brief.roomList
  rectPx: RectPx;            // { x, y, w, h } — AXIS-ALIGNED PIXEL RECTANGLE
  confidence: number;        // 0..1
  labelAsShown: string;
}
interface RectPx { x: number; y: number; w: number; h: number; }
```

Phase 2.8 added:
- `applyStage4PostValidation` (`stage-4-validators.ts`) — drops phantom rooms (area < 12 sqft, with pooja/store/powder exemptions), flags out-of-band areas against the brief's `approxAreaSqft`.
- `pickBestMatch` (`stage-4-matcher.ts`) — discriminator-weighted fuzzy name matcher (fixes the `Master Bath → Master Bedroom` bug).

**Contract commitment:** Stage 5 consumes `ExtractedRooms`. Every room is an axis-aligned rectangle in pixels. Path B's eventual "polygon per room" output doesn't fit this shape — this is the blocker detailed in §4 Q5.

### 2.5 Current Stage 5 hybrid (`stage-5-classifier.ts` + `stage-5-enhance.ts` + `stage-5-fidelity.ts` + `stage-5-adjacency.ts` + `stage-5-synthesis.ts`)

**Stage 5 flow (fidelity mode, Phase 2.7C+):**

1. Transform each `ExtractedRoom.rectPx` from pixels (Y-down) → feet (Y-up SW origin). Stored as `TransformedRoom { name, type, placed: Rect }` where `Rect = { x, y, width, depth }` in feet.
2. `classifyScenario` (Phase 2.9 classifier) decides whether to *enhance* dimensions. Hard gates:
   - `plotBoundsPx` aspect ratio ≤ 4:1 (→ `isRectangular`)
   - plot area in `[500, 7000]` sqft band (not tiny, not luxury)
   - prompt has no commercial markers
   - `roomCount ∈ [4, 15]`
   - grid-square bias detected (≥ 3 mixed-type rooms within ±5% of same area)
   - brief.roomList non-empty
3. If enhance-gate passes: `applyDimensionCorrection` resizes each room around its center to the brief's target area, clamping aspect ratio to `[0.4, 2.5]`, minimum dimension 4 ft.
4. `detectOverlaps` runs on the corrected output; if any pair overlaps by > 0.5 sqft, **atomic rollback** to the pre-correction state (`stage-5-enhance.ts` lines 254–277).
5. `enforceDeclaredAdjacencies` (Phase 2.3) moves rooms onto declared shared edges; same rollback gate.
6. `deriveWalls` (`stage-5-fidelity.ts` lines 172–305) builds `WallSegment[]` by scanning each room's 4 edges and splitting shared portions into "internal" walls, unshared portions into "external" walls.
7. `placeDoors` / `placeWindows` populate openings based on zone + adjacency.
8. Convert to `FloorPlanProject` (feet → millimeters for the renderer).

**Hard constraints Path B must respect:**

- Rooms are **axis-aligned rectangles** throughout. The `rectsShareEdge` helper (`strip-pack/types.ts` line 250) checks equality on a single coordinate — polygons with diagonal edges have no place here.
- The 6-gate classifier reads only `plotBoundsPx` + `roomCount` + `rectPx.w × rectPx.h`. If Path B eventually emits polygons, all six gates will need rewriting.
- The atomic-rollback on > 0.5 sqft overlap compares `Rect × Rect`. Polygon overlap is polygon-clipping, not a closed-form area calculation — that's a meaningfully harder algorithm.
- Phase 2.9 telemetry (`Phase29Telemetry`) is wired through `Stage5Metrics.enhancement` and read by the Logs Panel UI. Any new Path B metric needs the same wiring — don't add metadata that silently gets lost.

**Practical implication:** keeping Path B as a **wall-list filter** (same `LineSegment[]` out as in, just fewer segments) leaves Stage 5 untouched. Taking the further step to **emit polygon rooms** is a separate project.

---

## 3. Visual & empirical analysis on `real-04` and surrounding images

### 3.1 What I actually looked at

- `experiments/outputs/phase-3-0/text-masking/real-04-5bhk-80x60-luxury-villa_01-input.png` — clean GPT-Image-1 render of a 5BHK villa with Living Room / Dining / Kitchen / 4 × Bedroom / 3 × Bath on a rectangular plot.
- `..._04-walls-before.png` — Pipeline B overlay on the original: 50 segments.
- `..._05-walls-after.png` — Pipeline B overlay after text-masking: **55 segments** (went UP, per Section 4.0 of the sub-spike).
- `experiments/outputs/phase-3-0/metrics.json` — per-case metrics for all 10 real images.
- `experiments/outputs/phase-3-0/text-masking/metrics.json` — per-case metrics for the 5 images processed before circuit-break.

### 3.2 Plot scale reference

At 1024×1024 for an 80×60 ft plot:
- X scale: 1024 / 80 = **12.8 px/ft**
- Y scale: 1024 / 60 = **17.1 px/ft** (but Pipeline B uses a square canvas, so there's letterboxing — effective scale on the floor-plan region is closer to 12 px/ft)
- 16 px grid = **1.25 ft grid**
- 3 ft interior door = **~38 px gap**
- 4 ft main entrance = **~51 px gap**
- Wall thickness at render = **~8–12 px** (confirmed by Pipeline A's 2× detection: Canny finds both edges of an 8–12 px bar).

### 3.3 Endpoint-scatter symptoms visible in the overlay

The `_05-walls-after.png` for `real-04` shows green-dot junctions (endpoint cluster markers) along every wall. Two patterns are visible:

- **Interior walls appear as 2–4 short red segments** separated by small green-dot clusters. Each interior wall that *should* be one continuous segment has been broken at 1–3 interior junction points where orthogonal walls meet. Good — that's what grid-snap is supposed to do.
- **But the green dots are frequently in pairs** — two junction clusters 1–2 grid cells apart (16–32 px) at positions that SHOULD be identical. This is the shared-EP metric failing: 0.27 on `real-04`. The endpoints have not consistently snapped to the same grid point.

### 3.4 Per-symbol noise budget on `real-04` (empirical)

Visual census from the `_05-walls-after.png` overlay + `_01-input.png`:

| Symbol type | Visible count | Segments per symbol | Estimated noise |
|---|---:|---:|---:|
| Door swing arcs (interior) | 11 | 3–4 (chord + arc tangent fragments) | ~38 |
| Window stencils (double-parallel lines on exterior) | 7 | 2 per window | ~14 |
| Door-frame outlines (short jogs where wall ends at door) | 11 | 1–2 | ~14 |
| Dimension tick marks (small lines outside plot) | ~6 | 1 | ~6 |

Total expected noise: **~60+ segments from symbols alone**. Plus ~26 real walls → predicts ~86 pre-merge; the 55 post-merge count says Pipeline B's merge absorbs about 30 of those. Consistent with the sub-spike's "architectural symbol noise, not text" root-cause.

### 3.5 What polygon-closure should do in principle

- **Door arcs**: open curves, never close into a cycle on their own, never share endpoints with perpendicular walls → rejected by a cycle filter.
- **Window double-pairs**: too short to form a cycle with anything else and the two lines are parallel, not perpendicular → rejected.
- **Door-frame outlines**: fragments are short, endpoints are usually interior (away from grid corners) → rejected unless they happen to form a tiny 4-segment cycle inside a door-frame "box", which is a real edge case.
- **Dimension ticks**: isolated; can't close → rejected.
- **Real walls**: each forms part of at least one room's boundary → kept.

This is the structural argument for Path B. It is sound. The open question is whether real-image endpoint scatter is tight enough for cycles to emerge at all without extra bridging.

---

## 4. Investigation answers (Q1–Q8)

### Q1 — Polygon-closure feasibility precheck (real-04 visual inspection)

**Answer: CONDITIONAL YES.**

What the `real-04` overlay shows (visual rating only — I did not implement anything):

- **Outer perimeter** is mostly closed: 4 long exterior segments along N/E/S/W, with ~6–8 visible breaks where windows render as gaps + 1–2 breaks where the main entrance arc sits. The perimeter forms one large "almost-cycle" that would need ~7–9 bridges to become a closed polygon.
- **Most interior walls are present** as red overlay segments. A human can trace each of the ~26 GT walls, though several are represented as 2–3 short collinear fragments rather than one segment.
- **But almost no junctions actually coincide.** The green dots at 4-way intersections show 2–4 distinct endpoint clusters at each junction, not one. This is the 0.27 shared-EP number manifesting visually.
- **Door-arc chords DO share endpoints with adjacent walls** — an arc drawn at a door opening has its two endpoints landing on the wall line, which means the arc chord will be a wall segment *and* an edge of any cycle the arc closes against. That's a false-positive risk for cycle filtering that Section 8 of the sub-spike glossed over.

**Binary answer:** a minimum-cycle algorithm running on the *current* Pipeline B output will **fail to enumerate most rooms** — the endpoint scatter is too loose, and the door-arc chord issue creates false cycles. **Adding a bridging pass (see Q2)** and tightening the endpoint equivalence relation (see Q3) should recover most rooms. That's the spike's core uncertainty.

### Q2 — Doorway handling

**Answer:** typical doorway gap in Pipeline B output is **~30–45 px wide** on a 1024² render of a 60–80 ft plot (corresponding to 3–4 ft real doors plus the jambs). Main entrances are ~50–60 px.

**Proposal for wall-endpoint bridging:** treat two colinear segment endpoints as "virtually connected" for cycle enumeration if all three hold:
1. `sameOrientation(A, B)` (both horizontal or both vertical)
2. `|axisCoord(A) - axisCoord(B)| ≤ 2 px` (tight — walls ARE colinear after grid-snap)
3. `gapLen(A, B) ≤ 48 px` (bridges doors; just under 4 ft at 12 px/ft)

**Risk analysis of N=48 px:**
- Too loose: two parallel walls in separate rooms but offset by a single corridor can be colinear within 48 px if the corridor is narrow. Example: a 3-ft (36 px) corridor between two master-bedrooms creates a colinear pair that WOULD falsely bridge.
- Too tight: interior doors in rooms with decorative trim can render as 50–55 px gaps; those doors don't close into cycles.

**Mitigation: two-pass bridging.**
- Pass A (safe): bridge only gaps ≤ 32 px. Closes most 3-ft doors. Zero risk of merging distinct walls across a corridor (no corridor is < 3 ft).
- Pass B (risky): bridge 32–48 px gaps **only if a door-arc semicircle is detected in the gap** (OpenCV `HoughCircles` inside the rectangular gap-region, filtered to r = 30–50 px half-circles). This uses arcs as a positive signal for "yes, a door lives here" rather than noise to discard.

The two-pass approach is strictly more expensive to implement but avoids the catastrophic-failure mode of merging rooms that aren't neighbors. **Recommend scoping both for the spike and evaluating A alone first.**

### Q3 — Grid-snap tolerance

**Answer: 16 px is too loose for cycle enumeration. Propose 8 px for the Path B spike (with explicit test vs 16 px).**

Evidence:
- `real-10-2bhk-35x40-compact-family-B` has `sharedEndpointRatio = 0.086` (worst in the corpus) and 67 unique endpoints for 35 walls. That's 1.9 unique endpoints per wall, meaning the average wall does NOT share *either* endpoint with any other wall. Cycle enumeration on that graph produces zero cycles.
- At 16 px snap, two "real" endpoints at px (x=472.5, y=300.5) and (x=487.5, y=301.0) snap to (480, 304) and (480, 304) — same. Good.
- But at px (x=479.5, y=300.5) and (x=488.5, y=301.0): snap to (480, 304) and (480, 304) — same. Also good in this case.
- Failure case: (x=471.5, y=300.5) → (464, 304); (x=488.5, y=301.0) → (480, 304). **Different snap bins, same wall in reality.** 17-px physical spread across a grid-cell boundary splits the junction.

Tightening to 8 px halves the spatial bin but doubles the chance of a real physical junction being split. In practice, walls of thickness 8–12 px have centerline drift of ±2–3 px after thinning — which means 8 px is still safe if endpoints genuinely cluster. **The correct tuning is empirical (measure shared-EP at GRID ∈ {4, 8, 16} on all 10 real images).**

**Practical proposal for the Path B spike:**
- Keep GRID = 16 px for the primary wall output (preserves compatibility with existing Pipeline B consumers).
- Build the cycle enumeration on a separate **"graph node" resolution** of 8 px (i.e., two endpoints within 8 px × 8 px of each other are treated as the same graph vertex). Decoupling these means we don't change the wall segments' reported coordinates.

### Q4 — Exterior perimeter fragility

**Answer: fragile as described. Convex hull is necessary but not sufficient; need alpha-shape for non-convex plots.**

Count on `real-04`: **8–11 exterior segments** along the visible perimeter (4 corners × 1–2 segments per edge, broken by 6 windows + 1 main entrance). At least 2 are "missing" in the sense that the exterior-wall line has a ~30 px gap at each window.

**Proposal: special-case exterior rescue.**
1. After cycle enumeration, identify any segments that have at least one endpoint within `PERIMETER_EPS = 48 px` of the bounding-box of all detected walls.
2. Concatenate those segments + all bridging gaps ≤ 48 px into a single "perimeter candidate" path.
3. If the candidate path closes (or closes within 3 bridges of total length ≤ 60 px), accept it as one additional polygon ("the plot boundary").

**Why alpha-shape not convex hull:**
- Convex hull fails on plots with courtyards or setback-cutouts. Example: a typical villa with a front-porch setback has an exterior profile that dips IN around the porch. Convex hull returns the bigger box; rescue fails because the "real" porch-adjacent walls don't lie on the convex hull.
- Alpha-shape (with α ≈ 3 ft) traces concave profiles while still ignoring isolated arcs/windows. Pure-JS alpha-shape is ~100 LOC and tractable.

**For the spike, propose convex-hull rescue as pass 1** (cheap, handles 8 of 10 corpus images). Reserve alpha-shape for the full Phase 3.0 build.

### Q5 — Output contract compatibility ⚠️ **BIGGEST RISK**

**Answer: incompatible without either lossy approximation or a Stage 5 refactor.**

Detailed read of `stage-5-*.ts` (see §2.5):

- Stage 5 consumes `ExtractedRooms { plotBoundsPx: RectPx | null; rooms: ExtractedRoom[] }` where each `ExtractedRoom.rectPx` is `{ x, y, w, h }` — **axis-aligned pixel rectangle**.
- The entire Stage 5 chain (classifier → enhance → adjacency → fidelity wall-builder) is **rectangle-only**:
  - `isApproxRectangular`: aspect ratio check on `plotBoundsPx`.
  - `applyDimensionCorrection`: `rectFromCenter(cx, cy, newW, newH)`.
  - `detectOverlaps`: simple xyxy intersection.
  - `deriveWalls` (fidelity): scans each room's top/bottom/left/right edges and splits shared vs unshared intervals.
  - `rectsShareEdge` (strip-pack helper): equality on a single coord.
- Strip-pack's `Rect` is `{ x, y, width, depth }` in feet, Y-UP SW-origin. Zero polygon awareness anywhere in the module.
- Stage 6 quality scoring (`stage-6-quality.ts`) reads from the final `FloorPlanProject` which is also rectangle-only.

**Two honest options for Path B's eventual polygon output:**

**Option A — Polygon → bounding rectangle adapter (quick, lossy):**
- After cycle enumeration, take the axis-aligned bounding box of each polygon. Return those as `ExtractedRoom[]`.
- Pros: trivial adapter (~30 LOC), Stage 5 unchanged.
- Cons: L-shaped rooms become rectangles. If the original detected polygon had a 20% L-cutout (e.g. a kitchen with a built-in pantry nook), the bounding box overstates the room's footprint and creates overlap with the kitchen's neighbor.
- Risk: the very plots Path B would detect as non-rectangular are exactly the ones an L→rect collapse loses accuracy on. Partially defeats the purpose.

**Option B — Extend Stage 5 to polygon rooms (2–3 weeks):**
- New `ExtractedRoomPolygon { name, polygon: Point[], …}` variant.
- Polygon overlap via Sutherland–Hodgman or similar; pick a lib: `polygon-clipping` (MIT, TS types, ~30 KB, no native deps) — fits Vercel Pro.
- `deriveWalls` rewrites: walk each polygon edge, match against other polygons' edges for shared intervals.
- `rectFromCenter` in enhance needs a polygon analogue (probably skip — enhance is only meaningful for rectangle rooms anyway, so gate it behind `isRectangular`).
- Stage 6 verdict needs to keep working — bounding-box areas are a reasonable fallback.

**Recommendation for the scoping doc:** scope the Path B *spike* purely as a **wall-list filter** (`LineSegment[]` → subset of `LineSegment[]`). Do not produce rooms. Do not integrate with Stage 5. Evaluate against three gates (wall count, shared-EP, recall). If the spike passes, open a separate scoping pass for "Path B → Stage 5 polygon adapter" as a full 1–2 week workstream.

### Q6 — Algorithm choice for cycle enumeration

**Answer: planar face enumeration ("walk-around-next-CCW-edge"), implemented in-house. No suitable npm package.**

Options considered:

| Algorithm | Fit | Notes |
|---|---|---|
| **Planar face enumeration** (walk CCW edges around each vertex) | ★★★★★ | Requires planarity — guaranteed here by construction (walls are axis-aligned in the image plane). O(V + E). ~150 LOC in TS. |
| **Horton's min-cycle-basis** | ★★★ | O(V²E) — slow. Works on non-planar graphs we don't have. |
| **Geometric sweep-line** | ★★ | Needs ordered edges around each vertex — which planar face enum already computes. Redundant. |
| **BFS/DFS cycle finding per source** | ★★ | Finds cycles but NOT the minimum cycle set. Returns superset including enclosing rectangles. |

**Survey of npm packages** (checked `node_modules/` + npm search terms "planar graph", "min cycle basis", "face enumeration"):

- `graphlib` (Apache 2.0, 67 KB) — SCC, DFS, topological sort. **No face enumeration.**
- `ngraph.graph` + `ngraph.path` — pathfinding, no cycle basis.
- `graphology` — general-purpose, no planar-face tooling.
- `@turf/turf` — geospatial, has polygon ops but not graph-to-polygons.
- **No TypeScript-typed native-dep-free planar face enumeration package found.**

**Implementation sketch (~150 LOC, spike-grade):**
1. Input: `LineSegment[]` + an endpoint-clustering function (see Q3).
2. Build planar graph: vertex = cluster of endpoints within 8 px; edge = segment.
3. For each vertex v, sort outgoing edges by angle (clockwise).
4. For each directed edge (v → w), "next face edge" = (w → next CCW neighbour of v-from-w). Walk until we return to (v → w), collecting the face.
5. Drop the outer face (largest, or: the face whose vertices are on the outer bounding box).
6. Return the remaining faces as polygons.

Effort: **1–1.5 days** to implement + unit test on the 3 synthetic ground-truth cases. Minimum effective library size: zero (all in-house).

### Q7 — Library + bundle size audit

**Answer: no additional runtime dependencies. Total Vercel bundle impact from Path B: effectively 0.**

Current spike/app dependencies relevant to Phase 3.0:

| Package | On-disk `node_modules/` size | Runtime WASM/JS shipped |
|---|---:|---:|
| `@techstark/opencv-js` | 13 MB | WASM ~8–9 MB + JS wrapper |
| `tesseract.js` | 1.6 MB | Core JS + downloaded eng.traineddata (~4 MB, fetched on first run) |
| `sharp` | 816 KB | Native binding — server-only |
| **Path B additions (proposed)** | | |
| Planar-face enumeration (in-house) | 0 | ~5 KB JS |
| `polygon-clipping` (IF we go with Option B of Q5) | ~30 KB | pure JS |

Vercel Pro limit: 250 MB unzipped. Current floor-plan-related bundle (rough estimate based on the three above): ~25 MB. Plenty of headroom.

**No GitHub-sourced native deps** (Vercel incompatible). No Rust-compiled JS. No PyPI-sourced WASM.

### Q8 — Test corpus for the spike

**Answer: corpus needs 3–4 additions to cover Path B's failure modes.**

Current 10 real images are **all rectangular plots, all 25×30 to 80×60 ft, all 3/4/5-BHK+studio Indian residential**. Path B's algorithmic surface has more failure modes than this covers.

**Gaps + proposed additions:**

| # | Gap | Proposed prompt | Why it matters |
|---|---|---|---|
| 11 | L-shaped plot | "3BHK 40×40 L-shaped plot, south-facing, courtyard at SE corner" | Exercises alpha-shape rescue (Q4); tests that bounding-box adapter (Q5 Option A) loses accuracy where a polygon adapter would retain it. |
| 12 | Plot with internal courtyard | "5BHK 60×60 villa with central open courtyard" | Minimum-cycle should emit **2+ disconnected polygon sets** (exterior + courtyard). Tests whether the filter handles non-simply-connected regions. |
| 13 | Single-room studio | "Studio 20×25 no partitions" | Minimal-cycle case — the only polygon IS the exterior. Tests the exterior-rescue path when no interior walls exist. |
| 14 | Diagonal / chamfered corner | "3BHK 40×40 with 45° chamfer at NE corner (vastu)" | Tests whether axis-aligned grid-snap is a Path B blocker on non-orthogonal plans (probably yes — this is a known-hard case worth flagging). |

Cost: ~4 × $0.034 = **$0.14 in OpenAI credits** to generate. Cheap.

Note: generation is deterministic-enough (temp 0 image model) that regeneration across spike iterations is stable. Keep the PNGs in `experiments/outputs/phase-3-0/path-b/` so re-running doesn't blow the OpenAI bill.

---

## 5. Risk table (ranked by severity)

| # | Risk | Severity | Probability | Mitigation |
|---|---|---|---|---|
| 1 | Stage 5 polygon-adapter is multi-week work that nobody has scoped (§4 Q5) | **Critical** | Certain | Spike Path B as a wall-list filter only; defer adapter to a second spike; do not promise Phase 3.0 in 5–6 weeks — quote **7–9 weeks**. |
| 2 | Endpoint scatter is too wide for cycle enumeration to find rooms on real images (§3.3, Q3) | **High** | Medium-High | Two-resolution approach: wall coords stay at 16 px, graph vertices cluster at 8 px. Gate the spike on measured shared-EP ≥ 0.75 *after* Path B filter. |
| 3 | Door-arc chords are indistinguishable from wall segments by cycle criteria alone (§3.1 Q1) | **High** | Medium | Use Hough-Circle detection inside gap regions (Q2 Pass B) OR insist on minimum-wall-length ≥ 40 px AFTER cycle-filter. Accept that some arcs close short 4-segment "rooms" (door frame boxes) — handle with a minimum-area polygon filter (≥ 12 sqft, matching Phase 2.8 B2). |
| 4 | Doorway bridging merges unrelated rooms (§4 Q2) | Medium-High | Medium | Start with 32 px bridge; only lift to 48 px with door-arc detection confirming a door in the gap. Track merge count as a diagnostic — if > 0 on a test case, treat as spike failure. |
| 5 | Exterior perimeter misses on plots with courtyards/setbacks (§4 Q4) | Medium | Medium | Alpha-shape rescue (~100 LOC) instead of convex hull. In-scope for the full Phase 3.0 build; OUT of scope for the 4-day spike (which stays convex-hull only). |
| 6 | Bundle size bloat if we add extra geometry libraries (§4 Q7) | Low | Low | In-house implementation; no new deps. Already <30 MB of Phase-3 bundle vs 250 MB budget. |
| 7 | Spike runtime regression (cycle enumeration adds 50–100 ms per image) | Low | Low | Existing Pipeline B budget is 150 ms; cycle enum O(V+E) on ≤100 vertices is sub-10 ms. No real risk. |
| 8 | Test-corpus drift: the 10 current images' GPT-Image-1 renders change if we regenerate (§4 Q8) | Low | Low | Keep the PNGs checked in under `experiments/outputs/phase-3-0/`. Spike reads the files; never re-invokes OpenAI unless `--regenerate` is passed. |
| 9 | Text-mask step interacts with polygon closure unexpectedly (text-mask exposes arc pixels — Section 4.0 of sub-spike) | Low | Medium | Run Path B WITHOUT text masking for the spike. Keep text-mask for production UX polish only — it doesn't help accuracy and, per sub-spike §4.0, can briefly *hurt* wall count by a few segments by exposing arc/symbol pixels. |

---

## 6. Proposed Path B spike plan

### 6.1 Branch name

`experiment/phase-3-0-path-b-filter`

Branch from `experiment/phase-3-0-text-masking` (so text-mask lib stays available if needed for later combination, but NOT in the Path B pipeline).

### 6.2 Commit breakdown

The sub-spike precedent (`3e2edd0 / 98c73e8 / a3d3f90`) is 3 granular commits. Match that cadence:

1. **`spike(phase-3-0): planar face enumeration + endpoint clustering (1/4)`**
   Files: `src/features/floor-plan/experiments/phase-3-0/lib/planar-faces.ts` (~150 LOC) + `src/features/floor-plan/experiments/phase-3-0/__tests__/planar-faces.test.ts`. Unit test against the 3 synthetic ground-truth cases from `synthetic.ts`. Pass criteria: every GT room polygon is enumerated.

2. **`spike(phase-3-0): pipeline-b-cycle — polygon filter composed on Pipeline B (2/4)`**
   Files: `src/features/floor-plan/experiments/phase-3-0/pipelines/pipeline-b-cycle.ts` (~100 LOC — delegates to `runCVPipelineB`, builds planar graph with 8 px vertex clustering + 32 px doorway bridging, enumerates faces, drops segments not on any face, returns the filtered `LineSegment[]`).
   Wire a new `npm run spike:3-0-pb` script that runs it on all 10 real images + the 3 synthetic + the 4 proposed new cases (§4 Q8).

3. **`spike(phase-3-0): pipeline-b-cycle — outputs + metrics on 14-image corpus (3/4)`**
   Run the spike end-to-end. Write per-image:
   - `_01-input.png` (copy of source)
   - `_02-walls-raw.png` (Pipeline B overlay without filter)
   - `_03-graph.png` (planar graph visualisation: vertices + edges)
   - `_04-cycles.png` (enumerated polygons, coloured by cycle index)
   - `_05-walls-filtered.png` (Pipeline B output restricted to cycle-edges)
   - `_06-comparison.png` (2×2: input / raw / cycles / filtered)
   Metrics to write to `metrics.json`: wall count before / after, shared-EP before / after, cycles-enumerated count, expected room count, per-case pass/fail vs gates in §6.3.

4. **`spike(phase-3-0): path-b filter sub-spike report (4/4)`**
   File: `docs/phase-3-0-path-b-filter-spike.md` with verdict (GO / CONDITIONAL / NO-GO) and the per-case table. Follow `docs/phase-3-0-text-masking-spike.md` as the structural template.

### 6.3 Success gates (tighter than text-masking gates)

All three must hold on **≥ 7 of the 14 corpus images** for CONDITIONAL-GO, **≥ 10 of 14** for full GO:

- **Wall-count band:** `|wallsAfter − GT| / GT ≤ 0.15` (15 % — tighter than text-masking's 25 %)
- **Shared-EP ratio (after filter):** `sharedEndpointRatio ≥ 0.75` — reflects Path B's promise of endpoints actually coinciding
- **Recall proxy:** `recallAfter ≥ 0.85` — every remaining wall must correspond to a real wall, but we also need to keep most real walls. Tighter than text-masking's 0.70.

**On synthetic ground-truth cases:** F1 ≥ 0.85 (matches Pipeline B's own synthetic gate).

### 6.4 Circuit-breaker

**Abort the run and write a partial failure report if > 3 of the first 10 processed images FAIL all three gates.** Matches the text-masking spike's 5-fail circuit-break, calibrated tighter because Path B is a smaller delta.

On abort, the report must still include:
- Per-case metrics up to the failure point.
- Per-case "why failed" diagnostic — which gate, by how much, and the specific visible symbol (door arc / window pair / frame / etc.) that caused the failure.

### 6.5 Effort estimate with confidence interval

- **Day 1:** planar-face enum + endpoint clustering + unit tests on synthetic (Commit 1).
- **Day 2:** `pipeline-b-cycle.ts` + bridging pass + visualisation outputs (Commit 2).
- **Day 3:** run on 14-image corpus + diagnostic iteration (Commit 3).
- **Day 4:** write spike report + rubber-duck verdict (Commit 4).

**Nominal: 4 engineering days. Confidence: medium-high for days 1–2 (standard algorithms), lower for day 3 (empirical tuning of `VERTEX_CLUSTER_EPS` and `BRIDGE_LEN_MAX` may consume another 0.5–1 day).**

**Honest range: 4–6 days.** Budget 6 and be pleasantly surprised.

### 6.6 Out-of-scope for THIS spike

Explicitly defer these to a second spike (`experiment/phase-3-0-path-b-integration`) if Path B's filter-only spike passes:

- Polygon → `ExtractedRoom` adapter of any kind.
- OCR room-label assignment inside polygons.
- Door / window placement derived from cycle-filtered walls.
- Stage 5 polygon support (multi-week refactor, separate workstream).
- Alpha-shape exterior rescue (convex hull is enough for the spike corpus).
- Non-axis-aligned walls (chamfered corners, 45° plots).

---

## 7. If NO-GO after the spike: which Path is better?

If Path B's filter-only spike fails ≥ 4 of 14 on the three gates:

### 7.1 Recommend: Path A (symbol-suppression stack)

Path A from the sub-spike's §8:
- Step 0a: text-mask (already built this branch — keep it).
- Step 0b: Hough Circle door-arc detection + mask (well-understood, ~2 days).
- Step 0c: window-pair detection (parallel short-line pairs on exterior, ~1 day).
- Step 0d: connected-component filter — reject components with aspect < 0.3 OR total length < 30 px (~0.5 day; cheap symbol-stencil kill).

**Why I'd recommend A over C (Raster-to-Graph fine-tune):**

1. **Zero ops lift.** Path A stays in the Node.js world we already run. No Modal.com, no Python microservice, no inference-endpoint monitoring, no ML-Ops labour. Existing team skill set + `autosendjs` / Upstash / Sentry apparatus covers it.
2. **Output-contract preserved.** Path A still produces `LineSegment[]` in the same shape as Pipeline B. Pairs trivially with the existing Vision Stage 4 (GPT-4o) or a simplified tesseract-inside-bounding-box fallback. **Stage 5 doesn't change at all.**
3. **Cost per image stays sub-cent.** Path C's Raster-to-Graph would add $0.005–0.015 per inference call on a medium Modal GPU (rough estimate; depends on batch size). Path A is pure local compute.
4. **Upper bound of Path A is acceptable.** The research agent's estimate was "60–75 % door-arc detection ceiling". On a 7-door plan that's still ~5 of 7 doors placed correctly. Path C's ceiling estimate was 75–85 % — better on paper, but the Ops overhead negates the lift unless we're already running Modal for something else (we aren't).

### 7.2 Honest dissent on Path C

Path C (Raster-to-Graph fine-tune) is the technically more exciting option and would likely produce the best single-metric accuracy. But:

- It moves floor-plan intelligence out of the Node.js codebase and into a Python+Modal microservice. Operationally, that's a step-function in complexity — monitoring, cost-attribution, cold-start latency, model-version drift, training-data rot.
- Labelling 200–500 images with per-wall polygons is itself a 1–2 week distraction. The team has no labelling pipeline today.
- The 75–85 % ceiling is an estimate. Ceiling *claims* on LLM/ML pipelines in this domain have historically been 10–15 points optimistic (see Phase 2.9's initial estimates vs. what the hybrid actually delivered).

**If Path A also fails, THEN pivot to Path C** — at that point we'd have evidence that the classical-CV ceiling is genuinely below our accuracy bar and the ML ops cost is justified.

### 7.3 Other options considered & rejected

- **Phase 2.10 (patch existing GPT-4o extraction)** — stated in parent spike report as "patches Phase 2.9's known failure modes but leaves the structural ceiling at ~75/100". A reasonable placeholder but doesn't move the needle on the 90 %+ accuracy target the user cares about (memory: `feedback_accuracy_priority.md`).
- **Heuristic CC-based text detection** (sub-spike §5) — listed as a text-masking alternative. Irrelevant to the symbol-noise problem that actually dominates.
- **EasyOCR Python microservice** — same ops cost as Path C without the accuracy ceiling argument. Not recommended.

---

## 8. Summary table for decision-making

| Option | Scope | Time | Ops lift | Accuracy ceiling (est.) | Output-contract change | Spike commitment |
|---|---|---|---|---|---|---|
| **Path B filter-only spike** (RECOMMEND) | Wall-list filter via cycle enumeration | 4–6 days | None | ~85 % on real-image walls | None (spike) | **4–6 days** |
| Path B full (incl. Stage 5 polygon support) | Room-level polygon extraction + Stage 5 refactor | 7–9 weeks | Low | ~85–90 % rooms+walls | Yes (Stage 5 rewrite) | Gated on filter-only spike |
| Path A (symbol suppression) | Arc + window + CC filters on Pipeline B | 4–5 weeks | None | ~75–80 % rooms | None | Ready if Path B fails |
| Path C (Raster-to-Graph fine-tune) | Modal.com Python ML pipeline | 4–6 weeks including labelling | High | ~75–85 % rooms | Yes (new service) | Last-resort fallback |

---

## 9. Recommended next action

1. **Rutik approval** on the conditional-GO for the 4–6 day Path B filter-only spike (section 6). No code until approval.
2. **No new branch, no commits** until that sign-off.
3. After sign-off: follow the 4-commit plan in §6.2 on branch `experiment/phase-3-0-path-b-filter`. Per `feedback_no_auto_push.md` I will commit but not push; user pushes manually.
4. If the spike passes (§6.3): open a fresh scoping doc for the Path B → Stage 5 polygon-adapter workstream (estimated 3–4 more weeks on top of the spike).
5. If the spike fails (§6.4): pivot to Path A per §7.1. Scope that in a separate doc.

---

## 10. Appendix — where to look for follow-up

- **Raw per-case metrics (parent spike, 10 images):** `experiments/outputs/phase-3-0/metrics.json`
- **Raw per-case metrics (text-masking sub-spike, 5 images):** `experiments/outputs/phase-3-0/text-masking/metrics.json`
- **Best visual example of Path B's challenge:** `experiments/outputs/phase-3-0/text-masking/real-04-5bhk-80x60-luxury-villa_05-walls-after.png` (55 segments, 11 doors, 7 windows — the worst case).
- **Stage 5 rectangle contract:** `src/features/floor-plan/lib/vip-pipeline/stage-5-fidelity.ts` lines 172–305 (`deriveWalls`) and `src/features/floor-plan/lib/strip-pack/types.ts` lines 19–25 (`Rect`).
- **Pipeline B internals (thinning, merge, snap):** `src/features/floor-plan/experiments/phase-3-0/cv-pipeline-b.ts`.
- **Test harness precedent:** `scripts/run-phase-3-0-text-masking-spike.ts` (referenced by `package.json` script `spike:3-0-tm`; use as template for `run-phase-3-0-path-b-spike.ts`).
