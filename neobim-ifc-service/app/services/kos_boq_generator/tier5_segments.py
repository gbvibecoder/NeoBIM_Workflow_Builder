"""Tier 5 — Per-wall-segment aggregation.

Sources:

* 02_ALGORITHMS.md Problem 2 (the heaviest algorithm in the BOQ pipeline)
* ASSUMPTION-BOQ-9: opening_type derivation heuristic from sill_height + width
* ASSUMPTION-BOQ-12: custom segments zero out priced fields
* POLICY-CUSTOM-QUOTE-SEPARATE: custom segments carry no panels, no price

Mapper field-name mapping (confirmed via Pre-flight B):

* ``seg.id``                   → BOQ ``wall_id``
* ``seg.inferred_application`` → BOQ ``application``
* ``seg.segment_cost_inr``     → BOQ ``segment_price_inr``
* ``req.wall_segment_id``      → matches by ``seg.id`` in custom-quote lookup
* Mapper does NOT have ``is_curved``/``curve_radius_mm`` → BOQ hardcodes
  ``False``/``None`` (anti-pattern #7)

Pure function. No I/O. No mutation of inputs. Deterministic.
"""

from __future__ import annotations

from app.services.kos_panel_grid_mapper.types import (
    Opening,
    Panel,
    PanelGridMapperOutput,
    WallSegment,
)

from .types import (
    BOQOpeningType,
    Tier4SKUDetail,
    Tier5SegmentOpening,
    Tier5WallSegment,
)

# Opening-type derivation thresholds (ASSUMPTION-BOQ-9):
#
# * sill_height_mm <  50mm  → "door"      (or "sliding_door" if wide)
# * sill_height_mm >= 50mm  → "window"
# * sill_height_mm is None  → "door"      (floor-level default; mapper Opening
#                                           today never produces None, but
#                                           defensive against future schema)
#
# Source: 01_SCHEMA.md §B.2 Tier5OpeningType + 02_ALGORITHMS.md §2.2
_DOOR_SILL_THRESHOLD_MM: float = 50.0
_SLIDING_DOOR_WIDTH_THRESHOLD_MM: float = 1500.0


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────


def build_tier5_segments(
    mapper_output: PanelGridMapperOutput,
) -> tuple[Tier5WallSegment, ...]:
    """Build Tier 5 wall-segment rows from a mapper output.

    Preserves ``mapper_output.wall_segments`` order (anti-pattern #1 spirit).
    Routes each segment to the standard or custom builder based on
    ``seg.is_custom_order``.

    Edge case (anti-pattern #20): empty input returns ``()``.

    Parameters
    ----------
    mapper_output:
        The full mapper output. Must be a frozen ``PanelGridMapperOutput``.

    Returns
    -------
    tuple[Tier5WallSegment, ...]
        One row per ``wall_segment``, in mapper order.
    """
    rows: list[Tier5WallSegment] = []
    for seg in mapper_output.wall_segments:
        if seg.is_custom_order:
            rows.append(_build_custom_tier5(seg, mapper_output))
        else:
            rows.append(_build_standard_tier5(seg, mapper_output))
    return tuple(rows)


# ──────────────────────────────────────────────────────────────────────────────
# Standard vs custom builders
# ──────────────────────────────────────────────────────────────────────────────


def _build_standard_tier5(
    seg: WallSegment,
    mapper_output: PanelGridMapperOutput,
) -> Tier5WallSegment:
    """Build the Tier 5 row for a non-custom (priced) segment.

    Field translations from mapper → BOQ:
        seg.id                    → wall_id
        seg.inferred_application  → application
        seg.segment_cost_inr      → segment_price_inr (NOTE: cost vs price naming)
    """
    converted_openings = tuple(_convert_opening(o) for o in seg.openings)
    sku_breakdown = _aggregate_skus_in_segment(seg.panels)

    return Tier5WallSegment(
        wall_id=seg.id,
        system=seg.system,
        application=seg.inferred_application,
        length_mm=seg.length_mm,
        height_mm=seg.height_mm,
        is_custom_order=False,
        # Mapper does NOT have is_curved / curve_radius_mm fields today
        # (confirmed by Pre-flight B). Hardcode False/None (anti-pattern #7).
        # Future-proofed: when mapper adds these fields, this getattr would
        # need to switch to direct attribute access.
        is_curved=False,
        curve_radius_mm=None,
        area_sqft=seg.area_sqft,
        panel_count=len(seg.panels),
        openings=converted_openings,
        sku_breakdown=sku_breakdown,
        # Mapper's segment_cost_inr maps to BOQ's segment_price_inr
        # (different naming convention between layers).
        segment_weight_kg=seg.segment_weight_kg,
        segment_price_inr=seg.segment_cost_inr,
        notes=_extract_notes_for_segment(seg, mapper_output),
    )


