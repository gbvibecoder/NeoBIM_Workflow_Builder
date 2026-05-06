# LOD Target Reference

**Audience:** Anyone consuming a NeoBIM IFC — designers, coordinators, structural / MEP engineers, cost estimators, contractors.

This document explains what each `target_fidelity` tier *guarantees*, what it *does not deliver*, and which IDS rule set the IFC has been validated against. Read this together with the request envelope in [`app/models/request.py`](../app/models/request.py): the `target_fidelity` field on `ExportOptions` selects the tier; Stage 2.5 (VALIDATE-IFC) of the export pipeline runs `ifctester` against the IDS files listed below before the IFC is shipped.

| `target_fidelity` | Default? | IDS rule set | Typical use case |
|---|---|---|---|
| `concept`            | no      | `core.ids` only                                                      | Client design review, early massing, area-program checks |
| `design-development` | **yes** | `core.ids` + `lod-300.ids` + the active discipline overlay           | Coordination, clash detection, cost takeoff |
| `tender-ready`       | no      | `core.ids` + `lod-300.ids` + `lod-350.ids` + the active discipline overlay | Construction tender, BOQ generation, fabrication handoff |

The discipline overlay is `architectural.ids`, `structural.ids`, or `mep.ids` based on the `disciplines` array in the export request. The `combined` discipline pulls in all three overlays.

---

## `concept` — early-stage massing

**Audience:** Architect + client during the brief / early-design phase.

**What it delivers:**
- Spatial structure: `IfcProject`, `IfcSite`, `IfcBuilding`, `IfcBuildingStorey`.
- Mass / massing-equivalent walls, slabs, openings, spaces.
- Deterministic 22-character `GlobalId` on every rooted entity.
- Project units, representation contexts.
- Names on every storey, building, site, project.

**What it does NOT deliver:**
- ❌ No `Pset_*Common` populated (no `LoadBearing`, no `IsExternal`, no `FireRating`, no `ThermalTransmittance`).
- ❌ No `Qto_*BaseQuantities` (no `NetVolume`, no `NetArea`, no `GrossVolume`).
- ❌ No rebar, no `IfcStructuralAnalysisModel`.
- ❌ No `IfcDistributionSystem` even when MEP elements are present.
- ❌ MEP / rebar / mullions may be bodyless (placeholder geometry only) — see [`feedback_ifc_visual_quality.md`](../../.. ) memory note for why this is intentional at the bodyless tier.
- ❌ No COBie Psets on doors / windows / equipment.

**IDS files validated against:**
- `core.ids` (10 spec-mandatory rules)

**Why this tier exists:** Early-stage models cost money to validate against full LOD 300 rules — and most of the data those rules check (U-values, fire ratings, occupancy types) doesn't exist yet at the brief stage. Concept fidelity says "the IFC structurally conforms to IFC4 and downstream tools can open it."

---

## `design-development` — coordination-ready (DEFAULT)

**Audience:** Coordination consultants, clash-detection workflows, cost estimators producing rough-order-of-magnitude takeoffs.

**Adds on top of `concept`:**
- `Pset_WallCommon` populated on every wall (`Reference`, `IsExternal`, `LoadBearing`).
- `Pset_SlabCommon` populated on every slab (`IsExternal`, `LoadBearing`).
- `Pset_DoorCommon`, `Pset_WindowCommon`, `Pset_ColumnCommon`, `Pset_BeamCommon` present.
- `Qto_SlabBaseQuantities` (`NetVolume`, `NetArea`).
- `Qto_SpaceBaseQuantities.NetFloorArea` populated (drives FAR / RERA carpet-area calculations).
- `IfcBuildingStorey.CompositionType` populated (Solibri / BIMcollab grouping).
- Architectural-discipline rules: `FireRating`, `OperationType`, `GlazingAreaFraction`, optional `ThermalTransmittance` for façade analysis.
- Structural-discipline rules: `LoadBearing` flags everywhere, materials assigned to columns / beams / footings, optional `Pset_FootingCommon`.
- MEP-discipline rules: `IfcDistributionSystem` present with `PredefinedType`, segments named & typed, terminals class-correct (`IfcSanitaryTerminal` for WCs not `IfcFlowTerminal`).

**What it does NOT deliver:**
- ❌ No `IfcReinforcingBar` — concrete elements are non-reinforced placeholders.
- ❌ No `IfcStructuralAnalysisModel` — analytical mesh is absent.
- ❌ `AcousticRating` and `FireRating` on doors are **optional** at this tier (warning if missing, not error).
- ❌ COBie Psets are not exhaustive — only the `*Common` set is enforced.

