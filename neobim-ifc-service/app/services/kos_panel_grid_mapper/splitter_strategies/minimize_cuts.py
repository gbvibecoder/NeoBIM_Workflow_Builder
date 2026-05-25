"""
Strategy B — `minimize_cuts` — DEFAULT splitter strategy. DESIGN.md §6.5.

Uses ONLY standard 300mm-wide panels except for narrow residual infill.
Maximises stockability + site-fit certainty at the cost of 1-2 extra panels
vs Strategy A. Justified as DEFAULT per POLICY-DEFAULT-STRATEGY-B
(stockability, site-fit risk, reorderability).

R5 INTEGRATED: external segments without a corner reservation use
`neighbour_covered_left_mm` as the cursor offset (rather than emitting an
ECM default). Logic lives in `_common._compute_envelope`.

Residual thresholds (DESIGN §6.5):
  - residual ≤ 50mm     → absorbed (joint engagement)
  - 50 < residual ≤ 250mm → one narrow CTC infill panel at custom width
  - residual > 250mm    → add one standard AP panel (round-up), absorb the
                          new (smaller) residual
"""

from __future__ import annotations

from ..constants import (
    SPLITTER_RESIDUAL_DROP_THRESHOLD_MM,
    SPLITTER_RESIDUAL_INFILL_THRESHOLD_MM,
    STANDARD_PANEL_CUT_LENGTH_MM,
    STANDARD_PANEL_WIDTH_MM,
)
from ..types import Panel, SplitInput, SplitResult
from ._common import (
    LabelCounter,
    _build_horizontal_bands,
    _build_panel,
    _compute_envelope,
    _emit_terminator_if_needed,
)


def split_minimize_cuts(inp: SplitInput) -> SplitResult:
    """Run Strategy B on a SplitInput. Returns SplitResult with ordered panels
    (HB1, HB2, then verticals left-to-right) + strategy tag + warnings."""
    label_counter = LabelCounter()
    w_std = STANDARD_PANEL_WIDTH_MM
    cut_len = STANDARD_PANEL_CUT_LENGTH_MM
    warnings: list[str] = []

    # ── Common envelope (first reservation + last accounting, R5) ─────
    env = _compute_envelope(
        segment_length_mm=inp.segment_length_mm,
        sku_thickness_mm=inp.sku_thickness_mm,
        application=inp.application,
        first_panel_reservation=inp.first_panel_reservation,
        last_panel_reservation=inp.last_panel_reservation,
        neighbour_covered_left_mm=inp.neighbour_covered_left_mm,
        neighbour_covered_right_mm=inp.neighbour_covered_right_mm,
        label_counter=label_counter,
    )
    warnings.extend(env.warnings)

    vertical_panels: list[Panel] = list(env.initial_panels)
    cursor = env.cursor
    fillable = env.fillable_mm

    # ── Sanity: fillable < 0 means first+last reservations exceed wall length ─
    if fillable < 0:
        warnings.append(
            f"fillable={fillable:.1f}mm < 0 — segment too short for "
            f"first+last reservations. No AP panels emitted; flag for review."
        )
        fillable = 0.0

    # ── AP standard panels (loop on whole-300mm units) ────────────────
    n_full = int(fillable // w_std)
    residual = fillable - n_full * w_std

    for _ in range(n_full):
        vertical_panels.append(
            _build_panel(
                label=label_counter.next_s(),
                sku_type="AP",
                thickness_mm=inp.sku_thickness_mm,
                width_mm=w_std,
                cut_length_mm=cut_len,
                position_mm=cursor,
                orientation="vertical",
            )
        )
        cursor += w_std

    # ── Residual handling per DESIGN §6.5 ─────────────────────────────
    if residual <= SPLITTER_RESIDUAL_DROP_THRESHOLD_MM:
        # ≤ 50mm: absorbed by joint engagement; no panel emitted.
        pass
    elif residual <= SPLITTER_RESIDUAL_INFILL_THRESHOLD_MM:
        # 50 < residual ≤ 250: emit one narrow CTC infill at custom width.
        # PR-HOTFIX-1: cursor must advance by the SAME int-rounded width as
        # the panel itself, otherwise the next panel's position_mm and
        # the previous panel's right edge can disagree by a sub-millimetre
        # — surfacing as C-3 "overlapping vertical panels" on short
        # segments where the float residual rounds to ±0.5mm.
        infill_width = int(round(residual))
        vertical_panels.append(
            _build_panel(
                label=label_counter.next_s(),
                sku_type="CTC",
                thickness_mm=inp.sku_thickness_mm,
                width_mm=infill_width,
                cut_length_mm=cut_len,
                position_mm=cursor,
                orientation="vertical",
            )
        )
        cursor += infill_width
    else:
        # > 250: round-up to one more standard AP, absorb the smaller new residual.
        vertical_panels.append(
            _build_panel(
                label=label_counter.next_s(),
                sku_type="AP",
                thickness_mm=inp.sku_thickness_mm,
                width_mm=w_std,
                cut_length_mm=cut_len,
                position_mm=cursor,
                orientation="vertical",
            )
        )
        cursor += w_std

    # ── Last reservation OR CTC terminator OR nothing (R5 external) ───
    terminator_panels = _emit_terminator_if_needed(
        emit_terminator=env.emit_terminator,
        last_panel_reservation=inp.last_panel_reservation,
        sku_thickness_mm=inp.sku_thickness_mm,
        cursor=cursor,
        label_counter=label_counter,
    )
    vertical_panels.extend(terminator_panels)

    # ── Horizontal bands (BT bottom, TC top, full wall length) ────────
    horizontals = _build_horizontal_bands(
        thickness_mm=inp.sku_thickness_mm,
        segment_length_mm=inp.segment_length_mm,
    )

    # ── Assemble: HB1, HB2, then vertical panels in position order ────
    all_panels = horizontals + vertical_panels

    return SplitResult(
        panels=tuple(all_panels),
        strategy_used="minimize_cuts",
        warnings=tuple(warnings),
    )
