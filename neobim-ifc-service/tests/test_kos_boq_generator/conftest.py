"""Conftest for BOQ Generator tests.

PR 1 fixtures (smallest scope):

* ``p_int_8_boq_canonical_json`` — load golden JSON from disk
* ``boq_context_p_int_8`` — default ``BOQContext`` with determinism hooks pinned
* ``expected_boq_id_for_p_int_8`` — hand-computed UUID5

90VR-MR and Vamshi fixtures are intentionally deferred to PR 2, where
Tier 6/5/4 algorithms first need to test against real customer data.
PR 1 is foundation only (schema + types + golden JSON).

VALUE PROVENANCE: The golden JSON contains values that the BOQ algorithm
(shipping in PRs 2-6) must reproduce byte-for-byte. PR 1 hand-computes them:

* ``boq_id``: ``uuid.uuid5(_BOQ_UUID_NAMESPACE, "p_int_8_test_seed")`` → see test
* per-panel numerics: matches mapper ``p_int_8_canonical.json`` exactly
* aggregates: 7 × per-vertical + 2 × per-horizontal (Python repr precision)
* ``mapper_output_hash``: SHA-256 of the canonical mapper output (computed by
  reconstructing the mapper's ``p_int_8_canonical_output`` fixture and
  ``json.dumps(asdict(...), sort_keys=True, separators=(',', ':'))``).
* ``grand_total_inr_formatted``: hand-formatted with Indian comma to match the
  formatter that PR 3 ships.

If a future PR fails to reproduce these values, the algorithm has a bug — not
the golden.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

GOLDEN_DIR = Path(__file__).parent / "golden"


@pytest.fixture(scope="session")
def p_int_8_boq_canonical_json() -> dict[str, Any]:
    """Load the P_INT_8 canonical BOQ JSON from the golden directory.

    Returns the parsed dict (NOT a frozen dataclass — PR 1 doesn't have
    deserialization helpers; those land in PR 5/6).
    """
    path = GOLDEN_DIR / "p_int_8_boq_canonical.json"
    assert path.exists(), f"Golden fixture missing at {path}"
    return json.loads(path.read_text())


@pytest.fixture(scope="session")
def boq_context_p_int_8():  # type: ignore[no-untyped-def]
    """Default ``BOQContext`` for P_INT_8 testing.

    Uses ``deterministic_id_seed="p_int_8_test_seed"`` and
    ``generated_at_override="2026-05-25T00:00:00Z"`` so PR 4's id_generator
    produces a stable UUID5 + pinned timestamp that match the golden JSON
    byte-for-byte.
    """
    from app.services.kos_boq_generator import BOQContext

    return BOQContext(
        project_id="P_INT_8_TEST",
        quote_date="2026-05-25",
        quote_validity_days=30,
        tax_rate_percent=18.0,
        discount_percent=0.0,
        currency="INR",
        deterministic_id_seed="p_int_8_test_seed",
        generated_at_override="2026-05-25T00:00:00Z",
    )


@pytest.fixture(scope="session")
def expected_boq_id_for_p_int_8() -> str:
    """The deterministic UUID5 for the P_INT_8 fixture.

    Computed via::

        python3.11 -c "import uuid; print(uuid.uuid5(uuid.UUID('a5b8c2d1-4e6f-7890-1234-567890abcdef'), 'p_int_8_test_seed'))"

    PR 4's id_generator implementation MUST produce this exact value when
    called with the matching seed. This fixture also lets us verify the
    golden's ``boq_id`` field matches the computed value.
    """
    return "fd9d8a26-97e4-50e2-a623-47327379d185"


@pytest.fixture(scope="session")
def expected_mapper_output_hash_for_p_int_8() -> str:
    """The SHA-256 hash of the canonical P_INT_8 mapper output.

    Computed by reconstructing the mapper's ``p_int_8_canonical_output``
    fixture and SHA-256-ing
    ``json.dumps(dataclasses.asdict(mapper_output), sort_keys=True, separators=(',', ':'), default=str)``.

    PR 5's orchestrator must produce this exact hash when given the canonical
    mapper output.
    """
    return "2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"


# ──────────────────────────────────────────────────────────────────────────────
# PR 2 fixtures (APPENDED — PR 1 fixtures above MUST remain intact)
#
# Three new fixtures land in PR 2:
#
# 1. ``p_int_8_mapper_output`` — full PanelGridMapperOutput for the canonical
#    P_INT_8 segment. Reconstructed from mapper's OWN golden JSON
#    (``tests/test_kos_panel_grid_mapper/golden/p_int_8_canonical.json``).
#    NOT circular (anti-pattern #27): BOQ golden is the TARGET; mapper golden
#    is the SOURCE.
#
# 2. ``ninety_vr_mr_mapper_output`` — session-scoped LIVE run of the mapper
#    on the 90VR-MR PDF. Replicates the exact code path from CONTEXT_CONFIRMED.md
#    Step 0 (2026-05-25). Skips cleanly if PDF is absent.
#
# 3. ``synth_curved_segment`` — synthetic WallSegment with is_curved-style
#    flag for testing curve path (90VR data has no curve_handler-flagged
#    curves; this fills the gap).
#
# 4. ``empty_mapper_output`` — edge case (no wall segments).
#
# Vamshi fixture intentionally deferred: F1=0.000 on real Vamshi PDF, no
# live mapper output available; hand-synthesising is fragile. 🟡 PENDING-KARTHIK.
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def p_int_8_mapper_output():
    """Reconstruct the canonical P_INT_8 ``PanelGridMapperOutput``.

    Reads ``tests/test_kos_panel_grid_mapper/golden/p_int_8_canonical.json``
    (a serialized ``WallSegment``) and wraps it in a full
    ``PanelGridMapperOutput`` matching the mapper conftest's
    ``p_int_8_canonical_output`` fixture.

    Why this is NOT circular (anti-pattern #27):
    The BOQ golden (``tests/test_kos_boq_generator/golden/p_int_8_boq_canonical.json``)
    is the TARGET — what BOQ algorithms must produce.
    The mapper golden read here is the SOURCE — what the mapper would emit.
    Different files, different purposes.

    Session-scoped because reconstruction is deterministic and idempotent.
    """
    import dataclasses
    from pathlib import Path

    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION,
        Opening,
        Panel,
        PanelGridMapperOutput,
        ReinforcementSpec,
        SegmentCount,
        TotalCounts,
        WallSegment,
    )

    mapper_golden_path = (
        Path(__file__).parent.parent
        / "test_kos_panel_grid_mapper"
        / "golden"
        / "p_int_8_canonical.json"
    )
    assert mapper_golden_path.exists(), (
        f"Mapper P_INT_8 golden missing at {mapper_golden_path}"
    )
    d = json.loads(mapper_golden_path.read_text())

    # Reconstruct the 9 Panel dataclasses preserving full IEEE-754 precision.
    panels = tuple(
        Panel(
            label=pd["label"],
            sku=pd["sku"],
            type=pd["type"],
            thickness_mm=pd["thickness_mm"],
            width_mm=pd["width_mm"],
            cut_length_mm=pd["cut_length_mm"],
            raw_length_mm=pd["raw_length_mm"],
            position_mm=pd["position_mm"],
            orientation=pd["orientation"],
            is_cut_member=pd["is_cut_member"],
            cut_male_mm=pd["cut_male_mm"],
            cut_female_mm=pd["cut_female_mm"],
            area_sqft=pd["area_sqft"],
            weight_kg=pd["weight_kg"],
            weight_kg_skin=pd["weight_kg_skin"],
            weight_kg_rib=pd["weight_kg_rib"],
            raw_weight_kg=pd["raw_weight_kg"],
            waste_weight_kg=pd["waste_weight_kg"],
            price_inr=pd["price_inr"],
        )
        for pd in d["panels"]
    )

    rd = d["reinforcement_spec"]
    seg = WallSegment(
        id=d["id"],
        system=d["system"],
        custom_thickness_mm=d.get("custom_thickness_mm"),
        inferred_application=d["inferred_application"],
        application_confidence=d["application_confidence"],
        application_source=d["application_source"],
        length_mm=d["length_mm"],
        height_mm=d["height_mm"],
        area_sqft=d["area_sqft"],
        lifts_required=d["lifts_required"],
        neighbour_covered_left_mm=d["neighbour_covered_left_mm"],
        neighbour_covered_right_mm=d["neighbour_covered_right_mm"],
        panels=panels,
        openings=tuple(Opening(**o) for o in d.get("openings", ())),
        openings_inferable=d["openings_inferable"],
        bracing_height_class=d["bracing_height_class"],
        reinforcement_spec=ReinforcementSpec(
            vertical_bars=rd["vertical_bars"],
            horizontal_bars=rd["horizontal_bars"],
            concrete_grade=rd["concrete_grade"],
            cover_external_mm=rd["cover_external_mm"],
            cover_internal_mm=rd["cover_internal_mm"],
            source_section=rd["source_section"],
        ),
        segment_cost_inr=d["segment_cost_inr"],
        segment_weight_kg=d["segment_weight_kg"],
        segment_skin_kg=d["segment_skin_kg"],
        segment_rib_kg=d["segment_rib_kg"],
        segment_raw_kg=d["segment_raw_kg"],
        segment_waste_kg=d["segment_waste_kg"],
        segment_panel_counts=dict(d["segment_panel_counts"]),
        warnings=tuple(d["warnings"]),
        info_notes=tuple(d.get("info_notes", ())),
        assumptions=tuple(d["assumptions"]),
        plan_polyline=tuple(tuple(p) for p in d.get("plan_polyline", ())),
        source_wall_ids=tuple(d.get("source_wall_ids", ())),
        is_custom_order=d.get("is_custom_order", False),
        custom_quote_request=None,
    )

    # Build per-type and per-thickness tallies from the panels.
    by_type: dict[str, int] = {}
    by_thickness: dict[int, int] = {}
    for p in seg.panels:
        by_type[p.type] = by_type.get(p.type, 0) + 1
        by_thickness[p.thickness_mm] = by_thickness.get(p.thickness_mm, 0) + 1

    waste_ratio = (
        seg.segment_waste_kg / seg.segment_raw_kg if seg.segment_raw_kg > 0 else 0.0
    )

    return PanelGridMapperOutput(
        project_name="VAMSHI RESIDENCE",
        seismic_zone="III",
        split_strategy_used="minimize_cuts",
        wall_height_mm=3000,
        wall_segments=(seg,),
        custom_quote_requests=(),
        total_counts=TotalCounts(
            by_sku=dict(seg.segment_panel_counts),
            by_type=by_type,
            by_thickness=by_thickness,
            grand_total=len(seg.panels),
            by_segment=(
                SegmentCount(segment_id=seg.id, panel_count=len(seg.panels)),
            ),
        ),
        total_cost_inr=seg.segment_cost_inr,
        total_weight_kg=seg.segment_weight_kg,
        total_skin_kg=seg.segment_skin_kg,
        total_rib_kg=seg.segment_rib_kg,
        total_raw_kg=seg.segment_raw_kg,
        total_waste_kg=seg.segment_waste_kg,
        warnings=(),
        assumptions_made=("POLICY-KARTHIK-WINS",),
        pending_karthik=(),
        info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at="2026-05-24T00:00:00Z",
        waste_ratio=waste_ratio,
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
    )


@pytest.fixture(scope="session")
def ninety_vr_mr_mapper_output():
    """Live mapper run on 90VR-MR PDF (session-scoped, ~900ms one-time cost).

    Replicates CONTEXT_CONFIRMED.md Step 0 live run (2026-05-25). Baseline
    expectations (verified by separate baseline tests):

    * 100 wall_segments
    * 573 panels emitted across non-custom segments
    * 37 custom_quote_requests across 6 reason buckets
    * 25 parser openings → 19 routed → 6 orphans

    Session-scoping is safe because mapper has no module-level mutable state
    (verified by Pre-flight B inspection of mapper.py module attributes).

    Skips cleanly when 90VR-MR PDF is absent (environmental — NOT a bug).
    """
    import dataclasses
    from pathlib import Path

    pdf_path = (
        Path(__file__).parent.parent.parent.parent
        / "temp_folder"
        / "reference"
        / "90VR-MR-AD-2501[J]-Concrete Setout Plan-Basement-Part 2.pdf"
    )
    if not pdf_path.exists():
        pytest.skip(
            f"90VR-MR PDF not found at {pdf_path}. "
            f"Environmental — tests using this fixture skip cleanly. NOT a bug."
        )

    # Exact live-run code path from CONTEXT_CONFIRMED.md Step 0 (2026-05-25).
    from app.services.kos_panel_grid_mapper.mapper import map_walls_to_panels
    from app.services.kos_panel_grid_mapper.types import (
        MapperInput,
        ParserJunction,
        ParserOutput,
        ParserTitleBlock,
        ParserWall,
        ProjectContext,
    )
    from app.services.kos_pdf_parser import parse_pdf_walls

    parsed = parse_pdf_walls(str(pdf_path))

    def _bw(w):
        return ParserWall(
            id=w["id"],
            start=tuple(w["start"]),
            end=tuple(w["end"]),
            length_mm=float(w["length_mm"]),
            thickness_mm=(
                float(w["thickness_mm"]) if w.get("thickness_mm") is not None else None
            ),
            angle_degrees=float(w["angle_degrees"]),
            layer=w["layer"],
            detection_tier=int(w["detection_tier"]),
            confidence=float(w["confidence"]),
        )

    def _bj(j):
        return ParserJunction(
            point=tuple(j["point"]),
            type=j["type"],
            wall_ids=tuple(j["wall_ids"]),
            wall_count=int(j["wall_count"]),
        )

    known_fields = {f.name for f in dataclasses.fields(ParserTitleBlock)}
    tb = parsed.get("title_block") or {}
    title = ParserTitleBlock(**{k: v for k, v in tb.items() if k in known_fields})

    parser_output = ParserOutput(
        walls=tuple(_bw(w) for w in parsed.get("walls", [])),
        junctions=tuple(_bj(j) for j in parsed.get("junctions", [])),
        title_block=title,
        drawing_classification="FLOOR_PLAN",
        drawing_classification_confidence=0.9,
        drawing_classification_signals=(),
        drawing_classification_reasoning="boq-pr2-90vr-fixture",
        layers_found=tuple(parsed.get("layers_found", [])),
        drawing_bounds=dict(parsed.get("drawing_bounds", {})),
        units_detected=parsed.get("units_detected", "mm"),
        stats=dict(parsed.get("entity_counts", {})),
        field_confidences={"walls": 0.85, "title_block": 1.0},
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
        missing_data=tuple(parsed.get("missing_data", [])),
        detection_strategy_used=parsed.get("detection_strategy_used", "tier_3_4"),
        overall_confidence=parsed.get("overall_confidence", 0.85),
        parser_version=parsed.get("parser_version", "0.1.0"),
        phase=parsed.get("phase", "5C-3"),
        duration_ms=parsed.get("duration_ms", 0.0),
        warnings=tuple(parsed.get("warnings", [])),
        openings=tuple(parsed.get("openings", ())),
    )

    mapper_input = MapperInput(
        parser_output=parser_output,
        project_context=ProjectContext(
            project_name="90VR Main Residence",
            seismic_zone="III",
            application_hint=None,
            split_strategy="minimize_cuts",
            wall_height_mm=3000,
        ),
    )
    return map_walls_to_panels(mapper_input)


@pytest.fixture
def synth_curved_segment():
    """Synthetic WallSegment with a curve-style metadata flag.

    90VR-MR data does not trigger ``curve_handler`` — non-orthogonal walls
    route via ``system_selector`` to CUSTOM instead. To exercise the
    ``is_curved=True`` branch in Tier 5, we synthesize a minimal mapper
    output containing a single curved-style segment.

    NOTE: mapper's WallSegment dataclass today does NOT have ``is_curved`` /
    ``curve_radius_mm`` fields (Pre-flight B confirmed). PR 2's Tier 5
    builder hardcodes those to ``False`` / ``None`` for now. This fixture
    therefore exercises the hardcoded path (verifying the output flag is
    indeed False regardless of segment kind). When mapper adds curve
    fields, this fixture extends to synthesize them.
    """
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION,
        Panel,
        PanelGridMapperOutput,
        ReinforcementSpec,
        SegmentCount,
        TotalCounts,
        WallSegment,
    )

    # Minimal single-panel synthetic segment.
    p = Panel(
        label="S1", sku="AP155-2998", type="AP",
        thickness_mm=155, width_mm=300, cut_length_mm=2998, raw_length_mm=3048,
        position_mm=0.0, orientation="vertical", is_cut_member=False,
        cut_male_mm=0.0, cut_female_mm=0.0,
        area_sqft=9.681061028788726,
        weight_kg=14.134349101231381,
        weight_kg_skin=8.480609460738829,
        weight_kg_rib=5.6537396404925525,
        raw_weight_kg=14.371520895783152,
        waste_weight_kg=0.2371717945517704,
        price_inr=2178.2387314774633,
    )

    reinforcement = ReinforcementSpec(
        vertical_bars="2 nos 10mm dia. @ 600mm c/c",
        horizontal_bars="8mm dia. @ 400mm c/c",
        concrete_grade="M25",
        cover_external_mm=25,
        cover_internal_mm=20,
        source_section="Rulebook §8.2 K6 Zone III",
    )

    seg = WallSegment(
        id="P_CURVE_TEST",
        system="K6-150",
        custom_thickness_mm=None,
        inferred_application="external",
        application_confidence=1.0,
        application_source="geometry_heuristic",
        length_mm=300.0, height_mm=3000,
        area_sqft=9.681061028788726,
        lifts_required=1,
        neighbour_covered_left_mm=0.0, neighbour_covered_right_mm=0.0,
        panels=(p,),
        openings=(),
        openings_inferable=False,
        bracing_height_class="2.4_to_3.0m",
        reinforcement_spec=reinforcement,
        segment_cost_inr=p.price_inr,
        segment_weight_kg=p.weight_kg,
        segment_skin_kg=p.weight_kg_skin,
        segment_rib_kg=p.weight_kg_rib,
        segment_raw_kg=p.raw_weight_kg,
        segment_waste_kg=p.waste_weight_kg,
        segment_panel_counts={"AP155-2998": 1},
        warnings=(), info_notes=(), assumptions=(),
        plan_polyline=((0.0, 0.0), (300.0, 0.0)),
        source_wall_ids=("w_synth_curve",),
        is_custom_order=False,
        custom_quote_request=None,
    )

    return PanelGridMapperOutput(
        project_name="CURVE_TEST",
        seismic_zone="III",
        split_strategy_used="minimize_cuts",
        wall_height_mm=3000,
        wall_segments=(seg,),
        custom_quote_requests=(),
        total_counts=TotalCounts(
            by_sku={"AP155-2998": 1},
            by_type={"AP": 1},
            by_thickness={155: 1},
            grand_total=1,
            by_segment=(SegmentCount(segment_id=seg.id, panel_count=1),),
        ),
        total_cost_inr=seg.segment_cost_inr,
        total_weight_kg=seg.segment_weight_kg,
        total_skin_kg=seg.segment_skin_kg,
        total_rib_kg=seg.segment_rib_kg,
        total_raw_kg=seg.segment_raw_kg,
        total_waste_kg=seg.segment_waste_kg,
        warnings=(),
        assumptions_made=(),
        pending_karthik=(),
        info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at="2026-05-25T00:00:00Z",
        waste_ratio=(
            seg.segment_waste_kg / seg.segment_raw_kg if seg.segment_raw_kg > 0 else 0.0
        ),
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
    )


@pytest.fixture
def empty_mapper_output():
    """Edge-case fixture: ``PanelGridMapperOutput`` with no wall segments.

    Used by tests that verify BOQ algorithms gracefully return empty tuples
    (anti-pattern #20: empty input must not crash).
    """
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION,
        PanelGridMapperOutput,
        TotalCounts,
    )

    return PanelGridMapperOutput(
        project_name="EMPTY_TEST",
        seismic_zone="III",
        split_strategy_used="minimize_cuts",
        wall_height_mm=3000,
        wall_segments=(),
        custom_quote_requests=(),
        total_counts=TotalCounts(
            by_sku={}, by_type={}, by_thickness={}, grand_total=0, by_segment=(),
        ),
        total_cost_inr=0.0,
        total_weight_kg=0.0,
        total_skin_kg=0.0,
        total_rib_kg=0.0,
        total_raw_kg=0.0,
        total_waste_kg=0.0,
        warnings=(),
        assumptions_made=(),
        pending_karthik=(),
        info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at="2026-05-25T00:00:00Z",
        waste_ratio=0.0,
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
    )


# ──────────────────────────────────────────────────────────────────────────────
# PR 3 fixtures (APPENDED — PR 1 + PR 2 fixtures above MUST remain intact)
#
# PR 3 synthesises ``CustomQuoteLineItem`` and ``OperatorReviewItem`` directly
# from PR 1 types (no PR 4 classifier needed — these are inputs to Tier 2/Tier 1
# algorithms). The factory helpers below let any PR 3 test build custom
# fixtures of any size + reason-distribution.
#
# For P_INT_8: tests use empty tuples (P_INT_8 has zero customs and zero
# orphans, matching its golden contract).
# For 90VR-MR: tests use ``synth_90vr_mr_custom_quote_items`` (37 items in
# the {11,11,4,6,3,2} enum distribution from CONTEXT_CONFIRMED Q2).
# ──────────────────────────────────────────────────────────────────────────────


def _make_synth_custom_quote_item(
    wall_id: str,
    reason: str,
    *,
    thickness_mm: float | None = 100.0,
    length_mm: float = 2000.0,
    height_mm: int = 3000,
    area_sqft: float | None = 64.6,
    estimated_weight_kg: float | None = 93.6,
    curve_radius_mm: float | None = None,
    arc_length_mm: float | None = None,
):
    """Factory: build a synthetic ``CustomQuoteLineItem`` with sensible defaults.

    PR 3 algorithms only inspect ``reason`` (for by_reason aggregation) and
    ``estimated_weight_kg`` / ``area_sqft`` (for Tier 3 CUSTOM row aggregation).
    Other fields take reasonable defaults; callers override per test.

    The ``reason`` parameter must be a value from the ``CustomQuoteReason``
    Literal enum defined in PR 1 ``types.py``.
    """
    from app.services.kos_boq_generator import CustomQuoteLineItem
    return CustomQuoteLineItem(
        wall_id=wall_id,
        reason=reason,                                                 # type: ignore[arg-type]
        reason_detail=f"synth: {reason}",
        thickness_mm=thickness_mm,
        length_mm=length_mm,
        height_mm=height_mm,
        area_sqft=area_sqft,
        estimated_weight_kg=estimated_weight_kg,
        curve_radius_mm=curve_radius_mm,
        arc_length_mm=arc_length_mm,
        subtotal_inr="TBD",                                            # POLICY-CUSTOM-QUOTE-SEPARATE
        quote_status="pending_sales_review",
    )


def _make_synth_operator_review_item(
    review_type: str,
    *,
    description: str = "synth review item",
    source_warning: str = "synth source warning",
    suggested_action: str = "verify drawing",
):
    """Factory: build a synthetic ``OperatorReviewItem``.

    The ``review_type`` parameter must be a value from the ``OperatorReviewType``
    Literal enum defined in PR 1.
    """
    from app.services.kos_boq_generator import OperatorReviewItem
    return OperatorReviewItem(
        review_type=review_type,                                       # type: ignore[arg-type]
        description=description,
        source_warning=source_warning,
        suggested_action=suggested_action,
    )


@pytest.fixture
def make_synth_custom_quote_item():
    """Expose the factory helper to tests as a pytest fixture."""
    return _make_synth_custom_quote_item


@pytest.fixture
def make_synth_operator_review_item():
    """Expose the factory helper to tests as a pytest fixture."""
    return _make_synth_operator_review_item


@pytest.fixture
def synth_90vr_mr_custom_quote_items():
    """37 synth ``CustomQuoteLineItem`` matching 90VR-MR enum distribution.

    Per CONTEXT_CONFIRMED Q2 / pre-flight B (2026-05-25):
        thickness_unknown:              11
        thickness_below_minimum:        11
        thickness_between_bands:         4
        thickness_exceeds_catalog:       6
        system_180_not_stocked:          3
        system_250_custom_on_request:    2
        -----------------------------------
        Total:                          37

    Each item has reasonable area/weight estimates for Tier 2 aggregation
    sanity, but the exact numerics don't need to match real mapper data —
    PR 3 tests only verify counts + distribution, not specific subtotals.
    """
    items = []
    for i in range(11):
        items.append(_make_synth_custom_quote_item(
            wall_id=f"P_INT_{i + 100}", reason="thickness_unknown",
            thickness_mm=None, area_sqft=15.0, estimated_weight_kg=None,
        ))
    for i in range(11):
        items.append(_make_synth_custom_quote_item(
            wall_id=f"P_EXT_{i + 100}", reason="thickness_below_minimum",
            thickness_mm=50.81, area_sqft=20.0, estimated_weight_kg=15.0,
        ))
    for i in range(4):
        items.append(_make_synth_custom_quote_item(
            wall_id=f"P_INT_{i + 200}", reason="thickness_between_bands",
            thickness_mm=143.93, area_sqft=25.0, estimated_weight_kg=30.0,
        ))
    for i in range(6):
        items.append(_make_synth_custom_quote_item(
            wall_id=f"P_INT_{i + 300}", reason="thickness_exceeds_catalog",
            thickness_mm=300.5, area_sqft=30.0, estimated_weight_kg=45.0,
        ))
    for i in range(3):
        items.append(_make_synth_custom_quote_item(
            wall_id=f"P_INT_{i + 400}", reason="system_180_not_stocked",
            thickness_mm=180.0, area_sqft=40.0, estimated_weight_kg=55.0,
        ))
    for i in range(2):
        items.append(_make_synth_custom_quote_item(
            wall_id=f"P_INT_{i + 500}", reason="system_250_custom_on_request",
            thickness_mm=250.0, area_sqft=50.0, estimated_weight_kg=75.0,
        ))
    return tuple(items)


# ──────────────────────────────────────────────────────────────────────────────
# PR 4 fixtures (APPENDED — PR 1+2+3 fixtures above MUST remain intact)
#
# PR 3 synth fixtures STAY — they remain useful for unit tests of Tier 1/2/3
# algorithms that don't need real mapper-derived items.
#
# PR 4 adds REAL fixtures via the PR 4 handlers:
#   real_p_int_8_custom_quote_items     — empty (P_INT_8 has no customs)
#   real_p_int_8_operator_review_items  — empty (P_INT_8 has no orphans)
#   real_90vr_mr_custom_quote_items     — 37 items via real regex classifier
#   real_90vr_mr_operator_review_items  — 6 items via real orphan parser
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def real_p_int_8_custom_quote_items(p_int_8_mapper_output):
    """Real CustomQuoteLineItems for P_INT_8 (via PR 4 handler).

    P_INT_8 has no custom_quote_requests → empty tuple.
    """
    from app.services.kos_boq_generator import build_custom_quote_items
    return build_custom_quote_items(p_int_8_mapper_output)


@pytest.fixture
def real_p_int_8_operator_review_items(p_int_8_mapper_output):
    """Real OperatorReviewItems for P_INT_8 (via PR 4 handler).

    P_INT_8 has no orphan warnings → empty tuple.
    """
    from app.services.kos_boq_generator import build_operator_review_items
    return build_operator_review_items(p_int_8_mapper_output)


@pytest.fixture(scope="session")
def real_90vr_mr_custom_quote_items(ninety_vr_mr_mapper_output):
    """Real CustomQuoteLineItems for 90VR-MR (via PR 4 regex classifier).

    Expected: 37 items in the {11,11,4,6,3,2} distribution from
    CONTEXT_CONFIRMED Q2 / pre-flight B.

    Session-scoped — the mapper fixture is session-scoped and the
    classifier is pure, so this is safe to cache.
    """
    from app.services.kos_boq_generator import build_custom_quote_items
    return build_custom_quote_items(ninety_vr_mr_mapper_output)


@pytest.fixture(scope="session")
def real_90vr_mr_operator_review_items(ninety_vr_mr_mapper_output):
    """Real OperatorReviewItems for 90VR-MR (via PR 4 orphan parser).

    Expected: 6 items (o1, o3, o8, o11, o12, o20 — sorted by numeric oid).
    """
    from app.services.kos_boq_generator import build_operator_review_items
    return build_operator_review_items(ninety_vr_mr_mapper_output)


# ─────────────────────────────────────────────────────────────────────────────
# PR 5 — BOQInput fixtures (compose mapper + context for orchestrator E2E)
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def p_int_8_input(p_int_8_mapper_output, boq_context_p_int_8):
    """Composed ``BOQInput`` for P_INT_8 master E2E reproduction.

    Pairs the canonical mapper output with the determinism-pinned context
    (``deterministic_id_seed="p_int_8_test_seed"``,
    ``generated_at_override="2026-05-25T00:00:00Z"``) so that PR 5's
    ``generate_boq`` reproduces the golden BOQ byte-for-byte.
    """
    from app.services.kos_boq_generator import BOQInput
    return BOQInput(mapper_output=p_int_8_mapper_output, context=boq_context_p_int_8)


@pytest.fixture
def ninety_vr_mr_input(ninety_vr_mr_mapper_output, boq_context_p_int_8):
    """Composed ``BOQInput`` for 90VR-MR full-pipeline E2E.

    Reuses the P_INT_8 context (just different mapper input) — the context
    fields (tax/discount/validity/seeds) are not project-specific.
    """
    from app.services.kos_boq_generator import BOQInput
    return BOQInput(
        mapper_output=ninety_vr_mr_mapper_output, context=boq_context_p_int_8,
    )
