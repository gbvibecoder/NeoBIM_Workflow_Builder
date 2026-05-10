"""Phase P1.6 — IDS violation diagnostic.

Runs the LOD-300 IDS rule set against every Tier-2 IFC under
`temp_folder/` and dumps a per-rule, per-template violation breakdown
so we can target fixes precisely instead of speculating.

Usage:
    python3.11 scripts/inspect_p1_6_ids_violations.py
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_SERVICE_ROOT = _SCRIPT_DIR.parent
sys.path.insert(0, str(_SERVICE_ROOT))

import ifcopenshell  # noqa: E402

from app.services.ids_validator import validate_ifc  # noqa: E402


_REPO_ROOT = _SERVICE_ROOT.parent
_IFC_DIR = _REPO_ROOT / "temp_folder"


def main() -> int:
    ifcs = sorted(_IFC_DIR.glob("tier2_*_pune_*.ifc")) + sorted(
        _IFC_DIR.glob("tier2_*_pune_v1.ifc")
    )
    ifcs = sorted(set(ifcs))
    if not ifcs:
        print("✗ no Tier-2 IFCs found in temp_folder/")
        return 1

    # rule_id → list of (template_label, count)
    by_rule: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_template: dict[str, int] = {}
    rules_evaluated_per_template: dict[str, int] = {}

    print("=" * 80)
    print(f"P1.6 IDS Violation Diagnostic — {len(ifcs)} templates")
    print("=" * 80)

    for ifc_path in ifcs:
        label = ifc_path.stem
        model = ifcopenshell.open(str(ifc_path))
        result = validate_ifc(model, "combined", "LOD-300")
        n_v = len(result.violations)
        by_template[label] = n_v
        rules_evaluated_per_template[label] = result.rules_evaluated
        print(f"  [{label}] violations={n_v} rules={result.rules_evaluated}")

        # group by rule_id within this template
        rule_counts: dict[str, int] = defaultdict(int)
        for v in result.violations:
            rule_counts[v.rule_id] += 1
        for rule_id, count in rule_counts.items():
            by_rule[rule_id][label] += count

    total_violations = sum(by_template.values())
    total_rules_evaluated = sum(rules_evaluated_per_template.values())
    pass_rate = 1.0 - (total_violations / total_rules_evaluated) if total_rules_evaluated else 1.0

    print()
    print("=" * 80)
    print(
        f"TOTAL: {total_violations} violations across {len(ifcs)} IFCs; "
        f"pass-rate = {pass_rate * 100:.2f}% "
        f"({total_rules_evaluated - total_violations}/{total_rules_evaluated})"
    )
    print("=" * 80)

    print("\nVIOLATIONS BY RULE (sorted by count desc):")
    rule_summary = sorted(
        ((rule, sum(t.values())) for rule, t in by_rule.items()),
        key=lambda kv: -kv[1],
    )
    for rule, total in rule_summary:
        templates = ", ".join(
            f"{lbl}({n})" for lbl, n in sorted(
                by_rule[rule].items(), key=lambda kv: -kv[1]
            )
        )
        print(f"  {total:4d} × {rule}")
        print(f"         on: {templates}")

    print("\n→ Fix priority: top-3 rules account for "
          f"{sum(c for _, c in rule_summary[:3])}/{total_violations} violations")

    return 0


if __name__ == "__main__":
    sys.exit(main())
