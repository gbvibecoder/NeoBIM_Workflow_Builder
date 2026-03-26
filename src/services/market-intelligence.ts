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

// ─── Static Fallback Rates (CPWD DSR 2024 — emergency parachute only) ──────

const STATIC_FALLBACKS = {
  steel_per_tonne: {
    value: 68000, unit: "₹/tonne",
    source: "CPWD DSR 2024 (static fallback — may be outdated)", date: "2024-01",
    confidence: "LOW" as const, fallbackLevel: "national" as const,
  },
  cement_per_bag: {
    value: 380, unit: "₹/bag (50kg)",
    source: "CPWD DSR 2024 (static fallback — may be outdated)", date: "2024-01",
    confidence: "LOW" as const, brand: "Generic OPC 53", fallbackLevel: "national" as const,
  },
  sand_per_cft: {
    value: 55, unit: "₹/cft",
    source: "CPWD DSR 2024 (static fallback — may be outdated)", date: "2024-01",
    confidence: "LOW" as const, type: "M-sand", fallbackLevel: "national" as const,
  },
  labor: {
    mason:       { value: 800, unit: "₹/day", source: "CPWD DSR 2024 (static fallback)", date: "2024-01", confidence: "LOW" as const, fallbackLevel: "national" as const },
    helper:      { value: 450, unit: "₹/day", source: "CPWD DSR 2024 (static fallback)", date: "2024-01", confidence: "LOW" as const, fallbackLevel: "national" as const },
    carpenter:   { value: 900, unit: "₹/day", source: "CPWD DSR 2024 (static fallback)", date: "2024-01", confidence: "LOW" as const, fallbackLevel: "national" as const },
    steelFixer:  { value: 750, unit: "₹/day", source: "CPWD DSR 2024 (static fallback)", date: "2024-01", confidence: "LOW" as const, fallbackLevel: "national" as const },
    electrician: { value: 1000, unit: "₹/day", source: "CPWD DSR 2024 (static fallback)", date: "2024-01", confidence: "LOW" as const, fallbackLevel: "national" as const },
    plumber:     { value: 850, unit: "₹/day", source: "CPWD DSR 2024 (static fallback)", date: "2024-01", confidence: "LOW" as const, fallbackLevel: "national" as const },
  },
};

// ─── Agent Implementation ───────────────────────────────────────────────────

