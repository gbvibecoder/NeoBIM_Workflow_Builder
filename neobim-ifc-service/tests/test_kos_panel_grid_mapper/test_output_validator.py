"""Tests for output_validator — all 21 invariants C-1..C-21.

Coverage strategy:
  - 1 "all-PASS" test against the canonical P_INT_8 fixture (zero issues).
  - 21 PASS tests (one per invariant — confirming the invariant is satisfied
    in a clean output).
  - 21 FAIL tests (one per invariant — constructing a deliberately-broken
    output and asserting the validator catches it).
  - Plus aggregator + raise-helper tests.

This is the "first acid test" of the validator: if any of the 43+ tests fail,
the validator has a real bug.
"""

from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_panel_grid_mapper import (
    CustomQuoteRequest,
    OutputInvariantError,
    Panel,
    PanelGridMapperOutput,
    SegmentCount,
    TotalCounts,
    ValidationIssue,
    WallSegment,
    validate_or_raise,
    validate_output,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers — mutate a frozen output by reconstructing it
# ──────────────────────────────────────────────────────────────────────────────


def _replace_segment(
    output: PanelGridMapperOutput, seg_index: int, **changes
) -> PanelGridMapperOutput:
    """Return a copy of `output` with `wall_segments[seg_index]` patched."""
    segs = list(output.wall_segments)
    segs[seg_index] = dataclasses.replace(segs[seg_index], **changes)
    return dataclasses.replace(output, wall_segments=tuple(segs))


def _replace_panel(
    output: PanelGridMapperOutput, seg_index: int, panel_index: int, **changes
) -> PanelGridMapperOutput:
    """Return a copy of `output` with `wall_segments[seg_index].panels[panel_index]` patched."""
    seg = output.wall_segments[seg_index]
    panels = list(seg.panels)
    panels[panel_index] = dataclasses.replace(panels[panel_index], **changes)
    new_seg = dataclasses.replace(seg, panels=tuple(panels))
    segs = list(output.wall_segments)
    segs[seg_index] = new_seg
    return dataclasses.replace(output, wall_segments=tuple(segs))


def _issues_with_rule(issues: list[ValidationIssue], rule: str) -> list[ValidationIssue]:
    return [i for i in issues if i.rule == rule]


# ──────────────────────────────────────────────────────────────────────────────
# THE ACID TEST: canonical P_INT_8 fixture must pass ALL 21 invariants cleanly
# ──────────────────────────────────────────────────────────────────────────────


def test_canonical_p_int_8_passes_all_21_invariants(p_int_8_canonical_output) -> None:
    """Per the PR 3 prompt: 'all 21 invariants must PASS on that golden JSON'."""
    issues = validate_output(p_int_8_canonical_output)
    if issues:
        # Surface details so any future regression has an actionable error message.
        detail = "\n".join(f"  {i.rule} [{i.severity}]: {i.message}" for i in issues)
        pytest.fail(f"Canonical P_INT_8 produced {len(issues)} unexpected issue(s):\n{detail}")


def test_canonical_output_validate_or_raise_returns_no_softs(p_int_8_canonical_output) -> None:
    """validate_or_raise should return [] (no soft issues) for a clean canonical."""
    softs = validate_or_raise(p_int_8_canonical_output)
    assert softs == []


# ──────────────────────────────────────────────────────────────────────────────
# C-1 — length-sum tolerance
# ──────────────────────────────────────────────────────────────────────────────


def test_c1_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-1") == []


def test_c1_fail_when_panel_widths_dont_sum_to_length(p_int_8_canonical_output) -> None:
    """Inflate one vertical panel's width by 200mm → length-sum overshoots by 200 > 50mm tol."""
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, width_mm=500)  # S1 ECM110 was 300, now 500
    issues = _issues_with_rule(validate_output(bad), "C-1")
    assert len(issues) == 1
    assert issues[0].severity == "hard"
    assert "length-sum" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-2 — positions monotonically non-decreasing within orientation
# ──────────────────────────────────────────────────────────────────────────────


def test_c2_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-2") == []


