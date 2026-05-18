"""Deterministic Office builder — consumes an enriched BriefSpec and
emits a fully populated `BuildFlowIFC` instance ready to finalize.

Zero LLM. Zero retries. Given the same BriefSpec, produces the same IFC
(modulo GUIDs). Runs in <5 s for a typical 50-element office.

Depends on Phase BCD helpers in `BuildFlowIFC`:
  - `add_wall`, `add_slab`, `add_door`, `add_window`, `add_furniture`,
    `add_light_fixture`, `add_covering`, `add_space`
  - `attach_canonical_psets`, `attach_canonical_qto`
  - `style_solid` (auto-called inside _add_box_element)
  - `add_opening_in_wall`, `fill_opening` (auto-called inside add_door/add_window
    when host_wall_id + offset_m are provided)
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from ..buildflow_ifc import BuildFlowIFC


def build_office(brief_spec: Dict[str, Any], schema: str = "IFC4") -> BuildFlowIFC:
    """Deterministic office builder entry point.

    Returns a fully populated BuildFlowIFC instance. The caller finalizes
    (writes to disk / uploads to R2).
    """
    bf = BuildFlowIFC(brief_spec, schema=schema)

    # The constructor already bootstrapped project/site/building/storey/
    # materials. Now materialise the brief content deterministically.

    spaces = brief_spec.get("spaces") or []
    elements = brief_spec.get("elements") or []
    openings = brief_spec.get("openings") or []
    furniture_list = brief_spec.get("furniture") or []
    lighting_spec = brief_spec.get("lighting") or {}
    global_params = brief_spec.get("global_parameters") or {}

    # Defaults from global_parameters (enricher should have filled these).
    wall_ext = float(global_params.get("wall_thickness_ext_m", 0.2))
    wall_int = float(global_params.get("wall_thickness_int_m", 0.1))
    ceiling_h = float(global_params.get("ceiling_height_m", 3.0))
    slab_thick = float(global_params.get("slab_thickness_m", 0.15))
    roof_thick = float(global_params.get("roof_thickness_m", 0.15))

    # ── 1. Spaces (IfcSpace from polygon) ────────────────────────────
    for sp in spaces:
        sp_id = str(sp.get("id", ""))
        polygon = sp.get("polygon_world_m")
        height = float(sp.get("height_m", ceiling_h))
        if polygon and len(polygon) >= 3:
            bf.add_space(
                sp_id,
                [(float(p[0]), float(p[1])) for p in polygon],
                height,
                long_name=str(sp.get("long_name", sp_id)),
                occupancy=str(sp.get("occupancy_type", "Office")),
            )
        elif sp.get("circular_centre_radius"):
            ccr = sp["circular_centre_radius"]
            bf.add_circular_space(
                sp_id,
                centre=(float(ccr[0]), float(ccr[1])),
                radius=float(ccr[2]),
                height=height,
                long_name=str(sp.get("long_name", sp_id)),
                occupancy=str(sp.get("occupancy_type", "Office")),
            )

    # ── 2. Perimeter walls from space polygons ───────────────────────
    wall_map: Dict[str, str] = {}  # wall_id -> element_id in bf
    _emit_perimeter_walls(bf, spaces, wall_ext, ceiling_h, wall_map)

    # ── 3. Floor + roof slabs ────────────────────────────────────────
    _emit_slabs(bf, spaces, slab_thick, roof_thick, ceiling_h)

    # ── 4. Elements (legacy path — still honored for agent-loop compat)
    for el in elements:
        _emit_element(bf, el)

    # ── 5. Openings (deterministic path with host_wall_id) ───────────
    _emit_openings(bf, openings, wall_map)

    # ── 6. Furniture (grid/explicit layouts) ─────────────────────────
    _emit_furniture(bf, furniture_list, spaces)

    # ── 7. Lighting (grid strategy) ──────────────────────────────────
    _emit_lighting(bf, lighting_spec, spaces)

    # ── 8. Canonical Psets + Qtos for everything ─────────────────────
    _apply_canonical_metadata(bf, spaces)

    return bf


# ── Perimeter walls ──────────────────────────────────────────────────

def _emit_perimeter_walls(
    bf: BuildFlowIFC,
    spaces: List[Dict[str, Any]],
    wall_thickness: float,
    ceiling_height: float,
    wall_map: Dict[str, str],
) -> None:
    """Walk each space's polygon CCW and emit one wall per edge."""
    for sp in spaces:
        polygon = sp.get("polygon_world_m")
        if not polygon or len(polygon) < 3:
            continue
        sp_id = str(sp.get("id", ""))
        height = float(sp.get("height_m", ceiling_height))

        # Find a structural/wall material — prefer one with "wall" in name
        mat_id = _find_material(bf, "wall", "structural")

        for i in range(len(polygon)):
            a = polygon[i]
            b = polygon[(i + 1) % len(polygon)]
            ax, ay = float(a[0]), float(a[1])
            bx, by = float(b[0]), float(b[1])
            dx, dy = bx - ax, by - ay
            length = math.sqrt(dx * dx + dy * dy)
            if length < 0.01:
                continue
            rot = math.atan2(dy, dx)

            wall_id = f"W-{sp_id}-perim-{i}"
            bf.add_wall(
                wall_id,
                origin=(ax, ay, 0.0),
                dims=(length, wall_thickness),
                depth=height,
                material=mat_id,
                rotation=rot,
                description=f"Perimeter wall edge {i} of {sp_id}",
                tag=wall_id,
            )
            wall_map[wall_id] = wall_id


