/**
 * Price Fallback Chain — 6-priority material price lookup
 *
 * Priority 1: Live TR-015 market intelligence (real-time)         — handled by caller
 * Priority 2: Redis cache (24hr TTL, current behavior)            — handled by caller
 * Priority 3: MaterialPriceCache — same CITY, within 90 days      — this service
 * Priority 4: MaterialPriceCache — same STATE, within 90 days     — this service
 * Priority 5: MaterialPriceCache — national average, within 180d  — this service
 * Priority 6: Static CPWD rates × auto-escalation (8%/yr)         — this service
 *
 * Every returned price includes the priority level it came from,
 * so downstream consumers never serve a rate without knowing its provenance.
 */

export interface FallbackPriceResult {
  price: number;
  unit: string;
  priorityLevel: 3 | 4 | 5 | 6;
  sourceDescription: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  fetchedAt: string; // ISO date of the price data
}

// Static CPWD DSR 2025-26 base rates — seed data, used as Priority 6
const STATIC_CPWD: Record<string, { price: number; unit: string; date: string }> = {
  steel_per_tonne:   { price: 75000, unit: "₹/tonne", date: "2026-04-01" },
  cement_per_bag:    { price: 420,   unit: "₹/bag",   date: "2026-04-01" },
  sand_per_cft:      { price: 70,    unit: "₹/cft",   date: "2026-04-01" },
  labor_mason:       { price: 950,   unit: "₹/day",   date: "2026-04-01" },
  labor_helper:      { price: 580,   unit: "₹/day",   date: "2026-04-01" },
  labor_carpenter:   { price: 1050,  unit: "₹/day",   date: "2026-04-01" },
  labor_steel_fixer: { price: 900,   unit: "₹/day",   date: "2026-04-01" },
  labor_electrician: { price: 1150,  unit: "₹/day",   date: "2026-04-01" },
  labor_plumber:     { price: 1000,  unit: "₹/day",   date: "2026-04-01" },
};

// City-tier adjustments for state-level fallback (Priority 4)
const CITY_TIER_ADJUSTMENT: Record<string, number> = {
  metro: 1.10,     // Mumbai, Delhi, Bangalore, etc.
  "tier-1": 1.02,  // Pune, Hyderabad, Chennai, etc.
  "tier-2": 0.95,
  "tier-3": 0.88,
  town: 0.82,
};

/**
 * Look up a material price using the 6-priority fallback chain.
 * Priorities 1-2 (live TR-015 + Redis) are handled by the caller.
 * This function handles priorities 3-6.
 *
 * @param materialCode - e.g. "steel_per_tonne", "labor_mason"
 * @param city - e.g. "Pune"
 * @param state - e.g. "Maharashtra"
 * @param cityTier - optional, for state→city adjustment in Priority 4
 */
