# Rich IFC Generation — Implementation Plan

> ⚠️ **SUPERSEDED by [v2](./RICH_IFC_IMPLEMENTATION_PLAN_v2.md) as of 2026-04-18.**
> **Do not execute from this file.** Key change in v2: Python-primary strategy
> replacing the TS gate-flag unlock approach. See v2 for the authoritative roadmap.
> Further amendments tracked in [v2.1 amendments](./RICH_IFC_IMPLEMENTATION_PLAN_v2_1_AMENDMENTS.md).

**Goal:** BuildFlow's IFC Exporter (EX-001) should produce a **federated, multi-discipline IFC 4** file containing:
- **Architectural**: full spatial hierarchy, walls/doors/windows/floors/roofs/stairs/railings/furniture with real geometry, materials with fire/acoustic/thermal ratings, classifications, zones.
- **Structural**: physical + analytical model, beams/columns/slabs/foundations with material grades (IS 456 concrete, IS 808/2062 steel), `IfcStructuralAnalysisModel` with loads / supports / boundary conditions, analytical representations, reinforcement where appropriate.
- **MEP**: HVAC / plumbing / electrical / fire-protection with segments + fittings + valves + terminals + equipment, proper topology via `IfcDistributionPort` and `IfcRelConnectsPorts`, grouped into `IfcDistributionSystem`s, with full property sets.
- **Clash-free**: MEP routed in ceiling plenum / shafts, openings cut where services penetrate walls/slabs, internal AABB sanity-check before returning file.

**Non-negotiable guardrails (from project rules):**
1. **READ BEFORE WRITE.** Every phase begins with a discovery pass on the actual current code. No assumptions.
2. **NO BROKEN FUNCTIONALITY.** Everything in the current "Reliable today" list (functional report §3) must still work after every phase. Regression test before merge.
3. **ADDITIVE ONLY.** New builders, new types, new options. Do not delete or reduce the TS fallback. Do not rewrite `ex-001.ts`'s contract. Do not change the 4-file output shape (`architectural` / `structural` / `mep` / `combined`).
4. **FEATURE-FLAGGED.** Every phase gates behind an option (`enableStructuralAnalysis`, `enableMEPTopology`, etc.) that defaults **off** until the phase is signed off. Production stays green.
5. **GRANULAR, REVERTIBLE COMMITS.** One commit per logical unit. Each phase is its own branch.
6. **LOCALHOST VERIFICATION BEFORE PUSH.** Claude Code does not `git push` or commit without VibeCoders's visual confirmation.
7. **OPEN IFC IN BLENDERBIM / REVIT EACH PHASE.** Don't trust the viewer alone — validate in a real BIM tool.

---

## Phase Map

| # | Phase | Where | Flag | Owner path |
|---|---|---|---|---|
| 0 | Discovery & Deployment Audit | — | — | No code changes |
| 1 | Input Enrichment | `src/types/geometry.ts`, `neobim-ifc-service/app/models/request.py`, `src/features/ifc/services/ifc-exporter.ts` (interfaces only) | — | TS-side type extensions |
| 2 | Architectural Enrichment | `neobim-ifc-service/app/services/{roof,railing,furniture,zone}_builder.py`, `property_sets.py`, `material_library.py` | `enableRichArchitecture` | Python |
| 3 | Structural Enrichment | `neobim-ifc-service/app/services/structural_*.py` (new), `material_profile_library.py` (new) | `enableStructuralAnalysis` | Python |
| 4 | MEP Topology & Fittings | `neobim-ifc-service/app/services/mep_*.py` (extended), routing helpers | `enableMEPTopology` | Python |
| 5 | Coordination Layer | `neobim-ifc-service/app/services/coordination.py` (new) — routing + opening generation + clash self-check | `enableClashFreeRouting` | Python |
| 6 | Python-First + Robust Fallback | `src/features/ifc/services/ifc-service-client.ts`, `handlers/ex-001.ts`, new `/ready` pre-check, UI banner | — | Next.js app |
| 7 | Procedural Enrichment Upstream | `src/features/ifc/services/gn-001*.ts` or a new `enrich-massing.ts` so the Python service has data to build from | `enableProceduralDisciplineEnrichment` | TS |

**Order matters.** Phase 1 unblocks 2–4. Phase 5 needs 2–4 done. Phase 6 is independent. Phase 7 can start in parallel with Phase 2 once Phase 1 types are merged.

---

## Phase 0 — Discovery & Deployment Audit (read-only, zero code changes)

**Why:** The technical report tells us the Python service has wall/slab/column/beam/stair/opening/MEP builders, but it doesn't tell us *what's currently deployed* or *what users are actually seeing in their IFC*. We need ground truth before changing anything.

### Tasks for Claude Code

