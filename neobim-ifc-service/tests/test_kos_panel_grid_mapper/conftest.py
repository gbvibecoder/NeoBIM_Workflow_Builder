"""Shared fixtures for kos_panel_grid_mapper tests.

The P_INT_8 canonical fixture comes from DESIGN.md §8.1 — the smallest segment
worked example. We use it across multiple PRs as the foundation regression test.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from app.services.kos_panel_grid_mapper import (
    MapperInput,
    ParserJunction,
    ParserOutput,
    ParserTitleBlock,
    ParserWall,
    ProjectContext,
)


@pytest.fixture
def p_int_8_parser_output() -> ParserOutput:
    """Synthesized parser output for P_INT_8 — 2101mm internal wall, no openings.

    Hand-built from Vamshi PDF Sheet 11. Used as the smallest end-to-end fixture
    across the IMPLEMENT slice. PR 1 only constructs this; later PRs run algorithms
    against it.
    """
    return ParserOutput(
        walls=(
            ParserWall(
                id="w40",
                start=(0.0, 0.0),
                end=(2101.0, 0.0),
                length_mm=2101.0,
                thickness_mm=110.0,
                angle_degrees=0.0,
                layer="A-WALL-1",
                detection_tier=1,
                confidence=0.85,
            ),
        ),
        junctions=(
            ParserJunction(
                point=(0.0, 0.0),
                type="END",
                wall_ids=("w40",),
                wall_count=1,
            ),
            ParserJunction(
                point=(2101.0, 0.0),
                type="END",
                wall_ids=("w40",),
                wall_count=1,
            ),
        ),
        title_block=ParserTitleBlock(),
        drawing_classification="FLOOR_PLAN",
        drawing_classification_confidence=0.95,
        drawing_classification_signals=("title_block_present", "wall_count_50plus"),
        drawing_classification_reasoning="title-block dominant classification",
        layers_found=("A-WALL-1",),
        drawing_bounds={"min_x": 0.0, "min_y": 0.0, "max_x": 2101.0, "max_y": 100.0},
        units_detected="mm",
        stats={"wall_count": 1, "junction_count": 2},
        field_confidences={"thickness_mm": 0.85},
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
        missing_data=(),
        detection_strategy_used="dxf-tier-1",
        overall_confidence=0.85,
        parser_version="0.2.0",
        phase="5C-2",
        duration_ms=42.0,
        warnings=(),
    )


@pytest.fixture
def p_int_8_project_context() -> ProjectContext:
    """Default context for the P_INT_8 fixture: internal partition, seismic III."""
    return ProjectContext(
        project_name="VAMSHI RESIDENCE",
        seismic_zone="III",
        application_hint="internal_partition",
        split_strategy="minimize_cuts",
        wall_height_mm=3000,
    )


@pytest.fixture
def p_int_8_mapper_input(
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> MapperInput:
    return MapperInput(
        parser_output=p_int_8_parser_output,
        project_context=p_int_8_project_context,
    )


@pytest.fixture
def p_int_8_canonical_json() -> dict:
    """Load the canonical 9-panel WallSegment JSON from DESIGN.md §8.1.

    Used by integration tests (later PRs) to verify byte-equality of mapper output.
    PR 1 only verifies this file exists and parses as JSON.
    """
    here = pathlib.Path(__file__).parent
    path = here / "golden" / "p_int_8_canonical.json"
    return json.loads(path.read_text())


# ──────────────────────────────────────────────────────────────────────────────
# PR 3: build a complete PanelGridMapperOutput from the golden P_INT_8 segment.
# The validator works on PanelGridMapperOutput; the golden is a single segment,
# so we wrap it with computed project-level totals here.
# ──────────────────────────────────────────────────────────────────────────────


def _panel_from_dict(d: dict):
    """Lazy dict→Panel constructor used by tests."""
    from app.services.kos_panel_grid_mapper import Panel
    return Panel(**d)


def _segment_from_dict(d: dict):
    """Lazy dict→WallSegment constructor that handles tuple wrapping + nested
    ReinforcementSpec / Panel reconstruction. Defaults set for PR 3 fields if
    the JSON doesn't carry them (backward-compat)."""
    from app.services.kos_panel_grid_mapper import (
        Opening,
        ReinforcementSpec,
        WallSegment,
    )
    panels = tuple(_panel_from_dict(p) for p in d.get("panels", []))
    openings = tuple(
        Opening(**o) for o in d.get("openings", [])
    )
    rs = d["reinforcement_spec"]
    reinforcement_spec = ReinforcementSpec(
        vertical_bars=rs["vertical_bars"],
        horizontal_bars=rs["horizontal_bars"],
        concrete_grade=rs["concrete_grade"],
        cover_external_mm=rs["cover_external_mm"],
        cover_internal_mm=rs["cover_internal_mm"],
        source_section=rs["source_section"],
    )
    return WallSegment(
        id=d["id"],
        system=d["system"],
        custom_thickness_mm=d.get("custom_thickness_mm"),
        inferred_application=d["inferred_application"],
        application_confidence=d["application_confidence"],
        application_source=d["application_source"],
        length_mm=d["length_mm"],
        height_mm=d["height_mm"],
        area_sqft=d["area_sqft"],
        lifts_required=d["lifts_required"],
        neighbour_covered_left_mm=d["neighbour_covered_left_mm"],
        neighbour_covered_right_mm=d["neighbour_covered_right_mm"],
        panels=panels,
        openings=openings,
        openings_inferable=d["openings_inferable"],
        bracing_height_class=d["bracing_height_class"],
        reinforcement_spec=reinforcement_spec,
        segment_cost_inr=d["segment_cost_inr"],
        segment_weight_kg=d["segment_weight_kg"],
        segment_skin_kg=d["segment_skin_kg"],
        segment_rib_kg=d["segment_rib_kg"],
        segment_raw_kg=d["segment_raw_kg"],
        segment_waste_kg=d["segment_waste_kg"],
        segment_panel_counts=d["segment_panel_counts"],
        warnings=tuple(d.get("warnings", ())),
        info_notes=tuple(d.get("info_notes", ())),
        assumptions=tuple(d.get("assumptions", ())),
        # PR 3 additions (with sensible defaults if missing from JSON):
        plan_polyline=tuple(tuple(p) for p in d.get("plan_polyline", ())),
        source_wall_ids=tuple(d.get("source_wall_ids", ())),
        is_custom_order=d.get("is_custom_order", False),
        custom_quote_request=None,    # P_INT_8 is non-custom
    )


