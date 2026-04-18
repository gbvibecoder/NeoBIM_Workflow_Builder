/**
 * Step 2 — compute hallway spine geometry.
 *
 * The spine is the *first* element placed. Every other room is packed against
 * it (or against a room that touches it). This is what guarantees connectivity
 * by construction.
 *
 * Spine orientation:
 *   north / south facing → horizontal spine running E–W
 *   east  / west  facing → vertical   spine running N–S
 *
 * Spine position:
 *   The spine is placed so the FRONT strip (entrance side) is ~45% of the
 *   usable depth, BACK strip ~55%. Private rooms (back) are typically larger
 *   than public ones so the back strip gets the bigger share.
 *
 * Origin convention: SW corner = (0, 0); X grows east; Y grows north.
 */
import type { Facing, Rect, SpineLayout, StripPackRoom } from "./types";
import { findHallwayWidth } from "./room-classifier";

/**
 * Phase 3H: split fraction depends on spine orientation.
 * For horizontal spines (N/S-facing), the pack-depth is the plot depth which
 * is typically 35-50ft — plenty for 2-3 rows. 45/55 works well.
 * For vertical spines (E/W-facing), the pack-depth is the strip WIDTH which
 * is only 20-25ft. With 45%, only ~20ft is available — one row of 13ft rooms
 * leaves just 7ft, crushing second-row rooms. 50% gives ~23ft, enough for
 * 13ft + 10ft rows.
 */
const FRONT_FRACTION_HORIZONTAL = 0.45;
const FRONT_FRACTION_VERTICAL   = 0.50;
const DEFAULT_HALLWAY_WIDTH_FT = 4;
const MIN_HALLWAY_WIDTH_FT = 3;
const MAX_HALLWAY_WIDTH_FT = 6;

export interface PlotInput {
  width_ft: number;
  depth_ft: number;
  facing: Facing;
}

export function planSpine(plot: PlotInput, rooms: StripPackRoom[]): SpineLayout {
  // Pick hallway width: user-specified > default; clamped to a sane range.
  const fromRooms = findHallwayWidth(rooms);
  const hallwayWidthRaw = fromRooms ?? DEFAULT_HALLWAY_WIDTH_FT;
  const hallwayWidth = Math.max(
    MIN_HALLWAY_WIDTH_FT,
    Math.min(MAX_HALLWAY_WIDTH_FT, hallwayWidthRaw),
  );

  const isHorizontal = plot.facing === "north" || plot.facing === "south";
  const frontFraction = isHorizontal ? FRONT_FRACTION_HORIZONTAL : FRONT_FRACTION_VERTICAL;

  if (isHorizontal) {
    // Horizontal spine (runs E–W across the full plot width).
    const usable = plot.depth_ft - hallwayWidth;
    if (usable <= 0) throw new Error(`spine-placer: plot too shallow for hallway (depth=${plot.depth_ft}ft, hallway=${hallwayWidth}ft)`);

    let spineY: number;
    let frontY: number, frontDepth: number;
    let backY: number,  backDepth: number;

    if (plot.facing === "north") {
      // Entrance at y = plot.depth_ft (top). Front above spine, back below.
      backDepth  = usable * (1 - frontFraction);   // 55%
      frontDepth = usable * frontFraction;         // 45%
      spineY     = backDepth;                       // spine sits above the back strip
      backY      = 0;
      frontY     = spineY + hallwayWidth;
    } else {
      // facing === "south" → entrance at y = 0. Front below spine, back above.
      frontDepth = usable * frontFraction;
      backDepth  = usable * (1 - frontFraction);
      spineY     = frontDepth;
      frontY     = 0;
      backY      = spineY + hallwayWidth;
    }

    const spine: Rect = { x: 0, y: spineY, width: plot.width_ft, depth: hallwayWidth };
    const front: Rect = { x: 0, y: frontY, width: plot.width_ft, depth: frontDepth };
    const back:  Rect = { x: 0, y: backY,  width: plot.width_ft, depth: backDepth };

    return {
      spine,
      front_strip: front,
      back_strip: back,
      entrance_rooms: [],
      remaining_front: [front],
      orientation: "horizontal",
      entrance_side: plot.facing,
      hallway_width_ft: hallwayWidth,
    };
  }

  // Vertical spine (east / west facing).
  const usable = plot.width_ft - hallwayWidth;
  if (usable <= 0) throw new Error(`spine-placer: plot too narrow for hallway (width=${plot.width_ft}ft, hallway=${hallwayWidth}ft)`);

  let spineX: number;
  let frontX: number, frontWidth: number;
  let backX: number,  backWidth: number;

  if (plot.facing === "east") {
    // Entrance at x = plot.width_ft (right). Front to the east, back to the west.
    backWidth  = usable * (1 - frontFraction);
    frontWidth = usable * frontFraction;
    spineX     = backWidth;
    backX      = 0;
    frontX     = spineX + hallwayWidth;
  } else {
    // facing === "west" → entrance at x = 0. Front to the west, back to the east.
    frontWidth = usable * frontFraction;
    backWidth  = usable * (1 - frontFraction);
    spineX     = frontWidth;
    frontX     = 0;
    backX      = spineX + hallwayWidth;
  }

  const spine: Rect = { x: spineX, y: 0, width: hallwayWidth, depth: plot.depth_ft };
  const front: Rect = { x: frontX, y: 0, width: frontWidth, depth: plot.depth_ft };
  const back:  Rect = { x: backX,  y: 0, width: backWidth,  depth: plot.depth_ft };

  return {
    spine,
    front_strip: front,
    back_strip: back,
    entrance_rooms: [],
    remaining_front: [front],
    orientation: "vertical",
    entrance_side: plot.facing,
    hallway_width_ft: hallwayWidth,
  };
}

/** Convenience: which strip edge of a strip touches the hallway? */
export function hallwayEdgeOfFront(facing: Facing): Facing {
  // The hallway sits between front and back. The front strip's hallway edge is
  // the one CLOSEST to the spine — opposite of the entrance side.
  switch (facing) {
    case "north": return "south"; // front is north of spine; spine is on its south edge
    case "south": return "north";
    case "east":  return "west";
    case "west":  return "east";
  }
}

export function hallwayEdgeOfBack(facing: Facing): Facing {
  switch (facing) {
    case "north": return "north"; // back is south of spine; spine is on its north edge
    case "south": return "south";
    case "east":  return "east";
    case "west":  return "west";
  }
}
