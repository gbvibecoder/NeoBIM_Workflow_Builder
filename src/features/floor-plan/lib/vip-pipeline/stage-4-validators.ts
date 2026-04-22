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
 *
 * Phase 2.10.2 — adds an image-drift gate on top of the Phase 2.8
 * validators. Compares the Stage 2 image's visible-content bounding
 * box to the Stage 4 rooms-union bounding box; flags mismatches so
 * Stage 6 can penalise the quality score. Computation is pure CV —
 * sharp raw-pixel scan + rectangle math — and returns a Zod-validated
 * `ExtractedRoomsDriftMetrics` object.
 */

import sharp from "sharp";
import { z } from "zod";
import type {
  DedupRename,
  DriftSeverity,
  ExtractedRoom,
  ExtractedRooms,
  ExtractedRoomsDriftMetrics,
  RectPx,
  Stage4Input,
} from "./types";

// ─── B2 — phantom filter ────────────────────────────────────────

/**
 * Default minimum room area in sqft. Rooms below this are likely wall
 * gaps, door-frame outlines, or dimension-tick artefacts rather than
 * real rooms.
 *
 * Phase 2.10.4: raised 12 → 16 sqft. 16 sqft = the minimum habitable
 * closet size (4'×4'). 12 sqft was letting thin door-frame outlines
 * and dimension-annotation rectangles through as "rooms" in some
 * Phase 2.9 extractions, which Stage 5 then dutifully synthesised
 * into tiny spurious boxes. 16 sqft aligns with the
 * `DO NOT EXTRACT < 4×4 ft` clause in the Phase 2.10.1 prompt.
 */
const PHANTOM_MIN_SQFT = 16;
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

// ─── Phase 2.10.2 — image-drift gate ────────────────────────────

/**
 * Any non-white pixel counts as "content". 240 (out of 255) gives a
 * small tolerance for antialiased off-white while still rejecting
 * pure white paper backgrounds.
 */
const DRIFT_CONTENT_THRESHOLD = 240;

/**
 * XOR-area / image-bbox-area thresholds. Match the scope-doc:
 * - ratio ≤ 0.20 → "none" (pass)
 * - 0.20 <  ratio ≤ 0.35 → "moderate" (flag)
 * - ratio > 0.35 → "severe" (recommend retry)
 */
const DRIFT_FLAG_THRESHOLD = 0.2;
const DRIFT_SEVERE_THRESHOLD = 0.35;

// ─── Zod schema (internal guard; external callers see the TS type) ──

const RectPxSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
});

const DriftMetricsSchema = z.object({
  imageBboxPx: RectPxSchema,
  roomsUnionBboxPx: RectPxSchema.nullable(),
  driftRatio: z.number().finite().min(0),
  driftFlagged: z.boolean(),
  severity: z.enum(["none", "moderate", "severe"]),
});

// ─── Image-content bbox ─────────────────────────────────────────

/**
 * Scan a rasterised image buffer for its non-white bounding box.
 * Returns `null` when the image is entirely white (or entirely above
 * the threshold). The scan is O(W·H); on a 1024×1024 image V8 runs it
 * in ~15–25 ms, inside the 50 ms per-image budget.
 */
export async function computeImageContentBbox(
  imageBuffer: Buffer,
  threshold: number = DRIFT_CONTENT_THRESHOLD,
): Promise<RectPx | null> {
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  if (W === 0 || H === 0) return null;

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    for (let x = 0; x < W; x++) {
      if (data[rowBase + x] < threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

// ─── Rooms-union bbox ───────────────────────────────────────────

/**
 * Axis-aligned union bbox of the supplied rooms' rectPx. Returns
 * `null` when the list is empty or all rects are degenerate.
 */
export function computeRoomsUnionBbox(rooms: ExtractedRoom[]): RectPx | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const r of rooms) {
    if (r.rectPx.w <= 0 || r.rectPx.h <= 0) continue;
    any = true;
    if (r.rectPx.x < minX) minX = r.rectPx.x;
    if (r.rectPx.y < minY) minY = r.rectPx.y;
    if (r.rectPx.x + r.rectPx.w > maxX) maxX = r.rectPx.x + r.rectPx.w;
    if (r.rectPx.y + r.rectPx.h > maxY) maxY = r.rectPx.y + r.rectPx.h;
  }
  if (!any) return null;
  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  };
}

