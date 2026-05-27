"""Custom-quote handler — 10 trigger rules (mapper inheritance + 5F-specific).

Reference: 5F-DESIGN v2 doc 02 §17 (Problem 15 — Custom-quote routing).

The 10 ``FormworkCustomQuoteReason`` Literal arms:

1. **inherited_curved_wall** / **inherited_custom_thickness** / **inherited_other_custom**
   — propagated from mapper's ``WallSegment.is_custom_order`` + ``CustomQuoteRequest.reason``.
2. **height_exceeds_field_rule_book_max** — wall.height > FRB system max.
3. **pour_rate_exceeds_field_rule_book_max** — context.pour_rate > POUR_RATE_MAX[system].
4. **seismic_zone_v_verification** — resolved_seismic == 'V' (project-level).
5. **non_standard_corner_angle** / **unsupported_corner_thickness** /
   **unsupported_t_junction_thickness** / **wall_type_override_high_risk**.

🚨 P_INT_8 contract: no trigger fires (K4-110, h=3.0m, application_confidence=1.0,
is_custom_order=False, no warnings, no overrides, seismic='III') → returns ``()``.

🚨 Per DESIGN v2 §17, walls failing trigger 0 (inherit) SKIP all subsequent triggers
for that wall — first-match-wins per wall.

Output deterministically sorted by ``(wall_id, reason)`` ascending.
"""
from __future__ import annotations

import logging
import math
from typing import Optional, Tuple

from app.services.kos_formwork_generator.constants import (
    POUR_RATE_MAX_M_PER_HR,
)
from app.services.kos_formwork_generator.corner_counter import CornerDetection
from app.services.kos_formwork_generator.types import (
    FormworkContext,
    FormworkCustomQuoteReason,
    FormworkCustomQuoteRequest,
)
from app.services.kos_panel_grid_mapper.types import (
    PanelGridMapperOutput,
    WallSegment,
)

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# FRB max heights per system (doc 02 §17 + Appendix A BracingScheme rows)
# ═════════════════════════════════════════════════════════════════════

FRB_MAX_HEIGHT_M: dict[str, float] = {
    "K4-110": 3.6,
    "K6-150": 5.0,
    "K6-180": 5.0,
    "K8-200": 6.0,
    "K8-250": 6.0,
}

#: Mapper-emitted reason → FormworkCustomQuoteReason (inheritance map; doc 02 lines 884-893).
INHERITED_REASON_MAP: dict[str, FormworkCustomQuoteReason] = {
    "curved_wall_custom_panels": "inherited_curved_wall",
    "tight_curve_below_min_radius": "inherited_curved_wall",
    "thickness_exceeds_catalog": "inherited_custom_thickness",
    "thickness_below_minimum": "inherited_custom_thickness",
    "thickness_unknown": "inherited_custom_thickness",
    "thickness_between_bands": "inherited_custom_thickness",
    "system_180_not_stocked": "inherited_other_custom",
    "system_250_custom_on_request": "inherited_other_custom",
    "orphan_opening_reference": "inherited_other_custom",
    "other_custom": "inherited_other_custom",
}

#: Module-level documentation constant — keyed by every Literal arm.
CUSTOM_QUOTE_TRIGGER_RULES: dict[str, str] = {
    "inherited_curved_wall": "Mapper flagged wall as curved (FRB §1.4 — no Kalzen curved formwork)",
    "inherited_custom_thickness": "Mapper flagged wall thickness as non-catalog (FRB §4.1)",
    "inherited_other_custom": "Mapper flagged wall as custom (K6-180 not stocked / K8-250 on request / orphan opening / other)",
    "height_exceeds_field_rule_book_max": "Wall height exceeds FRB §4.2 max for system (K4≤3.6m, K6≤5.0m, K8≤6.0m)",
    "pour_rate_exceeds_field_rule_book_max": "Project pour_rate_m_per_hr exceeds FRB §10.2 system max",
    "seismic_zone_v_verification": "Seismic Zone V — structural engineer review mandatory (FRB §9.5 BI-17)",
    "non_standard_corner_angle": "Corner detected as non-standard angle (not 90°/135°/T-junction; FRB §7.2 has no SKU)",
    "unsupported_corner_thickness": "135° corner clamp not stocked for this thickness (FRB §7.2 covers K6-150/K8-200 only)",
    "unsupported_t_junction_thickness": "T-junction clamp not stocked for this thickness (FRB §7.2 covers K6-150/K8-200/K8-250 only)",
    "wall_type_override_high_risk": "Customer wall_type_override creates a high-risk combination (K4 basement / K8-200 retaining etc.)",
}

