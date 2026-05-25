"""KOS Phase 5C-3 PR 2 — DXF opening detection tests + Vamshi calibration.

Three concerns:

1. Per-tier unit tests — each detector exercised in isolation.
2. Tier integration — synthesised DXFs with all four signals, run through
   the full parser → orchestrator pipeline, expect deduplicated openings.
3. Vamshi calibration — synthesise a DXF per Vamshi fixture, run the
   detector, aggregate precision / recall / F1 across the 10-fixture set.
   Target ≥ 0.90 F1 (5C-3 prompt §3 PR 2).

Synthesised DXFs are hermetic (built in-memory with ezdxf, saved to a
tempfile, parsed back via parse_dxf_walls). We DON'T have Vamshi's original
DWG; the synthesiser reconstructs the geometry implied by the Vamshi
panel-schedule sheets per 5C-3 prompt §1.3.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from pathlib import Path

import ezdxf
import pytest

from app.services.kos_dxf_parser import parse_dxf_walls
from app.services.kos_opening_detector import detect_openings
from app.services.kos_opening_dxf import (
    ANNOTATION_TEXT_DISTANCE_MAX_MM,
    ARC_TO_WALL_DISTANCE_MAX_MM,
    BLOCK_NAME_REGEX,
    LAYER_NAME_REGEX,
    SWING_ARC_RADIUS_MAX_MM,
    SWING_ARC_RADIUS_MIN_MM,
    SWING_ARC_SWEEP_TARGET_DEG,
    SWING_ARC_SWEEP_TOL_DEG,
    TIER1_BLOCK_CONFIDENCE,
    TIER2_SWING_ARC_CONFIDENCE,
    TIER3_COLLINEAR_PERP_TOL_MM,
    TIER3_WALL_GAP_CONFIDENCE,
    TIER3_WORLD_CENTRE_DEDUPE_MM,
    TIER4_ANNOTATION_CONFIDENCE,
    detect_tier1_block_reference,
    detect_tier2_swing_arc_dxf,
    detect_tier3_wall_gap_dxf,
    detect_tier4_annotation_dxf,
    extract_dxf_entities,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "openings"


# ── DXF synthesiser helpers ──────────────────────────────────────────────────


def _save(doc) -> str:
    fd, path = tempfile.mkstemp(suffix=".dxf")
    os.close(fd)
    doc.saveas(path)
    return path


def _ensure_door_block(doc, width: int) -> str:
    """Create or fetch a door block named e.g. "door900".

    Block has a trivial LINE so ezdxf accepts the definition; the INSERT
    that references it is what tier 1 picks up. Width baked into the name
    so tier 1 can extract it.
    """
    name = f"door{width}"
    if name not in doc.blocks:
        blk = doc.blocks.new(name=name)
        blk.add_line((0, 0), (float(width), 0))
    return name


def _ensure_layers(doc) -> None:
    for layer in ("A-WALL", "A-DOOR", "A-ANNO"):
        if layer not in doc.layers:
            doc.layers.add(layer)


def _make_synthetic_wall_with_openings(
    *,
    wall_length_mm: float,
    openings: list[dict],
    include_tier1: bool = True,
    include_tier2: bool = True,
    include_tier4: bool = True,
    wall_thickness_mm: float = 200.0,
) -> str:
    """Build an in-memory DXF for ONE wall and write to a tempfile.

    The wall runs from (0, 0) to (wall_length, 0) on layer A-WALL with a
    parallel companion at y = -wall_thickness so the parser's thickness
    enrichment pass sees a 200mm wall. Each opening contributes:

      - Tier 1: INSERT of "door{width}" block at (opening_start, 0) on A-DOOR.
      - Tier 2: ARC centred (opening_start, 0), radius = width, 0°..90° on A-DOOR.
      - Tier 4: TEXT "D{i} {width}x2100" at (opening_centre, +500) on A-ANNO.

    Walls are authored as N+1 short LINEs (one per inter-opening run), so the
    parser sees END junctions at each jamb — feeds Tier 3 wall-gap detection.
    """
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4  # millimetres — kills the "assumed mm" warning
    msp = doc.modelspace()
    _ensure_layers(doc)

    # Determine wall-segment cuts between openings.
    cuts: list[float] = [0.0]
    for op in openings:
        cuts.append(op["position_mm"])
        cuts.append(op["position_mm"] + op["width_mm"])
    cuts.append(wall_length_mm)

    # Author wall lines as (cuts[0]..cuts[1]), (cuts[2]..cuts[3]), ...
    # i.e. even-indexed pairs are wall segments; odd-indexed pairs are
    # opening gaps.
    for i in range(0, len(cuts), 2):
        a = cuts[i]
        b = cuts[i + 1] if i + 1 < len(cuts) else wall_length_mm
        if b - a < 1.0:
            continue
        # Top axis line (the wall's centreline by Tier 1 detector convention).
        msp.add_line((a, 0.0), (b, 0.0), dxfattribs={"layer": "A-WALL"})
        # Parallel companion at y = -thickness (gives the parser a wall
        # thickness via the enrichment pass).
        msp.add_line(
            (a, -wall_thickness_mm),
            (b, -wall_thickness_mm),
            dxfattribs={"layer": "A-WALL"},
        )

    # Tier signals per opening.
    for idx, op in enumerate(openings):
        w = int(op["width_mm"])
        pos = float(op["position_mm"])
        centre = pos + w / 2.0

        if include_tier1:
            block_name = _ensure_door_block(doc, w)
            msp.add_blockref(
                block_name,
                insert=(pos, 0.0),
                dxfattribs={"layer": "A-DOOR"},
            )

        if include_tier2:
            # Door swing arc: centred at hinge (= opening start), 90° sweep.
            msp.add_arc(
                center=(pos, 0.0),
                radius=float(w),
                start_angle=0.0,
                end_angle=90.0,
                dxfattribs={"layer": "A-DOOR"},
            )

        if include_tier4:
            label = f"D{idx + 1} {w}x{int(op.get('height_mm', 2100))}"
            text = msp.add_text(label, dxfattribs={"layer": "A-ANNO"})
            text.set_placement((centre, 500.0))

    return _save(doc)


def _make_synthetic_solid_wall(wall_length_mm: float) -> str:
    """Build a solid wall with no openings — phantom-prevention anchor."""
    return _make_synthetic_wall_with_openings(
        wall_length_mm=wall_length_mm,
        openings=[],
        include_tier1=False,
        include_tier2=False,
        include_tier4=False,
    )


# ── per-tier unit tests ──────────────────────────────────────────────────────


def _single_wall_dict(length_mm: float = 5000.0, wid: str = "w0") -> dict:
    return {
        "id": wid,
        "start": [0.0, 0.0],
        "end": [length_mm, 0.0],
        "length_mm": length_mm,
        "thickness_mm": 200.0,
        "angle_degrees": 0.0,
        "layer": "A-WALL",
        "detection_tier": 1,
        "confidence": 0.85,
    }


# Tier 1


def test_tier1_block_name_door_matches():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [
            {"block_name": "door900", "layer": "0",
             "x": 2000.0, "y": 0.0, "rotation_deg": 0.0, "handle": "ABC"},
        ],
        "arcs": [], "texts": [],
    }
    cs = detect_tier1_block_reference(walls, raw)
    assert len(cs) == 1
    c = cs[0]
    assert c.opening_type == "door"
    assert c.parent_wall_id == "w0"
    assert c.position_mm == pytest.approx(2000.0)
    assert c.width_mm == 900.0
    assert c.confidence == TIER1_BLOCK_CONFIDENCE
    assert c.detection_tier == 1


def test_tier1_window_block_emits_window():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [
            {"block_name": "WIN1500", "layer": "0",
             "x": 2000.0, "y": 0.0, "rotation_deg": 0.0, "handle": ""},
        ],
        "arcs": [], "texts": [],
    }
    cs = detect_tier1_block_reference(walls, raw)
    assert len(cs) == 1
    assert cs[0].opening_type == "window"
    assert cs[0].sill_height_mm > 0
    assert cs[0].width_mm == 1500.0


def test_tier1_layer_match_only_no_block_name():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [
            {"block_name": "GENERIC_BLK", "layer": "A-DOOR",
             "x": 2000.0, "y": 0.0, "rotation_deg": 0.0, "handle": ""},
        ],
        "arcs": [], "texts": [],
    }
    cs = detect_tier1_block_reference(walls, raw)
    assert len(cs) == 1
    assert cs[0].opening_type == "door"
    # No width in block name → default door width.
    assert cs[0].width_mm == 900.0


def test_tier1_rejects_non_matching_block():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [
            {"block_name": "COLUMN_B1", "layer": "A-COL",
             "x": 2000.0, "y": 0.0, "rotation_deg": 0.0, "handle": ""},
        ],
        "arcs": [], "texts": [],
    }
    assert detect_tier1_block_reference(walls, raw) == []


def test_tier1_rejects_insert_too_far_from_wall():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [
            {"block_name": "door900", "layer": "A-DOOR",
             "x": 2000.0, "y": 9999.0, "rotation_deg": 0.0, "handle": ""},
        ],
        "arcs": [], "texts": [],
    }
    assert detect_tier1_block_reference(walls, raw) == []


def test_tier1_rejects_implausible_extracted_width():
    """e.g. 'door1' or 'door10000' — width number outside band → default."""
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [
            {"block_name": "door_swing", "layer": "A-DOOR",
             "x": 2000.0, "y": 0.0, "rotation_deg": 0.0, "handle": ""},
        ],
        "arcs": [], "texts": [],
    }
    cs = detect_tier1_block_reference(walls, raw)
    assert len(cs) == 1
    # "swing" has no 3–4 digit number; default to 900.
    assert cs[0].width_mm == 900.0


def test_tier1_empty_inputs():
    assert detect_tier1_block_reference([], None) == []
    assert detect_tier1_block_reference([_single_wall_dict()], None) == []


# Tier 2


def test_tier2_basic_swing_arc():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [], "texts": [],
        "arcs": [
            {"center_x": 2000.0, "center_y": 0.0, "radius_mm": 900.0,
             "start_deg": 0.0, "end_deg": 90.0, "layer": "A-DOOR", "handle": ""},
        ],
    }
    cs = detect_tier2_swing_arc_dxf(walls, raw)
    assert len(cs) == 1
    c = cs[0]
    assert c.parent_wall_id == "w0"
    assert c.width_mm == 900.0
    assert c.detection_tier == 2
    assert c.confidence == TIER2_SWING_ARC_CONFIDENCE
    # start_angle=0 → direction along +x = wall direction → opening starts at hinge.
    assert c.position_mm == pytest.approx(2000.0)


def test_tier2_rejects_off_target_sweep():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [], "texts": [],
        "arcs": [
            {"center_x": 2000.0, "center_y": 0.0, "radius_mm": 900.0,
             "start_deg": 0.0, "end_deg": 45.0, "layer": "A-DOOR", "handle": ""},
        ],
    }
    assert detect_tier2_swing_arc_dxf(walls, raw) == []


def test_tier2_rejects_radius_out_of_band():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [], "texts": [],
        "arcs": [
            {"center_x": 2000.0, "center_y": 0.0, "radius_mm": 200.0,
             "start_deg": 0.0, "end_deg": 90.0, "layer": "A-DOOR", "handle": ""},
        ],
    }
    assert detect_tier2_swing_arc_dxf(walls, raw) == []


def test_tier2_swing_direction_sign_negative():
    """start_angle 180° = arc opens to the LEFT of hinge → position = hinge - radius."""
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [], "texts": [],
        "arcs": [
            {"center_x": 2500.0, "center_y": 0.0, "radius_mm": 900.0,
             "start_deg": 180.0, "end_deg": 270.0, "layer": "A-DOOR", "handle": ""},
        ],
    }
    cs = detect_tier2_swing_arc_dxf(walls, raw)
    assert len(cs) == 1
    assert cs[0].position_mm == pytest.approx(1600.0)
    assert cs[0].width_mm == 900.0


def test_tier2_thresholds_match_prompt():
    assert SWING_ARC_RADIUS_MIN_MM == 600.0
    assert SWING_ARC_RADIUS_MAX_MM == 1500.0
    assert SWING_ARC_SWEEP_TARGET_DEG == 90.0
    assert SWING_ARC_SWEEP_TOL_DEG == 15.0
    assert ARC_TO_WALL_DISTANCE_MAX_MM == 300.0


# Tier 3


def test_tier3_basic_wall_gap():
    """Two collinear walls with a 900mm gap = one opening."""
    wa = {
        "id": "w0", "start": [0.0, 0.0], "end": [2000.0, 0.0],
        "length_mm": 2000.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    wb = {
        "id": "w1", "start": [2900.0, 0.0], "end": [5000.0, 0.0],
        "length_mm": 2100.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    junctions = [
        {"point": [0.0, 0.0], "type": "END", "wall_ids": ["w0"], "wall_count": 1},
        {"point": [2000.0, 0.0], "type": "END", "wall_ids": ["w0"], "wall_count": 1},
        {"point": [2900.0, 0.0], "type": "END", "wall_ids": ["w1"], "wall_count": 1},
        {"point": [5000.0, 0.0], "type": "END", "wall_ids": ["w1"], "wall_count": 1},
    ]
    cs = detect_tier3_wall_gap_dxf([wa, wb], junctions, raw_entities=None)
    assert len(cs) == 1
    c = cs[0]
    assert c.parent_wall_id == "w0"
    assert c.position_mm == pytest.approx(2000.0)
    assert c.width_mm == pytest.approx(900.0)
    assert c.detection_tier == 3
    assert c.confidence == TIER3_WALL_GAP_CONFIDENCE


def test_tier3_rejects_non_end_junctions():
    """Two parallel walls with CORNER junctions at the facing endpoints — no opening."""
    wa = {
        "id": "w0", "start": [0.0, 0.0], "end": [2000.0, 0.0],
        "length_mm": 2000.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    wb = {
        "id": "w1", "start": [2900.0, 0.0], "end": [5000.0, 0.0],
        "length_mm": 2100.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    junctions = [
        {"point": [2000.0, 0.0], "type": "CORNER", "wall_ids": ["w0", "wX"], "wall_count": 2},
        {"point": [2900.0, 0.0], "type": "CORNER", "wall_ids": ["w1", "wX"], "wall_count": 2},
    ]
    assert detect_tier3_wall_gap_dxf([wa, wb], junctions, raw_entities=None) == []


def test_tier3_rejects_companion_double_line():
    """Companion line offset by 200mm — must NOT trigger phantom gap."""
    top_wa = {
        "id": "w0", "start": [0.0, 0.0], "end": [2000.0, 0.0],
        "length_mm": 2000.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    bot_wb = {  # companion offset 200mm below
        "id": "w1", "start": [2900.0, -200.0], "end": [5000.0, -200.0],
        "length_mm": 2100.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    junctions = [
        {"point": [2000.0, 0.0], "type": "END", "wall_ids": ["w0"], "wall_count": 1},
        {"point": [2900.0, -200.0], "type": "END", "wall_ids": ["w1"], "wall_count": 1},
    ]
    # Perp distance = 200mm > TIER3_COLLINEAR_PERP_TOL_MM (50mm) → reject.
    assert detect_tier3_wall_gap_dxf([top_wa, bot_wb], junctions, raw_entities=None) == []


def test_tier3_world_centre_dedupe():
    """A double-line wall yields two gap candidates (top + bottom axis); dedupe to 1."""
    top_a = {
        "id": "w0", "start": [0.0, 0.0], "end": [2000.0, 0.0],
        "length_mm": 2000.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    top_b = {
        "id": "w1", "start": [2900.0, 0.0], "end": [5000.0, 0.0],
        "length_mm": 2100.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    # NOTE: tight perp tol rejects cross-axis pairs (200mm offset > 50mm).
    # The dedupe step only kicks in for SAME-axis pairs that produced
    # multiple gap candidates — synthesised here as a duplicate row.
    bot_a = {
        "id": "w2", "start": [0.0, -1.0], "end": [2000.0, -1.0],
        "length_mm": 2000.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    bot_b = {
        "id": "w3", "start": [2900.0, -1.0], "end": [5000.0, -1.0],
        "length_mm": 2100.0, "thickness_mm": 200.0, "angle_degrees": 0.0,
        "layer": "A-WALL", "detection_tier": 1, "confidence": 0.85,
    }
    junctions = [
        {"point": [2000.0, 0.0], "type": "END", "wall_ids": ["w0"], "wall_count": 1},
        {"point": [2900.0, 0.0], "type": "END", "wall_ids": ["w1"], "wall_count": 1},
        {"point": [2000.0, -1.0], "type": "END", "wall_ids": ["w2"], "wall_count": 1},
        {"point": [2900.0, -1.0], "type": "END", "wall_ids": ["w3"], "wall_count": 1},
    ]
    cs = detect_tier3_wall_gap_dxf(
        [top_a, top_b, bot_a, bot_b], junctions, raw_entities=None
    )
    # World-centre dedupe collapses to 1 opening.
    assert len(cs) == 1


def test_tier3_thresholds_match_prompt():
    assert TIER3_COLLINEAR_PERP_TOL_MM == 50.0
    assert TIER3_WORLD_CENTRE_DEDUPE_MM == 200.0


# Tier 4


def test_tier4_basic_text_annotation():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [], "arcs": [],
        "texts": [
            {"text": "D1 900x2100", "x": 2450.0, "y": 500.0,
             "layer": "A-ANNO", "handle": ""},
        ],
    }
    cs = detect_tier4_annotation_dxf(walls, raw)
    assert len(cs) == 1
    c = cs[0]
    assert c.opening_type == "door"
    assert c.width_mm == 900.0
    assert c.height_mm == 2100.0
    assert c.confidence == TIER4_ANNOTATION_CONFIDENCE
    # Centre 2450 - 450 (half-width) = 2000.
    assert c.position_mm == pytest.approx(2000.0)


def test_tier4_window_annotation():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [], "arcs": [],
        "texts": [
            {"text": "W2 1500x1200", "x": 2750.0, "y": 500.0,
             "layer": "A-ANNO", "handle": ""},
        ],
    }
    cs = detect_tier4_annotation_dxf(walls, raw)
    assert len(cs) == 1
    assert cs[0].opening_type == "window"
    assert cs[0].sill_height_mm > 0


def test_tier4_rejects_unrelated_text():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [], "arcs": [],
        "texts": [
            {"text": "ROOM A", "x": 2000.0, "y": 500.0,
             "layer": "A-ANNO", "handle": ""},
            {"text": "FFL +0.000", "x": 2500.0, "y": 500.0,
             "layer": "A-ANNO", "handle": ""},
        ],
    }
    assert detect_tier4_annotation_dxf(walls, raw) == []


def test_tier4_rejects_implausible_width():
    walls = [_single_wall_dict()]
    raw = {
        "inserts": [], "arcs": [],
        "texts": [
            {"text": "D9 300x500", "x": 2000.0, "y": 500.0,
             "layer": "A-ANNO", "handle": ""},
            {"text": "D10 9000x9000", "x": 3000.0, "y": 500.0,
             "layer": "A-ANNO", "handle": ""},
        ],
    }
    assert detect_tier4_annotation_dxf(walls, raw) == []


def test_tier4_threshold_matches_prompt():
    assert ANNOTATION_TEXT_DISTANCE_MAX_MM == 800.0


# Confidence values pinned


def test_confidence_values_match_prompt():
    assert TIER1_BLOCK_CONFIDENCE == 0.95
    assert TIER2_SWING_ARC_CONFIDENCE == 0.85
    assert TIER3_WALL_GAP_CONFIDENCE == 0.75
    assert TIER4_ANNOTATION_CONFIDENCE == 0.70


# Regex pinning


def test_block_name_regex_matches_expected():
    for name in ["door900", "DR_1200", "INTERIOR_DOOR", "window-frame",
                 "WIN_1500", "WND2", "OPENING_A", "OPNG_3"]:
        assert BLOCK_NAME_REGEX.search(name), name


def test_block_name_regex_rejects_non_opening():
    for name in ["COLUMN", "BEAM_B1", "FOOTING", "REINFORCEMENT"]:
        assert not BLOCK_NAME_REGEX.search(name), name


def test_layer_name_regex_anchors_to_start():
    assert LAYER_NAME_REGEX.search("A-DOOR")
    assert LAYER_NAME_REGEX.search("OPENING")
    assert LAYER_NAME_REGEX.search("A-WINDOW-FRAME")
    # Not anchored on a-wall-* — wall layers should NOT slip through.
    assert not LAYER_NAME_REGEX.search("A-WALL-OPENING")


# ── extract_dxf_entities ─────────────────────────────────────────────────────


def test_extract_dxf_entities_picks_up_all_kinds():
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    _ensure_layers(doc)
    blk_name = _ensure_door_block(doc, 900)
    msp.add_blockref(blk_name, insert=(1000, 0), dxfattribs={"layer": "A-DOOR"})
    msp.add_arc(center=(1000, 0), radius=900, start_angle=0, end_angle=90,
                dxfattribs={"layer": "A-DOOR"})
    text = msp.add_text("D1 900x2100", dxfattribs={"layer": "A-ANNO"})
    text.set_placement((1450, 500))

    bag = extract_dxf_entities(msp, mult=1.0)
    assert len(bag["inserts"]) == 1
    assert bag["inserts"][0]["block_name"] == "door900"
    assert len(bag["arcs"]) == 1
    assert bag["arcs"][0]["radius_mm"] == 900.0
    assert len(bag["texts"]) == 1
    assert bag["texts"][0]["text"].startswith("D1")


def test_extract_dxf_entities_applies_mult():
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    blk_name = _ensure_door_block(doc, 900)
    msp.add_blockref(blk_name, insert=(2.0, 0.0))
    bag = extract_dxf_entities(msp, mult=1000.0)  # e.g. metres → mm
    assert bag["inserts"][0]["x"] == 2000.0


# ── end-to-end on synthesised single wall ────────────────────────────────────


def test_e2e_single_wall_with_all_four_tiers():
    """All 4 tier signals present — dedupe collapses to 1 opening."""
    path = _make_synthetic_wall_with_openings(
        wall_length_mm=5000.0,
        openings=[
            {"position_mm": 2000.0, "width_mm": 900.0, "height_mm": 2100.0,
             "sill_height_mm": 0.0}
        ],
    )
    try:
        parsed = parse_dxf_walls(path, filename="single_wall.dxf")
        assert "error" not in parsed
        openings = parsed["openings"]
        assert len(openings) == 1
        o = openings[0]
        assert o.opening_type == "door"
        # Highest-confidence tier wins → tier 1 (0.95).
        assert o.detection_tier == 1
        assert o.confidence == 0.95
    finally:
        os.remove(path)


def test_e2e_solid_wall_no_openings():
    """Phantom-prevention: pure wall geometry, no opening signals."""
    path = _make_synthetic_solid_wall(wall_length_mm=3016.0)
    try:
        parsed = parse_dxf_walls(path, filename="solid.dxf")
        assert "error" not in parsed
        assert parsed["openings"] == ()
    finally:
        os.remove(path)


def test_e2e_only_block_ref_signal():
    path = _make_synthetic_wall_with_openings(
        wall_length_mm=5000.0,
        openings=[{"position_mm": 2000.0, "width_mm": 900.0}],
        include_tier1=True,
        include_tier2=False,
        include_tier4=False,
    )
    try:
        parsed = parse_dxf_walls(path)
        # Tier 1 + Tier 3 (wall gap) both fire here.
        openings = parsed["openings"]
        assert len(openings) == 1
        # Tier 1 wins (higher confidence).
        assert openings[0].detection_tier == 1
    finally:
        os.remove(path)


def test_e2e_only_swing_arc_signal():
    path = _make_synthetic_wall_with_openings(
        wall_length_mm=5000.0,
        openings=[{"position_mm": 2000.0, "width_mm": 900.0}],
        include_tier1=False,
        include_tier2=True,
        include_tier4=False,
    )
    try:
        parsed = parse_dxf_walls(path)
        openings = parsed["openings"]
        assert len(openings) == 1
        # Tier 2 + Tier 3 both fire; Tier 2 (0.85) wins over Tier 3 (0.75).
        assert openings[0].detection_tier == 2
    finally:
        os.remove(path)


def test_e2e_only_annotation_signal():
    path = _make_synthetic_wall_with_openings(
        wall_length_mm=5000.0,
        openings=[{"position_mm": 2000.0, "width_mm": 900.0}],
        include_tier1=False,
        include_tier2=False,
        include_tier4=True,
    )
    try:
        parsed = parse_dxf_walls(path)
        openings = parsed["openings"]
        assert len(openings) == 1
        # Tier 4 + Tier 3 both fire; Tier 3 (0.75) wins over Tier 4 (0.70).
        assert openings[0].detection_tier == 3
    finally:
        os.remove(path)


def test_e2e_only_wall_gap_signal():
    """No INSERT, no ARC, no TEXT — Tier 3 alone reads the gap."""
    path = _make_synthetic_wall_with_openings(
        wall_length_mm=5000.0,
        openings=[{"position_mm": 2000.0, "width_mm": 900.0}],
        include_tier1=False,
        include_tier2=False,
        include_tier4=False,
    )
    try:
        parsed = parse_dxf_walls(path)
        openings = parsed["openings"]
        assert len(openings) == 1
        assert openings[0].detection_tier == 3
    finally:
        os.remove(path)


# ── Vamshi calibration ──────────────────────────────────────────────────────


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
    return json.loads((FIXTURES_DIR / name).read_text())


def _wall_world_start_x(walls: list[dict], wall_id: str) -> float:
    """Find the wall's world-space start X — the synthesiser places all
    wall segments along +x from origin, so this is the absolute offset of
    the wall's t=0 along the segment axis."""
    for w in walls:
        if w["id"] == wall_id:
            return float(w["start"][0])
    return 0.0


