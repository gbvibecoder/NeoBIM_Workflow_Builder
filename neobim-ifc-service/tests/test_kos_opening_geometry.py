"""KOS Phase 5C-3 PR 1 — opening geometry + ParserOpening dataclass tests.

This file covers:
  - ParserOpening dataclass: frozen, all fields, validation by construction.
  - opening_overlaps / dedupe_openings_by_proximity / sort_openings_canonical
    (in kos_drawing_geometry).
  - project_point_to_wall / point_lies_on_wall / arc_near_wall / text_near_wall /
    parse_annotation_text / gap_in_collinear_walls (in kos_opening_geometry).

PR 1 INVARIANT: zero detection logic exercised here — only the primitives.
Tier-detector tests land in PR 2 (DXF) and PR 3 (PDF).

Determinism contract verified end-to-end:
  - Same inputs ⇒ byte-identical outputs (dedupe/sort run twice produces ==).
  - No reliance on dict iteration order, no random, no time-based input.
"""

from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_drawing_geometry import (
    DEDUPE_PROXIMITY_MM,
    ParserOpening,
    dedupe_openings_by_proximity,
    opening_overlaps,
    sort_openings_canonical,
)
from app.services.kos_opening_geometry import (
    ANNOTATION_TEXT_RE,
    COLLINEAR_ANGLE_TOL_DEG,
    GAP_MAX_WIDTH_MM,
    GAP_MIN_WIDTH_MM,
    NEAR_WALL_DEFAULT_PERP_TOL_MM,
    POINT_ON_WALL_PERP_TOL_MM,
    arc_near_wall,
    gap_in_collinear_walls,
    parse_annotation_text,
    point_lies_on_wall,
    project_point_to_wall,
    text_near_wall,
)


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_opening(
    *,
    oid: str = "o0",
    wall: str = "w0",
    position: float = 1000.0,
    width: float = 900.0,
    tier: int = 1,
    confidence: float = 0.9,
    opening_type: str = "door",
    sill: float = 0.0,
    method: str = "test",
    sources: tuple[str, ...] = (),
) -> ParserOpening:
    return ParserOpening(
        id=oid,
        opening_type=opening_type,  # type: ignore[arg-type]
        parent_wall_id=wall,
        position_mm=position,
        width_mm=width,
        height_mm=2100.0,
        sill_height_mm=sill,
        detection_tier=tier,
        detection_method=method,
        confidence=confidence,
        source_entities=sources,
    )


def _make_wall(
    *,
    wid: str = "w0",
    start: tuple[float, float] = (0.0, 0.0),
    end: tuple[float, float] = (5000.0, 0.0),
    layer: str = "A-WALL",
    tier: int = 1,
) -> dict:
    sx, sy = start
    ex, ey = end
    import math

    length = math.hypot(ex - sx, ey - sy)
    angle = math.degrees(math.atan2(ey - sy, ex - sx)) % 180.0
    return {
        "id": wid,
        "start": [sx, sy],
        "end": [ex, ey],
        "length_mm": round(length, 2),
        "thickness_mm": 200.0,
        "angle_degrees": round(angle, 2),
        "layer": layer,
        "detection_tier": tier,
        "confidence": 0.85,
    }


# ── ParserOpening dataclass ──────────────────────────────────────────────────


def test_parser_opening_is_frozen():
    o = _make_opening()
    with pytest.raises(dataclasses.FrozenInstanceError):
        o.position_mm = 9999.0  # type: ignore[misc]


def test_parser_opening_all_fields_present():
    o = _make_opening()
    fields = {f.name for f in dataclasses.fields(o)}
    assert fields == {
        "id",
        "opening_type",
        "parent_wall_id",
        "position_mm",
        "width_mm",
        "height_mm",
        "sill_height_mm",
        "detection_tier",
        "detection_method",
        "confidence",
        "source_entities",
    }


