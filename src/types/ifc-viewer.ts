/* ─── IFC Viewer Types ────────────────────────────────────────────────────── */

import type {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Group,
  Mesh,
  Box3,
  Object3D,
  Material,
  Vector3,
} from "three";

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

/**
 * Scene references exposed for the Enhance feature.
 * Returns null if the model has not yet finished loading.
 */
export interface SceneRefs {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  modelGroup: Group;
}

/**
 * Tier identifier for enhancement groups.
 * Determines which subgroup in the internal enhancement group receives mounted
 * objects, so each tier can be independently unmounted.
 */
export type EnhancementTier = 1 | 2 | 3 | 4;

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

  /* ── Enhance feature surface (Phase 1 scaffold) ──
     See IFC_ENGINE_AUDIT_2026-04-21.md §7 Risk 1 for the origin of this
     contract. Every method must be safe to call before a model is loaded. */

  /** Access the live scene graph. Null before first model load. */
  getSceneRefs: () => SceneRefs | null;

  /** Read-only view of expressID -> Mesh[] (maintained internally). */
  getMeshMap: () => ReadonlyMap<number, Mesh[]>;

  /** Read-only view of expressID -> IFC type-code (maintained internally). */
  getTypeMap: () => ReadonlyMap<number, number>;

  /** Computed on demand: IFCSPACE expressID -> axis-aligned Box3 in world coordinates. */
  getSpaceBounds: () => Map<number, Box3>;

  /**
   * Mount one or more Object3Ds into the scene under the enhancement group for
   * the given tier. Safe no-op if the scene is not ready. The Object3Ds become
   * children of a tier-specific subgroup so they can be unmounted together.
   */
  mountEnhancements: (nodes: Object3D[], opts: { tier: EnhancementTier }) => void;

  /**
   * Remove mounted enhancement nodes. Omit `tier` to unmount every tier (full
   * reset). Disposes geometry and materials for mesh descendants.
   */
  unmountEnhancements: (tier?: EnhancementTier) => void;

  /**
   * Property sets for an element. Lazy-fetched via the worker; walls also have
   * Pset_WallCommon pushed at parse time (see `ifc-worker.ts`). Resolves to
   * empty array if not found or no model loaded.
   */
  getPropertySets: (expressID: number) => Promise<PropertySet[]>;

  /**
   * Snapshot of Pset_WallCommon values pushed by the worker at parse time
   * (Phase 1 added the map and the message plumbing; this accessor is the
   * Phase-2 read surface for the Tier 1 classifier). Empty until the
   * `metadata` worker message lands. Keys are wall expressIDs.
   */
  getWallPsets: () => ReadonlyMap<number, { isExternal: boolean | null; fireRating: string | null }>;

  /**
   * Update Viewport's internal "baseline material" cache for a mesh. Hover
   * and selection systems restore to this baseline after transient overlays;
   * any caller that changes `mesh.material` outside the normal hover/select
   * transient flow (Tier 1 Enhance, future tier renderers) MUST call this so
   * hover-out and selection-release restore to the *new* baseline, not the
   * pre-swap gray. Phase-2 fix for hover-reverts-to-gray regression.
   */
  syncMeshBaseline: (mesh: Mesh, material: Material | Material[]) => void;

  /* ── Panorama coordination surface ──────────────────────────────────────
     The 360° panorama feature owns `scene.background` whenever it is
     active. These three methods are the contract between the panorama
     controller and the rest of the viewer. They are safe to call before a
     model is loaded (no-op). */

  /** Show or hide the procedural blueprint-grid ground plane. The panorama
   *  controller hides it on apply (otherwise the grid floats in front of a
   *  real-world environment) and restores prior state on reset. */
  setBlueprintGridVisible: (visible: boolean) => void;

  /** Read current visibility of the procedural blueprint-grid ground plane.
   *  Used by the panorama controller to capture prior state on apply. */
  isBlueprintGridVisible: () => boolean;

  /** Flag this viewport as having panorama active. Read by other engines
   *  (notably Tier 1) to skip touching `scene.background`. The flag does
   *  NOT itself swap the background — that is the panorama controller's
   *  responsibility. */
  setPanoramaActive: (active: boolean) => void;

  /** Read the panorama-active flag. */
  isPanoramaActive: () => boolean;

  /**
   * World-space axis-aligned bounding box of the loaded model. Returns
   * null if no model is loaded or the model group has no geometry.
   *
   * Phase Panorama-V3 added this accessor so the panorama controller can
   * anchor its inverted-sphere environment to the model's footprint
   * centre + base elevation. Without it, a typical-size building floats
   * above the panorama horizon (which Three.js otherwise pins to camera
   * eye level via the implicit equirectangular-background path).
   */
  getModelBoundingBox: () => Box3 | null;

  /**
   * IfcSlab meshes from the loaded model with their predefinedType (when
   * surfaced from the parser; null otherwise).
   *
   * Phase Panorama-V4 added this accessor so the panorama controller can
   * anchor its sphere to the user-perceived ground plane (top face of the
   * lowest IfcSlab) rather than to `bbox.min.y`, which includes
   * foundations / footings / basement walls and would push the horizon
   * below the visible slab base.
   *
   * Returns an empty array when no model is loaded or no IfcSlab meshes
   * exist. `predefinedType` is null in V4 because Viewport's worker does
   * not yet surface IfcSlab.PredefinedType to mesh userData — the slab
   * filter in `findGroundY` falls through to "any slab" in that case
   * (still produces correct ground detection because lowest top-face wins).
   */
  getSlabMeshes: () => Array<{ mesh: Object3D; predefinedType: string | null }>;

  /**
   * Translate the loaded BIM model group to a world-space position.
   * Phase Panorama-V6 added this so the panorama controller can offset
   * the model so it appears `groundAnchorDistance` metres in front of
   * the panorama camera. Idempotent: calling twice with the same
   * position is a no-op.
   *
   * Safe no-op before a model has loaded.
   */
  translateModelTo: (position: Vector3) => void;

  /**
   * Restore the BIM model group to the position captured at first
   * model load (typically the world origin). Used by the panorama
   * controller's reset path.
   *
   * Safe no-op before a model has loaded.
   */
  restoreModelPosition: () => void;
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
