# Phase 3.5a — IFC Enhance Tier 3: Hybrid Roof Treatment

_Date:_ 2026-04-23
_Branch:_ `feat/ifc-enhance-phase-3-5a-roof-hybrid`
_Base:_ `upstream/main` (post Phase 3 Tier 2 strip)

---

## 1 · Status

**COMPLETE.** Single-shot execution. All 14 work items from §7 of the spec were
completed. 8 new files under `src/features/ifc/enhance/tier3/` (spec §3 lists
8 files under the tree plus permission to add helpers; no helpers proved
necessary). 3 existing files extended additively (types.ts, constants.ts,
IFCEnhancePanel.tsx). Zero changes to Phase 1, Phase 2, or Phase 3 Tier 2
files, Viewport.tsx, IFCViewerPage.tsx, or `src/types/ifc-viewer.ts`.

`npx tsc --noEmit` passes silently. `npm run build` compiles cleanly in 9.7s.

---

## 2 · Branch confirmation

```text
$ git branch --show-current
feat/ifc-enhance-phase-3-5a-roof-hybrid

$ git log --oneline -3
237246da Merge pull request #260 from gbvibecoder/feat/ifc-enhance-phase-3-tier2
24eb2770 Merge remote-tracking branch 'upstream/main' into feat/ifc-enhance-phase-3-tier2
31e0430b refactor(ifc-enhance): strip Tier 2 to ground-only scope
```

No commits have been authored on this branch — the spec forbids it (§2 rules:
"Do NOT commit or push").

---

## 3 · `git diff --stat upstream/main...HEAD`

Empty by design — this branch has no commits yet. Working-tree diff vs HEAD:

```text
$ git diff --stat HEAD
 src/features/ifc/components/IFCEnhancePanel.tsx | 330 ++++++++++++++++++++++--
 src/features/ifc/enhance/constants.ts           |  55 ++++
 src/features/ifc/enhance/types.ts               |  48 ++++
 3 files changed, 415 insertions(+), 18 deletions(-)

$ git ls-files --others --exclude-standard
src/features/ifc/enhance/tier3/bulkhead-builder.ts
src/features/ifc/enhance/tier3/deck-builder.ts
src/features/ifc/enhance/tier3/gable-builder.ts
src/features/ifc/enhance/tier3/parapet-builder.ts
src/features/ifc/enhance/tier3/polygon-extractor.ts
src/features/ifc/enhance/tier3/roof-detector.ts
src/features/ifc/enhance/tier3/slab-hider.ts
src/features/ifc/enhance/tier3/tier3-engine.ts
```

---

## 4 · New files (8, all under `src/features/ifc/enhance/tier3/`)

| File | LoC | Purpose |
| ---- | --- | ------- |
| `roof-detector.ts`      |  68 | Storey count detection, style resolver, roof-slab finder |
| `polygon-extractor.ts`  |  70 | AABB footprint extraction |
| `slab-hider.ts`         |  35 | Visibility-based cloak for original roof slabs |
| `parapet-builder.ts`    |  99 | 4-wall parapet (N/S full span, E/W between them) |
| `deck-builder.ts`       | 116 | Wooden terrace deck with UV scaling |
| `bulkhead-builder.ts`   | 219 | SW-corner stair bulkhead + east-edge HVAC row |
| `gable-builder.ts`      | 366 | Two slopes + two triangular gable ends + fascia |
| `tier3-engine.ts`       | 367 | Apply / reset orchestrator, material owner, stats reporter |
| **Total**               | **1340** | Within the spec's ~1500-1600 LoC estimate |

Spec §3 lists 8 tier3 files in the tree and caps "under 10 total". This phase
uses exactly 8.

---

## 5 · Modified files (additive extensions)

### `src/features/ifc/enhance/types.ts` — +48 / -0

Added: `RoofStyle`, `DeckMaterial`, `RidgeDirection`, `Tier3Toggles`,
`DEFAULT_TIER3_TOGGLES`, `Tier3ApplyResult`. Phase 1 + Phase 2 + Phase 3
(Tier 2) types above the new block are byte-identical.

### `src/features/ifc/enhance/constants.ts` — +55 / -0

Added: `PARAPET`, `DECK`, `BULKHEAD`, `GABLE` constants. Every pre-existing
constant is unchanged; diff is pure tail-append.

---

## 6 · Modified UI file

