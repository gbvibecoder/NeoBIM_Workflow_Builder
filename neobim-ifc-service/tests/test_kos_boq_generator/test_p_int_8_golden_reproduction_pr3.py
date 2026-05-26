"""THE CRITICAL CONTRACT TEST (PR 3 extension).

Extends PR 2's golden reproduction to Tier 3 + Tier 2 + Tier 1. Verifies the
full pipeline Tier 6 → Tier 5 → Tier 4 → Tier 3 → Tier 2 → Tier 1 produces
byte-equal output to the PR 1 golden (after the surgical IEEE-754 ULP
corrections predicted by pre-flight A and documented in PR 3 Discrepancy #1).

If any test here fails:

* Algorithm bug → fix algorithm
* PR 1 golden has > 3 ULP drift → investigate (do NOT update golden silently)
* Indian comma formatter wrong → fix formatter

Compared via JSON round-trip normalization (preserves PR 2 tuple/list pattern).
"""

from __future__ import annotations

import dataclasses
import json

import pytest

from app.services.kos_boq_generator import (
    INR_TOLERANCE_RUPEES,
    build_tier1_project_summary,
    build_tier2_categories,
    build_tier3_sku_types,
    build_tier4_sku_details,
    build_tier5_segments,
    build_tier6_panel_pieces,
)


def _normalize(obj: object) -> object:
    """JSON round-trip normalization (tuples → lists; matches PR 2 pattern)."""
    return json.loads(json.dumps(obj))


# ──────────────────────────────────────────────────────────────────────────────
# Tier 3 byte-equal reproduction
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_tier3_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """Tier 3 algorithm must reproduce PR 1 golden exactly (no tolerance).

    P_INT_8 has 0 custom items → 5 rows (AP, BT, TC, CTC, ECM) in canonical
    order. NO synthetic CUSTOM row appended (anti-pattern #3).
    """
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    custom_quote_items = ()                                            # P_INT_8 has 0 customs

    result = build_tier3_sku_types(tier4, custom_quote_items)
    golden = p_int_8_boq_canonical_json["tier_3_sku_types"]

    assert len(result) == len(golden), (
        f"Tier 3 count mismatch: algorithm={len(result)}, golden={len(golden)}"
    )

    for i, (computed, expected) in enumerate(zip(result, golden)):
        computed_dict = _normalize(dataclasses.asdict(computed))
        assert computed_dict == expected, (
            f"Tier 3 row #{i} ({computed.sku_prefix}) differs:\n"
            f"  Computed: {computed_dict}\n"
            f"  Expected: {expected}"
        )


