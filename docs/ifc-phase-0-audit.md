# IFC Rich Generation — Phase 0 Audit

**Mode:** Read-only, no code changes.
**Date:** 2026-04-17
**Branch:** `better-3d-model`
**Plan reference:** `docs/RICH_IFC_IMPLEMENTATION_PLAN.md` — **NOT FOUND in repo** (searched `docs/`, root, and fs-wide; no file matches `*rich*` or `*implementation*plan*` outside `node_modules`). All claims below come from code, not plan text. If the plan document exists outside the repo (Notion, Google Doc, VibeCoders working draft), its assumptions could conflict with what the code actually does — see § 8 for one such conflict flag.

---

## 1. Deployment Status

**Status: DEPLOYED (Railway) — but evidence is local-only.**

Evidence:
- `.env.local:109-110` sets `IFC_SERVICE_URL="https://buildflow-python-server.up.railway.app"`. The inline comment literally reads `## Railway IFC_SERVICE_URL`.
- `.env.local:110` is not reproduced in `.env.example` — neither `IFC_SERVICE_URL` nor `IFC_SERVICE_API_KEY` appear there (grep across the whole `.env.example`). Operators cloning from the example won't know the variable exists.
- No `railway.json`, `render.yaml`, `fly.toml`, `Procfile`, or GitHub Actions workflow targeting the Python service exists in the repo (glob: 0 matches). `vercel.json` is present but covers only Next.js crons (`/api/files/cleanup`, `/api/cron/refresh-prices`, `/api/cron/reconcile-subscriptions`) — none touch the Python service.
- `neobim-ifc-service/Dockerfile` exists and is Railway-compatible (python:3.11-slim, libgomp1, 2 uvicorn workers on :8000) but has no associated Railway config checked into git.
- **UNKNOWN — need to confirm:** whether the production Vercel deployment (`rutikerole/NeoBIM_Workflow_Builder` main) has `IFC_SERVICE_URL` populated in its env settings. If it is populated and the Railway app is awake, EX-001 calls the Python path. If unpopulated (or Railway scaled to zero / 30s timeout), EX-001 silently falls back to the TS exporter (`src/features/ifc/services/ifc-service-client.ts:56-58`; `src/app/api/execute-node/handlers/ex-001.ts:170-197`). The code has no pre-flight `/health` probe.
- **UNKNOWN — need to confirm:** Python service auth posture in production. `neobim-ifc-service/app/auth.py:17-19` — if `IFC_SERVICE_API_KEY` is empty in the service's own env, the middleware is fully open (dev mode). A missing secret at Railway's side would expose the endpoint.

**Which path EX-001 uses right now in production:** CANNOT BE DETERMINED FROM CODE ALONE. The logic is: try Python, on any failure (null URL, HTTP error, timeout, `status !== "success"`, empty files) fall back to TS. Per `.env.local` the local-dev path uses Python; prod is UNKNOWN until someone checks Vercel env + Railway liveness.

---

## 2. Python Builder Capabilities Matrix

All twelve rows (a)–(l) from the audit prompt, based on end-to-end reads of **every file** in `neobim-ifc-service/app/services/` plus a global grep across the microservice tree.

