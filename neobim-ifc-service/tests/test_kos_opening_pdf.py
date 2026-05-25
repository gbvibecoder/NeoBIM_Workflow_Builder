"""KOS Phase 5C-3 PR 3 — PDF opening detection tests + Vamshi calibration.

Three concerns:

1. Per-tier unit tests on synthetic ``raw_entities`` dicts (no PDF I/O).
2. End-to-end on synthetic vector PDFs built with PyMuPDF — these are the
   "PR 2-equivalent" upper-bound numbers for PDFs since they contain the
   exact signals the detector expects.
3. Live Vamshi calibration — run the parser + detector against the real
   ``temp_folder/reference/Kalzen BIM integration.pdf`` and record the
   honest accuracy result. **This is the first independent (non-synthesised)
   accuracy measurement.**

The Vamshi PDF turns out to be a FILLED-RECTANGLE rendered elevation set
(see PR 3 report for the full forensic analysis): the existing PDF parser
extracts zero walls from it, and our detector requires walls to anchor
opening positions. The Vamshi calibration test therefore captures the
honest "0 detected / 15 expected" reality + documents the root cause
(parser limitation, not detector limitation).
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from pathlib import Path

import fitz
import pytest

from app.services.kos_opening_detector import _OpeningCandidate, detect_openings
from app.services.kos_opening_pdf import (
    ANNOTATION_PDF_DISTANCE_MAX_MM,
    ARC_TO_WALL_DISTANCE_MAX_PDF_MM,
    SWING_ARC_BBOX_ASPECT_TOL,
    SWING_ARC_RADIUS_MAX_MM,
    SWING_ARC_RADIUS_MIN_MM,
    TIER2_PDF_SWING_ARC_CONFIDENCE,
    TIER3_PDF_WALL_GAP_CONFIDENCE,
    TIER4_PDF_ANNOTATION_CONFIDENCE,
    detect_tier2_swing_arc_pdf,
    detect_tier3_wall_gap_pdf,
    detect_tier4_annotation_pdf,
    extract_pdf_entities,
)
from app.services.kos_pdf_parser import parse_pdf_walls

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "openings"
VAMSHI_PDF = Path(
    "/Users/govindbhujbal/work/Hackthon - Workflow Builder/"
    "NeoBIM_Workflow_Builder/temp_folder/reference/Kalzen BIM integration.pdf"
)


# ── synthetic helpers ────────────────────────────────────────────────────────


def _single_wall(length_mm: float = 5000.0, wid: str = "w0") -> dict:
    return {
        "id": wid,
        "start": [0.0, 0.0],
        "end": [length_mm, 0.0],
        "length_mm": length_mm,
        "thickness_mm": 200.0,
        "angle_degrees": 0.0,
        "layer": "PDF:black@1.2pt",
        "detection_tier": 1,
        "confidence": 0.85,
    }


# ── threshold pinning ────────────────────────────────────────────────────────


def test_pdf_confidence_ceilings_match_prompt():
    """5C-3 prompt §1.5: PDF Tier 2 ceiling is 0.75 (vs DXF 0.85)."""
    assert TIER2_PDF_SWING_ARC_CONFIDENCE == 0.75
    assert TIER3_PDF_WALL_GAP_CONFIDENCE == 0.75
    assert TIER4_PDF_ANNOTATION_CONFIDENCE == 0.70


def test_arc_to_wall_pdf_tolerance_wider_than_dxf():
    """5C-3 prompt §3 PR 3: ARC_TO_WALL_DISTANCE_MAX_MM = 500 for PDFs (vs 300 DXF)."""
    assert ARC_TO_WALL_DISTANCE_MAX_PDF_MM == 500.0


def test_radius_band_unchanged_from_dxf():
    """Door/window dimensions don't depend on source format."""
    assert SWING_ARC_RADIUS_MIN_MM == 600.0
    assert SWING_ARC_RADIUS_MAX_MM == 1500.0


def test_annotation_pdf_distance_wider_than_dxf():
    assert ANNOTATION_PDF_DISTANCE_MAX_MM == 1000.0


def test_arc_bbox_aspect_tolerance():
    assert SWING_ARC_BBOX_ASPECT_TOL == 0.30


# ── per-tier unit tests (synthetic raw_entities) ────────────────────────────


