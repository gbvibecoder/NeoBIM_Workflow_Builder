"""Phase P1.5 / P1.6 — Export all 4 2BHK Pune variants with full polish.

The original `export_2bhk_pune_to_ifc.py` exports only the duplex.
This script mirrors `export_1bhk_pune_to_ifc.py` / `export_3bhk_pune_to_ifc.py`,
emitting house + duplex + tower G+5 + tower G+23 in one run with the
shared `build_ifc_from_building_model` pipeline (P1.5 psets, coverings,
parapets, ground all included).

Usage:
    python3.11 scripts/export_2bhk_pune_all_variants_to_ifc.py
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_SERVICE_ROOT = _SCRIPT_DIR.parent
sys.path.insert(0, str(_SERVICE_ROOT))

from app.domain.building_model import BuildingModel  # noqa: E402
from app.templates import (  # noqa: E402
    build_2bhk_pune_duplex,
    build_2bhk_pune_house,
    build_2bhk_pune_tower,
)
from scripts.export_2bhk_pune_to_ifc import (  # noqa: E402
    build_ifc_from_building_model,
)

_REPO_ROOT = _SERVICE_ROOT.parent
_OUT_DIR = _REPO_ROOT / "temp_folder"


def _summarise(bm: BuildingModel) -> str:
    bld = bm.project.site.building
    return (
        f"storeys={len(bld.storeys)} "
        f"walls={sum(len(s.walls) for s in bld.storeys)} "
        f"rooms={sum(len(s.rooms) for s in bld.storeys)} "
        f"slabs={sum(len(s.slabs) for s in bld.storeys)} "
        f"columns={len(bld.structural_system.columns)} "
        f"beams={len(bld.structural_system.beams)} "
        f"doors={len(bld.doors)} windows={len(bld.windows)}"
    )


def _export_one(label: str, bm: BuildingModel, out_path: Path) -> None:
    print(f"\n[{label}] {_summarise(bm)}")
    model = build_ifc_from_building_model(bm)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    model.write(str(out_path))
    size = out_path.stat().st_size
    print(f"  → wrote {out_path}  ({size:,} bytes / {size / 1024:.1f} KiB)")


def main() -> int:
    print("=" * 72)
    print("Phase P1.5/P1.6 — 2BHK Pune Tier-2 Templates → IFC exports (all 4)")
    print("=" * 72)
    try:
        _export_one(
            "house",
            build_2bhk_pune_house(),
            _OUT_DIR / "tier2_2bhk_pune_house.ifc",
        )
        _export_one(
            "duplex",
            build_2bhk_pune_duplex(),
            _OUT_DIR / "tier2_2bhk_pune_v1.ifc",
        )
        _export_one(
            "tower-g5",
            build_2bhk_pune_tower(habitable_floor_count=5),
            _OUT_DIR / "tier2_2bhk_pune_tower_g5.ifc",
        )
        _export_one(
            "tower-g23",
            build_2bhk_pune_tower(habitable_floor_count=23),
            _OUT_DIR / "tier2_2bhk_pune_tower_g23.ifc",
        )
    except Exception as exc:
        print(f"\n✗ EXPORT FAILED: {type(exc).__name__}: {exc}")
        traceback.print_exc()
        return 1
    print("\n✓ All 4 exports complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
