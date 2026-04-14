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
  IFCBUILDINGELEMENTPROXY,
  IFCMEMBER,
  IFCPLATE,
  IFCCURTAINWALL,
  IFCPROJECT,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELVOIDSELEMENT,
} from "web-ifc";

// ─── Additional IFC type constants (not directly exported) ──────────────────
const IFCREINFORCINGBAR = 979691226;
// Diagnostic-only entity IDs — used for file-metadata scans, never for BOQ logic.
const IFCAPPLICATION = 639542469;
const IFCPROPERTYSET_TYPE = 1451395588;
const IFCELEMENTQUANTITY_TYPE = 1883228015;
const IFCSPACE_TYPE = 3856911033;
// Geometry representation type IDs — used by diagnostics to classify why
// `computeGeometricQuantities` either succeeded or failed for an element.
const IFC_GEOM_BOOLEAN_RESULT = 2736907675;
const IFC_GEOM_BOOLEAN_CLIPPING_RESULT = 4182860854;
const IFC_GEOM_FACETED_BREP = 807026263;
const IFC_GEOM_EXTRUDED_AREA_SOLID = 477187591;
const IFC_GEOM_MAPPED_ITEM = 1525564444;
const IFC_GEOM_BOUNDING_BOX = 2581212453;
const IFCDUCTSEGMENT = 3518393246;
const IFCPIPESEGMENT = 3612865200;
const IFCCABLESEGMENT = 4217484030;
const IFCCABLECARRIERSEGMENT = 3758799889;
const IFCDUCTFITTING = 342316401;
const IFCPIPEFITTING = 310824031;
const IFCCABLEFITTING = 1051757585;
const IFCCABLECARRIERFITTING = 635142910;
const IFCFLOWCONTROLLER = 2058353004;
const IFCFLOWMOVINGDEVICE = 3132237377;
const IFCFLOWTERMINAL_TYPE = 2223149337;
const IFCFLOWSTORAGEDEVICE = 707683696;
const IFCFLOWTREATMENTDEVICE = 3508470533;

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
  weight?: {
    gross?: number;
    net?: number;
    unit: string; // "kg"
  };
  length?: number;
  width?: number;
  height?: number;
  thickness?: number;
  perimeter?: number;
  openingArea?: number;
  crossSectionArea?: number;
  outerSurfaceArea?: number;
  footprintArea?: number;
  /** Where the primary quantity values came from */
  quantitySource?: "qto_standard" | "custom" | "geometry_calculated";
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

/** Pre-extraction model quality assessment — flags modeling issues that
 *  degrade BOQ accuracy. Computed during parsing, consumed by TR-008 and
 *  the BOQ Visualizer's IFCQualityCard component. */
export interface ModelQualityReport {
  /** Elements with visual representation but zero or undefined volume */
  zeroVolumeElements: { count: number; types: string[] };
  /** Elements without any IfcMaterial / IfcMaterialLayerSet association */
  noMaterialElements: { count: number; types: string[] };
  /** Elements not linked to any IfcBuildingStorey via IfcRelContainedInSpatialStructure */
  unassignedStoreyElements: { count: number; types: string[] };
  /** Walls/slabs with implausible thickness (walls >1000mm or <50mm, slabs >500mm or <50mm) */
  suspiciousDimensions: Array<{
    elementType: string;
    name: string;
    dimension: string; // "thickness"
    value: number;     // meters
    expected: string;  // "50mm–1000mm"
  }>;
  /** Elements at same coordinates with same type (potential double-count) */
  duplicateElements: { count: number; estimatedImpact: string };
  /** Whether the project unit is non-metric and was converted */
  unitConversion: {
    detectedUnit: string;    // "METRE", "FOOT", "INCH", etc.
    conversionApplied: boolean;
    conversionFactor: number; // multiplier to get meters (1.0 if already metric)
  };
  /** Overall model quality score (0-100) derived from the checks above */
  score: number;
  /** Quality label derived from score */
  label: "EXCELLENT" | "GOOD" | "FAIR" | "LIMITED";
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
  /** Model quality assessment — flags issues that affect BOQ accuracy */
  modelQuality?: ModelQualityReport;
  /** Optional diagnostic counters populated when caller passes a diagnostics object */
  parserDiagnostics?: ParserDiagnosticCounters;
}

/** File-level metadata captured at parse start — answers "what kind of IFC is this?" */
export interface ParserFileMetadata {
  fileSizeBytes: number;
  ifcSchema: string;
  authoringApplication?: string;
  authoringApplicationVersion?: string;
  fileName?: string;
  totalEntityCount: number;       // STEP line count
  totalProductCount: number;      // IfcProduct subtype count BEFORE aggregation
  qtoBaseSetCount: number;        // # of Qto_*BaseQuantities sets found
  customQuantitySetCount: number; // # of IfcElementQuantity NOT starting with Qto_
  propertySetCount: number;       // # of IfcPropertySet entities
  hasIfcSpaces: boolean;
  geometryTypesPresent: string[]; // distinct IfcRepresentationItem subtypes present in file
}

/** Per-element diagnostic capturing why a specific element ended up with X quantity. */
export interface ElementDiagnostic {
  expressId: number;
  ifcType: string;
  storey: string;
  material: string | null;
  geometryType: string | null;     // "IfcExtrudedAreaSolid" | "IfcBooleanResult" | …
  quantitySource: string | null;   // "qto_standard" | "custom" | "geometry_calculated" | "none"
  grossArea: number;
  volume: number;
  hasZeroQuantity: boolean;
  /** Compact array describing the fallback chain attempted, e.g.
   *  ["Qto:miss", "PropSet:miss", "Geom:IfcBooleanResult:unsupported", "BBox:miss", "Result:count_only"] */
  fallbackChain: string[];
  failureReason?: string;
}

/** Wall-clock timings of major parser phases — answers "where did the time go?" */
export interface ParserTimings {
  wasmInitMs: number;
  modelLoadMs: number;
  metadataScanMs: number;
  storeyScanMs: number;
  materialResolveMs: number;
  propertyExtractMs: number;
  elementProcessMs: number;
  aggregationMs: number;
  totalMs: number;
}

/**
 * Diagnostic counters mutated in-place during parsing. When the caller passes
 * one of these to `parseIFCBuffer`, the parser populates per-element breakdowns
 * (geometry strategy used, material association type) so downstream nodes can
 * surface why specific elements ended up with zero quantities.
 */
export interface ParserDiagnosticCounters {
  geometryTypes: {
    extrudedAreaSolid: number;
    booleanResult: number;
    facetedBrep: number;
    mappedItem: number;
    boundingBox: number;
    other: number;
    failed: number;
  };
  materialTypes: {
    ifcMaterial: number;
    layerSet: number;
    constituentSet: number;
    profileSet: number;
    materialList: number;
    none: number;
  };
  /** Per-element warnings — capped to first 50 to keep payload bounded */
  elementWarnings: string[];
  /** File-level metadata captured at parse start. */
  fileMetadata?: ParserFileMetadata;
  /** First 20 element diagnostics — prioritizes failed/zero-quantity elements
   *  so the panel can show concrete "why X failed" examples. */
  elementSamples: ElementDiagnostic[];
  /** Phase timings — populated incrementally during parse. */
  timings: ParserTimings;
  /** Smart, actionable warnings derived from the diagnostic data after parse. */
  smartWarnings: string[];
  /** Suggested fixes corresponding to smart warnings (parallel array). */
  smartFixes: string[];
}

export function createParserDiagnosticCounters(): ParserDiagnosticCounters {
  return {
    geometryTypes: { extrudedAreaSolid: 0, booleanResult: 0, facetedBrep: 0, mappedItem: 0, boundingBox: 0, other: 0, failed: 0 },
    materialTypes: { ifcMaterial: 0, layerSet: 0, constituentSet: 0, profileSet: 0, materialList: 0, none: 0 },
    elementWarnings: [],
    elementSamples: [],
    timings: { wasmInitMs: 0, modelLoadMs: 0, metadataScanMs: 0, storeyScanMs: 0, materialResolveMs: 0, propertyExtractMs: 0, elementProcessMs: 0, aggregationMs: 0, totalMs: 0 },
    smartWarnings: [],
    smartFixes: [],
  };
}

const ELEMENT_SAMPLE_CAP = 20;

/** Reverse map of geometry type IDs → human-readable name. */
const GEOM_TYPE_NAME: Record<number, string> = {
  477187591: "IfcExtrudedAreaSolid",
  2736907675: "IfcBooleanResult",
  4182860854: "IfcBooleanClippingResult",
  807026263: "IfcFacetedBrep",
  1525564444: "IfcMappedItem",
  2581212453: "IfcBoundingBox",
};

