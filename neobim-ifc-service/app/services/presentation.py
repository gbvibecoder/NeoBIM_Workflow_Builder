"""Presentation styles for IFC elements.

Attaches IfcStyledItem → IfcSurfaceStyle → IfcSurfaceStyleRendering with RGB
colours to every geometry item so viewers render the building with
architecturally correct colours instead of uniform grey.

Uses IfcSurfaceStyleRendering (not IfcSurfaceStyleShading) for maximum
viewer compatibility — Revit, ArchiCAD, BIMVision, Solibri, BlenderBIM,
and web-ifc all read IfcSurfaceStyleRendering reliably.
"""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import new_guid


# RGB in 0..1, transparency in 0..1 (0 = opaque, 1 = invisible).
# Architecturally accurate palette — locked to real-world material colours.
ELEMENT_COLORS: dict[str, tuple[float, float, float, float]] = {
    "wall-exterior":   (0.78, 0.65, 0.50, 0.00),  # warm beige stucco
    "wall-partition":  (0.92, 0.90, 0.86, 0.00),  # off-white plaster
    "slab-floor":      (0.72, 0.58, 0.42, 0.00),  # wood floor
    "slab-roof":       (0.45, 0.30, 0.22, 0.00),  # terracotta tile
    "column":          (0.88, 0.88, 0.88, 0.00),  # concrete
    "beam":            (0.55, 0.55, 0.55, 0.00),  # steel grey
    "window":          (0.45, 0.65, 0.78, 0.55),  # translucent blue glass
    "door":            (0.55, 0.40, 0.28, 0.00),  # walnut
    "stair":           (0.60, 0.55, 0.50, 0.00),  # light concrete
    "space":           (0.92, 0.92, 0.75, 0.80),  # soft yellow, mostly transparent
    "duct":            (0.95, 0.85, 0.20, 0.00),  # HVAC yellow
    "pipe":            (0.30, 0.65, 0.90, 0.00),  # plumbing cyan
    "cable-tray":      (0.95, 0.35, 0.20, 0.00),  # electrical red
    "equipment":       (0.50, 0.55, 0.65, 0.00),  # equipment grey
    "proxy":           (0.80, 0.80, 0.78, 0.00),  # generic
}


def _make_surface_style(
    model: ifcopenshell.file,
    rgba: tuple[float, float, float, float],
    name: str,
) -> ifcopenshell.entity_instance:
    """Build IfcSurfaceStyle with IfcSurfaceStyleRendering for wide viewer support.

    Uses IfcSurfaceStyleRendering (subtype of IfcSurfaceStyleShading) with
    ReflectanceMethod=NOTDEFINED — this is the most widely supported path
    across Revit 2024, ArchiCAD 27, BIMVision 2.x, Solibri, BlenderBIM,
    and web-ifc. The DiffuseColour is set to SurfaceColour for consistent
    rendering in viewers that only read diffuse.
    """
    r, g, b, t = rgba
    colour = model.create_entity("IfcColourRgb", Red=r, Green=g, Blue=b)
    rendering = model.create_entity(
        "IfcSurfaceStyleRendering",
        SurfaceColour=colour,
        Transparency=t,
        DiffuseColour=colour,
        ReflectanceMethod="NOTDEFINED",
    )
    return model.create_entity(
        "IfcSurfaceStyle",
        Name=name,
        Side="BOTH",
        Styles=[rendering],
    )


class StyleCache:
    """Reuses one IfcSurfaceStyle per category across all elements in a build.

    Keeps the output small — creating a fresh style per element would
    balloon the file without affecting what the viewer renders.
    """

    def __init__(self, model: ifcopenshell.file) -> None:
        self._model = model
        self._styles: dict[str, ifcopenshell.entity_instance] = {}

    def get(self, category: str) -> ifcopenshell.entity_instance | None:
        rgba = ELEMENT_COLORS.get(category)
        if rgba is None:
            return None
        style = self._styles.get(category)
        if style is None:
            style = _make_surface_style(self._model, rgba, f"{category}-style")
            self._styles[category] = style
        return style


def apply_color(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    category: str,
    cache: StyleCache | None = None,
) -> None:
    """Attach a cached IfcSurfaceStyle via IfcStyledItem to every geometric
    Item inside the element's body representation. Silent no-op on bodyless
    elements (MEP in default rich mode) — there is nothing to colour.
    """
    rep = getattr(element, "Representation", None)
    if rep is None:
        return  # bodyless (MEP, skipped types) — nothing to style

    style = cache.get(category) if cache else None
    if style is None:
        rgba = ELEMENT_COLORS.get(category)
        if rgba is None:
            return
        style = _make_surface_style(model, rgba, f"{category}-style")

    for ifc_rep in rep.Representations or []:
        for item in ifc_rep.Items or []:
            model.create_entity(
                "IfcStyledItem",
                Item=item,
                Styles=[style],
            )
