"""
Strategy A — `minimize_panels` — DESIGN.md §6.5.

Allows custom-width AP panels to minimise total panel count. For Vamshi-style
fillable lengths that exceed n×300mm by a small residual, Strategy A picks
`n = round(fillable / 300)` and distributes the residual evenly across the
n AP panels (each gets a custom width).

Trade-off vs Strategy B (DEFAULT minimize_cuts):
  - Strategy A: 0-1 fewer panels but every AP is a custom cut → poor stockability
  - Strategy B: 0-1 more panels but every AP is the standard 300mm → excellent stockability

Strategy A is for projects that prioritise minimum joint count over
stockability (e.g. spec-house with bulk-custom-fab supply). Default = B.

R5 INTEGRATED via _compute_envelope (same as Strategy B).
"""

from __future__ import annotations

from ..constants import (
    STANDARD_PANEL_CUT_LENGTH_MM,
    STANDARD_PANEL_WIDTH_MM,
)
from ..types import Panel, SplitInput, SplitResult
from ._common import (
    LabelCounter,
    _build_horizontal_bands,
    _build_panel,
    _compute_envelope,
    _distribute_widths_evenly,
    _emit_terminator_if_needed,
)


def split_minimize_panels(inp: SplitInput) -> SplitResult:
    """Run Strategy A on a SplitInput.

    The AP run uses `n = max(1, round(fillable / 300))` panels with widths
    distributed evenly (integer mm, leftmost bias for the fractional 1mm
    remainders).
    """
    label_counter = LabelCounter()
    w_std = STANDARD_PANEL_WIDTH_MM
    cut_len = STANDARD_PANEL_CUT_LENGTH_MM
    warnings: list[str] = []

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

    if fillable < 0:
        warnings.append(
            f"fillable={fillable:.1f}mm < 0 — segment too short; no AP panels emitted"
        )
        fillable = 0.0

    # ── Strategy A: pick n = round(fillable / w_std), at least 1 if fillable > 0 ─
    if fillable <= 0:
        n_ap = 0
    else:
        n_ap = max(1, round(fillable / w_std))

    widths = _distribute_widths_evenly(n_ap, fillable)
    for w in widths:
        vertical_panels.append(
            _build_panel(
                label=label_counter.next_s(),
                sku_type="AP",
                thickness_mm=inp.sku_thickness_mm,
                width_mm=w,
                cut_length_mm=cut_len,
                position_mm=cursor,
                orientation="vertical",
            )
        )
        cursor += w

    # ── Last reservation OR CTC terminator OR nothing (R5 external) ───
    terminator_panels = _emit_terminator_if_needed(
        emit_terminator=env.emit_terminator,
        last_panel_reservation=inp.last_panel_reservation,
        sku_thickness_mm=inp.sku_thickness_mm,
        cursor=cursor,
        label_counter=label_counter,
    )
    vertical_panels.extend(terminator_panels)

    # ── Horizontal bands ──────────────────────────────────────────────
    horizontals = _build_horizontal_bands(
        thickness_mm=inp.sku_thickness_mm,
        segment_length_mm=inp.segment_length_mm,
    )

    all_panels = horizontals + vertical_panels
    return SplitResult(
        panels=tuple(all_panels),
        strategy_used="minimize_panels",
        warnings=tuple(warnings),
    )