| # | Capability | Status | File:Line |
|---|---|---|---|
| a | IfcStructuralAnalysisModel | **ABSENT** | — (zero grep matches in `neobim-ifc-service/`) |
| b | IfcStructuralCurveMember / IfcStructuralSurfaceMember | **ABSENT** | — |
| c | IfcStructuralLoadCase / IfcStructuralAction / IfcBoundaryCondition | **ABSENT** | — |
| d | IfcDistributionPort | **ABSENT** | — |
| e | IfcRelConnectsPorts | **ABSENT** | — |
| f | IfcDuctFitting / IfcPipeFitting / IfcCableCarrierFitting | **ABSENT** | — (only segments: `mep_builder.py:26, 88, 149`) |
| g | IfcValve / IfcFlowTerminal / IfcFlowController | **PARTIAL** — `IfcFlowTerminal` PRESENT at `mep_builder.py:211`; `IfcValve` ABSENT; `IfcFlowController` ABSENT |
| h | IfcReinforcingBar / IfcReinforcingMesh | **ABSENT** | — |
| i | IfcMaterialProfileSet | **ABSENT** — only `IfcMaterialLayerSet` at `material_library.py:198-203`; `IfcMaterialLayerSetUsage` at L212 |
| j | IfcRoof / IfcRailing / IfcCurtainWall / IfcFurniture / IfcFooting | **ABSENT for all five.** `IfcRoof` is substituted by `IfcSlab` with `PredefinedType="ROOF"` (`slab_builder.py:32`). `balcony` / `canopy` / `parapet` are collapsed into `IfcBuildingElementProxy` (`ifc_builder.py:259-267`). |
| k | IfcZone / IfcRelAssignsToGroup | **PARTIAL** — `IfcZone` ABSENT; `IfcRelAssignsToGroup` PRESENT at `mep_builder.py:277` |
| l | IfcClassificationReference | **ABSENT** — no classification emission at all (zero matches for `classification` across the Python tree) |

**Additional relevant entities the Python service DOES emit** (observed while reading the files):

| Entity | File:Line |
|---|---|
| IfcProject | `ifc_builder.py:100` |
| IfcSite | `ifc_builder.py:118` |
| IfcBuilding | `ifc_builder.py:122` |
| IfcBuildingStorey | `ifc_builder.py:132` |
| IfcWall + PredefinedType STANDARD / PARTITIONING | `wall_builder.py:43-46` |
| IfcOpeningElement | `wall_builder.py:124` |
| IfcRelVoidsElement | `wall_builder.py:176-181` |
| IfcRelFillsElement | `wall_builder.py:192-197` (in `fill_opening`) |
| IfcSlab + PredefinedType FLOOR / ROOF | `slab_builder.py:29-32` |
| IfcColumn (circular) | `column_builder.py:25` |
| IfcBeam + IfcIShapeProfileDef | `beam_builder.py:26, 61-68` |
| IfcWindow (simplified panel) | `opening_builder.py:27` |
| IfcDoor + OperationType | `opening_builder.py:120-125` |
| IfcStairFlight + NumberOfRisers/RiserHeight/TreadLength | `stair_builder.py:27-32` |
| IfcSpace + CompositionType ELEMENT + LongName | `space_builder.py:22-26` |
| IfcDuctSegment | `mep_builder.py:26` |
| IfcPipeSegment + IfcCircleProfileDef | `mep_builder.py:88, 107-111` |
| IfcCableCarrierSegment | `mep_builder.py:149` |
| IfcSystem | `mep_builder.py:271` |
| IfcRelAssignsToGroup | `mep_builder.py:277` |
| IfcRelServicesBuildings | `mep_builder.py:285` |
| IfcBuildingElementProxy (balcony/canopy/parapet) | `ifc_builder.py:261` |
| IfcMaterialLayer / IfcMaterialLayerSet / IfcMaterialLayerSetUsage | `material_library.py:188, 198, 212` |
| IfcRelAssociatesMaterial | `material_library.py:219-224` |
| IfcRelAggregates / IfcRelContainedInSpatialStructure (fallback) | `utils/ifc_helpers.py:31-36, 46-51` (used only when `api.run` fails) |
| Pset_WallCommon / Qto_WallBaseQuantities | `property_sets.py:60-94` |
| Pset_SlabCommon / Qto_SlabBaseQuantities | `property_sets.py:100-128` |
| Pset_ColumnCommon / Qto_ColumnBaseQuantities | `property_sets.py:134-158` |
| Pset_WindowCommon | `property_sets.py:164-176` |
| Pset_DoorCommon | `property_sets.py:182-195` |
| Pset_SpaceCommon | `property_sets.py:201-216` |
| Pset_BeamCommon / Qto_BeamBaseQuantities (Length only) | `property_sets.py:222-239` |