def test_c2_fail_when_position_regresses(p_int_8_canonical_output) -> None:
    """Move S6 from position 1500 to 100 → after S5 (1200) → regression."""
    bad = _replace_panel(p_int_8_canonical_output, 0, 7, position_mm=100.0)  # S6 was at 1500
    issues = _issues_with_rule(validate_output(bad), "C-2")
    assert len(issues) >= 1
    assert all(i.severity == "hard" for i in issues)


# ──────────────────────────────────────────────────────────────────────────────
# C-3 — no overlapping vertical panels
# ──────────────────────────────────────────────────────────────────────────────


def test_c3_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-3") == []


def test_c3_fail_on_overlap(p_int_8_canonical_output) -> None:
    """Stretch S1 (ECM110 at pos 0, width 300) to width 500 → overlaps S2 (at pos 300)."""
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, width_mm=500)
    issues = _issues_with_rule(validate_output(bad), "C-3")
    assert len(issues) >= 1
    assert all(i.severity == "hard" for i in issues)


# ──────────────────────────────────────────────────────────────────────────────
# C-4 — grand_total === Σ len(segment.panels)
# ──────────────────────────────────────────────────────────────────────────────


def test_c4_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-4") == []


def test_c4_fail_when_grand_total_wrong(p_int_8_canonical_output) -> None:
    bad_tc = dataclasses.replace(p_int_8_canonical_output.total_counts, grand_total=999)
    bad = dataclasses.replace(p_int_8_canonical_output, total_counts=bad_tc)
    issues = _issues_with_rule(validate_output(bad), "C-4")
    assert len(issues) == 1
    assert issues[0].severity == "hard"
    assert "grand_total mismatch" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-5 — sub-table sums match grand_total
# ──────────────────────────────────────────────────────────────────────────────


def test_c5_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-5") == []


def test_c5_fail_when_by_sku_inconsistent(p_int_8_canonical_output) -> None:
    bad_tc = dataclasses.replace(
        p_int_8_canonical_output.total_counts,
        by_sku={"BAD-SKU": 100},  # sums to 100, not 9
    )
    bad = dataclasses.replace(p_int_8_canonical_output, total_counts=bad_tc)
    issues = _issues_with_rule(validate_output(bad), "C-5")
    assert any("by_sku sum" in i.message for i in issues)


def test_c5_fail_when_by_segment_inconsistent(p_int_8_canonical_output) -> None:
    bad_tc = dataclasses.replace(
        p_int_8_canonical_output.total_counts,
        by_segment=(SegmentCount(segment_id="P_INT_8", panel_count=42),),
    )
    bad = dataclasses.replace(p_int_8_canonical_output, total_counts=bad_tc)
    issues = _issues_with_rule(validate_output(bad), "C-5")
    assert any("by_segment sum" in i.message for i in issues)


# ──────────────────────────────────────────────────────────────────────────────
# C-6 — 1 ≤ cut_length_mm ≤ raw_length_mm (R6)
# ──────────────────────────────────────────────────────────────────────────────


def test_c6_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-6") == []


def test_c6_fail_when_cut_exceeds_raw(p_int_8_canonical_output) -> None:
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, cut_length_mm=9999, raw_length_mm=3048)
    issues = _issues_with_rule(validate_output(bad), "C-6")
    assert len(issues) >= 1


def test_c6_fail_when_cut_is_zero(p_int_8_canonical_output) -> None:
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, cut_length_mm=0)
    issues = _issues_with_rule(validate_output(bad), "C-6")
    assert len(issues) >= 1


# ──────────────────────────────────────────────────────────────────────────────
# C-7 — weight = area × KG_PER_SFT[thickness]
# ──────────────────────────────────────────────────────────────────────────────


def test_c7_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-7") == []


def test_c7_fail_on_wrong_weight(p_int_8_canonical_output) -> None:
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, weight_kg=99.0)
    issues = _issues_with_rule(validate_output(bad), "C-7")
    assert len(issues) == 1
    assert "weight formula mismatch" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-8 — price = area × 225
