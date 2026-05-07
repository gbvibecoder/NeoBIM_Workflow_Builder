"""Phase 2A — Design-agent intake schemas.

Pure-Python typed envelope between the new ``POST /api/v1/design/analyze``
endpoint and the design stages (``brief_analyst`` → ``program_architect``
in 2A; massing / layout / structural / MEP / envelope architects in 2B).

Layering rules (mirroring Phase 1's ``app/domain/building_model.py``)
--------------------------------------------------------------------
* No imports of ``ifcopenshell``, ``app.services.ifc_*``, ``app.routers``,
  or any LLM SDK from this module. ``types.py`` is the lowest leaf in the
  package and must stay import-light. Anyone adding a heavy import here is
  breaking the layering.
* Every node class is ``frozen=True`` and uses ``ConfigDict``. Pydantic v2.
* Cross-references between nodes are string ids resolved by per-model
  ``@model_validator(mode="after")`` rules. Each rule raises
  :class:`DesignContextValidationError` carrying ``rule_id``, ``node_id``,
  ``expected``, ``actual``, ``hint`` — never a generic ``ValueError``. This
  matches Phase 1's contract so route handlers, the BriefCritic stage in
  2C, and the lift bridge into ``BuildingModel`` can surface specific
  errors without string-matching.

Invariants enforced here (Phase 2A scope)
-----------------------------------------
* ``BRIEF_STYLE_WEIGHTS_NORMALIZED`` — weights on
  :class:`BriefStyleWeights` sum to 1.0 within ±1e-6 (a normalized
  probability distribution; downstream stages branch on the dominant
  weight).
* ``ROOM_AREA_RESPECTS_NBC`` — every :class:`RoomSpec`'s
  ``target_area_sqm`` is ≥ ``nbc_min_area_sqm``. Compliance with NBC
  India 2016 Part 4 minimum room sizes is the floor — the architect
  is allowed to size larger but never smaller.
* ``ROOM_ASPECT_VALID`` — ``aspect_ratio_max ≥ aspect_ratio_min``,
  both positive.
* ``ROOM_FLOORS_CONSISTENT`` — every room id in
  ``RoomProgram.rooms_per_floor`` exists in ``RoomProgram.rooms``;
  every room appears on exactly one floor; the room's stored
  ``floor_index`` matches the floor it's mapped to.
* ``ROOM_ADJACENCY_REFERENCES_VALID`` — every id in
  ``adjacency_required`` / ``adjacency_forbidden`` resolves to another
  room in the program (or the literal ``"Outside"`` sentinel).
* ``PROGRAM_AREA_RANGE_VALID`` —
  ``total_carpet_area_sqm_max ≥ total_carpet_area_sqm_min`` on
  :class:`ProgramConstraints`.

These invariants run on construction. Use the canonical ``.build(data)``
classmethod on :class:`DesignContext` / :class:`RoomProgram` /
:class:`BriefStyleWeights` (mirroring ``BuildingModel.build``) to receive
the structured error directly instead of Pydantic's generic wrapper.

The wider 30+ design-coherence rules (room program covers the brief's
explicit room list, building-class matches usage mix, etc.) are deferred
to the BriefCritic stage in Phase 2C — they need LLM judgement, not pure
schema validation.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ─── Errors ──────────────────────────────────────────────────────────


class DesignContextValidationError(ValueError):
    """Raised when a structural invariant on the design-context graph fails.

    Mirrors :class:`app.domain.building_model.BuildingModelValidationError`
    so route handlers can surface a single error envelope shape across
    Phase 1 (geometry-layer) and Phase 2A (design-context-layer)
    failures.
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


# ─── Allowed literals (kept as named tuples for reuse in tests) ──────


