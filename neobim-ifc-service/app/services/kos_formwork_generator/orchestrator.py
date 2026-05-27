"""KOS Formwork Quantities Generator — single public entry point.

Wires PR 1-4 modules into ``generate_formwork(mapper_output, context)``.

Reference: 5F-DESIGN v2 doc 02 §22 Problem 20 (Orchestrator wiring).

🚨 NO algorithm code lives here. Orchestrator only:

* Validates inputs (IV-F-1..IV-F-7).
* Calls PR 2-4 functions in the verified phase order.
* Wraps unexpected per-phase exceptions as ``FormworkError`` with phase context.
* Lets ``FormworkInputError`` / ``FormworkInvariantError`` / ``FormworkConfigError``
  propagate without wrap (typed errors carry full context already).
* Pulls policy strings for ``warnings`` / ``assumptions_made`` / ``pending_karthik``
  from module-level constants (PR 1).
* Merges validator soft warnings into ``output.warnings``.

🚨 P_INT_8 byte-equal contract:
* ``ASSUMPTIONS_MADE_DEFAULT`` matches golden ``assumptions_made`` EXACTLY.
* ``PENDING_KARTHIK_DEFAULT`` matches golden ``pending_karthik`` EXACTLY.
* ``_build_warnings`` returns ``()`` for v1 (no orchestrator-level policy warnings).
* Validator returns ``()`` for P_INT_8 (zero soft warnings).
* → ``output.warnings == ()`` matches golden.
"""
from __future__ import annotations

import dataclasses
import datetime
import logging
import time
from typing import Optional, Tuple

from app.services.kos_formwork_generator.constants import (
    ASSUMPTIONS_MADE_DEFAULT,
    FORMWORK_SCHEMA_VERSION,
    PENDING_KARTHIK_DEFAULT,
    WASTAGE_PERCENT_DEFAULT,
)
from app.services.kos_formwork_generator.component_counter import (
    count_components,
    find_bracing_scheme,
)
from app.services.kos_formwork_generator.corner_counter import count_corners
from app.services.kos_formwork_generator.custom_quote_handler import (
    build_custom_quote_items,
)
from app.services.kos_formwork_generator.exceptions import (
    FormworkError,
    FormworkInputError,
    FormworkInvariantError,
)
from app.services.kos_formwork_generator.id_generator import (
    build_audit_trail,
    compute_generated_at,
    mint_formwork_id,
)
from app.services.kos_formwork_generator.operator_review_handler import (
    build_operator_review_items,
)
from app.services.kos_formwork_generator.output_validator import (
    validate_formwork_output,
)
from app.services.kos_formwork_generator.tier1_project import build_tier1_project
from app.services.kos_formwork_generator.tier2_summary import build_tier2_summary
from app.services.kos_formwork_generator.tier3_categories import (
    build_tier3_categories,
)
from app.services.kos_formwork_generator.tier4_skus import build_tier4_skus
from app.services.kos_formwork_generator.tier5_walls import build_tier5_walls
from app.services.kos_formwork_generator.tier6_components import (
    build_tier6_components,
)
from app.services.kos_formwork_generator.types import (
    FormworkContext,
    FormworkCustomQuoteRequest,
    FormworkGeneratorOutput,
    FormworkOperatorReviewItem,
)
from app.services.kos_panel_grid_mapper import MAPPER_SCHEMA_VERSION
from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═════════════════════════════════════════════════════════════════════

#: Per DESIGN v2 doc 01 §117 — IV-F-3 valid seismic zone arms.
_VALID_SEISMIC_ZONES: frozenset = frozenset({None, "II", "III", "IV", "V"})

#: Per DESIGN v2 doc 01 §128 — IV-F-6 valid wall-type override arms.
_VALID_OVERRIDE_TYPES: frozenset = frozenset({"external", "internal", "basement", "retaining"})

#: Per DESIGN v2 doc 01 §129 — IV-F-7 supported mapper schema major version prefix.
#: DESIGN v2 wrote "starts with '1.'" but the production mapper currently ships
#: v0.x (`MAPPER_SCHEMA_VERSION='0.1.0'`). To preserve the byte-equal contract
#: and remain forward-compatible, accept the mapper's CURRENT major version
#: prefix (derived from `MAPPER_SCHEMA_VERSION`). When mapper bumps to v1.x
#: the prefix flips automatically — no orchestrator change needed.
_SUPPORTED_MAPPER_SCHEMA_PREFIX: str = MAPPER_SCHEMA_VERSION.split(".")[0] + "."


