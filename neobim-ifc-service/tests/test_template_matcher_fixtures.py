"""Slice 2B.1.C — Fixture-driven TemplateMatcher tests (20 briefs).

Each fixture in :data:`tests.fixtures._2b1_briefs.ALL_FIXTURES` is run
through :func:`run_template_matcher` and checked against its
:class:`ExpectedMatch` / :class:`ExpectedRefuse` envelope.

Three states (mirroring test_brief_analyst.py):

* Cache present in ``app/services/design_agent/cache/`` (the canonical
  committed location): tests run from disk, no API key needed.
  Deterministic + cheap.
* No cache + no ``ANTHROPIC_API_KEY``: each fixture's test skips with
  a message naming the missing cache key — operators see exactly
  which fixture cache to mint.
* No cache + valid key: real Haiku 4.5 calls run, cache files land in
  the canonical cache dir, and the assertions execute. The cost is
  ~$0.10 total (20 calls @ $0.005 first-write each).

To mint cache locally:

    ANTHROPIC_API_KEY=sk-ant-... pytest \\
        tests/test_template_matcher_fixtures.py \\
        --tb=short

Then commit the new files under ``app/services/design_agent/cache/``.
"""

from __future__ import annotations

import os

import pytest

from app.services.design_agent import (
    LLMClient,
    LLMUnavailableError,
    MatchFailed,
    MatchResult,
    run_template_matcher,
)
from tests.fixtures._2b1_briefs import (
    ALL_FIXTURES,
    ExpectedMatch,
    ExpectedRefuse,
    MatcherFixture,
)


# ─── Sanity tests on the fixture set itself ──────────────────────────


def test_twenty_fixtures_authored() -> None:
    """The matcher is calibrated against exactly 20 fixtures (5 per
    category). Drift here means the spec contract has been altered."""
    assert len(ALL_FIXTURES) == 20, (
        f"expected 20 matcher fixtures, got {len(ALL_FIXTURES)}"
    )


def test_fixture_names_unique() -> None:
    names = [f.name for f in ALL_FIXTURES]
    assert len(names) == len(set(names)), (
        f"duplicate fixture name(s): {names}"
    )


def test_five_match_per_category() -> None:
    """5 ExpectedMatch (clear) + 5 ExpectedMatch (ambiguous) +
    5 ExpectedMatch (edge) + 5 ExpectedRefuse (negative) = 20."""
    matches = [f for f in ALL_FIXTURES if isinstance(f.expected, ExpectedMatch)]
    refuses = [f for f in ALL_FIXTURES if isinstance(f.expected, ExpectedRefuse)]
    assert len(matches) == 15, (
        f"expected 15 ExpectedMatch fixtures (5 clear + 5 ambiguous + "
        f"5 edge), got {len(matches)}"
    )
    assert len(refuses) == 5, (
        f"expected 5 ExpectedRefuse fixtures, got {len(refuses)}"
    )


def test_fixture_briefs_validate_at_import_time() -> None:
    """Pydantic invariants on every fixture's BriefAnalysis must hold.
    Construction in ``_2b1_briefs.py`` already raises on validation
    failure; this test pins that the import path was clean and every
    BriefAnalysis is non-None.
    """
    for f in ALL_FIXTURES:
        assert f.analysis is not None, (
            f"fixture {f.name}: BriefAnalysis is None"
        )
        # Pydantic model_dump triggers serialization checks one more time.
        dumped = f.analysis.model_dump(mode="json")
        assert isinstance(dumped, dict)
        assert "building_class" in dumped


# ─── LLM-driven tests — graceful skip on cache miss ──────────────────


def _run_or_skip(fixture: MatcherFixture):
    """Run the matcher on a fixture. Skip cleanly on cache miss + no
    API key.

    Returns ``(decoded, metadata)`` where ``decoded`` is either a
    :class:`MatchResult` or :class:`MatchFailed` per the runner's
    contract.
    """
    client = LLMClient()
    try:
        return run_template_matcher(fixture.analysis, llm_client=client)
    except LLMUnavailableError as exc:
        pytest.skip(
            f"TemplateMatcher cache miss for fixture '{fixture.name}'; "
            f"ANTHROPIC_API_KEY unset. Run "
            f"`ANTHROPIC_API_KEY=sk-ant-... pytest "
            f"tests/test_template_matcher_fixtures.py` to mint cache. "
            f"Detail: {exc}"
        )