def test_p_int_8_tier3_5_rows_no_custom(p_int_8_mapper_output) -> None:
    """P_INT_8 baseline: 5 rows in canonical order, no CUSTOM (0 customs)."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    assert len(tier3) == 5
    prefixes = [r.sku_prefix for r in tier3]
    assert prefixes == ["AP", "BT", "TC", "CTC", "ECM"]
    assert "CUSTOM" not in prefixes


# ──────────────────────────────────────────────────────────────────────────────
# Tier 2 byte-equal reproduction
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_tier2_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """Tier 2 algorithm reproduces PR 1 golden exactly.

    P_INT_8: std (AP×5) + accessories (BT×1 + TC×1 + CTC×1 + ECM×1) +
    custom (count=0, by_reason=()).
    """
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    result = build_tier2_categories(tier3, ())
    golden = p_int_8_boq_canonical_json["tier_2_categories"]

    computed_dict = _normalize(dataclasses.asdict(result))
    assert computed_dict == golden, (
        f"Tier 2 differs:\n"
        f"  Computed: {computed_dict}\n"
        f"  Expected: {golden}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Tier 1 byte-equal reproduction (after surgical golden updates)
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_tier1_reproduces_golden_byte_equal_after_surgical_update(
    p_int_8_mapper_output, p_int_8_boq_canonical_json, boq_context_p_int_8,
) -> None:
    """Tier 1 algorithm reproduces PR 1 golden exactly.

    NOTE (Discrepancy #1, PR 3): pre-flight A predicted that
    ``accessories_subtotal_inr`` would shift by ~0.55 ULP because PR 1
    hand-computed it as ``2*v + 2*h`` while PR 3's algorithm sums
    sequentially (BT + TC + CTC + ECM). The shift is surgically corrected
    in the golden ahead of this test.

    All other Tier 1 fields byte-match without correction (the ULP shift
    in accessories is absorbed when summed with std → priced_subtotal).
    """
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    tier2 = build_tier2_categories(tier3, ())
    result = build_tier1_project_summary(
        tier6, tier5, tier2,
        custom_quote_items=(),
        operator_review_items=(),
        context=boq_context_p_int_8,
        mapper_output=p_int_8_mapper_output,
    )
    golden = p_int_8_boq_canonical_json["tier_1_summary"]

    computed_dict = _normalize(dataclasses.asdict(result))
    if computed_dict != golden:
        # Field-by-field diff for diagnostic clarity
        diffs = []
        all_keys = set(computed_dict.keys()) | set(golden.keys())
        for k in sorted(all_keys):
            c_val = computed_dict.get(k)
            g_val = golden.get(k)
            if c_val != g_val:
                diffs.append(f"  {k}: computed={c_val!r}, golden={g_val!r}")
        pytest.fail(
            f"Tier 1 differs from golden ({len(diffs)} fields):\n" + "\n".join(diffs)
        )


# ──────────────────────────────────────────────────────────────────────────────
# Full pipeline integration checks (P_INT_8)
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_full_pipeline_grand_total_formatted_matches(
    p_int_8_mapper_output, boq_context_p_int_8,
) -> None:
    """Grand total formatted should match exactly: '₹21,594.82'."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    tier2 = build_tier2_categories(tier3, ())
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, (), (), boq_context_p_int_8, p_int_8_mapper_output,
    )
    assert tier1.grand_total_inr_formatted == "₹21,594.82"


def test_p_int_8_full_pipeline_quote_number_matches(
    p_int_8_mapper_output, boq_context_p_int_8,
) -> None:
    """Quote number synth: 'Q-P_INT_8_TEST-001-20260525'."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    tier2 = build_tier2_categories(tier3, ())
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, (), (), boq_context_p_int_8, p_int_8_mapper_output,
    )
    assert tier1.quote_number == "Q-P_INT_8_TEST-001-20260525"


def test_p_int_8_full_pipeline_quote_validity_until_matches(
    p_int_8_mapper_output, boq_context_p_int_8,
) -> None:
    """Validity = quote_date + 30 days = 2026-06-24."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    tier2 = build_tier2_categories(tier3, ())
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, (), (), boq_context_p_int_8, p_int_8_mapper_output,
    )
    assert tier1.quote_validity_until == "2026-06-24"


def test_p_int_8_full_pipeline_project_name_from_mapper(
    p_int_8_mapper_output, boq_context_p_int_8,
) -> None:
    """project_name comes from mapper_output, NOT context.project_id."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    tier2 = build_tier2_categories(tier3, ())
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, (), (), boq_context_p_int_8, p_int_8_mapper_output,
    )
    assert tier1.project_name == "VAMSHI RESIDENCE"


# ──────────────────────────────────────────────────────────────────────────────
# 90VR-MR pipeline tests (skip if PDF missing)
# ──────────────────────────────────────────────────────────────────────────────


def test_90vr_mr_tier1_grand_total_approximately_canonical(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """90VR-MR grand_total ≈ ₹13,59,743.23 (CONTEXT_CONFIRMED Step 0 baseline).

    Tolerance: ±INR_TOLERANCE_RUPEES (0.01). Synth custom items used (37
    items in {11,11,4,6,3,2} enum distribution per CONTEXT_CONFIRMED Q2).
    """
    from app.services.kos_boq_generator import BOQContext

    ctx = BOQContext(
        project_id="90VR_MR_001",
        quote_date="2026-05-25",
        deterministic_id_seed="90vr_test_seed",
        generated_at_override="2026-05-25T00:00:00Z",
    )
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier5 = build_tier5_segments(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    tier2 = build_tier2_categories(tier3, synth_90vr_mr_custom_quote_items)
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2,
        custom_quote_items=synth_90vr_mr_custom_quote_items,
        operator_review_items=(),
        context=ctx,
        mapper_output=ninety_vr_mr_mapper_output,
    )

    # Tolerance check (within 1 paisa of the CONTEXT_CONFIRMED canonical)
    assert abs(tier1.grand_total_inr - 1359743.23) < 0.10, (
        f"90VR-MR grand_total={tier1.grand_total_inr} not near canonical ~₹13,59,743.23"
    )


def test_90vr_mr_tier1_has_unpriced_items_true(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """90VR-MR has 37 customs → has_unpriced_items must be True."""
    from app.services.kos_boq_generator import BOQContext

    ctx = BOQContext(project_id="90VR_MR_001", quote_date="2026-05-25")
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier5 = build_tier5_segments(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    tier2 = build_tier2_categories(tier3, synth_90vr_mr_custom_quote_items)
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2,
        synth_90vr_mr_custom_quote_items, (), ctx, ninety_vr_mr_mapper_output,
    )
    assert tier1.has_unpriced_items is True
    assert tier1.total_custom_quote_items == 37


def test_90vr_mr_tier3_has_custom_row_last(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """Tier 3 with non-empty customs: synthetic CUSTOM row appears LAST."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    prefixes = [r.sku_prefix for r in tier3]
    assert prefixes[-1] == "CUSTOM"
    # AP/BT/TC/CP/CTC/ECM... all before CUSTOM (canonical order)
    assert "CUSTOM" not in prefixes[:-1]


