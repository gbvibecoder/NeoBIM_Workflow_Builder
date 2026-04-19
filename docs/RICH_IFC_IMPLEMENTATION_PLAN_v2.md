# Rich IFC Implementation Plan v2 — Ultra-Realistic Multi-Discipline IFC

**Version:** 2.0 (supersedes v1 RICH_IFC_IMPLEMENTATION_PLAN.md)
**Date:** 2026-04-18
**Ground truth:** docs/ifc-feature-technical-report.md (v2, 806 LOC) + docs/ifc-feature-functional-report.md (v2, 322 LOC)
**Phase 1 Track A:** Complete. Observability layer live on `feature/rich-ifc-phase-1`.

---

## Goal (precise)

When a user provides a minimal brief like *"5-storey mixed-use, 1,800 m²/floor, Pune, RCC frame"*, BuildFlow produces a federated IFC4 package with:

1. **Architectural discipline** — full spatial hierarchy, walls with openings cut properly, roofs with pitch semantics, railings, furniture per room type, proper material layer sets with fire/acoustic/thermal ratings, classifications (CSI + NBC India + Uniclass), zones, space boundaries, visual styled items.
2. **Structural discipline** — physical + analytical model, footings at columns, beams/columns with IS-808 profiles, rebar in concrete members, material grades (IS 456, IS 800), `IfcStructuralAnalysisModel` with load cases (DL/LL/WL/EL per IS 1893), boundary conditions, applied actions. Engineer-friendly for ETABS/SAP2000 round-trip.
3. **MEP discipline** — HVAC + plumbing + electrical + fire as `IfcDistributionSystem`s with proper `PredefinedType`, ducts/pipes/trays with real direction vectors + bodies, fittings at every turn (bends, tees, reducers), valves (gate, check, ball), terminals (diffusers, WCs, fixtures), equipment (AHU, pumps, panels), full port topology via `IfcDistributionPort` + `IfcRelConnectsPorts`. Traceable in Solibri/Navisworks.
4. **Coordination** — clash-reduced (not zero but dramatically lower than current), openings cut where MEP penetrates structure, space boundaries aligned, deterministic GUIDs for versioning.
5. **Visual quality** — styled items per element, optional textures, presentation layers per discipline, lighting fixtures, furniture sets per space type.
6. **Regional compliance** — `IfcPermit` with RERA/NBC data, `IfcApproval` stamps, seismic/wind zones, Indian EPD references, classifications per region.

All driven procedurally from minimal user input. The user types "5-storey residential, Pune" and gets fire ratings per NBC Part 4, seismic zone from IS 1893 based on city, M25 concrete grade by default for residential, bedroom furniture sets per bedroom-tagged space, etc. The system fills in what the user didn't say, using Indian standards as defaults.

---

## Guardrails (non-negotiable, inherited from VibeCoders operating rules)

1. **Read before write.** Every phase begins with a discovery pass on the actual code. Cite file:line for every claim.
2. **Additive only.** Every change extends existing behavior. Zero fields removed. Zero API contracts broken. Every feature in "Reliably supported today" (functional report § 4) continues to work after each phase.
3. **Feature-flagged.** Every new capability gates behind a flag. Defaults stay conservative until validated.
4. **Granular commits.** One logical change per commit. Each phase is its own branch off `upstream/main`.
5. **Localhost verification before push.** Claude Code does not push without visual confirmation in BlenderBIM + Revit on a canonical fixture.
6. **Production stays green.** Immediate revert if any deploy breaks existing functionality.
7. **Python path is the primary** — richness work lands on Python first; TS fallback stays lean (its gate flags are intentional debris-avoidance).

---

## Why this plan differs from v1

