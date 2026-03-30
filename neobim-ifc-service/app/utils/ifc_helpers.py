"""Shared IfcOpenShell helpers for cross-version compatibility."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import new_guid

# IFC4 spatial elements that must be aggregated, not contained
_SPATIAL_TYPES = {"IfcSpace", "IfcSite", "IfcBuilding", "IfcBuildingStorey"}


def assign_to_storey(
    model: ifcopenshell.file,
    storey: ifcopenshell.entity_instance,
    element: ifcopenshell.entity_instance,
) -> None:
    """Assign an element to a building storey (cross-version compatible).

    IfcSpace and other spatial elements use IfcRelAggregates (not IfcRelContainedInSpatialStructure).
    Regular building elements use spatial.assign_container.
    """
    element_type = element.is_a()

    if element_type in _SPATIAL_TYPES:
        # Spatial elements must be aggregated, not contained
        try:
            api.run("aggregate.assign_object", model, relating_object=storey, products=[element])
        except (TypeError, Exception):
            model.create_entity(
                "IfcRelAggregates",
                GlobalId=new_guid(),
                RelatingObject=storey,
                RelatedObjects=[element],
            )
        return

    # Regular building elements — try assign_container with fallback
    try:
        api.run("spatial.assign_container", model, relating_structure=storey, products=[element])
    except TypeError:
        try:
            api.run("spatial.assign_container", model, relating_structure=storey, product=element)
        except (TypeError, Exception):
            model.create_entity(
                "IfcRelContainedInSpatialStructure",
                GlobalId=new_guid(),
                RelatingStructure=storey,
                RelatedElements=[element],
            )
