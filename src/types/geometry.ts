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
  type: "wall" | "slab" | "column" | "roof" | "space" | "window" | "door" | "beam" | "stair";
  vertices: Vertex[];
  faces: Face[];
  /** IFC element class this maps to */
  ifcType: "IfcWall" | "IfcSlab" | "IfcColumn" | "IfcBuildingElementProxy" | "IfcSpace"
    | "IfcWindow" | "IfcDoor" | "IfcBeam" | "IfcStairFlight";
  /** Metadata */
  properties: {
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
    /** For stairs: number of risers */
    riserCount?: number;
    /** For stairs: riser height */
    riserHeight?: number;
    /** For stairs: tread depth */
    treadDepth?: number;
  };
}

/** A single building storey */
export interface MassingStorey {
  index: number;
  name: string;
  elevation: number;
  height: number;
  elements: GeometryElement[];
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
