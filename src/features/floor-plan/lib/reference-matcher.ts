/**
 * Reference + Adapt engine — MATCHER.
 *
 * Scores every reference plan against the user's parsed constraints.
 * Returns top N matches sorted by score (0-100).
 *
 * Scoring breakdown (100 points total):
 *   BHK match:       30 pts — exact = 30, ±1 = 15, ±2+ = 0
 *   Facing match:    15 pts — exact = 15, adjacent = 8, opposite = 0
 *   Area match:      20 pts — within ±10% = 20, ±20% = 15, ±30% = 10
 *   Plot ratio:      15 pts — similar aspect ratio = 15, close = 8
 *   Room overlap:    20 pts — proportion of requested rooms found
 *   Bonuses:         up to +10 for vastu/pooja/parking/utility matches
 */
import type { ParsedConstraints, ParsedRoom } from "./structured-parser";
import type { ReferenceFloorPlan, MatchScore, MatchBreakdown } from "./reference-types";

// ───────────────────────────────────────────────────────────────────────────
// BHK DETECTION
// ───────────────────────────────────────────────────────────────────────────

/** Infer BHK count from parsed rooms (count bedrooms). */
function inferBHK(rooms: ParsedRoom[]): number {
  return rooms.filter(r =>
    r.function === "master_bedroom" ||
    r.function === "bedroom" ||
    r.function === "guest_bedroom" ||
    r.function === "kids_bedroom"
  ).length;
}

// ───────────────────────────────────────────────────────────────────────────
// SCORING FUNCTIONS
// ───────────────────────────────────────────────────────────────────────────

function scoreBHK(userBHK: number, refBHK: number): number {
  const diff = Math.abs(userBHK - refBHK);
  if (diff === 0) return 30;
  if (diff === 1) return 15;
  return 0;
}

function scoreFacing(
  userFacing: string | null | undefined,
  refFacing: string,
): number {
  if (!userFacing) return 15; // no preference = any matches
  const u = userFacing.toUpperCase().charAt(0);
  const r = refFacing.toUpperCase().charAt(0);
  if (u === r) return 15;
  // Adjacent facings (N↔E, N↔W, S↔E, S↔W)
  const adj: Record<string, string[]> = {
    N: ["E", "W"], S: ["E", "W"], E: ["N", "S"], W: ["N", "S"],
  };
  if (adj[u]?.includes(r)) return 8;
  return 0; // Opposite
}

function scoreArea(
  userAreaSqft: number | null | undefined,
  refAreaSqft: number,
): number {
  if (!userAreaSqft) return 15; // no preference = partial match
  const pct = Math.abs(userAreaSqft - refAreaSqft) / userAreaSqft;
  if (pct <= 0.10) return 20;
  if (pct <= 0.20) return 15;
  if (pct <= 0.30) return 10;
  if (pct <= 0.50) return 5;
  return 0;
}

function scorePlotRatio(
  userW: number | null | undefined,
  userD: number | null | undefined,
  refW: number,
  refD: number,
): number {
  if (!userW || !userD) return 10; // no plot dims = partial match
  const userRatio = userW / userD;
  const refRatio = refW / refD;
  const diff = Math.abs(userRatio - refRatio);
  if (diff <= 0.15) return 15;
  if (diff <= 0.30) return 8;
  if (diff <= 0.50) return 4;
  return 0;
}

/** Map room function names to canonical groups for matching. */
function roomGroup(fn: string): string {
  if (fn.includes("bedroom") || fn === "master_bedroom" || fn === "guest_bedroom" || fn === "kids_bedroom") return "bedroom";
  if (fn === "living" || fn === "drawing_room") return "living";
  if (fn === "dining") return "dining";
  if (fn === "kitchen") return "kitchen";
  if (fn.includes("bathroom") || fn === "master_bathroom" || fn === "ensuite" || fn === "powder_room" || fn === "toilet") return "bathroom";
  if (fn === "pooja" || fn === "prayer" || fn === "mandir") return "pooja";
  if (fn === "utility" || fn === "laundry") return "utility";
  if (fn === "store" || fn === "pantry") return "store";
  if (fn === "study") return "study";
  if (fn === "servant_quarter") return "servant";
  if (fn === "balcony") return "balcony";
  if (fn === "verandah" || fn === "porch") return "verandah";
  if (fn === "foyer") return "foyer";
  if (fn === "corridor" || fn === "hallway" || fn === "passage") return "corridor";
  if (fn === "staircase") return "staircase";
  return fn;
}