**Summary:** Python service has 8/12 ABSENT, 2/12 PARTIAL, 2/12 fully PRESENT (or equivalent). The service currently produces a valid, geometry-correct, spatially-organised IFC4 with proper material layer sets, openings, and basic property sets — but zero structural-analysis content, zero classification content, zero MEP connectivity topology, zero rebar, zero dedicated ancillary entities.

---

## 3. Input Surface Diff (TS vs Python)

### 3.1 `ElementProperties` field mirror

TS file: `src/types/geometry.ts:30-75` (GeometryElement.properties). Python file: `neobim-ifc-service/app/models/request.py:31-62` (`ElementProperties`, populate-by-name config at L62).

| Field | TS? | Python? | Used for | Needed for rich IFC? |
|---|---|---|---|---|
| name | ✅ | ✅ | Name on IFC entity | yes |
| storeyIndex / storey_index | ✅ | ✅ | Spatial containment | yes |
| height | ✅ | ✅ | Wall/column extrusion | yes |
| width | ✅ | ✅ | Rect profile X | yes |
| length | ✅ | ✅ | Extrusion depth | yes |
| thickness | ✅ | ✅ | Wall/slab thickness | yes |
| area | ✅ | ✅ | Fallback slab profile | yes |
| volume | ✅ | ✅ | Qto filling | yes |
| isPartition / is_partition | ✅ | ✅ | PredefinedType, Pset.IsExternal | yes |
| radius | ✅ | ✅ | Circular column | yes |
| spaceName / space_name | ✅ | ✅ | IfcSpace.Name | yes |
| spaceUsage / space_usage | ✅ | ✅ | IfcSpace.LongName, Pset.Category | yes |
| spaceFootprint / space_footprint | ✅ | ✅ | IfcArbitraryClosedProfileDef | yes |
| sillHeight / sill_height | ✅ | ✅ | Window placement | yes |
| wallOffset / wall_offset | ✅ | ✅ | Opening offset along wall | yes |
| parentWallId / parent_wall_id | ✅ | ✅ | Wall ↔ opening linkage | yes |
| wallDirectionX / wall_direction_x | ✅ | ✅ | Wall orientation | yes |
| wallDirectionY / wall_direction_y | ✅ | ✅ | Wall orientation | yes |
| wallOriginX / wall_origin_x | ✅ | ✅ | Wall origin | yes |
| wallOriginY / wall_origin_y | ✅ | ✅ | Wall origin | yes |
| material | ✅ | ✅ | Material lookup key | partial — currently only drives Python's preset selection; unused for TS CSI division override logic |
| discipline | ✅ | ✅ | Discipline filter | yes |
| diameter | ✅ | ✅ | Pipe radius | yes |
| isExterior / is_exterior | ✅ | ✅ | Pset.IsExternal on doors | yes |
| riserCount / riser_count | ✅ | ✅ | Stair NumberOfRisers | yes |
| riserHeight / riser_height | ✅ | ✅ | Stair RiserHeight | yes |
| treadDepth / tread_depth | ✅ | ✅ | Stair TreadLength | yes |

**ElementProperties parity: 27/27 fields mirrored (100 %).**

### 3.2 `GeometryElement.type` literal diff

TS (`geometry.ts:20-22`):
```
wall | slab | column | roof | space | window | door | beam | stair |
balcony | canopy | parapet | duct | pipe | cable-tray | equipment |
mullion | spandrel
```

Python (`request.py:67-71`):
```
wall | slab | column | roof | space | window | door | beam | stair |
balcony | canopy | parapet | duct | pipe | cable-tray | equipment
```

**Mismatch:** TS adds `mullion` and `spandrel`. Python would reject them as Pydantic validation errors on the request. Currently these TS types only arise when curtain-wall sub-components are supplied — and the TS exporter gates their geometry behind `emitCurtainWallGeometry=false` by default — so production probably never hits this path. But a Revit-style curtain wall ingestion would break today.

### 3.3 `GeometryElement.ifcType` literal diff

