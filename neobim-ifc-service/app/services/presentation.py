"""Presentation styles for IFC elements.

Attaches IfcStyledItem → IfcSurfaceStyle → IfcSurfaceStyleShading with RGB
colours to every geometry item so viewers render the building with
discipline-appropriate colours instead of uniform grey.

Without this, every wall/slab/column/MEP/etc. is a grey blob — all the rich
Psets and material layers are invisible to viewers that only render
geometry. Attaching styles per element category makes the multi-discipline
structure legible at a glance.
"""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import new_guid


# RGB in 0..1, transparency in 0..1 (0 = opaque, 1 = invisible).
# Tuned to feel like a real BIM viewer: warm tans for envelope, cool greys
# for structure, bright saturated hues for MEP (so they pop).
ELEMENT_COLORS: dict[str, tuple[float, float, float, float]] = {
    "wall-exterior":   (0.85, 0.80, 0.72, 0.00),  # warm tan
    "wall-partition":  (0.95, 0.95, 0.92, 0.00),  # off-white
    "slab-floor":      (0.60, 0.60, 0.62, 0.00),  # cool grey
    "slab-roof":       (0.55, 0.35, 0.25, 0.00),  # terracotta
    "column":          (0.35, 0.50, 0.72, 0.00),  # structural blue
    "beam":            (0.75, 0.55, 0.28, 0.00),  # bronze
    "window":          (0.55, 0.75, 0.90, 0.60),  # translucent blue
    "door":            (0.45, 0.28, 0.15, 0.00),  # dark brown
    "stair":           (0.60, 0.60, 0.62, 0.00),  # steel grey
    "space":           (0.92, 0.92, 0.75, 0.80),  # soft yellow, mostly transparent
    "duct":            (0.95, 0.85, 0.20, 0.00),  # HVAC yellow
    "pipe":            (0.30, 0.65, 0.90, 0.00),  # plumbing cyan
    "cable-tray":      (0.95, 0.35, 0.20, 0.00),  # electrical red
    "equipment":       (0.50, 0.55, 0.65, 0.00),  # equipment grey
    "proxy":           (0.80, 0.80, 0.78, 0.00),
}


def _make_surface_style(
    model: ifcopenshell.file,
    rgba: tuple[float, float, float, float],
    name: str,
) -> ifcopenshell.entity_instance:
    """Build one IfcSurfaceStyle(IfcSurfaceStyleShading(rgb, transparency))."""
    r, g, b, t = rgba
    colour = model.create_entity("IfcColourRgb", Red=r, Green=g, Blue=b)
    shading = model.create_entity(
        "IfcSurfaceStyleShading",
        SurfaceColour=colour,
        Transparency=t,
    )
    return model.create_entity(
        "IfcSurfaceStyle",
        Name=name,
        Side="BOTH",
        Styles=[shading],
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
