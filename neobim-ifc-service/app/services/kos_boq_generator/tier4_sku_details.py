"""Tier 4 — Per-SKU detail (project-wide grouping).

Sources:

* 02_ALGORITHMS.md Problem 3
* ASSUMPTION-BOQ-13: lexicographic ``sku_code`` ordering
* B-7 invariant (PR 4 will validate): ``line_total_X == Σ panel.X`` —
  per-panel sum, NOT ``quantity × unit_X``. (See "Variable-width CTC reality"
  below — anti-pattern #9 was based on a wrong simplification.)

Variable-width CTC reality (discovered in PR 2 via 90VR-MR live mapper run):

The mapper emits CTC panels (corner / connector / terminator filler) with
the same ``sku_code`` (e.g. ``"CTC155-2998"``) but **variable widths**
(108mm to 533mm observed on 90VR-MR). CTC panels are residual fillers; the
SKU code only encodes thickness and cut_length, NOT width.

3 of 112 unique SKUs on 90VR-MR have this property (CTC110-2998 / CTC155-2998
/ CTC200-2998). The fix:

* ``line_total_X`` = ``sum(panel.X for panel in panels)`` — correct for
  variable widths.
* ``unit_X`` = ``panels[0].X`` — representative "first panel" value; not a
  precise multiplier when widths vary. Documented as a known soft-spec.

For consistent-dimension SKUs (109/112 on 90VR), ``sum`` and
``quantity × unit`` are bit-identical in IEEE-754 (verified empirically on
P_INT_8), so the P_INT_8 golden reproduction is unaffected.

Description-format contract (anti-pattern #12):

    "{prefix}{thickness} {description_from_map}, {cut_length}mm cut"

Where ``description_from_map`` comes from ``SKU_PREFIX_DESCRIPTIONS`` re-export
from PR 1's ``constants.py``. The format is locked by PR 1's
``p_int_8_boq_canonical.json`` (verified by pre-flight A) and CANNOT change
without updating the golden in lockstep.

Pure function. No I/O. No mutation of inputs. Deterministic.
"""

from __future__ import annotations

import re
from typing import Sequence

from app.services.kos_panel_grid_mapper.types import Panel

from .constants import (
    AREA_TOLERANCE_SQFT,
    INR_TOLERANCE_RUPEES,
    KG_TOLERANCE,
    SKU_PREFIX_DESCRIPTIONS,
)
from .exceptions import BOQInvariantError
from .types import Tier4SKUDetail, Tier6PanelPiece

# Anti-pattern #10: regex extraction. CTC110-2998 has 3-letter prefix —
# ``[:2]`` slice would extract "CT" and miss the C. The regex matches
# one-or-more uppercase letters followed by a digit (start of thickness).
_SKU_PREFIX_RE: re.Pattern[str] = re.compile(r"^([A-Z]+)\d")

# PR 1 ``constants.SKU_PREFIX_DESCRIPTIONS`` is a tuple-of-pairs (anti-pattern #2);
# build an O(1) lookup dict once at module load.
_DESCRIPTION_LOOKUP: dict[str, str] = dict(SKU_PREFIX_DESCRIPTIONS)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────


def build_tier4_sku_details(
    tier6_panels: tuple[Tier6PanelPiece, ...],
) -> tuple[Tier4SKUDetail, ...]:
    """Build Tier 4 from a project-wide Tier 6 panel list.

    Groups panels by full ``sku_code`` (anti-pattern #8: NOT by prefix —
    AP155-2998 and AP200-2998 are separate Tier 4 rows). Sorts rows
    lexicographically by ``sku_code`` for deterministic output.

    Edge case (anti-pattern #20): empty input returns ``()``.

    Parameters
    ----------
    tier6_panels:
        Project-wide list of Tier 6 panel pieces (typically from
        ``build_tier6_panel_pieces``).

    Returns
    -------
    tuple[Tier4SKUDetail, ...]
        One row per unique ``sku_code``, sorted lexicographically.
    """
    if not tier6_panels:
        return ()

    by_sku: dict[str, list[Tier6PanelPiece]] = {}
    for p in tier6_panels:
        by_sku.setdefault(p.sku_code, []).append(p)

    rows = [
        _build_tier4_for_tier6_group(sku_code, panels)
        for sku_code, panels in by_sku.items()
    ]
    # ASSUMPTION-BOQ-13: lexicographic sort by sku_code.
    return tuple(sorted(rows, key=lambda r: r.sku_code))


# ──────────────────────────────────────────────────────────────────────────────
# Group → row helpers (Tier 6 + Panel variants share construction)
# ──────────────────────────────────────────────────────────────────────────────


