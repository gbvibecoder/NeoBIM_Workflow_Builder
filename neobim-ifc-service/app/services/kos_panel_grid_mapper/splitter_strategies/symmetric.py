"""
Strategy C — `symmetric` — DESIGN.md §6.5.

Places residual width symmetrically at both ENDS of the AP run (the first
and last AP panels get widened equally). Middle APs stay at the standard
300mm width.

Trade-off vs Strategy B (DEFAULT):
  - Strategy B: all APs at 300mm + 1 narrow CTC tail (asymmetric)
  - Strategy C: all APs at 300mm except 2 widened ends (visually symmetric)

For projects that prioritise visual balance (e.g. feature walls, exposed
showroom installs), Strategy C produces a mirror-symmetric layout. For
default residential, B is more stockable.

R5 INTEGRATED via _compute_envelope (same as Strategies A + B).

Edge cases:
  - n_full == 0 (fillable < 300): emit one panel at fillable width if
                                   residual > absorb_threshold, else nothing
  - n_full == 1: one AP at full fillable width
  - n_full ≥ 2: half-residual at each end, middle at 300mm
"""

from __future__ import annotations

from ..constants import (
    SPLITTER_RESIDUAL_DROP_THRESHOLD_MM,
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


def split_symmetric(inp: SplitInput) -> SplitResult:
    """Run Strategy C on a SplitInput. Half-residual at each AP-run end."""
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

    n_full = int(fillable // w_std)
    residual_total = fillable - n_full * w_std

    # ── Distribute residual symmetrically ─────────────────────────────
    if n_full == 0:
        # Tiny fillable: emit one panel at fillable width IF above absorb threshold.
        if residual_total > SPLITTER_RESIDUAL_DROP_THRESHOLD_MM:
            vertical_panels.append(
                _build_panel(
                    label=label_counter.next_s(),
                    sku_type="CTC",
                    thickness_mm=inp.sku_thickness_mm,
                    width_mm=int(round(residual_total)),
                    cut_length_mm=cut_len,
                    position_mm=cursor,
                    orientation="vertical",
                )
            )
            cursor += residual_total
    elif n_full == 1:
        # One AP carrying the whole fillable.
        actual_w = int(round(fillable))
        vertical_panels.append(
            _build_panel(
                label=label_counter.next_s(),
                sku_type="AP",
                thickness_mm=inp.sku_thickness_mm,
                width_mm=actual_w,
                cut_length_mm=cut_len,
                position_mm=cursor,
                orientation="vertical",
            )
        )
        cursor += actual_w
    else:
        # n_full ≥ 2: half-residual at each end, middle (n_full - 2) at 300mm.
        residual_int = int(round(residual_total))
        extra_left = (residual_int + 1) // 2     # leftmost bias for odd extras
        extra_right = residual_int // 2
        first_w = w_std + extra_left
        last_w = w_std + extra_right
        middle_count = n_full - 2

        # Place leftmost end-biased AP.
        vertical_panels.append(
            _build_panel(
                label=label_counter.next_s(),
                sku_type="AP",
                thickness_mm=inp.sku_thickness_mm,
                width_mm=first_w,
                cut_length_mm=cut_len,
                position_mm=cursor,
                orientation="vertical",
            )
        )
        cursor += first_w

        # Place middle APs at standard 300mm.
        for _ in range(middle_count):
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

        # Place rightmost end-biased AP.
        vertical_panels.append(
            _build_panel(
                label=label_counter.next_s(),
                sku_type="AP",
                thickness_mm=inp.sku_thickness_mm,
                width_mm=last_w,
                cut_length_mm=cut_len,
                position_mm=cursor,
                orientation="vertical",
            )
        )
        cursor += last_w

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
        strategy_used="symmetric",
        warnings=tuple(warnings),
    )
