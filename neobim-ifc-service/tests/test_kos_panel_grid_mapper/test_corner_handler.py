"""Tests for corner_handler.handle_corner — DESIGN.md §6.6 + R1 ownership.

Coverage:
  - R1 acid: each segment owns its LEFT corner (clockwise-walk LEFT)
  - Vamshi P_EXT_3 corner-walkthrough: 4 externals → 4 CP total, 1 per segment
  - 90° corner detection
  - 135° corner detection
  - 135° corner on K4-110/K6-180/K8-250 → fallback to 90° + warning
  - Unusual angle → default to 90° + warning
  - Mismatched SKU thicknesses → owner's thickness wins + warning
  - Degenerate "both left" or "both right" → alphabetical tiebreak + warning
  - Determinism
"""

from __future__ import annotations

import math

import pytest

from app.services.kos_panel_grid_mapper import (
    CornerHandlerResult,
    ParserJunction,
    ParserWall,
    handle_corner,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _w(
    wid: str, start: tuple[float, float], end: tuple[float, float],
    thickness: float = 155.0,
) -> ParserWall:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    angle = math.degrees(math.atan2(dy, dx)) % 180.0
    return ParserWall(
        id=wid, start=start, end=end, length_mm=round(length, 2),
        thickness_mm=thickness, angle_degrees=round(angle, 2),
        layer="A-WALL-1", detection_tier=1, confidence=0.85,
    )


def _j(
    point: tuple[float, float], jtype: str, wall_ids: tuple[str, ...],
) -> ParserJunction:
    return ParserJunction(
        point=point, type=jtype, wall_ids=wall_ids, wall_count=len(wall_ids),
    )


# ──────────────────────────────────────────────────────────────────────────────
# R1 OWNERSHIP — the load-bearing rule
# ──────────────────────────────────────────────────────────────────────────────


def test_r1_seg_a_left_owns_corner() -> None:
    """If seg_a has the corner at its polyline[0] (left), seg_a owns."""
    junction = _j((9370, 0), "CORNER", ("w0", "w1"))
    seg_a_wall = _w("w0", (0, 0), (9370, 0))             # P_EXT_1: ends at corner
    seg_b_wall = _w("w1", (9370, 0), (9370, 6692))       # P_EXT_2: starts at corner
    result = handle_corner(
        junction=junction,
        seg_a_id="P_EXT_1", seg_a_corner_side="right",
        seg_a_wall=seg_a_wall, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_2", seg_b_corner_side="left",
        seg_b_wall=seg_b_wall, seg_b_sku_thickness=155,
    )
    assert result.owner_segment_id == "P_EXT_2"
    assert result.owner_corner_side == "left"
    assert result.other_segment_id == "P_EXT_1"
    assert result.other_corner_side == "right"


def test_r1_seg_b_left_owns_corner_when_a_is_right() -> None:
    junction = _j((0, 0), "CORNER", ("w0", "w3"))
    seg_a_wall = _w("w0", (0, 0), (9370, 0))             # starts at corner → "left"
    seg_b_wall = _w("w3", (0, 6692), (0, 0))             # ends at corner → "right"
    result = handle_corner(
        junction=junction,
        seg_a_id="P_EXT_1", seg_a_corner_side="left",
        seg_a_wall=seg_a_wall, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_4", seg_b_corner_side="right",
        seg_b_wall=seg_b_wall, seg_b_sku_thickness=155,
    )
    assert result.owner_segment_id == "P_EXT_1"
    assert result.owner_corner_side == "left"


def test_r1_both_left_degenerate_alphabetical_tiebreak() -> None:
    junction = _j((0, 0), "CORNER", ("w0", "w1"))
    w_a = _w("w0", (0, 0), (1, 0))
    w_b = _w("w1", (0, 0), (0, 1))
    result = handle_corner(
        junction=junction,
        seg_a_id="P_EXT_2", seg_a_corner_side="left",
        seg_a_wall=w_a, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_1", seg_b_corner_side="left",
        seg_b_wall=w_b, seg_b_sku_thickness=155,
    )
    # Alphabetical tiebreak: P_EXT_1 < P_EXT_2 → P_EXT_1 wins
    assert result.owner_segment_id == "P_EXT_1"
    assert any("R1 ownership ambiguous" in w for w in result.warnings)


def test_r1_both_right_degenerate_alphabetical_tiebreak() -> None:
    junction = _j((0, 0), "CORNER", ("w0", "w1"))
    w_a = _w("w0", (1, 0), (0, 0))
    w_b = _w("w1", (0, 1), (0, 0))
    result = handle_corner(
        junction=junction,
        seg_a_id="P_INT_5", seg_a_corner_side="right",
        seg_a_wall=w_a, seg_a_sku_thickness=110,
        seg_b_id="P_INT_3", seg_b_corner_side="right",
        seg_b_wall=w_b, seg_b_sku_thickness=110,
    )
    assert result.owner_segment_id == "P_INT_3"
    assert any("R1 ownership ambiguous" in w for w in result.warnings)


# ──────────────────────────────────────────────────────────────────────────────
# VAMSHI ACID: 4 EXTERNALS → 4 CP TOTAL (1 per segment)
# ──────────────────────────────────────────────────────────────────────────────


def test_vamshi_4_corners_yield_1_cp_per_segment() -> None:
    """For Vamshi's 4-corner rectangular perimeter (clockwise walk from SW),
    R1 ownership should give 4 CP panels, exactly 1 per segment.

    The corner-to-segment-side map per Vamshi (synthesized in PR 4):
      Corner SW (0,0):       P_EXT_1 left, P_EXT_4 right → P_EXT_1 owns
      Corner SE (9370,0):    P_EXT_1 right, P_EXT_2 left → P_EXT_2 owns
      Corner NE (9370,6692): P_EXT_2 right, P_EXT_3 left → P_EXT_3 owns
      Corner NW (0,6692):    P_EXT_3 right, P_EXT_4 left → P_EXT_4 owns

    Result: 4 corners × 1 owner each = 4 CP, distributed 1-per-segment.
    Matches Vamshi PF_VAM_A001 Project Panel Schedule "CP155 ×4 @2998".
    """
    # The 4 perimeter walls (all 155mm thick).
    w0 = _w("w0", (0, 0),       (9370, 0),    155)    # P_EXT_1 south
    w1 = _w("w1", (9370, 0),    (9370, 6692), 155)    # P_EXT_2 east
    w2 = _w("w2", (9370, 6692), (0, 6692),    155)    # P_EXT_3 north
    w3 = _w("w3", (0, 6692),    (0, 0),       155)    # P_EXT_4 west

    corners = [
        # (junction_point, seg_a_id, seg_a_wall, seg_a_side, seg_b_id, seg_b_wall, seg_b_side, expected_owner)
        ((0, 0),       "P_EXT_1", w0, "left",  "P_EXT_4", w3, "right", "P_EXT_1"),
        ((9370, 0),    "P_EXT_1", w0, "right", "P_EXT_2", w1, "left",  "P_EXT_2"),
        ((9370, 6692), "P_EXT_2", w1, "right", "P_EXT_3", w2, "left",  "P_EXT_3"),
        ((0, 6692),    "P_EXT_3", w2, "right", "P_EXT_4", w3, "left",  "P_EXT_4"),
    ]

    owner_counts: dict[str, int] = {}
    for point, a_id, a_w, a_side, b_id, b_w, b_side, expected in corners:
        j = _j(point, "CORNER", (a_w.id, b_w.id))
        result = handle_corner(
            junction=j,
            seg_a_id=a_id, seg_a_corner_side=a_side,
            seg_a_wall=a_w, seg_a_sku_thickness=155,
            seg_b_id=b_id, seg_b_corner_side=b_side,
            seg_b_wall=b_w, seg_b_sku_thickness=155,
        )
        assert result.owner_segment_id == expected, (
            f"Corner at {point}: expected {expected}, got {result.owner_segment_id}"
        )
        assert result.panel_sku == "CP155-2998"
        owner_counts[result.owner_segment_id] = owner_counts.get(result.owner_segment_id, 0) + 1

    # Exactly 1 CP per external segment.
    assert owner_counts == {
        "P_EXT_1": 1, "P_EXT_2": 1, "P_EXT_3": 1, "P_EXT_4": 1,
    }


# ──────────────────────────────────────────────────────────────────────────────
# ANGLE CLASSIFICATION
# ──────────────────────────────────────────────────────────────────────────────


def test_90_degree_corner_classified() -> None:
    """Horizontal wall meeting vertical wall → 90°."""
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0))      # angle 0°
    w1 = _w("w1", (0, 0), (0, 1000))      # angle 90°
    result = handle_corner(
        junction=j,
        seg_a_id="P_EXT_1", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_2", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=155,
    )
    assert result.corner_angle_deg == 90


