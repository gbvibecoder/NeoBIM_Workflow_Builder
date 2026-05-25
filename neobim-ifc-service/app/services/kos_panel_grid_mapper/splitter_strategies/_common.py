"""Shared helpers for the 3 splitter strategies (DESIGN §6.5).

Internals (underscored — not part of the package's public API):

  - LabelCounter:        per-segment S/V/HB sequence counters
  - _build_panel():      Panel constructor that:
                           - looks up SKU via build_sku_code (PR 2)
                           - computes raw_length per R6 (multi-piece long horizontals)
                           - fills numeric fields via compute_panel_metrics (PR 2)
  - _build_horizontal_bands():  emits HB1=BT and HB2=TC
  - _compute_envelope():        common first/last reservation accounting,
                                R5 INTEGRATED for external+None reservation
  - _distribute_widths_evenly(): integer-width distribution with leftmost bias
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from ..area_weight_calculator import compute_panel_metrics
from ..constants import (
    STANDARD_PANEL_CUT_LENGTH_MM,
    STANDARD_PANEL_RAW_HEIGHT_MM,
    STANDARD_PANEL_WIDTH_MM,
    SimpleApplication,
    SkuPrefix,
)
from ..sku_resolver import build_sku_code
from ..types import Panel, PanelReservation


# ──────────────────────────────────────────────────────────────────────────────
# LabelCounter — per-segment sequential label generation
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class LabelCounter:
    """Tracks S{n}, V{n}, HB{n} sequence numbers within a single segment.

    Mutable for in-function use; the splitter creates a fresh instance per
    call so determinism is preserved (no cross-call state).
    """

    s: int = 0
    v: int = 0
    hb: int = 0

    def next_s(self) -> str:
        self.s += 1
        return f"S{self.s}"

    def next_v(self) -> str:
        self.v += 1
        return f"V{self.v}"

    def next_hb(self) -> str:
        self.hb += 1
        return f"HB{self.hb}"


# ──────────────────────────────────────────────────────────────────────────────
# raw-length computation per R6 (multi-piece long horizontals)
# ──────────────────────────────────────────────────────────────────────────────


def _compute_raw_length_mm(cut_length_mm: int, orientation: str) -> int:
    """Return the raw stock length consumed by a panel.

    For VERTICAL panels: always STANDARD_PANEL_RAW_HEIGHT_MM (3048mm) — one
    stock piece per panel.

    For HORIZONTAL panels:
      - cut ≤ 3048: 3048 (one stock piece).
      - cut > 3048: ceil(cut / 3048) × 3048 (multi-piece, R6).
        Example: BT155-9370 → ceil(9370/3048) × 3048 = 4 × 3048 = 12192mm.
    """
    if orientation == "vertical":
        return STANDARD_PANEL_RAW_HEIGHT_MM
    # horizontal
    if cut_length_mm <= STANDARD_PANEL_RAW_HEIGHT_MM:
        return STANDARD_PANEL_RAW_HEIGHT_MM
    n_pieces = math.ceil(cut_length_mm / STANDARD_PANEL_RAW_HEIGHT_MM)
    return int(n_pieces * STANDARD_PANEL_RAW_HEIGHT_MM)


# ──────────────────────────────────────────────────────────────────────────────
# Panel construction helper
# ──────────────────────────────────────────────────────────────────────────────


def _build_panel(
    *,
    label: str,
    sku_type: SkuPrefix,
    thickness_mm: int,
    width_mm: int,
    cut_length_mm: int,
    position_mm: float,
    orientation: str = "vertical",
    is_cut_member: bool = False,
    cut_male_mm: float = 0.0,
    cut_female_mm: float = 0.0,
) -> Panel:
    """Construct a fully-populated Panel from primitives.

    Pulls SKU naming via build_sku_code() (PR 2). Pulls all numeric fields
    via compute_panel_metrics() (PR 2). raw_length_mm follows R6 rules.

    The Panel.thickness_mm field is `Literal[110, 155, 200]` — callers must
    only invoke this with standard catalog thicknesses (the splitter is
    never called for K6-180 / K8-250 / CUSTOM segments — those route to
    custom_quote_request at the orchestrator level).
    """
    raw_length_mm = _compute_raw_length_mm(cut_length_mm, orientation)
    sku = build_sku_code(sku_type, thickness_mm, cut_length_mm)
    metrics = compute_panel_metrics(
        cut_length_mm=cut_length_mm,
        raw_length_mm=raw_length_mm,
        width_mm=width_mm,
        thickness_mm=thickness_mm,
    )
    return Panel(
        label=label,
        sku=sku,
        type=sku_type,
        thickness_mm=thickness_mm,   # type: ignore[arg-type]
        width_mm=width_mm,
        cut_length_mm=cut_length_mm,
        raw_length_mm=raw_length_mm,
        position_mm=position_mm,
        orientation=orientation,     # type: ignore[arg-type]
        is_cut_member=is_cut_member,
        cut_male_mm=cut_male_mm,
        cut_female_mm=cut_female_mm,
        **metrics,
    )


def _build_panel_from_reservation(
    reservation: PanelReservation,
    *,
    position_mm: float,
    fallback_label: str,
    orientation: str = "vertical",
) -> Panel:
    """Build a Panel from a PanelReservation. Uses reservation.label if set,
    else the supplied fallback label."""
    label = reservation.label if reservation.label is not None else fallback_label
    return _build_panel(
        label=label,
        sku_type=reservation.sku_type,
        thickness_mm=reservation.sku_thickness_mm,
        width_mm=reservation.width_mm,
        cut_length_mm=reservation.cut_length_mm,
        position_mm=position_mm,
        orientation=orientation,
    )


def _build_horizontal_bands(
    *,
    thickness_mm: int,
    segment_length_mm: float,
) -> list[Panel]:
    """Emit HB1 = BT and HB2 = TC at full segment length, both at position 0.

    R6: if segment_length_mm > 3048, _compute_raw_length_mm returns
    ceil(L/3048) × 3048 (multi-piece raw stock).
    """
    cut_length_int = int(round(segment_length_mm))
    return [
        _build_panel(
            label="HB1",
            sku_type="BT",
            thickness_mm=thickness_mm,
            width_mm=STANDARD_PANEL_WIDTH_MM,
            cut_length_mm=cut_length_int,
            position_mm=0.0,
            orientation="horizontal",
        ),
        _build_panel(
            label="HB2",
            sku_type="TC",
            thickness_mm=thickness_mm,
            width_mm=STANDARD_PANEL_WIDTH_MM,
            cut_length_mm=cut_length_int,
            position_mm=0.0,
            orientation="horizontal",
        ),
    ]


# ──────────────────────────────────────────────────────────────────────────────
# Envelope computation — first/last reservation accounting (R5 INTEGRATED)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SplitEnvelope:
    """The pre-amble result shared by all 3 strategies: first vertical panels
    already emitted, cursor advance, last-reservation width, right-side covered
    region, fillable length, last-panel-action hint, warnings.
    """

    initial_panels: list[Panel]                # first reservation OR ECM default OR []
    cursor: float                              # position to start AP run
    last_reserve_width_mm: float               # width reserved for last panel (or covered region)
    right_covered_mm: float                    # neighbour-covered right (R5)
    fillable_mm: float                         # available length for AP fill
    emit_terminator: bool                      # True iff splitter should emit a CTC terminator at the end
    warnings: list[str]


def _compute_envelope(
    *,
    segment_length_mm: float,
    sku_thickness_mm: int,
    application: SimpleApplication,
    first_panel_reservation: Optional[PanelReservation],
    last_panel_reservation: Optional[PanelReservation],
    neighbour_covered_left_mm: float,
    neighbour_covered_right_mm: float,
    label_counter: LabelCounter,
) -> SplitEnvelope:
    """Compute the common splitter pre-amble.

    Handles 5 cases for each end (left + right) — order matters:
      1. reservation present:           emit reservation panel
      2. neighbour_covered_*_mm > 0:    R5 — neighbour owns this corner; use
                                        offset, emit no default panel. PR-HOTFIX-1
                                        widened this from external-only to
                                        application-agnostic because
                                        corner_handler sets covered_*_mm for
                                        ALL corners regardless of application.
      3. external + no covered:         cursor stays at 0 / right_covered = 0
      4. internal/etc + no covered, LEFT:  emit ECM default (ASSUMPTION-A13)
      5. internal/etc + no covered, RIGHT: reserve CTC terminator (ASSUMPTION-A14)

    Sub-corner-cover edge case (covered_left + covered_right > segment_length
    AND no reservations): segment is too short for the standard corner kit;
    emit a soft warning and return an empty envelope so the splitter emits
    only horizontal bands (no overflow). The C-1 invariant will still hard-fail
    on such segments until the orchestrator routes them to CustomQuoteRequest;
    that orchestrator change is outside this hotfix's scope (PR-HOTFIX-1 §3
    Phase B rules limit to splitter modules only). 90VR-MR/TC contain no
    sub-corner-cover segments (smallest = 834mm > 600mm standard cover sum),
    so this guard is forward-looking.
    """
    warnings: list[str] = []
    initial_panels: list[Panel] = []
    w_std = STANDARD_PANEL_WIDTH_MM
    cut_len = STANDARD_PANEL_CUT_LENGTH_MM
    cursor = 0.0

    # ── Short-segment envelope-overflow detection (PR-HOTFIX-1) ──────
    # Compute the MINIMUM contribution each end will consume under the
    # default branches that follow:
    #   LEFT:  reservation.width if reserved; else covered_left if >0;
    #          else 0 for external; else w_std (ECM default)
    #   RIGHT: reservation.width if reserved; else covered_right if >0;
    #          else 0 for external; else w_std (CTC terminator default)
    # If left_min + right_min > segment_length, the envelope's defaults
    # overflow. We resolve by emitting only the SACROSANCT panels
    # (reservations + covered offsets — those are authoritative) plus an
    # optional fitted CTC infill in the remaining usable room.
    #
    # If both reservations AND covered are 0 (e.g. external + no corners),
    # left_min + right_min is 0 and this branch never fires; the segment
    # is fully fillable by the standard AP loop.
    from ..constants import SPLITTER_RESIDUAL_DROP_THRESHOLD_MM

    left_min = (
        first_panel_reservation.width_mm if first_panel_reservation is not None
        else (
            neighbour_covered_left_mm if neighbour_covered_left_mm > 0
            else (0.0 if application == "external" else w_std)
        )
    )
    right_min = (
        last_panel_reservation.width_mm if last_panel_reservation is not None
        else (
            neighbour_covered_right_mm if neighbour_covered_right_mm > 0
            else (0.0 if application == "external" else w_std)
        )
    )

    if left_min + right_min > segment_length_mm + 0.5:
        # Sacrosanct widths = reservation width OR covered offset (zero if
        # the side's overhead is just the skippable default).
        sacro_left = (
            first_panel_reservation.width_mm if first_panel_reservation is not None
            else neighbour_covered_left_mm
        )
        sacro_right = (
            last_panel_reservation.width_mm if last_panel_reservation is not None
            else neighbour_covered_right_mm
        )
        usable = segment_length_mm - sacro_left - sacro_right

        # Emit sacrosanct panels + optional fitted CTC. Skip the default
        # ECM (left) and CTC terminator (right) — they're what's overflowing.
        cursor = 0.0

        # LEFT sacrosanct
        if first_panel_reservation is not None:
            fallback_lbl = label_counter.next_s()
            p = _build_panel_from_reservation(
                first_panel_reservation,
                position_mm=cursor,
                fallback_label=fallback_lbl,
            )
            initial_panels.append(p)
            cursor += first_panel_reservation.width_mm
            if first_panel_reservation.label is not None:
                label_counter.s -= 1
        elif neighbour_covered_left_mm > 0:
            cursor = neighbour_covered_left_mm

        # FITTED MIDDLE (only when there's room above the absorb threshold)
        if usable > SPLITTER_RESIDUAL_DROP_THRESHOLD_MM:
            width_mm = int(round(usable))
            fitted = _build_panel(
                label=label_counter.next_s(),
                sku_type="CTC",
                thickness_mm=sku_thickness_mm,
                width_mm=width_mm,
                cut_length_mm=cut_len,
                position_mm=cursor,
                orientation="vertical",
            )
            initial_panels.append(fitted)
            cursor += width_mm

        # RIGHT sacrosanct
        right_covered = 0.0
        if last_panel_reservation is not None:
            fallback_lbl = label_counter.next_v()
            p = _build_panel_from_reservation(
                last_panel_reservation,
                position_mm=cursor,
                fallback_label=fallback_lbl,
            )
            initial_panels.append(p)
            cursor += last_panel_reservation.width_mm
            if last_panel_reservation.label is not None:
                label_counter.v -= 1
        elif neighbour_covered_right_mm > 0:
            right_covered = neighbour_covered_right_mm

        # Warning surface: always include "segment too short" to satisfy
        # existing test asserts; include detailed diagnostics for operators.
        if usable > SPLITTER_RESIDUAL_DROP_THRESHOLD_MM:
            warnings.append(
                f"segment too short for envelope kit ({application}): "
                f"left_min({left_min:.0f}) + right_min({right_min:.0f}) = "
                f"{left_min + right_min:.0f}mm > segment_length_mm={segment_length_mm:.1f}. "
                f"Emitted sacrosanct + fitted CTC-{int(round(usable))} infill "
                f"(usable={usable:.1f}mm). Custom-quote review recommended."
            )
        else:
            warnings.append(
                f"sub-corner-cover (segment too short): "
                f"segment_length_mm={segment_length_mm:.1f}, "
                f"sacrosanct(left={sacro_left:.0f}, right={sacro_right:.0f}) "
                f"leaves usable={usable:.1f}mm ≤ "
                f"{SPLITTER_RESIDUAL_DROP_THRESHOLD_MM:.0f}mm absorb threshold — "
                f"no infill emitted. Recommend custom-quote review."
            )

        return SplitEnvelope(
            initial_panels=initial_panels,
            cursor=cursor,
            last_reserve_width_mm=0.0,
            right_covered_mm=right_covered,
            fillable_mm=0.0,
            emit_terminator=False,
            warnings=warnings,
        )

    # ── LEFT side ─────────────────────────────────────────────────────
    if first_panel_reservation is not None:
        # Emit the reserved panel (CP / PC / etc.) at cursor=0.
        fallback_lbl = label_counter.next_s()
        p = _build_panel_from_reservation(
            first_panel_reservation,
            position_mm=cursor,
            fallback_label=fallback_lbl,
        )
        initial_panels.append(p)
        cursor += first_panel_reservation.width_mm
        # If reservation had its own label (not None), don't consume label counter slot
        if first_panel_reservation.label is not None:
            # Rewind label counter: we burned a number we shouldn't have.
            label_counter.s -= 1
    elif neighbour_covered_left_mm > 0:
        # PR-HOTFIX-1: neighbour owns this segment's LEFT corner — skip the
        # default ECM emission and use the covered region as the cursor
        # offset. This branch fires regardless of `application` because
        # corner_handler sets covered_*_mm for all CORNER junctions
        # (internal-internal L-corners, internal-external corners, etc.).
        # Pre-hotfix, internal walls fell through to the ECM default which
        # double-counted the covered region against C-1.
        # Warning string keeps the "R5:" prefix unchanged — existing tests
        # depend on it. Application is substituted into the message so the
        # log surface still tells operators what kind of segment this was.
        cursor = neighbour_covered_left_mm
        warnings.append(
            f"R5: {application} segment, no first_panel_reservation; "
            f"starting cursor at neighbour_covered_left_mm={neighbour_covered_left_mm:.0f}mm"
        )
    elif application == "external":
        # External + no reservation + no covered → cursor stays at 0, no panel.
        # (Equivalent to setting cursor=neighbour_covered_left_mm=0 in the
        # pre-hotfix code; preserved here for symmetry with the other branches.)
        cursor = neighbour_covered_left_mm
    else:
        # Internal / basement / retaining + free left end → ECM default (ASSUMPTION-A13).
        p = _build_panel(
            label=label_counter.next_s(),
            sku_type="ECM",
            thickness_mm=sku_thickness_mm,
            width_mm=w_std,
            cut_length_mm=cut_len,
            position_mm=cursor,
            orientation="vertical",
        )
        initial_panels.append(p)
        cursor += w_std

    # ── RIGHT side accounting ──────────────────────────────────────────
    if last_panel_reservation is not None:
        last_reserve_width = float(last_panel_reservation.width_mm)
        right_covered = 0.0
        emit_terminator = False     # the reservation IS the terminator
    elif neighbour_covered_right_mm > 0:
        # PR-HOTFIX-1: neighbour owns this segment's RIGHT corner — no
        # terminator, use the covered offset for fillable accounting.
        # Mirror of the LEFT new branch above; same rationale.
        last_reserve_width = 0.0
        right_covered = neighbour_covered_right_mm
        emit_terminator = False
        warnings.append(
            f"R5: {application} segment, no last_panel_reservation; "
            f"reserving neighbour_covered_right_mm={neighbour_covered_right_mm:.0f}mm "
            f"for covered region"
        )
    elif application == "external":
        # External + no reservation + no covered → no terminator.
        last_reserve_width = 0.0
        right_covered = neighbour_covered_right_mm
        emit_terminator = False
    else:
        # Internal / basement / retaining + free right end → CTC terminator (ASSUMPTION-A14).
        last_reserve_width = float(w_std)
        right_covered = 0.0
        emit_terminator = True

    # ── Fillable region ───────────────────────────────────────────────
    fillable = segment_length_mm - cursor - last_reserve_width - right_covered

    return SplitEnvelope(
        initial_panels=initial_panels,
        cursor=cursor,
        last_reserve_width_mm=last_reserve_width,
        right_covered_mm=right_covered,
        fillable_mm=fillable,
        emit_terminator=emit_terminator,
        warnings=warnings,
    )


def _emit_terminator_if_needed(
    *,
    emit_terminator: bool,
    last_panel_reservation: Optional[PanelReservation],
    sku_thickness_mm: int,
    cursor: float,
    label_counter: LabelCounter,
) -> list[Panel]:
    """Emit the last-side panel(s): reservation (if present) or CTC terminator
    (if emit_terminator) or nothing (covered region for external)."""
    out: list[Panel] = []
    if last_panel_reservation is not None:
        fallback_lbl = label_counter.next_v()
        p = _build_panel_from_reservation(
            last_panel_reservation,
            position_mm=cursor,
            fallback_label=fallback_lbl,
        )
        out.append(p)
        if last_panel_reservation.label is not None:
            label_counter.v -= 1
    elif emit_terminator:
        # Vamshi convention: end-terminator is V1 (CTC at the wall's free end).
        out.append(
            _build_panel(
                label="V1",
                sku_type="CTC",
                thickness_mm=sku_thickness_mm,
                width_mm=STANDARD_PANEL_WIDTH_MM,
                cut_length_mm=STANDARD_PANEL_CUT_LENGTH_MM,
                position_mm=cursor,
                orientation="vertical",
            )
        )
    # else: external + covered → no panel emitted
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Width-distribution helper for Strategies A and C
# ──────────────────────────────────────────────────────────────────────────────


def _distribute_widths_evenly(n: int, total_mm: float) -> list[int]:
    """Distribute `total_mm` across `n` integer-width panels with leftmost
    bias for any 1mm fractional remainders.

    Used by Strategy A (minimize_panels) to spread fillable across all APs.

    Example: total=1501, n=5 → base=300, extras=1 → [301, 300, 300, 300, 300].
    """
    if n <= 0:
        return []
    total_int = int(round(total_mm))
    base = total_int // n
    extras = total_int - n * base
    return [base + (1 if i < extras else 0) for i in range(n)]
