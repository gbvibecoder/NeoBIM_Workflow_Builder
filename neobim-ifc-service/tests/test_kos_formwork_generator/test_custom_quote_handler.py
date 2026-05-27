"""PR 4: tests for custom_quote_handler.

Covers:
* Public API contract.
* P_INT_8 byte-equal contract (empty tuple — no trigger fires).
* All 10 trigger paths × positive + negative.
* Determinism (sort order + repeat calls).
* CUSTOM_QUOTE_TRIGGER_RULES coverage.
* First-match-wins per wall.
"""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    build_custom_quote_items,
    CUSTOM_QUOTE_TRIGGER_RULES,
    FRB_MAX_HEIGHT_M,
    FormworkContext,
    FormworkCustomQuoteReason,
)
from app.services.kos_formwork_generator.custom_quote_handler import (
    INHERITED_REASON_MAP,
)


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 BYTE-EQUAL CONTRACT (the critical case)
# ═════════════════════════════════════════════════════════════════════


class TestP_INT_8EmptyContract:
    def test_p_int_8_no_custom_quotes(self, p_int_8_mapper_output, formwork_context_p_int_8):
        result = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert result == ()

    def test_p_int_8_with_explicit_empty_corners(self, p_int_8_mapper_output, formwork_context_p_int_8):
        result = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8, corners=())
        assert result == ()

    def test_empty_wall_segments_empty_output(self, p_int_8_mapper_output, formwork_context_p_int_8):
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=())
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        assert result == ()


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


class TestPublicAPI:
    def test_importable(self):
        from app.services.kos_formwork_generator import build_custom_quote_items  # noqa: F401

    def test_returns_tuple(self, p_int_8_mapper_output, formwork_context_p_int_8):
        result = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert isinstance(result, tuple)


# ═════════════════════════════════════════════════════════════════════
# INHERITED REASONS (mapper passes is_custom_order=True)
# ═════════════════════════════════════════════════════════════════════