def _build_tier4_for_tier6_group(
    sku_code: str,
    panels: Sequence[Tier6PanelPiece],
) -> Tier4SKUDetail:
    """Build a single Tier 4 row from a SKU group of Tier 6 panels.

    Per-panel sum for line totals (not quantity × unit) — handles variable
    widths in CTC SKU groups (see module docstring).
    """
    if not panels:
        raise BOQInvariantError(
            f"Cannot build Tier 4 row for empty Tier6PanelPiece group: {sku_code}",
            invariant_id="EMPTY_SKU_GROUP",
        )
    quantity = len(panels)
    first = panels[0]
    return _construct_tier4_row(
        sku_code=sku_code,
        quantity=quantity,
        unit_area=first.area_sqft,
        unit_weight=first.weight_kg,
        unit_price=first.price_inr,
        line_total_area=sum(p.area_sqft for p in panels),
        line_total_weight=sum(p.weight_kg for p in panels),
        line_total_price=sum(p.price_inr for p in panels),
    )


def _build_tier4_for_panel_group(
    sku_code: str,
    panels: Sequence[Panel],
) -> Tier4SKUDetail:
    """Build a single Tier 4 row from a SKU group of mapper ``Panel`` objects.

    Package-internal helper (underscore-prefixed); called from
    ``tier5_segments._aggregate_skus_in_segment``. Cross-module imports
    within this package are legitimate per ``DESIGN.md §7.8`` dependency DAG.

    Per-panel sum for line totals (not quantity × unit) — handles variable
    widths in CTC SKU groups (see module docstring).
    """
    if not panels:
        raise BOQInvariantError(
            f"Cannot build Tier 4 row for empty Panel group: {sku_code}",
            invariant_id="EMPTY_SKU_GROUP",
        )
    quantity = len(panels)
    first = panels[0]
    return _construct_tier4_row(
        sku_code=sku_code,
        quantity=quantity,
        unit_area=first.area_sqft,
        unit_weight=first.weight_kg,
        unit_price=first.price_inr,
        line_total_area=sum(p.area_sqft for p in panels),
        line_total_weight=sum(p.weight_kg for p in panels),
        line_total_price=sum(p.price_inr for p in panels),
    )


