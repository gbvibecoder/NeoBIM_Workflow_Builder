"""OmniClass classification references.

Real IFC files from Revit/ArchiCAD/Vectorworks attach classification codes
(OmniClass, Uniformat, MasterFormat) to every element. Click a wall in a
professional viewer and you see:

    OmniClass 2006-03-28
    └─ 21-02 10 00  Exterior Walls

That semantic link is what makes an IFC more than a geometry dump — it ties
the element to a construction taxonomy cost estimators, contractors, and
spec writers all use. Without it, the IFC is illegible to downstream tools
even when the geometry is perfect.

This module adds one IfcClassification (the OmniClass system) at project
level and one IfcClassificationReference per IFC class, attached to every
matching element via IfcRelAssociatesClassification. Emitting codes is a
three-object chain:

    IfcClassification (the source/system)
      └── IfcClassificationReference (one per code)
            └── IfcRelAssociatesClassification (attaches to N elements)
"""

from __future__ import annotations

from collections import defaultdict

import ifcopenshell
import structlog

from app.utils.guid import new_guid

log = structlog.get_logger()


# OmniClass Table 21 (Elements) — the commonly-used construction taxonomy.
# Codes are the authoritative 21-* identifiers from omniclass.org.
# When an element matches multiple rows (e.g. slab = FLOOR or ROOF) we look
# at PredefinedType before falling back.
OMNICLASS_TABLE_ID = "Table 21"
OMNICLASS_EDITION = "2006-03-28"
OMNICLASS_LOCATION = "https://www.omniclass.org/tables/"

# Map: (IFC class, predefined_type or None) -> (code, title)
# The None-keyed entries are fallbacks used when predefined_type is missing
# or doesn't match a more specific key.
OMNICLASS_MAP: dict[tuple[str, str | None], tuple[str, str]] = {
    # Walls
    ("IfcWall", "PARAPET"):          ("21-01 10 40 10", "Parapet Walls"),
    ("IfcWall", "PARTITIONING"):     ("21-02 10 70 00", "Interior Partitions"),
    ("IfcWall", "SOLIDWALL"):        ("21-01 10 10 00", "Exterior Walls"),
    ("IfcWall", "STANDARD"):         ("21-01 10 10 00", "Exterior Walls"),
    ("IfcWall", None):               ("21-01 10 10 00", "Exterior Walls"),
    # Slabs
    ("IfcSlab", "ROOF"):             ("21-01 30 70 00", "Roofs"),
    ("IfcSlab", "FLOOR"):            ("21-01 20 10 00", "Floor Construction"),
    ("IfcSlab", "BASESLAB"):         ("21-01 10 70 30", "Foundation Plinth"),
    ("IfcSlab", None):               ("21-01 20 10 00", "Floor Construction"),
    # Columns / Beams
    ("IfcColumn", None):             ("21-01 20 50 10", "Columns"),
    ("IfcBeam", None):               ("21-01 20 40 10", "Beams"),
    # Openings
    ("IfcWindow", None):             ("21-01 10 40 20", "Windows"),
    ("IfcDoor", None):               ("21-01 10 40 30", "Doors"),
    # Circulation
    ("IfcStairFlight", None):        ("21-01 20 60 00", "Stair Construction"),
    ("IfcRailing", None):            ("21-01 20 60 10", "Stair Railings"),
    ("IfcRamp", None):               ("21-01 20 60 50", "Ramp Construction"),
    # Coverings / Spaces
    ("IfcCovering", "CEILING"):      ("21-02 40 00 00", "Ceiling Finishes"),
    ("IfcCovering", "FLOORING"):     ("21-02 30 00 00", "Flooring"),
    ("IfcCovering", None):           ("21-02 40 00 00", "Finishes"),
    ("IfcSpace", None):              ("13-11 00 00 00", "Functional Spaces"),
    # MEP — OmniClass Table 23 (Products) is strictly used, but Table 21
    # has the summary elements. Stick to Table 21 for consistency.
    ("IfcDuctSegment", None):        ("21-04 20 30 10", "Air Distribution"),
    ("IfcPipeSegment", None):        ("21-04 20 70 00", "Domestic Water"),
    ("IfcCableCarrierSegment", None):("21-04 30 30 00", "Electrical Distribution"),
    ("IfcFlowTerminal", None):       ("21-04 20 30 40", "Air Terminals"),
    ("IfcSystem", None):             ("21-04 00 00 00", "Services"),
    ("IfcBuildingElementProxy", None):("21-01 00 00 00", "Building Elements"),
}


def _lookup(ifc_class: str, predefined_type: str | None) -> tuple[str, str] | None:
    if predefined_type:
        hit = OMNICLASS_MAP.get((ifc_class, predefined_type))
        if hit:
            return hit
    return OMNICLASS_MAP.get((ifc_class, None))


def attach_omniclass(model: ifcopenshell.file) -> int:
    """Attach an OmniClass IfcClassificationReference to every element in
    the model that has a mapping. Returns the number of refs created.
    """
    system = model.create_entity(
        "IfcClassification",
        Source="OmniClass",
        Edition=OMNICLASS_EDITION,
        Name="OmniClass Construction Classification System",
        Location=OMNICLASS_LOCATION,
    )

    # Group elements by (ifc_class, predefined_type) so we emit ONE
    # IfcRelAssociatesClassification per group instead of per element —
    # keeps the file small while still tagging every element.
    groups: dict[tuple[str, str | None], list[ifcopenshell.entity_instance]] = defaultdict(list)
    for cls_pair in {(c, p) for (c, p) in OMNICLASS_MAP.keys()}:
        ifc_class = cls_pair[0]
        for elem in model.by_type(ifc_class):
            pt = getattr(elem, "PredefinedType", None)
            groups[(ifc_class, pt)].append(elem)

    ref_count = 0
    # One IfcClassificationReference per unique code actually used.
    code_to_ref: dict[tuple[str, str], ifcopenshell.entity_instance] = {}
    for (ifc_class, pt), elements in groups.items():
        if not elements:
            continue
        mapping = _lookup(ifc_class, pt)
        if not mapping:
            continue
        code, title = mapping

        ref_key = (code, title)
        ref = code_to_ref.get(ref_key)
        if ref is None:
            ref = model.create_entity(
                "IfcClassificationReference",
                Location=OMNICLASS_LOCATION,
                Identification=code,
                Name=title,
                ReferencedSource=system,
            )
            code_to_ref[ref_key] = ref
            ref_count += 1

        model.create_entity(
            "IfcRelAssociatesClassification",
            GlobalId=new_guid(),
            Name=f"OmniClass {code}",
            RelatedObjects=elements,
            RelatingClassification=ref,
        )

    log.info(
        "classification_attached",
        system="OmniClass",
        references=ref_count,
        groups=len(groups),
    )
    return ref_count