def test_parser_opening_supports_replace():
    """Mapper-side `replace(o, id="o0")` is part of the public contract."""
    from dataclasses import replace

    o = _make_opening(oid="_pre0")
    renamed = replace(o, id="o42")
    assert renamed.id == "o42"
    assert renamed.position_mm == o.position_mm
    assert renamed is not o


# ── opening_overlaps ─────────────────────────────────────────────────────────


def test_overlap_same_position_same_wall():
    a = _make_opening(position=1000.0, width=900.0)
    b = _make_opening(position=1000.0, width=900.0)
    assert opening_overlaps(a, b)


def test_overlap_different_walls_never_overlaps():
    a = _make_opening(wall="w0", position=1000.0)
    b = _make_opening(wall="w1", position=1000.0)
    assert not opening_overlaps(a, b)


def test_overlap_position_ranges_intersect():
    """One opening's right edge inside another opening's body."""
    a = _make_opening(position=1000.0, width=900.0)   # 1000..1900
    b = _make_opening(position=1500.0, width=900.0)   # 1500..2400
    assert opening_overlaps(a, b)


def test_overlap_within_proximity_centre_distance():
    """Disjoint ranges but centres within DEDUPE_PROXIMITY_MM."""
    a = _make_opening(position=1000.0, width=400.0)    # centre 1200, end 1400
    b = _make_opening(position=1450.0, width=400.0)    # centre 1650, end 1850
    # range gap: 50mm (disjoint? a ends 1400, b starts 1450 → disjoint)
    # Actually: 1000<1850 AND 1450<1400 → False. So we test centre-proximity.
    # centre distance = 450mm > 200mm default → NOT overlapping.
    assert not opening_overlaps(a, b)
    # Now bring them closer.
    c = _make_opening(position=1000.0, width=300.0)    # centre 1150, end 1300
    d = _make_opening(position=1400.0, width=300.0)    # centre 1550, end 1700 — disjoint (gap 100mm)
    # centre distance = 400mm > 200mm → NOT overlapping. Good — large enough gap.
    assert not opening_overlaps(c, d)
    # Now within proximity.
    e = _make_opening(position=1000.0, width=300.0)    # centre 1150
    f = _make_opening(position=1300.0, width=300.0)    # centre 1450, disjoint by 0
    # centre distance = 300mm > 200mm.
    assert not opening_overlaps(e, f)


def test_overlap_custom_proximity():
    a = _make_opening(position=1000.0, width=300.0)    # centre 1150
    b = _make_opening(position=1500.0, width=300.0)    # centre 1650
    # centre distance = 500mm. With 600mm proximity, overlaps.
    assert opening_overlaps(a, b, proximity_mm=600.0)
    assert not opening_overlaps(a, b, proximity_mm=400.0)


def test_dedupe_proximity_default_value():
    """Cite the 200mm default to keep this from drifting silently."""
    assert DEDUPE_PROXIMITY_MM == 200.0


# ── dedupe_openings_by_proximity ─────────────────────────────────────────────


def test_dedupe_empty_input():
    assert dedupe_openings_by_proximity([]) == ()


def test_dedupe_two_same_position_keeps_highest_confidence():
    high = _make_opening(oid="_pre0", position=1000.0, confidence=0.95, tier=1, method="block_ref")
    low = _make_opening(oid="_pre1", position=1000.0, confidence=0.5, tier=3, method="wall_gap")
    result = dedupe_openings_by_proximity([low, high])
    assert len(result) == 1
    # The kept record carries the high-confidence detection_method + tier.
    assert result[0].confidence == 0.95
    assert result[0].detection_tier == 1
    assert result[0].detection_method == "block_ref"


def test_dedupe_disjoint_openings_preserved():
    a = _make_opening(oid="_pre0", position=1000.0)
    b = _make_opening(oid="_pre1", position=5000.0)
    result = dedupe_openings_by_proximity([a, b])
    assert len(result) == 2


def test_dedupe_unions_source_entities():
    a = _make_opening(oid="_pre0", position=1000.0, confidence=0.9, sources=("e1",))
    b = _make_opening(oid="_pre1", position=1000.0, confidence=0.6, sources=("e2",))
    result = dedupe_openings_by_proximity([a, b])
    assert len(result) == 1
    assert result[0].source_entities == ("e1", "e2")


