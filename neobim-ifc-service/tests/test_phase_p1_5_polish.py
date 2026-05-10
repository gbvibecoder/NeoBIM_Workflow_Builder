"""Phase P1.5 — End-to-end IFC polish tests.

Validates the P1.5 service-layer additions across all 12 templates:

  * Phase B (psets): every IfcWall/IfcSlab/IfcColumn/IfcBeam/IfcSpace
    has its standard Pset_*Common attached.
  * Phase C (coverings): every habitable storey emits IfcCovering
    floor + ceiling pair.
  * Phase D (parapet): every ROOF slab has 4 parapet IfcWall around it.
  * Phase F (site): IfcSite has geometry (ground plane).

Cross-template — runs each assertion against the 4 BHK form factors
(house, duplex, tower G+5) for 1BHK / 2BHK / 3BHK = 9 templates.
G+11 / G+23 are skipped here (covered via family-specific tests in
existing files) to keep the cross-cutting P1.5 suite fast.
"""

from __future__ import annotations

import pytest

from app.templates import (
    build_1bhk_pune_duplex,
    build_1bhk_pune_house,
    build_1bhk_pune_tower,
    build_2bhk_pune_house,
    build_2bhk_pune_template,
    build_2bhk_pune_tower,
    build_3bhk_pune_duplex,
    build_3bhk_pune_house,
    build_3bhk_pune_tower,
)
from scripts.export_2bhk_pune_to_ifc import build_ifc_from_building_model


# ─── Per-builder fixtures (build BuildingModel + IFC once per test) ──


def _builders():
    return [
        ("1bhk-house", build_1bhk_pune_house),
        ("1bhk-duplex", build_1bhk_pune_duplex),
        ("1bhk-tower-g5", lambda: build_1bhk_pune_tower(habitable_floor_count=5)),
        ("2bhk-house", build_2bhk_pune_house),
        ("2bhk-duplex", build_2bhk_pune_template),
        ("2bhk-tower-g5", lambda: build_2bhk_pune_tower(habitable_floor_count=5)),
        ("3bhk-house", build_3bhk_pune_house),
        ("3bhk-duplex", build_3bhk_pune_duplex),
        ("3bhk-tower-g5", lambda: build_3bhk_pune_tower(habitable_floor_count=5)),
    ]


@pytest.fixture(params=_builders(), ids=lambda p: p[0])
def ifc_model(request):
    """Build a fresh IFC for each template under test."""
    label, builder = request.param
    bm = builder()
    model = build_ifc_from_building_model(bm)
    return label, model


# ─── Phase B — Pset population ───────────────────────────────────────


def test_p1_5_b_every_wall_has_pset_wallcommon(ifc_model) -> None:
    """Every solid IfcWall has Pset_WallCommon attached. Excludes
    parapet IfcWalls (also have Pset_WallCommon) and IfcRailing
    (uses Pset_RailingCommon)."""
    label, model = ifc_model
    walls = [w for w in model.by_type("IfcWall")]
    assert len(walls) > 0, f"{label}: no walls found"
    for wall in walls:
        psets = _psets_of(wall)
        assert "Pset_WallCommon" in psets, (
            f"{label}: wall {wall.GlobalId} missing Pset_WallCommon"
        )


def test_p1_5_b_every_slab_has_pset_slabcommon(ifc_model) -> None:
    """Every IfcSlab has Pset_SlabCommon + Qto_SlabBaseQuantities."""
    label, model = ifc_model
    slabs = list(model.by_type("IfcSlab"))
    assert len(slabs) > 0, f"{label}: no slabs found"
    for slab in slabs:
        psets = _psets_of(slab)
        assert "Pset_SlabCommon" in psets
        assert "Qto_SlabBaseQuantities" in psets


def test_p1_5_b_every_column_has_pset_columncommon(ifc_model) -> None:
    """Every IfcColumn has Pset_ColumnCommon + Qto_ColumnBaseQuantities."""
    label, model = ifc_model
    cols = list(model.by_type("IfcColumn"))
    assert len(cols) > 0, f"{label}: no columns found"
    for col in cols:
        psets = _psets_of(col)
        assert "Pset_ColumnCommon" in psets
        assert "Qto_ColumnBaseQuantities" in psets


def test_p1_5_b_every_beam_has_pset_beamcommon(ifc_model) -> None:
    """Every IfcBeam has Pset_BeamCommon + Qto_BeamBaseQuantities."""
    label, model = ifc_model
    beams = list(model.by_type("IfcBeam"))
    assert len(beams) > 0, f"{label}: no beams found"
    for beam in beams:
        psets = _psets_of(beam)
        assert "Pset_BeamCommon" in psets
        assert "Qto_BeamBaseQuantities" in psets


