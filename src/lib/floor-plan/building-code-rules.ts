/**
 * Building Code Rules — NBC India 2016
 *
 * National Building Code of India (2016) compliance rules
 * covering minimum room sizes, corridor widths, door sizes,
 * window/ventilation requirements, stair dimensions, and accessibility.
 */

export type CodeCategory =
  | "room_size"
  | "corridor"
  | "door"
  | "window_ventilation"
  | "stair"
  | "accessibility"
  | "fire_safety"
  | "structural";

export type CodeSeverity = "error" | "warning" | "info";

export interface BuildingCodeRule {
  id: string;
  code_ref: string; // NBC clause reference
  category: CodeCategory;
  title: string;
  description: string;
  severity: CodeSeverity;
  /** Room types this applies to. Empty = general. */
  room_types: string[];
  /** The check function is in the validator — rules just hold parameters */
  parameters: Record<string, number | string | boolean>;
}

export interface CodeViolation {
  rule_id: string;
  rule: BuildingCodeRule;
  entity_type: "room" | "door" | "window" | "wall" | "stair" | "corridor" | "floor";
  entity_id: string | null;
  entity_name: string;
  severity: CodeSeverity;
  message: string;
  actual_value: string;
  required_value: string;
  suggestion: string;
}

// ============================================================
// ROOM SIZE RULES
// ============================================================

const ROOM_SIZE_RULES: BuildingCodeRule[] = [
  {
    id: "NBC-RS-001",
    code_ref: "NBC 2016, Clause 8.4.1",
    category: "room_size",
    title: "Habitable Room Minimum Area",
    description: "Every habitable room shall have a floor area of not less than 9.5 sq.m.",
    severity: "error",
    room_types: ["living_room", "bedroom", "master_bedroom", "guest_bedroom", "dining_room", "study", "home_office"],
    parameters: { min_area_sqm: 9.5 },
  },
  {
    id: "NBC-RS-002",
    code_ref: "NBC 2016, Clause 8.4.1",
    category: "room_size",
    title: "Habitable Room Minimum Width",
    description: "Every habitable room shall have a minimum width of 2.4 m.",
    severity: "error",
    room_types: ["living_room", "bedroom", "master_bedroom", "guest_bedroom", "dining_room", "study", "home_office"],
    parameters: { min_width_mm: 2400 },
  },
  {
    id: "NBC-RS-003",
    code_ref: "NBC 2016, Clause 8.4.2",
    category: "room_size",
    title: "Kitchen Minimum Area",
    description: "Kitchen shall have a floor area of not less than 5.0 sq.m.",
    severity: "error",
    room_types: ["kitchen"],
    parameters: { min_area_sqm: 5.0 },
  },
  {
    id: "NBC-RS-004",
    code_ref: "NBC 2016, Clause 8.4.2",
    category: "room_size",
    title: "Kitchen Minimum Width",
    description: "Kitchen shall have a minimum width of 1.8 m.",
    severity: "error",
    room_types: ["kitchen"],
    parameters: { min_width_mm: 1800 },
  },
  {
    id: "NBC-RS-005",
    code_ref: "NBC 2016, Clause 8.4.3",
    category: "room_size",
    title: "Bathroom Minimum Area",
    description: "Bathroom shall have a floor area of not less than 1.8 sq.m.",
    severity: "error",
    room_types: ["bathroom", "toilet", "wc"],
    parameters: { min_area_sqm: 1.8 },
  },
  {
    id: "NBC-RS-006",
    code_ref: "NBC 2016, Clause 8.4.3",
    category: "room_size",
    title: "Bathroom Minimum Width",
    description: "Bathroom shall have a minimum width of 1.2 m.",
    severity: "error",
    room_types: ["bathroom", "toilet", "wc"],
    parameters: { min_width_mm: 1200 },
  },
  {
    id: "NBC-RS-007",
    code_ref: "NBC 2016, Clause 8.4.1",
    category: "room_size",
    title: "Room Ceiling Height",
    description: "Habitable rooms shall have a minimum ceiling height of 2.75 m (2750 mm).",
    severity: "error",
    room_types: [],
    parameters: { min_height_mm: 2750 },
  },
];

