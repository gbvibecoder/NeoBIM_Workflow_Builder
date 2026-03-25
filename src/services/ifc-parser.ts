/**
 * TR-007: IFC Quantity Extractor
 * Real IFC parsing with CSI MasterFormat mapping and waste factors
 *
 * Extracts:
 * - Element counts by type
 * - Physical quantities (area, volume, length) from IfcElementQuantity (Qto_*)
 * - Net area calculations (gross minus openings)
 * - CSI division categorization
 * - Waste factor application
 * - Professional QS-ready output
 */

import {
  IfcAPI,
  IFCBUILDINGSTOREY,
  IFCWALL,
  IFCWALLSTANDARDCASE,
  IFCWINDOW,
  IFCDOOR,
  IFCSLAB,
  IFCCOLUMN,
  IFCBEAM,
  IFCSTAIR,
  IFCRAILING,
  IFCCOVERING,
  IFCROOF,
  IFCFOOTING,
  IFCPROJECT,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELVOIDSELEMENT,
} from "web-ifc";

// ============================================================================
// TYPES
// ============================================================================

export interface QuantityData {
  count: number;
  area?: {
    gross?: number;
    net?: number;
    unit: string;
  };
  volume?: {
    base: number;
    withWaste: number;
    unit: string;
  };
  length?: number;
  width?: number;
  height?: number;
  thickness?: number;
  perimeter?: number;
  openingArea?: number;
  [key: string]: unknown;
}

export interface MaterialLayer {
  name: string;
  thickness: number; // meters
}

export interface IFCElementData {
  id: string;
  type: string;
  name: string;
  storey: string;
  material: string;
  materialLayers?: MaterialLayer[];
  quantities: QuantityData;
  properties?: Record<string, unknown>;
}

export interface CSICategory {
  code: string;
  name: string;
  elements: IFCElementData[];
}

export interface CSIDivision {
  code: string;
  name: string;
  totalVolume?: number;
  volumeWithWaste?: number;
  totalArea?: number;
  totalNetArea?: number;
  totalOpeningArea?: number;
  areaWithWaste?: number;
  wasteFactor: number;
  elementCount: number;
  categories: CSICategory[];
}

export interface BuildingStorey {
  name: string;
  elevation: number;
  height: number;
  elementCount: number;
}

export interface IFCParseResult {
  meta: {
    version: string;
    timestamp: string;
    processingTimeMs: number;
    ifcSchema: string;
    projectName: string;
    projectGuid: string;
    units: {
      length: string;
      area: string;
      volume: string;
    };
    warnings: string[];
    errors: string[];
  };
  summary: {
    totalElements: number;
    processedElements: number;
    failedElements: number;
    divisionsFound: string[];
    buildingStoreys: number;
    grossFloorArea: number;
    totalConcrete?: number;
    totalMasonry?: number;
  };
  divisions: CSIDivision[];
  buildingStoreys: BuildingStorey[];
}

// ============================================================================
// CSI MASTERFORMAT MAPPING
// ============================================================================

interface CSIMapping {
  division: string;
  divisionName: string;
  code: string;
  codeName: string;
  wasteFactor: number;
}

const DEFAULT_WASTE_FACTORS: Record<string, number> = {
  "03": 5.0,  // Concrete
  "04": 8.0,  // Masonry
  "05": 3.0,  // Metals
  "06": 10.0, // Wood
  "07": 10.0, // Thermal/Moisture
  "08": 2.0,  // Openings
  "09": 15.0, // Finishes
  default: 5.0,
};