def test_dedupe_is_deterministic_under_input_reorder():
    """Same set of candidates in different input order ⇒ same output."""
    a = _make_opening(oid="_pre0", position=1000.0, confidence=0.9)
    b = _make_opening(oid="_pre1", position=4000.0, confidence=0.7)
    c = _make_opening(oid="_pre2", position=2500.0, confidence=0.8)
    r1 = dedupe_openings_by_proximity([a, b, c])
    r2 = dedupe_openings_by_proximity([c, a, b])
    r3 = dedupe_openings_by_proximity([b, c, a])
    assert r1 == r2 == r3


def test_dedupe_runs_twice_same_output():
    a = _make_opening(oid="_pre0", position=1000.0, confidence=0.9)
    b = _make_opening(oid="_pre1", position=1050.0, confidence=0.8)  # within proximity
    r1 = dedupe_openings_by_proximity([a, b])
    r2 = dedupe_openings_by_proximity([a, b])
    assert r1 == r2
    assert len(r1) == 1


def test_dedupe_ties_resolve_by_wall_then_position():
    """Equal confidence: parent_wall_id ASC, then position_mm ASC wins."""
    a = _make_opening(oid="_pre0", wall="w1", position=1000.0, confidence=0.8)
    b = _make_opening(oid="_pre1", wall="w0", position=1000.0, confidence=0.8)
    r1 = dedupe_openings_by_proximity([a, b])
    r2 = dedupe_openings_by_proximity([b, a])
    # Same result regardless of input order.
    assert r1 == r2
    # Different walls — no dedupe.
    assert len(r1) == 2


# ── sort_openings_canonical ──────────────────────────────────────────────────


def test_sort_canonical_by_wall_then_position():
    a = _make_opening(oid="o0", wall="w2", position=500.0)
    b = _make_opening(oid="o1", wall="w0", position=2000.0)
    c = _make_opening(oid="o2", wall="w0", position=500.0)
    result = sort_openings_canonical([a, b, c])
    assert [o.id for o in result] == ["o2", "o1", "o0"]


def test_sort_canonical_empty():
    assert sort_openings_canonical([]) == ()


def test_sort_canonical_id_breaks_position_tie():
    """If two openings have the same wall + position, id breaks the tie."""
    a = _make_opening(oid="o5", wall="w0", position=1000.0)
    b = _make_opening(oid="o2", wall="w0", position=1000.0)
    result = sort_openings_canonical([a, b])
    assert [o.id for o in result] == ["o2", "o5"]


# ── project_point_to_wall ────────────────────────────────────────────────────


def test_project_point_horizontal_wall_midpoint():
    wall = _make_wall(start=(0.0, 0.0), end=(5000.0, 0.0))
    res = project_point_to_wall(wall, (2500.0, 0.0))
    assert res is not None
    t, perp = res
    assert t == pytest.approx(2500.0)
    assert perp == pytest.approx(0.0)


def test_project_point_horizontal_wall_offset():
    wall = _make_wall(start=(0.0, 0.0), end=(5000.0, 0.0))
    res = project_point_to_wall(wall, (1000.0, 150.0))
    assert res is not None
    t, perp = res
    assert t == pytest.approx(1000.0)
    assert perp == pytest.approx(150.0)


def test_project_point_vertical_wall():
    wall = _make_wall(start=(1000.0, 0.0), end=(1000.0, 5000.0))
    res = project_point_to_wall(wall, (1100.0, 3000.0))
    assert res is not None
    t, perp = res
    assert t == pytest.approx(3000.0)
    assert perp == pytest.approx(100.0)


def test_project_point_returns_none_for_zero_length_wall():
    wall = _make_wall(start=(1000.0, 1000.0), end=(1000.0, 1000.0))
    assert project_point_to_wall(wall, (0.0, 0.0)) is None


