"""THE CRITICAL CONTRACT TEST — PR 2 algorithms must reproduce PR 1 golden byte-equal.

If any test in this file fails, one of three things is true:

1. **Algorithm has a bug.** Fix the algorithm.
2. **Golden was hand-computed wrong** in PR 1 (would have been caught in PR 1
   review, but defensive — verify hand math against algorithm output).
3. **Mapper output format changed.** Other tests would also fail; check
   mapper-side regressions first.

The contract is:

* PR 1 hand-computed the P_INT_8 golden JSON values.
* PR 2 algorithms must produce byte-equal output.
* DO NOT silently adjust either side. Surface the divergence in PR 2 report.

Compared via ``dataclasses.asdict(computed) == golden_dict``. NO tolerance —
byte-equal.

Tests verify Tier 6 + Tier 5 + Tier 4 independently AND in cross-tier
reconciliation.
"""

from __future__ import annotations

import dataclasses
import json

import pytest


def _normalize_dataclass_dict(obj: object) -> object:
    """Normalize a dataclass-derived dict for byte-equal comparison with a JSON-loaded dict.

    ``dataclasses.asdict()`` preserves tuples; ``json.loads()`` returns them as
    lists. Round-tripping through ``json.dumps/loads`` normalizes both
    representations to the same JSON-equivalent form.

    This is structural normalization only — float values pass through Python's
    JSON encoder which uses the canonical short-repr (the same encoding the
    PR 1 golden was written with).
    """
    return json.loads(json.dumps(obj))

from app.services.kos_boq_generator.tier4_sku_details import build_tier4_sku_details
from app.services.kos_boq_generator.tier5_segments import build_tier5_segments
from app.services.kos_boq_generator.tier6_panel_pieces import build_tier6_panel_pieces


# ──────────────────────────────────────────────────────────────────────────────
# Tier 6 byte-equal reproduction
# ──────────────────────────────────────────────────────────────────────────────


def test_tier6_p_int_8_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """Tier 6 algorithm must reproduce PR 1 golden exactly (no tolerance)."""
    result = build_tier6_panel_pieces(p_int_8_mapper_output)
    golden = p_int_8_boq_canonical_json["tier_6_panel_pieces"]

    assert len(result) == len(golden), (
        f"Tier 6 count mismatch: algorithm={len(result)}, golden={len(golden)}"
    )

    for i, (computed, expected) in enumerate(zip(result, golden)):
        computed_dict = _normalize_dataclass_dict(dataclasses.asdict(computed))
        assert computed_dict == expected, (
            f"Tier 6 panel #{i} ({computed.sku_code}) differs:\n"
            f"  Computed: {computed_dict}\n"
            f"  Expected: {expected}"
        )


