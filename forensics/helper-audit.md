# `buildflow_ifc.py` Audit — Unit / Placement Surface

Read every `add_*` and internal-geometry method to confirm whether the
unit-declaration bug (`diagnosis.md` H2) is the ONLY visual bug, or
whether per-method placement / extrusion bugs are also present.

**Conclusion: H2 is the only bug.** Every method consumes metre-valued
inputs and constructs correct placements relative to the storey (which
sits at world origin via `geometry.edit_object_placement`). The
forensic ratio of 0.0015 is uniform across all element classes — that
uniformity would not hold if any per-method bug were also present.

## Per-method audit

| Method | Inputs | Unit assumption | Placement | Verdict |
|---|---|---|---|---|
| `add_space` (line 353) | polygon: List[(x,y)] metres, height: m | metres (matches `polygon_world_m` in brief) | `_attach_geometry_extruded_polygon` places product at (0,0,0) relative to storey; polygon vertices are world coords | OK — values pass through, only LENGTHUNIT is wrong |
| `add_circular_space` (line 395) | centre, radius, height — metres | metres | delegates to `add_space` | OK |
| `add_slab` (line 420) | origin (x,y,z) m, dims (dx,dy) m, depth m | metres | `_add_box_element` | OK |
| `add_wall` (line 439) | origin m, dims m, depth m, rotation rad | metres | `_add_box_element` with rotation axis | OK |
| `add_column` (line 459) | origin m, dims m, depth m | metres | `_add_box_element` | OK |
| `add_circular_column` (line 477) | origin m, radius m, depth m | metres | `_add_circle_element` | OK |
| `add_beam` (line 494) | origin m, dims m, depth m | metres | `_add_box_element` | OK |
| `add_covering` (line 514) | origin m, dims m, depth m | metres | `_add_box_element` | OK |
| `add_proxy` (line 535) | origin m, dims m, depth m | metres | `_add_box_element` | OK |
| `add_furniture` (line 569) | origin m, dims m, depth m | metres | `_add_box_element` | OK |
| `add_light_fixture` (line 589) | origin m, dims m, depth m | metres | `_add_box_element` w/ `ifc_class=IfcLightFixture` — **note: IfcLightFixture is IFC4-only**, but `root.create_entity` falls back to `IfcFlowTerminal` or `IfcBuildingElementProxy` (forensics show this) | OK for unit purposes; minor class-mismatch note |
| `_add_box_element` (line 830) | ox/oy/oz, dx/dy, depth — metres | metres | `IfcExtrudedAreaSolid` at local origin + `IfcLocalPlacement` at (ox,oy,oz) relative to storey | OK |
| `_add_circle_element` (line 969) | same pattern | metres | same pattern | OK |
| `_attach_geometry_extruded_polygon` (line 1065) | polygon: world-coord 2-tuples in metres, height: metres | metres | placement at storey origin, polygon vertices are world coords | OK |
| `_bootstrap_project` (line 198) | — | declares LENGTHUNIT via `unit.assign_unit(file)` no args | **MILLIMETRE** by ifcopenshell default | **🚨 ONLY BUG** |

## Why the uniformity confirms single root cause

If any individual `add_*` method had its own scaling bug (e.g.
`add_wall` multiplying dims by 1000 while `add_slab` didn't), the
forensic ratios would diverge between IfcWall and IfcSlab in the
same file. They don't:

```
small-office.ifc:
  WALL-N x_extent: 0.0050 (brief expects 5.0, ratio 0.001)
  WALL-S x_extent: 0.0050 (ratio 0.001)
  WALL-E y_extent: 0.0050 (ratio 0.001)
  WALL-W y_extent: 0.0050 (ratio 0.001)
  SLAB-FLOOR x_extent: 0.0050 (ratio 0.001)
```

Every element under-renders by exactly 1/1000. That's the unit
declaration, not the geometry code.

## Out-of-scope notes (NOT FIXING this phase per prompt rule 14)

- `add_light_fixture` declares `ifc_class="IfcLightFixture"`. In
  IFC2X3 this class doesn't exist; `root.create_entity` will fall back
  silently. Forensics show those elements end up as
  `IfcFurnishingElement` or `IfcBuildingElementProxy` in the output —
  visually fine, semantically slightly wrong. Logging this as a
  follow-up.
- The lifetime-comment block at lines 745-749 says "Python-side
  bookkeeping goes to `meta.json`" — accurate.
- `_add_box_element` rotates the X-axis but always declares Z-up
  axis. Correct for vertical walls. For floors / slabs this is
  ignored (rotation is X-Y plane).

## Required PHASE 1 changes

1. **`buildflow_ifc.py:244-248`** — replace 4 lines with explicit METRE
   / SQUARE_METRE / CUBIC_METRE assignment.
2. **`tests/test_buildflow_ifc.py`** — add a regression test that
   round-trips a minimal brief, re-opens the IFC, and asserts:
   - LENGTHUNIT IfcSIUnit has `Prefix=None` and `Name="METRE"`
   - World bbox of a known wall matches expected within 0.1m
3. **Unit-coherence assertion in `write()`** (line 734) — before
   serialising, compute total bbox via `ifcopenshell.geom` and refuse
   to write if all extents are < 0.5m (a 50cm floor or a 1m wall would
   still be plausible at the LOW end). Raises `BuildFlowIFCError` with
   diagnostic message including suggested fix.

These three changes, plus the PHASE 3 server-side validator, mean:
even if the bootstrap was reverted, the next eval would visibly fail.