function getCSIMapping(
  ifcType: string,
  materialName: string = ""
): CSIMapping {
  const material = materialName.toLowerCase();

  // Material-based overrides
  if (ifcType === "IfcWall" || ifcType === "IfcWallStandardCase") {
    if (material.includes("brick") || material.includes("block")) {
      return {
        division: "04",
        divisionName: "Masonry",
        code: "04 20 00",
        codeName: "Unit Masonry",
        wasteFactor: DEFAULT_WASTE_FACTORS["04"],
      };
    }
    return {
      division: "03",
      divisionName: "Concrete",
      code: "03 30 00",
      codeName: "Cast-in-Place Concrete",
      wasteFactor: DEFAULT_WASTE_FACTORS["03"],
    };
  }

  if (ifcType === "IfcColumn") {
    if (material.includes("steel")) {
      return {
        division: "05",
        divisionName: "Metals",
        code: "05 12 00",
        codeName: "Structural Steel Framing",
        wasteFactor: DEFAULT_WASTE_FACTORS["05"],
      };
    }
    return {
      division: "03",
      divisionName: "Concrete",
      code: "03 30 00",
      codeName: "Cast-in-Place Concrete",
      wasteFactor: DEFAULT_WASTE_FACTORS["03"],
    };
  }

  if (ifcType === "IfcBeam") {
    if (material.includes("timber") || material.includes("wood")) {
      return {
        division: "06",
        divisionName: "Wood, Plastics, and Composites",
        code: "06 10 00",
        codeName: "Rough Carpentry",
        wasteFactor: DEFAULT_WASTE_FACTORS["06"],
      };
    }
    return {
      division: "05",
      divisionName: "Metals",
      code: "05 12 00",
      codeName: "Structural Steel Framing",
      wasteFactor: DEFAULT_WASTE_FACTORS["05"],
    };
  }

  // Type-based mapping
  const mappings: Record<string, CSIMapping> = {
    IfcFooting: {
      division: "03",
      divisionName: "Concrete",
      code: "03 30 00",
      codeName: "Cast-in-Place Concrete",
      wasteFactor: DEFAULT_WASTE_FACTORS["03"],
    },
    IfcSlab: {
      division: "03",
      divisionName: "Concrete",
      code: "03 30 00",
      codeName: "Cast-in-Place Concrete",
      wasteFactor: DEFAULT_WASTE_FACTORS["03"],
    },
    IfcDoor: {
      division: "08",
      divisionName: "Openings",
      code: "08 10 00",
      codeName: "Doors and Frames",
      wasteFactor: DEFAULT_WASTE_FACTORS["08"],
    },
    IfcWindow: {
      division: "08",
      divisionName: "Openings",
      code: "08 50 00",
      codeName: "Windows",
      wasteFactor: DEFAULT_WASTE_FACTORS["08"],
    },
    IfcCovering: {
      division: "09",
      divisionName: "Finishes",
      code: "09 60 00",
      codeName: "Flooring",
      wasteFactor: DEFAULT_WASTE_FACTORS["09"],
    },
    IfcRoof: {
      division: "07",
      divisionName: "Thermal and Moisture Protection",
      code: "07 40 00",
      codeName: "Roofing and Siding Panels",
      wasteFactor: DEFAULT_WASTE_FACTORS["07"],
    },
    IfcStair: {
      division: "03",
      divisionName: "Concrete",
      code: "03 30 00",
      codeName: "Cast-in-Place Concrete",
      wasteFactor: DEFAULT_WASTE_FACTORS["03"],
    },
    IfcRailing: {
      division: "05",
      divisionName: "Metals",
      code: "05 52 00",
      codeName: "Metal Railings",
      wasteFactor: DEFAULT_WASTE_FACTORS["05"],
    },
  };

  return (
    mappings[ifcType] || {
      division: "00",
      divisionName: "Unknown",
      code: "00 00 00",
      codeName: "Unclassified",
      wasteFactor: DEFAULT_WASTE_FACTORS.default,
    }
  );
}

// ============================================================================
// IFC TYPES TO EXTRACT
// ============================================================================

const IFC_TYPES = [
  { typeId: IFCWALL, label: "IfcWall" },
  { typeId: IFCWALLSTANDARDCASE, label: "IfcWallStandardCase" },
  { typeId: IFCWINDOW, label: "IfcWindow" },
  { typeId: IFCDOOR, label: "IfcDoor" },
  { typeId: IFCSLAB, label: "IfcSlab" },
  { typeId: IFCCOLUMN, label: "IfcColumn" },
  { typeId: IFCBEAM, label: "IfcBeam" },
  { typeId: IFCSTAIR, label: "IfcStair" },
  { typeId: IFCRAILING, label: "IfcRailing" },
  { typeId: IFCCOVERING, label: "IfcCovering" },
  { typeId: IFCROOF, label: "IfcRoof" },
  { typeId: IFCFOOTING, label: "IfcFooting" },
];

// ============================================================================
// QUANTITY PROPERTY NAMES (ISO 16739)
// ============================================================================

const AREA_QUANTITY_NAMES = {
  gross: ["GrossSideArea", "GrossArea", "GrossFootprintArea", "GrossSurfaceArea", "TotalSurfaceArea"],
  net: ["NetSideArea", "NetArea", "NetFootprintArea", "NetSurfaceArea"],
  opening: ["TotalOpeningArea", "OpeningArea"],
  general: ["Area"],
};

const VOLUME_QUANTITY_NAMES = ["NetVolume", "GrossVolume", "Volume"];
const LENGTH_QUANTITY_NAMES = ["Length", "NominalLength"];
const WIDTH_QUANTITY_NAMES = ["Width", "NominalWidth", "Thickness"];
const HEIGHT_QUANTITY_NAMES = ["Height", "NominalHeight", "Depth"];
const PERIMETER_QUANTITY_NAMES = ["Perimeter", "GrossPerimeter"];

// ============================================================================
// QUANTITY EXTRACTION — Real IfcElementQuantity parsing
// ============================================================================

/**
 * Build a lookup map: elementExpressID → [propertyDefinitionExpressID]
 * This avoids O(n²) by iterating IfcRelDefinesByProperties once.
 */
function buildPropertyLookup(
  ifcAPI: IfcAPI,
  modelID: number,
  warnings: string[]
): Map<number, number[]> {
  const lookup = new Map<number, number[]>();

  try {
    const relIds = ifcAPI.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
    const relCount = relIds.size();

    for (let i = 0; i < relCount; i++) {
      try {
        const relId = relIds.get(i);
        const rel = ifcAPI.GetLine(modelID, relId, false);
        if (!rel) continue;

        // Get the property definition reference
        const propDefRef = rel.RelatingPropertyDefinition;
        if (!propDefRef?.value) continue;

        // Get the related objects (elements this applies to)
        const relatedObjects = rel.RelatedObjects;
        if (!relatedObjects) continue;

        const objRefs = Array.isArray(relatedObjects) ? relatedObjects : [relatedObjects];

        for (const objRef of objRefs) {
          const elementId = objRef?.value;
          if (typeof elementId !== "number") continue;

          const existing = lookup.get(elementId) || [];
          existing.push(propDefRef.value);
          lookup.set(elementId, existing);
        }
      } catch {
        // Skip malformed relationships
      }
    }
  } catch {
    warnings.push("Failed to build property lookup from IfcRelDefinesByProperties");
  }

  return lookup;
}

