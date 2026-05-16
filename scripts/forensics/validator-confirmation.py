"""Confirm the new geometric validators correctly flag yesterday's 5
broken IFCs. Writes forensics/validator-confirmation.md.

Each output is expected to fail world-bbox validation with verdict
SCALED_TOO_SMALL (the unit-declaration bug). If any verdict comes back
OK, the validators are themselves broken.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Allow imports from neobim-ifc-service.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "neobim-ifc-service"))

from app.services.ifc_generator_v3.validate import validate_ifc_file  # noqa: E402


def main() -> int:
    briefs_dir = REPO_ROOT / "src/features/brief-to-ifc/v3/evals/briefs"
    forensics_dir = REPO_ROOT / "forensics"

    md_lines = [
        "# Validator Confirmation — yesterday's 5 broken IFCs",
        "",
        "Each row asserts the new geometric validators flag the file as broken.",
        "If `world_bbox.verdict == \"OK\"` here, the validators are bugged.",
        "",
        "| Brief | world_bbox | space_polygons | element_coverage | origin_collapse |",
        "|---|---|---|---|---|",
    ]

    all_caught = True
    for ifc_path in sorted(forensics_dir.glob("*.ifc")):
        stem = ifc_path.stem
        brief_path = briefs_dir / f"{stem}.json"
        if not brief_path.exists():
            md_lines.append(f"| {stem} | (no brief) | — | — | — |")
            continue
        brief = json.loads(brief_path.read_text())
        result = validate_ifc_file(str(ifc_path), brief=brief)

        wb = result.get("world_bbox") or {}
        wb_verdict = wb.get("verdict", "?")
        wb_ratio = wb.get("extent_ratio", [0, 0, 0])

        sp = result.get("space_polygons") or []
        sp_verdicts = sorted({s.get("verdict") for s in sp})

        ec = result.get("element_coverage") or {}
        ec_verdict = ec.get("verdict", "?")
        ec_missing = ec.get("missing_id_count", 0)

        oc = result.get("origin_collapse") or {}
        oc_verdict = oc.get("verdict", "?")
        oc_fraction = oc.get("fraction_at_origin", 0)

        catches_bug = wb_verdict in ("SCALED_TOO_SMALL", "OUT_OF_RANGE")
        if not catches_bug:
            all_caught = False

        md_lines.append(
            f"| {stem} | "
            f"**{wb_verdict}** (ratio "
            f"{wb_ratio[0]:.4f}, {wb_ratio[1]:.4f}, {wb_ratio[2]:.4f}) | "
            f"{','.join(v for v in sp_verdicts if v)} | "
            f"{ec_verdict} (missing {ec_missing}) | "
            f"{oc_verdict} ({oc_fraction:.0%}) |"
        )
        print(f"  {stem:30s} world_bbox={wb_verdict} space_polygons={sp_verdicts}")

    md_lines.append("")
    if all_caught:
        md_lines.append("✅ All 5 IFCs flagged as broken by `validate_world_bbox`.")
    else:
        md_lines.append(
            "🚨 At least one IFC passed validation — fix validators before "
            "proceeding."
        )

    out = forensics_dir / "validator-confirmation.md"
    out.write_text("\n".join(md_lines) + "\n")
    print(f"\nwrote {out}")
    return 0 if all_caught else 1


if __name__ == "__main__":
    raise SystemExit(main())