export async function resolvePriceFallback(
  materialCode: string,
  city: string,
  state: string,
  cityTier?: string,
): Promise<FallbackPriceResult> {
  const now = new Date();

  // ── Priority 3: Same city, within 90 days ──
  try {
    const { prisma } = await import("@/lib/db");
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const cityMatch = await prisma.materialPriceCache.findFirst({
      where: {
        city: { equals: city, mode: "insensitive" },
        materialCode,
        fetchedAt: { gte: ninetyDaysAgo },
      },
      orderBy: { fetchedAt: "desc" },
    });

    if (cityMatch) {
      return {
        price: cityMatch.price,
        unit: cityMatch.unit,
        priorityLevel: 3,
        sourceDescription: `MaterialPriceCache: ${city} (${daysSince(cityMatch.fetchedAt, now)}d ago)`,
        confidence: cityMatch.confidence === "HIGH" ? "HIGH" : "MEDIUM",
        fetchedAt: cityMatch.fetchedAt.toISOString(),
      };
    }

    // ── Priority 4: Same state, within 90 days (apply city-tier adjustment) ──
    const stateMatch = await prisma.materialPriceCache.findFirst({
      where: {
        state: { equals: state, mode: "insensitive" },
        materialCode,
        fetchedAt: { gte: ninetyDaysAgo },
      },
      orderBy: { fetchedAt: "desc" },
    });

    if (stateMatch) {
      // Adjust from the source city's tier to our target city's tier
      const tierFactor = CITY_TIER_ADJUSTMENT[cityTier ?? "tier-2"] ?? 1.0;
      // Assume the cached price was for a generic city — apply our tier
      const adjustedPrice = Math.round(stateMatch.price * tierFactor);

      return {
        price: adjustedPrice,
        unit: stateMatch.unit,
        priorityLevel: 4,
        sourceDescription: `MaterialPriceCache: ${stateMatch.city}, ${state} → adjusted for ${city} (${cityTier ?? "tier-2"} tier, ${daysSince(stateMatch.fetchedAt, now)}d ago)`,
        confidence: "MEDIUM",
        fetchedAt: stateMatch.fetchedAt.toISOString(),
      };
    }

    // ── Priority 5: National average, within 180 days ──
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    const nationalMatches = await prisma.materialPriceCache.findMany({
      where: {
        materialCode,
        fetchedAt: { gte: sixMonthsAgo },
        confidence: { not: "LOW" }, // Only use HIGH/MEDIUM confidence entries
      },
      orderBy: { fetchedAt: "desc" },
      take: 20,
    });

    if (nationalMatches.length >= 3) {
      // Trimmed mean: drop min and max, average the rest
      const prices = nationalMatches.map(m => m.price).sort((a, b) => a - b);
      const trimmed = prices.slice(1, -1);
      const avgPrice = Math.round(trimmed.reduce((s, p) => s + p, 0) / trimmed.length);
      const cities = [...new Set(nationalMatches.map(m => m.city))].slice(0, 3);

      return {
        price: avgPrice,
        unit: nationalMatches[0].unit,
        priorityLevel: 5,
        sourceDescription: `National average from ${nationalMatches.length} samples (${cities.join(", ")}${cities.length < nationalMatches.length ? ", ..." : ""})`,
        confidence: "LOW",
        fetchedAt: nationalMatches[0].fetchedAt.toISOString(),
      };
    }
  } catch {
    // Prisma/DB unavailable — fall through to static
  }

  // ── Priority 6: Static CPWD rates × auto-escalation (8%/yr) ──
  const staticRate = STATIC_CPWD[materialCode];
  if (!staticRate) {
    // Unknown material code — return a safe default
    return {
      price: 0,
      unit: "₹",
      priorityLevel: 6,
      sourceDescription: `Unknown material code: ${materialCode}`,
      confidence: "LOW",
      fetchedAt: now.toISOString(),
    };
  }

  // Auto-escalation: 8% annual from the static rate date
  const staticDate = new Date(staticRate.date);
  const yearsStale = (now.getTime() - staticDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const escalationFactor = Math.pow(1.08, Math.max(0, yearsStale));
  const escalatedPrice = Math.round(staticRate.price * escalationFactor);

  return {
    price: escalatedPrice,
    unit: staticRate.unit,
    priorityLevel: 6,
    sourceDescription: yearsStale > 0.1
      ? `CPWD DSR 2025-26 + ${(yearsStale).toFixed(1)}yr auto-escalation (8%/yr)`
      : "CPWD DSR 2025-26 (current)",
    confidence: "LOW",
    fetchedAt: staticRate.date,
  };
}

/**
 * Resolve multiple material prices at once (batched DB queries).
 */
export async function resolveMultiplePrices(
  materialCodes: string[],
  city: string,
  state: string,
  cityTier?: string,
): Promise<Map<string, FallbackPriceResult>> {
  const results = new Map<string, FallbackPriceResult>();
  // Individual lookups — Prisma handles connection pooling
  for (const code of materialCodes) {
    results.set(code, await resolvePriceFallback(code, city, state, cityTier));
  }
  return results;
}

function daysSince(date: Date, now: Date): number {
  return Math.round((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}