def _construct_tier4_row(
    *,
    sku_code: str,
    quantity: int,
    unit_area: float,
    unit_weight: float,
    unit_price: float,
    line_total_area: float,
    line_total_weight: float,
    line_total_price: float,
) -> Tier4SKUDetail:
    """Single source of truth for Tier 4 row construction.

    Line totals are PER-PANEL SUMS (passed in by caller). For consistent-
    dimension SKUs (e.g. AP, BT, TC at fixed 300mm width), sum equals
    quantity × unit bit-identically. For variable-width SKUs (CTC variants),
    sum is the only correct line total.

    Anti-pattern #9 was originally based on a wrong assumption that all
    panels with the same SKU share dimensions. 90VR-MR live data
    invalidated that — see module docstring "Variable-width CTC reality".
    """
    prefix, thickness_mm = _parse_sku_components(sku_code)
    return Tier4SKUDetail(
        sku_code=sku_code,
        sku_prefix=prefix,
        thickness_mm=thickness_mm,
        description=_synthesize_description(sku_code),
        quantity=quantity,
        unit_area_sqft=unit_area,
        unit_weight_kg=unit_weight,
        unit_price_inr=unit_price,
        line_total_area_sqft=line_total_area,
        line_total_weight_kg=line_total_weight,
        line_total_price_inr=line_total_price,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Validation helpers (raise BOQInvariantError on mapper drift)
# ──────────────────────────────────────────────────────────────────────────────


def _validate_unit_consistency(
    sku_code: str,
    panels: Sequence,
    panel_kind: str,
) -> None:
    """Verify all panels in a SKU group have identical unit numerics.

    Mapper guarantees this (all panels with same ``sku`` are constructed from
    the same per-thickness rates). If mapper drift breaks this assumption,
    Tier 4 row construction is ambiguous (which unit value to use?). Raise
    eagerly with diagnostic detail.

    Tolerances use PR 1's locked constants (no magic numbers — anti-pattern #21).
    """
    if not panels:
        raise BOQInvariantError(
            f"Cannot build Tier 4 row for empty {panel_kind} group: {sku_code}",
            invariant_id="EMPTY_SKU_GROUP",
        )

    first = panels[0]
    for i, p in enumerate(panels[1:], start=1):
        if abs(p.area_sqft - first.area_sqft) > AREA_TOLERANCE_SQFT:
            raise BOQInvariantError(
                f"Inconsistent area within sku_code={sku_code!r}: "
                f"panel[0]={first.area_sqft}, panel[{i}]={p.area_sqft}",
                invariant_id="UNIT_VALUE_DRIFT",
                hint="Mapper invariant: all panels sharing an sku_code must "
                     "have identical area_sqft. Check mapper-side regression.",
            )
        if abs(p.weight_kg - first.weight_kg) > KG_TOLERANCE:
            raise BOQInvariantError(
                f"Inconsistent weight within sku_code={sku_code!r}: "
                f"panel[0]={first.weight_kg}, panel[{i}]={p.weight_kg}",
                invariant_id="UNIT_VALUE_DRIFT",
            )
        if abs(p.price_inr - first.price_inr) > INR_TOLERANCE_RUPEES:
            raise BOQInvariantError(
                f"Inconsistent price within sku_code={sku_code!r}: "
                f"panel[0]={first.price_inr}, panel[{i}]={p.price_inr}",
                invariant_id="UNIT_VALUE_DRIFT",
            )


# ──────────────────────────────────────────────────────────────────────────────
# SKU parsing + description synthesis
# ──────────────────────────────────────────────────────────────────────────────


def _parse_sku_components(sku_code: str) -> tuple[str, int]:
    """Parse SKU code into ``(prefix, thickness_mm)``.

    Anti-pattern #10: regex match for the prefix (handles 2- and 3-letter
    prefixes like "AP" and "CTC").
    Anti-pattern #13: ``int()`` cast raises ``ValueError`` on malformed input
    — wrap into ``BOQInvariantError`` for stable callable contract.

    Examples
    --------
    >>> _parse_sku_components("AP155-2998")
    ('AP', 155)
    >>> _parse_sku_components("CTC110-2998")
    ('CTC', 110)
    >>> _parse_sku_components("BT110-2101")
    ('BT', 110)
    """
    match = _SKU_PREFIX_RE.match(sku_code)
    if not match:
        raise BOQInvariantError(
            f"Cannot extract prefix from sku_code={sku_code!r}",
            invariant_id="SKU_FORMAT",
        )
    prefix = match.group(1)

    parts = sku_code.split("-")
    # Mapper's sku format is "{PFX}{THICKNESS}-{CUT_LENGTH}" — exactly 2 parts.
    # 3-part case "{PFX}{THICKNESS}-{CUT_LENGTH}-CUT" exists for cut members;
    # accept 2 or 3 parts.
    if len(parts) not in (2, 3):
        raise BOQInvariantError(
            f"Invalid sku_code format: {sku_code!r} "
            f"(expected '{{PFX}}{{THICKNESS}}-{{CUT_LENGTH}}' "
            f"or '{{PFX}}{{THICKNESS}}-{{CUT_LENGTH}}-CUT')",
            invariant_id="SKU_FORMAT",
        )

    thickness_str = parts[0][len(prefix):]
    if not thickness_str:
        raise BOQInvariantError(
            f"Missing thickness in sku_code={sku_code!r}",
            invariant_id="SKU_FORMAT",
        )
    try:
        thickness_mm = int(thickness_str)
    except ValueError as exc:
        raise BOQInvariantError(
            f"Cannot parse thickness from sku_code={sku_code!r}: {exc}",
            invariant_id="SKU_FORMAT",
        ) from exc

    return prefix, thickness_mm


def _extract_sku_prefix(sku_code: str) -> str:
    """Extract prefix only (test-friendly wrapper)."""
    return _parse_sku_components(sku_code)[0]


def _extract_thickness_from_sku(sku_code: str) -> int:
    """Extract thickness only (test-friendly wrapper)."""
    return _parse_sku_components(sku_code)[1]


def _synthesize_description(sku_code: str) -> str:
    """Build human-readable description from SKU code.

    Format (locked by PR 1 golden, verified via pre-flight A)::

        "{PREFIX}{THICKNESS} {description_from_map}, {CUT_LENGTH}mm cut"

    Examples (matching PR 1 golden exactly)::

        AP110-2998  → "AP110 vertical panel (standard stretcher), 2998mm cut"
        BT110-2101  → "BT110 bottom track (horizontal), 2101mm cut"
        TC110-2101  → "TC110 top cap (horizontal), 2101mm cut"
        CTC110-2998 → "CTC110 connector / corner / terminator, 2998mm cut"
        ECM110-2998 → "ECM110 end cap male, 2998mm cut"

    Falls back gracefully when prefix is unknown — uses raw prefix as
    description ("XX{THICKNESS} XX, {LEN}mm cut") rather than crashing.

    Note: handles 3-part SKU codes for cut members (e.g. "AP155-1500-CUT")
    by using only the first length segment for the description.
    """
    try:
        prefix, thickness_mm = _parse_sku_components(sku_code)
    except BOQInvariantError:
        # Defensive fallback — should never reach here in practice since
        # _construct_tier4_row already called _parse_sku_components.
        return sku_code

    parts = sku_code.split("-")
    length_str = parts[1]
    role_description = _DESCRIPTION_LOOKUP.get(prefix, prefix)
    # Format matches PR 1 golden: "AP110 vertical panel (standard stretcher), 2998mm cut"
    return f"{prefix}{thickness_mm} {role_description}, {length_str}mm cut"
