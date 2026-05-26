"""Tests for ``operator_review_handler``.

Coverage:
* Orphan regex format (exact match for mapper's warning template)
* Filter non-orphan warnings (anti-pattern #52)
* 90VR-MR produces exactly 6 items (CONTEXT_CONFIRMED baseline)
* Sort by numeric oid (o2 < o10 < o100, not lexicographic)
* P_INT_8 has 0 orphans (clean fixture)
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator import (
    OperatorReviewItem,
    build_operator_review_items,
)
from app.services.kos_boq_generator.operator_review_handler import (
    ORPHAN_OPENING_PATTERN,
    _parse_orphan_warning,
)


# ──────────────────────────────────────────────────────────────────────────────
# Regex tests — exact format from pre-flight A Part 6
# ──────────────────────────────────────────────────────────────────────────────


def test_parse_orphan_warning_matches_canonical_format() -> None:
    """Canonical mapper format: 'opening o{N} references parent_wall_id=\\'w{M}\\'...'"""
    warning = (
        "opening o1 references parent_wall_id='w108' not in any segment.source_wall_ids "
        "— dropped during segmentation; this opening will not appear in mapper output."
    )
    parsed = _parse_orphan_warning(warning)
    assert parsed == {"oid": "o1", "wid": "w108"}


def test_parse_orphan_warning_extracts_high_id_correctly() -> None:
    """Large opening IDs (o12, o20) match correctly."""
    warning = (
        "opening o20 references parent_wall_id='w49' not in any segment.source_wall_ids "
        "— dropped during segmentation; this opening will not appear in mapper output."
    )
    parsed = _parse_orphan_warning(warning)
    assert parsed == {"oid": "o20", "wid": "w49"}


def test_parse_orphan_warning_returns_none_for_non_orphan() -> None:
    """Anti-pattern #52: non-orphan warnings return None."""
    samples = [
        "(system=K8-200, application=internal) not in MAX_LIFT_HEIGHT_MM table",
        "segment too short for envelope kit (internal)",
        "thickness_mm null — parser couldn't detect; routed",
        "R5",
        "thickness 50.81mm < 100mm",
        "K6-180 selected",
        "K8-250 selected",
    ]
    for s in samples:
        assert _parse_orphan_warning(s) is None, f"Expected None for {s!r}"


def test_parse_orphan_warning_empty_string_returns_none() -> None:
    assert _parse_orphan_warning("") is None


def test_parse_orphan_warning_none_input_returns_none() -> None:
    assert _parse_orphan_warning(None) is None  # type: ignore[arg-type]


def test_orphan_opening_pattern_matches_exactly_6_on_90vr_warnings(
    ninety_vr_mr_mapper_output,
) -> None:
    """Pre-flight A baseline: 6 orphan warnings on 90VR-MR."""
    count = sum(
        1 for w in ninety_vr_mr_mapper_output.warnings if ORPHAN_OPENING_PATTERN.search(w)
    )
    assert count == 6


# ──────────────────────────────────────────────────────────────────────────────
# build_operator_review_items — integration
# ──────────────────────────────────────────────────────────────────────────────


def test_build_p_int_8_returns_empty(p_int_8_mapper_output) -> None:
    """P_INT_8 has zero orphan warnings."""
    assert build_operator_review_items(p_int_8_mapper_output) == ()


def test_build_90vr_returns_6_items(ninety_vr_mr_mapper_output) -> None:
    """🚨 CRITICAL: 90VR-MR has exactly 6 orphans (CONTEXT_CONFIRMED Q2)."""
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    assert len(items) == 6


def test_build_90vr_all_orphan_opening_review_type(ninety_vr_mr_mapper_output) -> None:
    """All 6 items are review_type='orphan_opening' (no other types on 90VR)."""
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    for item in items:
        assert item.review_type == "orphan_opening"