# ──────────────────────────────────────────────────────────────────────────────


def test_c8_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-8") == []


def test_c8_fail_on_wrong_price(p_int_8_canonical_output) -> None:
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, price_inr=999.99)
    issues = _issues_with_rule(validate_output(bad), "C-8")
    assert len(issues) == 1
    assert "price formula mismatch" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-9 — skin + rib = weight
# ──────────────────────────────────────────────────────────────────────────────


def test_c9_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-9") == []


def test_c9_fail_when_skin_rib_dont_sum_to_weight(p_int_8_canonical_output) -> None:
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, weight_kg_skin=100.0)
    issues = _issues_with_rule(validate_output(bad), "C-9")
    assert len(issues) == 1
    assert "skin+rib mismatch" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-10 — area = (cut × width) / 92903.04
# ──────────────────────────────────────────────────────────────────────────────


def test_c10_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-10") == []


def test_c10_fail_on_wrong_area(p_int_8_canonical_output) -> None:
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, area_sqft=99.0)
    issues = _issues_with_rule(validate_output(bad), "C-10")
    assert len(issues) == 1
    assert "area formula mismatch" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-11 — external segment's first vertical panel should be CP (soft warning)
# ──────────────────────────────────────────────────────────────────────────────


def test_c11_pass_canonical_internal_wall(p_int_8_canonical_output) -> None:
    """P_INT_8 is internal; C-11 doesn't apply (no issue expected)."""
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-11") == []


def test_c11_warns_when_external_first_panel_not_cp(p_int_8_canonical_output) -> None:
    """Promote the P_INT_8 segment to inferred_application='external'.
    The first vertical panel is ECM (S1), not CP — should warn."""
    bad = _replace_segment(p_int_8_canonical_output, 0, inferred_application="external")
    issues = _issues_with_rule(validate_output(bad), "C-11")
    assert len(issues) == 1
    assert issues[0].severity == "soft"   # C-11 is soft per DESIGN §5
    assert "expected 'CP'" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-12 — SKU regex compliance
# ──────────────────────────────────────────────────────────────────────────────


def test_c12_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-12") == []


def test_c12_fail_on_malformed_sku(p_int_8_canonical_output) -> None:
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, sku="ZZZ-bad-sku")
    issues = _issues_with_rule(validate_output(bad), "C-12")
    assert len(issues) == 1
    assert "C-12 regex" in issues[0].message


def test_c12_accepts_cut_suffix(p_int_8_canonical_output) -> None:
    """SKUs ending in -CUT (for cut members) must also pass C-12."""
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, sku="AP110-2998-CUT")
    issues = _issues_with_rule(validate_output(bad), "C-12")
    assert issues == []


# ──────────────────────────────────────────────────────────────────────────────
# C-13 — total_cost = Σ panel.price_inr
# ──────────────────────────────────────────────────────────────────────────────


def test_c13_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-13") == []


def test_c13_fail_when_total_cost_drifts(p_int_8_canonical_output) -> None:
    bad = dataclasses.replace(p_int_8_canonical_output, total_cost_inr=99999.99)
    issues = _issues_with_rule(validate_output(bad), "C-13")
    assert len(issues) == 1
    assert "total_cost_inr mismatch" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-14 — total_weight = Σ panel.weight_kg
# ──────────────────────────────────────────────────────────────────────────────


def test_c14_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-14") == []


def test_c14_fail_when_total_weight_drifts(p_int_8_canonical_output) -> None:
    bad = dataclasses.replace(p_int_8_canonical_output, total_weight_kg=999.0)
    issues = _issues_with_rule(validate_output(bad), "C-14")
    assert len(issues) == 1
    assert "total_weight_kg mismatch" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-15 — total_skin + total_rib = total_weight
# ──────────────────────────────────────────────────────────────────────────────


def test_c15_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-15") == []


def test_c15_fail_when_skin_rib_totals_dont_sum(p_int_8_canonical_output) -> None:
    bad = dataclasses.replace(p_int_8_canonical_output, total_skin_kg=999.0)
    issues = _issues_with_rule(validate_output(bad), "C-15")
    assert len(issues) == 1
    assert "totals skin+rib mismatch" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-16 — total_raw ≥ total_weight
