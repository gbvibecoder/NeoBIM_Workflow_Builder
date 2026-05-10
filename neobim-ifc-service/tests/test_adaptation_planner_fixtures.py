"""Slice 2B.2.B — Fixture-driven AdaptationPlanner tests (15 briefs).

Each fixture in :data:`tests.fixtures._2b2_briefs.ALL_FIXTURES` is run
through :func:`run_adaptation_planner` and checked against its
:class:`ExpectedAdapt` / :class:`ExpectedRefuse` envelope.

Three states (mirroring ``test_template_matcher_fixtures.py``):

* Cache present in ``app/services/design_agent/cache/`` (the canonical
  committed location): tests run from disk, no API key needed.
  Deterministic + cheap.
* No cache + no ``ANTHROPIC_API_KEY``: each fixture's test skips with
  a message naming the missing cache key — operators see exactly
  which fixture cache to mint.
* No cache + valid key: real Haiku 4.5 calls run, cache files land in
  the canonical cache dir, and the assertions execute. The cost is
  ~$0.005-$0.01 per call × 15 fixtures = ~$0.10 total.

Mint
----

    ANTHROPIC_API_KEY=sk-ant-... pytest \\
        tests/test_adaptation_planner_fixtures.py \\
        --tb=short

Then commit the new files under ``app/services/design_agent/cache/``.
"""

from __future__ import annotations

import os

import pytest

from app.services.design_agent import (
    AdaptationFailed,
    AdaptationPlan,
    LLMClient,
    LLMUnavailableError,
    run_adaptation_planner,
)
from app.services.design_agent.llm_client import (
    CACHE_DIR,
    compute_cache_key,
)
from app.services.design_agent.prompts.adaptation_planner import (
    build_adaptation_planner_system_prompt,
    build_adaptation_planner_user_message,
)
from app.services.design_agent.stages.adaptation_planner import (
    _AdaptationDecision,
)
from app.services.design_agent.types import TransformRotation
from tests.fixtures._2b2_briefs import (
    ALL_FIXTURES,
    AdapterFixture,
    ExpectedAdapt,
    ExpectedRefuse,
)


# ─── Sanity tests on the fixture set itself ──────────────────────────


def test_fifteen_fixtures_authored() -> None:
    """The planner is calibrated against exactly 15 fixtures (3 per
    category). Drift here means the spec contract has been altered."""
    assert len(ALL_FIXTURES) == 15, (
        f"expected 15 planner fixtures, got {len(ALL_FIXTURES)}"
    )


def test_fixture_names_unique() -> None:
    names = [f.name for f in ALL_FIXTURES]
    assert len(names) == len(set(names)), (
        f"duplicate fixture name(s): {names}"
    )


def test_three_fixtures_per_category() -> None:
    """3 mirror-only + 3 rotate-only + 3 combined + 3 no-op +
    3 v2-deferral = 15."""
    adapts = [
        f for f in ALL_FIXTURES if isinstance(f.expected, ExpectedAdapt)
    ]
    refuses = [
        f for f in ALL_FIXTURES if isinstance(f.expected, ExpectedRefuse)
    ]
    assert len(adapts) == 12, (
        f"expected 12 ExpectedAdapt fixtures (3 mirror + 3 rotate + 3 "
        f"combined + 3 no-op), got {len(adapts)}"
    )
    assert len(refuses) == 3, (
        f"expected 3 ExpectedRefuse fixtures (v2-deferral), got "
        f"{len(refuses)}"
    )


# ─── Fixture-driven test runner ──────────────────────────────────────


def _expected_cache_path(fixture: AdapterFixture) -> str:
    """Compute the on-disk cache path the fixture WILL hit / mint
    so the skip message can name it."""
    key = compute_cache_key(
        system_prompt=build_adaptation_planner_system_prompt(),
        user_message=build_adaptation_planner_user_message(
            fixture.analysis, fixture.match_result
        ),
        response_schema=_AdaptationDecision,
        model="claude-haiku-4-5-20251001",
    )
    return str(CACHE_DIR / f"{key}.json")


@pytest.mark.parametrize(
    "fixture",
    ALL_FIXTURES,
    ids=[f.name for f in ALL_FIXTURES],
)
def test_planner_emits_expected_outcome(fixture: AdapterFixture) -> None:
    """Run the fixture's brief through the planner and check the
    decoded outcome against the expected envelope.

    Cache-only mode: when the cache file is missing AND no API key
    is set, ``LLMUnavailableError`` fires inside the runner and
    bubbles up to this test. We catch it and skip with a precise
    message naming the cache file the operator must mint."""
    llm_client = LLMClient()
    cache_path = _expected_cache_path(fixture)
    try:
        outcome, metadata = run_adaptation_planner(
            analysis=fixture.analysis,
            match=fixture.match_result,
            llm_client=llm_client,
        )
    except LLMUnavailableError:
        pytest.skip(
            f"[{fixture.name}] missing cache file: {cache_path}. "
            f"Mint with `ANTHROPIC_API_KEY=sk-ant-... pytest "
            f"tests/test_adaptation_planner_fixtures.py -k {fixture.name}`."
        )

    # Cost guardrail — slice prompt sets ≤ $0.01 per planner call
    # (Haiku 4.5 with cached system prompt). Cache hits cost ~$0.0001;
    # cache-misses (mint runs) cost ~$0.005.
    assert metadata.llm_cost_usd <= 0.01, (
        f"[{fixture.name}] planner cost ${metadata.llm_cost_usd:.4f} "
        f"exceeds $0.01 budget"
    )

    if isinstance(fixture.expected, ExpectedAdapt):
        assert isinstance(outcome, AdaptationPlan), (
            f"[{fixture.name}] expected AdaptationPlan, got "
            f"{type(outcome).__name__}: {outcome}"
        )
        assert fixture.expected.matches(outcome.mirror_axis, outcome.rotation), (
            f"[{fixture.name}] planner emitted "
            f"(mirror={outcome.mirror_axis}, rotation={outcome.rotation.value}); "
            f"acceptable plans were: {fixture.expected.acceptable_plans}"
        )
        # Reasoning must be non-trivial (Pydantic enforces ≥ 10 chars
        # but we want a real explanation, not "LGTM enough").
        assert len(outcome.reasoning) >= 20, (
            f"[{fixture.name}] reasoning too short: {outcome.reasoning!r}"
        )
        assert metadata.refused is False
    else:
        assert isinstance(outcome, AdaptationFailed), (
            f"[{fixture.name}] expected AdaptationFailed, got "
            f"{type(outcome).__name__}: {outcome}"
        )
        assert outcome.suggested_action in fixture.expected.allowed_actions, (
            f"[{fixture.name}] suggested_action="
            f"{outcome.suggested_action!r}; allowed: "
            f"{fixture.expected.allowed_actions}"
        )
        assert metadata.refused is True


def test_no_op_plan_short_circuits_apply_adaptations() -> None:
    """End-to-end smoke: a no-op fixture's plan, fed through
    apply_adaptations, returns the input BuildingModel unchanged
    (Phase A's no-op short-circuit). Non-fixture-dependent — uses
    a synthetic plan to cover the wiring without burning a cache."""
    from app.services.design_agent.transforms import apply_adaptations
    from app.services.design_agent.types import AdaptationPlan
    from app.templates import build_2bhk_pune_house

    bm = build_2bhk_pune_house()
    noop = AdaptationPlan(
        mirror_axis=None,
        rotation=TransformRotation.NONE,
        reasoning="planner-produced no-op for north-facing brief",
    )
    out = apply_adaptations(bm, noop)
    assert out is bm