// ─── Drift ratio ────────────────────────────────────────────────

function rectArea(r: RectPx): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

function rectIntersectionArea(a: RectPx, b: RectPx): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

/**
 * Drift = symmetric-difference area / image-content-bbox area.
 *
 *   XOR_area  = imageArea + roomsArea − 2·intersectionArea
 *   drift     = XOR_area / imageArea
 *
 * When `roomsUnionBbox` is null (extraction returned nothing), drift
 * is 1.0 — a full mismatch. When `imageBbox` has zero area, drift is
 * 1.0 (degenerate; should never happen in practice).
 */
export function computeDriftRatio(
  imageBbox: RectPx,
  roomsUnionBbox: RectPx | null,
): number {
  const imgArea = rectArea(imageBbox);
  if (imgArea <= 0) return 1;
  if (!roomsUnionBbox) return 1;
  const roomsArea = rectArea(roomsUnionBbox);
  const inter = rectIntersectionArea(imageBbox, roomsUnionBbox);
  const xor = imgArea + roomsArea - 2 * inter;
  return xor / imgArea;
}

function severityFor(ratio: number): DriftSeverity {
  if (ratio > DRIFT_SEVERE_THRESHOLD) return "severe";
  if (ratio > DRIFT_FLAG_THRESHOLD) return "moderate";
  return "none";
}

// ─── Public entry ──────────────────────────────────────────────

/**
 * Compute + validate drift metrics for a Stage 4 extraction.
 *
 * Returns `null` when the image is blank / unreadable (no content
 * bbox), which is treated as "can't compute drift" rather than
 * "drift is zero" — the caller should decide how to flag that.
 */
export async function computeImageDriftMetrics(
  imageBuffer: Buffer,
  rooms: ExtractedRoom[],
): Promise<ExtractedRoomsDriftMetrics | null> {
  const imageBboxPx = await computeImageContentBbox(imageBuffer);
  if (!imageBboxPx) return null;
  const roomsUnionBboxPx = computeRoomsUnionBbox(rooms);
  const driftRatio = computeDriftRatio(imageBboxPx, roomsUnionBboxPx);
  const severity = severityFor(driftRatio);
  const driftFlagged = severity !== "none";
  const metrics: ExtractedRoomsDriftMetrics = {
    imageBboxPx,
    roomsUnionBboxPx,
    driftRatio,
    driftFlagged,
    severity,
  };
  // Zod-validate the computed object (defense-in-depth — catches
  // NaN / negative-ratio bugs before they reach downstream consumers).
  return DriftMetricsSchema.parse(metrics);
}

/**
 * Mutating variant — attaches drift metrics + an issue line onto the
 * extraction so Stage 6's dimensionPlausibility scorer and the
 * Pipeline Logs Panel can surface the flag.
 */
export async function applyImageDriftGate(
  extraction: ExtractedRooms,
  imageBuffer: Buffer,
): Promise<ExtractedRooms> {
  const metrics = await computeImageDriftMetrics(imageBuffer, extraction.rooms);
  if (!metrics) {
    extraction.issues.push(
      "drift: image content bbox empty (all-white or unreadable input); gate skipped",
    );
    return extraction;
  }
  extraction.driftMetrics = metrics;
  if (metrics.driftFlagged) {
    extraction.issues.push(
      `drift: ${metrics.severity} (ratio ${metrics.driftRatio.toFixed(3)} > ${DRIFT_FLAG_THRESHOLD} threshold)`,
    );
  }
  return extraction;
}

