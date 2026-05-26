"""Tests for ``tier6_panel_pieces.build_tier6_panel_pieces``.

Coverage:

* Empty input → empty tuple (anti-pattern #20)
* Custom segments skipped (POLICY-CUSTOM-QUOTE-SEPARATE)
* Panel order preserved (anti-pattern #1 — no sorting)
* Pass-through of area/weight/price (anti-pattern #2)
* wall_id set from parent segment
* Tuple (not list) return type
* Determinism
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator.tier6_panel_pieces import build_tier6_panel_pieces
from app.services.kos_boq_generator.types import Tier6PanelPiece


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier6_empty_mapper_returns_empty_tuple(empty_mapper_output) -> None:
    """Anti-pattern #20: empty input must not crash; returns ()."""
    result = build_tier6_panel_pieces(empty_mapper_output)
    assert result == ()


def test_build_tier6_returns_tuple_not_list(p_int_8_mapper_output) -> None:
    """Output must be a tuple for immutability."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    assert isinstance(result, tuple)
    assert not isinstance(result, list)


def test_build_tier6_with_single_panel_works(synth_curved_segment) -> None:
    """1-panel input produces 1-piece output."""
    result = build_tier6_panel_pieces(synth_curved_segment)
    assert len(result) == 1


# ──────────────────────────────────────────────────────────────────────────────
# Custom-segment skip (POLICY-CUSTOM-QUOTE-SEPARATE)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier6_skips_custom_order_segments() -> None:
    """is_custom_order=True segments produce zero panels."""
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION, PanelGridMapperOutput,
        ReinforcementSpec, TotalCounts, WallSegment,
    )

    custom_seg = WallSegment(
        id="P_CUSTOM_1", system="K6-180",
        custom_thickness_mm=180,
        inferred_application="external",
        application_confidence=1.0, application_source="user_hint",
        length_mm=2000.0, height_mm=3000, area_sqft=64.6,
        lifts_required=1,
        neighbour_covered_left_mm=0.0, neighbour_covered_right_mm=0.0,
        panels=(),                                                     # custom: no panels
        openings=(), openings_inferable=False,
        bracing_height_class="2.4_to_3.0m",
        reinforcement_spec=ReinforcementSpec(
            vertical_bars="x", horizontal_bars="y", concrete_grade="M25",
            cover_external_mm=25, cover_internal_mm=20, source_section="t",
        ),
        segment_cost_inr=0.0,
        segment_weight_kg=0.0, segment_skin_kg=0.0, segment_rib_kg=0.0,
        segment_raw_kg=0.0, segment_waste_kg=0.0,
        segment_panel_counts={},
        warnings=(), info_notes=(), assumptions=(),
        is_custom_order=True,                                          # ⇐ custom flag
        custom_quote_request=None,
    )

    mapper = PanelGridMapperOutput(
        project_name="t", seismic_zone="III",
        split_strategy_used="minimize_cuts", wall_height_mm=3000,
        wall_segments=(custom_seg,),
        custom_quote_requests=(),
        total_counts=TotalCounts(
            by_sku={}, by_type={}, by_thickness={},
            grand_total=0, by_segment=(),
        ),
        total_cost_inr=0.0, total_weight_kg=0.0, total_skin_kg=0.0,
        total_rib_kg=0.0, total_raw_kg=0.0, total_waste_kg=0.0,
        warnings=(), assumptions_made=(), pending_karthik=(), info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at="2026-05-25T00:00:00Z",
        waste_ratio=0.0,
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
    )

    result = build_tier6_panel_pieces(mapper)
    assert result == ()


def test_build_tier6_with_zero_panel_segment_skips() -> None:
    """A non-custom segment with empty panels tuple yields zero pieces."""
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION, PanelGridMapperOutput,
        ReinforcementSpec, TotalCounts, WallSegment,
    )

    empty_seg = WallSegment(
        id="P_EMPTY", system="K4-110", custom_thickness_mm=None,
        inferred_application="internal", application_confidence=1.0,
        application_source="user_hint",
        length_mm=500.0, height_mm=3000, area_sqft=16.1,
        lifts_required=1,
        neighbour_covered_left_mm=0.0, neighbour_covered_right_mm=0.0,
        panels=(),                                                     # no panels but not custom
        openings=(), openings_inferable=False,
        bracing_height_class="2.4_to_3.0m",
        reinforcement_spec=ReinforcementSpec(
            vertical_bars="x", horizontal_bars="y", concrete_grade="M20",
            cover_external_mm=20, cover_internal_mm=20, source_section="t",
        ),
        segment_cost_inr=0.0,
        segment_weight_kg=0.0, segment_skin_kg=0.0, segment_rib_kg=0.0,
        segment_raw_kg=0.0, segment_waste_kg=0.0,
        segment_panel_counts={},
        warnings=(), info_notes=(), assumptions=(),
        is_custom_order=False,
        custom_quote_request=None,
    )

    mapper = PanelGridMapperOutput(
        project_name="t", seismic_zone="III",
        split_strategy_used="minimize_cuts", wall_height_mm=3000,
        wall_segments=(empty_seg,),
        custom_quote_requests=(),
        total_counts=TotalCounts(
            by_sku={}, by_type={}, by_thickness={},
            grand_total=0, by_segment=(),
        ),
        total_cost_inr=0.0, total_weight_kg=0.0, total_skin_kg=0.0,
        total_rib_kg=0.0, total_raw_kg=0.0, total_waste_kg=0.0,
        warnings=(), assumptions_made=(), pending_karthik=(), info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at="2026-05-25T00:00:00Z",
        waste_ratio=0.0,
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
    )

    result = build_tier6_panel_pieces(mapper)
    assert result == ()


# ──────────────────────────────────────────────────────────────────────────────
# Order preservation (anti-pattern #1)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier6_preserves_panel_order_within_segment(p_int_8_mapper_output) -> None:
    """ASSUMPTION-BOQ-11: panel iteration order = mapper's insertion order."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    # P_INT_8 mapper golden has explicit panel order: HB1, HB2, S1, ..., S6, V1
    labels = [p.panel_label for p in result]
    assert labels == ["HB1", "HB2", "S1", "S2", "S3", "S4", "S5", "S6", "V1"]