def test_p_int_8_tier6_panel_count_is_9(p_int_8_mapper_output) -> None:
    """P_INT_8 baseline: 9 panels in Tier 6."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    assert len(tier6) == 9


def test_p_int_8_tier6_order_matches_mapper_panel_order(p_int_8_mapper_output) -> None:
    """ASSUMPTION-BOQ-11: Tier 6 preserves mapper's panel insertion order.

    Mapper P_INT_8 emits panels in order: HB1, HB2, S1, S2, S3, S4, S5, S6, V1.
    """
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    labels = [p.panel_label for p in tier6]
    assert labels == ["HB1", "HB2", "S1", "S2", "S3", "S4", "S5", "S6", "V1"]


# ──────────────────────────────────────────────────────────────────────────────
# Tier 4 byte-equal reproduction (description format MUST match)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier4_p_int_8_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """Tier 4 algorithm must reproduce PR 1 golden exactly.

    Includes description strings — verifies exact format match
    (anti-pattern #12: description format must match PR 1 golden).
    """
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    result = build_tier4_sku_details(tier6)
    golden = p_int_8_boq_canonical_json["tier_4_sku_details"]

    assert len(result) == len(golden), (
        f"Tier 4 count mismatch: algorithm={len(result)}, golden={len(golden)}"
    )

    for i, (computed, expected) in enumerate(zip(result, golden)):
        computed_dict = _normalize_dataclass_dict(dataclasses.asdict(computed))

        # Pre-check description specifically — most likely place for byte divergence.
        if computed_dict.get("description") != expected.get("description"):
            pytest.fail(
                f"Tier 4 #{i} ({computed.sku_code}) description format mismatch:\n"
                f"  Algorithm: {computed_dict['description']!r}\n"
                f"  Golden:    {expected['description']!r}\n"
                f"  Fix: update _synthesize_description() in tier4_sku_details.py "
                f"to match golden format, OR update golden if synthesizer is canonical."
            )

        assert computed_dict == expected, (
            f"Tier 4 row #{i} ({computed.sku_code}) differs:\n"
            f"  Computed: {computed_dict}\n"
            f"  Expected: {expected}"
        )


def test_p_int_8_tier4_has_5_unique_skus(p_int_8_mapper_output) -> None:
    """P_INT_8 baseline: 5 unique SKUs (1 AP, 1 BT, 1 CTC, 1 ECM, 1 TC)."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    assert len(tier4) == 5


def test_p_int_8_tier4_sorted_lexicographically(p_int_8_mapper_output) -> None:
    """ASSUMPTION-BOQ-13: Tier 4 sorted by sku_code lexicographically."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    skus = [r.sku_code for r in tier4]
    assert skus == sorted(skus)
    # Specifically for P_INT_8:
    assert skus == ["AP110-2998", "BT110-2101", "CTC110-2998", "ECM110-2998", "TC110-2101"]


def test_p_int_8_tier4_descriptions_match_pr1_format(p_int_8_mapper_output) -> None:
    """Per pre-flight A: PR 1 description format is locked."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    descriptions = {r.sku_code: r.description for r in tier4}
    assert descriptions == {
        "AP110-2998": "AP110 vertical panel (standard stretcher), 2998mm cut",
        "BT110-2101": "BT110 bottom track (horizontal), 2101mm cut",
        "CTC110-2998": "CTC110 connector / corner / terminator, 2998mm cut",
        "ECM110-2998": "ECM110 end cap male, 2998mm cut",
        "TC110-2101": "TC110 top cap (horizontal), 2101mm cut",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Tier 5 byte-equal reproduction
# ──────────────────────────────────────────────────────────────────────────────


def test_tier5_p_int_8_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """Tier 5 algorithm must reproduce PR 1 golden exactly.

    Tier 5 includes a nested sku_breakdown (per-segment Tier 4 rollup); this
    test catches any divergence in either the segment-level fields or the
    nested breakdown.
    """
    result = build_tier5_segments(p_int_8_mapper_output)
    golden = p_int_8_boq_canonical_json["tier_5_wall_segments"]

    assert len(result) == len(golden), (
        f"Tier 5 count mismatch: algorithm={len(result)}, golden={len(golden)}"
    )

    for i, (computed, expected) in enumerate(zip(result, golden)):
        computed_dict = _normalize_dataclass_dict(dataclasses.asdict(computed))
        assert computed_dict == expected, (
            f"Tier 5 segment #{i} ({computed.wall_id}) differs:\n"
            f"  Computed: {computed_dict}\n"
            f"  Expected: {expected}"
        )


def test_p_int_8_tier5_has_1_segment(p_int_8_mapper_output) -> None:
    """P_INT_8 baseline: 1 wall segment (P_INT_8 itself)."""
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    assert len(tier5) == 1
    assert tier5[0].wall_id == "P_INT_8"


def test_p_int_8_tier5_segment_is_not_custom(p_int_8_mapper_output) -> None:
    """P_INT_8 is solid 110mm K4-110 — standard, not custom."""
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    assert tier5[0].is_custom_order is False
    assert tier5[0].panel_count == 9
    assert tier5[0].segment_price_inr > 0


def test_p_int_8_tier5_has_5_sku_breakdown_rows(p_int_8_mapper_output) -> None:
    """Per-segment SKU breakdown should match project-wide Tier 4 for P_INT_8.

    Since P_INT_8 is the only segment, its sku_breakdown should equal
    the project-wide Tier 4 result.
    """
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    assert len(tier5[0].sku_breakdown) == 5


def test_p_int_8_tier5_sku_breakdown_matches_project_tier4(p_int_8_mapper_output) -> None:
    """Single-segment project: per-segment sku_breakdown == project-wide Tier 4."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier5 = build_tier5_segments(p_int_8_mapper_output)

    project_skus = {r.sku_code for r in tier4}
    segment_skus = {r.sku_code for r in tier5[0].sku_breakdown}
    assert project_skus == segment_skus