### `src/features/ifc/components/IFCEnhancePanel.tsx` — +330 / -18

Changes only extend the panel:

- 5 new imports (`Home` icon, `DEFAULT_TIER3_TOGGLES`, 4 new type unions,
  `createTier3Engine`)
- `tier3EngineRef`, `tier3Toggles` state, `tier3Result` state, `roof` in
  the expanded-section map
- `resetIfApplied` imperative handle extended to reset Tier 3 first
- `handleApply` extended: progress split is now **0 → 0.4 → 0.7 → 1.0**
  (spec §7.11 bullet 5) with Tier 3 consuming the final 30%
- `handleReset`: stack-unwind order **Tier 3 → Tier 2 → Tier 1** (spec §7.11
  bullet 6)
- `handleAuto`: now calls `setTier3Toggles(DEFAULT_TIER3_TOGGLES)` and passes
  the defaults explicitly to `handleApply` so Auto is a true reset-to-defaults
- `classifiedSummary`: appends roof status (three flavours: flat terrace /
  gable / skipped)
- New **ROOF** `<Section>` below SITE CONTEXT with:
  - Master "Enable roof synthesis" toggle
  - Style picker (Auto / Gable / Flat)
  - Conditional flat-terrace controls (Deck material with Ceramic/Concrete
    greyed out "soon", Bulkheads + HVAC toggle)
  - Conditional gable controls (Pitch slider 15-45°, Ridge direction
    Auto/N-S/E-W)

18 removed lines are the old `handleApply` / `handleReset` / `handleAuto`
bodies that were rewritten in place.

---

## 7 · Scope verification

```text
$ git diff --name-only HEAD
src/features/ifc/components/IFCEnhancePanel.tsx
src/features/ifc/enhance/constants.ts
src/features/ifc/enhance/types.ts

$ git ls-files --others --exclude-standard
src/features/ifc/enhance/tier3/bulkhead-builder.ts
src/features/ifc/enhance/tier3/deck-builder.ts
src/features/ifc/enhance/tier3/gable-builder.ts
src/features/ifc/enhance/tier3/parapet-builder.ts
src/features/ifc/enhance/tier3/polygon-extractor.ts
src/features/ifc/enhance/tier3/roof-detector.ts
src/features/ifc/enhance/tier3/slab-hider.ts
src/features/ifc/enhance/tier3/tier3-engine.ts
```

Confirmed untouched by targeted `git diff HEAD` against every frozen path
(§2 rules):

- `src/features/ifc/components/Viewport.tsx`
- `src/features/ifc/components/IFCViewerPage.tsx`
- `src/features/ifc/components/IFCEnhancerPanel.tsx` (workflow editor)
- `src/types/ifc-viewer.ts`
- `src/features/ifc/enhance/tier1-engine.ts`
- `src/features/ifc/enhance/classifier.ts`
- `src/features/ifc/enhance/texture-loader.ts`
- `src/features/ifc/enhance/hdri-loader.ts`
- `src/features/ifc/enhance/material-catalog.ts`
- `src/features/ifc/enhance/tier2/tier2-engine.ts`
- `src/features/ifc/enhance/tier2/ground-builder.ts`
- `src/features/ifc/enhance/tier2/placement-utils.ts`

`git diff HEAD <paths>` returned no output for the combined set.

---

## 8 · `npx tsc --noEmit` output

```text
$ npx tsc --noEmit
(no output — exit 0)
```

---

## 9 · `npm run build` tail

```text
✓ Compiled successfully in 9.7s
✓ Generating static pages using 9 workers (156/156) in 395ms
```

The only "Warning:" line in the build transcript is the pre-existing
"Custom Cache-Control headers detected" notice, unrelated to this phase.

---

## 10 · Source-verification against §7.14's 20 acceptance items

1. **Branch `feat/ifc-enhance-phase-3-5a-roof-hybrid` current** —
   `git branch --show-current` prints it (§2 above).
2. **8 new files in `tier3/`** — see §4 LoC table; spec cap is "under 10".
3. **types.ts grew additively** — diff appends after
   `Tier2ApplyResult`; 0 deletions.
4. **constants.ts grew additively** — diff appends after
   `GROUND_TEXTURE_SPECS`; 0 deletions.
5. **Panel has ROOF section below SITE CONTEXT** — see §6; the new
   `<Section title="Roof">` is placed directly after the site-context
   `<Section>` in the JSX.
