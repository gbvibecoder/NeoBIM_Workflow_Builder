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

from app.utils.guid import new_guid, derive_guid

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
            # Include (ifc_class, predefined_type) in the GUID seed:
            # multiple groups can map to the same OmniClass code (e.g.
            # IfcSlab+FLOOR and IfcSlab+None both → "21-01 20 10 00").
            # Without the group key, two rels would collide.
            GlobalId=derive_guid(
                "IfcRelAssociatesClassification",
                "OmniClass",
                ifc_class,
                str(pt or ""),
                code,
            ),
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


# ── NBC India 2016 Part 4 (Phase 2 / new classification system) ───────
#
# A second classification chain alongside OmniClass. NBC = National
# Building Code of India, Part 4 = Fire and Life Safety. The Part 4
# occupancy groups are the canonical Indian-market classification for
# any building submitted to a municipal authority.
#
# Reference: Bureau of Indian Standards, NBC 2016 Vol. 1 Part 4 § 4.2.
# The Group A→I letter codes are spec-published — do not invent.

NBC_NAME = "NBC 2016 Part 4"
NBC_SOURCE = "Bureau of Indian Standards"
NBC_EDITION = "2016"
NBC_LOCATION = "https://www.bis.gov.in/standards/nbc-2016/"

NBC_OCCUPANCY_GROUPS: dict[str, str] = {
    "A":   "Residential",
    "A-1": "Lodging",
    "A-2": "One/two family private dwelling",
    "A-3": "Dormitory",
    "A-4": "Apartment",
    "A-5": "Hotel",
    "B":   "Educational",
    "C":   "Institutional",
    "D":   "Assembly",
    "E":   "Business",
    "F":   "Mercantile",
    "G":   "Industrial",
    "H":   "Storage",
    "I":   "Hazardous",
}


# Map fragments of a `buildingType` string to an NBC group code.
# Order matters — first hit wins. Specific tokens checked before
# generic ones, AND substring-trap tokens (e.g. "warehouse" contains
# "house") are placed before the shorter pattern they could collide
# with. The check is plain `token in bt`, so reordering is the
# correctness lever.
_NBC_BUILDING_TYPE_PATTERNS: list[tuple[str, str]] = [
    # Industrial / storage first — `warehouse` contains `house`,
    # `factory` doesn't collide but stays grouped here.
    ("warehouse", "H"),
    ("storage", "H"),
    ("hazardous", "I"),
    ("factory", "G"),
    ("industrial", "G"),
    # Specific residential tokens before the generic catch-all.
    ("single-family", "A-2"),
    ("two-family", "A-2"),
    ("apartment", "A-4"),
    ("hotel", "A-5"),
    ("dormitory", "A-3"),
    ("hostel", "A-3"),
    ("villa", "A-2"),
    ("house", "A-2"),
    ("residence", "A"),
    ("residential", "A"),
    # Other categories.
    ("school", "B"),
    ("college", "B"),
    ("educational", "B"),
    ("hospital", "C"),
    ("clinic", "C"),
    ("institutional", "C"),
    ("auditorium", "D"),
    ("assembly", "D"),
    ("office", "E"),
    ("business", "E"),
    ("mall", "F"),
    ("shop", "F"),
    ("retail", "F"),
    ("mercantile", "F"),
]


def nbc_group_for_building_type(building_type: str) -> str:
    """Map a free-form `buildingType` string to an NBC Part 4 group code.

    Falls back to "E" (Business) — the safe default for an
    unclassifiable commercial building. Surfaced in the Phase 2 report
    so callers know to populate `buildingType` precisely if they care
    about classification accuracy.
    """
    bt = (building_type or "").lower()
    for token, code in _NBC_BUILDING_TYPE_PATTERNS:
        if token in bt:
            return code
    return "E"


def attach_nbc_india(
    model: ifcopenshell.file,
    building_type: str,
) -> str | None:
    """Attach an NBC 2016 Part 4 classification reference to IfcBuilding.

    A SECOND classification chain alongside OmniClass — they coexist
    cleanly because each `IfcRelAssociatesClassification` is independent.
    Returns the assigned NBC group code, or None if there is no
    IfcBuilding in the model (off-mode skips this).
    """
    buildings = list(model.by_type("IfcBuilding"))
    if not buildings:
        return None

    code = nbc_group_for_building_type(building_type)
    title = NBC_OCCUPANCY_GROUPS.get(code, code)

    system = model.create_entity(
        "IfcClassification",
        Source=NBC_SOURCE,
        Edition=NBC_EDITION,
        Name=NBC_NAME,
        Location=NBC_LOCATION,
    )
    ref = model.create_entity(
        "IfcClassificationReference",
        Location=NBC_LOCATION,
        Identification=f"Group {code}",
        Name=title,
        ReferencedSource=system,
    )
    model.create_entity(
        "IfcRelAssociatesClassification",
        GlobalId=derive_guid("IfcRelAssociatesClassification", "NBC", code),
        Name=f"NBC 2016 Part 4 - Group {code}",
        RelatedObjects=buildings,
        RelatingClassification=ref,
    )

    log.info(
        "classification_attached",
        system="NBC 2016 Part 4",
        group=code,
        title=title,
        building_type=building_type,
    )
    return code
