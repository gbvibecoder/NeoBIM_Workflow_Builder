"""Type-instance registry — Phase 2 / Fix 3.

Implements the buildingSMART "type instancing" pattern for the eight
element classes the audit baseline flagged as 0% in Phase 1:

    IfcWall, IfcDoor, IfcWindow, IfcSlab,
    IfcColumn, IfcBeam, IfcStairFlight, IfcSpace.

Behaviour
---------
For every typed instance the builder hands the registry, the registry:

  1. Computes a deduplication signature (material layer set, thickness,
     predefined type, optional section profile). Two walls with the
     same signature share ONE IfcWallType.
  2. Lazily creates the IfcXxxType the first time a signature appears.
  3. Attaches `IfcRelAssociatesMaterial` from the *type* (NOT the
     instance) — instances inherit material via IfcRelDefinesByType.
  4. Tracks `(type_entity, [instances])` so the build can flush one
     `IfcRelDefinesByType` per type at the end (one rel, N members).

The registry is intentionally narrow: it knows about 8 IFC classes
exactly and refuses any class outside the allowlist (a typo would
otherwise silently disable typing for a whole element family).

Entity-count consequences (visible in the audit baseline diff):
  * IfcRelAssociatesMaterial drops from per-instance to per-type. On
    `simple_box` that's 7 → 4 (one per unique type).
  * IfcRelDefinesByType rises from 0 to one-per-type.
  * IfcXxxType counts rise from 0 to the number of unique signatures.
  * IfcMaterialLayerSetUsage moves from per-instance to per-type
    (handled inside `material_library.assign_material_to_element`
    when called with a type-level element).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import derive_guid


# ── Allowlist ─────────────────────────────────────────────────────────
#
# Adding a new IFC class to type instancing means: (1) the runtime
# create-entity call below works, (2) the audit baseline gap-row for
# Fix 3 keeps passing, and (3) downstream BlenderBIM/Revit consumers
# expect this kind of typing. Curate explicitly.
SUPPORTED_TYPE_CLASSES: frozenset[str] = frozenset({
    "IfcWallType",
    "IfcDoorType",
    "IfcWindowType",
    "IfcSlabType",
    "IfcColumnType",
    "IfcBeamType",
    "IfcStairFlightType",
    "IfcSpaceType",
})


# Default predefined types per class — used when the caller passes None.
# Mirrors the table in the Phase 2 prompt § Task 2.
DEFAULT_PREDEFINED_TYPE: dict[str, str] = {
    "IfcWallType": "STANDARD",
    "IfcDoorType": "DOOR",
    "IfcWindowType": "WINDOW",
    "IfcSlabType": "FLOOR",
    "IfcColumnType": "COLUMN",
    "IfcBeamType": "BEAM",
    "IfcStairFlightType": "STRAIGHT",
    "IfcSpaceType": "SPACE",
}


# ── Signature ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class TypeSignature:
    """Dedup key for a type entity.

    Two instances with the same TypeSignature collapse to a single
    IfcXxxType. The fields here are deliberately limited — adding too
    many fields fragments the type pool and re-introduces the per-
    instance footprint the typing fix was meant to eliminate.
    """

    type_class: str  # "IfcWallType", etc.
    material_layer_set_id: int  # `id(layer_set)` — None-safe via 0
    thickness_mm: int  # rounded to integer mm to dedupe near-equal walls
    predefined_type: str  # STANDARD / PARTITIONING / etc.
    section_profile: str = ""  # only meaningful for column/beam steel


def _round_thickness_mm(value_m: float | None) -> int:
    if value_m is None or value_m <= 0:
        return 0
    return int(round(value_m * 1000.0))


# ── Registry ──────────────────────────────────────────────────────────


@dataclass
class _TypeBucket:
    """One IfcXxxType plus the instances that point at it."""

    entity: ifcopenshell.entity_instance
    instances: list[ifcopenshell.entity_instance] = field(default_factory=list)


class TypeRegistry:
    """Per-build cache of IfcXxxType entities + linked instances.

    Construct one per call to `build_ifc()`; flush at end via `flush()`
    to emit the IfcRelDefinesByType bundle.
    """

    def __init__(self, model: ifcopenshell.file):
        self._model = model
        self._buckets: dict[TypeSignature, _TypeBucket] = {}

    # The signature builder is exposed so callers can compute it without
    # also having to know the dataclass shape — keeps the dedup logic
    # in one place.
    def signature(
        self,
        *,
        type_class: str,
        material_layer_set: ifcopenshell.entity_instance | None,
        thickness_m: float | None,
        predefined_type: str | None,
        section_profile: str = "",
    ) -> TypeSignature:
        if type_class not in SUPPORTED_TYPE_CLASSES:
            raise ValueError(
                f"TypeRegistry refuses unsupported type_class={type_class!r}; "
                f"allowed: {sorted(SUPPORTED_TYPE_CLASSES)}"
            )
        return TypeSignature(
            type_class=type_class,
            material_layer_set_id=int(material_layer_set.id()) if material_layer_set else 0,
            thickness_mm=_round_thickness_mm(thickness_m),
            predefined_type=predefined_type or DEFAULT_PREDEFINED_TYPE[type_class],
            section_profile=section_profile or "",
        )

    def attach(
        self,
        instance: ifcopenshell.entity_instance,
        signature: TypeSignature,
        *,
        material_layer_set: ifcopenshell.entity_instance | None = None,
    ) -> ifcopenshell.entity_instance:
        """Look up or create the type entity for `signature`, link the
        instance to it, and return the type entity.

        If `material_layer_set` is provided AND the type is being
        created right now (first time we've seen this signature), the
        registry attaches `IfcRelAssociatesMaterial` from the type.
        Subsequent `attach` calls with the same signature reuse the
        existing type and skip material association — the type already
        carries the layer set, and instances inherit via
        `IfcRelDefinesByType`.
        """
        bucket = self._buckets.get(signature)
        if bucket is None:
            type_entity = self._create_type_entity(signature, material_layer_set)
            bucket = _TypeBucket(entity=type_entity)
            self._buckets[signature] = bucket
        bucket.instances.append(instance)
        return bucket.entity

    def flush(self) -> int:
        """Emit one IfcRelDefinesByType per type with all its instances.

        Returns the number of relationships emitted. Idempotent — safe
        to call once at end-of-build; calling twice would emit duplicate
        rels so the registry guards against that.
        """
        if not self._buckets:
            return 0
        emitted = 0
        for signature, bucket in self._buckets.items():
            if not bucket.instances:
                continue
            self._model.create_entity(
                "IfcRelDefinesByType",
                GlobalId=derive_guid(
                    "IfcRelDefinesByType",
                    bucket.entity.GlobalId,
                ),
                RelatedObjects=bucket.instances,
                RelatingType=bucket.entity,
            )
            emitted += 1
        # Clear so repeat flush is a no-op.
        self._buckets.clear()
        return emitted

    # ── Diagnostics for tests ─────────────────────────────────────

    def signature_count(self) -> int:
        """Count of unique signatures observed in this build."""
        return len(self._buckets)

    def types_by_class(self) -> dict[str, int]:
        """Histogram of type entities per IFC class — fed to test asserts."""
        out: dict[str, int] = {}
        for sig in self._buckets:
            out[sig.type_class] = out.get(sig.type_class, 0) + 1
        return out

    # ── Internals ─────────────────────────────────────────────────

    def _create_type_entity(
        self,
        signature: TypeSignature,
        material_layer_set: ifcopenshell.entity_instance | None,
    ) -> ifcopenshell.entity_instance:
        """Create the type entity + (optional) material association.

        Material is associated with the type — instances inherit by
        IfcRelDefinesByType. This is the entire reason Fix 3 reduces
        IfcRelAssociatesMaterial count: one per type instead of per
        instance.
        """
        type_entity = api.run(
            "root.create_entity",
            self._model,
            ifc_class=signature.type_class,
        )
        type_entity.GlobalId = derive_guid(
            signature.type_class,
            str(signature.material_layer_set_id),
            str(signature.thickness_mm),
            signature.predefined_type,
            signature.section_profile,
        )
        type_entity.Name = self._derive_type_name(signature)
        type_entity.PredefinedType = signature.predefined_type

        if material_layer_set is not None:
            self._associate_material(type_entity, material_layer_set)

        return type_entity

    def _derive_type_name(self, signature: TypeSignature) -> str:
        """Human-readable name visible in BlenderBIM's Type Manager."""
        bare_class = signature.type_class[3:]  # strip "Ifc" prefix
        thick_label = (
            f" {signature.thickness_mm}mm" if signature.thickness_mm > 0 else ""
        )
        prof_label = (
            f" {signature.section_profile}" if signature.section_profile else ""
        )
        return f"{bare_class} {signature.predefined_type}{thick_label}{prof_label}".strip()

    def _associate_material(
        self,
        type_entity: ifcopenshell.entity_instance,
        layer_set: ifcopenshell.entity_instance,
    ) -> None:
        """Attach IfcMaterialLayerSetUsage to the type via IfcRelAssociatesMaterial.

        The usage entity carries the orientation/offset information; the
        layer set itself is reused across all types that share materials
        (so the IfcMaterialLayer chain isn't re-emitted N times).
        """
        usage = self._model.create_entity(
            "IfcMaterialLayerSetUsage",
            ForLayerSet=layer_set,
            LayerSetDirection="AXIS2",
            DirectionSense="POSITIVE",
            OffsetFromReferenceLine=0.0,
        )
        self._model.create_entity(
            "IfcRelAssociatesMaterial",
            GlobalId=derive_guid("IfcRelAssociatesMaterial", type_entity.GlobalId),
            RelatedObjects=[type_entity],
            RelatingMaterial=usage,
        )
