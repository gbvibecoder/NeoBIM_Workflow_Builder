"""Tests for kos_panel_grid_mapper.types — dataclass immutability + R-refinement check.

Every invariant from DESIGN.md §3-§4 and the prompt's §3.2 invariants table is
exercised. Refinements R2/R4/R6 are explicitly verified to be in the schema.
"""

from __future__ import annotations

import dataclasses
import json

import pytest

import app.services.kos_panel_grid_mapper as pkg
from app.services.kos_panel_grid_mapper import (
    CustomQuoteRequest,
    MapperInput,
    Opening,
    Panel,
    PanelGridMapperOutput,
    ParserJunction,
    ParserOutput,
    ParserTitleBlock,
    ParserWall,
    ProjectContext,
    ReinforcementSpec,
    TotalCounts,
    WallSegment,
)


# ──────────────────────────────────────────────────────────────────────────────
# Frozen dataclasses — mutation must raise
# ──────────────────────────────────────────────────────────────────────────────


def _make_minimal_panel() -> Panel:
    """Construct a Panel with all required fields populated (for mutation tests)."""
    return Panel(
        label="S1",
        sku="AP110-2998",
        type="AP",
        thickness_mm=110,
        width_mm=300,
        cut_length_mm=2998,
        raw_length_mm=3048,
        position_mm=0.0,
        orientation="vertical",
        is_cut_member=False,
        cut_male_mm=0.0,
        cut_female_mm=0.0,
        area_sqft=9.68,
        weight_kg=12.49,
        weight_kg_skin=7.49,
        weight_kg_rib=5.00,
        raw_weight_kg=12.70,
        waste_weight_kg=0.21,
        price_inr=2178.24,
    )


def test_panel_is_frozen() -> None:
    p = _make_minimal_panel()
    with pytest.raises(dataclasses.FrozenInstanceError):
        p.area_sqft = 99.0  # type: ignore[misc]


def test_project_context_is_frozen() -> None:
    ctx = ProjectContext(project_name="X")
    with pytest.raises(dataclasses.FrozenInstanceError):
        ctx.project_name = "Y"  # type: ignore[misc]