# ── Slabs ────────────────────────────────────────────────────────────

def _emit_slabs(
    bf: BuildFlowIFC,
    spaces: List[Dict[str, Any]],
    slab_thickness: float,
    roof_thickness: float,
    ceiling_height: float,
) -> None:
    """Emit floor and roof slabs for each space."""
    mat_id = _find_material(bf, "concrete", "structural", "slab")

    for sp in spaces:
        polygon = sp.get("polygon_world_m")
        if not polygon or len(polygon) < 3:
            continue
        sp_id = str(sp.get("id", ""))
        height = float(sp.get("height_m", ceiling_height))

        # Bounding box for rectangular slab approximation
        xs = [float(p[0]) for p in polygon]
        ys = [float(p[1]) for p in polygon]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        width = max_x - min_x
        depth_y = max_y - min_y

        if width > 0.01 and depth_y > 0.01:
            # Floor slab
            bf.add_slab(
                f"SL-{sp_id}-floor",
                origin=(min_x, min_y, 0.0),
                dims=(width, depth_y),
                depth=slab_thickness,
                material=mat_id,
                predefined_type="FLOOR",
                description=f"Floor slab for {sp_id}",
                tag=f"SL-{sp_id}-floor",
            )
            # Roof slab
            bf.add_slab(
                f"SL-{sp_id}-roof",
                origin=(min_x, min_y, height),
                dims=(width, depth_y),
                depth=roof_thickness,
                material=mat_id,
                predefined_type="ROOF",
                description=f"Roof slab for {sp_id}",
                tag=f"SL-{sp_id}-roof",
            )


# ── Elements (legacy) ────────────────────────────────────────────────

def _emit_element(bf: BuildFlowIFC, el: Dict[str, Any]) -> None:
    """Emit a single element from the legacy elements[] array."""
    el_id = str(el.get("id", ""))
    el_type = str(el.get("type", "proxy"))
    origin = tuple(float(v) for v in (el.get("origin_world_m") or [0, 0, 0]))
    dims_raw = el.get("dims_m") or [1, 1, 1]
    dims = (float(dims_raw[0]), float(dims_raw[1]))
    depth = float(dims_raw[2]) if len(dims_raw) > 2 else 1.0
    mat_id = str(el.get("material_id", ""))
    obj_type = str(el.get("object_type", ""))
    desc = str(el.get("description", ""))
    tag = str(el.get("tag", el_id))
    space_id = el.get("contained_in_space_id")
    rotation = float(el.get("rotation_z_rad", 0.0))

    dispatch = {
        "wall": lambda: bf.add_wall(el_id, origin, dims, depth, mat_id, rotation=rotation, description=desc, tag=tag),
        "slab": lambda: bf.add_slab(el_id, origin, dims, depth, mat_id, description=desc, tag=tag),
        "column": lambda: bf.add_column(el_id, origin, dims, depth, mat_id, description=desc, tag=tag),
        "beam": lambda: bf.add_beam(el_id, origin, dims, depth, mat_id, description=desc, tag=tag),
        "covering": lambda: bf.add_covering(el_id, origin, dims, depth, mat_id, description=desc, tag=tag),
        "furniture": lambda: bf.add_furniture(el_id, origin, dims, depth, mat_id, object_type=obj_type, description=desc, tag=tag, contained_in_space_id=space_id),
        "lighting": lambda: bf.add_light_fixture(el_id, origin, dims, depth, mat_id, object_type=obj_type, description=desc, tag=tag, contained_in_space_id=space_id),
        "proxy": lambda: bf.add_proxy(el_id, origin, dims, depth, mat_id, object_type=obj_type, description=desc, tag=tag),
        "door": lambda: bf.add_door(el_id, origin, dims, depth, mat_id, object_type=obj_type, description=desc, tag=tag, contained_in_space_id=space_id),
        "window": lambda: bf.add_window(el_id, origin, dims, depth, mat_id, object_type=obj_type, description=desc, tag=tag, contained_in_space_id=space_id),
    }
    fn = dispatch.get(el_type)
    if fn:
        try:
            fn()
        except Exception:
            # Skip elements that fail (e.g. duplicate ids) rather than
            # crashing the whole build. The validator will catch gaps.
            pass