_STANDARD_SYSTEMS: frozenset = frozenset({"K4-110", "K6-150", "K6-180", "K8-200", "K8-250"})


# ═════════════════════════════════════════════════════════════════════
# HELPERS
# ═════════════════════════════════════════════════════════════════════


def _system_thickness_mm(system: str) -> Optional[int]:
    """Map system code → reinforced thickness (mm) for FormworkCustomQuoteRequest."""
    return {
        "K4-110": 110, "K6-150": 150, "K6-180": 180,
        "K8-200": 200, "K8-250": 250,
    }.get(system)


def _estimate_complexity(wall: WallSegment) -> str:
    """Rule-of-thumb complexity used by sales when costing custom orders.

    high   ≥ 5.0m or basement/retaining
    medium 3.0 – 5.0m or external
    low    ≤ 3.0m internal/partition
    """
    h_m = wall.height_mm / 1000.0
    app = wall.inferred_application
    if h_m >= 5.0 or app in ("basement", "retaining"):
        return "high"
    if h_m >= 3.0 or app == "external":
        return "medium"
    return "low"


def _estimate_prop_count(wall: WallSegment) -> Optional[int]:
    """Coarse prop count = max(2, ceil(length_m / 2.0)). None for unknown length."""
    if wall.length_mm is None or wall.length_mm <= 0:
        return None
    return max(2, math.ceil(wall.length_mm / 2000.0))


def _build_request(
    wall: WallSegment,
    reason: FormworkCustomQuoteReason,
    reason_detail: str,
    context: FormworkContext,
    mapper_output: PanelGridMapperOutput,
) -> FormworkCustomQuoteRequest:
    """Assemble a single FormworkCustomQuoteRequest with resolved fields."""
    resolved_seismic = context.seismic_zone or mapper_output.seismic_zone or "III"
    thickness = (
        wall.custom_thickness_mm
        if wall.custom_thickness_mm is not None
        else _system_thickness_mm(wall.system)
    )
    return FormworkCustomQuoteRequest(
        wall_id=wall.id,
        reason=reason,
        reason_detail=reason_detail,
        system=wall.system,
        thickness_mm=float(thickness) if thickness is not None else None,
        length_mm=float(wall.length_mm),
        height_mm=int(wall.height_mm),
        application=wall.inferred_application,
        seismic_zone=resolved_seismic,
        estimated_bracing_complexity=_estimate_complexity(wall),
        estimated_prop_count=_estimate_prop_count(wall),
    )


def _build_project_level_request(
    reason: FormworkCustomQuoteReason,
    reason_detail: str,
    context: FormworkContext,
    mapper_output: PanelGridMapperOutput,
) -> FormworkCustomQuoteRequest:
    """Project-level (corner-detected) request — synthesizes safe defaults.

    Used for ``non_standard_corner_angle``, ``unsupported_corner_thickness``,
    ``unsupported_t_junction_thickness`` where the underlying issue is a corner,
    not a single wall. ``wall_id`` is a synthetic ``"CORNER:<wall_ids>"`` token
    so it sorts stably yet still indicates project-level scope.
    """
    resolved_seismic = context.seismic_zone or mapper_output.seismic_zone or "III"
    return FormworkCustomQuoteRequest(
        wall_id=reason_detail.split("|", 1)[0],  # caller embeds wall_id token at front
        reason=reason,
        reason_detail=reason_detail.split("|", 1)[-1],
        system="(corner)",
        thickness_mm=None,
        length_mm=0.0,
        height_mm=0,
        application="(corner)",
        seismic_zone=resolved_seismic,
        estimated_bracing_complexity="medium",
        estimated_prop_count=None,
    )


