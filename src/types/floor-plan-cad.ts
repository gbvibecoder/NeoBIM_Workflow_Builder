/**
 * Floor Plan CAD Data Model
 *
 * Canonical schema for the professional 2D floor plan viewer/editor.
 * ALL measurements are in millimeters internally.
 * Coordinate system: origin (0,0) at bottom-left, X→right, Y→up.
 * Wall geometry: defined by centerline + thickness.
 */

// ============================================================
// GEOMETRIC PRIMITIVES
// ============================================================

export interface Point {
  x: number; // mm from origin
  y: number; // mm from origin
}

export interface Polygon {
  points: Point[];
  holes?: Point[][];
}

export interface Line {
  start: Point;
  end: Point;
}

// ============================================================
// PROJECT
// ============================================================

export interface FloorPlanProject {
  id: string;
  name: string;
  version: string;
  created_at: string;
  updated_at: string;
  metadata: ProjectMetadata;
  settings: ProjectSettings;
  floors: Floor[];
}

export interface ProjectMetadata {
  client_name?: string;
  project_type: "residential" | "commercial" | "mixed_use" | "institutional" | "industrial";
  building_type: string;
  location?: {
    city: string;
    state: string;
    country: string;
    climate_zone?: string;
  };
  plot_area_sqm?: number;
  built_up_area_sqm?: number;
  carpet_area_sqm?: number;
  num_floors: number;
  building_code?: string;
  original_prompt?: string;
  design_brief?: string;
  generation_model?: string;
  generation_timestamp?: string;
}

export interface ProjectSettings {
  units: "metric" | "imperial";
  display_unit: "mm" | "cm" | "m" | "ft" | "in";
  scale: string;
  grid_size_mm: number;
  wall_thickness_mm: number;
  paper_size: "A4" | "A3" | "A2" | "A1" | "A0" | "ARCH_D" | "ANSI_D";
  orientation: "portrait" | "landscape";
  north_angle_deg: number;
  vastu_compliance: boolean;
  feng_shui_compliance: boolean;
  ada_compliance: boolean;
  nbc_compliance: boolean;
}

// ============================================================
// FLOOR
// ============================================================

export interface Floor {
  id: string;
  name: string;
  level: number;
  floor_to_floor_height_mm: number;
  slab_thickness_mm: number;
  boundary: Polygon;
  walls: Wall[];
  rooms: Room[];
  doors: Door[];
  windows: CadWindow[];
  stairs: Stair[];
  columns: Column[];
  furniture: FurnitureInstance[];
  fixtures: FixtureInstance[];
  annotations: Annotation[];
  dimensions: DimensionLine[];
  zones: Zone[];
}

// ============================================================
// WALLS
// ============================================================

export interface Wall {
  id: string;
  type: "exterior" | "interior" | "partition" | "shear" | "curtain" | "retaining";
  material: "brick" | "concrete" | "block" | "drywall" | "glass" | "stone" | "wood";
  centerline: { start: Point; end: Point };
  thickness_mm: number;
  height_mm: number;
  left_room_id?: string;
  right_room_id?: string;
  openings: WallOpening[];
  line_weight: "thin" | "medium" | "thick";
  hatch_pattern?: string;
  is_load_bearing: boolean;
}

export interface WallOpening {
  id: string;
  type: "door" | "window" | "archway" | "pass_through";
  ref_id: string;
  offset_from_start_mm: number;
  width_mm: number;
  sill_height_mm: number;
  head_height_mm: number;
}

// ============================================================
// ROOMS
// ============================================================