# ═════════════════════════════════════════════════════════════════════
# INPUT VALIDATION (defensive None guards + IV-F-1..IV-F-7)
# ═════════════════════════════════════════════════════════════════════


def _validate_inputs(
    mapper_output: Optional[PanelGridMapperOutput],
    context: Optional[FormworkContext],
) -> None:
    """Validate inputs per DESIGN v2 doc 01 §117 (IV-F-1..IV-F-7) + defensive None guards.

    Raises:
        FormworkInputError: on first failure. Message is tagged with the rule ID
            (``IV-F-N``); ``hint`` carries human-readable rationale.
    """
    # ── Defensive None guards (not numbered IV-F per DESIGN v2 but required
    #    to avoid AttributeError when downstream code accesses fields) ──
    if mapper_output is None:
        raise FormworkInputError(
            "mapper_output is None — generate_formwork requires a PanelGridMapperOutput instance",
            hint="Construct mapper_output via panel_grid_mapper.generate_panel_grid(...) first.",
        )
    if context is None:
        raise FormworkInputError(
            "context is None — generate_formwork requires a FormworkContext instance",
            hint="Construct FormworkContext with at least project_id and quote_date.",
        )

    # ── IV-F-1: project_id non-empty + no leading/trailing whitespace ──
    pid = context.project_id
    if not isinstance(pid, str) or not pid or pid != pid.strip():
        raise FormworkInputError(
            "IV-F-1: FormworkContext.project_id is empty or whitespace-only",
            hint="Set context.project_id to a non-empty, trimmed identifier.",
        )

    # ── IV-F-2: quote_date parseable ISO 8601 date ──
    try:
        datetime.date.fromisoformat(context.quote_date)
    except (ValueError, TypeError) as e:
        raise FormworkInputError(
            f"IV-F-2: FormworkContext.quote_date {context.quote_date!r} is not parseable as ISO 8601 date",
            hint="Use 'YYYY-MM-DD' format, e.g. '2026-05-27'.",
        ) from e

    # ── IV-F-3: seismic_zone in valid set ──
    if context.seismic_zone not in _VALID_SEISMIC_ZONES:
        raise FormworkInputError(
            f"IV-F-3: FormworkContext.seismic_zone {context.seismic_zone!r} "
            f"not in {{None,'II','III','IV','V'}}",
            hint="IS 1893 zones I and VI are not supported by FRB §9.5.",
        )

    # ── IV-F-4: pour_rate_m_per_hr None or > 0 ──
    pr = context.pour_rate_m_per_hr
    if pr is not None and pr <= 0:
        raise FormworkInputError(
            f"IV-F-4: FormworkContext.pour_rate_m_per_hr {pr!r} must be positive",
            hint="Either omit pour_rate_m_per_hr to use FRB §10.2 defaults, or supply a positive value.",
        )

    # ── IV-F-5: 0.0 ≤ wastage_percent ≤ 25.0 ──
    wp = context.wastage_percent
    if not (0.0 <= wp <= 25.0):
        raise FormworkInputError(
            f"IV-F-5: FormworkContext.wastage_percent {wp!r} outside [0.0, 25.0]",
            hint="Sanity cap — 5% default per FRB §2.1. Values above 25% suggest input error.",
        )

    # ── IV-F-6: wall_type_overrides reference existing walls + valid types ──
    if context.wall_type_overrides:
        mapper_wall_ids = {w.id for w in mapper_output.wall_segments}
        for wid, override_type in context.wall_type_overrides:
            if wid not in mapper_wall_ids:
                raise FormworkInputError(
                    f"IV-F-6: wall_type_overrides references wall_id {wid!r} "
                    f"not present in mapper_output.wall_segments",
                    hint="Override keys must match mapper-emitted wall ids exactly.",
                )
            if override_type not in _VALID_OVERRIDE_TYPES:
                raise FormworkInputError(
                    f"IV-F-6: wall_type_overrides type {override_type!r} not in "
                    f"{{external,internal,basement,retaining}}",
                    hint="Use one of the four mapper-supported wall_type values.",
                )

    # ── IV-F-7: mapper_output.schema_version supported ──
    sv = mapper_output.schema_version
    if not isinstance(sv, str) or not sv.startswith(_SUPPORTED_MAPPER_SCHEMA_PREFIX):
        raise FormworkInputError(
            f"IV-F-7: PanelGridMapperOutput schema_version {sv!r} not supported by 5F "
            f"(requires major version starting with {_SUPPORTED_MAPPER_SCHEMA_PREFIX!r})",
            hint="Regenerate mapper output with the current PanelGridMapper version, "
                 "or upgrade 5F to accept the newer schema.",
        )