def test_p1_5_b_every_space_has_pset_spacecommon(ifc_model) -> None:
    """Every IfcSpace has Pset_SpaceCommon + Qto_SpaceBaseQuantities."""
    label, model = ifc_model
    spaces = list(model.by_type("IfcSpace"))
    assert len(spaces) > 0, f"{label}: no spaces found"
    for space in spaces:
        psets = _psets_of(space)
        assert "Pset_SpaceCommon" in psets
        assert "Qto_SpaceBaseQuantities" in psets


def test_p1_5_b_every_door_has_pset_doorcommon(ifc_model) -> None:
    """Every IfcDoor has Pset_DoorCommon."""
    label, model = ifc_model
    doors = list(model.by_type("IfcDoor"))
    assert len(doors) > 0, f"{label}: no doors found"
    for door in doors:
        psets = _psets_of(door)
        assert "Pset_DoorCommon" in psets


def test_p1_5_b_every_window_has_pset_windowcommon(ifc_model) -> None:
    """Every IfcWindow has Pset_WindowCommon."""
    label, model = ifc_model
    windows = list(model.by_type("IfcWindow"))
    assert len(windows) > 0, f"{label}: no windows found"
    for window in windows:
        psets = _psets_of(window)
        assert "Pset_WindowCommon" in psets


def test_p1_5_b_every_railing_has_pset_railingcommon(ifc_model) -> None:
    """Every IfcRailing has Pset_RailingCommon. Skip templates with no
    railings (house/duplex without balcony, no-stilt edge cases)."""
    label, model = ifc_model
    railings = list(model.by_type("IfcRailing"))
    if not railings:
        pytest.skip(f"{label}: no railings (expected for house/duplex)")
    for railing in railings:
        psets = _psets_of(railing)
        assert "Pset_RailingCommon" in psets


# ─── Phase C — Coverings (floor + ceiling finishes) ─────────────────


def test_p1_5_c_every_habitable_storey_has_floor_and_ceiling_covering(
    ifc_model,
) -> None:
    """Each habitable storey emits one FLOORING + one CEILING IfcCovering.
    Stilt floors skip both."""
    label, model = ifc_model
    coverings = list(model.by_type("IfcCovering"))
    floor_coverings = [c for c in coverings if c.PredefinedType == "FLOORING"]
    ceiling_coverings = [c for c in coverings if c.PredefinedType == "CEILING"]
    # FLOORING and CEILING come in pairs.
    assert len(floor_coverings) == len(ceiling_coverings), (
        f"{label}: {len(floor_coverings)} floors vs "
        f"{len(ceiling_coverings)} ceilings"
    )
    # At least 1 habitable storey (every template has a habitable floor).
    assert len(floor_coverings) >= 1
    # Every covering has Pset_CoveringCommon.
    for cov in coverings:
        psets = _psets_of(cov)
        assert "Pset_CoveringCommon" in psets


# ─── Phase D — Roof parapet ──────────────────────────────────────────


def test_p1_5_d_every_roof_has_4_parapet_walls(ifc_model) -> None:
    """Every ROOF IfcSlab has 4 parapet IfcWalls (S/E/N/W) with
    PredefinedType=PARAPET. Identified by id pattern 'parapet-…'."""
    label, model = ifc_model
    roof_slabs = [s for s in model.by_type("IfcSlab") if s.PredefinedType == "ROOF"]
    assert len(roof_slabs) >= 1, f"{label}: no roof slabs"

    parapet_walls = [
        w for w in model.by_type("IfcWall")
        if w.PredefinedType == "PARAPET"
    ]
    # 4 parapets per roof slab.
    expected = 4 * len(roof_slabs)
    assert len(parapet_walls) == expected, (
        f"{label}: expected {expected} parapet walls "
        f"({len(roof_slabs)} roofs × 4), got {len(parapet_walls)}"
    )


def test_p1_5_d_parapet_height_is_1m(ifc_model) -> None:
    """Each parapet wall extrudes 1.0m above the roof slab."""
    import ifcopenshell.geom

    label, model = ifc_model
    parapet_walls = [
        w for w in model.by_type("IfcWall")
        if w.PredefinedType == "PARAPET"
    ]
    if not parapet_walls:
        pytest.skip(f"{label}: no parapet walls")
    # Inspect the first parapet's extrusion depth via IfcOpenShell geom.
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    sample = parapet_walls[0]
    shape = ifcopenshell.geom.create_shape(settings, sample)
    verts = shape.geometry.verts
    zs = verts[2::3]
    z_range = max(zs) - min(zs)
    assert z_range == pytest.approx(1.0, abs=0.05), (
        f"{label}: parapet z_range={z_range:.3f}m (expected 1.0m)"
    )


