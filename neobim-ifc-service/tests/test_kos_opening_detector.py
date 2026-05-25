"""KOS Phase 5C-3 PR 1 — opening detector orchestrator + ground-truth fixtures.

Two concerns covered here:

1. Detector orchestrator skeleton:
   - Empty / no-op behaviour (PR 1 has no tier detectors wired).
   - Determinism contract (same inputs ⇒ same outputs across runs).
   - Sequential id assignment after sort.
   - Confidence threshold filtering with warning surfacing.
   - Classification short-circuit (non-FLOOR_PLAN → empty).

2. Ground-truth fixture validation:
   - All 10 Vamshi fixtures load + parse.
   - Each fixture's invariants hold (positions inside extent, no overlapping
     openings, jamb spacing ≥ 300mm, door → sill=0, etc.).
   - The aggregate inventory matches §1.3 of the 5C-3 prompt:
       15 openings total / 7 walls with openings / 3 solid walls / all doors.

The fixtures become the calibration anchor for PR 2 (DXF) and PR 3 (PDF).

Fixture JSON schema (since the README lives in temp_folder/ per memory rule):

    {
      "wall_id": "P_EXT_3",              segment id (matches mapper segment.id)
      "wall_length_mm": 9370,
      "expected_openings": [             sorted by position_mm
        {
          "opening_type": "door" | "window",
          "position_mm": 2271,           distance from segment start
          "width_mm": 900,
          "height_mm": 2100,
          "sill_height_mm": 0            0 for door; >0 for window
        }, ...
      ],
      "tolerance_position_mm": 100,
      "tolerance_width_mm": 50,
      "source": "Vamshi PDF sheet PF_VAM_A005",
      "notes": "..."
    }
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.services.kos_drawing_geometry import (
    DEDUPE_PROXIMITY_MM,
    ParserOpening,
)
from app.services.kos_opening_detector import (
    MIN_CONFIDENCE_THRESHOLD,
    _OpeningCandidate,
    assign_sequential_ids,
    detect_openings,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "openings"


# ── orchestrator: empty input ────────────────────────────────────────────────


def test_orchestrator_empty_walls_returns_empty():
    openings, warnings = detect_openings(
        walls=[],
        junctions=[],
        raw_entities=None,
        source_type="dxf",
        classification="FLOOR_PLAN",
    )
    assert openings == ()
    assert warnings == ()


def test_orchestrator_short_circuits_non_floor_plan():
    """SECTION/ELEVATION/DETAIL drawings can't carry plan-view openings."""
    for classification in ("SECTION", "ELEVATION", "DETAIL", "UNKNOWN"):
        openings, warnings = detect_openings(
            walls=[{"id": "w0", "length_mm": 5000}],
            junctions=[],
            raw_entities=None,
            source_type="dxf",
            classification=classification,
        )
        assert openings == ()
        assert warnings == ()


# ── orchestrator: PR 1 baseline (no tier detectors yet) ─────────────────────


def test_orchestrator_pr1_returns_empty_for_floor_plan():
    """PR 1: tier detectors are stubs — orchestrator emits nothing."""
    openings, warnings = detect_openings(
        walls=[{"id": "w0", "length_mm": 5000}],
        junctions=[],
        raw_entities=None,
        source_type="dxf",
        classification="FLOOR_PLAN",
    )
    assert openings == ()
    assert warnings == ()


def test_orchestrator_pr1_works_for_pdf_source():
    openings, warnings = detect_openings(
        walls=[{"id": "w0", "length_mm": 5000}],
        junctions=[],
        raw_entities=None,
        source_type="pdf",
        classification="FLOOR_PLAN",
    )
    assert openings == ()
    assert warnings == ()


# ── orchestrator: determinism & id assignment via candidate injection ────────