/**
 * Extract a numeric value from a quantity line object.
 * web-ifc returns quantity values under different property names.
 */
function getQuantityValue(quantityLine: Record<string, unknown>): number {
  // Try all known value properties
  for (const prop of [
    "AreaValue", "VolumeValue", "LengthValue", "CountValue", "WeightValue",
    "areaValue", "volumeValue", "lengthValue", "countValue", "weightValue",
  ]) {
    const entry = quantityLine[prop] as Record<string, unknown> | number | null | undefined;
    if (entry != null && typeof entry === "object" && entry.value != null) {
      return Number(entry.value);
    }
    if (typeof entry === "number") {
      return entry;
    }
  }
  return 0;
}

function extractQuantities(
  ifcAPI: IfcAPI,
  modelID: number,
  expressID: number,
  ifcType: string,
  propertyLookup: Map<number, number[]>
): QuantityData {
  const quantities: QuantityData = { count: 1 };

  try {
    const propDefIds = propertyLookup.get(expressID) || [];

    for (const propDefId of propDefIds) {
      try {
        const propDef = ifcAPI.GetLine(modelID, propDefId, false);
        if (!propDef) continue;

        // Get the Quantities array from the IfcElementQuantity
        const quantitiesRef = propDef.Quantities;
        if (!quantitiesRef) continue;

        const qRefs = Array.isArray(quantitiesRef) ? quantitiesRef : [quantitiesRef];

        for (const qRef of qRefs) {
          try {
            const qId = qRef?.value;
            if (typeof qId !== "number") continue;

            const qLine = ifcAPI.GetLine(modelID, qId, false);
            if (!qLine) continue;

            const name = qLine.Name?.value || "";
            const value = getQuantityValue(qLine);

            if (value === 0) continue;

            // Match to known quantity names
            // Area — gross
            if (AREA_QUANTITY_NAMES.gross.some((n) => name === n)) {
              if (!quantities.area) quantities.area = { unit: "m²" };
              quantities.area.gross = value;
            }
            // Area — net
            else if (AREA_QUANTITY_NAMES.net.some((n) => name === n)) {
              if (!quantities.area) quantities.area = { unit: "m²" };
              quantities.area.net = value;
            }
            // Area — opening
            else if (AREA_QUANTITY_NAMES.opening.some((n) => name === n)) {
              quantities.openingArea = value;
            }
            // Area — general fallback
            else if (AREA_QUANTITY_NAMES.general.some((n) => name === n)) {
              if (!quantities.area) quantities.area = { unit: "m²" };
              if (!quantities.area.gross) quantities.area.gross = value;
            }
            // Volume
            else if (VOLUME_QUANTITY_NAMES.some((n) => name === n)) {
              if (!quantities.volume) quantities.volume = { base: 0, withWaste: 0, unit: "m³" };
              quantities.volume.base = Math.max(quantities.volume.base, value);
            }
            // Length
            else if (LENGTH_QUANTITY_NAMES.some((n) => name === n)) {
              quantities.length = value;
            }
            // Width / Thickness
            else if (WIDTH_QUANTITY_NAMES.some((n) => name === n)) {
              quantities.width = value;
              if (name === "Thickness") quantities.thickness = value;
            }
            // Height
            else if (HEIGHT_QUANTITY_NAMES.some((n) => name === n)) {
              quantities.height = value;
            }
            // Perimeter
            else if (PERIMETER_QUANTITY_NAMES.some((n) => name === n)) {
              quantities.perimeter = value;
            }
          } catch {
            // Skip individual quantity parsing errors
          }
        }
      } catch {
        // Skip malformed property definitions
      }
    }

    // --- Calculate derived quantities when IFC didn't provide them ---

    // Net area for walls: gross - openings
    if (quantities.area?.gross && quantities.openingArea) {
      if (!quantities.area.net) {
        quantities.area.net = quantities.area.gross - quantities.openingArea;
      }
    }

    // If we have length + height but no gross area (common for walls)
    if (!quantities.area?.gross && quantities.length && quantities.height) {
      if (!quantities.area) quantities.area = { unit: "m²" };
      quantities.area.gross = quantities.length * quantities.height;
      if (quantities.openingArea) {
        quantities.area.net = quantities.area.gross - quantities.openingArea;
      }
    }

    // If we have area but no volume, estimate from thickness
    if (quantities.area?.gross && !quantities.volume?.base && quantities.thickness) {
      quantities.volume = {
        base: quantities.area.gross * quantities.thickness,
        withWaste: 0,
        unit: "m³",
      };
    }

    // For doors/windows: try to get area from width × height
    if (
      (ifcType === "IfcDoor" || ifcType === "IfcWindow") &&
      !quantities.area?.gross &&
      quantities.width &&
      quantities.height
    ) {
      if (!quantities.area) quantities.area = { unit: "m²" };
      quantities.area.gross = quantities.width * quantities.height;
    }

    // Ensure area struct exists for area-based element types
    if (
      (ifcType === "IfcWall" || ifcType === "IfcWallStandardCase" || ifcType === "IfcSlab" ||
        ifcType === "IfcRoof" || ifcType === "IfcCovering") &&
      !quantities.area
    ) {
      quantities.area = { gross: 0, net: 0, unit: "m²" };
    }

    // Ensure volume struct exists for volume-based element types
    if (
      (ifcType === "IfcColumn" || ifcType === "IfcBeam" || ifcType === "IfcFooting" ||
        ifcType === "IfcStair" || ifcType === "IfcWall" || ifcType === "IfcWallStandardCase" ||
        ifcType === "IfcSlab") &&
      !quantities.volume
    ) {
      quantities.volume = { base: 0, withWaste: 0, unit: "m³" };
    }

  } catch (error) {
    console.warn(`Failed to extract quantities for element ${expressID}:`, error);
  }

  return quantities;
}