# ── Openings ─────────────────────────────────────────────────────────

def _emit_openings(
    bf: BuildFlowIFC,
    openings: List[Dict[str, Any]],
    wall_map: Dict[str, str],
) -> None:
    """Emit doors and windows with host-wall void cuts."""
    for op in openings:
        op_id = str(op.get("id", ""))
        op_type = str(op.get("type", "door"))
        host_wall_id = str(op.get("host_wall_id", ""))
        offset_m = float(op.get("offset_m", 0))
        width_m = float(op.get("width_m", 0.9))
        height_m = float(op.get("height_m", 2.1))
        sill_m = float(op.get("sill_m", 0))
        mat_id = str(op.get("material_id", ""))
        desc = str(op.get("description", ""))

        # Find the origin — we place the opening at the host wall's
        # start + offset along the wall's local X axis. But for the
        # IFC element's world placement, we need the wall's world
        # origin + direction vector. The add_door/add_window with
        # host_wall_id handles this internally.
        try:
            if op_type == "door":
                bf.add_door(
                    op_id,
                    origin=(0, 0, sill_m),  # Actual position resolved by host_wall_id
                    dims=(width_m, 0.1),
                    depth=height_m,
                    material=mat_id,
                    description=desc,
                    tag=op_id,
                    host_wall_id=host_wall_id if host_wall_id in wall_map else None,
                    offset_m=offset_m if host_wall_id in wall_map else None,
                    sill_m=sill_m,
                )
            elif op_type == "window":
                bf.add_window(
                    op_id,
                    origin=(0, 0, sill_m),
                    dims=(width_m, 0.05),
                    depth=height_m,
                    material=mat_id,
                    description=desc,
                    tag=op_id,
                    host_wall_id=host_wall_id if host_wall_id in wall_map else None,
                    offset_m=offset_m if host_wall_id in wall_map else None,
                    sill_m=sill_m,
                )
        except Exception:
            pass


# ── Furniture ────────────────────────────────────────────────────────

def _emit_furniture(
    bf: BuildFlowIFC,
    furniture_list: List[Dict[str, Any]],
    spaces: List[Dict[str, Any]],
) -> None:
    """Emit furniture items with grid/explicit/perimeter_offset layouts."""
    space_centroids = _compute_space_centroids(spaces)

    for furn in furniture_list:
        f_id = str(furn.get("id", ""))
        f_type = str(furn.get("type", "desk"))
        count = int(furn.get("count", 1))
        layout = furn.get("layout") or {}
        kind = str(layout.get("kind", "explicit"))
        anchor = str(furn.get("anchor_space_id", ""))
        bbox = furn.get("bounding_box") or [0.6, 0.6, 0.75]
        mat_id = str(furn.get("material_id", ""))
        desc = str(furn.get("description", ""))

        w, d, h = float(bbox[0]), float(bbox[1]), float(bbox[2])

        if kind == "grid":
            rows = int(layout.get("rows", 1))
            cols = int(layout.get("cols", max(1, count)))
            pitch_x = float(layout.get("pitch_x_m", w + 0.3))
            pitch_y = float(layout.get("pitch_y_m", d + 0.3))

            # Anchor origin: centroid of the anchor space, offset to
            # center the grid.
            cx, cy = space_centroids.get(anchor, (2.0, 2.0))
            grid_w = (cols - 1) * pitch_x
            grid_d = (rows - 1) * pitch_y
            start_x = cx - grid_w / 2.0
            start_y = cy - grid_d / 2.0

            idx = 0
            for row in range(rows):
                for col in range(cols):
                    if idx >= count:
                        break
                    x = start_x + col * pitch_x
                    y = start_y + row * pitch_y
                    item_id = f"{f_id}-{idx}"
                    try:
                        bf.add_furniture(
                            item_id,
                            origin=(x, y, 0.0),
                            dims=(w, d),
                            depth=h,
                            material=mat_id,
                            object_type=f_type,
                            description=desc,
                            tag=item_id,
                            contained_in_space_id=anchor or None,
                        )
                    except Exception:
                        pass
                    idx += 1
        else:
            # Explicit: just place at anchor centroid (enricher should
            # have given explicit coords in elements[] for this case)
            cx, cy = space_centroids.get(anchor, (2.0, 2.0))
            for idx in range(count):
                item_id = f"{f_id}-{idx}" if count > 1 else f_id
                try:
                    bf.add_furniture(
                        item_id,
                        origin=(cx + idx * (w + 0.3), cy, 0.0),
                        dims=(w, d),
                        depth=h,
                        material=mat_id,
                        object_type=f_type,
                        description=desc,
                        tag=item_id,
                        contained_in_space_id=anchor or None,
                    )
                except Exception:
                    pass