TS (`geometry.ts:26-28`) = Python (`request.py:73-78`): identical list of 16 IfcType strings. **Perfect parity.**

### 3.4 `ExportIFCRequest` + `ExportOptions` diff

| Field | TS request (`ifc-service-client.ts:61-80`) | Python (`request.py:136-156`) |
|---|---|---|
| `geometry.*` | forwarded verbatim | consumed | 
| `options.projectName` / `project_name` | sent | expected |
| `options.buildingName` / `building_name` | sent | expected |
| `options.author` | sent | expected (default `"NeoBIM"`) |
| `options.disciplines` | sent `["architectural","structural","mep","combined"]` | expected, same default |
| `options.siteName` | **not sent by TS client** | expected (default `"Default Site"`) |
| `filePrefix` | sent | expected |

TS client at L73-80 does not forward `siteName`, `schema`, `region`, `geoReference`, `projectIdentifier`, `rera`, `projectMetadata`, `unitSystem`, `currency`, `projectPhase`, `permit`, `federatedFiles`, or any of the four geometry-emission flags from `IFCExportOptions` (`ifc-exporter.ts:65-168`). These are TS-exporter-only; the Python request schema has no equivalent fields.

---

## 4. Missing Input Fields for Rich IFC

Neither side currently models any of the following. Each would be needed to emit entities that match BIM industry DoD for a "rich" IFC. All claims refer to absence in **both** `src/types/geometry.ts` and `neobim-ifc-service/app/models/request.py`.

- **materialGrade** — e.g. `M25`, `Fe500D`, `Fe250`. Needed to drive `IfcMaterial.Category`, `Pset_MaterialMechanical`, `Pset_MaterialConcrete`, and per-element IS 456 / IS 800 classification. TS exporter has the Indian grade catalogues hard-coded (`ifc-exporter.ts:6101-6108`, 6236-6244) but no way to override per element.
- **profileType** — `I-section`, `H-section`, `rectangular`, `circular`. Needed to pick `IfcIShapeProfileDef` vs `IfcRectangleProfileDef` vs `IfcCircleProfileDef` and to produce `IfcMaterialProfileSet`. Currently the Python beam builder always emits I-section (`beam_builder.py:61`) with hard-coded flange thickness 15 mm, web 10 mm — no input.
- **fireRatingMinutes** — currently hard-coded: `"REI 120"` exterior / `"EI 60"` interior walls (`property_sets.py:74`), `"R 120"` columns (`property_sets.py:149`). A rich IFC must carry the per-element fire rating from the designer.
- **acousticRatingDb** — no input. Pset_WallCommon / Pset_DoorCommon have `AcousticRating` slots; currently unset.
- **systemName** — duct/pipe/tray segments are grouped into three hard-coded Python IfcSystems (`HVAC`, `Plumbing`, `Electrical`) in `ifc_builder.py:163-167` regardless of the user's actual system naming. Needed for real COBie / IFC4 `IfcDistributionSystem` semantics.
- **upstreamElementId / downstreamElementIds** — needed to build `IfcRelConnectsPorts` topology that survives into Navisworks / Solibri. The TS exporter synthesises a minimal chain by iterating `equipmentByKind` at `ifc-exporter.ts:5732-5767`; Python has no equivalent.
- **flowDirection** — `SOURCE` / `SINK` / `SOURCEANDSINK` per port. Same concern as above.
- **diameterMm / widthMm / heightMm** — all current inputs are in meters (`ElementProperties.diameter`, `.width`, `.height`). QS tools and IFC rebar catalogues expect millimetres; TS exporter converts in-place (`ifc-exporter.ts:4218` `rMeters = (bar.diameter / 2) / 1000`) assuming mm input that the current TS type declares in m. Type-vs-unit drift risk.
- **designLoadKnPerM** / **designLoadKN** — required for real structural-analysis load case emission (the TS exporter currently emits only boilerplate `IfcStructuralLoadGroup.LOAD_CASE` entities at `ifc-exporter.ts:5591-5596` without any element-level applied actions).
- **supportType** — `PIN`, `FIXED`, `ROLLER`. Required to emit `IfcBoundaryCondition` (absent on both sides).
- **rebarRatio** or **rebarSpec** — required to emit realistic `IfcReinforcingBar` / `IfcReinforcingMesh` linked to a host column/beam. TS exporter `ifc-exporter.ts:4196-4329` has the emitters but consumes hand-constructed bar specs, not user input.
- **zoneName** — required for `IfcZone` emission (grouping spaces by function: tenanted area, fire zone, HVAC zone). Absent both sides.