@pytest.fixture
def p_int_8_canonical_segment(p_int_8_canonical_json):
    """Reconstruct the P_INT_8 WallSegment dataclass from the golden JSON.
    Full IEEE-754 precision on all numeric fields."""
    return _segment_from_dict(p_int_8_canonical_json)


@pytest.fixture
def p_int_8_canonical_output(p_int_8_canonical_segment):
    """Build a complete PanelGridMapperOutput around the P_INT_8 segment.

    Project-level totals are computed from the segment's per-panel rollups so
    every C-1..C-21 invariant holds by construction — this output should
    `validate_output()` to ZERO issues."""
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION,
        PanelGridMapperOutput,
        SegmentCount,
        TotalCounts,
    )

    seg = p_int_8_canonical_segment
    # Project-level totals — for the single-segment golden, just lift segment totals.
    total_cost_inr = seg.segment_cost_inr
    total_weight_kg = seg.segment_weight_kg
    total_skin_kg = seg.segment_skin_kg
    total_rib_kg = seg.segment_rib_kg
    total_raw_kg = seg.segment_raw_kg
    total_waste_kg = seg.segment_waste_kg
    waste_ratio = total_waste_kg / total_raw_kg if total_raw_kg > 0 else 0.0

    # by_type / by_thickness rollups derived from panels.
    by_type: dict[str, int] = {}
    by_thickness: dict[int, int] = {}
    for p in seg.panels:
        by_type[p.type] = by_type.get(p.type, 0) + 1
        by_thickness[p.thickness_mm] = by_thickness.get(p.thickness_mm, 0) + 1

    total_counts = TotalCounts(
        by_sku=dict(seg.segment_panel_counts),
        by_type=by_type,
        by_thickness=by_thickness,
        grand_total=len(seg.panels),
        by_segment=(SegmentCount(segment_id=seg.id, panel_count=len(seg.panels)),),
    )

    return PanelGridMapperOutput(
        project_name="VAMSHI RESIDENCE",
        seismic_zone="III",
        split_strategy_used="minimize_cuts",
        wall_height_mm=3000,
        wall_segments=(seg,),
        custom_quote_requests=(),
        total_counts=total_counts,
        total_cost_inr=total_cost_inr,
        total_weight_kg=total_weight_kg,
        total_skin_kg=total_skin_kg,
        total_rib_kg=total_rib_kg,
        total_raw_kg=total_raw_kg,
        total_waste_kg=total_waste_kg,
        warnings=(),
        assumptions_made=("POLICY-KARTHIK-WINS",),
        pending_karthik=(),
        info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at="2026-05-24T00:00:00Z",
        waste_ratio=waste_ratio,
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
    )
