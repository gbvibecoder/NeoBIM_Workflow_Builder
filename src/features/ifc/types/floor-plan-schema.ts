/* ─── Floor-plan brief schema ──────────────────────────────────────────────
   Strict typed output of the Brief Parser when the input PDF describes a
   specific, room-level floor plan (as opposed to a high-level massing
   brief). Drives the room-level IFC builder in
   `floor-plan-to-massing.ts`.

   Units: feet are the primary unit because residential briefs in India
   and the US/UK are written in feet/inches. The converter handles ft→m
   at a single boundary. Inches are expressed as decimal feet
   (10' 6" → 10.5).

   Coordinate convention:
     · Plot is laid out on the world XZ plane (Y is up).
     · `+X` runs East, `+Z` runs South. `northAxis` says which world
       direction the brief calls "North"; the converter rotates the
       plot accordingly so North-facing windows really face the world's
       +Z (or whatever the brief specifies).

   Backwards-compatible: every floor-plan field is **optional** at the
   ParsedBrief level so existing massing briefs (which never populate
   `floorPlan`) keep working unchanged. */

/** Compass quadrant or cardinal direction the room lives in within the plot. */
export type FloorPlanQuadrant =
  | "NW" | "N" | "NE"
  | "W"  |       "E"
  | "SW" | "S" | "SE"
  | "center";

/** Cardinal wall identifier for door/window placement. */
export type CardinalWall = "N" | "S" | "E" | "W";

/** Which world axis the brief calls "North". */
export type NorthAxis = "Z+" | "Z-" | "X+" | "X-";

/** Door specification — position is along a stated wall. */
export interface FloorPlanDoor {
  /** Wall this door sits on. */
  wall: CardinalWall;
  /** Door width in feet. Default 3 ft (≈ 915 mm) when omitted. */
  widthFt?: number;
  /** Door height in feet. Default 7 ft (≈ 2.13 m). */
  heightFt?: number;
  /** Hinge side. Defaults to "right". */
  handedness?: "left" | "right";
  /** Free-text room this door connects to (e.g. "kitchen", "outside"). */
  connectsTo?: string;
}

/** Window specification — single window per `wall` by default; multiple
 *  windows on the same wall require multiple entries. */
export interface FloorPlanWindow {
  wall: CardinalWall;
  /** Window width in feet. Default 4 ft. */
  widthFt?: number;
  /** Window height in feet. Default 4 ft. */
  heightFt?: number;
  /** Sill height (height above floor) in feet. Default 3 ft. */
  sillHeightFt?: number;
}

/** Room specification — every room contributes 4 walls (some shared with
 *  neighbours), 0+ doors, 0+ windows, 1 floor slab, 1 ceiling slab. */
export interface FloorPlanRoom {
  /** Display name. Examples: "Hall", "Bedroom 1", "Kitchen", "Toilet". */
  name: string;
  /** Width in feet (aligned with the X axis after orientation rotation). */
  widthFt: number;
  /** Length in feet (aligned with the Z axis after orientation rotation). */
  lengthFt: number;
  /** Quadrant of the plot this room occupies. The converter resolves
   *  same-quadrant collisions by stacking rooms left-to-right within the
   *  quadrant in the order they appear. */
  quadrant: FloorPlanQuadrant;
  doors?: FloorPlanDoor[];
  windows?: FloorPlanWindow[];
  /** Free-text usage hint for IfcSpace.LongName. */
  usage?: string;
  /** Optional finish material — surfaced as `properties.finishMaterial`. */
  finishMaterial?: string;
}

/** Staircase specification. Defaults sized for residential per IS standards. */
export interface FloorPlanStaircase {
  /** Where on the plot the staircase sits. */
  quadrant: FloorPlanQuadrant;
  /** "Dog-legged" = 2 flights with a half-landing. "Straight" = single run. */
  type?: "dog-legged" | "straight";
  /** Total run width in feet. Default 4 ft. */
  widthFt?: number;
  /** Connects this storey to the storey above it; if `false`, just a
   *  placeholder space (toilet near staircase but no actual stair geometry). */
  hasGeometry?: boolean;
}

/** A single storey in the floor-plan brief. */
export interface FloorPlanFloor {
  /** Display name — "Ground Floor", "First Floor", "Roof". */
  name: string;
  /** Storey index, 0-based. Ground = 0. */
  index: number;
  /** Floor-to-floor height in feet. Default 10 ft. */
  storeyHeightFt?: number;
  /** Rooms on this storey. */
  rooms: FloorPlanRoom[];
  /** Optional staircase on this storey. */
  staircase?: FloorPlanStaircase;
  /** True for the topmost roof slab — emitted as a flat slab + parapet
   *  even when the brief doesn't enumerate rooms (the "stub roof" path). */
  isRoofStub?: boolean;
}

/** Building category — drives furniture + MEP preset selection.
 *  "residential" gets bedroom/living/kitchen/toilet furniture sets;
 *  "commercial" gets desks/conference tables/reception counters; etc. */
export type BuildingCategory =
  | "residential"
  | "commercial"
  | "industrial"
  | "institutional"
  | "hospitality";

/** The full floor-plan schema attached to ParsedBrief.floorPlan. */
export interface FloorPlanSchema {
  /** Plot width (East-West extent before orientation rotation), feet. */
  plotWidthFt: number;
  /** Plot depth (North-South extent before orientation rotation), feet. */
  plotDepthFt: number;
  /** Which world axis the brief calls "North". Default "Z+". */
  northAxis?: NorthAxis;
  /** Building category. Default "residential". Drives furniture +
   *  MEP preset selection in the converter. */
  buildingCategory?: BuildingCategory;
  /** Wall thickness for exterior walls, mm. Default 230 mm (≈ 9"). */
  exteriorWallThicknessMm?: number;
  /** Wall thickness for interior partitions, mm. Default 150 mm (≈ 6"). */
  interiorWallThicknessMm?: number;
  /** Slab thickness, mm. Default 150 mm. */
  slabThicknessMm?: number;
  /** Floors enumerated in the brief — at least one entry. */
  floors: FloorPlanFloor[];
  /** Free-text source of truth for the brief — useful for debugging and
   *  for downstream nodes that need the original prose. */
  rawText?: string;
}

/** Foot → metre conversion. Single source of truth for the converter. */
export const FT_TO_M = 0.3048;

/** Default values used when the brief omits a measurement. Centralised so
 *  unit tests can pin them and so the GPT prompt can echo the same numbers. */
export const FLOOR_PLAN_DEFAULTS = {
  exteriorWallThicknessMm: 230,
  interiorWallThicknessMm: 150,
  slabThicknessMm: 150,
  /** 12 ft (3.66 m) — IS-recommended max for residential. The earlier
   *  11-ft default still read as compressed on a 50×24 ft footprint
   *  combined with a single-storey layout. 12 ft + G+1 (replicated
   *  upper floor when brief implies stairs) gives a 28-ft-tall (8.5 m)
   *  building on the user's plot — proper "house" aspect ratio. */
  storeyHeightFt: 12,
  doorWidthFt: 3,
  doorHeightFt: 7,
  windowWidthFt: 4,
  windowHeightFt: 4,
  windowSillFt: 3,
  staircaseWidthFt: 4,
  /** Roof parapet height (m) — 1.5 m for residential safety + reads as
   *  a clear architectural roof feature on the rendered IFC. */
  parapetHeightM: 1.5,
  northAxis: "Z+" as NorthAxis,
} as const;