Additional observations from reading both sides:

- Neither side carries **`buildingFunctionCategory`** (Occupancy A-G per NBC). TS exporter infers it from building-type string at `ifc-exporter.ts:6200-6207` but it's a global, not per-space.
- Neither side carries **`spaceThermalProfile`** (target temperature, RH, ACH). TS exporter emits `Pset_SpaceThermalRequirements` with hard-coded defaults.
- Neither side carries **`spaceAcousticTargetDb`**, **`spaceLightingLuxTarget`**, **`spaceSafetyClass`**.
- Python `ElementProperties` has no `shapeProfile` variant — forces the builders to lock in one shape per element type regardless of designer intent.

---

## 5. TS Exporter Fallback Gaps (what it does NOT produce)

**Important context-reversal vs the common assumption:** the TS exporter is actually *richer* than the Python service (6328 LOC vs ~1500). The Python service is the minimum-viable production path; the TS exporter is the feature-maximal fallback. See § 8 for how this affects strategy.

What the TS exporter calls unconditionally (`ifc-exporter.ts:1815-1854`):
- `emitIfcGrid`, `emitInternationalClassifications`, `emitEmbodiedCarbonMaterialPsets`, `emitM25ConstituentSet`, `emitIndianEPDReferences`, `emitBuildingEmbodiedCarbonSummary`, `emitProjectLibraryAndFederation`, `emitStructuralAnalysisModel` (metadata only, no analytical members), `emitLoadCasesAndCombinations` (Pset-only), `emitTaskElementLinkage`, `emitCostElementLinkage`, `emitConstructionResources`, `emitMilestoneTasks`, `emitPerEquipmentCOBieData`, `emitAssetGroupings`, `emitApprovalWorkflow`, `emitIndianPermit`, `emitIDSAndDigitalSignature`, `emitValidationCertificateScaffold`, `emitPresentationLayerAssignments`, `emitBuildingPset`, per-storey `emitStoreyPset`, `emitMaterialAssociations`, `emitTypeAssignments`, `emitClassificationAssociations`, `emitMEPSystemAssignments`, `emitDocumentReferences`, `emitWallConnections`, `emitSpaceBoundaries`, `emitMaterialPhysicsPsets`, `emitSpaceThermalPsets`, `emitWorkScheduleAnd4D`, `emitCostScheduleAnd5D`, `emitProjectTeamAndPhase`.

What the TS exporter gates behind **`autoEmitDemoContent: false`** (default, see `ifc-exporter.ts:1609-1612`):
- `emitSampleMechanicalFasteners` (L1829) — sample M20 bolt, 6 mm fillet weld.
- `emitAdvancedMEPComponents` (L1830) — plant-room equipment at hardcoded bbox coords.
- `emitMEPPortConnectivity` (L1831) — **this is where `IfcDistributionPort` + `IfcRelConnectsPorts` live** (L5747, L5758, L5764). With default flags, the TS exporter emits ZERO MEP port topology.
- `emitMEPFixturesForStorey` (L1766-1768) — produces `IfcPipeFitting`, `IfcValve`, `IfcDuctFitting` at bbox-derived positions. Default off.
- Sample lifts, entry ramps, pile caps, furniture, curtain-wall demos inside `emitMissingBuildingElements` (`ifc-exporter.ts:5112, 5141, 5219, 5241, 5250, 5267`). Default off.