# ═════════════════════════════════════════════════════════════════════
# HELPERS — policy strings (Phase 6)
# ═════════════════════════════════════════════════════════════════════


def _build_warnings(
    mapper_output: PanelGridMapperOutput,
    context: FormworkContext,
    custom_quote_items: Tuple[FormworkCustomQuoteRequest, ...],
    operator_review_items: Tuple[FormworkOperatorReviewItem, ...],
) -> Tuple[str, ...]:
    """Build orchestrator-level warnings (separate from validator soft warnings).

    For v1, orchestrator emits NO policy-driven warnings — all conditions surface
    via the handlers (custom_quote_items, operator_review_items) or via validator
    soft warnings (F-1, F-6, F-7). Returns ``()`` for P_INT_8 → preserves byte-equal
    against golden.

    🚨 Signature includes handler items because a future v2 may react to them
    (e.g., 'project has > 5 custom-quote walls'). Currently unused — documented for
    forward compatibility.
    """
    # Intentionally returns empty tuple for v1.
    # Future v2 hooks: project-level warnings derived from input characteristics or
    # handler counts go here.
    return ()


def _build_assumptions_made(
    mapper_output: PanelGridMapperOutput,
    context: FormworkContext,
) -> Tuple[str, ...]:
    """Build assumptions_made tuple per FRB-policy baseline.

    Returns ``ASSUMPTIONS_MADE_DEFAULT`` (5 strings, locked by PR 1 + Karthik
    2026-05-26 scope policy). For v1 this is verbatim; v2+ may add
    input-derived entries.

    P_INT_8 golden value: ``ASSUMPTIONS_MADE_DEFAULT`` exactly — byte-equal.
    """
    return ASSUMPTIONS_MADE_DEFAULT


def _build_pending_karthik(
    mapper_output: PanelGridMapperOutput,
    context: FormworkContext,
) -> Tuple[str, ...]:
    """Build pending_karthik tuple per outstanding-question baseline.

    Returns ``PENDING_KARTHIK_DEFAULT`` (4 strings, locked by PR 1).

    P_INT_8 golden value: ``PENDING_KARTHIK_DEFAULT`` exactly — byte-equal.
    """
    return PENDING_KARTHIK_DEFAULT


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API — generate_formwork
# ═════════════════════════════════════════════════════════════════════


