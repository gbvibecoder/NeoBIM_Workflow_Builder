"""Tests for ``tier5_segments.build_tier5_segments``.

Coverage:

* Empty input → empty tuple
* Standard segment: correct panel count, openings, sku_breakdown
* Custom segment: zero-out (ASSUMPTION-BOQ-12)
* Opening conversion (anti-pattern #3) + opening_type heuristic (anti-pattern #4)
* SKU breakdown is per-segment, not project-wide (anti-pattern #5)
* is_curved / curve_radius_mm hardcoded False/None (anti-pattern #7)
* Custom notes joining (anti-pattern #19)
* 90VR-MR baseline numbers (100 segments, 37 customs)
* Performance smoke test (<1s for 573 panels)
"""

from __future__ import annotations

import time

import pytest

from app.services.kos_boq_generator import (
    Tier5SegmentOpening,
    Tier5WallSegment,
    build_tier5_segments,
    build_tier6_panel_pieces,
    build_tier4_sku_details,
)
from app.services.kos_boq_generator.tier5_segments import (
    _DOOR_SILL_THRESHOLD_MM,
    _SLIDING_DOOR_WIDTH_THRESHOLD_MM,
    _derive_opening_type,
)


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier5_empty_mapper_returns_empty_tuple(empty_mapper_output) -> None:
    """Anti-pattern #20: empty input → ()."""
    result = build_tier5_segments(empty_mapper_output)
    assert result == ()


def test_build_tier5_returns_tuple(p_int_8_mapper_output) -> None:
    """Output is a tuple."""
    result = build_tier5_segments(p_int_8_mapper_output)
    assert isinstance(result, tuple)


def test_build_tier5_preserves_segment_order(p_int_8_mapper_output) -> None:
    """Tier 5 order = mapper segment iteration order."""
    result = build_tier5_segments(p_int_8_mapper_output)
    wall_ids = [r.wall_id for r in result]
    mapper_ids = [s.id for s in p_int_8_mapper_output.wall_segments]
    assert wall_ids == mapper_ids


# ──────────────────────────────────────────────────────────────────────────────
# Standard segment tests
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier5_standard_segment_correct_panel_count(p_int_8_mapper_output) -> None:
    """Standard segment: panel_count == len(seg.panels)."""
    result = build_tier5_segments(p_int_8_mapper_output)
    assert result[0].panel_count == 9


def test_build_tier5_standard_segment_has_system_from_mapper(p_int_8_mapper_output) -> None:
    """Standard segment retains mapper's system value."""
    result = build_tier5_segments(p_int_8_mapper_output)
    assert result[0].system == "K4-110"


def test_build_tier5_standard_segment_application_from_mapper(p_int_8_mapper_output) -> None:
    """Application maps from mapper's inferred_application field."""
    result = build_tier5_segments(p_int_8_mapper_output)
    assert result[0].application == "internal"


def test_build_tier5_segment_price_passes_through_from_mapper(p_int_8_mapper_output) -> None:
    """seg.segment_cost_inr (mapper) → seg.segment_price_inr (BOQ)."""
    result = build_tier5_segments(p_int_8_mapper_output)
    mapper_seg = p_int_8_mapper_output.wall_segments[0]
    assert result[0].segment_price_inr == mapper_seg.segment_cost_inr


# ──────────────────────────────────────────────────────────────────────────────
# Custom segment tests (ASSUMPTION-BOQ-12)
# ──────────────────────────────────────────────────────────────────────────────