SiteOrientation = Literal["N", "S", "E", "W", "NE", "NW", "SE", "SW"]
SeismicZone = Literal["II", "III", "IV", "V"]
TargetFidelity = Literal["concept", "design-development", "tender-ready"]
# Two distinct structural-system vocabularies:
#   * FormStructuralSystem — short user-facing labels in BriefForm.
#     Treats "rcc" / "steel" / "masonry" as the everyday Indian-builder
#     terms a user is most likely to type or pick from a dropdown.
#   * StructuralSystemKind — canonical frame-suffixed labels used by
#     the StructuralIntent + StructuralEngineer agent in Phase 2B.
# The BriefAnalyst maps form values to canonical values during
# enrichment ("rcc" → "rcc_frame", "masonry" → "load_bearing_masonry").
FormStructuralSystem = Literal["rcc", "steel", "masonry", "auto"]
StructuralSystemKind = Literal[
    "rcc_frame", "steel_frame", "load_bearing_masonry", "composite", "auto"
]
MassingHint = Literal[
    "rectangular", "L_shape", "U_shape", "circular",
    "elliptical", "courtyard", "free_form",
]
FacadeTreatment = Literal[
    "plaster_paint", "brick_exposed", "stone_clad",
    "glass_curtain", "metal_panel", "wood_clad", "mixed",
]
NBCGroup = Literal[
    "A-1", "A-2", "A-3", "A-4", "A-5",
    "B", "C", "D", "E", "F", "G", "H", "I",
]
PrimaryBuildingType = Literal[
    "residential", "office", "retail", "warehouse",
    "hospital", "school", "hotel", "mixed_use", "unknown",
]
FormBuildingType = Literal[
    "residential", "office", "retail", "warehouse",
    "hospital", "school", "hotel", "mixed_use",
]
PrivacyLevel = Literal["public", "semi_private", "private"]
# Note on the "Outside" sentinel — Phase 2A Slice 1 Q2 refinement
# ----------------------------------------------------------------
# The literal string ``"Outside"`` is intentionally NOT included in
# ``RoomUsage``. ``"Outside"`` is a magic-string sentinel reserved for
# adjacency-array fields (``RoomSpec.adjacency_required`` /
# ``adjacency_forbidden``) and Phase 1's
# ``Door.connects_room_ids``. Keeping it out of the typed enum prevents
# anyone from accidentally constructing a sized :class:`RoomSpec` whose
# ``usage="Outside"`` (which would have no NBC minimum and no defined
# semantics for a sized exterior). For legitimate sized exterior
# spaces — terraces, courtyards, verandahs, balcony slabs — use the
# ``"external"`` literal, which has an explicit NBC minimum (1.4 sqm,
# matching the balcony floor) and behaves as a real, sized room.
RoomUsage = Literal[
    "living", "dining", "kitchen", "bedroom", "master_bedroom",
    "bathroom", "powder_room", "study", "store", "balcony",
    "corridor", "lobby", "stairs_landing", "utility",
    "office", "meeting_room", "reception", "pantry",
    "ward", "consultation", "operation_theatre", "icu",
    "classroom", "library", "auditorium",
    "shop", "showroom", "stock_room",
    "warehouse_floor", "loading_bay",
    "pooja_room", "puja", "vastu_zone",
    "external",
]
FoundationHint = Literal["isolated_pad", "strip", "raft", "pile"]


# ─── INPUT SCHEMAS ───────────────────────────────────────────────────


class BriefForm(BaseModel):
    """Structured form fields a user can fill in lieu of free text.

    All fields are Optional. The agent treats empty fields as "infer or
    leave None"; it never invents values. The form is a *parametric*
    signal source — every set field nudges the classifier's
    ``parametric`` weight up.
    """

    model_config = ConfigDict(frozen=True)
    plot_dimensions_m: Optional[tuple[float, float]] = None
    plot_area_sqft: Optional[float] = Field(default=None, gt=0)
    floors: Optional[int] = Field(default=None, ge=1, le=50)
    bhk_count: Optional[int] = Field(default=None, ge=0, le=20)
    building_type: Optional[FormBuildingType] = None
    style: Optional[str] = None
    structural_system: Optional[FormStructuralSystem] = "auto"
    parking_required: Optional[bool] = None
    site_orientation: Optional[SiteOrientation] = None
    location_city: Optional[str] = None
    budget_inr_lakhs: Optional[float] = Field(default=None, ge=0)
    site_constraints: Optional[list[str]] = None
    user_notes: Optional[str] = None