# ──────────────────────────────────────────────────────────────────────────────


def test_c16_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-16") == []


def test_c16_fail_when_raw_less_than_installed(p_int_8_canonical_output) -> None:
    bad = dataclasses.replace(p_int_8_canonical_output, total_raw_kg=1.0)
    issues = _issues_with_rule(validate_output(bad), "C-16")
    assert len(issues) == 1
    assert "raw stock cannot be lighter" in issues[0].message


# ──────────────────────────────────────────────────────────────────────────────
# C-17 — waste = raw − installed; ratio = waste / raw
# ──────────────────────────────────────────────────────────────────────────────


def test_c17_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-17") == []


def test_c17_fail_when_waste_inconsistent(p_int_8_canonical_output) -> None:
    bad = dataclasses.replace(p_int_8_canonical_output, total_waste_kg=99.0)
    issues = _issues_with_rule(validate_output(bad), "C-17")
    assert any("waste mismatch" in i.message for i in issues)


def test_c17_fail_when_waste_ratio_wrong(p_int_8_canonical_output) -> None:
    bad = dataclasses.replace(p_int_8_canonical_output, waste_ratio=0.99)
    issues = _issues_with_rule(validate_output(bad), "C-17")
    assert any("waste_ratio mismatch" in i.message for i in issues)


# ──────────────────────────────────────────────────────────────────────────────
# C-18 — custom_quote consistency
# ──────────────────────────────────────────────────────────────────────────────


def test_c18_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-18") == []


def test_c18_fail_when_custom_order_has_panels(p_int_8_canonical_output) -> None:
    """Mark the standard segment as custom_order — panels list is non-empty → fails."""
    cq = CustomQuoteRequest(
        wall_segment_id="P_INT_8", thickness_mm=275.0,
        length_mm=2101.0, height_mm=3000,
        reason="test",
    )
    bad = _replace_segment(
        p_int_8_canonical_output, 0,
        is_custom_order=True, custom_quote_request=cq,
    )
    issues = _issues_with_rule(validate_output(bad), "C-18")
    assert any("panels.length=" in i.message for i in issues)


def test_c18_fail_when_non_custom_has_quote_request(p_int_8_canonical_output) -> None:
    cq = CustomQuoteRequest(
        wall_segment_id="P_INT_8", thickness_mm=110.0,
        length_mm=2101.0, height_mm=3000,
        reason="test",
    )
    bad = _replace_segment(p_int_8_canonical_output, 0, custom_quote_request=cq)
    issues = _issues_with_rule(validate_output(bad), "C-18")
    assert any("must be None" in i.message for i in issues)


# ──────────────────────────────────────────────────────────────────────────────
# C-19 — bracing_height_class consistent with height_mm (soft)
# ──────────────────────────────────────────────────────────────────────────────


def test_c19_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-19") == []


def test_c19_warns_on_mismatch(p_int_8_canonical_output) -> None:
    """Wall is 3000mm tall → expect '2.4_to_3.0m'; setting 'le_2.4m' should warn."""
    bad = _replace_segment(p_int_8_canonical_output, 0, bracing_height_class="le_2.4m")
    issues = _issues_with_rule(validate_output(bad), "C-19")
    assert len(issues) == 1
    assert issues[0].severity == "soft"


# ──────────────────────────────────────────────────────────────────────────────
# C-20 — downstream_ready.shop_drawings consistency
# ──────────────────────────────────────────────────────────────────────────────


def test_c20_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-20") == []


def test_c20_fail_when_flag_true_but_panel_missing_label(p_int_8_canonical_output) -> None:
    """Empty out one panel's label while shop_drawings=True → mismatch."""
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, label="")
    issues = _issues_with_rule(validate_output(bad), "C-20")
    assert len(issues) == 1
    assert issues[0].severity == "hard"


