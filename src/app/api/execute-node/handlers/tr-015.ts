import { generateId } from "./deps";
import type { NodeHandler } from "./types";
import {
  createDiagnostics,
  finalizeDiagnostics,
  addLog,
} from "@/features/boq/services/pipeline-diagnostics";

/**
 * TR-015 — Market Intelligence Agent (live construction material prices via Claude web search)
 * Pure copy from execute-node/route.ts (lines 2849-2987 of the pre-decomposition file).
 */
export const handleTR015: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // Market Intelligence Agent — live construction material prices via web search
  const { fetchMarketPrices, computeMarketAdjustments } = await import("@/features/boq/services/market-intelligence");

  // Extract location from all possible input paths
  let miCity = "";
  let miState = "";
  let miBuildingType = "commercial";

  // Log raw input for debugging

  // Path 1: Direct fields (from IN-006 JSON parse)
  if (inputData?.city) miCity = String(inputData.city);
  if (inputData?.state) miState = String(inputData.state);
  if (inputData?.country && !miState) miState = String(inputData.country);

  // Path 2: JSON string in content/prompt/location/inputValue fields
  if (!miCity) {
    for (const field of [inputData?.content, inputData?.prompt, inputData?.location, inputData?.inputValue]) {
      if (typeof field === "string" && field.includes("{")) {
        try {
          const loc = JSON.parse(field);
          if (loc.city) miCity = loc.city;
          if (loc.state) miState = loc.state;
          if (loc.buildingType) miBuildingType = loc.buildingType;
          break;
        } catch { /* not JSON */ }
      } else if (typeof field === "string" && field.length > 2 && !field.startsWith("{")) {
        const parts = field.split(",").map(s => s.trim());
        if (parts.length >= 2) { miCity = parts[0]; miState = parts[1]; }
        else if (parts[0]) { miCity = parts[0]; }
      }
    }
  }

  if (inputData?.buildingType) miBuildingType = String(inputData.buildingType);

  // If still no city found — warn loudly
  if (!miCity && !miState) {
    console.error("[TR-015] No location data found in input — cannot fetch market prices");
    miCity = "Delhi"; miState = "Delhi NCR"; // national default
  }

  // Include IFC context in building type for smarter pricing
  const ifcCtx = inputData?._ifcContext as Record<string, unknown> | undefined;
  let buildingDesc = miBuildingType;
  if (ifcCtx) {
    buildingDesc = `${miBuildingType} (${ifcCtx.totalFloors ?? "?"} floors, ${ifcCtx.totalGFA ?? "?"}m² GFA, ${ifcCtx.dominantStructure ?? "RCC"}, ~${ifcCtx.estimatedHeight ?? "?"}m height)`;
  }

  const marketDiag = createDiagnostics(executionId ?? "local");
  addLog(marketDiag, "tr-015-market", "info", `TR-015 dispatched for ${miCity}, ${miState}`, { buildingDesc });
  const marketData = await fetchMarketPrices(miCity, miState, buildingDesc, marketDiag);
  const adjustments = computeMarketAdjustments(marketData);
  const durationSec = (marketData.duration_ms / 1000).toFixed(1);
  finalizeDiagnostics(marketDiag);

  // Build a transparent, formatted table output
  const miHeaders = ["Material", "Price", "Source", "Date", "Confidence"];
  const miRows: string[][] = [
    [
      "TMT Steel Fe500",
      `₹${marketData.steel_per_tonne.value.toLocaleString()}/tonne`,
      marketData.steel_per_tonne.source,
      marketData.steel_per_tonne.date,
      marketData.steel_per_tonne.confidence,
    ],
    [
      `Cement (${marketData.cement_per_bag.brand || "OPC 53"})`,
      `₹${marketData.cement_per_bag.value}/bag (50kg)`,
      marketData.cement_per_bag.source,
      marketData.cement_per_bag.date,
      marketData.cement_per_bag.confidence,
    ],
    [
      `Sand (${marketData.sand_per_cft.type || "M-sand"})`,
      `₹${marketData.sand_per_cft.value}/cft`,
      marketData.sand_per_cft.source,
      marketData.sand_per_cft.date,
      marketData.sand_per_cft.confidence,
    ],
    [
      `Benchmark — ${miBuildingType}`,
      `₹${marketData.benchmark_per_sqft.range_low.toLocaleString()}-${marketData.benchmark_per_sqft.range_high.toLocaleString()}/m²`,
      marketData.benchmark_per_sqft.source,
      new Date().toISOString().split("T")[0],
      marketData.benchmark_per_sqft.value > 0 ? "MEDIUM" : "LOW",
    ],
    // Labor rates
    ["── LABOR ──", "", "", "", ""],
    ["Mason (skilled)", `₹${marketData.labor.mason.value}/day`, marketData.labor.mason.source, marketData.labor.mason.date, marketData.labor.mason.confidence],
    ["Helper (unskilled)", `₹${marketData.labor.helper.value}/day`, marketData.labor.helper.source, marketData.labor.helper.date, marketData.labor.helper.confidence],
    ["Carpenter", `₹${marketData.labor.carpenter.value}/day`, marketData.labor.carpenter.source, marketData.labor.carpenter.date, marketData.labor.carpenter.confidence],
    ["Electrician", `₹${marketData.labor.electrician.value}/day`, marketData.labor.electrician.source, marketData.labor.electrician.date, marketData.labor.electrician.confidence],
    ["Plumber", `₹${marketData.labor.plumber.value}/day`, marketData.labor.plumber.source, marketData.labor.plumber.date, marketData.labor.plumber.confidence],
  ];

  // Build clean card-style report
  const isCached = marketData.duration_ms === 0;
  const icon = isCached ? "💾" : "✨";
  const statusLine = isCached
    ? `From cache · fetched today · Prices refresh daily`
    : `Just fetched · ${durationSec}s · Claude AI`;

  const reportLines = [
    `${icon} Market Intelligence`,
    `${miCity}, ${miState} · ${new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`,
    `────────────────────────────────`,
    `🔩 Steel      ₹${marketData.steel_per_tonne.value.toLocaleString()}/tonne    ${marketData.steel_per_tonne.confidence}`,
    `🏗️ Cement     ${marketData.cement_per_bag.brand} ₹${marketData.cement_per_bag.value}/bag    ${marketData.cement_per_bag.confidence}`,
    `👷 Mason      ₹${marketData.labor.mason.value.toLocaleString()}/day     ${marketData.labor.mason.confidence}`,
    `🏜️ Sand       ₹${marketData.sand_per_cft.value}/cft     ${marketData.sand_per_cft.confidence}`,
    `────────────────────────────────`,
    `📊 Benchmark  ₹${marketData.benchmark_per_sqft.range_low.toLocaleString()}-${marketData.benchmark_per_sqft.range_high.toLocaleString()}/m² (${miBuildingType})`,
    `────────────────────────────────`,
    statusLine,
    `Accuracy ±15-25% · Verify with local suppliers`,
  ];

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "table",
    data: {
      label: `${icon} Market Intelligence — ${miCity}, ${miState}`,
      headers: miHeaders,
      rows: miRows,
      content: reportLines.join("\n"),
      _marketData: marketData,
      _adjustments: adjustments,
      _marketDiagnostics: marketDiag,
    },
    metadata: {
      model: "claude-web-search-agent",
      real: true,
      agent_status: marketData.agent_status,
      search_count: marketData.search_count,
      duration_ms: marketData.duration_ms,
      fallbacks_used: marketData.fallbacks_used,
    },
    createdAt: new Date(),
  };
};
