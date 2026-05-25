"""Multi-tier opening (door/window) detection orchestrator — Phase 5C-3 PR 1.

This module is the entrypoint the DXF and PDF parsers call after wall +
junction extraction. It runs the applicable detector tiers (Tier 1 only for
DXF; Tiers 2-4 for both formats; Tier 5 reserved for the mapper's existing
geometric heuristic), deduplicates overlapping detections, filters by
confidence, and emits a deterministic, canonical-sorted list of
``ParserOpening`` records.

PR 1 SCOPE: skeleton only.
  - All public types + the orchestrator function are defined.
  - The orchestrator routes through tier-detector hooks that are PRESENT but
    return empty results — the actual tier detectors land in PR 2 (DXF) and
    PR 3 (PDF).
  - This PR ships the dedupe + sort + filter + id-assignment pipeline so PR 2
    only needs to plug in tier implementations.

Determinism contract (verified by PR 1 tests):
  - Pure function. No I/O. No globals. No randomness.
  - Same inputs ⇒ byte-identical outputs (frozen dataclasses, sorted dicts).
  - ID assignment is deterministic: sequential ``o0``, ``o1``, … after the
    canonical sort.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable, Literal

from app.services.kos_drawing_geometry import (
    DEDUPE_PROXIMITY_MM,
    ParserOpening,
    dedupe_openings_by_proximity,
    sort_openings_canonical,
)


# ── tunable thresholds (citations inline) ────────────────────────────────────

# Confidence floor. Openings emitted below this threshold are dropped and
# surface as a "low_confidence_skipped" warning. Default 0.5 per 5C-3 prompt
# §1.5 ("Confidence cutoff: openings below threshold (default 0.5) get logged
# as `openings_inferable: true` warning but NOT emitted to mapper").
MIN_CONFIDENCE_THRESHOLD: float = 0.5

# Tier order. Higher-confidence tiers win during dedupe (we sort by -confidence
# already), but the tier number is also embedded in each candidate so a tied
# confidence can break ties consistently. T1 (block ref) > T2 (swing arc) >
# T3 (wall gap) > T4 (annotation text) > T5 (geometric heuristic). The mapper's
# existing heuristic is Tier 5 and stays in opening_handler.py — this
# orchestrator does NOT emit Tier 5 candidates.
SourceType = Literal["dxf", "pdf"]


# ── pre-detection candidate type (internal — not exported) ────────────────────


@dataclass(frozen=True)
class _OpeningCandidate:
    """Pre-dedupe, pre-id-assignment candidate from a single tier detector.

    Same fields as ``ParserOpening`` minus the ``id`` (assigned after dedupe).
    Tier detectors return tuples of these; the orchestrator dedupes them all,
    then assigns sequential IDs to the survivors.
    """

    opening_type: Literal["door", "window"]
    parent_wall_id: str
    position_mm: float
    width_mm: float
    height_mm: float
    sill_height_mm: float
    detection_tier: int
    detection_method: str
    confidence: float
    source_entities: tuple[str, ...]

    def to_parser_opening(self, oid: str) -> ParserOpening:
        return ParserOpening(
            id=oid,
            opening_type=self.opening_type,
            parent_wall_id=self.parent_wall_id,
            position_mm=self.position_mm,
            width_mm=self.width_mm,
            height_mm=self.height_mm,
            sill_height_mm=self.sill_height_mm,
            detection_tier=self.detection_tier,
            detection_method=self.detection_method,
            confidence=self.confidence,
            source_entities=self.source_entities,
        )


# ── tier-detector hooks ────────────────────────────────────────────────────
#
# Each hook is a thin dispatcher: it routes to the per-format detector module
# based on source_type. PR 1 shipped stubs returning []; PR 2 (this PR) wires
# the DXF path through ``kos_opening_dxf``; PR 3 will wire the PDF path
# through ``kos_opening_pdf``.
#
# Keeping the hooks as named module-level functions preserves test-time
# monkeypatching (PR 1's test_orchestrator_assigns_sequential_ids and
# friends rely on swapping _detect_tier1_block_reference).


def _detect_tier1_block_reference(
    walls: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """Tier 1 — DXF block reference detection (DXF only).

    PDFs have no block semantics; the orchestrator skips this tier for
    source_type='pdf'.
    """
    from app.services.kos_opening_dxf import detect_tier1_block_reference
    return detect_tier1_block_reference(walls, raw_entities)


def _detect_tier2_swing_arc(
    walls: list[dict],
    raw_entities: dict | None,
    source_type: SourceType,
) -> list[_OpeningCandidate]:
    """Tier 2 — door swing arc detection.

    DXF path: native ARC entities. PDF path (PR 3): reconstructed from
    PyMuPDF drawing items (cubic beziers OR short line-segment sequences).
    """
    if source_type == "dxf":
        from app.services.kos_opening_dxf import detect_tier2_swing_arc_dxf
        return detect_tier2_swing_arc_dxf(walls, raw_entities)
    if source_type == "pdf":
        from app.services.kos_opening_pdf import detect_tier2_swing_arc_pdf
        return detect_tier2_swing_arc_pdf(walls, raw_entities)
    return []


def _detect_tier3_wall_gap(
    walls: list[dict],
    junctions: list[dict],
    raw_entities: dict | None,
    source_type: SourceType,
) -> list[_OpeningCandidate]:
    """Tier 3 — wall-gap detection from collinear END junctions.

    Wall-gap geometry is source-agnostic; both DXF and PDF dispatchers run
    the same algorithm (just on the walls + junctions their parser
    produced).
    """
    if source_type == "dxf":
        from app.services.kos_opening_dxf import detect_tier3_wall_gap_dxf
        return detect_tier3_wall_gap_dxf(walls, junctions, raw_entities)
    if source_type == "pdf":
        from app.services.kos_opening_pdf import detect_tier3_wall_gap_pdf
        return detect_tier3_wall_gap_pdf(walls, junctions, raw_entities)
    return []


def _detect_tier4_annotation(
    walls: list[dict],
    raw_entities: dict | None,
    source_type: SourceType,
) -> list[_OpeningCandidate]:
    """Tier 4 — text annotation detection.

    DXF path reads TEXT/MTEXT entities; PDF path reads PyMuPDF text spans.
    """
    if source_type == "dxf":
        from app.services.kos_opening_dxf import detect_tier4_annotation_dxf
        return detect_tier4_annotation_dxf(walls, raw_entities)
    if source_type == "pdf":
        from app.services.kos_opening_pdf import detect_tier4_annotation_pdf
        return detect_tier4_annotation_pdf(walls, raw_entities)
    return []


# ── public orchestrator API ───────────────────────────────────────────────────


def detect_openings(
    walls: list[dict],
    junctions: list[dict],
    raw_entities: dict | None,
    source_type: SourceType,
    classification: str,
    min_confidence: float = MIN_CONFIDENCE_THRESHOLD,
    dedupe_proximity_mm: float = DEDUPE_PROXIMITY_MM,
) -> tuple[tuple[ParserOpening, ...], tuple[str, ...]]:
    """Multi-tier opening detection orchestrator.

    Args:
      walls:              Wall dicts from ``_seg_to_wall`` (parser-canonical
                          shape — id/start/end/length_mm/angle_degrees/...).
      junctions:          Junction dicts from ``_detect_junctions`` (with
                          point/type/wall_ids).
      raw_entities:       Format-specific entity bag. For DXF: dict with
                          ``inserts``, ``arcs``, ``texts`` (PR 2 populates).
                          For PDF: dict with ``arcs``, ``texts`` (PR 3
                          populates). ``None`` is accepted; orchestrator
                          then runs only the wall-gap detector (Tier 3).
      source_type:        ``"dxf"`` or ``"pdf"`` — gates Tier 1 (DXF only).
      classification:     Parser's drawing_classification (e.g. "FLOOR_PLAN").
                          Reserved for future use — non-floor-plan drawings
                          can short-circuit to empty output.
      min_confidence:     Drop candidates below this confidence. Default 0.5.
      dedupe_proximity_mm: Two candidates within this many mm on the same
                          wall are merged. Default 200mm.

    Returns:
      (openings_tuple, warnings_tuple).
      - openings_tuple: deterministic-sorted ParserOpening tuple with
        sequential ids ``o0``, ``o1``, ...
      - warnings_tuple: human-readable strings flagging dropped candidates,
        unsupported drawing classifications, etc.

    PR 1 BEHAVIOUR: returns ``((), ())`` for any non-empty wall set because
    no tier detectors are implemented yet. PR 2/3 plug in the real detectors;
    THIS function's signature and dedupe/sort behaviour does not change.
    """
    warnings: list[str] = []

    # Short-circuit: non-floor-plan drawings don't carry plan-view openings.
    # The mapper consumes opening data in plan-view metres-along-wall units,
    # so a section/detail/elevation has nothing useful to contribute here.
    if classification not in ("FLOOR_PLAN",):
        # Reserved short-circuit — not a warning, just no-op.
        return (), tuple(warnings)

    # Run the applicable tier detectors. PR 1: all return [].
    candidates: list[_OpeningCandidate] = []

    if source_type == "dxf":
        candidates.extend(_detect_tier1_block_reference(walls, raw_entities))

    candidates.extend(_detect_tier2_swing_arc(walls, raw_entities, source_type))
    candidates.extend(_detect_tier3_wall_gap(walls, junctions, raw_entities, source_type))
    candidates.extend(_detect_tier4_annotation(walls, raw_entities, source_type))

    # Filter by confidence BEFORE dedupe so the dedupe pass sees only
    # candidates we'd actually emit.
    above_threshold: list[_OpeningCandidate] = []
    for c in candidates:
        if c.confidence < min_confidence:
            warnings.append(
                f"opening candidate skipped (tier {c.detection_tier}, "
                f"method={c.detection_method}, confidence={c.confidence:.2f} "
                f"< min={min_confidence:.2f}) on {c.parent_wall_id} "
                f"@ {c.position_mm:.0f}mm"
            )
            continue
        above_threshold.append(c)

    # Convert candidates to ParserOpening with placeholder ids, dedupe, sort.
    placeholder_openings = tuple(
        c.to_parser_opening(f"_pre{i}") for i, c in enumerate(above_threshold)
    )
    deduped = dedupe_openings_by_proximity(
        placeholder_openings, proximity_mm=dedupe_proximity_mm
    )
    sorted_openings = sort_openings_canonical(deduped)

    # Assign final sequential ids o0, o1, ... post-sort. We rebuild via
    # `replace` to keep frozen-dataclass semantics.
    final = tuple(
        replace(o, id=f"o{i}") for i, o in enumerate(sorted_openings)
    )

    return final, tuple(warnings)


# ── helper: convenience wrapper for testing / future call sites ───────────────


def assign_sequential_ids(
    openings: Iterable[ParserOpening],
    prefix: str = "o",
) -> tuple[ParserOpening, ...]:
    """Reassign sequential ids to a tuple of openings.

    Exposed for testability and for future call sites that might want to
    re-id openings after a downstream filter pass. Pure function: input is
    not mutated.
    """
    return tuple(
        replace(o, id=f"{prefix}{i}") for i, o in enumerate(openings)
    )