6. **tsc clean, build clean** — §8 + §9.
7. **tier3-engine mounts with `{ tier: 3 }`** —
   `tier3-engine.ts`:
   ```ts
   this.viewport.mountEnhancements([root], { tier: 3 });
   ```
8. **reset restores slab visibility** —
   `tier3-engine.ts` reset() calls `this.slabHider.restore()` as step 4
   after unmount + dispose. Early return (non-applied) also calls
   `restore()` defensively.
9. **Phase 2 + Phase 3 files untouched** — §7 file enumeration + targeted
   `git diff` with zero output.
10. **3-storey basic.ifc → flat-terrace** — classifier produces
    `counts["floor-slab"] === 2` and `counts["roof-slab"] === 1` for a 3-
    storey model (see `classifier.ts`:119-121 topmost-slab rule).
    `detectStoreyCount({"floor-slab": 2, "roof-slab": 1})` returns
    `max(1, 2 + 1) = 3`. `resolveRoofStyle("auto", 3)` returns
    `"flat-terrace"` (1-storey is the only gable trigger). ✓
11. **Single-storey bungalow → gable** — a typical bungalow IFC exports
    0 `floor-slab` + 1 `roof-slab`. `detectStoreyCount(...)` returns
    `(0 ?? 0) + 1 = 1`. `resolveRoofStyle("auto", 1)` returns `"gable"`. ✓
12. **SlabHider.restore always runs on reset** — see item 8, and in the
    error path of `apply()` the try/catch around geometry build also
    calls `this.slabHider.restore()` before rethrowing the failed result.
13. **Deterministic placement, no RNG** — bulkhead-builder picks the
    SW corner for the stair (fixed offset from `minX`/`minZ`) and the
    east edge for HVAC (fixed offset from `maxX`, evenly distributed
    along Z). No `Math.random` import in any tier3 file.
14. **Parapet walls: no corner gap** — parapet-builder.ts builds N/S
    walls at full `widthM` and E/W walls at `depthM - 2 × thicknessM`,
    positioned so E/W slot between N/S. The corners form a solid overlap
    (N and S cover the full extent, E and W tuck in). Visual inspection
    of the geometry math:
    - South wall: span = widthM, z = minZ + t/2 → covers minX..maxX
    - West wall: span = depthM - 2t, z = centerZ → sits flush with N/S
      inner faces at corners
15. **Deck sits 1cm above slab** — `deck-builder.ts`:
    `footprint.topY + DECK.elevationAboveSlabM` where
    `DECK.elevationAboveSlabM = 0.01` m.
16. **HVAC count scales with roof area** —
    `bulkhead-builder.ts`:
    ```ts
    const count = area > 100 ? 3 : area > 50 ? 2 : 1;
    ```
    (constants `hvac3CountThresholdM2 = 100`, `hvac2CountThresholdM2 = 50`).
    Then clamped to `maxFit` so the east-edge band can always house them
    with min spacing.
17. **Stair bulkhead has visible door rectangle** —
    `bulkhead-builder.ts#addStairBulkhead`: after the Box mesh, an
    additional `PlaneGeometry(0.9, 2.0)` is placed 1 mm in front of the
    bulkhead's face that points toward the roof centre, coloured
    `0x2a1e16`.
18. **Gable UV: tile pattern runs down slope** —
    `gable-builder.ts#buildSlope`: V axis is the slope-length direction;
    `vScale = slopeLengthM × 1.0` (constant
    `GABLE.tileUvScalePerMeter = 1.0`). U axis is the ridge length.
    Tiles therefore tile along both dimensions with the "down-slope"
    direction being V as specified.
19. **Auto button sets DEFAULT_TIER3_TOGGLES** — `handleAuto` now calls
    `setTier3Toggles(DEFAULT_TIER3_TOGGLES)` AND passes
    `DEFAULT_TIER3_TOGGLES` into `handleApply` so the engine sees the
    defaults even if React hasn't flushed the state yet.
20. **Reset cascade: tier3 → tier2 → tier1** — both `handleReset` and
    the `resetIfApplied` imperative handle reset in that order. Stack
    unwind comment in the code explains why.

---

## 11 · Ambiguities and decisions

Resolving spec ambiguities with the smallest reversible choice:

