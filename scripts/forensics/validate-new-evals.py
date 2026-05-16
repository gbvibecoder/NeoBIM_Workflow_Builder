"""Run the new geometric validators on the post-fix eval outputs.

For each IFC in prod-eval-outputs-v2/, compares against the matching
brief and emits a pass/fail verdict on world_bbox / space_polygons /
element_coverage / origin_collapse. Writes a markdown summary to
prod-eval-outputs-v2/SUMMARY.md plus a per-brief details block.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "neobim-ifc-service"))

from app.services.ifc_generator_v3.validate import validate_ifc_file  # noqa: E402


def main() -> int:
    briefs_dir = REPO_ROOT / "src/features/brief-to-ifc/v3/evals/briefs"
    out_dir = REPO_ROOT / "prod-eval-outputs-v2"

    md_lines = [
        "# Eval Re-Run Summary — 2026-05-16 (post-fix)",
        "",
        "All 5 briefs re-run against `main@d57f2833` with the helper",
        "unit-fix + new geometric validators. Compare to yesterday's",
        "false-green at `prod-eval-outputs/SUMMARY.md`.",
        "",
        "## Per-eval results",
        "",
        "| Brief | status | cost | turns | world_bbox | actual bbox | space_polygons | origin_collapse | element_coverage | Visual PASS |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]

    detail_blocks = []
    all_pass = True
    total_cost = 0.0
    for status_path in sorted(out_dir.glob("*-status.json")):
        stem = status_path.stem.replace("-status", "")
        brief_path = briefs_dir / f"{stem}.json"
        ifc_path = out_dir / f"{stem}.ifc"
        if not brief_path.exists() or not ifc_path.exists():
            continue
        brief = json.loads(brief_path.read_text())
        status = json.loads(status_path.read_text())
        result = validate_ifc_file(str(ifc_path), brief=brief)

        wb = result.get("world_bbox") or {}
        wb_verdict = wb.get("verdict", "?")
        wb_extent = wb.get("actual_extent") or [0, 0, 0]
        wb_str = f"{wb_extent[0]:.2f}×{wb_extent[1]:.2f}×{wb_extent[2]:.2f}m"

        sp = result.get("space_polygons") or []
        sp_pass = all(
            s.get("verdict") in ("OK", "NO_EXPECTED_POLYGON") for s in sp
        )
        sp_str = "OK" if sp_pass else ", ".join(
            s.get("verdict", "?") for s in sp
        )

        oc = result.get("origin_collapse") or {}
        oc_collapsed = oc.get("collapsed", False)

        ec = result.get("element_coverage") or {}
        ec_verdict = ec.get("verdict", "?")
        ec_missing = ec.get("missing_id_count", 0)

        visual_pass = (
            wb_verdict == "OK"
            and sp_pass
            and not oc_collapsed
            and ec_verdict == "OK"
        )
        if not visual_pass:
            all_pass = False

        cost = float(status.get("generatorCostUsd") or 0)
        turns = int(status.get("turns") or 0)
        total_cost += cost
        st = status.get("status", "?")

        md_lines.append(
            f"| {stem} | {st} | ${cost:.3f} | {turns} | "
            f"**{wb_verdict}** | {wb_str} | "
            f"{sp_str} | "
            f"{'COLLAPSED' if oc_collapsed else 'OK'} | "
            f"{ec_verdict} (missing {ec_missing}) | "
            f"{'✅' if visual_pass else '❌'} |"
        )

        detail_blocks.append(
            f"\n### {stem}\n"
            f"\n- status: `{st}` · cost: `${cost:.3f}` · turns: `{turns}`"
            f"\n- world_bbox: `{wb_verdict}` actual extent `{wb_str}` "
            f"vs expected `{wb.get('expected_extent')}` "
            f"ratio `{wb.get('extent_ratio')}`"
            f"\n- origin_collapse: at_origin "
            f"`{oc.get('at_origin_count', 0)} / {oc.get('total_elements', 0)}` "
            f"({(oc.get('fraction_at_origin', 0) * 100):.0f}%)"
            f"\n- element_coverage: actual `{ec.get('by_class_actual', {})}` "
            f"vs expected `{ec.get('by_class_expected', {})}`"
        )

    md_lines.append("")
    md_lines.append(f"**Total Anthropic spend: ${total_cost:.3f}** "
                    f"(budget cap: $15.00)")
    md_lines.append("")
    md_lines.append(
        "**Overall: " + ("✅ 5/5 PASS — visual quality verified."
                          if all_pass else
                          "❌ NOT ALL PASS — see per-brief details below.") + "**"
    )
    md_lines.append("")
    md_lines.append("## Details")
    md_lines.extend(detail_blocks)

    out_path = out_dir / "SUMMARY.md"
    out_path.write_text("\n".join(md_lines) + "\n")
    print(f"wrote {out_path}")
    print(f"total cost ${total_cost:.3f}, all_pass={all_pass}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