def test_c20_fail_when_flag_false_but_panels_renderable(p_int_8_canonical_output) -> None:
    """Flip the flag to False while panels are still fine → mismatch."""
    bad = dataclasses.replace(
        p_int_8_canonical_output,
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": False},
    )
    issues = _issues_with_rule(validate_output(bad), "C-20")
    assert len(issues) == 1


# ──────────────────────────────────────────────────────────────────────────────
# C-21 — segment ID regex (soft)
# ──────────────────────────────────────────────────────────────────────────────


def test_c21_pass_canonical(p_int_8_canonical_output) -> None:
    assert _issues_with_rule(validate_output(p_int_8_canonical_output), "C-21") == []


def test_c21_warns_on_bad_segment_id(p_int_8_canonical_output) -> None:
    bad = _replace_segment(p_int_8_canonical_output, 0, id="SOMETHING_BAD")
    issues = _issues_with_rule(validate_output(bad), "C-21")
    assert len(issues) == 1
    assert issues[0].severity == "soft"


# ──────────────────────────────────────────────────────────────────────────────
# Aggregator + raise-helper behaviour
# ──────────────────────────────────────────────────────────────────────────────


def test_validate_output_is_deterministic(p_int_8_canonical_output) -> None:
    """Same input → same list (same length, same rule order)."""
    a = validate_output(p_int_8_canonical_output)
    b = validate_output(p_int_8_canonical_output)
    assert len(a) == len(b)
    for ia, ib in zip(a, b):
        assert (ia.rule, ia.severity, ia.message) == (ib.rule, ib.severity, ib.message)


def test_validate_output_returns_list_not_raises_on_hard(p_int_8_canonical_output) -> None:
    """validate_output should NEVER raise — even with hard issues, it returns a list."""
    bad = dataclasses.replace(p_int_8_canonical_output, total_weight_kg=-999.0)
    issues = validate_output(bad)  # must NOT raise
    assert any(i.severity == "hard" for i in issues)


def test_validate_or_raise_raises_on_hard(p_int_8_canonical_output) -> None:
    bad = dataclasses.replace(p_int_8_canonical_output, total_weight_kg=-999.0)
    with pytest.raises(OutputInvariantError):
        validate_or_raise(bad)


def test_validate_or_raise_returns_softs_only(p_int_8_canonical_output) -> None:
    """Soft-only output should return the soft issues without raising."""
    bad = _replace_segment(p_int_8_canonical_output, 0, id="SOMETHING_BAD")
    softs = validate_or_raise(bad)  # only C-21 (soft) — no raise
    assert len(softs) == 1
    assert softs[0].severity == "soft"
    assert softs[0].rule == "C-21"


def test_validate_output_emits_issues_in_rule_order(p_int_8_canonical_output) -> None:
    """Issues should come back in C-1..C-21 order (deterministic aggregation)."""
    # Inject 3 issues across 3 different rule families.
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, sku="ZZZ-bad")  # C-12
    bad = _replace_segment(bad, 0, id="BAD_ID")                          # C-21
    bad = dataclasses.replace(bad, total_weight_kg=-1.0)                 # C-14
    issues = validate_output(bad)
    rules = [i.rule for i in issues]
    # Within the issues, C-12 should appear before C-14 before C-21.
    if "C-12" in rules and "C-14" in rules and "C-21" in rules:
        assert rules.index("C-12") < rules.index("C-14")
        assert rules.index("C-14") < rules.index("C-21")


def test_issue_diagnostic_fields_populated(p_int_8_canonical_output) -> None:
    """Segment-scoped issues should carry segment_id; panel-scoped should carry panel_label."""
    bad = _replace_panel(p_int_8_canonical_output, 0, 2, area_sqft=99.0)
    issues = _issues_with_rule(validate_output(bad), "C-10")
    assert issues[0].segment_id == "P_INT_8"
    assert issues[0].panel_label == "S1"


def test_all_21_rules_have_check_functions() -> None:
    """Every rule C-1..C-21 must be exercised by the aggregator (no skips)."""
    from app.services.kos_panel_grid_mapper.output_validator import _ALL_CHECKS

    assert len(_ALL_CHECKS) == 21