export type RoomType =
  | "living_room" | "dining_room" | "bedroom" | "master_bedroom" | "guest_bedroom"
  | "kitchen" | "bathroom" | "toilet" | "wc" | "utility" | "laundry"
  | "study" | "home_office" | "puja_room" | "store_room" | "pantry"
  | "balcony" | "terrace" | "verandah" | "corridor" | "lobby" | "foyer"
  | "walk_in_closet" | "dressing_room" | "servant_quarter" | "garage"
  | "office" | "conference_room" | "meeting_room" | "reception"
  | "server_room" | "break_room" | "cafeteria" | "restroom"
  | "open_office" | "cabin" | "board_room"
  | "staircase" | "elevator" | "lift_lobby" | "shaft"
  | "electrical_room" | "mechanical_room" | "fire_escape"
  | "courtyard" | "garden" | "parking" | "ramp"
  | "custom";

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  boundary: Polygon;
  area_sqm: number;
  perimeter_mm: number;
  min_area_sqm?: number;
  min_dimension_mm?: number;
  natural_light_required: boolean;
  ventilation_required: boolean;
  label_position: Point;
  fill_color?: string;
  fill_opacity?: number;
  vastu_direction?: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "CENTER";
  vastu_compliant?: boolean;
  vastu_notes?: string;
  wall_ids: string[];
}

// ============================================================
// DOORS
// ============================================================

export type DoorType =
  | "single_swing" | "double_swing" | "sliding" | "pocket"
  | "bi_fold" | "french" | "revolving" | "pivot"
  | "barn" | "accordion" | "garage" | "fire_rated"
  | "main_entrance" | "service_entrance";

export interface DoorSymbol {
  hinge_point: Point;
  arc_radius_mm: number;
  arc_start_angle_deg: number;
  arc_end_angle_deg: number;
  leaf_end_point: Point;
}

export interface Door {
  id: string;
  type: DoorType;
  wall_id: string;
  width_mm: number;
  height_mm: number;
  thickness_mm: number;
  position_along_wall_mm: number;
  swing_direction: "left" | "right";
  swing_angle_deg: number;
  opens_to: "inside" | "outside";
  symbol: DoorSymbol;
  connects_rooms: [string, string];
}

// ============================================================
// WINDOWS
// ============================================================

export type WindowType =
  | "fixed" | "casement" | "sliding" | "awning" | "hopper"
  | "double_hung" | "louvered" | "bay" | "bow" | "skylight"
  | "picture" | "transom" | "clerestory" | "french";

export interface WindowSymbol {
  start_point: Point;
  end_point: Point;
  glass_lines: Line[];
}

export interface CadWindow {
  id: string;
  type: WindowType;
  wall_id: string;
  width_mm: number;
  height_mm: number;
  sill_height_mm: number;
  position_along_wall_mm: number;
  symbol: WindowSymbol;
  glazing: "single" | "double" | "triple";
  operable: boolean;
}

// ============================================================
// STAIRS
// ============================================================

export interface Stair {
  id: string;
  type: "straight" | "l_shaped" | "u_shaped" | "spiral" | "curved" | "dog_leg";
  boundary: Polygon;
  num_risers: number;
  riser_height_mm: number;
  tread_depth_mm: number;
  width_mm: number;
  landing_depth_mm?: number;
  up_direction: { start: Point; end: Point };
  treads: Line[];
  has_railing: boolean;
  railing_side: "left" | "right" | "both";
  connects_floors: [number, number];
}

// ============================================================
// COLUMNS
// ============================================================

export interface Column {
  id: string;
  type: "rectangular" | "circular" | "l_shaped" | "t_shaped";
  center: Point;
  width_mm?: number;
  depth_mm?: number;
  rotation_deg?: number;
  diameter_mm?: number;
  is_structural: boolean;
  grid_ref?: string;
}

// ============================================================
// FURNITURE & FIXTURES
// ============================================================

export interface FurnitureInstance {
  id: string;
  catalog_id: string;
  position: Point;
  rotation_deg: number;
  scale: number;
  room_id: string;
  locked: boolean;
}