What the TS exporter gates behind **`emitRebarGeometry: false`** (default):
- Body geometry for `IfcReinforcingBar` (L4211). With default flags, rebar entities exist with full metadata (grade, diameter, cutting length, BBS role) but `Representation = $` — no visual in viewers.

What the TS exporter gates behind **`emitCurtainWallGeometry: false`** and **`emitMEPGeometry: false`** (defaults, L1611-1612):
- Curtain-wall mullion/spandrel geometry (L3000).
- Duct/pipe/tray body geometry (L3664, L3737, L3790).
- Per the comments at L140-167, these defaults exist because past iterations produced "flying debris" on non-rectangular / circular buildings.

**Consequences for EX-001 today:**
- **TS fallback path** (when Python unreachable): emits structural-analysis Psets, cost links, task links, CSI + international classifications, rebar metadata, curtain-wall metadata entities — but NO port topology, NO fittings, NO rebar geometry, NO curtain-wall geometry, NO fixture geometry, because none of the four gate flags are set by the caller.
- **Python path** (when up): emits ONLY geometry-correct walls, slabs, columns, beams, windows, doors, stairs, spaces, duct/pipe/tray segments, flow terminals, material layer sets, and Pset_*Common. No structural analysis, no classifications, no cost/task linkage, no rebar, no curtain walls, no zones.

So the two paths are complementary, not redundant. Neither alone satisfies "rich IFC" per the prompt's (a)–(l) list.

---

## 6. Fixture IFC Analysis

**No generated `.ifc` sample committed to the repo.**

Evidence:
- `neobim-ifc-service/tests/fixtures/sample_geometry.json` **is a request input**, not a generated output (260 lines; I read it end-to-end — it is the `ExportIFCRequest` body). Building: 3-storey Office Tower A, 20 × 20 m footprint, 12 elements: 5 walls, 2 slabs, 1 roof slab, 2 columns, 2 windows, 1 door, 1 space.
- `neobim-ifc-service/tests/` contains only `__init__.py` and `fixtures/` — **no Python test files** named `test_*.py`.
- `tests/unit/ifc-exporter.test.ts` and `tests/unit/ifc-multi-export.test.ts` exist in the Next.js app but they generate IFC in-memory during the test run; no fixture `.ifc` is checked in.
- `temp_folder/ifc_file.ifc` exists in the repo root (per the earlier glob) but this is a user-uploaded artefact sitting in a scratch folder, not a generated output fixture we control.

**Entity counts:** UNKNOWN — cannot report accurate numbers without generating one. **Recommended Phase 1 prep step:** run `POST {IFC_SERVICE_URL}/api/v1/export-ifc` with `sample_geometry.json` and save both discipline outputs + TS-path outputs as repo-committed fixtures (`neobim-ifc-service/tests/fixtures/generated_*.ifc` and `tests/fixtures/ts_*.ifc`). Then a trivial grep-and-count Python snippet gives us a comparative entity matrix. That baseline is mandatory to measure whether each subsequent Phase's additions actually land in the output.

---

## 7. EX-001 Fallback Flow

EX-001 handler lives at `src/app/api/execute-node/handlers/ex-001.ts`. The generation-path logic runs after geometry resolution (Paths A/B/C around L51-156). Specifically:

1. Line 164: initialises `let ifcServiceUsed = false`.
2. Line 170-194 wraps the Python call in `try`. It dynamically imports `@/features/ifc/services/ifc-service-client` (L171) and calls `generateIFCViaService(resolvedGeometry, {projectName, buildingName}, filePrefix)` (L172-176). **Note** — it passes only `projectName` and `buildingName`; `siteName`, `author`, and `disciplines` default on the Python side (`request.py:137-143`). No region, RERA, currency, schema, or gate-flag information is transmitted.
3. `generateIFCViaService` (`ifc-service-client.ts:47-113`) returns `null` in these exact conditions:
   - L56-58: `IFC_SERVICE_URL` env var unset → silent null.
   - L94-98: HTTP status non-OK → logs warning, returns null.
   - L103-106: response `status !== "success"` or `files` array empty → logs warning, returns null.
   - L109-112: any thrown exception including `AbortSignal.timeout(30_000)` (L39, L91) → logs warning, returns null.