class DesignRequest(BaseModel):
    """Top-level request envelope for ``POST /api/v1/design/analyze``.

    ``build_id`` is a uuid4 the route handler stamps before passing to
    classification. Tests construct a fixed ``build_id`` for determinism.
    """

    model_config = ConfigDict(frozen=True)
    brief_pdf_url: Optional[str] = None
    brief_pdf_text: Optional[str] = None
    brief_form: Optional[BriefForm] = None
    brief_text: Optional[str] = None
    target_fidelity: TargetFidelity = "design-development"
    build_id: str = Field(min_length=1)


# ─── CLASSIFIER OUTPUT ───────────────────────────────────────────────


class BriefStyleWeights(BaseModel):
    """Hybrid weighted scores across the 3 brief styles.

    Sum to 1.0 (enforced). High-confidence single-style briefs land near
    one extreme (e.g. 0.9 / 0.05 / 0.05); ambiguous briefs distribute
    weight more evenly. Downstream stages branch on the dominant weight
    rather than a hard label.

    ``confidence`` is independent of the weights themselves: a brief can
    be unambiguously ``narrative=0.9`` with ``confidence=0.95`` (clean
    classifier signal) OR a brief can be ``narrative=0.34, parametric=0.33,
    floor_plan=0.33`` with ``confidence=0.30`` (genuinely ambiguous).
    """

    model_config = ConfigDict(frozen=True)
    floor_plan: float = Field(ge=0.0, le=1.0)
    narrative: float = Field(ge=0.0, le=1.0)
    parametric: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(min_length=1)

    @model_validator(mode="after")
    def _weights_sum_to_one(self) -> "BriefStyleWeights":
        total = self.floor_plan + self.narrative + self.parametric
        if abs(total - 1.0) > 1e-6:
            raise DesignContextValidationError(
                rule_id="BRIEF_STYLE_WEIGHTS_NORMALIZED",
                node_id="BriefStyleWeights",
                expected="floor_plan + narrative + parametric == 1.0 (±1e-6)",
                actual=(
                    f"sum = {total:.9f} "
                    f"(floor_plan={self.floor_plan:.4f}, "
                    f"narrative={self.narrative:.4f}, "
                    f"parametric={self.parametric:.4f})"
                ),
                hint=(
                    "Brief style weights must form a probability distribution. "
                    "Renormalise by dividing each component by their total before "
                    "constructing BriefStyleWeights."
                ),
            )
        return self

    @classmethod
    def build(cls, data: dict) -> "BriefStyleWeights":
        """Canonical constructor — unwraps ``DesignContextValidationError``.

        Pydantic v2 wraps any ``ValueError`` raised inside a model
        validator into a ``ValidationError``. We unwrap here so callers
        receive the structured ``rule_id`` / ``hint`` envelope directly.
        Same pattern as :meth:`BuildingModel.build`.
        """
        return _build_unwrapping(cls, data)


# ─── BRIEF ANALYST OUTPUT ────────────────────────────────────────────


class BuildingClass(BaseModel):
    """Detected building category, NBC India occupancy class, and load."""

    model_config = ConfigDict(frozen=True)
    primary_type: PrimaryBuildingType
    sub_type: str = Field(min_length=1)
    nbc_group: NBCGroup
    nbc_subdivision: str = Field(min_length=1)
    occupancy_load_persons: Optional[int] = Field(default=None, ge=0)


class SiteContext(BaseModel):
    """Site-level constraints extracted (or enriched) from the brief.

    ``seismic_zone`` and ``wind_zone`` are populated by post-LLM lookups
    against ``reference_data.seismic_zones_in`` / ``wind_zones_in`` when
    ``location_city`` resolves; otherwise ``None``. The LLM itself does
    not assign zones — that's a deterministic table lookup.
    """

    model_config = ConfigDict(frozen=True)
    plot_width_m: Optional[float] = Field(default=None, gt=0)
    plot_length_m: Optional[float] = Field(default=None, gt=0)
    plot_area_sqm: Optional[float] = Field(default=None, gt=0)
    site_orientation: Optional[SiteOrientation] = None
    location_city: Optional[str] = None
    seismic_zone: Optional[SeismicZone] = None
    wind_zone: Optional[int] = Field(default=None, ge=1, le=6)
    setbacks_m: Optional[dict[str, float]] = None
    max_height_m: Optional[float] = Field(default=None, gt=0)
    fsi_or_far: Optional[float] = Field(default=None, gt=0)


