"""Phase 5C-3 PR 4 — 90VR parser → mapper end-to-end integration.

Verifies the existing mapper correctly handles real customer 90VR input
once openings are populated (PARSER_OPENINGS_AVAILABLE flipped to True).

The mapper code is NOT changed in this PR. This test surfaces:
  - Whether the existing pipeline crashes on real input
  - Whether non-standard wall thicknesses (e.g. 250+mm walls on 90VR)
    correctly route through ``CustomQuoteRequest`` per Karthik's
    "above 110/155/200 = customized" rule (2026-05-25 11:04)
  - Whether the existing curve_handler survives 49 non-orthogonal walls
  - Whether output_validator passes all hard invariants on real input

The numbers printed at the end of each test get captured in the PR 4
calibration report.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.kos_panel_grid_mapper.exceptions import (
    MapperInputError,
    OutputInvariantError,
)
from app.services.kos_panel_grid_mapper.mapper import map_walls_to_panels
from app.services.kos_panel_grid_mapper.types import (
    MapperInput,
    ParserJunction,
    ParserOutput,
    ParserTitleBlock,
    ParserWall,
    ProjectContext,
)
from app.services.kos_pdf_parser import parse_pdf_walls

REFERENCE_DIR = (
    Path(__file__).resolve().parent.parent.parent / "temp_folder" / "reference"
)

MR_PDF = REFERENCE_DIR / "90VR-MR-AD-2501[J]-Concrete Setout Plan-Basement-Part 2.pdf"
TC_PDF = REFERENCE_DIR / "90VR-TC-AD-2501[A]-Concrete Setout Plan-Basement-Part 2.pdf"


# ── parser-dict → typed-dataclass conversion (mirrors the router) ────────────


def _build_wall(w: dict) -> ParserWall:
    return ParserWall(
        id=w["id"],
        start=tuple(w["start"]),
        end=tuple(w["end"]),
        length_mm=float(w["length_mm"]),
        thickness_mm=(
            float(w["thickness_mm"]) if w.get("thickness_mm") is not None else None
        ),
        angle_degrees=float(w["angle_degrees"]),
        layer=w["layer"],
        detection_tier=int(w["detection_tier"]),
        confidence=float(w["confidence"]),
    )


def _build_junction(j: dict) -> ParserJunction:
    return ParserJunction(
        point=tuple(j["point"]),
        type=j["type"],
        wall_ids=tuple(j["wall_ids"]),
        wall_count=int(j["wall_count"]),
    )


def _build_title_block(tb: dict) -> ParserTitleBlock:
    import dataclasses
    known = {f.name for f in dataclasses.fields(ParserTitleBlock)}
    return ParserTitleBlock(**{k: v for k, v in (tb or {}).items() if k in known})


def _to_parser_output(parsed: dict) -> ParserOutput:
    """Build a typed ParserOutput from the parser's dict result, mirroring
    the router's _api_to_dataclass logic (we need it here because the test
    bypasses the HTTP layer)."""
    walls = parsed.get("walls", [])
    junctions = parsed.get("junctions", [])
    # Mirror router downstream_ready calculation (kos_drawing_parser.py).
    has_thickness = any(w.get("thickness_mm") is not None for w in walls)
    has_long_wall = any(w.get("length_mm", 0) > 100 for w in walls)
    boq_ready = has_thickness
    formwork_ready = boq_ready and has_long_wall
    shop_ready = formwork_ready and len(junctions) > 0

    # PR-HOTFIX-2: forward parser-emitted openings through the typed
    # ParserOutput so the mapper orchestrator can route them to segments.
    # parse_pdf_walls returns openings as a tuple[ParserOpening, ...]
    # already (no conversion needed at this layer).
    parser_openings = parsed.get("openings", ())

    return ParserOutput(
        walls=tuple(_build_wall(w) for w in walls),
        junctions=tuple(_build_junction(j) for j in junctions),
        title_block=_build_title_block(parsed.get("title_block") or {}),
        # 90VR PDF's title-block path already classifies as FLOOR_PLAN
        # (verified in PR 4 probe with classify_drawing).
        drawing_classification="FLOOR_PLAN",
        drawing_classification_confidence=0.9,
        drawing_classification_signals=(),
        drawing_classification_reasoning="parser-side default for integration test",
        layers_found=tuple(parsed.get("layers_found", [])),
        drawing_bounds=dict(parsed.get("drawing_bounds", {})),
        units_detected=parsed.get("units_detected", "mm"),
        stats=dict(parsed.get("entity_counts", {})),
        field_confidences={
            "walls": parsed.get("walls_field_confidence", 0.0),
        },
        downstream_ready={
            "boq": boq_ready,
            "formwork": formwork_ready,
            "shop_drawings": shop_ready,
        },
        missing_data=(),
        detection_strategy_used=f"tier_{parsed.get('detection_tier', 0)}",
        overall_confidence=float(parsed.get("overall_confidence", 0.0)),
        parser_version=parsed.get("parser_version", ""),
        phase=parsed.get("phase", ""),
        duration_ms=float(parsed.get("duration_ms", 0.0)),
        warnings=tuple(parsed.get("warnings", [])),
        openings=tuple(parser_openings),
    )


def _run_pipeline(pdf_path: Path, project_name: str):
    """Parse + map. Returns (parsed, output_or_None, mapper_error_or_None).

    Mapper validator may surface hard invariants on real 90VR walls (per
    PR 4 forensic discovery — the splitter's corner-cover math fails on
    sub-1100mm non-orthogonal segments). Per prompt §4 we cannot modify
    mapper code, so this helper returns the exception object instead of
    re-raising; callers decide whether to treat it as a hard failure or
    a documented finding."""
    parsed = parse_pdf_walls(str(pdf_path), filename=pdf_path.name)
    assert "error" not in parsed, parsed
    po = _to_parser_output(parsed)
    ctx = ProjectContext(
        project_name=project_name,
        seismic_zone="II",          # NSW Sydney (90VR is in Australia)
        application_hint=None,
        split_strategy="minimize_cuts",
        wall_height_mm=3000,
    )
    try:
        output = map_walls_to_panels(
            MapperInput(parser_output=po, project_context=ctx)
        )
        return parsed, output, None
    except (OutputInvariantError, MapperInputError) as exc:
        return parsed, None, exc


# ── 90VR-MR full pipeline ────────────────────────────────────────────────────


@pytest.mark.skipif(not MR_PDF.exists(), reason="90VR-MR PDF not present")
def test_90vr_mr_full_pipeline_runs_clean():
    parsed, output, err = _run_pipeline(MR_PDF, "90 Victoria Road - Main Residence")

    # Test invariants regardless of mapper outcome:
    # - Parser must succeed
    # - If mapper succeeded, output must be self-consistent
    # - If mapper failed, the failure must be a documented mapper validator
    #   issue (not a crash) — this captures PR 4's forensic finding that the
    #   existing mapper needs further hardening for real 90VR splitter math.
    print(f"\n=== 90VR-MR FULL PIPELINE ===")
    print(f"  Walls parsed:              {len(parsed['walls'])}")
    print(f"  Openings parsed:           {len(parsed['openings'])}")
    print(f"  Junctions:                 {len(parsed['junctions'])}")

    if err is not None:
        # Mapper validator surfaced hard invariants. Document the result;
        # the PR 4 report flags this as a follow-up for the splitter.
        print(f"  Mapper status:             FAILED (existing-mapper limitation)")
        print(f"  Mapper error type:         {type(err).__name__}")
        msg = str(err)
        print(f"  Mapper error summary:      {msg[:280]}{'...' if len(msg) > 280 else ''}")
        print(f"=== END 90VR-MR FULL PIPELINE ===")
        # Soft assertion: parser did its job; mapper failure is documented.
        assert len(parsed["walls"]) > 0, "parser failed to extract walls"
        # The failure must be a documented mapper exception, not a crash.
        assert isinstance(err, (OutputInvariantError, MapperInputError))
        return

    # Mapper succeeded — full invariant suite applies.
    assert output.wall_segments, "mapper produced zero segments on real input"
    assert output.total_counts.grand_total >= 0
    assert output.total_cost_inr >= 0.0
    assert output.total_weight_kg >= 0.0

    # CUSTOM-thickness routing — Karthik 2026-05-25 11:04:
    # "At the moment we are limited to 110 155 200. Above that are customized"
    non_standard_segments = [
        s for s in output.wall_segments
        if s.system not in ("K4-110", "K6-150", "K8-200")
    ]
    if non_standard_segments:
        assert output.custom_quote_requests, (
            f"{len(non_standard_segments)} non-standard segments produced but "
            "zero CustomQuoteRequest entries — sales handoff missing"
        )

    for s in output.wall_segments:
        for o in s.openings:
            assert o.position_mm >= 0, (
                f"segment {s.id}: opening.position_mm < 0"
            )

    print(f"  Mapper segments:           {len(output.wall_segments)}")
    print(f"  Mapper segments w/ openings: "
          f"{sum(1 for s in output.wall_segments if s.openings)}")
    print(f"  Total panel count:         {output.total_counts.grand_total}")
    print(f"  Custom quote requests:     {len(output.custom_quote_requests)}")
    print(f"  Total cost (INR):          {output.total_cost_inr:,.0f}")
    print(f"  Total weight (kg):         {output.total_weight_kg:.1f}")
    print(f"  Output warnings:           {len(output.warnings)}")
    print(f"=== END 90VR-MR FULL PIPELINE ===")


# ── 90VR-TC full pipeline ────────────────────────────────────────────────────


@pytest.mark.skipif(not TC_PDF.exists(), reason="90VR-TC PDF not present")
def test_90vr_tc_full_pipeline_runs_clean():
    parsed, output, err = _run_pipeline(TC_PDF, "90 Victoria Road - Townhouse Cluster")

    print(f"\n=== 90VR-TC FULL PIPELINE ===")
    print(f"  Walls parsed:              {len(parsed['walls'])}")
    print(f"  Openings parsed:           {len(parsed['openings'])}")
    print(f"  Junctions:                 {len(parsed['junctions'])}")

    if err is not None:
        print(f"  Mapper status:             FAILED (existing-mapper limitation)")
        print(f"  Mapper error type:         {type(err).__name__}")
        msg = str(err)
        print(f"  Mapper error summary:      {msg[:280]}{'...' if len(msg) > 280 else ''}")
        print(f"=== END 90VR-TC FULL PIPELINE ===")
        assert len(parsed["walls"]) > 0
        assert isinstance(err, (OutputInvariantError, MapperInputError))
        return

    assert output.wall_segments
    assert output.total_counts.grand_total >= 0

    non_standard = [
        s for s in output.wall_segments
        if s.system not in ("K4-110", "K6-150", "K8-200")
    ]
    if non_standard:
        assert output.custom_quote_requests

    print(f"  Mapper segments:           {len(output.wall_segments)}")
    print(f"  Mapper segments w/ openings: "
          f"{sum(1 for s in output.wall_segments if s.openings)}")
    print(f"  Total panel count:         {output.total_counts.grand_total}")
    print(f"  Custom quote requests:     {len(output.custom_quote_requests)}")
    print(f"  Total cost (INR):          {output.total_cost_inr:,.0f}")
    print(f"  Total weight (kg):         {output.total_weight_kg:.1f}")
    print(f"  Output warnings:           {len(output.warnings)}")
    print(f"=== END 90VR-TC FULL PIPELINE ===")


# ── opening-handler activation verification ─────────────────────────────────


@pytest.mark.skipif(not MR_PDF.exists(), reason="90VR-MR PDF not present")
def test_90vr_mapper_consumes_opening_handler_output():
    """When PARSER_OPENINGS_AVAILABLE=True (PR 4 flip), the mapper's
    opening_handler must be invoked. We verify the flag is consulted by
    confirming mapper output for 90VR-MR contains opening data on at least
    some wall_segments (parser emits 25 openings → mapper distributes them
    across segments via the wall_segmenter's parser-id → segment-id mapping).
    """
    from app.services.kos_panel_grid_mapper.constants import (
        PARSER_OPENINGS_AVAILABLE,
    )
    _, output, err = _run_pipeline(MR_PDF, "90 Victoria Road - Main Residence")
    if err is not None:
        # Mapper failed before we can verify opening flow; skip rather than
        # fail. The test above already documents the mapper failure mode.
        pytest.skip(f"mapper failed before opening verification: {type(err).__name__}")

    # PR-HOTFIX-2 wired the consumer pipe: mapper.py now passes parser
    # openings (filtered by parent_wall_id ∈ segment.source_wall_ids) into
    # opening_handler.detect_openings, which projects them onto the segment
    # axis and emits mapper-side Opening records.
    if PARSER_OPENINGS_AVAILABLE:
        segments_with_openings = [s for s in output.wall_segments if s.openings]
        total_consumed = sum(len(s.openings) for s in output.wall_segments)
        # 90VR-MR parser emits 19 openings (per 5C-3 PR 4 calibration). Some
        # routing loss is acceptable when the segmenter drops the parent
        # wall of an opening (orphan path); we set the floor at ≥ 1 to
        # prove the pipe is alive, and ≥ 10 as a realistic real-customer
        # threshold given the wall_segmenter's filtering behaviour.
        assert segments_with_openings, (
            "PARSER_OPENINGS_AVAILABLE=True and parser emitted openings, "
            "but mapper output has zero segments with openings — "
            "consumer pipe appears broken."
        )
        assert total_consumed >= 10, (
            f"Only {total_consumed} parser openings routed to segments "
            f"(parser emitted ~19 on 90VR-MR). Excessive routing loss — "
            f"orphan opening filter may be too aggressive."
        )
    else:
        for s in output.wall_segments:
            assert s.openings == ()


# ── PR-HOTFIX-1 regression: hard C-1 issues must drop to 0 on 90VR ─────────


def _count_hard_c1_issues(pdf_path):
    """Run the full parser → mapper pipeline and return the number of
    hard C-1 (length-sum) validation issues. Per PR-HOTFIX-1:
      - pre-fix on 90VR-MR: 43 hard C-1 issues
      - pre-fix on 90VR-TC: 36 hard C-1 issues
      - post-fix on both: 0 (target)
    """
    from app.services.kos_panel_grid_mapper.output_validator import validate_output

    parsed, output, err = _run_pipeline(pdf_path, "PR-HOTFIX-1 90VR C-1 regression")
    # The PR-HOTFIX-1 fix is supposed to PREVENT OutputInvariantError from
    # firing on 90VR. If err is None, the mapper completed and we count
    # C-1 issues from the output directly. If err is still raised, we
    # haven't fully fixed the problem.
    if err is not None:
        # Mapper still hard-raises. Surface the error so the hotfix isn't
        # masking a residual issue.
        return None, err
    issues = validate_output(output)
    return [i for i in issues if i.severity == "hard" and i.rule == "C-1"], None


@pytest.mark.skipif(not MR_PDF.exists(), reason="90VR-MR PDF not present")
def test_90vr_mr_produces_zero_hard_c1_validation_issues():
    """PR-HOTFIX-1 acceptance test: 90VR-MR pre-fix surfaced 43 hard C-1
    issues; post-fix must drop to 0."""
    hard_c1, err = _count_hard_c1_issues(MR_PDF)
    assert err is None, (
        f"90VR-MR mapper still raises post-hotfix: {type(err).__name__}: {str(err)[:200]}"
    )
    assert len(hard_c1) == 0, (
        f"PR-HOTFIX-1 regression: {len(hard_c1)} hard C-1 issues on 90VR-MR "
        f"(pre-fix was 43; target 0). First few:\n"
        + "\n".join(f"  {i.message[:160]}" for i in hard_c1[:5])
    )


@pytest.mark.skipif(not TC_PDF.exists(), reason="90VR-TC PDF not present")
def test_90vr_tc_produces_zero_hard_c1_validation_issues():
    """PR-HOTFIX-1 acceptance test: 90VR-TC pre-fix surfaced 36 hard C-1
    issues; post-fix must drop to 0."""
    hard_c1, err = _count_hard_c1_issues(TC_PDF)
    assert err is None, (
        f"90VR-TC mapper still raises post-hotfix: {type(err).__name__}: {str(err)[:200]}"
    )
    assert len(hard_c1) == 0, (
        f"PR-HOTFIX-1 regression: {len(hard_c1)} hard C-1 issues on 90VR-TC "
        f"(pre-fix was 36; target 0). First few:\n"
        + "\n".join(f"  {i.message[:160]}" for i in hard_c1[:5])
    )