// ============================================================
// CORRIDOR RULES
// ============================================================

const CORRIDOR_RULES: BuildingCodeRule[] = [
  {
    id: "NBC-CR-001",
    code_ref: "NBC 2016, Clause 8.5.1",
    category: "corridor",
    title: "Corridor Minimum Width (Residential)",
    description: "Corridors in residential buildings shall have a minimum width of 1.0 m.",
    severity: "error",
    room_types: ["corridor", "lobby", "foyer"],
    parameters: { min_width_mm: 1000 },
  },
  {
    id: "NBC-CR-002",
    code_ref: "NBC 2016, Clause 8.5.2",
    category: "corridor",
    title: "Corridor Minimum Width (Commercial)",
    description: "Corridors in commercial/public buildings shall have a minimum width of 1.5 m.",
    severity: "error",
    room_types: ["corridor", "lobby"],
    parameters: { min_width_mm: 1500, project_types: "commercial,institutional" },
  },
];

// ============================================================
// DOOR RULES
// ============================================================

const DOOR_RULES: BuildingCodeRule[] = [
  {
    id: "NBC-DR-001",
    code_ref: "NBC 2016, Clause 8.3.1",
    category: "door",
    title: "Main Entrance Door Minimum Width",
    description: "Main entrance door shall have a minimum clear width of 1.0 m.",
    severity: "error",
    room_types: [],
    parameters: { min_width_mm: 1000, door_types: "main_entrance" },
  },
  {
    id: "NBC-DR-002",
    code_ref: "NBC 2016, Clause 8.3.1",
    category: "door",
    title: "Internal Door Minimum Width",
    description: "Internal doors shall have a minimum clear width of 0.75 m.",
    severity: "error",
    room_types: [],
    parameters: { min_width_mm: 750, door_types: "single_swing,double_swing,sliding,pocket,bi_fold" },
  },
  {
    id: "NBC-DR-003",
    code_ref: "NBC 2016, Clause 8.3.1",
    category: "door",
    title: "Door Minimum Height",
    description: "All doors shall have a minimum clear height of 2.0 m.",
    severity: "error",
    room_types: [],
    parameters: { min_height_mm: 2000 },
  },
  {
    id: "NBC-DR-004",
    code_ref: "NBC 2016, Clause 8.3.2",
    category: "door",
    title: "Bathroom Door Minimum Width",
    description: "Bathroom/toilet doors shall have a minimum clear width of 0.6 m.",
    severity: "warning",
    room_types: [],
    parameters: { min_width_mm: 600, connects_to: "bathroom,toilet,wc" },
  },
];

// ============================================================
// WINDOW / VENTILATION RULES
// ============================================================

const WINDOW_RULES: BuildingCodeRule[] = [
  {
    id: "NBC-WV-001",
    code_ref: "NBC 2016, Clause 8.4.6",
    category: "window_ventilation",
    title: "Window-to-Floor Area Ratio",
    description: "Habitable rooms shall have window openings of at least 1/10th of the floor area for natural light.",
    severity: "error",
    room_types: ["living_room", "bedroom", "master_bedroom", "guest_bedroom", "dining_room", "study", "home_office", "kitchen"],
    parameters: { min_ratio: 0.10 },
  },
  {
    id: "NBC-WV-002",
    code_ref: "NBC 2016, Clause 8.4.7",
    category: "window_ventilation",
    title: "Ventilation Openings",
    description: "Habitable rooms shall have ventilation openings of at least 1/20th of the floor area.",
    severity: "warning",
    room_types: ["living_room", "bedroom", "master_bedroom", "guest_bedroom", "dining_room", "kitchen"],
    parameters: { min_ratio: 0.05 },
  },
  {
    id: "NBC-WV-003",
    code_ref: "NBC 2016, Clause 8.4.8",
    category: "window_ventilation",
    title: "Bathroom Ventilation",
    description: "Bathrooms shall have a ventilation opening of at least 0.3 sq.m or mechanical ventilation.",
    severity: "warning",
    room_types: ["bathroom", "toilet", "wc"],
    parameters: { min_opening_sqm: 0.3 },
  },
];