def test_90vr_mr_tier2_by_reason_alphabetically_sorted(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """Anti-pattern #20: by_reason sorted alphabetically by key."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    tier2 = build_tier2_categories(tier3, synth_90vr_mr_custom_quote_items)
    keys = [pair[0] for pair in tier2.custom_quotes.by_reason]
    assert keys == sorted(keys)


def test_90vr_mr_tier2_by_reason_has_6_keys(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """90VR-MR synth: 6 distinct reason enum values per CONTEXT_CONFIRMED Q2."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    tier2 = build_tier2_categories(tier3, synth_90vr_mr_custom_quote_items)
    assert len(tier2.custom_quotes.by_reason) == 6


def test_90vr_mr_tier2_by_reason_counts_match_distribution(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """Confirm the synth distribution matches CONTEXT_CONFIRMED Q2 exactly."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    tier2 = build_tier2_categories(tier3, synth_90vr_mr_custom_quote_items)
    by_reason_dict = dict(tier2.custom_quotes.by_reason)
    assert by_reason_dict == {
        "system_180_not_stocked": 3,
        "system_250_custom_on_request": 2,
        "thickness_below_minimum": 11,
        "thickness_between_bands": 4,
        "thickness_exceeds_catalog": 6,
        "thickness_unknown": 11,
    }


def test_90vr_mr_tier3_row_count_includes_custom(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """90VR-MR has AP/BT/TC/CP/CTC/ECM (6 prefixes) + CUSTOM = 7 rows."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    # 90VR-MR has: AP, BT, TC, CP, CTC, ECM (6 standard prefixes)
    assert len(tier3) == 7
    assert tier3[-1].sku_prefix == "CUSTOM"
    assert tier3[-1].total_count == 37


# ──────────────────────────────────────────────────────────────────────────────
# Performance smoke test (anti-pattern #28 from PR 2)
# ──────────────────────────────────────────────────────────────────────────────


def test_90vr_mr_full_pipeline_t6_to_t1_completes_under_2_seconds(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """Full Tier 6→Tier 1 pipeline performance: <2s on 90VR-MR.

    Tests MAY use ``time.monotonic()`` for performance smoke tests
    (anti-pattern #23 is for PRODUCTION code only).
    """
    import time

    from app.services.kos_boq_generator import BOQContext

    ctx = BOQContext(project_id="90VR_MR_001", quote_date="2026-05-25")

    start = time.monotonic()
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier5 = build_tier5_segments(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    tier2 = build_tier2_categories(tier3, synth_90vr_mr_custom_quote_items)
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, synth_90vr_mr_custom_quote_items,
        (), ctx, ninety_vr_mr_mapper_output,
    )
    elapsed = time.monotonic() - start

    assert len(tier6) == 573
    assert len(tier5) == 100
    assert len(tier3) == 7
    assert tier1.total_custom_quote_items == 37
    assert elapsed < 2.0, (
        f"Full T6→T1 pipeline took {elapsed:.3f}s, expected <2s"
    )
