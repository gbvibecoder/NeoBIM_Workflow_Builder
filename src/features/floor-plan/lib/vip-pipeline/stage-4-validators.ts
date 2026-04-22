/**
 * Phase 2.8 — post-extraction validators for Stage 4 output.
 *
 * These run AFTER validateAndClamp produces the `ExtractedRooms`
 * struct. They don't modify geometry — they drop obvious phantoms
 * (B2) and annotate suspicious extractions (B3) so Stage 6's
 * dimensionPlausibility scoring has signal to work with.
 *
 * Philosophy: preserve what the model returned whenever possible.
 * Phantoms (wall gaps, dimension callouts) are dropped because they
 * confuse downstream layout. Plausibility mismatches are FLAGGED,
 * never corrected — the fidelity-mode spirit of Phase 2.7C says the
 * image is the source of truth and violations surface as issues.
 */

import type {
  ExtractedRoom,
  ExtractedRooms,
  RectPx,
  Stage4Input,
} from "./types";

// ─── B2 — phantom filter ────────────────────────────────────────

/** Default minimum room area in sqft. Rooms below this are likely wall gaps. */
const PHANTOM_MIN_SQFT = 12;
/** Exempted minimum for intentionally small rooms (pooja, store, etc.). */
const SMALL_ROOM_EXEMPT_MIN_SQFT = 8;
/** Room TYPES for which we apply the exempt minimum instead of the default. */
const SMALL_ROOM_TYPES = new Set<string>([
  "pooja", "prayer", "mandir",
  "store", "storage", "pantry",
  "closet", "wardrobe", "walk_in_closet",
  "powder_room", "powder",
]);

export interface PhantomFilterResult {
  kept: ExtractedRoom[];
  droppedNames: string[];
}

/**
 * Drop rooms whose feet-area is below the phantom threshold. The
 * caller should then recompute `expectedRoomsMissing` against the
 * KEPT list, because dropping a "Hallway" that the LLM invented
 * means we shouldn't report the LLM's ghost as a real extraction.
 *
 * Returns the brief's per-name dropped list too so the caller can
 * log each one with the reason string.
 *
 * No-op (returns rooms unchanged) when plotBoundsPx is null — we
 * can't compute feet area without a reference.
 */
export function dropPhantomRooms(
  rooms: ExtractedRoom[],
  plotBoundsPx: RectPx | null,
  plotWidthFt: number,
  plotDepthFt: number,
  brief: Stage4Input["brief"],
  issues: string[],
): PhantomFilterResult {
  if (!plotBoundsPx || plotBoundsPx.w <= 0 || plotBoundsPx.h <= 0) {
    return { kept: rooms, droppedNames: [] };
  }
  const scaleX = plotWidthFt / plotBoundsPx.w;
  const scaleY = plotDepthFt / plotBoundsPx.h;
  const briefByName = new Map(
    brief.roomList.map((r) => [r.name.toLowerCase(), r]),
  );

  const kept: ExtractedRoom[] = [];
  const droppedNames: string[] = [];
  for (const room of rooms) {
    const widthFt = room.rectPx.w * scaleX;
    const heightFt = room.rectPx.h * scaleY;
    const areaFt = Math.max(0, widthFt) * Math.max(0, heightFt);

    const briefEntry = briefByName.get(room.name.toLowerCase());
    const isSmallRoomType = briefEntry && SMALL_ROOM_TYPES.has(briefEntry.type);
    const threshold = isSmallRoomType ? SMALL_ROOM_EXEMPT_MIN_SQFT : PHANTOM_MIN_SQFT;

    if (areaFt < threshold) {
      issues.push(
        `phantom: dropped "${room.name}" (${areaFt.toFixed(1)} sqft < ${threshold} sqft threshold)`,
      );
      droppedNames.push(room.name);
      continue;
    }
    kept.push(room);
  }
  return { kept, droppedNames };
}

