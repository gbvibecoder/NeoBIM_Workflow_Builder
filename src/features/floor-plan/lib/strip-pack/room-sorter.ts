/**
 * Step 5 — sort rooms within a strip for packing.
 *
 * Order (highest priority first):
 *   1. Rooms with an explicit position_preference matching a corner/edge of
 *      the strip → packed first so they land at the strip's anchor edge.
 *   2. Larger rooms before smaller — large rooms are harder to fit and need
 *      first crack at the available space.
 *   3. Zone affinity tiebreaker — keep SERVICE grouped together and PRIVATE
 *      grouped together so wet walls and bedroom clusters form naturally.
 *
 * The sort is STABLE so equal keys preserve parser order. Pure function.
 */
import type { StripPackRoom, StripAssignment, RoomZone } from "./types";

const ZONE_AFFINITY_RANK: Readonly<Record<RoomZone, number>> = {
  PUBLIC: 0,
  ENTRANCE: 1,
  WORSHIP: 2,
  PRIVATE: 3,
  WET: 4,
  SERVICE: 5,
  CIRCULATION: 6,
  OUTDOOR: 7,
};

/**
 * Returns true when this room's position_preference points to an anchor edge
 * of the strip — i.e. the user said "put it in this corner" and the strip
 * itself owns that corner.
 *
 * Each StripAssignment maps to a set of compass directions that lie inside it:
 *   FRONT = the entrance side; BACK = the far side. A position_preference of
 *   "SW" / "S" / "W" lies inside the BACK strip of a north-facing plot, etc.
 *
 * We don't need to know the facing here — the classifier already routed the
 * room to the correct strip. If the user gave a position at all, that is a
 * stronger placement signal than zone defaults.
 */
function hasAnchorPreference(room: StripPackRoom): boolean {
  return !!room.position_preference;
}

interface SortKey {
  hasPosition: 0 | 1;   // 0 wins (sorted first)
  groupKey: string;     // group root id, or singleton id (for stability)
  negArea: number;      // larger area → more negative → sorted earlier
  zoneRank: number;
  parserOrder: number;  // tiebreaker for stability across runtimes
}

function keyFor(room: StripPackRoom, idx: number): SortKey {
  return {
    hasPosition: hasAnchorPreference(room) ? 0 : 1,
    groupKey: room.group_id ?? `__solo_${room.id}`,
    negArea: -room.requested_area_sqft,
    zoneRank: ZONE_AFFINITY_RANK[room.zone] ?? 99,
    parserOrder: idx,
  };
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (a.hasPosition !== b.hasPosition) return a.hasPosition - b.hasPosition;
  if (a.groupKey    !== b.groupKey)    return a.groupKey < b.groupKey ? -1 : 1;
  if (a.negArea     !== b.negArea)     return a.negArea - b.negArea;
  if (a.zoneRank    !== b.zoneRank)    return a.zoneRank - b.zoneRank;
  return a.parserOrder - b.parserOrder;
}

export function sortForPacking(rooms: StripPackRoom[]): StripPackRoom[] {
  const indexed = rooms.map((r, i) => ({ r, k: keyFor(r, i) }));
  indexed.sort((a, b) => compareKeys(a.k, b.k));
  return indexed.map(x => x.r);
}

/** Filter helper for the orchestrator. */
export function roomsForStrip(rooms: StripPackRoom[], strip: StripAssignment): StripPackRoom[] {
  return rooms.filter(r => r.strip === strip);
}