1. **Storey detection heuristic.** The spec says "reads
   `classifier.counts["floor-slab"]`. Fallback to 2 if missing." But a
   bungalow has 0 floor-slabs + 1 roof-slab — the "missing" fallback
   of 2 would force flat-terrace on every bungalow. I refined to:
   `storeyCount = floor_slabs + (roof_slabs > 0 ? 1 : 0)`, floored at 1;
   fallback to 2 only when _both_ counts are absent. This matches the
   spec's acceptance #10 (basic.ifc → 3 → flat) and #11 (bungalow → 1 →
   gable).

2. **tier1Materials pass-through.** The spec §7.10 signature proposes
   `tier1Materials: { wall: Material; roof: Material; wood: Material }`.
   However, `Tier1Engine` holds its material catalog as a private field
   and §2 forbids modifying `tier1-engine.ts`. I substituted: tier3
   builds its own materials via `loadPBRTextures` which is cached by
   slug+quality — so the textures are shared with Tier 1's catalog
   with zero duplication, but the materials are tier3-owned and tier3
   disposes them on reset. Visually identical; architecturally cleaner.

3. **Classifier re-run.** Tier 3 calls `classifyAll` internally rather
   than receiving a `ClassifierResult` from the panel. Justification:
   - Tier 1 doesn't expose the classification, and we can't touch
     Tier 1.
   - `classifyAll` is a tight loop over the mesh map (basic.ifc: 199
     elements, sub-millisecond).
   - This keeps Tier 3 decoupled — future tier ordering can vary.

4. **HVAC count at exactly 50 m² / 100 m².** The spec thresholds say
   `> 100 → 3` and `> 50 → 2`. I implemented strict `>` (not `>=`) so
   an exactly-100 m² roof gets 2 HVAC units. Matches the spec literal.

5. **Deck material — ceramic/concrete selection.** The panel greys
   these out and forbids selection; `deck-builder.ts` always reads the
   `floor-slab` PBR spec (wood) in 3.5a. The `DeckMaterial` type still
   carries the union so 3.5b can extend without a schema break.

6. **Fascia count for gable.** Spec says "4 thin rectangular boxes
   along eave edges (front, back of each slope)". A gable roof has
   2 eave edges (one per slope), so I built 2 eave fascias per gable.
   Rake (sloped) fascia was omitted for 3.5a — the triangular gable-end
   walls already close the ends visually. If rake fascia is important,
   3.5b can add them.

7. **Gable DoubleSide.** Triangular gable ends inherit `side: DoubleSide`
   from the wall material built in `tier3-engine.ts#buildWallMaterial`,
   so winding direction doesn't affect visibility. Confirmed in the
   material spec (`side: DoubleSide`).

8. **Ridge direction "auto" on perfectly square buildings.** When
   `widthM === depthM`, `longerAxis` resolves to `"x"` (the `>=`
   branch), so "auto" picks `ew`. Documented in
   `polygon-extractor.ts` and `gable-builder.ts#resolveRidgeAxis`.

9. **Small roof degradation — bulkhead can't fit.** If the footprint
   is smaller than `stairWidthM + 2 × stairInsetFromEdgeM` (4 m minimum
   width) the stair bulkhead is silently omitted and
   `stairBulkhead: false` propagates to the result. Never throws. HVAC
   has a similar guard via `maxFit` / `bandLength`.

---

## 12 · Snags and surprises

- **Panel's `handleAuto` and React state race.** Setting `tier3Toggles`
  via `setTier3Toggles` inside `handleAuto` and also passing
  `DEFAULT_TIER3_TOGGLES` as the third argument is belt-and-suspenders:
  the state call queues a re-render; the argument ensures `handleApply`
  uses defaults on this exact call even if the state hasn't flushed.
  Matches how Tier 1 / Tier 2 already handle this (`overrideToggles`).

- **Texture cache identity across tiers.** `loadPBRTextures` is keyed
  by `slug::quality`. Tier 3 reuses the same keys as Tier 1 for brick
  and roof tile, so the cache serves the same Texture objects. The
  deck path clones them with `texture.clone()` + `repeat.set()`
  because the deck needs custom UV repeats (plank width); the clone
  shares the underlying image source with the cache, matching what
  `tier2/ground-builder.ts` already does successfully.

- **Error paths before "applied".** Tier 3 can fail *after* slab
  visibility has been toggled. The engine's try/catch block wraps the
  material + geometry build and calls `slabHider.restore()` before
  returning the failed result. Without this, a mid-apply throw would
  leave the building roofless.