// ============================================================================
// GEOMETRIC QUANTITY FALLBACK — compute from shape representation
// Activates PER ELEMENT when Qto property sets are missing or incomplete
// ============================================================================

function computeGeometricQuantities(
  ifcAPI: IfcAPI,
  modelID: number,
  expressID: number,
  ifcType: string,
  quantities: QuantityData
): void {
  // Only fall back if Qto gave us nothing useful
  const hasArea = (quantities.area?.gross ?? 0) > 0;
  const hasVolume = (quantities.volume?.base ?? 0) > 0;
  if (hasArea && hasVolume) return;

  try {
    const element = ifcAPI.GetLine(modelID, expressID, false);
    if (!element?.Representation?.value) return;

    const prodShape = ifcAPI.GetLine(modelID, element.Representation.value, false);
    if (!prodShape?.Representations) return;

    const reps = Array.isArray(prodShape.Representations)
      ? prodShape.Representations
      : [prodShape.Representations];

    for (const repRef of reps) {
      const repId = repRef?.value;
      if (typeof repId !== "number") continue;

      const rep = ifcAPI.GetLine(modelID, repId, false);
      if (!rep?.Items) continue;

      const items = Array.isArray(rep.Items) ? rep.Items : [rep.Items];

      for (const itemRef of items) {
        const itemId = itemRef?.value;
        if (typeof itemId !== "number") continue;

        const item = ifcAPI.GetLine(modelID, itemId, false);
        if (!item || item.Depth?.value == null) continue;

        // IFCEXTRUDEDAREASOLID: profile extruded along a direction
        const depth = Number(item.Depth.value);
        if (depth <= 0) continue;

        const profileRef = item.SweptArea?.value;
        if (typeof profileRef !== "number") continue;

        const profile = ifcAPI.GetLine(modelID, profileRef, false);
        if (!profile) continue;

        const { area: profileArea, xDim, yDim } =
          computeProfileMetrics(ifcAPI, modelID, profile);

        if (profileArea <= 0) continue;

        // Volume = profileArea × depth
        if (!hasVolume) {
          if (!quantities.volume) quantities.volume = { base: 0, withWaste: 0, unit: "m³" };
          quantities.volume.base = profileArea * depth;
        }

        // Quantities depend on element type
        if (ifcType === "IfcWall" || ifcType === "IfcWallStandardCase") {
          // Walls: XDim = length, YDim = thickness, depth = height
          if (!hasArea && xDim > 0) {
            if (!quantities.area) quantities.area = { unit: "m²" };
            quantities.area.gross = xDim * depth; // lateral area (one side)
            quantities.area.net = quantities.area.gross;
          }
          if (xDim > 0) quantities.length = xDim;
          if (yDim > 0) {
            quantities.thickness = yDim;
            quantities.width = yDim;
          }
          quantities.height = depth;
        } else if (ifcType === "IfcSlab" || ifcType === "IfcRoof" || ifcType === "IfcCovering") {
          // Slabs/roofs: profile = footprint, depth = thickness
          if (!hasArea) {
            if (!quantities.area) quantities.area = { unit: "m²" };
            quantities.area.gross = profileArea; // footprint area
            quantities.area.net = profileArea;
          }
          quantities.thickness = depth;
        } else if (ifcType === "IfcColumn" || ifcType === "IfcBeam") {
          // Columns/beams: profile = cross-section, depth = height/length
          quantities.height = depth;
        } else if (ifcType === "IfcFooting") {
          // Footings: profile = footprint, depth = thickness
          if (!hasArea) {
            if (!quantities.area) quantities.area = { unit: "m²" };
            quantities.area.gross = profileArea;
            quantities.area.net = profileArea;
          }
          quantities.thickness = depth;
        }

        return; // Found geometry, done with this element
      }
    }
  } catch {
    // Geometry extraction failed — silently fall back to count-only
  }
}

/**
 * Compute area, perimeter, xDim, yDim from an IFC profile definition.
 * Handles: RectangleProfileDef, CircleProfileDef, CircleHollowProfileDef,
 *          ArbitraryClosedProfileDef (polyline via shoelace formula).
 */