def _make_custom_mapper(seg_id: str = "P_CUSTOM_1") -> object:
    """Build a minimal PanelGridMapperOutput with one custom segment."""
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION, CustomQuoteRequest, PanelGridMapperOutput,
        ReinforcementSpec, TotalCounts, WallSegment,
    )

    seg = WallSegment(
        id=seg_id, system="K6-180", custom_thickness_mm=180,
        inferred_application="external",
        application_confidence=1.0, application_source="user_hint",
        length_mm=2500.0, height_mm=3000, area_sqft=80.7,
        lifts_required=1,
        neighbour_covered_left_mm=0.0, neighbour_covered_right_mm=0.0,
        panels=(),
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
        is_custom_order=True,
        custom_quote_request=None,
    )

    cqr = CustomQuoteRequest(
        wall_segment_id=seg_id, thickness_mm=180.0,
        length_mm=2500.0, height_mm=3000,
        reason="K6-180 is in Rulebook §4.1 but NOT in Karthik's standard catalog",
    )

    return PanelGridMapperOutput(
        project_name="t", seismic_zone="III",
        split_strategy_used="minimize_cuts", wall_height_mm=3000,
        wall_segments=(seg,),
        custom_quote_requests=(cqr,),
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


def test_build_tier5_custom_segment_zeros_panel_count() -> None:
    """Custom segments have panel_count=0 (ASSUMPTION-BOQ-12)."""
    result = build_tier5_segments(_make_custom_mapper())
    assert result[0].panel_count == 0


def test_build_tier5_custom_segment_zeros_weight() -> None:
    """Custom segments have segment_weight_kg=0.0 (ASSUMPTION-BOQ-12)."""
    result = build_tier5_segments(_make_custom_mapper())
    assert result[0].segment_weight_kg == 0.0


def test_build_tier5_custom_segment_zeros_price() -> None:
    """Custom segments have segment_price_inr=0.0 (POLICY-CUSTOM-QUOTE-SEPARATE)."""
    result = build_tier5_segments(_make_custom_mapper())
    assert result[0].segment_price_inr == 0.0


def test_build_tier5_custom_segment_empty_sku_breakdown() -> None:
    """Custom segments have empty sku_breakdown."""
    result = build_tier5_segments(_make_custom_mapper())
    assert result[0].sku_breakdown == ()


def test_build_tier5_custom_segment_has_system_custom() -> None:
    """Custom segments override system to 'CUSTOM' regardless of mapper value."""
    result = build_tier5_segments(_make_custom_mapper())
    assert result[0].system == "CUSTOM"


def test_build_tier5_custom_segment_is_custom_order_true() -> None:
    result = build_tier5_segments(_make_custom_mapper())
    assert result[0].is_custom_order is True


def test_build_tier5_custom_segment_area_still_computed() -> None:
    """Custom segments STILL carry area_sqft for quote reference (anti-pattern #22)."""
    result = build_tier5_segments(_make_custom_mapper())
    assert result[0].area_sqft > 0


def test_build_tier5_custom_segment_notes_from_quote_request() -> None:
    """Custom notes include the mapper's reason text."""
    result = build_tier5_segments(_make_custom_mapper())
    assert "K6-180" in result[0].notes


def test_build_tier5_custom_segment_empty_openings() -> None:
    """Custom segments have empty openings tuple."""
    result = build_tier5_segments(_make_custom_mapper())
    assert result[0].openings == ()


# ──────────────────────────────────────────────────────────────────────────────
# Opening conversion + opening_type heuristic (anti-pattern #3 + #4)
# ──────────────────────────────────────────────────────────────────────────────


def test_derive_opening_type_zero_sill_returns_door() -> None:
    """sill_height_mm=0 + width<1500 → door."""
    assert _derive_opening_type(0.0, 900.0) == "door"


def test_derive_opening_type_below_50mm_sill_returns_door() -> None:
    """Boundary: sill at 49.9mm is still a door."""
    assert _derive_opening_type(49.9, 900.0) == "door"


def test_derive_opening_type_at_50mm_sill_returns_window() -> None:
    """Boundary: sill exactly at 50.0mm → window (>= threshold)."""
    assert _derive_opening_type(_DOOR_SILL_THRESHOLD_MM, 900.0) == "window"


def test_derive_opening_type_above_50mm_sill_returns_window() -> None:
    """sill > 50mm → window."""
    assert _derive_opening_type(100.0, 900.0) == "window"


def test_derive_opening_type_wide_door_returns_sliding_door() -> None:
    """sill=0 + width>1500 → sliding_door."""
    assert _derive_opening_type(0.0, 1800.0) == "sliding_door"


def test_derive_opening_type_wide_window_stays_window() -> None:
    """sill>50 + wide width → still a window (sliding only applies to doors)."""
    assert _derive_opening_type(1000.0, 2000.0) == "window"


def test_derive_opening_type_none_sill_returns_door() -> None:
    """None sill defaults to door (floor-level assumption)."""
    assert _derive_opening_type(None, 900.0) == "door"


def test_derive_opening_type_boundary_width_exactly_1500mm() -> None:
    """Boundary: width exactly at 1500 → door (>1500 required for sliding_door)."""
    assert _derive_opening_type(0.0, _SLIDING_DOOR_WIDTH_THRESHOLD_MM) == "door"


def test_derive_opening_type_just_above_1500mm_width_door() -> None:
    """Boundary: width=1500.1 → sliding_door."""
    assert _derive_opening_type(0.0, 1500.1) == "sliding_door"


# ──────────────────────────────────────────────────────────────────────────────
# is_curved hardcoded False (anti-pattern #7)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier5_non_curved_segment_has_is_curved_false(p_int_8_mapper_output) -> None:
    """Standard segments default to is_curved=False (mapper doesn't expose flag)."""
    result = build_tier5_segments(p_int_8_mapper_output)
    assert result[0].is_curved is False
    assert result[0].curve_radius_mm is None


def test_tier5_synth_curve_segment_passes_through_with_false_curve(
    synth_curved_segment,
) -> None:
    """Synth fixture exercises the path; mapper has no curve fields → hardcoded False."""
    result = build_tier5_segments(synth_curved_segment)
    # Mapper doesn't have is_curved/curve_radius_mm fields, so Tier 5 builder
    # hardcodes False/None per anti-pattern #7.
    assert result[0].is_curved is False
    assert result[0].curve_radius_mm is None


# ──────────────────────────────────────────────────────────────────────────────
# Notes joining (anti-pattern #19)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier5_standard_segment_no_warnings_empty_notes(p_int_8_mapper_output) -> None:
    """No matching warnings → empty notes string."""
    result = build_tier5_segments(p_int_8_mapper_output)
    assert result[0].notes == ""


def test_tier5_custom_segment_multiple_matching_reasons_joined() -> None:
    """Anti-pattern #19: multiple matching custom_quote_requests joined with ' | '."""
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION, CustomQuoteRequest, PanelGridMapperOutput,
        ReinforcementSpec, TotalCounts, WallSegment,
    )

    seg = WallSegment(
        id="P_MULTI", system="CUSTOM", custom_thickness_mm=None,
        inferred_application="external",
        application_confidence=1.0, application_source="user_hint",
        length_mm=1000.0, height_mm=3000, area_sqft=32.3,
        lifts_required=1,
        neighbour_covered_left_mm=0.0, neighbour_covered_right_mm=0.0,
        panels=(), openings=(), openings_inferable=False,
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
        is_custom_order=True, custom_quote_request=None,
    )

    cqrs = (
        CustomQuoteRequest(wall_segment_id="P_MULTI", thickness_mm=180.0,
                           length_mm=1000.0, height_mm=3000, reason="reason_one"),
        CustomQuoteRequest(wall_segment_id="P_MULTI", thickness_mm=180.0,
                           length_mm=1000.0, height_mm=3000, reason="reason_two"),
    )

    mapper = PanelGridMapperOutput(
        project_name="t", seismic_zone="III",
        split_strategy_used="minimize_cuts", wall_height_mm=3000,
        wall_segments=(seg,),
        custom_quote_requests=cqrs,
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

    result = build_tier5_segments(mapper)
    assert "reason_one" in result[0].notes
    assert "reason_two" in result[0].notes
    assert " | " in result[0].notes


def test_tier5_custom_segment_no_matching_reason_uses_fallback() -> None:
    """Defensive fallback when no custom_quote_request matches the segment."""
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION, PanelGridMapperOutput,
        ReinforcementSpec, TotalCounts, WallSegment,
    )

    seg = WallSegment(
        id="P_ORPHAN", system="CUSTOM", custom_thickness_mm=None,
        inferred_application="external",
        application_confidence=1.0, application_source="user_hint",
        length_mm=1000.0, height_mm=3000, area_sqft=32.3,
        lifts_required=1,
        neighbour_covered_left_mm=0.0, neighbour_covered_right_mm=0.0,
        panels=(), openings=(), openings_inferable=False,
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
        is_custom_order=True, custom_quote_request=None,
    )

    mapper = PanelGridMapperOutput(
        project_name="t", seismic_zone="III",
        split_strategy_used="minimize_cuts", wall_height_mm=3000,
        wall_segments=(seg,),
        custom_quote_requests=(),                                       # no matching CQRs
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

    result = build_tier5_segments(mapper)
    assert result[0].notes == "custom"


# ──────────────────────────────────────────────────────────────────────────────
# Per-segment sku_breakdown (anti-pattern #5)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier5_sku_breakdown_only_contains_segment_skus(p_int_8_mapper_output) -> None:
    """sku_breakdown is per-segment, not project-wide (anti-pattern #5)."""
    result = build_tier5_segments(p_int_8_mapper_output)
    seg_panels = p_int_8_mapper_output.wall_segments[0].panels
    expected_skus = {p.sku for p in seg_panels}
    actual_skus = {row.sku_code for row in result[0].sku_breakdown}
    assert actual_skus == expected_skus


def test_tier5_sku_breakdown_sorted_lexicographically(p_int_8_mapper_output) -> None:
    """sku_breakdown is sorted just like project-wide Tier 4."""
    result = build_tier5_segments(p_int_8_mapper_output)
    skus = [row.sku_code for row in result[0].sku_breakdown]
    assert skus == sorted(skus)


# ──────────────────────────────────────────────────────────────────────────────
# Determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_tier5_is_deterministic_same_input_same_output(p_int_8_mapper_output) -> None:
    r1 = build_tier5_segments(p_int_8_mapper_output)
    r2 = build_tier5_segments(p_int_8_mapper_output)
    assert r1 == r2


# ──────────────────────────────────────────────────────────────────────────────
# 90VR-MR baseline verification (skips cleanly if PDF missing)
# ──────────────────────────────────────────────────────────────────────────────


def test_90vr_mr_fixture_has_100_segments(ninety_vr_mr_mapper_output) -> None:
    """CONTEXT_CONFIRMED.md Step 0 baseline: 100 wall_segments."""
    assert len(ninety_vr_mr_mapper_output.wall_segments) == 100


def test_90vr_mr_fixture_has_37_custom_requests(ninety_vr_mr_mapper_output) -> None:
    """CONTEXT_CONFIRMED.md Step 0 baseline: 37 custom_quote_requests."""
    assert len(ninety_vr_mr_mapper_output.custom_quote_requests) == 37


def test_90vr_mr_tier6_panel_count_is_573(ninety_vr_mr_mapper_output) -> None:
    """CONTEXT_CONFIRMED.md Step 0 baseline: 573 panels emitted (non-custom)."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    assert len(tier6) == 573


def test_90vr_mr_tier5_has_100_rows(ninety_vr_mr_mapper_output) -> None:
    """Tier 5 emits one row per mapper wall_segment (100 segments)."""
    tier5 = build_tier5_segments(ninety_vr_mr_mapper_output)
    assert len(tier5) == 100


def test_90vr_mr_tier5_custom_segments_count_matches_mapper_customs(
    ninety_vr_mr_mapper_output,
) -> None:
    """Tier 5 is_custom_order count equals mapper's custom_quote_requests count
    (every custom segment has a matching CQR)."""
    tier5 = build_tier5_segments(ninety_vr_mr_mapper_output)
    custom_in_tier5 = sum(1 for r in tier5 if r.is_custom_order)
    assert custom_in_tier5 == 37


def test_90vr_mr_tier4_has_multiple_unique_skus(ninety_vr_mr_mapper_output) -> None:
    """Real customer data has multiple thickness × cut-length variants."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    assert len(tier4) >= 5


def test_90vr_mr_tier4_sorted_lexicographically(ninety_vr_mr_mapper_output) -> None:
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    skus = [r.sku_code for r in tier4]
    assert skus == sorted(skus)


def test_90vr_mr_tier_algorithms_complete_under_1_second(ninety_vr_mr_mapper_output) -> None:
    """Performance smoke test (anti-pattern #28).

    Tests MAY use time.monotonic() — only PRODUCTION code is forbidden from
    using non-deterministic time sources.
    """
    start = time.monotonic()
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier5 = build_tier5_segments(ninety_vr_mr_mapper_output)
    elapsed = time.monotonic() - start

    # Sanity checks alongside performance:
    assert len(tier6) == 573
    assert len(tier5) == 100
    assert len(tier4) > 0
    assert elapsed < 1.0, (
        f"BOQ Tier 6/5/4 algorithms took {elapsed:.3f}s on 90VR-MR — "
        f"expected <1s. Check for O(N²) loops."
    )


def test_90vr_mr_tier5_segments_have_openings_populated(ninety_vr_mr_mapper_output) -> None:
    """PR-HOTFIX-2 routes 19 openings into 15 segments. Verify Tier 5 carries them."""
    tier5 = build_tier5_segments(ninety_vr_mr_mapper_output)
    total_openings = sum(len(r.openings) for r in tier5)
    # Baseline expectation from CONTEXT_CONFIRMED Step 0: 19 routed openings
    assert total_openings == 19
    # And each opening must be a Tier5SegmentOpening
    for r in tier5:
        for op in r.openings:
            assert isinstance(op, Tier5SegmentOpening)
