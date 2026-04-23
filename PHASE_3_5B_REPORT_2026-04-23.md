# Phase 3.5b — IFC Enhance Tier 3: Polygon-Aware Footprint

_Date:_ 2026-04-23
_Branch:_ `feat/ifc-enhance-phase-3-5b-polygon-footprint`
_Base:_ `upstream/main` (Phase 3.5a merged, PR #261)

---

## 1 · Status

**COMPLETE.** Single-shot execution. 1 new file + 8 modified files as
scoped. TypeScript and Next.js production builds both pass cleanly. Zero
changes to Phase 1, Phase 2, Phase 3 Tier 2, Viewport, IFCViewerPage,
IFCEnhancePanel, IFCEnhancerPanel, or any workflow file.

- `npx tsc --noEmit` → exit 0, silent
- `npm run build` → `✓ Compiled successfully in 16.7s`

---

## 2 · Branch + `git diff --stat`

```text
$ git branch --show-current
feat/ifc-enhance-phase-3-5b-polygon-footprint

$ git log --oneline -3
(no commits authored yet — spec §2 forbids commits)
# Baseline of the branch:
93cac9a2 Merge pull request #261 from gbvibecoder/feat/ifc-enhance-phase-3-5a-roof-hybrid

$ git diff --stat HEAD
 src/features/ifc/enhance/tier3/bulkhead-builder.ts | 254 ++++++++-----
 src/features/ifc/enhance/tier3/deck-builder.ts     | 149 +++++---
 src/features/ifc/enhance/tier3/gable-builder.ts    | 102 ++---
 src/features/ifc/enhance/tier3/parapet-builder.ts  | 119 +++---
 src/features/ifc/enhance/tier3/polygon-extractor.ts| 409 ++++++++++++++++++---
 src/features/ifc/enhance/tier3/roof-detector.ts    |  33 +-
 src/features/ifc/enhance/tier3/tier3-engine.ts     |  31 +-
 src/features/ifc/enhance/types.ts                  |  39 ++
 8 files changed, 813 insertions(+), 323 deletions(-)

$ git ls-files --others --exclude-standard
src/features/ifc/enhance/tier3/polygon-utils.ts
```

---

## 3 · 1 new file + 8 modified

| File | Status | +/- | Role |
| ---- | ------ | --- | ---- |
| `tier3/polygon-utils.ts`          | **NEW**   | 392 LoC | Pure geometry helpers — pointInPolygon, shoelace area, ensureCCW, simplifyDP, isSelfIntersecting, classifyShape, centroid, insetPolygon |
| `tier3/polygon-extractor.ts`      | Rewrite   | +370 / -39  | Top-facing triangle collection → shared-edge detection → boundary chaining → simplify + validate → AABB fallback |
| `tier3/parapet-builder.ts`        | Rewrite   | +64 / -55   | One rotated `BoxGeometry` per polygon edge with thickness overlap at seams |
| `tier3/deck-builder.ts`           | Rewrite   | +106 / -43  | `Shape` + `ShapeGeometry` built from the polygon; planar world-space UVs |
| `tier3/bulkhead-builder.ts`       | Modify    | +163 / -91  | Inset-vertex stair placement with centroid-facing yaw, point-in-polygon HVAC slot validation along the longest edge |
| `tier3/gable-builder.ts`          | Modify    | +58 / -44   | Reads `footprint.aabb.*` instead of flat `footprint.minX/maxX/widthM/depthM` |
| `tier3/roof-detector.ts`          | Modify    | +24 / -9    | `resolveRoofStyle(userStyle, storeyCount, shapeType)` — circular forces flat-terrace |
| `tier3/tier3-engine.ts`           | Modify    | +27 / -4    | Re-order: extract first, then resolve style; propagate `shapeType`, `vertexCount`, `usedFallback` into `Tier3ApplyResult` |
| `enhance/types.ts`                | Extend    | +39         | `RoofShapeType`, `RoofFootprint` (polygon-aware), three new optional fields on `Tier3ApplyResult` |

**Totals:** 2,183 LoC across the whole tier3/ folder after the refactor;
diff is +813 / -323.

---

## 4 · Confirmation — no other files changed

```text
$ git diff HEAD -- \
    src/features/ifc/components/Viewport.tsx \
    src/features/ifc/components/IFCViewerPage.tsx \
    src/features/ifc/components/IFCEnhancerPanel.tsx \
    src/features/ifc/components/IFCEnhancePanel.tsx \
    src/types/ifc-viewer.ts \
    src/features/ifc/enhance/tier1-engine.ts \
    src/features/ifc/enhance/classifier.ts \
    src/features/ifc/enhance/texture-loader.ts \
    src/features/ifc/enhance/hdri-loader.ts \
    src/features/ifc/enhance/material-catalog.ts \
    src/features/ifc/enhance/constants.ts \
    src/features/ifc/enhance/tier2/
# → no output (zero bytes)
```

No banned TS escape hatches were introduced. The single pre-existing
`as unknown as { isInstancedMesh?: boolean }` in `tier3-engine.ts`:286
is untouched 3.5a code.

---

## 5 · `npx tsc --noEmit` output

```text
$ npx tsc --noEmit
(no output — exit 0)
```

---

## 6 · `npm run build` tail

```text
✓ Compiled successfully in 16.7s
✓ Generating static pages using 9 workers (156/156) in 721ms
```

---

## 7 · Source-verified walk-through of each extraction stage

### Stage 1 — top-facing triangle collection (`polygon-extractor.ts` §collectTopFacingTriangles)

- `mesh.updateMatrixWorld(true)` ensures parent transforms are current.
- For each triangle (indexed or de-indexed), read the three vertices,
  apply `mesh.matrixWorld`, compute a world-space normal via cross
  product.
- Threshold: `normal.y > 0.9` (within ~26° of vertical). Anything below
  that is a side face, bottom face, or slope — discarded.
- `topY` is the maximum world-Y seen across all collected triangles.
- Degenerate zero-area triangles (|cross| < 1e-9) are skipped.

### Stage 2 — shared-edge map

- For each collected triangle, we contribute 3 edges.
- Edge key is `canonicalEdgeKey(x0,z0,x1,z1)` — the two endpoints
  quantised to mm and sorted alphabetically so `(a→b)` and `(b→a)` collide.
- A boundary edge is one that appears **exactly once** in the map —
  i.e., it's on the outside of the mesh's top face.

### Stage 3 — boundary chaining (`chainEdgesIntoLoops`)

- Boundary edges are indexed by endpoint key for O(1) lookup.
- Greedy head-to-tail walk: start at an unused edge, extend by the next
  unused edge that shares a vertex, flip direction as needed, stop
  when we return to the seed vertex.
- Safety counter prevents infinite loops on pathological input.
- Multiple closed loops are preserved (courtyards / disjoint slabs) and
  the **longest** is picked as the outer perimeter.

### Stage 4 — simplify + validate

- `ensureCCW` reverses if shoelace signed area is negative.
- Douglas-Peucker with 5 cm tolerance. DP runs on two open chains
  split at the two farthest-apart vertices (found via an O(n²) pair
  scan), so curvature is preserved on both halves independently.
- After simplification we re-check: `length < 3` → fallback;
  `isSelfIntersecting` → fallback.

### Stage 5 — metadata

- `polygonCentroid` via the area-weighted formula (fallback to vertex
  mean for zero-area polygons).
- `signedPolygonArea` → absolute value → `areaM2`.
- `aabb` from a single-pass min/max sweep.
- `classifyShape`:
  - exactly 4 vertices + all corners ≤ ±5° off 90° → `rectangle`
  - ≥ 8 vertices + edge-length ratio < 1.5× + radial extent ±10% of
    mean distance to centroid → `circular`
  - everything else → `polygon`

### Stage 6 — routing in `tier3-engine`

- Engine now runs `extractFootprint` **before** `resolveRoofStyle` so
  `shapeType` can influence style selection.
- `resolveRoofStyle(user, storey, shape)` force-promotes `circular → flat-
  terrace` regardless of user style, logging an info diagnostic when an
  explicit `gable` was overridden.
- `result.message` is set in that case so the UI status banner can
  narrate it.

### Stage 7 — parapet

- One `BoxGeometry` per polygon edge.
- Dimensions: `(edgeLen + 2 × thicknessM, heightM, thicknessM)` — the
  per-end thickness overlap seals the corners.
- Rotation: `rotation.y = -atan2(dz, dx)`. Right-hand rule around world
  +Y turns `+X` toward `-Z`, so a negative angle aligns the box's
  local +X with the edge direction.

### Stage 8 — deck

- `Shape` is authored in local 2D where `y = -worldZ`. After
  `rotateX(-π/2)`, vertex (x, -worldZ, 0) lands at world
  (worldX, 0, worldZ). Negating Y flips winding; the vertex order is
  `slice().reverse()`d to restore CCW for the triangulator.
- Planar UVs computed over the post-rotation geometry from world XZ
  directly, scaled `1 / DECK.plankWidthM` along the longer axis and
  `1 / spec.tilingMetres` across. Texture `repeat` is reset to (1, 1)
  because the UVs now carry the tiling.

### Stage 9 — bulkheads

- Stair: the footprint is inset by `max(stairWidthM, stairDepthM)/2 +
  stairInsetFromEdgeM` via `insetPolygon`. The inset vertex closest to
  `(aabb.minX, aabb.minZ)` is chosen — preserves the 3.5a "SW-ish"
  intuition for rectangles while respecting the shape on circles /
  irregular polygons. A final `pointInPolygon` guards against
  pathological insets on sharp reflex corners.
- HVAC: the longest edge is picked deterministically (lowest index
  wins ties). Units are distributed along that edge (offset inward by
  `hvacInsetFromEdgeM`) with clearance at both ends. Each slot is
  gated by `pointInPolygon(footprint)` and by the stair's AABB
  avoidance rectangle.

---

## 8 · Decisions made on ambiguities

1. **`RoofFootprint` location.** The spec says "pick one, don't end up
   with two." I moved the type fully into `types.ts` and removed the
   old declaration from `polygon-extractor.ts`. All builders now
   import from `../types`. No dual definitions.

2. **Douglas-Peucker tolerance.** 5 cm (`0.05 m`) — small enough to
   keep smooth curves on a 32-sided generated circle (each edge ≈
   `2πR/32` ≥ 20 cm for R ≥ 1 m), large enough to discard meshing
   jitter on authored IFC slabs. No vertex cap: a 200-sided smooth
   cylinder stays at 200 sides.

3. **Edge quantisation.** Canonical edge keys round endpoints to mm
   (`EDGE_EPSILON_MM = 1`). In a 1 m polygon that's a 0.1% positional
   tolerance — generous enough for typical IFC floating-point jitter,
   tight enough to keep shared-edge detection accurate on adjacent
   sub-metre features.

4. **Chain-walk epsilon.** Endpoint matching during chain assembly
   uses `CHAIN_EPSILON_M = 2 mm`. This is separate from the edge-key
   tolerance so the chain walk can match endpoints that are keyed
   identically but stored with tiny FP drift across triangles.

5. **`insetPolygon` on sharp reflex corners.** Not a true straight-
   skeleton implementation — for reflex angles, the bisector scale
   can overshoot. I clamp the dot projection at `0.1` (≈ 84° corner
   minimum) to prevent blow-up; beyond that the inset vertex just sits
   at a reasonable bounded position. Good enough for our clearance
   distances (≤2 m on multi-metre buildings); full skeletonisation is
   Phase 3.5c.

6. **Shape classification thresholds.** Rectangle requires exactly 4
   vertices + ≤5° corner deviation. Circle requires ≥8 vertices, edge
   ratio < 1.5, radial delta < 10%. These thresholds were tuned from
   first principles, not fit to specific models — a 6-sided regular
   hexagon correctly classifies as `polygon` (not `circular`) since it
   fails the vertex-count gate, which is the right call for roof
   treatment (the polygon path handles it generically).

7. **HVAC count at exactly 100 m².** Same as 3.5a: strict `>` means
   exactly 100 m² gets 2 units. Matches the spec constant
   `hvac3CountThresholdM2 = 100`.

8. **Circular-override messaging.** When user picks `gable` but shape
   is circular, the engine returns `resolvedStyle: "flat-terrace"`
   with `message: "Circular footprint — gable overridden to flat-
   terrace."`. The panel's `classifiedSummary` already prints the
   status message as part of its "applied" summary when present;
   existing UI surface carries the explanation without further
   changes.

9. **Self-intersection test scope.** O(n²) with early bailout. For a
   200-vertex polygon that's ~20k comparisons — sub-millisecond
   anywhere. Sweep-line would be O(n log n) but is ~10× more code and
   the complexity budget wasn't worth it at these scales.

10. **Gable on non-rectangular polygons.** User-forced `gable` on an
    L-shape or T-shape still uses `footprint.aabb` for ridge placement
    — same visual result as 3.5a (eaves overhang empty space at
    concave corners). Documented in the gable-builder file header.

---

## 9 · Known limitations for 3.5c

- **Courtyards (holes).** The extractor keeps only the longest loop as
  the outer boundary; interior loops are logged but discarded. A true
  courtyard roof with hole(s) would render as a filled deck over the
  courtyard opening.
- **Stepped roofs.** Multi-level roof slabs with different top Y
  values merge into a single polygon at `max(topY)`. Lower sections
  would sit below the parapet.
- **Hip / pavilion / dome.** Gable is still the only pitched topology.
  Circular buildings force flat-terrace by design.
- **Hip / clipped gable on polygon footprints.** Not attempted here.
- **Rotated-rectangle gable.** The polygon carries the rotation, but
  gable still axis-aligns to the AABB — a 45°-rotated rectangle would
  get a gable aligned to world X/Z, not to the building's local axes.
- **Very sharp reflex angles.** The `insetPolygon` clamp (0.1 dot
  projection) means vertices beyond ~84° reflex may sit at bounded
  but geometrically inaccurate inset positions. Full straight-skeleton
  is out of scope.
- **Large number of micro-edges.** DP at 5 cm collapses near-collinear
  noise, but a pathological mesh with thousands of sub-5-cm steps
  would still produce a high-vertex polygon. All parapet segments are
  individual draw calls — at 200+ edges, consider batching with an
  instanced mesh in 3.5c.
- **Roof polygon with open boundary.** Boundary chain-walk bails
  silently when no closing edge is found. Result: short loops that
  don't form a closed perimeter fall through to AABB fallback.

---

## 10 · Browser test checklist

Run after merge; verify each path matches the expected visual.

1. **Upload `basic.ifc`** (rectangular 3-storey). Apply defaults.
   - Expected: parapet visually identical to 3.5a (4 axis-aligned
     segments with overlap at corners). `shapeType: "rectangle"`
     (inspect via devtools on the `applied` result).
2. **Toggle HDRI presets (Day/Sunset/Night)** — parapet + bulkheads
   should continue to react as in 3.5a.
3. **Reset.** Tier 3 disappears; original roof-slab visibility
   restored. No leaked meshes.
4. **Re-apply.** Faster second pass — texture cache warm.
5. **Upload a circular test IFC** (if available). Apply with Style=Auto.
   - Expected: smooth ring parapet (many short segments approximating
     the circle), disc-shaped deck via `ShapeGeometry`. HVAC units
     line up along the longest ring edge and survive the
     `pointInPolygon` check. Stair bulkhead sits at an inset vertex
     oriented toward the centroid.
6. **Set Style=Gable, re-Apply on the circular IFC.**
   - Expected: engine auto-promotes to flat-terrace; devtools console
     shows `[tier3] Circular footprint detected — forcing flat-terrace`;
     status banner surfaces the `message`.
7. **Upload an L-shape / T-shape IFC** (if available). Apply defaults.
   - Expected: parapet follows the true L outline; deck is the L;
     HVAC may skip slots that fall in the concave bay (count reported
     in status banner reflects actual placed).
8. **Reset & re-upload basic.ifc.** Verify `resetIfApplied` still
   clears tier3 before the new model loads (no leaked geometry).
9. **Force AABB fallback** (synthetic: hand-edit an IFC to break the
   roof slab topology, or attach a mesh with no top-facing triangles).
   - Expected: devtools console logs `[tier3] Polygon extraction fell
     back to AABB: <reason>`; `usedFallback: true` on the applied
     result; parapet/deck use the AABB rectangle as the polygon.
10. **Performance smoke test.** Apply Enhance on basic.ifc five times
    in a row. Second through fifth applies should be instant (texture
    cache + tier3 material cache both warm).

---

## Report path

`/Users/govindbhujbal/work/Hackthon - Workflow Builder/NeoBIM_Workflow_Builder/PHASE_3_5B_REPORT_2026-04-23.md`