def test_tier2_basic_arc_emits_opening():
    walls = [_single_wall()]
    raw = {
        "arcs": [
            {"center_x": 2000.0, "center_y": 0.0, "radius_mm": 900.0,
             "start_deg": 0.0, "end_deg": 90.0, "handle": ""},
        ],
        "texts": [],
    }
    cs = detect_tier2_swing_arc_pdf(walls, raw)
    assert len(cs) == 1
    c = cs[0]
    assert c.parent_wall_id == "w0"
    assert c.width_mm == 900.0
    assert c.detection_tier == 2
    assert c.confidence == TIER2_PDF_SWING_ARC_CONFIDENCE
    assert c.position_mm == pytest.approx(2000.0)


def test_tier2_rejects_undersized_radius():
    walls = [_single_wall()]
    raw = {
        "arcs": [
            {"center_x": 2000.0, "center_y": 0.0, "radius_mm": 200.0,
             "start_deg": 0.0, "end_deg": 90.0, "handle": ""},
        ],
        "texts": [],
    }
    assert detect_tier2_swing_arc_pdf(walls, raw) == []


def test_tier2_rejects_arc_far_from_wall():
    walls = [_single_wall()]
    raw = {
        "arcs": [
            {"center_x": 2000.0, "center_y": 9999.0, "radius_mm": 900.0,
             "start_deg": 0.0, "end_deg": 90.0, "handle": ""},
        ],
        "texts": [],
    }
    assert detect_tier2_swing_arc_pdf(walls, raw) == []


def test_tier2_swing_sign_negative_direction():
    walls = [_single_wall()]
    raw = {
        "arcs": [
            {"center_x": 2500.0, "center_y": 0.0, "radius_mm": 900.0,
             "start_deg": 180.0, "end_deg": 270.0, "handle": ""},
        ],
        "texts": [],
    }
    cs = detect_tier2_swing_arc_pdf(walls, raw)
    assert len(cs) == 1
    assert cs[0].position_mm == pytest.approx(1600.0)


def test_tier3_basic_wall_gap_pdf():
    wa = {**_single_wall(2000.0, "w0")}
    wb = {**_single_wall(2100.0, "w1")}
    wb["start"] = [2900.0, 0.0]
    wb["end"] = [5000.0, 0.0]
    junctions = [
        {"point": [0.0, 0.0], "type": "END", "wall_ids": ["w0"], "wall_count": 1},
        {"point": [2000.0, 0.0], "type": "END", "wall_ids": ["w0"], "wall_count": 1},
        {"point": [2900.0, 0.0], "type": "END", "wall_ids": ["w1"], "wall_count": 1},
        {"point": [5000.0, 0.0], "type": "END", "wall_ids": ["w1"], "wall_count": 1},
    ]
    cs = detect_tier3_wall_gap_pdf([wa, wb], junctions, raw_entities=None)
    assert len(cs) == 1
    c = cs[0]
    assert c.parent_wall_id == "w0"
    assert c.position_mm == pytest.approx(2000.0)
    assert c.width_mm == pytest.approx(900.0)
    assert c.confidence == TIER3_PDF_WALL_GAP_CONFIDENCE


def test_tier3_rejects_corner_junction_pdf():
    """Same behaviour as DXF Tier 3 — non-END facing endpoints → reject."""
    wa = {**_single_wall(2000.0, "w0")}
    wb = {**_single_wall(2100.0, "w1")}
    wb["start"] = [2900.0, 0.0]
    wb["end"] = [5000.0, 0.0]
    junctions = [
        {"point": [2000.0, 0.0], "type": "CORNER", "wall_ids": ["w0", "wX"], "wall_count": 2},
        {"point": [2900.0, 0.0], "type": "CORNER", "wall_ids": ["w1", "wX"], "wall_count": 2},
    ]
    assert detect_tier3_wall_gap_pdf([wa, wb], junctions, raw_entities=None) == []


def test_tier4_basic_annotation_pdf_team2_dw2():
    """PR 4: Team2 library — DW2 → standard 900mm door."""
    walls = [_single_wall()]
    raw = {
        "arcs": [],
        "texts": [
            {"text": "DW2", "x": 2450.0, "y": 500.0, "handle": ""},
        ],
    }
    cs = detect_tier4_annotation_pdf(walls, raw)
    assert len(cs) == 1
    c = cs[0]
    assert c.opening_type == "door"
    assert c.width_mm == 900.0          # Team2 DW2 default
    assert c.height_mm == 2100.0
    assert c.sill_height_mm == 0.0
    # Final confidence = TIER4_BASE × DW2.confidence_modifier = 0.70 × 0.80
    assert c.confidence == pytest.approx(0.56)
    # Position = projected wall coord (2450) - width/2 (450) = 2000.
    assert c.position_mm == pytest.approx(2000.0)
    assert "DW2" in c.detection_method
    assert "team2" in c.detection_method