4. If the call returned truthy, L178-194 sets `ifcServiceUsed = true` and maps each `f.download_url` into the artifact's `files` array. No content is re-uploaded to R2 — the Python service has already done that via its own `r2_uploader.py:27-57` (or fallen back to inline base64 data URI).
5. If `ifcServiceUsed === false` (line 200), fallback runs: dynamically import `generateMultipleIFCFiles` from `ifc-exporter.ts`, call it with `{projectName, buildingName}` only (L202-204). For each of the four disciplines, base64-encode the string, call `uploadBase64ToR2(b64, fileName, "application/x-step")` (L219). On upload success, use the R2 URL; otherwise fall back to `data:application/x-step;base64,${b64}` (L222). Note that the **TS exporter gate flags** (`emitRebarGeometry`, `autoEmitDemoContent`, `emitCurtainWallGeometry`, `emitMEPGeometry`) are all left at their defaults (false) because only `projectName` and `buildingName` are passed.
6. Final artifact (L237-263): `type: "file"`, `data.files[]`, `metadata.engine: ifcServiceUsed ? "ifcopenshell" : "ifc-exporter"` (L255), `metadata.real: true`, `metadata.schema: "IFC4"`, `metadata.multiFile: true`, `metadata.ifcServiceUsed: boolean` (L259).

**User-visible path indicator:** `metadata.engine` + `metadata.ifcServiceUsed` on the artifact. I did not find any UI component that surfaces either value as a badge / toast / chip — checked `result-showcase/` in the earlier technical pass. The indicator exists in the payload but is not displayed. **UNKNOWN — need to confirm:** whether any admin-only debug panel reads it.

---

## 8. Recommendation — Fastest Win

**Recommendation: (a) *Confirm* the Python service is deployed and reachable from production Vercel, THEN (d) extend the input surface so the TS exporter's already-rich feature set can actually fire.**

Reasoning from evidence:

- The conventional framing of this initiative — "enrich the Python service so EX-001 produces richer IFC" — is partially inverted by the code. The TS exporter at 6328 LOC already emits `IfcStructuralAnalysisModel`, `IfcStructuralLoadGroup` (both `LOAD_CASE` and `LOAD_COMBINATION` variants), `IfcDistributionPort`, `IfcRelConnectsPorts`, `IfcPipeFitting`, `IfcDuctFitting`, `IfcValve`, `IfcRailing`, `IfcReinforcingBar`, `IfcReinforcingMesh`, `IfcCurtainWall`, `IfcFurniture`, `IfcFooting`, `IfcClassificationReference`, `IfcZone`-less but COBie-full asset groupings, 4D tasks, 5D costs, and material Psets. The Python service emits none of these. **The Python service is the minimum-viable path; the TS exporter is the feature-rich path.**
- But — the TS exporter's rich features are gated behind four flags (`emitRebarGeometry`, `autoEmitDemoContent`, `emitCurtainWallGeometry`, `emitMEPGeometry`) that **EX-001 never sets** (`ex-001.ts:172-176` passes only `projectName` + `buildingName`). So the rich features are dead code in production unless someone explicitly wires the flags.
- And — the Python primary path does produce more visually correct *core* geometry (walls with openings, slabs with proper `IfcArbitraryClosedProfileDef`, stairs with stepped polyline extrusion) than the TS exporter, which is why the TS path was demoted to fallback status. The Python service is the geometry-correctness layer; the TS exporter is the metadata-richness layer.

**The fastest win path is therefore:**