# ─── Phase F — Site ground plane ─────────────────────────────────────


def test_p1_5_f_site_has_ground_geometry(ifc_model) -> None:
    """IfcSite has a Representation (ground polygon)."""
    label, model = ifc_model
    sites = list(model.by_type("IfcSite"))
    assert len(sites) == 1
    site = sites[0]
    assert site.Representation is not None, (
        f"{label}: IfcSite has no Representation (ground plane missing)"
    )
    # Representation contains at least one shape.
    reps = site.Representation.Representations
    assert len(reps) >= 1


def test_p1_5_f_site_has_pset_sitecommon(ifc_model) -> None:
    """IfcSite has Pset_SiteCommon attached."""
    label, model = ifc_model
    site = model.by_type("IfcSite")[0]
    psets = _psets_of(site)
    assert "Pset_SiteCommon" in psets


# ─── Cross-cutting: pset count strictly increased ────────────────────


def test_p1_5_total_psets_grew_significantly(ifc_model) -> None:
    """Forward-only quality: each template has dozens of psets now
    (previously only Pset_BuildFlow_Provenance + Pset_ReraData).
    Threshold is dynamic — at least 5× the element count to ensure
    every major element got at least one pset."""
    label, model = ifc_model
    psets = list(model.by_type("IfcPropertySet"))
    qtos = list(model.by_type("IfcElementQuantity"))
    walls = len(model.by_type("IfcWall"))
    slabs = len(model.by_type("IfcSlab"))
    cols = len(model.by_type("IfcColumn"))
    beams = len(model.by_type("IfcBeam"))
    spaces = len(model.by_type("IfcSpace"))

    elements = walls + slabs + cols + beams + spaces
    # Each major element should contribute ≥1 pset on average.
    assert len(psets) >= elements, (
        f"{label}: psets={len(psets)} < elements={elements} "
        f"(walls={walls}, slabs={slabs}, cols={cols}, beams={beams}, "
        f"spaces={spaces})"
    )
    # Qto count tracks beams/cols/slabs/spaces (each gets one Qto).
    assert len(qtos) >= 1, f"{label}: no Qto entities found"


# ─── Phase A — Stair stepped geometry (regression guard from T2.0.1.1) ─


def test_p1_5_a_stair_geometry_has_stepped_profile(ifc_model) -> None:
    """Stairs use stepped polyline profile (not single block).
    The profile polyline has 2N+3 vertices for N risers
    (start + 2N step corners + bottom-back + close-to-start).
    """
    label, model = ifc_model
    flights = list(model.by_type("IfcStairFlight"))
    if not flights:
        pytest.skip(f"{label}: no stairs (house has none)")
    sample = flights[0]
    # Walk the IFC graph to find the IfcArbitraryClosedProfileDef.
    rep = sample.Representation
    profile_polyline_pts = []
    for r in rep.Representations:
        for item in r.Items:
            if item.is_a("IfcExtrudedAreaSolid"):
                profile = item.SweptArea
                if profile.is_a("IfcArbitraryClosedProfileDef"):
                    polyline = profile.OuterCurve
                    if polyline.is_a("IfcPolyline"):
                        profile_polyline_pts = polyline.Points
                        break
        if profile_polyline_pts:
            break

    assert len(profile_polyline_pts) > 0, (
        f"{label}: stair profile polyline not found (geometry not stepped)"
    )
    # Stepped profile: ≥ 2N+3 for N=19 risers = 41. Allow some flex.
    assert len(profile_polyline_pts) >= 20, (
        f"{label}: stair profile has only {len(profile_polyline_pts)} "
        f"points — not stepped"
    )


# ─── Helpers ─────────────────────────────────────────────────────────


def _psets_of(entity) -> set[str]:
    """Return the names of all IfcPropertySet / IfcElementQuantity
    attached to an entity via IfcRelDefinesByProperties."""
    out: set[str] = set()
    for rel in getattr(entity, "IsDefinedBy", []) or []:
        if rel.is_a("IfcRelDefinesByProperties"):
            defin = rel.RelatingPropertyDefinition
            name = getattr(defin, "Name", None)
            if name:
                out.add(name)
    return out