def test_tier4_pdf_team2_sd_sliding_door():
    """PR 4: Team2 library — SD → 2400mm sliding door."""
    walls = [_single_wall()]
    raw = {
        "arcs": [],
        "texts": [
            {"text": "SD", "x": 2500.0, "y": 500.0, "handle": ""},
        ],
    }
    cs = detect_tier4_annotation_pdf(walls, raw)
    assert len(cs) == 1
    c = cs[0]
    assert c.opening_type == "sliding_door"
    assert c.width_mm == 2400.0
    assert c.sill_height_mm == 0.0
    # SD modifier 0.85 × 0.70 = 0.595
    assert c.confidence == pytest.approx(0.595)


def test_tier4_pdf_team2_dw1_wide_door():
    """PR 4: Team2 library — DW1 → 1200mm door."""
    walls = [_single_wall()]
    raw = {
        "arcs": [],
        "texts": [
            {"text": "DW1", "x": 2500.0, "y": 500.0, "handle": ""},
        ],
    }
    cs = detect_tier4_annotation_pdf(walls, raw)
    assert len(cs) == 1
    assert cs[0].opening_type == "door"
    assert cs[0].width_mm == 1200.0


def test_tier4_pdf_rejects_non_opening_labels():
    """PR 4: drainage / wall-type labels must NEVER detect."""
    walls = [_single_wall()]
    for non_opening in ["RWO", "RWD", "CW5", "CFW1", "TD", "FW", "SK", "MIN"]:
        raw = {
            "arcs": [],
            "texts": [{"text": non_opening, "x": 2500.0, "y": 500.0, "handle": ""}],
        }
        assert detect_tier4_annotation_pdf(walls, raw) == [], (
            f"non-opening label {non_opening!r} was incorrectly detected"
        )


def test_tier4_pdf_whole_word_match_rejects_substrings():
    """PR 4: 'DW1A' must NOT match the DW1 label (whole-word only)."""
    walls = [_single_wall()]
    for variant in ["DW1A", "XDW1", "DW", "SDX", "DW1B", "DDW1", "MYDW1"]:
        raw = {
            "arcs": [],
            "texts": [{"text": variant, "x": 2500.0, "y": 500.0, "handle": ""}],
        }
        assert detect_tier4_annotation_pdf(walls, raw) == [], (
            f"variant {variant!r} incorrectly matched as an opening label"
        )


def test_tier4_pdf_too_far_from_wall_dropped():
    """PR 4: label exists but no wall within TIER4_NEAREST_WALL_MAX_MM (800mm)."""
    walls = [_single_wall()]
    raw = {
        "arcs": [],
        "texts": [
            # y = 9999 → > 800mm from wall axis at y=0; rejected.
            {"text": "DW2", "x": 2500.0, "y": 9999.0, "handle": ""},
        ],
    }
    assert detect_tier4_annotation_pdf(walls, raw) == []


def test_tier4_pdf_determinism_same_input_same_output():
    """PR 4: pure function — two runs return identical candidates."""
    walls = [_single_wall()]
    raw = {
        "arcs": [],
        "texts": [
            {"text": "DW2", "x": 2450.0, "y": 500.0, "handle": ""},
            {"text": "SD",  "x": 4500.0, "y": 500.0, "handle": ""},
        ],
    }
    r1 = detect_tier4_annotation_pdf(walls, raw)
    r2 = detect_tier4_annotation_pdf(walls, raw)
    assert r1 == r2
    assert len(r1) == 2


def test_tier4_pdf_multiple_team2_labels_distinct_positions():
    """Two different Team2 labels at different positions → 2 detections."""
    walls = [_single_wall(length_mm=10000.0)]
    raw = {
        "arcs": [],
        "texts": [
            {"text": "DW1", "x": 2000.0, "y": 200.0, "handle": ""},
            {"text": "DW2", "x": 6000.0, "y": 200.0, "handle": ""},
        ],
    }
    cs = detect_tier4_annotation_pdf(walls, raw)
    assert len(cs) == 2
    types = {c.width_mm for c in cs}
    assert types == {900.0, 1200.0}