def test_135_degree_corner_classified_for_k6_150() -> None:
    """Walls at 45° offset → 135° corner."""
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0))                                 # angle 0°
    w1 = _w("w1", (0, 0), (1000 * math.cos(math.radians(45)),
                           1000 * math.sin(math.radians(45))))       # angle 45°
    result = handle_corner(
        junction=j,
        seg_a_id="P_EXT_1", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_2", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=155,
    )
    assert result.corner_angle_deg == 135


def test_135_degree_corner_for_k4_110_falls_back_to_90() -> None:
    """K4-110 has no KZ-CC-135-110 in Rulebook §7.2 → fallback to 90° + warning."""
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0), thickness=110.0)
    w1 = _w("w1", (0, 0), (1000 * math.cos(math.radians(45)),
                           1000 * math.sin(math.radians(45))), thickness=110.0)
    result = handle_corner(
        junction=j,
        seg_a_id="P_INT_5", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=110,
        seg_b_id="P_INT_6", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=110,
    )
    assert result.corner_angle_deg == 90  # downgraded from 135° per fallback
    assert any("KZ-CC-135" in w and "110mm" in w for w in result.warnings)


def test_135_degree_corner_for_k8_250_falls_back_to_90() -> None:
    """K8-250 also has no KZ-CC-135-250 per Rulebook §7.2."""
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0), thickness=250.0)
    w1 = _w("w1", (0, 0), (700.0, 700.0), thickness=250.0)   # 45° angle
    result = handle_corner(
        junction=j,
        seg_a_id="P_EXT_5", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=250,
        seg_b_id="P_EXT_6", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=250,
    )
    assert result.corner_angle_deg == 90
    assert any("KZ-CC-135" in w for w in result.warnings)


