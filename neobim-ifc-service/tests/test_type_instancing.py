"""Phase 2 / Fix 3 — type-instance pattern tests.

Pins the buildingSMART type-instance contract on the multistorey_residential
fixture (the most-element-rich of the three Phase 1 fixtures):

  1. Every typed instance class produces ≥ 1 IfcXxxType.
  2. IfcRelDefinesByType count == number of populated type buckets.
  3. Two walls with the same material/thickness/predefined-type signature
     share ONE IfcWallType (deduplication works).
  4. Material association moved from instance level to type level —
     zero IfcRelAssociatesMaterial points at IfcWall instances directly.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.ifc_builder import build_multi_discipline


FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def model() -> ifcopenshell.file:
    raw = json.loads((FIXTURE_DIR / "multistorey_residential.json").read_text())
    raw.pop("_comment", None)
    raw["options"]["richMode"] = "full"
    raw["options"]["disciplines"] = ["combined"]
    req = ExportIFCRequest.model_validate(raw)
    ifc_bytes, _, _ = build_multi_discipline(req)["combined"]
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as t:
        t.write(ifc_bytes)
        t.flush()
        return ifcopenshell.open(t.name)


# ── (1) Every typed instance class produces ≥ 1 type entity ───────────


@pytest.mark.parametrize(
    "instance_class,type_class",
    [
        ("IfcWall", "IfcWallType"),
        ("IfcDoor", "IfcDoorType"),
        ("IfcWindow", "IfcWindowType"),
        ("IfcSlab", "IfcSlabType"),
        ("IfcColumn", "IfcColumnType"),
        ("IfcStairFlight", "IfcStairFlightType"),
        ("IfcSpace", "IfcSpaceType"),
    ],
)
def test_instance_class_has_corresponding_type_class(
    model: ifcopenshell.file, instance_class: str, type_class: str
):
    instance_count = len(list(model.by_type(instance_class)))
    type_count = len(list(model.by_type(type_class)))
    if instance_count > 0:
        assert type_count >= 1, (
            f"{instance_count} {instance_class} instances but 0 {type_class} types"
        )


def test_beam_type_present_when_beams_present(model: ifcopenshell.file):
    """Beams may be 0 in some fixtures — the residential fixture has them.
    Treated separately so the parametrize loop above doesn't false-positive
    when tested against MEP-only or stair-only fixtures."""
    beam_count = len(list(model.by_type("IfcBeam")))
    beam_type_count = len(list(model.by_type("IfcBeamType")))
    if beam_count > 0:
        assert beam_type_count >= 1


# ── (2) IfcRelDefinesByType bundle count ──────────────────────────────


def test_rel_defines_by_type_count_matches_populated_types(model: ifcopenshell.file):
    """One IfcRelDefinesByType per type with ≥ 1 instance."""
    type_classes = (
        "IfcWallType", "IfcDoorType", "IfcWindowType", "IfcSlabType",
        "IfcColumnType", "IfcBeamType", "IfcStairFlightType", "IfcSpaceType",
    )
    populated_types = sum(len(list(model.by_type(c))) for c in type_classes)
    rels = len(list(model.by_type("IfcRelDefinesByType")))
    assert rels == populated_types, (
        f"Expected one IfcRelDefinesByType per populated type; "
        f"got {rels} rels for {populated_types} types"
    )


def _is_enrichment_added(inst) -> bool:
    """Heuristic: enrichment.py adds IfcWall(PARAPET) and IfcSlab named
    'Ground Podium' / 'Entrance Canopy'. These bypass the typed-emitter
    pipeline by design (enrichment was Phase 1 and is out of Phase 2
    scope). Recognise them so tests can exclude them from the strict
    type-membership invariant."""
    if inst.is_a("IfcWall") and getattr(inst, "PredefinedType", None) == "PARAPET":
        return True
    if inst.is_a("IfcSlab"):
        name = (getattr(inst, "Name", None) or "").lower()
        if "podium" in name or "canopy" in name:
            return True
    return False


def test_every_user_emitted_typed_instance_belongs_to_exactly_one_type(
    model: ifcopenshell.file,
):
    """`IsTypedBy` inverse points each user-emitted instance at its
    type — and only one. Excludes enrichment-emitted parapet walls and
    podium/canopy slabs, which keep the per-instance pattern."""
    typed_classes = (
        "IfcWall", "IfcDoor", "IfcWindow", "IfcSlab",
        "IfcColumn", "IfcBeam", "IfcStairFlight", "IfcSpace",
    )
    orphans: list[str] = []
    for cls in typed_classes:
        for inst in model.by_type(cls):
            if _is_enrichment_added(inst):
                continue
            typed_by = getattr(inst, "IsTypedBy", None) or []
            if len(typed_by) != 1:
                orphans.append(f"{cls}:{inst.Name} typed_by_count={len(typed_by)}")
    assert not orphans, f"Expected exactly one type per instance: {orphans[:5]}"


# ── (3) Deduplication ─────────────────────────────────────────────────


def test_walls_with_identical_signature_share_one_type(model: ifcopenshell.file):
    """All non-partition walls (STANDARD, 250mm thickness, same material)
    must collapse to ONE IfcWallType. multistorey_residential has many
    such walls per storey + one partition variant per storey."""
    wall_types = list(model.by_type("IfcWallType"))
    standard_types = [t for t in wall_types if t.PredefinedType == "STANDARD"]
    partitioning_types = [t for t in wall_types if t.PredefinedType == "PARTITIONING"]
    assert len(standard_types) == 1, (
        f"Expected 1 IfcWallType STANDARD, got {len(standard_types)}: "
        f"{[t.Name for t in standard_types]}"
    )
    assert len(partitioning_types) == 1, (
        f"Expected 1 IfcWallType PARTITIONING, got {len(partitioning_types)}"
    )


# ── (4) Material association moved from instance to type ──────────────


def test_no_material_association_directly_on_user_emitted_wall_instances(
    model: ifcopenshell.file,
):
    """After Phase 2: IfcRelAssociatesMaterial points at IfcWallType,
    never directly at IfcWall instances *that the user emitted*.

    Exception: parapet walls created by `enrichment.py` are outside the
    typed-emitter pipeline — they're added post-hoc to dress the roof
    line — and keep the pre-Phase-2 per-instance pattern. Recognised by
    PredefinedType=PARAPET. Migrating enrichment to the type registry
    is in scope for a later phase that also tackles podium slabs,
    ceilings, and railings.
    """
    direct_associations = []
    for rel in model.by_type("IfcRelAssociatesMaterial"):
        for obj in rel.RelatedObjects or []:
            if obj.is_a("IfcWall") and getattr(obj, "PredefinedType", None) != "PARAPET":
                direct_associations.append(obj.Name)
    assert not direct_associations, (
        f"IfcRelAssociatesMaterial still points at non-parapet wall instances: "
        f"{direct_associations[:5]}"
    )


def test_wall_types_carry_material_association(model: ifcopenshell.file):
    """Each IfcWallType in the model is the target of at least one
    IfcRelAssociatesMaterial — that's how instances inherit their layer
    set."""
    wall_types = list(model.by_type("IfcWallType"))
    materialized_types: set[int] = set()
    for rel in model.by_type("IfcRelAssociatesMaterial"):
        for obj in rel.RelatedObjects or []:
            if obj.is_a("IfcWallType"):
                materialized_types.add(obj.id())
    missing = [t for t in wall_types if t.id() not in materialized_types]
    assert not missing, (
        f"{len(missing)} IfcWallType(s) without material association"
    )


def test_instance_inherits_material_via_type(model: ifcopenshell.file):
    """Round-trip: pick any IfcWall, follow IsTypedBy → IfcWallType,
    verify the type's material is reachable. Locks the inheritance chain
    against future regressions."""
    walls = list(model.by_type("IfcWall"))
    assert walls, "fixture has no walls — re-pin or re-generate fixture"
    wall = walls[0]
    typed_by = wall.IsTypedBy
    assert len(typed_by) == 1
    wall_type = typed_by[0].RelatingType
    assert wall_type.is_a("IfcWallType")
    # Type must have an associated layer set
    type_materials = [
        rel.RelatingMaterial
        for rel in model.by_type("IfcRelAssociatesMaterial")
        if wall_type in (rel.RelatedObjects or [])
    ]
    assert type_materials, "wall type has no IfcRelAssociatesMaterial"