// ─── B3 — plausibility flag ─────────────────────────────────────

/** Ratio band for "extracted area consistent with brief expectation". */
const PLAUSIBILITY_RATIO_MIN = 0.4;
const PLAUSIBILITY_RATIO_MAX = 2.5;

/**
 * Flag rooms whose extracted area doesn't match the brief's
 * approxAreaSqft within the plausibility band [0.4×, 2.5×]. Appends
 * a `plausibility: …` entry per mismatch to `issues`. DOES NOT touch
 * room coordinates — this is strictly a signal for Stage 6.
 *
 * Rooms without a matching brief entry, or without an approxAreaSqft
 * on the brief entry, are skipped (nothing to compare against).
 */
export function flagPlausibility(
  rooms: ExtractedRoom[],
  plotBoundsPx: RectPx | null,
  plotWidthFt: number,
  plotDepthFt: number,
  brief: Stage4Input["brief"],
  issues: string[],
): void {
  if (!plotBoundsPx || plotBoundsPx.w <= 0 || plotBoundsPx.h <= 0) return;
  const scaleX = plotWidthFt / plotBoundsPx.w;
  const scaleY = plotDepthFt / plotBoundsPx.h;
  const briefByName = new Map(
    brief.roomList.map((r) => [r.name.toLowerCase(), r]),
  );

  for (const room of rooms) {
    const briefEntry = briefByName.get(room.name.toLowerCase());
    if (!briefEntry || typeof briefEntry.approxAreaSqft !== "number") continue;
    const expected = briefEntry.approxAreaSqft;
    if (expected <= 0) continue;

    const extractedArea =
      Math.max(0, room.rectPx.w * scaleX) * Math.max(0, room.rectPx.h * scaleY);
    if (extractedArea <= 0) continue;

    const ratio = extractedArea / expected;
    if (ratio < PLAUSIBILITY_RATIO_MIN || ratio > PLAUSIBILITY_RATIO_MAX) {
      issues.push(
        `plausibility: "${room.name}" extracted ${extractedArea.toFixed(1)} sqft, expected ~${Math.round(expected)} sqft (ratio ${ratio.toFixed(2)})`,
      );
    }
  }
}

// ─── Missing-rooms recompute after phantom drop ─────────────────

/**
 * After dropping phantom rooms, some previously-matched expected
 * names may no longer appear in the kept list — re-check and
 * rebuild `expectedRoomsMissing`. Returns a fresh list; caller
 * replaces extraction.expectedRoomsMissing.
 */
export function recomputeMissing(
  kept: ExtractedRoom[],
  expectedNames: string[],
): string[] {
  const keptNames = new Set(kept.map((r) => r.name.toLowerCase()));
  const missing: string[] = [];
  for (const expected of expectedNames) {
    if (!keptNames.has(expected.toLowerCase())) missing.push(expected);
  }
  return missing;
}

// ─── Public wrapper — run B2 + B3 + missing recompute in order ──

export function applyStage4PostValidation(
  extraction: ExtractedRooms,
  brief: Stage4Input["brief"],
): ExtractedRooms {
  // B2: phantom drop.
  const { kept } = dropPhantomRooms(
    extraction.rooms,
    extraction.plotBoundsPx,
    brief.plotWidthFt,
    brief.plotDepthFt,
    brief,
    extraction.issues,
  );
  extraction.rooms = kept;

  // B3: plausibility flag (AFTER phantom drop — don't waste cycles
  // flagging rooms we're about to discard).
  flagPlausibility(
    extraction.rooms,
    extraction.plotBoundsPx,
    brief.plotWidthFt,
    brief.plotDepthFt,
    brief,
    extraction.issues,
  );

  // Recompute missing list (some expected rooms might have been the
  // phantoms we just dropped — surface them as missing).
  extraction.expectedRoomsMissing = recomputeMissing(
    extraction.rooms,
    brief.roomList.map((r) => r.name),
  );

  return extraction;
}