def test_unusual_angle_defaults_to_90_with_warning() -> None:
    """60° corner is neither 90° nor 135° — defaults to 90° + warning."""
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0))                              # angle 0°
    w1 = _w("w1", (0, 0), (500, 866))                             # angle 60°
    result = handle_corner(
        junction=j,
        seg_a_id="P_EXT_1", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_2", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=155,
    )
    assert result.corner_angle_deg == 90
    assert any("unusual corner angle" in w for w in result.warnings)


# ──────────────────────────────────────────────────────────────────────────────
# SKU NAMING + MISMATCH
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "thickness, expected_sku",
    [(110, "CP110-2998"), (155, "CP155-2998"), (200, "CP200-2998"),
     (180, "CP180-2998"), (250, "CP250-2998")],
)
def test_sku_naming_per_thickness(thickness: int, expected_sku: str) -> None:
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0))
    w1 = _w("w1", (0, 0), (0, 1000))
    result = handle_corner(
        junction=j,
        seg_a_id="P_EXT_1", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=thickness,
        seg_b_id="P_EXT_2", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=thickness,
    )
    assert result.panel_sku == expected_sku
    assert result.sku_thickness_mm == thickness


def test_mismatched_thicknesses_use_owner_with_warning() -> None:
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0), thickness=110.0)
    w1 = _w("w1", (0, 0), (0, 1000), thickness=155.0)
    result = handle_corner(
        junction=j,
        seg_a_id="P_INT_1", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=110,
        seg_b_id="P_EXT_1", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=155,
    )
    # Owner = P_INT_1 (left side) → uses thickness 110
    assert result.owner_segment_id == "P_INT_1"
    assert result.sku_thickness_mm == 110
    assert result.panel_sku == "CP110-2998"
    assert any("mismatched SKU thicknesses" in w for w in result.warnings)


# ──────────────────────────────────────────────────────────────────────────────
# Return type sanity + determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_return_type_is_corner_handler_result() -> None:
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0))
    w1 = _w("w1", (0, 0), (0, 1000))
    result = handle_corner(
        junction=j,
        seg_a_id="P_EXT_1", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_2", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=155,
    )
    assert isinstance(result, CornerHandlerResult)
    assert result.width_mm == 300
    assert result.cut_length_mm == 2998


def test_warnings_is_always_tuple() -> None:
    j = _j((0, 0), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 0), (1000, 0))
    w1 = _w("w1", (0, 0), (0, 1000))
    result = handle_corner(
        junction=j,
        seg_a_id="P_EXT_1", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_2", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=155,
    )
    assert isinstance(result.warnings, tuple)


def test_determinism_repeated_calls() -> None:
    j = _j((9370, 6692), "CORNER", ("w0", "w1"))
    w0 = _w("w0", (0, 6692), (9370, 6692))
    w1 = _w("w1", (9370, 0), (9370, 6692))
    kwargs = dict(
        junction=j,
        seg_a_id="P_EXT_3", seg_a_corner_side="left",
        seg_a_wall=w0, seg_a_sku_thickness=155,
        seg_b_id="P_EXT_2", seg_b_corner_side="right",
        seg_b_wall=w1, seg_b_sku_thickness=155,
    )
    a = handle_corner(**kwargs)  # type: ignore[arg-type]
    b = handle_corner(**kwargs)  # type: ignore[arg-type]
    assert a == b
