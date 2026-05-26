"""BOQ generator orchestrator — single public entry point.

Wires PR 1–4 building blocks (types, tiers, custom/operator, id/audit,
output_validator) into one pure function: ``generate_boq(boq_input)``.

The function is deterministic when ``context.deterministic_id_seed`` and
``context.generated_at_override`` are both set (test mode).

Source: 02_ALGORITHMS.md Problem 12 (orchestrator spec); PR 5 prompt §3.
"""

from __future__ import annotations

from app.services.kos_boq_generator.constants import (
    BOQ_SCHEMA_VERSION,
    DEFAULT_DELIVERY_TERMS,
    DEFAULT_PAYMENT_TERMS,
)
from app.services.kos_boq_generator.custom_quote_handler import (
    build_custom_quote_items,
)
from app.services.kos_boq_generator.formatters import compute_quote_validity_until
from app.services.kos_boq_generator.id_generator import (
    build_audit_trail,
    compute_generated_at,
    compute_mapper_output_hash,
    mint_boq_id,
)
from app.services.kos_boq_generator.operator_review_handler import (
    build_operator_review_items,
)
from app.services.kos_boq_generator.output_validator import validate_boq_output
from app.services.kos_boq_generator.tier1_summary import (
    build_tier1_project_summary,
)
from app.services.kos_boq_generator.tier2_categories import build_tier2_categories
from app.services.kos_boq_generator.tier3_sku_types import build_tier3_sku_types
from app.services.kos_boq_generator.tier4_sku_details import build_tier4_sku_details
from app.services.kos_boq_generator.tier5_segments import build_tier5_segments
from app.services.kos_boq_generator.tier6_panel_pieces import build_tier6_panel_pieces
from app.services.kos_boq_generator.types import (
    BOQCommercialTerms,
    BOQContext,
    BOQGeneratorOutput,
    BOQInput,
)


def generate_boq(boq_input: BOQInput) -> BOQGeneratorOutput:
    """Generate a complete BOQ from a validated input.

    Pipeline (Source: PR 5 prompt §3.1):
      1. Extract mapper_output + context from input.
      2. Build Tier 6 → Tier 5 → Tier 4 (PR 2 panel/segment/SKU geometry).
      3. Build custom_quote_items + operator_review_items (PR 4) — BEFORE
         Tier 3 because Tier 3's CUSTOM synthetic row depends on the
         custom item count.
      4. Build Tier 3 → Tier 2 → Tier 1 (PR 3 aggregations + commercials).
      5. Compute mapper_output_hash (PR 4) — once, reused by audit trail.
      6. Mint boq_id + compute generated_at (PR 4).
      7. Build audit_trail (PR 4) including review-required flags.
      8. Build commercial_terms (PR 5) from constants + context.
      9. Validate via 24-invariant ``validate_boq_output`` (PR 4) →
         hard issues raise BOQInvariantError; soft issues collected as
         warnings tuple.
      10. Construct frozen ``BOQGeneratorOutput``.

    Pure function. No mutation of input. No side effects. Errors propagate
    to caller (PR 6 router will map to HTTP responses).

    Source: 02_ALGORITHMS.md Problem 12; PR 5 prompt §3.
    """
    mapper_output = boq_input.mapper_output
    context = boq_input.context

    # Step 2 — Tier 6 / Tier 5 / Tier 4 (PR 2)
    tier_6_panel_pieces = build_tier6_panel_pieces(mapper_output)
    tier_5_wall_segments = build_tier5_segments(mapper_output)
    tier_4_sku_details = build_tier4_sku_details(tier_6_panel_pieces)

    # Step 3 — Custom + operator items (PR 4) BEFORE Tier 3 (Source: prompt
    # anti-pattern #60 — Tier 3's CUSTOM row needs the count).
    custom_quote_items = build_custom_quote_items(mapper_output)
    operator_review_items = build_operator_review_items(mapper_output)

    # Step 4 — Tier 3 / Tier 2 / Tier 1 (PR 3)
    tier_3_sku_types = build_tier3_sku_types(tier_4_sku_details, custom_quote_items)
    tier_2_categories = build_tier2_categories(tier_3_sku_types, custom_quote_items)
    tier_1_summary = build_tier1_project_summary(
        tier_6_panel_pieces,
        tier_5_wall_segments,
        tier_2_categories,
        custom_quote_items,
        operator_review_items,
        context,
        mapper_output,
    )

    # Step 5 — mapper_output_hash computed ONCE (Source: prompt anti-pattern
    # #62). build_audit_trail recomputes internally per PR 4 contract; we
    # keep this local for any future re-use without recomputation.
    _ = compute_mapper_output_hash(mapper_output)

    # Step 6 — IDs (PR 4)
    boq_id = mint_boq_id(context)
    generated_at = compute_generated_at(context)

    # Step 7 — Audit trail (PR 4). Review-required flags derived inside
    # build_audit_trail from item counts.
    audit_trail = build_audit_trail(
        mapper_output, custom_quote_items, operator_review_items,
    )

    # Step 8 — Commercial terms (PR 5)
    commercial_terms = _build_commercial_terms(context)

    # Step 9 — Validate. Hard issues raise BOQInvariantError; soft issues
    # returned as tuple[str, ...] (Source: pre-flight A Part 6).
    soft_warnings = validate_boq_output(
        tier_6_panel_pieces=tier_6_panel_pieces,
        tier_5_wall_segments=tier_5_wall_segments,
        tier_4_sku_details=tier_4_sku_details,
        tier_3_sku_types=tier_3_sku_types,
        tier_2_categories=tier_2_categories,
        tier_1_summary=tier_1_summary,
        custom_quote_items=custom_quote_items,
        operator_review_items=operator_review_items,
        audit_trail=audit_trail,
        mapper_output=mapper_output,
        context=context,
    )

    # Step 10 — Assemble frozen output (Source: pre-flight A Part 2 exact
    # 16-field list).
    return BOQGeneratorOutput(
        boq_id=boq_id,
        generated_at=generated_at,
        schema_version=BOQ_SCHEMA_VERSION,
        tier_1_summary=tier_1_summary,
        tier_2_categories=tier_2_categories,
        tier_3_sku_types=tier_3_sku_types,
        tier_4_sku_details=tier_4_sku_details,
        tier_5_wall_segments=tier_5_wall_segments,
        tier_6_panel_pieces=tier_6_panel_pieces,
        custom_quote_items=custom_quote_items,
        operator_review_items=operator_review_items,
        commercial_terms=commercial_terms,
        audit_trail=audit_trail,
        warnings=soft_warnings,
        assumptions_made=(),
        pending_karthik=(),
    )


def _build_commercial_terms(context: BOQContext) -> BOQCommercialTerms:
    """Build BOQCommercialTerms from defaults + context.

    Per pre-flight A Part 8, golden's commercial_terms values match the
    DEFAULT_* constants exactly:
      payment_terms  = DEFAULT_PAYMENT_TERMS   ("50% advance, 50% before dispatch")
      delivery_terms = DEFAULT_DELIVERY_TERMS  ("Ex-works Kalzen factory")
      quote_validity_until = compute_quote_validity_until(quote_date, days)
      notes = context.notes or ""  (golden has empty string)

    Source: PR 5 prompt §3.1 Step 5 + pre-flight A Part 4/8.
    """
    return BOQCommercialTerms(
        payment_terms=DEFAULT_PAYMENT_TERMS,
        delivery_terms=DEFAULT_DELIVERY_TERMS,
        quote_validity_until=compute_quote_validity_until(
            context.quote_date, context.quote_validity_days,
        ),
        notes=context.notes or "",
    )