// ─── Phase 2.10.3 — duplicate-name dedup ────────────────────────
//
// GPT-Image-1.5 occasionally renders the same label twice ("BEDROOM 2"
// drawn in two rooms). GPT-4o Vision dutifully reports both with
// separate bounding boxes, and Phase 2.8 B1's matcher was extended to
// keep both with reduced confidence. That was the right conservative
// call at the time — but it leaves the downstream pipeline with two
// rooms sharing a name, which confuses Stage 5's name→brief lookup
// and Stage 6's noDuplicateNames scoring.
//
// Dedup policy:
//   1. Scan extraction.rooms for duplicate names (case-insensitive).
//   2. For the FIRST occurrence of each name, do nothing.
//   3. For each subsequent occurrence, pick a brief room NOT yet in
//      the extraction and rename to it.
//   4. If no brief room remains, rename to "Room N" where N is the
//      smallest integer that keeps the resulting name unique.
//
// All renames are recorded:
//   - Structured: extraction.dedupRenames[]
//   - Human-readable: extraction.issues[] entry prefixed "dedup:"
//
// The pass runs AFTER phantom filter (so we don't rename a room we're
// about to drop) and BEFORE plausibility (so plausibility checks the
// renamed room's expected area, not the duplicate-name placeholder).

const DEDUP_FALLBACK_PREFIX = "Room";

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

function buildBriefNameSet(brief: Stage4Input["brief"]): string[] {
  return brief.roomList.map((r) => r.name).filter((n) => n && n.trim().length > 0);
}

function firstAvailableBriefName(
  briefNames: string[],
  usedNormalised: Set<string>,
): string | null {
  for (const name of briefNames) {
    if (!usedNormalised.has(normaliseName(name))) return name;
  }
  return null;
}

function firstAvailableFallback(usedNormalised: Set<string>): string {
  for (let n = 1; n < 1000; n++) {
    const candidate = `${DEDUP_FALLBACK_PREFIX} ${n}`;
    if (!usedNormalised.has(normaliseName(candidate))) return candidate;
  }
  // pathological — but let the caller see a suffix rather than loop forever
  return `${DEDUP_FALLBACK_PREFIX} ${Date.now()}`;
}

export function dedupRoomNames(
  rooms: ExtractedRoom[],
  brief: Stage4Input["brief"],
  issues: string[],
): { rooms: ExtractedRoom[]; renames: DedupRename[] } {
  const used = new Set<string>();
  const renames: DedupRename[] = [];
  const briefNames = buildBriefNameSet(brief);
  const out: ExtractedRoom[] = [];
  for (const r of rooms) {
    const key = normaliseName(r.name);
    if (!used.has(key)) {
      used.add(key);
      out.push(r);
      continue;
    }
    // Duplicate — try brief-name pool first, fall back to "Room N"
    const picked = firstAvailableBriefName(briefNames, used);
    const reason = picked
      ? "duplicate of existing extraction"
      : "duplicate of existing extraction; no brief name available — fallback";
    const newName = picked ?? firstAvailableFallback(used);
    used.add(normaliseName(newName));
    renames.push({ from: r.name, to: newName, reason });
    issues.push(`dedup: renamed "${r.name}" → "${newName}" (${reason})`);
    out.push({ ...r, name: newName });
  }
  return { rooms: out, renames };
}

// ─── Public wrapper — run B2 + dedup + B3 + missing recompute in order ──

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

  // Phase 2.10.3 dedup — AFTER phantom drop (don't spend rename slots on
  // rooms we're about to discard) and BEFORE plausibility (so flagging
  // runs on the final name).
  const { rooms: deduped, renames } = dedupRoomNames(
    extraction.rooms,
    brief,
    extraction.issues,
  );
  extraction.rooms = deduped;
  if (renames.length > 0) extraction.dedupRenames = renames;

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