class TestInheritedCurvedWall:
    def test_curved_wall_triggers(self, curved_wall, p_int_8_mapper_output, formwork_context_p_int_8):
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(curved_wall,))
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        assert len(result) == 1
        assert result[0].reason == "inherited_curved_wall"

    def test_curved_wall_carries_wall_id(self, curved_wall, p_int_8_mapper_output, formwork_context_p_int_8):
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(curved_wall,))
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        assert result[0].wall_id == curved_wall.id

    def test_tight_curve_also_maps_to_curved(self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8):
        from app.services.kos_panel_grid_mapper.types import CustomQuoteRequest
        w = dataclasses.replace(
            p_int_8_wall, id="W_TC", is_custom_order=True,
            custom_quote_request=CustomQuoteRequest(
                wall_segment_id="W_TC", thickness_mm=0.0,
                length_mm=p_int_8_wall.length_mm, height_mm=p_int_8_wall.height_mm,
                reason="tight_curve_below_min_radius",
            ),
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        assert build_custom_quote_items(m, formwork_context_p_int_8)[0].reason == "inherited_curved_wall"


class TestInheritedCustomThickness:
    @pytest.mark.parametrize("original_reason", [
        "thickness_exceeds_catalog",
        "thickness_below_minimum",
        "thickness_unknown",
        "thickness_between_bands",
    ])
    def test_thickness_reasons_route_to_custom_thickness(
        self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8, original_reason,
    ):
        from app.services.kos_panel_grid_mapper.types import CustomQuoteRequest
        w = dataclasses.replace(
            p_int_8_wall, id="W_T", is_custom_order=True,
            custom_quote_request=CustomQuoteRequest(
                wall_segment_id="W_T", thickness_mm=0.0,
                length_mm=p_int_8_wall.length_mm, height_mm=p_int_8_wall.height_mm,
                reason=original_reason,
            ),
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        assert result[0].reason == "inherited_custom_thickness"


class TestInheritedOtherCustom:
    @pytest.mark.parametrize("original_reason", [
        "system_180_not_stocked", "system_250_custom_on_request",
        "orphan_opening_reference", "other_custom", "unknown_mapper_string",
    ])
    def test_other_custom_routing(
        self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8, original_reason,
    ):
        from app.services.kos_panel_grid_mapper.types import CustomQuoteRequest
        w = dataclasses.replace(
            p_int_8_wall, id="W_O", is_custom_order=True,
            custom_quote_request=CustomQuoteRequest(
                wall_segment_id="W_O", thickness_mm=0.0,
                length_mm=p_int_8_wall.length_mm, height_mm=p_int_8_wall.height_mm,
                reason=original_reason,
            ),
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        assert result[0].reason == "inherited_other_custom"

    def test_is_custom_order_without_explicit_quote_request(
        self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        w = dataclasses.replace(
            p_int_8_wall, id="W_NOREQ", is_custom_order=True, custom_quote_request=None,
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        assert result[0].reason == "inherited_other_custom"


# ═════════════════════════════════════════════════════════════════════
# 5F-SPECIFIC TRIGGERS
# ═════════════════════════════════════════════════════════════════════


class TestHeightExceedsMax:
    @pytest.mark.parametrize("system,max_m,test_h_mm", [
        ("K4-110", 3.6, 4000),
        ("K6-150", 5.0, 5500),
        ("K6-180", 5.0, 5500),
        ("K8-200", 6.0, 6500),
        ("K8-250", 6.0, 6500),
    ])
    def test_height_over_max_triggers(
        self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8, system, max_m, test_h_mm,
    ):
        w = dataclasses.replace(p_int_8_wall, id=f"W_{system}", system=system, height_mm=test_h_mm)
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        assert any(r.reason == "height_exceeds_field_rule_book_max" for r in result)

    @pytest.mark.parametrize("system,max_m", [
        ("K4-110", 3.6), ("K6-150", 5.0), ("K8-200", 6.0),
    ])
    def test_height_at_or_below_max_no_trigger(
        self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8, system, max_m,
    ):
        w = dataclasses.replace(p_int_8_wall, id=f"W_{system}_OK", system=system, height_mm=int(max_m * 1000))
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        assert not any(r.reason == "height_exceeds_field_rule_book_max" for r in result)


class TestPourRateExceedsMax:
    def test_pour_above_max_triggers(self, p_int_8_mapper_output, pour_exceeds_max_context):
        result = build_custom_quote_items(p_int_8_mapper_output, pour_exceeds_max_context)
        assert any(r.reason == "pour_rate_exceeds_field_rule_book_max" for r in result)

    def test_pour_at_max_no_trigger(self, p_int_8_mapper_output, formwork_context_p_int_8):
        # P_INT_8 K4-110 max = 3.0
        ctx = dataclasses.replace(formwork_context_p_int_8, pour_rate_m_per_hr=3.0)
        result = build_custom_quote_items(p_int_8_mapper_output, ctx)
        assert not any(r.reason == "pour_rate_exceeds_field_rule_book_max" for r in result)


class TestSeismicZoneV:
    def test_zone_v_triggers(self, p_int_8_mapper_output, seismic_v_context):
        result = build_custom_quote_items(p_int_8_mapper_output, seismic_v_context)
        assert any(r.reason == "seismic_zone_v_verification" for r in result)

    def test_zone_iv_no_custom_quote(self, p_int_8_mapper_output, seismic_iv_context):
        result = build_custom_quote_items(p_int_8_mapper_output, seismic_iv_context)
        assert not any(r.reason == "seismic_zone_v_verification" for r in result)

    @pytest.mark.parametrize("zone", ["II", "III", "IV"])
    def test_low_zones_no_trigger(self, p_int_8_mapper_output, formwork_context_p_int_8, zone):
        ctx = dataclasses.replace(formwork_context_p_int_8, seismic_zone=zone)
        result = build_custom_quote_items(p_int_8_mapper_output, ctx)
        assert not any(r.reason == "seismic_zone_v_verification" for r in result)


class TestWallTypeOverrideHighRisk:
    def test_k4_basement_override_triggers(
        self, p_int_8_mapper_output, k4_basement_override_context,
    ):
        result = build_custom_quote_items(p_int_8_mapper_output, k4_basement_override_context)
        assert any(r.reason == "wall_type_override_high_risk" for r in result)

    def test_no_override_no_trigger(self, p_int_8_mapper_output, formwork_context_p_int_8):
        result = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert not any(r.reason == "wall_type_override_high_risk" for r in result)


# ═════════════════════════════════════════════════════════════════════
# CORNER-LEVEL TRIGGERS
# ═════════════════════════════════════════════════════════════════════


class TestCornerLevelTriggers:
    def _make_corner(self, corner_type, walls=("P_INT_8",)):
        from app.services.kos_formwork_generator.corner_counter import CornerDetection
        return CornerDetection(
            corner_type=corner_type,
            wall_ids=walls,
            system_used="K4-110",
            cluster_x_mm=0.0,
            cluster_y_mm=0.0,
            frb_source="FRB §7.2 (test synthetic)",
        )

    def test_unsupported_angle_triggers_non_standard(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        corners = (self._make_corner("unsupported"),)
        result = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8, corners)
        assert any(r.reason == "non_standard_corner_angle" for r in result)

    def test_135_corner_unsupported_thickness(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        # P_INT_8 is K4-110 (thickness 110) — 135° corner not stocked for 110
        corners = (self._make_corner("135deg"),)
        result = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8, corners)
        assert any(r.reason == "unsupported_corner_thickness" for r in result)

    def test_t_junction_unsupported_thickness(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        # K4-110 (110mm) — T-junction needs 150/200/250
        corners = (self._make_corner("t_junction"),)
        result = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8, corners)
        assert any(r.reason == "unsupported_t_junction_thickness" for r in result)

    def test_90_corner_supported_no_trigger(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        corners = (self._make_corner("90deg"),)
        result = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8, corners)
        assert result == ()


# ═════════════════════════════════════════════════════════════════════
# FIRST-MATCH-WINS per wall
# ═════════════════════════════════════════════════════════════════════


class TestFirstMatchWins:
    def test_is_custom_order_short_circuits_height_check(
        self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        """Wall is_custom_order=True AND height>3.6m — only inherited fires, not height."""
        from app.services.kos_panel_grid_mapper.types import CustomQuoteRequest
        w = dataclasses.replace(
            p_int_8_wall, id="W_BOTH",
            is_custom_order=True, height_mm=5000,
            custom_quote_request=CustomQuoteRequest(
                wall_segment_id="W_BOTH", thickness_mm=0.0,
                length_mm=p_int_8_wall.length_mm, height_mm=5000,
                reason="thickness_unknown",
            ),
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_custom_quote_items(m, formwork_context_p_int_8)
        # Only one request per wall — and it's the inherited reason (first check)
        assert len(result) == 1
        assert result[0].reason == "inherited_custom_thickness"


# ═════════════════════════════════════════════════════════════════════
# DETERMINISM
# ═════════════════════════════════════════════════════════════════════


class TestDeterminism:
    def test_repeat_calls_identical(self, p_int_8_mapper_output, formwork_context_p_int_8):
        a = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8)
        b = build_custom_quote_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert a == b

    def test_sort_by_wall_id_then_reason(
        self, p_int_8_wall, p_int_8_mapper_output, seismic_v_context,
    ):
        w1 = dataclasses.replace(p_int_8_wall, id="W_BBB")
        w2 = dataclasses.replace(p_int_8_wall, id="W_AAA")
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w1, w2))
        result = build_custom_quote_items(m, seismic_v_context)
        wall_ids = [r.wall_id for r in result]
        assert wall_ids == sorted(wall_ids), f"not sorted: {wall_ids}"


# ═════════════════════════════════════════════════════════════════════
# MODULE CONSTANTS
# ═════════════════════════════════════════════════════════════════════


class TestModuleConstants:
    def test_trigger_rules_keyed_by_all_10_reasons(self):
        import typing
        reasons = set(typing.get_args(FormworkCustomQuoteReason))
        assert set(CUSTOM_QUOTE_TRIGGER_RULES.keys()) == reasons

    def test_inherited_reason_map_completeness(self):
        # All 10 mapper reasons should map to one of the 3 inherited_* arms.
        expected_mapper_reasons = {
            "curved_wall_custom_panels", "tight_curve_below_min_radius",
            "thickness_exceeds_catalog", "thickness_below_minimum",
            "thickness_unknown", "thickness_between_bands",
            "system_180_not_stocked", "system_250_custom_on_request",
            "orphan_opening_reference", "other_custom",
        }
        assert set(INHERITED_REASON_MAP.keys()) == expected_mapper_reasons
        for value in INHERITED_REASON_MAP.values():
            assert value in ("inherited_curved_wall", "inherited_custom_thickness", "inherited_other_custom")

    def test_frb_max_height_5_systems(self):
        assert set(FRB_MAX_HEIGHT_M.keys()) == {"K4-110", "K6-150", "K6-180", "K8-200", "K8-250"}

    def test_frb_max_height_values(self):
        # Per DESIGN v2 doc 02 §17 + Appendix A Card 1
        assert FRB_MAX_HEIGHT_M["K4-110"] == 3.6
        assert FRB_MAX_HEIGHT_M["K6-150"] == 5.0
        assert FRB_MAX_HEIGHT_M["K6-180"] == 5.0
        assert FRB_MAX_HEIGHT_M["K8-200"] == 6.0
        assert FRB_MAX_HEIGHT_M["K8-250"] == 6.0