def test_project_point_negative_t_before_wall_start():
    wall = _make_wall(start=(1000.0, 0.0), end=(5000.0, 0.0))
    res = project_point_to_wall(wall, (500.0, 0.0))
    assert res is not None
    t, _perp = res
    assert t == pytest.approx(-500.0)


# ── point_lies_on_wall ───────────────────────────────────────────────────────


def test_point_lies_on_wall_centre():
    wall = _make_wall(end=(5000.0, 0.0))
    assert point_lies_on_wall(wall, (2500.0, 0.0))


def test_point_lies_on_wall_outside_extent():
    wall = _make_wall(end=(5000.0, 0.0))
    assert not point_lies_on_wall(wall, (6000.0, 0.0))


def test_point_lies_on_wall_perpendicular_offset_rejected():
    wall = _make_wall(end=(5000.0, 0.0))
    assert not point_lies_on_wall(wall, (2500.0, 500.0))


def test_point_lies_on_wall_with_margin():
    wall = _make_wall(end=(5000.0, 0.0))
    assert point_lies_on_wall(wall, (5200.0, 0.0), margin_mm=300.0)
    assert not point_lies_on_wall(wall, (5200.0, 0.0), margin_mm=0.0)


def test_point_on_wall_perp_tol_default():
    """Document the calibrated default."""
    assert POINT_ON_WALL_PERP_TOL_MM == 250.0


# ── arc_near_wall ────────────────────────────────────────────────────────────


def test_arc_near_wall_chooses_closest():
    w1 = _make_wall(wid="w0", start=(0.0, 0.0), end=(5000.0, 0.0))
    w2 = _make_wall(wid="w1", start=(0.0, 2000.0), end=(5000.0, 2000.0))
    # Arc centred 100mm off w1.
    res = arc_near_wall((2500.0, 100.0), radius_mm=900.0, walls=[w1, w2])
    assert res is not None
    assert res[0] == "w0"
    assert res[1] == pytest.approx(2500.0)


def test_arc_near_wall_returns_none_when_far():
    w1 = _make_wall(wid="w0", end=(5000.0, 0.0))
    res = arc_near_wall(
        (2500.0, 9999.0),
        radius_mm=900.0,
        walls=[w1],
        perp_tol_mm=NEAR_WALL_DEFAULT_PERP_TOL_MM,
    )
    assert res is None


def test_arc_near_wall_rejects_off_extent():
    w1 = _make_wall(wid="w0", end=(5000.0, 0.0))
    # Centre projects to t = -500 (before wall start) → reject.
    res = arc_near_wall((-500.0, 0.0), radius_mm=900.0, walls=[w1])
    assert res is None


# ── text_near_wall ───────────────────────────────────────────────────────────


def test_text_near_wall_basic():
    w1 = _make_wall(wid="w0", end=(5000.0, 0.0))
    res = text_near_wall((2500.0, 400.0), walls=[w1])
    assert res is not None
    assert res[0] == "w0"
    assert res[1] == pytest.approx(2500.0)


def test_text_near_wall_clamps_to_extent():
    w1 = _make_wall(wid="w0", end=(5000.0, 0.0))
    # Just past the wall end, within margin.
    res = text_near_wall((5200.0, 100.0), walls=[w1], margin_mm=300.0)
    assert res is not None
    assert res[0] == "w0"
    # Clamped to wall length (5000mm).
    assert res[1] == pytest.approx(5000.0)


def test_text_near_wall_returns_none_when_off_axis():
    w1 = _make_wall(wid="w0", end=(5000.0, 0.0))
    res = text_near_wall((2500.0, 9999.0), walls=[w1])
    assert res is None


# ── parse_annotation_text ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text,expected",
    [
        ("D1 900x2100", ("door", 900.0, 2100.0)),
        ("D 900 x 2100", ("door", 900.0, 2100.0)),
        ("DR3 1200×2400", ("door", 1200.0, 2400.0)),
        ("W1 1500x1200", ("window", 1500.0, 1200.0)),
        ("WIN 600x900", ("window", 600.0, 900.0)),
        ("WND2 750x1200", ("window", 750.0, 1200.0)),
    ],
)
def test_parse_annotation_text_matches(text, expected):
    assert parse_annotation_text(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "",
        None,
        "RANDOM 12 text",
        "Wall thickness 200mm",
        "Floor level +0.000",
    ],
)
def test_parse_annotation_text_rejects(text):
    assert parse_annotation_text(text) is None


