# v3 IFC Visual-Bug Forensic Diagnosis — 2026-05-16

## TL;DR

Every IFC file v3 generates declares `IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)`
(millimetre) but the BriefSpec and helper library pass metre-valued
coordinates. Every viewer reads the file as millimetre-scale, so a
4-metre wall renders as 4 millimetres. The entire model collapses
to a 5–22 mm dot at the world origin.

**Root cause:** `BuildFlowIFC._bootstrap_project()` calls
`ifcopenshell.api.run("unit.assign_unit", self._ifc)` with **no
arguments**. The docstring in `buildflow_ifc.py:245-247` claims this
"defaults to metric" — that's *technically* true (the units ARE all
metric / SI) but specifically defaults to `LENGTHUNIT = MILLI.METRE`.
This is documented in
[`ifcopenshell.api.unit.assign_unit`](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/unit/assign_unit/index.html):

> "you may specify without any arguments to automatically create
> **millimeters**, square meters, and cubic meters as a convenience
> for testing purposes."

The helper inherited the Revit-default convention from ifcopenshell;
nobody noticed because (a) ASCII + entity-refs validators don't read
LENGTHUNIT and (b) no one rendered the file in a viewer to look at it.

## Evidence

### 1. LENGTHUNIT declaration is consistent across all 5 IFCs

| Brief | LENGTHUNIT |
|---|---|
| residential-bedroom | `.MILLI..METRE.` |
| restaurant-counter  | `.MILLI..METRE.` |
| retail-pop-up       | `.MILLI..METRE.` |
| small-office        | `.MILLI..METRE.` |
| sol-properties-booth | `.MILLI..METRE.` |

### 2. World-bbox ratio is consistently ~0.0015 across all 5 IFCs

Source: `scripts/forensics/brief-vs-actual.py` →
[forensics/brief-vs-actual-summary.md](brief-vs-actual-summary.md).

| Brief | Expected (x×y×z, m) | Actual rendered (m) | Ratio | Verdict |
|---|---|---|---|---|
| residential-bedroom | 4.00 × 5.00 × 2.70 | 0.0059 × 0.0075 × 0.0027 | 0.0015 | MM_INTERPRETED_AS_M |
| restaurant-counter  | 4.00 × 8.00 × 3.00 | 0.0056 × 0.0113 × 0.0030 | 0.0014 | MM_INTERPRETED_AS_M |
| retail-pop-up       | 6.00 × 6.00 × 3.00 | 0.0089 × 0.0091 × 0.0030 | 0.0015 | MM_INTERPRETED_AS_M |
| small-office        | 5.00 × 5.00 × 2.80 | 0.0074 × 0.0076 × 0.0029 | 0.0015 | MM_INTERPRETED_AS_M |
| sol-properties-booth | 15.00 × 15.00 × 4.50 | 0.0225 × 0.0226 × 0.0044 | 0.0015 | MM_INTERPRETED_AS_M |

The 0.0015 multiplier (rather than exactly 0.001) is because the
actual bbox includes ± wall thickness and slab perimeter, while the
expected is the brief's outer bounds — no inconsistency. The 1000×
shrink is unambiguous.

### 3. The IFC file STORES correct metre-valued coords

Spot check the first wall in residential-bedroom.ifc — its origin is
stored as `(0.0, 4.9, 0.05)`. That IS metres in the brief. Same value
written, but the unit declaration tells the viewer "this is 4900 mm
= 4.9 m * 1mm/m" → 4.9 mm. The numerical values are RIGHT for metres;
the declared unit is wrong.

This is the cleanest possible flavour of this bug — no code path
multiplies anything; the entire fix is one bootstrap call.

## Hypothesis tree — narrowed

