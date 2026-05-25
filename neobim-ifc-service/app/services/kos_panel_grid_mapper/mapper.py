"""
Orchestrator — the public entry point for the KOS Panel-Grid Mapper.

DESIGN.md §6.1 pipeline order:
  Phase 0  Input validation (IV-1..IV-5)
  Phase 1  Wall segmentation                            (Problem 2)
  Phase 2  Per-segment enrichment:
             - Application inference                    (Problem 3)
             - System selection                         (Problem 1)
             - Multi-lift planning                      (Problem 9)
             - Opening detection                        (Problem 7)
             - Curve handling                           (Problem 8)
  Phase 3  Cross-segment corner & T-junction handlers   (Problems 5+6)
           → produces per-segment first/last reservations
             and neighbour_covered_*_mm offsets (R1+R2+R5)
  Phase 4  Per-segment splitting                        (Problem 4)
           → Panel[] (or CustomQuoteRequest for is_custom_order)
  Phase 5  Project-level totals + TotalCounts rollup
  Phase 6  Output validation                            (Problem 11 — 21 invariants)
           → soft issues append to warnings; hard raises OutputInvariantError

Pure wiring. No new algorithms. The only allowed `datetime.now()` in the
entire codebase lives here — for the `generated_at` field of the output.

Error model:
  - MapperInputError    → raised on IV-1..IV-5 failures
                          (caller / router translates to HTTP 400)
  - OutputInvariantError → raised when validate_or_raise detects a hard
                           validation issue (algorithm bug; HTTP 500)
  - CustomQuoteRequired → NOT propagated to caller. Caught internally and
                          translated to a CustomQuoteRequest in the 200 OK output.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timezone
from typing import Literal, Optional

from .area_weight_calculator import compute_panel_area_sqft
from .constants import (
    JUNCTION_TOLERANCE_MM,
    MAPPER_SCHEMA_VERSION,
    SimpleApplication,
)
from .corner_handler import handle_corner
from .curve_handler import detect_curve
from .exceptions import (
    CustomQuoteRequired,
    MapperInputError,
)
from .multi_row_handler import plan_lifts
from .opening_handler import detect_openings
from .orientation_inferrer import infer_application
from .output_validator import validate_or_raise
from .sku_resolver import (
    resolve_bracing_height_class,
    resolve_reinforcement_spec,
)
from .splitter import split_wall_to_panels
from .system_selector import select_system
from .t_junction_handler import handle_t_junction
from .types import (
    CustomQuoteRequest,
    MapperInput,
    Panel,
    PanelGridMapperOutput,
    PanelReservation,
    ParserJunction,
    ParserOutput,
    ParserWall,
    ProjectContext,
    SegmentCount,
    SplitInput,
    TotalCounts,
    WallSegment,
    WallSegmentDraft,
)
from .wall_segmenter import segment_walls


# ──────────────────────────────────────────────────────────────────────────────
# Static design-time documentation tuples emitted in every output
# ──────────────────────────────────────────────────────────────────────────────

_ASSUMPTIONS_MADE: tuple[str, ...] = (
    "POLICY-KARTHIK-WINS: Karthik's WhatsApp confirmations override Vamshi PDF observations.",
    "POLICY-DEFAULT-STRATEGY-B: default split strategy is `minimize_cuts` (standard 300mm panels).",
    "POLICY-DETERMINISM: same input ⇒ byte-equal output; no random, no time/date except generated_at.",
    "POLICY-DEFAULT-CONFIG: defaults seismic_zone='III', wall_height_mm=3000, "
    "application_hint=None (geometry-inferred).",
    "ASSUMPTION-A1: parser output coords already in mm.",
    "ASSUMPTION-A11: segment.length_mm = plan-extent (max-min along polyline), "
    "not sum of source-wall lengths.",
    "ASSUMPTION-A13: default first panel for internal walls with no reservation = ECM.",
    "ASSUMPTION-A14: default end-terminator for internal walls = CTC labeled V1.",
    "ASSUMPTION-A18: minimum curve radius for straight-panel approximation = 600mm.",
    "ASSUMPTION-A19: running bond offset = 150mm (half-panel) between consecutive lifts.",
    "R1 INTEGRATED: each segment owns its LEFT corner (clockwise-walk-LEFT ownership).",
    "R5 INTEGRATED: external segment with no corner reservation skips covered "
    "neighbour offset (no ECM default emitted).",
    "R6 INTEGRATED: Panel.raw_length_mm = ceil(cut/3048) × 3048 for long horizontals.",
)

_PENDING_KARTHIK: tuple[str, ...] = (
    "Skin-vs-rib pricing engineering (currently flat ₹225/sft; future per-component blend).",
    "K6-150 vs 155mm naming confirmation (working assumption: synonymous per POLICY-KARTHIK-WINS).",
    "K6-180 stocking status (currently routed to CustomQuoteRequest with warning).",
    "K8-250 standard-vs-custom (currently routed to CustomQuoteRequest per Karthik 2026-05-22).",
    "CP vs PC SKU semantics (CP for 90° external corner; PC for T-abutment per Vamshi P_INT_7).",
    "CUT MEMBER M:X, F:Y interpretation (inferred as joint-trim depth in mm).",
    "Default seismic zone for India (proposed: III; configurable per project).",
)


# ──────────────────────────────────────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────────────────────────────────────


def map_walls_to_panels(inp: MapperInput) -> PanelGridMapperOutput:
    """The single public entry point of the mapper.

    Runs the full DESIGN §6.1 pipeline and returns a fully populated,
    validated PanelGridMapperOutput. Raises MapperInputError on bad input
    (IV-1..IV-5) or OutputInvariantError on internal-bug-only conditions
    (validator C-N hard failures).
    """
    # ── Phase 0: input validation ──
    input_warnings = _validate_input(inp)

    po = inp.parser_output
    pc = inp.project_context

    # ── Phase 1: wall segmentation ──
    drafts = segment_walls(po.walls, po.junctions)

    if not drafts:
        # Edge case: validator accepted ≥1 wall but segmenter produced no drafts.
        # Emit an empty output with diagnostic warning.
        return _build_empty_output(
            pc, po, input_warnings + ("Phase 1: wall_segmenter produced 0 drafts from non-empty walls",)
        )

    # ── Phase 2: per-segment enrichment ──
    walls_by_id = {w.id: w for w in po.walls}
    enriched = _enrich_segments(drafts, walls_by_id, po, pc)

    # PR-HOTFIX-2: detect parser openings whose parent_wall_id is not in any
    # segment.source_wall_ids — these are "orphan" openings the segmenter
    # dropped (e.g. opening on a wall the segmenter classified as noise).
    # Surface as soft warnings on the output so operators can review.
    if po.openings:
        segment_wall_ids: set[str] = set()
        for d in drafts:
            segment_wall_ids.update(d.source_wall_ids)
        orphan_opening_warnings = tuple(
            f"opening {o.id} references parent_wall_id={o.parent_wall_id!r} "
            f"not in any segment.source_wall_ids — dropped during segmentation; "
            f"this opening will not appear in mapper output."
            for o in po.openings
            if o.parent_wall_id not in segment_wall_ids
        )
        input_warnings = input_warnings + orphan_opening_warnings

    # ── Phase 3: cross-segment corner + T-junction handling ──
    enriched_by_id = {e["draft"].id: e for e in enriched}
    for j in po.junctions:
        if j.type == "CORNER":
            _process_corner_junction(j, enriched_by_id, walls_by_id)
        elif j.type == "T_JOIN":
            _process_t_junction(j, enriched_by_id, walls_by_id)

    # ── Phase 4: per-segment splitting (or custom-quote routing) ──
    wall_segments: list[WallSegment] = []
    custom_quote_requests: list[CustomQuoteRequest] = []

    for e in enriched:
        if e["system"].is_custom_order:
            # K6-180 / K8-250 / CUSTOM → custom-quote handoff; no panels emitted.
            cq = _build_custom_quote_request(e, pc)
            custom_quote_requests.append(cq)
            wall_segments.append(_build_custom_quote_segment(e, cq, pc))
        else:
            split_input = SplitInput(
                segment_id=e["draft"].id,
                segment_length_mm=e["draft"].length_mm,
                segment_height_mm=pc.wall_height_mm,
                system=e["system"].system,
                sku_thickness_mm=e["system"].sku_thickness_mm or 0,
                application=e["orientation"].application,
                strategy=pc.split_strategy,
                first_panel_reservation=e["first_reservation"],
                last_panel_reservation=e["last_reservation"],
                neighbour_covered_left_mm=e["covered_left"],
                neighbour_covered_right_mm=e["covered_right"],
                openings=e["openings"].openings,
            )
            split_res = split_wall_to_panels(split_input)

            seg = _build_wall_segment(e, split_res, pc)
            wall_segments.append(seg)

    # ── Phase 5: project totals + TotalCounts ──
    project_totals = _compute_project_totals(wall_segments)
    total_counts = _build_total_counts(wall_segments)

    # ── Build output ──
    output = _build_output(
        pc=pc,
        po=po,
        wall_segments=tuple(wall_segments),
        custom_quote_requests=tuple(custom_quote_requests),
        total_counts=total_counts,
        project_totals=project_totals,
        input_warnings=input_warnings,
    )

    # ── Phase 6: output validation ──
    # validate_or_raise raises OutputInvariantError on hard issues; returns soft issues.
    soft_issues = validate_or_raise(output)
    if soft_issues:
        soft_warning_msgs = tuple(f"[{i.rule}] {i.message}" for i in soft_issues)
        output = dataclasses.replace(
            output, warnings=output.warnings + soft_warning_msgs
        )

    return output


# ──────────────────────────────────────────────────────────────────────────────
# Phase 0 — Input validation (IV-1 .. IV-5)
# ──────────────────────────────────────────────────────────────────────────────


def _validate_input(inp: MapperInput) -> tuple[str, ...]:
    """Run IV-1..IV-5. Raises MapperInputError on hard failures; returns
    warnings for soft IV-4 (low classification confidence)."""
    warnings: list[str] = []
    po = inp.parser_output
    pc = inp.project_context

    if po.drawing_classification != "FLOOR_PLAN":
        raise MapperInputError(
            f"IV-1: drawing_classification={po.drawing_classification!r} "
            f"(expected 'FLOOR_PLAN' — mapper only consumes plan-view drawings)"
        )

    if not po.downstream_ready.get("boq", False):
        raise MapperInputError(
            "IV-2: parser_output.downstream_ready.boq is False — parser "
            "could not detect thickness on enough walls; can't proceed"
        )

    if len(po.walls) == 0:
        raise MapperInputError("IV-3: parser_output.walls is empty")

    if po.drawing_classification_confidence < 0.5:
        warnings.append(
            f"IV-4: low drawing_classification_confidence="
            f"{po.drawing_classification_confidence:.2f} (< 0.5); "
            f"BOQ may be unreliable but mapper proceeds"
        )

    if not pc.project_name or not pc.project_name.strip():
        raise MapperInputError("IV-5: project_context.project_name is empty")

    if pc.seismic_zone not in ("II", "III", "IV", "V"):
        raise MapperInputError(
            f"IV-5b: project_context.seismic_zone={pc.seismic_zone!r} not in "
            f"valid Indian zones (II, III, IV, V)"
        )

    return tuple(warnings)


# ──────────────────────────────────────────────────────────────────────────────
# Phase 2 — Per-segment enrichment
# ──────────────────────────────────────────────────────────────────────────────


def _enrich_segments(
    drafts: list[WallSegmentDraft],
    walls_by_id: dict[str, ParserWall],
    po: ParserOutput,
    pc: ProjectContext,
) -> list[dict]:
    """Walk each segment draft and produce enrichment metadata (orientation,
    system, lifts, openings, curves). Returns a list of mutable dicts that
    Phase 3 mutates with reservation info.
    """
    # PR-HOTFIX-2: pre-bucket parser openings by parent_wall_id so each
    # segment can pull its openings via a set-membership check on
    # source_wall_ids in O(segment_walls). Single pass over po.openings —
    # zero cost when the parser emitted none (empty for-loop). Orphan
    # openings (those whose parent_wall_id isn't in any segment) are
    # surfaced as soft warnings by the orchestrator, NOT by this enricher.
    openings_by_parent_wall: dict[str, list] = {}
    for po_opening in po.openings:
        openings_by_parent_wall.setdefault(
            po_opening.parent_wall_id, []
        ).append(po_opening)

    enriched: list[dict] = []
    for draft in drafts:
        # Junctions whose wall_ids intersect this segment's source walls.
        seg_wall_ids = set(draft.source_wall_ids)
        seg_junctions = tuple(
            j for j in po.junctions
            if any(wid in seg_wall_ids for wid in j.wall_ids)
        )

        orient_res = infer_application(
            is_closed_loop=draft.is_closed_loop,
            endpoint_junction_types=draft.endpoint_junction_types,
            title_block_level=po.title_block.level,
            application_hint=pc.application_hint,
        )

        # Use average thickness of source walls (null thickness drops out).
        seg_walls = [walls_by_id[wid] for wid in draft.source_wall_ids]
        thicknesses = [
            w.thickness_mm for w in seg_walls if w.thickness_mm is not None
        ]
        avg_thickness: Optional[float] = (
            sum(thicknesses) / len(thicknesses) if thicknesses else None
        )

        sys_res = select_system(
            wall_thickness_mm=avg_thickness,
            application_hint=pc.application_hint,
            inferred_application=orient_res.application,
        )

        lift_res = plan_lifts(
            height_mm=pc.wall_height_mm,
            system=sys_res.system,
            application=orient_res.application,
        )

        # PR-HOTFIX-2: collect the parser openings whose parent wall lies
        # inside this segment. Order is preserved from po.openings (which
        # was already deterministic-sorted by the parser orchestrator).
        seg_parser_openings: list = []
        for wid in draft.source_wall_ids:
            if wid in openings_by_parent_wall:
                seg_parser_openings.extend(openings_by_parent_wall[wid])

        open_res = detect_openings(
            segment=draft,
            junctions_in_segment=seg_junctions,
            parser_openings=tuple(seg_parser_openings),
            walls_by_id=walls_by_id,
        )

        curve_res = detect_curve(seg_walls)

        enriched.append({
            "draft": draft,
            "orientation": orient_res,
            "system": sys_res,
            "lifts": lift_res,
            "openings": open_res,
            "curves": curve_res,
            "seg_walls": seg_walls,
            "seg_junctions": seg_junctions,
            # Phase 3 populates these:
            "first_reservation": None,
            "last_reservation": None,
            "covered_left": 0.0,
            "covered_right": 0.0,
        })
    return enriched


# ──────────────────────────────────────────────────────────────────────────────
# Phase 3 — Cross-segment corner + T-junction handling
# ──────────────────────────────────────────────────────────────────────────────


def _process_corner_junction(
    j: ParserJunction,
    enriched_by_id: dict[str, dict],
    walls_by_id: dict[str, ParserWall],
) -> None:
    """Invoke handle_corner for one CORNER junction and apply the reservation
    + covered_*_mm offsets to the affected segments."""
    incident_seg_ids = _find_incident_segments(j, enriched_by_id)
    if len(incident_seg_ids) != 2:
        return    # degenerate — skip
    seg_a_id, seg_b_id = incident_seg_ids
    e_a = enriched_by_id[seg_a_id]
    e_b = enriched_by_id[seg_b_id]

    a_side = _determine_corner_side(e_a["draft"], j.point)
    b_side = _determine_corner_side(e_b["draft"], j.point)
    a_wall = _find_wall_at_endpoint(e_a, j.point, walls_by_id)
    b_wall = _find_wall_at_endpoint(e_b, j.point, walls_by_id)
    if a_wall is None or b_wall is None:
        return

    result = handle_corner(
        junction=j,
        seg_a_id=seg_a_id,
        seg_a_corner_side=a_side,
        seg_a_wall=a_wall,
        seg_a_sku_thickness=e_a["system"].sku_thickness_mm or 0,
        seg_b_id=seg_b_id,
        seg_b_corner_side=b_side,
        seg_b_wall=b_wall,
        seg_b_sku_thickness=e_b["system"].sku_thickness_mm or 0,
    )

    owner_e = enriched_by_id[result.owner_segment_id]
    other_e = enriched_by_id[result.other_segment_id]

    # Owner's reservation: label "S1" if on the left, otherwise let splitter
    # assign a V label.
    reservation = PanelReservation(
        sku_type="CP",
        sku_thickness_mm=result.sku_thickness_mm,
        width_mm=result.width_mm,
        cut_length_mm=result.cut_length_mm,
        label="S1" if result.owner_corner_side == "left" else None,
    )

    if result.owner_corner_side == "left":
        owner_e["first_reservation"] = reservation
    else:
        owner_e["last_reservation"] = reservation

    # The OTHER segment treats this corner as a covered region.
    if result.other_corner_side == "left":
        other_e["covered_left"] = float(result.width_mm)
    else:
        other_e["covered_right"] = float(result.width_mm)


def _process_t_junction(
    j: ParserJunction,
    enriched_by_id: dict[str, dict],
    walls_by_id: dict[str, ParserWall],
) -> None:
    """Invoke handle_t_junction for one T_JOIN and apply PC reservation to
    the ending segment."""
    incident_walls = tuple(
        walls_by_id[wid] for wid in j.wall_ids if wid in walls_by_id
    )
    if len(incident_walls) != 3:
        return    # degenerate

    # Map each incident wall to its segment id.
    wall_to_seg: dict[str, str] = {}
    for wid in j.wall_ids:
        for sid, e in enriched_by_id.items():
            if wid in e["draft"].source_wall_ids:
                wall_to_seg[wid] = sid
                break

    if not wall_to_seg:
        return    # no incident segments — skip

    seg_thicknesses = {
        sid: (e["system"].sku_thickness_mm or 0)
        for sid, e in enriched_by_id.items()
    }
    seg_systems = {sid: e["system"].system for sid, e in enriched_by_id.items()}

    # For each segment touching this T_JOIN, determine its corner side here.
    seg_corner_sides: dict[str, Literal["left", "right"]] = {}
    for sid in set(wall_to_seg.values()):
        e = enriched_by_id[sid]
        seg_corner_sides[sid] = _determine_corner_side(e["draft"], j.point)

    result = handle_t_junction(
        junction=j,
        incident_walls=incident_walls[:3],
        wall_to_segment_id=wall_to_seg,
        ending_segment_corner_side=seg_corner_sides,
        segment_sku_thicknesses=seg_thicknesses,
        segment_systems=seg_systems,
    )

    if result.ending_segment_id not in enriched_by_id:
        return    # ending wall didn't map to a known segment
    ending_e = enriched_by_id[result.ending_segment_id]

    pc_reservation = PanelReservation(
        sku_type="PC",
        sku_thickness_mm=result.sku_thickness_mm,
        width_mm=result.width_mm,
        cut_length_mm=result.cut_length_mm,
    )

    if result.ending_corner_side == "left":
        ending_e["first_reservation"] = pc_reservation
    else:
        ending_e["last_reservation"] = pc_reservation


# ──────────────────────────────────────────────────────────────────────────────
# Phase 4 — Building WallSegment + CustomQuoteRequest
# ──────────────────────────────────────────────────────────────────────────────


def _build_wall_segment(
    e: dict,
    split_res,    # SplitResult
    pc: ProjectContext,
) -> WallSegment:
    """Construct a WallSegment from the enriched dict + splitter result."""
    draft: WallSegmentDraft = e["draft"]
    sys_res = e["system"]
    orient_res = e["orientation"]
    lift_res = e["lifts"]
    open_res = e["openings"]
    curve_res = e["curves"]
    panels: tuple[Panel, ...] = split_res.panels

    # Per-panel aggregations
    seg_cost = sum(p.price_inr for p in panels)
    seg_weight = sum(p.weight_kg for p in panels)
    seg_skin = sum(p.weight_kg_skin for p in panels)
    seg_rib = sum(p.weight_kg_rib for p in panels)
    seg_raw = sum(p.raw_weight_kg for p in panels)
    seg_waste = sum(p.waste_weight_kg for p in panels)

    # SKU panel counts
    by_sku: dict[str, int] = {}
    for p in panels:
        by_sku[p.sku] = by_sku.get(p.sku, 0) + 1

    bracing_class = resolve_bracing_height_class(pc.wall_height_mm)
    reinforcement_spec = resolve_reinforcement_spec(sys_res.system, pc.seismic_zone)

    area_sqft = compute_panel_area_sqft(draft.length_mm, pc.wall_height_mm)

    # Collect per-segment warnings from all enrichment sub-results.
    seg_warnings = tuple(
        sys_res.warnings
        + lift_res.warnings
        + open_res.warnings
        + curve_res.warnings
        + tuple(split_res.warnings)
    )

    seg_info_notes: tuple[str, ...] = ()
    seg_assumptions: tuple[str, ...] = ()

    return WallSegment(
        id=draft.id,
        system=sys_res.system,
        custom_thickness_mm=None,
        inferred_application=orient_res.application,
        application_confidence=orient_res.confidence,
        application_source=orient_res.source,
        length_mm=draft.length_mm,
        height_mm=pc.wall_height_mm,
        area_sqft=area_sqft,
        lifts_required=lift_res.lifts_required,
        neighbour_covered_left_mm=e["covered_left"],
        neighbour_covered_right_mm=e["covered_right"],
        panels=panels,
        openings=open_res.openings,
        openings_inferable=open_res.openings_inferable,
        bracing_height_class=bracing_class,
        reinforcement_spec=reinforcement_spec,
        segment_cost_inr=seg_cost,
        segment_weight_kg=seg_weight,
        segment_skin_kg=seg_skin,
        segment_rib_kg=seg_rib,
        segment_raw_kg=seg_raw,
        segment_waste_kg=seg_waste,
        segment_panel_counts=by_sku,
        warnings=seg_warnings,
        info_notes=seg_info_notes,
        assumptions=seg_assumptions,
        plan_polyline=draft.plan_polyline,
        source_wall_ids=draft.source_wall_ids,
        is_custom_order=False,
        custom_quote_request=None,
    )


def _build_custom_quote_request(
    e: dict,
    pc: ProjectContext,
) -> CustomQuoteRequest:
    """Build a CustomQuoteRequest for a segment that can't be standard-fabricated."""
    draft = e["draft"]
    sys_res = e["system"]
    # The "thickness_mm" we report is the segment's average parser thickness if known,
    # else 0 as sentinel.
    avg_t = 0.0
    walls = e["seg_walls"]
    thicknesses = [w.thickness_mm for w in walls if w.thickness_mm is not None]
    if thicknesses:
        avg_t = sum(thicknesses) / len(thicknesses)

    if sys_res.system == "K6-180":
        reason = (
            "K6-180 is in Rulebook §4.1 but NOT in Karthik's standard 110/155/200 "
            "catalog — sales handoff required for custom 180mm fabrication"
        )
    elif sys_res.system == "K8-250":
        reason = (
            "K8-250 is custom-on-request per Karthik 2026-05-22 — "
            "sales handoff required for 250mm thick walls"
        )
    else:
        reason = (
            f"system={sys_res.system}, thickness={avg_t}mm not in Karthik's "
            f"standard catalog — custom quote required"
        )

    return CustomQuoteRequest(
        wall_segment_id=draft.id,
        thickness_mm=avg_t,
        length_mm=draft.length_mm,
        height_mm=pc.wall_height_mm,
        reason=reason,
    )