def test_annotation_text_re_is_case_insensitive():
    assert ANNOTATION_TEXT_RE.search("d1 900x2100")
    assert ANNOTATION_TEXT_RE.search("D1 900X2100")


# ── gap_in_collinear_walls ───────────────────────────────────────────────────


def test_gap_in_collinear_walls_basic():
    """Two horizontal walls with a 900mm gap between them = one opening."""
    w1 = _make_wall(wid="w0", start=(0.0, 0.0), end=(2000.0, 0.0))
    w2 = _make_wall(wid="w1", start=(2900.0, 0.0), end=(5000.0, 0.0))
    result = gap_in_collinear_walls(w1, w2)
    assert result is not None
    centre, width = result
    assert centre[0] == pytest.approx(2450.0)
    assert centre[1] == pytest.approx(0.0)
    assert width == pytest.approx(900.0)


def test_gap_in_collinear_walls_rejects_overlap():
    """Two overlapping walls — no clean gap."""
    w1 = _make_wall(wid="w0", start=(0.0, 0.0), end=(3000.0, 0.0))
    w2 = _make_wall(wid="w1", start=(1500.0, 0.0), end=(4500.0, 0.0))
    assert gap_in_collinear_walls(w1, w2) is None


def test_gap_in_collinear_walls_rejects_too_narrow():
    """Gap below GAP_MIN_WIDTH_MM is filtered out (too small for a door)."""
    w1 = _make_wall(wid="w0", start=(0.0, 0.0), end=(2000.0, 0.0))
    w2 = _make_wall(wid="w1", start=(2400.0, 0.0), end=(5000.0, 0.0))
    # Gap = 400mm < GAP_MIN_WIDTH_MM (600mm).
    assert gap_in_collinear_walls(w1, w2) is None


def test_gap_in_collinear_walls_rejects_too_wide():
    w1 = _make_wall(wid="w0", start=(0.0, 0.0), end=(2000.0, 0.0))
    w2 = _make_wall(wid="w1", start=(5500.0, 0.0), end=(8000.0, 0.0))
    # Gap = 3500mm > GAP_MAX_WIDTH_MM (2400mm).
    assert gap_in_collinear_walls(w1, w2) is None


def test_gap_in_collinear_walls_rejects_non_parallel():
    w1 = _make_wall(wid="w0", start=(0.0, 0.0), end=(2000.0, 0.0))
    w2 = _make_wall(wid="w1", start=(2900.0, 0.0), end=(5000.0, 100.0))
    # Slight angle (~2.7°). Within COLLINEAR_ANGLE_TOL_DEG = 3°, so SHOULD pass.
    res = gap_in_collinear_walls(w1, w2)
    assert res is not None
    # A wider angle should fail.
    w3 = _make_wall(wid="w2", start=(2900.0, 0.0), end=(5000.0, 1000.0))
    assert gap_in_collinear_walls(w1, w3) is None


def test_gap_in_collinear_walls_rejects_offset_axis():
    """Two parallel walls but offset perpendicularly = different walls."""
    w1 = _make_wall(wid="w0", start=(0.0, 0.0), end=(2000.0, 0.0))
    w2 = _make_wall(wid="w1", start=(2900.0, 500.0), end=(5000.0, 500.0))
    # Perpendicular offset 500mm > POINT_ON_WALL_PERP_TOL_MM (250mm).
    assert gap_in_collinear_walls(w1, w2) is None


def test_gap_thresholds_match_prompt():
    assert GAP_MIN_WIDTH_MM == 600.0
    assert GAP_MAX_WIDTH_MM == 2400.0
    assert COLLINEAR_ANGLE_TOL_DEG == 3.0