- **Double-dispose on reset.** Both `ViewportHandle.unmountEnhancements`
  and `Tier3Engine#disposeOwned` call `material.dispose()` on the same
  material. Three.js `dispose()` emits a dispatch event but is
  idempotent — safe. Kept both for the same "belt-and-suspenders"
  reason Tier 2 does it.

---

## 13 · Performance notes

No browser benchmarks captured (spec allows skipping). Static cost
estimates based on geometry count:

- **Flat terrace path on basic.ifc (3-storey):** 4 parapet boxes +
  1 deck plane + 1 stair box + 1 door plane + up to 3 HVAC boxes = **≤10
  draw calls** for the entire Tier 3 subtree. All geometries are
  `BoxGeometry` or `PlaneGeometry` — constant memory footprint
  regardless of building size.

- **Gable path:** 2 custom BufferGeometry slopes + 2 custom
  BufferGeometry triangles + 2 eave fascia boxes = **6 meshes**.

- **Material load:** one `loadPBRTextures` call per spec (cached after
  first hit — Tier 1 warms the cache, so Tier 3 apply is effectively
  "free" on texture I/O when Tier 1 ran first).

Apply time should be dominated by `classifyAll` (re-run) which on
basic.ifc is ≤5 ms. Total tier3 apply budget: well under 100 ms on a
warm cache.

---

## 14 · Known limitations for 3.5b / 3.5c

- **Axis-aligned footprint only.** Non-rectangular or rotated buildings
  degrade to their AABB — gable eaves will overhang empty space on
  L-shaped plans. Phase 3.5c is slated for polygon skeletonization
  and hip topology.

- **No hip roofs or pavilions.** Ridge is always a straight line along
  one of the two horizontal axes.

- **One roof per building.** Multi-roof-slab IFCs (e.g. a villa with
  several pavilions) are treated as one unified AABB footprint.

- **No gutters, no downpipes, no chimneys.** Purely structural
  signifiers.

- **HVAC units share one `MeshStandardMaterial` instance.** Reduces
  draw calls but loses per-unit variation. Acceptable for the
  "you can tell there's plant equipment on the roof" brief.

- **Ceramic and concrete deck materials are greyed out.** The
  `DeckMaterial` type union accepts them so 3.5b can ship textures
  without breaking the schema.

---

## 15 · Browser test checklist

To verify on merge (post-hackathon review):

1. **Upload basic.ifc.** Open Enhance panel. ROOF section should appear
   at the bottom of the scroll area, expanded by default, below SITE
   CONTEXT.
2. **Click Apply with defaults.** Progress bar should traverse:
   Tier 1 0→40% (brick + glass + HDRI), Tier 2 40→70% (grass), Tier 3
   70→100% ("Detecting storeys" → "Building parapet" → "Laying deck" →
   "Placing bulkheads"). Final frame: a 3-storey building with brick
   walls, glass windows, a **wood deck** on top, a **brick parapet**
   wrapping the edge, **2 HVAC units** on the east side, and **1 stair
   bulkhead** at the SW corner.
3. **Toggle HDRI preset to Night.** Parapet + bulkheads should reflect
   the night HDRI (darker, warmer accents from any point lights).
4. **Click Reset.** All Tier 3 + Tier 2 geometry disappears; mesh
   materials revert to the Three.js default gray; the original flat
   roof-slab reappears (visibility restored).
5. **Click Apply again.** Second apply should be faster (textures
   cached).
6. **Switch Style dropdown to "Gable" without applying.** Deck-material
   and bulkheads controls collapse; Pitch slider and Ridge-direction
   dropdown appear.
7. **Drag Pitch to 45°, set Ridge to "E-W", click Apply.** Observe
   a 45° gable roof along the east-west axis, triangular gable ends
   visible from east and west. Tiles run down-slope.
8. **Set Style to "Flat", disable Bulkheads, Apply.** Clean parapet +
   deck, no stair box, no HVAC.
9. **Upload a single-storey test IFC (if available) with Auto style.**
   Verify gable is auto-selected (status banner reads "Gable roof
   (30°, ... ridge)").
10. **Re-upload a different IFC.** `resetIfApplied` should be called
    automatically (via IFCViewerPage) and the new model should load
    without any leftover tier3 geometry.

---

## Report path

`/Users/govindbhujbal/work/Hackthon - Workflow Builder/NeoBIM_Workflow_Builder/PHASE_3_5A_REPORT_2026-04-23.md`