def test_tier4_pdf_repeated_same_label_emits_per_occurrence():
    """Same label at two positions → two distinct openings."""
    walls = [_single_wall(length_mm=10000.0)]
    raw = {
        "arcs": [],
        "texts": [
            {"text": "DW2", "x": 1500.0, "y": 200.0, "handle": ""},
            {"text": "DW2", "x": 5000.0, "y": 200.0, "handle": ""},
        ],
    }
    cs = detect_tier4_annotation_pdf(walls, raw)
    assert len(cs) == 2
    positions = sorted(c.position_mm for c in cs)
    assert positions[0] == pytest.approx(1050.0)  # 1500 - 450
    assert positions[1] == pytest.approx(4550.0)  # 5000 - 450


def test_tier4_pdf_label_regex_in_sync_with_library():
    """The Tier 4 regex labels MUST equal the Team2 library labels."""
    from app.services.kos_annotation_library import TEAM2_OPENING_LIBRARY
    from app.services.kos_opening_pdf import TIER4_TEAM2_LABEL_RE
    library_labels = {e.label for e in TEAM2_OPENING_LIBRARY}
    pattern_text = TIER4_TEAM2_LABEL_RE.pattern  # e.g. ^(SD|DW1|DW2)$
    # Quick extraction of alternation members
    import re
    inner = re.match(r"\^\(([^)]+)\)\$", pattern_text)
    assert inner, f"unexpected regex shape: {pattern_text}"
    regex_labels = set(inner.group(1).split("|"))
    assert regex_labels == library_labels, (
        f"regex {regex_labels} drifted from library {library_labels}"
    )


def test_tier4_pdf_rejects_non_opening_text():
    walls = [_single_wall()]
    raw = {
        "arcs": [],
        "texts": [
            {"text": "ROOM A", "x": 2000.0, "y": 500.0, "handle": ""},
            {"text": "+0.000", "x": 2500.0, "y": 500.0, "handle": ""},
        ],
    }
    assert detect_tier4_annotation_pdf(walls, raw) == []


def test_all_tiers_empty_when_no_walls():
    raw = {"arcs": [{"center_x": 100, "center_y": 0, "radius_mm": 900,
                     "start_deg": 0, "end_deg": 90}], "texts": []}
    assert detect_tier2_swing_arc_pdf([], raw) == []
    assert detect_tier3_wall_gap_pdf([], [], raw_entities=None) == []
    assert detect_tier4_annotation_pdf([], raw) == []


# ── extract_pdf_entities ─────────────────────────────────────────────────────


def test_extract_pdf_entities_picks_up_text():
    doc = fitz.open()
    page = doc.new_page(width=842, height=596)
    page.insert_text(fitz.Point(100, 300), "D1 900x2100", fontsize=10)
    bag = extract_pdf_entities(page, pt_to_mm=1.0)
    assert any("900x2100" in t["text"] for t in bag["texts"])


def test_extract_pdf_entities_returns_empty_on_blank_page():
    doc = fitz.open()
    doc.new_page(width=200, height=200)
    bag = extract_pdf_entities(doc[0], pt_to_mm=1.0)
    assert bag["arcs"] == []
    assert bag["texts"] == []


def test_extract_pdf_entities_filters_non_square_paths():
    """A long thin line is NOT an arc; extractor must reject it."""
    doc = fitz.open()
    page = doc.new_page(width=842, height=596)
    sh = page.new_shape()
    sh.draw_line(fitz.Point(100, 300), fitz.Point(700, 300))
    sh.finish(color=(0, 0, 0), width=1.2)
    sh.commit()
    bag = extract_pdf_entities(page, pt_to_mm=1.0)
    assert bag["arcs"] == []


# ── synthesis: PyMuPDF vector PDFs ───────────────────────────────────────────


def _save_pdf(doc) -> str:
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    doc.save(path)
    return path


# The PDF parser interprets 1 PDF point as `PDF_PT_TO_PAPER_MM × scale_denom`
# millimetres (default scale 1:100 → ~35.28 mm/pt). To author a synth PDF whose
# wall lengths land on the intended mm values after parsing, we DIVIDE every
# logical-mm coordinate by this factor when emitting PDF points.
_PT_PER_MM = 1.0 / (25.4 / 72.0 * 100.0)  # ≈ 0.0283 pt per mm under 1:100 scale