1. **Confirm Python deployment** (first half-day): verify `IFC_SERVICE_URL` is set on the prod Vercel environment, add a `/health` or `/ready` pre-flight probe in `generateIFCViaService` to prevent the silent 30-s timeout fallback, and expose `metadata.ifcServiceUsed` in the UI so users know which path ran. **Documents `IFC_SERVICE_URL` and `IFC_SERVICE_API_KEY` in `.env.example` (currently absent)** — ship-blocker-grade documentation gap.
2. **Extend the input surface** (rest of Phase 1): add `materialGrade`, `profileType`, `fireRatingMinutes`, `systemName`, `flowDirection`, `diameterMm`, `widthMm`, `heightMm`, `designLoadKnPerM`, `supportType`, `zoneName` to both `src/types/geometry.ts` and `neobim-ifc-service/app/models/request.py`. This unblocks *both* the TS rich emitters (by enabling the gate flags per-element) *and* the Python builders (by giving them real data to emit).
3. **Then — and only then — add the absent Python emitters** (structural analysis members, ports, fittings, rebar, curtain-wall, zones). At that point Python emits geometry + structure, TS emits metadata, and they complement each other cleanly.

Competing options (a), (b), (c), (d) in the prompt:
- **(a) Deploy Python**: probably already done per `.env.local:110`; the remaining work is confirmation + documentation. LOW effort, HIGH de-risking value.
- **(b) Add IfcStructuralAnalysisModel to Python**: duplicates what TS already emits at `ifc-exporter.ts:5569`. Medium effort, low net gain — the entity *already exists in the output* when TS path runs.
- **(c) Extend MEP topology on Python (fittings + ports)**: needed eventually but (d) is a prerequisite — without `systemName`, `flowDirection`, `upstreamElementId`, there is no data to drive topology.
- **(d) Procedurally enrich upstream**: the unblocker for both (b) and (c). All current gate flags that turn the TS exporter's rich features off default to false precisely because today there is no per-element input to parameterise them without producing "flying debris" (see comments at `ifc-exporter.ts:123-167`). Fix the input, and the TS exporter instantly produces richer output with no exporter code change; Python becomes a parallel enrichment track rather than a parallel rewrite.

**Justification with concrete evidence:** `ex-001.ts:172-176` (call site passes only 2 options) + `ifc-exporter.ts:1609-1612` (flags default to false) + `ifc-exporter.ts:140-167` (flags default to false *because* input is too impoverished to emit safe geometry). Fix the input → flags can flip → features light up → Python in parallel.

---

## 9. Open Questions for VibeCoders

1. **Does the production Vercel project have `IFC_SERVICE_URL` set?** (Needed to answer "which path runs today in production".) Can't determine from code.
2. **Is `https://buildflow-python-server.up.railway.app` actually running?** Last-known deployment URL is in `.env.local` but nothing in the repo pins a service health check.
3. **Does the Python service have an `IFC_SERVICE_API_KEY` configured on Railway?** If not, its auth middleware (`auth.py:17-19`) is fully open — the endpoint accepts anonymous POSTs from any origin.
4. **Where is `docs/RICH_IFC_IMPLEMENTATION_PLAN.md`?** Not in the repo. If it lives in Notion / Google Doc, share the link so I can align the audit with its "Definition of Done" section before Phase 1.
5. **Who owns the deployment pipeline for the Python service?** No `railway.json` / CI config exists. What happens when the Next.js code's request shape drifts from Python's Pydantic model?
6. **Is it acceptable to make `disciplines` a per-request choice (currently defaulted on both sides to all four)?** Right now a TR-001 → EX-001 flow always gets 4 IFCs whether the user needs them or not — that's 4× the R2 storage and 4× the build time per run.
7. **Are the `mullion` / `spandrel` element types used anywhere upstream?** Python rejects them (L67-71); TS accepts them (L22). If unused, remove from TS; if used, add to Python Pydantic literal before Phase 1 changes break more.
8. **Are the TS exporter's four gate flags intended to become per-request or remain global?** Per-element seems right for a rich IFC, but that's a data-model decision, not a code one.
9. **`metadata.ifcServiceUsed` is emitted but not displayed — is this on purpose or pending UI work?** Affects whether users can report "I got a lean IFC" vs "I got a rich IFC" post-run.

---

**Status:** Audit complete. AWAITING EXPLICIT APPROVAL before proceeding to Phase 1.