# ═════════════════════════════════════════════════════════════════════
# WALL-LEVEL TRIGGER CHECKERS (first-match-wins per wall)
# ═════════════════════════════════════════════════════════════════════


def _check_wall(
    wall: WallSegment,
    context: FormworkContext,
    mapper_output: PanelGridMapperOutput,
    resolved_seismic: Optional[str],
) -> Optional[FormworkCustomQuoteRequest]:
    """Apply per-wall trigger checks in DESIGN v2 priority order.

    Order (DESIGN v2 doc 02 §17 routing flow):
      0. is_custom_order → inherited_* (any of three).
      1. height_exceeds_field_rule_book_max.
      2. pour_rate_exceeds_field_rule_book_max.
      3. seismic_zone_v_verification.
      4. wall_type_override_high_risk.

    Returns first matching request, else None.
    """
    # 0. Inheritance
    if wall.is_custom_order:
        if wall.custom_quote_request is not None:
            original = wall.custom_quote_request.reason
            detail = original
        else:
            original = "other_custom"
            detail = "Mapper flagged is_custom_order without explicit reason"
        mapped: FormworkCustomQuoteReason = INHERITED_REASON_MAP.get(
            original, "inherited_other_custom"
        )
        return _build_request(wall, mapped, f"Inherited from mapper: {detail}", context, mapper_output)

    # 1. Height exceeds FRB max
    max_h_m = FRB_MAX_HEIGHT_M.get(wall.system)
    if max_h_m is not None and (wall.height_mm / 1000.0) > max_h_m:
        return _build_request(
            wall,
            "height_exceeds_field_rule_book_max",
            f"height {wall.height_mm/1000.0:.2f}m > FRB max {max_h_m:.1f}m for {wall.system}",
            context, mapper_output,
        )

    # 2. Pour-rate exceeds FRB max
    pr_override = context.pour_rate_m_per_hr
    pr_max = POUR_RATE_MAX_M_PER_HR.get(wall.system)
    if pr_override is not None and pr_max is not None and pr_override > pr_max:
        return _build_request(
            wall,
            "pour_rate_exceeds_field_rule_book_max",
            f"context.pour_rate_m_per_hr={pr_override:.2f} > FRB §10.2 max {pr_max:.2f} for {wall.system}",
            context, mapper_output,
        )

    # 3. Seismic Zone V verification (per-wall emission)
    if resolved_seismic == "V":
        return _build_request(
            wall,
            "seismic_zone_v_verification",
            f"Seismic Zone V — structural engineer must verify diagonal bracing pattern for wall {wall.id} per FRB §9.5 BI-17",
            context, mapper_output,
        )

    # 4. Wall-type override high-risk combinations
    for wid, override_type in context.wall_type_overrides:
        if wid != wall.id:
            continue
        if override_type == "basement" and wall.system == "K4-110":
            return _build_request(
                wall,
                "wall_type_override_high_risk",
                f"Override basement on K4-110 wall {wall.id} — K4 not permitted for basements (FRB §4.1)",
                context, mapper_output,
            )
        if override_type == "retaining" and wall.system == "K8-200":
            return _build_request(
                wall,
                "wall_type_override_high_risk",
                f"Override retaining on K8-200 wall {wall.id} — FRB §4.2 prescribes K8-250 for retaining",
                context, mapper_output,
            )

    return None


# ═════════════════════════════════════════════════════════════════════
# CORNER-LEVEL TRIGGER CHECKER
# ═════════════════════════════════════════════════════════════════════


