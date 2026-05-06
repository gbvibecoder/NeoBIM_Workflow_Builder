#!/usr/bin/env python3
"""Phase 1 audit script — emit the 3-fixture × 5-richMode entity matrix.

Calls the export logic in-process (NOT via HTTP) so the audit is a
direct measurement of what `app.services.ifc_builder.build_multi_discipline`
emits for each (fixture, rich_mode) pair. Runs the combined-discipline
output of each invocation through the audit_counter helpers.

Output: writes `docs/python-service-baseline-2026-05-01.md` at the repo
root with a per-fixture matrix + a Phase-2 gap analysis against the 14
TS-exporter Fixes documented in §2.1 of
`temp_folder/IFC_GENERATION_AND_ENHANCEMENT_TECHNICAL_REPORT_2026-04-30.md`.

Usage:
    python scripts/audit_emission.py
    python scripts/audit_emission.py --out docs/custom-baseline.md

Notes:
- "richMode=null" column is included alongside the 5 documented values
  to make the backward-compatible no-field-on-the-wire path visible in
  the matrix. Tests assert this column matches existing baseline_quality
  expectations.
- Total runtime ~2-5 s on a warm Docker; runs build_multi_discipline 18x
  (3 fixtures × 6 columns).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import ifcopenshell  # noqa: E402

from app.models.request import ExportIFCRequest, ExportOptions  # noqa: E402
from app.services.audit_counter import audit_model  # noqa: E402
from app.services.ifc_builder import build_multi_discipline  # noqa: E402


FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures"

FIXTURES: list[str] = [
    "simple_box",
    "multistorey_residential",
    "non_rectangular",
]

# Order matters — left-to-right reads as "spec defaults → richer".
# `null` is the no-field path (backward compat); the other 5 are the
# Literal whitelist values.
RICH_MODES: list[str | None] = [
    None,
    "off",
    "arch-only",
    "structural",
    "mep",
    "full",
]

# The 14 TS-exporter Fixes from §2.1 of the R&D report. For each Fix
# we map a question — "is there evidence this Fix is implemented?" —
# to a closure that examines the audit dict. Returns one of "✅", "⚠️",
# or "❌".
TS_EXPORTER_FIXES = [
    ("Fix 1",  "IfcRelAssociatesMaterial batched per material layer set"),
    ("Fix 2",  "IfcOpeningElement + IfcRelVoidsElement + IfcRelFillsElement for openings"),
    ("Fix 3",  "IfcWallType / IfcDoorType / IfcWindowType / ... + IfcRelDefinesByType (type instancing)"),
    ("Fix 5",  "Deterministic UUID v5 GUIDs (compressed buildingSMART base-64)"),
    ("Fix 7",  "IfcClassification + IfcClassificationReference + IfcRelAssociatesClassification (CSI + NBC India)"),
    ("Fix 8",  "IfcDistributionSystem + IfcRelAssignsToGroup for MEP segments"),
    ("Fix 11", "Indian IS-808 IfcIShapeProfileDef for steel"),
    ("Fix 13", "Pset_SpaceCommon (COBie space-handover requirement)"),
    ("Fix 14", "Body / Axis / FootPrint representation subcontexts"),
    ("RERA",   "Indian RERA Pset for residential spaces (project ID, seismic/wind zone)"),
    ("Bdy-1",  "IfcMaterialLayerSet present (richer than bare IfcMaterial)"),
    ("Bdy-2", "Pset_WallCommon present on every IfcWall"),
    ("Bdy-3", "Qto_*BaseQuantities present (downstream BOQ accuracy)"),
    ("Bdy-4", "IfcReinforcingBar emission gated for structural/full"),
]


def _fix_status(audit: dict, key: str) -> str:
    """Heuristic per-Fix presence check — returns ✅ / ⚠️ / ❌."""
    by_type = audit["by_type"]
    rels = audit["openings_and_relationships"]
    materials = audit["materials"]
    type_inst = audit["type_instances"]
    psets = audit["psets_by_name"]
    geom = audit["geometry_primitives"]

    if key == "Fix 1":
        # Material association count > 0 AND at least one IfcMaterialLayerSet
        return "✅" if rels.get("IfcRelAssociatesMaterial", 0) > 0 and materials.get("IfcMaterialLayerSet", 0) > 0 else "❌"

    if key == "Fix 2":
        # Any opening element + voids + fills present?
        opens = rels.get("IfcOpeningElement", 0)
        voids = rels.get("IfcRelVoidsElement", 0)
        fills = rels.get("IfcRelFillsElement", 0)
        if opens == 0 and voids == 0 and fills == 0:
            return "❌"
        if opens > 0 and voids > 0 and fills > 0:
            return "✅"
        return "⚠️"

    if key == "Fix 3":
        # Any IfcXxxType + IfcRelDefinesByType?
        any_type = sum(type_inst.values()) > 0
        defines_by_type = rels.get("IfcRelDefinesByType", 0) > 0
        if any_type and defines_by_type:
            return "✅"
        if any_type or defines_by_type:
            return "⚠️"
        return "❌"

    if key == "Fix 5":
        # Phase 2: deterministic GUIDs are verified by `_audit_combined`
        # building the same input twice and comparing the GUID sets. The
        # boolean is stamped into the audit dict here.
        if audit.get("deterministic_guids"):
            return "✅"
        return "⚠️" if audit.get("unique_guid_count", 0) > 0 else "❌"

    if key == "Fix 7":
        # IfcClassification + IfcRelAssociatesClassification
        cls_count = by_type.get("IfcClassification", 0)
        ref_count = by_type.get("IfcClassificationReference", 0)
        rel_count = rels.get("IfcRelAssociatesClassification", 0)
        if cls_count > 0 and ref_count > 0 and rel_count > 0:
            return "✅"
        if cls_count > 0:
            return "⚠️"
        return "❌"

    if key == "Fix 8":
        # IfcDistributionSystem + IfcRelAssignsToGroup
        ds = by_type.get("IfcDistributionSystem", 0)
        ag = rels.get("IfcRelAssignsToGroup", 0)
        if ds > 0 and ag > 0:
            return "✅"
        if ds > 0 or ag > 0:
            return "⚠️"
        return "❌"

    if key == "Fix 11":
        # Phase 2 / Task 5: IS-808 sections produce IfcIShapeProfileDef
        # entities with `ProfileName` set to an IS prefix. Anything else
        # (concrete column with circular profile, generic beam fallback)
        # leaves ProfileName empty.
        names = audit.get("ishape_profile_names") or []
        if any(n and n.startswith(("ISMB", "ISLB", "ISJB")) for n in names):
            return "✅"
        if not names:
            return "n/a"  # no I-shapes → fix can't apply on this fixture
        return "❌"

    if key == "Fix 13":
        return "✅" if psets.get("Pset_SpaceCommon", 0) > 0 else "❌"

    if key == "Fix 14":
        # Subcontexts: requires IfcGeometricRepresentationSubContext or named
        # contexts ("Body", "Axis", "FootPrint"). We approximate by checking
        # the count of IfcGeometricRepresentationSubContext.
        return "✅" if by_type.get("IfcGeometricRepresentationSubContext", 0) > 0 else "❌"

    if key == "RERA":
        # Look for a Pset name matching RERA-ish keys.
        rera_psets = [k for k in psets if "rera" in k.lower()]
        return "✅" if rera_psets else "❌"

    if key == "Bdy-1":
        return "✅" if materials.get("IfcMaterialLayerSet", 0) > 0 else "❌"

    if key == "Bdy-2":
        wall_count = by_type.get("IfcWall", 0)
        if wall_count == 0:
            return "n/a"
        return "✅" if psets.get("Pset_WallCommon", 0) >= wall_count else "⚠️" if psets.get("Pset_WallCommon", 0) > 0 else "❌"

    if key == "Bdy-3":
        return "✅" if audit["totals"]["qto_instances"] > 0 else "❌"

    if key == "Bdy-4":
        return "✅" if by_type.get("IfcReinforcingBar", 0) > 0 else "❌"

    return "?"


def _load_request(name: str) -> ExportIFCRequest:
    path = FIXTURE_DIR / f"{name}.json"
    with path.open() as f:
        raw = json.load(f)
    raw.pop("_comment", None)
    return ExportIFCRequest.model_validate(raw)


def _build_combined_bytes(req: ExportIFCRequest, rich_mode: str | None) -> bytes:
    """Build COMBINED IFC bytes for the (request, rich_mode) pair.

    Mutates a request copy (concurrent-safe) and returns just the
    bytes. Splitting this off makes the determinism check (Phase 2 /
    Fix 5) a one-liner: build twice, compare the two byte strings.
    """
    new_options = req.options.model_copy(update={"rich_mode": rich_mode, "disciplines": ["combined"]})
    new_req = req.model_copy(update={"options": new_options})
    results = build_multi_discipline(new_req)
    if "combined" not in results:
        raise RuntimeError("build_multi_discipline did not return a combined file")
    return results["combined"][0]


def _guid_set_from_bytes(ifc_bytes: bytes) -> frozenset[str]:
    """Extract the set of all GlobalIds in an IFC file.

    Used to verify GUID determinism: same input → same set across runs.
    Two builds whose GUID sets are identical proves the deterministic
    UUID v5 derivation is wired up correctly.
    """
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as tmp:
        tmp.write(ifc_bytes)
        tmp.flush()
        tmp_path = tmp.name
    model = ifcopenshell.open(tmp_path)
    guids = {
        getattr(inst, "GlobalId", None)
        for inst in model
        if hasattr(inst, "GlobalId")
    }
    return frozenset(g for g in guids if g)


def _audit_combined(req: ExportIFCRequest, rich_mode: str | None) -> dict:
    """Build the COMBINED file twice, audit, and stamp determinism flag.

    Phase 2 / Fix 5: the gap-analysis heuristic for "deterministic
    GUIDs" can't be inferred from a single output file (a random uuid4
    is also a 22-char string), so we build the same input twice and
    compare GUID sets. Identical → ✅ deterministic. The audit dict
    carries the resulting `deterministic_guids` flag for the gap-row
    rendering.
    """
    bytes_a = _build_combined_bytes(req, rich_mode)
    bytes_b = _build_combined_bytes(req, rich_mode)

    guids_a = _guid_set_from_bytes(bytes_a)
    guids_b = _guid_set_from_bytes(bytes_b)
    deterministic = guids_a == guids_b and len(guids_a) > 0

    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as tmp:
        tmp.write(bytes_a)
        tmp.flush()
        tmp_path = tmp.name
    model = ifcopenshell.open(tmp_path)
    audit = audit_model(model)
    audit["combined_size_bytes"] = len(bytes_a)
    audit["build_failure_count"] = 0
    audit["deterministic_guids"] = deterministic
    audit["unique_guid_count"] = len(guids_a)
    return audit


def _column_header(rich_mode: str | None) -> str:
    return rich_mode if rich_mode is not None else "(unset)"


def _matrix_for_fixture(name: str, audits: dict[str | None, dict]) -> str:
    """Return the per-fixture markdown section."""
    out = [f"### Fixture: {name}.json", ""]

    # Headline meta
    schemas = {a["schema_version"] for a in audits.values()}
    out.append(f"- Schema versions observed: {sorted(schemas)}")
    out.append(f"- Build failures across all 6 columns: {sum(a['build_failure_count'] for a in audits.values())}")
    out.append("")

    # Collect every IfcType key seen across the 6 columns; sort for stable output.
    all_classes = set()
    for a in audits.values():
        all_classes.update(a["by_type"].keys())
    classes = sorted(all_classes)

    headers = [_column_header(m) for m in RICH_MODES]
    out.append("#### Entity counts by IfcType")
    out.append("")
    out.append("| Entity | " + " | ".join(headers) + " |")
    out.append("|" + "---|" * (len(headers) + 1))
    for cls in classes:
        row = [cls] + [str(audits[m]["by_type"].get(cls, 0)) for m in RICH_MODES]
        out.append("| " + " | ".join(row) + " |")
    out.append("")

    # Geometry primitives
    out.append("#### Geometry primitives")
    out.append("")
    out.append("| Class | " + " | ".join(headers) + " |")
    out.append("|" + "---|" * (len(headers) + 1))
    primitive_classes = sorted(set().union(*[a["geometry_primitives"].keys() for a in audits.values()]))
    for cls in primitive_classes:
        row = [cls] + [str(audits[m]["geometry_primitives"].get(cls, 0)) for m in RICH_MODES]
        out.append("| " + " | ".join(row) + " |")
    out.append("")

    # Type instances
    out.append("#### Type instances (Fix 3)")
    out.append("")
    out.append("| Class | " + " | ".join(headers) + " |")
    out.append("|" + "---|" * (len(headers) + 1))
    type_classes = sorted(set().union(*[a["type_instances"].keys() for a in audits.values()]))
    for cls in type_classes:
        row = [cls] + [str(audits[m]["type_instances"].get(cls, 0)) for m in RICH_MODES]
        out.append("| " + " | ".join(row) + " |")
    out.append("")

    # Openings & relationships
    out.append("#### Openings & relationships")
    out.append("")
    out.append("| Class | " + " | ".join(headers) + " |")
    out.append("|" + "---|" * (len(headers) + 1))
    rel_classes = sorted(set().union(*[a["openings_and_relationships"].keys() for a in audits.values()]))
    for cls in rel_classes:
        row = [cls] + [str(audits[m]["openings_and_relationships"].get(cls, 0)) for m in RICH_MODES]
        out.append("| " + " | ".join(row) + " |")
    out.append("")

    # Pset / Qto names
    out.append("#### Pset / Qto totals")
    out.append("")
    out.append("| Metric | " + " | ".join(headers) + " |")
    out.append("|" + "---|" * (len(headers) + 1))
    out.append("| Pset_* instances | " + " | ".join(str(audits[m]["totals"]["pset_instances"]) for m in RICH_MODES) + " |")
    out.append("| Qto_* instances | " + " | ".join(str(audits[m]["totals"]["qto_instances"]) for m in RICH_MODES) + " |")
    out.append("")

    # Totals row
    out.append("#### Total entity count")
    out.append("")
    out.append("| Metric | " + " | ".join(headers) + " |")
    out.append("|" + "---|" * (len(headers) + 1))
    out.append("| Total entities | " + " | ".join(str(audits[m]["total_entities"]) for m in RICH_MODES) + " |")
    out.append("| Combined .ifc size (bytes) | " + " | ".join(str(audits[m]["combined_size_bytes"]) for m in RICH_MODES) + " |")
    out.append("")

    # Gap analysis (against the FULL column — best case the Python service can produce today)
    out.append("#### Gap analysis vs §2.1 TS-exporter Fixes (column: full)")
    out.append("")
    out.append("| ID | Description | Status |")
    out.append("|---|---|---|")
    for fix_id, desc in TS_EXPORTER_FIXES:
        status = _fix_status(audits["full"], fix_id)
        out.append(f"| {fix_id} | {desc} | {status} |")
    out.append("")

    return "\n".join(out)


def _generate_baseline_doc(audits_by_fixture: dict[str, dict[str | None, dict]]) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    parts = [
        f"# Python service baseline — {today}",
        "",
        "**Phase 1 deliverable.** Pure measurement: 3 fixtures × 6 richMode columns",
        "(`null` plus the 5 documented values), `combined`-discipline output of",
        "`app.services.ifc_builder.build_multi_discipline`, audited via",
        "`app.services.audit_counter.audit_model`.",
        "",
        "Generated by `scripts/audit_emission.py`. Do NOT hand-edit — re-run the",
        "script after any emitter or builder change.",
        "",
        "## Read this first",
        "",
        "- **`null` column** = `richMode` field absent from the request body.",
        "  Backward-compatible behaviour: no element-type gating, full MEP body.",
        "  This is the column existing callers (and the `baseline_building.json`",
        "  baseline test) hit.",
        "- **`off`** = explicit minimal mode. Spatial structure only — no walls,",
        "  no slabs, no MEP. Asserts the gating actually filters.",
        "- **`arch-only` ≈ `structural`** = same allowed type set today; rebar",
        "  emitter not yet implemented, so `structural` will only diverge from",
        "  `arch-only` once Phase 3 lands an `IfcReinforcingBar` builder.",
        "- **`mep`** = arch-only types + MEP (ducts/pipes/cable trays/equipment),",
        "  bodyless (Pset + IfcSystem grouping only).",
        "- **`full`** = `mep` + bodyful MEP (IfcExtrudedAreaSolid on each segment).",
        "",
        "## How the gap-analysis column reads",
        "",
        "Status legend — **✅** = implemented and exercised on this fixture; ",
        "**⚠️** = partially present (some sub-pieces but not the full chain); ",
        "**❌** = not implemented or not exercised; **n/a** = the host element type",
        "isn't in the fixture so the Fix can't apply.",
        "",
        "Gap status is computed against the `full` column (the richest output the",
        "service can produce today). A `❌` here is a Phase-2-or-later target.",
        "",
    ]

    for name in FIXTURES:
        parts.append(_matrix_for_fixture(name, audits_by_fixture[name]))
        parts.append("")

    parts.append("## Cross-fixture summary")
    parts.append("")
    parts.append("| Fixture | total (null) | total (off) | total (arch-only) | total (structural) | total (mep) | total (full) |")
    parts.append("|---|---|---|---|---|---|---|")
    for name in FIXTURES:
        a = audits_by_fixture[name]
        parts.append(
            "| "
            + " | ".join([
                name,
                *(str(a[m]["total_entities"]) for m in RICH_MODES),
            ])
            + " |"
        )
    parts.append("")
    parts.append("## What this baseline unblocks")
    parts.append("")
    parts.append("1. Phase 2 R&D can scope which `❌`/`⚠️` Fixes to address first")
    parts.append("   without re-running the audit by hand.")
    parts.append("2. Future emitter work can rerun this script and diff the output to")
    parts.append("   demonstrate progress quantitatively.")
    parts.append("3. The cross-fixture summary makes the off → full chain a single-")
    parts.append("   table read — sanity-checks the gating works on every shape.")

    return "\n".join(parts) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=str(REPO_ROOT / "docs" / "python-service-baseline-2026-05-01.md"),
        help="Output markdown file path",
    )
    parser.add_argument(
        "--print-summary",
        action="store_true",
        help="Print the cross-fixture totals to stdout after writing the doc",
    )
    args = parser.parse_args()

    audits_by_fixture: dict[str, dict[str | None, dict]] = {}
    for name in FIXTURES:
        req = _load_request(name)
        audits_by_fixture[name] = {}
        for mode in RICH_MODES:
            print(f"  ▸ {name}  richMode={mode}", file=sys.stderr)
            audits_by_fixture[name][mode] = _audit_combined(req, mode)

    doc = _generate_baseline_doc(audits_by_fixture)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(doc)
    print(f"Wrote {out_path}", file=sys.stderr)

    if args.print_summary:
        print()
        print("CROSS-FIXTURE TOTALS")
        for name in FIXTURES:
            a = audits_by_fixture[name]
            row = " | ".join(f"{m or 'unset'}={a[m]['total_entities']}" for m in RICH_MODES)
            print(f"  {name}: {row}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