def _emitted_to_segment_position(opening, walls: list[dict]) -> float:
    """Translate parser-relative position into segment-relative position
    for comparison with fixture expected_openings."""
    base = _wall_world_start_x(walls, opening.parent_wall_id)
    return base + opening.position_mm


def _confusion(
    expected: list[dict],
    emitted: list,
    walls: list[dict],
    tol_pos: float,
    tol_width: float,
) -> tuple[int, int, int, list[str]]:
    """Greedy bipartite match: closest unmatched expected ↔ emitted within
    tolerance. Returns (TP, FP, FN, notes)."""
    notes: list[str] = []
    matched_expected: set[int] = set()
    matched_emitted: set[int] = set()

    # Sort emitted by descending confidence so the strongest hits are matched first.
    emitted_indexed = sorted(
        enumerate(emitted), key=lambda kv: -kv[1].confidence
    )

    for emit_idx, em in emitted_indexed:
        em_pos = _emitted_to_segment_position(em, walls)
        em_width = em.width_mm
        best_match = -1
        best_score = math.inf
        for i, exp in enumerate(expected):
            if i in matched_expected:
                continue
            pos_err = abs(em_pos - exp["position_mm"])
            width_err = abs(em_width - exp["width_mm"])
            if pos_err <= tol_pos and width_err <= tol_width:
                score = pos_err + width_err
                if score < best_score:
                    best_score = score
                    best_match = i
        if best_match >= 0:
            matched_expected.add(best_match)
            matched_emitted.add(emit_idx)
            notes.append(
                f"  TP: emitted T{em.detection_tier} pos={em_pos:.0f} "
                f"w={em_width:.0f} ↔ expected pos={expected[best_match]['position_mm']} "
                f"w={expected[best_match]['width_mm']}"
            )

    tp = len(matched_expected)
    fn = len(expected) - tp
    fp = len(emitted) - len(matched_emitted)

    for i in range(len(emitted)):
        if i not in matched_emitted:
            em = emitted[i]
            notes.append(
                f"  FP: emitted T{em.detection_tier} "
                f"pos={_emitted_to_segment_position(em, walls):.0f} "
                f"w={em.width_mm:.0f}"
            )
    for i, exp in enumerate(expected):
        if i not in matched_expected:
            notes.append(
                f"  FN: missing pos={exp['position_mm']} w={exp['width_mm']}"
            )
    return tp, fp, fn, notes