def _candidate(
    wall: str = "w0",
    position: float = 1000.0,
    confidence: float = 0.9,
    tier: int = 1,
    method: str = "test",
    width: float = 900.0,
    opening_type: str = "door",
    sill: float = 0.0,
    sources: tuple[str, ...] = (),
) -> _OpeningCandidate:
    return _OpeningCandidate(
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


def _run_orchestrator_with_candidates(
    candidates: list[_OpeningCandidate],
    *,
    classification: str = "FLOOR_PLAN",
    source_type: str = "dxf",
    min_confidence: float = MIN_CONFIDENCE_THRESHOLD,
) -> tuple[tuple[ParserOpening, ...], tuple[str, ...]]:
    """Helper: monkey-patch tier hooks for one orchestrator call.

    This is the PR 1 test harness for the candidate-pipeline (dedupe + sort +
    id-assignment) without needing real tier detectors. PR 2 and PR 3 will
    test the real tier hooks individually + their integration.
    """
    from app.services import kos_opening_detector as mod

    original = mod._detect_tier1_block_reference

    def fake_tier1(walls, raw):
        return candidates

    mod._detect_tier1_block_reference = fake_tier1  # type: ignore[assignment]
    try:
        return detect_openings(
            walls=[],
            junctions=[],
            raw_entities=None,
            source_type=source_type,  # type: ignore[arg-type]
            classification=classification,
            min_confidence=min_confidence,
        )
    finally:
        mod._detect_tier1_block_reference = original  # type: ignore[assignment]


def test_orchestrator_assigns_sequential_ids():
    candidates = [
        _candidate(wall="w0", position=1000.0),
        _candidate(wall="w0", position=4000.0),
        _candidate(wall="w1", position=500.0),
    ]
    openings, _ = _run_orchestrator_with_candidates(candidates)
    assert [o.id for o in openings] == ["o0", "o1", "o2"]


def test_orchestrator_sorts_canonically_before_id_assignment():
    """Candidates supplied in random order — output sorted by wall then position."""
    candidates = [
        _candidate(wall="w2", position=4000.0),
        _candidate(wall="w0", position=500.0),
        _candidate(wall="w0", position=2500.0),
        _candidate(wall="w1", position=1000.0),
    ]
    openings, _ = _run_orchestrator_with_candidates(candidates)
    assert [(o.parent_wall_id, o.position_mm) for o in openings] == [
        ("w0", 500.0),
        ("w0", 2500.0),
        ("w1", 1000.0),
        ("w2", 4000.0),
    ]
    assert [o.id for o in openings] == ["o0", "o1", "o2", "o3"]


def test_orchestrator_dedupes_overlapping_candidates():
    """Two tiers detect the SAME opening — orchestrator keeps the higher confidence."""
    candidates = [
        _candidate(wall="w0", position=1000.0, confidence=0.95, tier=1, method="block_ref"),
        _candidate(wall="w0", position=1000.0, confidence=0.55, tier=3, method="wall_gap"),
    ]
    openings, _ = _run_orchestrator_with_candidates(candidates)
    assert len(openings) == 1
    assert openings[0].confidence == 0.95
    assert openings[0].detection_tier == 1


def test_orchestrator_filters_below_min_confidence():
    candidates = [
        _candidate(wall="w0", position=1000.0, confidence=0.9, method="block_ref"),
        _candidate(wall="w1", position=2000.0, confidence=0.3, method="weak_heuristic"),
    ]
    openings, warnings = _run_orchestrator_with_candidates(candidates)
    assert len(openings) == 1
    assert openings[0].parent_wall_id == "w0"
    # The dropped candidate surfaces as a warning.
    assert any("weak_heuristic" in w for w in warnings)
    assert any("confidence=0.30" in w for w in warnings)


def test_orchestrator_is_deterministic_across_runs():
    candidates = [
        _candidate(wall="w0", position=1000.0, confidence=0.9, tier=1),
        _candidate(wall="w1", position=4000.0, confidence=0.7, tier=2),
        _candidate(wall="w0", position=2500.0, confidence=0.8, tier=3),
    ]
    r1, w1 = _run_orchestrator_with_candidates(candidates)
    r2, w2 = _run_orchestrator_with_candidates(candidates)
    assert r1 == r2
    assert w1 == w2


def test_orchestrator_proximity_dedupe_default():
    """Two candidates within 200mm on the same wall = one opening."""
    candidates = [
        _candidate(wall="w0", position=1000.0, width=900.0, confidence=0.9, method="t1"),
        _candidate(wall="w0", position=1150.0, width=900.0, confidence=0.7, method="t2"),
    ]
    openings, _ = _run_orchestrator_with_candidates(candidates)
    assert len(openings) == 1


def test_orchestrator_disjoint_openings_kept_separate():
    candidates = [
        _candidate(wall="w0", position=1000.0, width=900.0, confidence=0.9),
        _candidate(wall="w0", position=3500.0, width=900.0, confidence=0.9),
    ]
    openings, _ = _run_orchestrator_with_candidates(candidates)
    assert len(openings) == 2
    assert openings[0].position_mm == 1000.0
    assert openings[1].position_mm == 3500.0


def test_orchestrator_min_confidence_threshold_value():
    assert MIN_CONFIDENCE_THRESHOLD == 0.5


def test_orchestrator_dedupe_proximity_aligned_with_shared_constant():
    assert DEDUPE_PROXIMITY_MM == 200.0


# ── assign_sequential_ids helper ────────────────────────────────────────────


def test_assign_sequential_ids_basic():
    openings = (
        ParserOpening(
            id="anything",
            opening_type="door",
            parent_wall_id="w0",
            position_mm=1000.0,
            width_mm=900.0,
            height_mm=2100.0,
            sill_height_mm=0.0,
            detection_tier=1,
            detection_method="test",
            confidence=0.9,
            source_entities=(),
        ),
    )
    result = assign_sequential_ids(openings)
    assert result[0].id == "o0"


def test_assign_sequential_ids_custom_prefix():
    openings = (
        ParserOpening(
            id="x",
            opening_type="door",
            parent_wall_id="w0",
            position_mm=1000.0,
            width_mm=900.0,
            height_mm=2100.0,
            sill_height_mm=0.0,
            detection_tier=1,
            detection_method="test",
            confidence=0.9,
            source_entities=(),
        ),
        replace(
            ParserOpening(
                id="y",
                opening_type="door",
                parent_wall_id="w0",
                position_mm=2000.0,
                width_mm=900.0,
                height_mm=2100.0,
                sill_height_mm=0.0,
                detection_tier=1,
                detection_method="test",
                confidence=0.9,
                source_entities=(),
            ),
        ),
    )
    result = assign_sequential_ids(openings, prefix="op_")
    assert [o.id for o in result] == ["op_0", "op_1"]


# ── ground-truth fixtures: loadability + invariants ─────────────────────────


# All 10 Vamshi fixture filenames. Hard-coded here so a missing file is a
# loud failure, not silently-skipped.
VAMSHI_FIXTURE_NAMES = [
    "vamshi_p_ext_1_expected.json",
    "vamshi_p_ext_2_expected.json",
    "vamshi_p_ext_3_expected.json",
    "vamshi_p_ext_4_expected.json",
    "vamshi_p_int_5_expected.json",
    "vamshi_p_int_6_expected.json",
    "vamshi_p_int_7_expected.json",
    "vamshi_p_int_8_expected.json",
    "vamshi_p_int_9_expected.json",
    "vamshi_p_int_10_expected.json",
]


def _load_fixture(name: str) -> dict:
    path = FIXTURES_DIR / name
    assert path.exists(), f"missing fixture: {path}"
    return json.loads(path.read_text())


@pytest.mark.parametrize("name", VAMSHI_FIXTURE_NAMES)
def test_fixture_loads_and_has_required_keys(name):
    fixture = _load_fixture(name)
    required = {
        "wall_id",
        "wall_length_mm",
        "expected_openings",
        "tolerance_position_mm",
        "tolerance_width_mm",
        "source",
    }
    missing = required - fixture.keys()
    assert not missing, f"{name} missing keys: {missing}"


@pytest.mark.parametrize("name", VAMSHI_FIXTURE_NAMES)
def test_fixture_wall_id_matches_vamshi_segment_pattern(name):
    fixture = _load_fixture(name)
    wid = fixture["wall_id"]
    assert wid.startswith("P_EXT_") or wid.startswith("P_INT_"), (
        f"{name}: wall_id {wid!r} not in Vamshi convention"
    )


@pytest.mark.parametrize("name", VAMSHI_FIXTURE_NAMES)
def test_fixture_wall_length_positive(name):
    fixture = _load_fixture(name)
    assert fixture["wall_length_mm"] > 0


@pytest.mark.parametrize("name", VAMSHI_FIXTURE_NAMES)
def test_fixture_opening_invariants(name):
    fixture = _load_fixture(name)
    length = fixture["wall_length_mm"]

    last_end = -1.0
    for op in fixture["expected_openings"]:
        # Required opening keys.
        for k in ("opening_type", "position_mm", "width_mm", "height_mm", "sill_height_mm"):
            assert k in op, f"{name}: opening missing {k}"

        # Type literal.
        assert op["opening_type"] in ("door", "window"), (
            f"{name}: unknown type {op['opening_type']}"
        )

        # Doors have sill 0; windows have sill > 0.
        if op["opening_type"] == "door":
            assert op["sill_height_mm"] == 0, (
                f"{name}: door with non-zero sill {op['sill_height_mm']}"
            )
        else:
            assert op["sill_height_mm"] > 0, (
                f"{name}: window with zero/negative sill {op['sill_height_mm']}"
            )

        # Dimensions sane.
        assert op["position_mm"] >= 0
        assert op["width_mm"] > 0
        assert op["height_mm"] > 0

        # Fits inside the wall.
        assert op["position_mm"] + op["width_mm"] <= length, (
            f"{name}: opening at {op['position_mm']}+{op['width_mm']} "
            f"exceeds wall length {length}"
        )

        # Sorted ascending by position; ≥ 300mm jamb spacing between consecutive.
        # 300mm: a single Kalzen panel width — the smallest meaningful spacing
        # between two jamb structures in the Karthik panel catalog.
        if last_end >= 0:
            spacing = op["position_mm"] - last_end
            assert spacing >= 300.0, (
                f"{name}: opening at {op['position_mm']} only {spacing:.0f}mm "
                f"after previous opening end {last_end:.0f}"
            )
        last_end = op["position_mm"] + op["width_mm"]


@pytest.mark.parametrize("name", VAMSHI_FIXTURE_NAMES)
def test_fixture_tolerances_within_sensible_bounds(name):
    fixture = _load_fixture(name)
    # Position tolerance: small enough to catch real errors, big enough to
    # absorb PDF rendering jitter.
    assert 0 < fixture["tolerance_position_mm"] <= 200, (
        f"{name}: tolerance_position_mm out of band"
    )
    # Width tolerance: small enough that a 750mm vs 900mm misread is caught.
    assert 0 < fixture["tolerance_width_mm"] <= 100, (
        f"{name}: tolerance_width_mm out of band"
    )


def test_vamshi_aggregate_counts_match_prompt():
    """The 10 fixtures together must reproduce the §1.3 inventory:
    15 openings total / 7 walls with openings / 3 solid walls."""
    total_openings = 0
    walls_with_openings = 0
    solid_walls = 0
    door_count = 0
    window_count = 0

    for name in VAMSHI_FIXTURE_NAMES:
        fx = _load_fixture(name)
        n = len(fx["expected_openings"])
        total_openings += n
        if n == 0:
            solid_walls += 1
        else:
            walls_with_openings += 1
        for op in fx["expected_openings"]:
            if op["opening_type"] == "door":
                door_count += 1
            else:
                window_count += 1

    assert total_openings == 15, f"expected 15 openings, got {total_openings}"
    assert walls_with_openings == 7
    assert solid_walls == 3
    # §1.3 says "All Vamshi openings are doors. No windows in Vamshi."
    assert door_count == 15
    assert window_count == 0


def test_vamshi_p_ext_3_matches_prompt_example():
    """The 5C-3 prompt §3 hard-codes positions 2271 + 7464 for P_EXT_3."""
    fx = _load_fixture("vamshi_p_ext_3_expected.json")
    assert fx["wall_id"] == "P_EXT_3"
    assert fx["wall_length_mm"] == 9370
    positions = [o["position_mm"] for o in fx["expected_openings"]]
    assert positions == [2271, 7464]
    widths = [o["width_mm"] for o in fx["expected_openings"]]
    assert widths == [900, 900]


def test_vamshi_solid_walls_zero_openings():
    """P_INT_6, P_INT_8, P_INT_10 are documented solid in §1.3 — must stay 0."""
    for solid in ("vamshi_p_int_6_expected.json", "vamshi_p_int_8_expected.json",
                  "vamshi_p_int_10_expected.json"):
        fx = _load_fixture(solid)
        assert fx["expected_openings"] == [], (
            f"{solid}: expected solid wall, got {len(fx['expected_openings'])} openings"
        )


def test_vamshi_wall_lengths_match_prompt():
    """Wall lengths from §1.3 are LOAD-BEARING in PR 2/3 calibration —
    catch a drift here, not deep in detector tuning."""
    expected_lengths = {
        "P_EXT_1": 9370,
        "P_EXT_2": 6692,
        "P_EXT_3": 9370,
        "P_EXT_4": 6692,
        "P_INT_5": 6537,
        "P_INT_6": 3016,
        "P_INT_7": 2963,
        "P_INT_8": 2101,
        "P_INT_9": 3632,
        "P_INT_10": 3016,
    }
    for name in VAMSHI_FIXTURE_NAMES:
        fx = _load_fixture(name)
        wid = fx["wall_id"]
        assert fx["wall_length_mm"] == expected_lengths[wid], (
            f"{name}: wall_length_mm {fx['wall_length_mm']} != "
            f"prompt-spec {expected_lengths[wid]}"
        )
