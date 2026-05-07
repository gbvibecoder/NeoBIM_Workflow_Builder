"""Phase 2A Slice 2A.5 — BriefAnalyst stage runner.

Orchestrates one LLM call: build prompt → invoke LLMClient → parse
response → enrich with deterministic city → seismic / wind zone
lookups. Returns the enriched :class:`BriefAnalysis` plus a
:class:`BriefAnalystMetadata` accounting record.

Why a separate stage runner module
-----------------------------------
The route handler in Slice 2A.7 stitches three stages: classifier
(2A.2), BriefAnalyst (this), ProgramArchitect (2A.6). Keeping the
LLM-call boilerplate per stage in its own module — rather than
inline in the route — lets each stage's signature and metadata stay
narrow and lets us test each stage independently without spinning
up FastAPI.

Determinism
-----------
The LLM call is deterministic-by-cache: same (system_prompt,
user_message, schema, model) → same response, since the
:class:`LLMClient` reads from a file-backed cache before hitting the
API. Once cache files are committed, every CI run reproduces every
extraction byte-for-byte (modulo the ``created_at_iso`` field on
metadata, which is set per-call).

Enrichment is also deterministic — it's a table lookup against
``reference_data/seismic_zones_in.py`` and
``reference_data/wind_zones_in.py``. The LLM never assigns zones; it
either leaves them null (preferred) or copies a value the user wrote
verbatim.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.design_agent.llm_client import LLMClient
from app.services.design_agent.prompts.brief_analyst import (
    build_brief_analyst_system_prompt,
    build_brief_analyst_user_message,
)
from app.services.design_agent.reference_data.seismic_zones_in import (
    lookup_seismic_zone,
)
from app.services.design_agent.reference_data.wind_zones_in import (
    lookup_wind_zone,
)
from app.services.design_agent.types import (
    BriefAnalysis,
    BriefStyleWeights,
    DesignRequest,
)


_BRIEF_ANALYST_TIMEOUT_S: float = 10.0


@dataclass(frozen=True)
class BriefAnalystMetadata:
    """Per-stage accounting record. Stable shape — Slice 2A.7 stamps a
    sum of these onto Pset_BuildFlow_Provenance alongside the
    ProgramArchitect counterpart.
    """

    model: str
    latency_ms: float
    cache_hit: bool
    cost_usd_estimated: float
    enrichment_applied: bool


def run_brief_analyst(
    request: DesignRequest,
    style_weights: BriefStyleWeights,
    pdf_text: Optional[str],
    llm_client: LLMClient,
) -> tuple[BriefAnalysis, BriefAnalystMetadata]:
    """Run the BriefAnalyst stage.

    Calls Haiku 4.5 with a 10-second wallclock ceiling and the
    BriefAnalysis Pydantic schema as the structured-output target.
    The system prompt is shared across calls (cache_shared_context=True)
    so a sequence of design analyses on the same product surface
    benefits from Anthropic's ephemeral prompt cache.

    Post-LLM, runs deterministic enrichment: if the LLM returned
    ``site_context.location_city`` but left ``seismic_zone`` /
    ``wind_zone`` null, fill them via the reference-data table
    lookups. Never overrides LLM-supplied values — the model wins
    when it's confident.
    """
    system_prompt = build_brief_analyst_system_prompt(style_weights)
    user_message = build_brief_analyst_user_message(request, pdf_text)

    parsed, llm_metadata = llm_client.call(
        model="haiku-4.5",
        system_prompt=system_prompt,
        user_message=user_message,
        response_schema=BriefAnalysis,
        timeout_seconds=_BRIEF_ANALYST_TIMEOUT_S,
        cache_shared_context=True,
    )
    # The schema can only round-trip a BriefAnalysis here, but the
    # LLMClient returns a generic BaseModel; refine the type for
    # downstream consumers.
    assert isinstance(parsed, BriefAnalysis)

    enriched, enrichment_applied = enrich_with_zone_lookups(parsed)

    metadata = BriefAnalystMetadata(
        model=llm_metadata.model,
        latency_ms=llm_metadata.latency_ms,
        cache_hit=llm_metadata.cache_hit,
        cost_usd_estimated=llm_metadata.cost_usd_estimated,
        enrichment_applied=enrichment_applied,
    )
    return enriched, metadata


def enrich_with_zone_lookups(
    analysis: BriefAnalysis,
) -> tuple[BriefAnalysis, bool]:
    """Fill ``seismic_zone`` / ``wind_zone`` from the city tables.

    Only fills fields the LLM left None — never overrides a value the
    LLM emitted. Returns ``(possibly_updated_analysis, applied_bool)``.
    The bool is True iff at least one of the two zones was filled.
    """
    site = analysis.site_context
    if not site.location_city:
        return analysis, False

    new_seismic = site.seismic_zone
    new_wind = site.wind_zone
    enriched = False

    if site.seismic_zone is None:
        looked_up = lookup_seismic_zone(site.location_city)
        if looked_up is not None:
            new_seismic = looked_up
            enriched = True

    if site.wind_zone is None:
        wind_looked_up = lookup_wind_zone(site.location_city)
        if wind_looked_up is not None:
            new_wind = wind_looked_up
            enriched = True

    if not enriched:
        return analysis, False

    new_site = site.model_copy(
        update={
            "seismic_zone": new_seismic,
            "wind_zone": new_wind,
        }
    )
    return analysis.model_copy(update={"site_context": new_site}), True


__all__ = [
    "run_brief_analyst",
    "enrich_with_zone_lookups",
    "BriefAnalystMetadata",
]
