"""Phase 1 — BuildingModel parametric layer (R1 + R2 of the Phase 1 prompt).

Pure-Python typed graph between MassingGeometry and the IFC builders. Carries
every relationship a downstream emitter needs to produce a clean,
IDS-passing IFC entity:

  * Walls know their host storey(s).
  * Rooms know their bounding walls (which side of each axis).
  * Doors know which 0..2 rooms they connect (the literal "Outside" is a
    permitted singleton pseudo-space).
  * Beams know their supporting columns / moment connections.
  * Stairs reference the slab below + slab above (resolved by storey index).

Every node class is `frozen=True`. Cross-references between nodes are
string ids resolved by the root validator.

The 12 Phase-1 invariants run as a single `@model_validator(mode="after")`
on `BuildingModel`. On any failure they raise `BuildingModelValidationError`
carrying `rule_id`, `node_id`, `expected`, `actual`, and a remediation
`hint` — never a generic `ValueError`. This is the spec'd shape downstream
tooling (lift warnings, builder error handlers) will consume in later
slices.

This module is deliberately import-light: pydantic + shapely. **No** ifc
imports, **no** project-services imports, **no** LLM / DB / R2. Anyone
adding an `import ifcopenshell` here is breaking the layering rule.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import Polygon


# ─── Errors ──────────────────────────────────────────────────────────


class BuildingModelValidationError(ValueError):
    """Raised when one of the 12 Phase-1 invariants fails on construction.

    Carries the structured fields the lift service (Slice 2) and IFC builders
    (Slices 4–5) consume to surface specific, actionable error messages —
    never generic ones (per the senior-engineer feedback rule).
    """

    def __init__(
        self,
        rule_id: str,
        node_id: str,
        expected: str,
        actual: str,
        hint: str,
    ) -> None:
        super().__init__(
            f"[{rule_id}] node={node_id}: expected {expected}; got {actual}. {hint}"
        )
        self.rule_id = rule_id
        self.node_id = node_id
        self.expected = expected
        self.actual = actual
        self.hint = hint


class BuildingModelResolutionError(RuntimeError):
    """Raised by the two-pass resolver in Slice 4 when a placement cycle
    is detected during Pass 1 RESOLVE. Defined here so Slice 4 can import
    from a single canonical location.
    """


# ─── Primitives ──────────────────────────────────────────────────────


class Vec2(BaseModel):
    model_config = ConfigDict(frozen=True)
    x: float
    y: float


class Vec3(BaseModel):
    model_config = ConfigDict(frozen=True)
    x: float
    y: float
    z: float


class MaterialLayer(BaseModel):
    model_config = ConfigDict(frozen=True)
    material_name: str
    thickness: float = Field(gt=0)
    function: Optional[Literal["core", "finish", "insulation", "cladding"]] = None


class ProfileRef(BaseModel):
    model_config = ConfigDict(frozen=True)
    name: str
    profile_type: Literal[
        "I-beam", "rectangle", "circle", "L-angle", "T-section", "channel", "tube"
    ]
    dimensions: dict[str, float] = Field(default_factory=dict)


class GeoReference(BaseModel):
    model_config = ConfigDict(frozen=True)
    epsg_code: int = 4326
    x_offset: float = 0.0
    y_offset: float = 0.0
    z_offset: float = 0.0


class ReraData(BaseModel):
    model_config = ConfigDict(frozen=True)
    project_id: Optional[str] = None
    seismic_zone: Optional[Literal["II", "III", "IV", "V"]] = None
    wind_zone: Optional[int] = Field(default=None, ge=1, le=6)
    nbc_occupancy_group: Optional[str] = None


class Permit(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    name: str
    authority: str
    valid_until: Optional[str] = None


# ─── Building elements (no nested cross-refs at construction) ─────────


class BoundaryEdge(BaseModel):
    model_config = ConfigDict(frozen=True)
    wall_id: str
    side: Literal["left", "right"]


class Wall(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    # Slice 5 addition: human-readable name. When set, builders use it as
    # the IfcWall.Name attribute; falls back to .id when None. Lift
    # populates from MassingGeometry's elem.properties.name so the IFC
    # output preserves authoring labels ("Wall N") instead of carrying
    # only machine ids ("w-n").
    name: Optional[str] = None
    # Plural: a curtain wall / double-height lobby wall may span multiple
    # storeys. WALL_HOSTED requires every id resolves; WALL_BASE_VALID
    # bounds base_z / top_z against the min/max of those storeys.
    host_storey_ids: list[str] = Field(min_length=1)
    axis_points: list[Vec2] = Field(min_length=2)
    base_z: float
    top_z: float
    thickness: float = Field(gt=0)
    layers: list[MaterialLayer] = Field(default_factory=list)
    type: Literal["solid", "curtain", "partition", "shear"] = "solid"
    is_external: bool = False
    is_load_bearing: bool = False


class Slab(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    host_storey_id: str
    footprint_polygon: list[Vec2] = Field(min_length=3)
    top_z: float
    bottom_z: float
    openings_polygons: list[list[Vec2]] = Field(default_factory=list)
    layers: list[MaterialLayer] = Field(default_factory=list)
    predefined_type: Literal["FLOOR", "ROOF", "BASESLAB", "LANDING"]


class Column(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    host_storey_id: str
    grid_intersection: Optional[tuple[str, str]] = None
    location: Vec2
    # If `top_location` is None the column is vertical (top sits directly above
    # `location`). When set it allows slanted columns; COLUMN_AXIS_VALID
    # rejects non-vertical geometry unless `StructuralSystem.allows_slanted`.
    top_location: Optional[Vec2] = None
    profile: ProfileRef
    material: str
    base_z: float
    top_z: float
    is_load_bearing: bool = True


class Beam(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    host_storey_id: str
    supported_by_column_ids: list[str] = Field(default_factory=list)
    has_moment_connection: bool = False
    moment_connection_target_id: Optional[str] = None
    profile: ProfileRef
    material: str
    start_point: Vec3
    end_point: Vec3
    top_z: float


class Footing(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    supports_column_id: Optional[str] = None
    location: Vec2
    top_z: float
    bottom_z: float
    footprint_polygon: list[Vec2] = Field(min_length=3)
    material: str = "concrete"


class Opening(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    in_wall_id: str
    distance_along_wall: float = Field(ge=0)
    sill_z: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    predefined_type: Literal["WINDOW", "DOOR", "RECESS"] = "WINDOW"


class Door(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    in_opening_id: str
    # 1 for exterior (paired with literal "Outside"), 2 for interior. The
    # literal string "Outside" is a permitted pseudo-space — no Room
    # instance required. DOOR_CONNECTS_ROOMS enforces shape + uniqueness.
    connects_room_ids: list[str] = Field(min_length=1, max_length=2)
    swing: Literal["inward", "outward", "sliding", "folding", "revolving"]
    handedness: Literal["left", "right"]


class Window(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    in_opening_id: str
    glass_area: Optional[float] = None
    frame_material: Optional[str] = None


class Room(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    name: str
    usage: str
    footprint_polygon: list[Vec2] = Field(min_length=3)
    bounding_edges: list[BoundaryEdge] = Field(default_factory=list)


class Stair(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    # `host_storey_id` is the LOWER storey the stair starts on; STAIR_RISE_MATCHES
    # locates the slab on this storey + the slab on the next storey by index.
    host_storey_id: str
    riser_count: int = Field(gt=0)
    riser_height: float = Field(gt=0)
    tread_depth: float = Field(gt=0)
    flight_count: int = Field(default=1, gt=0)
    landing_count: int = Field(default=0, ge=0)
    plan_polygon: list[Vec2] = Field(min_length=3)


# ─── Grid + Foundation + StructuralSystem ─────────────────────────────


class GridAxis(BaseModel):
    model_config = ConfigDict(frozen=True)
    label: str
    position: float


class Grid(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    x_axes: list[GridAxis] = Field(default_factory=list)
    y_axes: list[GridAxis] = Field(default_factory=list)


class Roof(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    type: Literal["flat", "pitched", "curved", "membrane"] = "flat"


class Foundation(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    footings: list[Footing] = Field(default_factory=list)


class StructuralSystem(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str = "structural-system-1"
    grid: Optional[Grid] = None
    columns: list[Column] = Field(default_factory=list)
    beams: list[Beam] = Field(default_factory=list)
    allows_slanted: bool = False


# ─── MEP ──────────────────────────────────────────────────────────────


class MEPEquipment(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    system_kind: Literal["HVAC", "Plumbing", "Electrical", "FireProtection"]
    predefined_type: str
    location: Vec3
    name: Optional[str] = None


class MEPSegment(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    system_kind: Literal["HVAC", "Plumbing", "Electrical", "FireProtection"]
    predefined_type: str
    start_point: Vec3
    end_point: Vec3


class MEPTerminal(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    system_kind: Literal["HVAC", "Plumbing", "Electrical", "FireProtection"]
    predefined_type: str
    location: Vec3
    name: Optional[str] = None


class MEPSystem(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    system_kind: Literal["HVAC", "Plumbing", "Electrical", "FireProtection"]
    source: Optional[MEPEquipment] = None
    distribution: list[MEPSegment] = Field(default_factory=list)
    terminals: list[MEPTerminal] = Field(default_factory=list)


# ─── Spatial hierarchy ────────────────────────────────────────────────


class Storey(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    name: str
    elevation: float
    actual_height: float = Field(gt=0)
    index: int
    rooms: list[Room] = Field(default_factory=list)
    walls: list[Wall] = Field(default_factory=list)
    slabs: list[Slab] = Field(default_factory=list)
    stairs: list[Stair] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)


class Building(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    name: str
    occupancy_nbc_group: Optional[str] = None
    envelope_polygon: list[Vec2] = Field(default_factory=list)
    structural_system: StructuralSystem = Field(default_factory=StructuralSystem)
    mep_systems: list[MEPSystem] = Field(default_factory=list)
    storeys: list[Storey] = Field(default_factory=list)
    foundation: Optional[Foundation] = None
    roof: Optional[Roof] = None
    doors: list[Door] = Field(default_factory=list)
    windows: list[Window] = Field(default_factory=list)


class Site(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    name: str = "Default Site"
    georef: GeoReference = Field(default_factory=GeoReference)
    true_north_deg: float = 0.0
    terrain_polygon: list[Vec2] = Field(default_factory=list)
    building: Building


# ─── Provenance + project metadata ────────────────────────────────────


class Provenance(BaseModel):
    """Pset_BuildFlow_Provenance — 15 fields stamped onto every IfcProject
    by Slice 3 (R7). All fields must be present at construction time even
    if zero / empty; `ids_rules_passed` and `ids_rules_failed` are
    overwritten post-validation by the route handler.
    """

    model_config = ConfigDict(frozen=True)
    model_version: str = "1.0.0"
    input_contract_version: str
    ifcopenshell_version: str = ""
    agent_stages_run: str = "lift-from-massing"
    agent_models_used: str = ""
    total_llm_cost_usd: float = 0.0
    total_wallclock_ms: int = 0
    prompt_cache_hit_rate: float = 0.0
    ids_rules_passed: int = 0
    ids_rules_failed: int = 0
    target_fidelity: str
    fixture_match: str = ""
    generated_at: str
    build_id: str
    source_contract: Literal["BuildingModel", "MassingGeometry-lifted"]


class ProjectMetadata(BaseModel):
    model_config = ConfigDict(frozen=True)
    rera: Optional[ReraData] = None
    permits: list[Permit] = Field(default_factory=list)
    cobie_defaults: dict[str, str] = Field(default_factory=dict)
    provenance: Provenance


class Project(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    name: str
    model_version: str = "1.0.0"
    site: Site
    metadata: ProjectMetadata


# ─── Geometry helpers (pure functions; no model state) ────────────────


def _polyline_length(points: list[Vec2]) -> float:
    """Total length of a 2D polyline along consecutive segments."""
    total = 0.0
    for i in range(len(points) - 1):
        dx = points[i + 1].x - points[i].x
        dy = points[i + 1].y - points[i].y
        total += (dx * dx + dy * dy) ** 0.5
    return total


def _signed_area(coords: list[Vec2]) -> float:
    """Shoelace formula. Positive == CCW, negative == CW."""
    n = len(coords)
    if n < 3:
        return 0.0
    acc = 0.0
    for i in range(n):
        j = (i + 1) % n
        acc += coords[i].x * coords[j].y - coords[j].x * coords[i].y
    return acc / 2.0


def _count_distinct_vertices(coords: list[Vec2], tol: float) -> int:
    """Number of pairwise-distinct vertices within a tolerance.

    Conservative O(n^2) — fine for footprints (rarely > 50 points). Avoids
    a tolerance-aware hash that would be tricky to get right at boundaries.
    """
    distinct: list[Vec2] = []
    for v in coords:
        if not any(((v.x - u.x) ** 2 + (v.y - u.y) ** 2) ** 0.5 <= tol for u in distinct):
            distinct.append(v)
    return len(distinct)


def _offset_axis(points: list[Vec2], offset: float, side: Literal["left", "right"]) -> list[Vec2]:
    """Offset a 2D polyline perpendicular to its direction by `offset`.

    For each consecutive pair (p_i, p_{i+1}), compute the unit perpendicular
    on the chosen side and emit (p_i + perp*offset, p_{i+1} + perp*offset).
    Adjacent segments do NOT have their corner intersections resolved — the
    output preserves both endpoints of every segment. Downstream consumers
    (ROOM_BOUNDED) feed the result to shapely.Polygon which tolerates
    cusped/duplicate-near vertices.
    """
    out: list[Vec2] = []
    sign = 1.0 if side == "left" else -1.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        dx = b.x - a.x
        dy = b.y - a.y
        seg_len = (dx * dx + dy * dy) ** 0.5
        if seg_len < 1e-9:
            continue  # degenerate segment — skip
        # Left perpendicular for direction (dx, dy) is (-dy, dx). Right is (dy, -dx).
        nx = -dy / seg_len
        ny = dx / seg_len
        out.append(Vec2(x=a.x + sign * nx * offset, y=a.y + sign * ny * offset))
        out.append(Vec2(x=b.x + sign * nx * offset, y=b.y + sign * ny * offset))
    return out


def _points_close(a: Vec3, b: Vec3, tol: float) -> bool:
    return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) ** 0.5 <= tol


def _line_intersection(
    p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2
) -> Optional[Vec2]:
    """Intersection of two infinite 2D lines, each given as (point, direction).

    Returns None if the lines are parallel (no unique intersection). Used by
    ROOM_BOUNDED to resolve corner points where consecutive bounding edges'
    offset axes meet — the spec's literal "concatenate all offset points"
    approach produces a self-intersecting polygon for any rectangular room
    with finite-thickness walls, because each wall's offset axis stops
    short of the geometric corner by half a wall thickness. Intersecting
    the extended axes yields the true inner corner.
    """
    denom = d1.x * d2.y - d1.y * d2.x
    if abs(denom) < 1e-9:
        return None
    t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom
    return Vec2(x=p1.x + t * d1.x, y=p1.y + t * d1.y)


# ─── Validation context (built once per BuildingModel construction) ───


class _ValidationContext:
    """Side table of id → node, built once at the top of the validator.

    Also surfaces duplicate-id errors (which would otherwise silently
    last-write-wins through dicts) before any invariant runs.
    """

    def __init__(self, bm: "BuildingModel") -> None:
        building = bm.project.site.building
        self.building = building
        self.storeys: list[Storey] = list(building.storeys)
        self.storeys_by_id: dict[str, Storey] = {}
        self.storeys_by_index: dict[int, Storey] = {}
        self.walls_by_id: dict[str, Wall] = {}
        self.slabs: list[Slab] = []
        self.slabs_by_id: dict[str, Slab] = {}
        self.slabs_by_storey: dict[str, list[Slab]] = defaultdict(list)
        self.rooms_by_id: dict[str, Room] = {}
        self.openings_by_id: dict[str, Opening] = {}
        self.stairs: list[Stair] = []
        self.columns_by_id: dict[str, Column] = {}
        self.beams: list[Beam] = list(building.structural_system.beams)
        self.doors: list[Door] = list(building.doors)
        self.windows: list[Window] = list(building.windows)
        self.footings_by_id: dict[str, Footing] = {}
        self.mep_systems: list[MEPSystem] = list(building.mep_systems)

        for storey in building.storeys:
            self._claim("storey", storey.id, storey, self.storeys_by_id)
            if storey.index in self.storeys_by_index:
                raise BuildingModelValidationError(
                    rule_id="DUPLICATE_STOREY_INDEX",
                    node_id=storey.id,
                    expected="storey indices to be unique",
                    actual=(
                        f"index {storey.index} reused by '{storey.id}' and "
                        f"'{self.storeys_by_index[storey.index].id}'"
                    ),
                    hint="Renumber storeys so each .index is unique within the building.",
                )
            self.storeys_by_index[storey.index] = storey
            for w in storey.walls:
                self._claim("wall", w.id, w, self.walls_by_id)
            for s in storey.slabs:
                self._claim("slab", s.id, s, self.slabs_by_id)
                self.slabs.append(s)
                self.slabs_by_storey[s.host_storey_id].append(s)
            for r in storey.rooms:
                self._claim("room", r.id, r, self.rooms_by_id)
            for o in storey.openings:
                self._claim("opening", o.id, o, self.openings_by_id)
            for st in storey.stairs:
                self.stairs.append(st)

        for c in building.structural_system.columns:
            self._claim("column", c.id, c, self.columns_by_id)
        if building.foundation:
            for f in building.foundation.footings:
                self._claim("footing", f.id, f, self.footings_by_id)

    @staticmethod
    def _claim(kind: str, node_id: str, node: object, target: dict) -> None:
        if node_id in target:
            raise BuildingModelValidationError(
                rule_id=f"DUPLICATE_{kind.upper()}_ID",
                node_id=node_id,
                expected=f"unique {kind} ids across the building",
                actual=f"id '{node_id}' appears more than once",
                hint=f"Rename one of the {kind}s so every id is unique.",
            )
        target[node_id] = node


# ─── Root: BuildingModel + 12 invariants ──────────────────────────────


class BuildingModel(BaseModel):
    model_config = ConfigDict(frozen=True)
    project: Project

    @classmethod
    def build(cls, data: dict) -> "BuildingModel":
        """Canonical constructor — unwraps invariant errors.

        Pydantic v2 wraps any `ValueError` raised inside a
        `@model_validator(mode="after")` body into a
        `pydantic.ValidationError`, masking the original exception type.
        This classmethod inspects the wrapped error and, when the inner
        cause is a `BuildingModelValidationError`, re-raises that
        canonical error directly so callers (the lift service in Slice 2,
        builders in Slices 4–5, route handlers) receive the structured
        `rule_id` / `node_id` / `expected` / `actual` / `hint` fields.

        Other Pydantic validation errors (type mismatches, missing
        required fields, `Field(min_length=…)` violations, etc.) pass
        through unchanged — they're parse-time failures, not invariant
        failures.

        Use `BuildingModel.build(d)` in production code. `model_validate`
        still works but requires callers to manually unwrap.
        """
        from pydantic import ValidationError as _PydanticVE

        try:
            return cls.model_validate(data)
        except _PydanticVE as wrapper:
            for err in wrapper.errors():
                inner = err.get("ctx", {}).get("error")
                if isinstance(inner, BuildingModelValidationError):
                    raise inner from wrapper
            raise

    @model_validator(mode="after")
    def _validate_invariants(self) -> "BuildingModel":
        ctx = _ValidationContext(self)
        # Run in spec order — later invariants can rely on earlier ones
        # having succeeded (e.g. WALL_BASE_VALID assumes WALL_HOSTED).
        self._i_storey_continuity(ctx)
        self._i_wall_hosted(ctx)
        self._i_wall_base_valid(ctx)
        self._i_opening_in_wall(ctx)
        self._i_door_in_opening(ctx)
        self._i_door_connects_rooms(ctx)
        self._i_beam_supported(ctx)
        self._i_column_axis_valid(ctx)
        self._i_room_bounded(ctx)
        self._i_mep_terminates(ctx)
        self._i_stair_rise_matches(ctx)
        self._i_footprint_valid(ctx)
        return self

    # ---- Invariant 1 ---------------------------------------------------
    @staticmethod
    def _i_storey_continuity(ctx: _ValidationContext) -> None:
        """For each adjacent pair ordered by .index, top-of-prev == elevation-of-next within 5mm."""
        ordered = sorted(ctx.storeys, key=lambda s: s.index)
        for i in range(len(ordered) - 1):
            cur, nxt = ordered[i], ordered[i + 1]
            expected_z = cur.elevation + cur.actual_height
            if abs(nxt.elevation - expected_z) > 0.005:
                raise BuildingModelValidationError(
                    rule_id="STOREY_CONTINUITY",
                    node_id=nxt.id,
                    expected=(
                        f"elevation == {expected_z:.4f}m (top of '{cur.id}' at index "
                        f"{cur.index}: {cur.elevation:.4f} + {cur.actual_height:.4f})"
                    ),
                    actual=f"elevation == {nxt.elevation:.4f}m",
                    hint=(
                        "Adjacent storeys must abut within 5mm. Adjust elevations "
                        "or insert a gap-storey if you need an intentional plenum."
                    ),
                )

    # ---- Invariant 2 ---------------------------------------------------
    @staticmethod
    def _i_wall_hosted(ctx: _ValidationContext) -> None:
        for w in ctx.walls_by_id.values():
            for sid in w.host_storey_ids:
                if sid not in ctx.storeys_by_id:
                    raise BuildingModelValidationError(
                        rule_id="WALL_HOSTED",
                        node_id=w.id,
                        expected=f"host_storey_id '{sid}' to exist in building.storeys",
                        actual=f"no storey with id '{sid}' (known ids: {sorted(ctx.storeys_by_id)})",
                        hint=(
                            "Either add the missing storey or correct the wall's "
                            "host_storey_ids."
                        ),
                    )

    # ---- Invariant 3 ---------------------------------------------------
    @staticmethod
    def _i_wall_base_valid(ctx: _ValidationContext) -> None:
        for w in ctx.walls_by_id.values():
            hosts = [ctx.storeys_by_id[sid] for sid in w.host_storey_ids]
            min_storey = min(hosts, key=lambda s: s.elevation)
            max_storey = max(hosts, key=lambda s: s.elevation)
            min_allowed = min_storey.elevation - 0.005
            max_allowed = max_storey.elevation + max_storey.actual_height + 0.005
            if w.base_z < min_allowed:
                raise BuildingModelValidationError(
                    rule_id="WALL_BASE_VALID",
                    node_id=w.id,
                    expected=(
                        f"base_z >= {min_allowed:.4f}m (min host storey "
                        f"'{min_storey.id}' elevation {min_storey.elevation:.4f} - 5mm tol)"
                    ),
                    actual=f"base_z = {w.base_z:.4f}m",
                    hint=(
                        "Wall base sits below its lowest host storey. Either lower "
                        "the host_storey_ids list to include a basement storey or "
                        "raise base_z."
                    ),
                )
            if w.top_z > max_allowed:
                raise BuildingModelValidationError(
                    rule_id="WALL_BASE_VALID",
                    node_id=w.id,
                    expected=(
                        f"top_z <= {max_allowed:.4f}m (max host '{max_storey.id}' top "
                        f"{max_storey.elevation + max_storey.actual_height:.4f} + 5mm tol)"
                    ),
                    actual=f"top_z = {w.top_z:.4f}m",
                    hint=(
                        "Wall top exceeds the top of its highest host storey. Either "
                        "extend host_storey_ids upward or lower top_z."
                    ),
                )

    # ---- Invariant 4 ---------------------------------------------------
    @staticmethod
    def _i_opening_in_wall(ctx: _ValidationContext) -> None:
        for o in ctx.openings_by_id.values():
            if o.in_wall_id not in ctx.walls_by_id:
                raise BuildingModelValidationError(
                    rule_id="OPENING_IN_WALL",
                    node_id=o.id,
                    expected=f"in_wall_id '{o.in_wall_id}' to exist",
                    actual="not found in any storey's walls",
                    hint="Set the opening's in_wall_id to a valid wall.id.",
                )
            wall = ctx.walls_by_id[o.in_wall_id]
            wall_len = _polyline_length(wall.axis_points)
            far_edge = o.distance_along_wall + o.width
            if o.distance_along_wall < 0.1:
                raise BuildingModelValidationError(
                    rule_id="OPENING_IN_WALL",
                    node_id=o.id,
                    expected="distance_along_wall >= 0.1m (100mm clearance from near end)",
                    actual=f"distance_along_wall = {o.distance_along_wall:.4f}m",
                    hint=(
                        "Move the opening away from the wall's start by at least 100mm "
                        "to leave a structural reveal."
                    ),
                )
            if far_edge > wall_len - 0.1:
                raise BuildingModelValidationError(
                    rule_id="OPENING_IN_WALL",
                    node_id=o.id,
                    expected=(
                        f"distance_along_wall + width <= {wall_len - 0.1:.4f}m "
                        f"(wall_len {wall_len:.4f} - 100mm clearance)"
                    ),
                    actual=(
                        f"distance_along_wall ({o.distance_along_wall:.4f}) + "
                        f"width ({o.width:.4f}) = {far_edge:.4f}m"
                    ),
                    hint=(
                        "Opening extends past wall end. Shrink width or move "
                        "distance_along_wall closer to start."
                    ),
                )

    # ---- Invariant 5 ---------------------------------------------------
    @staticmethod
    def _i_door_in_opening(ctx: _ValidationContext) -> None:
        for d in ctx.doors:
            if d.in_opening_id not in ctx.openings_by_id:
                raise BuildingModelValidationError(
                    rule_id="DOOR_IN_OPENING",
                    node_id=d.id,
                    expected=f"in_opening_id '{d.in_opening_id}' to exist on some storey",
                    actual="not found",
                    hint="Set the door's in_opening_id to a valid opening.id.",
                )

    # ---- Invariant 6 ---------------------------------------------------
    @staticmethod
    def _i_door_connects_rooms(ctx: _ValidationContext) -> None:
        for d in ctx.doors:
            rids = list(d.connects_room_ids)
            if not (1 <= len(rids) <= 2):
                # Pydantic Field(min_length=1, max_length=2) catches this at parse
                # time; this branch is defensive in case validation is bypassed.
                raise BuildingModelValidationError(
                    rule_id="DOOR_CONNECTS_ROOMS",
                    node_id=d.id,
                    expected="1 (exterior) or 2 (interior) connects_room_ids",
                    actual=f"{len(rids)}",
                    hint="Use 1 id + 'Outside' for exterior; 2 distinct room ids for interior.",
                )
            if len(rids) == 2 and rids[0] == rids[1]:
                raise BuildingModelValidationError(
                    rule_id="DOOR_CONNECTS_ROOMS",
                    node_id=d.id,
                    expected="distinct connects_room_ids",
                    actual=f"both ids are '{rids[0]}'",
                    hint="A door cannot connect a room to itself; use 'Outside' for exterior.",
                )
            for rid in rids:
                if rid == "Outside":
                    continue
                if rid not in ctx.rooms_by_id:
                    raise BuildingModelValidationError(
                        rule_id="DOOR_CONNECTS_ROOMS",
                        node_id=d.id,
                        expected=f"connects_room_id '{rid}' to exist or be 'Outside'",
                        actual="not found in any storey's rooms",
                        hint=(
                            "Either add the missing room, or use the 'Outside' "
                            "sentinel for exterior doors."
                        ),
                    )

    # ---- Invariant 7 ---------------------------------------------------
    @staticmethod
    def _i_beam_supported(ctx: _ValidationContext) -> None:
        for b in ctx.beams:
            # Path A: at least one supporting column id
            if b.supported_by_column_ids:
                for cid in b.supported_by_column_ids:
                    if cid not in ctx.columns_by_id:
                        raise BuildingModelValidationError(
                            rule_id="BEAM_SUPPORTED",
                            node_id=b.id,
                            expected=f"supporting column id '{cid}' to exist",
                            actual="not found in structural_system.columns",
                            hint="Set supported_by_column_ids to existing column.id values.",
                        )
                continue
            # Path B: cantilever via moment connection
            if b.has_moment_connection:
                target = b.moment_connection_target_id
                if not target:
                    raise BuildingModelValidationError(
                        rule_id="BEAM_SUPPORTED",
                        node_id=b.id,
                        expected="moment_connection_target_id when has_moment_connection=True",
                        actual="None",
                        hint=(
                            "Cantilever beams must reference what they cantilever from "
                            "(column / wall / slab id)."
                        ),
                    )
                if (
                    target not in ctx.columns_by_id
                    and target not in ctx.walls_by_id
                    and target not in ctx.slabs_by_id
                ):
                    raise BuildingModelValidationError(
                        rule_id="BEAM_SUPPORTED",
                        node_id=b.id,
                        expected=(
                            f"moment_connection_target_id '{target}' to exist as "
                            "column / wall / slab"
                        ),
                        actual="not found in any of the three pools",
                        hint="Verify the target id matches an existing structural element.",
                    )
                continue
            # Neither path → unsupported beam
            raise BuildingModelValidationError(
                rule_id="BEAM_SUPPORTED",
                node_id=b.id,
                expected="at least one supporting column OR a moment connection",
                actual="empty supported_by_column_ids and has_moment_connection=False",
                hint=(
                    "Every beam must rest on at least one column or be explicitly "
                    "modelled as a cantilever."
                ),
            )

    # ---- Invariant 8 ---------------------------------------------------
    @staticmethod
    def _i_column_axis_valid(ctx: _ValidationContext) -> None:
        if ctx.building.structural_system.allows_slanted:
            return  # check skipped per spec
        for c in ctx.columns_by_id.values():
            if c.top_location is None:
                continue  # vertical by default
            dx = c.top_location.x - c.location.x
            dy = c.top_location.y - c.location.y
            horiz_offset = (dx * dx + dy * dy) ** 0.5
            if horiz_offset > 0.005:
                raise BuildingModelValidationError(
                    rule_id="COLUMN_AXIS_VALID",
                    node_id=c.id,
                    expected=(
                        "vertical column axis (top_location aligned with location "
                        "within 5mm) when StructuralSystem.allows_slanted=False"
                    ),
                    actual=f"horizontal offset = {horiz_offset:.4f}m",
                    hint=(
                        "Either set top_location=None for a vertical column, or set "
                        "StructuralSystem.allows_slanted=True to permit slanted geometry."
                    ),
                )

    # ---- Invariant 9 ---------------------------------------------------
    @staticmethod
    def _i_room_bounded(ctx: _ValidationContext) -> None:
        """ROOM_BOUNDED — bounding edges enclose a valid simple polygon.

        Implementation note (divergence from the literal spec wording):

            The spec says "construct polygon by concatenating offset points
            from each edge in order, then assert closure within 50mm and
            shapely is_valid". That literal algorithm produces a
            self-intersecting polygon for any rectangular room with
            finite-thickness walls — each wall's offset axis stops short
            of the geometric corner by half a wall thickness, so connecting
            consecutive walls' offsets traces a zig-zag through every
            corner. Verified by direct construction: for 50mm walls on a
            5×5 room, shapely declares the resulting polygon invalid.

            The geometrically correct construction is: for each consecutive
            pair of bounding edges, intersect their offset-axis extensions
            to get the inner corner. That yields a clean N-vertex polygon
            for an N-edge room. The closure check becomes inherent (the
            polygon is a closed loop by construction) so we drop the 50mm
            assertion and rely on shapely.is_valid + ≥3 corners.

            This preserves the spec's *intent* (detect malformed bounding
            edge sequences) while producing a correct algorithm. The
            literal spec wording is a Slice-1 finding to flag with the
            plan author.
        """
        for r in ctx.rooms_by_id.values():
            if len(r.bounding_edges) < 3:
                raise BuildingModelValidationError(
                    rule_id="ROOM_BOUNDED",
                    node_id=r.id,
                    expected="at least 3 bounding_edges",
                    actual=f"{len(r.bounding_edges)}",
                    hint="A room polygon needs at least 3 wall sides to enclose an area.",
                )
            # Build per-edge offset axis (start, end of the offset polyline).
            offset_axes: list[tuple[Vec2, Vec2]] = []
            for edge in r.bounding_edges:
                if edge.wall_id not in ctx.walls_by_id:
                    raise BuildingModelValidationError(
                        rule_id="ROOM_BOUNDED",
                        node_id=r.id,
                        expected=f"bounding edge wall_id '{edge.wall_id}' to exist",
                        actual="not found in any storey's walls",
                        hint="Set the BoundaryEdge.wall_id to a valid wall.id.",
                    )
                wall = ctx.walls_by_id[edge.wall_id]
                axis_offsets = _offset_axis(
                    wall.axis_points, wall.thickness / 2.0, edge.side
                )
                if len(axis_offsets) < 2:
                    raise BuildingModelValidationError(
                        rule_id="ROOM_BOUNDED",
                        node_id=r.id,
                        expected=(
                            f"bounding wall '{edge.wall_id}' to have >= 1 "
                            "non-degenerate axis segment"
                        ),
                        actual="zero non-degenerate segments after perpendicular offset",
                        hint=(
                            "Wall axis_points collapse to a point — check input "
                            "geometry for zero-length walls."
                        ),
                    )
                offset_axes.append((axis_offsets[0], axis_offsets[-1]))
            # Resolve polygon corners by intersecting consecutive offset axes
            # (extended as infinite lines).
            n = len(offset_axes)
            corners: list[Vec2] = []
            for i in range(n):
                prev_start, prev_end = offset_axes[(i - 1) % n]
                curr_start, curr_end = offset_axes[i]
                prev_dir = Vec2(
                    x=prev_end.x - prev_start.x,
                    y=prev_end.y - prev_start.y,
                )
                curr_dir = Vec2(
                    x=curr_end.x - curr_start.x,
                    y=curr_end.y - curr_start.y,
                )
                corner = _line_intersection(prev_start, prev_dir, curr_start, curr_dir)
                if corner is None:
                    raise BuildingModelValidationError(
                        rule_id="ROOM_BOUNDED",
                        node_id=r.id,
                        expected=(
                            "consecutive bounding edges to meet at a finite corner "
                            "(offset axes non-parallel)"
                        ),
                        actual=(
                            f"bounding edges {(i - 1) % n} → {i} have parallel offset "
                            f"axes (walls '{r.bounding_edges[(i - 1) % n].wall_id}' and "
                            f"'{r.bounding_edges[i].wall_id}' are collinear or anti-parallel)"
                        ),
                        hint=(
                            "Consecutive bounding edges must reference walls that meet "
                            "at a non-zero angle. Reorder bounding_edges or merge "
                            "collinear walls into one entry."
                        ),
                    )
                corners.append(corner)
            try:
                shp = Polygon([(p.x, p.y) for p in corners])
            except Exception as exc:  # pragma: no cover
                raise BuildingModelValidationError(
                    rule_id="ROOM_BOUNDED",
                    node_id=r.id,
                    expected="shapely-constructable corner-resolved boundary polygon",
                    actual=f"{type(exc).__name__}: {exc}",
                    hint="Resolved corners produce an unbuildable polygon.",
                ) from exc
            if not shp.is_valid:
                raise BuildingModelValidationError(
                    rule_id="ROOM_BOUNDED",
                    node_id=r.id,
                    expected="simple non-self-intersecting boundary polygon",
                    actual="shapely is_valid=False on corner-resolved polygon",
                    hint=(
                        "Synthesized boundary polygon self-intersects; bounding edges "
                        "are out of traversal order or wall axes cross each other."
                    ),
                )

    # ---- Invariant 10 --------------------------------------------------
    @staticmethod
    def _i_mep_terminates(ctx: _ValidationContext) -> None:
        for sys in ctx.mep_systems:
            # (a) source or at least one terminal must exist for the system to be anchored
            if sys.source is None and not sys.terminals:
                raise BuildingModelValidationError(
                    rule_id="MEP_TERMINATES",
                    node_id=sys.id,
                    expected="non-None source OR at least one terminal",
                    actual="source=None and zero terminals",
                    hint=(
                        "An MEP system must have at least an origin (source equipment) "
                        "or an end-point (terminal) for connectivity to make sense."
                    ),
                )
            if not sys.distribution:
                continue  # no segments → nothing to validate further
            # (b) build connectivity graph from segment endpoint proximity (5mm tol)
            # Each segment is a graph edge between two cluster ids; cluster ids
            # are assigned by greedy 5mm proximity merging across all anchor
            # points (segment endpoints + source + terminals).
            anchors: list[tuple[str, Vec3]] = []  # (label, point)
            for seg in sys.distribution:
                anchors.append((f"seg::{seg.id}::start", seg.start_point))
                anchors.append((f"seg::{seg.id}::end", seg.end_point))
            if sys.source is not None:
                anchors.append((f"src::{sys.source.id}", sys.source.location))
            for term in sys.terminals:
                anchors.append((f"term::{term.id}", term.location))

            cluster_id_for: dict[str, int] = {}
            cluster_centroids: list[Vec3] = []
            for label, pt in anchors:
                matched: Optional[int] = None
                for cid, c in enumerate(cluster_centroids):
                    if _points_close(pt, c, 0.005):
                        matched = cid
                        break
                if matched is None:
                    cluster_id_for[label] = len(cluster_centroids)
                    cluster_centroids.append(pt)
                else:
                    cluster_id_for[label] = matched

            # Build adjacency on cluster ids via segments
            adj: dict[int, list[tuple[int, str]]] = defaultdict(list)
            for seg in sys.distribution:
                a = cluster_id_for[f"seg::{seg.id}::start"]
                b = cluster_id_for[f"seg::{seg.id}::end"]
                adj[a].append((b, seg.id))
                adj[b].append((a, seg.id))

            # (c) cycle detection via DFS, treating each segment as a single
            # edge that must not be traversed twice from different parents.
            visited_nodes: set[int] = set()
            for start in adj:
                if start in visited_nodes:
                    continue
                # iterative DFS; stack carries (node, parent_edge_id)
                stack: list[tuple[int, Optional[str]]] = [(start, None)]
                local_seen: set[int] = set()
                while stack:
                    node, parent_edge = stack.pop()
                    if node in local_seen:
                        raise BuildingModelValidationError(
                            rule_id="MEP_TERMINATES",
                            node_id=sys.id,
                            expected="acyclic distribution graph",
                            actual=f"cycle detected reaching node cluster {node}",
                            hint=(
                                "Distribution segments form a loop. Remove a segment "
                                "or split the system into separate branches."
                            ),
                        )
                    local_seen.add(node)
                    visited_nodes.add(node)
                    for neighbor, edge_id in adj[node]:
                        if edge_id == parent_edge:
                            continue
                        if neighbor in local_seen:
                            raise BuildingModelValidationError(
                                rule_id="MEP_TERMINATES",
                                node_id=sys.id,
                                expected="acyclic distribution graph",
                                actual=(
                                    f"cycle detected via segment '{edge_id}' from "
                                    f"cluster {node} → already-visited cluster {neighbor}"
                                ),
                                hint=(
                                    "Distribution segments form a loop. Remove a segment "
                                    "or split the system into separate branches."
                                ),
                            )
                        stack.append((neighbor, edge_id))

            # (d) every connected component must contain source or terminal
            anchor_clusters: set[int] = set()
            if sys.source is not None:
                anchor_clusters.add(cluster_id_for[f"src::{sys.source.id}"])
            for term in sys.terminals:
                anchor_clusters.add(cluster_id_for[f"term::{term.id}"])

            # Components by BFS over the same adjacency
            components: list[set[int]] = []
            seen_global: set[int] = set()
            for node in adj:
                if node in seen_global:
                    continue
                comp: set[int] = set()
                queue: list[int] = [node]
                while queue:
                    n = queue.pop()
                    if n in comp:
                        continue
                    comp.add(n)
                    for neigh, _ in adj[n]:
                        if neigh not in comp:
                            queue.append(neigh)
                components.append(comp)
                seen_global |= comp
            for comp in components:
                if not (comp & anchor_clusters):
                    raise BuildingModelValidationError(
                        rule_id="MEP_TERMINATES",
                        node_id=sys.id,
                        expected="every connected component to include the source or a terminal",
                        actual=f"orphan component with cluster ids {sorted(comp)}",
                        hint=(
                            "A run of segments dead-ends without source or terminal; "
                            "either connect it to the system or remove it."
                        ),
                    )

    # ---- Invariant 11 --------------------------------------------------
    @staticmethod
    def _i_stair_rise_matches(ctx: _ValidationContext) -> None:
        for stair in ctx.stairs:
            host = ctx.storeys_by_id.get(stair.host_storey_id)
            if host is None:
                raise BuildingModelValidationError(
                    rule_id="STAIR_RISE_MATCHES",
                    node_id=stair.id,
                    expected=f"host_storey_id '{stair.host_storey_id}' to exist",
                    actual="not found",
                    hint="Set stair.host_storey_id to the LOWER storey.id the stair starts on.",
                )
            next_storey = ctx.storeys_by_index.get(host.index + 1)
            if next_storey is None:
                raise BuildingModelValidationError(
                    rule_id="STAIR_RISE_MATCHES",
                    node_id=stair.id,
                    expected=f"a storey at index {host.index + 1} above the host",
                    actual=(
                        f"highest storey index is {max(ctx.storeys_by_index)} "
                        f"(host '{host.id}' is at index {host.index})"
                    ),
                    hint="A stair must connect to a storey above its host_storey_id.",
                )
            slab_below = BuildingModel._pick_floor_slab(
                ctx.slabs_by_storey.get(stair.host_storey_id, []),
                stair.id,
                stair.host_storey_id,
                "slab_below",
            )
            slab_above = BuildingModel._pick_floor_slab(
                ctx.slabs_by_storey.get(next_storey.id, []),
                stair.id,
                next_storey.id,
                "slab_above",
            )
            rise_total = stair.riser_count * stair.riser_height
            structural_rise = slab_above.bottom_z - slab_below.top_z
            if abs(rise_total - structural_rise) > 0.001:
                raise BuildingModelValidationError(
                    rule_id="STAIR_RISE_MATCHES",
                    node_id=stair.id,
                    expected=(
                        f"riser_count * riser_height == "
                        f"slab_above.bottom_z ({slab_above.bottom_z:.4f}) - "
                        f"slab_below.top_z ({slab_below.top_z:.4f}) = "
                        f"{structural_rise:.4f}m"
                    ),
                    actual=(
                        f"{stair.riser_count} * {stair.riser_height:.4f} = "
                        f"{rise_total:.4f}m"
                    ),
                    hint=(
                        "Adjust riser_count or riser_height so the total rise matches "
                        "the structural floor-to-floor distance within 1mm."
                    ),
                )

    @staticmethod
    def _pick_floor_slab(
        candidates: list[Slab], stair_id: str, storey_id: str, label: str
    ) -> Slab:
        if not candidates:
            raise BuildingModelValidationError(
                rule_id="STAIR_RISE_MATCHES",
                node_id=stair_id,
                expected=f"a slab on storey '{storey_id}' for {label}",
                actual="zero slabs on that storey",
                hint=(
                    f"Add at least one FLOOR slab to storey '{storey_id}' before "
                    "the stair can be validated."
                ),
            )
        if len(candidates) == 1:
            return candidates[0]
        floor_only = [s for s in candidates if s.predefined_type == "FLOOR"]
        if len(floor_only) == 1:
            return floor_only[0]
        if len(floor_only) == 0:
            raise BuildingModelValidationError(
                rule_id="STAIR_RISE_MATCHES",
                node_id=stair_id,
                expected=f"exactly one FLOOR slab on storey '{storey_id}' for {label}",
                actual=(
                    f"zero FLOOR slabs (predefined_types found: "
                    f"{sorted({s.predefined_type for s in candidates})})"
                ),
                hint=(
                    f"None of the slabs on '{storey_id}' have predefined_type='FLOOR'; "
                    "tag exactly one as FLOOR."
                ),
            )
        raise BuildingModelValidationError(
            rule_id="STAIR_RISE_MATCHES",
            node_id=stair_id,
            expected=f"exactly one FLOOR slab on storey '{storey_id}' for {label}",
            actual=f"multiple FLOOR slabs ({len(floor_only)})",
            hint=(
                f"multiple FLOOR slabs on storey '{storey_id}'; cannot determine "
                f"{label} unambiguously. Split slabs by storey or merge."
            ),
        )

    # ---- Invariant 12 --------------------------------------------------
    @staticmethod
    def _i_footprint_valid(ctx: _ValidationContext) -> None:
        targets: list[tuple[str, str, list[Vec2]]] = []
        bld = ctx.building
        if bld.envelope_polygon:
            targets.append(("Building envelope", bld.id, bld.envelope_polygon))
        for storey in bld.storeys:
            for room in storey.rooms:
                targets.append(("Room footprint", room.id, room.footprint_polygon))
            for slab in storey.slabs:
                targets.append(("Slab footprint", slab.id, slab.footprint_polygon))
        if bld.foundation:
            for footing in bld.foundation.footings:
                targets.append(("Footing footprint", footing.id, footing.footprint_polygon))

        for label, node_id, coords in targets:
            distinct = _count_distinct_vertices(coords, 0.001)
            if distinct < 3:
                raise BuildingModelValidationError(
                    rule_id="FOOTPRINT_VALID",
                    node_id=node_id,
                    expected=f"{label}: >= 3 distinct vertices (within 1mm)",
                    actual=f"{distinct} distinct out of {len(coords)} input points",
                    hint=f"{label} polygon collapses to <3 unique points; cannot enclose area.",
                )
            try:
                shp = Polygon([(v.x, v.y) for v in coords])
            except Exception as exc:  # pragma: no cover
                raise BuildingModelValidationError(
                    rule_id="FOOTPRINT_VALID",
                    node_id=node_id,
                    expected=f"{label}: shapely-constructable polygon",
                    actual=f"{type(exc).__name__}: {exc}",
                    hint=f"{label} polygon points cannot be assembled by shapely.",
                ) from exc
            if not shp.is_valid:
                raise BuildingModelValidationError(
                    rule_id="FOOTPRINT_VALID",
                    node_id=node_id,
                    expected=f"{label}: simple non-self-intersecting polygon",
                    actual="shapely is_valid=False",
                    hint=f"{label} self-intersects or has degenerate edges.",
                )
            sa = _signed_area(coords)
            if sa <= 0:
                raise BuildingModelValidationError(
                    rule_id="FOOTPRINT_VALID",
                    node_id=node_id,
                    expected=f"{label}: counterclockwise winding (signed area > 0)",
                    actual=f"signed area = {sa:.6f}",
                    hint=(
                        f"{label} is clockwise / collinear / zero-area. Reverse the "
                        "vertex order to make it CCW."
                    ),
                )


__all__ = [
    "BuildingModel",
    "BuildingModelValidationError",
    "BuildingModelResolutionError",
    "Project",
    "ProjectMetadata",
    "Provenance",
    "Site",
    "Building",
    "Storey",
    "Room",
    "BoundaryEdge",
    "Wall",
    "Slab",
    "Column",
    "Beam",
    "Footing",
    "Foundation",
    "Roof",
    "StructuralSystem",
    "Grid",
    "GridAxis",
    "MEPSystem",
    "MEPEquipment",
    "MEPSegment",
    "MEPTerminal",
    "Door",
    "Window",
    "Opening",
    "Stair",
    "MaterialLayer",
    "ProfileRef",
    "GeoReference",
    "ReraData",
    "Permit",
    "Vec2",
    "Vec3",
]