/** Generate actionable warnings from collected diagnostic data. */
function generateSmartWarnings(
  counters: ParserDiagnosticCounters,
  totalElements: number,
  zeroCount: number,
): { warnings: string[]; fixes: string[] } {
  const warnings: string[] = [];
  const fixes: string[] = [];
  const meta = counters.fileMetadata;
  const g = counters.geometryTypes;
  const failedGeom = g.booleanResult + g.facetedBrep + g.failed;
  const supportedGeom = g.extrudedAreaSolid + g.mappedItem + g.boundingBox;

  // Critical: nothing has quantities
  if (totalElements > 0 && zeroCount === totalElements) {
    warnings.push(
      `⚠ CRITICAL: All ${totalElements} elements have zero area/volume. ` +
      `Quantities default to element COUNTS, not measurements — BOQ accuracy is severely limited.`
    );
  } else if (zeroCount > totalElements * 0.5) {
    warnings.push(
      `⚠ ${zeroCount} of ${totalElements} elements (${Math.round(zeroCount / totalElements * 100)}%) have zero quantities. ` +
      `BOQ totals will be significantly understated.`
    );
  }

  // Missing Qto sets
  if (meta && meta.qtoBaseSetCount === 0 && totalElements > 0) {
    const author = meta.authoringApplication || "the BIM tool";
    warnings.push(
      `⚠ This file was authored by ${author} and contains 0 Qto_* base quantity sets. ` +
      `IFC base quantities (Qto_WallBaseQuantities, Qto_SlabBaseQuantities, etc.) are the gold-standard source of measurements.`
    );
    fixes.push(
      `💡 Re-export the IFC with "Export Base Quantities" enabled. ` +
      (author.toLowerCase().includes("revit")
        ? `In Revit: File → Export → IFC → Modify Setup → Property Sets → check "Export base quantities".`
        : author.toLowerCase().includes("archicad")
          ? `In ArchiCAD: File → Interoperability → IFC → IFC Translators → enable "IFC Base Quantities".`
          : `In your BIM tool's IFC export settings, enable "Export Base Quantities" or "IFC Base Quantities".`)
    );
  }

  // Unsupported geometry types
  if (failedGeom > 0 && supportedGeom === 0) {
    const types: string[] = [];
    if (g.facetedBrep > 0) types.push(`${g.facetedBrep} IfcFacetedBrep`);
    if (g.booleanResult > 0) types.push(`${g.booleanResult} IfcBooleanResult`);
    if (g.failed > 0) types.push(`${g.failed} unrecognized`);
    warnings.push(
      `⚠ All geometry uses representations the WASM parser cannot tessellate (${types.join(", ")}). ` +
      `web-ifc handles IfcExtrudedAreaSolid natively but cannot compute measurements from boolean operations or arbitrary BReps without a full geometry kernel.`
    );
    fixes.push(
      `💡 Deploy the IfcOpenShell microservice (see docs/ifcopenshell-microservice-architecture.md) ` +
      `for server-side geometry processing of complex representations. ` +
      `Alternatively, ask the modeler to export with "Use Tessellated Geometry" instead of "Use Advanced Surfaces".`
    );
  } else if (failedGeom > 0 && failedGeom > totalElements * 0.3) {
    warnings.push(
      `⚠ ${failedGeom} elements (${Math.round(failedGeom / totalElements * 100)}%) use unsupported geometry — these contribute zero measurable quantities.`
    );
  }

  // Materials missing
  if (counters.materialTypes.none > totalElements * 0.5 && totalElements > 0) {
    warnings.push(
      `⚠ ${counters.materialTypes.none} elements have no material assignment. ` +
      `Cost mapping uses default material rates which may not match the project specification.`
    );
    fixes.push(`💡 Assign materials to all structural elements in the BIM model before export.`);
  }

  // Counts-as-quantities consequence
  if (totalElements > 0 && zeroCount === totalElements && counters.materialTypes.none < totalElements) {
    warnings.push(
      `💡 BOQ will use COUNT × default volume estimates. Real measurements may differ ±50–200%. ` +
      `Cost-per-sqm benchmarks will likely flag the result as anomalous.`
    );
  }

  // Authoring tool note
  if (meta?.authoringApplication) {
    const lower = meta.authoringApplication.toLowerCase();
    if (lower.includes("bimcollab") || lower.includes("solibri")) {
      warnings.push(
        `ℹ This file came from ${meta.authoringApplication}, which is a coordination/review tool. ` +
        `Coordination IFCs typically lack base quantities. Source the file from the original Revit/ArchiCAD model for accurate quantities.`
      );
    }
  }

  return { warnings, fixes };
}