def _build_custom_tier5(
    seg: WallSegment,
    mapper_output: PanelGridMapperOutput,
) -> Tier5WallSegment:
    """Build the Tier 5 row for a custom segment (ASSUMPTION-BOQ-12).

    Custom segments zero out priced fields:

    * ``panel_count=0``
    * ``segment_weight_kg=0.0``
    * ``segment_price_inr=0.0``
    * ``sku_breakdown=()``
    * ``openings=()``

    But STILL carry geometry (length_mm, height_mm, area_sqft) and the
    custom-quote reason in ``notes`` for sales handoff.

    Even though mapper sets ``system`` for custom segments (e.g. "K6-180"),
    we override to "CUSTOM" in the BOQ Tier 5 row — the BOQ contract is that
    custom rows surface as ``system="CUSTOM"`` regardless of mapper's
    classification (POLICY-CUSTOM-QUOTE-SEPARATE).
    """
    return Tier5WallSegment(
        wall_id=seg.id,
        system="CUSTOM",
        application=seg.inferred_application,
        length_mm=seg.length_mm,
        height_mm=seg.height_mm,
        is_custom_order=True,
        is_curved=False,
        curve_radius_mm=None,
        # Custom segments STILL need area for quote reference (anti-pattern #22).
        area_sqft=seg.area_sqft,
        panel_count=0,
        openings=(),
        sku_breakdown=(),
        segment_weight_kg=0.0,
        segment_price_inr=0.0,
        notes=_extract_custom_reason_notes(seg, mapper_output),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Opening conversion + type derivation
# ──────────────────────────────────────────────────────────────────────────────


def _convert_opening(o: Opening) -> Tier5SegmentOpening:
    """Convert mapper ``Opening`` → BOQ ``Tier5SegmentOpening`` with derived type.

    Anti-pattern #3: mapper.Opening and BOQ.Tier5SegmentOpening are
    DIFFERENT types; explicit conversion required.

    Anti-pattern #29: trust mapper's PR-HOTFIX-2 sort guarantee
    (openings within a segment are emitted in position order by the mapper).
    No additional sorting performed here.
    """
    return Tier5SegmentOpening(
        position_mm=o.position_mm,
        width_mm=o.width_mm,
        height_mm=o.height_mm,
        sill_height_mm=o.sill_height_mm,
        opening_type=_derive_opening_type(o.sill_height_mm, o.width_mm),
    )


def _derive_opening_type(
    sill_height_mm: float | None,
    width_mm: float,
) -> BOQOpeningType:
    """Derive opening type from sill height and width.

    Source: ASSUMPTION-BOQ-9.

    Rules (anti-pattern #4: must handle all boundary cases):

    * ``sill_height_mm`` is None or < 50mm → "door"
      - if width > 1500mm → "sliding_door"
    * ``sill_height_mm`` >= 50mm → "window"

    Examples
    --------
    >>> _derive_opening_type(0.0, 900.0)
    'door'
    >>> _derive_opening_type(49.9, 900.0)
    'door'
    >>> _derive_opening_type(50.0, 900.0)
    'window'
    >>> _derive_opening_type(0.0, 1800.0)
    'sliding_door'
    >>> _derive_opening_type(None, 900.0)
    'door'
    >>> _derive_opening_type(1000.0, 1500.0)
    'window'
    """
    if sill_height_mm is None or sill_height_mm < _DOOR_SILL_THRESHOLD_MM:
        if width_mm > _SLIDING_DOOR_WIDTH_THRESHOLD_MM:
            return "sliding_door"
        return "door"
    return "window"


# ──────────────────────────────────────────────────────────────────────────────
# Per-segment SKU breakdown (anti-pattern #5: NOT project-wide)
# ──────────────────────────────────────────────────────────────────────────────


def _aggregate_skus_in_segment(
    panels: tuple[Panel, ...],
) -> tuple[Tier4SKUDetail, ...]:
    """Build per-segment SKU rollup from ONLY this segment's panels.

    Anti-pattern #5: this MUST NOT be the project-wide Tier 4 list. Each
    segment has its own sku_breakdown computed from its own panels.

    Groups panels by ``sku``, sorts groups lexicographically (matching the
    project-wide ASSUMPTION-BOQ-13 ordering), delegates row construction to
    ``tier4_sku_details._build_tier4_for_panel_group``.
    """
    if not panels:
        return ()

    by_sku: dict[str, list[Panel]] = {}
    for p in panels:
        by_sku.setdefault(p.sku, []).append(p)

    # Package-internal cross-module import (legitimate per DESIGN.md §7.8
    # dependency DAG). Tier 4 module provides the canonical row builder so
    # Tier 5's sku_breakdown rows are byte-equal to the project-wide Tier 4.
    from .tier4_sku_details import _build_tier4_for_panel_group

    rows = [
        _build_tier4_for_panel_group(sku_code, sku_panels)
        for sku_code, sku_panels in sorted(by_sku.items())
    ]
    return tuple(rows)


# ──────────────────────────────────────────────────────────────────────────────
# Notes extraction (warnings + custom-quote reason joining)
# ──────────────────────────────────────────────────────────────────────────────


def _extract_notes_for_segment(
    seg: WallSegment,
    mapper_output: PanelGridMapperOutput,
) -> str:
    """Notes for a standard segment.

    Concatenates any mapper-output-level warnings that mention this segment's
    wall_id. Empty string when no warnings reference this segment (most
    common case for clean inputs like P_INT_8).
    """
    matching = [w for w in mapper_output.warnings if seg.id in w]
    return " | ".join(matching)


def _extract_custom_reason_notes(
    seg: WallSegment,
    mapper_output: PanelGridMapperOutput,
) -> str:
    """Notes for a custom segment.

    Anti-pattern #19: a wall_id might match multiple custom-quote requests
    (defensive against future mapper changes — today mapper guarantees one,
    but we don't depend on that). Join all matching reasons with " | ".

    Fallback when no requests match: "custom" (should never happen if
    is_custom_order=True implies at least one matching request, but
    defensive against drift).
    """
    matches = [
        req.reason or ""
        for req in mapper_output.custom_quote_requests
        if req.wall_segment_id == seg.id
    ]
    if not matches:
        return "custom"
    return " | ".join(m for m in matches if m)