class StyleIntent(BaseModel):
    """Aesthetic and design intent."""

    model_config = ConfigDict(frozen=True)
    architectural_style: str = Field(min_length=1)
    cultural_overlay: Optional[str] = None
    massing_hint: Optional[MassingHint] = None
    facade_treatment: Optional[FacadeTreatment] = None


class StructuralIntent(BaseModel):
    """Structural choices — explicit from the brief, or inferred."""

    model_config = ConfigDict(frozen=True)
    system: StructuralSystemKind = "auto"
    foundation_hint: Optional[FoundationHint] = None
    seismic_design_required: bool = True
    wind_design_required: bool = True


class FidelityHint(BaseModel):
    """Output-detail hints derived from ``target_fidelity``.

    ``concept`` keeps everything False. ``design-development`` enables
    MEP routing. ``tender-ready`` enables rebar + COBie. The mapping is
    deterministic — see :func:`fidelity_hint_for`.
    """

    model_config = ConfigDict(frozen=True)
    rebar_required: bool = False
    mep_routing_required: bool = False
    cobie_required: bool = False


def fidelity_hint_for(target: TargetFidelity) -> FidelityHint:
    """Canonical ``target_fidelity`` → :class:`FidelityHint` mapping.

    Centralised so the BriefAnalyst stage and any downstream consumer
    use the same answer. Phase 2B's MEP / structural agents read this
    to skip detail work the user didn't ask for.
    """
    if target == "concept":
        return FidelityHint()
    if target == "design-development":
        return FidelityHint(mep_routing_required=True)
    return FidelityHint(
        rebar_required=True,
        mep_routing_required=True,
        cobie_required=True,
    )


class BriefAnalysis(BaseModel):
    """Structured output of the BriefAnalyst stage.

    ``raw_brief_summary`` is a 2-3 sentence paraphrase the agent writes;
    used downstream by the BriefCritic in 2C to detect intent drift.
    ``extraction_warnings`` carry every field the agent could not
    confidently extract — never a fabrication.
    """

    model_config = ConfigDict(frozen=True)
    building_class: BuildingClass
    site_context: SiteContext
    style_intent: StyleIntent
    structural_intent: StructuralIntent
    fidelity_hint: FidelityHint
    floors_above_ground: int = Field(ge=1, le=50)
    floors_below_ground: int = Field(ge=0, le=10)
    explicit_room_list: list[str] = Field(default_factory=list)
    explicit_dimensions: dict[str, str] = Field(default_factory=dict)
    user_priorities: list[str] = Field(default_factory=list)
    raw_brief_summary: str = Field(min_length=1)
    extraction_warnings: list[str] = Field(default_factory=list)


# ─── PROGRAM ARCHITECT OUTPUT ────────────────────────────────────────


