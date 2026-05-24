"""Tests for curve_handler.detect_curve — DESIGN.md §6.9.

Coverage:
  - The acid: Vamshi has zero curves — typical wall sequences return no-curve
  - Insufficient walls: 0, 1, 2 → no curve
  - Straight walls (all same angle) → no curve
  - Sharp corner (single large delta > 15°) → not a curve (a corner)
  - Gentle curve too short (total < 30°) → no curve
  - Real curve passing approximate threshold (radius ≥ 600mm) → approximate
  - Tight curve (radius < 600mm) → flag_custom + warning
  - Determinism
"""

from __future__ import annotations

import math

import pytest

from app.services.kos_panel_grid_mapper import (
    MIN_KALZEN_CURVE_RADIUS_MM,
    CurveResult,
    ParserWall,
    detect_curve,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _w(
    wid: str, length: float, angle: float,
) -> ParserWall:
    """Build a parser wall — actual start/end coords don't matter here; the
    curve handler only reads length_mm and angle_degrees."""
    return ParserWall(
        id=wid,
        start=(0.0, 0.0),    # unused by curve handler
        end=(length, 0.0),   # unused
        length_mm=length,
        thickness_mm=110.0,
        angle_degrees=angle % 180.0,
        layer="A-WALL-1",
        detection_tier=1,
        confidence=0.85,
    )


# ──────────────────────────────────────────────────────────────────────────────
# THE ACID — Vamshi has zero curves
# ──────────────────────────────────────────────────────────────────────────────


def test_vamshi_typical_orthogonal_wall_no_curve() -> None:
    """A Vamshi-style orthogonal wall (single long segment) has no curve."""
    walls = [_w("w0", 9370.0, 0.0)]
    res = detect_curve(walls)
    assert res.has_curve is False
    assert res.decision == "approximate"
    assert res.curve_radius_mm is None
    assert res.warnings == ()


def test_vamshi_two_orthogonal_walls_in_chain_no_curve() -> None:
    """Two perpendicular walls (corner, not curve)."""
    walls = [_w("w0", 1000.0, 0.0), _w("w1", 1000.0, 90.0)]
    res = detect_curve(walls)
    assert res.has_curve is False    # < 3 walls
    assert res.decision == "approximate"


# ──────────────────────────────────────────────────────────────────────────────
# Insufficient walls
# ──────────────────────────────────────────────────────────────────────────────


def test_empty_input_no_curve() -> None:
    res = detect_curve([])
    assert res.has_curve is False
    assert res.decision == "approximate"


def test_one_wall_no_curve() -> None:
    res = detect_curve([_w("w0", 1000.0, 45.0)])
    assert res.has_curve is False
    assert res.decision == "approximate"


def test_two_walls_no_curve_even_with_bend() -> None:
    """Two walls can form a corner, not a curve (need ≥3)."""
    walls = [_w("w0", 100.0, 0.0), _w("w1", 100.0, 10.0)]
    res = detect_curve(walls)
    assert res.has_curve is False


# ──────────────────────────────────────────────────────────────────────────────
# Straight walls (all same angle)
# ──────────────────────────────────────────────────────────────────────────────


def test_three_collinear_walls_no_curve() -> None:
    """Δangle = 0 → not in [1°, 15°] range, so no curve."""
    walls = [_w("w0", 1000.0, 0.0), _w("w1", 1000.0, 0.0), _w("w2", 1000.0, 0.0)]
    res = detect_curve(walls)
    assert res.has_curve is False
    assert res.decision == "approximate"


# ──────────────────────────────────────────────────────────────────────────────
# Sharp corner (delta > 15°) — not a curve
# ──────────────────────────────────────────────────────────────────────────────


def test_sharp_30_degree_corner_not_a_curve() -> None:
    """A single 30° bend at one junction — too sharp for a curve."""
    walls = [
        _w("w0", 1000.0, 0.0),
        _w("w1", 1000.0, 30.0),   # one big delta = 30° > 15° threshold
        _w("w2", 1000.0, 30.0),   # delta=0 here
    ]
    res = detect_curve(walls)
    assert res.has_curve is False


def test_90_degree_corner_not_a_curve() -> None:
    walls = [
        _w("w0", 1000.0, 0.0),
        _w("w1", 1000.0, 90.0),
        _w("w2", 1000.0, 90.0),
    ]
    res = detect_curve(walls)
    assert res.has_curve is False


# ──────────────────────────────────────────────────────────────────────────────
# Curve too gentle (total < 30°)
# ──────────────────────────────────────────────────────────────────────────────


def test_three_walls_with_5_degree_deltas_too_gentle() -> None:
    """Two deltas of 5° each = 10° total, < 30° → not a curve (noisy straights)."""
    walls = [
        _w("w0", 1000.0, 0.0),
        _w("w1", 1000.0, 5.0),
        _w("w2", 1000.0, 10.0),
    ]
    res = detect_curve(walls)
    assert res.has_curve is False


# ──────────────────────────────────────────────────────────────────────────────
# Real curves — approximate vs flag_custom
# ──────────────────────────────────────────────────────────────────────────────


def test_gentle_curve_with_long_walls_is_approximated() -> None:
    """3 walls × 1000mm each, 15° between consecutive → total 30°.
    Radius = 3000 / radians(30) = 3000 / 0.524 ≈ 5730mm >> 600mm → approximate."""
    walls = [
        _w("w0", 1000.0, 0.0),
        _w("w1", 1000.0, 15.0),
        _w("w2", 1000.0, 30.0),
    ]
    res = detect_curve(walls)
    assert res.has_curve is True
    assert res.decision == "approximate"
    assert res.curve_radius_mm is not None
    assert res.curve_radius_mm > MIN_KALZEN_CURVE_RADIUS_MM
    # Computed: 3000/radians(30) ≈ 5730mm
    assert math.isclose(res.curve_radius_mm, 3000.0 / math.radians(30), rel_tol=1e-6)


def test_tight_curve_with_short_walls_flagged_custom() -> None:
    """3 walls × 100mm each, 15° between → total 30° → radius ≈ 573mm < 600 → flag."""
    walls = [
        _w("w0", 100.0, 0.0),
        _w("w1", 100.0, 15.0),
        _w("w2", 100.0, 30.0),
    ]
    res = detect_curve(walls)
    assert res.has_curve is True
    assert res.decision == "flag_custom"
    assert res.curve_radius_mm is not None
    assert res.curve_radius_mm < MIN_KALZEN_CURVE_RADIUS_MM
    assert any("custom curved SKU" in w for w in res.warnings)


def test_long_curve_many_walls_approximate() -> None:
    """6 walls × 500mm each, 8° between consecutive → 5 deltas × 8° = 40° total.
    Radius = 3000 / radians(40) ≈ 4297mm > 600 → approximate."""
    walls = [_w(f"w{i}", 500.0, i * 8.0) for i in range(6)]
    res = detect_curve(walls)
    assert res.has_curve is True
    assert res.decision == "approximate"


# ──────────────────────────────────────────────────────────────────────────────
# Radius computation correctness
# ──────────────────────────────────────────────────────────────────────────────


def test_radius_formula_matches_arc_over_angle() -> None:
    """3 walls of equal length L, 15° Δ between consecutive pairs.
    Total angle = 2×15 = 30° (meets MIN_TOTAL_ANGLE_DEG threshold).
    Arc = 3L. radius = 3L / radians(30°)."""
    walls = [_w(f"w{i}", 800.0, i * 15.0) for i in range(3)]
    res = detect_curve(walls)
    assert res.has_curve is True
    expected = (3 * 800.0) / math.radians(30.0)
    assert math.isclose(res.curve_radius_mm, expected, rel_tol=1e-9)


# ──────────────────────────────────────────────────────────────────────────────
# Modular angle handling
# ──────────────────────────────────────────────────────────────────────────────


def test_angle_normalization_handles_wrap_around() -> None:
    """Walls at angle 178° and 2° should be considered 4° apart (modular).
    But the parser already normalises to [0, 180), so:
      178 % 180 = 178; 2 % 180 = 2; |178 - 2| % 180 = 176; folded > 90 → 180-176 = 4
    So Δ=4° (in [1°, 15°] range — counts as small bend).
    """
    walls = [
        _w("w0", 1000.0, 178.0),
        _w("w1", 1000.0, 2.0),
        _w("w2", 1000.0, 6.0),
    ]
    # Δ1 = |178 - 2| % 180 = 176 → folded = 4°
    # Δ2 = |2 - 6| % 180 = 4°
    # Total = 8°, < 30° → no curve
    res = detect_curve(walls)
    assert res.has_curve is False    # too gentle


# ──────────────────────────────────────────────────────────────────────────────
# Return type sanity + determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_return_type_is_curve_result() -> None:
    res = detect_curve([_w("w0", 100.0, 0.0)])
    assert isinstance(res, CurveResult)


def test_warnings_is_always_tuple() -> None:
    for walls in [
        [],
        [_w("w0", 100.0, 0.0)],
        [_w("w0", 100.0, 0.0), _w("w1", 100.0, 15.0), _w("w2", 100.0, 30.0)],
    ]:
        res = detect_curve(walls)
        assert isinstance(res.warnings, tuple)


def test_determinism_repeated_calls() -> None:
    walls = [_w(f"w{i}", 500.0, i * 10.0) for i in range(4)]
    a = detect_curve(walls)
    b = detect_curve(walls)
    assert a == b