function computeProfileMetrics(
  ifcAPI: IfcAPI,
  modelID: number,
  profile: Record<string, unknown>
): { area: number; perimeter: number; xDim: number; yDim: number } {

  // IFCRECTANGLEPROFILEDEF(XDim, YDim)
  const xEntry = profile.XDim as { value?: number } | undefined;
  const yEntry = profile.YDim as { value?: number } | undefined;
  if (xEntry?.value != null && yEntry?.value != null) {
    const x = Number(xEntry.value);
    const y = Number(yEntry.value);
    return { area: x * y, perimeter: 2 * (x + y), xDim: x, yDim: y };
  }

  // IFCCIRCLEPROFILEDEF / IFCCIRCLEHOLLOWPROFILEDEF
  const rEntry = profile.Radius as { value?: number } | undefined;
  if (rEntry?.value != null) {
    const r = Number(rEntry.value);
    const tEntry = profile.WallThickness as { value?: number } | undefined;
    if (tEntry?.value != null) {
      // Hollow circle
      const t = Number(tEntry.value);
      const rInner = r - t;
      return {
        area: Math.PI * (r * r - rInner * rInner),
        perimeter: 2 * Math.PI * r,
        xDim: 2 * r,
        yDim: 2 * r,
      };
    }
    // Solid circle
    return {
      area: Math.PI * r * r,
      perimeter: 2 * Math.PI * r,
      xDim: 2 * r,
      yDim: 2 * r,
    };
  }

  // IFCARBITRARYCLOSEDPROFILEDEF(OuterCurve) — polyline → shoelace formula
  const outerCurveEntry = profile.OuterCurve as { value?: number } | undefined;
  if (outerCurveEntry?.value != null) {
    try {
      const curve = ifcAPI.GetLine(modelID, Number(outerCurveEntry.value), false);
      if (curve?.Points) {
        const pointRefs = Array.isArray(curve.Points) ? curve.Points : [curve.Points];
        const coords: [number, number][] = [];

        for (const ptRef of pointRefs) {
          const ptId = (ptRef as { value?: number })?.value;
          if (typeof ptId !== "number") continue;
          const pt = ifcAPI.GetLine(modelID, ptId, false);
          if (pt?.Coordinates) {
            const rawCoords = Array.isArray(pt.Coordinates) ? pt.Coordinates : [];
            const c = rawCoords.map((v: { value: number } | number) =>
              typeof v === "object" && v !== null ? Number(v.value) : Number(v)
            );
            if (c.length >= 2) coords.push([c[0], c[1]]);
          }
        }

        if (coords.length >= 3) {
          let area = 0;
          let perim = 0;
          for (let i = 0; i < coords.length; i++) {
            const j = (i + 1) % coords.length;
            area += coords[i][0] * coords[j][1];
            area -= coords[j][0] * coords[i][1];
            const dx = coords[j][0] - coords[i][0];
            const dy = coords[j][1] - coords[i][1];
            perim += Math.sqrt(dx * dx + dy * dy);
          }
          return { area: Math.abs(area) / 2, perimeter: perim, xDim: 0, yDim: 0 };
        }
      }
    } catch {
      // Polyline parsing failed
    }
  }

  return { area: 0, perimeter: 0, xDim: 0, yDim: 0 };
}

/**
 * Resolve material name from an IfcMaterial, IfcMaterialLayerSet,
 * IfcMaterialLayerSetUsage, IfcMaterialList, or IfcMaterialProfileSet.
 */
function resolveMaterialName(
  ifcAPI: IfcAPI,
  modelID: number,
  matId: number
): string {
  try {
    const mat = ifcAPI.GetLine(modelID, matId, false);
    if (!mat) return "";

    // IfcMaterial → direct Name
    if (mat.Name?.value && typeof mat.Name.value === "string") {
      return mat.Name.value;
    }

    // IfcMaterialLayerSet → join layer material names
    if (mat.MaterialLayers) {
      const layers = Array.isArray(mat.MaterialLayers) ? mat.MaterialLayers : [mat.MaterialLayers];
      const names: string[] = [];
      for (const layerRef of layers) {
        const layerId = (layerRef as { value?: number })?.value;
        if (typeof layerId !== "number") continue;
        const layer = ifcAPI.GetLine(modelID, layerId, false);
        const matRef = layer?.Material?.value;
        if (typeof matRef === "number") {
          const layerMat = ifcAPI.GetLine(modelID, matRef, false);
          if (layerMat?.Name?.value) names.push(layerMat.Name.value);
        }
      }
      if (names.length > 0) return names.join(" / ");
    }

    // IfcMaterialLayerSetUsage → unwrap to IfcMaterialLayerSet
    if (mat.ForLayerSet?.value != null) {
      return resolveMaterialName(ifcAPI, modelID, mat.ForLayerSet.value);
    }

    // IfcMaterialProfileSet → first profile's material
    if (mat.MaterialProfiles) {
      const profiles = Array.isArray(mat.MaterialProfiles) ? mat.MaterialProfiles : [mat.MaterialProfiles];
      for (const profRef of profiles) {
        const profId = (profRef as { value?: number })?.value;
        if (typeof profId !== "number") continue;
        const prof = ifcAPI.GetLine(modelID, profId, false);
        const profMatRef = prof?.Material?.value;
        if (typeof profMatRef === "number") {
          const profMat = ifcAPI.GetLine(modelID, profMatRef, false);
          if (profMat?.Name?.value) return profMat.Name.value;
        }
      }
    }

    // IfcMaterialList → first material
    if (mat.Materials) {
      const materials = Array.isArray(mat.Materials) ? mat.Materials : [mat.Materials];
      for (const mRef of materials) {
        const mId = (mRef as { value?: number })?.value;
        if (typeof mId !== "number") continue;
        const m = ifcAPI.GetLine(modelID, mId, false);
        if (m?.Name?.value) return m.Name.value;
      }
    }

    return "";
  } catch {
    return "";
  }
}

/**
 * Resolve material layers from an IfcMaterialLayerSet or IfcMaterialLayerSetUsage.
 * Returns individual layers with name + thickness for per-layer BOQ decomposition.
 */
