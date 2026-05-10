"""Phase T1.3 — Export the 2BHK Pune Tier-2 BuildingModel to IFC.

Slice 2B.2.C move: the implementation of
``build_ifc_from_building_model`` was lifted to a service module so
the new ``/api/v1/design/generate`` route handler can import it
without depending on ``scripts/``. This script keeps the CLI
``main()`` for ad-hoc local exports + IDS validation, and re-exports
``build_ifc_from_building_model`` from the canonical service location
so existing test imports
(``tests/test_phase_t2_0_4_stair_lift_visuals.py``) keep working
without churn.

Byte-identity verification of the move is in
``tests/test_ifc_from_building_model_byte_identity.py``: a 3BHK G+5
BuildingModel exported through this script and through the service
module produces SHA-256-equal IFC content (timestamp stripped) after
the per-process module-cache warm-up call.

Output is deterministic (same BuildingModel + same GUID seed = same
IFC content); see the byte-identity test for the timestamp-strip
discipline.

Usage:
  python3.11 scripts/export_2bhk_pune_to_ifc.py
  → writes ../temp_folder/tier2_2bhk_pune_v1.ifc
"""

from __future__ import annotations

import sys
import time
import traceback
from collections import Counter
from pathlib import Path

# Add neobim-ifc-service to sys.path so this script can run from anywhere.
_SCRIPT_DIR = Path(__file__).resolve().parent
_SERVICE_ROOT = _SCRIPT_DIR.parent
sys.path.insert(0, str(_SERVICE_ROOT))

import ifcopenshell  # noqa: E402

from app.services.ids_validator import validate_ifc  # noqa: E402

# Slice 2B.2.C — re-export from the lifted service module so existing
# imports (notably ``tests/test_phase_t2_0_4_stair_lift_visuals.py``)
# resolve without an import path change.
from app.services.ifc_from_building_model import (  # noqa: E402,F401
    build_ifc_from_building_model,
)
from app.templates import build_2bhk_pune_template  # noqa: E402

# ─── Output target ─────────────────────────────────────────────────────

_REPO_ROOT = _SERVICE_ROOT.parent  # NeoBIM_Workflow_Builder/
_OUTPUT_PATH = _REPO_ROOT / "temp_folder" / "tier2_2bhk_pune_v1.ifc"


def main() -> int:
    print("=" * 72)
    print("Phase T1.3 — 2BHK Pune Tier-2 Template → IFC export")
    print("=" * 72)

    t0 = time.monotonic()
    print("\n[1/5] Building BuildingModel…")
    bm = build_2bhk_pune_template()
    bld = bm.project.site.building
    n_walls = sum(len(s.walls) for s in bld.storeys)
    n_rooms = sum(len(s.rooms) for s in bld.storeys)
    n_slabs = sum(len(s.slabs) for s in bld.storeys)
    n_openings = sum(len(s.openings) for s in bld.storeys)
    n_stairs = sum(len(s.stairs) for s in bld.storeys)
    print(
        f"  storeys={len(bld.storeys)} walls={n_walls} rooms={n_rooms} "
        f"slabs={n_slabs} openings={n_openings} stairs={n_stairs} "
        f"columns={len(bld.structural_system.columns)} "
        f"beams={len(bld.structural_system.beams)} "
        f"footings={len(bld.foundation.footings) if bld.foundation else 0} "
        f"doors={len(bld.doors)} windows={len(bld.windows)}"
    )

    print("\n[2/5] Building IFC4 file…")
    try:
        model = build_ifc_from_building_model(bm)
    except Exception as exc:
        print(f"\n  ✗ BUILD FAILED: {type(exc).__name__}: {exc}")
        traceback.print_exc()
        return 1
    print("  ✓ built")

    # ── Element counts by IfcClass ────────────────────────────────
    ifc_class_counts: Counter[str] = Counter()
    target_classes = {
        "IfcWall",
        "IfcSlab",
        "IfcColumn",
        "IfcBeam",
        "IfcSpace",
        "IfcDoor",
        "IfcWindow",
        "IfcOpeningElement",
        "IfcStair",
        "IfcStairFlight",
        "IfcBuildingStorey",
        "IfcSite",
        "IfcBuilding",
        "IfcProject",
        "IfcWallType",
        "IfcSlabType",
        "IfcColumnType",
        "IfcBeamType",
        "IfcDoorType",
        "IfcWindowType",
        "IfcSpaceType",
    }
    for cls in target_classes:
        n = len(model.by_type(cls))
        if n:
            ifc_class_counts[cls] = n

    print("\n[3/5] IFC element counts by IfcClass:")
    for cls in sorted(ifc_class_counts):
        print(f"  {cls}: {ifc_class_counts[cls]}")

    # ── Write to file ─────────────────────────────────────────────
    print(f"\n[4/5] Writing IFC to {_OUTPUT_PATH}…")
    _OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.write(str(_OUTPUT_PATH))
    size_bytes = _OUTPUT_PATH.stat().st_size
    print(f"  ✓ wrote {size_bytes:,} bytes ({size_bytes / 1024:.1f} KiB)")

    # ── IDS validation (Stage 2.5 in production) ──────────────────
    print("\n[5/5] Running IDS validation (LOD-300, combined)…")
    try:
        ids_result = validate_ifc(model, "combined", "LOD-300")
        print(f"  rules_evaluated: {ids_result.rules_evaluated}")
        print(f"  passed: {ids_result.passed}")
        print(f"  violations: {len(ids_result.violations)}")
        print(f"  warnings: {len(ids_result.warnings)}")
        print(f"  elapsed_ms: {ids_result.elapsed_ms}")
        if ids_result.skipped_reason:
            print(f"  skipped_reason: {ids_result.skipped_reason}")
        if ids_result.violations:
            by_rule: dict[str, int] = {}
            for v in ids_result.violations:
                by_rule[v.rule_id] = by_rule.get(v.rule_id, 0) + 1
            print("  violation breakdown by rule (top 10):")
            for rule, n in sorted(by_rule.items(), key=lambda kv: -kv[1])[:10]:
                print(f"    - {rule}: {n} violations")
            print("  first 3 violation samples:")
            for v in ids_result.violations[:3]:
                guid = v.applicable_element_guid or "(no-guid)"
                print(
                    f"    - {v.rule_id} [{v.severity}] guid={guid[:8]}: "
                    f"expected='{v.expected}' actual='{v.actual}'"
                )
        if ids_result.warnings:
            print("  first 3 warnings:")
            for w in ids_result.warnings[:3]:
                print(f"    - {w.rule_id} [{w.severity}]: expected='{w.expected}' actual='{w.actual}'")
    except Exception as exc:
        print(f"  ⚠ IDS validation crashed: {type(exc).__name__}: {exc}")
        traceback.print_exc()

    elapsed_total = time.monotonic() - t0
    print("\n" + "=" * 72)
    print(f"DONE in {elapsed_total:.2f} s")
    print(f"  ifcopenshell version: {ifcopenshell.version}")
    print(f"  output file: {_OUTPUT_PATH}")
    print(f"  size: {size_bytes:,} bytes")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
