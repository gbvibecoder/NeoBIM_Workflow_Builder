"""Slice 2B.3.B — Fixture-driven ExtensionPlanner tests (20 briefs).

Each fixture in :data:`tests.fixtures._2b3_briefs.ALL_FIXTURES` is
run through :func:`run_extension_planner` and checked against its
:class:`ExpectedPlan` / :class:`ExpectedRefuse` envelope.

Three states (mirroring ``test_adaptation_planner_fixtures.py``):

* Cache present at ``app/services/design_agent/cache/`` (canonical
  committed location): tests run from disk, no API key needed.
* No cache + no ``ANTHROPIC_API_KEY``: each fixture's test skips
  with a precise message naming the missing cache key.
* No cache + valid key: real Haiku 4.5 calls run, cache files land
  in the canonical cache dir. Mint cost ~$0.005 × 20 = ~$0.10
  total (≤ $0.30 one-time mint target).

Mint
----
    ANTHROPIC_API_KEY=sk-ant-... pytest \\
        tests/test_extension_planner_fixtures.py --tb=short

Then commit the new files under ``app/services/design_agent/cache/``.
"""

from __future__ import annotations

import pytest

from app.services.design_agent.llm_client import (
    CACHE_DIR,
    LLMClient,
    LLMUnavailableError,
    compute_cache_key,
)
from app.services.design_agent.prompts.extension_planner import (
    build_extension_planner_system_prompt,
    build_extension_planner_user_message,
)
from app.services.design_agent.stages.extension_planner import (
    _ExtensionDecision,
    run_extension_planner,
)
from app.services.design_agent.types import (
    ExtensionFailed,
    ExtensionPlan,
    ExtensionType,
)
from tests.fixtures._2b3_briefs import (
    ALL_FIXTURES,
    ExpectedPlan,
    ExpectedRefuse,
    ExtensionFixture,
)


# ─── Sanity tests on the fixture set itself ──────────────────────────


def test_twenty_fixtures_authored() -> None:
    """20 fixtures per Slice 2B.3.B contract (5 single + 5 multi +
    5 vague + 3 defer + 2 noop)."""
    assert len(ALL_FIXTURES) == 20, (
        f"expected 20 planner fixtures, got {len(ALL_FIXTURES)}"
    )


def test_fixture_names_unique() -> None:
    names = [f.name for f in ALL_FIXTURES]
    assert len(names) == len(set(names)), (
        f"duplicate fixture name(s): {names}"
    )


def test_fixture_category_distribution() -> None:
    """5 single + 5 multi + 5 vague + 3 defer + 2 noop = 20."""
    plans = [f for f in ALL_FIXTURES if isinstance(f.expected, ExpectedPlan)]
    refuses = [
        f for f in ALL_FIXTURES if isinstance(f.expected, ExpectedRefuse)
    ]
    # 5 single + 5 multi + 5 vague + 2 noop = 17 plan, 3 defer = 3 refuse.
    assert len(plans) == 17, (
        f"expected 17 ExpectedPlan fixtures (5 single + 5 multi + 5 "
        f"vague + 2 noop); got {len(plans)}"
    )
    assert len(refuses) == 3, (
        f"expected 3 ExpectedRefuse fixtures (v2-deferral); got "
        f"{len(refuses)}"
    )


# ─── Fixture-driven test runner ──────────────────────────────────────


def _expected_cache_path(fixture: ExtensionFixture) -> str:
    key = compute_cache_key(
        system_prompt=build_extension_planner_system_prompt(),
        user_message=build_extension_planner_user_message(
            fixture.analysis, fixture.match_result
        ),
        response_schema=_ExtensionDecision,
        model="claude-haiku-4-5-20251001",
    )
    return str(CACHE_DIR / f"{key}.json")


