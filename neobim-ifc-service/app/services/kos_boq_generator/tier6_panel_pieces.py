"""Tier 6 — Per-panel-piece (most granular tier).

Algorithm: 1:1 pass-through from mapper Panel → Tier6PanelPiece.

Sources:

* 02_ALGORITHMS.md Problem 1
* ASSUMPTION-BOQ-11: preserves mapper panel order (no sorting; mapper's order
  is canonical for shop-drawing rendering and downstream review)
* POLICY-CUSTOM-QUOTE-SEPARATE: skips ``is_custom_order=True`` segments
* Anti-pattern #2: pass through pre-computed area/weight/price; never recompute

Mapper field-name mapping (confirmed via Pre-flight B):

* ``panel.label``     → BOQ ``panel_label``
* ``panel.sku``       → BOQ ``sku_code``
* (other fields share names: position_mm, cut_length_mm, width_mm,
  is_cut_member, area_sqft, weight_kg, price_inr)

Pure function. No I/O. No mutation of inputs. No global state. Deterministic.
"""

from __future__ import annotations

from app.services.kos_panel_grid_mapper.types import (
    Panel,
    PanelGridMapperOutput,
)

from .types import Tier6PanelPiece


def build_tier6_panel_pieces(
    mapper_output: PanelGridMapperOutput,
) -> tuple[Tier6PanelPiece, ...]:
    """Build Tier 6 panel pieces from a mapper output.

    Iterates ``mapper_output.wall_segments`` in order; for each non-custom
    segment, iterates its panels in order. Custom segments (``is_custom_order=
    True``) contribute zero panels.

    Order discipline (anti-pattern #1):
        Tier 6 output order = mapper segment iteration order
                            × within-segment panel iteration order
        NO re-sorting. The mapper's order is canonical.

    Parameters
    ----------
    mapper_output:
        The full mapper output. Must be a frozen ``PanelGridMapperOutput``
        dataclass (validated by mapper-side invariants before reaching here).

    Returns
    -------
    tuple[Tier6PanelPiece, ...]
        One panel piece per emitted panel, in mapper order. Empty tuple
        when there are no non-custom panels.
    """
    pieces: list[Tier6PanelPiece] = []
    for seg in mapper_output.wall_segments:
        if seg.is_custom_order:
            # POLICY-CUSTOM-QUOTE-SEPARATE: custom segments have no panels
            # in the BOQ — their commercial info lives in custom_quote_items
            # (built by PR 4's custom_quote_handler).
            continue
        wall_id = seg.id
        for panel in seg.panels:
            pieces.append(_panel_to_tier6(panel, wall_id))
    return tuple(pieces)


def _panel_to_tier6(panel: Panel, wall_id: str) -> Tier6PanelPiece:
    """Convert a mapper ``Panel`` to a BOQ ``Tier6PanelPiece``.

    Field-name translation:

    * ``panel.label``     → ``panel_label``
    * ``panel.sku``       → ``sku_code``

    All numeric fields pass through verbatim (anti-pattern #2 — never
    recompute; mapper's IEEE-754 values are canonical).
    """
    return Tier6PanelPiece(
        wall_id=wall_id,
        panel_label=panel.label,
        sku_code=panel.sku,
        position_mm=panel.position_mm,
        cut_length_mm=panel.cut_length_mm,
        width_mm=panel.width_mm,
        is_cut_member=panel.is_cut_member,
        area_sqft=panel.area_sqft,
        weight_kg=panel.weight_kg,
        price_inr=panel.price_inr,
    )