/** Identify which IFC material association entity an element uses. */
function classifyMaterialAssociation(
  ifcAPI: IfcAPI,
  modelID: number,
  matId: number,
): "ifcMaterial" | "layerSet" | "constituentSet" | "profileSet" | "materialList" | "none" {
  try {
    const mat = ifcAPI.GetLine(modelID, matId, false);
    if (!mat) return "none";
    if (mat.MaterialLayers || mat.ForLayerSet?.value != null) return "layerSet";
    if (mat.MaterialConstituents ?? mat.Constituents) return "constituentSet";
    if (mat.MaterialProfiles) return "profileSet";
    if (mat.Materials) return "materialList";
    if (mat.Name?.value) return "ifcMaterial";
  } catch { /* fall through */ }
  return "none";
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
  "22": 5.0,  // Plumbing
  "23": 8.0,  // HVAC
  "26": 3.0,  // Electrical
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
    // IfcBuildingElementProxy — generic catch-all used by Allplan, Tekla, precast exports
    // Infer division from material name if possible, default to Concrete (most common)
    IfcBuildingElementProxy: material.includes("steel")
      ? { division: "05", divisionName: "Metals", code: "05 12 00", codeName: "Structural Steel Framing", wasteFactor: DEFAULT_WASTE_FACTORS["05"] }
      : material.includes("timber") || material.includes("wood")
        ? { division: "06", divisionName: "Wood, Plastics, and Composites", code: "06 10 00", codeName: "Rough Carpentry", wasteFactor: DEFAULT_WASTE_FACTORS["06"] }
        : material.includes("brick") || material.includes("block") || material.includes("masonry")
          ? { division: "04", divisionName: "Masonry", code: "04 20 00", codeName: "Unit Masonry", wasteFactor: DEFAULT_WASTE_FACTORS["04"] }
          : { division: "03", divisionName: "Concrete", code: "03 30 00", codeName: "Cast-in-Place Concrete (Proxy Element)", wasteFactor: DEFAULT_WASTE_FACTORS["03"] },
    IfcMember: {
      division: "05",
      divisionName: "Metals",
      code: "05 12 00",
      codeName: "Structural Steel Members",
      wasteFactor: DEFAULT_WASTE_FACTORS["05"],
    },
    IfcPlate: {
      division: "05",
      divisionName: "Metals",
      code: "05 50 00",
      codeName: "Metal Fabrications",
      wasteFactor: DEFAULT_WASTE_FACTORS["05"],
    },
    IfcReinforcingBar: {
      division: "03",
      divisionName: "Concrete",
      code: "03 21 00",
      codeName: "Reinforcement Bars",
      wasteFactor: 0.10, // 10% waste for rebar cutting
    },
    IfcCurtainWall: {
      division: "08",
      divisionName: "Openings",
      code: "08 44 00",
      codeName: "Curtain Wall and Glazed Assemblies",
      wasteFactor: DEFAULT_WASTE_FACTORS["08"],
    },
    // ── MEP — HVAC (Division 23) ──
    IfcDuctSegment: {
      division: "23", divisionName: "HVAC", code: "23 31 00",
      codeName: "HVAC Ducts and Casings", wasteFactor: DEFAULT_WASTE_FACTORS["23"],
    },
    IfcDuctFitting: {
      division: "23", divisionName: "HVAC", code: "23 31 00",
      codeName: "Duct Fittings", wasteFactor: DEFAULT_WASTE_FACTORS["23"],
    },
    IfcFlowController: {
      division: "23", divisionName: "HVAC", code: "23 09 00",
      codeName: "Instrumentation and Control for HVAC", wasteFactor: 2.0,
    },
    IfcFlowMovingDevice: {
      division: "23", divisionName: "HVAC", code: "23 34 00",
      codeName: "HVAC Fans", wasteFactor: 2.0,
    },
    IfcFlowTerminal: {
      division: "23", divisionName: "HVAC", code: "23 37 00",
      codeName: "Air Outlets and Inlets", wasteFactor: 3.0,
    },
    IfcFlowTreatmentDevice: {
      division: "23", divisionName: "HVAC", code: "23 41 00",
      codeName: "Particulate Air Filtration", wasteFactor: 3.0,
    },
    // ── MEP — Plumbing (Division 22) ──
    IfcPipeSegment: {
      division: "22", divisionName: "Plumbing", code: "22 11 00",
      codeName: "Facility Water Distribution Piping", wasteFactor: DEFAULT_WASTE_FACTORS["22"],
    },
    IfcPipeFitting: {
      division: "22", divisionName: "Plumbing", code: "22 11 00",
      codeName: "Pipe Fittings", wasteFactor: DEFAULT_WASTE_FACTORS["22"],
    },
    IfcFlowStorageDevice: {
      division: "22", divisionName: "Plumbing", code: "22 11 00",
      codeName: "Water Storage", wasteFactor: 2.0,
    },
    // ── MEP — Electrical (Division 26) ──
    IfcCableSegment: {
      division: "26", divisionName: "Electrical", code: "26 05 19",
      codeName: "Low-Voltage Electrical Power Conductors and Cables", wasteFactor: DEFAULT_WASTE_FACTORS["26"],
    },
    IfcCableCarrierSegment: {
      division: "26", divisionName: "Electrical", code: "26 05 29",
      codeName: "Hangers and Supports for Electrical Systems", wasteFactor: DEFAULT_WASTE_FACTORS["26"],
    },
    IfcCableFitting: {
      division: "26", divisionName: "Electrical", code: "26 05 19",
      codeName: "Cable Fittings", wasteFactor: DEFAULT_WASTE_FACTORS["26"],
    },
    IfcCableCarrierFitting: {
      division: "26", divisionName: "Electrical", code: "26 05 29",
      codeName: "Cable Tray Fittings", wasteFactor: DEFAULT_WASTE_FACTORS["26"],
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
  // Common in Allplan, Tekla, precast exports — elements not fitting standard types
  { typeId: IFCBUILDINGELEMENTPROXY, label: "IfcBuildingElementProxy" },
  // Structural members (steel connections, bracing, purlins)
  { typeId: IFCMEMBER, label: "IfcMember" },
  // Plates (steel plates, panels, cladding sheets)
  { typeId: IFCPLATE, label: "IfcPlate" },
  // Curtain walls (glass facades)
  { typeId: IFCCURTAINWALL, label: "IfcCurtainWall" },
  // Reinforcing bars (when modeled in structural IFC — gives exact rebar weight)
  { typeId: IFCREINFORCINGBAR, label: "IfcReinforcingBar" },
  // ── MEP — HVAC (Division 23) ──
  { typeId: IFCDUCTSEGMENT, label: "IfcDuctSegment" },
  { typeId: IFCDUCTFITTING, label: "IfcDuctFitting" },
  { typeId: IFCFLOWCONTROLLER, label: "IfcFlowController" },
  { typeId: IFCFLOWMOVINGDEVICE, label: "IfcFlowMovingDevice" },
  { typeId: IFCFLOWTERMINAL_TYPE, label: "IfcFlowTerminal" },
  { typeId: IFCFLOWTREATMENTDEVICE, label: "IfcFlowTreatmentDevice" },
  // ── MEP — Plumbing (Division 22) ──
  { typeId: IFCPIPESEGMENT, label: "IfcPipeSegment" },
  { typeId: IFCPIPEFITTING, label: "IfcPipeFitting" },
  { typeId: IFCFLOWSTORAGEDEVICE, label: "IfcFlowStorageDevice" },
  // ── MEP — Electrical (Division 26) ──
  { typeId: IFCCABLESEGMENT, label: "IfcCableSegment" },
  { typeId: IFCCABLECARRIERSEGMENT, label: "IfcCableCarrierSegment" },
  { typeId: IFCCABLEFITTING, label: "IfcCableFitting" },
  { typeId: IFCCABLECARRIERFITTING, label: "IfcCableCarrierFitting" },
];

// ============================================================================
// QUANTITY PROPERTY NAMES (ISO 16739)
// ============================================================================

const AREA_QUANTITY_NAMES = {
  gross: ["GrossSideArea", "GrossArea", "GrossFootprintArea", "GrossSurfaceArea", "TotalSurfaceArea"],
  net: ["NetSideArea", "NetArea", "NetFootprintArea", "NetSurfaceArea"],
  opening: ["TotalOpeningArea", "OpeningArea"],
  general: ["Area", "FootprintArea"],
};

/** Cross-section area (columns, beams, piles) — used for structural steel weight calc */
const CROSS_SECTION_NAMES = ["CrossSectionArea", "GrossCrossSectionArea", "NetCrossSectionArea"];
/** Outer surface area — used for painting/cladding takeoff */
const OUTER_SURFACE_NAMES = ["OuterSurfaceArea"];
/** Footprint area — used for excavation/waterproofing */
const FOOTPRINT_NAMES = ["GrossFootprintArea", "NetFootprintArea", "FootprintArea"];

const VOLUME_QUANTITY_NAMES = ["NetVolume", "GrossVolume", "Volume"];
/** Weight quantities (IFC 4.x) — critical for structural steel BOQ in tonnes */
const WEIGHT_QUANTITY_NAMES = ["GrossWeight", "NetWeight", "Weight"];
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

    // ── Qto_* Prioritization ──
    // IFC standard base quantity sets (Qto_WallBaseQuantities, Qto_SlabBaseQuantities, etc.)
    // are computed by the authoring tool from parametric geometry — they are the gold standard.
    // Custom IfcElementQuantity sets may be wrong, manually entered, or from plugins.
    // Strategy: process ALL property sets, but track which values came from Qto_* sets.
    // Qto_* values always overwrite custom values. Custom values only fill gaps.
    let hasQtoValues = false;   // did we find any Qto_* quantity set?
    let hasCustomValues = false; // did we find any custom quantity set?
    // Track which fields have been set by a Qto_* standard set — these must not be overwritten
    const qtoLockedFields = new Set<string>();

    for (const propDefId of propDefIds) {
      try {
        const propDef = ifcAPI.GetLine(modelID, propDefId, false);
        if (!propDef) continue;

        // ── Read IfcPropertySet (Pset) properties ──
        // Extracts ConcreteGrade, IsExternal, LoadBearing, FireRating, etc.
        const hasProperties = propDef.HasProperties;
        if (hasProperties && !propDef.Quantities) {
          const propRefs = Array.isArray(hasProperties) ? hasProperties : [hasProperties];
          for (const propRef of propRefs) {
            try {
              const propId = propRef?.value;
              if (typeof propId !== "number") continue;
              const propLine = ifcAPI.GetLine(modelID, propId, false);
              if (!propLine?.Name?.value) continue;
              const propName = String(propLine.Name.value);
              // Extract concrete grade from various property names
              if (propName === "ConcreteGrade" || propName === "Grade" || propName === "ConcreteMix" || propName === "StrengthClass") {
                const val = propLine.NominalValue?.value;
                if (val != null) quantities.concreteGrade = String(val);
              }
              // Extract IsExternal for wall cost differentiation
              if (propName === "IsExternal") {
                const val = propLine.NominalValue?.value;
                if (val != null) quantities.isExternal = String(val) === ".T." || val === true;
              }
            } catch { /* skip individual property */ }
          }
          continue; // This propDef was a PropertySet, not ElementQuantity
        }

        // Get the Quantities array from the IfcElementQuantity
        const quantitiesRef = propDef.Quantities;
        if (!quantitiesRef) continue;

        // Check if this is a Qto_* standard set (e.g. Qto_WallBaseQuantities)
        const psetName = String(propDef.Name?.value ?? "");
        const isQtoStandard = psetName.startsWith("Qto_");
        if (isQtoStandard) hasQtoValues = true;
        else hasCustomValues = true;

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

            // Skip if this field was already set by a Qto_* set and current set is custom
            const canWrite = (field: string) => {
              if (isQtoStandard) {
                qtoLockedFields.add(field);
                return true; // Qto_* always writes
              }
              return !qtoLockedFields.has(field); // custom only writes if not locked
            };

            // Match to known quantity names
            // Area — gross
            if (AREA_QUANTITY_NAMES.gross.some((n) => name === n)) {
              if (canWrite("area.gross")) {
                if (!quantities.area) quantities.area = { unit: "m²" };
                quantities.area.gross = value;
              }
            }
            // Area — net
            else if (AREA_QUANTITY_NAMES.net.some((n) => name === n)) {
              if (canWrite("area.net")) {
                if (!quantities.area) quantities.area = { unit: "m²" };
                quantities.area.net = value;
              }
            }
            // Area — opening
            else if (AREA_QUANTITY_NAMES.opening.some((n) => name === n)) {
              if (canWrite("openingArea")) {
                quantities.openingArea = value;
              }
            }
            // Area — general fallback
            else if (AREA_QUANTITY_NAMES.general.some((n) => name === n)) {
              if (canWrite("area.gross") && !quantities.area?.gross) {
                if (!quantities.area) quantities.area = { unit: "m²" };
                quantities.area.gross = value;
              }
            }
            // Volume
            else if (VOLUME_QUANTITY_NAMES.some((n) => name === n)) {
              if (canWrite("volume")) {
                if (!quantities.volume) quantities.volume = { base: 0, withWaste: 0, unit: "m³" };
                quantities.volume.base = Math.max(quantities.volume.base, value);
              }
            }
            // Length
            else if (LENGTH_QUANTITY_NAMES.some((n) => name === n)) {
              if (canWrite("length")) quantities.length = value;
            }
            // Width / Thickness
            else if (WIDTH_QUANTITY_NAMES.some((n) => name === n)) {
              if (canWrite("width")) {
                quantities.width = value;
                if (name === "Thickness") quantities.thickness = value;
              }
            }
            // Height
            else if (HEIGHT_QUANTITY_NAMES.some((n) => name === n)) {
              if (canWrite("height")) quantities.height = value;
            }
            // Perimeter
            else if (PERIMETER_QUANTITY_NAMES.some((n) => name === n)) {
              if (canWrite("perimeter")) quantities.perimeter = value;
            }
            // Weight (IFC 4.x — critical for structural steel BOQ)
            else if (WEIGHT_QUANTITY_NAMES.some((n) => name === n)) {
              if (canWrite("weight")) {
                if (!quantities.weight) quantities.weight = { unit: "kg" };
                if (name === "GrossWeight") quantities.weight.gross = value;
                else if (name === "NetWeight") quantities.weight.net = value;
                else if (!quantities.weight.gross) quantities.weight.gross = value; // generic "Weight"
              }
            }
            // Cross-section area (columns, beams, piles)
            else if (CROSS_SECTION_NAMES.some((n) => name === n)) {
              if (canWrite("crossSectionArea")) quantities.crossSectionArea = value;
            }
            // Outer surface area (painting/cladding)
            else if (OUTER_SURFACE_NAMES.some((n) => name === n)) {
              if (canWrite("outerSurfaceArea")) quantities.outerSurfaceArea = value;
            }
            // Footprint area (excavation/waterproofing)
            else if (FOOTPRINT_NAMES.some((n) => name === n)) {
              if (canWrite("footprintArea")) quantities.footprintArea = value;
            }
          } catch {
            // Skip individual quantity parsing errors
          }
        }
      } catch {
        // Skip malformed property definitions
      }
    }

    // Set quantitySource based on what was found
    if (hasQtoValues) {
      quantities.quantitySource = "qto_standard";
    } else if (hasCustomValues) {
      quantities.quantitySource = "custom";
    }
    // If neither found, will remain undefined — computeGeometricQuantities will set "geometry_calculated"

    // --- Calculate derived quantities when IFC didn't provide them ---

    // Net area for walls: gross - openings
    if (quantities.area?.gross && quantities.openingArea) {
      if (!quantities.area.net) {
        quantities.area.net = quantities.area.gross - quantities.openingArea;
      }
    }

    // For steel members/plates: if we have Qto weight but no volume, derive volume from weight
    // weight / density (7850 kg/m³) = volume — more accurate than geometric estimation
    if (
      (ifcType === "IfcMember" || ifcType === "IfcPlate") &&
      !quantities.volume?.base &&
      (quantities.weight?.gross ?? quantities.weight?.net)
    ) {
      const w = quantities.weight!.net ?? quantities.weight!.gross!;
      if (w > 0) {
        quantities.volume = {
          base: w, // downstream uses this as kg for steel (IS1200-P7-STRUCT-STEEL)
          withWaste: 0,
          unit: "m³", // note: for steel elements TR-008 treats this as kg via density conversion
        };
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

    // For IfcReinforcingBar: prefer Qto weight, else calculate from diameter × length
    // Weight = (π/4) × d² × length × 7850 kg/m³
    if (ifcType === "IfcReinforcingBar") {
      // Priority 1: Use GrossWeight/NetWeight from Qto_ReinforcingElementBaseQuantities
      const qtoWeight = quantities.weight?.net ?? quantities.weight?.gross;
      if (qtoWeight && qtoWeight > 0) {
        if (!quantities.volume) quantities.volume = { base: 0, withWaste: 0, unit: "m³" };
        quantities.volume.base = qtoWeight; // Store weight in volume.base for downstream (unit: kg)
        quantities.rebarWeight = qtoWeight;
        quantities.rebarDiameter = quantities.width ? (quantities.width > 1 ? quantities.width : quantities.width * 1000) : undefined;
        quantities.rebarSource = "qto_weight";
      } else {
        // Priority 2: Compute from NominalDiameter × Length × density
        const diam = quantities.width ?? 0; // NominalDiameter often mapped to width
        const barLength = quantities.length ?? 0;
        if (diam > 0 && barLength > 0) {
          // diam may be in mm, convert to m for calculation
          const d_m = diam > 1 ? diam / 1000 : diam; // if >1 likely mm
          const weight = (Math.PI / 4) * d_m * d_m * barLength * 7850; // kg
          if (!quantities.volume) quantities.volume = { base: 0, withWaste: 0, unit: "m³" };
          quantities.volume.base = weight; // Store weight in volume.base for downstream (unit: kg)
          quantities.rebarWeight = weight;
          quantities.rebarDiameter = diam > 1 ? diam : diam * 1000; // store in mm
          quantities.rebarSource = "extracted";
        }
      }
    }

    // Ensure area struct exists for area-based element types
    if (
      (ifcType === "IfcWall" || ifcType === "IfcWallStandardCase" || ifcType === "IfcSlab" ||
        ifcType === "IfcRoof" || ifcType === "IfcCovering" || ifcType === "IfcCurtainWall") &&
      !quantities.area
    ) {
      quantities.area = { gross: 0, net: 0, unit: "m²" };
    }

    // For curtain walls: try height × width or length × height if available
    if (ifcType === "IfcCurtainWall" && !(quantities.area?.gross)) {
      if (quantities.height && quantities.width) {
        if (!quantities.area) quantities.area = { unit: "m²" };
        quantities.area.gross = quantities.height * quantities.width;
        quantities.area.net = quantities.area.gross;
      } else if (quantities.height && quantities.length) {
        if (!quantities.area) quantities.area = { unit: "m²" };
        quantities.area.gross = quantities.height * quantities.length;
        quantities.area.net = quantities.area.gross;
      }
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
  quantities: QuantityData,
  diagCounters?: ParserDiagnosticCounters,
): void {
  // Only fall back if Qto gave us nothing useful
  const hasArea = (quantities.area?.gross ?? 0) > 0;
  const hasVolume = (quantities.volume?.base ?? 0) > 0;
  if (hasArea && hasVolume) return;

  // Track which strategy ultimately produced (or failed to produce) geometry
  let geometryRecorded = false;
  const recordGeom = (kind: keyof ParserDiagnosticCounters["geometryTypes"]) => {
    if (geometryRecorded || !diagCounters) return;
    diagCounters.geometryTypes[kind] = (diagCounters.geometryTypes[kind] ?? 0) + 1;
    geometryRecorded = true;
  };

  // If we're computing from geometry, mark the source (unless Qto already set it)
  const markGeometrySource = () => {
    if (!quantities.quantitySource) {
      quantities.quantitySource = "geometry_calculated";
    }
  };

  try {
    const element = ifcAPI.GetLine(modelID, expressID, false);
    if (!element?.Representation?.value) return;

    const prodShape = ifcAPI.GetLine(modelID, element.Representation.value, false);
    if (!prodShape?.Representations) return;

    const reps = Array.isArray(prodShape.Representations)
      ? prodShape.Representations
      : [prodShape.Representations];

    // Track bounding box for curtain wall fallback
    let bbMinX = Infinity, bbMaxX = -Infinity;
    let bbMinY = Infinity, bbMaxY = -Infinity;
    let bbMinZ = Infinity, bbMaxZ = -Infinity;
    let foundExtrusion = false;

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
        if (!item) continue;

        // Diagnostic: classify the representation type even if extraction fails.
        // We only record once per element via recordGeom (first matching strategy wins).
        if (diagCounters && !geometryRecorded) {
          try {
            const geomTypeId = ifcAPI.GetLineType(modelID, itemId);
            if (geomTypeId === IFC_GEOM_BOOLEAN_RESULT || geomTypeId === IFC_GEOM_BOOLEAN_CLIPPING_RESULT) {
              recordGeom("booleanResult");
            } else if (geomTypeId === IFC_GEOM_FACETED_BREP) {
              recordGeom("facetedBrep");
            }
            // Other types are recorded by the strategy branch that handles them.
            void geomTypeId;
            void IFC_GEOM_EXTRUDED_AREA_SOLID;
            void IFC_GEOM_MAPPED_ITEM;
            void IFC_GEOM_BOUNDING_BOX;
          } catch { /* GetLineType not always available — fall back to property sniffing */ }
        }

        // ── Strategy 1: IfcExtrudedAreaSolid (standard walls, slabs, columns) ──
        if (item.Depth?.value != null) {
          recordGeom("extrudedAreaSolid");
          const depth = Number(item.Depth.value);
          if (depth <= 0) continue;

          const profileRef = item.SweptArea?.value;
          if (typeof profileRef !== "number") continue;

          const profile = ifcAPI.GetLine(modelID, profileRef, false);
          if (!profile) continue;

          const { area: profileArea, xDim, yDim } =
            computeProfileMetrics(ifcAPI, modelID, profile);

          if (profileArea <= 0) continue;

          foundExtrusion = true;
          markGeometrySource();

          // Volume = profileArea × depth
          if (!hasVolume) {
            if (!quantities.volume) quantities.volume = { base: 0, withWaste: 0, unit: "m³" };
            quantities.volume.base = profileArea * depth;
          }

          // Quantities depend on element type
          if (ifcType === "IfcWall" || ifcType === "IfcWallStandardCase") {
            if (!hasArea && xDim > 0) {
              if (!quantities.area) quantities.area = { unit: "m²" };
              quantities.area.gross = xDim * depth;
              quantities.area.net = quantities.area.gross;
            }
            if (xDim > 0) quantities.length = xDim;
            if (yDim > 0) {
              quantities.thickness = yDim;
              quantities.width = yDim;
            }
            quantities.height = depth;
          } else if (ifcType === "IfcSlab" || ifcType === "IfcRoof" || ifcType === "IfcCovering") {
            if (!hasArea) {
              if (!quantities.area) quantities.area = { unit: "m²" };
              quantities.area.gross = profileArea;
              quantities.area.net = profileArea;
            }
            quantities.thickness = depth;
          } else if (ifcType === "IfcCurtainWall") {
            // Curtain wall with extrusion: profile = cross-section, depth = height
            if (!hasArea && xDim > 0) {
              if (!quantities.area) quantities.area = { unit: "m²" };
              quantities.area.gross = xDim * depth;
              quantities.area.net = quantities.area.gross;
            }
            quantities.height = depth;
            if (xDim > 0) quantities.length = xDim;
          } else if (ifcType === "IfcColumn" || ifcType === "IfcBeam") {
            quantities.height = depth;
          } else if (ifcType === "IfcFooting") {
            if (!hasArea) {
              if (!quantities.area) quantities.area = { unit: "m²" };
              quantities.area.gross = profileArea;
              quantities.area.net = profileArea;
            }
            quantities.thickness = depth;
          }

          return; // Found geometry, done
        }

        // ── Strategy 2: Bounding box (IfcBoundingBox) — fallback for complex geometry ──
        // Curtain walls often use IfcFacetedBrep or decomposed geometry
        if (item.Corner?.value != null || item.XDim?.value != null) {
          recordGeom("boundingBox");
          const xd = Number(item.XDim?.value ?? 0);
          const yd = Number(item.YDim?.value ?? 0);
          const zd = Number(item.ZDim?.value ?? 0);
          if (xd > 0 && yd > 0 && zd > 0) {
            bbMinX = 0; bbMaxX = xd;
            bbMinY = 0; bbMaxY = yd;
            bbMinZ = 0; bbMaxZ = zd;
          }
        }

        // ── Strategy 3: IfcMappedItem — follow the mapping source ──
        if (item.MappingSource?.value != null) {
          recordGeom("mappedItem");
          try {
            const mapSource = ifcAPI.GetLine(modelID, item.MappingSource.value, false);
            if (mapSource?.MappedRepresentation?.value) {
              const mappedRep = ifcAPI.GetLine(modelID, mapSource.MappedRepresentation.value, false);
              if (mappedRep?.Items) {
                const mappedItems = Array.isArray(mappedRep.Items) ? mappedRep.Items : [mappedRep.Items];
                for (const mRef of mappedItems) {
                  const mId = mRef?.value;
                  if (typeof mId !== "number") continue;
                  const mappedItem = ifcAPI.GetLine(modelID, mId, false);
                  if (mappedItem?.Depth?.value != null) {
                    const mDepth = Number(mappedItem.Depth.value);
                    const mProfileRef = mappedItem.SweptArea?.value;
                    if (typeof mProfileRef === "number" && mDepth > 0) {
                      const mProfile = ifcAPI.GetLine(modelID, mProfileRef, false);
                      if (mProfile) {
                        const { area: mArea, xDim: mX } = computeProfileMetrics(ifcAPI, modelID, mProfile);
                        if (mArea > 0 && ifcType === "IfcCurtainWall" && mX > 0) {
                          if (!quantities.area) quantities.area = { unit: "m²" };
                          quantities.area.gross = mX * mDepth;
                          quantities.area.net = quantities.area.gross;
                          quantities.height = mDepth;
                          quantities.length = mX;
                          return;
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch { /* skip mapped item errors */ }
        }
      }
    }

    // ── Strategy 4: Bounding box fallback for curtain walls ──
    // If no extrusion found, use bounding box dimensions
    if (!foundExtrusion && ifcType === "IfcCurtainWall" && !hasArea) {
      if (bbMaxZ > bbMinZ && (bbMaxX > bbMinX || bbMaxY > bbMinY)) {
        const height = bbMaxZ - bbMinZ;
        const spanX = bbMaxX - bbMinX;
        const spanY = bbMaxY - bbMinY;
        // Curtain wall area = height × longer horizontal span
        const span = Math.max(spanX, spanY);
        if (span > 0 && height > 0) {
          if (!quantities.area) quantities.area = { unit: "m²" };
          quantities.area.gross = span * height;
          quantities.area.net = quantities.area.gross;
          quantities.height = height;
          quantities.length = span;
          return;
        }
      }

      // ── Strategy 5: Use height × width from Qto if we got them but no area ──
      if (quantities.height && quantities.width) {
        if (!quantities.area) quantities.area = { unit: "m²" };
        quantities.area.gross = quantities.height * quantities.width;
        quantities.area.net = quantities.area.gross;
      } else if (quantities.height && quantities.length) {
        if (!quantities.area) quantities.area = { unit: "m²" };
        quantities.area.gross = quantities.height * quantities.length;
        quantities.area.net = quantities.area.gross;
      }
    }
  } catch {
    // Geometry extraction failed — silently fall back to count-only
  }

  // Record final outcome if no strategy claimed this element earlier
  if (!geometryRecorded && diagCounters) {
    const aGross = quantities.area?.gross ?? 0;
    const vBase = quantities.volume?.base ?? 0;
    if (aGross === 0 && vBase === 0) recordGeom("failed");
    else recordGeom("other");
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
 * Resolve material name from any IFC material association type:
 * IfcMaterial, IfcMaterialLayerSet, IfcMaterialLayerSetUsage,
 * IfcMaterialConstituentSet (IFC4), IfcMaterialProfileSet (IFC4),
 * or IfcMaterialList.
 *
 * Composite types (LayerSet, ConstituentSet, ProfileSet) are checked BEFORE
 * the generic Name property, because composite entities may have a Name like
 * "Wall Composite" that is useless for CSI mapping — we want the actual
 * constituent material name (e.g., "Concrete M25").
 */
function resolveMaterialName(
  ifcAPI: IfcAPI,
  modelID: number,
  matId: number
): string {
  try {
    const mat = ifcAPI.GetLine(modelID, matId, false);
    if (!mat) return "";

    // ── Composite material types checked FIRST ──
    // These may also have a Name property, but the constituent material
    // names are more useful for BOQ cost mapping.

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

    // IfcMaterialConstituentSet (IFC4 — ArchiCAD, newer Revit IFC4 exports)
    // Structure: MaterialConstituents[] → each IfcMaterialConstituent has Material → IfcMaterial
    // Returns the constituent with the highest Fraction as primary material.
    // web-ifc may expose the array as "MaterialConstituents" or "Constituents"
    const rawConstituents = mat.MaterialConstituents ?? mat.Constituents;
    if (rawConstituents) {
      const constituents = Array.isArray(rawConstituents) ? rawConstituents : [rawConstituents];
      let bestName = "";
      let bestFraction = -1;
      for (const constRef of constituents) {
        const constId = (constRef as { value?: number })?.value;
        if (typeof constId !== "number") continue;
        const constituent = ifcAPI.GetLine(modelID, constId, false);
        const constMatRef = constituent?.Material?.value;
        if (typeof constMatRef !== "number") continue;
        const constMat = ifcAPI.GetLine(modelID, constMatRef, false);
        const name = constMat?.Name?.value;
        if (!name || typeof name !== "string") continue;
        const fraction = Number(constituent?.Fraction?.value ?? 0);
        if (fraction > bestFraction) {
          bestName = name;
          bestFraction = fraction;
        }
      }
      if (bestName) return bestName;
    }

    // IfcMaterialProfileSet (IFC4 — Tekla, structural Revit exports)
    // Structure: MaterialProfiles[] → each IfcMaterialProfile has Material → IfcMaterial
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

    // IfcMaterialList → first material in the list
    if (mat.Materials) {
      const materials = Array.isArray(mat.Materials) ? mat.Materials : [mat.Materials];
      for (const mRef of materials) {
        const mId = (mRef as { value?: number })?.value;
        if (typeof mId !== "number") continue;
        const m = ifcAPI.GetLine(modelID, mId, false);
        if (m?.Name?.value) return m.Name.value;
      }
    }

    // IfcMaterial → direct Name (checked LAST to avoid catching composite set names
    // like "Wall Composite" when constituent-level names are available)
    if (mat.Name?.value && typeof mat.Name.value === "string") {
      return mat.Name.value;
    }

    return "";
  } catch {
    return "";
  }
}

/**
 * Resolve material layers from any IFC material association type.
 * Returns individual layers with name + thickness for per-layer BOQ decomposition.
 *
 * - IfcMaterialLayerSet/Usage → layers with real thickness in metres
 * - IfcMaterialConstituentSet → constituents with Fraction as pseudo-thickness (0.0–1.0)
 * - IfcMaterialProfileSet → profiles with thickness = 0 (cross-section, not layer)
 * - IfcMaterialList → materials with thickness = 0
 *
 * Preference: LayerSet > ConstituentSet > ProfileSet > MaterialList
 * (LayerSet has physical thickness which is most useful for BOQ)
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

    // IfcMaterialLayerSet → extract each layer (PREFERRED — has real thickness)
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

    // IfcMaterialConstituentSet (IFC4) → constituents with Fraction as pseudo-thickness
    const rawConstituents = mat.MaterialConstituents ?? mat.Constituents;
    if (rawConstituents) {
      const constituents = Array.isArray(rawConstituents) ? rawConstituents : [rawConstituents];
      const result: MaterialLayer[] = [];
      for (const constRef of constituents) {
        const constId = (constRef as { value?: number })?.value;
        if (typeof constId !== "number") continue;
        const constituent = ifcAPI.GetLine(modelID, constId, false);
        const constMatRef = constituent?.Material?.value;
        let name = "Unknown";
        if (typeof constMatRef === "number") {
          const constMat = ifcAPI.GetLine(modelID, constMatRef, false);
          if (constMat?.Name?.value) name = constMat.Name.value;
        }
        // Fraction (0.0–1.0) stored as pseudo-thickness for downstream proportional analysis
        const fraction = Number(constituent?.Fraction?.value ?? 0);
        result.push({ name, thickness: fraction });
      }
      return result;
    }

    // IfcMaterialProfileSet (IFC4) → profiles (no meaningful thickness for layers)
    if (mat.MaterialProfiles) {
      const profiles = Array.isArray(mat.MaterialProfiles) ? mat.MaterialProfiles : [mat.MaterialProfiles];
      const result: MaterialLayer[] = [];
      for (const profRef of profiles) {
        const profId = (profRef as { value?: number })?.value;
        if (typeof profId !== "number") continue;
        const prof = ifcAPI.GetLine(modelID, profId, false);
        const profMatRef = prof?.Material?.value;
        let name = "Unknown";
        if (typeof profMatRef === "number") {
          const profMat = ifcAPI.GetLine(modelID, profMatRef, false);
          if (profMat?.Name?.value) name = profMat.Name.value;
        }
        // Profile name (e.g., "ISMB 300") — useful for structural steel BOQ
        const profName = prof?.Name?.value;
        if (profName && typeof profName === "string") name = `${name} (${profName})`;
        result.push({ name, thickness: 0 });
      }
      return result;
    }

    // IfcMaterialList → simple list of materials (no thickness info)
    if (mat.Materials) {
      const materials = Array.isArray(mat.Materials) ? mat.Materials : [mat.Materials];
      const result: MaterialLayer[] = [];
      for (const mRef of materials) {
        const mId = (mRef as { value?: number })?.value;
        if (typeof mId !== "number") continue;
        const m = ifcAPI.GetLine(modelID, mId, false);
        if (m?.Name?.value) {
          result.push({ name: m.Name.value, thickness: 0 });
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
// MODEL QUALITY VALIDATION
// ============================================================================

/**
 * Assess model quality after element extraction. Flags issues that degrade
 * BOQ accuracy: zero-volume elements, missing materials, unassigned storeys,
 * suspicious dimensions, and potential duplicates.
 */
function buildModelQualityReport(
  divisions: CSIDivision[],
  _materialLookup: Map<number, string>,
  _storeyLookup: Map<number, string>,
  totalElements: number,
  processedElements: number,
  warnings: string[],
  unitInfo: { detectedUnit: string; conversionApplied: boolean; conversionFactor: number },
): ModelQualityReport {
  // Collect all elements across all divisions
  const allElements: IFCElementData[] = [];
  for (const div of divisions) {
    for (const cat of div.categories) {
      allElements.push(...cat.elements);
    }
  }

  // 1. Zero-volume elements: elements expected to have volume but don't
  const volumeExpectedTypes = new Set([
    "IfcWall", "IfcWallStandardCase", "IfcSlab", "IfcColumn", "IfcBeam",
    "IfcFooting", "IfcStair",
  ]);
  const zeroVolumeTypes = new Map<string, number>();
  for (const el of allElements) {
    if (volumeExpectedTypes.has(el.type)) {
      const vol = el.quantities.volume?.base ?? 0;
      if (vol <= 0) {
        zeroVolumeTypes.set(el.type, (zeroVolumeTypes.get(el.type) ?? 0) + 1);
      }
    }
  }
  const zeroVolumeCount = Array.from(zeroVolumeTypes.values()).reduce((s, v) => s + v, 0);

  // 2. No-material elements: elements without material assignment
  // We check by looking at the element's material field
  const noMaterialTypes = new Map<string, number>();
  for (const el of allElements) {
    if (!el.material || el.material === "Unknown" || el.material === "") {
      noMaterialTypes.set(el.type, (noMaterialTypes.get(el.type) ?? 0) + 1);
    }
  }
  const noMaterialCount = Array.from(noMaterialTypes.values()).reduce((s, v) => s + v, 0);

  // 3. Unassigned-storey elements
  const unassignedTypes = new Map<string, number>();
  for (const el of allElements) {
    if (!el.storey || el.storey === "Unassigned") {
      unassignedTypes.set(el.type, (unassignedTypes.get(el.type) ?? 0) + 1);
    }
  }
  const unassignedCount = Array.from(unassignedTypes.values()).reduce((s, v) => s + v, 0);

  // 4. Suspicious dimensions
  const suspiciousDims: ModelQualityReport["suspiciousDimensions"] = [];
  for (const el of allElements) {
    const t = el.quantities.thickness;
    if (t != null && t > 0) {
      if ((el.type === "IfcWall" || el.type === "IfcWallStandardCase") && (t > 1.0 || t < 0.05)) {
        suspiciousDims.push({
          elementType: el.type,
          name: el.name,
          dimension: "thickness",
          value: t,
          expected: "50mm–1000mm",
        });
      }
      if (el.type === "IfcSlab" && (t > 0.5 || t < 0.05)) {
        suspiciousDims.push({
          elementType: el.type,
          name: el.name,
          dimension: "thickness",
          value: t,
          expected: "50mm–500mm",
        });
      }
    }
  }
  // Cap suspicious dimensions list to avoid noise
  if (suspiciousDims.length > 20) suspiciousDims.length = 20;

  // 5. Duplicate detection: elements at same position + type
  // Lightweight heuristic: group by type + storey + rounded area + rounded volume
  // If >1 element has identical signature, flag as potential duplicate
  const signatureMap = new Map<string, number>();
  for (const el of allElements) {
    const area = Math.round((el.quantities.area?.gross ?? 0) * 100);
    const vol = Math.round((el.quantities.volume?.base ?? 0) * 100);
    const sig = `${el.type}|${el.storey}|${area}|${vol}`;
    signatureMap.set(sig, (signatureMap.get(sig) ?? 0) + 1);
  }
  let duplicateCount = 0;
  for (const [, count] of signatureMap) {
    if (count > 1) duplicateCount += count - 1; // each extra is a potential duplicate
  }
  // Only report if ratio is suspiciously high (>20% duplicates)
  const duplicateRatio = allElements.length > 0 ? duplicateCount / allElements.length : 0;
  const reportedDuplicates = duplicateRatio > 0.20 ? duplicateCount : 0;

  // Compute overall score (0-100)
  let score = 100;
  // Penalize for failed elements
  if (totalElements > 0) {
    const failedRatio = (totalElements - processedElements) / totalElements;
    score -= Math.round(failedRatio * 30); // up to -30 for all elements failing
  }
  // Penalize for zero-volume elements
  if (allElements.length > 0) {
    score -= Math.min(20, Math.round((zeroVolumeCount / allElements.length) * 40));
  }
  // Penalize for no-material elements
  if (allElements.length > 0) {
    score -= Math.min(15, Math.round((noMaterialCount / allElements.length) * 30));
  }
  // Penalize for unassigned storeys
  if (allElements.length > 0) {
    score -= Math.min(10, Math.round((unassignedCount / allElements.length) * 20));
  }
  // Penalize for suspicious dimensions
  score -= Math.min(10, suspiciousDims.length * 2);
  // Penalize for duplicates
  if (reportedDuplicates > 0) score -= Math.min(15, Math.round(duplicateRatio * 30));

  score = Math.max(0, Math.min(100, score));

  const label: ModelQualityReport["label"] =
    score >= 85 ? "EXCELLENT" : score >= 65 ? "GOOD" : score >= 40 ? "FAIR" : "LIMITED";

  // Add warnings for significant issues
  if (zeroVolumeCount > 0) {
    warnings.push(`Model quality: ${zeroVolumeCount} element(s) have zero volume (${Array.from(zeroVolumeTypes.keys()).join(", ")})`);
  }
  if (noMaterialCount > 5) {
    warnings.push(`Model quality: ${noMaterialCount} element(s) have no material assignment — generic rates will be used`);
  }
  if (unassignedCount > 5) {
    warnings.push(`Model quality: ${unassignedCount} element(s) not assigned to any storey — floor-wise breakdown incomplete`);
  }
  if (suspiciousDims.length > 0) {
    warnings.push(`Model quality: ${suspiciousDims.length} element(s) have suspicious dimensions (e.g. wall thickness ${suspiciousDims[0].value > 1 ? ">1m" : "<50mm"})`);
  }

  return {
    zeroVolumeElements: {
      count: zeroVolumeCount,
      types: Array.from(zeroVolumeTypes.keys()),
    },
    noMaterialElements: {
      count: noMaterialCount,
      types: Array.from(noMaterialTypes.keys()),
    },
    unassignedStoreyElements: {
      count: unassignedCount,
      types: Array.from(unassignedTypes.keys()),
    },
    suspiciousDimensions: suspiciousDims,
    duplicateElements: {
      count: reportedDuplicates,
      estimatedImpact: reportedDuplicates > 0
        ? `~${Math.round(duplicateRatio * 100)}% of elements may be duplicated — quantities could be over-counted`
        : "none",
    },
    unitConversion: unitInfo,
    score,
    label,
  };
}

// ============================================================================
// MAIN PARSER
// ============================================================================

export async function parseIFCBuffer(
  buffer: Uint8Array,
  filename: string,
  customWasteFactors?: Record<string, number>,
  diagnostics?: ParserDiagnosticCounters,
): Promise<IFCParseResult> {
  void filename;
  void customWasteFactors;
  const startTime = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  // Diagnostic counters (always present internally, optionally surfaced via caller)
  const diag: ParserDiagnosticCounters = diagnostics ?? createParserDiagnosticCounters();
  const pushElementWarning = (msg: string) => {
    if (diag.elementWarnings.length < 50) diag.elementWarnings.push(msg);
  };

  // Track failed elements first so the 20-item sample shows the most useful evidence.
  const collectElementSample = (sample: ElementDiagnostic) => {
    if (diag.elementSamples.length < ELEMENT_SAMPLE_CAP) {
      diag.elementSamples.push(sample);
      return;
    }
    // Replace a non-failed sample with a failed one when we hit the cap.
    if (sample.hasZeroQuantity) {
      const swapIdx = diag.elementSamples.findIndex(s => !s.hasZeroQuantity);
      if (swapIdx >= 0) diag.elementSamples[swapIdx] = sample;
    }
  };

  // Initialize web-ifc API with correct WASM path for Next.js
  const wasmInitStart = Date.now();
  const ifcAPI = new IfcAPI();
  const path = await import("path");
  const wasmDir = path.resolve(process.cwd(), "node_modules", "web-ifc") + "/";
  ifcAPI.SetWasmPath(wasmDir, true);
  await ifcAPI.Init();
  diag.timings.wasmInitMs = Date.now() - wasmInitStart;

  // Open model
  const modelLoadStart = Date.now();
  const modelID = ifcAPI.OpenModel(buffer, {
    COORDINATE_TO_ORIGIN: true,
  });
  diag.timings.modelLoadMs = Date.now() - modelLoadStart;

  // Extract metadata
  const metadataScanStart = Date.now();
  const schema = ifcAPI.GetModelSchema(modelID) || "IFC2X3";

  // ── File-level diagnostic metadata scan ─────────────────────────────────
  // Best-effort: each lookup is wrapped because entity IDs are schema-version
  // specific and may not exist in every file.
  const fileMeta: ParserFileMetadata = {
    fileSizeBytes: buffer.byteLength,
    ifcSchema: schema,
    fileName: filename,
    totalEntityCount: 0,
    totalProductCount: 0,
    qtoBaseSetCount: 0,
    customQuantitySetCount: 0,
    propertySetCount: 0,
    hasIfcSpaces: false,
    geometryTypesPresent: [],
  };
  try {
    const allLines = ifcAPI.GetAllLines(modelID);
    fileMeta.totalEntityCount = allLines.size();
  } catch { /* GetAllLines unavailable in some web-ifc versions */ }
  try {
    const apps = ifcAPI.GetLineIDsWithType(modelID, IFCAPPLICATION);
    if (apps.size() > 0) {
      const app = ifcAPI.GetLine(modelID, apps.get(0), false);
      const appName = app?.ApplicationFullName?.value ?? app?.ApplicationIdentifier?.value;
      const appVer = app?.Version?.value;
      if (typeof appName === "string") fileMeta.authoringApplication = appName;
      if (typeof appVer === "string") fileMeta.authoringApplicationVersion = appVer;
    }
  } catch { /* IfcApplication ID may differ across schemas */ }
  try {
    fileMeta.propertySetCount = ifcAPI.GetLineIDsWithType(modelID, IFCPROPERTYSET_TYPE).size();
  } catch { /* schema mismatch — leave 0 */ }
  try {
    const elementQuants = ifcAPI.GetLineIDsWithType(modelID, IFCELEMENTQUANTITY_TYPE);
    const eqSize = elementQuants.size();
    let qto = 0;
    let custom = 0;
    for (let i = 0; i < eqSize; i++) {
      try {
        const eq = ifcAPI.GetLine(modelID, elementQuants.get(i), false);
        const name = String(eq?.Name?.value ?? "");
        if (name.startsWith("Qto_")) qto++;
        else custom++;
      } catch { /* skip */ }
    }
    fileMeta.qtoBaseSetCount = qto;
    fileMeta.customQuantitySetCount = custom;
  } catch { /* schema mismatch */ }
  try {
    fileMeta.hasIfcSpaces = ifcAPI.GetLineIDsWithType(modelID, IFCSPACE_TYPE).size() > 0;
  } catch { /* schema mismatch */ }
  diag.fileMetadata = fileMeta;
  diag.timings.metadataScanMs = Date.now() - metadataScanStart;

  // Get project info
  let projectName = "Unknown Project";
  let projectGuid = "";

  // Unit detection state — set during project metadata extraction, used after
  let detectedLengthUnit = "METRE";
  let lengthConversionFactor = 1.0; // multiply to get meters
  let unitConversionApplied = false;

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

      // ── Unit Consistency Check ──
      // Read IfcUnitAssignment from IfcProject to detect length unit
      // Most IFC files use METRE, but some (especially from US tools) use FOOT or INCH
      const unitsRef = project?.UnitsInContext?.value;
      if (typeof unitsRef === "number") {
        try {
          const unitAssignment = ifcAPI.GetLine(modelID, unitsRef, false);
          const units = unitAssignment?.Units;
          const unitRefs = Array.isArray(units) ? units : units ? [units] : [];
          for (const uRef of unitRefs) {
            const uId = (uRef as { value?: number })?.value;
            if (typeof uId !== "number") continue;
            try {
              const unit = ifcAPI.GetLine(modelID, uId, false);
              // IfcSIUnit or IfcConversionBasedUnit with UnitType = LENGTHUNIT
              const unitType = unit?.UnitType?.value;
              if (unitType !== ".LENGTHUNIT." && unitType !== "LENGTHUNIT") continue;

              // Check for IfcSIUnit
              const siName = unit?.Name?.value;
              const prefix = unit?.Prefix?.value;
              if (siName) {
                const nameStr = String(siName).replace(/\./g, "").toUpperCase();
                if (nameStr === "METRE" || nameStr === "METER") {
                  if (prefix) {
                    const prefixStr = String(prefix).replace(/\./g, "").toUpperCase();
                    if (prefixStr === "MILLI") {
                      detectedLengthUnit = "MILLIMETRE";
                      lengthConversionFactor = 0.001;
                      unitConversionApplied = true;
                      warnings.push("IFC file uses MILLIMETRE units — quantities converted to metres");
                    } else if (prefixStr === "CENTI") {
                      detectedLengthUnit = "CENTIMETRE";
                      lengthConversionFactor = 0.01;
                      unitConversionApplied = true;
                      warnings.push("IFC file uses CENTIMETRE units — quantities converted to metres");
                    }
                    // METRE with no prefix = standard (factor stays 1.0)
                  } else {
                    detectedLengthUnit = "METRE";
                  }
                }
              }

              // Check for IfcConversionBasedUnit (e.g. FOOT, INCH)
              const convName = unit?.Name?.value;
              if (typeof convName === "string") {
                const cn = convName.toUpperCase();
                if (cn.includes("FOOT") || cn.includes("FT")) {
                  detectedLengthUnit = "FOOT";
                  lengthConversionFactor = 0.3048;
                  unitConversionApplied = true;
                  warnings.push("IFC file uses FOOT units — quantities converted to metres");
                } else if (cn.includes("INCH") || cn.includes("IN")) {
                  detectedLengthUnit = "INCH";
                  lengthConversionFactor = 0.0254;
                  unitConversionApplied = true;
                  warnings.push("IFC file uses INCH units — quantities converted to metres");
                }
              }

              break; // Found the length unit, stop looking
            } catch { /* skip individual unit */ }
          }
        } catch {
          warnings.push("Failed to read IfcUnitAssignment — assuming METRE");
        }
      }
    }
  } catch {
    warnings.push("Failed to extract project metadata");
  }

  // Get building storeys
  const storeyScanStart = Date.now();
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

  diag.timings.storeyScanMs = Date.now() - storeyScanStart;

  // Build element → material lookup via IfcRelAssociatesMaterial
  const materialResolveStart = Date.now();
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
        const matKind = classifyMaterialAssociation(ifcAPI, modelID, matRef);
        if (!matName) continue;
        const relatedObjects = rel?.RelatedObjects;
        const refs = Array.isArray(relatedObjects) ? relatedObjects : [relatedObjects];
        for (const ref of refs) {
          const elId = (ref as { value?: number })?.value;
          if (typeof elId === "number") {
            elementMaterialLookup.set(elId, matName);
            if (layers.length > 0) elementMaterialLayersLookup.set(elId, layers);
            diag.materialTypes[matKind] = (diag.materialTypes[matKind] ?? 0) + 1;
          }
        }
      } catch { /* skip */ }
    }
  } catch {
    warnings.push("Failed to build material lookup");
  }

  diag.timings.materialResolveMs = Date.now() - materialResolveStart;

  // Build property lookup once (O(n) instead of O(n²))
  const propertyExtractStart = Date.now();
  const propertyLookup = buildPropertyLookup(ifcAPI, modelID, warnings);
  diag.timings.propertyExtractMs = Date.now() - propertyExtractStart;

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
  const elementProcessStart = Date.now();
  const geometryTypesPresentSet = new Set<string>();
  const quantitySourceCounts = { qto_standard: 0, custom: 0, geometry_calculated: 0, none: 0 };

  for (const { typeId, label } of IFC_TYPES) {
    const ids = ifcAPI.GetLineIDsWithType(modelID, typeId);
    const count = ids.size();

    if (count === 0) continue;
    fileMeta.totalProductCount += count;

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
        // Snapshot the geometry-counter state before the call so we can detect
        // which strategy this specific element triggered.
        const geomBefore = { ...diag.geometryTypes };
        computeGeometricQuantities(ifcAPI, modelID, expressID, label, quantities, diag);

        // Detect which (if any) geometry strategy fired for this element by
        // diffing the counter object — used both for the per-element sample
        // and for the file-level "geometryTypesPresent" set.
        const detectGeomKind = (): string | null => {
          for (const k of Object.keys(diag.geometryTypes) as Array<keyof typeof diag.geometryTypes>) {
            if (diag.geometryTypes[k] !== geomBefore[k]) return k;
          }
          return null;
        };
        const geomKind = detectGeomKind();

        // Inspect the actual representation type for the file-level summary,
        // even if the strategy diff didn't catch it (e.g., element had no rep).
        try {
          const elem = ifcAPI.GetLine(modelID, expressID, false);
          const repValRaw = elem?.Representation?.value;
          if (typeof repValRaw === "number") {
            const prodShape = ifcAPI.GetLine(modelID, repValRaw, false);
            const reps = prodShape?.Representations
              ? (Array.isArray(prodShape.Representations) ? prodShape.Representations : [prodShape.Representations])
              : [];
            for (const repRef of reps) {
              const repId = repRef?.value;
              if (typeof repId !== "number") continue;
              const rep = ifcAPI.GetLine(modelID, repId, false);
              const items = rep?.Items ? (Array.isArray(rep.Items) ? rep.Items : [rep.Items]) : [];
              for (const itemRef of items) {
                const itemId = itemRef?.value;
                if (typeof itemId !== "number") continue;
                try {
                  const tid = ifcAPI.GetLineType(modelID, itemId);
                  const tname = GEOM_TYPE_NAME[tid];
                  if (tname) geometryTypesPresentSet.add(tname);
                } catch { /* skip */ }
              }
            }
          }
        } catch { /* representation inspection is best-effort */ }

        // Per-element zero-quantity warning — captures WHY this element has no quantities
        const aGross = quantities.area?.gross ?? 0;
        const vBase = quantities.volume?.base ?? 0;
        const isZero = aGross === 0 && vBase === 0 && label !== "IfcDoor" && label !== "IfcWindow" && label !== "IfcRailing";
        if (isZero) {
          pushElementWarning(`${label} #${expressID}: zero area & volume (quantitySource=${quantities.quantitySource ?? "none"})`);
        }

        // Bump quantity-source breakdown counts
        const qSrc = quantities.quantitySource ?? "none";
        if (qSrc in quantitySourceCounts) (quantitySourceCounts as Record<string, number>)[qSrc]++;
        else quantitySourceCounts.none++;

        // ── Per-element fallback chain ──
        // Reconstructs the strategy attempts from the final state. Compact array
        // form keeps it cheap to render and serialize.
        const fallbackChain: string[] = [];
        if (qSrc === "qto_standard") {
          fallbackChain.push("Qto:hit");
        } else {
          fallbackChain.push("Qto:miss");
          if (qSrc === "custom") {
            fallbackChain.push("PropSet:hit");
          } else {
            fallbackChain.push("PropSet:miss");
            if (qSrc === "geometry_calculated") {
              fallbackChain.push(`Geom:${geomKind ?? "extrudedAreaSolid"}:hit`);
            } else if (geomKind === "failed" || geomKind === null) {
              fallbackChain.push("Geom:none:miss");
            } else if (geomKind === "booleanResult" || geomKind === "facetedBrep") {
              fallbackChain.push(`Geom:${geomKind}:unsupported`);
            } else {
              fallbackChain.push(`Geom:${geomKind}:partial`);
            }
          }
        }
        if (isZero) fallbackChain.push("Result:count_only");
        else if (aGross > 0 || vBase > 0) fallbackChain.push("Result:measured");

        // ── Element diagnostic sample ──
        // Storey/material aren't resolved yet at this point — defer those by
        // looking them up lazily here (cheap; both are Maps).
        const sampleStorey = elementStoreyLookup.get(expressID) || "Unassigned";
        const sampleMaterial = elementMaterialLookup.get(expressID) || null;
        const failureReason = isZero
          ? (geomKind === "booleanResult" || geomKind === "facetedBrep")
            ? `${geomKind === "booleanResult" ? "IfcBooleanResult" : "IfcFacetedBrep"} not supported by WASM parser`
            : geomKind === "failed"
              ? "No representation found or all geometry strategies failed"
              : qSrc === "none"
                ? "No Qto_*, custom property set, or computable geometry"
                : "Geometry computation produced zero values"
          : undefined;
        const niceGeomName = geomKind ? (geomKind.charAt(0).toUpperCase() + geomKind.slice(1).replace(/([A-Z])/g, " $1").trim()) : null;
        collectElementSample({
          expressId: expressID,
          ifcType: label,
          storey: sampleStorey,
          material: sampleMaterial,
          geometryType: niceGeomName,
          quantitySource: qSrc,
          grossArea: Math.round(aGross * 100) / 100,
          volume: Math.round(vBase * 100) / 100,
          hasZeroQuantity: isZero,
          fallbackChain,
          failureReason,
        });

        // ── Unit conversion: apply lengthConversionFactor if non-metric units detected ──
        if (unitConversionApplied && lengthConversionFactor !== 1.0) {
          const lf = lengthConversionFactor;        // e.g. 0.3048 for feet → meters
          const af = lf * lf;                       // area conversion factor
          const vf = lf * lf * lf;                  // volume conversion factor
          if (quantities.length) quantities.length *= lf;
          if (quantities.width) quantities.width *= lf;
          if (quantities.height) quantities.height *= lf;
          if (quantities.thickness) quantities.thickness *= lf;
          if (quantities.perimeter) quantities.perimeter *= lf;
          if (quantities.area?.gross) quantities.area.gross *= af;
          if (quantities.area?.net) quantities.area.net *= af;
          if (quantities.openingArea) quantities.openingArea *= af;
          if (quantities.crossSectionArea) quantities.crossSectionArea *= af;
          if (quantities.outerSurfaceArea) quantities.outerSurfaceArea *= af;
          if (quantities.footprintArea) quantities.footprintArea *= af;
          if (quantities.volume?.base) quantities.volume.base *= vf;
          // Weight is always in kg, no conversion needed
        }

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

        // Read PredefinedType for IfcCovering to distinguish FLOORING/CEILING/CLADDING/ROOFING
        const elementProperties: Record<string, unknown> = {};
        if (label === "IfcCovering" && element?.PredefinedType?.value) {
          elementProperties.PredefinedType = String(element.PredefinedType.value).toUpperCase();
        }
        // Concrete grade from Pset (extracted in extractQuantities)
        if (quantities.concreteGrade) {
          elementProperties.concreteGrade = quantities.concreteGrade;
        }

        const elementData: IFCElementData = {
          id: globalId,
          type: label,
          name,
          storey: storeyName,
          material: materialName,
          materialLayers: layers && layers.length > 1 ? layers : undefined,
          quantities,
          ...(Object.keys(elementProperties).length > 0 ? { properties: elementProperties } : {}),
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

  diag.timings.elementProcessMs = Date.now() - elementProcessStart;
  fileMeta.geometryTypesPresent = Array.from(geometryTypesPresentSet).sort();

  // ── Post-processing: distribute unaccounted door/window area to walls by storey ──
  const aggregationStart = Date.now();
  // Mirrors the text parser's fallback: for walls with zero IfcRelVoidsElement
  // deductions, proportionally distribute door/window area from the same storey.
  // This catches IFC exports that don't create explicit void relationships.
  {
    const doorAreaByStorey = new Map<string, number>();
    const deductedByStorey = new Map<string, number>();
    const wallsByStorey = new Map<string, IFCElementData[]>();

    // Collect all elements from all divisions
    for (const [, categoriesMap] of elementsByDivision) {
      for (const [, elems] of categoriesMap) {
        for (const elem of elems) {
          const s = elem.storey;
          if (elem.type === "IfcDoor" || elem.type === "IfcWindow") {
            const doorArea = elem.quantities.area?.gross ?? (elem.quantities.width && elem.quantities.height ? elem.quantities.width * elem.quantities.height : 0);
            if (doorArea > 0) {
              doorAreaByStorey.set(s, (doorAreaByStorey.get(s) ?? 0) + doorArea);
            }
          }
          if ((elem.type === "IfcWall" || elem.type === "IfcWallStandardCase") && (elem.quantities.area?.gross ?? 0) > 0) {
            if (!wallsByStorey.has(s)) wallsByStorey.set(s, []);
            wallsByStorey.get(s)!.push(elem);
            deductedByStorey.set(s, (deductedByStorey.get(s) ?? 0) + (elem.quantities.openingArea ?? 0));
          }
        }
      }
    }

    for (const [storey, totalDoorArea] of doorAreaByStorey) {
      const alreadyDeducted = deductedByStorey.get(storey) ?? 0;
      const remaining = totalDoorArea - alreadyDeducted;
      if (remaining <= 0) continue;

      const walls = wallsByStorey.get(storey) ?? [];
      const undeductedWalls = walls.filter(w => (w.quantities.openingArea ?? 0) === 0);
      if (undeductedWalls.length === 0) continue;

      const totalWallArea = undeductedWalls.reduce((sum, w) => sum + (w.quantities.area?.gross ?? 0), 0);
      if (totalWallArea <= 0) continue;

      for (const wall of undeductedWalls) {
        const wallGross = wall.quantities.area?.gross ?? 0;
        const share = (wallGross / totalWallArea) * remaining;
        wall.quantities.openingArea = Math.round(share * 100) / 100;
        if (wall.quantities.area?.gross) {
          wall.quantities.area.net = Math.max(0, wall.quantities.area.gross - share);
        }
        // Deduct opening volume if thickness known
        if (wall.quantities.volume?.base && wall.quantities.thickness) {
          wall.quantities.volume.base = Math.max(0, wall.quantities.volume.base - share * wall.quantities.thickness);
        }
      }

      warnings.push(`Storey "${storey}": distributed ${remaining.toFixed(1)}m² of unlinked door/window area across ${undeductedWalls.length} walls (IfcRelVoidsElement fallback).`);
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

  // ── Model Quality Validation ──
  // Assess model quality BEFORE closing — flags issues that degrade BOQ accuracy
  const modelQuality = buildModelQualityReport(
    divisions,
    elementMaterialLookup,
    elementStoreyLookup,
    totalElements,
    processedElements,
    warnings,
    { detectedUnit: detectedLengthUnit, conversionApplied: unitConversionApplied, conversionFactor: lengthConversionFactor },
  );

  // Close model
  ifcAPI.CloseModel(modelID);

  diag.timings.aggregationMs = Date.now() - aggregationStart;
  diag.timings.totalMs = Date.now() - startTime;

  // ── Smart warnings: derive actionable insight from collected diagnostics ──
  // Done once at the end so we have full counts to reason over.
  const zeroCount = diag.elementSamples.filter(e => e.hasZeroQuantity).length
    + Math.max(0, processedElements - diag.elementSamples.length); // upper-bound for elements beyond the sample cap
  const computedZeroCount = quantitySourceCounts.none + (Math.max(0, processedElements -
    (quantitySourceCounts.qto_standard + quantitySourceCounts.custom + quantitySourceCounts.geometry_calculated + quantitySourceCounts.none)));
  // Prefer the precise count derived from quantitySourceCounts when available.
  const finalZeroCount = computedZeroCount > 0 || quantitySourceCounts.none > 0 ? quantitySourceCounts.none : zeroCount;
  const sw = generateSmartWarnings(diag, processedElements, finalZeroCount);
  diag.smartWarnings = sw.warnings;
  diag.smartFixes = sw.fixes;

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
    modelQuality,
    parserDiagnostics: diag,
  };
}