def _f1(precision: float, recall: float) -> float:
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def _run_calibration() -> tuple[dict, list[str]]:
    """Run all 10 fixtures through the synth → parse → detect pipeline.

    Returns (aggregate_metrics_dict, per_fixture_lines)."""
    total_tp = total_fp = total_fn = 0
    per_fixture: dict[str, dict] = {}
    log_lines: list[str] = []

    for name in VAMSHI_FIXTURE_NAMES:
        fx = _load_fixture(name)
        expected = fx["expected_openings"]
        path = _make_synthetic_wall_with_openings(
            wall_length_mm=fx["wall_length_mm"],
            openings=expected,
        )
        try:
            parsed = parse_dxf_walls(path)
            assert "error" not in parsed, f"{name} parse error: {parsed}"
            emitted = list(parsed["openings"])
            walls = parsed["walls"]
            tp, fp, fn, notes = _confusion(
                expected, emitted, walls,
                tol_pos=fx["tolerance_position_mm"],
                tol_width=fx["tolerance_width_mm"],
            )
        finally:
            os.remove(path)

        total_tp += tp
        total_fp += fp
        total_fn += fn

        precision = tp / (tp + fp) if (tp + fp) else (1.0 if not expected else 0.0)
        recall = tp / (tp + fn) if (tp + fn) else 1.0
        f1 = _f1(precision, recall) if expected else (
            1.0 if fp == 0 else 0.0
        )

        per_fixture[name] = {
            "expected": len(expected), "tp": tp, "fp": fp, "fn": fn,
            "precision": precision, "recall": recall, "f1": f1,
            "emitted": len(emitted),
        }
        log_lines.append(
            f"{name}: emitted={len(emitted)} TP={tp} FP={fp} FN={fn} "
            f"P={precision:.2f} R={recall:.2f} F1={f1:.2f}"
        )
        log_lines.extend(notes)

    agg_p = total_tp / (total_tp + total_fp) if (total_tp + total_fp) else 0.0
    agg_r = total_tp / (total_tp + total_fn) if (total_tp + total_fn) else 0.0
    agg_f1 = _f1(agg_p, agg_r)

    aggregate = {
        "total_tp": total_tp, "total_fp": total_fp, "total_fn": total_fn,
        "precision": agg_p, "recall": agg_r, "f1": agg_f1,
        "per_fixture": per_fixture,
    }
    log_lines.append(
        f"\nAGGREGATE: TP={total_tp} FP={total_fp} FN={total_fn} "
        f"P={agg_p:.3f} R={agg_r:.3f} F1={agg_f1:.3f}"
    )
    return aggregate, log_lines


