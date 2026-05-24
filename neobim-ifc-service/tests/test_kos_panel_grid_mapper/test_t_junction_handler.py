"""Tests for t_junction_handler.handle_t_junction — DESIGN.md §6.7.

Coverage:
  - The acid: P_INT_8 (K4-110) T-junction → PC110-2998 fallback + warning
  - Through-vs-ending detection via collinearity
  - K6-150 + K8-200 + K8-250 (rulebook KZ-CC-T exists) → no warning
  - K4-110 + K6-180 (no KZ-CC-T) → warning emitted
  - SKU naming per thickness
  - Wrong junction type → warning but processes
  - Degenerate (no collinear pair) → longest wall as ending + warning
  - Determinism
"""

from __future__ import annotations

import math

from app.services.kos_panel_grid_mapper import (
    ParserJunction,
    ParserWall,
    TJunctionHandlerResult,
    handle_t_junction,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _w(
    wid: str, start: tuple[float, float], end: tuple[float, float],
    thickness: float = 110.0,
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
    point: tuple[float, float], wall_ids: tuple[str, ...],
) -> ParserJunction:
    return ParserJunction(
        point=point, type="T_JOIN", wall_ids=wall_ids,
        wall_count=len(wall_ids),
    )


# ──────────────────────────────────────────────────────────────────────────────
# THE ACID — P_INT_8 (K4-110) T-junction → PC110 fallback
# ──────────────────────────────────────────────────────────────────────────────


def test_acid_p_int_8_k4_110_t_junction_uses_pc110_with_warning() -> None:
    """P_INT_8 abuts the south perimeter wall at (6000, 0). South wall is
    split at the T into two collinear segments (w0_west, w0_east), and the
    P_INT_8 internal wall (w_int8) is the ending wall.

    Per DESIGN §6.7: K4-110 has no KZ-CC-T-110 in Rulebook §7.2 →
    falls back to PC110-2998 per Vamshi P_INT_7 convention + warning."""
    w0_west = _w("w0_west", (0, 0), (6000, 0), thickness=155.0)   # P_EXT_1 part 1
    w0_east = _w("w0_east", (6000, 0), (9370, 0), thickness=155.0)  # P_EXT_1 part 2
    w_int8 = _w("w_int8", (6000, 0), (6000, 3016), thickness=110.0)  # P_INT_8 (vertical, 110mm K4)

    j = _j((6000, 0), ("w0_west", "w0_east", "w_int8"))

    result = handle_t_junction(
        junction=j,
        incident_walls=(w0_west, w0_east, w_int8),
        wall_to_segment_id={
            "w0_west": "P_EXT_1",
            "w0_east": "P_EXT_1",
            "w_int8":  "P_INT_8",
        },
        ending_segment_corner_side={"P_INT_8": "left"},
        segment_sku_thicknesses={"P_EXT_1": 155, "P_INT_8": 110},
        segment_systems={"P_EXT_1": "K6-150", "P_INT_8": "K4-110"},
    )

    assert result.ending_segment_id == "P_INT_8"
    assert result.through_segment_id == "P_EXT_1"
    assert result.sku_thickness_mm == 110
    assert result.panel_sku == "PC110-2998"
    assert result.width_mm == 300
    assert result.cut_length_mm == 2998
    # Fallback warning must mention K4-110's missing KZ-CC-T-110.
    assert any(
        "no KZ-CC-T-110" in w and "PC110-2998" in w and "Vamshi P_INT_7" in w
        for w in result.warnings
    ), f"Missing fallback warning. Got: {result.warnings}"


# ──────────────────────────────────────────────────────────────────────────────
# Through-vs-ending detection
# ──────────────────────────────────────────────────────────────────────────────


def test_through_pair_horizontal_ending_vertical() -> None:
    """2 collinear horizontals (the through pair) + 1 perpendicular vertical
    (the ending)."""
    a = _w("a", (0, 0), (1000, 0))           # angle 0
    b = _w("b", (1000, 0), (2000, 0))        # angle 0 (collinear with a)
    c = _w("c", (1000, 0), (1000, 500))      # angle 90 (perpendicular = ending)
    j = _j((1000, 0), ("a", "b", "c"))

    result = handle_t_junction(
        junction=j,
        incident_walls=(a, b, c),
        wall_to_segment_id={"a": "P_EXT_1", "b": "P_EXT_1", "c": "P_INT_5"},
        ending_segment_corner_side={"P_INT_5": "left"},
        segment_sku_thicknesses={"P_EXT_1": 155, "P_INT_5": 110},
        segment_systems={"P_EXT_1": "K6-150", "P_INT_5": "K4-110"},
    )
    assert result.ending_segment_id == "P_INT_5"
    assert result.through_segment_id == "P_EXT_1"


def test_through_pair_vertical_ending_horizontal() -> None:
    """Opposite orientation: 2 verticals collinear + 1 perpendicular horizontal."""
    a = _w("a", (0, 0), (0, 1000))           # angle 90
    b = _w("b", (0, 1000), (0, 2000))        # angle 90
    c = _w("c", (0, 1000), (500, 1000))      # angle 0 (ending)
    j = _j((0, 1000), ("a", "b", "c"))

    result = handle_t_junction(
        junction=j,
        incident_walls=(a, b, c),
        wall_to_segment_id={"a": "P_EXT_4", "b": "P_EXT_4", "c": "P_INT_5"},
        ending_segment_corner_side={"P_INT_5": "left"},
        segment_sku_thicknesses={"P_EXT_4": 155, "P_INT_5": 110},
        segment_systems={"P_EXT_4": "K6-150", "P_INT_5": "K4-110"},
    )
    assert result.ending_segment_id == "P_INT_5"
    assert result.through_segment_id == "P_EXT_4"


# ──────────────────────────────────────────────────────────────────────────────
# Fallback warning for K4-110 and K6-180; no warning for K6-150/K8-200/K8-250
# ──────────────────────────────────────────────────────────────────────────────


def _make_t(thickness: int, system: str) -> TJunctionHandlerResult:
    a = _w("a", (0, 0), (1000, 0))
    b = _w("b", (1000, 0), (2000, 0))
    c = _w("c", (1000, 0), (1000, 500), thickness=float(thickness))
    j = _j((1000, 0), ("a", "b", "c"))
    return handle_t_junction(
        junction=j,
        incident_walls=(a, b, c),
        wall_to_segment_id={"a": "P_EXT_1", "b": "P_EXT_1", "c": "P_END"},
        ending_segment_corner_side={"P_END": "left"},
        segment_sku_thicknesses={"P_EXT_1": 155, "P_END": thickness},
        segment_systems={"P_EXT_1": "K6-150", "P_END": system},
    )


def test_k6_150_t_junction_no_fallback_warning() -> None:
    """KZ-CC-T-150 exists in Rulebook §7.2 → no fallback warning."""
    r = _make_t(thickness=155, system="K6-150")
    assert r.panel_sku == "PC155-2998"
    assert not any("no KZ-CC-T" in w for w in r.warnings)


def test_k8_200_t_junction_no_fallback_warning() -> None:
    r = _make_t(thickness=200, system="K8-200")
    assert r.panel_sku == "PC200-2998"
    assert not any("no KZ-CC-T" in w for w in r.warnings)


def test_k8_250_t_junction_no_fallback_warning() -> None:
    r = _make_t(thickness=250, system="K8-250")
    assert r.panel_sku == "PC250-2998"
    assert not any("no KZ-CC-T" in w for w in r.warnings)


def test_k4_110_t_junction_fallback_warning_emitted() -> None:
    r = _make_t(thickness=110, system="K4-110")
    assert r.panel_sku == "PC110-2998"
    assert any("no KZ-CC-T-110" in w for w in r.warnings)


def test_k6_180_t_junction_fallback_warning_emitted() -> None:
    r = _make_t(thickness=180, system="K6-180")
    assert r.panel_sku == "PC180-2998"
    assert any("no KZ-CC-T-180" in w for w in r.warnings)


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_wrong_junction_type_emits_warning() -> None:
    a = _w("a", (0, 0), (1000, 0))
    b = _w("b", (1000, 0), (2000, 0))
    c = _w("c", (1000, 0), (1000, 500))
    # Junction labeled CORNER instead of T_JOIN.
    j = ParserJunction(
        point=(1000, 0), type="CORNER", wall_ids=("a", "b", "c"), wall_count=3,
    )
    r = handle_t_junction(
        junction=j,
        incident_walls=(a, b, c),
        wall_to_segment_id={"a": "S1", "b": "S1", "c": "S2"},
        ending_segment_corner_side={"S2": "left"},
        segment_sku_thicknesses={"S1": 155, "S2": 110},
        segment_systems={"S1": "K6-150", "S2": "K4-110"},
    )
    assert any("expected 'T_JOIN'" in w for w in r.warnings)


def test_degenerate_no_collinear_pair_falls_back() -> None:
    """3 walls at different non-collinear angles → fallback to longest-as-ending."""
    a = _w("a", (0, 0), (1000, 0))             # angle 0, length 1000
    b = _w("b", (0, 0), (500, 866))            # angle 60, length 1000
    c = _w("c", (0, 0), (-866, 500))           # angle 150, length 1000
    j = _j((0, 0), ("a", "b", "c"))

    r = handle_t_junction(
        junction=j,
        incident_walls=(a, b, c),
        wall_to_segment_id={"a": "S1", "b": "S2", "c": "S3"},
        ending_segment_corner_side={"S1": "left", "S2": "left", "S3": "left"},
        segment_sku_thicknesses={"S1": 155, "S2": 155, "S3": 155},
        segment_systems={"S1": "K6-150", "S2": "K6-150", "S3": "K6-150"},
    )
    assert any("no clean collinear pair" in w for w in r.warnings)


def test_missing_ending_segment_corner_side_defaults_left() -> None:
    a = _w("a", (0, 0), (1000, 0))
    b = _w("b", (1000, 0), (2000, 0))
    c = _w("c", (1000, 0), (1000, 500))
    j = _j((1000, 0), ("a", "b", "c"))

    r = handle_t_junction(
        junction=j,
        incident_walls=(a, b, c),
        wall_to_segment_id={"a": "P_EXT_1", "b": "P_EXT_1", "c": "P_INT_5"},
        ending_segment_corner_side={},        # missing entry for P_INT_5
        segment_sku_thicknesses={"P_EXT_1": 155, "P_INT_5": 110},
        segment_systems={"P_EXT_1": "K6-150", "P_INT_5": "K4-110"},
    )
    assert r.ending_corner_side == "left"
    assert any("defaulting to 'left'" in w for w in r.warnings)


# ──────────────────────────────────────────────────────────────────────────────
# Return type + determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_return_type_is_t_junction_handler_result() -> None:
    r = _make_t(thickness=110, system="K4-110")
    assert isinstance(r, TJunctionHandlerResult)
    assert r.width_mm == 300
    assert r.cut_length_mm == 2998


def test_warnings_is_always_tuple() -> None:
    r = _make_t(thickness=155, system="K6-150")
    assert isinstance(r.warnings, tuple)


def test_determinism_repeated_calls() -> None:
    a = _make_t(thickness=110, system="K4-110")
    b = _make_t(thickness=110, system="K4-110")
    assert a == b
