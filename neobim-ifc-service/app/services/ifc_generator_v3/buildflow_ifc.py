"""BuildFlowIFC — the helper library that hides IFC2X3 schema strictness.

Designed so the v3 generator agent can author a Concierge-class IFC in
~20-40 lines of Python without ever touching `ifcopenshell` raw or
hand-rolling STEP. Every public method:

  • Sanitizes string arguments to pure ASCII at the boundary (em-dash,
    middle dot, curly quotes, arrows → ASCII equivalents). The 3 bugs
    that killed the v2 one-shot generator all reduced to non-ASCII bytes
    leaking into STEP serialization.
  • Knows which IFC2X3 entity classes have a PredefinedType slot and which
    don't (the chat-discovered list — IfcWall / IfcColumn / IfcBeam /
    IfcFurnishingElement / IfcLightFixture do NOT in 2X3; IfcSlab /
    IfcRoof / IfcCovering / IfcRailing / IfcBuildingElementProxy do).
  • Rejects invalid `IfcBuildingElementProxy.CompositionType` values up
    front (must be one of `.COMPLEX. / .ELEMENT. / .PARTIAL.`).
  • Returns a Python object reference the agent can pass to subsequent
    calls (e.g. `attach_pset([slab1, slab2], …)`) instead of fighting
    GUID lookups.

The instance lifecycle is `__init__(brief) → add_* calls → write(path)`,
plus `save_state(path)` / `load_state(path)` for the session-scoped
sandbox to persist between agent tool calls.

NOTE on PredefinedType: even where 2X3 allows it, ifcopenshell.api will
silently drop unknown PredefinedType values. We accept the documented
2X3 set (FLOOR/ROOF/LANDING/BASESLAB for IfcSlab; FLOORING/CEILING/
CLADDING/INSULATION/MEMBRANE/SLEEVING/WRAPPING/USERDEFINED/NOTDEFINED
for IfcCovering; etc.) and otherwise omit.
"""

from __future__ import annotations

import json
import math
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.guid


# ── ASCII sanitization ────────────────────────────────────────────────
#
# Every non-ASCII byte that reaches STEP serialization is a potential
# tokenizer crash downstream (web-ifc reports `GetSetArgument unexpected
# token` with zero context). We normalise at the public API boundary.

_ASCII_FALLBACKS = {
    "—": "-",   # em-dash
    "–": "-",   # en-dash
    "−": "-",   # minus sign
    "·": ".",   # middle dot
    " ": " ",   # non-breaking space
    "‘": "'",   # left single quote
    "’": "'",   # right single quote (also apostrophe)
    "“": '"',   # left double quote
    "”": '"',   # right double quote
    "→": "->",  # rightwards arrow
    "←": "<-",  # leftwards arrow
    "↓": "v",   # downwards arrow
    "↑": "^",   # upwards arrow
    "…": "...", # ellipsis
    "×": "x",   # multiplication sign
    "•": "*",   # bullet
}


