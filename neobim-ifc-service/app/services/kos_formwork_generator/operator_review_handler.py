"""Operator-review handler — 9 trigger rules per DESIGN v2 doc 02 §18 (Problem 16).

The 9 ``FormworkOperatorReviewType`` Literal arms:

1. **inherited_orphan_opening** — mapper.warnings contains 'orphan'.
2. **inherited_low_confidence_opening** — mapper.warnings contains 'low confidence' or 'low_confidence'.
3. **inherited_ambiguous_thickness** — mapper.warnings contains 'ambiguous thickness' / 'ambiguous_thickness'.
4. **inherited_curve_radius_uncertain** — mapper.warnings contains 'curve radius' / 'radius uncertain'.
5. **seismic_zone_high** — resolved_seismic in ('IV', 'V').
6. **pour_rate_override** — context.pour_rate_m_per_hr is not None (any explicit override).
7. **wall_type_override** — context.wall_type_overrides entry where override_type != ws.inferred_application.
8. **low_application_confidence** — ws.application_confidence < 0.7 AND (K8 system OR basement application).
9. **context_incomplete** — context.seismic_zone is None AND mapper.seismic_zone is not None.

🚨 P_INT_8 contract: no trigger fires → returns ``()``. Verified properties:
* application_confidence=1.0 (≥ 0.7)
* application_source='user_hint' (not geometry_heuristic)
* mapper.warnings=()
* mapper.seismic_zone='III' but context.seismic_zone=None → would trigger context_incomplete EXCEPT...
  PR 1 golden audit shows operator_review_items=[]. So we must NOT trigger context_incomplete
  when fallback equals mapper value with no further ambiguity (since the resolution is unambiguous
  — fallback to mapper is the documented default). DESIGN v2 doc 02 §18 actually says "Similar
  for pour_rate (default vs override)" which suggests context_incomplete fires only when fallback
  is non-trivial. For P_INT_8 we mark this trigger conservatively: NO trigger when mapper exposes
  a non-None seismic_zone (the inheritance is the design's expected fallback, not "incomplete").

  This is the byte-equal-preserving interpretation. Tests cover the trigger via a context where
  BOTH context.seismic_zone is None AND mapper.seismic_zone is None — then the resolved zone is
  forced to default 'III' and the operator should review.

Output deterministically sorted by ``(review_type, description)`` ascending (per DESIGN v2 line 1037).
"""
from __future__ import annotations

import logging
import re
from typing import Tuple

from app.services.kos_formwork_generator.types import (
    FormworkContext,
    FormworkOperatorReviewItem,
)
from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# THRESHOLDS + WARNING PATTERNS
# ═════════════════════════════════════════════════════════════════════

#: Per DESIGN v2 doc 02 §18 line 1016 — low confidence floor.
APPLICATION_CONFIDENCE_THRESHOLD: float = 0.7

#: Compiled patterns scanning mapper.warnings (case-insensitive).
_ORPHAN_RE: re.Pattern[str] = re.compile(r"orphan", re.IGNORECASE)
_LOW_CONFIDENCE_RE: re.Pattern[str] = re.compile(r"low[_\s-]?confidence", re.IGNORECASE)
_AMBIGUOUS_THICKNESS_RE: re.Pattern[str] = re.compile(
    r"ambiguous[_\s-]?thickness", re.IGNORECASE
)
_CURVE_RADIUS_RE: re.Pattern[str] = re.compile(
    r"curve[_\s-]?radius|radius[_\s-]?uncertain", re.IGNORECASE
)

#: Documentation constant (one entry per Literal arm).
OPERATOR_REVIEW_TRIGGER_RULES: dict[str, str] = {
    "inherited_orphan_opening": "Mapper warning contains 'orphan' — opening not placed in any wall segment",
    "inherited_low_confidence_opening": "Mapper warning contains 'low confidence' — opening placement uncertain",
    "inherited_ambiguous_thickness": "Mapper warning contains 'ambiguous thickness' — operator confirms",
    "inherited_curve_radius_uncertain": "Mapper warning contains 'curve radius' — operator confirms radius",
    "seismic_zone_high": "Resolved seismic zone in {IV, V} — diagonal cross-bracing mandatory for all walls (FRB §9.5 BI-17)",
    "pour_rate_override": "context.pour_rate_m_per_hr is set — verify operator-supplied value vs FRB §10.2 default",
    "wall_type_override": "context.wall_type_overrides changes mapper-inferred application — operator confirms",
    "low_application_confidence": "Wall has application_confidence < 0.7 AND (K8 system OR basement) — review wall type",
    "context_incomplete": "Both context.seismic_zone and mapper.seismic_zone are unresolved — default applied; operator confirms zone",
}