class RoomSpec(BaseModel):
    """One room in the program.

    ``target_area_sqm`` is CARPET area (RERA definition: actual usable
    floor area within the walls). ``nbc_min_area_sqm`` is the NBC India
    2016 Part 4 minimum for the usage; ROOM_AREA_RESPECTS_NBC enforces
    that ``target_area_sqm`` never drops below it.

    Adjacency arrays accept the literal ``"Outside"`` for relationships
    to the building exterior (e.g. balconies adjacent to ``"Outside"``);
    this matches the Phase 1 BuildingModel's ``Door.connects_room_ids``
    convention so the program → BuildingModel lift is straightforward.
    """

    model_config = ConfigDict(frozen=True)
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    usage: RoomUsage
    target_area_sqm: float = Field(gt=0)
    nbc_min_area_sqm: float = Field(gt=0)
    aspect_ratio_min: float = Field(default=1.0, gt=0)
    aspect_ratio_max: float = Field(default=3.0, gt=0)
    natural_light_required: bool = False
    natural_ventilation_required: bool = False
    privacy_level: PrivacyLevel = "private"
    floor_index: int = Field(ge=-10, le=50)
    adjacency_required: list[str] = Field(default_factory=list)
    adjacency_forbidden: list[str] = Field(default_factory=list)
    notes: str = ""

    @model_validator(mode="after")
    def _room_invariants(self) -> "RoomSpec":
        # ROOM_AREA_RESPECTS_NBC — target area must be >= NBC minimum.
        if self.target_area_sqm < self.nbc_min_area_sqm:
            raise DesignContextValidationError(
                rule_id="ROOM_AREA_RESPECTS_NBC",
                node_id=self.id,
                expected=(
                    f"target_area_sqm >= nbc_min_area_sqm "
                    f"({self.nbc_min_area_sqm:.2f} sqm) "
                    f"for usage='{self.usage}'"
                ),
                actual=f"target_area_sqm = {self.target_area_sqm:.2f} sqm",
                hint=(
                    "Room target carpet area is below the NBC India 2016 "
                    "Part 4 minimum for this usage. Either increase the area "
                    "or revisit the usage classification — assigning a smaller "
                    "minimum is not acceptable."
                ),
            )
        # ROOM_ASPECT_VALID — max >= min.
        if self.aspect_ratio_max < self.aspect_ratio_min:
            raise DesignContextValidationError(
                rule_id="ROOM_ASPECT_VALID",
                node_id=self.id,
                expected="aspect_ratio_max >= aspect_ratio_min",
                actual=(
                    f"aspect_ratio_min = {self.aspect_ratio_min:.2f}, "
                    f"aspect_ratio_max = {self.aspect_ratio_max:.2f}"
                ),
                hint=(
                    "Aspect ratio range is inverted. Set aspect_ratio_min as "
                    "the lower bound (e.g. 1.0 for a square-ish room) and "
                    "aspect_ratio_max as the upper bound (e.g. 2.5 for a "
                    "narrow rectangle)."
                ),
            )
        return self

    @classmethod
    def build(cls, data: dict) -> "RoomSpec":
        return _build_unwrapping(cls, data)


class CirculationSpec(BaseModel):
    """Corridors, stairs, lifts.

    ``corridor_min_width_m`` defaults to 1.2m (NBC India Part 4
    residential minimum). Commercial briefs override to 1.5m via the
    ProgramArchitect stage when the building class is non-residential.
    """

    model_config = ConfigDict(frozen=True)
    corridor_min_width_m: float = Field(default=1.2, gt=0)
    stair_count: int = Field(ge=1)
    lift_count: int = Field(default=0, ge=0)
    egress_paths_required: int = Field(ge=1)


class ProgramConstraints(BaseModel):
    """Hard constraints on the layout.

    ``rera_carpet_built_super_ratio`` is a 3-tuple
    ``(carpet, built_up, super_built_up)`` normalised so carpet=1.0.
    Default ``(1.0, 1.15, 1.30)`` reflects typical Indian residential
    practice — ProgramArchitect overrides per-region or per-building-type.
    """

    model_config = ConfigDict(frozen=True)
    total_carpet_area_sqm_min: float = Field(gt=0)
    total_carpet_area_sqm_max: float = Field(gt=0)
    rera_carpet_built_super_ratio: tuple[float, float, float] = (1.0, 1.15, 1.30)
    setbacks_m: dict[str, float] = Field(default_factory=dict)
    max_floors: int = Field(ge=1, le=50)

    @model_validator(mode="after")
    def _area_range_valid(self) -> "ProgramConstraints":
        if self.total_carpet_area_sqm_max < self.total_carpet_area_sqm_min:
            raise DesignContextValidationError(
                rule_id="PROGRAM_AREA_RANGE_VALID",
                node_id="ProgramConstraints",
                expected=(
                    "total_carpet_area_sqm_max >= total_carpet_area_sqm_min"
                ),
                actual=(
                    f"min = {self.total_carpet_area_sqm_min:.2f} sqm, "
                    f"max = {self.total_carpet_area_sqm_max:.2f} sqm"
                ),
                hint=(
                    "Total-area range is inverted. Pass the smaller carpet "
                    "area as min and the larger as max."
                ),
            )
        return self