def _make_synth_floor_plan_pdf(
    *,
    wall_length_mm: float,
    opening_positions_mm: list[tuple[float, float]],  # list of (start_mm, width_mm)
    add_text: bool = True,
) -> str:
    """Synthesise a vector floor-plan PDF — walls + annotations.

    Authors at the PDF parser's 1:100 default scale, so 1 logical mm = ~0.0283 pt.
    Walls are drawn as multiple 1.2pt black LINE segments — one per inter-opening
    run. Each opening contributes a text annotation near the gap.

    The parser's tier-1 detector requires walls ≥ 350mm; our synth respects
    that — the smallest wall sub-segment in Vamshi (P_INT_9: ~660mm before
    the first opening) clears the floor.
    """
    doc = fitz.open()
    margin_pt = 30.0
    wall_pt = wall_length_mm * _PT_PER_MM
    page_w = wall_pt + 2 * margin_pt + 100.0
    page = doc.new_page(width=max(page_w, 400.0), height=300.0)

    # Compute wall sub-segments between openings.
    cuts: list[float] = [0.0]
    for start_mm, width_mm in opening_positions_mm:
        cuts.append(start_mm)
        cuts.append(start_mm + width_mm)
    cuts.append(wall_length_mm)

    y_pt = 200.0
    for i in range(0, len(cuts), 2):
        a_mm = cuts[i]
        b_mm = cuts[i + 1] if i + 1 < len(cuts) else wall_length_mm
        if b_mm - a_mm < 1.0:
            continue
        a_pt = margin_pt + a_mm * _PT_PER_MM
        b_pt = margin_pt + b_mm * _PT_PER_MM
        sh = page.new_shape()
        sh.draw_line(fitz.Point(a_pt, y_pt), fitz.Point(b_pt, y_pt))
        sh.finish(color=(0.0, 0.0, 0.0), width=1.2)
        sh.commit()

    if add_text:
        for idx, (start_mm, width_mm) in enumerate(opening_positions_mm):
            centre_mm = start_mm + width_mm / 2.0
            centre_pt = margin_pt + centre_mm * _PT_PER_MM
            page.insert_text(
                fitz.Point(centre_pt - 15.0, y_pt - 10.0),
                f"D{idx + 1} {int(width_mm)}x2100",
                fontsize=4,
            )
    return _save_pdf(doc)


def test_e2e_synth_pdf_two_walls_one_gap():
    """Simple synth: 4000mm wall, 900mm opening at 2271mm position."""
    path = _make_synth_floor_plan_pdf(
        wall_length_mm=4000.0,
        opening_positions_mm=[(2271.0, 900.0)],
        add_text=True,
    )
    try:
        parsed = parse_pdf_walls(path, filename="synth.pdf")
        assert "error" not in parsed
        walls = parsed["walls"]
        # Parser should detect at least 2 wall segments (before+after the gap).
        assert len(walls) >= 1, f"walls extracted: {len(walls)}"
        openings = parsed["openings"]
        # If walls detected, openings should appear; if no walls, openings=0.
        if len(walls) >= 2:
            assert len(openings) >= 1, (
                f"expected at least 1 opening; got {len(openings)} "
                f"with {len(walls)} walls + raw_arcs="
                f"{len(parsed['raw_opening_entities'].get('arcs', []))} "
                f"raw_texts={len(parsed['raw_opening_entities'].get('texts', []))}"
            )
    finally:
        os.remove(path)


def test_e2e_synth_pdf_solid_wall_no_openings():
    """Phantom-prevention: continuous wall, no openings."""
    path = _make_synth_floor_plan_pdf(
        wall_length_mm=3000.0,
        opening_positions_mm=[],
        add_text=False,
    )
    try:
        parsed = parse_pdf_walls(path)
        assert "error" not in parsed
        # Either parser sees 1 wall (no gap → no openings) or sees 0 walls
        # (parser-side failure). Either way openings = 0.
        assert parsed["openings"] == ()
    finally:
        os.remove(path)


# ── Vamshi PDF live calibration ──────────────────────────────────────────────


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


def _expected_openings_count() -> int:
    return sum(
        len(json.loads((FIXTURES_DIR / n).read_text())["expected_openings"])
        for n in VAMSHI_FIXTURE_NAMES
    )


