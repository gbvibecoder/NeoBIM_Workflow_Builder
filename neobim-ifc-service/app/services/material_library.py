"""Material layer presets by building type for IfcMaterialLayerSet creation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import new_guid


@dataclass
class LayerDef:
    """A single material layer definition."""
    name: str
    thickness: float  # metres
    category: str = ""  # e.g. "Finish", "Structure", "Insulation"


@dataclass
class MaterialPreset:
    """A named set of layers for a wall or slab."""
    name: str
    layers: list[LayerDef]


# ── Wall presets by building type ────────────────────────────────────

WALL_PRESETS: dict[str, MaterialPreset] = {
    "residential": MaterialPreset(
        name="Residential Exterior Wall",
        layers=[
            LayerDef("Gypsum Plaster", 0.015, "Finish"),
            LayerDef("Masonry Block", 0.200, "Structure"),
            LayerDef("EPS Insulation", 0.080, "Insulation"),
            LayerDef("Cement Render", 0.015, "Finish"),
        ],
    ),
    "office": MaterialPreset(
        name="Commercial Curtain Wall",
        layers=[
            LayerDef("Gypsum Board", 0.013, "Finish"),
            LayerDef("Reinforced Concrete", 0.200, "Structure"),
            LayerDef("Mineral Wool", 0.100, "Insulation"),
            LayerDef("Aluminium Composite Panel", 0.006, "Finish"),
        ],
    ),
    "commercial": MaterialPreset(
        name="Commercial Exterior Wall",
        layers=[
            LayerDef("Gypsum Board", 0.013, "Finish"),
            LayerDef("Reinforced Concrete", 0.200, "Structure"),
            LayerDef("Mineral Wool", 0.100, "Insulation"),
            LayerDef("Aluminium Composite Panel", 0.006, "Finish"),
        ],
    ),
    "industrial": MaterialPreset(
        name="Industrial Wall",
        layers=[
            LayerDef("Precast Concrete", 0.200, "Structure"),
            LayerDef("PIR Insulation", 0.080, "Insulation"),
            LayerDef("Profiled Metal Sheet", 0.002, "Finish"),
        ],
    ),
    "healthcare": MaterialPreset(
        name="Healthcare Wall",
        layers=[
            LayerDef("Antimicrobial Panel", 0.015, "Finish"),
            LayerDef("Reinforced Concrete", 0.200, "Structure"),
            LayerDef("Mineral Wool", 0.100, "Insulation"),
            LayerDef("Cement Render", 0.015, "Finish"),
        ],
    ),
}

PARTITION_PRESET = MaterialPreset(
    name="Interior Partition",
    layers=[
        LayerDef("Gypsum Board", 0.013, "Finish"),
        LayerDef("Steel Stud + Mineral Wool", 0.075, "Structure"),
        LayerDef("Gypsum Board", 0.013, "Finish"),
    ],
)

# ── Slab presets ─────────────────────────────────────────────────────

SLAB_PRESETS: dict[str, MaterialPreset] = {
    "residential": MaterialPreset(
        name="Residential Floor Slab",
        layers=[
            LayerDef("Ceramic Tile", 0.010, "Finish"),
            LayerDef("Cement Screed", 0.050, "Finish"),
            LayerDef("Reinforced Concrete", 0.200, "Structure"),
        ],
    ),
    "office": MaterialPreset(
        name="Office Floor Slab",
        layers=[
            LayerDef("Raised Floor Panel", 0.040, "Finish"),
            LayerDef("Insulation Board", 0.050, "Insulation"),
            LayerDef("Reinforced Concrete", 0.300, "Structure"),
        ],
    ),
    "commercial": MaterialPreset(
        name="Commercial Floor Slab",
        layers=[
            LayerDef("Polished Concrete", 0.010, "Finish"),
            LayerDef("Reinforced Concrete", 0.250, "Structure"),
            LayerDef("Insulation Board", 0.050, "Insulation"),
        ],
    ),
    "industrial": MaterialPreset(
        name="Industrial Slab on Grade",
        layers=[
            LayerDef("Reinforced Concrete", 0.250, "Structure"),
            LayerDef("DPM Membrane", 0.002, "Insulation"),
            LayerDef("Compacted Gravel", 0.150, "Structure"),
        ],
    ),
    "healthcare": MaterialPreset(
        name="Healthcare Floor",
        layers=[
            LayerDef("Vinyl Sheet", 0.005, "Finish"),
            LayerDef("Self-Levelling Screed", 0.030, "Finish"),
            LayerDef("Reinforced Concrete", 0.250, "Structure"),
        ],
    ),
}

# ── Roof presets ─────────────────────────────────────────────────────

ROOF_PRESET = MaterialPreset(
    name="Flat Roof Assembly",
    layers=[
        LayerDef("Waterproof Membrane", 0.005, "Finish"),
        LayerDef("Rigid Insulation", 0.100, "Insulation"),
        LayerDef("Reinforced Concrete", 0.250, "Structure"),
        LayerDef("Gypsum Plaster", 0.015, "Finish"),
    ],
)


def _resolve_type(building_type: str) -> str:
    """Normalize building type string to a known preset key."""
    bt = building_type.lower()
    for key in ("residential", "office", "commercial", "industrial", "healthcare"):
        if key in bt:
            return key
    if any(w in bt for w in ("apartment", "house", "villa", "condo")):
        return "residential"
    if any(w in bt for w in ("hospital", "clinic", "medical")):
        return "healthcare"
    if any(w in bt for w in ("warehouse", "factory", "plant")):
        return "industrial"
    return "office"  # default


def get_wall_preset(building_type: str, is_partition: bool = False) -> MaterialPreset:
    if is_partition:
        return PARTITION_PRESET
    return WALL_PRESETS.get(_resolve_type(building_type), WALL_PRESETS["office"])


def get_slab_preset(building_type: str) -> MaterialPreset:
    return SLAB_PRESETS.get(_resolve_type(building_type), SLAB_PRESETS["office"])


def get_roof_preset() -> MaterialPreset:
    return ROOF_PRESET


# ── IfcOpenShell helpers ─────────────────────────────────────────────


def create_material_layer_set(
    model: ifcopenshell.file,
    preset: MaterialPreset,
) -> ifcopenshell.entity_instance:
    """Create an IfcMaterialLayerSet from a preset definition."""
    layers = []
    for layer_def in preset.layers:
        material = api.run("material.add_material", model, name=layer_def.name)
        if layer_def.category:
            material.Category = layer_def.category
        layer = api.run(
            "material.add_layer",
            model,
            layer_set=None,  # will be assigned below
            material=material,
        )
        layer.LayerThickness = layer_def.thickness
        layer.Name = layer_def.name
        if layer_def.category:
            layer.Category = layer_def.category
        layers.append(layer)

    layer_set = model.create_entity(
        "IfcMaterialLayerSet",
        MaterialLayers=layers,
        LayerSetName=preset.name,
    )
    return layer_set


def assign_material_to_element(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    layer_set: ifcopenshell.entity_instance,
) -> None:
    """Assign an IfcMaterialLayerSet to an element via IfcRelAssociatesMaterial."""
    layer_set_usage = model.create_entity(
        "IfcMaterialLayerSetUsage",
        ForLayerSet=layer_set,
        LayerSetDirection="AXIS2",
        DirectionSense="POSITIVE",
        OffsetFromReferenceLine=0.0,
    )
    model.create_entity(
        "IfcRelAssociatesMaterial",
        GlobalId=new_guid(),
        RelatedObjects=[element],
        RelatingMaterial=layer_set_usage,
    )