class RoomProgram(BaseModel):
    """Structured output of the ProgramArchitect stage.

    Rooms are stored once in ``rooms``; ``rooms_per_floor`` is a side
    table mapping each floor index to the room ids on that floor. The
    ROOM_FLOORS_CONSISTENT invariant cross-validates the two views.
    """

    model_config = ConfigDict(frozen=True)
    rooms: list[RoomSpec] = Field(min_length=1)
    rooms_per_floor: dict[int, list[str]]
    circulation: CirculationSpec
    constraints: ProgramConstraints
    summary: str = Field(min_length=1)
    extraction_warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _program_invariants(self) -> "RoomProgram":
        rooms_by_id: dict[str, RoomSpec] = {}
        for room in self.rooms:
            if room.id in rooms_by_id:
                raise DesignContextValidationError(
                    rule_id="ROOM_FLOORS_CONSISTENT",
                    node_id=room.id,
                    expected="unique room ids across the program",
                    actual=f"id '{room.id}' appears more than once",
                    hint=(
                        "Rename one of the duplicate rooms so every "
                        "RoomSpec.id is unique within the program."
                    ),
                )
            rooms_by_id[room.id] = room

        # ROOM_FLOORS_CONSISTENT — each room appears in exactly one
        # rooms_per_floor entry; that floor matches room.floor_index.
        seen_in_floor_map: dict[str, int] = {}
        for floor_index, room_ids in self.rooms_per_floor.items():
            for rid in room_ids:
                if rid not in rooms_by_id:
                    raise DesignContextValidationError(
                        rule_id="ROOM_FLOORS_CONSISTENT",
                        node_id=rid,
                        expected=(
                            f"rooms_per_floor[{floor_index}] entry '{rid}' "
                            "to refer to an existing RoomSpec.id"
                        ),
                        actual=(
                            f"no room with id '{rid}' "
                            f"(known ids: {sorted(rooms_by_id)})"
                        ),
                        hint=(
                            "Either add a RoomSpec with this id or remove "
                            "the dangling reference from rooms_per_floor."
                        ),
                    )
                if rid in seen_in_floor_map:
                    raise DesignContextValidationError(
                        rule_id="ROOM_FLOORS_CONSISTENT",
                        node_id=rid,
                        expected="each room mapped to exactly one floor",
                        actual=(
                            f"id '{rid}' appears on floor "
                            f"{seen_in_floor_map[rid]} and floor {floor_index}"
                        ),
                        hint=(
                            "Remove the duplicate entry from rooms_per_floor "
                            "or split the room into per-floor instances with "
                            "distinct ids."
                        ),
                    )
                seen_in_floor_map[rid] = floor_index
                room = rooms_by_id[rid]
                if room.floor_index != floor_index:
                    raise DesignContextValidationError(
                        rule_id="ROOM_FLOORS_CONSISTENT",
                        node_id=rid,
                        expected=(
                            f"RoomSpec.floor_index == "
                            f"rooms_per_floor key ({floor_index})"
                        ),
                        actual=f"RoomSpec.floor_index = {room.floor_index}",
                        hint=(
                            "Synchronise the room's floor_index attribute "
                            "with the floor it's listed under in "
                            "rooms_per_floor — the two must agree."
                        ),
                    )

        for rid, room in rooms_by_id.items():
            if rid not in seen_in_floor_map:
                raise DesignContextValidationError(
                    rule_id="ROOM_FLOORS_CONSISTENT",
                    node_id=rid,
                    expected=(
                        "every RoomSpec to be listed under exactly one "
                        "rooms_per_floor entry"
                    ),
                    actual=(
                        f"id '{rid}' is not listed under any floor "
                        f"(rooms_per_floor keys: "
                        f"{sorted(self.rooms_per_floor)})"
                    ),
                    hint=(
                        "Add this room id to rooms_per_floor under "
                        f"floor_index {room.floor_index}."
                    ),
                )

        # ROOM_ADJACENCY_REFERENCES_VALID
        for room in self.rooms:
            for kind, ids in (
                ("adjacency_required", room.adjacency_required),
                ("adjacency_forbidden", room.adjacency_forbidden),
            ):
                for ref in ids:
                    if ref == "Outside":
                        continue
                    if ref not in rooms_by_id:
                        raise DesignContextValidationError(
                            rule_id="ROOM_ADJACENCY_REFERENCES_VALID",
                            node_id=room.id,
                            expected=(
                                f"{kind} entry '{ref}' to refer to an "
                                "existing RoomSpec.id or the literal 'Outside'"
                            ),
                            actual=(
                                f"no room with id '{ref}' "
                                f"(known ids: {sorted(rooms_by_id)})"
                            ),
                            hint=(
                                "Adjacency references must resolve. Use "
                                "'Outside' for relationships to the exterior, "
                                "or correct the typo."
                            ),
                        )
                    if ref == room.id:
                        raise DesignContextValidationError(
                            rule_id="ROOM_ADJACENCY_REFERENCES_VALID",
                            node_id=room.id,
                            expected=f"{kind} entries to reference other rooms",
                            actual=f"room references itself in {kind}",
                            hint=(
                                "A room cannot be adjacent to or forbid "
                                "adjacency with itself — remove the self-"
                                "reference."
                            ),
                        )

        return self

    @classmethod
    def build(cls, data: dict) -> "RoomProgram":
        return _build_unwrapping(cls, data)