def test_build_tier6_preserves_segment_order_in_mapper_output(synth_curved_segment) -> None:
    """All panels from segment 0 appear before all panels from segment 1, etc."""
    result = build_tier6_panel_pieces(synth_curved_segment)
    if not result:
        pytest.skip("synth fixture has no panels")
    # Single segment → all panels from same wall_id
    wall_ids = {p.wall_id for p in result}
    assert len(wall_ids) == 1


# ──────────────────────────────────────────────────────────────────────────────
# Pass-through verification (anti-pattern #2 — never recompute)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier6_passes_through_area_verbatim(p_int_8_mapper_output) -> None:
    """area_sqft passes through from mapper's pre-computed value."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    mapper_seg = p_int_8_mapper_output.wall_segments[0]
    for tier6_piece, mapper_panel in zip(result, mapper_seg.panels):
        assert tier6_piece.area_sqft == mapper_panel.area_sqft


def test_build_tier6_passes_through_weight_verbatim(p_int_8_mapper_output) -> None:
    """weight_kg passes through verbatim."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    mapper_seg = p_int_8_mapper_output.wall_segments[0]
    for tier6_piece, mapper_panel in zip(result, mapper_seg.panels):
        assert tier6_piece.weight_kg == mapper_panel.weight_kg


def test_build_tier6_passes_through_price_verbatim(p_int_8_mapper_output) -> None:
    """price_inr passes through verbatim."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    mapper_seg = p_int_8_mapper_output.wall_segments[0]
    for tier6_piece, mapper_panel in zip(result, mapper_seg.panels):
        assert tier6_piece.price_inr == mapper_panel.price_inr


def test_build_tier6_sets_wall_id_from_parent_segment(p_int_8_mapper_output) -> None:
    """wall_id is set from the parent segment's id."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    expected_wall_id = p_int_8_mapper_output.wall_segments[0].id  # "P_INT_8"
    for piece in result:
        assert piece.wall_id == expected_wall_id


def test_build_tier6_panel_label_maps_from_mapper_label(p_int_8_mapper_output) -> None:
    """Mapper's ``panel.label`` field maps to BOQ's ``panel_label``."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    mapper_panel = p_int_8_mapper_output.wall_segments[0].panels[0]
    assert result[0].panel_label == mapper_panel.label


def test_build_tier6_sku_code_maps_from_mapper_sku(p_int_8_mapper_output) -> None:
    """Mapper's ``panel.sku`` field maps to BOQ's ``sku_code``."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    mapper_panel = p_int_8_mapper_output.wall_segments[0].panels[0]
    assert result[0].sku_code == mapper_panel.sku


def test_build_tier6_is_deterministic_same_input_same_output(p_int_8_mapper_output) -> None:
    """Two calls with same input produce identical tuples."""
    result1 = build_tier6_panel_pieces(p_int_8_mapper_output)
    result2 = build_tier6_panel_pieces(p_int_8_mapper_output)
    assert result1 == result2


def test_build_tier6_returns_tier6_panel_piece_instances(p_int_8_mapper_output) -> None:
    """Every element is a Tier6PanelPiece dataclass."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    for piece in result:
        assert isinstance(piece, Tier6PanelPiece)
