/**
 * Market Intelligence Agent
 *
 * Uses Anthropic Claude API with web_search tool to fetch live construction
 * material prices for Indian projects. Returns structured JSON with prices,
 * sources, confidence levels, and fallback to static rates when unavailable.
 *
 * Searches: TMT steel, cement (brand-specific), sand, benchmark cost/sqft,
 * CPWD construction cost index.
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

export interface MarketIntelligenceResult {
  steel_per_tonne: MarketPrice;
  cement_per_bag: MarketPrice & { brand?: string };
  sand_per_cft: MarketPrice & { type?: string };
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

// ─── Static Fallback Rates (CPWD DSR 2024 + market averages) ───────────────

const STATIC_FALLBACKS = {
  steel_per_tonne: {
    value: 68000,
    unit: "₹/tonne",
    source: "CPWD DSR 2024 (static fallback)",
    date: "2024-01",
    confidence: "LOW" as const,
    fallbackLevel: "national" as const,
  },
  cement_per_bag: {
    value: 380,
    unit: "₹/bag (50kg)",
    source: "CPWD DSR 2024 (static fallback)",
    date: "2024-01",
    confidence: "LOW" as const,
    brand: "Generic OPC 53",
    fallbackLevel: "national" as const,
  },
  sand_per_cft: {
    value: 55,
    unit: "₹/cft",
    source: "CPWD DSR 2024 (static fallback)",
    date: "2024-01",
    confidence: "LOW" as const,
    type: "M-sand",
    fallbackLevel: "national" as const,
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

  // Default result with static fallbacks
  const result: MarketIntelligenceResult = {
    steel_per_tonne: { ...STATIC_FALLBACKS.steel_per_tonne },
    cement_per_bag: { ...STATIC_FALLBACKS.cement_per_bag },
    sand_per_cft: { ...STATIC_FALLBACKS.sand_per_cft },
    benchmark_per_sqft: {
      value: 2500, range_low: 1800, range_high: 4500,
      source: "Estimated (no live data)", building_type: buildingType,
    },
    cpwd_index: { factor: 1.0, source: "Baseline (no live data)", year: now.getFullYear() },
    sources_summary: [],
    fetched_at: now.toISOString(),
    city,
    state,
    agent_status: "fallback",
    agent_notes: [],
    search_count: 0,
    duration_ms: 0,
    fallbacks_used: 3, // all 3 use static fallback by default
  };

  if (!apiKey) {
    result.agent_notes.push("ANTHROPIC_API_KEY not configured — using static fallback rates.");
    return result;
  }

  const startTime = Date.now();

  try {
    // Support both API keys (sk-ant-api03-...) and OAuth tokens (sk-ant-oat01-...)
    const isOAuth = apiKey.startsWith("sk-ant-oat");
    const client = isOAuth
      ? new Anthropic({ authToken: apiKey })
      : new Anthropic({ apiKey });

    const systemPrompt = `You are a construction market price research agent for India. Your job is to find current, accurate construction material prices.

IMPORTANT RULES:
1. Search for REAL prices with sources. Do NOT make up numbers.
2. If you cannot find a specific city price, try state level, then national.
3. Always include the source URL or name.
4. Prices must be in INR (Indian Rupees).
5. Return ONLY valid JSON — no markdown, no explanation before or after.

Return this exact JSON structure:
{
  "steel_per_tonne": { "value": <number>, "source": "<source name or URL>", "date": "<when this price is from>", "confidence": "HIGH|MEDIUM|LOW" },
  "cement_per_bag": { "value": <number>, "brand": "<brand name>", "source": "<source>", "date": "<date>", "confidence": "HIGH|MEDIUM|LOW" },
  "sand_per_cft": { "value": <number>, "type": "M-sand|River sand|Crushed", "source": "<source>", "date": "<date>", "confidence": "HIGH|MEDIUM|LOW" },
  "benchmark_per_sqft": { "value": <number>, "range_low": <number>, "range_high": <number>, "source": "<source>", "building_type": "${buildingType}" },
  "cpwd_index": { "factor": <number>, "source": "<source>", "year": ${yearStr} },
  "sources": ["<url1>", "<url2>", ...]
}`;

    const userPrompt = `Find current construction material prices for ${city}, ${state}, India.
Date: ${monthYear}
Building type: ${buildingType}

Search for:
1. TMT steel Fe500 price per tonne in ${state} (${monthYear})
2. UltraTech or Ambuja cement price per 50kg bag in ${city} (current)
3. M-sand or construction sand price per cft in ${city}/${state}
4. Construction cost per sqft for ${buildingType} in ${city} (${yearStr})
5. CPWD construction cost index for ${yearStr}

For each, find the most recent price with a verifiable source.`;

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 8,
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract the text response (the agent may have used web_search internally)
    let jsonText = "";
    for (const block of response.content) {
      if (block.type === "text") {
        jsonText += block.text;
      }
    }

    // Parse the JSON from the response
    // The response may contain markdown code fences
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);

        // Steel
        if (parsed.steel_per_tonne?.value > 0) {
          result.steel_per_tonne = {
            value: parsed.steel_per_tonne.value,
            unit: "₹/tonne",
            source: parsed.steel_per_tonne.source || "Web search",
            sourceUrl: parsed.steel_per_tonne.source_url,
            date: parsed.steel_per_tonne.date || monthYear,
            confidence: parsed.steel_per_tonne.confidence || "MEDIUM",
            fallbackLevel: "city",
          };
        }

        // Cement
        if (parsed.cement_per_bag?.value > 0) {
          result.cement_per_bag = {
            value: parsed.cement_per_bag.value,
            unit: "₹/bag (50kg)",
            source: parsed.cement_per_bag.source || "Web search",
            sourceUrl: parsed.cement_per_bag.source_url,
            date: parsed.cement_per_bag.date || monthYear,
            confidence: parsed.cement_per_bag.confidence || "MEDIUM",
            brand: parsed.cement_per_bag.brand || "UltraTech/Ambuja",
            fallbackLevel: "city",
          };
        }

        // Sand
        if (parsed.sand_per_cft?.value > 0) {
          result.sand_per_cft = {
            value: parsed.sand_per_cft.value,
            unit: "₹/cft",
            source: parsed.sand_per_cft.source || "Web search",
            sourceUrl: parsed.sand_per_cft.source_url,
            date: parsed.sand_per_cft.date || monthYear,
            confidence: parsed.sand_per_cft.confidence || "MEDIUM",
            type: parsed.sand_per_cft.type || "M-sand",
            fallbackLevel: "city",
          };
        }

        // Benchmark
        if (parsed.benchmark_per_sqft?.value > 0) {
          result.benchmark_per_sqft = {
            value: parsed.benchmark_per_sqft.value,
            range_low: parsed.benchmark_per_sqft.range_low || parsed.benchmark_per_sqft.value * 0.75,
            range_high: parsed.benchmark_per_sqft.range_high || parsed.benchmark_per_sqft.value * 1.25,
            source: parsed.benchmark_per_sqft.source || "Web search",
            building_type: buildingType,
          };
        }

        // CPWD Index
        if (parsed.cpwd_index?.factor > 0) {
          result.cpwd_index = {
            factor: parsed.cpwd_index.factor,
            source: parsed.cpwd_index.source || "CPWD",
            year: parsed.cpwd_index.year || now.getFullYear(),
          };
        }

        // Sources
        if (Array.isArray(parsed.sources)) {
          result.sources_summary = parsed.sources.filter((s: unknown) => typeof s === "string");
        }

        // Determine overall status and count fallbacks
        const hasSteel = result.steel_per_tonne.confidence !== "LOW";
        const hasCement = result.cement_per_bag.confidence !== "LOW";
        const hasSand = result.sand_per_cft.confidence !== "LOW";
        result.fallbacks_used = [hasSteel, hasCement, hasSand].filter(x => !x).length;
        result.search_count = 7; // We asked for 7 searches

        if (hasSteel && hasCement && hasSand) {
          result.agent_status = "success";
        } else if (hasSteel || hasCement || hasSand) {
          result.agent_status = "partial";
          result.agent_notes.push("Some prices fetched from live sources, others using static fallback.");
        }

      } catch (parseErr) {
        result.agent_notes.push(`Failed to parse agent response: ${String(parseErr)}`);
      }
    } else {
      result.agent_notes.push("Agent response did not contain valid JSON — using static fallbacks.");
    }

  } catch (err) {
    // Anthropic SDK APIError has: .status, .message (pre-formatted), .error (raw JSON body)
    const msg = err instanceof Error ? err.message : String(err);
    result.agent_notes.push(`Market intelligence agent error: ${msg}`);
    console.error("[Market Intelligence] Agent error:", msg);
    // Log full error body for debugging
    try { console.error("[Market Intelligence] Error body:", JSON.stringify((err as { error?: unknown }).error ?? err)); } catch { /* skip */ }
    // Graceful degradation — result already has static fallbacks
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Apply market intelligence prices to adjust BOQ steel and cement rates.
 * Returns adjustment factors relative to CPWD DSR base rates.
 */
