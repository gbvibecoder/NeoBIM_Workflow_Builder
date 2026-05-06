"""IS-808 Indian Standard steel section lookup — Phase 2 / Fix 11.

Single source of truth for the most common rolled-steel section names
issued under IS-808:1989 ("Hot Rolled Steel Beam, Column, Channel and
Angle Sections"). When `material === "steel"` and `sectionProfile` is
one of the names below, the column/beam builder emits an
`IfcIShapeProfileDef` with the spec dimensions instead of falling back
to a generic rectangle.

Source: IS-808:1989 Annex A. Dimensions in MILLIMETRES (not metres) —
converted to metres at the IFC boundary by the builders. Do not modify
the published dimensions; if a cross-section needs adjusting, the spec
itself is the authority.

Series prefix legend:
  ISMB  — Indian Standard Medium Weight Beam
  ISLB  — Indian Standard Light Weight Beam
  ISJB  — Indian Standard Junior Beam
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ISection:
    """A single rolled section in millimetres.

    `IfcIShapeProfileDef` expects metres, so convert at the call site
    via `as_metres()` to keep this table 1:1 with the IS-808 catalogue.
    """

    designation: str  # canonical name e.g. "ISMB300"
    depth_mm: float
    flange_width_mm: float
    flange_thickness_mm: float
    web_thickness_mm: float

    def as_metres(self) -> dict[str, float]:
        return {
            "depth": self.depth_mm / 1000.0,
            "flange_width": self.flange_width_mm / 1000.0,
            "flange_thickness": self.flange_thickness_mm / 1000.0,
            "web_thickness": self.web_thickness_mm / 1000.0,
        }


# ── Lookup table — values published in IS-808:1989, Tables 1, 2, 3 ────
#
# Order: depth, flange_width, flange_thickness, web_thickness. All mm.
# A typo in this table propagates to every IFC the service generates,
# so it lives in one file and is referenced by tests that pin a few
# representative sections.

IS_808_LOOKUP: dict[str, ISection] = {
    # ── ISMB (Medium Weight Beam) ────────────────────────────────
    "ISMB100": ISection("ISMB100", 100, 75,  7.2,  4.0),
    "ISMB125": ISection("ISMB125", 125, 75,  7.6,  4.4),
    "ISMB150": ISection("ISMB150", 150, 80,  7.6,  4.8),
    "ISMB200": ISection("ISMB200", 200, 100, 10.8, 5.7),
    "ISMB250": ISection("ISMB250", 250, 125, 12.5, 6.9),
    "ISMB300": ISection("ISMB300", 300, 140, 12.4, 7.5),
    "ISMB400": ISection("ISMB400", 400, 140, 16.0, 8.9),
    "ISMB500": ISection("ISMB500", 500, 180, 17.2, 10.2),
    "ISMB600": ISection("ISMB600", 600, 210, 20.8, 12.0),
    # ── ISLB (Light Weight Beam) ─────────────────────────────────
    "ISLB100": ISection("ISLB100", 100, 50,  6.4,  4.0),
    "ISLB200": ISection("ISLB200", 200, 100, 7.3,  5.4),
    "ISLB300": ISection("ISLB300", 300, 150, 9.4,  6.7),
    # ── ISJB (Junior Beam) ───────────────────────────────────────
    "ISJB150": ISection("ISJB150", 150, 50,  6.8,  3.6),
    "ISJB200": ISection("ISJB200", 200, 60,  7.3,  4.0),
    "ISJB225": ISection("ISJB225", 225, 80,  8.6,  5.0),
}


def get_is_section(name: str | None) -> ISection | None:
    """Return the IS-808 section for a designation, or None if unknown.

    Case-insensitive on the designation prefix; trims whitespace. The
    builder treats `None` as "use the rectangular fallback".
    """
    if not name:
        return None
    return IS_808_LOOKUP.get(name.strip().upper())


def is_steel_material(material: str | None) -> bool:
    """True if the element's structural material maps to steel.

    Accepts `material` and `structuralMaterial` values (Track C added
    `structuralMaterial` as a typed Literal — both flow into here).
    """
    if not material:
        return False
    return material.strip().lower() == "steel"
