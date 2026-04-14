/**
 * Market Intelligence Agent — The Single Source of Truth for ALL Pricing
 *
 * Architecture: Agent fetches EVERYTHING needed for a BOQ at runtime.
 * Hardcoded tables are emergency fallbacks only — never the primary source.
 *
 * Works for any city, any year, forever — no code changes needed.
 *
 * Search strategy: city → state → region → national (cascading fallback)
 *
 * Covers:
 * - Material prices (steel, cement, sand, aggregate)
 * - Labor rates (mason, helper, carpenter, electrician, plumber)
 * - MEP benchmarks (electrical, HVAC, plumbing per m²)
 * - Construction cost index
 * - Benchmark cost per m² by building type
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  addLog,
  type PipelineDiagnostics,
} from "@/features/boq/services/pipeline-diagnostics";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MarketPrice {
  value: number;
  unit: string;
  source: string;
  sourceUrl?: string;
  date: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  fallbackLevel?: "city" | "state" | "national" | "static";
}

export interface LaborRates {
  mason: MarketPrice;
  helper: MarketPrice;
  carpenter: MarketPrice;
  steelFixer: MarketPrice;
  electrician: MarketPrice;
  plumber: MarketPrice;
}

export interface MarketIntelligenceResult {
  // Material prices
  steel_per_tonne: MarketPrice;
  cement_per_bag: MarketPrice & { brand?: string };
  sand_per_cft: MarketPrice & { type?: string };

  // Labor rates (daily wages in INR)
  labor: LaborRates;

  // Benchmarks
  benchmark_per_sqft: {
    value: number;
    range_low: number;
    range_high: number;
    source: string;
    building_type: string;
  };
  cpwd_index: {
    factor: number;
    source: string;
    year: number;
  };

  // Dynamic benchmarks (from Claude AI — city + building type specific)
  minimum_cost_per_m2: number;      // Floor: cannot build for less in this city
  typical_range_min: number;        // Low end of typical cost range
  typical_range_max: number;        // High end of typical cost range
  building_type_factor: number;     // Multiplier vs generic commercial (wellness=1.35, etc.)
  mep_percentage: number;           // MEP as % of hard cost (wellness=35%, office=25%)
  benchmark_label: string;          // Human-readable: "wellness in Tier-2 Durg, March 2026"

  // Smart MEP breakdown with reasoning
  mep_breakdown?: {
    plumbing_pct: number; electrical_pct: number; hvac_pct: number;
    fire_pct: number; lifts_pct: number; reasoning: string;
  };

  // Dynamic state factor (replaces hardcoded STATE_PWD_FACTORS table)
  state_pwd_factor: number;           // 0.80-1.40, relative to CPWD national average
  absolute_minimum_cost: number;      // Absolute minimum ₹/m² to build anything in this state

  // Metadata
  sources_summary: string[];
  fetched_at: string;
  city: string;
  state: string;
  agent_status: "success" | "partial" | "fallback";
  agent_notes: string[];
  search_count: number;
  duration_ms: number;
  fallbacks_used: number;
}

// ─── Static Fallback Rates (CPWD DSR 2025-26 — emergency parachute only) ────
// Updated April 2026. These are used ONLY when market intelligence fails entirely.

const STATIC_FALLBACKS = {
  steel_per_tonne: {
    value: 75000, unit: "₹/tonne",
    source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04",
    confidence: "LOW" as const, fallbackLevel: "national" as const,
  },
  cement_per_bag: {
    value: 420, unit: "₹/bag (50kg)",
    source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04",
    confidence: "LOW" as const, brand: "Generic OPC 53", fallbackLevel: "national" as const,
  },
  sand_per_cft: {
    value: 70, unit: "₹/cft",
    source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04",
    confidence: "LOW" as const, type: "M-sand", fallbackLevel: "national" as const,
  },
  labor: {
    mason:       { value: 950, unit: "₹/day", source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04", confidence: "LOW" as const, fallbackLevel: "national" as const },
    helper:      { value: 580, unit: "₹/day", source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04", confidence: "LOW" as const, fallbackLevel: "national" as const },
    carpenter:   { value: 1050, unit: "₹/day", source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04", confidence: "LOW" as const, fallbackLevel: "national" as const },
    steelFixer:  { value: 900, unit: "₹/day", source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04", confidence: "LOW" as const, fallbackLevel: "national" as const },
    electrician: { value: 1150, unit: "₹/day", source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04", confidence: "LOW" as const, fallbackLevel: "national" as const },
    plumber:     { value: 1000, unit: "₹/day", source: "CPWD DSR 2025-26 (static fallback)", date: "2026-04", confidence: "LOW" as const, fallbackLevel: "national" as const },
  },
};

// ─── Redis Cache ────────────────────────────────────────────────────────────

async function getCachedResult(cacheKey: string): Promise<MarketIntelligenceResult | null> {
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    const cached = await redis.get<MarketIntelligenceResult>(cacheKey);
    return cached ?? null;
  } catch {
    return null;
  }
}

async function setCachedResult(cacheKey: string, data: MarketIntelligenceResult): Promise<void> {
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return;
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    await redis.set(cacheKey, data, { ex: 82800 }); // 23 hours TTL
  } catch {
    // Non-fatal — caching is best-effort
  }
}

// ─── Persistent Price Cache (Postgres via Prisma) ──────────────────────────
// Survives Redis TTL expiry. Enables cross-user learning: once ANY user
// fetches prices for Pune, ALL subsequent Pune BOQs benefit.

async function persistToMaterialCache(result: MarketIntelligenceResult): Promise<void> {
  try {
    const { prisma } = await import("@/lib/db");
    const now = new Date(result.fetched_at || Date.now());
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
    const city = result.city || "";
    const state = result.state || "";
    if (!city || !state) return;

    const entries: Array<{
      materialCode: string; price: number; unit: string;
      source: string; confidence: string;
    }> = [
      { materialCode: "steel_per_tonne", price: result.steel_per_tonne.value, unit: result.steel_per_tonne.unit, source: result.steel_per_tonne.source, confidence: result.steel_per_tonne.confidence },
      { materialCode: "cement_per_bag", price: result.cement_per_bag.value, unit: result.cement_per_bag.unit, source: result.cement_per_bag.source, confidence: result.cement_per_bag.confidence },
      { materialCode: "sand_per_cft", price: result.sand_per_cft.value, unit: result.sand_per_cft.unit, source: result.sand_per_cft.source, confidence: result.sand_per_cft.confidence },
      { materialCode: "labor_mason", price: result.labor.mason.value, unit: result.labor.mason.unit, source: result.labor.mason.source, confidence: result.labor.mason.confidence },
      { materialCode: "labor_helper", price: result.labor.helper.value, unit: result.labor.helper.unit, source: result.labor.helper.source, confidence: result.labor.helper.confidence },
      { materialCode: "labor_carpenter", price: result.labor.carpenter.value, unit: result.labor.carpenter.unit, source: result.labor.carpenter.source, confidence: result.labor.carpenter.confidence },
      { materialCode: "labor_electrician", price: result.labor.electrician.value, unit: result.labor.electrician.unit, source: result.labor.electrician.source, confidence: result.labor.electrician.confidence },
      { materialCode: "labor_plumber", price: result.labor.plumber.value, unit: result.labor.plumber.unit, source: result.labor.plumber.source, confidence: result.labor.plumber.confidence },
      { materialCode: "labor_steel_fixer", price: result.labor.steelFixer.value, unit: result.labor.steelFixer.unit, source: result.labor.steelFixer.source, confidence: result.labor.steelFixer.confidence },
    ];

    // Filter out static fallback entries (only persist live/partial data)
    const liveEntries = entries.filter(e => e.confidence !== "LOW" || !e.source.includes("static fallback"));

    if (liveEntries.length === 0) return;

    // Batch create — fire-and-forget, non-blocking
    await prisma.materialPriceCache.createMany({
      data: liveEntries.map(e => ({
        city,
        state,
        materialCode: e.materialCode,
        price: e.price,
        unit: e.unit,
        source: e.source,
        confidence: e.confidence,
        fetchedAt: now,
        expiresAt,
      })),
    });
  } catch {
    // Non-fatal — persistence is best-effort
  }
}

// ─── Sanity Utilities ───────────────────────────────────────────────────────

/** Auto-convert sqft→m² for Indian construction costs.
 * Indian sqft costs: ₹1,500-8,000. Indian m² costs: ₹15,000-100,000+.
 * If value < 10,000 → definitely sqft (no Indian city has m² cost below ₹10,000) */
