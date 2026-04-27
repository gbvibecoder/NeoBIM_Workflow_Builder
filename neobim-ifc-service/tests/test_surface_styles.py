"""Test that IFC output contains proper IfcSurfaceStyle entities.

Phase 5.1: every geometric element should have an IfcStyledItem linking it to
an IfcSurfaceStyle with an IfcSurfaceStyleRendering. This test uses the
baseline fixture and verifies the colour pipeline end-to-end.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.ifc_builder import build_multi_discipline


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "baseline_building.json"


@pytest.fixture(scope="module")
def combined_model() -> ifcopenshell.file:
    """Build the combined-discipline model from the baseline fixture."""
    raw = json.loads(FIXTURE_PATH.read_text())
    request = ExportIFCRequest(**raw)
    results = build_multi_discipline(request)
    ifc_bytes, _counts, _failures = results["combined"]
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        tmp.write(ifc_bytes)
        tmp.flush()
        return ifcopenshell.open(tmp.name)


class TestSurfaceStyles:
    """Verify IfcSurfaceStyle + IfcStyledItem presence and correctness."""

    def test_surface_styles_exist(self, combined_model: ifcopenshell.file):
        """At least one IfcSurfaceStyle must be present."""
        styles = combined_model.by_type("IfcSurfaceStyle")
        assert len(styles) >= 4, (
            f"Expected at least 4 IfcSurfaceStyle (walls, windows, doors, slabs), "
            f"found {len(styles)}"
        )

    def test_styled_items_exist(self, combined_model: ifcopenshell.file):
        """At least one IfcStyledItem must be present."""
        items = combined_model.by_type("IfcStyledItem")
        assert len(items) >= 4, (
            f"Expected at least 4 IfcStyledItem, found {len(items)}"
        )

    def test_colour_rgb_exist(self, combined_model: ifcopenshell.file):
        """IfcColourRgb entities must exist for the colours."""
        colours = combined_model.by_type("IfcColourRgb")
        assert len(colours) >= 4, (
            f"Expected at least 4 IfcColourRgb, found {len(colours)}"
        )

    def test_rendering_not_shading(self, combined_model: ifcopenshell.file):
        """Styles should use IfcSurfaceStyleRendering, not plain IfcSurfaceStyleShading.

        IfcSurfaceStyleRendering extends IfcSurfaceStyleShading and is supported
        by more viewers (Revit, ArchiCAD, BIMVision, web-ifc).
        """
        styles = combined_model.by_type("IfcSurfaceStyle")
        for style in styles:
            for render_style in style.Styles:
                assert render_style.is_a("IfcSurfaceStyleRendering"), (
                    f"Style '{style.Name}' uses {render_style.is_a()} — "
                    f"expected IfcSurfaceStyleRendering"
                )

    def test_wall_colour_is_beige(self, combined_model: ifcopenshell.file):
        """Exterior wall colour should be warm beige (0.78, 0.65, 0.50)."""
        styles = combined_model.by_type("IfcSurfaceStyle")
        wall_style = next(
            (s for s in styles if s.Name and "wall-exterior" in s.Name), None
        )
        assert wall_style is not None, "No wall-exterior-style found"
        rendering = wall_style.Styles[0]
        rgb = rendering.SurfaceColour
        assert abs(rgb.Red - 0.78) < 0.02, f"Wall red={rgb.Red}, expected ~0.78"
        assert abs(rgb.Green - 0.65) < 0.02, f"Wall green={rgb.Green}, expected ~0.65"
        assert abs(rgb.Blue - 0.50) < 0.02, f"Wall blue={rgb.Blue}, expected ~0.50"

    def test_window_transparency(self, combined_model: ifcopenshell.file):
        """Window glass should have transparency ~0.55."""
        styles = combined_model.by_type("IfcSurfaceStyle")
        win_style = next(
            (s for s in styles if s.Name and "window" in s.Name), None
        )
        assert win_style is not None, "No window-style found"
        rendering = win_style.Styles[0]
        assert abs(rendering.Transparency - 0.55) < 0.02, (
            f"Window transparency={rendering.Transparency}, expected ~0.55"
        )

    def test_no_orphan_styled_items(self, combined_model: ifcopenshell.file):
        """Every IfcStyledItem.Item should reference a geometry representation item."""
        items = combined_model.by_type("IfcStyledItem")
        orphans = [si for si in items if si.Item is None]
        assert len(orphans) == 0, (
            f"{len(orphans)} IfcStyledItem(s) have no Item reference (orphans)"
        )

    def test_every_wall_has_style(self, combined_model: ifcopenshell.file):
        """Every IfcWall with geometry should have an associated IfcStyledItem."""
        styled_items = combined_model.by_type("IfcStyledItem")
        styled_geom_ids = {si.Item.id() for si in styled_items if si.Item}

        walls = combined_model.by_type("IfcWall")
        walls_missing_style = []
        for wall in walls:
            rep = wall.Representation
            if not rep:
                continue
            has_style = False
            for ifc_rep in rep.Representations or []:
                for item in ifc_rep.Items or []:
                    if item.id() in styled_geom_ids:
                        has_style = True
                        break
                if has_style:
                    break
            if not has_style:
                walls_missing_style.append(wall.Name or wall.GlobalId)

        assert len(walls_missing_style) == 0, (
            f"{len(walls_missing_style)} walls missing IfcStyledItem: "
            f"{walls_missing_style[:5]}"
        )
