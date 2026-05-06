"""Phase 1 Slice 6 — IDS violation reduction proof.

THE most important test in Phase 1. Builds `multistorey_residential`
twice — once through the legacy pipeline, once through the parametric
pipeline — runs Stage 2.5 (the same ifctester invocation the route
handler does post-BUILD) against every emitted discipline IFC, and
asserts the parametric path produces at least 30% fewer total
violations.

If this test fails: do NOT lower the threshold. Investigate which
violation types didn't reduce, escalate to the plan author with the
top 5 categories not reduced, and add the missing emissions in a
follow-up commit on the same branch.

Slice 6 baseline: 152 violations on multistorey_residential (Phase 0
captured this number). Target: ≤ 106 (≥30% reduction).
"""

from __future__ import annotations

import json
import tempfile
from collections import Counter
from pathlib import Path

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.ids_validator import merge_results, validate_ifc
from app.services.ifc_builder import build_multi_discipline


_FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _build_and_count_violations(
    fixture_name: str, use_parametric: bool
) -> tuple[int, Counter]:
    """Build the fixture across all 4 disciplines, run Stage 2.5 against
    each, return (total_violations, per_rule_counter)."""
    pytest.importorskip("ifctester")  # skip if ifctester not installed
    with open(_FIXTURE_DIR / f"{fixture_name}.json") as fp:
        d = json.load(fp)
    d.pop("_comment", None)
    req = ExportIFCRequest.model_validate(d)
    if use_parametric:
        req = req.model_copy(
            update={
                "options": req.options.model_copy(
                    update={"use_parametric_pipeline": True}
                )
            }
        )
    target_fidelity = req.options.target_fidelity
    results = build_multi_discipline(req)

    per_discipline = []
    for discipline, (ifc_bytes, _, _) in results.items():
        with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as tmp:
            tmp.write(ifc_bytes)
            tmp.flush()
            tmp_path = tmp.name
        model = ifcopenshell.open(tmp_path)
        per_discipline.append(validate_ifc(model, discipline, target_fidelity))
    merged = merge_results(per_discipline)
    counter: Counter = Counter()
    for v in merged.violations:
        counter[v.rule_id] += 1
    return len(merged.violations), counter


def test_phase1_ids_violations_reduced_by_at_least_30_percent():
    """The Slice 6 acceptance gate."""
    legacy_total, legacy_breakdown = _build_and_count_violations(
        "multistorey_residential", use_parametric=False
    )
    parametric_total, parametric_breakdown = _build_and_count_violations(
        "multistorey_residential", use_parametric=True
    )
    target_max = legacy_total * 0.70
    reduction_pct = (
        (legacy_total - parametric_total) / legacy_total * 100
        if legacy_total > 0
        else 0.0
    )
    print(
        f"\nIDS reduction on multistorey_residential:\n"
        f"  legacy:     {legacy_total} violations\n"
        f"  parametric: {parametric_total} violations\n"
        f"  reduction:  {reduction_pct:.1f}%\n"
        f"  target:     >= 30%  (≤ {int(target_max)} violations)\n"
    )
    if parametric_total > target_max:
        # Surface the top categories not reducing so the plan author can
        # decide where to add emissions next.
        not_reduced = []
        for rule, legacy_count in legacy_breakdown.most_common():
            param_count = parametric_breakdown.get(rule, 0)
            if param_count >= legacy_count:
                not_reduced.append((rule, legacy_count, param_count))
        snippet = "\n".join(
            f"    {leg:3d} → {par:3d}  {rule}"
            for rule, leg, par in not_reduced[:10]
        )
        pytest.fail(
            f"Phase 1 IDS reduction FAILED on multistorey_residential. "
            f"Got {parametric_total} violations vs target ≤{int(target_max)} "
            f"({reduction_pct:.1f}% reduction, need ≥30%).\n\n"
            f"Top 10 violation types NOT reduced (legacy → parametric):\n{snippet}\n\n"
            "Do NOT lower the threshold. Add the missing emissions or "
            "escalate to the plan author with these categories."
        )
    assert parametric_total <= target_max


def test_top_5_violation_types_eliminated_documented():
    """Documents the top 5 violation types eliminated by the parametric
    path. This is the value-add Phase 1 claims; pinning it as a test
    means a regression that re-introduces the violations fails CI."""
    legacy_total, legacy_breakdown = _build_and_count_violations(
        "multistorey_residential", use_parametric=False
    )
    parametric_total, parametric_breakdown = _build_and_count_violations(
        "multistorey_residential", use_parametric=True
    )
    eliminated = []
    for rule, legacy_count in legacy_breakdown.most_common():
        param_count = parametric_breakdown.get(rule, 0)
        if param_count < legacy_count:
            eliminated.append((rule, legacy_count, param_count, legacy_count - param_count))
    eliminated.sort(key=lambda r: -r[3])  # by reduction count
    top_5 = eliminated[:5]
    print("\nTop 5 violation types eliminated by parametric path:")
    for rule, leg, par, reduction in top_5:
        print(f"  {leg:3d} → {par:3d}  ({reduction:+3d})  {rule}")
    # At least 3 distinct rule types must show reduction
    assert len(eliminated) >= 3, (
        f"Only {len(eliminated)} rule types reduced; expected at least 3 "
        "distinct categories to demonstrate parametric value."
    )