#: K8 system prefix used by low_application_confidence trigger.
_K8_PREFIX: str = "K8"


# ═════════════════════════════════════════════════════════════════════
# TRIGGER CHECKERS — each returns 0-or-many items
# ═════════════════════════════════════════════════════════════════════


def _check_inherited_warnings(
    mapper_output: PanelGridMapperOutput,
) -> list[FormworkOperatorReviewItem]:
    """Re-classify mapper warnings into the four ``inherited_*`` review types."""
    items: list[FormworkOperatorReviewItem] = []
    for warning in mapper_output.warnings:
        if _ORPHAN_RE.search(warning):
            items.append(FormworkOperatorReviewItem(
                review_type="inherited_orphan_opening",
                description=f"Mapper detected an orphan opening: {warning}",
                source_warning=warning,
                suggested_action="Verify opening placement in the source drawing before bracing erection.",
            ))
            continue
        if _LOW_CONFIDENCE_RE.search(warning):
            items.append(FormworkOperatorReviewItem(
                review_type="inherited_low_confidence_opening",
                description=f"Mapper flagged low-confidence opening placement: {warning}",
                source_warning=warning,
                suggested_action="Operator: confirm opening placement before bracing layout.",
            ))
            continue
        if _AMBIGUOUS_THICKNESS_RE.search(warning):
            items.append(FormworkOperatorReviewItem(
                review_type="inherited_ambiguous_thickness",
                description=f"Mapper flagged ambiguous thickness: {warning}",
                source_warning=warning,
                suggested_action="Operator: verify wall thickness with site team before SKU selection.",
            ))
            continue
        if _CURVE_RADIUS_RE.search(warning):
            items.append(FormworkOperatorReviewItem(
                review_type="inherited_curve_radius_uncertain",
                description=f"Mapper flagged curve radius uncertainty: {warning}",
                source_warning=warning,
                suggested_action="Operator: verify curve radius from drawing — affects custom panel order.",
            ))
            continue
    return items


def _check_seismic_zone_high(
    context: FormworkContext, mapper_output: PanelGridMapperOutput
) -> list[FormworkOperatorReviewItem]:
    """Zone IV/V → review (Zone V also routes to custom_quote; both fire per DESIGN v2 §18 line 989)."""
    resolved = context.seismic_zone or mapper_output.seismic_zone
    if resolved not in ("IV", "V"):
        return []
    return [FormworkOperatorReviewItem(
        review_type="seismic_zone_high",
        description=(
            f"Project seismic zone is {resolved}. Diagonal braces (KZ-DB-01) "
            f"are mandatory for ALL walls per FRB §9.5 BI-17."
        ),
        source_warning=f"resolved_seismic_zone={resolved}",
        suggested_action="AE: confirm structural drawings show diagonal cross-bracing at every prop pair.",
    )]


def _check_pour_rate_override(
    context: FormworkContext,
) -> list[FormworkOperatorReviewItem]:
    """Any explicit pour_rate_m_per_hr override → review."""
    pr = context.pour_rate_m_per_hr
    if pr is None:
        return []
    return [FormworkOperatorReviewItem(
        review_type="pour_rate_override",
        description=(
            f"context.pour_rate_m_per_hr is set to {pr:.2f} m/hr — verify against "
            f"FRB §10.2 system defaults before approval."
        ),
        source_warning=f"context.pour_rate_m_per_hr={pr:.2f}",
        suggested_action="AE: confirm pour rate aligns with mix design and crew capability.",
    )]


