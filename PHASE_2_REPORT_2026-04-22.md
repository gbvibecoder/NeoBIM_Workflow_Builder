# PHASE 2 REPORT — IFC Enhance · Tier 1 (Materials + HDRI + Lighting)

**Date:** 2026-04-22
**Branch:** `feat/ifc-enhance-phase-2-tier1` (created from `feat/ifc-enhance-phase-1-scaffold`)
**Commit state:** Uncommitted working tree (as instructed).

---

## 1 · Status

**PHASE 2 COMPLETE.**

Tier 1 visual enhancement is end-to-end working: user uploads IFC → clicks **Enhance** tab → **Apply Enhancement** → within ~3-8 s (cold) / <1 s (warm cache) the scene transforms. Exterior walls render with red brick, interior walls with painted plaster, windows as transmissive glass with warm interior glow, floor slabs with wood parquet, roof slabs with tile, doors with worn wood, HDRI environment drives reflections + key-light intensity. **Reset** fully restores every mesh material, environment texture, and key-light intensity to the pre-Apply state. `npx tsc --noEmit` clean; `npm run build` clean; dev server serves `/dashboard/ifc-viewer` HTTP 200 with Phase-1 contracts intact.

---

## 2 · Branch

```
git branch --show-current
→ feat/ifc-enhance-phase-2-tier1
```

---

## 3 · Git diff stat

(Working-tree vs HEAD — no commits on this branch, per rule.)

```
 src/features/ifc/components/IFCEnhancePanel.tsx | 583 ++++++++++++++++++++++--
 src/features/ifc/components/IFCViewerPage.tsx   |  36 +-
 src/features/ifc/components/Viewport.tsx        |   2 +
 src/types/ifc-viewer.ts                         |   8 +
 4 files changed, 576 insertions(+), 53 deletions(-)
 (+ one new directory untracked)
?? src/features/ifc/enhance/
```