def _format_param_assertion_failure(
    fixture: MatcherFixture,
    description: str,
    parameters,
) -> str:
    return (
        f"fixture '{fixture.name}': parameter assertion failed.\n"
        f"  expected: {description}\n"
        f"  actual parameters: {parameters!r}"
    )


@pytest.mark.parametrize(
    "fixture", ALL_FIXTURES, ids=lambda f: f.name
)
def test_matcher_fixture_decision(fixture: MatcherFixture) -> None:
    """Run each fixture and assert its expected outcome.

    Skips cleanly on cache miss when no API key is present. With cache
    minted (locally + committed), the test runs deterministically from
    disk in CI.
    """
    decoded, metadata = _run_or_skip(fixture)

    if isinstance(fixture.expected, ExpectedMatch):
        assert isinstance(decoded, MatchResult), (
            f"fixture '{fixture.name}': expected MatchResult, got "
            f"{type(decoded).__name__} (reason="
            f"{getattr(decoded, 'reason', '<none>')!r})"
        )
        assert decoded.template_id == fixture.expected.template_id, (
            f"fixture '{fixture.name}': matcher picked "
            f"{decoded.template_id.value!r}, expected "
            f"{fixture.expected.template_id.value!r}"
        )
        assert decoded.confidence >= fixture.expected.min_confidence, (
            f"fixture '{fixture.name}': matcher confidence "
            f"{decoded.confidence:.3f} below expected minimum "
            f"{fixture.expected.min_confidence:.3f}"
        )
        for desc, predicate in fixture.expected.parameter_assertions:
            assert predicate(decoded.parameters), (
                _format_param_assertion_failure(
                    fixture, desc, decoded.parameters
                )
            )
        # Metadata must reflect the success path.
        assert metadata.refused is False
    else:
        # ExpectedRefuse
        assert isinstance(decoded, MatchFailed), (
            f"fixture '{fixture.name}': expected MatchFailed, got "
            f"MatchResult ({decoded!r})"
        )
        assert decoded.best_confidence <= fixture.expected.max_best_confidence, (
            f"fixture '{fixture.name}': matcher reported best_confidence "
            f"{decoded.best_confidence:.3f} above expected ceiling "
            f"{fixture.expected.max_best_confidence:.3f} for a refusal"
        )
        assert decoded.suggested_action in fixture.expected.allowed_actions, (
            f"fixture '{fixture.name}': suggested_action "
            f"{decoded.suggested_action!r} not in allowed set "
            f"{fixture.expected.allowed_actions!r}"
        )
        # Metadata must reflect the refusal path.
        assert metadata.refused is True


# ─── Sanity test: cache directory location is the committed canonical ─


def test_default_llm_client_writes_to_canonical_cache_dir() -> None:
    """When ``LLMClient()`` is instantiated with no ``cache_dir`` arg,
    it MUST point at ``app/services/design_agent/cache/`` — the
    canonical, committed cache directory. A drift here would mean
    minted cache files land in the wrong spot and the committed
    files are never replayed in CI.
    """
    from app.services.design_agent.llm_client import CACHE_DIR

    client = LLMClient()
    # The client stores the path internally as _cache_dir; we check the
    # public CACHE_DIR constant which must equal the cache/ next to
    # llm_client.py.
    assert CACHE_DIR.name == "cache"
    assert CACHE_DIR.parent.name == "design_agent"
    assert client._cache_dir == CACHE_DIR


# ─── Sanity test: skips happen as expected when no key + no cache ────


def test_run_or_skip_skips_cleanly_without_key_and_cache(
    monkeypatch, tmp_path
) -> None:
    """When the API key is unset AND the cache file for a fixture is
    missing, _run_or_skip surfaces ``pytest.skip`` rather than raising
    or returning a fabricated response. Pinned with a tmp cache_dir so
    we genuinely guarantee a miss."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    fixture = ALL_FIXTURES[0]
    client = LLMClient(cache_dir=tmp_path)

    # Replicate the body of _run_or_skip but verify the skip triggers.
    with pytest.raises(pytest.skip.Exception):
        try:
            run_template_matcher(fixture.analysis, llm_client=client)
        except LLMUnavailableError as exc:
            pytest.skip(f"cache miss + no key: {exc}")