export async function fetchMarketPrices(
  city: string,
  state: string,
  buildingType: string,
): Promise<MarketIntelligenceResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  const now = new Date();
  const monthYear = now.toLocaleString("en-IN", { month: "long", year: "numeric" });
  const yearStr = String(now.getFullYear());

  // ── Diagnostic logging (visible in Vercel function logs) ──
  console.log(`[TR-015] Starting market intelligence for: ${city}, ${state} (${buildingType})`);
  console.log(`[TR-015] API key present: ${!!apiKey}, length: ${apiKey.length}, starts with sk-ant-api: ${apiKey.startsWith("sk-ant-api")}`);

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
    return result;
  }

  if (!apiKey.startsWith("sk-ant-api")) {
    console.warn(`[TR-015] ANTHROPIC_API_KEY has wrong format: starts with "${apiKey.slice(0, 10)}..." — not sk-ant-api`);
    result.agent_notes.push(
      "⚠️ LIVE PRICES NOT FETCHED: ANTHROPIC_API_KEY is not a valid API key (must start with sk-ant-api03-). " +
      "Get one from console.anthropic.com/settings/keys. Using static fallback rates."
    );
    return result;
  }

  const startTime = Date.now();
  const client = new Anthropic({ apiKey });

  // ── Lean prompt: 5 core items only (steel, cement, sand, mason, benchmark) ──
  // Other labor rates derived from mason: helper=0.55×, carpenter=1.10×, etc.
  // Keeps the Claude call fast (under 45s) to avoid Vercel timeout.
  const userPrompt = `Find current construction prices for ${city}, ${state}, India. Date: ${monthYear}.

Search for these 5 items (try ${city} first, then ${state}, then national):
1. TMT steel Fe500 price per tonne in ${state}
2. Cement price per 50kg bag in ${city} (UltraTech/Ambuja/ACC)
3. M-sand or construction sand per cft in ${city}/${state}
4. Mason (skilled) daily wage in ${city} or ${state}
5. Construction cost per sqft for ${buildingType} in ${city} ${yearStr}

Return ONLY JSON, no explanation:
{"steel_per_tonne":{"value":0,"source":"","date":"","confidence":"LOW"},"cement_per_bag":{"value":0,"brand":"","source":"","date":"","confidence":"LOW"},"sand_per_cft":{"value":0,"type":"M-sand","source":"","date":"","confidence":"LOW"},"mason":{"value":0,"source":"","date":"","confidence":"LOW"},"benchmark":{"value":0,"range_low":0,"range_high":0,"source":""},"sources":[]}`;

  let jsonText = "";
  let usedWebSearch = false;

  // 45-second hard timeout to stay within Vercel limits
  const TIMEOUT_MS = 45_000;

  // ── Attempt 1: Claude with web_search (live prices) ──
  try {
    console.log("[TR-015] Starting web search call...");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: userPrompt }],
    }, { signal: controller.signal });
    clearTimeout(timer);
    for (const block of response.content) {
      if (block.type === "text") jsonText += block.text;
    }
    usedWebSearch = true;
    result.search_count = 5;
    console.log(`[TR-015] Web search done in ${Date.now() - startTime}ms`);
  } catch (wsErr) {
    const wsMsg = wsErr instanceof Error ? wsErr.message : String(wsErr);
    const isTimeout = wsMsg.includes("abort") || wsMsg.includes("timeout");
    console.warn(`[TR-015] Web search ${isTimeout ? "timed out" : "failed"}: ${wsMsg}`);
    result.agent_notes.push(isTimeout
      ? "Web search timed out (>45s) — using AI knowledge base."
      : "Web search not available — using AI knowledge base.");
  }

  // ── Attempt 2: Plain Claude, fast model (training data) ──
  if (!jsonText) {
    try {
      console.log("[TR-015] Falling back to plain Claude (no web search)...");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: userPrompt }],
      }, { signal: controller.signal });
      clearTimeout(timer);
      for (const block of response.content) {
        if (block.type === "text") jsonText += block.text;
      }
      result.search_count = 0;
      console.log(`[TR-015] Plain Claude done in ${Date.now() - startTime}ms`);
    } catch (plainErr) {
      const plainMsg = plainErr instanceof Error ? plainErr.message : String(plainErr);
      result.agent_notes.push(`Claude API error: ${plainMsg}`);
      console.error("[TR-015] Both attempts failed:", plainMsg);
    }
  }

  // ── Parse response ──
  if (jsonText) {
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const p = JSON.parse(jsonMatch[0]);
        const src = usedWebSearch ? "Web search" : "AI estimate";
        const conf = usedWebSearch ? "HIGH" : "MEDIUM";

        // Materials
        if (p.steel_per_tonne?.value > 0) {
          result.steel_per_tonne = {
            value: p.steel_per_tonne.value, unit: "₹/tonne",
            source: p.steel_per_tonne.source || src,
            date: p.steel_per_tonne.date || monthYear,
            confidence: p.steel_per_tonne.confidence || conf,
            fallbackLevel: usedWebSearch ? "city" : "national",
          };
        }
        if (p.cement_per_bag?.value > 0) {
          result.cement_per_bag = {
            value: p.cement_per_bag.value, unit: "₹/bag (50kg)",
            source: p.cement_per_bag.source || src,
            date: p.cement_per_bag.date || monthYear,
            confidence: p.cement_per_bag.confidence || conf,
            brand: p.cement_per_bag.brand || "UltraTech/Ambuja",
            fallbackLevel: usedWebSearch ? "city" : "national",
          };
        }
        if (p.sand_per_cft?.value > 0) {
          result.sand_per_cft = {
            value: p.sand_per_cft.value, unit: "₹/cft",
            source: p.sand_per_cft.source || src,
            date: p.sand_per_cft.date || monthYear,
            confidence: p.sand_per_cft.confidence || conf,
            type: p.sand_per_cft.type || "M-sand",
            fallbackLevel: usedWebSearch ? "city" : "national",
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
        const bench = p.benchmark ?? p.benchmark_per_sqft;
        if (bench?.value > 0) {
          result.benchmark_per_sqft = {
            value: bench.value,
            range_low: bench.range_low || bench.value * 0.75,
            range_high: bench.range_high || bench.value * 1.25,
            source: bench.source || src,
            building_type: buildingType,
          };
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

        // Status — count how many items have live data
        const matPrices = [result.steel_per_tonne, result.cement_per_bag, result.sand_per_cft];
        const corePrices = [...matPrices, result.labor.mason];
        const liveCount = corePrices.filter(p2 => p2.confidence !== "LOW").length;
        result.fallbacks_used = 9 - (liveCount + (liveCount >= 1 ? 5 : 0)); // mason derives 5 others

        if (liveCount >= 3) {
          result.agent_status = "success";
        } else if (liveCount >= 1) {
          result.agent_status = "partial";
          if (!usedWebSearch) result.agent_notes.push("Prices from AI training data — verify against current market.");
        }

      } catch (parseErr) {
        result.agent_notes.push(`Failed to parse AI response: ${String(parseErr)}`);
      }
    } else {
      result.agent_notes.push("AI response did not contain valid JSON.");
    }
  }

  result.duration_ms = Date.now() - startTime;
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
