"""Phase T2.1 Phase F — Export the 1BHK Pune Tier-2 templates to IFC.

Drives the same `build_ifc_from_building_model` pipeline used by
`export_2bhk_pune_to_ifc.py`, but for all four 1BHK variants in one
run: house, duplex, tower G+5, tower G+11. Writes deterministic
output paths under `temp_folder/` for visual inspection.

Usage:
    python3.11 scripts/export_1bhk_pune_to_ifc.py
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
    build_1bhk_pune_duplex,
    build_1bhk_pune_house,
    build_1bhk_pune_tower,
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
        f"openings={sum(len(s.openings) for s in bld.storeys)} "
        f"stairs={sum(len(s.stairs) for s in bld.storeys)} "
        f"columns={len(bld.structural_system.columns)} "
        f"beams={len(bld.structural_system.beams)} "
        f"doors={len(bld.doors)} "
        f"windows={len(bld.windows)}"
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
    print("Phase T2.1 — 1BHK Pune Tier-2 Templates → IFC exports")
    print("=" * 72)
    try:
        _export_one(
            "house",
            build_1bhk_pune_house(),
            _OUT_DIR / "tier2_1bhk_pune_house.ifc",
        )
        _export_one(
            "duplex",
            build_1bhk_pune_duplex(),
            _OUT_DIR / "tier2_1bhk_pune_duplex.ifc",
        )
        _export_one(
            "tower-g5",
            build_1bhk_pune_tower(habitable_floor_count=5),
            _OUT_DIR / "tier2_1bhk_pune_tower_g5.ifc",
        )
        _export_one(
            "tower-g11",
            build_1bhk_pune_tower(habitable_floor_count=11),
            _OUT_DIR / "tier2_1bhk_pune_tower_g11.ifc",
        )
    except Exception as exc:
        print(f"\n✗ EXPORT FAILED: {type(exc).__name__}: {exc}")
        traceback.print_exc()
        return 1
    print("\n✓ All 4 exports complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