1. **Deployment status check:**
   - Look at Vercel env vars (via the repo's `.env.example` and any deployment docs) for `IFC_SERVICE_URL`, `IFC_SERVICE_API_KEY`.
   - Grep the repo for any active config referencing the Python service URL.
   - Check `neobim-ifc-service/` for a deployment target indicator (`railway.json`, `render.yaml`, `fly.toml`, Dockerfile deploy notes, README).
   - Confirm whether the service appears to be deployed by checking any documented production URL.

2. **Current Python builder inventory:**
   - Read every file under `neobim-ifc-service/app/services/` end to end. For each, produce a short summary: what's built, which Ifc entities, which relationships, which property sets, which predefined types are supported. Cite line ranges.
   - Specifically check for:
     - `IfcStructuralAnalysisModel` — expected: **absent**
     - `IfcDistributionPort` / `IfcRelConnectsPorts` — expected: **absent**
     - `IfcDuctFitting`, `IfcPipeFitting`, `IfcValve`, `IfcFlowTerminal` — expected: **absent**
     - `IfcReinforcingBar`, `IfcReinforcingMesh` — expected: **absent**
     - `IfcMaterialProfileSet` (proper steel sections) — expected: **absent**
     - `IfcZone` — expected: **absent**
     - `IfcClassificationReference` usage — check whether dual CSI/NBC is actually wired into Python or only TS.
   - Flag anything NOT in the technical report.

3. **Input surface audit:**
   - Read `src/types/geometry.ts` and `neobim-ifc-service/app/models/request.py` side by side.
   - List every field on `GeometryElement.properties` currently consumed by the Python service. What's passed through vs. what's ignored.
   - Specifically check: are structural properties (rebar ratio, design load, span type) currently passable? Are MEP topology hints (upstream/downstream refs) passable? Expected: **no**.

4. **Current user-visible IFC sample:**
   - Find a fixture IFC in `tests/fixtures/` or `neobim-ifc-service/tests/fixtures/` that represents a **current** output.
   - Open it, report: how many `IfcWall`, `IfcSlab`, `IfcColumn`, `IfcBeam`, `IfcSpace`, `IfcDoor`, `IfcWindow`, `IfcDuctSegment`, `IfcPipeSegment`, `IfcCableSegment` entities. How many `IfcRelConnectsPorts`. Whether any `IfcStructuralAnalysisModel` exists. What property sets are attached to a representative wall.

### Deliverable

A markdown report `docs/ifc-phase-0-audit.md` with:
- Deployment status: DEPLOYED / NOT DEPLOYED / UNKNOWN with evidence
- Python builder capabilities matrix (what exists, what's missing, per-discipline)
- Input gap list (what we need to add to `MassingGeometry` / `request.py` to enable later phases)
- Current fixture IFC analysis (entity counts, missing entities)
- Concrete recommendation: "The fastest win is \_\_\_" (probably: deploy Python service, or add `IfcStructuralAnalysisModel`, or extend MEP topology — let the code tell us).

**STOP. Present the report to VibeCoders. Do not proceed to Phase 1 without approval.**

---

## Phase 1 — Input Enrichment

**Why:** Even if every Python builder is rich, they'll build nothing if the input doesn't carry the information. Today `MassingGeometry` carries vertices and basic `ifcType` + minimal `properties`. It cannot express:
- Structural: material grade, design load, span condition, support type, reinforcement ratio
- MEP: upstream/downstream element refs, flow direction, diameter vs. cross-section, system assignment, fitting angles
- Architectural: fire rating, acoustic rating, thermal U-value, classification code, zone membership

### Tasks for Claude Code

1. **Extend TS types** in `src/types/geometry.ts` (additive, no removed fields):
   - `ElementProperties` — add optional fields:
     - Architectural: `fireRatingMinutes`, `acousticRatingDb`, `thermalUValue`, `classificationCode`, `classificationSystem`, `zoneName`, `isExternal`, `loadBearing`.
     - Structural: `materialGrade` (e.g. `"M30"`, `"Fe500"`, `"IS 2062 E250"`), `profileType` (e.g. `"ISMB 450"`, `"rectangular-300x450"`), `designLoadKnPerM`, `spanType` (`"simple" | "continuous" | "cantilever"`), `supportType` (`"fixed" | "pinned" | "roller"`), `rebarRatio`, `analyticalSegmentStart`, `analyticalSegmentEnd`, `reinforcementLayers?`.
     - MEP: `systemName` (e.g. `"Supply Air 1"`, `"Domestic Cold Water"`), `systemPredefinedType` (matches IFC4 `IfcDistributionSystemEnum`), `flowDirection` (`"source" | "sink" | "bidirectional"`), `upstreamElementId`, `downstreamElementIds`, `diameterMm`, `widthMm`, `heightMm`, `insulationThicknessMm`, `designFlowRate`, `designPressure`.
   - `GeometryElement.type` literal — ADD new element types (do not remove existing):
     - Architectural: `roof`, `railing`, `curtain-wall`, `furniture`
     - Structural: `foundation`, `shear-wall`, `bracing`, `rebar-group`
     - MEP fittings: `duct-fitting`, `pipe-fitting`, `valve`, `flow-terminal`, `equipment-hvac`, `equipment-plumbing`, `equipment-electrical`, `air-terminal`, `sanitary-terminal`, `electrical-fixture`, `lighting-fixture`, `junction-box`

2. **Mirror in Python** `neobim-ifc-service/app/models/request.py`:
   - Add Pydantic fields matching the TS additions. All Optional with sensible defaults.
   - Extend `ElementType` literal with the new values.
   - Validate: `pydantic` must still accept existing fixtures without modification.

3. **Pass-through in exporter/service client:**
   - Confirm `ifc-service-client.ts:47-113` forwards the full `GeometryElement` shape verbatim. Add a test that a custom property (e.g. `materialGrade: "M30"`) on input appears in the request payload.
   - No logic change needed if pass-through is already shape-agnostic.

4. **Backward compatibility tests:**
   - Run `npx tsc --noEmit`. Zero new errors.
   - Run `npm test` on `tests/unit/ifc-exporter.test.ts` and `tests/unit/ifc-multi-export.test.ts`. All pass.
   - Run the existing Python service locally, send a fixture without new fields, verify it still produces a valid IFC (smoke test via `/health` and `/ready`).

### Deliverable

- A branch `feature/rich-ifc-phase-1-input-types`
- Updated `src/types/geometry.ts`
- Updated `neobim-ifc-service/app/models/request.py`
- A new integration test `tests/integration/ifc-rich-input-passthrough.test.ts` confirming new fields survive the TS→Python boundary
- `docs/ifc-phase-1-input-contract.md` documenting the new fields with a worked example per discipline

**STOP. VibeCoders runs workflow on localhost, confirms existing flow still works. Approval required.**

---

## Phase 2 — Architectural Enrichment

**Why:** Today's architectural output has walls, slabs, columns, windows, doors, spaces, stairs. Missing: roofs as first-class elements, railings, furniture, zones (groupings of spaces — e.g. "residential unit 2BHK-A"), full classification, full Psets.

### Tasks for Claude Code

1. **Read first:** Open `neobim-ifc-service/app/services/wall_builder.py`, `slab_builder.py`, `space_builder.py`, `property_sets.py`, `material_library.py`. Produce a mini-audit in `docs/ifc-phase-2-audit.md`: what's there, what's missing per element type.

2. **New builders** (all under `neobim-ifc-service/app/services/`):
   - `roof_builder.py` — `IfcRoof` with `FLAT_ROOF` / `PITCHED_ROOF` predefined types, extrudes from footprint, proper `Pset_RoofCommon`.
   - `railing_builder.py` — `IfcRailing` with `HANDRAIL` / `GUARDRAIL`, placed along an edge polyline.
   - `furniture_builder.py` — `IfcFurniture` with predefined type, material assignment.
   - `zone_builder.py` — `IfcZone` + `IfcRelAssignsToGroup` for grouping spaces (e.g. all rooms of a unit, or all public-area spaces). Zones are multi-purpose: thermal, fire compartment, functional.
   - `curtain_wall_builder.py` — `IfcCurtainWall` with nested `IfcMember` (mullions) and `IfcPlate` (panels). Flag gated; only emits when curtain-wall type elements present.

3. **Property set expansion** in `property_sets.py` (extend, don't replace):
   - Add `Pset_WallCommon` fields: `FireRating`, `AcousticRating`, `ThermalTransmittance`, `Combustible`, `SurfaceSpreadOfFlame`.
   - Add `Pset_DoorCommon` fields: `FireRating`, `SecurityRating`, `SelfClosing`, `HandicapAccessible`, `AcousticRating`.
   - Add `Pset_WindowCommon` fields: `FireRating`, `GlazingAreaFraction`, `ThermalTransmittance`, `SolarHeatGainCoefficient`.
   - Add `Pset_SlabCommon` fields: `FireRating`, `LoadBearing`, `Combustible`, `SurfaceSpreadOfFlame`.
   - Add `Pset_RoofCommon` (new function).
   - Add `Pset_SpaceOccupancyRequirements` (occupancy type, number of people, area per person).
   - Input source: `element.properties.fireRatingMinutes`, `acousticRatingDb`, etc. from Phase 1 types.

4. **Classification** in a new `classification_library.py`:
   - Load CSI MasterFormat, Uniclass 2015, OmniClass 2013, NBC India Part 4 code sets (mirror the TS arrays in `ifc-exporter.ts:6121-6207`).
   - Emit `IfcClassificationReference` + `IfcRelAssociatesClassification` on every element with a classification code.

5. **Material enrichment** in `material_library.py`:
   - Extend presets with: density, specific heat, thermal conductivity, embodied carbon kgCO2/unit (sourced from Indian EPD samples in TS exporter `ifc-exporter.ts:6101-6244` — port the catalogue to Python).
   - Use `api.run('material.add_pset', ...)` to attach `Pset_MaterialCommon` (or IFC4 equivalent).

6. **Orchestrator update** in `ifc_builder.py`:
   - New optional build parameter `enableRichArchitecture: bool = False`.
   - When true: iterate new element types (`roof`, `railing`, `furniture`), call new builders, attach zones after spaces are created, enrich Psets.
   - When false: current behavior unchanged.

### Deliverable

- Branch `feature/rich-ifc-phase-2-architectural`
- New builder files + tests per builder in `neobim-ifc-service/tests/unit/`
- A golden-file test: feed a known fixture, produce IFC, open in BlenderBIM, confirm: roofs render, railings render, zones appear in tree, Psets have fire rating values.
- Updated `docs/ifc-phase-2-architectural.md` with before/after entity counts on a canonical fixture.

**Commit granularity:** one commit per builder. One commit for `property_sets.py` additions. One commit for `classification_library.py`. One commit wiring into `ifc_builder.py`.

**STOP. VibeCoders opens the produced IFC in BlenderBIM + Revit. Visual confirmation required before merge.**

---

## Phase 3 — Structural Enrichment

**Why:** Current structural is "beams and columns with rectangular profiles, no material grade, no analytical model." A real structural IFC carries the Finite-Element-ready analytical model so SAP2000 / Robot / ETABS can round-trip.

### Tasks for Claude Code

1. **Read first:** Open `column_builder.py`, `beam_builder.py`, `slab_builder.py` (structural side), and any existing foundation logic. Mini-audit as before.

2. **Material profile library** (new file `material_profile_library.py`):
   - Port IS 808 I-section, channel, angle catalogues from TS `ifc-exporter.ts` (confirm the exact line range during discovery).
   - Each entry produces an `IfcIShapeProfileDef` / `IfcUShapeProfileDef` / `IfcLShapeProfileDef` with correct dimensions.
   - Concrete sections: rectangular, circular, T-beam via `IfcRectangleProfileDef`, `IfcCircleProfileDef`, `IfcTShapeProfileDef`.
   - Output: `IfcMaterialProfileSet` associated to the structural member via `IfcRelAssociatesMaterial`.

3. **Enhance physical member builders:**
   - `beam_builder.py`: when `element.properties.profileType = "ISMB 450"`, look up section → `IfcIShapeProfileDef`, extrude along beam axis. Fallback to rectangle if profile not found.
   - `column_builder.py`: same pattern, respect steel vs. concrete.
   - `slab_builder.py`: add `IfcSlab` predefined type handling — `FLOOR`, `ROOF`, `LANDING`, `BASESLAB`. Respect `loadBearing`.
   - New `foundation_builder.py`: `IfcFooting` with predefined type `PAD_FOOTING` / `STRIP_FOOTING` / `PILE_CAP`. Extrude a rectangular or custom profile downward by depth.
   - New `shear_wall_builder.py`: thin wrapper producing `IfcWall` with `predefined_type = SHEAR` and proper rebar ratio.

4. **Reinforcement** in new `reinforcement_builder.py`:
   - `IfcReinforcingBar` for individual bars (optional — only when `element.properties.reinforcementLayers` provided).
   - Use `IfcSweptDiskSolid` to draw bar geometry along a polyline.
   - Simplified representation: parent concrete element references a group of rebars via `IfcRelAggregates`.
   - **Gate heavily**: default off because rebar geometry is expensive. `enableReinforcementGeometry: bool = False`.

5. **Analytical model** in new `structural_analysis_builder.py`:
   - Create `IfcStructuralAnalysisModel` as a sibling of `IfcBuilding` under the project.
   - For each structural member: emit an analytical representation and link physical→analytical:
     - Beams/columns → `IfcStructuralCurveMember` (line along member axis).
     - Walls/slabs → `IfcStructuralSurfaceMember` (surface along midplane).
     - Link via `IfcRelAssignsToProduct` (physical is the `RelatingProduct`, analytical is the `RelatedObject`) — verify the direction matches IFC4 spec during implementation.
   - Emit `IfcStructuralPointConnection` at nodes, `IfcStructuralCurveConnection` at edges shared between members.
   - Emit `IfcBoundaryNodeCondition` at supports (from `element.properties.supportType`).
   - Emit one or more `IfcStructuralLoadCase` (DL, LL, WL, EL) with `IfcStructuralAction` applying to the model.
   - Reference: IFC4 documentation for `IfcStructuralAnalysisDomain`. Do NOT guess — use `ifcopenshell.api.run('structural.add_...')` or construct directly. Verify with a reference file from BlenderBIM's test suite.

6. **Material grades**:
   - Extend `material_library.py` with grade-parameterised creation: `create_concrete_material(grade="M30")` → `IfcMaterial` with `Pset_MaterialMechanical` containing compressive strength, modulus, Poisson ratio.
   - Same for `create_steel_material(grade="Fe500")` — yield strength, ultimate strength, density.

### Deliverable

- Branch `feature/rich-ifc-phase-3-structural`
- Analytical model validated: open in BlenderBIM's "Structural" viewer (BIMtester / native), confirm the analytical graph is well-formed — every beam has an analytical line, every support has a boundary condition.
- Validation against an open FEA tool: export via NeoBIM, open in FreeCAD/Robot/SAP2000 import, confirm the analytical model imports cleanly.
- `docs/ifc-phase-3-structural.md` with entity counts and a one-page "how to use the analytical model" snippet for users.

**Commit granularity:** one commit per builder. Material profile library is its own commit. Analytical model is its own commit (riskiest — isolate it).

**STOP. BIM partner / QS validates the analytical model is correct. This is a correctness-critical phase — do not merge on assumed correctness.**

---

## Phase 4 — MEP Topology & Fittings

**Why:** Current MEP is "duct segments, pipe segments, cable trays, each floating in space with no connection to anything." Real MEP IFCs have topology: duct goes to fitting goes to equipment, fittings have ports, ports connect via `IfcRelConnectsPorts`, systems group members.

### Tasks for Claude Code

1. **Read first:** `mep_builder.py` end-to-end. Mini-audit: what segments exist, what system grouping exists, are any ports created today.

2. **Port model** (new file `mep_ports.py`):
   - Helper `add_ports(element, start_point, end_point, flow_direction)` → creates two `IfcDistributionPort`s at each end of the segment.
   - Each port has `FlowDirection` (`SOURCE` / `SINK` / `SINKANDSOURCE`).
   - Attach via `IfcRelNests` (port nested inside its parent distribution element).
   - Connection: `IfcRelConnectsPorts(port_a, port_b)`.

3. **Fittings** (new file `mep_fittings.py`):
   - `IfcDuctFitting` predefined types: `BEND`, `TEE`, `REDUCER`, `OFFSET`, `TRANSITION`, `CROSS`.
   - `IfcPipeFitting` same set.
   - `IfcCableCarrierFitting` for cable tray bends.
   - Each fitting has N ports matching its topology (bend=2, tee=3, cross=4).
   - Simple geometry: a short swept solid along the bend arc, or a box representation.

4. **Valves & terminals** (new file `mep_components.py`):
   - `IfcValve` predefined types: `GATEVALVE`, `CHECKVALVE`, `BALLVALVE`, `PRV`.
   - `IfcFlowTerminal` — `AIRTERMINAL` (diffuser/grille/register), `SANITARYTERMINAL` (WC/WashBasin/Shower), `ELECTRICALFIXTURE` (LuminaryFixture/Outlet/Switch).
   - `IfcFlowController` — for dampers, flow regulators.

5. **Equipment** (extend `mep_builder.py`):
   - `IfcUnitaryEquipment` (AHU, FCU, rooftop unit).
   - `IfcPump`, `IfcFan`, `IfcBoiler`, `IfcChiller`, `IfcTank`.
   - `IfcElectricDistributionBoard`, `IfcTransformer`.

6. **System topology** (extend `mep_builder.py` `create_mep_system`):
   - Currently creates `IfcDistributionSystem`. Extend to:
     - Walk the element graph from source (equipment) through segments (via port connections) to terminals.
     - Emit `IfcDistributionCircuit` for electrical sub-circuits.
     - Proper `PredefinedType` from `IfcDistributionSystemEnum`: `SUPPLYAIR`, `RETURNAIR`, `DOMESTICCOLDWATER`, `DOMESTICHOTWATER`, `ELECTRICAL`, `LIGHTING`, `DATA`, `SEWAGE`, `FIREPROTECTION`.
   - System groups elements via `IfcRelAssignsToGroup`.

7. **Property sets** in `property_sets.py`:
   - `Pset_DuctSegmentTypeCommon` (NominalHeight, NominalWidth, Roughness, InsulationThickness, NetCrossSectionArea, HydraulicDiameter).
   - `Pset_PipeSegmentTypeCommon` (InnerDiameter, OuterDiameter, Roughness, WallThickness).
   - `Pset_CableCarrierSegmentTypeCommon` (CrossSection, NominalHeight, NominalWidth).
   - `Pset_FlowTerminalAirTerminal`, `Pset_AirTerminalOccurrence` (AirFlowrateRange, FaceType).
   - `Pset_ElectricalCircuit`.

### Deliverable

- Branch `feature/rich-ifc-phase-4-mep-topology`
- Validated via BIMcollab ZOOM or Solibri: open generated IFC, confirm "Walk" / "Trace" from a boiler through pipe → valve → pipe → terminal. The walk must work.
- `docs/ifc-phase-4-mep.md` with a system topology diagram.

**STOP. MEP specialist (if available, else VibeCoders with a Navisworks trial) validates connectivity.**

---

## Phase 5 — Coordination Layer (Clash-Free Generation)

**Why:** The user explicitly asked for "without clashes." Current generation doesn't route MEP around structure — it just places where the geometry input says. We need procedural routing + opening generation.

### Tasks for Claude Code

1. **Zone definition** in new `coordination.py`:
   - Given a storey's structural elements, compute three zones:
     - **Ceiling plenum** — below slab top, above finished ceiling height (e.g. 300–600 mm band).
     - **Floor service** — above slab, below finished floor (e.g. 50–150 mm screed).
     - **Vertical shaft** — any dedicated MEP shaft area (passed in via `MassingGeometry.shafts` — a new optional field; add in Phase 1 if not done).
   - Output: 3D AABB volumes per storey.

2. **MEP routing helper**:
   - Input: MEP segments from input (horizontal pipes/ducts).
   - Algorithm: snap each horizontal segment's elevation to the middle of the ceiling plenum for HVAC, to floor service for hydronic, to shaft for verticals.
   - For bends, insert `IfcDuctFitting`/`IfcPipeFitting` at elevation transitions.
   - Do NOT move segments that already have explicit absolute elevations set.

3. **Opening generator**:
   - For each MEP segment that crosses a wall or slab boundary (AABB intersection), emit an `IfcOpeningElement` sized to the segment diameter + clearance.
   - Use the existing `opening_builder.create_opening_in_wall` + `fill_opening` pattern.
   - For slab crossings: use `IfcOpeningElement` + `IfcRelVoidsElement` with the slab as host.

4. **Internal clash self-check**:
   - After all builders run, before serialisation, use `ifcopenshell.util.shape` or the same AABB pattern as NeoBIM's existing `clash-detector.ts` (but in Python with `ifcopenshell`) to detect any remaining hard clashes.
   - If hard clashes found, log warnings into the response `metadata.coordinationWarnings`.
   - Do NOT fail the build — return the file with warnings. The user can iterate.

5. **Option gating**:
   - `enableClashFreeRouting: bool = False` by default.
   - When on, behavior applies. When off, MEP is placed as-given (current behavior).

### Deliverable

- Branch `feature/rich-ifc-phase-5-coordination`
- Self-check report in response metadata.
- Validated via Navisworks Clash Detective: run the produced IFC against itself, confirm zero or dramatically reduced hard clashes vs. Phase 4 output on the same fixture.
- `docs/ifc-phase-5-coordination.md` explaining the routing algorithm and its limits.

**STOP. This is where the user's "without clashes" promise is tested. Validate carefully.**

---

## Phase 6 — Python-First + Robust Fallback

**Why:** Today if `IFC_SERVICE_URL` is unset, cold, or times out, the user silently gets the TS fallback with no banner. The TS fallback is intentionally geometry-poor for non-arch elements (rebar / mullions / MEP emitted as metadata only — see `ifc-exporter.ts:119-167`). This destroys the richness we just built. We need to make Python the first-class path and surface any fallback.

### Tasks for Claude Code

1. **Pre-flight health check** in `ifc-service-client.ts`:
   - New function `isServiceReady(timeoutMs = 5000): Promise<boolean>` — calls `GET {IFC_SERVICE_URL}/api/v1/ready` (already exists in `health.py`).
   - Cache result for 60 s in-memory (don't hammer the health endpoint).
   - Exposed to `ex-001.ts` handler.

2. **EX-001 handler update** (`handlers/ex-001.ts`):
   - Before calling `generateIFCViaService`, call `isServiceReady()`.
   - If not ready, add `metadata.ifcServiceCold = true` and explicitly log "Python service not ready — using TS fallback".
   - If ready but call fails, add `metadata.ifcServiceFailed = true` with the error.
   - The output artifact's `metadata` already carries `ifcServiceUsed` — extend to include `ifcServiceCold`, `ifcServiceFailed`, `ifcServiceLatencyMs`.

3. **UI banner** in `src/features/canvas/components/artifacts/` (the EX-001 artifact card):
   - When `metadata.ifcServiceUsed === false`, render a warning strip: "This IFC was generated via the TypeScript fallback — structural analysis, rebar, and full MEP geometry may be reduced. [Learn more]".
   - Link to a short doc page explaining the difference.

4. **Cold-start mitigation**:
   - Railway/Render free tiers scale to zero. Document the cold-start issue prominently.
   - Recommend upgrading to a paid Railway plan that keeps the container warm, OR use Fly.io with min-instance=1.
   - Optionally: ping the service periodically via a Vercel cron (if the budget allows) to keep it warm.

5. **Default ON for new features** (phased rollout):
   - Phase 2/3/4/5 options all default OFF. In Phase 6, flip them ON when the feature-flag tests are all green and the BIM partner has validated.
   - Controlled via env var `IFC_RICH_MODE=full|arch-only|off`. Respect it in `ex-001.ts` → `ifc-service-client.ts` option mapping.

### Deliverable

- Branch `feature/rich-ifc-phase-6-fallback`
- Banner visible in canvas when fallback path runs.
- Documentation update: `docs/ifc-service-deployment.md` with deployment instructions for Railway / Render / Fly.io, warm-keep strategies, env var reference.

**STOP. Confirm in production (staging first) that when Python is up, users always get the Python path; when Python is down, users see a banner and still get a file.**

---

## Phase 7 — Procedural Enrichment Upstream

**Why:** Even after Phases 1–6, the quality of the output is gated by the quality of `MassingGeometry` coming in. GN-001 (Massing Generator) produces geometry for walls, slabs, columns, beams, windows, doors, stairs — but minimal structural details (no rebar ratio, no analytical support conditions), minimal MEP (no system backbone), and no zones. Without upstream enrichment, the rich builders have nothing to build.

Two options (decide in discovery):
- **A.** Extend GN-001 directly.
- **B.** Create a new node `TR-013 Discipline Enricher` that takes raw massing and adds procedural discipline data. This keeps GN-001 focused on geometry and makes enrichment composable.

**Recommendation:** B — composability + testability + doesn't bloat GN-001.

### Tasks for Claude Code

1. **Decide A vs B** in a short design note `docs/ifc-phase-7-design.md`. Get approval.

2. **Structural enrichment algorithm** (deterministic, no AI needed):
   - For each column: assume material "RCC M30" for residential ≤ 5 storeys, "RCC M35" 6–15, "RCC M40+steel" above. Apply `supportType = "fixed"` at ground, `supportType = "continuous"` at intermediate.
   - For each beam: `spanType` inferred from endpoint connectivity (terminal = cantilever, two columns = simple, multiple = continuous). Material follows column.
   - Design load: DL (self-weight from material density × volume) + LL per occupancy (IS 875: 2 kN/m² residential, 3 kN/m² office, 4 kN/m² commercial, 5 kN/m² assembly).
   - Foundation: generate `foundation` element beneath each ground-floor column. Pad footing size from column load.

3. **MEP backbone generator**:
   - For each storey, generate a primary HVAC duct trunk along the longest axis, with branches every 6 m.
   - Plumbing: assume a single riser in a shaft, horizontals per bathroom group.
   - Electrical: one vertical riser per storey, horizontal cable trays along ceiling corridors.
   - Each segment gets `systemName`, `upstreamElementId`, `downstreamElementIds` populated.
   - Use Phase 5's coordination to keep them clash-free with structural.

4. **Architectural enrichment**:
   - Infer `zoneName` per space from space name pattern (`"Bedroom 1"` → zone `"Private"`, `"Living"` → `"Semi-Public"`, `"Entrance"` → `"Public"`).
   - Infer `fireRatingMinutes` per element per building-type rules (NBC India Part 4): residential walls 60 min, doors 30 min; commercial 90/60.

5. **Wire into the workflow**:
   - Option B: new handler `handlers/tr-013.ts`. Adds to `REAL_NODE_IDS` and `LIVE_NODE_IDS` (after confirming the two-list issue from technical report §5). Catalogue entry in `node-catalogue.ts`.
   - Edge: GN-001 → TR-013 → EX-001. Optional — if TR-013 not wired, EX-001 receives GN-001 directly (current behavior preserved).

### Deliverable

- Branch `feature/rich-ifc-phase-7-upstream-enrichment`
- A prebuilt workflow `wf-NN Rich IFC Pipeline`: IN-001 → TR-003 → GN-001 → TR-013 → EX-001.
- Before/after comparison: same brief into same GN-001, one with TR-013 and one without, diff the IFC entity counts. Target: >3× structural entities, >5× MEP entities, zones populated.

**STOP. Final end-to-end test with a real architect or QS on the team.**

---

## Testing Strategy (cross-phase)

1. **Unit tests per builder** — `neobim-ifc-service/tests/unit/test_{builder}.py`. Each test: build 1 element, assert IFC entity structure via `ifcopenshell`.
2. **Integration fixtures** — a set of canonical inputs (`small_house.json`, `5_storey_mixed.json`, `commercial_office.json`) kept in `neobim-ifc-service/tests/fixtures/inputs/`. Each phase adds expected-output IFCs in `tests/fixtures/outputs/phase_N/`.
3. **IFC validator** — use `ifcopenshell-validator` or `IfcCheckingTool` in CI to assert schema compliance on every produced IFC.
4. **Round-trip tests** — produce IFC → parse with `parseIFCBuffer` (the app's own parser) → confirm TR-007 quantity extraction still gives sensible numbers. This catches regressions where rich geometry breaks quantity takeoff.
5. **Visual validation** — each phase has a mandatory BlenderBIM open + screenshot.
6. **Clash validation** — Phase 5 onwards, run the produced IFC through TR-016 (NeoBIM's own clash detector). Assert: hard-clash count is within a defined budget.

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Python service cold starts make Phase 6 UX bad | Medium | Railway paid tier / Fly.io min-instance=1 / periodic Vercel cron ping |
| `IfcStructuralAnalysisModel` schema is strict — easy to produce invalid files | High | Reference BlenderBIM test fixtures; validate every output; do not hand-roll — use `ifcopenshell.api.run('structural....')` helpers |
| Large IFCs (rich MEP + structural + rebar) may exceed 100 MB R2 limit | Medium | Phase 6 adds size metrics; raise limit to 200 MB on R2 (`MAX_IFC_SIZE`) only after measurement |
| `MassingGeometry` type extension breaks existing consumers | High | All new fields optional; run `tsc --noEmit` in CI; run full test suite before merge |
| Python builder errors cascade into silent TS fallback hiding real bugs | Medium | Phase 6 banner; log Python errors with full stack into Vercel logs; alert on sustained fallback rate |
| Coordination layer moves MEP into the wrong zone | High | Phase 5 gated off by default; internal clash self-check reports remaining conflicts; visual validation mandatory |
| Ports + `IfcRelConnectsPorts` produce invalid graphs when input topology is inconsistent | Medium | Validate input graph in Phase 4 before emitting — reject orphan ports, disconnected subtrees |
| Rebar geometry makes viewers slow | Medium | Gate `enableReinforcementGeometry` off by default; document as power-user feature |

---

## Rollback Plan

Every phase is a branch. Every commit is granular. If Phase N breaks production:
1. `git revert` the merge commit.
2. Feature flags gate most of this — setting `IFC_RICH_MODE=off` disables Phases 2–5 instantly without a deploy.
3. `IFC_SERVICE_URL` unset reverts to pure TS fallback (current production behavior).

Worst case: delete the feature branch. Nothing else touched.

---

## Definition of Done — End to End

A canonical 5-storey mixed-use brief goes through:
`IN-001 brief → TR-003 description → GN-001 massing → TR-013 enrich (Phase 7) → EX-001 export (Python, Phases 2–5 on)`

And produces an IFC file that:
- [ ] Opens cleanly in BlenderBIM, Revit 2024, ArchiCAD 27, Navisworks.
- [ ] Has ≥ 20 `IfcSpace` with zones grouping them.
- [ ] Has `IfcRoof`, `IfcRailing`, optionally `IfcCurtainWall`, `IfcFurniture`.
- [ ] Every architectural element has `Pset_*Common` with fire / acoustic / thermal ratings.
- [ ] Has `IfcStructuralAnalysisModel` with analytical curves/surfaces matching physical members, supports at the base, at least DL + LL load cases.
- [ ] Structural members use `IfcMaterialProfileSet` with IS-808 sections for steel, proper concrete grades via `Pset_MaterialMechanical`.
- [ ] Has `IfcFooting` under every ground-floor column.
- [ ] MEP: ducts / pipes / cable trays wired through `IfcDistributionPort` + `IfcRelConnectsPorts` into `IfcDistributionSystem`s.
- [ ] Fittings, valves, terminals, equipment all present with proper predefined types.
- [ ] Openings cut where MEP penetrates walls/slabs.
- [ ] Navisworks Clash Detective reports ≤ 5 hard clashes (target: 0) on the rich file.
- [ ] TR-007 on the rich file returns ≥ 2× the quantity line items vs the current baseline, with no regression in existing counts.
- [ ] File size < 200 MB.
- [ ] Generation time < 120 s on the Vercel serverless / Python service happy path.