def generate_formwork(
    mapper_output: PanelGridMapperOutput,
    context: FormworkContext,
) -> FormworkGeneratorOutput:
    """Generate the complete formwork quantities output.

    Phases (per DESIGN v2 doc 02 §22 Problem 20):

      0. Input validation (defensive guards + IV-F-1..IV-F-7).
      1. PR 2 — count_corners.
      2. PR 4 — custom_quote_handler + operator_review_handler (EARLY to
         identify walls routed to custom-quote; those are skipped from wcm).
      3. PR 2 — wcm + tier_6 + tier_5 + tier_4 (standard-path walls only).
      4. PR 3 — tier_3 (per-prefix aggregation).
      5. PR 3 — tier_2 (buckets), tier_1 (16 fields), audit_trail.
      6. PR 3 — formwork_id + generated_at.
      7. Orchestrator helpers — warnings, assumptions_made, pending_karthik.
      8. Construct FormworkGeneratorOutput.
      9. PR 4 — validate_formwork_output (hard raises propagate; soft → Phase 10).
      10. Merge soft warnings into output.warnings.
      11. Return.

    Args:
        mapper_output: PanelGridMapper output. Schema version must start with '1.'.
        context: caller-provided FormworkContext.

    Returns:
        FormworkGeneratorOutput (16 fields).

    Raises:
        FormworkInputError: on input validation failure (defensive None guard
            or IV-F-1..IV-F-7). Message is tagged with rule ID; ``hint`` gives
            rationale.
        FormworkInvariantError: on validator hard failure (Phase 8) — indicates
            an orchestrator bug. Propagated without wrap so callers can route by
            ``invariant_id``.
        FormworkConfigError: propagated unwrapped from any phase.
        FormworkError: unexpected exception in any phase, wrapped with phase tag.

    Determinism:
        When ``context.deterministic_id_seed`` and ``context.generated_at_override``
        are BOTH set, output is byte-equal across repeated calls (no clock reads,
        no random ids).
    """
    t_start = time.perf_counter()

    # ───────── Phase 0: Input validation ─────────
    _validate_inputs(mapper_output, context)
    n_walls = len(mapper_output.wall_segments)
    logger.debug(
        "generate_formwork: ENTRY project_id=%s n_walls=%d seismic_zone=%r",
        context.project_id, n_walls, context.seismic_zone,
    )

    # ───────── Phase 1: count_corners ─────────
    try:
        corners = count_corners(mapper_output.wall_segments)
    except FormworkError:
        logger.exception("Phase 1 (count_corners) raised typed FormworkError")
        raise
    except Exception as e:
        logger.exception("Phase 1 (count_corners) failed unexpectedly")
        raise FormworkError(
            f"Phase 1 (count_corners) failed: {type(e).__name__}: {e}"
        ) from e

    logger.info("Phase 1 OK: %d corners", len(corners))

    # ───────── Phase 2: PR 4 handlers (BEFORE wcm — per DESIGN v2 §22) ───────
    # Custom-quote handler identifies walls that route to custom (height > FRB max,
    # is_custom_order, etc.); those walls must be SKIPPED from wcm because
    # find_bracing_scheme/count_components would reject them. Operator-review
    # handler is independent.
    try:
        custom_quote_items = build_custom_quote_items(
            mapper_output, context, corners,
        )
        operator_review_items = build_operator_review_items(
            mapper_output, context,
        )
    except FormworkError:
        logger.exception("Phase 2 (PR 4 handlers) raised typed FormworkError")
        raise
    except Exception as e:
        logger.exception("Phase 2 (PR 4 handlers) failed unexpectedly")
        raise FormworkError(
            f"Phase 2 (handlers) failed: {type(e).__name__}: {e}"
        ) from e

    logger.info(
        "Phase 2 OK: %d custom_quote_items, %d operator_review_items",
        len(custom_quote_items), len(operator_review_items),
    )

    # Identify wall_ids routed to custom quote (any reason). These walls skip wcm.
    custom_wall_ids = {req.wall_id for req in custom_quote_items}

    # ───────── Phase 3: PR 2 — wcm + tier 6/5/4 (standard-path walls only) ──
    try:
        # Preserve input wall order via dict insertion order (Python 3.7+).
        # Skip walls routed to custom-quote (is_custom_order OR custom_wall_ids).
        wcm: dict = {}
        for wall in mapper_output.wall_segments:
            if wall.is_custom_order or wall.id in custom_wall_ids:
                continue
            scheme = find_bracing_scheme(wall.system, wall.height_mm)
            counts = count_components(wall, scheme)
            wcm[wall.id] = (wall, scheme, counts)

        tier_6, base_by_sku = build_tier6_components(
            wcm, corners, WASTAGE_PERCENT_DEFAULT,
        )
        tier_5 = build_tier5_walls(
            wcm, corners, context, WASTAGE_PERCENT_DEFAULT,
        )
        tier_4 = build_tier4_skus(tier_6, base_by_sku)
    except FormworkError:
        logger.exception("Phase 3 (PR 2 tier 6/5/4) raised typed FormworkError")
        raise
    except Exception as e:
        logger.exception("Phase 3 (PR 2 tier 6/5/4) failed unexpectedly")
        raise FormworkError(
            f"Phase 3 (panel grid → tier 6/5/4) failed: {type(e).__name__}: {e}"
        ) from e

    logger.info(
        "Phase 3 OK: %d tier_6, %d tier_5, %d tier_4 (skipped %d custom walls)",
        len(tier_6), len(tier_5), len(tier_4),
        len(mapper_output.wall_segments) - len(wcm),
    )

    # ───────── Phase 4: PR 3 — tier_3 ─────────
    try:
        tier_3 = build_tier3_categories(tier_4)
    except FormworkError:
        logger.exception("Phase 4 (PR 3 tier_3) raised typed FormworkError")
        raise
    except Exception as e:
        logger.exception("Phase 4 (PR 3 tier_3) failed unexpectedly")
        raise FormworkError(
            f"Phase 4 (tier_3) failed: {type(e).__name__}: {e}"
        ) from e

    logger.debug("Phase 4 OK: %d tier_3 categories", len(tier_3))

    # ───────── Phase 5: PR 3 — tier_2, tier_1, audit_trail ─────────
    try:
        tier_2 = build_tier2_summary(tier_6, custom_quote_items)
        tier_1 = build_tier1_project(
            mapper_output=mapper_output,
            context=context,
            tier_5_wall_segments=tier_5,
            corners=corners,
            custom_quote_items=custom_quote_items,
            operator_review_items=operator_review_items,
        )
        audit_trail = build_audit_trail(
            mapper_output, context,
            custom_quote_items, operator_review_items,
        )
    except FormworkError:
        logger.exception("Phase 5 (PR 3 tier_2/tier_1/audit_trail) raised typed FormworkError")
        raise
    except Exception as e:
        logger.exception("Phase 5 (PR 3 tier_2/tier_1/audit_trail) failed unexpectedly")
        raise FormworkError(
            f"Phase 5 (tier_2/tier_1/audit_trail) failed: {type(e).__name__}: {e}"
        ) from e

    logger.debug("Phase 5 OK: tier_2, tier_1, audit_trail constructed")

    # ───────── Phase 6: id + timestamp ─────────
    try:
        formwork_id = mint_formwork_id(context)
        generated_at = compute_generated_at(context)
    except FormworkError:
        logger.exception("Phase 6 (id/timestamp) raised typed FormworkError")
        raise
    except Exception as e:
        logger.exception("Phase 6 (id/timestamp) failed unexpectedly")
        raise FormworkError(
            f"Phase 6 (formwork_id/generated_at) failed: {type(e).__name__}: {e}"
        ) from e

    # ───────── Phase 7: warnings, assumptions, pending ─────────
    try:
        warnings_base = _build_warnings(
            mapper_output, context, custom_quote_items, operator_review_items,
        )
        assumptions_made = _build_assumptions_made(mapper_output, context)
        pending_karthik = _build_pending_karthik(mapper_output, context)
    except FormworkError:
        logger.exception("Phase 7 (policy strings) raised typed FormworkError")
        raise
    except Exception as e:
        logger.exception("Phase 7 (warnings/assumptions/pending) failed unexpectedly")
        raise FormworkError(
            f"Phase 7 (warnings/assumptions/pending) failed: {type(e).__name__}: {e}"
        ) from e

    logger.debug(
        "Phase 7 OK: %d warnings, %d assumptions, %d pending_karthik",
        len(warnings_base), len(assumptions_made), len(pending_karthik),
    )

    # ───────── Phase 8: Construct FormworkGeneratorOutput ─────────
    try:
        output = FormworkGeneratorOutput(
            formwork_id=formwork_id,
            generated_at=generated_at,
            schema_version=FORMWORK_SCHEMA_VERSION,
            tier_1_summary=tier_1,
            tier_2_categories=tier_2,
            tier_3_sku_types=tier_3,
            tier_4_sku_details=tier_4,
            tier_5_wall_segments=tier_5,
            tier_6_components=tier_6,
            custom_quote_items=custom_quote_items,
            operator_review_items=operator_review_items,
            audit_trail=audit_trail,
            warnings=warnings_base,
            assumptions_made=assumptions_made,
            pending_karthik=pending_karthik,
        )
    except (TypeError, ValueError) as e:
        logger.exception("Phase 8 (FormworkGeneratorOutput construction) failed")
        raise FormworkError(
            f"Phase 8 (FormworkGeneratorOutput construction) failed: {type(e).__name__}: {e}"
        ) from e

    # ───────── Phase 9: validate_formwork_output ─────────
    # FormworkInvariantError (hard violation) propagates — indicates orchestrator bug.
    try:
        soft_warnings = validate_formwork_output(output)
    except FormworkInvariantError:
        logger.exception(
            "VALIDATOR HARD FAILURE for formwork_id=%s — orchestrator bug; output inconsistent",
            formwork_id,
        )
        raise
    except FormworkError:
        logger.exception("Phase 9 (validator) raised typed FormworkError")
        raise
    except Exception as e:
        logger.exception("Phase 9 (validator) failed unexpectedly")
        raise FormworkError(
            f"Phase 9 (validator) failed: {type(e).__name__}: {e}"
        ) from e

    # ───────── Phase 10: Merge soft warnings into output.warnings ─────────
    if soft_warnings:
        logger.warning(
            "Validator returned %d soft warnings for formwork_id=%s",
            len(soft_warnings), formwork_id,
        )
        output = dataclasses.replace(
            output,
            warnings=tuple(output.warnings) + tuple(soft_warnings),
        )

    # ───────── Phase 11: Return ─────────
    elapsed_ms = (time.perf_counter() - t_start) * 1000
    logger.info(
        "generate_formwork: SUCCESS formwork_id=%s n_walls=%d cq=%d rev=%d in %.1fms",
        formwork_id, n_walls,
        len(custom_quote_items), len(operator_review_items),
        elapsed_ms,
    )
    return output
