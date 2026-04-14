import { NextRequest, NextResponse } from "next/server";

/**
 * Cron: Batch Material Price Refresh
 *
 * Pre-populates MaterialPriceCache for the top 50 Indian cities so that
 * users get instant cached prices instead of waiting 15-35s for a live
 * Claude Haiku web search during their BOQ generation.
 *
 * Schedule: 1st and 15th of each month at 3 AM IST (vercel.json cron)
 * Can also be triggered manually: POST /api/cron/refresh-prices with Bearer token
 *
 * Cost: ~50 cities × $0.003/call = $0.15 per run = $0.30/month
 *
 * Data flow:
 *   fetchMarketPrices(city, state, "residential")
 *     → Claude Haiku + web_search → parse prices
 *     → setCachedResult() → Redis (23hr TTL)
 *     → persistToMaterialCache() → Postgres MaterialPriceCache (30-day expiry)
 *
 * The price-fallback-chain.ts then serves these cached prices at Priority 3-5
 * for any user in these cities — zero latency, no LLM call needed.
 */

export const maxDuration = 300; // 5 minutes — enough for ~60 cities at 2s delay each
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // ── Auth: Vercel Cron sends CRON_SECRET, manual calls use Bearer token ──
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Import dependencies (lazy — only loaded when cron runs) ──
  const { INDIAN_CITIES } = await import("@/features/boq/constants/indian-cities");
  const { fetchMarketPrices } = await import("@/features/boq/services/market-intelligence");

  const MAX_CITIES = 60;      // Budget cap: 60 × ~$0.003 = $0.18 per run
  const DELAY_MS = 2000;      // 2s between cities to avoid API rate limits
  const TIMEOUT_MS = 270_000; // 4.5 min safety margin (maxDuration = 5 min)

  const results: Array<{
    city: string; state: string; tier: string;
    status: string; steel?: number; cement?: number; mason?: number;
    error?: string; durationMs?: number;
  }> = [];
  let successCount = 0;
  let failCount = 0;
  const runStart = Date.now();

  // Process metro cities first (highest user volume), then tier2, tier3
  const tierOrder: Record<string, number> = { metro: 0, tier2: 1, tier3: 2 };
  const sorted = [...INDIAN_CITIES]
    .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier])
    .slice(0, MAX_CITIES);

  console.log(`[cron/refresh-prices] Starting batch refresh for ${sorted.length} cities`);

  for (const city of sorted) {
    // Budget guard — stop if approaching maxDuration
    if (Date.now() - runStart > TIMEOUT_MS) {
      console.warn(`[cron/refresh-prices] Timeout after ${results.length} cities`);
      break;
    }

    const cityStart = Date.now();
    try {
      const result = await fetchMarketPrices(city.name, city.state, "residential");
      // fetchMarketPrices automatically persists to Redis + Postgres on success

      const status = result.agent_status; // "success" | "partial" | "fallback"
      results.push({
        city: city.name,
        state: city.state,
        tier: city.tier,
        status,
        steel: result.steel_per_tonne?.value,
        cement: result.cement_per_bag?.value,
        mason: result.labor?.mason?.value,
        durationMs: Date.now() - cityStart,
      });

      if (status !== "fallback") {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      results.push({
        city: city.name,
        state: city.state,
        tier: city.tier,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - cityStart,
      });
      failCount++;
    }

    // Rate limit — 2s between cities to avoid Anthropic API throttling
    if (Date.now() - runStart < TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  const totalDuration = Date.now() - runStart;
  console.log(
    `[cron/refresh-prices] Complete: ${successCount}/${results.length} success, ${failCount} failed, ${totalDuration}ms`
  );

  return NextResponse.json({
    completed: results.length,
    success: successCount,
    failed: failCount,
    durationMs: totalDuration,
    results,
  });
}

// POST endpoint for manual trigger (same logic)
export async function POST(req: NextRequest) {
  return GET(req);
}
