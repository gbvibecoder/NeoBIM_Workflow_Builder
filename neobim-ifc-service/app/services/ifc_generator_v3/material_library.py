"""Hand-curated material library for Indian construction context.

60+ materials covering structural, finishes, furniture, glass, metals,
upholstery, and plants. Each material carries RGB color, specular data,
and archetype/class hints for the deterministic resolver.

Usage:
    from material_library import resolve_material, MATERIAL_LIBRARY
    mat_id = resolve_material("teak wood floor", "residential_2bhk", "IfcCovering")
    mat = MATERIAL_LIBRARY[mat_id]
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


MaterialEntry = Dict[str, Any]

# ── Material catalogue ──────────────────────────────────────────────────
# Each entry: id, name, category, rgb, specular_rgb, transparency,
# roughness, method, ifc_class_hints, archetype_hints

MATERIAL_LIBRARY: Dict[str, MaterialEntry] = {}

def _m(
    mid: str, name: str, category: str,
    rgb: Tuple[float, float, float],
    specular: Tuple[float, float, float] = (0.1, 0.1, 0.1),
    transparency: float = 0.0,
    roughness: float = 0.5,
    method: str = "PHONG",
    ifc_hints: Optional[List[str]] = None,
    arch_hints: Optional[List[str]] = None,
) -> None:
    MATERIAL_LIBRARY[mid] = {
        "id": mid,
        "name": name,
        "category": category,
        "rgb": list(rgb),
        "specular_rgb": list(specular),
        "transparency": transparency,
        "roughness": roughness,
        "method": method,
        "ifc_class_hints": ifc_hints or [],
        "archetype_hints": arch_hints or [],
    }

# ── Structural ──────────────────────────────────────────────────────────
_m("mat-concrete-m25", "M25 Concrete", "structural", (0.75, 0.73, 0.70), roughness=0.8, method="MATT", ifc_hints=["IfcSlab", "IfcColumn", "IfcBeam", "IfcWall"])
_m("mat-concrete-m30", "M30 Concrete", "structural", (0.72, 0.70, 0.67), roughness=0.8, method="MATT", ifc_hints=["IfcSlab", "IfcColumn", "IfcBeam"])
_m("mat-concrete-m40", "M40 Concrete", "structural", (0.68, 0.66, 0.63), roughness=0.8, method="MATT", ifc_hints=["IfcColumn", "IfcBeam"])
_m("mat-rcc", "RCC (Reinforced)", "structural", (0.70, 0.68, 0.65), roughness=0.85, method="MATT", ifc_hints=["IfcSlab", "IfcColumn", "IfcBeam"])
_m("mat-brick-red", "Red Clay Brick", "structural", (0.72, 0.33, 0.22), roughness=0.9, method="MATT", ifc_hints=["IfcWall"])
_m("mat-brick-fly-ash", "Fly Ash Brick", "structural", (0.65, 0.65, 0.62), roughness=0.85, method="MATT", ifc_hints=["IfcWall"])
_m("mat-aac-block", "AAC Block", "structural", (0.85, 0.85, 0.82), roughness=0.7, method="MATT", ifc_hints=["IfcWall"])
_m("mat-stone-kota", "Kota Stone", "structural", (0.55, 0.50, 0.40), roughness=0.4, method="PHONG", ifc_hints=["IfcCovering", "IfcSlab"], arch_hints=["office", "retail"])
_m("mat-stone-granite-black", "Black Granite", "structural", (0.10, 0.10, 0.10), specular=(0.3, 0.3, 0.3), roughness=0.15, method="PHONG", ifc_hints=["IfcCovering"])
_m("mat-stone-granite-grey", "Grey Granite", "structural", (0.45, 0.45, 0.45), specular=(0.2, 0.2, 0.2), roughness=0.2, method="PHONG", ifc_hints=["IfcCovering"])
_m("mat-stone-marble-white", "White Makrana Marble", "structural", (0.95, 0.93, 0.90), specular=(0.4, 0.4, 0.4), roughness=0.1, method="PHONG", ifc_hints=["IfcCovering"], arch_hints=["residential_2bhk", "residential_3bhk"])
_m("mat-stone-sandstone", "Rajasthan Sandstone", "structural", (0.85, 0.72, 0.50), roughness=0.6, method="MATT", ifc_hints=["IfcWall", "IfcCovering"])
_m("mat-stone-laterite", "Laterite Stone", "structural", (0.65, 0.35, 0.20), roughness=0.8, method="MATT", ifc_hints=["IfcWall"])

# ── Wall finishes / paints ──────────────────────────────────────────────
_m("mat-paint-white", "White Emulsion Paint", "finish", (0.95, 0.95, 0.95), roughness=0.3, method="MATT", ifc_hints=["IfcWall", "IfcCovering"])
_m("mat-paint-cream", "Cream Emulsion", "finish", (0.96, 0.93, 0.85), roughness=0.3, method="MATT", ifc_hints=["IfcWall"])
_m("mat-paint-beige", "Beige Emulsion", "finish", (0.90, 0.85, 0.75), roughness=0.3, method="MATT", ifc_hints=["IfcWall"])
_m("mat-paint-grey-light", "Light Grey Paint", "finish", (0.82, 0.82, 0.82), roughness=0.3, method="MATT", ifc_hints=["IfcWall"])
_m("mat-paint-blue-accent", "Accent Blue", "finish", (0.20, 0.45, 0.72), roughness=0.3, method="MATT", ifc_hints=["IfcWall"], arch_hints=["office", "classroom"])
_m("mat-paint-green-accent", "Accent Green", "finish", (0.25, 0.60, 0.35), roughness=0.3, method="MATT", ifc_hints=["IfcWall"], arch_hints=["gym"])
_m("mat-paint-terracotta", "Terracotta Wash", "finish", (0.80, 0.48, 0.30), roughness=0.5, method="MATT", ifc_hints=["IfcWall"], arch_hints=["restaurant"])
_m("mat-plaster-cement", "Cement Plaster", "finish", (0.80, 0.78, 0.75), roughness=0.7, method="MATT", ifc_hints=["IfcWall"])
_m("mat-putty-white", "White Wall Putty", "finish", (0.92, 0.91, 0.89), roughness=0.25, method="MATT", ifc_hints=["IfcWall"])

# ── Floor / wall tiles ──────────────────────────────────────────────────
_m("mat-tile-vitrified-white", "White Vitrified Tile", "finish", (0.92, 0.92, 0.90), specular=(0.3, 0.3, 0.3), roughness=0.15, method="PHONG", ifc_hints=["IfcCovering"])
_m("mat-tile-vitrified-beige", "Beige Vitrified Tile", "finish", (0.88, 0.83, 0.72), specular=(0.2, 0.2, 0.2), roughness=0.15, method="PHONG", ifc_hints=["IfcCovering"])
_m("mat-tile-ceramic-white", "White Ceramic Wall Tile", "finish", (0.95, 0.95, 0.95), specular=(0.35, 0.35, 0.35), roughness=0.1, method="PHONG", ifc_hints=["IfcCovering"], arch_hints=["residential_2bhk", "residential_3bhk"])
_m("mat-tile-mosaic", "Mosaic Floor Tile", "finish", (0.70, 0.60, 0.50), roughness=0.4, method="PHONG", ifc_hints=["IfcCovering"])
_m("mat-tile-anti-skid", "Anti-Skid Tile", "finish", (0.55, 0.52, 0.48), roughness=0.8, method="MATT", ifc_hints=["IfcCovering"], arch_hints=["gym"])

# ── Wood ────────────────────────────────────────────────────────────────
_m("mat-wood-teak", "Teak Wood", "furniture", (0.62, 0.42, 0.22), specular=(0.15, 0.10, 0.05), roughness=0.35, method="PHONG", ifc_hints=["IfcFurnishingElement", "IfcDoor", "IfcCovering"], arch_hints=["residential_2bhk", "residential_3bhk", "office"])
_m("mat-wood-sheesham", "Sheesham (Indian Rosewood)", "furniture", (0.45, 0.28, 0.15), specular=(0.12, 0.08, 0.04), roughness=0.3, method="PHONG", ifc_hints=["IfcFurnishingElement", "IfcDoor"])
_m("mat-wood-sal", "Sal Wood", "furniture", (0.55, 0.38, 0.22), roughness=0.4, method="PHONG", ifc_hints=["IfcDoor", "IfcFurnishingElement"])
_m("mat-wood-pine", "Pine Wood", "furniture", (0.80, 0.68, 0.48), roughness=0.4, method="PHONG", ifc_hints=["IfcFurnishingElement"])
_m("mat-plywood", "Commercial Plywood (BWR)", "furniture", (0.75, 0.62, 0.42), roughness=0.5, method="MATT", ifc_hints=["IfcFurnishingElement"])
_m("mat-particle-board", "Particle Board (Laminated)", "furniture", (0.70, 0.58, 0.40), roughness=0.45, method="MATT", ifc_hints=["IfcFurnishingElement"])
_m("mat-mdf", "MDF Board", "furniture", (0.72, 0.60, 0.45), roughness=0.4, method="MATT", ifc_hints=["IfcFurnishingElement"])
_m("mat-laminate-white", "White Laminate", "furniture", (0.94, 0.94, 0.93), specular=(0.2, 0.2, 0.2), roughness=0.15, method="PHONG", ifc_hints=["IfcFurnishingElement"], arch_hints=["office"])
_m("mat-laminate-wood", "Wood-grain Laminate", "furniture", (0.68, 0.52, 0.35), specular=(0.15, 0.12, 0.08), roughness=0.2, method="PHONG", ifc_hints=["IfcFurnishingElement"])
_m("mat-veneer-walnut", "Walnut Veneer", "furniture", (0.40, 0.26, 0.15), specular=(0.18, 0.12, 0.08), roughness=0.25, method="PHONG", ifc_hints=["IfcFurnishingElement"])

# ── Glass ───────────────────────────────────────────────────────────────
_m("mat-glass-clear", "Clear Float Glass", "glass", (0.85, 0.92, 0.95), specular=(0.5, 0.5, 0.5), transparency=0.7, roughness=0.05, method="PHONG", ifc_hints=["IfcWindow"])
_m("mat-glass-tinted-green", "Green Tinted Glass", "glass", (0.50, 0.75, 0.55), specular=(0.4, 0.4, 0.4), transparency=0.5, roughness=0.05, method="PHONG", ifc_hints=["IfcWindow"])
_m("mat-glass-frosted", "Frosted Glass", "glass", (0.88, 0.90, 0.92), specular=(0.15, 0.15, 0.15), transparency=0.3, roughness=0.6, method="PHONG", ifc_hints=["IfcWindow", "IfcDoor"])
_m("mat-glass-toughened", "Toughened Glass (12mm)", "glass", (0.82, 0.88, 0.90), specular=(0.5, 0.5, 0.5), transparency=0.65, roughness=0.05, method="PHONG", ifc_hints=["IfcWindow", "IfcDoor"], arch_hints=["retail", "office"])

# ── Metals ──────────────────────────────────────────────────────────────
_m("mat-steel-ms", "Mild Steel (MS)", "metal", (0.50, 0.50, 0.52), specular=(0.35, 0.35, 0.35), roughness=0.3, method="METAL", ifc_hints=["IfcColumn", "IfcBeam", "IfcRailing"])
_m("mat-steel-ss", "Stainless Steel (SS 304)", "metal", (0.70, 0.72, 0.75), specular=(0.5, 0.5, 0.5), roughness=0.1, method="METAL", ifc_hints=["IfcRailing", "IfcFurnishingElement"])
_m("mat-aluminium", "Aluminium (Anodized)", "metal", (0.75, 0.77, 0.80), specular=(0.45, 0.45, 0.45), roughness=0.15, method="METAL", ifc_hints=["IfcWindow", "IfcDoor"])
_m("mat-aluminium-powder-coated", "Powder-Coated Aluminium", "metal", (0.25, 0.25, 0.28), specular=(0.3, 0.3, 0.3), roughness=0.2, method="METAL", ifc_hints=["IfcWindow"])
_m("mat-brass", "Brass", "metal", (0.80, 0.68, 0.22), specular=(0.5, 0.42, 0.15), roughness=0.15, method="METAL", ifc_hints=["IfcFurnishingElement"])
_m("mat-iron-cast", "Cast Iron", "metal", (0.30, 0.28, 0.26), roughness=0.7, method="METAL", ifc_hints=["IfcFurnishingElement"])
_m("mat-chrome", "Chrome Finish", "metal", (0.82, 0.84, 0.86), specular=(0.6, 0.6, 0.6), roughness=0.05, method="METAL", ifc_hints=["IfcFurnishingElement"], arch_hints=["gym"])

# ── Upholstery / fabric ────────────────────────────────────────────────
_m("mat-fabric-grey", "Grey Office Fabric", "upholstery", (0.50, 0.50, 0.50), roughness=0.85, method="MATT", ifc_hints=["IfcFurnishingElement"], arch_hints=["office"])
_m("mat-fabric-blue", "Blue Upholstery", "upholstery", (0.18, 0.30, 0.55), roughness=0.85, method="MATT", ifc_hints=["IfcFurnishingElement"])
_m("mat-fabric-maroon", "Maroon Upholstery", "upholstery", (0.50, 0.12, 0.12), roughness=0.85, method="MATT", ifc_hints=["IfcFurnishingElement"], arch_hints=["restaurant"])
_m("mat-leather-brown", "Brown Leather", "upholstery", (0.45, 0.30, 0.18), specular=(0.1, 0.07, 0.04), roughness=0.4, method="PHONG", ifc_hints=["IfcFurnishingElement"])
_m("mat-leather-black", "Black Leather", "upholstery", (0.08, 0.08, 0.08), specular=(0.15, 0.15, 0.15), roughness=0.35, method="PHONG", ifc_hints=["IfcFurnishingElement"])
_m("mat-rubber-gym", "Gym Rubber Mat", "upholstery", (0.15, 0.15, 0.15), roughness=0.95, method="MATT", ifc_hints=["IfcCovering"], arch_hints=["gym"])
_m("mat-carpet-grey", "Grey Loop Carpet", "upholstery", (0.45, 0.45, 0.45), roughness=0.9, method="MATT", ifc_hints=["IfcCovering"], arch_hints=["office", "exhibition"])
_m("mat-carpet-red", "Red Exhibition Carpet", "upholstery", (0.65, 0.12, 0.10), roughness=0.9, method="MATT", ifc_hints=["IfcCovering"], arch_hints=["exhibition"])

# ── Misc / special ──────────────────────────────────────────────────────
_m("mat-pvc-white", "White PVC Panel", "finish", (0.92, 0.92, 0.90), roughness=0.3, method="MATT", ifc_hints=["IfcCovering"])
_m("mat-gypsum-board", "Gypsum Plasterboard", "finish", (0.90, 0.88, 0.85), roughness=0.5, method="MATT", ifc_hints=["IfcCovering", "IfcWall"])
_m("mat-false-ceiling", "False Ceiling Grid Tile", "finish", (0.92, 0.90, 0.88), roughness=0.4, method="MATT", ifc_hints=["IfcCovering"])
_m("mat-mirror", "Mirror Glass", "glass", (0.90, 0.92, 0.95), specular=(0.8, 0.8, 0.8), transparency=0.0, roughness=0.02, method="PHONG", ifc_hints=["IfcCovering"], arch_hints=["gym"])
_m("mat-whiteboard", "Whiteboard Surface", "finish", (0.96, 0.96, 0.96), specular=(0.4, 0.4, 0.4), roughness=0.05, method="PHONG", ifc_hints=["IfcFurnishingElement"], arch_hints=["classroom", "office"])
_m("mat-chalkboard", "Chalkboard Green", "finish", (0.15, 0.28, 0.15), roughness=0.6, method="MATT", ifc_hints=["IfcFurnishingElement"], arch_hints=["classroom"])
_m("mat-plastic-white", "White ABS Plastic", "finish", (0.92, 0.92, 0.90), roughness=0.3, method="PLASTIC", ifc_hints=["IfcFurnishingElement"])
_m("mat-plastic-black", "Black ABS Plastic", "finish", (0.08, 0.08, 0.08), roughness=0.35, method="PLASTIC", ifc_hints=["IfcFurnishingElement"])
_m("mat-acrylic-signage", "Acrylic Signage", "finish", (0.85, 0.85, 0.90), specular=(0.3, 0.3, 0.3), transparency=0.1, roughness=0.1, method="PLASTIC", ifc_hints=["IfcFurnishingElement"], arch_hints=["exhibition", "retail"])
_m("mat-led-panel", "LED Panel Housing", "metal", (0.88, 0.88, 0.90), specular=(0.2, 0.2, 0.2), roughness=0.2, method="MATT", ifc_hints=["IfcLightFixture"])
_m("mat-pendant-brass", "Brass Pendant Housing", "metal", (0.75, 0.62, 0.20), specular=(0.4, 0.35, 0.12), roughness=0.2, method="METAL", ifc_hints=["IfcLightFixture"], arch_hints=["restaurant", "residential_2bhk"])
_m("mat-ceiling-fan", "Ceiling Fan (Matt White)", "metal", (0.90, 0.90, 0.88), roughness=0.4, method="MATT", ifc_hints=["IfcFurnishingElement"], arch_hints=["classroom", "residential_2bhk", "residential_3bhk"])
_m("mat-ac-unit", "AC Unit Casing", "plastic", (0.92, 0.92, 0.90), roughness=0.3, method="PLASTIC", ifc_hints=["IfcFurnishingElement"], arch_hints=["classroom", "office"])

# ── Exterior / landscape ────────────────────────────────────────────────
_m("mat-asphalt", "Asphalt Paving", "finish", (0.20, 0.20, 0.20), roughness=0.9, method="MATT", ifc_hints=["IfcCovering"])
_m("mat-grass", "Grass Ground", "landscape", (0.30, 0.55, 0.20), roughness=0.95, method="MATT", ifc_hints=["IfcCovering"])
_m("mat-soil", "Earth / Soil", "landscape", (0.45, 0.35, 0.22), roughness=0.95, method="MATT", ifc_hints=["IfcCovering"])
_m("mat-site-ground", "Site Ground Plane", "landscape", (0.55, 0.52, 0.42), roughness=0.8, method="MATT", ifc_hints=["IfcCovering"])


# ── Resolver ────────────────────────────────────────────────────────────

# Keyword → material id mappings for fast lookup
_KEYWORD_MAP: Dict[str, str] = {}
_CATEGORY_MAP: Dict[str, List[str]] = {}

def _build_indexes() -> None:
    for mid, mat in MATERIAL_LIBRARY.items():
        name_lower = mat["name"].lower()
        # Index every word in the name
        for word in name_lower.split():
            if len(word) >= 3:
                _KEYWORD_MAP.setdefault(word, mid)
        # Category index
        cat = mat["category"]
        _CATEGORY_MAP.setdefault(cat, []).append(mid)

_build_indexes()


def resolve_material(
    intent: str,
    archetype: str = "other",
    ifc_class: str = "",
) -> str:
    """Map a free-text material intent to the best library material id.

    Priority:
    1. Exact id match (if intent IS a material id)
    2. Keyword match in material name
    3. IFC class hint + archetype hint
    4. Category fallback
    5. Generic default
    """
    intent_lower = intent.lower().strip()

    # 1. Exact id match
    if intent_lower in MATERIAL_LIBRARY:
        return intent_lower

    # 2. Keyword match — score each material
    best_id = ""
    best_score = 0
    intent_words = set(intent_lower.split())

    for mid, mat in MATERIAL_LIBRARY.items():
        name_words = set(mat["name"].lower().split())
        # Word overlap score
        overlap = len(intent_words & name_words)
        score = overlap * 10

        # Substring match bonus
        if intent_lower in mat["name"].lower():
            score += 20
        if mat["name"].lower() in intent_lower:
            score += 15

        # IFC class hint bonus
        if ifc_class and ifc_class in mat.get("ifc_class_hints", []):
            score += 5

        # Archetype hint bonus
        if archetype and archetype in mat.get("archetype_hints", []):
            score += 3

        # Category keyword match
        if mat["category"] in intent_lower:
            score += 4

        if score > best_score:
            best_score = score
            best_id = mid

    if best_score >= 10:
        return best_id

    # 3. IFC class hint fallback
    for mid, mat in MATERIAL_LIBRARY.items():
        if ifc_class in mat.get("ifc_class_hints", []):
            if archetype in mat.get("archetype_hints", []):
                return mid

    for mid, mat in MATERIAL_LIBRARY.items():
        if ifc_class in mat.get("ifc_class_hints", []):
            return mid

    # 4. Category-based fallback
    for category_keyword in ["structural", "finish", "furniture"]:
        if category_keyword in intent_lower:
            mats = _CATEGORY_MAP.get(category_keyword, [])
            if mats:
                return mats[0]

    # 5. Default
    return "mat-paint-white"


def get_default_materials_for_archetype(archetype: str) -> List[MaterialEntry]:
    """Return a curated default material palette for a given archetype."""
    palettes: Dict[str, List[str]] = {
        "office": ["mat-paint-white", "mat-concrete-m25", "mat-glass-clear", "mat-laminate-white", "mat-carpet-grey", "mat-steel-ss", "mat-fabric-grey", "mat-led-panel", "mat-aluminium"],
        "residential_2bhk": ["mat-paint-cream", "mat-concrete-m25", "mat-glass-clear", "mat-wood-teak", "mat-tile-vitrified-beige", "mat-tile-ceramic-white", "mat-stone-marble-white", "mat-steel-ss", "mat-pendant-brass", "mat-ceiling-fan"],
        "residential_3bhk": ["mat-paint-cream", "mat-concrete-m30", "mat-glass-clear", "mat-wood-teak", "mat-tile-vitrified-beige", "mat-tile-ceramic-white", "mat-stone-marble-white", "mat-steel-ss", "mat-veneer-walnut", "mat-pendant-brass", "mat-ceiling-fan"],
        "gym": ["mat-paint-grey-light", "mat-concrete-m25", "mat-glass-toughened", "mat-rubber-gym", "mat-chrome", "mat-mirror", "mat-steel-ms", "mat-led-panel", "mat-paint-green-accent"],
        "exhibition": ["mat-paint-white", "mat-acrylic-signage", "mat-carpet-red", "mat-aluminium", "mat-glass-clear", "mat-led-panel", "mat-laminate-white", "mat-steel-ss"],
        "retail": ["mat-paint-white", "mat-glass-toughened", "mat-tile-vitrified-white", "mat-laminate-wood", "mat-steel-ss", "mat-led-panel", "mat-aluminium"],
        "restaurant": ["mat-paint-terracotta", "mat-wood-sheesham", "mat-glass-frosted", "mat-tile-mosaic", "mat-leather-brown", "mat-fabric-maroon", "mat-pendant-brass", "mat-brass"],
        "classroom": ["mat-paint-cream", "mat-concrete-m25", "mat-glass-clear", "mat-plywood", "mat-whiteboard", "mat-tile-vitrified-beige", "mat-ceiling-fan", "mat-ac-unit", "mat-led-panel"],
    }
    ids = palettes.get(archetype, palettes["office"])
    return [MATERIAL_LIBRARY[mid] for mid in ids if mid in MATERIAL_LIBRARY]
