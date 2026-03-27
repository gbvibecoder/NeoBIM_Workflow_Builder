/* ─── IFC Viewer Types ────────────────────────────────────────────────────── */

export interface IFCModelInfo {
  modelID: number;
  schema: string;
  name: string;
  description: string;
  fileSize: number;
  fileName: string;
  elementCount: number;
  storeyCount: number;
}

export interface SpatialNode {
  expressID: number;
  type: string;
  name: string;
  children: SpatialNode[];
  elementCount: number;
  visible: boolean;
}

export interface IFCElementData {
  expressID: number;
  type: string;
  typeName: string;
  name: string;
  globalId: string;
  description: string;
  storey: string;
  material: string;
  propertySets: PropertySet[];
  quantities: QuantityEntry[];
}

export interface PropertySet {
  name: string;
  properties: PropertyEntry[];
}

export interface PropertyEntry {
  name: string;
  value: string | number | boolean;
}

export interface QuantityEntry {
  name: string;
  value: number;
  unit: string;
}

export type ViewModeType = "shaded" | "wireframe" | "xray";
export type ColorByType = "default" | "storey" | "category";
export type ProjectionType = "perspective" | "orthographic";
export type PresetView = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";
export type SectionAxis = "x" | "y" | "z";

export interface MeasurementData {
  id: string;
  startWorld: [number, number, number];
  endWorld: [number, number, number];
  distance: number;
}

export interface SectionPlaneData {
  axis: SectionAxis;
  position: number;
  enabled: boolean;
}

export interface ViewerState {
  file: File | null;
  modelInfo: IFCModelInfo | null;
  loading: boolean;
  loadProgress: number;
  loadMessage: string;
  selectedExpressID: number | null;
  selectedElement: IFCElementData | null;
  spatialTree: SpatialNode[];
  viewMode: ViewModeType;
  colorBy: ColorByType;
  showEdges: boolean;
  showGrid: boolean;
  projection: ProjectionType;
  sectionPlanes: Map<SectionAxis, SectionPlaneData>;
  measurements: MeasurementData[];
  measuringActive: boolean;
  bottomPanelOpen: boolean;
  bottomPanelTab: "tree" | "properties";
  bannerDismissed: boolean;
}

export interface ViewportHandle {
  loadFile: (buffer: ArrayBuffer, filename: string) => Promise<void>;
  fitToView: () => void;
  fitToSelection: () => void;
  setViewMode: (mode: ViewModeType) => void;
  setColorBy: (colorBy: ColorByType) => void;
  toggleEdges: () => void;
  toggleSectionPlane: (axis: SectionAxis) => void;
  startMeasurement: () => void;
  cancelMeasurement: () => void;
  clearMeasurements: () => void;
  takeScreenshot: () => void;
  setProjection: (type: ProjectionType) => void;
  setPresetView: (view: PresetView) => void;
  toggleGrid: () => void;
  hideSelected: () => void;
  isolateSelected: () => void;
  showAll: () => void;
  selectByExpressID: (id: number) => void;
  selectByType: (referenceExpressID: number) => void;
  getCSVData: () => string;
  unloadModel: () => void;
  setMeasureUnit: (unit: "m" | "ft") => void;
  onCameraChange: (cb: ((css: string) => void) | null) => void;
}

/* IFC element type IDs (web-ifc constants) */
export const IFC_TYPES: Record<number, string> = {
  /* Populated at runtime from web-ifc */
};

/* Common IFC type names for display */
export const IFC_TYPE_NAMES: Record<string, string> = {
  IFCWALL: "Wall",
  IFCWALLSTANDARDCASE: "Wall",
  IFCWINDOW: "Window",
  IFCDOOR: "Door",
  IFCSLAB: "Slab",
  IFCCOLUMN: "Column",
  IFCBEAM: "Beam",
  IFCSTAIR: "Stair",
  IFCSTAIRFLIGHT: "Stair Flight",
  IFCRAILING: "Railing",
  IFCCOVERING: "Covering",
  IFCROOF: "Roof",
  IFCFOOTING: "Footing",
  IFCBUILDINGELEMENTPROXY: "Building Element",
  IFCMEMBER: "Member",
  IFCPLATE: "Plate",
  IFCCURTAINWALL: "Curtain Wall",
  IFCFURNISHINGELEMENT: "Furniture",
  IFCFLOWSEGMENT: "Pipe/Duct",
  IFCFLOWTERMINAL: "Terminal",
  IFCFLOWFITTING: "Fitting",
  IFCSPACE: "Space",
  IFCOPENINGELEMENT: "Opening",
  IFCSITE: "Site",
  IFCBUILDING: "Building",
  IFCBUILDINGSTOREY: "Storey",
  IFCPROJECT: "Project",
};
