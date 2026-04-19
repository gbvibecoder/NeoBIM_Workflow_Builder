#!/usr/bin/env python3
"""Entity-count helper for IFC files.

Used by the Track D baseline test (tests/test_baseline_quality.py) and by hand
when regenerating baselines after an intentional floor change
(see docs/ifc-baseline-regeneration.md).

Usage:
    python scripts/count_ifc_entities.py path/to/building.ifc
    python scripts/count_ifc_entities.py path/to/building.ifc --pretty
    python scripts/count_ifc_entities.py path/to/building.ifc --classes IfcWall,IfcSlab

Library usage (from pytest):
    from scripts.count_ifc_entities import count_entities
    counts = count_entities(ifc_model)       # pass an ifcopenshell.file
    counts = count_entities_from_path(path)  # pass a file path
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable, Optional

import ifcopenshell


# Classes we care about for baseline assertions. The script emits ALL classes
# found plus zeros for any class in this list that was absent — makes baseline
# diffs stable (a class appearing or disappearing is always visible).
BASELINE_CLASSES: tuple[str, ...] = (
    # Spatial hierarchy
    "IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace",
    # Architectural elements
    "IfcWall", "IfcWallStandardCase", "IfcWindow", "IfcDoor",
    "IfcRailing", "IfcCovering", "IfcCurtainWall", "IfcFurniture",
    # Structural elements
    "IfcSlab", "IfcRoof", "IfcColumn", "IfcBeam", "IfcMember", "IfcPlate",
    "IfcFooting", "IfcStairFlight", "IfcStair", "IfcRamp",
    "IfcReinforcingBar", "IfcReinforcingMesh",
    # MEP elements
    "IfcDuctSegment", "IfcDuctFitting",
    "IfcPipeSegment", "IfcPipeFitting",
    "IfcCableCarrierSegment", "IfcCableSegment",
    "IfcFlowTerminal", "IfcAirTerminal", "IfcSanitaryTerminal", "IfcLightFixture",
    "IfcDistributionSystem", "IfcDistributionPort",
    # Openings + relationships
    "IfcOpeningElement", "IfcRelFillsElement", "IfcRelVoidsElement",
    "IfcRelContainedInSpatialStructure", "IfcRelAggregates",
    "IfcRelAssociatesMaterial", "IfcRelDefinesByProperties",
    # Materials + property sets
    "IfcMaterial", "IfcMaterialLayerSet", "IfcMaterialLayerSetUsage",
    "IfcPropertySet", "IfcElementQuantity",
    # Units
    "IfcUnitAssignment", "IfcSIUnit",
)


def count_entities(
    model: ifcopenshell.file,
    classes: Optional[Iterable[str]] = None,
) -> dict:
    """Return a dict of {IfcClass: count} for the given model.

    When `classes` is None, returns counts for every class in BASELINE_CLASSES
    plus any class the model contains that isn't in the list. When `classes`
    is provided, restricts output to that set (still including zeros).
    """
    # Fast path: ifcopenshell's `types_with_super` is overkill; we iterate once.
    by_class: Counter[str] = Counter(inst.is_a() for inst in model)

    target = list(classes) if classes is not None else list(BASELINE_CLASSES)
    # Union: baseline classes (with zeros) + any non-baseline class we found
    extras = [c for c in by_class if c not in target]
    ordered = target + sorted(extras)

    return {cls: by_class.get(cls, 0) for cls in ordered}


def count_entities_from_path(path: str | Path, classes: Optional[Iterable[str]] = None) -> dict:
    model = ifcopenshell.open(str(path))
    return count_entities(model, classes=classes)


def summarize(path: str | Path, classes: Optional[Iterable[str]] = None) -> dict:
    """Full summary: file metadata + counts + total."""
    p = Path(path)
    model = ifcopenshell.open(str(p))
    counts = count_entities(model, classes=classes)
    total = sum(counts.values())
    return {
        "file": str(p),
        "size_bytes": p.stat().st_size if p.exists() else None,
        "schema": model.schema,
        "total_entities_in_scope": total,
        "total_entities_in_file": len(list(model)),
        "by_type": counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .ifc file")
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON with 2-space indent",
    )
    parser.add_argument(
        "--classes",
        default=None,
        help="Comma-separated list of classes to restrict to (default: baseline set)",
    )
    args = parser.parse_args()

    classes = args.classes.split(",") if args.classes else None
    result = summarize(args.path, classes=classes)

    indent = 2 if args.pretty else None
    json.dump(result, sys.stdout, indent=indent, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
