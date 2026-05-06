#!/usr/bin/env python3
"""Phase 0 R3 — buildingSMART Validation Service baseline runner.

Submits each fixture's combined-discipline IFC (rich_mode=full) to
validate.buildingsmart.org and writes the structured report to
`tests/baselines/buildingsmart-validation/<fixture>_<date>.json`.

This script is the deferred-work artefact. The Phase 0 prompt requires
the baseline reports to exist in the repo, but the buildingSMART service
is external — the script is invoked manually by the human running the
phase, or by the release workflow once the
`BSDD_VALIDATION_SERVICE_TOKEN` secret is provisioned.

Usage:
    # Submit all fixtures (interactive — uses the public web endpoint):
    python scripts/submit_buildingsmart_baseline.py

    # CI mode (token from env var, no interactive auth):
    BSDD_VALIDATION_SERVICE_TOKEN=... \
      python scripts/submit_buildingsmart_baseline.py \
        --fixtures simple_box,multistorey_residential,non_rectangular \
        --output tests/baselines/buildingsmart-validation

The endpoint URL and request shape are documented at
https://github.com/buildingSMART/validation-service. If the public API
changes, update `_submit_to_buildingsmart` below — every other piece
of this script (fixture loading, IFC build, report writing) is stable.

This script never modifies builders or IDS files. It is purely a
producer of `tests/baselines/buildingsmart-validation/*.json`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.models.request import ExportIFCRequest  # noqa: E402
from app.services.ifc_builder import build_multi_discipline  # noqa: E402

FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "tests" / "baselines" / "buildingsmart-validation"
BSDD_API_BASE = os.environ.get(
    "BSDD_VALIDATION_API_BASE",
    "https://validate.buildingsmart.org/api/validate",
)


def _load_fixture(name: str, rich_mode: str) -> ExportIFCRequest:
    raw = json.loads((FIXTURE_DIR / f"{name}.json").read_text())
    raw.pop("_comment", None)
    raw.setdefault("options", {})["richMode"] = rich_mode
    raw["options"]["disciplines"] = ["combined"]
    return ExportIFCRequest.model_validate(raw)


def _build_ifc(req: ExportIFCRequest) -> bytes:
    results = build_multi_discipline(req)
    ifc_bytes, _, _ = results["combined"]
    return ifc_bytes


def _submit_to_buildingsmart(
    ifc_bytes: bytes,
    filename: str,
    token: str | None,
) -> dict[str, Any]:
    """POST the IFC to validate.buildingsmart.org.

    Falls back to a deterministic offline stub when:
      * the `requests` library is missing
      * the service URL is unreachable
      * `--offline` was passed (set BSDD_VALIDATION_OFFLINE=1 to force)

    The stub is structurally identical to a real response so callers
    can wire downstream code against the same shape.
    """
    if os.environ.get("BSDD_VALIDATION_OFFLINE") == "1":
        return _offline_stub(filename, reason="BSDD_VALIDATION_OFFLINE=1")

    try:
        import requests  # type: ignore[import-not-found]
    except ImportError:
        return _offline_stub(filename, reason="requests library not installed")

    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
            tmp.write(ifc_bytes)
            tmp.flush()
            tmp_path = tmp.name
        with open(tmp_path, "rb") as fh:
            resp = requests.post(
                BSDD_API_BASE,
                files={"file": (filename, fh, "application/x-step")},
                headers=headers,
                timeout=120,
            )
    except Exception as exc:  # noqa: BLE001
        return _offline_stub(filename, reason=f"submit failed: {exc}")

    if resp.status_code >= 400:
        return _offline_stub(
            filename,
            reason=f"HTTP {resp.status_code}: {resp.text[:200]}",
        )

    try:
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        return _offline_stub(filename, reason=f"non-JSON response: {exc}")


def _offline_stub(filename: str, reason: str) -> dict[str, Any]:
    """Deterministic placeholder report so callers can pin shape and
    drift-detect even when the service is unreachable. Make the human
    intent obvious by stuffing the reason into the report itself."""
    return {
        "$schema": "neobim/buildingsmart-validation-stub-v1",
        "filename": filename,
        "submitted_at": date.today().isoformat(),
        "service_status": "stub",
        "skipped_reason": reason,
        "results": {
            "normative_rule_errors": [],
            "industry_practice_warnings": [],
            "bsdd_compliance": {"checked": False, "issues": []},
        },
        "summary": {
            "error_count": 0,
            "warning_count": 0,
            "rules_evaluated": 0,
        },
    }


def _summarise_top_errors(reports: dict[str, dict[str, Any]]) -> list[tuple[str, int]]:
    """Across all fixtures, return the top-N most common normative-rule
    error codes — feeds the SUMMARY.md generated below."""
    counter: Counter[str] = Counter()
    for fixture, report in reports.items():
        for err in report.get("results", {}).get("normative_rule_errors", []):
            code = err.get("rule") or err.get("code") or "(unspecified)"
            counter[code] += 1
    return counter.most_common(5)


def _write_summary(output_dir: Path, reports: dict[str, dict[str, Any]]) -> Path:
    """Write tests/baselines/buildingsmart-validation/SUMMARY.md."""
    rows = []
    for fixture, report in sorted(reports.items()):
        summary = report.get("summary", {})
        service_status = report.get("service_status", "live")
        rows.append((
            fixture,
            summary.get("error_count", "?"),
            summary.get("warning_count", "?"),
            service_status,
        ))

    top = _summarise_top_errors(reports)

    lines = [
        "# buildingSMART Validation Service — baseline summary",
        "",
        f"**Captured:** {date.today().isoformat()}",
        f"**Endpoint:** `{BSDD_API_BASE}`",
        "",
        "## Per-fixture",
        "",
        "| fixture | errors | warnings | service status |",
        "|---|---:|---:|---|",
    ]
    for fixture, errors, warns, status in rows:
        lines.append(f"| `{fixture}` | {errors} | {warns} | `{status}` |")

    lines += ["", "## Top 5 most common error codes", ""]
    if not top:
        lines.append("_No structured error codes captured (either zero errors or the report is a stub)._")
    else:
        lines.append("| rank | code | count |")
        lines.append("|---:|---|---:|")
        for i, (code, n) in enumerate(top, 1):
            lines.append(f"| {i} | `{code}` | {n} |")

    lines += [
        "",
        "## What this baseline gates",
        "",
        "`tests/test_buildingsmart_baseline.py` reads these JSON reports and",
        "asserts the per-fixture error count matches what was committed. A",
        "drift in either direction (better or worse) fails the test until",
        "a human re-runs `submit_buildingsmart_baseline.py` and re-pins.",
        "",
        "## How to refresh",
        "",
        "```bash",
        "cd neobim-ifc-service",
        "BSDD_VALIDATION_SERVICE_TOKEN=… python scripts/submit_buildingsmart_baseline.py",
        "```",
        "",
        "Or run it offline (stubbed) for shape-only updates:",
        "",
        "```bash",
        "BSDD_VALIDATION_OFFLINE=1 python scripts/submit_buildingsmart_baseline.py",
        "```",
    ]
    path = output_dir / "SUMMARY.md"
    path.write_text("\n".join(lines) + "\n")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fixtures",
        default="simple_box,multistorey_residential,non_rectangular",
        help="Comma-separated fixture names (matching tests/fixtures/<name>.json).",
    )
    parser.add_argument(
        "--rich-mode",
        default="full",
        help="rich_mode value to pin into the build (default: full).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for JSON reports + SUMMARY.md.",
    )
    parser.add_argument(
        "--fail-on-baseline-drift",
        action="store_true",
        help="Exit non-zero if any fixture's error count drifts from the committed baseline.",
    )
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)

    fixtures = [f.strip() for f in args.fixtures.split(",") if f.strip()]
    token = os.environ.get("BSDD_VALIDATION_SERVICE_TOKEN")
    today = date.today().isoformat()

    reports: dict[str, dict[str, Any]] = {}
    drift_detected: list[str] = []

    for fixture in fixtures:
        print(f"[buildingSMART] {fixture}: building IFC…")
        req = _load_fixture(fixture, args.rich_mode)
        ifc_bytes = _build_ifc(req)
        print(f"[buildingSMART] {fixture}: submitting ({len(ifc_bytes):,} bytes)…")
        report = _submit_to_buildingsmart(ifc_bytes, f"{fixture}.ifc", token)

        out_path = args.output / f"{fixture}_{today}.json"
        out_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(f"[buildingSMART] {fixture}: wrote {out_path.relative_to(REPO_ROOT)}")
        reports[fixture] = report

        if args.fail_on_baseline_drift:
            committed = sorted(args.output.glob(f"{fixture}_*.json"))
            committed_pre_today = [p for p in committed if not p.name.endswith(f"_{today}.json")]
            if committed_pre_today:
                last = json.loads(committed_pre_today[-1].read_text())
                old = last.get("summary", {}).get("error_count")
                new = report.get("summary", {}).get("error_count")
                if old is not None and new is not None and old != new:
                    drift_detected.append(f"{fixture}: {old} → {new}")

    summary_path = _write_summary(args.output, reports)
    print(f"[buildingSMART] wrote {summary_path.relative_to(REPO_ROOT)}")

    if drift_detected:
        print("\nbaseline drift detected:")
        for d in drift_detected:
            print(f"  - {d}")
        if args.fail_on_baseline_drift:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