def _check_corner(
    corner: CornerDetection,
    walls_by_id: dict[str, WallSegment],
    context: FormworkContext,
    mapper_output: PanelGridMapperOutput,
) -> Optional[FormworkCustomQuoteRequest]:
    """Apply corner-level trigger checks (FRB §7.2 corner-clamp catalog gaps)."""
    # Sample primary wall (first in tuple) — used to anchor wall_id in output.
    primary_wall = walls_by_id.get(corner.wall_ids[0]) if corner.wall_ids else None
    if primary_wall is None:
        return None

    # Determine thickness from primary wall's system
    thickness = _system_thickness_mm(primary_wall.system)

    ctype = corner.corner_type
    if ctype == "unsupported":
        return _build_request(
            primary_wall, "non_standard_corner_angle",
            f"Corner at ({corner.cluster_x_mm:.0f}, {corner.cluster_y_mm:.0f}) walls={list(corner.wall_ids)} — angle not in FRB §7.2 catalog",
            context, mapper_output,
        )

    if ctype == "135deg" and thickness is not None and thickness not in (150, 200):
        return _build_request(
            primary_wall, "unsupported_corner_thickness",
            f"135° corner clamp not stocked for thickness {thickness}mm (FRB §7.2 covers 150/200 only); walls={list(corner.wall_ids)}",
            context, mapper_output,
        )

    if ctype == "t_junction" and thickness is not None and thickness not in (150, 200, 250):
        return _build_request(
            primary_wall, "unsupported_t_junction_thickness",
            f"T-junction clamp not stocked for thickness {thickness}mm (FRB §7.2 covers 150/200/250 only); walls={list(corner.wall_ids)}",
            context, mapper_output,
        )

    return None


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def _sort_key(item: FormworkCustomQuoteRequest) -> Tuple[str, str]:
    """Deterministic sort key — (wall_id, reason) ascending."""
    return (item.wall_id, item.reason)


def build_custom_quote_items(
    mapper_output: PanelGridMapperOutput,
    context: FormworkContext,
    corners: Tuple[CornerDetection, ...] = (),
) -> Tuple[FormworkCustomQuoteRequest, ...]:
    """Build the tuple of FormworkCustomQuoteRequest items for a project.

    Args:
        mapper_output: panel-grid-mapper output (wall_segments + warnings).
        context: caller-provided context (seismic, pour_rate, wall_type_overrides).
        corners: corner detections from PR 2's count_corners. Optional — when
            omitted, corner-level triggers are skipped (still byte-equal-safe
            for P_INT_8 which has zero corners).

    Returns:
        Deterministically-sorted tuple of FormworkCustomQuoteRequest. Empty
        tuple when no triggers fire (P_INT_8 happy path).
    """
    logger.debug(
        "build_custom_quote_items: %d walls, %d corners, seismic=%r, pour_rate=%r, overrides=%d",
        len(mapper_output.wall_segments), len(corners),
        context.seismic_zone, context.pour_rate_m_per_hr,
        len(context.wall_type_overrides),
    )

    resolved_seismic = context.seismic_zone or mapper_output.seismic_zone
    items: list[FormworkCustomQuoteRequest] = []

    # Wall-level triggers (first-match-wins per wall)
    for wall in mapper_output.wall_segments:
        result = _check_wall(wall, context, mapper_output, resolved_seismic)
        if result is not None:
            items.append(result)

    # Corner-level triggers (corners are project-level structures; emit per corner)
    if corners:
        walls_by_id = {w.id: w for w in mapper_output.wall_segments}
        for corner in corners:
            result = _check_corner(corner, walls_by_id, context, mapper_output)
            if result is not None:
                items.append(result)

    sorted_items = tuple(sorted(items, key=_sort_key))
    logger.debug("build_custom_quote_items: emitted %d items", len(sorted_items))
    return sorted_items