# ── Lighting ─────────────────────────────────────────────────────────

def _emit_lighting(
    bf: BuildFlowIFC,
    lighting_spec: Dict[str, Any],
    spaces: List[Dict[str, Any]],
) -> None:
    """Emit light fixtures from lighting zones."""
    zones = lighting_spec.get("zones") or []
    space_centroids = _compute_space_centroids(spaces)
    space_heights = {str(sp.get("id", "")): float(sp.get("height_m", 3.0)) for sp in spaces}

    for zi, zone in enumerate(zones):
        anchor = str(zone.get("anchor_space_id", ""))
        fixture_type = str(zone.get("fixture_type", "LED Panel"))
        count = int(zone.get("count", 1))
        layout = zone.get("layout") or {}
        kind = str(layout.get("kind", "grid"))
        mat_id = str(zone.get("material_id", ""))

        cx, cy = space_centroids.get(anchor, (5.0, 2.0))
        ceiling_z = space_heights.get(anchor, 3.0) - 0.05  # 5cm below ceiling

        if kind == "grid":
            rows = int(layout.get("rows", 1))
            cols = int(layout.get("cols", max(1, count)))
            pitch_x = float(layout.get("pitch_x_m", 1.5))
            pitch_y = float(layout.get("pitch_y_m", 1.5))

            grid_w = (cols - 1) * pitch_x
            grid_d = (rows - 1) * pitch_y
            start_x = cx - grid_w / 2.0
            start_y = cy - grid_d / 2.0

            idx = 0
            for row in range(rows):
                for col in range(cols):
                    if idx >= count:
                        break
                    x = start_x + col * pitch_x
                    y = start_y + row * pitch_y
                    light_id = f"LT-z{zi}-{idx}"
                    try:
                        bf.add_light_fixture(
                            light_id,
                            origin=(x, y, ceiling_z),
                            dims=(0.6, 0.6),
                            depth=0.05,
                            material=mat_id,
                            object_type=fixture_type,
                            description=f"{fixture_type} in {anchor}",
                            tag=light_id,
                            contained_in_space_id=anchor or None,
                        )
                    except Exception:
                        pass
                    idx += 1
        else:
            for idx in range(count):
                light_id = f"LT-z{zi}-{idx}"
                try:
                    bf.add_light_fixture(
                        light_id,
                        origin=(cx + idx * 1.5, cy, ceiling_z),
                        dims=(0.6, 0.6),
                        depth=0.05,
                        material=mat_id,
                        object_type=fixture_type,
                        description=f"{fixture_type} in {anchor}",
                        tag=light_id,
                        contained_in_space_id=anchor or None,
                    )
                except Exception:
                    pass


# ── Canonical metadata ───────────────────────────────────────────────

def _apply_canonical_metadata(
    bf: BuildFlowIFC,
    spaces: List[Dict[str, Any]],
) -> None:
    """Apply Psets + Qtos to every tracked element and space."""
    for elem_id in list(bf._elements_by_id.keys()):
        try:
            bf.attach_canonical_psets(elem_id)
        except Exception:
            pass
        try:
            bf.attach_canonical_qto(elem_id)
        except Exception:
            pass

    for sp in spaces:
        sp_id = str(sp.get("id", ""))
        try:
            bf.attach_canonical_psets(sp_id)
        except Exception:
            pass
        try:
            bf.attach_canonical_qto(sp_id)
        except Exception:
            pass


# ── Helpers ──────────────────────────────────────────────────────────

def _find_material(bf: BuildFlowIFC, *keywords: str) -> str:
    """Find a material id whose name contains one of the keywords.
    Falls back to the first available material."""
    for kw in keywords:
        for mid, mat in bf._materials_by_id.items():
            name = getattr(mat, "Name", "").lower()
            if kw.lower() in name:
                return mid
    # Fallback to first material
    if bf._materials_by_id:
        return next(iter(bf._materials_by_id.keys()))
    return "mat-default"


def _compute_space_centroids(
    spaces: List[Dict[str, Any]],
) -> Dict[str, Tuple[float, float]]:
    """Compute (cx, cy) centroid for each space from its polygon."""
    centroids: Dict[str, Tuple[float, float]] = {}
    for sp in spaces:
        sp_id = str(sp.get("id", ""))
        polygon = sp.get("polygon_world_m")
        if not polygon or len(polygon) < 3:
            continue
        xs = [float(p[0]) for p in polygon]
        ys = [float(p[1]) for p in polygon]
        centroids[sp_id] = (sum(xs) / len(xs), sum(ys) / len(ys))
    return centroids