def _build_custom_quote_segment(
    e: dict,
    cq: CustomQuoteRequest,
    pc: ProjectContext,
) -> WallSegment:
    """Build a WallSegment shell for a CUSTOM/K6-180/K8-250 wall:
    panels=(), is_custom_order=True, custom_quote_request set."""
    draft = e["draft"]
    sys_res = e["system"]
    orient_res = e["orientation"]
    lift_res = e["lifts"]

    bracing_class = resolve_bracing_height_class(pc.wall_height_mm)
    # For CUSTOM walls we don't lookup reinforcement (it raises) — use a
    # placeholder ReinforcementSpec since the WallSegment field is non-optional.
    from .types import ReinforcementSpec
    placeholder_reinforcement = ReinforcementSpec(
        vertical_bars="(custom — per Sales / Structural Engineer)",
        horizontal_bars="(custom)",
        concrete_grade="(custom)",
        cover_external_mm=0,
        cover_internal_mm=0,
        source_section="(no Rulebook §8.2 spec for CUSTOM/K6-180/K8-250 — sales handoff)",
    )

    area_sqft = compute_panel_area_sqft(draft.length_mm, pc.wall_height_mm)
    seg_warnings = tuple(
        sys_res.warnings
        + lift_res.warnings
        + (f"WallSegment {draft.id}: custom_quote_request populated; no panels emitted",)
    )

    return WallSegment(
        id=draft.id,
        system=sys_res.system,
        custom_thickness_mm=int(round(cq.thickness_mm)) if cq.thickness_mm > 0 else None,
        inferred_application=orient_res.application,
        application_confidence=orient_res.confidence,
        application_source=orient_res.source,
        length_mm=draft.length_mm,
        height_mm=pc.wall_height_mm,
        area_sqft=area_sqft,
        lifts_required=lift_res.lifts_required,
        neighbour_covered_left_mm=0.0,
        neighbour_covered_right_mm=0.0,
        panels=(),
        openings=(),
        openings_inferable=False,
        bracing_height_class=bracing_class,
        reinforcement_spec=placeholder_reinforcement,
        segment_cost_inr=0.0,
        segment_weight_kg=0.0,
        segment_skin_kg=0.0,
        segment_rib_kg=0.0,
        segment_raw_kg=0.0,
        segment_waste_kg=0.0,
        segment_panel_counts={},
        warnings=seg_warnings,
        info_notes=(),
        assumptions=(),
        plan_polyline=draft.plan_polyline,
        source_wall_ids=draft.source_wall_ids,
        is_custom_order=True,
        custom_quote_request=cq,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Phase 5 — Project totals + TotalCounts
# ──────────────────────────────────────────────────────────────────────────────


def _compute_project_totals(wall_segments: list[WallSegment]) -> dict[str, float]:
    """Aggregate per-segment numeric totals into project-level fields."""
    total_cost = sum(s.segment_cost_inr for s in wall_segments)
    total_weight = sum(s.segment_weight_kg for s in wall_segments)
    total_skin = sum(s.segment_skin_kg for s in wall_segments)
    total_rib = sum(s.segment_rib_kg for s in wall_segments)
    total_raw = sum(s.segment_raw_kg for s in wall_segments)
    total_waste = sum(s.segment_waste_kg for s in wall_segments)
    waste_ratio = total_waste / total_raw if total_raw > 0 else 0.0
    return {
        "total_cost_inr": total_cost,
        "total_weight_kg": total_weight,
        "total_skin_kg": total_skin,
        "total_rib_kg": total_rib,
        "total_raw_kg": total_raw,
        "total_waste_kg": total_waste,
        "waste_ratio": waste_ratio,
    }


def _build_total_counts(wall_segments: list[WallSegment]) -> TotalCounts:
    """Build the TotalCounts rollup from per-segment panel inventories."""
    by_sku: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_thickness: dict[int, int] = {}
    by_segment_list: list[SegmentCount] = []
    grand_total = 0

    for s in wall_segments:
        seg_count = len(s.panels)
        grand_total += seg_count
        by_segment_list.append(SegmentCount(segment_id=s.id, panel_count=seg_count))
        for p in s.panels:
            by_sku[p.sku] = by_sku.get(p.sku, 0) + 1
            by_type[p.type] = by_type.get(p.type, 0) + 1
            by_thickness[p.thickness_mm] = by_thickness.get(p.thickness_mm, 0) + 1

    return TotalCounts(
        by_sku=by_sku,
        by_type=by_type,
        by_thickness=by_thickness,
        by_segment=tuple(by_segment_list),
        grand_total=grand_total,
    )


def _compute_downstream_ready(wall_segments: tuple[WallSegment, ...]) -> dict[str, bool]:
    """Compute the downstream_ready flags per DESIGN §4.2 + C-20 invariant."""
    boq = all(p.sku for s in wall_segments for p in s.panels) if any(
        s.panels for s in wall_segments
    ) else True
    formwork = all(
        s.bracing_height_class is not None for s in wall_segments
    ) if wall_segments else True
    shop_drawings = all(
        p.label != "" and p.position_mm is not None
        for s in wall_segments
        for p in s.panels
    )
    return {"boq": boq, "formwork": formwork, "shop_drawings": shop_drawings}


# ──────────────────────────────────────────────────────────────────────────────
# Output construction
# ──────────────────────────────────────────────────────────────────────────────


def _build_output(
    *,
    pc: ProjectContext,
    po: ParserOutput,
    wall_segments: tuple[WallSegment, ...],
    custom_quote_requests: tuple[CustomQuoteRequest, ...],
    total_counts: TotalCounts,
    project_totals: dict[str, float],
    input_warnings: tuple[str, ...],
) -> PanelGridMapperOutput:
    """Assemble the final PanelGridMapperOutput. All warnings collected from
    sub-stages are concatenated; assumptions_made and pending_karthik are
    the static design-time tuples."""
    all_warnings = list(input_warnings)
    for s in wall_segments:
        all_warnings.extend(s.warnings)

    downstream_ready = _compute_downstream_ready(wall_segments)

    # `datetime.now()` is the ONE allowed live-time call in the entire codebase
    # — strictly for the generated_at audit-trail field. All algorithm logic
    # above this line is deterministic.
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    return PanelGridMapperOutput(
        project_name=pc.project_name,
        seismic_zone=pc.seismic_zone,
        split_strategy_used=pc.split_strategy,
        wall_height_mm=pc.wall_height_mm,
        wall_segments=wall_segments,
        custom_quote_requests=custom_quote_requests,
        total_counts=total_counts,
        total_cost_inr=project_totals["total_cost_inr"],
        total_weight_kg=project_totals["total_weight_kg"],
        total_skin_kg=project_totals["total_skin_kg"],
        total_rib_kg=project_totals["total_rib_kg"],
        total_raw_kg=project_totals["total_raw_kg"],
        total_waste_kg=project_totals["total_waste_kg"],
        warnings=tuple(all_warnings),
        assumptions_made=_ASSUMPTIONS_MADE,
        pending_karthik=_PENDING_KARTHIK,
        info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at=generated_at,
        waste_ratio=project_totals["waste_ratio"],
        downstream_ready=downstream_ready,
    )


def _build_empty_output(
    pc: ProjectContext,
    po: ParserOutput,
    warnings: tuple[str, ...],
) -> PanelGridMapperOutput:
    """Build a degenerate output when the segmenter produced no segments."""
    empty_total_counts = TotalCounts(
        by_sku={}, by_type={}, by_thickness={},
        by_segment=(), grand_total=0,
    )
    project_totals = {
        "total_cost_inr": 0.0, "total_weight_kg": 0.0,
        "total_skin_kg": 0.0, "total_rib_kg": 0.0,
        "total_raw_kg": 0.0, "total_waste_kg": 0.0,
        "waste_ratio": 0.0,
    }
    return _build_output(
        pc=pc, po=po,
        wall_segments=(),
        custom_quote_requests=(),
        total_counts=empty_total_counts,
        project_totals=project_totals,
        input_warnings=warnings,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Junction-related geometry helpers (shared by Phase 3 routers)
# ──────────────────────────────────────────────────────────────────────────────


def _find_incident_segments(
    j: ParserJunction, enriched_by_id: dict[str, dict]
) -> list[str]:
    """Return the unique segment ids whose source walls include any of the
    junction's wall_ids."""
    out: list[str] = []
    for wid in j.wall_ids:
        for sid, e in enriched_by_id.items():
            if wid in e["draft"].source_wall_ids:
                if sid not in out:
                    out.append(sid)
                break
    return out


def _determine_corner_side(
    draft: WallSegmentDraft, point: tuple[float, float]
) -> Literal["left", "right"]:
    """Return 'left' if the junction point matches the segment's polyline[0],
    'right' if it matches polyline[-1], else 'left' as fallback."""
    if not draft.plan_polyline:
        return "left"
    poly = draft.plan_polyline
    if _points_close(point, poly[0]):
        return "left"
    if _points_close(point, poly[-1]):
        return "right"
    return "left"


def _find_wall_at_endpoint(
    enriched: dict,
    point: tuple[float, float],
    walls_by_id: dict[str, ParserWall],
) -> Optional[ParserWall]:
    """Find the wall in the segment whose start OR end is near the given point."""
    for wid in enriched["draft"].source_wall_ids:
        w = walls_by_id.get(wid)
        if w is None:
            continue
        if _points_close(w.start, point) or _points_close(w.end, point):
            return w
    return None


def _points_close(
    p1: tuple[float, float], p2: tuple[float, float]
) -> bool:
    """Two points are within JUNCTION_TOLERANCE_MM in both axes."""
    return (
        abs(p1[0] - p2[0]) <= JUNCTION_TOLERANCE_MM
        and abs(p1[1] - p2[1]) <= JUNCTION_TOLERANCE_MM
    )