export function computeMarketAdjustments(
  marketData: MarketIntelligenceResult
): {
  steelAdjustment: number; // multiplier on CPWD steel rate
  cementAdjustment: number; // multiplier on CPWD cement rate
  sandAdjustment: number; // multiplier on CPWD sand rate
  overallConfidence: "HIGH" | "MEDIUM" | "LOW";
  priceNotes: string[];
} {
  const notes: string[] = [];

  // CPWD DSR 2024 base: steel ₹68,000/tonne, cement ₹380/bag, sand ₹55/cft
  const cpwdSteel = 68000;
  const cpwdCement = 380;
  const cpwdSand = 55;

  const steelAdj = marketData.steel_per_tonne.value / cpwdSteel;
  const cementAdj = marketData.cement_per_bag.value / cpwdCement;
  const sandAdj = marketData.sand_per_cft.value / cpwdSand;

  if (marketData.steel_per_tonne.confidence !== "LOW") {
    notes.push(`Steel: ₹${marketData.steel_per_tonne.value.toLocaleString()}/tonne (${marketData.steel_per_tonne.source}, ${marketData.steel_per_tonne.date}) — ${marketData.steel_per_tonne.confidence} confidence`);
  }
  if (marketData.cement_per_bag.confidence !== "LOW") {
    notes.push(`Cement: ${marketData.cement_per_bag.brand} ₹${marketData.cement_per_bag.value}/bag (${marketData.cement_per_bag.source}, ${marketData.cement_per_bag.date}) — ${marketData.cement_per_bag.confidence} confidence`);
  }
  if (marketData.sand_per_cft.confidence !== "LOW") {
    notes.push(`Sand: ${marketData.sand_per_cft.type} ₹${marketData.sand_per_cft.value}/cft (${marketData.sand_per_cft.source}, ${marketData.sand_per_cft.date}) — ${marketData.sand_per_cft.confidence} confidence`);
  }

  // Overall confidence based on how many prices were fetched live
  const highCount = [marketData.steel_per_tonne, marketData.cement_per_bag, marketData.sand_per_cft]
    .filter(p => p.confidence === "HIGH").length;
  const medCount = [marketData.steel_per_tonne, marketData.cement_per_bag, marketData.sand_per_cft]
    .filter(p => p.confidence === "MEDIUM").length;
  const overallConfidence = highCount >= 2 ? "HIGH" : (highCount + medCount) >= 2 ? "MEDIUM" : "LOW";

  return {
    steelAdjustment: Math.round(steelAdj * 1000) / 1000,
    cementAdjustment: Math.round(cementAdj * 1000) / 1000,
    sandAdjustment: Math.round(sandAdj * 1000) / 1000,
    overallConfidence,
    priceNotes: notes,
  };
}