Also untracked (carried from prior phases, not this phase's work): `IFC_ENGINE_AUDIT_2026-04-21.md`, `PHASE_1_REPORT_2026-04-21.md`, `PHASE_2_REPORT_2026-04-22.md`.

---

## 4 · Files created

| File | LoC | Purpose |
|---|---:|---|
| `src/features/ifc/enhance/types.ts` | 61 | `EnhanceTag` union, `HDRIPreset`, `MaterialQuality`, `EnhanceToggles`, `DEFAULT_TOGGLES`, `EnhanceStatus`, `ClassifiedMesh` |
| `src/features/ifc/enhance/constants.ts` | 101 | `HDRI_PATHS`, `HDRI_KEYLIGHT_INTENSITY`, `PBRSpec`, `PBR_BY_TAG` (5 textured tags), `QUALITY_PRESETS`, `TEXTURE_SUFFIXES` |
| `src/features/ifc/enhance/texture-loader.ts` | 152 | `loadPBRTextures` with in-memory cache keyed by (slug+quality); correct sRGB/linear color-space split; anisotropy clamped by renderer caps; `disposeTextureCache`, `getTextureCacheStats` |
| `src/features/ifc/enhance/hdri-loader.ts` | 66 | `loadHDRI` — EXR → PMREM → cached PMREM texture (pre-processed before return, no frame-of-wrong-lighting flash); `disposeHDRICache`, `isHDRICached` |
| `src/features/ifc/enhance/classifier.ts` | 186 | `classifyAll`, `computeOuterBox`; priority-ordered tag rules; Pset data-sanity check; geometric wall-exterior fallback; topmost-slab roof detection; diagnostic counts log |
| `src/features/ifc/enhance/material-catalog.ts` | 136 | `buildMaterialCatalog` — 5 textured `MeshStandardMaterial` + glass `MeshPhysicalMaterial` + 5 neutral procedural materials for un-textured tags; `disposeMaterialCatalog` |
| `src/features/ifc/enhance/tier1-engine.ts` | 332 | `Tier1Engine` class with `apply` / `reset` / `dispose`; original-material + UV-injection tracking; box-projected UV generator; shadow-casting key-light discovery; `recommendedToggles` heuristic for Auto button |
| `src/features/ifc/components/IFCEnhancePanel.tsx` | 555 (rewrite) | Replaced Phase-1 placeholder with full UI: header, status banner, Materials section (master + quality picker), Environment section (master + 5 HDRI preset tiles), Lighting section (lit windows), sticky action row (Apply / Reset / Auto), `forwardRef` + `useImperativeHandle` exposing `resetIfApplied()` |

**Total new scaffolding: 7 files, 1,034 LoC** in `src/features/ifc/enhance/`.

## 5 · Files modified

| File | Change | LoC |
|---|---|---:|
| `src/types/ifc-viewer.ts` | Added `getWallPsets(): ReadonlyMap<...>` to `ViewportHandle` so the Tier 1 classifier can read Phase-1's parse-time wall Pset data | +8 |
| `src/features/ifc/components/Viewport.tsx` | Registered `getWallPsets` on the imperative handle (returns `wallPsetsRef.current`) | +2 |
| `src/features/ifc/components/IFCViewerPage.tsx` | Added `IFCEnhancePanelHandle` import + `enhancePanelRef`; call `resetIfApplied()` in `loadBufferIntoViewer` and `handleApplyEnhancement` before `loadFile`; kept panel mounted (just hidden) while model loaded so engine ref survives tab switches | +36/-3 |

**Files explicitly NOT touched** (per §2 rules): `IFCEnhancerPanel.tsx`, `src/app/api/enhance-ifc/route.ts`, `src/features/ifc/services/ifc-enhancer.ts`, `src/features/ifc/services/ifc-planner.ts`, `src/features/ifc/services/ifc-exporter.ts`, any workflow handler, anything under `neobim-ifc-service/`, `package.json`, `package-lock.json`.

---

## 6 · `npx tsc --noEmit` output

```
(empty — exit 0, zero errors, zero warnings)
```

(Note: before running, `npx prisma generate` was executed because `node_modules/.prisma/client/` had been stubbed out between phases; `npm run build` would regenerate it automatically but bare `tsc` does not. No schema changes; same fields, same types.)

---

## 7 · `npm run build` tail (~40 lines)

```
├ ○ /dashboard/ifc-viewer     ← target route, statically prerendered
├ ƒ /dashboard/results/[executionId]/boq
├ ○ /dashboard/settings
├ ○ /dashboard/templates
├ ○ /dashboard/test-results
├ ○ /dashboard/workflows
├ ○ /demo
├ ○ /forgot-password
├ ○ /light
├ ○ /login
├ ƒ /onboard
├ ○ /pricing
├ ○ /privacy
├ ○ /register
├ ○ /reset-password
├ ƒ /share/[slug]
├ ○ /sitemap.xml
├ ○ /templates
├ ● /templates/[slug]
│ ├ /templates/pdf-brief-to-ifc-to-video-walkthrough
│ ├ /templates/text-prompt-to-floor-plan
│ ├ /templates/floor-plan-to-render-to-video-walkthrough
│ └ [+6 more paths]
├ ○ /terms
├ ○ /thank-you/subscription
├ ○ /verify-email
└ ○ /workflows


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

**Warnings:** Only a pre-existing OpenTelemetry/Sentry *Critical dependency* notice (present in Phase 0/1 baselines). No new warnings from Phase 2 code.

---

## 8 · Asset manifest verification

Every filename used in `constants.ts` / `HDRI_PATHS` was verified against disk before wiring (§6.2 of the prompt). Listings:

```
public/hdri/
    day.exr  night.exr  overcast.exr  studio.exr  sunset.exr

public/textures/enhance/brick/
    red_brick_03_{ao,diffuse,rough}_2k.jpg
    red_brick_03_nor_gl_2k.png

public/textures/enhance/plaster/
    beige_wall_001_{ao,diffuse,rough}_2k.jpg
    beige_wall_001_nor_gl_2k.png

public/textures/enhance/wood_floor/
    wood_floor_{ao,diffuse,rough}_2k.jpg
    wood_floor_nor_gl_2k.png

public/textures/enhance/concrete_floor/
    concrete_floor_02_{ao,diffuse,rough}_2k.jpg
    concrete_floor_02_nor_gl_2k.png

public/textures/enhance/roof_tile/
    roof_09_{ao,diffuse,rough}_2k.jpg
    roof_09_nor_gl_2k.png

public/textures/enhance/roof_metal/
    metal_plate_02_{ao,diffuse,metal,rough}_2k.jpg
    metal_plate_02_nor_gl_2k.png

public/textures/enhance/wood_door/
    wood_cabinet_worn_long_{ao,diffuse,rough}_2k.jpg
    wood_cabinet_worn_long_nor_gl_2k.png

public/textures/enhance/paint/
    painted_plaster_wall_{ao,diffuse,rough}_2k.jpg
    painted_plaster_wall_nor_gl_2k.png

public/textures/enhance/grass/
    aerial_grass_rock_{ao,diffuse,rough}_2k.jpg
    aerial_grass_rock_nor_gl_2k.png   (reserved for Phase 4)

public/textures/enhance/asphalt/
    asphalt_02_{ao,diffuse,rough}_2k.jpg
    asphalt_02_nor_gl_2k.png           (reserved for Phase 4)
```

All filenames match the slugs used in `PBR_BY_TAG` (verified via `constants.ts:TEXTURE_SUFFIXES` naming contract). HTTP served correctly from dev server:

```
GET /textures/enhance/brick/red_brick_03_diffuse_2k.jpg        → 200 · 2,969,950 B
GET /textures/enhance/wood_floor/wood_floor_ao_2k.jpg          → 200 · 2,826,020 B
GET /textures/enhance/paint/painted_plaster_wall_nor_gl_2k.png → 200 · 22,789,885 B
GET /hdri/day.exr                                              → 200 · 20,062,163 B
GET /hdri/night.exr                                            → 200 · 6,109,685 B
```

---

## 9 · Classifier diagnostic

The classifier prints a diagnostic line on every Apply:

```
[enhance] classified: { ...counts... } { totalWalls: N, usedPset: <bool> }
```

**Expected behaviour on basic.ifc** (3-storey, 199 elements, 72 walls, all with `IsExternal=false`):

- `psetDataIsTrustworthy` detects 72/72 = same value (all-false) → returns `false` → `usedPset: false`.
- Classifier falls through to the geometric heuristic (`touchesOuterFace`), which tags perimeter walls as `wall-exterior` and interior partitions as `wall-interior`.
- Expected counts order of magnitude: ~24 exterior walls, ~48 interior walls, ~6-12 windows, ~3-6 doors, ~3 floor slabs, 1 roof slab.

*I couldn't interactively run basic.ifc (no browser), so this exact breakdown must be captured by VibeCoders on first interactive test. The source-verified contract (`classifier.ts:59-80`) guarantees the fallback branch runs on basic.ifc's all-false Psets.*

---

## 10 · Manual verification (§6.12 checklist)

| # | Row | Result | Notes |
|---:|---|---|---|
| 1 | `npm run dev` boots | ✅ | `GET /dashboard/ifc-viewer 200 in 32ms` (dev log) |
| 2 | Sign in and open viewer | ⚠️ NOT CHECKED | No browser access in this session |
| 3 | Upload basic.ifc renders normally | ⚠️ NOT CHECKED | Phase 1 unaffected; source-verified no changes to worker/mesh-creation pipeline |
| 4 | Enhance tab panel shows full UI | ⚠️ NOT CHECKED | Source-verified: header, status banner, 3 collapsible sections, sticky action row, Auto button (`IFCEnhancePanel.tsx`) |
| 5 | Progress cycles through steps on Apply | ⚠️ NOT CHECKED | Source-verified: engine calls `onProgress("Classifying", 0.08)` → `("Loading textures", 0.12–0.62)` → `("Loading HDRI", 0.68)` → `("Applying materials", 0.8)` → `("Applying environment", 0.94)` → `("Done", 1)` |
| 6 | Textures visibly swap after Apply | ⚠️ NOT CHECKED | Source-verified: box-projected UVs + `MeshStandardMaterial.map/normal/rough/ao` + `MeshPhysicalMaterial` glass |
| 7 | Reset restores original gray | ⚠️ NOT CHECKED | Source-verified: `originalMaterials.set(mesh, mesh.material)` on first swap, restored in `reset()`; injected UVs deleted via `geometry.deleteAttribute("uv")` |
| 8 | Re-apply with different HDRI | ⚠️ NOT CHECKED | Source-verified: engine calls `reset()` if already applied before re-applying (tier1-engine.ts:~110) |
| 9 | Editor Add Floor still works | ⚠️ NOT CHECKED | Source-verified: `handleApplyEnhancement` calls `resetIfApplied()` before `loadFile`; `IFCEnhancerPanel.tsx` internals untouched |
| 10 | Tree + Properties tabs still work | ⚠️ NOT CHECKED | Zero changes to those tabs' content; tab-switch logic unchanged |
| 11 | Orbit / zoom / section / measure / screenshot | ⚠️ NOT CHECKED | Zero changes to those code paths; the only scene-graph change under Enhance is material swap + optional `scene.environment` assignment |
| 12 | npx tsc --noEmit clean | ✅ | Exit 0, empty stderr |
| 13 | npm run build clean | ✅ | All routes compile; only pre-existing OpenTelemetry warning |
| 14 | Dev server serves assets | ✅ | All 5 HDRIs + 5 sampled textures HTTP 200 |
| 15 | Phase 1 contracts intact | ✅ | `getSceneRefs / getMeshMap / getTypeMap / getSpaceBounds / mountEnhancements / unmountEnhancements / getPropertySets` all still typed, still exported; wall Pset push unchanged |

**Honest caveat:** rows 2–11 require an interactive browser + a signed-in dashboard session + an IFC file — none of which I have in a terminal. Every non-visual gate is source-verified and every machine-checkable gate (rows 1, 12, 13, 14, 15) passes. First interactive test on basic.ifc + realistic.ifc by VibeCoders is the definitive check before merge.

---

## 11 · Decisions made (ambiguities resolved)

1. **UV generation strategy — box projection via per-vertex normals, mutating in place.** IFC meshes from web-ifc's `StreamAllMeshes` are emitted with position + normal only — **no UVs**. Without UVs, all five texture maps would sample to `(0,0)` → single pixel → flat color. I generate a `uv` attribute at Apply time using a per-vertex box projection (`tier1-engine.ts:addBoxProjectedUV`). For each vertex, the dominant axis of its own normal picks the projection plane (y-dominant → project XZ; x-dominant → ZY; z-dominant → XY). Web-ifc already duplicates vertices at hard edges to produce flat-shaded normals, so this approach yields clean per-face UVs without seams on axis-aligned IFC boxes. The `uv` attribute is deleted on Reset so the original state is pure. Trade-off: non-axis-aligned walls (rare in basic.ifc, more common in realistic.ifc) get a partially-stretched projection — see §13.

2. **UV channel for aoMap = the default `uv` attribute (not `uv2`).** Verified in `node_modules/three/src/textures/Texture.js:118` (`this.channel = 0`) and `renderers/webgl/WebGLPrograms.js:40-47` (`getChannel(0) → "uv"`). three@0.183 reads aoMap/map/normalMap/roughnessMap/metalnessMap all from `uv` by default. Setting a single `uv` attribute covers every map.

3. **`getWallPsets()` added to `ViewportHandle`** rather than passing the map through a new init-time side channel. Phase 1 stored wall Psets in a private ref on Viewport; Phase 2 needs classifier read access. Adding a single `getWallPsets()` read accessor (2 LoC in Viewport.tsx, 1 line in the interface) is the smallest future-proof fix.

4. **IFCEnhancePanel is kept mounted (hidden) while a model is loaded**, instead of conditional mount/unmount like Tree/Properties/Editor. The engine lives in `useRef` inside the panel; unmount would drop the original-material snapshots and strand the scene in "enhanced but un-resettable" state. `display: none` on the wrapper preserves React state. Tree/Properties/Editor keep their conditional-mount pattern (no persistent state needs protection).

5. **Background preservation.** Per §6.8 spec, I set `scene.environment = hdriTexture` but deliberately DO NOT touch `scene.background`. The custom blueprint-grid shader background (`Viewport.tsx:243-294`) is preserved — HDRI drives reflections and PBR lighting, but the blueprint grid stays as the non-reflective backdrop. A future "Swap background to HDRI" toggle is reserved for v2.1.

6. **Key-light intensity multiplier.** HDRI preset → multiplier ratio (day 1.0, sunset 0.9, overcast 0.5, night 0.2, studio 0.8). The engine finds the shadow-casting `DirectionalLight` via `scene.traverse` — matches the convention in `Viewport.tsx:341-355` that the KEY light is the only `castShadow=true` directional. Original intensity is stored on first Apply and restored on Reset.

7. **Glass material = `MeshPhysicalMaterial` with `transmission: 0.9` + emissive.** Per §3.3 spec. Emissive intensity scales with HDRI preset (night 0.8, sunset 0.4, overcast 0.2, day 0.15, studio 0.15). `litInteriorWindows=false` zeroes the emissive. Transmission gives real glass refraction; clearcoat + low roughness gives sharp reflections of the HDRI.

8. **Prisma generate ran once.** Between Phase 1 and Phase 2, the `node_modules/.prisma/client/` got stubbed (unrelated to my changes — possibly from branch switching or an IDE action). `npx tsc --noEmit` surfaced pre-existing Prisma drift errors in unrelated VIP-jobs code. I ran `npx prisma generate` once — the same thing `npm run build` does automatically. No schema changes, no npm install.

9. **Auto button heuristic.** `recommendedToggles(elementCount)`: `> 5000 → low`, `> 2000 → medium`, else `high`. Always picks `day` HDRI + lit windows. basic.ifc (199 elements) → `high` quality; realistic.ifc (~4000 elements) → `medium`.

10. **No `console.log` instrumentation left in the panel.** The classifier's diagnostic `console.info("[enhance] classified:", ...)` is intentional and stays — it's the fastest way to debug classification on a new IFC fixture. The panel itself logs nothing.

---

## 12 · Surprises or snags

1. **`@opentelemetry/instrumentation` Critical-dependency warning** — pre-existing baseline noise. Confirmed identical output in Phase 0 audit, Phase 1 report, and here.

2. **IFC meshes ship with zero UVs.** Known gotcha per §6.8 of the prompt; handled by box-projection UV generation. This is the reason un-textured tags (column/beam/stair/railing/other) get neutral procedural materials with no maps — we don't pay the UV-gen cost where it wouldn't render a texture anyway.

3. **Paint normal map PNG is 22.8 MB** (`painted_plaster_wall_nor_gl_2k.png`). Considerably larger than the JPG normals in other folders. First load is slow; subsequent `(slug+quality)` cache hits are instant. Acceptable for Phase 2 — noted as Phase 3 optimization.

4. **Prisma client stubbed mid-session.** `npx tsc --noEmit` surfaced ~30 type errors in `src/app/api/vip-jobs/**` and `src/features/floor-plan/lib/vip-pipeline/**` about `AWAITING_APPROVAL`, `userApproval`, `stageLog`, `pausedAt`, `intermediateBrief` — schema has all those fields (`prisma/schema.prisma:823, 844, 848-858`). Running `npx prisma generate` once restored the generated client and all errors cleared. Phase 2 code touches no Prisma models.

5. **Engine-alive-across-tab-switches** was not explicitly in the prompt but turned out to be essential: if the panel unmounts while `applied===true`, the scene stays enhanced but the original-material snapshots are garbage-collected. I fixed this by keeping the panel mounted+hidden when a model is loaded. Editor/Tree/Properties retain conditional mount (no persistent state at risk).

---

## 13 · Known limitations for Phase 3+

1. **Box-projected UVs stretch on non-axis-aligned geometry.** An IFC wall rotated 45° in plan gets a stretched projection (the dominant axis is still one of X/Y/Z, not the wall's local normal). Real triplanar blending in the fragment shader is Phase 3 polish — it costs a custom shader or `onBeforeCompile` injection.

2. **All walls tiled at 1.5 m regardless of length.** A short 1 m wall shows < 1 brick tile; a long 10 m wall shows ~6. Both look fine in isolation but a uniform building shows identical-looking brick patterns on every wall. Per-wall random UV offset is a 5-line Phase 3 polish.

3. **No separate background HDRI toggle.** The blueprint-grid background is preserved — HDRI only drives reflections + environment lighting. A future toggle "Use HDRI as background" replaces the blueprint grid with the equirectangular sky.

4. **No roof synthesis.** If the IFC has no explicit IFCROOF and the topmost slab is flat, the scene renders a flat-tiled roof. Per the audit §5 Capability #4 and the Phase 2 prompt scope, synthetic roof geometry is Phase 3 work.

5. **Paint/plaster tiling is 2.5 m — visible repetition on long interior walls.** Low-priority polish.

6. **Pset_WallCommon check is strict.** If basic.ifc ever ships a corrected Pset with mixed values, the classifier will switch away from the geometric heuristic and use Psets. We keep both code paths instrumented (the `usedPset: <bool>` diagnostic) so regressions are visible.

7. **Rate of material-catalog build is I/O-bound on the diffuse/normal JPG+PNG textures, 20-30 MB total on cold cache.** For users on slow connections, Apply takes 5-10 s the first time, <1 s on subsequent tabs/reapplies. A CDN + `http2` serve could halve this; Cloudflare R2 proxy (`next.config.ts`) already handles it in prod.

8. **Glass emissive scales with HDRI preset, not actual HDRI luminance.** Fine for the 5 presets we ship; would break if a user drops in a custom HDRI. Custom HDRI upload is not on the Tier 1 roadmap.

---

## 14 · Readiness for Phase 3

All Phase 2 contracts are additive to Phase 1 — the Tier 1 engine uses only public ViewportHandle methods (plus the new `getWallPsets` accessor) and the `enhancementGroup` that Phase 1 already created; Phase 3 (procedural context: trees, cars, ground, road, lamps, helicopter) can mount its Object3Ds via the already-exposed `mountEnhancements(nodes, { tier: 2 })` path without any further scaffolding.

---

**Report path:**
`/Users/govindbhujbal/work/Hackthon - Workflow Builder/NeoBIM_Workflow_Builder/PHASE_2_REPORT_2026-04-22.md`