# ─── DESIGN CONTEXT (final output of Phase 2A) ───────────────────────


class DesignContext(BaseModel):
    """Hand-off structure to Phase 2B design agents.

    Phase 2A produces this. Phase 2B's MassingArchitect, LayoutArchitect,
    StructuralEngineer, MEPEngineer, EnvelopeArchitect all consume it.

    Carries the full classifier / analyst / architect provenance dicts
    so the Phase 2C BriefCritic can audit the full reasoning chain (model
    used, latency, cache hits, prompt-cache stats, cost) without re-
    running upstream stages.
    """

    model_config = ConfigDict(frozen=True)
    request: DesignRequest
    style_weights: BriefStyleWeights
    analysis: BriefAnalysis
    program: RoomProgram
    classifier_metadata: dict = Field(default_factory=dict)
    analyst_metadata: dict = Field(default_factory=dict)
    architect_metadata: dict = Field(default_factory=dict)

    @classmethod
    def build(cls, data: dict) -> "DesignContext":
        return _build_unwrapping(cls, data)


# ─── Internal helpers ────────────────────────────────────────────────


def _build_unwrapping(cls, data: dict):
    """Unwrap Pydantic ValidationError → DesignContextValidationError.

    Pydantic v2 wraps any plain ``ValueError`` raised inside a
    ``@model_validator(mode="after")`` body into a generic
    ``ValidationError``, masking the original exception type. This
    helper inspects the wrapped error and, when the inner cause is a
    :class:`DesignContextValidationError`, re-raises it directly so
    callers receive the structured ``rule_id`` / ``hint`` envelope.

    Other Pydantic validation errors (type mismatches, missing required
    fields, ``Field`` constraint violations) pass through unchanged —
    those are parse-time failures, not invariant failures.

    Mirrors :meth:`app.domain.building_model.BuildingModel.build`.
    """
    from pydantic import ValidationError as _PydanticVE

    try:
        return cls.model_validate(data)
    except _PydanticVE as wrapper:
        for err in wrapper.errors():
            inner = err.get("ctx", {}).get("error")
            if isinstance(inner, DesignContextValidationError):
                raise inner from wrapper
        raise


# ─── Public exports ──────────────────────────────────────────────────


__all__ = [
    # Errors
    "DesignContextValidationError",
    # Inputs
    "BriefForm",
    "DesignRequest",
    # Classifier
    "BriefStyleWeights",
    # Brief analyst
    "BuildingClass",
    "SiteContext",
    "StyleIntent",
    "StructuralIntent",
    "FidelityHint",
    "fidelity_hint_for",
    "BriefAnalysis",
    # Program architect
    "RoomSpec",
    "CirculationSpec",
    "ProgramConstraints",
    "RoomProgram",
    # Final hand-off
    "DesignContext",
    # Literal aliases (re-exported for downstream typing)
    "SiteOrientation",
    "SeismicZone",
    "TargetFidelity",
    "FormStructuralSystem",
    "StructuralSystemKind",
    "MassingHint",
    "FacadeTreatment",
    "NBCGroup",
    "PrimaryBuildingType",
    "FormBuildingType",
    "PrivacyLevel",
    "RoomUsage",
    "FoundationHint",
]