**IDS files validated against:**
- `core.ids`
- `lod-300.ids` (13 rules)
- `architectural.ids` (16 rules), `structural.ids` (13 rules), and/or `mep.ids` (11 rules) per active discipline.

**Why this tier is the default:** This is the level at which an IFC is useful for *coordination work* — clash detection, BOQ rough-cut, design review. Pushing earlier into `tender-ready` requires data the design team typically doesn't yet have (rebar layouts, full structural analysis); falling back to `concept` strips the metadata that makes coordination tools useful.

---

## `tender-ready` — constructible / fabrication handoff

**Audience:** General contractor, structural fabricator, MEP fabricator, cost-takeoff team producing the final BOQ and tender package.

**Adds on top of `design-development`:**
- `IfcReinforcingBar` instances in concrete columns / beams / slabs, with `NominalDiameter` and material (Fe415 / Fe500).
- `IfcStructuralAnalysisModel` — analytical mesh tied to the physical model.
- `IfcMaterialProfileSetUsage` on every column and beam (section profile unambiguous: `ISMB-450`, `RCC-450x600`, etc.).
- Door `FireRating` AND `AcousticRating` **mandatory** (was optional at LOD 300).
- Window `GlazingAreaFraction` **mandatory** (was optional at LOD 300).
- `Pset_SpaceCommon.OccupancyType` mandatory — feeds NBC Part 4 / IBC Chapter 3 life-safety analysis.
- `Qto_SpaceBaseQuantities.GrossVolume` mandatory — feeds HVAC sizing.
- `IfcGrid` present — column / beam positions reference the grid axes.
- Door `IsExternal` mandatory (egress counting + COBie).

**IDS files validated against:**
- `core.ids`
- `lod-300.ids`
- `lod-350.ids` (11 rules)
- `architectural.ids`, `structural.ids`, and/or `mep.ids` per active discipline.

**Why this tier is gated:** Generating a tender-ready model is expensive (rebar layout, structural analysis, full COBie population). The `target_fidelity` knob lets the workflow stay cheap during design exploration and switch to expensive-but-correct at the final hand-off step. The IDS gate makes that switch a hard contract: a `tender-ready` IFC that fails LOD 350 validation is shipped with `status="partial"` and an explicit `ids_violations[]` array — never silently downgraded.

---

## Disclaimers

- **A `tender-ready` IFC is not a substitute for a stamped engineering drawing.** Even a model that passes every rule in `lod-350.ids` has not been signed off by a licensed structural / MEP engineer. The IDS gate enforces *data-quality contracts*; it does not enforce *engineering correctness*.
- **The reinforcement bars at `tender-ready` are derived from `rebar_ratio` / `concrete_strength` parametrics**, not from a structural analysis. Treat them as quantity placeholders for BOQ takeoff, not as a fabrication shop drawing.
- **The `IfcStructuralAnalysisModel` at `tender-ready` is a topology-only mesh**, sufficient for export to ETABS / RAM / RISA for downstream analysis — it does *not* itself contain analysis results.
- **`concept` IFCs may render with bodyless rebar / mullion / MEP placeholders** by design. This is the "lock this" milestone documented in the team's IFC visual-quality feedback note. Don't file a bug because a concept-tier IFC has invisible rebar — it's intentional.
- **Severity model:** any IDS rule with `cardinality="required"` or `cardinality="prohibited"` is an `error` — failures flip the response status to `"partial"`. Rules with `cardinality="optional"` are `warning`s — they appear in `ids_warnings[]` but do not degrade status.

---

## Where to find the IDS files

- [`neobim-ifc-service/ids/core.ids`](../ids/core.ids)
- [`neobim-ifc-service/ids/lod-300.ids`](../ids/lod-300.ids)
- [`neobim-ifc-service/ids/lod-350.ids`](../ids/lod-350.ids)
- [`neobim-ifc-service/ids/architectural.ids`](../ids/architectural.ids)
- [`neobim-ifc-service/ids/structural.ids`](../ids/structural.ids)
- [`neobim-ifc-service/ids/mep.ids`](../ids/mep.ids)

Validator entrypoint: [`app/services/ids_validator.py`](../app/services/ids_validator.py).
Pipeline integration (Stage 2.5): [`app/routers/export.py`](../app/routers/export.py).