def test_wall_segment_is_frozen() -> None:
    seg = WallSegment(
        id="P_INT_8",
        system="K4-110",
        custom_thickness_mm=None,
        inferred_application="internal",
        application_confidence=1.0,
        application_source="user_hint",
        length_mm=2101.0,
        height_mm=3000,
        area_sqft=67.84,
        lifts_required=1,
        neighbour_covered_left_mm=0.0,
        neighbour_covered_right_mm=0.0,
        panels=(),
        openings=(),
        openings_inferable=False,
        bracing_height_class="2.4_to_3.0m",
        reinforcement_spec=ReinforcementSpec(
            vertical_bars="x", horizontal_bars="y",
            concrete_grade="M20", cover_external_mm=20,
            cover_internal_mm=20, source_section="z",
        ),
        segment_cost_inr=0.0, segment_weight_kg=0.0,
        segment_skin_kg=0.0, segment_rib_kg=0.0,
        segment_raw_kg=0.0, segment_waste_kg=0.0,
        segment_panel_counts={},
        warnings=(), info_notes=(), assumptions=(),
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        seg.id = "P_INT_999"  # type: ignore[misc]


def test_parser_wall_is_frozen() -> None:
    w = ParserWall(
        id="w0", start=(0.0, 0.0), end=(100.0, 0.0),
        length_mm=100.0, thickness_mm=110.0, angle_degrees=0.0,
        layer="A-WALL", detection_tier=1, confidence=0.85,
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        w.length_mm = 999.0  # type: ignore[misc]


# ──────────────────────────────────────────────────────────────────────────────
# MapperInput constructs cleanly from a minimal parser output + context
# ──────────────────────────────────────────────────────────────────────────────


def test_mapper_input_constructs_from_fixtures(p_int_8_mapper_input: MapperInput) -> None:
    assert p_int_8_mapper_input.project_context.project_name == "VAMSHI RESIDENCE"
    assert len(p_int_8_mapper_input.parser_output.walls) == 1
    assert p_int_8_mapper_input.parser_output.walls[0].thickness_mm == 110.0


def test_mapper_input_minimal_manual_construction() -> None:
    """Even without fixtures, MapperInput composes from primitives."""
    parser = ParserOutput(
        walls=(),
        junctions=(),
        title_block=ParserTitleBlock(),
        drawing_classification="FLOOR_PLAN",
        drawing_classification_confidence=1.0,
        drawing_classification_signals=(),
        drawing_classification_reasoning="",
        layers_found=(),
        drawing_bounds={"min_x": 0.0, "min_y": 0.0, "max_x": 0.0, "max_y": 0.0},
        units_detected="mm",
        stats={},
        field_confidences={},
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
        missing_data=(),
        detection_strategy_used="x",
        overall_confidence=1.0,
        parser_version="0.0.0",
        phase="test",
        duration_ms=0.0,
        warnings=(),
    )
    ctx = ProjectContext(project_name="t")
    inp = MapperInput(parser_output=parser, project_context=ctx)
    assert inp.project_context.seismic_zone == "III"  # default


# ──────────────────────────────────────────────────────────────────────────────
# REFINEMENTS R2/R4/R6 — explicitly verified
# ──────────────────────────────────────────────────────────────────────────────


def test_r4_panel_width_mm_accepts_non_300_int() -> None:
    """R4: Panel.width_mm relaxed from Literal[300] to int — splitter emits narrow
    CTC infills (e.g. 70mm wide for P_EXT_3's residual) and Strategy A custom widths."""
    p = Panel(
        label="S31", sku="CTC155-2998", type="CTC", thickness_mm=155,
        width_mm=70,                           # ← non-300 value: must construct cleanly
        cut_length_mm=2998, raw_length_mm=3048,
        position_mm=9000.0, orientation="vertical",
        is_cut_member=False, cut_male_mm=0.0, cut_female_mm=0.0,
        area_sqft=2.26, weight_kg=3.30, weight_kg_skin=1.98, weight_kg_rib=1.32,
        raw_weight_kg=3.35, waste_weight_kg=0.06, price_inr=508.26,
    )
    assert p.width_mm == 70


def test_r2_wall_segment_has_neighbour_covered_fields() -> None:
    """R2: WallSegment carries neighbour_covered_left_mm + neighbour_covered_right_mm."""
    fields = {f.name for f in dataclasses.fields(WallSegment)}
    assert "neighbour_covered_left_mm" in fields
    assert "neighbour_covered_right_mm" in fields


def test_r6_panel_raw_length_mm_accepts_long_horizontal() -> None:
    """R6: Panel.raw_length_mm is `int`, not Literal[3048] — for horizontals longer
    than raw stock, raw_length_mm = ceil(cut/3048) × 3048 (multi-piece tracking)."""
    p = Panel(
        label="HB1", sku="BT155-9370", type="BT", thickness_mm=155,
        width_mm=300, cut_length_mm=9370,
        raw_length_mm=12192,                   # ← 4 × 3048 (long horizontal)
        position_mm=0.0, orientation="horizontal",
        is_cut_member=False, cut_male_mm=0.0, cut_female_mm=0.0,
        area_sqft=30.25, weight_kg=44.16, weight_kg_skin=26.50, weight_kg_rib=17.67,
        raw_weight_kg=57.48, waste_weight_kg=13.32, price_inr=6806.04,
    )
    assert p.raw_length_mm == 12192
    assert p.raw_length_mm > p.cut_length_mm  # R6 invariant: raw can exceed cut


# ──────────────────────────────────────────────────────────────────────────────
# ProjectContext defaults (POLICY-DEFAULT-CONFIG)
# ──────────────────────────────────────────────────────────────────────────────


def test_project_context_defaults() -> None:
    ctx = ProjectContext(project_name="X")
    assert ctx.seismic_zone == "III"
    assert ctx.split_strategy == "minimize_cuts"
    assert ctx.wall_height_mm == 3000
    assert ctx.application_hint is None


# ──────────────────────────────────────────────────────────────────────────────
# PanelGridMapperOutput — has all documented fields
# ──────────────────────────────────────────────────────────────────────────────


def test_panel_grid_mapper_output_has_required_fields() -> None:
    """The output dataclass exposes every field downstream generators need."""
    required = {
        "project_name", "seismic_zone", "split_strategy_used", "wall_height_mm",
        "wall_segments", "custom_quote_requests",
        "total_counts",
        "total_cost_inr", "total_weight_kg",
        "total_skin_kg", "total_rib_kg",
        "total_raw_kg", "total_waste_kg",
        "warnings", "assumptions_made", "pending_karthik", "info_notes",
        "schema_version", "generated_at",
    }
    actual = {f.name for f in dataclasses.fields(PanelGridMapperOutput)}
    assert required.issubset(actual), f"Missing fields: {required - actual}"


# ──────────────────────────────────────────────────────────────────────────────
# Round-trip via dataclasses.asdict produces JSON-serialisable dict
# ──────────────────────────────────────────────────────────────────────────────


def test_panel_asdict_is_json_serialisable() -> None:
    p = _make_minimal_panel()
    d = dataclasses.asdict(p)
    # Must round-trip through json.dumps without error
    s = json.dumps(d)
    decoded = json.loads(s)
    assert decoded["sku"] == "AP110-2998"
    assert decoded["area_sqft"] == 9.68


# ──────────────────────────────────────────────────────────────────────────────
# Imports from package root work (validates __init__.py exports)
# ──────────────────────────────────────────────────────────────────────────────


def test_imports_from_package_root() -> None:
    """Every symbol listed in __all__ must be importable from the package root."""
    # If __init__.py is broken these would have failed at file-top import time, but
    # double-check the public-API surface is correctly exposed.
    assert pkg.Panel is Panel
    assert pkg.MapperInput is MapperInput
    assert pkg.PanelGridMapperOutput is PanelGridMapperOutput
    assert pkg.WallSegment is WallSegment
    assert pkg.ProjectContext is ProjectContext
    assert pkg.STANDARD_PANEL_WIDTH_MM == 300
    assert pkg.KG_PER_SFT[110] == 1.29
    assert pkg.MAPPER_SCHEMA_VERSION == "0.1.0"


def test_dunder_all_exports_resolve() -> None:
    """Every name in __all__ must actually exist on the package module."""
    for name in pkg.__all__:
        assert hasattr(pkg, name), f"__all__ exports missing attribute: {name}"


# ──────────────────────────────────────────────────────────────────────────────
# Supporting dataclasses smoke-test
# ──────────────────────────────────────────────────────────────────────────────


def test_opening_constructs() -> None:
    o = Opening(position_mm=310.0, width_mm=1200.0, height_mm=2100.0, sill_height_mm=0.0)
    assert o.sill_height_mm == 0.0


def test_custom_quote_request_constructs() -> None:
    cq = CustomQuoteRequest(
        wall_segment_id="P_EXT_1", thickness_mm=275.0,
        length_mm=5000.0, height_mm=3000,
        reason="thickness 275mm exceeds standard catalog",
    )
    assert cq.thickness_mm == 275.0


def test_total_counts_constructs() -> None:
    tc = TotalCounts(by_sku={}, by_type={}, by_thickness={}, grand_total=0)
    assert tc.grand_total == 0


def test_parser_junction_types_constrained() -> None:
    """Junction types are CORNER/T_JOIN/X_JOIN/END (NOT L/T/X/endpoint)."""
    j = ParserJunction(point=(0.0, 0.0), type="CORNER", wall_ids=("w0", "w1"), wall_count=2)
    assert j.type == "CORNER"


# ──────────────────────────────────────────────────────────────────────────────
# Golden JSON file exists and parses
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_golden_json_exists_and_parses(p_int_8_canonical_json: dict) -> None:
    """PR 1 baseline: the file is on disk and is valid JSON.
    Later PRs will diff actual mapper output against this content."""
    assert isinstance(p_int_8_canonical_json, dict)
    # Sanity: it's at least a WallSegment-shaped dict
    assert p_int_8_canonical_json.get("id") == "P_INT_8"
    assert "panels" in p_int_8_canonical_json
    assert len(p_int_8_canonical_json["panels"]) == 9  # 7 vertical + 2 horizontal
