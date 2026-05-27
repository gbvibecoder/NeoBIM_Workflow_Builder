"""Build Tier 1 project summary — 16 fields, quantities only.

Reference: 5F-DESIGN v2 doc 02 §15 (Problem 13 — Tier aggregation) +
PR 1 types.py Tier1FormworkSummary (16 fields, no commercial fields, no total_components).

All totals are computed as direct sums of Tier 5 wall_segment values (which already
have wastage applied per-wall by build_tier5_walls).

Fields:
   1. project_name                       (from mapper_output)
   2. quote_date                         (from context)
   3. total_wall_segments_with_bracing   (count walls where is_custom_order=False)
   4. total_corners_detected             (len(corners))
   5. total_props                        (sum of Tier 5)
   6. total_walers                       (sum of Tier 5)
   7. total_kickers                      (sum of Tier 5)
   8. total_diagonal_braces              (sum of Tier 5 total_diagonals — note field name)
   9. total_raker_props                  (sum of Tier 5)
  10. total_corner_clamps                (sum of Tier 5)
  11. total_base_plates                  (sum of Tier 5)
  12. total_prop_heads                   (sum of Tier 5)
  13. total_joint_gasket_meters          (round to 5 decimals)
  14. total_starter_track_meters         (round to 5 decimals)
  15. total_custom_quote_items           (len(custom_quote_items))
  16. operator_review_items_count        (len(operator_review_items))

🚨 Tier 5 field is `total_diagonals` (singular type, plural noun). Tier 1 field is
   `total_diagonal_braces` (verbose). Both refer to the same quantity.
"""
from __future__ import annotations

import logging
from typing import Tuple

from app.services.kos_formwork_generator.corner_counter import CornerDetection
from app.services.kos_formwork_generator.types import (
    FormworkContext,
    FormworkCustomQuoteRequest,
    FormworkOperatorReviewItem,
    Tier1FormworkSummary,
    Tier5FormworkWallSegment,
)
from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def build_tier1_project(
    mapper_output: PanelGridMapperOutput,
    context: FormworkContext,
    tier_5_wall_segments: Tuple[Tier5FormworkWallSegment, ...],
    corners: Tuple[CornerDetection, ...],
    custom_quote_items: Tuple[FormworkCustomQuoteRequest, ...] = (),
    operator_review_items: Tuple[FormworkOperatorReviewItem, ...] = (),
) -> Tier1FormworkSummary:
    """Build Tier 1 project summary (16 fields).

    Args:
        mapper_output: project metadata source.
        context: caller-provided context (quote_date).
        tier_5_wall_segments: per-wall aggregates (from build_tier5_walls).
        corners: detected corners (from count_corners).
        custom_quote_items: PR 4 generates these; PR 3 takes () for byte-equal test.
        operator_review_items: PR 4 generates these; PR 3 takes () for byte-equal test.

    Returns:
        Tier1FormworkSummary with all 16 fields populated.

    Notes:
        - No wastage re-application — Tier 5 already has wastage applied.
        - No commercial fields (no INR, no weight) — bracing on lease.
        - linear_meter totals rounded to 5 decimals for determinism.
    """
    logger.debug(
        "build_tier1_project: %d Tier 5 walls, %d corners, %d custom, %d review",
        len(tier_5_wall_segments), len(corners),
        len(custom_quote_items), len(operator_review_items),
    )

    # Count walls with bracing (exclude custom-order walls).
    walls_with_bracing = sum(
        1 for w in tier_5_wall_segments if not w.is_custom_order
    )

    # Pure aggregation — sum across Tier 5.
    total_props        = sum(w.total_props        for w in tier_5_wall_segments)
    total_walers       = sum(w.total_walers       for w in tier_5_wall_segments)
    total_kickers      = sum(w.total_kickers      for w in tier_5_wall_segments)
    total_diagonals    = sum(w.total_diagonals    for w in tier_5_wall_segments)
    total_raker_props  = sum(w.total_raker_props  for w in tier_5_wall_segments)
    total_corner_clamps = sum(w.total_corner_clamps for w in tier_5_wall_segments)
    total_base_plates  = sum(w.total_base_plates  for w in tier_5_wall_segments)
    total_prop_heads   = sum(w.total_prop_heads   for w in tier_5_wall_segments)
    total_jg_meters    = sum(w.joint_gasket_meters  for w in tier_5_wall_segments)
    total_track_meters = sum(w.starter_track_meters for w in tier_5_wall_segments)

    summary = Tier1FormworkSummary(
        project_name=mapper_output.project_name,
        quote_date=context.quote_date,
        total_wall_segments_with_bracing=walls_with_bracing,
        total_corners_detected=len(corners),
        total_props=total_props,
        total_walers=total_walers,
        total_kickers=total_kickers,
        # 🚨 Note: Tier 5 field is `total_diagonals`; Tier 1 field is `total_diagonal_braces`.
        total_diagonal_braces=total_diagonals,
        total_raker_props=total_raker_props,
        total_corner_clamps=total_corner_clamps,
        total_base_plates=total_base_plates,
        total_prop_heads=total_prop_heads,
        total_joint_gasket_meters=round(total_jg_meters, 5),
        total_starter_track_meters=round(total_track_meters, 5),
        total_custom_quote_items=len(custom_quote_items),
        operator_review_items_count=len(operator_review_items),
    )

    logger.debug(
        "build_tier1_project: walls=%d corners=%d props=%d kickers=%d "
        "BP=%d PH=%d track=%.5fm gasket=%.5fm",
        walls_with_bracing, len(corners), total_props, total_kickers,
        total_base_plates, total_prop_heads, summary.total_starter_track_meters,
        summary.total_joint_gasket_meters,
    )
    return summary