function ensurePerM2(value: number, field: string): number {
  if (value > 0 && value < 10000) {
    const converted = Math.round(value * 10.764);
    return converted;
  }
  return value;
}

/** Clamp state PWD factor to realistic range. No Indian state is <0.80x or >1.50x CPWD. */
function clampPWDFactor(factor: number): number {
  if (factor < 0.80) { return 0.80; }
  if (factor > 1.50) { return 1.50; }
  return factor;
}

// ─── Agent Implementation ───────────────────────────────────────────────────

export async function fetchMarketPrices(
  city: string,
  state: string,
  buildingType: string,
  diag?: PipelineDiagnostics,
): Promise<MarketIntelligenceResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  const now = new Date();
  const monthYear = now.toLocaleString("en-IN", { month: "long", year: "numeric" });
  const yearStr = String(now.getFullYear());
  const dateStr = now.toISOString().split("T")[0];

  if (diag) {
    diag.stages.marketIntelligence.attempted = true;
    addLog(diag, "tr-015-market", "info", `Fetching market prices for ${city}, ${state}`, {
      buildingType, monthYear, hasApiKey: !!apiKey,
    });
  }

  // ── Cache check ──
  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "_");
  const cacheKey = `market_intel:v2:${norm(city)}:${norm(state)}:${dateStr}`;
  const cached = await getCachedResult(cacheKey);
  if (cached && cached.city?.toLowerCase() === city.toLowerCase() && cached.state?.toLowerCase() === state.toLowerCase()) {
    const fetchTime = cached.fetched_at ? new Date(cached.fetched_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "earlier";
    cached.agent_notes = [
      `💾 Market Intelligence — ${city}, ${state} (cached, fetched today at ${fetchTime})`,
      `Steel ₹${cached.steel_per_tonne?.value?.toLocaleString() ?? "?"}/t · Cement ₹${cached.cement_per_bag?.value ?? "?"}/bag · Mason ₹${cached.labor?.mason?.value ?? "?"}/day · Sand ₹${cached.sand_per_cft?.value ?? "?"}/cft`,
      `Prices refresh daily at midnight IST`,
    ];
    cached.duration_ms = 0; // instant from cache
    if (diag) {
      diag.stages.marketIntelligence.cacheHit = true;
      diag.stages.marketIntelligence.status = cached.agent_status === "fallback" ? "failed" : cached.agent_status;
      diag.stages.marketIntelligence.steelPrice = cached.steel_per_tonne?.value;
      diag.stages.marketIntelligence.steelSource = cached.steel_per_tonne?.source;
      diag.stages.marketIntelligence.cementPrice = cached.cement_per_bag?.value;
      diag.stages.marketIntelligence.cementSource = cached.cement_per_bag?.source;
      addLog(diag, "tr-015-market", "info", "Redis cache HIT — returning cached prices", {
        fetchedAt: cached.fetched_at,
      });
    }
    return cached;
  }
  if (cached) {
    console.warn(`[TR-015] Cache key matched but city/state mismatch — ignoring cache`);
  }
  if (diag) diag.stages.marketIntelligence.cacheHit = false;

  // ── Postgres MaterialPriceCache check (Sprint 3 addition) ──────────────
  // If Redis missed but Postgres has recent data, use it and skip the Claude call.
  // This saves 10-20s per request for cities previously fetched by any user.
  try {
    const { prisma } = await import("@/lib/db");
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

    const cachedPrices = await prisma.materialPriceCache.findMany({
      where: {
        city: { equals: city, mode: "insensitive" as const },
        state: { equals: state, mode: "insensitive" as const },
        fetchedAt: { gte: cutoff },
      },
      orderBy: { fetchedAt: "desc" },
      take: 20, // enough to cover all material codes
    });

    if (cachedPrices.length >= 3) {
      // Reconstruct MarketIntelligenceResult from cached entries
      const priceMap = new Map<string, { price: number; unit: string; source: string; confidence: string; fetchedAt: Date }>();
      for (const p of cachedPrices) {
        if (!priceMap.has(p.materialCode)) {
          priceMap.set(p.materialCode, { price: p.price, unit: p.unit, source: p.source, confidence: p.confidence, fetchedAt: p.fetchedAt });
        }
      }

      type Conf = "HIGH" | "MEDIUM" | "LOW";
      const toConf = (c: string): Conf => (c === "HIGH" || c === "MEDIUM" ? c : "LOW");
      const get = (code: string) => priceMap.get(code);
      const steelEntry = get("steel_per_tonne");
      const cementEntry = get("cement_per_bag");
      const sandEntry = get("sand_per_cft");
      const masonEntry = get("labor_mason");

      if (steelEntry && cementEntry) {
        const fetchedAt = cachedPrices[0].fetchedAt;
        const ageMs = Date.now() - fetchedAt.getTime();
        const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));

        const pgResult: MarketIntelligenceResult = {
          steel_per_tonne: { value: steelEntry.price, unit: steelEntry.unit, source: `${steelEntry.source} (cached ${ageDays}d ago)`, date: fetchedAt.toISOString(), confidence: toConf(steelEntry.confidence) },
          cement_per_bag: { value: cementEntry.price, unit: cementEntry.unit, source: `${cementEntry.source} (cached ${ageDays}d ago)`, date: fetchedAt.toISOString(), confidence: toConf(cementEntry.confidence) },
          sand_per_cft: sandEntry
            ? { value: sandEntry.price, unit: sandEntry.unit, source: `${sandEntry.source} (cached ${ageDays}d ago)`, date: fetchedAt.toISOString(), confidence: toConf(sandEntry.confidence) }
            : { value: 70, unit: "₹/cft", source: "CPWD static fallback", date: new Date().toISOString(), confidence: "LOW" as const },
          labor: {
            mason: masonEntry
              ? { value: masonEntry.price, unit: masonEntry.unit, source: `${masonEntry.source} (cached)`, date: fetchedAt.toISOString(), confidence: toConf(masonEntry.confidence) }
              : { value: 950, unit: "₹/day", source: "CPWD static fallback", date: new Date().toISOString(), confidence: "LOW" as const },
            helper: { value: get("labor_helper")?.price ?? 580, unit: "₹/day", source: "cached", date: fetchedAt.toISOString(), confidence: "MEDIUM" as const },
            carpenter: { value: get("labor_carpenter")?.price ?? 1050, unit: "₹/day", source: "cached", date: fetchedAt.toISOString(), confidence: "MEDIUM" as const },
            steelFixer: { value: get("labor_steel_fixer")?.price ?? 1000, unit: "₹/day", source: "cached", date: fetchedAt.toISOString(), confidence: "MEDIUM" as const },
            electrician: { value: get("labor_electrician")?.price ?? 1150, unit: "₹/day", source: "cached", date: fetchedAt.toISOString(), confidence: "MEDIUM" as const },
            plumber: { value: get("labor_plumber")?.price ?? 1050, unit: "₹/day", source: "cached", date: fetchedAt.toISOString(), confidence: "MEDIUM" as const },
          },
          benchmark_per_sqft: { value: 2500, range_low: 1800, range_high: 4500, source: "Estimated", building_type: buildingType },
          cpwd_index: { factor: 1.0, source: "Cached (no live data)", year: new Date().getFullYear() },
          minimum_cost_per_m2: 22000,
          typical_range_min: 25000,
          typical_range_max: 55000,
          state_pwd_factor: 1.0,
          absolute_minimum_cost: 18000,
          building_type_factor: 1.0,
          mep_percentage: 25,
          benchmark_label: `${buildingType} in ${city}, ${state} (from cache)`,
          sources_summary: [`Postgres MaterialPriceCache (${ageDays} days old, ${cachedPrices.length} entries)`],
          fetched_at: fetchedAt.toISOString(),
          city, state,
          agent_status: ageDays <= 14 ? "success" as const : "partial" as const,
          agent_notes: [
            `📦 Prices from Postgres cache (${ageDays} days old)`,
            `Steel ₹${steelEntry.price.toLocaleString()}/t · Cement ₹${cementEntry.price}/bag`,
            ageDays > 14 ? "⚠️ Data aging — recommend manual refresh" : "✅ Fresh cached data",
          ],
          search_count: 0,
          duration_ms: 0,
          fallbacks_used: 0,
        };

        if (diag) {
          diag.stages.marketIntelligence.status = pgResult.agent_status === "fallback" ? "failed" : pgResult.agent_status;
          diag.stages.marketIntelligence.materialPriceCacheHit = true;
          diag.stages.marketIntelligence.steelPrice = steelEntry.price;
          diag.stages.marketIntelligence.cementPrice = cementEntry.price;
          addLog(diag, "tr-015-market", "info", `Postgres cache HIT — ${cachedPrices.length} entries, ${ageDays} days old`, {
            city, state, entriesFound: cachedPrices.length, ageDays,
          });
        }

        // Also warm Redis so next call is even faster
        setCachedResult(cacheKey, pgResult).catch(() => {});

        return pgResult;
      }
    }
  } catch (pgErr) {
    // Non-fatal — Postgres lookup failure should never block the pipeline
    console.warn("[TR-015] Postgres cache lookup failed (non-fatal):", pgErr);
  }

  // Default result with static fallbacks
  const result: MarketIntelligenceResult = {
    steel_per_tonne: { ...STATIC_FALLBACKS.steel_per_tonne },
    cement_per_bag: { ...STATIC_FALLBACKS.cement_per_bag },
    sand_per_cft: { ...STATIC_FALLBACKS.sand_per_cft },
    labor: {
      mason: { ...STATIC_FALLBACKS.labor.mason },
      helper: { ...STATIC_FALLBACKS.labor.helper },
      carpenter: { ...STATIC_FALLBACKS.labor.carpenter },
      steelFixer: { ...STATIC_FALLBACKS.labor.steelFixer },
      electrician: { ...STATIC_FALLBACKS.labor.electrician },
      plumber: { ...STATIC_FALLBACKS.labor.plumber },
    },
    benchmark_per_sqft: {
      value: 2500, range_low: 1800, range_high: 4500,
      source: "Estimated (no live data)", building_type: buildingType,
    },
    cpwd_index: { factor: 1.0, source: "Baseline (no live data)", year: now.getFullYear() },
    minimum_cost_per_m2: 22000,
    typical_range_min: 25000,
    typical_range_max: 55000,
    state_pwd_factor: 1.0,
    absolute_minimum_cost: 18000,
    building_type_factor: 1.0,
    mep_percentage: 25,
    benchmark_label: `${buildingType} in ${city}, ${state} (static fallback)`,
    sources_summary: [],
    fetched_at: now.toISOString(),
    city, state,
    agent_status: "fallback",
    agent_notes: [],
    search_count: 0,
    duration_ms: 0,
    fallbacks_used: 9, // materials(3) + labor(6) all start as fallback
  };

  if (!apiKey) {
    console.warn("[TR-015] ANTHROPIC_API_KEY is empty/missing — returning static rates");
    result.agent_notes.push("⚠️ LIVE PRICES NOT FETCHED: ANTHROPIC_API_KEY not configured in environment. Using CPWD 2024 static fallback rates — may be inaccurate for your location. Set the key in Vercel Settings → Environment Variables.");
    if (diag) {
      diag.stages.marketIntelligence.status = "failed";
      diag.stages.marketIntelligence.error = "ANTHROPIC_API_KEY missing";
      addLog(diag, "tr-015-market", "error", "ANTHROPIC_API_KEY not configured — using static fallback");
    }
    return result;
  }

  if (!apiKey.startsWith("sk-ant-api")) {
    console.warn(`[TR-015] ANTHROPIC_API_KEY has wrong format: starts with "${apiKey.slice(0, 10)}..." — not sk-ant-api`);
    result.agent_notes.push(
      "⚠️ LIVE PRICES NOT FETCHED: ANTHROPIC_API_KEY is not a valid API key (must start with sk-ant-api03-). " +
      "Get one from console.anthropic.com/settings/keys. Using static fallback rates."
    );
    if (diag) {
      diag.stages.marketIntelligence.status = "failed";
      diag.stages.marketIntelligence.error = "ANTHROPIC_API_KEY invalid format";
      addLog(diag, "tr-015-market", "error", "ANTHROPIC_API_KEY has invalid format");
    }
    return result;
  }

  const startTime = Date.now();
  const client = new Anthropic({ apiKey });

  // ── Reasoning-based prompt: Claude thinks like a senior QS, not a database ──
  const userPrompt = `You are a senior Quantity Surveyor with 20 years of Indian construction experience. REASON through each price — do not just recall averages.

Location: ${city}, ${state}, India. Date: ${monthYear}. Building type: ${buildingType}.

REASON THROUGH THESE STEPS:

STEP 1 — Classify: Is ${city} a metro, district HQ, or small town? What are ${state}'s economic characteristics?

STEP 2 — Market factors for ${state}:
- Nearby steel plants? (Jamshedpur/Bhilai/Visakhapatnam → cheaper steel)
- Nearby cement plants? (Rajasthan/MP/Gujarat → cheaper cement; Kerala/NE → expensive, must import)
- Labor-surplus or labor-scarce? (Bihar/UP/Odisha → surplus → cheap; Kerala/Goa → scarce → expensive)
- Remote/hill/island logistics? (NE states +20-35%; Andaman +50-80%)

STEP 3 — Derive prices with brief reasoning in the "source" field. Example: "Near Bhilai Steel Plant, cheapest steel belt in India" or "Kerala imports cement, ~15% above national average".

STEP 4 — SELF-CRITIQUE (act as your own reviewer):
Before finalizing, check each answer:
- Is steel in ₹52,000-78,000/tonne range? If not, reconsider.
- Is cement in ₹340-560/bag range? If cement-producing state shows >₹450, that's wrong.
- Is mason wage consistent? Labor-surplus states must be <₹700, scarce states >₹900.
- If mason is high (Kerala) but cement is low (national avg) → inconsistent. High-labor markets usually have higher material costs too.
- ALL benchmark values MUST be in INR per SQUARE METRE (m²). NOT sqft.
  If you think in sqft, multiply by 10.764. m² values are ALWAYS > 15,000.
  If benchmark range_low < 10,000 → you're returning sqft. Convert before returning.
- Is ${buildingType} premium applied? wellness > hotel > hospital > office > residential.

IMPORTANT: You have web_search available. SEARCH for current prices before answering.
Search for: "{material} price {city} {state} India today" for at least steel and cement.
Use searched data as your primary source. Mark confidence HIGH if you found real data.

After searching, use the report_construction_prices tool to return your findings.`;

  // ── Tool definition forces structured JSON output — no parse errors ever ──
  const priceTool = {
    name: "report_construction_prices",
    description: "Report reasoned construction prices for an Indian city. The source field should explain WHY this price, not just where from.",
    input_schema: {
      type: "object" as const,
      properties: {
        steel_per_tonne: { type: "object" as const, properties: { value: { type: "number" as const, description: "TMT Fe500 price in INR per tonne" }, source: { type: "string" as const, description: "Brief reasoning WHY this price. E.g. 'Near Bhilai Steel Plant, lowest in India' or 'NE import premium +25%'" }, date: { type: "string" as const }, confidence: { type: "string" as const, description: "HIGH if near production center, MEDIUM otherwise, LOW if very uncertain" } }, required: ["value", "source"] },
        cement_per_bag: { type: "object" as const, properties: { value: { type: "number" as const, description: "OPC 53 cement price in INR per 50kg bag" }, brand: { type: "string" as const }, source: { type: "string" as const, description: "Brief reasoning. E.g. 'UltraTech plant in Rajpura, local supply' or 'Kerala imports all cement, premium market'" }, date: { type: "string" as const }, confidence: { type: "string" as const } }, required: ["value", "source"] },
        sand_per_cft: { type: "object" as const, properties: { value: { type: "number" as const }, type: { type: "string" as const }, source: { type: "string" as const, description: "Brief reasoning about sand availability" }, date: { type: "string" as const }, confidence: { type: "string" as const } }, required: ["value"] },
        mason: { type: "object" as const, properties: { value: { type: "number" as const, description: "Skilled mason daily wage in INR" }, source: { type: "string" as const, description: "Brief reasoning. E.g. 'Bihar labor surplus, workers migrate out' or 'Kerala severe labor scarcity, highest in India'" }, date: { type: "string" as const }, confidence: { type: "string" as const } }, required: ["value", "source"] },
        benchmark: { type: "object" as const, properties: {
          value: { type: "number" as const, description: "Typical construction cost in INR per SQUARE METRE (m²). NOT per sqft. If you know sqft, multiply by 10.764." },
          range_low: { type: "number" as const, description: "Minimum typical cost in INR per SQUARE METRE (m²). Example: commercial in tier-3 = 18000-25000. NOT sqft values like 1800-2500." },
          range_high: { type: "number" as const, description: "Maximum typical cost in INR per SQUARE METRE (m²). Example: commercial in metro = 45000-90000." },
          source: { type: "string" as const },
        }, required: ["value", "range_low", "range_high"] },
        minimum_cost_per_m2: { type: "number" as const, description: "Absolute minimum cost in INR per SQUARE METRE (m²) to build this building type in this city. Must be > 10000 for any Indian city." },
        building_type_factor: { type: "number" as const },
        mep_percentage: { type: "number" as const },
        mep_breakdown: { type: "object" as const, properties: {
          plumbing_pct: { type: "number" as const, description: "Plumbing % of hard cost" },
          electrical_pct: { type: "number" as const, description: "Electrical % of hard cost" },
          hvac_pct: { type: "number" as const, description: "HVAC % of hard cost" },
          fire_pct: { type: "number" as const, description: "Fire fighting % of hard cost" },
          lifts_pct: { type: "number" as const, description: "Lifts % of hard cost" },
          reasoning: { type: "string" as const, description: "One-line reasoning for the MEP split" },
        } },
        state_pwd_factor: { type: "number" as const },
        absolute_minimum_cost: { type: "number" as const },
      },
      required: ["steel_per_tonne", "cement_per_bag", "sand_per_cft", "mason", "benchmark"],
    },
  };

  let jsonText = "";
  let usedWebSearch = false;

  // ── Shorter prompt for Haiku (no web_search instructions, no self-critique) ──
  const haikuPrompt = `You are a senior Quantity Surveyor. Return current construction prices for ${city}, ${state}, India (${monthYear}). Building type: ${buildingType}.

Consider: Is ${city} metro/tier-2/tier-3? Is ${state} near steel/cement plants? Labor surplus or scarce?

Rules:
- ALL benchmark values in INR per SQUARE METRE (m²), NOT sqft. m² values > 15,000.
- Steel: ₹52,000-78,000/tonne. Cement: ₹340-560/bag. Mason: ₹500-1200/day.

Use the report_construction_prices tool to return your findings.`;

  // ── Primary: Claude Sonnet with web_search — SHORT prompt for speed ──
  // The long reasoning prompt was causing 40s+ timeouts on Vercel.
  // Web search results provide the context — no need for reasoning steps in prompt.
  const webSearchPrompt = `You MUST search the web before answering. Do NOT use your training data for prices — training data is stale and inaccurate.

Search for current construction material prices in ${city}, ${state}, India (${monthYear}).
Search: "TMT steel price ${city} ${state} today" and "cement price ${city} today".
After searching, use the report_construction_prices tool with your findings.
Building type: ${buildingType}. All benchmark values in INR per SQUARE METRE (m²), not sqft.
Steel range: ₹52,000-78,000/tonne. Cement: ₹340-560/bag. Mason: ₹500-1200/day.`;

  // ── Primary: Haiku + web_search (with 1 retry for transient failures) ──
  // 45s timeout allows for 3 web searches (3-8s each) + reasoning (3-5s).
  // Vercel maxDuration is 600s — plenty of headroom.
  if (diag) {
    diag.stages.marketIntelligence.toolChoiceUsed = "any (web_search + report_construction_prices)";
    addLog(diag, "tr-015-market", "info", "Calling Claude Haiku with web_search", {
      timeoutMs: 45_000,
      maxTokens: 2048,
      maxWebSearchUses: 3,
    });
  }

  try {
    const callStart = Date.now();

    const makeWebSearchCall = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      try {
        return await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          tools: [
            { type: "web_search_20250305", name: "web_search", max_uses: 3 },
            priceTool,
          ],
          tool_choice: { type: "any" },
          messages: [{ role: "user", content: webSearchPrompt }],
        }, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    // Try up to 2 attempts (initial + 1 retry with 3s backoff)
    let resp;
    try {
      resp = await makeWebSearchCall();
    } catch (firstErr) {
      console.warn(`[TR-015] Attempt 1 failed (${firstErr instanceof Error ? firstErr.message : firstErr}), retrying in 3s...`);
      if (diag) {
        diag.stages.marketIntelligence.retryUsed = true;
        addLog(diag, "tr-015-market", "warn", "Primary call failed — retrying after 3s", {
          error: firstErr instanceof Error ? firstErr.message : String(firstErr),
        });
      }
      await new Promise(r => setTimeout(r, 3000));
      resp = await makeWebSearchCall();
    }

    const callMs = Date.now() - callStart;
    let webSearchCount = 0;
    for (const block of resp.content) {
      const bt = block.type as string;
      if (bt === "web_search_tool_result") webSearchCount++;
      if (bt === "web_search_tool_result" || bt === "server_tool_use") usedWebSearch = true;
      if (block.type === "tool_use" && block.name === "report_construction_prices") {
        jsonText = JSON.stringify(block.input);
      }
    }
    if (!jsonText) {
      for (const block of resp.content) {
        if (block.type === "text" && block.text.includes("{")) { jsonText = block.text; break; }
      }
    }
    result.search_count = usedWebSearch ? 3 : 0;
    if (diag) {
      diag.stages.marketIntelligence.primaryCallMs = callMs;
      diag.stages.marketIntelligence.webSearchesPerformed = webSearchCount;
      addLog(diag, "tr-015-market", "info", `Primary call returned in ${(callMs / 1000).toFixed(1)}s`, {
        usedWebSearch, webSearchCount, hasToolUse: !!jsonText,
      });
    }
    result.agent_notes.push(`✨ Market Intelligence — ${city}, ${state} · ${monthYear} · ${usedWebSearch ? "web search" : "Claude AI"} · ±${usedWebSearch ? "10-15" : "15-25"}%`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[TR-015] Haiku + web_search failed after ${Date.now() - startTime}ms: ${errMsg}`);
    if (diag) {
      diag.stages.marketIntelligence.fallbackCallUsed = true;
      addLog(diag, "tr-015-market", "warn", "Web search call failed — falling back to Haiku without search", {
        error: errMsg.slice(0, 300),
      });
    }

    // ── Fallback: Haiku WITHOUT web_search ──
    try {
      const haikuStart = Date.now();
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 25_000);
      const resp2 = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        tools: [priceTool],
        tool_choice: { type: "tool", name: "report_construction_prices" },
        messages: [{ role: "user", content: haikuPrompt }],
      }, { signal: ctrl2.signal });
      clearTimeout(t2);
      for (const block of resp2.content) {
        if (block.type === "tool_use" && block.name === "report_construction_prices") {
          jsonText = JSON.stringify(block.input);
          break;
        }
      }
      result.search_count = 0;
      if (diag) {
        addLog(diag, "tr-015-market", "info", `Fallback (Haiku no-search) returned in ${(Date.now() - haikuStart)}ms`, {
          hasToolUse: !!jsonText,
        });
      }
      result.agent_notes.push(`✨ Market Intelligence — ${city}, ${state} · ${monthYear} · Claude AI · ±15-25%`);
    } catch (fallbackErr) {
      const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      result.agent_notes.push(`Using CPWD 2024 static rates (AI unavailable — ${fbMsg})`);
      console.error(`[TR-015] All attempts failed after ${Date.now() - startTime}ms: ${fbMsg}`);
      if (diag) {
        diag.stages.marketIntelligence.status = "failed";
        diag.stages.marketIntelligence.error = fbMsg.slice(0, 300);
        addLog(diag, "tr-015-market", "error", "All Haiku attempts failed — using static CPWD rates", {
          error: fbMsg.slice(0, 300),
        });
      }
    }
  }

  // ── Parse response (tool_use gives guaranteed valid JSON) ──
  if (jsonText) {
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let p: any;
      try {
        p = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.error(`[TR-015] JSON parse failed (unexpected with tool_use). Raw: ${jsonText.slice(0, 300)}`);
        result.agent_notes.push(`Failed to parse response: ${String(parseErr)}`);
        p = null;
      }
      if (p) try {
        const src = usedWebSearch ? "Web search" : `Claude AI estimate (${monthYear})`;
        const conf = usedWebSearch ? "HIGH" : "MEDIUM";

        // Materials
        if (p.steel_per_tonne?.value > 0) {
          result.steel_per_tonne = {
            value: p.steel_per_tonne.value, unit: "₹/tonne",
            source: p.steel_per_tonne.source || src,
            date: p.steel_per_tonne.date || monthYear,
            confidence: p.steel_per_tonne.confidence || conf,
            fallbackLevel: usedWebSearch ? "city" : "state",
          };
        }
        if (p.cement_per_bag?.value > 0) {
          result.cement_per_bag = {
            value: p.cement_per_bag.value, unit: "₹/bag (50kg)",
            source: p.cement_per_bag.source || src,
            date: p.cement_per_bag.date || monthYear,
            confidence: p.cement_per_bag.confidence || conf,
            brand: p.cement_per_bag.brand || "UltraTech/Ambuja",
            fallbackLevel: usedWebSearch ? "city" : "state",
          };
        }
        if (p.sand_per_cft?.value > 0) {
          result.sand_per_cft = {
            value: p.sand_per_cft.value, unit: "₹/cft",
            source: p.sand_per_cft.source || src,
            date: p.sand_per_cft.date || monthYear,
            confidence: p.sand_per_cft.confidence || conf,
            type: p.sand_per_cft.type || "M-sand",
            fallbackLevel: usedWebSearch ? "city" : "state",
          };
        }

        // Mason rate — derive all other labor from this
        const mason = p.mason ?? p.labor?.mason;
        if (mason?.value > 0) {
          const masonVal = mason.value;
          const mSrc = mason.source || src;
          const mDate = mason.date || monthYear;
          const mConf = mason.confidence || conf;
          const fb = usedWebSearch ? "city" as const : "state" as const;
          result.labor.mason = { value: masonVal, unit: "₹/day", source: mSrc, date: mDate, confidence: mConf, fallbackLevel: fb };
          // Derive other rates from mason with industry ratios
          result.labor.helper = { value: Math.round(masonVal * 0.55), unit: "₹/day", source: `Derived from mason (×0.55) — ${mSrc}`, date: mDate, confidence: mConf, fallbackLevel: fb };
          result.labor.carpenter = { value: Math.round(masonVal * 1.10), unit: "₹/day", source: `Derived from mason (×1.10) — ${mSrc}`, date: mDate, confidence: mConf, fallbackLevel: fb };
          result.labor.steelFixer = { value: Math.round(masonVal * 0.95), unit: "₹/day", source: `Derived from mason (×0.95) — ${mSrc}`, date: mDate, confidence: mConf, fallbackLevel: fb };
          result.labor.electrician = { value: Math.round(masonVal * 1.25), unit: "₹/day", source: `Derived from mason (×1.25) — ${mSrc}`, date: mDate, confidence: mConf, fallbackLevel: fb };
          result.labor.plumber = { value: Math.round(masonVal * 1.05), unit: "₹/day", source: `Derived from mason (×1.05) — ${mSrc}`, date: mDate, confidence: mConf, fallbackLevel: fb };
        }

        // Benchmark — handle both flat and nested format
        // Auto-convert sqft→m² if values are suspiciously low
        const bench = p.benchmark ?? p.benchmark_per_sqft;
        if (bench?.value > 0 || bench?.range_low > 0) {
          const bVal = ensurePerM2(bench.value || bench.range_low || 0, "benchmark_value");
          const bLow = ensurePerM2(bench.range_low || bVal * 0.75, "benchmark_low");
          const bHigh = ensurePerM2(bench.range_high || bVal * 1.25, "benchmark_high");
          result.benchmark_per_sqft = {
            value: bVal, range_low: bLow, range_high: bHigh,
            source: bench.source || src, building_type: buildingType,
          };
          result.typical_range_min = bLow;
          result.typical_range_max = bHigh;
        }
        if (p.cpwd_index?.factor > 0) {
          result.cpwd_index = {
            factor: p.cpwd_index.factor,
            source: p.cpwd_index.source || "CPWD",
            year: p.cpwd_index.year || now.getFullYear(),
          };
        }
        if (Array.isArray(p.sources)) {
          result.sources_summary = p.sources.filter((s: unknown) => typeof s === "string");
        }

        // Dynamic benchmarks — apply ensurePerM2 to ALL cost/m² fields
        if (p.minimum_cost_per_m2 > 0) {
          result.minimum_cost_per_m2 = ensurePerM2(p.minimum_cost_per_m2, "minimum_cost");
        }
        if (p.mep_breakdown?.plumbing_pct > 0) {
          result.mep_breakdown = p.mep_breakdown;
        }
        if (p.building_type_factor > 0) {
          result.building_type_factor = p.building_type_factor;
        }
        if (p.mep_percentage > 0) {
          result.mep_percentage = p.mep_percentage;
        }
        result.benchmark_label = `${buildingType} in ${city}, ${state} (${monthYear} — AI estimate)`;

        // State PWD factor from Claude (replaces hardcoded table)
        if (p.state_pwd_factor > 0) {
          result.state_pwd_factor = clampPWDFactor(p.state_pwd_factor);
        }
        if (p.absolute_minimum_cost > 0) {
          result.absolute_minimum_cost = ensurePerM2(p.absolute_minimum_cost, "absolute_minimum");
        }

        // Status — count how many items have live data
        const matPrices = [result.steel_per_tonne, result.cement_per_bag, result.sand_per_cft];
        const corePrices = [...matPrices, result.labor.mason];
        const liveCount = corePrices.filter(p2 => p2.confidence !== "LOW").length;
        result.fallbacks_used = 9 - (liveCount + (liveCount >= 1 ? 5 : 0)); // mason derives 5 others

        if (liveCount >= 3) {
          result.agent_status = "success";
        } else if (liveCount >= 1) {
          result.agent_status = "partial";
        }
        // Add price summary line
        result.agent_notes.push(
          `Steel ₹${result.steel_per_tonne.value.toLocaleString()}/t · Cement ₹${result.cement_per_bag.value}/bag · Mason ₹${result.labor.mason.value}/day · Sand ₹${result.sand_per_cft.value}/cft`
        );

      } catch (parseErr) {
        result.agent_notes.push(`Failed to process AI response fields: ${String(parseErr)}`);
      }
    } else {
      result.agent_notes.push("AI response did not contain valid JSON.");
    }
  }

  result.duration_ms = Date.now() - startTime;

  // ── Final diagnostics population ──
  if (diag) {
    diag.stages.marketIntelligence.status =
      result.agent_status === "success" ? "success"
      : result.agent_status === "partial" ? "partial"
      : "failed";
    diag.stages.marketIntelligence.steelPrice = result.steel_per_tonne.value;
    diag.stages.marketIntelligence.steelSource = result.steel_per_tonne.source;
    diag.stages.marketIntelligence.cementPrice = result.cement_per_bag.value;
    diag.stages.marketIntelligence.cementSource = result.cement_per_bag.source;
    addLog(diag, "tr-015-market", "info", `Market intelligence completed: ${result.agent_status}`, {
      durationMs: result.duration_ms,
      steel: result.steel_per_tonne.value,
      cement: result.cement_per_bag.value,
      mason: result.labor.mason.value,
      sand: result.sand_per_cft.value,
    });
  }

  // ── Cache write (only if we got live data) ──
  if (result.agent_status !== "fallback") {
    setCachedResult(cacheKey, result).catch(() => {});
    // Persist to Postgres for cross-user learning (survives Redis TTL)
    persistToMaterialCache(result).catch(() => {});
  }

  return result;
}

// ─── Market Adjustments ─────────────────────────────────────────────────────

export function computeMarketAdjustments(
  marketData: MarketIntelligenceResult
): {
  steelAdjustment: number;
  cementAdjustment: number;
  sandAdjustment: number;
  laborAdjustment: number;
  overallConfidence: "HIGH" | "MEDIUM" | "LOW";
  priceNotes: string[];
} {
  const notes: string[] = [];

  // CPWD DSR 2024 base rates
  const cpwdSteel = 68000;
  const cpwdCement = 380;
  const cpwdSand = 55;
  const cpwdMason = 800;

  const steelAdj = marketData.steel_per_tonne.value / cpwdSteel;
  const cementAdj = marketData.cement_per_bag.value / cpwdCement;
  const sandAdj = marketData.sand_per_cft.value / cpwdSand;
  const laborAdj = marketData.labor.mason.value / cpwdMason;

  if (marketData.steel_per_tonne.confidence !== "LOW") {
    notes.push(`Steel: ₹${marketData.steel_per_tonne.value.toLocaleString()}/tonne (${marketData.steel_per_tonne.source}) — ${marketData.steel_per_tonne.confidence}`);
  }
  if (marketData.cement_per_bag.confidence !== "LOW") {
    notes.push(`Cement: ${marketData.cement_per_bag.brand} ₹${marketData.cement_per_bag.value}/bag (${marketData.cement_per_bag.source}) — ${marketData.cement_per_bag.confidence}`);
  }
  if (marketData.sand_per_cft.confidence !== "LOW") {
    notes.push(`Sand: ${marketData.sand_per_cft.type} ₹${marketData.sand_per_cft.value}/cft (${marketData.sand_per_cft.source}) — ${marketData.sand_per_cft.confidence}`);
  }
  if (marketData.labor.mason.confidence !== "LOW") {
    notes.push(`Mason: ₹${marketData.labor.mason.value}/day (${marketData.labor.mason.source}) — ${marketData.labor.mason.confidence}`);
  }

  const allPrices = [marketData.steel_per_tonne, marketData.cement_per_bag, marketData.sand_per_cft, marketData.labor.mason];
  const highCount = allPrices.filter(p => p.confidence === "HIGH").length;
  const medCount = allPrices.filter(p => p.confidence === "MEDIUM").length;
  const overallConfidence = highCount >= 2 ? "HIGH" : (highCount + medCount) >= 2 ? "MEDIUM" : "LOW";

  return {
    steelAdjustment: Math.round(steelAdj * 1000) / 1000,
    cementAdjustment: Math.round(cementAdj * 1000) / 1000,
    sandAdjustment: Math.round(sandAdj * 1000) / 1000,
    laborAdjustment: Math.round(laborAdj * 1000) / 1000,
    overallConfidence,
    priceNotes: notes,
  };
}
