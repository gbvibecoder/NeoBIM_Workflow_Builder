/**
 * Step 3 — place porch + foyer at the entrance wall and carve the resulting
 * column out of the front strip.
 *
 * The front strip becomes 1–3 sub-rectangles after the carve:
 *   LEFT  — strip area west of the cutout, full front-strip depth
 *   RIGHT — strip area east of the cutout, full front-strip depth
 *   INNER — strip area below the cutout (between the foyer's far edge and the
 *           hallway), spans the cutout's width
 *
 * For north-facing the cutout sits at the top (north) of the front strip; for
 * south-facing at the bottom; for east/west facing the cutout is on the
 * facing-side edge and we produce TOP/BOTTOM/INNER rectangles instead.
 */
import type { Facing, Rect, SpineLayout, StripPackRoom } from "./types";

export interface EntranceResult {
  porch?: StripPackRoom;
  foyer?: StripPackRoom;
  remainingFront: Rect[];
  entranceCutout?: Rect;
}

const MIN_USABLE_DIMENSION_FT = 5; // strips below this are dropped as scrap

function findRoom(rooms: StripPackRoom[], pred: (r: StripPackRoom) => boolean): StripPackRoom | undefined {
  return rooms.find(pred);
}

/** Subtract a centered cutout from a strip rectangle aligned on one edge. */
function carveStrip(strip: Rect, cutout: Rect, facing: Facing): Rect[] {
  const out: Rect[] = [];
  if (facing === "north" || facing === "south") {
    // cutout shares the entrance edge of the strip; carve LEFT, RIGHT, INNER
    const leftWidth = cutout.x - strip.x;
    if (leftWidth >= MIN_USABLE_DIMENSION_FT) {
      out.push({ x: strip.x, y: strip.y, width: leftWidth, depth: strip.depth });
    }
    const rightX = cutout.x + cutout.width;
    const rightWidth = strip.x + strip.width - rightX;
    if (rightWidth >= MIN_USABLE_DIMENSION_FT) {
      out.push({ x: rightX, y: strip.y, width: rightWidth, depth: strip.depth });
    }
    // INNER strip — below cutout (north-facing) or above cutout (south-facing)
    if (facing === "north") {
      const innerDepth = (strip.y + strip.depth) - cutout.y - cutout.depth;
      // wait: cutout sits at the top, so the area BELOW it within the strip:
      const innerTop = cutout.y; // bottom of cutout
      const innerHeight = innerTop - strip.y;
      if (innerHeight >= MIN_USABLE_DIMENSION_FT) {
        out.push({ x: cutout.x, y: strip.y, width: cutout.width, depth: innerHeight });
      }
      void innerDepth;
    } else {
      // south facing: cutout sits at the bottom (y = strip.y), INNER is above
      const innerY = cutout.y + cutout.depth;
      const innerHeight = strip.y + strip.depth - innerY;
      if (innerHeight >= MIN_USABLE_DIMENSION_FT) {
        out.push({ x: cutout.x, y: innerY, width: cutout.width, depth: innerHeight });
      }
    }
  } else {
    // east/west facing — cutout shares the entrance vertical edge
    const bottomDepth = cutout.y - strip.y;
    if (bottomDepth >= MIN_USABLE_DIMENSION_FT) {
      out.push({ x: strip.x, y: strip.y, width: strip.width, depth: bottomDepth });
    }
    const topY = cutout.y + cutout.depth;
    const topDepth = strip.y + strip.depth - topY;
    if (topDepth >= MIN_USABLE_DIMENSION_FT) {
      out.push({ x: strip.x, y: topY, width: strip.width, depth: topDepth });
    }
    if (facing === "east") {
      // cutout on the east edge → INNER on the west of the cutout
      const innerWidth = cutout.x - strip.x;
      if (innerWidth >= MIN_USABLE_DIMENSION_FT) {
        out.push({ x: strip.x, y: cutout.y, width: innerWidth, depth: cutout.depth });
      }
    } else {
      // west: cutout on the west edge → INNER on the east of the cutout
      const innerX = cutout.x + cutout.width;
      const innerWidth = strip.x + strip.width - innerX;
      if (innerWidth >= MIN_USABLE_DIMENSION_FT) {
        out.push({ x: innerX, y: cutout.y, width: innerWidth, depth: cutout.depth });
      }
    }
  }
  return out;
}