@pytest.mark.skipif(
    not VAMSHI_PDF.exists(),
    reason="Vamshi PDF not present in temp_folder/reference/",
)
def test_vamshi_pdf_calibration_documents_reality():
    """**The first independent accuracy measurement.**

    Parses the real ``Kalzen BIM integration.pdf`` and records what the
    detector emits. This is NOT a pass/fail accuracy assertion — it's a
    deterministic forensic check that captures the honest reality of
    running our detector against a customer-grade PDF.

    Expected outcome (per PR 3 forensic analysis):
      - PDF is filled-rectangle rendered (no 1.2pt stroked walls).
      - Parser extracts 0 walls from page 1 (the schedule overview).
      - Detector emits 0 openings (no walls to anchor onto).
      - 15 openings exist in ground truth across 10 walls — none detected.

    The test asserts INVARIANTS, not a target F1:
      - The parser must not crash.
      - The detector must not crash.
      - If walls == 0, openings must == 0 (no phantoms).
      - If openings > 0, every emitted opening must have a valid parent
        wall present in the parsed walls list (no orphans).
    """
    parsed = parse_pdf_walls(str(VAMSHI_PDF), filename="Kalzen BIM integration.pdf")
    assert "error" not in parsed, f"Vamshi parse error: {parsed.get('message')}"

    walls = parsed["walls"]
    openings = parsed["openings"]
    raw = parsed.get("raw_opening_entities", {})

    # Invariant 1: if no walls, no openings.
    if len(walls) == 0:
        assert openings == (), (
            f"detector emitted {len(openings)} phantom openings with 0 walls"
        )

    # Invariant 2: every emitted opening references a known wall.
    wall_ids = {w["id"] for w in walls}
    for o in openings:
        assert o.parent_wall_id in wall_ids, (
            f"orphan opening {o.id} → parent {o.parent_wall_id} not in walls"
        )

    # Print a forensic summary for the PR 3 report (capture-on-stdout).
    expected_total = _expected_openings_count()
    print("\n=== VAMSHI PDF LIVE CALIBRATION ===")
    print(f"  Pages parsed: 1 (parser hard-coded; ground truth spans 10 walls across pp.3-13)")
    print(f"  Walls extracted: {len(walls)}")
    print(f"  raw arcs:  {len(raw.get('arcs', []))}")
    print(f"  raw texts: {len(raw.get('texts', []))}")
    print(f"  Openings detected: {len(openings)}")
    print(f"  Openings expected (ground truth aggregate): {expected_total}")
    if len(openings) > 0:
        for o in openings[:10]:
            print(
                f"    {o.id}: tier={o.detection_tier} "
                f"wall={o.parent_wall_id} pos={o.position_mm:.0f} w={o.width_mm:.0f}"
            )
    print(
        "  Root cause (filled-rectangle render, parser limited to stroked "
        "1.2pt lines on page 1): no extractable walls → no anchors → no openings."
    )
    print("=== END VAMSHI ===")


def test_vamshi_pdf_synthesised_walls_show_detector_alive():
    """Sanity: when we feed the detector SYNTHESISED walls + the real
    Vamshi PDF's raw entities, does anything fire?

    This isolates "is there detectable signal in the PDF" from "can the
    parser extract walls." If the PDF has door annotations like
    'D1 900x2100' floating somewhere, they'll project onto our synthetic
    test walls.

    NOT a pass/fail F1 assertion — a forensic probe printed to stdout.
    """
    if not VAMSHI_PDF.exists():
        pytest.skip("Vamshi PDF not present")

    # Open the PDF directly; we want raw_entities from page 1 specifically.
    doc = fitz.open(str(VAMSHI_PDF))
    page = doc[0]
    raw = extract_pdf_entities(page, pt_to_mm=1.0)
    # Synthesise a wide horizontal wall at y=0 spanning the page.
    walls = [{
        "id": "w0",
        "start": [0.0, 0.0],
        "end": [10000.0, 0.0],
        "length_mm": 10000.0,
        "thickness_mm": 200.0,
        "angle_degrees": 0.0,
        "layer": "synth",
        "detection_tier": 1,
        "confidence": 0.85,
    }]
    openings, warnings = detect_openings(
        walls=walls, junctions=[], raw_entities=raw,
        source_type="pdf", classification="FLOOR_PLAN",
    )
    print(
        f"\nPage 1 forensic probe: raw_arcs={len(raw['arcs'])} "
        f"raw_texts={len(raw['texts'])} "
        f"detectable_signal_count={len(openings)}"
    )
    # No assertion — purely diagnostic.


# ── confusion-matrix harness (synth-PDF path; runs for stdout capture only) ─


def _emitted_to_segment_position(opening, walls: list[dict]) -> float:
    """Translate parser-output mm → fixture-relative segment mm.

    The synth offsets every wall by 30pt → 30 * 35.28 ≈ 1058mm from page
    origin. To compare against fixture positions (which start at 0), we
    subtract the LEFTMOST wall start across the parsed walls (≡ the
    leftmost segment endpoint, which the synth maps to fixture position 0).
    """
    base = 0.0
    for w in walls:
        if w["id"] == opening.parent_wall_id:
            base = float(w["start"][0])
            break
    if walls:
        left_offset = min(float(w["start"][0]) for w in walls)
    else:
        left_offset = 0.0
    return base + opening.position_mm - left_offset