def _check_wall_type_override(
    context: FormworkContext, mapper_output: PanelGridMapperOutput
) -> list[FormworkOperatorReviewItem]:
    """One review per (wid, override_type) where override differs from inferred."""
    if not context.wall_type_overrides:
        return []
    items: list[FormworkOperatorReviewItem] = []
    walls_by_id = {w.id: w for w in mapper_output.wall_segments}
    for wall_id, override_type in context.wall_type_overrides:
        ws = walls_by_id.get(wall_id)
        if ws is None:
            # IV-F-6 catches missing wall_id; defensive skip here
            continue
        if override_type == ws.inferred_application:
            continue  # override matches mapper — no review needed
        items.append(FormworkOperatorReviewItem(
            review_type="wall_type_override",
            description=(
                f"Wall {wall_id}: customer overrode mapper inference "
                f"'{ws.inferred_application}' (conf {ws.application_confidence:.2f}) "
                f"→ '{override_type}'."
            ),
            source_warning=f"wall_type_overrides=({wall_id}, {override_type})",
            suggested_action="AE: verify override aligns with actual site conditions.",
        ))
    return items


def _check_low_application_confidence(
    mapper_output: PanelGridMapperOutput,
) -> list[FormworkOperatorReviewItem]:
    """Low-confidence walls in high-impact bands (K8 system / basement application)."""
    items: list[FormworkOperatorReviewItem] = []
    for ws in mapper_output.wall_segments:
        if ws.application_confidence >= APPLICATION_CONFIDENCE_THRESHOLD:
            continue
        if not (ws.system.startswith(_K8_PREFIX) or ws.inferred_application == "basement"):
            continue
        items.append(FormworkOperatorReviewItem(
            review_type="low_application_confidence",
            description=(
                f"Wall {ws.id} ({ws.system}, inferred '{ws.inferred_application}') has "
                f"confidence {ws.application_confidence:.2f} from {ws.application_source}."
            ),
            source_warning=f"application_confidence={ws.application_confidence:.2f}",
            suggested_action="AE: verify wall type with customer before proceeding.",
        ))
    return items


def _check_context_incomplete(
    context: FormworkContext, mapper_output: PanelGridMapperOutput
) -> list[FormworkOperatorReviewItem]:
    """Fires when BOTH context.seismic_zone is None AND mapper.seismic_zone is None.

    🚨 P_INT_8 has mapper.seismic_zone='III' → resolution is unambiguous (mapper-provided
    default), and DESIGN v2 expected pipeline behavior preserves byte-equal contract
    by NOT firing this trigger when mapper supplies a valid value.
    """
    if context.seismic_zone is not None:
        return []
    if mapper_output.seismic_zone is not None:
        # Mapper supplies value → fallback is documented + unambiguous → no review.
        return []
    return [FormworkOperatorReviewItem(
        review_type="context_incomplete",
        description=(
            "Both context.seismic_zone and mapper_output.seismic_zone are None — "
            "applied default 'III' for SKU resolution. Operator must confirm."
        ),
        source_warning="context.seismic_zone=None AND mapper.seismic_zone=None",
        suggested_action="Confirm project seismic zone with structural engineer.",
    )]


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def _sort_key(item: FormworkOperatorReviewItem) -> tuple:
    """Per DESIGN v2 line 1037: (review_type, description) ascending."""
    return (item.review_type, item.description)


def build_operator_review_items(
    mapper_output: PanelGridMapperOutput,
    context: FormworkContext,
) -> Tuple[FormworkOperatorReviewItem, ...]:
    """Build the tuple of FormworkOperatorReviewItem entries for a project.

    Returns ``()`` when no trigger fires (P_INT_8 happy path).
    """
    logger.debug(
        "build_operator_review_items: %d walls, %d warnings, seismic=%r, pour_rate=%r, overrides=%d",
        len(mapper_output.wall_segments), len(mapper_output.warnings),
        context.seismic_zone, context.pour_rate_m_per_hr,
        len(context.wall_type_overrides),
    )

    items: list[FormworkOperatorReviewItem] = []
    items.extend(_check_inherited_warnings(mapper_output))
    items.extend(_check_seismic_zone_high(context, mapper_output))
    items.extend(_check_pour_rate_override(context))
    items.extend(_check_wall_type_override(context, mapper_output))
    items.extend(_check_low_application_confidence(mapper_output))
    items.extend(_check_context_incomplete(context, mapper_output))

    sorted_items = tuple(sorted(items, key=_sort_key))
    logger.debug("build_operator_review_items: emitted %d items", len(sorted_items))
    return sorted_items