def test_build_90vr_sorted_by_numeric_oid(ninety_vr_mr_mapper_output) -> None:
    """Items sorted by numeric oid (o1 < o3 < o8 < o11 < o12 < o20).

    Lexicographic would give wrong order (o1, o11, o12, o20, o3, o8).
    """
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    # Extract oids from source_warning (regex match)
    oids = []
    for item in items:
        match = ORPHAN_OPENING_PATTERN.search(item.source_warning)
        assert match is not None
        oids.append(match.group("oid"))
    # Expected order
    assert oids == ["o1", "o3", "o8", "o11", "o12", "o20"]


def test_build_90vr_oid_wid_pairs_match_baseline(ninety_vr_mr_mapper_output) -> None:
    """Specific oid/wid pairs from CONTEXT_CONFIRMED:
       o1/w108, o3/w12, o8/w17, o11/w21, o12/w28, o20/w49."""
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    pairs = []
    for item in items:
        match = ORPHAN_OPENING_PATTERN.search(item.source_warning)
        pairs.append((match.group("oid"), match.group("wid")))
    assert pairs == [
        ("o1", "w108"),
        ("o3", "w12"),
        ("o8", "w17"),
        ("o11", "w21"),
        ("o12", "w28"),
        ("o20", "w49"),
    ]


def test_build_filters_non_orphan_warnings(ninety_vr_mr_mapper_output) -> None:
    """Anti-pattern #52: 175 total warnings filter to 6 orphan items."""
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    assert len(items) == 6  # not 175
    # Total warnings was ~175; verifying filter narrowed correctly
    assert len(ninety_vr_mr_mapper_output.warnings) > 100


def test_build_preserves_source_warning_verbatim(ninety_vr_mr_mapper_output) -> None:
    """source_warning is verbatim from mapper.warnings."""
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    item_warnings = {item.source_warning for item in items}
    mapper_orphan_warnings = {
        w for w in ninety_vr_mr_mapper_output.warnings if ORPHAN_OPENING_PATTERN.search(w)
    }
    assert item_warnings == mapper_orphan_warnings


def test_build_description_mentions_orphan_oid_and_wid(ninety_vr_mr_mapper_output) -> None:
    """Description includes oid + wid for human readability."""
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    for item in items:
        match = ORPHAN_OPENING_PATTERN.search(item.source_warning)
        oid = match.group("oid")
        wid = match.group("wid")
        assert oid in item.description
        assert wid in item.description


def test_build_suggested_action_actionable(ninety_vr_mr_mapper_output) -> None:
    """suggested_action mentions verification + re-run."""
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    for item in items:
        assert "Verify" in item.suggested_action or "verify" in item.suggested_action
        assert "re-run" in item.suggested_action.lower() or "re-run" in item.suggested_action


def test_build_is_deterministic(ninety_vr_mr_mapper_output) -> None:
    """Two calls produce identical output."""
    a = build_operator_review_items(ninety_vr_mr_mapper_output)
    b = build_operator_review_items(ninety_vr_mr_mapper_output)
    assert a == b


def test_build_returns_tuple_of_operator_review_item(ninety_vr_mr_mapper_output) -> None:
    items = build_operator_review_items(ninety_vr_mr_mapper_output)
    assert isinstance(items, tuple)
    for item in items:
        assert isinstance(item, OperatorReviewItem)


def test_build_with_empty_warnings_returns_empty() -> None:
    """Synthetic empty input → ()."""
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION, PanelGridMapperOutput, TotalCounts,
    )

    mapper = PanelGridMapperOutput(
        project_name="EMPTY", seismic_zone="III",
        split_strategy_used="minimize_cuts", wall_height_mm=3000,
        wall_segments=(), custom_quote_requests=(),
        total_counts=TotalCounts(
            by_sku={}, by_type={}, by_thickness={}, grand_total=0, by_segment=()),
        total_cost_inr=0.0, total_weight_kg=0.0, total_skin_kg=0.0,
        total_rib_kg=0.0, total_raw_kg=0.0, total_waste_kg=0.0,
        warnings=(),                                                   # <-- empty
        assumptions_made=(), pending_karthik=(), info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at="2026-05-25T00:00:00Z",
        waste_ratio=0.0,
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True})

    assert build_operator_review_items(mapper) == ()
