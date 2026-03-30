"""Shared IfcOpenShell helpers for cross-version compatibility."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api


def assign_to_storey(
    model: ifcopenshell.file,
    storey: ifcopenshell.entity_instance,
    element: ifcopenshell.entity_instance,
) -> None:
    """Assign an element to a building storey (cross-version compatible).

    IfcOpenShell 0.8.x changed the API for spatial.assign_container.
    This helper tries multiple approaches to ensure compatibility.
    """
    try:
        api.run("spatial.assign_container", model, relating_structure=storey, products=[element])
    except TypeError:
        try:
            api.run("spatial.assign_container", model, relating_structure=storey, product=element)
        except (TypeError, Exception):
            # Last resort: create the relationship manually
            from app.utils.guid import new_guid
            model.create_entity(
                "IfcRelContainedInSpatialStructure",
                GlobalId=new_guid(),
                RelatingStructure=storey,
                RelatedElements=[element],
            )
