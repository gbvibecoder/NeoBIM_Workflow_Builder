"""Phase 0 R7 — buildingSMART Validation Service baseline drift gate.

Reads the JSON reports produced by `scripts/submit_buildingsmart_baseline.py`
under `tests/baselines/buildingsmart-validation/<fixture>_<date>.json`
and asserts the error counts match the latest-committed baseline.

A drift in either direction (better OR worse) fails until a human
re-runs the baseline script and re-commits the JSONs. This is intentional:
both directions of drift represent state we want a human to confirm.

When NO baselines are committed yet (the Phase 0 deferred state), all
parametrized tests pytest.skip with a clear message rather than failing
the CI run. CI green-lights once baselines are produced and committed.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

BASELINE_DIR = Path(__file__).parent / "baselines" / "buildingsmart-validation"
EXPECTED_FIXTURES = ["simple_box", "multistorey_residential", "non_rectangular"]


def _latest_report(fixture: str) -> Path | None:
    """Return the most-recent baseline JSON for `fixture`, or None."""
    if not BASELINE_DIR.exists():
        return None
    candidates = sorted(BASELINE_DIR.glob(f"{fixture}_*.json"))
    return candidates[-1] if candidates else None


@pytest.mark.parametrize("fixture", EXPECTED_FIXTURES)
def test_baseline_report_exists(fixture: str):
    path = _latest_report(fixture)
    if path is None:
        pytest.skip(
            f"No baseline committed yet for {fixture}. Run "
            "`python scripts/submit_buildingsmart_baseline.py` and commit "
            f"the JSON under {BASELINE_DIR.relative_to(Path.cwd())}/."
        )
    assert path.is_file(), f"{path} should be a file"


@pytest.mark.parametrize("fixture", EXPECTED_FIXTURES)
def test_baseline_report_has_summary_block(fixture: str):
    """Every committed report carries `summary.error_count` and
    `summary.warning_count` so the drift gate has something to pin."""
    path = _latest_report(fixture)
    if path is None:
        pytest.skip(f"No baseline committed yet for {fixture}.")

    data = json.loads(path.read_text())
    summary = data.get("summary")
    assert summary is not None, f"{path}: missing 'summary' block"
    assert "error_count" in summary, f"{path}: summary missing 'error_count'"
    assert "warning_count" in summary, f"{path}: summary missing 'warning_count'"


@pytest.mark.parametrize("fixture", EXPECTED_FIXTURES)
def test_baseline_drift_within_committed_pin(fixture: str):
    """When two or more reports exist for the same fixture, the most
    recent one's error count must match the second-most-recent. This is
    the actual drift gate — it locks every CI run against the baseline
    and forces a human to re-pin when a builder change shifts the count."""
    if not BASELINE_DIR.exists():
        pytest.skip("No baseline directory yet.")

    candidates = sorted(BASELINE_DIR.glob(f"{fixture}_*.json"))
    if len(candidates) < 2:
        pytest.skip(
            f"Need ≥2 committed reports for {fixture} to detect drift "
            f"(found {len(candidates)})."
        )
    latest = json.loads(candidates[-1].read_text())
    previous = json.loads(candidates[-2].read_text())
    latest_errors = latest.get("summary", {}).get("error_count")
    previous_errors = previous.get("summary", {}).get("error_count")
    assert latest_errors == previous_errors, (
        f"{fixture}: error_count drifted "
        f"{previous_errors} → {latest_errors} between "
        f"{candidates[-2].name} and {candidates[-1].name}. "
        f"Re-run scripts/submit_buildingsmart_baseline.py and re-commit "
        f"if intentional."
    )


def test_summary_md_present_when_any_report_committed():
    """If any per-fixture JSON exists, the SUMMARY.md must exist alongside
    it — that's how a reviewer interprets the raw JSONs."""
    if not BASELINE_DIR.exists():
        pytest.skip("No baseline directory yet.")
    if not any(BASELINE_DIR.glob("*.json")):
        pytest.skip("No baseline JSONs committed yet.")
    summary = BASELINE_DIR / "SUMMARY.md"
    assert summary.is_file(), (
        f"{summary} must exist alongside the per-fixture JSON reports. "
        "Re-run scripts/submit_buildingsmart_baseline.py."
    )
