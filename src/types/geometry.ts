/**
 * Type definitions for 3D massing geometry and IFC export.
 */

/** A 3D point/vertex */
export interface Vertex {
  x: number;
  y: number;
  z: number;
}

/** A face defined by vertex indices */
export interface Face {
  vertices: number[]; // indices into the vertex array
}

/** A single geometry element (wall, slab, space, etc.) */
export interface GeometryElement {
  id: string;
  type: "wall" | "slab" | "column" | "roof" | "space" | "window" | "door" | "beam" | "stair"
    | "balcony" | "canopy" | "parapet" | "duct" | "pipe" | "cable-tray" | "equipment"
    | "mullion" | "spandrel"
    // Phase 1 Track C: new entity-type literals (architectural, structural, MEP).
    // Emitters may begin setting these in Phase 2+; builders ignore unknown
    // (type, ifcType) pairs safely, so landing them now unblocks downstream work.
    | "railing" | "ramp" | "covering-ceiling" | "covering-floor" | "furniture"
    | "plate" | "member" | "footing" | "curtain-wall"
    | "sanitary-terminal" | "light-fixture" | "air-terminal" | "flow-terminal";
  vertices: Vertex[];
  faces: Face[];
  /** IFC element class this maps to */
  ifcType: "IfcWall" | "IfcSlab" | "IfcColumn" | "IfcBuildingElementProxy" | "IfcSpace"
    | "IfcWindow" | "IfcDoor" | "IfcBeam" | "IfcStairFlight" | "IfcRailing" | "IfcCovering"
    | "IfcFooting" | "IfcDuctSegment" | "IfcPipeSegment" | "IfcCableCarrierSegment" | "IfcFlowTerminal"
    // Phase 1 Track C: new IFC4 entity classes matching the type literals above.
    | "IfcRamp" | "IfcFurniture" | "IfcPlate" | "IfcMember" | "IfcCurtainWall"
    | "IfcSanitaryTerminal" | "IfcLightFixture" | "IfcAirTerminal";
  /** Metadata */
  properties: ElementProperties;
}

/**
 * Element property bag. All fields are optional to preserve backward
 * compatibility — a payload produced against the pre-Track-C schema still
 * validates. New fields are grouped by discipline and consumed by emitters
 * that care (Python builder today; TS exporter on a gated path only).
 */
export interface ElementProperties {
  name: string;
  storeyIndex: number;
  height?: number;
  width?: number;
  length?: number;
  thickness?: number;
  area?: number;
  volume?: number;
  /** For interior partition walls vs exterior walls */
  isPartition?: boolean;
  /** For circular columns */
  radius?: number;
  /** For IfcSpace: room name */
  spaceName?: string;
  /** For IfcSpace: usage/function */
  spaceUsage?: string;
  /** For IfcSpace: footprint polygon */
  spaceFootprint?: FootprintPoint[];
  /** For windows/doors: sill height above floor */
  sillHeight?: number;
  /** For windows/doors: position along parent wall (distance from wall start) */
  wallOffset?: number;
  /** For windows/doors: reference to parent wall element ID */
  parentWallId?: string;
  /** For windows/doors: wall direction unit vector */
  wallDirectionX?: number;
  wallDirectionY?: number;
  /** For windows/doors: wall origin point */
  wallOriginX?: number;
  wallOriginY?: number;
  /** For beams: material type */
  material?: string;
  /** BIM discipline for IFC split export */
  discipline?: "architectural" | "structural" | "mep";
  /** For pipes: diameter in meters */
  diameter?: number;
  /** Whether element is exterior-facing */
  isExterior?: boolean;
  /** For stairs: number of risers */
  riserCount?: number;
  /** For stairs: riser height */
  riserHeight?: number;
  /** For stairs: tread depth */
  treadDepth?: number;

  // ── Phase 1 Track C: architectural fields ──────────────────────────

  /** Detailed wall classification (supersedes coarse `isPartition`) */
  wallType?: "exterior" | "interior" | "partition" | "shear" | "curtain";
  /** Whether the element carries gravity/lateral load */
  loadBearing?: boolean;
  /** Fire-resistance rating, e.g. "2HR", "60min" */
  fireRating?: string;
  /** Acoustic rating, e.g. "STC-50" */
  acousticRating?: string;
  /** Thermal transmittance in W/(m²·K) */
  uValue?: number;
  /** For windows: glazing spec, e.g. "double-low-e", "triple-argon" */
  glazingType?: string;
  /** For windows/doors: frame material, e.g. "aluminum", "wood", "upvc" */
  frameMaterial?: string;
  /** For windows/doors: operation, e.g. "fixed", "casement", "sliding", "hung" */
  operationType?: string;
  /** For doors: hinge side */
  handedness?: "left" | "right";
  /** Interior finish, e.g. "paint", "tile", "plaster" */
  finishMaterial?: string;
  /** For IfcSpace: occupancy/use class, e.g. "office", "corridor", "restroom" */
  occupancyType?: string;

  // ── Phase 1 Track C: structural fields ─────────────────────────────

  /** Primary structural material family */
  structuralMaterial?: "concrete" | "steel" | "timber" | "masonry" | "composite";
  /** Material grade, e.g. "C30/37", "S355", "A992", "Grade-60" */
  materialGrade?: string;
  /** Cross-section profile designation, e.g. "W12x26", "HSS6x6x1/2", "UB406x140x39" */
  sectionProfile?: string;
  /** Reinforcement ratio in kg/m³ of concrete */
  rebarRatio?: number;
  /** Concrete compressive strength in MPa */
  concreteStrength?: number;
  /** Structural role in the load path */
  memberRole?: "primary" | "secondary" | "tertiary";
  /** Factored axial load in kN */
  axialLoad?: number;
  /** Clear span length in meters */
  spanLength?: number;

  // ── Phase 1 Track C: MEP fields ────────────────────────────────────

  /** MEP system classification */
  mepSystem?:
    | "hvac-supply"
    | "hvac-return"
    | "hvac-exhaust"
    | "plumbing-cold"
    | "plumbing-hot"
    | "plumbing-waste"
    | "plumbing-vent"
    | "electrical-power"
    | "electrical-lighting"
    | "electrical-low-voltage"
    | "fire-protection"
    | "data";
  /** Design flow rate in L/s */
  flowRate?: number;
  /** Design pressure in kPa */
  pressure?: number;
  /** Nominal voltage in V */
  voltage?: number;
  /** Power rating in W */
  powerRating?: number;
  /** Insulation thickness in meters */
  insulationThickness?: number;
  /** Nominal connection/terminal size in mm */
  connectionSize?: number;
}

/** A single building storey */
export interface MassingStorey {
  index: number;
  name: string;
  elevation: number;
  height: number;
  elements: GeometryElement[];
  isBasement?: boolean;
}

/** A 2D footprint point */
export interface FootprintPoint {
  x: number;
  y: number;
}

/** Complete massing geometry output from GN-001 */
export interface MassingGeometry {
  buildingType: string;
  floors: number;
  totalHeight: number;
  footprintArea: number;
  gfa: number;
  footprint: FootprintPoint[];
  storeys: MassingStorey[];
  boundingBox: {
    min: Vertex;
    max: Vertex;
  };
  metrics: Array<{
    label: string;
    value: string | number;
    unit?: string;
  }>;
}

/** Programme entry describing a room/space */
export interface ProgrammeEntry {
  space: string;
  area_m2?: number;
  floor?: string;
}

/** Input for the IFC exporter */
export interface IFCExportInput {
  geometry: MassingGeometry;
  projectName?: string;
  siteName?: string;
  buildingName?: string;
}