export function placeEntrance(
  spine: SpineLayout,
  classified: StripPackRoom[],
): EntranceResult {
  const facing = spine.entrance_side;
  const front = spine.front_strip;

  const porch = findRoom(classified, r => r.type === "porch" || r.type === "verandah");
  const foyer = findRoom(classified, r => r.type === "foyer");

  // No porch and no foyer → nothing to carve. Return the front strip whole.
  if (!porch && !foyer) {
    return { remainingFront: [front] };
  }

  // Decide cutout dimensions:
  //   width  = max of porch.width, foyer.width (centered)
  //   depth  = sum of porch.depth + foyer.depth (or whichever exists)
  // Clamp width to the front strip width.
  const pW = porch?.requested_width_ft ?? 0;
  const fW = foyer?.requested_width_ft ?? 0;
  const pD = porch?.requested_depth_ft ?? 0;
  const fD = foyer?.requested_depth_ft ?? 0;
  const cutoutWidth = Math.min(front.width, Math.max(pW, fW, MIN_USABLE_DIMENSION_FT));
  const cutoutDepth = Math.min(front.depth, pD + fD);

  if (cutoutDepth <= 0 || cutoutWidth <= 0) {
    return { remainingFront: [front] };
  }

  // Position cutout: centered by default, biased by porch position_preference.
  let cutoutX = front.x + (front.width - cutoutWidth) / 2;
  const pref = porch?.position_preference ?? foyer?.position_preference;
  if (pref === "NW" || pref === "W" || pref === "SW") {
    cutoutX = front.x;
  } else if (pref === "NE" || pref === "E" || pref === "SE") {
    cutoutX = front.x + front.width - cutoutWidth;
  } else if (pref === "N" || pref === "S" || pref === "CENTER" || !pref) {
    cutoutX = front.x + (front.width - cutoutWidth) / 2;
  }

  // Cutout Y depends on facing.
  let cutoutY: number;
  if (facing === "north") {
    cutoutY = front.y + front.depth - cutoutDepth;
  } else if (facing === "south") {
    cutoutY = front.y;
  } else if (facing === "east") {
    cutoutY = front.y + (front.depth - cutoutDepth) / 2;
    // also shift X to the entrance edge
    cutoutX = front.x + front.width - cutoutWidth;
  } else {
    // west
    cutoutY = front.y + (front.depth - cutoutDepth) / 2;
    cutoutX = front.x;
  }

  const cutout: Rect = { x: cutoutX, y: cutoutY, width: cutoutWidth, depth: cutoutDepth };

  // Place porch + foyer inside the cutout. Porch on the entrance side.
  let porchPlaced: StripPackRoom | undefined;
  let foyerPlaced: StripPackRoom | undefined;

  if (porch) {
    const w = Math.min(porch.requested_width_ft, cutoutWidth);
    const d = Math.min(porch.requested_depth_ft, cutoutDepth);
    let px = cutoutX + (cutoutWidth - w) / 2;
    let py: number;
    if (facing === "north")      py = cutoutY + cutoutDepth - d;
    else if (facing === "south") py = cutoutY;
    else if (facing === "east")  { px = cutoutX + cutoutWidth - w; py = cutoutY + (cutoutDepth - d) / 2; }
    else                          { px = cutoutX;                  py = cutoutY + (cutoutDepth - d) / 2; }
    porchPlaced = { ...porch, placed: { x: px, y: py, width: w, depth: d }, actual_area_sqft: w * d };
  }

  if (foyer) {
    const w = Math.min(foyer.requested_width_ft, cutoutWidth);
    const d = Math.min(foyer.requested_depth_ft, cutoutDepth - (porch?.requested_depth_ft ?? 0));
    const safeDepth = Math.max(MIN_USABLE_DIMENSION_FT, d);
    let fx = cutoutX + (cutoutWidth - w) / 2;
    let fy: number;
    if (facing === "north")      fy = cutoutY + cutoutDepth - (porch?.requested_depth_ft ?? 0) - safeDepth;
    else if (facing === "south") fy = cutoutY + (porch?.requested_depth_ft ?? 0);
    else if (facing === "east")  { fx = cutoutX + cutoutWidth - (porch?.requested_width_ft ?? 0) - w; fy = cutoutY + (cutoutDepth - safeDepth) / 2; }
    else                          { fx = cutoutX + (porch?.requested_width_ft ?? 0);                  fy = cutoutY + (cutoutDepth - safeDepth) / 2; }
    foyerPlaced = { ...foyer, placed: { x: fx, y: fy, width: w, depth: safeDepth }, actual_area_sqft: w * safeDepth };
  }

  const remaining = carveStrip(front, cutout, facing);

  return {
    porch: porchPlaced,
    foyer: foyerPlaced,
    remainingFront: remaining,
    entranceCutout: cutout,
  };
}