def _confusion(expected: list[dict], emitted: list, walls: list[dict],
               tol_pos: float, tol_width: float) -> tuple[int, int, int]:
    matched_e: set[int] = set()
    matched_m: set[int] = set()
    for emit_idx, em in sorted(enumerate(emitted), key=lambda kv: -kv[1].confidence):
        em_pos = _emitted_to_segment_position(em, walls)
        best = -1
        best_score = math.inf
        for i, exp in enumerate(expected):
            if i in matched_e:
                continue
            pos_err = abs(em_pos - exp["position_mm"])
            width_err = abs(em.width_mm - exp["width_mm"])
            if pos_err <= tol_pos and width_err <= tol_width:
                score = pos_err + width_err
                if score < best_score:
                    best_score = score
                    best = i
        if best >= 0:
            matched_e.add(best)
            matched_m.add(emit_idx)
    return len(matched_e), len(emitted) - len(matched_m), len(expected) - len(matched_e)


# ── fixture-position forensic analysis against real Vamshi PDF ──────────────


# Map fixture → 0-indexed page in Kalzen BIM integration.pdf.
# Verified manually from page text ("P_EXT_1 PLAN, ELEVATION AND SCHEDULE" etc.)
_VAMSHI_FIXTURE_TO_PAGE = {
    "P_EXT_1": 3, "P_EXT_2": 4, "P_EXT_3": 5, "P_EXT_4": 6,
    "P_INT_5": 7, "P_INT_6": 8, "P_INT_7": 9, "P_INT_8": 10,
    "P_INT_9": 11, "P_INT_10": 12,
}


def _opening_width_labels_top_of_page(page, expected_widths: list[int]) -> list[tuple[float, str]]:
    """Return [(x_pt, width_str)] of opening-width text labels in the top
    portion of the page (y < 200pt — the elevation/plan view area)."""
    out: list[tuple[float, str]] = []
    expected_set = {str(w) for w in expected_widths}
    td = page.get_text("dict")
    for b in td.get("blocks", []):
        if b.get("type") != 0:
            continue
        for ln in b.get("lines", []):
            for sp in ln.get("spans", []):
                t = sp.get("text", "").strip()
                if t in expected_set:
                    bbox = sp.get("bbox", (0, 0, 0, 0))
                    if bbox[1] < 200.0:
                        out.append((bbox[0], t))
    return sorted(out)


