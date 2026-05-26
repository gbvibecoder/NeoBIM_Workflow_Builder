"""Operator review handler — orphan-opening regex parser from mapper.warnings.

Sources:

* 02_ALGORITHMS.md Problem 8
* POLICY-ORPHAN-OPENING-WARNING: orphan openings surface as
  OperatorReviewItem (review_type='orphan_opening'); never silently dropped
* Anti-pattern #52: filter non-orphan warnings (mapper emits many other
  warning types that are info-only and shouldn't surface to operators)

Exact mapper warning format (verified by pre-flight A Part 6 on 90VR-MR):

    "opening o{N} references parent_wall_id='w{M}' not in any segment.source_wall_ids
     — dropped during segmentation; this opening will not appear in mapper output."

90VR-MR has 6 orphans (o1/w108, o3/w12, o8/w17, o11/w21, o12/w28, o20/w49)
out of 175 total warnings. The other 169 warnings are info-only (MAX_LIFT
fallbacks, segment-too-short, R5 short-circuit notes, etc.) and are NOT
operator-actionable.

Pure function. No I/O. No mutation. Deterministic.
"""

from __future__ import annotations

import re
from typing import Optional

from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

from .types import OperatorReviewItem


# ──────────────────────────────────────────────────────────────────────────────
# Orphan-opening regex (exact format from pre-flight A Part 6)
#
# Captures:
#   group 1 (oid): opening identifier like "o3"
#   group 2 (wid): parent wall identifier like "w12"
#
# The em-dash (—, U+2014) in the warning is preserved in the source — using
# generic ".*" after capture for robustness against trailing-text changes.
# ──────────────────────────────────────────────────────────────────────────────

ORPHAN_OPENING_PATTERN: re.Pattern[str] = re.compile(
    r"opening\s+(?P<oid>o\d+)\s+references\s+parent_wall_id='(?P<wid>w\d+)'"
    r"\s+not\s+in\s+any\s+segment\.source_wall_ids"
)


# ──────────────────────────────────────────────────────────────────────────────
# Warning parser (returns parsed components or None)
# ──────────────────────────────────────────────────────────────────────────────


def _parse_orphan_warning(warning: str) -> Optional[dict[str, str]]:
    """Parse a mapper warning string. Returns dict with {oid, wid} or None.

    Anti-pattern #52: returns None for non-orphan warnings — caller must
    skip these (orphan handler should not surface them as review items).

    Examples:
        "opening o1 references parent_wall_id='w108' not in any segment..."
            → {"oid": "o1", "wid": "w108"}
        "(system=K8-200, application=internal) not in MAX_LIFT_HEIGHT_MM table..."
            → None
    """
    if not warning:
        return None
    match = ORPHAN_OPENING_PATTERN.search(warning)
    if not match:
        return None
    return {
        "oid": match.group("oid"),
        "wid": match.group("wid"),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Public API: build_operator_review_items
# ──────────────────────────────────────────────────────────────────────────────


def build_operator_review_items(
    mapper_output: PanelGridMapperOutput,
) -> tuple[OperatorReviewItem, ...]:
    """Build OperatorReviewItem tuple from mapper.warnings.

    Filters only orphan_opening warnings (anti-pattern #52). The other 3
    review_types (low_confidence_opening, ambiguous_thickness,
    curve_radius_uncertain) are RESERVED for future mapper-emitted signals;
    v1 emits only orphan_opening.

    For each orphan-matching warning, builds an OperatorReviewItem with:
      review_type='orphan_opening'
      description: human-readable problem statement
      source_warning: verbatim mapper warning (audit trail)
      suggested_action: operator-actionable next step

    The output is sorted by numeric opening_id ascending for deterministic
    order. Anti-pattern #20 carry: stable across runs.

    Pure function. Deterministic.
    """
    items: list[OperatorReviewItem] = []

    for warning in mapper_output.warnings:
        parsed = _parse_orphan_warning(warning)
        if parsed is None:
            continue                                                   # anti-pattern #52

        oid = parsed["oid"]
        wid = parsed["wid"]

        items.append(OperatorReviewItem(
            review_type="orphan_opening",
            description=(
                f"Parser detected opening {oid} on wall {wid}, but the segmenter "
                f"could not place this wall in any segment — the opening will "
                f"not appear in the BOQ unless the source drawing is corrected."
            ),
            source_warning=warning,                                    # verbatim
            suggested_action=(
                f"Verify that opening {oid} at parent wall {wid} is intended "
                f"in the customer drawing. If intended, manually patch the "
                f"parent wall and re-run parser → mapper → BOQ."
            ),
        ))

    # Sort by numeric opening_id (e.g., o2 < o10 < o100), not lexicographic.
    return tuple(sorted(items, key=_orphan_sort_key))


def _orphan_sort_key(item: OperatorReviewItem) -> tuple[int, str]:
    """Sort key: (numeric opening id ascending, then verbatim warning for ties).

    Future-review-types (when added) sort last — assigned numeric 10**9 so
    they never collide with real orphan ids.
    """
    match = ORPHAN_OPENING_PATTERN.search(item.source_warning)
    if match is None:
        return (10**9, item.source_warning)                            # future types
    oid_str = match.group("oid")                                       # e.g. "o12"
    return (int(oid_str[1:]), item.source_warning)