function resolveMaterialLayers(
  ifcAPI: IfcAPI,
  modelID: number,
  matId: number
): MaterialLayer[] {
  try {
    const mat = ifcAPI.GetLine(modelID, matId, false);
    if (!mat) return [];

    // IfcMaterialLayerSetUsage → unwrap to IfcMaterialLayerSet
    if (mat.ForLayerSet?.value != null) {
      return resolveMaterialLayers(ifcAPI, modelID, mat.ForLayerSet.value);
    }

    // IfcMaterialLayerSet → extract each layer
    if (mat.MaterialLayers) {
      const layers = Array.isArray(mat.MaterialLayers) ? mat.MaterialLayers : [mat.MaterialLayers];
      const result: MaterialLayer[] = [];
      for (const layerRef of layers) {
        const layerId = (layerRef as { value?: number })?.value;
        if (typeof layerId !== "number") continue;
        const layer = ifcAPI.GetLine(modelID, layerId, false);
        const thickness = Number(layer?.LayerThickness?.value ?? 0);
        const matRef = layer?.Material?.value;
        let name = "Unknown";
        if (typeof matRef === "number") {
          const layerMat = ifcAPI.GetLine(modelID, matRef, false);
          if (layerMat?.Name?.value) name = layerMat.Name.value;
        }
        if (thickness > 0) {
          result.push({ name, thickness });
        }
      }
      return result;
    }

    return [];
  } catch {
    return [];
  }
}

function getMaterialName(
  ifcAPI: IfcAPI,
  modelID: number,
  expressID: number
): string {
  try {
    const element = ifcAPI.GetLine(modelID, expressID, false);
    if (element?.Name?.value) {
      return element.Name.value;
    }
    return "Unknown";
  } catch {
    return "Unknown";
  }
}


// ============================================================================
// MAIN PARSER
// ============================================================================