| # | Hypothesis | Evidence | Verdict |
|---|------------|----------|---------|
| H1 | All elements at IfcLocalPlacement origin (0,0,0) | placement_at_origin_count ranges 1–3 out of 14–78 elements; most have non-origin placements (e.g. WALL-N at (0, 4.9, 0.05)) | **NEGATIVE** |
| H2 | Dimensions interpreted as mm but declared as m (1000× too small) | Aggregate bbox is consistently 1000× smaller than brief site bounds; LENGTHUNIT declared as `.MILLI..METRE.` | **POSITIVE — confirmed** |
| H3 | Dimensions interpreted as m but declared as mm (1000× too large) | Bbox is smaller, not larger | NEGATIVE |
| H4 | Z-axis missing (zero-height extrusions) | Z extents are non-zero (0.0027–0.0044m); proportional to expected, not zeroed | NEGATIVE |
| H5 | Polygon coordinates flipped (y/x or signed) | Polygon ordering matches brief; aspect ratios correct (rectangular bedroom = 4.00×5.00 → bbox ratio matches) | NEGATIVE |
| H6 | IfcAxis2Placement3D RelativeTo chain broken | Chain resolves: storey→building→site→project all at identity; placements compose correctly except scaled by 1/1000 | NEGATIVE |
| H7 | IfcShapeRepresentation references empty geometry | Every element has a non-empty extrusion with positive Depth; ifcopenshell.geom returns valid meshes | NEGATIVE |

**Likely diagnosis: H2 only. Single root cause. Fix shape is a 4-line
bootstrap change in `buildflow_ifc.py`.**

## The fix

In `BuildFlowIFC._bootstrap_project()`, replace:

```python
# Units — metric SI ... (current, broken)
api.run("unit.assign_unit", self._ifc)
```

with:

```python
# Units — explicit METRE / SQUARE_METRE / CUBIC_METRE.
# ifcopenshell.api.unit.assign_unit() with no `units=` kwarg
# defaults to MILLIMETRE for LENGTHUNIT (Revit convention),
# which silently corrupts every metre-valued coordinate from
# the brief.
length_unit = api.run("unit.add_si_unit", self._ifc, unit_type="LENGTHUNIT")
area_unit = api.run("unit.add_si_unit", self._ifc, unit_type="AREAUNIT")
volume_unit = api.run("unit.add_si_unit", self._ifc, unit_type="VOLUMEUNIT")
api.run("unit.assign_unit", self._ifc, units=[length_unit, area_unit, volume_unit])
```

Verified locally: `prefix=None, name=METRE` for LENGTHUNIT after the
fix. Equivalent result for the other two units (no prefix → base SI).

## Defence-in-depth

A one-line fix needs guardrails so this can never silently regress:

1. **Regression test** in `tests/test_buildflow_ifc.py` — round-trip a
   minimal BriefSpec through `BuildFlowIFC`, re-open the written file
   with ifcopenshell, assert the LENGTHUNIT IfcSIUnit has `Prefix=None`
   and `Name="METRE"`. Run on every CI build.
2. **Validator** in `validate.py` — new `validate_world_bbox()` that
   computes the actual world bbox via `ifcopenshell.geom` and compares
   to expected from the brief. Refuse `finalize_ifc` if the ratio is
   outside [0.5, 2.0] on any axis (caught error code:
   `VISUAL_GEOMETRY_INVALID`).
3. **System prompt** — explicit UNITS AND COORDINATES section telling
   the agent every dimension is in metres and what a sane bbox looks
   like. The agent learns to verify via `read_ifc_summary` before
   calling `finalize_ifc`.
4. **Visual smoke test** — `scripts/forensics/ifc-render-preview.py`
   produces top-down + iso PNGs. Embedded in eval pass criteria + final
   report. Even if validators miss a future bug, eyeballing 5 PNGs catches it.

Combined, these mean a future regression of this bug class would:
(a) fail the round-trip test in CI (blocks merge),
(b) refuse to finalize the IFC at runtime (Railway returns `VISUAL_GEOMETRY_INVALID`),
(c) be visible in the auto-rendered PNG in the next eval report.