export type FixtureType =
  | "toilet" | "bidet" | "urinal"
  | "bathtub" | "shower" | "shower_enclosure"
  | "washbasin" | "double_basin" | "vanity"
  | "sink" | "double_sink"
  | "stove" | "oven" | "cooktop"
  | "refrigerator" | "dishwasher"
  | "kitchen_counter" | "island"
  | "washing_machine" | "dryer"
  | "water_heater" | "ac_unit";

export interface FixtureInstance {
  id: string;
  type: FixtureType;
  position: Point;
  rotation_deg: number;
  room_id: string;
  properties: Record<string, unknown>;
}

export interface PlanSymbol {
  paths: Array<{
    d: string;
    stroke_width: number;
    fill?: string;
    dash?: number[];
  }>;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  outline: Polygon;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  plan_symbol: PlanSymbol;
  clearance: {
    front_mm: number;
    back_mm: number;
    left_mm: number;
    right_mm: number;
  };
}

// ============================================================
// ANNOTATIONS & DIMENSIONS
// ============================================================

export interface Annotation {
  id: string;
  type: "text" | "leader" | "callout" | "revision_cloud" | "section_mark" | "elevation_mark";
  position: Point;
  text: string;
  font_size_mm: number;
  rotation_deg: number;
  leader_line?: Point[];
  direction?: number;
  ref_id?: string;
}

export type DimensionType = "linear" | "aligned" | "angular" | "radial" | "diameter" | "chain" | "baseline";

export interface DimensionLine {
  id: string;
  type: DimensionType;
  start_point?: Point;
  end_point?: Point;
  offset_mm?: number;
  center?: Point;
  angle_start_deg?: number;
  angle_end_deg?: number;
  value_mm: number;
  display_value: string;
  text_position: Point;
  text_rotation_deg: number;
  extension_line_gap_mm: number;
  extension_line_overshoot_mm: number;
  arrow_style: "tick" | "arrow" | "dot" | "open_arrow";
  layer: string;
}

// ============================================================
// ZONES
// ============================================================

export interface Zone {
  id: string;
  name: string;
  type: "public" | "private" | "semi_private" | "service" | "circulation" | "outdoor";
  room_ids: string[];
  color: string;
  opacity: number;
}

// ============================================================
// EDITOR STATE TYPES
// ============================================================

export type EditorTool =
  | "select" | "wall" | "door" | "window"
  | "furniture" | "measure" | "annotate"
  | "pan" | "stair" | "column";

export type ViewMode = "cad" | "presentation" | "construction";

export interface LayerConfig {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  printable: boolean;
  opacity: number;
  color?: string;
}