@pytest.mark.parametrize(
    "fixture",
    ALL_FIXTURES,
    ids=[f.name for f in ALL_FIXTURES],
)
def test_planner_emits_expected_outcome(fixture: ExtensionFixture) -> None:
    """Run the fixture's brief through the planner and check the
    decoded outcome against the expected envelope.

    Cache-only skip path: missing cache file → ``LLMUnavailableError``
    bubbles up → pytest.skip with a precise message naming the cache
    file the operator must mint.
    """
    llm_client = LLMClient()
    cache_path = _expected_cache_path(fixture)
    try:
        outcome, metadata = run_extension_planner(
            analysis=fixture.analysis,
            match=fixture.match_result,
            llm_client=llm_client,
        )
    except LLMUnavailableError:
        pytest.skip(
            f"[{fixture.name}] missing cache file: {cache_path}. "
            f"Mint with `ANTHROPIC_API_KEY=sk-ant-... pytest "
            f"tests/test_extension_planner_fixtures.py -k {fixture.name}`."
        )

    # Cost guardrail — slice spec ≤ $0.015 per planner call.
    assert metadata.llm_cost_usd <= 0.015, (
        f"[{fixture.name}] planner cost ${metadata.llm_cost_usd:.4f} "
        f"exceeds $0.015 budget"
    )

    if isinstance(fixture.expected, ExpectedPlan):
        assert isinstance(outcome, ExtensionPlan), (
            f"[{fixture.name}] expected ExtensionPlan, got "
            f"{type(outcome).__name__}: {outcome}"
        )
        actual_types = frozenset(r.extension_type for r in outcome.extensions)
        assert fixture.expected.matches(actual_types), (
            f"[{fixture.name}] planner emitted extensions={sorted(t.value for t in actual_types)}; "
            f"acceptable sets were: "
            f"{[sorted(t.value for t in s) for s in fixture.expected.acceptable_sets]}"
        )
        assert len(outcome.reasoning) >= 20, (
            f"[{fixture.name}] reasoning too short: {outcome.reasoning!r}"
        )
        assert metadata.refused is False
    else:
        assert isinstance(outcome, ExtensionFailed), (
            f"[{fixture.name}] expected ExtensionFailed, got "
            f"{type(outcome).__name__}: {outcome}"
        )
        assert outcome.suggested_action in fixture.expected.allowed_actions, (
            f"[{fixture.name}] suggested_action="
            f"{outcome.suggested_action!r}; allowed: "
            f"{fixture.expected.allowed_actions}"
        )
        assert metadata.refused is True


# ─── End-to-end smoke (non-fixture-dependent, no LLM needed) ────────


def test_empty_plan_short_circuits_apply_extensions() -> None:
    """A planner-produced empty ExtensionPlan should short-circuit
    apply_extensions to return input bm unchanged (orchestrator
    no-op path verified in Phase A.3)."""
    from app.services.design_agent.transforms_extensions import apply_extensions
    from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house

    bm = build_3bhk_pune_house()
    noop = ExtensionPlan(
        extensions=[],
        reasoning="planner-produced no-op for minimalist brief",
    )
    out, failed = apply_extensions(bm, noop)
    assert out is bm
    assert failed is None


def test_populated_plan_dispatches_through_orchestrator() -> None:
    """A planner-produced plan with all 5 True is dispatched correctly
    by the orchestrator (3BHK House baseline)."""
    from app.services.design_agent.transforms_extensions import apply_extensions
    from app.services.design_agent.types import (
        ExtensionAttachment,
        ExtensionRequest,
    )
    from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house

    bm = build_3bhk_pune_house()
    full_plan = ExtensionPlan(
        extensions=[
            ExtensionRequest(extension_type=t, attachment=ExtensionAttachment.FRONT)
            for t in ExtensionType
        ],
        reasoning="all-5 plan simulating planner output",
    )
    out, failed = apply_extensions(bm, full_plan)
    assert failed is None
    # +1 storey for mumty, +3 rooms (2 servant + 1 mumty).
    assert len(out.project.site.building.storeys) == 2
    new_rooms = sum(len(s.rooms) for s in out.project.site.building.storeys)
    base_rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    assert new_rooms - base_rooms == 3