function scoreRoomOverlap(
  userRooms: ParsedRoom[],
  ref: ReferenceFloorPlan,
): number {
  // Count distinct room groups the user wants
  const userGroups = new Map<string, number>();
  for (const r of userRooms) {
    const g = roomGroup(r.function);
    userGroups.set(g, (userGroups.get(g) ?? 0) + 1);
  }

  // Count what the reference has
  const refGroups = new Map<string, number>();
  for (const r of ref.rooms) {
    const g = roomGroup(r.type);
    refGroups.set(g, (refGroups.get(g) ?? 0) + 1);
  }

  // For each user group, score based on how many the ref has
  let matched = 0;
  let total = 0;
  for (const [group, count] of userGroups) {
    if (group === "corridor" || group === "foyer") continue; // skip circulation
    total += count;
    const refCount = refGroups.get(group) ?? 0;
    matched += Math.min(count, refCount);
  }

  if (total === 0) return 15;
  return Math.round((matched / total) * 20);
}

function scoreSpecialBonuses(
  parsed: ParsedConstraints,
  ref: ReferenceFloorPlan,
): { vastu: number; special: number } {
  let vastu = 0;
  let special = 0;

  // Vastu match
  if (parsed.vastu_required && ref.metadata.vastu_compliant) vastu = 5;
  if (!parsed.vastu_required && !ref.metadata.vastu_compliant) vastu = 2;

  // Special feature matches
  const wantsPooja = parsed.special_features.some(f => f.feature === "pooja") ||
    parsed.rooms.some(r => r.function === "pooja" || (r.function as string) === "prayer" || (r.function as string) === "mandir");
  const wantsBalcony = parsed.special_features.some(f => f.feature === "balcony") ||
    parsed.rooms.some(r => r.function === "balcony");
  const wantsParking = parsed.rooms.some(r => r.name.toLowerCase().includes("parking") || r.name.toLowerCase().includes("garage"));
  const wantsUtility = parsed.rooms.some(r => r.function === "utility" || (r.function as string) === "laundry");
  const wantsServant = parsed.rooms.some(r => r.function === "servant_quarter");

  if (wantsPooja && ref.metadata.has_pooja) special += 2;
  if (wantsBalcony && ref.metadata.has_balcony) special += 1;
  if (wantsParking && ref.metadata.has_parking) special += 2;
  if (wantsUtility && ref.metadata.has_utility) special += 1;
  if (wantsServant && ref.metadata.has_servant_quarter) special += 2;

  return { vastu, special };
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Score all reference plans against parsed constraints.
 * Returns top `topN` matches sorted by score descending.
 */
export function matchReferences(
  parsed: ParsedConstraints,
  library: ReferenceFloorPlan[],
  topN = 3,
): MatchScore[] {
  const userBHK = inferBHK(parsed.rooms);

  const scores: MatchScore[] = library.map(ref => {
    const bhk_match = scoreBHK(userBHK, ref.metadata.bhk);
    const facing_match = scoreFacing(parsed.plot.facing, ref.metadata.facing);
    const area_match = scoreArea(parsed.plot.total_built_up_sqft, ref.metadata.total_area_sqft);
    const plot_ratio_match = scorePlotRatio(
      parsed.plot.width_ft, parsed.plot.depth_ft,
      ref.metadata.plot_width_ft, ref.metadata.plot_depth_ft,
    );
    const room_overlap = scoreRoomOverlap(parsed.rooms, ref);
    const bonuses = scoreSpecialBonuses(parsed, ref);

    const score = bhk_match + facing_match + area_match + plot_ratio_match +
      room_overlap + bonuses.vastu + bonuses.special;

    return {
      ref,
      score: Math.min(100, score),
      breakdown: {
        bhk_match,
        facing_match,
        area_match,
        plot_ratio_match,
        room_overlap,
        vastu_bonus: bonuses.vastu,
        special_bonus: bonuses.special,
      },
    };
  });

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