export const DEFAULT_LAYERS: LayerConfig[] = [
  { id: "A-WALL-EXTR", name: "Exterior Walls", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-WALL-INTR", name: "Interior Walls", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-DOOR", name: "Doors", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-WIND", name: "Windows", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-STRS", name: "Stairs", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-COLS", name: "Columns", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-ROOM-FILL", name: "Room Fills", visible: true, locked: false, printable: true, opacity: 0.4 },
  { id: "A-ROOM-NAME", name: "Room Labels", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-FURN", name: "Furniture", visible: false, locked: false, printable: true, opacity: 0.6 },
  { id: "A-FIXT", name: "Fixtures", visible: false, locked: false, printable: true, opacity: 0.6 },
  { id: "A-DIM", name: "Dimensions", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-DIM-OVERALL", name: "Overall Dimensions", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-NOTE", name: "Annotations", visible: true, locked: false, printable: true, opacity: 1 },
  { id: "A-SCALE", name: "Scale Bar", visible: true, locked: true, printable: true, opacity: 1 },
  { id: "A-NORTH", name: "North Arrow", visible: true, locked: true, printable: true, opacity: 1 },
  { id: "A-MEASURE", name: "Measurements", visible: true, locked: false, printable: false, opacity: 1 },
  { id: "A-GRID", name: "Grid", visible: false, locked: true, printable: false, opacity: 0.5 },
  { id: "A-GRID-STRU", name: "Structural Grid", visible: false, locked: true, printable: true, opacity: 0.3 },
  { id: "A-VASTU", name: "Vastu Overlay", visible: true, locked: true, printable: false, opacity: 0.5 },
];

export const ROOM_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  living_room:     { fill: "#D5F5E3", stroke: "#82E0AA", label: "#1E8449" },
  dining_room:     { fill: "#D5F5E3", stroke: "#82E0AA", label: "#1E8449" },
  bedroom:         { fill: "#D4E6F1", stroke: "#85C1E9", label: "#2471A3" },
  master_bedroom:  { fill: "#D4E6F1", stroke: "#85C1E9", label: "#2471A3" },
  guest_bedroom:   { fill: "#D4E6F1", stroke: "#85C1E9", label: "#2471A3" },
  kitchen:         { fill: "#FEF9E7", stroke: "#F9E79F", label: "#B7950B" },
  bathroom:        { fill: "#FDEDEC", stroke: "#F5B7B1", label: "#C0392B" },
  wc:              { fill: "#FDEDEC", stroke: "#F5B7B1", label: "#C0392B" },
  toilet:          { fill: "#FDEDEC", stroke: "#F5B7B1", label: "#C0392B" },
  balcony:         { fill: "#E8F8F5", stroke: "#76D7C4", label: "#148F77" },
  terrace:         { fill: "#E8F8F5", stroke: "#76D7C4", label: "#148F77" },
  verandah:        { fill: "#E8F8F5", stroke: "#76D7C4", label: "#148F77" },
  corridor:        { fill: "#F2F3F4", stroke: "#BDC3C7", label: "#7F8C8D" },
  lobby:           { fill: "#F2F3F4", stroke: "#BDC3C7", label: "#7F8C8D" },
  foyer:           { fill: "#F2F3F4", stroke: "#BDC3C7", label: "#7F8C8D" },
  study:           { fill: "#E8DAEF", stroke: "#BB8FCE", label: "#7D3C98" },
  home_office:     { fill: "#E8DAEF", stroke: "#BB8FCE", label: "#7D3C98" },
  puja_room:       { fill: "#FDEBD0", stroke: "#F5CBA7", label: "#CA6F1E" },
  store_room:      { fill: "#F2F3F4", stroke: "#BDC3C7", label: "#7F8C8D" },
  utility:         { fill: "#F2F3F4", stroke: "#BDC3C7", label: "#7F8C8D" },
  laundry:         { fill: "#F2F3F4", stroke: "#BDC3C7", label: "#7F8C8D" },
  garage:          { fill: "#EAECEE", stroke: "#ABB2B9", label: "#5D6D7E" },
  staircase:       { fill: "#EAECEE", stroke: "#ABB2B9", label: "#5D6D7E" },
  elevator:        { fill: "#EAECEE", stroke: "#ABB2B9", label: "#5D6D7E" },
  walk_in_closet:  { fill: "#E8DAEF", stroke: "#BB8FCE", label: "#7D3C98" },
  dressing_room:   { fill: "#E8DAEF", stroke: "#BB8FCE", label: "#7D3C98" },
  pantry:          { fill: "#FEF9E7", stroke: "#F9E79F", label: "#B7950B" },
  servant_quarter: { fill: "#F2F3F4", stroke: "#BDC3C7", label: "#7F8C8D" },
  office:          { fill: "#D4E6F1", stroke: "#85C1E9", label: "#2471A3" },
  conference_room: { fill: "#D4E6F1", stroke: "#85C1E9", label: "#2471A3" },
  meeting_room:    { fill: "#D4E6F1", stroke: "#85C1E9", label: "#2471A3" },
  reception:       { fill: "#D5F5E3", stroke: "#82E0AA", label: "#1E8449" },
  custom:          { fill: "#F2F3F4", stroke: "#BDC3C7", label: "#7F8C8D" },
};