export async function parseIFCBuffer(
  buffer: Uint8Array,
  filename: string,
  customWasteFactors?: Record<string, number>
): Promise<IFCParseResult> {
  void filename;
  void customWasteFactors;
  const startTime = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  // Initialize web-ifc API with correct WASM path for Next.js
  const ifcAPI = new IfcAPI();
  const path = await import("path");
  const wasmDir = path.resolve(process.cwd(), "node_modules", "web-ifc") + "/";
  ifcAPI.SetWasmPath(wasmDir, true);
  await ifcAPI.Init();

  // Open model
  const modelID = ifcAPI.OpenModel(buffer, {
    COORDINATE_TO_ORIGIN: true,
  });

  // Extract metadata
  const schema = ifcAPI.GetModelSchema(modelID) || "IFC2X3";

  // Get project info
  let projectName = "Unknown Project";
  let projectGuid = "";

  try {
    const projectIDs = ifcAPI.GetLineIDsWithType(modelID, IFCPROJECT);
    if (projectIDs.size() > 0) {
      const projectID = projectIDs.get(0);
      const project = ifcAPI.GetLine(modelID, projectID, false);
      if (project?.Name?.value) {
        projectName = project.Name.value;
      }
      if (project?.GlobalId?.value) {
        projectGuid = project.GlobalId.value;
      }
    }
  } catch {
    warnings.push("Failed to extract project metadata");
  }

  // Get building storeys
  const storeyIDs = ifcAPI.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
  const storeyCount = storeyIDs.size();
  const storeyMap = new Map<number, string>();
  const buildingStoreys: BuildingStorey[] = [];

  // First pass: collect all storey elevations
  const storeyElevations: Array<{ id: number; name: string; elevation: number }> = [];
  for (let i = 0; i < storeyCount; i++) {
    const storeyID = storeyIDs.get(i);
    try {
      const storey = ifcAPI.GetLine(modelID, storeyID, false);
      const name = storey?.Name?.value || `Level ${i + 1}`;
      const elevation = storey?.Elevation?.value || 0;
      storeyElevations.push({ id: storeyID, name, elevation });
    } catch {
      warnings.push(`Failed to parse storey ${storeyID}`);
    }
  }

  // Sort by elevation ascending to compute inter-storey heights
  storeyElevations.sort((a, b) => a.elevation - b.elevation);

  for (let i = 0; i < storeyElevations.length; i++) {
    const s = storeyElevations[i];
    // Height = difference to next storey elevation, or 3.0m for top storey
    const height = i < storeyElevations.length - 1
      ? Math.max(storeyElevations[i + 1].elevation - s.elevation, 2.4)
      : 3.0; // top storey defaults to 3.0m

    storeyMap.set(s.id, s.name);
    buildingStoreys.push({
      name: s.name,
      elevation: s.elevation,
      height: Math.round(height * 100) / 100,
      elementCount: 0,
    });
  }

  // Build element → storey lookup via IfcRelContainedInSpatialStructure
  const elementStoreyLookup = new Map<number, string>();
  try {
    const relContIds = ifcAPI.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < relContIds.size(); i++) {
      try {
        const rel = ifcAPI.GetLine(modelID, relContIds.get(i), false);
        const storeyRef = rel?.RelatingStructure?.value;
        if (typeof storeyRef !== "number") continue;
        const storeyName = storeyMap.get(storeyRef) || "Unassigned";
        const relatedElements = rel?.RelatedElements;
        const refs = Array.isArray(relatedElements) ? relatedElements : [relatedElements];
        for (const ref of refs) {
          const elId = (ref as { value?: number })?.value;
          if (typeof elId === "number") elementStoreyLookup.set(elId, storeyName);
        }
      } catch { /* skip malformed relationship */ }
    }
  } catch {
    warnings.push("Failed to build storey lookup from spatial containment");
  }

  // Build element → material lookup via IfcRelAssociatesMaterial
  const elementMaterialLookup = new Map<number, string>();
  const elementMaterialLayersLookup = new Map<number, MaterialLayer[]>();
  try {
    const IFCRELASSOCIATESMATERIAL = 2655215786;
    const relMatIds = ifcAPI.GetLineIDsWithType(modelID, IFCRELASSOCIATESMATERIAL);
    for (let i = 0; i < relMatIds.size(); i++) {
      try {
        const rel = ifcAPI.GetLine(modelID, relMatIds.get(i), false);
        const matRef = rel?.RelatingMaterial?.value;
        if (typeof matRef !== "number") continue;
        const matName = resolveMaterialName(ifcAPI, modelID, matRef);
        const layers = resolveMaterialLayers(ifcAPI, modelID, matRef);
        if (!matName) continue;
        const relatedObjects = rel?.RelatedObjects;
        const refs = Array.isArray(relatedObjects) ? relatedObjects : [relatedObjects];
        for (const ref of refs) {
          const elId = (ref as { value?: number })?.value;
          if (typeof elId === "number") {
            elementMaterialLookup.set(elId, matName);
            if (layers.length > 0) elementMaterialLayersLookup.set(elId, layers);
          }
        }
      } catch { /* skip */ }
    }
  } catch {
    warnings.push("Failed to build material lookup");
  }

  // Build property lookup once (O(n) instead of O(n²))
  const propertyLookup = buildPropertyLookup(ifcAPI, modelID, warnings);

  // Build per-wall opening area lookup via IfcRelVoidsElement → IfcOpeningElement
  // This gives precise per-element net area deduction instead of aggregate distribution
  const wallOpeningAreaLookup = new Map<number, number>();
  let totalOpeningArea = 0;

  try {
    const relVoidIds = ifcAPI.GetLineIDsWithType(modelID, IFCRELVOIDSELEMENT);
    for (let i = 0; i < relVoidIds.size(); i++) {
      try {
        const rel = ifcAPI.GetLine(modelID, relVoidIds.get(i), false);
        const wallId = rel?.RelatingBuildingElement?.value;
        const openingId = rel?.RelatedOpeningElement?.value;
        if (typeof wallId !== "number" || typeof openingId !== "number") continue;

        // Compute opening area from geometry
        let openingArea = 0;
        try {
          const openingQ = extractQuantities(ifcAPI, modelID, openingId, "IfcOpeningElement", propertyLookup);
          computeGeometricQuantities(ifcAPI, modelID, openingId, "IfcOpeningElement", openingQ);
          openingArea = openingQ.area?.gross ?? (openingQ.width && openingQ.height ? openingQ.width * openingQ.height : 0);
        } catch { /* skip */ }

        if (openingArea > 0) {
          wallOpeningAreaLookup.set(wallId, (wallOpeningAreaLookup.get(wallId) || 0) + openingArea);
          totalOpeningArea += openingArea;
        }
      } catch { /* skip */ }
    }
  } catch {
    warnings.push("Failed to build per-wall opening lookup");
  }

  // Count doors and windows for metadata (used in summary)
  const doorCount = (() => { try { return ifcAPI.GetLineIDsWithType(modelID, IFCDOOR).size(); } catch { return 0; } })();
  const windowCount = (() => { try { return ifcAPI.GetLineIDsWithType(modelID, IFCWINDOW).size(); } catch { return 0; } })();
  void doorCount; void windowCount; // available for future use in summary

  // Extract elements by type
  const elementsByDivision = new Map<string, Map<string, IFCElementData[]>>();
  let totalElements = 0;
  let processedElements = 0;
  let failedElements = 0;

  for (const { typeId, label } of IFC_TYPES) {
    const ids = ifcAPI.GetLineIDsWithType(modelID, typeId);
    const count = ids.size();

    if (count === 0) continue;

    for (let i = 0; i < count; i++) {
      const expressID = ids.get(i);
      totalElements++;

      try {
        const element = ifcAPI.GetLine(modelID, expressID, false);
        const globalId = element?.GlobalId?.value || `TEMP_${expressID}`;
        const name = element?.Name?.value || `${label}-${i + 1}`;

        const materialName = elementMaterialLookup.get(expressID) || getMaterialName(ifcAPI, modelID, expressID);
        const csiMapping = getCSIMapping(label, materialName);
        const quantities = extractQuantities(ifcAPI, modelID, expressID, label, propertyLookup);

        // Geometric fallback: compute area/volume from shape representation
        // when Qto property sets are missing or incomplete
        computeGeometricQuantities(ifcAPI, modelID, expressID, label, quantities);

        // Per-wall opening deduction: deduct opening area from THIS wall's gross area
        if ((label === "IfcWall" || label === "IfcWallStandardCase") && wallOpeningAreaLookup.has(expressID)) {
          const wallOpening = wallOpeningAreaLookup.get(expressID)!;
          quantities.openingArea = wallOpening;
          if (quantities.area?.gross) {
            quantities.area.net = Math.max(0, quantities.area.gross - wallOpening);
          }
          // Also deduct volume if wall thickness is known
          if (quantities.volume?.base && quantities.thickness && quantities.area?.gross && quantities.area.gross > 0) {
            const openingVolume = wallOpening * quantities.thickness;
            quantities.volume.base = Math.max(0, quantities.volume.base - openingVolume);
          }
        }

        // Apply waste factor to volume
        if (quantities.volume) {
          quantities.volume.withWaste =
            quantities.volume.base * (1 + csiMapping.wasteFactor / 100);
        }

        const storeyName = elementStoreyLookup.get(expressID) || "Unassigned";
        // Increment storey element count
        const storeyEntry = buildingStoreys.find(s => s.name === storeyName);
        if (storeyEntry) storeyEntry.elementCount++;

        const layers = elementMaterialLayersLookup.get(expressID);
        const elementData: IFCElementData = {
          id: globalId,
          type: label,
          name,
          storey: storeyName,
          material: materialName,
          materialLayers: layers && layers.length > 1 ? layers : undefined,
          quantities,
        };

        // Organize by division and category
        if (!elementsByDivision.has(csiMapping.division)) {
          elementsByDivision.set(csiMapping.division, new Map());
        }

        const divisionMap = elementsByDivision.get(csiMapping.division)!;
        if (!divisionMap.has(csiMapping.code)) {
          divisionMap.set(csiMapping.code, []);
        }

        divisionMap.get(csiMapping.code)!.push(elementData);
        processedElements++;

      } catch {
        failedElements++;
        warnings.push(`Failed to process ${label} element ${expressID}`);
      }
    }
  }

  // Build divisions output
  const divisions: CSIDivision[] = [];
  const divisionsFound: string[] = [];

  for (const [divisionCode, categoriesMap] of elementsByDivision) {
    const categories: CSICategory[] = [];
    let divisionElementCount = 0;
    let totalVolume = 0;
    let volumeWithWaste = 0;
    let totalArea = 0;
    let totalNetArea = 0;
    let divisionOpeningArea = 0;
    let areaWithWaste = 0;

    for (const [categoryCode, elements] of categoriesMap) {
      divisionElementCount += elements.length;

      for (const element of elements) {
        if (element.quantities.volume) {
          totalVolume += element.quantities.volume.base;
          volumeWithWaste += element.quantities.volume.withWaste;
        }
        if (element.quantities.area?.gross) {
          totalArea += element.quantities.area.gross;
        }
        if (element.quantities.area?.net) {
          totalNetArea += element.quantities.area.net;
        }
        if (element.quantities.openingArea) {
          divisionOpeningArea += element.quantities.openingArea;
        }
      }

      const firstElement = elements[0];
      const csiMapping = getCSIMapping(firstElement.type, firstElement.material);

      categories.push({
        code: categoryCode,
        name: csiMapping.codeName,
        elements,
      });
    }

    const firstCategoryElement = categories[0]?.elements[0];
    const csiMapping = firstCategoryElement
      ? getCSIMapping(firstCategoryElement.type, firstCategoryElement.material)
      : { divisionName: "Unknown", wasteFactor: 5.0 };

    areaWithWaste = totalArea * (1 + csiMapping.wasteFactor / 100);

    // For wall divisions: distribute opening area if not already per-element
    const isWallDivision = categories.some((c) =>
      c.elements.some((e) => e.type === "IfcWall" || e.type === "IfcWallStandardCase")
    );
    if (isWallDivision && totalArea > 0 && divisionOpeningArea === 0 && totalOpeningArea > 0) {
      divisionOpeningArea = totalOpeningArea;
      totalNetArea = totalArea - totalOpeningArea;
    }

    divisions.push({
      code: divisionCode,
      name: csiMapping.divisionName,
      totalVolume: totalVolume > 0 ? totalVolume : undefined,
      volumeWithWaste: volumeWithWaste > 0 ? volumeWithWaste : undefined,
      totalArea: totalArea > 0 ? totalArea : undefined,
      totalNetArea: totalNetArea > 0 ? totalNetArea : undefined,
      totalOpeningArea: divisionOpeningArea > 0 ? divisionOpeningArea : undefined,
      areaWithWaste: areaWithWaste > 0 ? areaWithWaste : undefined,
      wasteFactor: csiMapping.wasteFactor,
      elementCount: divisionElementCount,
      categories,
    });

    divisionsFound.push(divisionCode);
  }

  // Sort divisions by code
  divisions.sort((a, b) => a.code.localeCompare(b.code));

  // Calculate summary — GFA from slab gross areas (floor slabs, not roof)
  const slabDivision = divisions.find((d) => d.code === "03");
  const slabGrossArea = slabDivision?.categories
    .flatMap(c => c.elements)
    .filter(e => e.type === "IfcSlab")
    .reduce((sum, e) => sum + (e.quantities.area?.gross ?? 0), 0) ?? 0;
  const grossFloorArea = slabGrossArea > 0 ? slabGrossArea : buildingStoreys.reduce((sum, s) => sum + (s.height > 0 ? 1 : 0), 0) * 100; // fallback estimate
  const totalConcrete = slabDivision?.totalVolume;
  const totalMasonry = divisions.find((d) => d.code === "04")?.totalArea;

  // Close model
  ifcAPI.CloseModel(modelID);

  const processingTimeMs = Date.now() - startTime;

  return {
    meta: {
      version: "1.0",
      timestamp: new Date().toISOString(),
      processingTimeMs,
      ifcSchema: schema,
      projectName,
      projectGuid,
      units: {
        length: "m",
        area: "m²",
        volume: "m³",
      },
      warnings,
      errors,
    },
    summary: {
      totalElements,
      processedElements,
      failedElements,
      divisionsFound,
      buildingStoreys: storeyCount,
      grossFloorArea,
      totalConcrete,
      totalMasonry,
    },
    divisions,
    buildingStoreys,
  };
}
