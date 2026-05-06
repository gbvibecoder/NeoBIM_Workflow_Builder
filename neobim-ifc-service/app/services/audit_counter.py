"""Entity-count helpers for the /api/v1/audit endpoint.

Pure-function module — takes an `ifcopenshell.file` and returns a
serializable dict matching the shape consumed by the Phase 1 audit
endpoint and `scripts/audit_emission.py`.

The richer breakdown here (geometry primitives, Pset/Qto, type instances)
is the diff against `scripts/count_ifc_entities.py`: that script is the
existing CI baseline tool and stays focused on per-class counts; this
module adds the categorisation Phase 2+ R&D needs to scope which of the
14 TS-exporter Fixes are present in Python output.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import ifcopenshell


# ── Categorisation tables ─────────────────────────────────────────────
#
# Each tuple is queried with model.by_type(); the resulting count goes
# into a categorised total. Names mirror the IFC4 spec exactly.

GEOMETRY_PRIMITIVE_CLASSES: tuple[str, ...] = (
    "IfcExtrudedAreaSolid",
    "IfcArbitraryClosedProfileDef",
    "IfcBooleanResult",
    "IfcBooleanClippingResult",
    "IfcFacetedBrep",
    "IfcMappedItem",
    "IfcBoundingBox",
    "IfcShellBasedSurfaceModel",
)

TYPE_INSTANCE_CLASSES: tuple[str, ...] = (
    "IfcWallType",
    "IfcSlabType",
    "IfcDoorType",
    "IfcWindowType",
    "IfcColumnType",
    "IfcBeamType",
    "IfcStairFlightType",
    "IfcSpaceType",
    "IfcRailingType",
    "IfcCoveringType",
    "IfcMemberType",
    "IfcPlateType",
    "IfcCurtainWallType",
    "IfcRampType",
    "IfcFurnitureType",
)

OPENING_AND_RELATIONSHIP_CLASSES: tuple[str, ...] = (
    "IfcOpeningElement",
    "IfcRelVoidsElement",
    "IfcRelFillsElement",
    "IfcRelDefinesByType",
    "IfcRelAssociatesMaterial",
    "IfcRelAssociatesClassification",
    "IfcRelDefinesByProperties",
    "IfcRelAggregates",
    "IfcRelContainedInSpatialStructure",
    "IfcRelAssignsToGroup",
)

MATERIAL_CLASSES: tuple[str, ...] = (
    "IfcMaterial",
    "IfcMaterialLayer",
    "IfcMaterialLayerSet",
    "IfcMaterialLayerSetUsage",
    "IfcMaterialConstituent",
    "IfcMaterialConstituentSet",
    "IfcMaterialProfile",
    "IfcMaterialProfileSet",
)


def _count_pset_qto_by_name(model: ifcopenshell.file) -> tuple[dict[str, int], dict[str, int]]:
    """Return (Pset_*-by-name, Qto_*-by-name) frequency dicts.

    Pset / Qto distinction is by `Name` prefix. Handles the case where a
    custom-named Pset (e.g. `Pset_RERA`) is present alongside the
    standard `Pset_WallCommon`.
    """
    psets: Counter[str] = Counter()
    qtos: Counter[str] = Counter()
    for inst in model.by_type("IfcPropertySet"):
        name = getattr(inst, "Name", None) or "<unnamed>"
        if name.startswith("Pset_"):
            psets[name] += 1
        elif name.startswith("Qto_"):
            qtos[name] += 1
        else:
            psets[name] += 1  # custom Psets that don't follow the prefix
    for inst in model.by_type("IfcElementQuantity"):
        name = getattr(inst, "Name", None) or "<unnamed>"
        if name.startswith("Qto_"):
            qtos[name] += 1
        else:
            qtos[name] += 1  # treat any IfcElementQuantity as a Qto for counting
    return dict(psets), dict(qtos)


def audit_model(model: ifcopenshell.file) -> dict[str, Any]:
    """Produce an audit dict for an opened IFC model.

    The returned shape is the contract for both `/api/v1/audit` and the
    `scripts/audit_emission.py` baseline writer:

        {
          "schema_version": "IFC4",
          "total_entities": 1234,
          "by_type": {"IfcWall": 12, ...},      # every class present, sorted
          "geometry_primitives": {...},          # by class, zeros included
          "type_instances": {...},               # by class, zeros included
          "openings_and_relationships": {...},   # by class, zeros included
          "materials": {...},                    # by class, zeros included
          "psets_by_name": {...},                # Pset_X → count
          "qtos_by_name": {...},                 # Qto_X → count
          "totals": {                            # convenience aggregates
            "geometry_primitives": int,
            "type_instances": int,
            "openings_and_relationships": int,
            "materials": int,
            "pset_instances": int,
            "qto_instances": int,
          }
        }
    """
    by_type: Counter[str] = Counter(inst.is_a() for inst in model)
    sorted_by_type = dict(sorted(by_type.items()))

    def _bucket(classes: tuple[str, ...]) -> dict[str, int]:
        return {cls: by_type.get(cls, 0) for cls in classes}

    geometry_primitives = _bucket(GEOMETRY_PRIMITIVE_CLASSES)
    type_instances = _bucket(TYPE_INSTANCE_CLASSES)
    openings_rels = _bucket(OPENING_AND_RELATIONSHIP_CLASSES)
    materials = _bucket(MATERIAL_CLASSES)

    psets_by_name, qtos_by_name = _count_pset_qto_by_name(model)

    # ProfileName values on every IfcIShapeProfileDef — lets downstream
    # gap analysis distinguish "I-shape from IS-808 spec" from "I-shape
    # generic fallback". Empty list when no I-shapes are present.
    ishape_profile_names = sorted({
        getattr(p, "ProfileName", None) or ""
        for p in model.by_type("IfcIShapeProfileDef")
    })

    return {
        "schema_version": model.schema,
        "total_entities": sum(by_type.values()),
        "by_type": sorted_by_type,
        "geometry_primitives": geometry_primitives,
        "type_instances": type_instances,
        "openings_and_relationships": openings_rels,
        "materials": materials,
        "psets_by_name": dict(sorted(psets_by_name.items())),
        "qtos_by_name": dict(sorted(qtos_by_name.items())),
        "ishape_profile_names": ishape_profile_names,
        "totals": {
            "geometry_primitives": sum(geometry_primitives.values()),
            "type_instances": sum(type_instances.values()),
            "openings_and_relationships": sum(openings_rels.values()),
            "materials": sum(materials.values()),
            "pset_instances": sum(psets_by_name.values()),
            "qto_instances": sum(qtos_by_name.values()),
        },
    }
