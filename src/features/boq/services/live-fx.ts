/**
 * Live FX rate service — fetches INR/USD from RBI or ECB.
 *
 * Priority: Redis cache (24hr) → RBI Reference Rate → ECB API → hardcoded fallback.
 * Called by the refresh-prices cron and consumed by BOQ pricing for international reference.
 *
 * Since BuildFlow is Indian-only (Phase B), FX is mainly used for:
 * - Benchmarking against international rates
 * - MaterialPriceCache entries that store USD-denominated commodities
 */

export interface LiveFxResult {
  inrPerUsd: number;
  asOfDate: string;
  source: "rbi" | "ecb" | "cached" | "fallback";
  ageMinutes: number;
}

const FX_CACHE_KEY = "mkt:fx:inr-usd";
const FX_CACHE_TTL = 86400; // 24 hours
const FALLBACK_RATE = 83.50; // Static fallback, Phase A baseline

async function getRedis() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
    const { Redis } = await import("@upstash/redis");
    return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  } catch { return null; }
}

async function fetchFromRBI(): Promise<number | null> {
  try {
    // RBI publishes reference rates at this endpoint. The page contains an HTML table
    // with rows for USD, GBP, EUR, JPY. We extract the USD/INR rate.
    const resp = await fetch("https://www.rbi.org.in/Scripts/ReferenceRateArchive.aspx", {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "BuildFlow-BOQ/1.0 (construction cost estimator)" },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // Look for pattern: USD followed by a decimal number (the rate)
    // RBI page format: <td>US Dollar</td><td>83.4567</td>
    const match = html.match(/US\s*Dollar[^<]*<\/td>\s*<td[^>]*>\s*([\d.]+)/i);
    if (match) {
      const rate = parseFloat(match[1]);
      if (rate > 50 && rate < 150) return rate; // sanity check
    }
    return null;
  } catch { return null; }
}

async function fetchFromECB(): Promise<number | null> {
  try {
    // ECB provides EUR/INR. We also need EUR/USD to derive INR/USD.
    // Using ECB's free API (no auth required).
    const [eurInrResp, eurUsdResp] = await Promise.all([
      fetch("https://data-api.ecb.europa.eu/service/data/EXR/D.INR.EUR.SP00.A?lastNObservations=1&format=csvdata", { signal: AbortSignal.timeout(10000) }),
      fetch("https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata", { signal: AbortSignal.timeout(10000) }),
    ]);
    if (!eurInrResp.ok || !eurUsdResp.ok) return null;
    const eurInrCsv = await eurInrResp.text();
    const eurUsdCsv = await eurUsdResp.text();
    // CSV last line has the rate in the OBS_VALUE column
    const eurInr = parseFloat(eurInrCsv.split("\n").filter(l => l.trim()).pop()?.split(",").pop() ?? "0");
    const eurUsd = parseFloat(eurUsdCsv.split("\n").filter(l => l.trim()).pop()?.split(",").pop() ?? "0");
    if (eurInr > 50 && eurUsd > 0.5) {
      const inrPerUsd = Math.round((eurInr / eurUsd) * 100) / 100;
      if (inrPerUsd > 50 && inrPerUsd < 150) return inrPerUsd;
    }
    return null;
  } catch { return null; }
}

export async function getLiveFx(): Promise<LiveFxResult> {
  const now = new Date();

  // 1. Redis cache
  const redis = await getRedis();
  if (redis) {
    try {
      const cached = await redis.get<{ rate: number; date: string; ts: number }>(FX_CACHE_KEY);
      if (cached && (now.getTime() - cached.ts) < FX_CACHE_TTL * 1000) {
        return { inrPerUsd: cached.rate, asOfDate: cached.date, source: "cached", ageMinutes: Math.round((now.getTime() - cached.ts) / 60000) };
      }
    } catch { /* fall through */ }
  }

  // 2. RBI Reference Rate
  const rbiRate = await fetchFromRBI();
  if (rbiRate) {
    const result: LiveFxResult = { inrPerUsd: rbiRate, asOfDate: now.toISOString().split("T")[0], source: "rbi", ageMinutes: 0 };
    if (redis) { try { await redis.set(FX_CACHE_KEY, { rate: rbiRate, date: result.asOfDate, ts: now.getTime() }, { ex: FX_CACHE_TTL }); } catch { /* non-fatal */ } }
    return result;
  }

  // 3. ECB API
  const ecbRate = await fetchFromECB();
  if (ecbRate) {
    const result: LiveFxResult = { inrPerUsd: ecbRate, asOfDate: now.toISOString().split("T")[0], source: "ecb", ageMinutes: 0 };
    if (redis) { try { await redis.set(FX_CACHE_KEY, { rate: ecbRate, date: result.asOfDate, ts: now.getTime() }, { ex: FX_CACHE_TTL }); } catch { /* non-fatal */ } }
    return result;
  }

  // 4. Hardcoded fallback
  console.warn("[live-fx] All FX sources failed — using hardcoded ₹83.50/USD");
  return { inrPerUsd: FALLBACK_RATE, asOfDate: "2026-05-01", source: "fallback", ageMinutes: -1 };
}

export async function refreshFxCache(): Promise<LiveFxResult> {
  return getLiveFx(); // getLiveFx already writes to cache on success
}
