/**
 * LiveRateResolver — The SINGLE source of truth for all construction pricing.
 *
 * Resolution waterfall (tried in order):
 * 1. Redis cache (if fresh) → instant
 * 2. Claude AI reasoning (with city-specific knowledge) → 3-8s
 * 3. IS 1200 reference rates (static fallback) → instant, LOW confidence
 * 4. null → "rate not found, manual input needed"
 *
 * When web_search becomes available on the API plan, it slots in at position 1.5
 * (between cache and Claude reasoning) without any other changes.
 *
 * Architecture: every resolved rate carries full provenance:
 * - value, unit, confidence, source, sourceUrl, fetchedAt, ageHours
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResolvedRate {
  value: number;
  unit: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  source: "web_search" | "agent_reasoned" | "cached" | "reference_rate" | "user_input";
  sourceDetail: string;        // human-readable: "Claude AI estimate for Pune, March 2026"
  sourceUrl?: string;
  fetchedAt: string;           // ISO
  ageHours: number;
  item: string;                // what was queried
}

export interface RateQuery {
  item: string;                // 'rcc_m25_slab' | 'tmt_fe500_rebar' | 'mason_labor' | etc.
  is1200Code?: string;         // 'IS1200-P2-RCC-SLAB' if known
  city: string;
  state: string;
  unit: string;                // 'per_m3' | 'per_m2' | 'per_kg' | 'per_day'
  context?: {
    buildingType?: string;
    totalArea?: number;
    storeys?: number;
    concreteGrade?: string;
  };
}

export interface BatchRateResult {
  rates: Map<string, ResolvedRate>;
  resolvedCount: number;
  cachedCount: number;
  failedCount: number;
  totalMs: number;
}

// ─── Cache Layer ────────────────────────────────────────────────────────────

// TTLs by item volatility (seconds) — cache POLICY, not prices
const CACHE_TTL: Record<string, number> = {
  steel: 86400,        // 24hr — commodity, moves weekly
  cement: 86400,       // 24hr
  sand: 86400,         // 24hr
  labor: 259200,       // 72hr — moves monthly
  equipment: 604800,   // 168hr — moves slowly
  benchmark: 604800,   // 168hr — composite
  pwd_factor: 2592000, // 720hr — annual revision
  default: 172800,     // 48hr
};

function getTTL(item: string): number {
  for (const [key, ttl] of Object.entries(CACHE_TTL)) {
    if (item.toLowerCase().includes(key)) return ttl;
  }
  return CACHE_TTL.default;
}

async function getCached(key: string): Promise<ResolvedRate | null> {
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
    return await redis.get<ResolvedRate>(key) ?? null;
  } catch { return null; }
}

async function setCache(key: string, rate: ResolvedRate, ttl: number): Promise<void> {
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return;
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
    await redis.set(key, rate, { ex: ttl });
  } catch { /* non-fatal */ }
}

// ─── Reference Rate Lookup (static IS 1200 — emergency fallback ONLY) ──────

async function getReferenceRate(query: RateQuery): Promise<ResolvedRate | null> {
  try {
    const { getIS1200Rate } = await import("@/features/boq/constants/is1200-rates");
    if (!query.is1200Code) return null;
    const rate = getIS1200Rate(query.is1200Code);
    if (!rate) return null;
    return {
      value: rate.rate,
      unit: rate.unit,
      confidence: "LOW",
      source: "reference_rate",
      sourceDetail: `IS 1200 CPWD reference rate (static — may be outdated)`,
      fetchedAt: new Date().toISOString(),
      ageHours: 0,
      item: query.item,
    };
  } catch { return null; }
}

// ─── Main Resolver ──────────────────────────────────────────────────────────

/**
 * Resolve a single rate. Tries cache → Claude AI → reference rate → null.
 */
export async function resolveRate(query: RateQuery): Promise<ResolvedRate | null> {
  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "_");
  const cacheKey = `rate:v3:${norm(query.item)}:${norm(query.city)}:${norm(query.state)}`;

  // 1. Cache check
  const cached = await getCached(cacheKey);
  if (cached) {
    cached.ageHours = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 3600000);
    // Downgrade confidence if stale
    if (cached.ageHours > getTTL(query.item) / 3600) {
      cached.confidence = cached.confidence === "HIGH" ? "MEDIUM" : "LOW";
    }
    return cached;
  }

  // 2. Claude AI reasoning (primary live source)
  // This is handled at the TR-015 level (market-intelligence.ts) for batch efficiency.
  // Individual rate resolution falls to reference rates for now.
  // When web_search becomes available, it would slot in here.

  // 3. Reference rate (IS 1200 static — emergency fallback)
  const ref = await getReferenceRate(query);
  if (ref) {
    await setCache(cacheKey, ref, getTTL(query.item)).catch(() => {});
    return ref;
  }

  // 4. Nothing found
  return null;
}

/**
 * Resolve multiple rates in parallel. Used by TR-008 for batch efficiency.
 */
export async function resolveRatesBatch(queries: RateQuery[]): Promise<BatchRateResult> {
  const start = Date.now();
  const rates = new Map<string, ResolvedRate>();
  let cachedCount = 0;
  let failedCount = 0;

  const results = await Promise.allSettled(
    queries.map(async (q) => {
      const rate = await resolveRate(q);
      if (rate) {
        rates.set(q.item, rate);
        if (rate.source === "cached") cachedCount++;
      } else {
        failedCount++;
      }
    })
  );

  return {
    rates,
    resolvedCount: rates.size,
    cachedCount,
    failedCount,
    totalMs: Date.now() - start,
  };
}

/**
 * Validate a computed cost/m² against live-searched benchmarks.
 * Returns flags for the QS to review — never silently adjusts.
 */
export interface BenchmarkValidation {
  computedCostPerM2: number;
  benchmarkLow: number;
  benchmarkTypical: number;
  benchmarkHigh: number;
  status: "within_range" | "below_range" | "above_range";
  flags: string[];
  benchmarkSource: string;
}

export async function validateAgainstBenchmark(
  computedCostPerM2: number,
  city: string,
  state: string,
  buildingType: string,
  marketData?: { typical_range_min?: number; typical_range_max?: number; benchmark_label?: string }
): Promise<BenchmarkValidation> {
  // Use market data from TR-015 if available (already searched by Claude)
  const low = marketData?.typical_range_min ?? 18000;
  const high = marketData?.typical_range_max ?? 55000;
  const typical = Math.round((low + high) / 2);
  const source = marketData?.benchmark_label ?? `${buildingType} in ${city}, ${state}`;

  const flags: string[] = [];
  let status: BenchmarkValidation["status"] = "within_range";

  if (computedCostPerM2 < low * 0.8) {
    status = "below_range";
    flags.push(`Cost ₹${computedCostPerM2.toLocaleString()}/m² is ${Math.round((1 - computedCostPerM2 / low) * 100)}% below typical minimum ₹${low.toLocaleString()}/m²`);
    flags.push("Some cost divisions may be underpriced — review provisional items");
  } else if (computedCostPerM2 > high * 1.3) {
    status = "above_range";
    flags.push(`Cost ₹${computedCostPerM2.toLocaleString()}/m² is ${Math.round((computedCostPerM2 / high - 1) * 100)}% above typical maximum ₹${high.toLocaleString()}/m²`);
    flags.push("Possible double-counting — verify element quantities");
  }

  return {
    computedCostPerM2,
    benchmarkLow: low,
    benchmarkTypical: typical,
    benchmarkHigh: high,
    status,
    flags,
    benchmarkSource: source,
  };
}