def _ascii_safe(value: Any) -> Any:
    """Recursively coerce strings to pure ASCII; pass-through for non-strings.

    The mapping above handles the common ones cleanly; anything else falls
    through to `errors="replace"` (becomes `?`). Loud-replacement, not
    silent loss — a `?` in the IFC viewer is a clearly-visible signal
    that a string needs review.
    """
    if isinstance(value, str):
        out = value
        for unicode_ch, ascii_repl in _ASCII_FALLBACKS.items():
            if unicode_ch in out:
                out = out.replace(unicode_ch, ascii_repl)
        return out.encode("ascii", errors="replace").decode("ascii")
    if isinstance(value, list):
        return [_ascii_safe(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_ascii_safe(v) for v in value)
    if isinstance(value, dict):
        return {k: _ascii_safe(v) for k, v in value.items()}
    return value


# ── Schema constraints ───────────────────────────────────────────────
#
# These are the IFC2X3-correct allow-lists. Setting a PredefinedType
# on an entity NOT in the slotted list crashes web-ifc; setting an
# invalid CompositionType on IfcBuildingElementProxy crashes earlier.

# IFC2X3 entities that DO have a PredefinedType attribute slot.
# Reference: IFC2X3 Coordination View 2.0 schema spec.
_IFC2X3_HAS_PREDEFINED_TYPE = frozenset({
    "IfcSlab",
    "IfcRoof",
    "IfcCovering",
    "IfcRailing",
    "IfcStair",
    "IfcStairFlight",
    "IfcRamp",
    "IfcRampFlight",
    "IfcDoor",       # PredefinedType in 2X3 is on IfcDoorStyle, not IfcDoor
                     # — keep IfcDoor in this set anyway so the helper
                     # explicitly skips passing it.
    "IfcBuildingElementProxy",
})

# `IfcBuildingElementProxy.CompositionType` — exactly these three.
# `.NOTDEFINED.` is INVALID for this attribute in 2X3 (it IS valid for
# many other enum attributes, which is why this bug fooled the v2 agent).
_VALID_PROXY_COMPOSITION = frozenset({"COMPLEX", "ELEMENT", "PARTIAL"})

# Accepted PredefinedType values per slotted class. Anything outside →
# we omit the predefined-type assignment (the entity is still valid;
# defaults to NOTDEFINED where the schema allows it).
_PREDEFINED_TYPE_ENUMS: Dict[str, frozenset] = {
    "IfcSlab": frozenset({"FLOOR", "ROOF", "LANDING", "BASESLAB", "USERDEFINED", "NOTDEFINED"}),
    "IfcRoof": frozenset({
        "FLAT_ROOF", "SHED_ROOF", "GABLE_ROOF", "HIP_ROOF", "HIPPED_GABLE_ROOF",
        "GAMBREL_ROOF", "MANSARD_ROOF", "BARREL_ROOF", "RAINBOW_ROOF",
        "BUTTERFLY_ROOF", "PAVILION_ROOF", "DOME_ROOF", "FREEFORM",
        "USERDEFINED", "NOTDEFINED",
    }),
    "IfcCovering": frozenset({
        "CEILING", "FLOORING", "CLADDING", "ROOFING", "MOLDING",
        "SKIRTINGBOARD", "INSULATION", "MEMBRANE", "SLEEVING",
        "WRAPPING", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcRailing": frozenset({
        "HANDRAIL", "GUARDRAIL", "BALUSTRADE", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcStair": frozenset({
        "STRAIGHT_RUN_STAIR", "TWO_STRAIGHT_RUN_STAIR", "QUARTER_WINDING_STAIR",
        "QUARTER_TURN_STAIR", "HALF_WINDING_STAIR", "HALF_TURN_STAIR",
        "TWO_QUARTER_WINDING_STAIR", "TWO_QUARTER_TURN_STAIR",
        "THREE_QUARTER_WINDING_STAIR", "THREE_QUARTER_TURN_STAIR",
        "SPIRAL_STAIR", "DOUBLE_RETURN_STAIR", "CURVED_RUN_STAIR",
        "TWO_CURVED_RUN_STAIR", "USERDEFINED", "NOTDEFINED",
    }),
    # IfcBuildingElementProxy has CompositionType *instead of* PredefinedType
    # in 2X3, so it goes through a separate code path.
    "IfcBuildingElementProxy": frozenset({"COMPLEX", "ELEMENT", "PARTIAL"}),
}


# ── Phase δ.0 — BuildTelemetry caps and defaults ──────────────────────
#
# Per-build counters and fallback-event arrays mirror the TS-side
# `BuildTelemetryCollector` (see src/features/brief-to-ifc/v3/telemetry.ts).
# The cap stops a pathological build from bloating the FinalizeResponse
# or meta.json payload past the JSON practical limits — counts in
# `built_element_counts` remain authoritative even when events cap out.

_TELEMETRY_MAX_EVENTS = 200


def _empty_telemetry() -> Dict[str, Any]:
    """Fresh telemetry shape. Mirrors the TS-side `SandboxFinalizeTelemetry`
    interface so the merge on the TypeScript side is field-for-field."""
    return {
        "proxy_fallbacks": [],
        "material_misses": [],
        "dropped_elements": [],
        "built_element_counts": {},
    }


class BuildFlowIFCError(Exception):
    """Raised for schema-strictness violations caught at the helper API.

    Caller-side message — safe to surface to the agent loop as a tool
    error so the next turn can fix the call.
    """


# ── The helper ────────────────────────────────────────────────────────


class BuildFlowIFC:
    """Stateful IFC2X3 builder bound to a single session.

    Usage from the agent loop::

        bf = BuildFlowIFC(brief)
        for sp in brief["spaces"]:
            bf.add_space(sp["id"], sp["polygon_world_m"], sp["height_m"],
                         long_name=sp["long_name"], occupancy=sp["occupancy_type"])
        for el in brief["elements"]:
            getattr(bf, f"add_{el['type']}")(...)
        bf.write("/tmp/out.ifc")

    Methods return the created `ifcopenshell` entity so the agent can
    capture references for `attach_pset` etc.
    """

    SCHEMA = "IFC4"  # Default for new builds; "IFC2X3" still supported as fallback

    def __init__(self, brief: Dict[str, Any], schema: str = "IFC4") -> None:
        if schema not in ("IFC4", "IFC2X3"):
            raise BuildFlowIFCError(
                f"Unsupported schema {schema!r}; must be 'IFC4' or 'IFC2X3'."
            )
        self.SCHEMA = schema
        self._brief: Dict[str, Any] = _ascii_safe(dict(brief))
        self._ifc = ifcopenshell.file(schema=self.SCHEMA)
        self._elements_by_id: Dict[str, Any] = {}
        self._materials_by_id: Dict[str, Any] = {}
        self._material_styles: Dict[str, Any] = {}
        self._spaces_by_id: Dict[str, Any] = {}
        self._storeys_by_id: Dict[str, Any] = {}

        # Phase δ.0 — BuildTelemetry. Per-build structured record of
        # silent fallbacks the agent code triggered. Every recorder is
        # wrapped in try/except so telemetry collection NEVER aborts
        # the build (instrumentation that breaks the thing it observes
        # is worse than no instrumentation).
        self._telemetry: Dict[str, Any] = _empty_telemetry()

        self._bootstrap_project()
        self._bootstrap_materials()

    # ── Phase δ.0 — telemetry recorders ──────────────────────────────

    def _record_proxy_fallback(
        self,
        requested_type: str,
        ifc_class: str,
        element_id: Optional[str] = None,
        reason: str = "agent_chose_proxy",
    ) -> None:
        """Record that the agent fell back to IfcBuildingElementProxy
        (or a generic class) for an element type we cannot type properly.
        Safe to call from any add_* helper — never raises."""
        try:
            evs = self._telemetry.setdefault("proxy_fallbacks", [])
            if len(evs) >= _TELEMETRY_MAX_EVENTS:
                return
            evs.append({
                "requested_type": str(requested_type or "unknown")[:120],
                "ifc_class": str(ifc_class or "IfcBuildingElementProxy")[:64],
                "element_id": str(element_id)[:120] if element_id else None,
                "reason": str(reason or "unspecified")[:120],
            })
        except Exception:
            # Swallow — telemetry never crashes the build.
            pass

    def _record_material_miss(
        self,
        element_id: Optional[str],
        requested_material_id: str,
        fallback_material_id: str,
    ) -> None:
        """Record that an element referenced a material id absent from
        the catalog and silently fell back to another material. Safe
        to call from any add_* helper — never raises."""
        try:
            evs = self._telemetry.setdefault("material_misses", [])
            if len(evs) >= _TELEMETRY_MAX_EVENTS:
                return
            evs.append({
                "element_id": str(element_id)[:120] if element_id else None,
                "requested_material_id": str(requested_material_id or "")[:120],
                "fallback_material_id": str(fallback_material_id or "")[:120],
            })
        except Exception:
            pass

    def _record_dropped_element(
        self,
        type_: str,
        element_id: Optional[str],
        reason: str,
    ) -> None:
        """Record that an element produced no IFC geometry (validation
        failure pre-creation, missing required dim, etc.). Safe — never
        raises."""
        try:
            evs = self._telemetry.setdefault("dropped_elements", [])
            if len(evs) >= _TELEMETRY_MAX_EVENTS:
                return
            evs.append({
                "type": str(type_ or "unknown")[:64],
                "element_id": str(element_id)[:120] if element_id else None,
                "reason": str(reason or "unspecified")[:200],
            })
        except Exception:
            pass

    def _record_built_class(self, ifc_class: str) -> None:
        """Increment the count of built elements per IFC class. Safe."""
        try:
            counts = self._telemetry.setdefault("built_element_counts", {})
            key = str(ifc_class or "Unknown")[:64]
            counts[key] = int(counts.get(key, 0)) + 1
        except Exception:
            pass

    def get_telemetry(self) -> Dict[str, Any]:
        """Return a deep-copied snapshot of the build telemetry. The
        sandbox finalize endpoint surfaces this to the TS caller, which
        merges it into BuildTelemetry.snapshot. Safe — always returns
        a dict (empty on internal error)."""
        try:
            return {
                "proxy_fallbacks": list(self._telemetry.get("proxy_fallbacks", [])),
                "material_misses": list(self._telemetry.get("material_misses", [])),
                "dropped_elements": list(self._telemetry.get("dropped_elements", [])),
                "built_element_counts": dict(self._telemetry.get("built_element_counts", {})),
            }
        except Exception:
            return _empty_telemetry()

    # ── bootstrap ─────────────────────────────────────────────────────

    def _bootstrap_project(self) -> None:
        api = ifcopenshell.api
        proj_meta = self._brief.get("project", {})
        site_meta = self._brief.get("site", {})

        # IFC2X3 strictness — `root.create_entity` synthesises an
        # IfcOwnerHistory which needs BOTH an IfcPersonAndOrganization
        # AND an IfcApplication in the file. In IFC4 ifcopenshell may
        # auto-create them in some versions, but we pre-populate both
        # unconditionally so the first `root.create_entity` succeeds
        # regardless of schema.
        #
        # NOTE the British spelling — ifcopenshell uses `add_organisation`
        # / `add_person_and_organisation` (matching the IFC schema entity
        # names like `IfcOrganization` but the *usecase* file names use
        # the British 's' form). Calling the American spelling silently
        # raises `ModuleNotFoundError` from the usecase loader.
        person = api.run(
            "owner.add_person", self._ifc,
            identification="bf-v3-generator",
            family_name="BuildFlow",
            given_name="Generator",
        )
        organisation = api.run(
            "owner.add_organisation", self._ifc,
            identification="buildflow", name="BuildFlow",
        )
        api.run(
            "owner.add_person_and_organisation", self._ifc,
            person=person, organisation=organisation,
        )
        api.run(
            "owner.add_application", self._ifc,
            application_developer=organisation,
            version="3.0", application_full_name="BuildFlow Generator v3",
            application_identifier="buildflow-v3",
        )

        project = api.run(
            "root.create_entity",
            self._ifc,
            ifc_class="IfcProject",
            name=str(proj_meta.get("name", "BuildFlow Project")),
        )

        # Units — explicit METRE / SQUARE_METRE / CUBIC_METRE.
        #
        # IMPORTANT: `ifcopenshell.api.unit.assign_unit(file)` without a
        # `units=` kwarg silently defaults to LENGTHUNIT = MILLI.METRE
        # (Revit/BIM-tool convention), per the upstream docstring:
        # "you may specify without any arguments to automatically create
        # millimeters, square meters, and cubic meters as a convenience
        # for testing purposes". Our BriefSpec is metre-valued, so
        # accepting the default silently rescales every coordinate by
        # 1/1000 — a 4m wall renders as 4mm. Forensic root cause for
        # the visual-collapse bug shipped on 2026-05-16. See
        # forensics/diagnosis.md for the evidence trail.
        length_unit = api.run("unit.add_si_unit", self._ifc, unit_type="LENGTHUNIT")
        area_unit = api.run("unit.add_si_unit", self._ifc, unit_type="AREAUNIT")
        volume_unit = api.run("unit.add_si_unit", self._ifc, unit_type="VOLUMEUNIT")
        api.run(
            "unit.assign_unit", self._ifc,
            units=[length_unit, area_unit, volume_unit],
        )

        # Contexts — Model / Body subcontext (web-ifc requires this).
        ctx = api.run("context.add_context", self._ifc, context_type="Model")
        body_ctx = api.run(
            "context.add_context",
            self._ifc,
            context_type="Model",
            context_identifier="Body",
            target_view="MODEL_VIEW",
            parent=ctx,
        )

        # Spatial hierarchy — Site → Building → Storey.
        site = api.run(
            "root.create_entity", self._ifc,
            ifc_class="IfcSite",
            name=str(site_meta.get("name", proj_meta.get("location", "Site"))),
        )
        building = api.run(
            "root.create_entity", self._ifc,
            ifc_class="IfcBuilding",
            name=str(proj_meta.get("name", "BuildFlow Building")),
        )
        storey = api.run(
            "root.create_entity", self._ifc,
            ifc_class="IfcBuildingStorey",
            name="Ground Floor",
        )

        api.run("aggregate.assign_object", self._ifc,
                products=[site], relating_object=project)
        api.run("aggregate.assign_object", self._ifc,
                products=[building], relating_object=site)
        api.run("aggregate.assign_object", self._ifc,
                products=[storey], relating_object=building)

        # `root.create_entity` doesn't auto-create ObjectPlacement on
        # spatial structure entities — `geometry.edit_object_placement`
        # does. Without these, `validate()` reports every spatial element
        # missing placement and refs_resolve flips to False.
        api.run("geometry.edit_object_placement", self._ifc, product=site)
        api.run("geometry.edit_object_placement", self._ifc, product=building)
        api.run("geometry.edit_object_placement", self._ifc, product=storey)

        self._project = project
        self._site = site
        self._building = building
        self._storey = storey
        self._model_ctx = ctx
        self._body_ctx = body_ctx

    def _bootstrap_materials(self) -> None:
        """Register every material from `brief["materials"]` with a coloured
        surface style so viewers render the model as the spec intended."""
        api = ifcopenshell.api
        materials = self._brief.get("materials") or []

        for m in materials:
            mat_id = str(m.get("id"))
            if not mat_id or mat_id in self._materials_by_id:
                continue
            name = str(m.get("name", mat_id))
            # `IfcMaterial.Category` is IFC4-only — passing `category` to
            # `material.add_material` on a 2X3 file raises an AttributeError
            # mid-execute. The helper hides this: we silently drop `category`
            # in 2X3 (the spec data lives in the brief JSON; the IFC carries
            # only what the schema allows).
            kwargs = {"name": name}
            if self.SCHEMA != "IFC2X3":
                kwargs["category"] = str(m.get("category", ""))
            material = api.run("material.add_material", self._ifc, **kwargs)
            self._materials_by_id[mat_id] = material

            rgb = m.get("rgb") or [0.7, 0.7, 0.7]
            r, g, b = (float(rgb[0]), float(rgb[1]), float(rgb[2]))
            try:
                style = api.run(
                    "style.add_style", self._ifc, name=name + " Style",
                )
                api.run(
                    "style.add_surface_style", self._ifc,
                    style=style,
                    ifc_class="IfcSurfaceStyleShading",
                    attributes={
                        "SurfaceColour": {
                            "Name": name + " Colour",
                            "Red": r, "Green": g, "Blue": b,
                        },
                    },
                )
                api.run(
                    "style.assign_material_style", self._ifc,
                    material=material, style=style, context=self._body_ctx,
                )
                self._material_styles[mat_id] = style
            except Exception:
                # Surface-style assignment is non-critical — a coloured
                # material is nice but a missing one is not a generation
                # failure. Skip silently so the rest of the model still
                # writes.
                pass

    # ── storeys ───────────────────────────────────────────────────────

    def add_storey(
        self,
        storey_id: str,
        name: str,
        elevation: float,
    ) -> Any:
        """Create an additional IfcBuildingStorey at the given elevation.

        The bootstrap creates "Ground Floor" at 0.0 — call this for each
        additional floor. Elements assigned to a storey via `storey_id`
        parameter on `add_*` methods are contained in that storey's
        IfcRelContainedInSpatialStructure.

        `elevation` is in metres (e.g. 3.1 for the first floor of a
        building with 3.1m floor-to-floor height).
        """
        storey_id = str(_ascii_safe(storey_id))
        name = str(_ascii_safe(name))
        if storey_id in self._storeys_by_id:
            return self._storeys_by_id[storey_id]

        api = ifcopenshell.api
        storey = api.run(
            "root.create_entity", self._ifc,
            ifc_class="IfcBuildingStorey",
            name=name,
        )
        try:
            storey.Elevation = float(elevation)
        except (AttributeError, RuntimeError):
            pass

        # Aggregate under the building
        api.run(
            "aggregate.assign_object", self._ifc,
            products=[storey], relating_object=self._building,
        )
        # Create placement at the elevation
        api.run(
            "geometry.edit_object_placement", self._ifc,
            product=storey,
        )
        # Move placement to the correct elevation
        loc = self._ifc.create_entity(
            "IfcCartesianPoint", Coordinates=(0.0, 0.0, float(elevation)),
        )
        placement_axis = self._ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=loc, Axis=None, RefDirection=None,
        )
        storey.ObjectPlacement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=self._building.ObjectPlacement,
            RelativePlacement=placement_axis,
        )

        self._storeys_by_id[storey_id] = storey
        return storey

    # ── spaces ────────────────────────────────────────────────────────

    def add_space(
        self,
        space_id: str,
        polygon: List[Tuple[float, float]],
        height: float,
        long_name: str = "",
        occupancy: str = "Internal",
    ) -> Any:
        """Create an `IfcSpace` from a 2D polygon footprint extruded `height` metres."""
        space_id = str(_ascii_safe(space_id))
        long_name = str(_ascii_safe(long_name))
        occupancy = str(_ascii_safe(occupancy))
        if not polygon or len(polygon) < 3:
            raise BuildFlowIFCError(
                f"add_space({space_id!r}): polygon must have >= 3 points, "
                f"got {len(polygon) if polygon else 0}"
            )

        api = ifcopenshell.api
        space = api.run(
            "root.create_entity", self._ifc,
            ifc_class="IfcSpace", name=space_id,
        )
        space.LongName = long_name or space_id
        space.ObjectType = occupancy
        # IFC4 has Tag on IfcSpace (via IfcElement inheritance chain);
        # IFC2X3 does not. Set it when available; Name is the primary
        # id surface regardless.
        if self.SCHEMA != "IFC2X3":
            try:
                space.Tag = space_id
            except (AttributeError, RuntimeError):
                pass
        try:
            space.CompositionType = "ELEMENT"
        except AttributeError:
            pass

        self._attach_geometry_extruded_polygon(space, polygon, height)
        self._contain_in_storey(space)
        self._spaces_by_id[space_id] = space
        return space

    def add_circular_space(
        self,
        space_id: str,
        centre: Tuple[float, float],
        radius: float,
        height: float,
        long_name: str = "",
        occupancy: str = "Internal",
        segments: int = 32,
    ) -> Any:
        """Convenience for circular spaces — approximates a circle with
        `segments` polygon points centred on `centre`."""
        cx, cy = float(centre[0]), float(centre[1])
        polygon = [
            (cx + radius * math.cos(2 * math.pi * i / segments),
             cy + radius * math.sin(2 * math.pi * i / segments))
            for i in range(segments)
        ]
        return self.add_space(
            space_id, polygon, height,
            long_name=long_name, occupancy=occupancy,
        )

    # ── structural ────────────────────────────────────────────────────

    def add_slab(
        self,
        slab_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        predefined_type: str = "FLOOR",
        description: str = "",
        tag: str = "",
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcSlab` — DOES have PredefinedType in 2X3."""
        return self._add_box_element(
            ifc_class="IfcSlab",
            element_id=slab_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=predefined_type,
            description=description, tag=tag,
            storey_id=storey_id,
        )

    def add_wall(
        self,
        wall_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        rotation: float = 0.0,
        description: str = "",
        tag: str = "",
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcWall` — does NOT have PredefinedType in 2X3 (only IfcWallStandardCase
        does in 4+). We deliberately skip the predefined-type assignment."""
        return self._add_box_element(
            ifc_class="IfcWall",
            element_id=wall_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=None, rotation=rotation,
            description=description, tag=tag,
            storey_id=storey_id,
        )

    def add_column(
        self,
        col_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        description: str = "",
        tag: str = "",
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcColumn` — no PredefinedType slot in 2X3."""
        return self._add_box_element(
            ifc_class="IfcColumn",
            element_id=col_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=None,
            description=description, tag=tag,
            storey_id=storey_id,
        )

    def add_circular_column(
        self,
        col_id: str,
        origin: Tuple[float, float, float],
        radius: float,
        depth: float,
        material: str,
        description: str = "",
        tag: str = "",
        storey_id: Optional[str] = None,
    ) -> Any:
        """Round-section `IfcColumn` — circular profile extruded vertically."""
        return self._add_circle_element(
            ifc_class="IfcColumn",
            element_id=col_id, origin=origin, radius=radius, depth=depth,
            material=material, description=description, tag=tag,
            storey_id=storey_id,
        )

    def add_beam(
        self,
        beam_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        description: str = "",
        tag: str = "",
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcBeam` — no PredefinedType slot in 2X3."""
        return self._add_box_element(
            ifc_class="IfcBeam",
            element_id=beam_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=None,
            description=description, tag=tag,
            storey_id=storey_id,
        )

    # ── coverings ────────────────────────────────────────────────────

    def add_covering(
        self,
        cov_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        predefined_type: str = "FLOORING",
        description: str = "",
        tag: str = "",
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcCovering` — DOES have PredefinedType in 2X3."""
        return self._add_box_element(
            ifc_class="IfcCovering",
            element_id=cov_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=predefined_type,
            description=description, tag=tag,
            storey_id=storey_id,
        )

    # ── railings ─────────────────────────────────────────────────────

    def add_railing(
        self,
        railing_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        predefined_type: str = "GUARDRAIL",
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcRailing` — PredefinedType DOES exist in IFC2X3 and IFC4."""
        return self._add_box_element(
            ifc_class="IfcRailing",
            element_id=railing_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=predefined_type,
            description=description, tag=tag,
            contained_in_space_id=contained_in_space_id,
            storey_id=storey_id,
        )

    # ── Phase δ.4 — IfcStair (straight-run flight, multi-storey link) ──

    def add_stair(
        self,
        stair_id: str,
        origin: Tuple[float, float, float],
        total_rise: float,
        width: float = 1.0,
        run: Optional[float] = None,
        step_count: Optional[int] = None,
        material: str = "",
        predefined_type: str = "STRAIGHT_RUN_STAIR",
        rotation_z_rad: float = 0.0,
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Optional[Any]:
        """Build a straight-run stair connecting two floors.

        Phase δ.4 — replaces the prior `bf.add_proxy(object_type="stair")`
        fallback with real `IfcStair` + `IfcStairFlight` geometry. Multi-
        storey buildings now have a way to physically connect floors;
        downstream BIM tools that filter by IFC class (Revit import,
        IDS validation, schedule generation, clash detection) see the
        stair as a stair.

        Geometry:
          - `IfcStair` (the assembly) with PredefinedType set per the
            schema-aware allow-list (IFC2X3 + IFC4 differ; both supported).
          - One `IfcStairFlight` aggregated under the stair via
            `IfcRelAggregates`. PredefinedType="STRAIGHT" in IFC4.
          - The flight's geometry: `step_count` rectangular extrusions
            stacked into a staircase silhouette. Step i is a box of
            footprint `tread_depth × width` extruded upward to
            `(i+1) * riser_height`. The top of the last step lands at
            EXACTLY `origin[2] + total_rise` so the stair connects to
            the next storey's floor level (the acceptance invariant).

        Placement: storey-relative, following the canonical
        `_add_box_element` pattern (lines 2351-2371). The stair's local
        `(ox, oy, oz)` lives in the target storey's frame; with `oz=0`
        the bottom step sits at the storey floor, the top step lands at
        the next storey floor (the storey deltas come from
        `bf.add_storey(..., elevation)`). Avoids the γ.10 freestanding-
        slab trap by NEVER re-parenting after creation.

        Args:
          stair_id: unique element id (also used as IFC Tag).
          origin: storey-local (x, y, z) of the bottom-front-left corner
            of the first step. Pass z=0 to land on the storey's floor.
          total_rise: floor-to-floor height in metres. The top of the
            stair lands at exactly `origin[2] + total_rise` regardless of
            step count rounding.
          width: tread width (perpendicular to the run direction). Default
            1.0 m (standard residential).
          run: total horizontal run in metres. Auto-derived as
            `step_count * 0.28` when omitted.
          step_count: number of risers (and steps). Auto-derived from
            `total_rise` targeting ~0.17 m risers when omitted. Always
            >= 2.
          material: material id from the catalog. Falls back per γ.5 when
            not in the catalog (records a material_miss in δ.0 telemetry).
          predefined_type: IFC `IfcStair.PredefinedType`. Default
            `STRAIGHT_RUN_STAIR` — the only one this method physically
            implements; other values are stored on the entity but the
            geometry is always straight-run for δ.4.
          rotation_z_rad: rotation about Z. Default 0 → stair runs along
            +X. Pass `math.pi/2` to run along +Y, etc.
          contained_in_space_id: optionally route spatial containment to
            a specific IfcSpace (the stairwell) instead of the storey.
          storey_id: target storey id (defaults to ground). The stair's
            origin is in this storey's frame.

        Edge cases (graceful — never crash):
          - `total_rise <= 0` or `width <= 0`: records dropped_element
            telemetry with the reason and returns None. No IFC entity
            created.
          - `step_count` overridden too low (<2): clamped to 2.
          - `run` overridden too small (<0.1m total): clamped.
          - Non-even rise/step division: `riser_height = total_rise /
            step_count` is exact; the top of step N-1 lands at exactly
            `total_rise`, never overshoots.

        Returns the IfcStair entity (registered in `_elements_by_id` for
        save/load persistence and downstream reference), or None on
        graceful skip.
        """
        import math as _math
        import ifcopenshell.guid as _guid

        # ── Inputs: sanitise + validate ──
        stair_id = str(_ascii_safe(stair_id))
        material = str(_ascii_safe(material))
        description = str(_ascii_safe(description))
        tag = str(_ascii_safe(tag)) or stair_id

        if stair_id in self._elements_by_id:
            raise BuildFlowIFCError(
                f"add_stair({stair_id!r}): id already taken — "
                "every element id must be unique within the session."
            )

        # Edge case: missing / non-positive dims → graceful skip,
        # telemetered, no IFC entity created.
        try:
            total_rise_f = float(total_rise)
            width_f = float(width)
        except (TypeError, ValueError):
            self._record_dropped_element(
                type_="stair",
                element_id=stair_id,
                reason=f"non-numeric total_rise={total_rise!r} or width={width!r}",
            )
            return None
        if total_rise_f <= 0 or width_f <= 0:
            self._record_dropped_element(
                type_="stair",
                element_id=stair_id,
                reason=f"non-positive total_rise={total_rise_f} or width={width_f}",
            )
            return None

        # Auto-derive step_count targeting ~0.17 m risers, min 2. Caller
        # may override.
        if step_count is None:
            derived = max(2, int(round(total_rise_f / 0.17)))
        else:
            try:
                derived = max(2, int(step_count))
            except (TypeError, ValueError):
                derived = max(2, int(round(total_rise_f / 0.17)))
        n_steps = derived

        # Auto-derive run targeting ~0.28 m treads, min 0.1m per tread.
        if run is None:
            run_f = n_steps * 0.28
        else:
            try:
                run_f = float(run)
                if run_f < n_steps * 0.1:
                    run_f = n_steps * 0.1
            except (TypeError, ValueError):
                run_f = n_steps * 0.28

        # Exact riser + tread dimensions — top of step n-1 lands at EXACTLY
        # total_rise so the stair connects to the next storey's floor Z.
        riser_height = total_rise_f / n_steps
        tread_depth = run_f / n_steps

        ox, oy, oz = float(origin[0]), float(origin[1]), float(origin[2])

        api = ifcopenshell.api

        # ── 1. Create the IfcStair assembly entity ──
        stair = api.run("root.create_entity", self._ifc, ifc_class="IfcStair")
        stair.Name = stair_id
        stair.Tag = tag
        if description:
            stair.Description = description

        # Stair-type enum — schema-aware. IFC4 renamed the attribute:
        # IFC2X3.IfcStair.ShapeType → IFC4.IfcStair.PredefinedType
        # (same set of allowed values: STRAIGHT_RUN_STAIR etc.). The
        # _add_box_element discipline (lines 2269-2280) only handles
        # PredefinedType, which silently swallows on IFC2X3 stairs; for
        # add_stair we want the type SET on both schemas so downstream
        # tools (Solibri, IDS validation) read the stair shape
        # correctly. Match the right attribute name per schema.
        try:
            from .canonical_psets import IFC4_PREDEFINED_TYPES
            if self.SCHEMA == "IFC4":
                allowed = IFC4_PREDEFINED_TYPES.get("IfcStair")
                attr_name = "PredefinedType"
            else:
                allowed = _PREDEFINED_TYPE_ENUMS.get("IfcStair")
                attr_name = "ShapeType"
            requested = str(predefined_type).upper()
            if allowed and requested in allowed:
                try:
                    setattr(stair, attr_name, requested)
                except Exception:
                    pass
        except Exception:
            # Never let stair-type setting abort stair creation.
            pass

        # ── 2. Storey-parented placement (the canonical pattern) ──
        # Quoting the _add_box_element discipline (lines 2351-2371):
        # IfcLocalPlacement(PlacementRelTo=target_storey.ObjectPlacement,
        # RelativePlacement=IfcAxis2Placement3D(Location=(ox,oy,oz))).
        # This puts the stair's local origin at world Z =
        # storey.elevation + oz. With oz=0 → world Z = storey.elevation,
        # i.e. on the storey's floor. The top of the last step (at local
        # z = total_rise) lands at world Z = storey.elevation +
        # total_rise → the next storey's floor when total_rise equals
        # the storey delta. This is the connect-the-floors invariant.
        ref_dir = self._ifc.create_entity(
            "IfcDirection",
            DirectionRatios=(_math.cos(rotation_z_rad), _math.sin(rotation_z_rad), 0.0),
        )
        location = self._ifc.create_entity(
            "IfcCartesianPoint", Coordinates=(ox, oy, oz),
        )
        placement_axis = self._ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=location,
            Axis=self._ifc.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
            RefDirection=ref_dir,
        )
        target_storey = self._resolve_storey(storey_id)
        stair.ObjectPlacement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=target_storey.ObjectPlacement,
            RelativePlacement=placement_axis,
        )

        # ── 3. Build the IfcStairFlight + step geometry ──
        flight = api.run(
            "root.create_entity", self._ifc, ifc_class="IfcStairFlight",
        )
        flight.Name = f"{stair_id}-flight-1"
        flight.Tag = f"{stair_id}-flight-1"

        # IfcStairFlight schema-specific attributes:
        # - IFC2X3: NumberOfRiser, NumberOfTreads, RiserHeight, TreadLength
        # - IFC4:   NumberOfRisers (note plural), NumberOfTreads,
        #           RiserHeight, TreadLength, PredefinedType
        # Set defensively — older / newer ifcopenshell may name fields
        # slightly differently. Never let an attribute-set failure abort
        # the stair build.
        for attr_name, attr_val in (
            ("NumberOfRisers", n_steps),
            ("NumberOfRiser", n_steps),  # IFC2X3 singular
            ("NumberOfTreads", n_steps - 1),  # N risers => N-1 full treads
            ("RiserHeight", float(riser_height)),
            ("TreadLength", float(tread_depth)),
        ):
            try:
                if hasattr(flight, attr_name):
                    setattr(flight, attr_name, attr_val)
            except Exception:
                pass
        # Flight PredefinedType (IFC4 only — IFC2X3 IfcStairFlight has none).
        if self.SCHEMA == "IFC4":
            try:
                flight.PredefinedType = "STRAIGHT"
            except Exception:
                pass

        # Flight placement: stair-relative origin (0, 0, 0) so the flight
        # inherits the stair's storey-relative position. Same pattern as
        # γ.10's re-parenting BUT for assembly composition, not for an
        # opening-fill relationship.
        flight.ObjectPlacement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=stair.ObjectPlacement,
            RelativePlacement=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity(
                    "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0),
                ),
                Axis=None, RefDirection=None,
            ),
        )

        # ── 4. Build the step geometry — N stacked boxes ──
        # Each step i is a rectangular slab of footprint
        # (tread_depth × width) extruded upward by (i+1) * riser_height,
        # located at local (i * tread_depth, 0, 0). The result, viewed
        # from the side (X-Z plane), is a staircase silhouette: each
        # successive step rises one riser higher than the last. Top of
        # step n-1 reaches z = n * riser_height = total_rise (exactly).
        step_items: List[Any] = []
        for i in range(n_steps):
            step_x = i * tread_depth
            step_height = (i + 1) * riser_height
            # Rectangle profile, SW-corner convention (matches
            # _add_box_element's centering offset, lines 2299-2308).
            rect = self._ifc.create_entity(
                "IfcRectangleProfileDef",
                ProfileType="AREA",
                ProfileName=None,
                Position=self._ifc.create_entity(
                    "IfcAxis2Placement2D",
                    Location=self._ifc.create_entity(
                        "IfcCartesianPoint",
                        Coordinates=(tread_depth / 2.0, width_f / 2.0),
                    ),
                    RefDirection=None,
                ),
                XDim=tread_depth,
                YDim=width_f,
            )
            solid = self._ifc.create_entity(
                "IfcExtrudedAreaSolid",
                SweptArea=rect,
                Position=self._ifc.create_entity(
                    "IfcAxis2Placement3D",
                    Location=self._ifc.create_entity(
                        "IfcCartesianPoint",
                        Coordinates=(step_x, 0.0, 0.0),
                    ),
                    Axis=None, RefDirection=None,
                ),
                ExtrudedDirection=self._ifc.create_entity(
                    "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0),
                ),
                Depth=step_height,
            )
            step_items.append(solid)

        rep = self._ifc.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self._body_ctx,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=step_items,
        )
        flight.Representation = self._ifc.create_entity(
            "IfcProductDefinitionShape",
            Representations=[rep],
        )

        # ── 5. Aggregate the flight under the stair (IfcRelAggregates) ──
        # Real IFC stair semantics: IfcStair is the assembly, sub-parts
        # (flights, landings) are aggregated via IfcRelAggregates. This
        # also helps δ.2's structural signal pick the stair up as one
        # element rather than N loose solids.
        oh_list = self._ifc.by_type("IfcOwnerHistory")
        oh = oh_list[0] if oh_list else None
        self._ifc.create_entity(
            "IfcRelAggregates",
            GlobalId=_guid.new(),
            OwnerHistory=oh,
            Name=f"Aggregates {stair_id}",
            RelatingObject=stair,
            RelatedObjects=[flight],
        )

        # ── 6. Spatial containment (storey OR space) ──
        if contained_in_space_id and contained_in_space_id in self._spaces_by_id:
            self._contain_in_space(stair, contained_in_space_id)
        else:
            self._contain_in_storey(stair, target_storey)

        # ── 7. Material assignment (γ.5 discipline) ──
        # Stairs in residential are typically concrete; the catalog's
        # fallback material is fine if the agent doesn't name one. Apply
        # to both the assembly and the flight so renders pick up colour.
        resolved_mat_id = (
            material if material in self._materials_by_id else self._fallback_material_id()
        )
        if material and resolved_mat_id and material != resolved_mat_id:
            self._record_material_miss(
                element_id=stair_id,
                requested_material_id=material,
                fallback_material_id=resolved_mat_id,
            )
        if resolved_mat_id and resolved_mat_id in self._materials_by_id:
            mat_entity = self._materials_by_id[resolved_mat_id]
            try:
                api.run(
                    "material.assign_material", self._ifc,
                    products=[stair, flight], material=mat_entity,
                )
            except Exception:
                # Non-critical — colour-only. The stair geometry still
                # exists; downstream tools will render in default colour.
                pass
            # Per-solid IfcStyledItem so web-ifc renders colours. The
            # canonical helper walks the flight's Representation Items
            # and styles each IfcExtrudedAreaSolid — covering every step
            # in one call.
            try:
                self._style_solid_internal(flight, resolved_mat_id)
            except Exception:
                pass

        # ── 8. Register + telemeter as BUILT (not proxy fallback) ──
        # The whole point of δ.4: stairs move OUT of proxyFallbacks and
        # INTO built_element_counts. After this ships, telemetry should
        # show IfcStair counts climbing on multi-storey briefs.
        self._elements_by_id[stair_id] = stair
        self._record_built_class("IfcStair")
        self._record_built_class("IfcStairFlight")
        return stair

    # ── Phase ε.1 — roof / balcony / parapet (kill the last proxies) ──
    #
    # The benchmark residential brief asks for "flat RCC roof",
    # "projecting balcony", "parapet". Pre-ε.1 all three fell through
    # to `add_proxy(object_type=...)` because no typed builders
    # existed — δ.0 telemetry was recording the proxy_fallback events
    # explicitly so we'd know to build these next. ε.1 closes the gap.
    # Each follows the SAME storey-placement discipline as δ.4's
    # add_stair (line 2351-2371 pattern from _add_box_element); none
    # re-parent after creation (the γ.10 freestanding-slab trap).

    def add_balcony(
        self,
        balcony_id: str,
        origin: Tuple[float, float, float],
        length: float,
        projection: float,
        thickness: float = 0.15,
        material: str = "",
        rotation_z_rad: float = 0.0,
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Optional[Any]:
        """A projecting balcony slab — `IfcSlab` with
        `PredefinedType=USERDEFINED` and `ObjectType="Balcony"`.

        IFC has no dedicated IfcBalcony class. The standard convention
        is IfcSlab + USERDEFINED PredefinedType + ObjectType discriminator;
        downstream BIM tools filter for "slabs with ObjectType=Balcony"
        when generating balcony schedules. The previous fallback —
        `add_proxy(object_type="balcony")` — created an
        IfcBuildingElementProxy that those tools entirely miss.

        Args:
          origin: storey-local SW corner of the balcony where it MEETS
            the host wall (the building edge). The balcony extends
            outward (along the rotation_z_rad direction's +Y axis local
            to the rotation) by `projection`.
          length: along-the-host-wall dimension in metres (the balcony's
            visible width from outside the building).
          projection: outward cantilever distance in metres.
          thickness: slab thickness, default 0.15 m (residential RCC).
          rotation_z_rad: orientation of the balcony's local axes; 0 →
            balcony length is +X, projection is +Y. Use π/2 to rotate.

        Edge cases (graceful — never crash):
          - length or projection <= 0 → dropped_element + None
          - thickness <= 0 → coerced to 0.05 m
          - duplicate id → BuildFlowIFCError

        Returns the IfcSlab entity (registered in `_elements_by_id`)
        or None on graceful skip.
        """
        try:
            length_f = float(length)
            projection_f = float(projection)
        except (TypeError, ValueError):
            self._record_dropped_element(
                type_="balcony",
                element_id=balcony_id,
                reason=f"non-numeric length={length!r} or projection={projection!r}",
            )
            return None
        if length_f <= 0 or projection_f <= 0:
            self._record_dropped_element(
                type_="balcony",
                element_id=balcony_id,
                reason=f"non-positive length={length_f} or projection={projection_f}",
            )
            return None
        thickness_f = max(0.05, float(thickness) if thickness else 0.15)

        # The balcony is structurally just a USERDEFINED IfcSlab — wrap
        # _add_box_element exactly as add_railing wraps it (γ.8
        # discipline). The ObjectType="Balcony" carries the semantic
        # discriminator that downstream tools filter on.
        return self._add_box_element(
            ifc_class="IfcSlab",
            element_id=balcony_id,
            origin=origin,
            dims=(length_f, projection_f),
            depth=thickness_f,
            material=material,
            predefined_type="USERDEFINED",
            rotation=rotation_z_rad,
            object_type="Balcony",
            description=description or "Projecting balcony slab",
            tag=tag,
            contained_in_space_id=contained_in_space_id,
            storey_id=storey_id,
        )

    def add_canopy(
        self,
        canopy_id: str,
        origin: Tuple[float, float, float],
        length: float,
        projection: float,
        thickness: float = 0.1,
        material: str = "",
        rotation_z_rad: float = 0.0,
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Optional[Any]:
        """An overhead canopy / awning — `IfcSlab` with
        `PredefinedType=USERDEFINED` and `ObjectType="Canopy"`.

        Phase ε.5 (forensic-audit FIX 3) — closes the silent proxy
        gap left after ε.1. The element-type enum already accepts
        `"canopy"` (with `awning` / `overhang` synonyms via δ.1b);
        without this method the agent fell back to `add_proxy` and
        the canopy became a geometry-less IfcBuildingElementProxy.

        IFC4 has `IfcShadingDevice(PredefinedType=AWNING)` which is
        the semantically-strictest representation, BUT IFC2X3 has no
        such class. The IfcSlab + ObjectType convention works in BOTH
        schemas and matches the discipline already used by
        `add_balcony` (no IfcBalcony class either — same situation).
        Downstream tools that filter `IfcSlab.ObjectType="Canopy"`
        pick it up cleanly. Future enhancement could route to
        IfcShadingDevice when SCHEMA="IFC4"; not in ε.5 scope.

        Args:
          origin: storey-local SW corner of the canopy where it MEETS
            the host wall (typically high on the wall — caller passes
            oz = lintel_z or roof_overhang_z). The canopy extends
            outward (along the rotation_z_rad direction's +Y axis local
            to the rotation) by `projection`.
          length: along-the-host-wall dimension in metres.
          projection: outward cantilever distance in metres.
          thickness: slab thickness, default 0.1 m (canopies are
            typically thinner than balconies — they don't bear human
            load).
          rotation_z_rad: orientation; 0 → length is +X, projection +Y.

        Edge cases (graceful — never crash):
          - length or projection <= 0 → dropped_element + None
          - thickness <= 0 → coerced to 0.03 m minimum
          - duplicate id → BuildFlowIFCError
        """
        try:
            length_f = float(length)
            projection_f = float(projection)
        except (TypeError, ValueError):
            self._record_dropped_element(
                type_="canopy",
                element_id=canopy_id,
                reason=f"non-numeric length={length!r} or projection={projection!r}",
            )
            return None
        if length_f <= 0 or projection_f <= 0:
            self._record_dropped_element(
                type_="canopy",
                element_id=canopy_id,
                reason=f"non-positive length={length_f} or projection={projection_f}",
            )
            return None
        thickness_f = max(0.03, float(thickness) if thickness else 0.1)

        # Wrap _add_box_element exactly as add_balcony does (γ.8
        # discipline) — same storey-placement, same material handling,
        # same telemetry, same persistence. The ObjectType="Canopy"
        # discriminator distinguishes it from balcony at the IfcSlab
        # level for downstream filtering.
        return self._add_box_element(
            ifc_class="IfcSlab",
            element_id=canopy_id,
            origin=origin,
            dims=(length_f, projection_f),
            depth=thickness_f,
            material=material,
            predefined_type="USERDEFINED",
            rotation=rotation_z_rad,
            object_type="Canopy",
            description=description or "Overhead canopy",
            tag=tag,
            contained_in_space_id=contained_in_space_id,
            storey_id=storey_id,
        )

    def add_parapet(
        self,
        parapet_id: str,
        origin: Tuple[float, float, float],
        length: float,
        height: float = 1.0,
        thickness: float = 0.1,
        material: str = "",
        rotation_z_rad: float = 0.0,
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Optional[Any]:
        """A low perimeter wall around a roof edge — `IfcWall` with
        `PredefinedType=PARAPET` in IFC4 (the predefined-type slot does
        not exist on IfcWall in IFC2X3; the helper sets ObjectType
        instead for that schema so downstream tools still see the
        semantic discriminator).

        Args:
          origin: storey-local SW corner of the parapet wall, at the
            roof level (caller passes oz = roof_top_z so the parapet
            sits ON the roof).
          length: along-the-roof-edge dimension in metres.
          height: vertical height above the roof, default 1.0 m
            (residential safety / IBC minimum is ~1.07 m).
          thickness: wall thickness, default 0.1 m.

        Edge cases (graceful — never crash):
          - length or height <= 0 → dropped_element + None
          - thickness <= 0 → coerced to 0.05 m
          - duplicate id → BuildFlowIFCError
        """
        try:
            length_f = float(length)
            height_f = float(height)
        except (TypeError, ValueError):
            self._record_dropped_element(
                type_="parapet",
                element_id=parapet_id,
                reason=f"non-numeric length={length!r} or height={height!r}",
            )
            return None
        if length_f <= 0 or height_f <= 0:
            self._record_dropped_element(
                type_="parapet",
                element_id=parapet_id,
                reason=f"non-positive length={length_f} or height={height_f}",
            )
            return None
        thickness_f = max(0.05, float(thickness) if thickness else 0.1)

        element = self._add_box_element(
            ifc_class="IfcWall",
            element_id=parapet_id,
            origin=origin,
            dims=(length_f, thickness_f),
            depth=height_f,
            material=material,
            # PARAPET is a valid PredefinedType on IFC4 IfcWall
            # (canonical_psets.py:142). On IFC2X3 IfcWall has no
            # PredefinedType — _add_box_element's schema-aware
            # allow-list silently skips, the ObjectType below carries
            # the semantic discriminator instead.
            predefined_type="PARAPET",
            rotation=rotation_z_rad,
            object_type="Parapet",
            description=description or "Roof perimeter parapet",
            tag=tag,
            contained_in_space_id=contained_in_space_id,
            storey_id=storey_id,
        )
        return element

    def add_roof(
        self,
        roof_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        thickness: float = 0.15,
        material: str = "",
        predefined_type: str = "FLAT_ROOF",
        rotation_z_rad: float = 0.0,
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Optional[Any]:
        """A roof over the top storey — `IfcRoof` (the assembly) +
        `IfcSlab` (the geometry) aggregated via `IfcRelAggregates`.

        Follows the same pattern as δ.4's add_stair: the IfcRoof is the
        building-element-level assembly that BIM tools treat as the
        roof, and the IfcSlab carries the actual geometry. Multiple
        slabs CAN be aggregated for pitched / multi-section roofs;
        ε.1's scope is flat single-slab (covers the benchmark
        residential RCC roof — pitched and gabled are future, the data
        trigger will be telemetry showing the agent calling add_proxy
        with predefined_type="GABLE_ROOF" / etc.).

        Args:
          origin: storey-local SW corner of the roof slab. Pass oz =
            ceiling_height so the slab sits ON TOP of the top storey's
            ceiling (or 0 if storey_id is the top storey and the agent
            wants the roof in the storey's own frame).
          dims: (width, depth) — the building footprint in metres.
          thickness: roof slab thickness, default 0.15 m (RCC).
          predefined_type: `IfcRoof.PredefinedType` (IFC4) or `.ShapeType`
            (IFC2X3, attribute renamed — same δ.4 stair lesson).
            FLAT_ROOF is the only one ε.1 produces geometry for.
          storey_id: target storey id (defaults to ground). For a
            multi-storey building the caller should pass the TOP storey
            id, with oz = floor-to-floor height so the roof sits on top.

        Edge cases (graceful — never crash):
          - dims (w, d) any <=0 → dropped_element + None
          - thickness <= 0 → coerced to 0.05 m
          - duplicate id → BuildFlowIFCError

        Returns the IfcRoof entity (registered in `_elements_by_id` for
        save/load + downstream addressing), or None on graceful skip.
        """
        import math as _math
        import ifcopenshell.guid as _guid

        roof_id = str(_ascii_safe(roof_id))
        material = str(_ascii_safe(material))
        description = str(_ascii_safe(description))
        tag = str(_ascii_safe(tag)) or roof_id

        if roof_id in self._elements_by_id:
            raise BuildFlowIFCError(
                f"add_roof({roof_id!r}): id already taken — "
                "every element id must be unique within the session."
            )

        try:
            dx, dy = float(dims[0]), float(dims[1])
        except (TypeError, ValueError, IndexError):
            self._record_dropped_element(
                type_="roof",
                element_id=roof_id,
                reason=f"non-numeric dims={dims!r}",
            )
            return None
        if dx <= 0 or dy <= 0:
            self._record_dropped_element(
                type_="roof",
                element_id=roof_id,
                reason=f"non-positive dims=({dx}, {dy})",
            )
            return None
        thickness_f = max(0.05, float(thickness) if thickness else 0.15)
        ox, oy, oz = float(origin[0]), float(origin[1]), float(origin[2])

        api = ifcopenshell.api

        # ── 1. IfcRoof assembly ──
        roof = api.run("root.create_entity", self._ifc, ifc_class="IfcRoof")
        roof.Name = roof_id
        roof.Tag = tag
        if description:
            roof.Description = description

        # IFC2X3 → ShapeType; IFC4 → PredefinedType (same δ.4 stair
        # discipline). The IFC4 enum lives in canonical_psets.py
        # (added in ε.1); IFC2X3 in _PREDEFINED_TYPE_ENUMS at the top
        # of this file.
        try:
            from .canonical_psets import IFC4_PREDEFINED_TYPES
            if self.SCHEMA == "IFC4":
                allowed = IFC4_PREDEFINED_TYPES.get("IfcRoof")
                attr_name = "PredefinedType"
            else:
                allowed = _PREDEFINED_TYPE_ENUMS.get("IfcRoof")
                attr_name = "ShapeType"
            requested = str(predefined_type).upper()
            if allowed and requested in allowed:
                try:
                    setattr(roof, attr_name, requested)
                except Exception:
                    pass
        except Exception:
            pass

        # ── 2. Storey-parented placement (canonical pattern) ──
        ref_dir = self._ifc.create_entity(
            "IfcDirection",
            DirectionRatios=(_math.cos(rotation_z_rad), _math.sin(rotation_z_rad), 0.0),
        )
        location = self._ifc.create_entity(
            "IfcCartesianPoint", Coordinates=(ox, oy, oz),
        )
        placement_axis = self._ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=location,
            Axis=self._ifc.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
            RefDirection=ref_dir,
        )
        target_storey = self._resolve_storey(storey_id)
        roof.ObjectPlacement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=target_storey.ObjectPlacement,
            RelativePlacement=placement_axis,
        )

        # ── 3. The roof slab (IfcSlab PredefinedType=ROOF) ──
        slab = api.run("root.create_entity", self._ifc, ifc_class="IfcSlab")
        slab.Name = f"{roof_id}-slab"
        slab.Tag = f"{roof_id}-slab"
        try:
            slab.PredefinedType = "ROOF"
        except Exception:
            pass

        # Slab placement: roof-relative (0,0,0) so geometry coords are
        # roof-frame; rectangle profile (dx × dy) extruded upward by
        # thickness.
        slab.ObjectPlacement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=roof.ObjectPlacement,
            RelativePlacement=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity(
                    "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0),
                ),
                Axis=None, RefDirection=None,
            ),
        )
        rect = self._ifc.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            ProfileName=None,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement2D",
                Location=self._ifc.create_entity(
                    "IfcCartesianPoint",
                    Coordinates=(dx / 2.0, dy / 2.0),
                ),
                RefDirection=None,
            ),
            XDim=dx,
            YDim=dy,
        )
        solid = self._ifc.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=rect,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity(
                    "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0),
                ),
                Axis=None, RefDirection=None,
            ),
            ExtrudedDirection=self._ifc.create_entity(
                "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0),
            ),
            Depth=thickness_f,
        )
        rep = self._ifc.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self._body_ctx,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=[solid],
        )
        slab.Representation = self._ifc.create_entity(
            "IfcProductDefinitionShape",
            Representations=[rep],
        )

        # ── 4. Aggregate slab under roof ──
        oh_list = self._ifc.by_type("IfcOwnerHistory")
        oh = oh_list[0] if oh_list else None
        self._ifc.create_entity(
            "IfcRelAggregates",
            GlobalId=_guid.new(),
            OwnerHistory=oh,
            Name=f"Aggregates {roof_id}",
            RelatingObject=roof,
            RelatedObjects=[slab],
        )

        # ── 5. Spatial containment + material (γ.5) ──
        if contained_in_space_id and contained_in_space_id in self._spaces_by_id:
            self._contain_in_space(roof, contained_in_space_id)
        else:
            self._contain_in_storey(roof, target_storey)

        resolved_mat_id = (
            material if material in self._materials_by_id else self._fallback_material_id()
        )
        if material and resolved_mat_id and material != resolved_mat_id:
            self._record_material_miss(
                element_id=roof_id,
                requested_material_id=material,
                fallback_material_id=resolved_mat_id,
            )
        if resolved_mat_id and resolved_mat_id in self._materials_by_id:
            mat_entity = self._materials_by_id[resolved_mat_id]
            try:
                api.run(
                    "material.assign_material", self._ifc,
                    products=[roof, slab], material=mat_entity,
                )
            except Exception:
                pass
            try:
                self._style_solid_internal(slab, resolved_mat_id)
            except Exception:
                pass

        # ── 6. Register + telemeter as BUILT (not proxy) ──
        self._elements_by_id[roof_id] = roof
        self._record_built_class("IfcRoof")
        self._record_built_class("IfcSlab")
        return roof

    # ── proxies / furniture / lighting ───────────────────────────────

    def add_proxy(
        self,
        proxy_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        object_type: str = "",
        composition: str = "ELEMENT",
        description: str = "",
        tag: str = "",
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcBuildingElementProxy` — catches everything non-standard.

        `composition` MUST be `COMPLEX`, `ELEMENT`, or `PARTIAL` —
        `NOTDEFINED` IS NOT valid for this attribute in 2X3 (the v2
        crash case).
        """
        composition = str(_ascii_safe(composition)).upper().strip().rstrip(".").lstrip(".")
        if composition not in _VALID_PROXY_COMPOSITION:
            raise BuildFlowIFCError(
                f"add_proxy({proxy_id!r}): composition must be one of "
                f"{sorted(_VALID_PROXY_COMPOSITION)}, got {composition!r}. "
                "Note: NOTDEFINED is INVALID for IfcBuildingElementProxy.CompositionType in IFC2X3."
            )
        # δ.0 — every add_proxy call is a deliberate "I cannot type this"
        # signal from the agent. Recording these tells us which element
        # types are most-often demoted to untyped geometry, so δ.4 can
        # prioritise add_stair/add_balcony/etc. implementations.
        self._record_proxy_fallback(
            requested_type=object_type or "unspecified",
            ifc_class="IfcBuildingElementProxy",
            element_id=proxy_id,
            reason="agent_called_add_proxy",
        )
        return self._add_box_element(
            ifc_class="IfcBuildingElementProxy",
            element_id=proxy_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=None,
            object_type=object_type,
            composition_type=composition,
            description=description, tag=tag,
            storey_id=storey_id,
        )

    def add_furniture(
        self,
        f_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        object_type: str = "",
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcFurnishingElement` — no PredefinedType slot in 2X3."""
        return self._add_box_element(
            ifc_class="IfcFurnishingElement",
            element_id=f_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=None,
            object_type=object_type,
            description=description, tag=tag,
            contained_in_space_id=contained_in_space_id,
            storey_id=storey_id,
        )

    def add_furniture_part(
        self,
        parent_id: str,
        part_spec: Dict[str, Any],
        item_world_origin: Tuple[float, float, float],
        item_rotation: float = 0.0,
        storey_id: Optional[str] = None,
    ) -> Any:
        """Build a single furniture part as an IfcFurnishingElement.

        `part_spec` follows the Phase Alpha decomposer schema:
            id, subtype, origin_local_m, dims_m, shape, rotation_z_rad,
            material_id, ifc_class, notes

        Returns the IFC entity for later aggregation.
        """
        import math as _math

        local = part_spec.get("origin_local_m", [0, 0, 0])
        cos_r = _math.cos(item_rotation)
        sin_r = _math.sin(item_rotation)
        rx = local[0] * cos_r - local[1] * sin_r
        ry = local[0] * sin_r + local[1] * cos_r
        world_origin = (
            item_world_origin[0] + rx,
            item_world_origin[1] + ry,
            item_world_origin[2] + local[2],
        )

        dims_m = part_spec.get("dims_m", [0.1, 0.1, 0.1])
        shape = part_spec.get("shape", "box")
        ifc_class = part_spec.get("ifc_class", "IfcFurnishingElement")
        mat_id = part_spec.get("material_id", "mat-paint-white")
        subtype = part_spec.get("subtype", "")
        part_id = f"{parent_id}-{part_spec.get('id', 'part')}"

        # For cylinders, dims_m = [radius, radius, height]; use radius
        # as both x/y dims for the bounding box approach.
        if shape == "cylinder":
            box_dims = (dims_m[0] * 2, dims_m[1] * 2)
            box_depth = dims_m[2]
        else:
            box_dims = (dims_m[0], dims_m[1])
            box_depth = dims_m[2]

        _PART_ALLOWED_CLASSES = (
            "IfcFurnishingElement", "IfcSystemFurnitureElement",
            "IfcDiscreteAccessory", "IfcCovering", "IfcFlowTerminal",
            "IfcFlowSegment", "IfcRailing", "IfcLightFixture",
            "IfcSanitaryTerminal", "IfcBuildingElementProxy",
        )
        # δ.0 — when the agent asks for an IFC class not in the
        # furniture-parts whitelist, we silently coerce to
        # IfcFurnishingElement. Record the coercion so the whitelist
        # gap is visible in telemetry rather than hidden behind a
        # successful build.
        if ifc_class not in _PART_ALLOWED_CLASSES:
            self._record_proxy_fallback(
                requested_type=ifc_class or subtype or "part",
                ifc_class="IfcFurnishingElement",
                element_id=part_id,
                reason="part_class_not_in_whitelist",
            )
        return self._add_box_element(
            ifc_class=ifc_class if ifc_class in _PART_ALLOWED_CLASSES else "IfcFurnishingElement",
            element_id=part_id, origin=world_origin,
            dims=box_dims, depth=box_depth,
            material=mat_id, predefined_type=None,
            object_type=subtype,
            description=part_spec.get("notes", f"Part of {parent_id}"),
            tag=part_id,
            contained_in_space_id=None,
            storey_id=storey_id,
        )

    def aggregate_parts(
        self,
        parent_id: str,
        child_ids: list,
        label: str = "",
    ) -> None:
        """Link child IFC entities to a parent via IfcRelAggregates."""
        import ifcopenshell.guid as _guid

        parent_el = self._elements_by_id.get(parent_id)
        if not parent_el:
            return
        children = [
            self._elements_by_id[cid]
            for cid in child_ids
            if cid in self._elements_by_id
        ]
        if not children:
            return
        oh_list = self._ifc.by_type("IfcOwnerHistory")
        oh = oh_list[0] if oh_list else None
        self._ifc.create_entity(
            "IfcRelAggregates",
            GlobalId=_guid.new(),
            OwnerHistory=oh,
            Name=label or f"Aggregates {parent_id}",
            RelatingObject=parent_el,
            RelatedObjects=children,
        )

    # ── Phase Beta 2: Trim & hardware helpers ──────────────────────────

    def add_skirting(
        self,
        skirting_id: str,
        host_space_id: str,
        wall_id: str,
        height: float = 0.075,
        depth: float = 0.018,
        material_id: str = "mat-paint-white",
    ) -> Any:
        """Build skirting as IfcCovering (FLOORING) along a wall base.

        Looks up the wall's origin and dims to compute skirting length
        and placement. Returns the IFC entity.
        """
        wall_el = self._elements_by_id.get(wall_id)
        if not wall_el:
            return None

        # Get wall placement — extract from the tracked data
        wall_data = self._tracked_data.get(wall_id, {})
        wall_origin = wall_data.get("origin", (0, 0, 0))
        wall_dims = wall_data.get("dims", (1.0, 0.2))
        wall_length = wall_dims[0] if isinstance(wall_dims, (list, tuple)) else 1.0

        return self._add_box_element(
            ifc_class="IfcCovering",
            element_id=skirting_id,
            origin=(wall_origin[0], wall_origin[1], wall_origin[2]),
            dims=(wall_length, depth),
            depth=height,
            material=material_id,
            predefined_type="FLOORING",
            object_type="Skirting",
            description=f"Skirting along {wall_id}",
            tag=skirting_id,
            contained_in_space_id=host_space_id,
        )

    def add_door_hardware(
        self,
        hardware_id: str,
        host_door_id: str,
        hardware_type: str,
        position_local: Tuple[float, float, float],
        dims: Tuple[float, float, float],
        material_id: str = "mat-brass",
    ) -> Any:
        """Build door hardware as IfcDiscreteAccessory.

        hardware_type: "hinge" | "handle" | "strike_plate"
        position_local: offset from door origin
        dims: (width, depth, height) in metres
        """
        valid_types = {"hinge", "handle", "strike_plate"}
        if hardware_type not in valid_types:
            raise ValueError(
                f"Invalid hardware_type {hardware_type!r}. "
                f"Must be one of: {', '.join(sorted(valid_types))}"
            )

        door_el = self._elements_by_id.get(host_door_id)
        door_data = self._tracked_data.get(host_door_id, {})
        door_origin = door_data.get("origin", (0, 0, 0))
        space_id = door_data.get("contained_in_space_id")

        world_origin = (
            door_origin[0] + position_local[0],
            door_origin[1] + position_local[1],
            door_origin[2] + position_local[2],
        )

        return self._add_box_element(
            ifc_class="IfcDiscreteAccessory",
            element_id=hardware_id,
            origin=world_origin,
            dims=(dims[0], dims[1]),
            depth=dims[2],
            material=material_id,
            predefined_type=None,
            object_type=f"Door {hardware_type.replace('_', ' ').title()}",
            description=f"{hardware_type} for {host_door_id}",
            tag=hardware_id,
            contained_in_space_id=space_id,
        )

    def add_window_hardware(
        self,
        hardware_id: str,
        host_window_id: str,
        hardware_type: str,
        position_local: Tuple[float, float, float],
        dims: Tuple[float, float, float],
        material_id: str = "mat-aluminium",
    ) -> Any:
        """Build window hardware as IfcDiscreteAccessory.

        hardware_type: "handle" | "sash_lock"
        """
        valid_types = {"handle", "sash_lock"}
        if hardware_type not in valid_types:
            raise ValueError(
                f"Invalid hardware_type {hardware_type!r}. "
                f"Must be one of: {', '.join(sorted(valid_types))}"
            )

        win_data = self._tracked_data.get(host_window_id, {})
        win_origin = win_data.get("origin", (0, 0, 0))
        space_id = win_data.get("contained_in_space_id")

        world_origin = (
            win_origin[0] + position_local[0],
            win_origin[1] + position_local[1],
            win_origin[2] + position_local[2],
        )

        return self._add_box_element(
            ifc_class="IfcDiscreteAccessory",
            element_id=hardware_id,
            origin=world_origin,
            dims=(dims[0], dims[1]),
            depth=dims[2],
            material=material_id,
            predefined_type=None,
            object_type=f"Window {hardware_type.replace('_', ' ').title()}",
            description=f"{hardware_type} for {host_window_id}",
            tag=hardware_id,
            contained_in_space_id=space_id,
        )

    def add_light_fixture(
        self,
        l_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        object_type: str = "",
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcLightFixture` — no PredefinedType slot in 2X3."""
        return self._add_box_element(
            ifc_class="IfcLightFixture",
            element_id=l_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=None,
            object_type=object_type,
            description=description, tag=tag,
            contained_in_space_id=contained_in_space_id,
            storey_id=storey_id,
        )

    def add_door(
        self,
        door_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        object_type: str = "",
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        host_wall_id: Optional[str] = None,
        offset_m: Optional[float] = None,
        sill_m: float = 0.0,
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcDoor` — typed opening, NOT a proxy.

        Downstream BIM tools (Revit import, Solibri, IDS validators,
        clash detection, schedule generation) filter by IFC class.
        Doors emitted as `IfcFurnishingElement` or
        `IfcBuildingElementProxy` are invisible to those tools — use
        this method instead so the schedule + clash workflows pick
        the door up.

        IFC2X3's `IfcDoor` has no `PredefinedType` slot (the v3 trap
        comment in system-prompt.md notes this); `OverallHeight` and
        `OverallWidth` are derived from the geometry. Pass dims in
        METRES (e.g. `dims=(0.9, 0.1)` for a 90 cm wide × 10 cm deep
        door leaf; `depth=2.1` for a 2.1 m tall door).

        If `host_wall_id` and `offset_m` are provided, the door will
        automatically cut an opening in the host wall and fill it.
        """
        element = self._add_box_element(
            ifc_class="IfcDoor",
            element_id=door_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=None,
            object_type=object_type,
            description=description, tag=tag,
            contained_in_space_id=contained_in_space_id,
            storey_id=storey_id,
        )
        if host_wall_id and offset_m is not None:
            opening = self.add_opening_in_wall(
                host_wall_id, offset_m, dims[0], depth, sill_m,
            )
            self.fill_opening(opening, element)
            # Re-parent door to the opening so it renders IN the wall,
            # not as a freestanding slab at world coordinates.
            element.ObjectPlacement = self._ifc.create_entity(
                "IfcLocalPlacement",
                PlacementRelTo=opening.ObjectPlacement,
                RelativePlacement=self._ifc.create_entity(
                    "IfcAxis2Placement3D",
                    Location=self._ifc.create_entity(
                        "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0),
                    ),
                    Axis=None, RefDirection=None,
                ),
            )
        return element

    def add_window(
        self,
        window_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        object_type: str = "",
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        host_wall_id: Optional[str] = None,
        offset_m: Optional[float] = None,
        sill_m: float = 0.9,
        storey_id: Optional[str] = None,
    ) -> Any:
        """`IfcWindow` — typed opening, NOT a proxy.

        Same downstream-compatibility argument as `add_door`. Windows
        emitted as proxies / furniture are invisible to BIM-tool
        schedules, clash detection and IDS validation. Use this
        method for any opening that lets light in.

        Pass dims in METRES (e.g. `dims=(1.2, 0.05)` for a 1.2 m wide
        × 5 cm deep window pane; `depth=1.5` for a 1.5 m tall window).
        Place the SW corner at the wall's inner face.

        If `host_wall_id` and `offset_m` are provided, the window will
        automatically cut an opening in the host wall and fill it.
        `sill_m` defaults to 0.9m (standard window sill height).
        """
        element = self._add_box_element(
            ifc_class="IfcWindow",
            element_id=window_id, origin=origin, dims=dims, depth=depth,
            material=material, predefined_type=None,
            object_type=object_type,
            description=description, tag=tag,
            contained_in_space_id=contained_in_space_id,
            storey_id=storey_id,
        )
        if host_wall_id and offset_m is not None:
            opening = self.add_opening_in_wall(
                host_wall_id, offset_m, dims[0], depth, sill_m,
            )
            self.fill_opening(opening, element)
            # Re-parent window to the opening so it renders IN the wall,
            # not as a freestanding slab at world coordinates.
            element.ObjectPlacement = self._ifc.create_entity(
                "IfcLocalPlacement",
                PlacementRelTo=opening.ObjectPlacement,
                RelativePlacement=self._ifc.create_entity(
                    "IfcAxis2Placement3D",
                    Location=self._ifc.create_entity(
                        "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0),
                    ),
                    Axis=None, RefDirection=None,
                ),
            )
        return element

    # ── property sets / quantities ───────────────────────────────────

    def attach_pset(
        self,
        element_ids: List[str],
        pset_name: str,
        properties: Dict[str, Any],
    ) -> Any:
        """Attach a property set to one or more elements (looked up by tag).

        Properties are sanitised — string values become ASCII, dicts /
        lists pass through recursively. ifcopenshell.api.pset emits
        IfcPropertySet + IfcRelDefinesByProperties automatically.
        """
        pset_name = str(_ascii_safe(pset_name))
        properties = _ascii_safe(properties)
        targets = [self._elements_by_id[i] for i in element_ids if i in self._elements_by_id]
        if not targets:
            raise BuildFlowIFCError(
                f"attach_pset({pset_name!r}): no known elements for ids {element_ids!r}"
            )
        api = ifcopenshell.api
        pset = api.run(
            "pset.add_pset", self._ifc, product=targets[0], name=pset_name,
        )
        api.run(
            "pset.edit_pset", self._ifc, pset=pset, properties=properties,
        )
        # For multi-element psets, ifcopenshell.api creates per-product
        # property sets — easier than mutating IfcRelDefinesByProperties
        # by hand and just as schema-valid.
        for extra in targets[1:]:
            extra_pset = api.run(
                "pset.add_pset", self._ifc, product=extra, name=pset_name,
            )
            api.run(
                "pset.edit_pset", self._ifc, pset=extra_pset, properties=properties,
            )
        return pset

    def attach_qto(
        self,
        element_id: str,
        quantities: Dict[str, float],
    ) -> Any:
        """Attach an IfcElementQuantity to a single element."""
        if element_id not in self._elements_by_id:
            raise BuildFlowIFCError(
                f"attach_qto({element_id!r}): unknown element id"
            )
        api = ifcopenshell.api
        qto = api.run(
            "pset.add_qto", self._ifc,
            product=self._elements_by_id[element_id],
            name="Qto_" + element_id,
        )
        api.run("pset.edit_qto", self._ifc, qto=qto, properties=quantities)
        return qto

    # ── canonical Psets + Qto (Phase BCD — B2) ──────────────────────

    PSET_DEFAULTS: Dict[str, Dict[str, Any]] = {
        "IfcWall": {
            "pset_name": "Pset_WallCommon",
            "props": {
                "LoadBearing": False,
                "IsExternal": True,
                "ThermalTransmittance": 0.30,
                "AcousticRating": "Rw 45 dB",
                "FireRating": "REI 60",
                "Compartmentation": False,
                "Combustible": False,
                "SurfaceSpreadOfFlame": "Class 0",
            },
        },
        "IfcDoor": {
            "pset_name": "Pset_DoorCommon",
            "props": {
                "IsExternal": True,
                "FireRating": "EI 30",
                "AcousticRating": "Rw 35 dB",
                "ThermalTransmittance": 1.6,
                "SmokeStop": False,
                "SecurityRating": "Standard",
                "HandicapAccessible": True,
            },
        },
        "IfcWindow": {
            "pset_name": "Pset_WindowCommon",
            "props": {
                "IsExternal": True,
                "ThermalTransmittance": 1.2,
                "GlazingAreaFraction": 0.78,
                "FireRating": "Not Required",
                "AcousticRating": "Rw 32 dB",
                "SecurityRating": "Standard",
            },
        },
        "IfcSpace": {
            "pset_name": "Pset_SpaceCommon",
            "props": {
                "Reference": None,
                "IsExternal": False,
                "PubliclyAccessible": False,
                "HandicapAccessible": True,
                "OccupancyType": None,
                "OccupancyNumber": None,
                "GrossPlannedArea": None,
                "NetPlannedArea": None,
            },
        },
        "IfcSlab": {
            "pset_name": "Pset_SlabCommon",
            "props": {
                "LoadBearing": True,
                "IsExternal": False,
                "ThermalTransmittance": 0.25,
                "FireRating": "REI 60",
                "AcousticRating": "Rw 52 dB",
            },
        },
        "IfcFurnishingElement": {
            "pset_name": "Pset_FurnitureCommon",
            "props": {
                "Reference": None,
                "Manufacturer": "BuildFlow Reference Spec",
            },
        },
        "IfcLightFixture": {
            "pset_name": "Pset_LightFixtureTypeCommon",
            "props": {
                "Reference": None,
                "LightFixturePlacingType": "SURFACE",
                "MaintenanceFactor": 0.85,
                "NumberOfSources": 1,
                "TotalWattage": 36.0,
            },
        },
        "IfcCovering": {
            "pset_name": "Pset_CoveringCommon",
            "props": {
                "IsExternal": False,
                "Reference": None,
            },
        },
    }

    QTO_FIELDS: Dict[str, List[str]] = {
        "IfcWall": ["Length", "Width", "Height", "GrossSideArea", "NetSideArea", "GrossVolume", "NetVolume"],
        "IfcDoor": ["Width", "Height", "Area"],
        "IfcWindow": ["Width", "Height", "Area"],
        "IfcSpace": ["Height", "FinishCeilingHeight", "GrossFloorArea", "NetFloorArea", "GrossWallArea", "NetWallArea", "GrossVolume", "NetVolume", "GrossPerimeter"],
        "IfcSlab": ["Width", "Length", "Depth", "GrossArea", "NetArea", "GrossVolume", "NetVolume"],
        "IfcFurnishingElement": ["Width", "Depth", "Height"],
        "IfcLightFixture": [],
        "IfcCovering": ["GrossArea", "NetArea"],
    }

    QTO_NAMES: Dict[str, str] = {
        "IfcWall": "Qto_WallBaseQuantities",
        "IfcDoor": "Qto_DoorBaseQuantities",
        "IfcWindow": "Qto_WindowBaseQuantities",
        "IfcSpace": "Qto_SpaceBaseQuantities",
        "IfcSlab": "Qto_SlabBaseQuantities",
        "IfcFurnishingElement": "Qto_FurnitureBaseQuantities",
        "IfcCovering": "Qto_CoveringBaseQuantities",
    }

    def attach_canonical_psets(
        self,
        element_id: str,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Optional[Any]:
        """Look up the element's IFC class and attach the canonical Pset
        with sensible defaults merged with caller overrides.

        Returns the created IfcPropertySet, or None if the class has no
        canonical Pset defined.
        """
        if element_id not in self._elements_by_id:
            # Spaces are keyed by name, not tag — try space lookup.
            if element_id in self._spaces_by_id:
                return self._attach_canonical_psets_for_space(element_id, overrides)
            raise BuildFlowIFCError(
                f"attach_canonical_psets({element_id!r}): unknown element id"
            )
        element = self._elements_by_id[element_id]
        ifc_class = element.is_a()
        config = self.PSET_DEFAULTS.get(ifc_class)
        if not config:
            return None
        props = dict(config["props"])
        # Fill Reference from the element's Name/ObjectType if available.
        if "Reference" in props and props["Reference"] is None:
            props["Reference"] = getattr(element, "ObjectType", None) or getattr(element, "Name", element_id)
        if overrides:
            props.update(overrides)
        # Strip None-valued entries — ifcopenshell will fail on IfcPropertySingleValue
        # with a None value. Omitting the property is schema-correct.
        props = {k: v for k, v in props.items() if v is not None}
        api = ifcopenshell.api
        pset = api.run(
            "pset.add_pset", self._ifc, product=element, name=str(config["pset_name"]),
        )
        api.run("pset.edit_pset", self._ifc, pset=pset, properties=_ascii_safe(props))
        return pset

    def _attach_canonical_psets_for_space(
        self,
        space_id: str,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Optional[Any]:
        """Attach Pset_SpaceCommon to a space (keyed by Name, not Tag)."""
        space = self._spaces_by_id.get(space_id)
        if not space:
            return None
        config = self.PSET_DEFAULTS.get("IfcSpace")
        if not config:
            return None
        props = dict(config["props"])
        props["Reference"] = getattr(space, "ObjectType", None) or space_id
        occ_type = getattr(space, "ObjectType", None)
        if occ_type and props.get("OccupancyType") is None:
            props["OccupancyType"] = occ_type
        if overrides:
            props.update(overrides)
        props = {k: v for k, v in props.items() if v is not None}
        api = ifcopenshell.api
        pset = api.run(
            "pset.add_pset", self._ifc, product=space, name=str(config["pset_name"]),
        )
        api.run("pset.edit_pset", self._ifc, pset=pset, properties=_ascii_safe(props))
        return pset

    def attach_canonical_qto(
        self,
        element_id: str,
        computed: Optional[Dict[str, float]] = None,
    ) -> Optional[Any]:
        """Auto-compute base quantities from the element's geometry and
        attach as the canonical Qto for its IFC class.

        If `computed` is provided, it overrides the auto-computed values.
        Returns the IfcElementQuantity, or None if the class has no Qto.
        """
        # Space handling: spaces are keyed by name.
        if element_id in self._spaces_by_id:
            return self._attach_canonical_qto_for_space(element_id, computed)
        if element_id not in self._elements_by_id:
            raise BuildFlowIFCError(
                f"attach_canonical_qto({element_id!r}): unknown element id"
            )
        element = self._elements_by_id[element_id]
        ifc_class = element.is_a()
        qto_name = self.QTO_NAMES.get(ifc_class)
        fields = self.QTO_FIELDS.get(ifc_class)
        if not qto_name or not fields:
            return None

        quantities = self._compute_qto_from_geometry(element, ifc_class, fields)
        if computed:
            quantities.update(computed)
        if not quantities:
            return None

        api = ifcopenshell.api
        qto = api.run(
            "pset.add_qto", self._ifc, product=element, name=qto_name,
        )
        api.run("pset.edit_qto", self._ifc, qto=qto, properties=quantities)
        return qto

    def _attach_canonical_qto_for_space(
        self,
        space_id: str,
        computed: Optional[Dict[str, float]] = None,
    ) -> Optional[Any]:
        """Attach Qto_SpaceBaseQuantities to an IfcSpace."""
        space = self._spaces_by_id.get(space_id)
        if not space:
            return None
        qto_name = "Qto_SpaceBaseQuantities"

        # Derive from the space's polygon + extrusion depth.
        quantities: Dict[str, float] = {}
        poly, height = self._extract_polygon_and_height(space)
        if poly and len(poly) >= 3 and height > 0:
            area = abs(self._polygon_area(poly))
            perimeter = self._polygon_perimeter(poly)
            quantities["Height"] = height
            quantities["FinishCeilingHeight"] = height
            quantities["GrossFloorArea"] = round(area, 4)
            quantities["NetFloorArea"] = round(area, 4)
            quantities["GrossWallArea"] = round(perimeter * height, 4)
            quantities["NetWallArea"] = round(perimeter * height, 4)
            quantities["GrossVolume"] = round(area * height, 4)
            quantities["NetVolume"] = round(area * height, 4)
            quantities["GrossPerimeter"] = round(perimeter, 4)

        if computed:
            quantities.update(computed)
        if not quantities:
            return None

        api = ifcopenshell.api
        qto = api.run("pset.add_qto", self._ifc, product=space, name=qto_name)
        api.run("pset.edit_qto", self._ifc, qto=qto, properties=quantities)
        return qto

    def _compute_qto_from_geometry(
        self,
        element: Any,
        ifc_class: str,
        fields: List[str],
    ) -> Dict[str, float]:
        """Best-effort quantity computation from the element's bbox."""
        quantities: Dict[str, float] = {}
        # Extract dims from the element's extruded area solid.
        rep = getattr(element, "Representation", None)
        if not rep:
            return quantities
        for shape_rep in (rep.Representations or []):
            for item in (shape_rep.Items or []):
                if not item.is_a("IfcExtrudedAreaSolid"):
                    continue
                depth = float(item.Depth) if item.Depth else 0.0
                area_def = item.SweptArea
                if area_def and area_def.is_a("IfcRectangleProfileDef"):
                    dx = float(area_def.XDim)
                    dy = float(area_def.YDim)
                    return self._qto_from_box(ifc_class, fields, dx, dy, depth)
                if area_def and area_def.is_a("IfcCircleProfileDef"):
                    radius = float(area_def.Radius)
                    circle_area = math.pi * radius * radius
                    if "Width" in fields:
                        quantities["Width"] = round(2 * radius, 4)
                    if "Depth" in fields:
                        quantities["Depth"] = round(2 * radius, 4)
                    if "Height" in fields:
                        quantities["Height"] = round(depth, 4)
                    if "GrossArea" in fields:
                        quantities["GrossArea"] = round(circle_area, 4)
                    if "NetArea" in fields:
                        quantities["NetArea"] = round(circle_area, 4)
                    if "GrossVolume" in fields:
                        quantities["GrossVolume"] = round(circle_area * depth, 4)
                    if "NetVolume" in fields:
                        quantities["NetVolume"] = round(circle_area * depth, 4)
                    return quantities
                if area_def and area_def.is_a("IfcArbitraryClosedProfileDef"):
                    # Polygon profile — compute area from vertices.
                    curve = getattr(area_def, "OuterCurve", None)
                    if curve and curve.is_a("IfcPolyline"):
                        poly = [(float(p.Coordinates[0]), float(p.Coordinates[1]))
                                for p in (curve.Points or [])]
                        poly_area = abs(self._polygon_area(poly))
                        perimeter = self._polygon_perimeter(poly)
                        if "GrossFloorArea" in fields:
                            quantities["GrossFloorArea"] = round(poly_area, 4)
                        if "NetFloorArea" in fields:
                            quantities["NetFloorArea"] = round(poly_area, 4)
                        if "Height" in fields:
                            quantities["Height"] = round(depth, 4)
                        if "GrossVolume" in fields:
                            quantities["GrossVolume"] = round(poly_area * depth, 4)
                        if "NetVolume" in fields:
                            quantities["NetVolume"] = round(poly_area * depth, 4)
                        if "GrossPerimeter" in fields:
                            quantities["GrossPerimeter"] = round(perimeter, 4)
                    return quantities
        return quantities

    def _qto_from_box(
        self,
        ifc_class: str,
        fields: List[str],
        dx: float,
        dy: float,
        depth: float,
    ) -> Dict[str, float]:
        """Compute Qto quantities from a box profile (dx x dy extruded by depth)."""
        q: Dict[str, float] = {}
        if ifc_class in ("IfcWall",):
            length = dx
            width = dy
            height = depth
            if "Length" in fields:
                q["Length"] = round(length, 4)
            if "Width" in fields:
                q["Width"] = round(width, 4)
            if "Height" in fields:
                q["Height"] = round(height, 4)
            if "GrossSideArea" in fields:
                q["GrossSideArea"] = round(length * height, 4)
            if "NetSideArea" in fields:
                q["NetSideArea"] = round(length * height, 4)
            if "GrossVolume" in fields:
                q["GrossVolume"] = round(length * width * height, 4)
            if "NetVolume" in fields:
                q["NetVolume"] = round(length * width * height, 4)
        elif ifc_class in ("IfcDoor", "IfcWindow"):
            width = dx
            height = depth
            if "Width" in fields:
                q["Width"] = round(width, 4)
            if "Height" in fields:
                q["Height"] = round(height, 4)
            if "Area" in fields:
                q["Area"] = round(width * height, 4)
        elif ifc_class in ("IfcSlab",):
            if "Width" in fields:
                q["Width"] = round(dy, 4)
            if "Length" in fields:
                q["Length"] = round(dx, 4)
            if "Depth" in fields:
                q["Depth"] = round(depth, 4)
            if "GrossArea" in fields:
                q["GrossArea"] = round(dx * dy, 4)
            if "NetArea" in fields:
                q["NetArea"] = round(dx * dy, 4)
            if "GrossVolume" in fields:
                q["GrossVolume"] = round(dx * dy * depth, 4)
            if "NetVolume" in fields:
                q["NetVolume"] = round(dx * dy * depth, 4)
        elif ifc_class in ("IfcFurnishingElement",):
            if "Width" in fields:
                q["Width"] = round(dx, 4)
            if "Depth" in fields:
                q["Depth"] = round(dy, 4)
            if "Height" in fields:
                q["Height"] = round(depth, 4)
        elif ifc_class in ("IfcCovering",):
            if "GrossArea" in fields:
                q["GrossArea"] = round(dx * dy, 4)
            if "NetArea" in fields:
                q["NetArea"] = round(dx * dy, 4)
        return q

    @staticmethod
    def _polygon_area(poly: List[Tuple[float, float]]) -> float:
        """Shoelace formula for polygon area."""
        n = len(poly)
        if n < 3:
            return 0.0
        area = 0.0
        for i in range(n):
            j = (i + 1) % n
            area += poly[i][0] * poly[j][1]
            area -= poly[j][0] * poly[i][1]
        return area / 2.0

    @staticmethod
    def _polygon_perimeter(poly: List[Tuple[float, float]]) -> float:
        """Sum of edge lengths for a closed polygon."""
        n = len(poly)
        perimeter = 0.0
        for i in range(n):
            j = (i + 1) % n
            dx = poly[j][0] - poly[i][0]
            dy = poly[j][1] - poly[i][1]
            perimeter += math.sqrt(dx * dx + dy * dy)
        return perimeter

    def _extract_polygon_and_height(
        self, product: Any
    ) -> Tuple[Optional[List[Tuple[float, float]]], float]:
        """Extract the polygon vertices and extrusion height from a product's
        IfcArbitraryClosedProfileDef representation."""
        rep = getattr(product, "Representation", None)
        if not rep:
            return None, 0.0
        for shape_rep in (rep.Representations or []):
            for item in (shape_rep.Items or []):
                if not item.is_a("IfcExtrudedAreaSolid"):
                    continue
                depth = float(item.Depth) if item.Depth else 0.0
                area_def = item.SweptArea
                if area_def and area_def.is_a("IfcArbitraryClosedProfileDef"):
                    curve = getattr(area_def, "OuterCurve", None)
                    if curve and curve.is_a("IfcPolyline"):
                        poly = [(float(p.Coordinates[0]), float(p.Coordinates[1]))
                                for p in (curve.Points or [])]
                        return poly, depth
        return None, 0.0

    # ── per-solid IfcStyledItem (Phase BCD — C) ─────────────────────

    def style_solid(
        self,
        element_id: str,
        material_id: Optional[str] = None,
    ) -> List[Any]:
        """Emit one IfcStyledItem per IfcExtrudedAreaSolid in the element's
        Body representation.

        If `material_id` is None, looks up the material already associated
        with the element via IfcRelAssociatesMaterial and finds the
        corresponding bootstrap surface style. Returns the list of created
        IfcStyledItem entities.

        web-ifc (the BuildFlow viewer) does NOT traverse the indirect
        material -> IfcMaterialDefinitionRepresentation -> IfcStyledItem
        chain. It requires a direct IfcStyledItem on each geometric
        representation item. This method bridges that gap.
        """
        # Resolve the element.
        element = self._elements_by_id.get(element_id) or self._spaces_by_id.get(element_id)
        if not element:
            raise BuildFlowIFCError(
                f"style_solid({element_id!r}): unknown element/space id"
            )
        # Resolve the style from the material.
        style = self._resolve_style_for_element(element, material_id)
        if not style:
            return []

        # Walk the Body representation and find all solids.
        styled_items: List[Any] = []
        rep = getattr(element, "Representation", None)
        if not rep:
            return styled_items
        for shape_rep in (rep.Representations or []):
            for item in (shape_rep.Items or []):
                if item.is_a("IfcExtrudedAreaSolid"):
                    si = self._ifc.create_entity(
                        "IfcStyledItem",
                        Item=item,
                        Styles=[style],
                        Name=None,
                    )
                    styled_items.append(si)
        return styled_items

    def _resolve_style_for_element(
        self,
        element: Any,
        material_id: Optional[str],
    ) -> Optional[Any]:
        """Find the IfcPresentationStyleAssignment for an element's material."""
        if material_id and material_id in self._material_styles:
            return self._material_styles[material_id]

        # Walk IfcRelAssociatesMaterial to find the material.
        for rel in self._ifc.by_type("IfcRelAssociatesMaterial"):
            related = rel.RelatedObjects or ()
            if element in related:
                mat = rel.RelatingMaterial
                if mat:
                    mat_name = getattr(mat, "Name", None)
                    if mat_name:
                        # Reverse-lookup: _materials_by_id values are IfcMaterial
                        # entities; _material_styles is keyed by brief-mat-id.
                        for mid, m in self._materials_by_id.items():
                            if m == mat or getattr(m, "Name", None) == mat_name:
                                return self._material_styles.get(mid)
        return None

    def _style_solid_internal(self, element: Any, material_id: str) -> None:
        """Internal auto-styling called from _add_box_element / _add_circle_element.
        Creates one IfcStyledItem per IfcExtrudedAreaSolid in the element's Body rep."""
        style = self._material_styles.get(material_id)
        if not style:
            return
        rep = getattr(element, "Representation", None)
        if not rep:
            return
        for shape_rep in (rep.Representations or []):
            for item in (shape_rep.Items or []):
                if item.is_a("IfcExtrudedAreaSolid"):
                    self._ifc.create_entity(
                        "IfcStyledItem",
                        Item=item,
                        Styles=[style],
                        Name=None,
                    )

    # ── typed openings + voids + fills (Phase BCD — D) ──────────────

    def add_opening_in_wall(
        self,
        host_wall_id: str,
        offset_m: float,
        width_m: float,
        height_m: float,
        sill_m: float = 0.0,
    ) -> Any:
        """Create an IfcOpeningElement cut into a host wall.

        `offset_m` is metres from the wall's start along its axis.
        `sill_m` is the sill height above the wall's base.
        The opening is positioned in the wall's local coordinate system
        and linked via IfcRelVoidsElement.

        Returns the IfcOpeningElement.
        """
        if host_wall_id not in self._elements_by_id:
            raise BuildFlowIFCError(
                f"add_opening_in_wall({host_wall_id!r}): unknown wall id"
            )
        host_wall = self._elements_by_id[host_wall_id]
        if not host_wall.is_a("IfcWall"):
            raise BuildFlowIFCError(
                f"add_opening_in_wall({host_wall_id!r}): element is {host_wall.is_a()}, not IfcWall"
            )

        # Extract wall thickness from its profile.
        wall_thickness = 0.1  # fallback
        wall_rep = getattr(host_wall, "Representation", None)
        if wall_rep:
            for sr in (wall_rep.Representations or []):
                for item in (sr.Items or []):
                    if item.is_a("IfcExtrudedAreaSolid"):
                        area = item.SweptArea
                        if area and area.is_a("IfcRectangleProfileDef"):
                            wall_thickness = float(area.YDim)

        api = ifcopenshell.api
        opening_id = f"opening-{host_wall_id}-{uuid.uuid4().hex[:8]}"

        opening = api.run(
            "root.create_entity", self._ifc,
            ifc_class="IfcOpeningElement",
            name=opening_id,
        )

        # Opening geometry: a box (width x wall_thickness x height).
        rect = self._ifc.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            ProfileName=None,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement2D",
                Location=self._ifc.create_entity(
                    "IfcCartesianPoint", Coordinates=(width_m / 2.0, wall_thickness / 2.0),
                ),
                RefDirection=None,
            ),
            XDim=width_m,
            YDim=wall_thickness,
        )
        solid = self._ifc.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=rect,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
                Axis=None, RefDirection=None,
            ),
            ExtrudedDirection=self._ifc.create_entity(
                "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0),
            ),
            Depth=height_m,
        )
        rep = self._ifc.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self._body_ctx,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=[solid],
        )
        opening.Representation = self._ifc.create_entity(
            "IfcProductDefinitionShape", Representations=[rep],
        )

        # Position the opening in the wall's LOCAL coordinate system:
        # offset_m along the wall's X axis, 0 along Y, sill_m along Z.
        # The opening's placement is relative to the wall's placement.
        placement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=host_wall.ObjectPlacement,
            RelativePlacement=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity(
                    "IfcCartesianPoint", Coordinates=(offset_m, 0.0, sill_m),
                ),
                Axis=None, RefDirection=None,
            ),
        )
        opening.ObjectPlacement = placement

        # IfcRelVoidsElement — cut the opening out of the wall.
        self._ifc.create_entity(
            "IfcRelVoidsElement",
            GlobalId=ifcopenshell.guid.new(),
            OwnerHistory=self._ifc.by_type("IfcOwnerHistory")[0] if self._ifc.by_type("IfcOwnerHistory") else None,
            Name=f"Void {opening_id}",
            Description=None,
            RelatingBuildingElement=host_wall,
            RelatedOpeningElement=opening,
        )

        return opening

    def fill_opening(
        self,
        opening: Any,
        fill_element: Any,
    ) -> Any:
        """Create an IfcRelFillsElement linking an opening to a door/window.

        Both arguments are ifcopenshell entity references (not string IDs).
        """
        rel = self._ifc.create_entity(
            "IfcRelFillsElement",
            GlobalId=ifcopenshell.guid.new(),
            OwnerHistory=self._ifc.by_type("IfcOwnerHistory")[0] if self._ifc.by_type("IfcOwnerHistory") else None,
            Name=None,
            Description=None,
            RelatingOpeningElement=opening,
            RelatedBuildingElement=fill_element,
        )
        return rel

    # ── spatial containment override (Phase BCD — H9) ───────────────

    def _contain_in_space(self, element: Any, space_id: str) -> bool:
        """Assign an element to an IfcSpace instead of the storey.

        Uses `ifcopenshell.api.run("spatial.assign_container", ...)` to
        move the element from the storey's containment to the specified
        space's containment. Returns True if successful.
        """
        space = self._spaces_by_id.get(space_id)
        if not space:
            return False
        try:
            ifcopenshell.api.run(
                "spatial.assign_container", self._ifc,
                products=[element], relating_structure=space,
            )
            return True
        except Exception:
            try:
                ifcopenshell.api.run(
                    "spatial.assign_container", self._ifc,
                    product=element, relating_structure=space,
                )
                return True
            except Exception:
                return False

    # ── inspection ───────────────────────────────────────────────────

    def validate(self) -> Dict[str, Any]:
        """Quick structural integrity check. Does NOT exercise web-ifc —
        the validator in `validate.py` does that against the WRITTEN file."""
        all_products = self._ifc.by_type("IfcProduct")
        spaces = [p for p in all_products if p.is_a("IfcSpace")]
        errors: List[str] = []

        # Every product should have a placement. (`Tag` is unsafe to
        # access on IfcSpace in 2X3 — fall back to Name / GlobalId.)
        for p in all_products:
            try:
                if p.ObjectPlacement is None and not p.is_a("IfcProject"):
                    label = (
                        getattr(p, "Tag", None)
                        or getattr(p, "Name", None)
                        or getattr(p, "GlobalId", "?")
                    )
                    errors.append(f"{p.is_a()} {label} has no ObjectPlacement")
            except Exception:
                pass

        # Reference resolution — every Tag we tracked must still resolve.
        for tag in list(self._elements_by_id.keys()):
            try:
                _ = self._elements_by_id[tag].GlobalId
            except Exception as exc:
                errors.append(f"element {tag} unreachable: {exc!r}")

        return {
            "schema": self.SCHEMA,
            "entity_count": len(list(self._ifc)),
            "refs_resolve": len(errors) == 0,
            # IfcSpace has no Tag in 2X3 — use Name (which we set to the
            # caller's space_id at creation time).
            "spaces_present": [getattr(s, "Name", None) for s in spaces if getattr(s, "Name", None)],
            "errors": errors,
        }

    def summary(self) -> Dict[str, Any]:
        """Structured snapshot for the `read_ifc_summary` agent tool."""
        by_class: Dict[str, int] = {}
        for entity in self._ifc.by_type("IfcProduct"):
            by_class[entity.is_a()] = by_class.get(entity.is_a(), 0) + 1
        materials = [m.Name for m in self._ifc.by_type("IfcMaterial")]
        psets = sorted({p.Name for p in self._ifc.by_type("IfcPropertySet") if p.Name})
        # Spaces — in 2X3 the schema has no Tag attribute on IfcSpace, so
        # we use Name (which `add_space` sets to the caller's space_id).
        spaces_list = []
        for s in self._ifc.by_type("IfcSpace"):
            spaces_list.append({
                "name": getattr(s, "Name", None),
                "long_name": getattr(s, "LongName", None),
                "object_type": getattr(s, "ObjectType", None),
            })
        return {
            "schema": self.SCHEMA,
            "entity_count_total": len(list(self._ifc)),
            "products_by_class": by_class,
            "materials": materials,
            "property_sets": psets,
            "spaces": spaces_list,
            "tracked_element_ids": sorted(self._elements_by_id.keys()),
        }

    def write(self, path: str) -> int:
        """Write the IFC file. Returns the total entity count."""
        self._ifc.write(_ascii_safe(path))
        return len(list(self._ifc))

    # ── session persistence ──────────────────────────────────────────

    def save_state(self, dir_path: str) -> None:
        """Persist the current state to disk. The session-store calls this
        between each agent tool call so the file survives the FastAPI
        request/response boundary.

        We can't pickle ifcopenshell.file (C++ state under the hood), so
        the IFC itself goes to disk via `write()` and the Python-side
        bookkeeping (tracked element tags, brief, material map) goes to
        `meta.json` alongside it.
        """
        os.makedirs(dir_path, exist_ok=True)
        ifc_path = os.path.join(dir_path, "state.ifc")
        meta_path = os.path.join(dir_path, "meta.json")
        self._ifc.write(ifc_path)
        # δ.0 — persist BuildTelemetry alongside the IFC + meta so it
        # survives the FastAPI request/response boundary. The Python
        # /finalize endpoint reads this back and forwards it to the TS
        # caller. Wrapped in try/except inside `get_telemetry()` so a
        # corrupt telemetry dict cannot break save_state.
        meta = {
            "brief": self._brief,
            "element_tags": sorted(self._elements_by_id.keys()),
            "material_ids": sorted(self._materials_by_id.keys()),
            "space_tags": sorted(self._spaces_by_id.keys()),
            "storey_tags": sorted(self._storeys_by_id.keys()),
            "schema": self.SCHEMA,
            "telemetry": self.get_telemetry(),
        }
        with open(meta_path, "w", encoding="ascii") as f:
            json.dump(meta, f, ensure_ascii=True)

    @classmethod
    def load_state(cls, dir_path: str) -> "BuildFlowIFC":
        """Re-hydrate from a `save_state` directory. References are re-resolved
        by walking `IfcProduct.Tag` and matching against the saved tag list."""
        ifc_path = os.path.join(dir_path, "state.ifc")
        meta_path = os.path.join(dir_path, "meta.json")
        with open(meta_path, "r", encoding="ascii") as f:
            meta = json.load(f)

        instance = cls.__new__(cls)
        instance._brief = meta["brief"]
        instance._ifc = ifcopenshell.open(ifc_path)
        instance._elements_by_id = {}
        instance._spaces_by_id = {}
        instance._materials_by_id = {}
        instance._material_styles = {}
        instance._storeys_by_id = {}
        # δ.0 — restore accumulated BuildTelemetry across exec calls.
        # Tolerant of pre-δ.0 sessions (no telemetry key in meta.json)
        # and of corrupted telemetry payloads (anything non-dict resets
        # to an empty snapshot — counters start from zero, never crash).
        loaded_tel = meta.get("telemetry")
        if isinstance(loaded_tel, dict):
            instance._telemetry = {
                "proxy_fallbacks": list(loaded_tel.get("proxy_fallbacks", [])
                                        if isinstance(loaded_tel.get("proxy_fallbacks"), list) else []),
                "material_misses": list(loaded_tel.get("material_misses", [])
                                        if isinstance(loaded_tel.get("material_misses"), list) else []),
                "dropped_elements": list(loaded_tel.get("dropped_elements", [])
                                         if isinstance(loaded_tel.get("dropped_elements"), list) else []),
                "built_element_counts": dict(loaded_tel.get("built_element_counts", {})
                                             if isinstance(loaded_tel.get("built_element_counts"), dict) else {}),
            }
        else:
            instance._telemetry = _empty_telemetry()

        # Re-resolve element references. Spaces in IFC2X3 have no `Tag`
        # attribute — they're keyed by Name. Other IfcElement descendants
        # DO have Tag in 2X3 (it's on IfcElement, not IfcSpatialStructureElement).
        wanted_tags = set(meta.get("element_tags", []))
        wanted_space_names = set(meta.get("space_tags", []))
        for p in instance._ifc.by_type("IfcProduct"):
            if p.is_a("IfcSpace"):
                name = getattr(p, "Name", None)
                if name and name in wanted_space_names:
                    instance._spaces_by_id[name] = p
                continue
            try:
                tag = p.Tag
            except AttributeError:
                tag = None
            if tag and tag in wanted_tags:
                instance._elements_by_id[tag] = p

        # Re-resolve materials by *brief mat_id* (e.g. "mat-walnut"),
        # NOT by IfcMaterial.Name (e.g. "Walnut Veneer").
        # _bootstrap_materials keys _materials_by_id by mat_id, but
        # IfcMaterial.Name is the display name.  Without this reverse
        # mapping every bf.add_* call after the first session restore
        # silently skips material assignment (the "gray IFC" bug).
        brief_materials = instance._brief.get("materials") or []
        _name_to_ids: Dict[str, list] = {}
        for bm in brief_materials:
            mid = str(bm.get("id", ""))
            mname = str(bm.get("name", mid))
            if mid:
                _name_to_ids.setdefault(mname, []).append(mid)

        _name_idx: Dict[str, int] = {}
        for m in instance._ifc.by_type("IfcMaterial"):
            ids = _name_to_ids.get(m.Name)
            if ids:
                i = _name_idx.get(m.Name, 0)
                mat_id = ids[i] if i < len(ids) else m.Name
                _name_idx[m.Name] = i + 1
            else:
                mat_id = m.Name  # fallback for materials not in brief
            instance._materials_by_id[mat_id] = m

        # Re-resolve material styles by walking the IFC entity graph:
        # IfcMaterial → IfcMaterialDefinitionRepresentation →
        # IfcStyledRepresentation → IfcStyledItem → Styles[0].
        # Without this, _style_solid_internal silently skips per-solid
        # IfcStyledItem creation after session restore.
        for mat_id, material in instance._materials_by_id.items():
            try:
                for inv in instance._ifc.get_inverse(material):
                    if not inv.is_a("IfcMaterialDefinitionRepresentation"):
                        continue
                    for rep in (inv.Representations or []):
                        if not rep.is_a("IfcStyledRepresentation"):
                            continue
                        for item in (rep.Items or []):
                            if item.is_a("IfcStyledItem") and item.Styles:
                                instance._material_styles[mat_id] = item.Styles[0]
                                break
                        if mat_id in instance._material_styles:
                            break
                    if mat_id in instance._material_styles:
                        break
            except Exception:
                pass  # Non-critical — element colour, not structural

        # Re-resolve project / storey / contexts.
        projects = instance._ifc.by_type("IfcProject")
        if projects:
            instance._project = projects[0]
        sites = instance._ifc.by_type("IfcSite")
        if sites:
            instance._site = sites[0]
        buildings = instance._ifc.by_type("IfcBuilding")
        if buildings:
            instance._building = buildings[0]
        storeys = instance._ifc.by_type("IfcBuildingStorey")
        if storeys:
            instance._storey = storeys[0]
        # Re-resolve additional storeys by Name (matching saved storey_tags).
        wanted_storey_names = set(meta.get("storey_tags", []))
        for s in storeys:
            name = getattr(s, "Name", None)
            if name and name in wanted_storey_names:
                instance._storeys_by_id[name] = s
        # GeometricRepresentationContext bodies — the first Model context
        # with a Body subcontext.
        ctxs = instance._ifc.by_type("IfcGeometricRepresentationContext")
        sub = [c for c in ctxs if c.is_a("IfcGeometricRepresentationSubContext")]
        instance._body_ctx = sub[0] if sub else (ctxs[0] if ctxs else None)
        instance._model_ctx = next(
            (c for c in ctxs if not c.is_a("IfcGeometricRepresentationSubContext")),
            None,
        )
        return instance

    # ── internal helpers ─────────────────────────────────────────────

    def _fallback_material_id(self) -> Optional[str]:
        """Return the first available material id, or None if empty."""
        if self._materials_by_id:
            return next(iter(self._materials_by_id))
        return None

    def _resolve_storey(self, storey_id: Optional[str]) -> Any:
        """Return the IfcBuildingStorey for the given id, or the default."""
        if storey_id and storey_id in self._storeys_by_id:
            return self._storeys_by_id[storey_id]
        return self._storey

    def _add_box_element(
        self,
        ifc_class: str,
        element_id: str,
        origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        material: str,
        predefined_type: Optional[str],
        rotation: float = 0.0,
        object_type: str = "",
        composition_type: Optional[str] = None,
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Any:
        element_id = str(_ascii_safe(element_id))
        material = str(_ascii_safe(material))
        object_type = str(_ascii_safe(object_type))
        description = str(_ascii_safe(description))
        tag = str(_ascii_safe(tag)) or element_id

        if element_id in self._elements_by_id:
            raise BuildFlowIFCError(
                f"add element {element_id!r}: id already taken — "
                "every element id must be unique within the session."
            )

        ox, oy, oz = float(origin[0]), float(origin[1]), float(origin[2])
        dx, dy = float(dims[0]), float(dims[1])
        depth = float(depth)

        if dx <= 0 or dy <= 0 or depth <= 0:
            raise BuildFlowIFCError(
                f"add element {element_id!r}: dims ({dx}x{dy}) and depth ({depth}) "
                "must all be > 0."
            )

        api = ifcopenshell.api
        element = api.run("root.create_entity", self._ifc, ifc_class=ifc_class)
        element.Name = element_id
        element.Tag = tag
        if object_type:
            element.ObjectType = object_type
        if description:
            element.Description = description

        # PredefinedType — schema-aware. IFC4 allows PredefinedType on
        # many more classes than IFC2X3. We consult the right allow-list.
        if predefined_type and ifc_class != "IfcBuildingElementProxy":
            from .canonical_psets import IFC4_PREDEFINED_TYPES
            if self.SCHEMA == "IFC4":
                allowed = IFC4_PREDEFINED_TYPES.get(ifc_class)
            else:
                allowed = _PREDEFINED_TYPE_ENUMS.get(ifc_class)
            if allowed and predefined_type.upper() in allowed:
                try:
                    element.PredefinedType = predefined_type.upper()
                except Exception:
                    # ifcopenshell rejects — leave unset rather than crash.
                    pass

        # CompositionType — IfcBuildingElementProxy only, validated upstream.
        # In IFC4, IfcBuildingElementProxy gains PredefinedType too.
        if composition_type and ifc_class == "IfcBuildingElementProxy":
            if self.SCHEMA == "IFC4":
                # IFC4: use PredefinedType, not CompositionType.
                try:
                    element.PredefinedType = composition_type.upper()
                except Exception:
                    pass
            else:
                try:
                    element.CompositionType = composition_type
                except Exception:
                    pass

        # Geometry: rectangle profile extruded along +Z by `depth`.
        #
        # IFC2X3 IfcRectangleProfileDef is *centered* on its Position —
        # XDim / YDim are TOTAL widths, and Position.Location is the
        # centre point. Placing the profile centre at (dx/2, dy/2) means
        # the rectangle spans (0, 0) to (dx, dy) in local space, so the
        # element's placement origin (ox, oy, oz) becomes the SW corner
        # of the bbox in world space — matching the BriefSpec's SW-corner
        # convention for `origin_world_m`. Without this offset, walls
        # land centred on their origin, so a WALL-N at origin=(0, 4.9)
        # overshoots by half its length westwards. See
        # forensics/diagnosis.md follow-ups.
        rect = self._ifc.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            ProfileName=None,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement2D",
                Location=self._ifc.create_entity(
                    "IfcCartesianPoint",
                    Coordinates=(dx / 2.0, dy / 2.0),
                ),
                RefDirection=None,
            ),
            XDim=dx,
            YDim=dy,
        )
        solid = self._ifc.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=rect,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
                Axis=None,
                RefDirection=None,
            ),
            ExtrudedDirection=self._ifc.create_entity(
                "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0),
            ),
            Depth=depth,
        )
        rep = self._ifc.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self._body_ctx,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=[solid],
        )
        prod_def = self._ifc.create_entity(
            "IfcProductDefinitionShape",
            Representations=[rep],
        )
        element.Representation = prod_def

        # Local placement at (ox, oy, oz), rotated about Z by `rotation`.
        ref_dir = self._ifc.create_entity(
            "IfcDirection",
            DirectionRatios=(math.cos(rotation), math.sin(rotation), 0.0),
        )
        location = self._ifc.create_entity(
            "IfcCartesianPoint", Coordinates=(ox, oy, oz),
        )
        placement_axis = self._ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=location,
            Axis=self._ifc.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
            RefDirection=ref_dir,
        )
        target_storey = self._resolve_storey(storey_id)
        local_placement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=target_storey.ObjectPlacement,
            RelativePlacement=placement_axis,
        )
        element.ObjectPlacement = local_placement

        # Spatial containment: route to IfcSpace if brief element specifies
        # contained_in_space_id (H9 fix); otherwise fall through to storey.
        if contained_in_space_id and contained_in_space_id in self._spaces_by_id:
            self._contain_in_space(element, contained_in_space_id)
        else:
            self._contain_in_storey(element, target_storey)

        resolved_mat_id = material if material in self._materials_by_id else self._fallback_material_id()
        # δ.0 — record material misses (requested mat id not in catalog,
        # silently substituted with the fallback). This is the precise
        # signal for "the agent referenced materials that don't exist"
        # which manifested as "gray IFC" in earlier phases.
        if material and resolved_mat_id and material != resolved_mat_id:
            self._record_material_miss(
                element_id=element_id,
                requested_material_id=material,
                fallback_material_id=resolved_mat_id,
            )
        if resolved_mat_id and resolved_mat_id in self._materials_by_id:
            api.run(
                "material.assign_material", self._ifc,
                products=[element], material=self._materials_by_id[resolved_mat_id],
            )
            # Per-solid IfcStyledItem so web-ifc renders colours (Phase C fix).
            self._style_solid_internal(element, resolved_mat_id)

        self._elements_by_id[element_id] = element
        # δ.0 — count built elements by IFC class. Authoritative even
        # when individual event arrays cap out.
        self._record_built_class(ifc_class)
        return element

    def _add_circle_element(
        self,
        ifc_class: str,
        element_id: str,
        origin: Tuple[float, float, float],
        radius: float,
        depth: float,
        material: str,
        description: str = "",
        tag: str = "",
        contained_in_space_id: Optional[str] = None,
        storey_id: Optional[str] = None,
    ) -> Any:
        element_id = str(_ascii_safe(element_id))
        material = str(_ascii_safe(material))
        description = str(_ascii_safe(description))
        tag = str(_ascii_safe(tag)) or element_id

        if element_id in self._elements_by_id:
            raise BuildFlowIFCError(
                f"add element {element_id!r}: id already taken — "
                "every element id must be unique within the session."
            )

        ox, oy, oz = float(origin[0]), float(origin[1]), float(origin[2])
        radius = float(radius)
        depth = float(depth)
        if radius <= 0 or depth <= 0:
            raise BuildFlowIFCError(
                f"add element {element_id!r}: radius and depth must both be > 0."
            )

        api = ifcopenshell.api
        element = api.run("root.create_entity", self._ifc, ifc_class=ifc_class)
        element.Name = element_id
        element.Tag = tag
        if description:
            element.Description = description

        circle = self._ifc.create_entity(
            "IfcCircleProfileDef",
            ProfileType="AREA",
            ProfileName=None,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement2D",
                Location=self._ifc.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0)),
                RefDirection=None,
            ),
            Radius=radius,
        )
        solid = self._ifc.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=circle,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
                Axis=None,
                RefDirection=None,
            ),
            ExtrudedDirection=self._ifc.create_entity(
                "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0),
            ),
            Depth=depth,
        )
        rep = self._ifc.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self._body_ctx,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=[solid],
        )
        element.Representation = self._ifc.create_entity(
            "IfcProductDefinitionShape", Representations=[rep],
        )

        placement_axis = self._ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=self._ifc.create_entity(
                "IfcCartesianPoint", Coordinates=(ox, oy, oz),
            ),
            Axis=None, RefDirection=None,
        )
        target_storey = self._resolve_storey(storey_id)
        element.ObjectPlacement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=target_storey.ObjectPlacement,
            RelativePlacement=placement_axis,
        )

        # Spatial containment: route to IfcSpace if specified (H9 fix).
        if contained_in_space_id and contained_in_space_id in self._spaces_by_id:
            self._contain_in_space(element, contained_in_space_id)
        else:
            self._contain_in_storey(element, target_storey)

        resolved_mat_id = material if material in self._materials_by_id else self._fallback_material_id()
        # δ.0 — same material-miss telemetry as _add_box_element so
        # circular elements (e.g. add_circular_column) are observable
        # on the same axis as box elements.
        if material and resolved_mat_id and material != resolved_mat_id:
            self._record_material_miss(
                element_id=element_id,
                requested_material_id=material,
                fallback_material_id=resolved_mat_id,
            )
        if resolved_mat_id and resolved_mat_id in self._materials_by_id:
            api.run(
                "material.assign_material", self._ifc,
                products=[element], material=self._materials_by_id[resolved_mat_id],
            )
            # Per-solid IfcStyledItem so web-ifc renders colours (Phase C fix).
            self._style_solid_internal(element, resolved_mat_id)
        # δ.0 — count built circular elements by IFC class.
        self._record_built_class(ifc_class)

        self._elements_by_id[element_id] = element
        return element

    def _attach_geometry_extruded_polygon(
        self,
        product: Any,
        polygon: List[Tuple[float, float]],
        height: float,
    ) -> None:
        """Attach an extruded-polygon body representation to an existing product."""
        # IfcArbitraryClosedProfileDef expects an IfcPolyline outer-curve.
        points = [
            self._ifc.create_entity(
                "IfcCartesianPoint", Coordinates=(float(p[0]), float(p[1])),
            )
            for p in polygon
        ]
        # Close the polyline if not already closed.
        first = polygon[0]
        last = polygon[-1]
        if (abs(float(first[0]) - float(last[0])) > 1e-6 or
            abs(float(first[1]) - float(last[1])) > 1e-6):
            points.append(self._ifc.create_entity(
                "IfcCartesianPoint", Coordinates=(float(first[0]), float(first[1])),
            ))
        polyline = self._ifc.create_entity("IfcPolyline", Points=points)
        profile = self._ifc.create_entity(
            "IfcArbitraryClosedProfileDef",
            ProfileType="AREA",
            ProfileName=None,
            OuterCurve=polyline,
        )
        solid = self._ifc.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=profile,
            Position=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
                Axis=None, RefDirection=None,
            ),
            ExtrudedDirection=self._ifc.create_entity(
                "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0),
            ),
            Depth=float(height),
        )
        rep = self._ifc.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self._body_ctx,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=[solid],
        )
        product.Representation = self._ifc.create_entity(
            "IfcProductDefinitionShape", Representations=[rep],
        )
        # Place at world origin — the polygon points are world-coordinate.
        product.ObjectPlacement = self._ifc.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=self._storey.ObjectPlacement,
            RelativePlacement=self._ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=self._ifc.create_entity(
                    "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0),
                ),
                Axis=None, RefDirection=None,
            ),
        )

    def _contain_in_storey(self, element: Any, storey: Any = None) -> None:
        """Wire an element into a storey's containment relationship.

        We piggy-back on `ifcopenshell.api.spatial.assign_container` — it
        handles creating or extending an `IfcRelContainedInSpatialStructure`.
        """
        target = storey if storey is not None else self._storey
        try:
            ifcopenshell.api.run(
                "spatial.assign_container", self._ifc,
                products=[element], relating_structure=target,
            )
        except Exception:
            # Fallback for older ifcopenshell.api versions that took
            # `product` (singular) instead of `products`.
            try:
                ifcopenshell.api.run(
                    "spatial.assign_container", self._ifc,
                    product=element, relating_structure=target,
                )
            except Exception:
                pass