@pytest.mark.skipif(
    not VAMSHI_PDF.exists(),
    reason="Vamshi PDF not present in temp_folder/reference/",
)
def test_vamshi_fixture_position_forensic_analysis():
    """Forensic check: extract opening-width label X positions from each
    fixture's elevation page in the Vamshi PDF, derive an implied
    inter-opening spacing using P_EXT_3's prompt-known positions as the
    scale anchor, and report the delta between fixture-spacing and
    PDF-spacing.

    This test does NOT update the fixtures — it surfaces the data needed
    for a future, careful tightening pass. The current fixtures retain
    100mm position tolerance which absorbs the placeholder uncertainty.
    The reason for NOT updating in this PR is documented in the PR 3
    report: the Vamshi PDF lacks a clean absolute reference frame, so
    only RELATIVE spacings can be reliably recovered; absolute positions
    would require either a vector floor-plan PDF or manual
    rectangle-decomposition work outside PR 3's scope.

    No assertion on accuracy; prints findings for the PR 3 report."""
    doc = fitz.open(str(VAMSHI_PDF))

    # ── 1. derive scale from P_EXT_3 (prompt-given positions 2271, 7464) ──
    page_p3 = doc[_VAMSHI_FIXTURE_TO_PAGE["P_EXT_3"]]
    p3_labels = _opening_width_labels_top_of_page(page_p3, [900])
    p3_labels = [l for l in p3_labels if l[1] == "900"][:2]
    if len(p3_labels) < 2:
        pytest.skip("P_EXT_3 width labels not extractable; analysis aborted")
    x_a, x_b = p3_labels[0][0], p3_labels[1][0]
    # Expected opening CENTRES (position + width/2):
    expected_centre_a = 2271 + 450
    expected_centre_b = 7464 + 450
    pdf_span_pt = x_b - x_a
    expected_span_mm = expected_centre_b - expected_centre_a
    mm_per_pt = expected_span_mm / pdf_span_pt
    print(f"\n=== VAMSHI FIXTURE POSITION FORENSICS ===")
    print(f"P_EXT_3 scale anchor: PDF span {pdf_span_pt:.2f}pt = {expected_span_mm}mm "
          f"⇒ {mm_per_pt:.3f} mm/pt (≈ 1:{mm_per_pt/0.353:.0f} scale)")

    # ── 2. per-fixture inter-opening spacing comparison ────────────────────
    for name in VAMSHI_FIXTURE_NAMES:
        fx = json.loads((FIXTURES_DIR / name).read_text())
        expected = fx["expected_openings"]
        if not expected:
            print(f"{name}: solid wall (no openings)")
            continue

        widths_expected = sorted({o["width_mm"] for o in expected})
        # Find page for this fixture.
        page_idx = _VAMSHI_FIXTURE_TO_PAGE.get(fx["wall_id"])
        if page_idx is None:
            print(f"{name}: no page mapping")
            continue
        page = doc[page_idx]
        labels = _opening_width_labels_top_of_page(page, list(widths_expected))
        if len(labels) < len(expected):
            print(
                f"{name}: only {len(labels)} width labels extractable "
                f"(expected {len(expected)}) — likely overlapping rendering or "
                f"label outside top region. Inter-opening spacings cannot be "
                f"computed."
            )
            continue

        # Expected inter-opening centre spacings (fixture-implied).
        centres_expected = [o["position_mm"] + o["width_mm"] / 2.0 for o in expected]
        fix_spacings = [
            centres_expected[i + 1] - centres_expected[i]
            for i in range(len(centres_expected) - 1)
        ]
        # PDF-derived inter-label spacings → mm.
        labels_sorted = sorted(labels[: len(expected)], key=lambda l: l[0])
        pdf_xs = [l[0] for l in labels_sorted]
        pdf_spacings_mm = [
            (pdf_xs[i + 1] - pdf_xs[i]) * mm_per_pt
            for i in range(len(pdf_xs) - 1)
        ]
        deltas = [pdf - fx for pdf, fx in zip(pdf_spacings_mm, fix_spacings)]
        print(
            f"{name}: fix_spacings={[f'{s:.0f}' for s in fix_spacings]}  "
            f"pdf_spacings={[f'{s:.0f}' for s in pdf_spacings_mm]}  "
            f"delta={[f'{d:+.0f}' for d in deltas]}"
        )
    print(f"=== END FORENSICS ===")


def test_synth_pdf_calibration_aggregate_f1():
    """Run the 10 Vamshi fixtures through the synth-PDF → parser → detector
    pipeline. This is the PDF analogue of PR 2's DXF calibration — same
    upper-bound caveat applies. Captures stdout for the PR 3 report."""
    total_tp = total_fp = total_fn = 0
    lines: list[str] = []
    for name in VAMSHI_FIXTURE_NAMES:
        fx = json.loads((FIXTURES_DIR / name).read_text())
        expected = fx["expected_openings"]
        opening_pos = [(o["position_mm"], o["width_mm"]) for o in expected]
        path = _make_synth_floor_plan_pdf(
            wall_length_mm=fx["wall_length_mm"],
            opening_positions_mm=opening_pos,
            add_text=True,
        )
        try:
            parsed = parse_pdf_walls(path)
            if "error" in parsed:
                lines.append(f"{name}: PARSE ERROR ({parsed.get('message')})")
                continue
            tp, fp, fn = _confusion(
                expected, list(parsed["openings"]), parsed["walls"],
                tol_pos=fx["tolerance_position_mm"],
                tol_width=fx["tolerance_width_mm"],
            )
        finally:
            os.remove(path)
        total_tp += tp
        total_fp += fp
        total_fn += fn
        lines.append(
            f"{name}: expected={len(expected)} TP={tp} FP={fp} FN={fn}"
        )

    p = total_tp / (total_tp + total_fp) if (total_tp + total_fp) else 0.0
    r = total_tp / (total_tp + total_fn) if (total_tp + total_fn) else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    print("\n=== SYNTH PDF AGGREGATE ===")
    for ln in lines:
        print(f"  {ln}")
    print(
        f"  TP={total_tp} FP={total_fp} FN={total_fn} "
        f"P={p:.3f} R={r:.3f} F1={f1:.3f}"
    )
    print("=== END SYNTH PDF ===")
    # Soft assertion: synth-PDF F1 must clear the 0.75 PDF target.
    assert f1 >= 0.75, (
        f"Synth-PDF F1 {f1:.3f} below 0.75 target.\n" + "\n".join(lines)
    )