# Module-level cache so per-fixture parametrised tests share one calibration run.
_CALIBRATION_CACHE: dict | None = None
_CALIBRATION_LOG: list[str] = []


def _get_calibration() -> tuple[dict, list[str]]:
    global _CALIBRATION_CACHE, _CALIBRATION_LOG
    if _CALIBRATION_CACHE is None:
        _CALIBRATION_CACHE, _CALIBRATION_LOG = _run_calibration()
    return _CALIBRATION_CACHE, _CALIBRATION_LOG


def test_calibration_aggregate_f1_meets_target():
    aggregate, log_lines = _get_calibration()
    print("\n".join(log_lines))
    assert aggregate["f1"] >= 0.90, (
        f"Vamshi aggregate F1 {aggregate['f1']:.3f} below 0.90 target.\n"
        + "\n".join(log_lines)
    )


@pytest.mark.parametrize("name", VAMSHI_FIXTURE_NAMES)
def test_calibration_per_fixture_at_least_recall_one(name):
    """For non-solid fixtures: recall must be 1.0 (every expected detected).
    Precision tolerated to drop if phantoms appear, but recall == 1 is the
    customer-visible BOQ-correctness floor."""
    aggregate, _ = _get_calibration()
    metrics = aggregate["per_fixture"][name]
    fx = _load_fixture(name)
    if not fx["expected_openings"]:
        # Solid wall — must emit 0 openings (FP == 0).
        assert metrics["fp"] == 0, f"{name}: phantom FP={metrics['fp']}"
    else:
        assert metrics["recall"] == 1.0, (
            f"{name}: recall {metrics['recall']:.2f} — missed openings: "
            f"FN={metrics['fn']}"
        )
