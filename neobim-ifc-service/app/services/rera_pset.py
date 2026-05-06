"""Indian RERA (Real Estate Regulation Act 2016) Pset emitter.

Phase 2 / Task 7. RERA is mandatory in India for any residential project
sold off-plan; downstream cost/legal tools expect each residential
IfcSpace to carry the project's RERA registration ID, the seismic zone
the building was designed for (per IS 1893:2016), the wind zone (per IS
875 Part 3), and the three published-area variants (carpet, built-up,
super built-up). Pset_ReraData is a CUSTOM property set — RERA is not
yet in the buildingSMART standard list — but custom Psets are valid IFC
and parse correctly in BlenderBIM, Revit, ArchiCAD.

Application rule: only attach to residential IfcSpaces. The NBC Group A
mapping in `app/services/classification.py` is the authoritative
"is residential" check.
"""

from __future__ import annotations

from dataclasses import dataclass

import ifcopenshell
import ifcopenshell.api as api
import structlog

from app.services.classification import nbc_group_for_building_type

log = structlog.get_logger()


PSET_NAME = "Pset_ReraData"

# Defaults documented in the Phase 2 prompt § Task 7 — derived from
# the most common Indian-market values:
#   * Zone III covers most of the populated subcontinent.
#   * Wind zone 3 is the average plain-state designation.
DEFAULT_SEISMIC_ZONE = "III"
DEFAULT_WIND_ZONE = 3

# Built-up factor: 15% above carpet. Super built-up: 30% above carpet.
# These are RERA-compliant approximations; the exact ratios are
# project-specific and would override here in a future phase.
BUILT_UP_FACTOR = 1.15
SUPER_BUILT_UP_FACTOR = 1.30


@dataclass(frozen=True)
class ReraInputs:
    """Per-build RERA inputs resolved from request options + defaults."""

    project_id: str
    seismic_zone: str
    wind_zone: int

    @classmethod
    def from_options(
        cls,
        rera_project_id: str | None,
        seismic_zone: str | None,
        wind_zone: int | None,
    ) -> "ReraInputs":
        return cls(
            project_id=rera_project_id or "",
            seismic_zone=seismic_zone or DEFAULT_SEISMIC_ZONE,
            wind_zone=int(wind_zone) if wind_zone is not None else DEFAULT_WIND_ZONE,
        )


def is_residential_building(building_type: str) -> bool:
    """True iff the buildingType maps to NBC Group A (Residential)."""
    code = nbc_group_for_building_type(building_type)
    return code == "A" or code.startswith("A-")


def attach_rera_psets(
    model: ifcopenshell.file,
    building_type: str,
    inputs: ReraInputs,
) -> int:
    """Attach Pset_ReraData to every IfcSpace in residential buildings.

    Returns the number of Psets attached (0 on non-residential, or when
    no IfcSpaces exist — the latter happens in `richMode='off'`).
    """
    if not is_residential_building(building_type):
        return 0

    occupancy_group = nbc_group_for_building_type(building_type)
    spaces = list(model.by_type("IfcSpace"))
    if not spaces:
        return 0

    attached = 0
    for space in spaces:
        carpet = _space_carpet_area(space)
        properties = {
            "ProjectIDNumber": inputs.project_id,
            "SeismicZone": inputs.seismic_zone,
            "WindZone": int(inputs.wind_zone),
            "CarpetAreaM2": float(carpet),
            "BuiltUpAreaM2": float(carpet * BUILT_UP_FACTOR),
            "SuperBuiltUpAreaM2": float(carpet * SUPER_BUILT_UP_FACTOR),
            "OccupancyGroup": occupancy_group,
        }
        pset = api.run(
            "pset.add_pset",
            model,
            product=space,
            name=PSET_NAME,
        )
        api.run("pset.edit_pset", model, pset=pset, properties=properties)
        attached += 1

    log.info(
        "rera_psets_attached",
        spaces=attached,
        seismic_zone=inputs.seismic_zone,
        wind_zone=inputs.wind_zone,
        occupancy_group=occupancy_group,
    )
    return attached


# ── Internals ─────────────────────────────────────────────────────────


def _space_carpet_area(space: ifcopenshell.entity_instance) -> float:
    """Pull the most authoritative area available for a space.

    Prefers `Pset_SpaceCommon.GrossPlannedArea` if already attached,
    otherwise falls back to a minimum of 10 m² so the Pset never carries
    zero. Real-world values come through Pset_SpaceCommon since
    `add_space_psets` always runs before this helper.
    """
    fallback = 10.0
    for rel in getattr(space, "IsDefinedBy", None) or []:
        if not rel.is_a("IfcRelDefinesByProperties"):
            continue
        defin = getattr(rel, "RelatingPropertyDefinition", None)
        if defin is None or not defin.is_a("IfcPropertySet"):
            continue
        if defin.Name != "Pset_SpaceCommon":
            continue
        for prop in defin.HasProperties or []:
            if not prop.is_a("IfcPropertySingleValue"):
                continue
            if prop.Name == "GrossPlannedArea":
                v = getattr(prop, "NominalValue", None)
                if v is not None and getattr(v, "wrappedValue", None):
                    try:
                        return float(v.wrappedValue)
                    except (TypeError, ValueError):
                        pass
    return fallback
