"""Phase 2A Slice 2A.5 — BriefAnalyst stage tests.

Two test layers:

* **Cache-only tests** (always run) — exercise the deterministic
  pieces: ``enrich_with_zone_lookups`` table-lookup logic, the
  system-prompt builder, the user-message builder. These pin the
  contract against the LLM-side surface without consuming any tokens.
* **LLM-driven tests** — run the full :func:`run_brief_analyst` against
  the committed sample brief fixtures. They use a graceful skip
  helper so:
    - With a valid cache file present (the committed Slice 2A.5 cache
      rows): tests run from cache, no API needed.
    - With no cache file AND no ``ANTHROPIC_API_KEY``: test skips
      cleanly with a message naming the missing cache key.
    - With no cache file AND a valid key: a real Haiku 4.5 call
      runs, the cache file is written, the test asserts on the
      returned ``BriefAnalysis``.

Cache-generation workflow
-------------------------
1. ``ANTHROPIC_API_KEY=sk-ant-... pytest tests/test_brief_analyst.py``
2. Cache JSON files appear under
   ``app/services/design_agent/cache/``.
3. Commit those files; CI re-runs hit cache and pass without a key.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from app.services.design_agent import (
    BriefAnalysis,
    BriefAnalystMetadata,
    BriefForm,
    BriefStyleWeights,
    DesignRequest,
    LLMClient,
    LLMUnavailableError,
    classify_brief,
    enrich_with_zone_lookups,
    run_brief_analyst,
)
from app.services.design_agent.prompts.brief_analyst import (
    build_brief_analyst_system_prompt,
    build_brief_analyst_user_message,
)
from app.services.design_agent.types import (
    BuildingClass,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    FidelityHint,
)


_FIXTURES = Path(__file__).parent / "fixtures" / "sample_briefs"


# ─── Cache-only tests (always run, no API key needed) ────────────────


def test_system_prompt_clears_anthropic_cache_minimum() -> None:
    """The system prompt must exceed 1024 tokens for Anthropic's
    ephemeral prompt cache to actually buy us anything. Rough estimate:
    chars/4. Guard with a comfortable margin (>= 1500 estimated tokens).
    """
    weights = BriefStyleWeights.build(
        {
            "floor_plan": 0.7,
            "narrative": 0.1,
            "parametric": 0.2,
            "confidence": 0.6,
            "rationale": "test",
        }
    )
    prompt = build_brief_analyst_system_prompt(weights)
    assert len(prompt) >= 1500 * 4, (
        f"system prompt too short ({len(prompt)} chars ~ "
        f"{len(prompt) // 4} tokens) — Anthropic cache minimum is "
        f"1024 tokens"
    )


def test_system_prompt_branches_on_dominant_style() -> None:
    """The classifier weights are embedded literally so the LLM can
    branch on the dominant style. Each style appears in the prompt."""
    weights = BriefStyleWeights.build(
        {
            "floor_plan": 0.7,
            "narrative": 0.1,
            "parametric": 0.2,
            "confidence": 0.6,
            "rationale": "explicit dimensions detected",
        }
    )
    prompt = build_brief_analyst_system_prompt(weights)
    assert "0.70" in prompt or "0.7" in prompt, "weights not embedded"
    assert "floor_plan" in prompt
    assert "narrative" in prompt
    assert "parametric" in prompt


def test_system_prompt_lists_every_nbc_group() -> None:
    """A drift sentinel: every canonical NBC group string the schema
    accepts must appear in the prompt so the LLM emits the exact tokens."""
    weights = BriefStyleWeights.build(
        {
            "floor_plan": 0.34,
            "narrative": 0.33,
            "parametric": 0.33,
            "confidence": 0.1,
            "rationale": "test",
        }
    )
    prompt = build_brief_analyst_system_prompt(weights)
    for group in ("A-1", "A-2", "A-3", "A-4", "A-5", "B", "C", "D",
                  "E", "F", "G", "H", "I"):
        assert group in prompt, f"NBC group {group} missing from prompt"


def test_user_message_text_only_concatenates_sources() -> None:
    """All available sources land under section headers."""
    request = DesignRequest(
        brief_text="Modern apartment for young couple",
        brief_form=BriefForm(floors=3, location_city="Pune"),
        build_id="t",
    )
    pdf_text = "=== Page 1 ===\nExtracted PDF content."
    msg = build_brief_analyst_user_message(request, pdf_text)
    assert isinstance(msg, str)
    assert "Modern apartment" in msg
    assert "Pune" in msg
    assert "Extracted PDF content" in msg
    assert "## Free-text brief" in msg
    assert "## Structured form fields" in msg
    assert "## Extracted PDF text" in msg


def test_user_message_skips_empty_sources() -> None:
    """Sections without content do not appear at all."""
    request = DesignRequest(brief_text="modern", build_id="t")
    msg = build_brief_analyst_user_message(request, pdf_text=None)
    assert isinstance(msg, str)
    assert "## Free-text brief" in msg
    # No PDF section, no form section
    assert "## Extracted PDF text" not in msg
    assert "## Structured form fields" not in msg


# ─── enrich_with_zone_lookups (pure function) ────────────────────────


def _build_minimal_analysis(
    *,
    location_city: "str | None" = None,
    seismic_zone: "str | None" = None,
    wind_zone: "int | None" = None,
) -> BriefAnalysis:
    """Build a minimum-valid BriefAnalysis with controllable site_context."""
    return BriefAnalysis(
        building_class=BuildingClass(
            primary_type="residential",
            sub_type="apartment",
            nbc_group="A-4",
            nbc_subdivision="Multi-family residential",
        ),
        site_context=SiteContext(
            location_city=location_city,
            seismic_zone=seismic_zone,  # type: ignore[arg-type]
            wind_zone=wind_zone,
        ),
        style_intent=StyleIntent(architectural_style="modern"),
        structural_intent=StructuralIntent(),
        fidelity_hint=FidelityHint(),
        floors_above_ground=2,
        floors_below_ground=0,
        raw_brief_summary="Test summary.",
    )


def test_enrich_no_city_returns_unchanged() -> None:
    a = _build_minimal_analysis(location_city=None)
    out, applied = enrich_with_zone_lookups(a)
    assert applied is False
    assert out is a  # exact identity — no copy


def test_enrich_unknown_city_returns_unchanged() -> None:
    a = _build_minimal_analysis(location_city="Atlantis")
    out, applied = enrich_with_zone_lookups(a)
    assert applied is False
    assert out.site_context.seismic_zone is None
    assert out.site_context.wind_zone is None


def test_enrich_pune_fills_both_zones() -> None:
    a = _build_minimal_analysis(
        location_city="Pune", seismic_zone=None, wind_zone=None
    )
    out, applied = enrich_with_zone_lookups(a)
    assert applied is True
    assert out.site_context.seismic_zone == "III"
    assert out.site_context.wind_zone == 2


def test_enrich_does_not_override_llm_supplied_seismic() -> None:
    """If the LLM was confident enough to emit a zone, trust it —
    even when our table says something different."""
    a = _build_minimal_analysis(
        location_city="Pune", seismic_zone="V", wind_zone=None
    )
    out, applied = enrich_with_zone_lookups(a)
    assert applied is True  # wind_zone was filled
    assert out.site_context.seismic_zone == "V"  # LLM value preserved
    assert out.site_context.wind_zone == 2


def test_enrich_does_not_override_llm_supplied_wind() -> None:
    a = _build_minimal_analysis(
        location_city="Pune", seismic_zone=None, wind_zone=6
    )
    out, applied = enrich_with_zone_lookups(a)
    assert applied is True  # seismic was filled
    assert out.site_context.seismic_zone == "III"
    assert out.site_context.wind_zone == 6  # LLM value preserved


def test_enrich_both_already_set_no_change() -> None:
    a = _build_minimal_analysis(
        location_city="Pune", seismic_zone="III", wind_zone=2
    )
    out, applied = enrich_with_zone_lookups(a)
    assert applied is False


# ─── LLM-driven tests — gracefully skip on cache miss without API key ─


def _run_or_skip(
    request: DesignRequest,
    style_weights: BriefStyleWeights,
    pdf_text: "str | None",
) -> tuple[BriefAnalysis, BriefAnalystMetadata]:
    """Run the analyst. Skip cleanly if cache miss + no API key.

    The slice's intent is: commit cache → CI passes with no key.
    Until cache is committed (locally generated by the user with
    their key), these tests skip with a clear message identifying
    which cache key needs to land.
    """
    client = LLMClient()
    try:
        return run_brief_analyst(
            request=request,
            style_weights=style_weights,
            pdf_text=pdf_text,
            llm_client=client,
        )
    except LLMUnavailableError as exc:
        pytest.skip(
            f"BriefAnalyst cache miss + no ANTHROPIC_API_KEY. "
            f"Run with key locally to populate cache. Detail: {exc}"
        )


def _read_text_fixture(name: str) -> str:
    return (_FIXTURES / name).read_text(encoding="utf-8")


def test_brief_analyst_2bhk_pune_extraction() -> None:
    """Floor-plan-style brief: explicit dimensions, RCC frame, Pune."""
    text = _read_text_fixture("2bhk_24x50.txt")
    request = DesignRequest(brief_text=text, build_id="test-2bhk-pune")
    weights = classify_brief(request)
    analysis, meta = _run_or_skip(request, weights, pdf_text=None)

    # Building class: residential apartment / two-family
    assert analysis.building_class.primary_type == "residential"
    assert analysis.building_class.nbc_group in {"A-2", "A-4"}

    # Site context: Pune → Zone III seismic, Zone 2 wind
    site_city = (analysis.site_context.location_city or "").lower()
    assert "pune" in site_city, f"location_city not Pune: {site_city!r}"
    assert analysis.site_context.seismic_zone == "III"
    assert analysis.site_context.wind_zone == 2

    # Floor count: G+1 = 2 above ground
    assert analysis.floors_above_ground == 2

    # Explicit dimensions: at least one of master_bedroom / kitchen / living
    keys_lower = " ".join(k.lower() for k in analysis.explicit_dimensions.keys())
    assert any(
        room in keys_lower
        for room in ("bedroom", "kitchen", "living", "dining")
    ), (
        f"expected at least one room in explicit_dimensions; "
        f"got keys: {list(analysis.explicit_dimensions.keys())}"
    )

    # Vastu signal preserved
    if analysis.style_intent.cultural_overlay:
        assert "vastu" in analysis.style_intent.cultural_overlay.lower()

    # Structural intent: RCC frame
    assert analysis.structural_intent.system in {"rcc_frame", "auto"}

    # Sanity on metadata shape
    assert meta.model.startswith("claude-haiku")
    assert meta.cost_usd_estimated >= 0.0


def test_brief_analyst_circular_futuristic_bangalore() -> None:
    """Narrative-dominant brief: Bangalore → Zone II seismic."""
    text = _read_text_fixture("circular_futuristic.txt")
    request = DesignRequest(brief_text=text, build_id="test-circular-futur")
    weights = classify_brief(request)
    analysis, _meta = _run_or_skip(request, weights, pdf_text=None)

    # Mixed-use or office (the brief explicitly mixes retail + office)
    assert analysis.building_class.primary_type in {"mixed_use", "office", "retail"}

    # Bangalore: Zone II
    assert (analysis.site_context.location_city or "").lower().startswith(
        ("bang", "beng")
    )
    assert analysis.site_context.seismic_zone == "II"

    # Architectural style mentions futuristic
    style_low = analysis.style_intent.architectural_style.lower()
    assert "futur" in style_low or "modern" in style_low, (
        f"unexpected architectural_style: {style_low!r}"
    )

    # Massing hint: circular
    if analysis.style_intent.massing_hint is not None:
        assert analysis.style_intent.massing_hint == "circular"

    # 5 floors above ground
    assert analysis.floors_above_ground == 5


def test_brief_analyst_g_plus_5_form_only() -> None:
    """Pure parametric — BriefForm only, no free text."""
    form_dict = json.loads(
        _read_text_fixture("g_plus_5_apartment_form.json")
    )
    # Strip the comment field (intake would do this in production)
    form_dict.pop("_comment", None)
    form = BriefForm(**form_dict)
    request = DesignRequest(brief_form=form, build_id="test-gplus5-form")
    weights = classify_brief(request)
    analysis, _meta = _run_or_skip(request, weights, pdf_text=None)

    assert analysis.building_class.primary_type == "residential"
    assert analysis.building_class.nbc_group == "A-4"  # multi-family
    assert analysis.floors_above_ground == 5
    # Pune from form → Zone III enrichment
    assert analysis.site_context.seismic_zone == "III"
    assert analysis.site_context.wind_zone == 2


def test_brief_analyst_warehouse() -> None:
    """Industrial brief: warehouse → NBC Group H, steel frame."""
    text = _read_text_fixture("warehouse.txt")
    request = DesignRequest(brief_text=text, build_id="test-warehouse")
    weights = classify_brief(request)
    analysis, _meta = _run_or_skip(request, weights, pdf_text=None)

    assert analysis.building_class.primary_type == "warehouse"
    assert analysis.building_class.nbc_group == "H"
    assert analysis.structural_intent.system in {"steel_frame", "composite"}


def test_brief_analyst_hospital() -> None:
    """Institutional brief: 3-floor hospital → NBC Group C."""
    text = _read_text_fixture("hospital_3floor.txt")
    request = DesignRequest(brief_text=text, build_id="test-hospital")
    weights = classify_brief(request)
    analysis, _meta = _run_or_skip(request, weights, pdf_text=None)

    assert analysis.building_class.primary_type == "hospital"
    assert analysis.building_class.nbc_group == "C"
    assert analysis.floors_above_ground == 3


def test_brief_analyst_rejects_non_building() -> None:
    """A bridge-over-river brief must hit the rejection rule."""
    text = (
        "Build a 200-meter long suspension bridge over the Ganga river "
        "near Varanasi. Steel cables, RCC pylons, two carriageways."
    )
    request = DesignRequest(brief_text=text, build_id="test-bridge")
    weights = classify_brief(request)
    analysis, _meta = _run_or_skip(request, weights, pdf_text=None)

    assert analysis.building_class.primary_type == "unknown"
    # And a rejection note in extraction_warnings
    warnings_text = " ".join(analysis.extraction_warnings).lower()
    assert any(
        word in warnings_text for word in ("bridge", "not a building", "reject")
    ), f"expected rejection note; got warnings: {analysis.extraction_warnings}"


def test_brief_analyst_does_not_hallucinate_on_sparse_brief() -> None:
    """Honesty rule: a brief with no rooms / dimensions yields empty
    explicit_dimensions and explicit_room_list — no fabrication."""
    request = DesignRequest(
        brief_text="Build me a small house in Pune.",
        build_id="test-sparse-brief",
    )
    weights = classify_brief(request)
    analysis, _meta = _run_or_skip(request, weights, pdf_text=None)

    # Either both empty, OR the agent extracted only what was literally
    # in the brief ("a small house" → no specific rooms / dimensions
    # to extract).
    assert analysis.explicit_dimensions == {} or all(
        not v.strip() for v in analysis.explicit_dimensions.values()
    ), f"hallucinated dimensions: {analysis.explicit_dimensions}"


def test_brief_analyst_deterministic_on_cache_hit() -> None:
    """Two consecutive runs with identical input must produce
    byte-identical BriefAnalysis (cache hits are deterministic).
    The metadata's ``created_at_iso`` differs on cache miss but is
    sourced from the cached file on hit, so it also matches on the
    second call."""
    text = _read_text_fixture("warehouse.txt")
    request = DesignRequest(brief_text=text, build_id="test-determinism")
    weights = classify_brief(request)

    a, _ = _run_or_skip(request, weights, pdf_text=None)
    b, _ = _run_or_skip(request, weights, pdf_text=None)

    assert a == b, (
        "Same request produced different BriefAnalysis — cache is "
        "not deterministic OR the schema's equality semantics drifted."
    )


def test_brief_analyst_enrichment_fills_seismic_when_llm_left_null() -> None:
    """End-to-end enrichment integration: a brief that mentions a known
    Indian city should always come out with a non-null seismic_zone in
    the final BriefAnalysis, even if the LLM left it null."""
    request = DesignRequest(
        brief_text="2BHK apartment in Pune.",
        build_id="test-enrichment",
    )
    weights = classify_brief(request)
    analysis, meta = _run_or_skip(request, weights, pdf_text=None)

    # Pune → seismic Zone III, wind Zone 2 — guaranteed by the
    # enrichment step (LLM may have set them OR left them null;
    # either path yields these final values).
    assert (analysis.site_context.location_city or "").lower().startswith("pune")
    assert analysis.site_context.seismic_zone == "III"
    assert analysis.site_context.wind_zone == 2
    # If the LLM had left BOTH null, enrichment_applied should be True.
    # If LLM filled them, applied=False. Both are valid; just confirm
    # the metadata flag exists.
    assert isinstance(meta.enrichment_applied, bool)
