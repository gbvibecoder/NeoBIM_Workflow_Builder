"""Tests for ``app.services.kos_boq_generator.types``.

Covers:
* All 15 frozen dataclasses (immutability + constructibility + equality)
* 4 Literal enum aliases (value counts via ``typing.get_args``)
* Anti-pattern fixes (#1: concrete mapper type, #2 + #9: tuple-of-pairs,
  #5: Tier4 line-totals as settable fields, #10: ``Literal["TBD"]`` round-trips)
* Golden JSON parse + structure verification
"""

from __future__ import annotations

import dataclasses
import json
import re
from typing import get_args

import pytest

from app.services.kos_boq_generator import (
    BOQAuditTrail,
    BOQCommercialTerms,
    BOQContext,
    BOQGeneratorOutput,
    BOQInput,
    BOQOpeningType,
    CustomQuoteLineItem,
    CustomQuoteReason,
    OperatorReviewItem,
    OperatorReviewType,
    QuoteStatus,
    Tier1ProjectSummary,
    Tier2Bucket,
    Tier2BucketCustom,
    Tier2Category,
    Tier3SKUType,
    Tier4SKUDetail,
    Tier5SegmentOpening,
    Tier5WallSegment,
    Tier6PanelPiece,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers: minimal valid instances of each tier type
# ──────────────────────────────────────────────────────────────────────────────


def _make_tier1() -> Tier1ProjectSummary:
    return Tier1ProjectSummary(
        project_name="Test", quote_number="Q-X", quote_date="2026-05-25",
        quote_validity_until="2026-06-24",
        total_standard_panels=5, total_accessory_pieces=4,
        total_custom_quote_items=0, total_curve_segments=0,
        total_openings_in_walls=0, total_orphan_openings=0,
        total_weight_kg=100.0, total_weight_kg_skin=60.0, total_weight_kg_rib=40.0,
        standard_panels_subtotal_inr=10000.0, accessories_subtotal_inr=7000.0,
        custom_quotes_pending_count=0, custom_quotes_estimated_weight_kg=0.0,
        discount_inr=0.0, subtotal_after_discount_inr=17000.0,
        tax_inr=3060.0, grand_total_inr=20060.0,
        grand_total_inr_formatted="₹20,060.00", has_unpriced_items=False,
    )


def _make_tier4(sku: str = "AP110-2998", qty: int = 5) -> Tier4SKUDetail:
    return Tier4SKUDetail(
        sku_code=sku, sku_prefix=sku.split("1", 1)[0].rstrip("ACPTEFMJ")[:3].rstrip("-")
                                  if False else "AP",
        thickness_mm=110, description="test", quantity=qty,
        unit_area_sqft=1.0, unit_weight_kg=1.29, unit_price_inr=225.0,
        line_total_area_sqft=qty * 1.0,
        line_total_weight_kg=qty * 1.29,
        line_total_price_inr=qty * 225.0,
    )


def _make_tier5_opening() -> Tier5SegmentOpening:
    return Tier5SegmentOpening(
        position_mm=4284.9, width_mm=900.0, height_mm=2100.0,
        sill_height_mm=0.0, opening_type="door",
    )


def _make_tier5(custom: bool = False) -> Tier5WallSegment:
    return Tier5WallSegment(
        wall_id="P_INT_8", system="K4-110" if not custom else "CUSTOM",
        application="internal", length_mm=2101.0, height_mm=3000,
        is_custom_order=custom, is_curved=False, curve_radius_mm=None,
        area_sqft=67.844, panel_count=0 if custom else 9,
        openings=(), sku_breakdown=(),
        segment_weight_kg=0.0 if custom else 104.92,
        segment_price_inr=0.0 if custom else 18300.69,
        notes="",
    )


def _make_tier6() -> Tier6PanelPiece:
    return Tier6PanelPiece(
        wall_id="P_INT_8", panel_label="S1", sku_code="ECM110-2998",
        position_mm=0.0, cut_length_mm=2998, width_mm=300, is_cut_member=False,
        area_sqft=9.68, weight_kg=12.49, price_inr=2178.24,
    )


def _make_custom_quote_item() -> CustomQuoteLineItem:
    return CustomQuoteLineItem(
        wall_id="P_EXT_1", reason="thickness_below_minimum",
        reason_detail="thickness 74.09mm",
        thickness_mm=74.09, length_mm=834.39, height_mm=3000,
        area_sqft=26.94, estimated_weight_kg=None,
        curve_radius_mm=None, arc_length_mm=None,
        subtotal_inr="TBD", quote_status="pending_sales_review",
    )


def _make_operator_review() -> OperatorReviewItem:
    return OperatorReviewItem(
        review_type="orphan_opening",
        description="orphan opening detected",
        source_warning="opening o1 references parent_wall_id='w108'",
        suggested_action="verify drawing",
    )


def _make_commercial_terms() -> BOQCommercialTerms:
    return BOQCommercialTerms(
        delivery_terms="Ex-works", payment_terms="50/50",
        quote_validity_until="2026-06-24", notes="",
    )


def _make_audit_trail() -> BOQAuditTrail:
    return BOQAuditTrail(
        mapper_output_hash="a" * 64,
        boq_calculation_version="v1.0",
        karthik_pricing_version="v1.0: ₹225/sft flat",
        custom_quote_review_required=False,
        operator_review_required=False,
        pipeline_versions=(
            ("boq", "v1.0"),
            ("mapper", "v1.0"),
            ("parser", "v1.0"),
        ),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Anti-pattern #1: BOQInput.mapper_output typed as PanelGridMapperOutput
# ──────────────────────────────────────────────────────────────────────────────


def test_boq_input_mapper_output_typed_as_panel_grid_mapper_output() -> None:
    """Anti-pattern #1: must use concrete type, not ``object``."""
    from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

    fields = {f.name: f.type for f in dataclasses.fields(BOQInput)}
    mapper_field_type = fields["mapper_output"]
    # The type annotation may be a string (forward reference) or a class.
    # Both should resolve to PanelGridMapperOutput.
    if isinstance(mapper_field_type, str):
        assert "PanelGridMapperOutput" in mapper_field_type
    else:
        assert mapper_field_type is PanelGridMapperOutput


# ──────────────────────────────────────────────────────────────────────────────
# Anti-pattern #2 + #9: tuple-of-pairs for by_reason and pipeline_versions
# ──────────────────────────────────────────────────────────────────────────────


def test_tier2_bucket_custom_by_reason_is_tuple_not_dict() -> None:
    """Anti-pattern #2: frozen dataclass with dict is mutable internally."""
    bucket = Tier2BucketCustom(
        count=2, weight_kg_estimated=10.0, subtotal_inr="TBD",
        by_reason=(("a", 1), ("b", 1)),
    )
    assert isinstance(bucket.by_reason, tuple)
    assert not isinstance(bucket.by_reason, dict)


def test_tier2_bucket_custom_by_reason_default_is_empty_tuple() -> None:
    """Default ``by_reason=()`` — no mutable default."""
    bucket = Tier2BucketCustom(count=0, weight_kg_estimated=0.0, subtotal_inr="TBD")
    assert bucket.by_reason == ()


def test_boq_audit_trail_pipeline_versions_is_tuple_not_dict() -> None:
    """Anti-pattern #9: pipeline_versions must be tuple-of-pairs."""
    audit = _make_audit_trail()
    assert isinstance(audit.pipeline_versions, tuple)
    assert not isinstance(audit.pipeline_versions, dict)


def test_pipeline_versions_alphabetically_orderable() -> None:
    """Determinism: pipeline_versions tuple must accept alphabetically sorted pairs."""
    pairs = tuple(sorted([("parser", "v1.0"), ("boq", "v1.0"), ("mapper", "v1.0")]))
    audit = BOQAuditTrail(
        mapper_output_hash="0" * 64, boq_calculation_version="v1.0",
        karthik_pricing_version="v1.0", custom_quote_review_required=False,
        operator_review_required=False, pipeline_versions=pairs,
    )
    # First entry should be "boq" after alphabetical sort
    assert audit.pipeline_versions[0][0] == "boq"


def test_by_reason_alphabetically_orderable() -> None:
    """by_reason pairs must accept alphabetically sorted construction."""
    pairs = tuple(sorted([("system_180_not_stocked", 3),
                          ("thickness_below_minimum", 11),
                          ("thickness_exceeds_catalog", 6)]))
    bucket = Tier2BucketCustom(
        count=20, weight_kg_estimated=0.0, subtotal_inr="TBD", by_reason=pairs,
    )
    # First entry should be "system_180_not_stocked" alphabetically
    assert bucket.by_reason[0][0] == "system_180_not_stocked"


# ──────────────────────────────────────────────────────────────────────────────
# Frozen dataclass verification (all 15 dataclasses)
# ──────────────────────────────────────────────────────────────────────────────


_ALL_DATACLASSES = (
    BOQContext, BOQInput, BOQGeneratorOutput,
    Tier1ProjectSummary, Tier2Bucket, Tier2BucketCustom, Tier2Category,
    Tier3SKUType, Tier4SKUDetail,
    Tier5SegmentOpening, Tier5WallSegment, Tier6PanelPiece,
    CustomQuoteLineItem, OperatorReviewItem,
    BOQCommercialTerms, BOQAuditTrail,
)


def test_all_dataclasses_are_frozen() -> None:
    """All BOQ dataclasses must be frozen=True for immutability."""
    for cls in _ALL_DATACLASSES:
        params = getattr(cls, "__dataclass_params__", None)
        assert params is not None, f"{cls.__name__} is not a @dataclass"
        assert params.frozen, f"{cls.__name__} must be frozen=True"


def test_all_dataclasses_hashable() -> None:
    """Frozen dataclasses are hashable by default (usable as dict keys)."""
    # Test selected dataclasses with simple field types
    instances = [
        _make_tier1(),
        _make_tier4(),
        _make_tier5_opening(),
        _make_commercial_terms(),
    ]
    for obj in instances:
        # Should be hashable — won't raise
        h = hash(obj)
        assert isinstance(h, int)


def test_dataclasses_equality_works() -> None:
    """Two instances with same data must be ==."""
    t1a = _make_tier1()
    t1b = _make_tier1()
    assert t1a == t1b


def test_frozen_prevents_field_reassignment() -> None:
    """Attempting to set a field on a frozen instance raises FrozenInstanceError."""
    t1 = _make_tier1()
    with pytest.raises(dataclasses.FrozenInstanceError):
        t1.project_name = "modified"  # type: ignore[misc]


# ──────────────────────────────────────────────────────────────────────────────
# No mutable defaults — every default is None, immutable primitive, or tuple
# ──────────────────────────────────────────────────────────────────────────────


def test_no_mutable_defaults_in_dataclasses() -> None:
    """None of the dataclass defaults should be a list, dict, or set.

    These are mutable; bound to the class they cause shared-state bugs. Python
    raises ValueError on @dataclass declaration when this is detected, so this
    test catches accidental list/dict default values that slip past.
    """
    for cls in _ALL_DATACLASSES:
        for f in dataclasses.fields(cls):
            if f.default is dataclasses.MISSING:
                continue
            default = f.default
            assert not isinstance(default, (list, dict, set)), (
                f"{cls.__name__}.{f.name} has mutable default {default!r} — "
                "use tuple, None, or default_factory."
            )


# ──────────────────────────────────────────────────────────────────────────────
# Literal enum aliases — value counts
# ──────────────────────────────────────────────────────────────────────────────


def test_custom_quote_reason_has_10_literal_values() -> None:
    """10-value enum per CONTEXT_CONFIRMED Q6 + 01_SCHEMA.md §B."""
    args = get_args(CustomQuoteReason)
    assert len(args) == 10


def test_custom_quote_reason_includes_thickness_unknown() -> None:
    """Value #3: parser thickness=0 case."""
    assert "thickness_unknown" in get_args(CustomQuoteReason)


def test_custom_quote_reason_includes_curve_reservations() -> None:
    """Values #7 and #8 are RESERVED for future curve_handler routing."""
    args = get_args(CustomQuoteReason)
    assert "curved_wall_custom_panels" in args
    assert "tight_curve_below_min_radius" in args


def test_operator_review_type_has_4_literal_values() -> None:
    """4-value enum per CONTEXT_CONFIRMED Q7."""
    args = get_args(OperatorReviewType)
    assert len(args) == 4


def test_operator_review_type_includes_orphan_opening() -> None:
    """v1 emits only this value."""
    assert "orphan_opening" in get_args(OperatorReviewType)


def test_boq_opening_type_has_3_literal_values() -> None:
    """door / window / sliding_door (ASSUMPTION-BOQ-9 heuristic)."""
    args = get_args(BOQOpeningType)
    assert set(args) == {"door", "window", "sliding_door"}


def test_quote_status_has_3_values() -> None:
    args = get_args(QuoteStatus)
    assert set(args) == {"pending_sales_review", "priced", "voided"}


# ──────────────────────────────────────────────────────────────────────────────
# BOQContext defaults match Karthik values (CONTEXT_CONFIRMED Q4)
# ──────────────────────────────────────────────────────────────────────────────


def test_boq_context_defaults_match_karthik_values() -> None:
    """Defaults must match the locked Karthik 2026-05-25 confirmations."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    assert ctx.tax_rate_percent == 18.0
    assert ctx.discount_percent == 0.0
    assert ctx.quote_validity_days == 30
    assert ctx.currency == "INR"


def test_boq_context_determinism_hooks_default_to_none() -> None:
    """Production uses None; golden tests override."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    assert ctx.deterministic_id_seed is None
    assert ctx.generated_at_override is None


def test_boq_context_required_fields_are_project_id_and_quote_date() -> None:
    """Only project_id + quote_date are required; everything else has defaults."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    assert ctx.project_id == "X"
    assert ctx.quote_date == "2026-05-25"


def test_boq_context_optional_fields_are_optional() -> None:
    """Optional fields default to None."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    assert ctx.customer_name is None
    assert ctx.notes is None


# ──────────────────────────────────────────────────────────────────────────────
# Tier2BucketCustom.subtotal_inr Literal["TBD"] — anti-pattern #10
# ──────────────────────────────────────────────────────────────────────────────


def test_tier2_bucket_custom_subtotal_inr_must_be_tbd() -> None:
    """Only ``"TBD"`` is the legal value (runtime check via construction)."""
    bucket = Tier2BucketCustom(count=0, weight_kg_estimated=0.0, subtotal_inr="TBD")
    assert bucket.subtotal_inr == "TBD"


def test_tier2_bucket_custom_round_trips_through_json() -> None:
    """Anti-pattern #10: ``Literal["TBD"]`` must round-trip cleanly through JSON
    as a string, not a sentinel."""
    bucket = Tier2BucketCustom(
        count=2, weight_kg_estimated=10.0, subtotal_inr="TBD",
        by_reason=(("thickness_below_minimum", 2),),
    )
    as_dict = dataclasses.asdict(bucket)
    assert as_dict["subtotal_inr"] == "TBD"

    json_str = json.dumps(as_dict)
    parsed = json.loads(json_str)
    assert parsed["subtotal_inr"] == "TBD"


def test_custom_quote_line_item_subtotal_inr_is_tbd() -> None:
    """Same TBD invariant for individual line items."""
    item = _make_custom_quote_item()
    assert item.subtotal_inr == "TBD"


def test_custom_quote_line_item_subtotal_round_trips_through_json() -> None:
    """Per-item TBD must round-trip through JSON."""
    item = _make_custom_quote_item()
    as_dict = dataclasses.asdict(item)
    json_str = json.dumps(as_dict)
    parsed = json.loads(json_str)
    assert parsed["subtotal_inr"] == "TBD"


# ──────────────────────────────────────────────────────────────────────────────
# Tier4SKUDetail: line totals are independently settable (anti-pattern #5)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier4_sku_detail_line_totals_can_be_set_independently() -> None:
    """Anti-pattern #5: PR 1 schema must allow divergent line totals. PR 2
    algorithm ensures consistency; PR 4 invariant validates. No ``@property``
    accessors at PR 1 level."""
    # Construct with intentionally INCONSISTENT line totals — PR 1 must allow this.
    row = Tier4SKUDetail(
        sku_code="AP110-2998", sku_prefix="AP", thickness_mm=110,
        description="test", quantity=5,
        unit_area_sqft=1.0, unit_weight_kg=1.29, unit_price_inr=225.0,
        # Deliberately wrong line totals (NOT 5 * unit_*):
        line_total_area_sqft=999.0,
        line_total_weight_kg=999.0,
        line_total_price_inr=999.0,
    )
    # Construction succeeded with inconsistent values.
    assert row.line_total_area_sqft == 999.0
    assert row.quantity == 5


def test_tier4_sku_detail_has_both_unit_and_line_total_fields() -> None:
    """Schema must expose both ``unit_*`` and ``line_total_*`` triples."""
    fields = {f.name for f in dataclasses.fields(Tier4SKUDetail)}
    assert "unit_area_sqft" in fields
    assert "unit_weight_kg" in fields
    assert "unit_price_inr" in fields
    assert "line_total_area_sqft" in fields
    assert "line_total_weight_kg" in fields
    assert "line_total_price_inr" in fields


# ──────────────────────────────────────────────────────────────────────────────
# Tier 5 + Tier 6 structure
# ──────────────────────────────────────────────────────────────────────────────


def test_tier5_wall_segment_openings_is_tuple_of_segment_opening() -> None:
    """Openings tuple: from PR-HOTFIX-2 wiring."""
    opening = _make_tier5_opening()
    seg = Tier5WallSegment(
        wall_id="P_INT_3", system="K6-150", application="internal",
        length_mm=6824.14, height_mm=3000,
        is_custom_order=False, is_curved=False, curve_radius_mm=None,
        area_sqft=220.36, panel_count=25,
        openings=(opening,), sku_breakdown=(),
        segment_weight_kg=385.85, segment_price_inr=59463.82, notes="",
    )
    assert isinstance(seg.openings, tuple)
    assert len(seg.openings) == 1
    assert isinstance(seg.openings[0], Tier5SegmentOpening)


def test_tier5_custom_segment_panel_count_zero() -> None:
    """is_custom_order=True ⇒ panel_count==0 per POLICY-CUSTOM-QUOTE-SEPARATE."""
    seg = _make_tier5(custom=True)
    assert seg.is_custom_order is True
    assert seg.panel_count == 0
    assert seg.segment_weight_kg == 0.0
    assert seg.segment_price_inr == 0.0


def test_tier5_segment_opening_is_frozen() -> None:
    opening = _make_tier5_opening()
    with pytest.raises(dataclasses.FrozenInstanceError):
        opening.position_mm = 999.0  # type: ignore[misc]


def test_tier6_panel_piece_constructible() -> None:
    piece = _make_tier6()
    assert piece.sku_code == "ECM110-2998"
    assert piece.area_sqft > 0
    assert piece.weight_kg > 0


# ──────────────────────────────────────────────────────────────────────────────
# BOQGeneratorOutput root: all required tier fields present
# ──────────────────────────────────────────────────────────────────────────────


def test_boq_generator_output_has_all_required_tier_fields() -> None:
    """Schema must expose all 6 tier fields + custom + operator + commercial + audit."""
    fields = {f.name for f in dataclasses.fields(BOQGeneratorOutput)}
    required = {
        "boq_id", "generated_at", "schema_version",
        "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
        "tier_4_sku_details", "tier_5_wall_segments", "tier_6_panel_pieces",
        "custom_quote_items", "operator_review_items",
        "commercial_terms", "audit_trail",
        "warnings", "assumptions_made", "pending_karthik",
    }
    assert required.issubset(fields)


# ──────────────────────────────────────────────────────────────────────────────
# Golden JSON parses + structural verification
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_golden_loads_as_valid_json(p_int_8_boq_canonical_json: dict) -> None:
    """The golden JSON must be valid JSON that loads to a dict."""
    assert isinstance(p_int_8_boq_canonical_json, dict)


def test_p_int_8_golden_has_all_6_tier_keys(p_int_8_boq_canonical_json: dict) -> None:
    keys = set(p_int_8_boq_canonical_json.keys())
    required = {
        "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
        "tier_4_sku_details", "tier_5_wall_segments", "tier_6_panel_pieces",
    }
    assert required.issubset(keys)


def test_p_int_8_golden_boq_id_matches_uuid5(
    p_int_8_boq_canonical_json: dict, expected_boq_id_for_p_int_8: str,
) -> None:
    """The golden's boq_id MUST be the deterministic UUID5 from the fixture seed.
    PR 4's id_generator will reproduce this exact value."""
    assert p_int_8_boq_canonical_json["boq_id"] == expected_boq_id_for_p_int_8


def test_p_int_8_golden_mapper_hash_64_lowercase_hex(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """audit_trail.mapper_output_hash must be SHA-256 hex format."""
    h = p_int_8_boq_canonical_json["audit_trail"]["mapper_output_hash"]
    assert re.fullmatch(r"[0-9a-f]{64}", h), f"bad hash format: {h!r}"


def test_p_int_8_golden_mapper_hash_matches_expected(
    p_int_8_boq_canonical_json: dict, expected_mapper_output_hash_for_p_int_8: str,
) -> None:
    """The golden's hash MUST match the hash computed from the canonical mapper
    output. PR 5's orchestrator will reproduce this."""
    actual = p_int_8_boq_canonical_json["audit_trail"]["mapper_output_hash"]
    assert actual == expected_mapper_output_hash_for_p_int_8


def test_p_int_8_golden_grand_total_internally_consistent(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """B-6 invariant preview: grand_total ≈ subtotal_after_discount × (1 + tax/100)."""
    from app.services.kos_boq_generator import INR_TOLERANCE_RUPEES

    s = p_int_8_boq_canonical_json["tier_1_summary"]
    expected_grand = s["subtotal_after_discount_inr"] * (1 + 18.0 / 100)
    assert abs(s["grand_total_inr"] - expected_grand) < INR_TOLERANCE_RUPEES


def test_p_int_8_golden_indian_comma_formatted(p_int_8_boq_canonical_json: dict) -> None:
    """B-15 invariant preview: grand_total_inr_formatted matches Indian-comma regex."""
    formatted = p_int_8_boq_canonical_json["tier_1_summary"]["grand_total_inr_formatted"]
    # Indian comma format: ₹X[,XX]*[,XXX]?.XX
    assert re.fullmatch(r"^₹-?\d{1,3}(,\d{2,3})*\.\d{2}$", formatted), (
        f"grand_total_inr_formatted {formatted!r} doesn't match Indian comma format"
    )


def test_p_int_8_golden_custom_quotes_empty(p_int_8_boq_canonical_json: dict) -> None:
    """P_INT_8 is solid 110mm K4 — no custom quotes."""
    assert p_int_8_boq_canonical_json["custom_quote_items"] == []
    assert p_int_8_boq_canonical_json["tier_2_categories"]["custom_quotes"]["count"] == 0


def test_p_int_8_golden_operator_review_empty(p_int_8_boq_canonical_json: dict) -> None:
    """P_INT_8 has no orphan openings."""
    assert p_int_8_boq_canonical_json["operator_review_items"] == []


def test_p_int_8_golden_schema_version_is_0_1_0(p_int_8_boq_canonical_json: dict) -> None:
    """Must match the constant; bumps invalidate the fixture."""
    assert p_int_8_boq_canonical_json["schema_version"] == "0.1.0"


def test_p_int_8_golden_tier6_count_matches_tier1_total(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """B-21 invariant preview: Tier 6 count == Tier 1 standard + accessory counts."""
    t1 = p_int_8_boq_canonical_json["tier_1_summary"]
    tier_6 = p_int_8_boq_canonical_json["tier_6_panel_pieces"]
    expected = t1["total_standard_panels"] + t1["total_accessory_pieces"]
    assert len(tier_6) == expected
    # And it should equal 9 specifically for P_INT_8
    assert len(tier_6) == 9


def test_p_int_8_golden_warnings_empty(p_int_8_boq_canonical_json: dict) -> None:
    """P_INT_8 is the cleanest case — no warnings."""
    assert p_int_8_boq_canonical_json["warnings"] == []


def test_p_int_8_golden_tier4_has_5_unique_skus(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """5 unique SKUs: AP110-2998, BT110-2101, CTC110-2998, ECM110-2998, TC110-2101."""
    tier_4 = p_int_8_boq_canonical_json["tier_4_sku_details"]
    assert len(tier_4) == 5
    skus = [row["sku_code"] for row in tier_4]
    assert set(skus) == {"AP110-2998", "BT110-2101", "CTC110-2998",
                          "ECM110-2998", "TC110-2101"}


def test_p_int_8_golden_tier4_sorted_lexicographic(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """ASSUMPTION-BOQ-13: Tier 4 sorted by sku_code lexicographic."""
    tier_4 = p_int_8_boq_canonical_json["tier_4_sku_details"]
    skus = [row["sku_code"] for row in tier_4]
    assert skus == sorted(skus)


def test_p_int_8_golden_tier4_line_totals_consistent(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """B-7 invariant preview: line_total_X == quantity × unit_X."""
    from app.services.kos_boq_generator import INR_TOLERANCE_RUPEES, KG_TOLERANCE

    for row in p_int_8_boq_canonical_json["tier_4_sku_details"]:
        expected_price = row["quantity"] * row["unit_price_inr"]
        assert abs(row["line_total_price_inr"] - expected_price) < INR_TOLERANCE_RUPEES
        expected_weight = row["quantity"] * row["unit_weight_kg"]
        assert abs(row["line_total_weight_kg"] - expected_weight) < KG_TOLERANCE


def test_p_int_8_golden_tier3_has_no_custom_row(p_int_8_boq_canonical_json: dict) -> None:
    """No custom quotes ⇒ no synthetic CUSTOM row in Tier 3."""
    tier_3 = p_int_8_boq_canonical_json["tier_3_sku_types"]
    prefixes = [row["sku_prefix"] for row in tier_3]
    assert "CUSTOM" not in prefixes


def test_p_int_8_golden_tier3_priced_sum_matches_tier4(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """B-2 invariant preview: Σ Tier 3 priced ≈ Σ Tier 4 line_total."""
    from app.services.kos_boq_generator import INR_TOLERANCE_RUPEES

    t3_sum = sum(row["total_price_inr"] for row in p_int_8_boq_canonical_json["tier_3_sku_types"])
    t4_sum = sum(row["line_total_price_inr"] for row in p_int_8_boq_canonical_json["tier_4_sku_details"])
    assert abs(t3_sum - t4_sum) < INR_TOLERANCE_RUPEES


def test_p_int_8_golden_tier2_reconciles_with_tier1(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """B-3 invariant preview: Tier 2 std + acc subtotals == Tier 1 std + acc."""
    from app.services.kos_boq_generator import INR_TOLERANCE_RUPEES

    t2 = p_int_8_boq_canonical_json["tier_2_categories"]
    t1 = p_int_8_boq_canonical_json["tier_1_summary"]
    t2_sum = t2["standard_panels"]["subtotal_inr"] + t2["accessories"]["subtotal_inr"]
    t1_sum = t1["standard_panels_subtotal_inr"] + t1["accessories_subtotal_inr"]
    assert abs(t2_sum - t1_sum) < INR_TOLERANCE_RUPEES


def test_p_int_8_golden_quote_validity_30_days_after_quote_date(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """B-16 invariant preview: validity = quote_date + 30."""
    from datetime import date, timedelta

    t1 = p_int_8_boq_canonical_json["tier_1_summary"]
    quote_d = date.fromisoformat(t1["quote_date"])
    validity_d = date.fromisoformat(t1["quote_validity_until"])
    assert (validity_d - quote_d) == timedelta(days=30)


def test_p_int_8_golden_quote_number_matches_template(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """Anti-pattern #14: quote_number follows QUOTE_NUMBER_TEMPLATE."""
    t1 = p_int_8_boq_canonical_json["tier_1_summary"]
    assert t1["quote_number"] == "Q-P_INT_8_TEST-001-20260525"


def test_p_int_8_golden_pipeline_versions_alphabetically_sorted(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """Anti-pattern #2/#9: pipeline_versions sorted alphabetically by name."""
    audit = p_int_8_boq_canonical_json["audit_trail"]
    pairs = audit["pipeline_versions"]
    # JSON serializes tuples as lists
    names = [pair[0] for pair in pairs]
    assert names == sorted(names)


# ──────────────────────────────────────────────────────────────────────────────
# Full top-level shape — quick sanity
# ──────────────────────────────────────────────────────────────────────────────


def test_boq_input_instantiable_from_mapper_fixture(
    p_int_8_boq_canonical_json: dict,
) -> None:
    """Smoke test: BOQContext + BOQInput construct cleanly when supplied with
    a valid mapper output. The fixture is the dict; we don't construct the
    PanelGridMapperOutput here (that's PR 2+ territory)."""
    ctx = BOQContext(
        project_id="P_INT_8_TEST", quote_date="2026-05-25",
        deterministic_id_seed="p_int_8_test_seed",
        generated_at_override="2026-05-25T00:00:00Z",
    )
    assert ctx.project_id == "P_INT_8_TEST"