// ============================================================
// STAIR RULES
// ============================================================

const STAIR_RULES: BuildingCodeRule[] = [
  {
    id: "NBC-ST-001",
    code_ref: "NBC 2016, Clause 8.6.1",
    category: "stair",
    title: "Stair Minimum Width",
    description: "Stairs in residential buildings shall have a minimum width of 0.9 m.",
    severity: "error",
    room_types: [],
    parameters: { min_width_mm: 900 },
  },
  {
    id: "NBC-ST-002",
    code_ref: "NBC 2016, Clause 8.6.2",
    category: "stair",
    title: "Stair Riser Height",
    description: "Maximum riser height shall not exceed 190 mm for residential buildings.",
    severity: "error",
    room_types: [],
    parameters: { max_riser_mm: 190 },
  },
  {
    id: "NBC-ST-003",
    code_ref: "NBC 2016, Clause 8.6.2",
    category: "stair",
    title: "Stair Tread Depth",
    description: "Minimum tread depth shall be 250 mm for residential buildings.",
    severity: "error",
    room_types: [],
    parameters: { min_tread_mm: 250 },
  },
  {
    id: "NBC-ST-004",
    code_ref: "NBC 2016, Clause 8.6.3",
    category: "stair",
    title: "Stair Headroom",
    description: "Minimum headroom above any stair tread shall be 2.2 m.",
    severity: "warning",
    room_types: [],
    parameters: { min_headroom_mm: 2200 },
  },
];

// ============================================================
// ACCESSIBILITY RULES
// ============================================================

const ACCESSIBILITY_RULES: BuildingCodeRule[] = [
  {
    id: "NBC-AC-001",
    code_ref: "NBC 2016, Clause 11.1",
    category: "accessibility",
    title: "Wheelchair Accessible Corridor",
    description: "At least one corridor path shall be 1.2 m wide for wheelchair access.",
    severity: "warning",
    room_types: ["corridor", "lobby"],
    parameters: { min_width_mm: 1200 },
  },
  {
    id: "NBC-AC-002",
    code_ref: "NBC 2016, Clause 11.3",
    category: "accessibility",
    title: "Accessible Bathroom Space",
    description: "Accessible bathrooms shall provide 1.5 m turning circle.",
    severity: "info",
    room_types: ["bathroom"],
    parameters: { min_turning_circle_mm: 1500 },
  },
];

// ============================================================
// FIRE SAFETY RULES
// ============================================================

const FIRE_SAFETY_RULES: BuildingCodeRule[] = [
  {
    id: "NBC-FS-001",
    code_ref: "NBC 2016, Part 4",
    category: "fire_safety",
    title: "Fire Escape Route Width",
    description: "Fire escape routes shall have minimum 1.0 m unobstructed width.",
    severity: "error",
    room_types: ["fire_escape", "corridor", "staircase"],
    parameters: { min_width_mm: 1000 },
  },
];

// ============================================================
// EXPORT ALL RULES
// ============================================================

export const ALL_BUILDING_CODE_RULES: BuildingCodeRule[] = [
  ...ROOM_SIZE_RULES,
  ...CORRIDOR_RULES,
  ...DOOR_RULES,
  ...WINDOW_RULES,
  ...STAIR_RULES,
  ...ACCESSIBILITY_RULES,
  ...FIRE_SAFETY_RULES,
];

/** Get rules by category */
export function getCodeRulesByCategory(category: CodeCategory): BuildingCodeRule[] {
  return ALL_BUILDING_CODE_RULES.filter((r) => r.category === category);
}

/** Category display labels */
export const CODE_CATEGORY_LABELS: Record<CodeCategory, string> = {
  room_size: "Room Sizes",
  corridor: "Corridors",
  door: "Doors",
  window_ventilation: "Windows & Ventilation",
  stair: "Stairs",
  accessibility: "Accessibility",
  fire_safety: "Fire Safety",
  structural: "Structural",
};