The Phase 0 audit proved the TS exporter already contains richer emitters than Python — but those emitters produce "flying debris" on non-rectangular buildings (that's why the gate flags default off). v1 proposed unlocking TS flags as the fastest win. **v2 rejects that.** TS fallback is infrastructure, not a product path. Users see the Python output. Therefore the richness investment must happen on the Python side, where geometry discipline is already correct and adding entities won't break layouts.

Phase 1 Track B (IFC_RICH_MODE plumbing) still ships because it serves the fallback role well — but it's no longer the richness strategy. It's graceful degradation.

---

## Phase Map

| # | Phase | What ships | Branch | Gate |
|---|---|---|---|---|
| **1 B/C/D** | Phase 1 completion | Track B (richMode plumb), Track C (input surface), Track D (baseline fixtures) | `feature/rich-ifc-phase-1` (active) | Per Track A verification pattern |
| **2** | Python parity + determinism | 5 new builders, deterministic GUIDs, real MEP direction, rectangular columns, Python test suite | `feature/rich-ifc-phase-2` | Visual diff in BlenderBIM; entity counts ≥ fixture baseline |
| **3** | Structural analysis layer | `IfcStructuralAnalysisModel`, rebar bodies, load cases, boundary conditions, material profile sets | `feature/rich-ifc-phase-3` | Round-trip to FreeCAD/Robot; analytical graph well-formed |
| **4** | MEP topology | Ports, fittings, valves, terminals, equipment, `IfcDistributionSystem` | `feature/rich-ifc-phase-4` | Navisworks/Solibri trace walks the network end-to-end |
| **5** | Coordination + visual quality | Styled items, textures, presentation layers, routing helpers, opening auto-generation, optional topologicpy adoption decision | `feature/rich-ifc-phase-5` | TR-016 clash count ≤ budget on rich fixture; BlenderBIM visual |
| **6** | Classification + regional compliance | `IfcClassificationReference`, `IfcPermit`, `IfcApproval`, `IfcZone`, 2nd-level space boundaries | `feature/rich-ifc-phase-6` | Solibri validation passes for CSI + NBC classifications |
| **7** | Procedural enrichment upstream | New node TR-013 "Discipline Enricher" + building-type realism presets; auto-derives structural/MEP data from minimal brief | `feature/rich-ifc-phase-7` | End-to-end: minimal brief → rich federated IFC in production |

Each phase: 1-2 weeks of focused work for Govind + validation pass with a BIM consultant where relevant.

---

## Phase 1 (B + C + D) — in progress

### 1.B — `IFC_RICH_MODE` plumbing

Already specified in `docs/ifc-phase-1-subplan.md`. Recap: env var `IFC_RICH_MODE` + per-run `inputData.richMode` override, resolves to TS exporter gate flags. Default `"off"`. Python path unaffected.

**Framing note:** Phase 1 Track B is **fallback infrastructure preparation**, not the richness strategy. Richness lives on Python in Phases 2-6.

### 1.C — Input surface extension

26 new optional fields on `ElementProperties`, mirrored in Python Pydantic. 13 new element type literals. See sub-plan § C1-C3 for exact fields.

**Critical:** these fields are declared now so Phase 2-4 builders have a contract to consume. Phase 1 itself does not implement builder consumption — declaring is enough.

### 1.D — Baseline fixtures

Generate baseline IFCs from both paths on `sample_geometry.json`. Commit to `neobim-ifc-service/tests/fixtures/baseline/phase0/`. Commit entity-count report. Commit `scripts/count-ifc-entities.py`.

**Baseline to beat:** production `cultural_pavilion_2026-04-17` = 504 KB across 4 files, 250 KB combined. By end of Phase 4, same input → ≥ 5 MB combined with ≥ 20× entity count.

**Current Docker image size baseline:** record via `docker images neobim-ifc` and capture in entity_counts.md. Phase 5 topologicpy decision compares against this.

---

## Phase 2 — Python Parity + Determinism

**Goal:** Close the gap between Python and TS's default-flag output. Make Python emit proper IfcRoof, IfcRailing, IfcFooting, IfcFurniture. Fix determinism. Fix the MEP direction bug.

### 2.1 Discovery (read-only)

1. Read every file in `neobim-ifc-service/app/services/` end to end. Produce `docs/ifc-phase-2-audit.md`.
2. Confirm the current gaps match technical report § 11 items 2, 9, 10, 11.
3. Identify the exact lines where `IfcBuildingElementProxy` is used as a workaround for proper entity types (e.g., `ifc_builder.py:259-267` for balcony/canopy/parapet).

### 2.2 Deterministic GUIDs

**New file:** `neobim-ifc-service/app/utils/guid.py` (port from TS `ifc-exporter.ts:177-199`)

- UUID v5 with buildingSMART namespace `6ba7b811-9dad-11d1-80b4-00c04fd430c8`.
- Compressed to 22-char base-64 per IFC spec.
- `make_guid(project_identifier, element_stable_id)` — deterministic.
- `make_random_guid()` — preserved for elements with no stable ID.

**Migration:** `ifc_builder.py` pass an optional `project_identifier` through to every `.create_*` call. When present, derive GUIDs from `{project_identifier}::{element.id}`. When absent, fall back to random (current behavior).

**Impact:** re-runs of the same input now produce identical element GUIDs. Revit's "compare to last version" works correctly.

### 2.3 New builders

One file each, ~100-200 LOC.

- **`roof_builder.py`** — `IfcRoof` (not IfcSlab). Accepts `roofForm` in `{FLAT_ROOF, SHED_ROOF, GABLE_ROOF, HIP_ROOF, MONO_PITCH_ROOF}`. Generates sloped geometry when pitch > 0. Creates nested `IfcSlab` children representing roof surfaces when multi-surface.
- **`railing_builder.py`** — `IfcRailing` with `PredefinedType` ∈ {HANDRAIL, GUARDRAIL, BALUSTRADE, TOPRAIL}. Placed along edge polyline from input. Emits simple handrail + balusters geometry.
- **`footing_builder.py`** — proper `IfcFooting` with `PredefinedType` ∈ {PAD_FOOTING, STRIP_FOOTING, PILE_CAP, CAISSON_FOUNDATION}. Sized from column/wall above if present, else from input.
- **`furniture_builder.py`** — `IfcFurniture` with `PredefinedType` via property sets. Minimum viable: bed, desk, chair, sofa, table, cabinet, wardrobe, shelf. Box-representation geometry.
- **`curtain_wall_builder.py`** — proper `IfcCurtainWall` with nested `IfcMember(MULLION)` and `IfcPlate(CURTAIN_PANEL)` via `IfcRelAggregates`. Gated `emitBodyGeometry` per member/plate so the existing debris risk is controlled.

### 2.4 Geometric correctness fixes

- **MEP direction** in `mep_builder.py:58, 119, 181`: when `len(vertices) >= 2`, compute `direction = normalize(v1 - v0)` and extrude along that vector. Fall back to world +X only when length is scalar.
- **Rectangular columns** in `column_builder.py`: branch on `radius` vs `width + length` presence. Emit `IfcRectangleProfileDef` when rectangular.
- **Beam profiles** in `beam_builder.py`: when `profileType` starts with `"ISMB"` / `"ISLB"` / `"ISHB"`, look up in new `material_profile_library.py` (see 2.5) and emit correct flange/web dimensions. Default fallback to current 15/10 mm I-section when unrecognized.
- **Balcony/canopy/parapet dedicated entities** in `ifc_builder.py:259-267`: route to proper `IfcSlab(CANTILEVER)` / `IfcCovering` / `IfcRailing` instead of blanket `IfcBuildingElementProxy`.

### 2.5 Material profile library

**New file:** `neobim-ifc-service/app/services/material_profile_library.py`

- IS 808 section catalogues (ISMB 100 through ISMB 600, ISLB, ISHB).
- Each section → `IfcIShapeProfileDef` with exact flange width, flange thickness, web thickness, depth per IS spec.
- Exposed as `get_profile(profile_type: str) -> IfcProfileDef | None`.
- Used by `beam_builder.py` and later by `column_builder.py` for steel columns.

Port catalogue data from TS exporter (find via grep on `ifc-exporter.ts` for "ISMB"). Do NOT hand-type values — copy them from the TS source and add a unit test asserting numbers match.

### 2.6 Python test suite bootstrap

**New files under `neobim-ifc-service/tests/unit/`:**
- `test_wall_builder.py`, `test_slab_builder.py`, `test_column_builder.py`, `test_beam_builder.py`, `test_mep_builder.py`, `test_opening_builder.py`, `test_space_builder.py`, `test_stair_builder.py`
- Each: minimum 3 tests — happy path, edge case, invalid input.
- Plus tests for the 5 new builders from 2.3.
- Plus `test_guid.py` for determinism.
- Plus `test_ifc_builder_integration.py` that runs the full `sample_geometry.json` and asserts entity counts increase over Phase 0 baseline.

**CI wiring:** run Python tests on PR via GitHub Actions (new `.github/workflows/python-service-tests.yml`). Fail the PR if Python tests don't pass.

### 2.7 Input discovery: building defaults library

**New file:** `neobim-ifc-service/app/services/building_defaults.py`

Given minimal input (`buildingType`, `floors`, `region`), return defaults for everything the user didn't specify:

- `materialGrade` defaults per building type (residential ≤5 storeys → M25 + Fe500; residential 6-15 → M30 + Fe500D; commercial → M30; industrial → M40+Fe550).
- `fireRatingMinutes` per NBC Part 4 (residential wall exterior 120 min, door 30 min; commercial 120 / 60).
- `supportType` at ground level → `fixed`, intermediate → `pinned`.
- `spanType` inferred from column-count along element axis.
- Wall thickness defaults per building type.
- Material preset name per building type (already exists in `material_library.py` L145-157 — formalize + extend).

**Applied in `ifc_builder.py` during element creation:** if `element.properties.materialGrade is None`, fill from `building_defaults.get_material_grade(building_type, storey_index)`. Same pattern for every newly-added field.

Python's first job is to **make the output rich even when the input is sparse.**

### 2.8 Deliverables

- Branch `feature/rich-ifc-phase-2-parity` with ~15 commits.
- `docs/ifc-phase-2-audit.md` — current gap inventory.
- `docs/ifc-phase-2-completion.md` — before/after entity count delta, per-discipline file size delta, visual screenshots from BlenderBIM.
- Phase 0 baseline fixtures re-generated as `phase2/` and committed; entity count table compared against phase0.

**Gate for merge:**
- Python test suite green (new).
- Existing Next.js test suite green (1958 tests).
- BlenderBIM visual verification: roof pitch visible, railings on stairs, footings under columns, rectangular columns when configured.
- Revit import round-trip: no errors, all disciplines recognized.

---

## Phase 3 — Structural Analysis Layer

**Goal:** Ship `IfcStructuralAnalysisModel` with real analytical members + loads + boundary conditions. Ship `IfcReinforcingBar` with bodies. Engineer-grade output.

### 3.1 Discovery

Read existing `ifc_builder.py`, current beam/column/slab builders. Identify which elements will participate in the analytical model. Produce `docs/ifc-phase-3-audit.md`.

Critical question: **which Python `ifcopenshell.api` calls produce analytical entities?** `ifcopenshell.api.run('structural.add_model', ...)` etc. Validate the API surface exists at 0.8.5 before committing to the approach.

### 3.2 Analytical model orchestrator

**New file:** `neobim-ifc-service/app/services/structural_analysis_builder.py`

Creates one `IfcStructuralAnalysisModel` under the project (sibling to `IfcBuilding`). Contains:

- **Analytical members:**
  - Beams/columns → `IfcStructuralCurveMember` (line along member centroid axis).
  - Walls/slabs → `IfcStructuralSurfaceMember` (surface at midplane).
  - Linked to physical via `IfcRelAssignsToProduct` — physical is `RelatingProduct`, analytical is `RelatedObject`.

- **Connectivity:**
  - `IfcStructuralPointConnection` at nodes where multiple members meet.
  - `IfcStructuralCurveConnection` at shared edges.
  - Wired via `IfcRelConnectsStructuralMember`.

- **Boundary conditions:**
  - `IfcBoundaryNodeCondition` at supports.
  - Translated from `element.properties.supportType`:
    - `"fixed"` → translational + rotational restraint all 3 axes.
    - `"pinned"` → translational only.
    - `"roller"` → translational on one axis.
  - Defaults (from `building_defaults.py`): ground-level columns → fixed.

- **Load cases + actions:**
  - Four standard IS-compliant cases:
    - `DL` (Dead Load) — auto-computed from material density × volume per physical member.
    - `LL` (Live Load) — from occupancy per IS 875 (residential 2 kN/m², office 3 kN/m², commercial 4 kN/m², assembly 5 kN/m²).
    - `WL` (Wind Load) — from IS 875 Part 3 wind zone (city-indexed).
    - `EL` (Earthquake Load) — from IS 1893 seismic zone (city-indexed).
  - Each case: `IfcStructuralLoadCase` + `IfcStructuralLoadGroup`.
  - Per-element `IfcStructuralLinearAction` (UDL) / `IfcStructuralPointAction` (concentrated) populated from `designLoadKnPerM` / `designLoadKn` if set, else from case defaults.

- **Load combinations** per IS 456 + IS 1893:
  - `1.5 DL + 1.5 LL`
  - `1.2 DL + 1.2 LL + 1.2 WL`
  - `1.5 DL + 1.5 EL`
  - etc.
  - Each as `IfcStructuralLoadGroup` with `PurposeType=LOAD_COMBINATION`.

**Gate:** `options.enableStructuralAnalysis: bool = False` by default. Flip to `True` in production after validation.

**Reference:** BlenderBIM has analytical model test fixtures in their GitHub. Use those to verify the graph structure before committing emission code.

### 3.3 Reinforcement

**New file:** `neobim-ifc-service/app/services/reinforcement_builder.py`

Ports TS exporter rebar logic (`ifc-exporter.ts:4196-4329`) to Python:

- Given a concrete column/beam, compute rebar layout from `rebarRatio` or `rebarSpec`.
- Main bars: `IfcReinforcingBar` (BarRole=MAIN), geometry as `IfcSweptDiskSolid` along the member axis, set back from surface by cover (50 mm default).
- Stirrups: `IfcReinforcingBar` (BarRole=LIGATURE), rectangular path around the member cross-section, repeated at spacing.
- Linked to host concrete element via `IfcRelAssignsToProduct` (rebar group) or `IfcRelAggregates`.

**Heavy gate:** `options.emitReinforcementGeometry: bool = False`. Rebar bodies are expensive. Default emits metadata-only (empty representation, full property set) which preserves BBS workflows.

### 3.4 Material grades + mechanical properties

Extend `material_library.py`:

- `create_concrete_material(grade: str) -> IfcMaterial`:
  - Grade ∈ {M20, M25, M30, M35, M40, M45, M50}.
  - Attach `Pset_MaterialMechanical` with characteristic compressive strength `f_ck` (20-50 MPa), Young's modulus `E = 5000√f_ck`, Poisson 0.18, density 24 kN/m³.
- `create_steel_material(grade: str) -> IfcMaterial`:
  - Grade ∈ {Fe250, Fe415, Fe500, Fe500D, Fe550, IS 2062 E250}.
  - `Pset_MaterialMechanical`: yield strength `f_y` (250-550 MPa), ultimate strength, E=210 GPa, Poisson 0.3, density 78.5 kN/m³.
- When `element.properties.materialGrade` is set, use the grade-based factory; otherwise fall back to existing preset path.

### 3.5 Foundation auto-generation

In `building_defaults.py`: when no foundation is specified for a ground-floor column, auto-generate a pad footing beneath. Footing size from column load (DL from above summed via analytical model × safety factor ÷ soil bearing capacity default 200 kN/m²).

### 3.6 Deliverables

- Branch `feature/rich-ifc-phase-3-structural` with ~12 commits.
- Analytical model validated in BlenderBIM's "Structural Model" panel.
- **External validation:** export IFC, open in FreeCAD FEM or save for Robot Structural Analysis import, confirm analytical members import cleanly.
- `docs/ifc-phase-3-completion.md` with analytical model entity counts + "How to use the analytical model" user-facing snippet.

**Gate for merge:** BIM/structural partner reviews the analytical model in an FEA tool. This phase is correctness-critical — do not merge on "it visualizes OK" alone.

---

## Phase 4 — MEP Topology

**Goal:** MEP systems that are traceable. Walk from a boiler through a pipe through a valve into a terminal in Solibri's trace tool and have the trace complete. Every segment has ports, every port has a connection.

### 4.1 Discovery

Read `mep_builder.py` end-to-end. Identify: does ifcopenshell have port helpers (`ifcopenshell.api.run('system.add_port', ...)`)? If yes, use them. If no, construct manually.

Produce `docs/ifc-phase-4-audit.md`.

### 4.2 Port infrastructure

**New file:** `neobim-ifc-service/app/services/mep_ports.py`

- Helper `add_ports(element, start_point, end_point, flow_direction)`:
  - Creates two `IfcDistributionPort`s, one at each endpoint.
  - `FlowDirection` ∈ {SOURCE, SINK, SINKANDSOURCE, NOTDEFINED} from input.
  - Attaches ports to parent via `IfcRelNests` (IFC4 pattern — port nested inside its owning distribution element).
- Helper `connect_ports(port_a, port_b)`:
  - Creates `IfcRelConnectsPorts`.
  - Optional `RealizingElement` reference.

Applied to every duct/pipe/tray segment in Phase 4.3.

### 4.3 Fittings

**New file:** `neobim-ifc-service/app/services/mep_fittings_builder.py`

Emits `IfcDuctFitting`, `IfcPipeFitting`, `IfcCableCarrierFitting` with:

- `PredefinedType` ∈ {BEND, TEE, CROSS, REDUCER, OFFSET, TRANSITION, JUNCTION}.
- N ports matching topology (bend=2, tee=3, cross=4).
- Simple geometry: swept solid along centerline arc, or box for simple junctions.

**Auto-insertion:** when two segments share an endpoint and have different directions, auto-insert a bend fitting between them. When three segments meet, auto-insert a tee. When four, a cross.

Handled in `ifc_builder.py` as a post-pass over MEP elements once all segments have ports.

### 4.4 Valves + terminals + equipment

**New file:** `neobim-ifc-service/app/services/mep_components_builder.py`

- `IfcValve` with `PredefinedType` ∈ {GATEVALVE, CHECKVALVE, BALLVALVE, GLOBEVALVE, BUTTERFLYVALVE, PRV}.
- `IfcFlowController` — dampers, flow regulators.
- `IfcFlowMovingDevice` — `PredefinedType` ∈ {PUMP, FAN, COMPRESSOR}.
- `IfcFlowStorageDevice` — tanks.
- `IfcFlowTreatmentDevice` — filters.
- `IfcFlowTerminal` extended with proper sub-types:
  - `IfcAirTerminal` (DIFFUSER, GRILLE, REGISTER, LOUVRE).
  - `IfcSanitaryTerminal` (TOILETPAN, WASHBASIN, BATH, SHOWER, SINK, URINAL).
  - `IfcLightFixture` + `IfcLamp`.
  - `IfcElectricAppliance`.
  - `IfcOutlet` (AUDIOVISUALOUTLET, COMMUNICATIONSOUTLET, POWEROUTLET, DATAOUTLET).
- `IfcUnitaryEquipment` — AHU, FCU, rooftop unit.
- `IfcElectricDistributionBoard`, `IfcTransformer`, `IfcSwitchingDevice`.

Each accepts input dimensions and emits box geometry + proper Pset.

### 4.5 Distribution systems

Replace current hard-coded 3 systems in `ifc_builder.py:272-275` with dynamic `IfcDistributionSystem` emission:

- One system per unique `systemName` across MEP elements.
- `PredefinedType` from `systemPredefinedType` (valid IFC4 `IfcDistributionSystemEnum` values — SUPPLYAIR, RETURNAIR, EXHAUSTAIR, DOMESTICCOLDWATER, DOMESTICHOTWATER, ELECTRICAL, LIGHTING, FIREPROTECTION, STORMWATER, WASTEWATER, etc.).
- Members grouped via `IfcRelAssignsToGroup`.
- Services building via `IfcRelServicesBuildings`.

### 4.6 Procedural MEP generation (foundation for Phase 7)

Today the Python service builds only what's provided. For a sparse user brief, there's no MEP in input. Phase 4 doesn't fix this directly — Phase 7 adds the TR-013 node that auto-generates MEP backbones. But Phase 4 ensures that when MEP data IS provided, the output is rich.

### 4.7 Deliverables

- Branch `feature/rich-ifc-phase-4-mep` with ~10 commits.
- Solibri "Trace" tool walks from equipment through the network to terminals.
- Navisworks "Clash Detective" doesn't explode with invalid topology errors.
- `docs/ifc-phase-4-completion.md` with MEP topology diagram + system-by-system walkthrough.

**Gate for merge:** MEP consultant (or you + Navisworks trial) validates connectivity via trace tool.

---

## Phase 5 — Coordination + Visual Quality

**Goal:** Clash-reduced output. Visual polish. Optional topologicpy adoption decision.

### 5.1 Opening auto-generation

**New file:** `neobim-ifc-service/app/services/coordination_openings.py`

For each MEP segment crossing a wall (AABB intersection), emit `IfcOpeningElement` sized to segment diameter + 50 mm clearance. Use existing opening pattern from `wall_builder.py`.

For slab crossings: `IfcOpeningElement` + `IfcRelVoidsElement` with slab host.

**Gate:** `options.autoCutServiceOpenings: bool = True`. On by default because it's objectively correct.

### 5.2 MEP routing helper

**New file:** `neobim-ifc-service/app/services/coordination_routing.py`

Zone-based routing — when `enableClashFreeRouting=True`:

1. Compute three bands per storey:
   - **Ceiling plenum** — 300-600 mm below slab top.
   - **Floor service** — 50-150 mm above slab.
   - **Vertical shaft** — dedicated area per input.

2. For each MEP segment without explicit Z:
   - HVAC ducts → ceiling plenum Z.
   - Domestic hot/cold → floor service or plenum.
   - Waste/sewage → floor service + gravity slope.
   - Electrical trays → ceiling plenum.

3. When a segment crosses from one zone to another (vertical transition), auto-insert a fitting + vertical segment.

**Gate:** `options.enableClashFreeRouting: bool = False`. Off by default pending validation. On when topologicpy decision is made.

### 5.3 Internal clash self-check

After all elements created, before IFC serialization, run AABB clash check (port Python version of `src/features/3d-render/services/clash-detector.ts`).

Returns `coordinationWarnings: list[dict]` in response metadata:

```python
{
  "severity": "hard" | "soft",
  "element_a_id": str, "element_a_type": str,
  "element_b_id": str, "element_b_type": str,
  "overlap_volume_m3": float,
  "storey": str,
}
```

Does NOT fail the build. Returns file + warnings. UI surfaces warnings in EX-001 artifact metadata.

### 5.4 Visual styled items

**New file:** `neobim-ifc-service/app/services/visual_styling.py`

Maps material → RGB + transparency:

- Concrete → RGB(180, 180, 180), 0.0 trans
- Brick → RGB(180, 80, 60), 0.0
- Wood → RGB(160, 110, 60), 0.0
- Steel → RGB(130, 150, 180), 0.0
- Glass → RGB(180, 210, 230), 0.65 trans
- Aluminium → RGB(200, 200, 210), 0.0
- Ceramic tile → RGB(220, 220, 210), 0.0

Emits `IfcStyledItem` + `IfcSurfaceStyle` + `IfcSurfaceStyleShading` per material layer.

Attached to materials via `IfcMaterialDefinitionRepresentation`. Viewers pick up colors automatically.

**Optional textures (Phase 5.1 or defer):** `IfcSurfaceStyleWithTextures` + `IfcImageTexture` referencing R2-hosted texture files. Requires a texture library (brick.jpg, wood_grain.jpg, etc.) uploaded to R2. Defer to Phase 5.2 if library isn't ready.

### 5.5 Presentation layers

Per `IfcPresentationLayerWithStyle`:
- "A-Walls", "A-Doors", "A-Windows", "A-Roofs", "A-Furniture"
- "S-Structure", "S-Foundation", "S-Rebar"
- "M-HVAC", "M-Plumbing", "M-Electrical", "M-Fire"

Each element assigned to one layer. Enables layer-toggle in Navisworks/ArchiCAD.

### 5.6 topologicpy decision point

At this point, evaluate whether topologicpy adoption is needed:

**Skip topologicpy (lighter path) if:**
- Phase 5.1-5.3 coordination is producing acceptable clash counts.
- Space boundaries remain 1st-level (no EnergyPlus export requested).
- Docker image size stays under 1 GB.

**Adopt topologicpy if:**
- 2nd-level space boundaries are needed for energy analysis export.
- Clash counts remain high despite coordination.
- MEP routing through spaces needs graph-based path finding.
- Docker image can grow to ~2 GB (Railway upgrade acceptable).

**If adopted:**
- New branch `feature/rich-ifc-phase-5-topologicpy`.
- Add `topologicpy` to `requirements.txt`.
- Docker base image changes from `python:3.11-slim` to a heavier base (possibly `ubuntu:22.04` with OpenCascade libs).
- New file `topology_analysis.py` with space boundary detection, cell complex building, MEP routing.
- Generation time budget: accept +30-60 s for topologically-enhanced output.

### 5.7 Deliverables

- Branch `feature/rich-ifc-phase-5-coordination` with ~15 commits (or +topologicpy sub-branch).
- Navisworks Clash Detective comparison: Phase 4 fixture → Phase 5 fixture. Target: ≥ 70% reduction in hard clashes.
- BlenderBIM visual: colors applied to materials, presentation layers toggleable.
- `docs/ifc-phase-5-completion.md` with clash reduction metrics + decision record on topologicpy.

**Gate for merge:** user's "without clashes" test — run a 5-storey mixed-use brief end-to-end, open federated IFC in Navisworks, confirm clash count is manageable (defined as a specific number in the completion doc).

---

## Phase 6 — Classification + Regional Compliance

**Goal:** Ship `IfcClassificationReference` across all elements. Ship `IfcPermit` + `IfcApproval`. Ship `IfcZone`. Upgrade to 2nd-level space boundaries if Phase 5 adopted topologicpy.

### 6.1 Classification library

**New file:** `neobim-ifc-service/app/services/classification_library.py`

Ports TS exporter data at `ifc-exporter.ts:6121-6207`:
- CSI MasterFormat division → category → title.
- NBC India Part 4 occupancy codes (A-G).
- Uniclass 2015 tables.
- OmniClass 2013 tables.
- Uniformat II 2009 codes.
- DIN 276-1:2018 codes.

Each element type has default classification codes for each system. Overridable via `element.properties.classificationCode` + `classificationSystem`.

Emits `IfcClassification` (once per system) + `IfcClassificationReference` (per code) + `IfcRelAssociatesClassification` linking element to reference.

### 6.2 Zones

**New file:** `neobim-ifc-service/app/services/zone_builder.py`

`IfcZone` + `IfcRelAssignsToGroup` for:

- Functional zones (residential unit, office suite, retail unit).
- Thermal zones (for HVAC).
- Fire compartments per NBC Part 4.
- Security zones.

Auto-inferred from space names when possible. Overridable via `element.properties.zoneName`.

### 6.3 Indian permits + approvals

Port TS logic:
- `IfcPermit` with `ControlType="PERMIT"`, `Name="RERA"`, ID from input, `ValidUntil` date.
- Also: fire NOC, environmental clearance, municipal approval, BU permit.
- `IfcApproval` for design review milestones.

Input surface: new `projectMetadata` block (optional) on `ExportIFCRequest` with rera registration, permit numbers, etc.

### 6.4 Seismic + wind zones on building Pset

Building-level `Pset_BuildFlow_Regional`:
- `SeismicZone` (I-V per IS 1893).
- `SeismicZoneFactor`.
- `WindZone` (I-VI per IS 875).
- `BasicWindSpeed`.
- Derived from `location` (city → IS table lookup).

### 6.5 2nd-level space boundaries (if topologicpy adopted)

`IfcRelSpaceBoundary2ndLevel` emitted where wall/slab faces align with space faces. Required for energy analysis round-trip.

### 6.6 Deliverables

- Branch `feature/rich-ifc-phase-6-compliance` with ~10 commits.
- Solibri validation run: confirm classifications, zones, permits all render.
- `docs/ifc-phase-6-completion.md`.

---

## Phase 7 — Procedural Enrichment Upstream (TR-013 Discipline Enricher)

**Goal:** The user's dream: type "5-storey mixed-use Pune" → get everything above automatically.

### 7.1 New node: TR-013 Discipline Enricher

**File:** `src/app/api/execute-node/handlers/tr-013.ts`

Takes `MassingGeometry` + `buildingType` + `location` as input. Produces enriched `MassingGeometry` where every element has structural, MEP, and architectural properties populated.

**Not AI-driven** — deterministic algorithms based on building standards. Claude/GPT only used for space-naming interpretation (Phase 7 may use OpenAI for "what furniture goes in a 15 m² bedroom?" if procedural isn't enough).

### 7.2 Structural enrichment algorithm

For each structural element (from `ifcType` matching column/beam/slab/wall):

- **Columns:** infer `materialGrade` from floors + buildingType (Phase 2 defaults). Ground floor `supportType=fixed`, intermediate `pinned`. Compute tributary area → design load.
- **Beams:** infer `spanType` from endpoint connectivity graph (terminal node = cantilever; 2 columns = simple; multiple = continuous). Material follows host column.
- **Slabs:** `loadBearing=true` for all unless flagged. `predefinedType=FLOOR` or `ROOF` based on storey index.
- **Foundations:** auto-generate `foundation` element beneath each ground-floor column. Type = PAD_FOOTING + sized from tributary load.

### 7.3 MEP backbone generator

For each storey:
- **HVAC:** one primary duct trunk along longest axis, branches every 6 m, diffusers in each space. `systemName="HVAC Supply"` + return duct mirror. `systemPredefinedType=SUPPLYAIR`.
- **Plumbing:** single riser in dedicated shaft area. Horizontals per bathroom group. Cold + hot + waste as three systems.
- **Electrical:** one vertical riser per storey. Horizontal cable trays along ceiling corridors. Light fixtures per space (2 × 15 W per 10 m²). Outlets per wall (1 per 3 m).
- **Fire:** sprinkler loop on ceiling, every 3 m spacing.

All with `systemName`, `upstreamElementId`, `downstreamElementIds` populated → MEP topology builds in Phase 4.

### 7.4 Architectural enrichment

- **Zones:** `zoneName` inferred from space naming pattern (`"Bedroom"` → zone `Private`, `"Living"` → `Semi-Public`).
- **Fire ratings:** per NBC Part 4 rules for building type.
- **Furniture:** per space type from preset library (see 7.5).
- **Classifications:** default CSI + NBC code per element type.

### 7.5 Furniture presets per space type

**New file:** `src/services/furniture-presets.ts`

```ts
const FURNITURE_PRESETS = {
  bedroom: [
    { type: "furniture", subtype: "bed", dimensions: [2.0, 1.8, 0.5] },
    { type: "furniture", subtype: "wardrobe", dimensions: [2.4, 0.6, 2.2] },
    { type: "furniture", subtype: "nightstand", dimensions: [0.5, 0.4, 0.6] },
    // ...
  ],
  office: [ /* desk, chair, cabinet, ... */ ],
  living: [ /* sofa, coffee-table, tv-unit, ... */ ],
  kitchen: [ /* base-cabinets, wall-cabinets, sink, stove, fridge */ ],
  bathroom: [ /* wc, washbasin, shower, mirror */ ],
  // ... per building-type variations
};
```

Each furniture piece becomes a `GeometryElement` with `type: "furniture"` + `ifcType: "IfcFurniture"` + positioned relative to space center.

### 7.6 Wire into workflows

- New prebuilt workflow `WF-Rich-IFC-Pipeline`: IN-001 (brief) → TR-003 (description) → GN-001 (massing) → TR-013 (enrich) → EX-001 (export).
- Optional — TR-013 not wired means EX-001 gets bare GN-001 output (current behavior preserved).

### 7.7 Deliverables

- Branch `feature/rich-ifc-phase-7-upstream` with ~15 commits.
- Comparison: brief "5-storey residential Pune" → IFC via Phase 6 path vs Phase 7 path. Target: Phase 7 produces ≥ 5× element count and ≥ 3× file size.
- `docs/ifc-phase-7-completion.md` with end-to-end user journey screenshots.

**Gate for merge:** real architect or QS on the team runs the minimal-brief pipeline and confirms output is production-grade.

---

## Testing Strategy (cross-phase)

### Phase-scoped tests

Each phase adds tests. Phase 2 bootstraps the Python test suite (Phase 0 finding: zero Python tests exist). Subsequent phases grow it.

### Canonical fixtures

Three inputs kept in `neobim-ifc-service/tests/fixtures/inputs/`:

- `small_house.json` — 2-storey, 100 m²/floor residential.
- `five_storey_mixed.json` — canonical test case, matches v1 plan's Definition of Done.
- `commercial_office.json` — 10-storey steel + RCC.

Each phase commits expected outputs to `tests/fixtures/outputs/phase{N}/` with entity count JSON.

### IFC validator

Use `ifcopenshell.validate` on every produced IFC in CI. Assert zero schema violations.

### Round-trip tests

Produce IFC → parse with existing `parseIFCBuffer` (TR-007) → confirm quantity extraction still works. Catches regressions where rich geometry breaks quantity takeoff.

### Visual validation (mandatory per phase)

Every phase's merge gate includes:
- BlenderBIM screenshot with the produced IFC open.
- Revit 2024 import with no errors.
- Navisworks federated-view screenshot when applicable.

Store screenshots in `docs/ifc-phase-{N}-screenshots/`.

### Clash validation

Phase 5+ runs produced IFCs through TR-016. Hard-clash count budget:
- Phase 5 initial: ≤ 100 on `five_storey_mixed.json`.
- Phase 5 after coordination: ≤ 30.
- Phase 7 end-state: ≤ 10.

---

## Risk Register (updated)

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Python service memory on Railway free tier | High | Medium | Upgrade Railway plan by Phase 3 at latest. Set RSS budget = 512 MB for 50k-element buildings. |
| `IfcStructuralAnalysisModel` schema errors | Medium | High | Reference BlenderBIM test fixtures. Use `ifcopenshell.api.run('structural...')` helpers. Never hand-roll. External FEA tool validation gate. |
| Rich IFCs exceed 100 MB `MAX_IFC_SIZE` | Medium | Medium | Raise limit to 500 MB on R2 by Phase 5. Monitor. |
| `MassingGeometry` extension breaks existing consumers | High | High | All new fields optional. CI runs `tsc --noEmit` + full test suite on every commit. Sample geometry backward-compat test each phase. |
| Silent Python builder failures hiding bugs | Medium | Medium | Phase 2 adds element-level error tracking in response metadata. Surface in UI. |
| Coordination routes MEP into wrong zone | Medium | High | Phase 5 coordination gated off by default. Internal clash self-check reports remaining conflicts. |
| Ports + `IfcRelConnectsPorts` produce invalid graphs | Medium | Medium | Phase 4 validates input graph before emission. Rejects orphan ports. |
| Rebar geometry makes viewers slow | Low | Medium | Gate `emitReinforcementGeometry` off by default. Document as power-user feature. |
| topologicpy adoption doubles Docker image | Low (if deferred to Phase 5) | Medium | Decision point documented. Lighter path exists via manual ifcopenshell + AABB. |
| Building defaults (NBC, IS) drift from regulation updates | Low | Low | Source tables in constants with citation + revision date. Refresh yearly. |
| Procedural MEP conflicts with user-provided MEP | Medium | Medium | TR-013 skips enrichment for any discipline with ≥1 user-provided element. |

---

## Rollback Plan

Every phase is a branch. Every commit is granular. If Phase N breaks production:

1. `git revert` the merge commit.
2. Feature flags gate most new behavior. `enableStructuralAnalysis=false` etc. disable entire phase output.
3. `IFC_SERVICE_URL=""` reverts to pure TS fallback (current pre-Phase-2 behavior).

Worst case: delete the feature branch. Nothing else touched.

---

## Definition of Done — End-to-End

A minimal brief **"5-storey residential, 1800 m² GFA/floor, Pune"** goes through:

`IN-001 brief → TR-003 description → GN-001 massing → TR-013 enrich → EX-001 export`

And produces an IFC4 federated package that:

### Architectural
- [ ] Opens cleanly in BlenderBIM, Revit 2024, ArchiCAD 27, Navisworks without errors.
- [ ] ≥ 20 `IfcSpace` grouped into `IfcZone`s by function.
- [ ] Proper `IfcRoof` (not IfcSlab-as-roof) with pitch when applicable.
- [ ] `IfcRailing` on every stair and balcony.
- [ ] Furniture present per space type from preset library.
- [ ] Every architectural element has `Pset_*Common` with fire / acoustic / thermal ratings from NBC Part 4.
- [ ] `IfcClassificationReference` per element (CSI + NBC).
- [ ] Visual: per-element colors via `IfcStyledItem`. Concrete grey, brick red, glass transparent.
- [ ] Presentation layers per discipline (A-/S-/M- prefix) toggleable in Navisworks.

### Structural
- [ ] `IfcStructuralAnalysisModel` with analytical curves/surfaces matching physical members.
- [ ] Supports at ground level with correct boundary conditions.
- [ ] ≥ 4 load cases (DL, LL, WL, EL) per IS 1893.
- [ ] Load combinations per IS 456.
- [ ] Applied actions populated.
- [ ] `IfcMaterialProfileSet` with IS-808 sections for steel.
- [ ] Concrete/steel materials with `Pset_MaterialMechanical` carrying grade data.
- [ ] `IfcFooting` under every ground-floor column.
- [ ] Rebar as `IfcReinforcingBar` with metadata (geometry optional per flag).
- [ ] Exports cleanly to FreeCAD FEM or Robot via IFC.

### MEP
- [ ] Ducts / pipes / cable trays wired through `IfcDistributionPort` + `IfcRelConnectsPorts` into `IfcDistributionSystem`s.
- [ ] Proper system `PredefinedType` enum values.
- [ ] `IfcDuctFitting` / `IfcPipeFitting` at every turn.
- [ ] `IfcValve` at isolation points.
- [ ] `IfcFlowTerminal` (diffusers, WCs, fixtures) per space.
- [ ] Equipment (AHU, pumps, panels) with proper Pset.
- [ ] Solibri "Trace" walks from equipment to terminal without breaks.

### Coordination
- [ ] Openings cut in walls/slabs where MEP penetrates.
- [ ] Navisworks Clash Detective reports ≤ 10 hard clashes on the rich fixture.
- [ ] Deterministic GUIDs: re-running same input produces byte-identical GUIDs.
- [ ] `coordinationWarnings` in response metadata empty or minimal.

### Compliance
- [ ] `IfcPermit` with RERA / NBC data when input provides it.
- [ ] Seismic + wind zones on building Pset per IS.
- [ ] Indian EPD references for Indian brands.

### Quality metrics
- [ ] TR-007 on the rich file returns ≥ 2× quantity line items vs current baseline, no regression.
- [ ] File size < 100 MB combined (headroom in 100 MB limit).
- [ ] Generation time < 120 s on Vercel + Railway happy path.
- [ ] Re-run of identical input produces identical IFC bytes (determinism).

---

## Execution Order & Next Steps

1. **Complete Phase 1** (B + C + D) on `feature/rich-ifc-phase-1`. This is already in flight per sub-plan. VibeCoders verifies Track A localhost → approves Tracks B/C/D → sign-off → merge.

2. **Phase 2** immediately after Phase 1 merge. This is the highest-ROI phase — five new Python builders close 80% of the "looks like a real IFC" gap.

3. **Phase 3 + 4** can be developed in parallel by two contributors. Phase 3 adds structural analysis (self-contained). Phase 4 adds MEP topology (self-contained). They touch different files.

4. **Phase 5** requires Phase 4 done (coordination acts on MEP). topologicpy decision made here.

5. **Phase 6** requires Phase 2 done (classifications attach to real entities).

6. **Phase 7** requires Phases 2-6 done (procedural enrichment generates data that all the builders consume).

**Full Phase 1 → Phase 7 timeline:** 8-12 weeks of focused Govind + VibeCoders work, plus BIM/structural/MEP consultant validation at Phase 3, 4, 5 gates.

**Production impact along the way:**
- Phase 1 (B/C/D): zero production impact (defaults off).
- Phase 2: Python output improves for every user of EX-001 on merge.
- Phase 3-7: each phase progressively enriches per-user output. Phase 7 is the "wow" moment where minimal briefs produce rich federated IFCs.

---

## Reading Index

For any future contributor or Claude Code session:

1. This file — `docs/RICH_IFC_IMPLEMENTATION_PLAN_v2.md` — strategic roadmap.
2. `docs/ifc-phase-0-audit.md` — starting-state capability audit.
3. `docs/ifc-phase-1-subplan.md` — Phase 1 track breakdown.
4. `docs/ifc-feature-technical-report.md` — current-state reference (v2, post-Track-A).
5. `docs/ifc-feature-functional-report.md` — non-code companion.
6. `src/features/ifc/services/ifc-service-client.ts` — probe + export entry.
7. `src/app/api/execute-node/handlers/ex-001.ts` — orchestrator.
8. `neobim-ifc-service/app/services/ifc_builder.py` — Python orchestrator.
9. `neobim-ifc-service/app/services/*_builder.py` — per-entity builders.
10. `src/features/ifc/services/ifc-exporter.ts` — 6,328-LOC TS reference for what rich IFC looks like.

---

**End of plan v2.**
