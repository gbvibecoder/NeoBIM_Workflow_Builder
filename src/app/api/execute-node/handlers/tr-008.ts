import {
  generateId,
  calculateTotalCost,
  calculateEscalation,
  detectProjectType,
  buildDynamicDisclaimer,
  getCostBreakdown,
  detectRegionFromText,
} from "./deps";
import {
  escalateValue,
  getStalenessLevel,
  IS1200_BASELINE,
  MEP_BASELINE,
  BENCHMARK_BASELINE,
  MARKET_FALLBACK_BASELINE,
  getCurvesForSubcategory,
  getEscalationFactor,
} from "@/features/boq/lib/dated-rate";
import type { NodeHandler } from "./types";
import {
  createDiagnostics,
  addLog,
  finalizeDiagnostics,
  mergeParserDiagnostics,
  mergeMarketDiagnostics,
  buildExecutionLogSummary,
  type PipelineDiagnostics,
} from "@/features/boq/services/pipeline-diagnostics";

/**
 * TR-008 — BOQ Cost Mapper (Professional QS-grade)
 * Pure copy from execute-node/route.ts (lines 1748-2847 of the pre-decomposition file).
 *
 * The largest handler in the codebase (~1100 LOC). Logic preserved verbatim:
 *   • Indian (IS 1200 / CPWD) and international (USD/USD baseline) pricing paths
 *   • Market intelligence integration via TR-015 upstream output
 *   • Derived quantity computation (formwork, rebar, finishing)
 *   • Provisional sums for MEP / foundation / external works
 *   • Storey grouping
 *   • AACE class assignment
 *   • Dynamic disclaimer
 *   • Anomaly detection
 *   • BoQAnalytics persistence (fire-and-forget)
 *
 * NO LOGIC CHANGES — pre-existing unused-let warnings on this block stay.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handleTR008: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // BOQ Cost Mapper — Professional QS-grade with waste, M/L/E breakdown, escalation, project type

  // ── Unified pipeline diagnostics — merges upstream parser + market traces ──
  const diag: PipelineDiagnostics = createDiagnostics(executionId ?? "local");
  mergeParserDiagnostics(diag, inputData?._parserDiagnostics as Partial<PipelineDiagnostics> | undefined);
  mergeMarketDiagnostics(diag, inputData?._marketDiagnostics as Partial<PipelineDiagnostics> | undefined);
  addLog(diag, "tr-008-cost", "info", "TR-008 dispatched", {
    hasParserDiagnostics: !!inputData?._parserDiagnostics,
    hasMarketDiagnostics: !!inputData?._marketDiagnostics,
    hasMarketData: !!inputData?._marketData,
    elementCount: Array.isArray(inputData?._elements) ? inputData._elements.length : 0,
  });

  // FIX 11: Indian number formatting (Cr/L) for QS summary
  const formatINR = (value: number): string => {
    if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
    if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
    return `₹${Math.round(value).toLocaleString("en-IN")}`;
  };

  // Normalize storey names in ALL element descriptions received from upstream
  // Belt-and-suspenders: catches "Grond" even if TR-007 path missed it
  const fixStoreyInDesc = (s: string): string => s.replace(/\bGrond\b/gi, "Ground").replace(/\bGroung\b/gi, "Ground");
  if (inputData?._elements && Array.isArray(inputData._elements)) {
    for (const el of inputData._elements) {
      if (typeof el === "object" && el !== null) {
        const elem = el as Record<string, unknown>;
        if (typeof elem.description === "string") elem.description = fixStoreyInDesc(elem.description);
        if (typeof elem.storey === "string") elem.storey = fixStoreyInDesc(elem.storey);
      }
    }
  }

  // Diagnostic: what keys does TR-008 actually receive from upstream merge?
  const inputKeys = Object.keys(inputData ?? {});
  // If _marketData is missing, check if market data is nested under a different key
  if (!inputData?._marketData) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const mKeys = inputKeys.filter(k => k.toLowerCase().includes("market") || k.toLowerCase().includes("price") || k.toLowerCase().includes("steel"));
  }
  // ── Steel market rate — derived from TR-015 market data (safe scoping: all let at top) ──
  // Market TMT price is MATERIAL ONLY. Labor for cutting/bending/placing is added on top.
  // IS 1200 reference: material ₹68 + labour ₹20 = ₹88/kg total.
  // Market: material ₹62 + labour ₹20 = ₹82/kg total.
  let marketSteelMaterialPerKg: number | null = null;  // Material-only price ₹/kg
  const marketSteelLabourPerKg = 20;                    // IS 1200 labour rate for rebar (constant)
  let marketTMTPerKg: number | null = null;             // Total rate ₹/kg (material + labour)
  let marketStructSteelPerKg: number | null = null;     // Structural steel total ₹/kg (TMT × 1.55)
  let steelFromMarket = false;
  try {
    const earlyMarket = inputData?._marketData as Record<string, unknown> | undefined;
    const steelVal = earlyMarket?.steel_per_tonne as { value?: number } | number | undefined;
    let steelPerTonne = 0;
    if (typeof steelVal === "number") {
      steelPerTonne = steelVal;
    } else if (typeof steelVal === "object" && steelVal !== null && typeof steelVal.value === "number") {
      steelPerTonne = steelVal.value;
    }
    if (steelPerTonne > 10000) { // sanity: must be > ₹10,000/tonne
      marketSteelMaterialPerKg = Math.round(steelPerTonne / 1000 * 100) / 100; // ₹/tonne → ₹/kg (material only)
      marketTMTPerKg = Math.round((marketSteelMaterialPerKg + marketSteelLabourPerKg) * 100) / 100; // total: mat + lab
      marketStructSteelPerKg = Math.round(marketSteelMaterialPerKg * 1.55 + 40) / 1; // structural: higher mat + fab labour ₹40
      steelFromMarket = true;
    }
  } catch (steelErr) {
    console.warn("[TR-008] Could not extract steel rate from market data:", steelErr);
    // steelFromMarket stays false — will try fallback chain below
  }

  // ── Price Fallback Chain (Priorities 3-6) ──
  // When TR-015 live data (Priority 1) and Redis cache (Priority 2) are both missing,
  // query the MaterialPriceCache in Postgres before falling back to static rates.
  // This enables cross-user learning: prices fetched by ANY user for a city
  // benefit ALL subsequent BOQs for that city.
  let fallbackChainUsed = false;
  const fallbackSources: string[] = [];
  if (!steelFromMarket) {
    try {
      // Extract location for fallback lookup
      let fbCity = "";
      let fbState = "";
      let fbCityTier: string | undefined;
      for (const field of [inputData?.content, inputData?.prompt, inputData?.region, inputData?.location]) {
        if (typeof field === "string" && field.startsWith("{")) {
          try {
            const loc = JSON.parse(field);
            fbCity = loc.city || "";
            fbState = loc.state || "";
            break;
          } catch { /* not JSON */ }
        }
      }
      if (fbCity && fbState) {
        const { resolvePriceFallback } = await import("@/features/boq/services/price-fallback-chain");
        const steelFallback = await resolvePriceFallback("steel_per_tonne", fbCity, fbState, fbCityTier);

        if (steelFallback.price > 10000 && steelFallback.priorityLevel <= 5) {
          // Use fallback chain steel price — better than static CPWD
          marketSteelMaterialPerKg = Math.round(steelFallback.price / 1000 * 100) / 100;
          marketTMTPerKg = Math.round((marketSteelMaterialPerKg + marketSteelLabourPerKg) * 100) / 100;
          marketStructSteelPerKg = Math.round(marketSteelMaterialPerKg * 1.55 + 40);
          steelFromMarket = true;
          fallbackChainUsed = true;
          fallbackSources.push(`Steel: ${steelFallback.sourceDescription} (Priority ${steelFallback.priorityLevel})`);
        }
      }
    } catch {
      // Non-fatal — fallback chain is best-effort, static IS 1200 rates still work
    }
  }

  const elements = inputData?._elements ?? inputData?.elements ?? inputData?.rows ?? [];
  // Include IFC filename in building type detection — "Wellness center Sama.ifc" → wellness type
  const buildingDescription = [
    inputData?.buildingDescription,
    inputData?.content,
    inputData?.prompt,
    inputData?.fileName, // IFC filename often contains building type keywords
    inputData?.label,
  ].filter(v => typeof v === "string" && v.length > 0).join(" ") || "commercial";
  let escalationMonths = Number(inputData?.escalationMonths ?? 6);
  let escalationRate = 0.06;
  let contingencyPct = 0.10;

  // ── Project date: user-provided construction start date, or today + 6 months ──
  const projectDate: Date = inputData?._projectDate
    ? new Date(inputData._projectDate as string)
    : new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000); // default: ~6 months from now

  // ── Location-aware pricing (from IN-006 Location Input or text detection) ──
  // IN-006 stores JSON in inputData.content/prompt: { country, state, city, currency }
  let locationData: { country?: string; state?: string; city?: string; currency?: string; escalation?: string; contingency?: string; months?: string; soilType?: string; plotArea?: string } | null = null;
  for (const field of [inputData?.content, inputData?.prompt, inputData?.region, inputData?.location]) {
    if (typeof field === "string" && field.startsWith("{")) {
      try { locationData = JSON.parse(field); break; } catch { /* not JSON */ }
    }
  }

  // Import regional factors
  const { resolveProjectLocation } = await import("@/features/boq/constants/regional-factors");

  // Default to India — 95%+ of BuildFlow traffic is Indian AEC.
  // Non-Indian projects override via the Location node (IN-006) below.
  let activeRegion = "INDIA · BASELINE";
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let regionWasAutoDetected = true;
  let locationFactor = 1.0;
  let currencySymbol = "₹";
  let currencyCode = "INR";
  let exchangeRate = 1.0;
  let locationLabel = "";

  if (locationData?.country) {
    // Structured location from IN-006
    const loc = resolveProjectLocation(
      locationData.country,
      locationData.state || "",
      locationData.city || "",
      locationData.currency
    );
    activeRegion = `${loc.city || loc.state || loc.country} (${loc.country})`;
    locationFactor = loc.combinedFactor;
    currencySymbol = loc.currencySymbol;
    currencyCode = loc.currency;
    exchangeRate = loc.exchangeRate;
    regionWasAutoDetected = false;
    locationLabel = `${loc.city ? loc.city + ", " : ""}${loc.state ? loc.state + ", " : ""}${loc.country}`;
    // Read user-configurable escalation/contingency/months from location data
    if (locationData.escalation != null) escalationRate = Number(locationData.escalation) / 100;
    if (locationData.contingency != null) contingencyPct = Number(locationData.contingency) / 100;
    if (locationData.months != null) escalationMonths = Number(locationData.months);
  } else {
    // Fall back to text-based region detection
    const regionInput = inputData?.region ?? inputData?.location ?? "INDIA · BASELINE";
    const upstreamNarrative = inputData?.content ?? inputData?.narrative ?? "";
    const explicitRegion = regionInput !== "INDIA · BASELINE" ? regionInput : "";
    const detectedRegion = detectRegionFromText(
      typeof explicitRegion === "string" && explicitRegion
        ? explicitRegion
        : (typeof upstreamNarrative === "string" ? upstreamNarrative : "")
    );
    activeRegion = (typeof detectedRegion === "string" && detectedRegion) || (typeof regionInput === "string" ? regionInput : "INDIA · BASELINE");
    regionWasAutoDetected = !detectedRegion && regionInput === "INDIA · BASELINE";
  }

  // Detect project type from description
  const projectTypeInfo = detectProjectType(typeof buildingDescription === "string" ? buildingDescription : "commercial");

  // Enhanced headers with waste and M/L/E
  const headers = ["Description", "Unit", "Qty", "Waste %", "Adj Qty", "Rate", "Material", "Labor", "Equipment", "Total"];
  const rows: string[][] = [];
  let hardCostSubtotal = 0;
  let totalMaterial = 0;
  let totalLabor = 0;
  let totalEquipment = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let estimatedItemsCount = 0;

  // Build structured BOQ lines for EX-002
  const boqLines: Array<{
    division: string; csiCode: string; description: string; unit: string;
    quantity: number; wasteFactor: number; adjustedQty: number;
    materialRate: number; laborRate: number; equipmentRate: number; unitRate: number;
    materialCost: number; laborCost: number; equipmentCost: number; totalCost: number;
    storey?: string; elementCount?: number;
    is1200Code?: string; // IS 1200 code for Indian projects
  }> = [];

  // ── IS 1200 Indian Standard: Use native CPWD rates for Indian projects ──
  const isIndianProject = locationData?.country?.toLowerCase() === "india"
    || currencyCode === "INR"
    || locationLabel.toLowerCase().includes("india");
  let is1200Module: typeof import("@/features/boq/constants/is1200-rates") | null = null;
  let indianPricing: Awaited<ReturnType<typeof import("@/features/boq/constants/indian-pricing-factors").calculateIndianPricingAdjustment>> | null = null;
  if (isIndianProject) {
    is1200Module = await import("@/features/boq/constants/is1200-rates");
    const { calculateIndianPricingAdjustment } = await import("@/features/boq/constants/indian-pricing-factors");
    const currentMonth = new Date().getMonth() + 1;
    indianPricing = calculateIndianPricingAdjustment(
      locationData?.state || "",
      locationData?.city || "",
      currentMonth
    );

    // Override with dynamic state factor from market intelligence (Claude AI) when available
    // This makes the system accurate in 2026, 2030, 2038+ without code changes
    const dynamicPWD = (inputData?._marketData as Record<string, unknown>)?.state_pwd_factor as number | undefined;
    if (typeof dynamicPWD === "number" && dynamicPWD >= 0.5 && dynamicPWD <= 2.0) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const staticOverall = indianPricing.overall;
      // Replace the overall factor with Claude's dynamic value × city tier
      const cityMult = indianPricing.cityTier === "metro" ? 1.10 : indianPricing.cityTier === "tier-2" ? 0.98 : indianPricing.cityTier === "tier-3" ? 0.92 : 1.0;
      indianPricing.overall = Math.round(dynamicPWD * cityMult * 1000) / 1000;
      indianPricing.concrete = Math.round(dynamicPWD * cityMult * 1000) / 1000;
      indianPricing.steel = Math.round(dynamicPWD * cityMult * 1000) / 1000;
      indianPricing.masonry = Math.round(dynamicPWD * cityMult * 1000) / 1000;
      indianPricing.finishing = Math.round(dynamicPWD * cityMult * 1000) / 1000;
      indianPricing.labor = Math.round(dynamicPWD * cityMult * 1000) / 1000;
    } else {
    }
  }

  // ── Escalation factor cache (per-subcategory, computed once per BOQ run) ──
  // Escalates all rates from their CPWD DSR 2025-26 baseline to the project date.
  // Cache avoids recomputing pow() for every line item.
  const escalationCache = new Map<string, { total: number; material: number; labour: number }>();
  function getEscalation(subcategory: string): { total: number; material: number; labour: number } {
    let cached = escalationCache.get(subcategory);
    if (!cached) {
      const curves = getCurvesForSubcategory(subcategory);
      cached = {
        total: getEscalationFactor(curves.total, IS1200_BASELINE, projectDate),
        material: getEscalationFactor(curves.material, IS1200_BASELINE, projectDate),
        labour: getEscalationFactor(curves.labour, IS1200_BASELINE, projectDate),
      };
      escalationCache.set(subcategory, cached);
    }
    return cached;
  }

  // ── Auto-fire TR-015 (Market Intelligence) if not provided upstream ──
  // Phase C: live market data is primary, escalated static is secondary.
  let marketDataConfidence: "live" | "cached" | "escalated" | "static" = "static";
  let marketDataSource: "ai-search" | "redis" | "postgres" | "fallback" = "fallback";
  let marketDataAgeDays = 0;
  let marketDataStrikes = 0;

  if (!inputData._marketData && isIndianProject) {
    const miCity = locationData?.city ?? "";
    const miState = locationData?.state ?? "";
    try {
      const { getStrikeCount, isBlocked: isStrikeBlocked, recordStrike, clearStrikes } = await import("@/features/boq/services/market-intelligence-strike");
      marketDataStrikes = await getStrikeCount(ctx.userId, miCity);

      if (!isStrikeBlocked(marketDataStrikes)) {
        const { fetchMarketPrices } = await import("@/features/boq/services/market-intelligence");
        const marketResult = await fetchMarketPrices(miCity || "national-baseline", miState, buildingDescription, diag);
        inputData._marketData = marketResult;

        if (marketResult.agent_status === "success" && marketResult.search_count > 0) {
          marketDataConfidence = "live";
          marketDataSource = "ai-search";
          await clearStrikes(ctx.userId, miCity);
        } else if (marketResult.agent_status === "success" && marketResult.search_count === 0) {
          marketDataConfidence = "cached";
          marketDataSource = "redis";
        } else if (marketResult.agent_status === "partial") {
          marketDataConfidence = "cached";
          marketDataSource = "postgres";
        } else {
          marketDataConfidence = "static";
          marketDataSource = "fallback";
          const strike = await recordStrike(ctx.userId, miCity);
          marketDataStrikes = strike.count;
        }

        if (marketResult.fetched_at) {
          marketDataAgeDays = Math.round((Date.now() - new Date(marketResult.fetched_at).getTime()) / 86400000);
        }

        addLog(diag, "tr-008-cost", "info", `Auto-fired TR-015: ${marketDataConfidence} (${marketDataSource}, ${marketDataAgeDays}d old, strikes: ${marketDataStrikes})`, {});
      } else {
        addLog(diag, "tr-008-cost", "warn", `TR-015 blocked: ${marketDataStrikes} strikes in last hour — using static rates`, {});
      }
    } catch (autoFireErr) {
      addLog(diag, "tr-008-cost", "error", `Auto-fire failed: ${autoFireErr instanceof Error ? autoFireErr.message : String(autoFireErr)}`, {});
      try {
        const { recordStrike } = await import("@/features/boq/services/market-intelligence-strike");
        const strike = await recordStrike(ctx.userId, locationData?.city ?? "");
        marketDataStrikes = strike.count;
      } catch { /* non-fatal */ }
    }
  } else if (inputData._marketData) {
    marketDataConfidence = "live";
    marketDataSource = "ai-search";
    addLog(diag, "tr-008-cost", "info", "Market data provided by upstream TR-015 node", {});
  }

  // Expand elements with material layers into separate line items per layer
  const expandedElements: typeof elements = [];
  for (const elem of elements) {
    const layers = typeof elem === "object" ? (elem as Record<string, unknown>).materialLayers as Array<{name: string; thickness: number}> | undefined : undefined;
    if (layers && layers.length > 1 && typeof elem === "object") {
      const baseArea = Number((elem as Record<string, unknown>).grossArea ?? (elem as Record<string, unknown>).quantity ?? 0);
      for (const layer of layers) {
        expandedElements.push({
          ...elem,
          description: `${layer.name} (${Math.round(layer.thickness * 1000)}mm)`,
          quantity: baseArea, // area same for all layers
          unit: "m²",
          grossArea: baseArea,
          totalVolume: baseArea * layer.thickness,
          materialLayers: undefined, // don't re-expand
        });
      }
    } else {
      expandedElements.push(elem);
    }
  }

  // ── DIAGNOSTIC: Track which path each element takes ──
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let pathIS1200 = 0, pathUSD = 0, pathFallback = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let costIS1200 = 0, costUSD = 0, costFallback = 0;

  // ── Grade-aware rebar estimation lookup (used in both IS1200 loop and derived quantities) ──
  const GRADE_REBAR_KG: Record<string, number> = {
    M15: 60, M20: 80, M25: 100, M30: 130, M35: 150, M40: 160, M45: 170, M50: 180, M55: 185, M60: 190,
    C20: 80, C25: 100, "C25/30": 100, C30: 130, "C30/37": 130, C35: 150, "C35/45": 150, C40: 160,
    "Grade 20": 80, "Grade 25": 100, "Grade 30": 130, "Grade 35": 150, "Grade 40": 160,
  };
  const TYPE_REBAR_KG: Record<string, { wall: number; slab: number; column: number; beam: number }> = {
    residential:  { wall: 90,  slab: 90,  column: 140, beam: 120 },
    commercial:   { wall: 110, slab: 110, column: 160, beam: 140 },
    hospital:     { wall: 130, slab: 130, column: 175, beam: 155 },
    healthcare:   { wall: 130, slab: 130, column: 175, beam: 155 },
    industrial:   { wall: 85,  slab: 85,  column: 130, beam: 110 },
    warehouse:    { wall: 70,  slab: 70,  column: 110, beam: 100 },
    institutional:{ wall: 120, slab: 120, column: 165, beam: 145 },
    wellness:     { wall: 110, slab: 110, column: 155, beam: 135 },
  };
  const getRebarKgPerM3 = (elemType: string, concreteGrade: string | undefined, defaultKg: number): number => {
    if (concreteGrade) {
      const grade = concreteGrade.toUpperCase().replace(/\s+/g, "");
      for (const [key, val] of Object.entries(GRADE_REBAR_KG)) {
        if (grade.includes(key.toUpperCase())) return val;
      }
    }
    const btKey = projectTypeInfo.type.toLowerCase();
    const typeProfile = TYPE_REBAR_KG[btKey];
    if (typeProfile) {
      const et = elemType.toLowerCase();
      if (et.includes("wall")) return typeProfile.wall;
      if (et.includes("slab")) return typeProfile.slab;
      if (et.includes("column")) return typeProfile.column;
      if (et.includes("beam")) return typeProfile.beam;
    }
    return defaultKg;
  };

  // Process each element (may include expanded material layers)
  for (const elem of expandedElements) {
    const description = typeof elem === "string" ? elem : elem.description ?? elem[0];
    const descLower = (typeof description === "string" ? description : "").toLowerCase();
    const quantity = typeof elem === "object" ? (Number(elem.quantity) || Number(elem[2]) || 1) : 1;
    const sourceUnit = typeof elem === "object" ? ((elem as Record<string, unknown>).unit as string ?? "EA") : "EA";
    const sourceVolume = typeof elem === "object" ? Number((elem as Record<string, unknown>).totalVolume ?? 0) : 0;
    const sourceArea = typeof elem === "object" ? Number((elem as Record<string, unknown>).grossArea ?? 0) : 0;
    const elemCategory = typeof elem === "object" ? ((elem as Record<string, unknown>).category as string ?? "") : "";
    const elemStorey = typeof elem === "object" ? ((elem as Record<string, unknown>).storey as string ?? "") : "";
    const elemCount = typeof elem === "object" ? Number((elem as Record<string, unknown>).elementCount ?? 0) : 0;

    // ── IS 1200 path: use native Indian rates (INR) for Indian projects ──
    if (is1200Module && isIndianProject) {
      // Use raw IFC type from upstream TR-007 (e.g. "IfcWall", "IfcMember")
      // DO NOT reconstruct from description — it contains storey labels and counts
      const rawIfcType = typeof elem === "object" ? ((elem as Record<string, unknown>).ifcType as string) : undefined;
      const ifcType = rawIfcType || ("Ifc" + description.replace(/\s*[—\-].*/g, "").replace(/\s*\(.*\)/g, "").replace(/\s+/g, ""));
      const materialHint = elemCategory || description;
      const is1200Rates = is1200Module.getIS1200RatesForElement(ifcType, materialHint);
      const is1200Label = is1200Module.getIS1200PartLabel(ifcType, materialHint);

      if (is1200Rates.length > 0) {
        for (const rate of is1200Rates) {
          // Determine quantity based on rate unit (already in metric — no conversion needed)
          let qty: number;
          if (rate.unit === "EA") {
            qty = elemCount || quantity;
          } else if (rate.unit === "m²") {
            qty = sourceArea > 0 ? sourceArea : quantity;
          } else if (rate.unit === "m³") {
            qty = sourceVolume > 0 ? sourceVolume : quantity;
          } else if (rate.unit === "kg") {
            // Steel: kg from volume × density (7850 kg/m³) or count × typical weight
            // Rebar: multi-factor estimation (replaces fixed 150 kg/m³ heuristic)
            const isStructSteel = rate.subcategory === "Steel" && !rate.is1200Code.includes("REBAR");
            // Priority 1: Check for actual rebar weight from parser (Qto_ReinforcingElementBaseQuantities)
            const elemRebarWeight = typeof elem === "object" ? Number((elem as Record<string, unknown>).rebarWeight ?? 0) : 0;
            if (elemRebarWeight > 0) {
              qty = elemRebarWeight; // Exact weight from IFC
            } else if (isStructSteel && sourceVolume > 0) {
              qty = sourceVolume * 7850; // steel density 7850 kg/m³
            } else if (sourceVolume > 0) {
              // Grade-aware rebar estimation
              const elemGrade = typeof elem === "object" ? ((elem as Record<string, unknown>).concreteGrade as string) : undefined;
              const elemTypeForRebar = descLower.includes("column") ? "column"
                : descLower.includes("beam") ? "beam"
                : descLower.includes("slab") ? "slab"
                : "wall";
              const kgPerM3 = getRebarKgPerM3(elemTypeForRebar, elemGrade, 120);
              qty = sourceVolume * kgPerM3;
            } else {
              qty = (elemCount || 1) * 50; // fallback: 50 kg per element
            }
          } else if (rate.unit === "Rmt") {
            qty = quantity; // linear measure
          } else {
            qty = quantity;
          }

          // Element-type-specific waste factors (replaces category-level defaults)
          const getElementWaste = (): number => {
            const code = rate.is1200Code;
            // Concrete: slab 4%, column 7%, beam 5%, wall 6%, foundation 3%, stair 6%
            if (code.includes("SLAB")) return 0.04;
            if (code.includes("COLUMN") || code.includes("COL")) return 0.07;
            if (code.includes("BEAM")) return 0.05;
            if (code.includes("WALL") && rate.subcategory === "Concrete") return 0.06;
            if (code.includes("FOOTING") || code.includes("PCC")) return 0.03;
            if (code.includes("STAIR")) return 0.06;
            // Steel: rebar 4%, structural 6%
            if (code.includes("REBAR")) return 0.04;
            if (code.includes("STRUCT-STEEL")) return 0.06;
            // Masonry: brick 6%, AAC block 4%, concrete block 6%
            if (code.includes("AAC")) return 0.04;
            if (code.includes("BRICK") || code.includes("BLOCK")) return 0.06;
            // Finishes: plaster 11%, paint 7%, tile 13%, marble 20%, granite 16%
            if (code.includes("PLASTER")) return 0.11;
            if (code.includes("PAINT")) return 0.07;
            if (code.includes("MARBLE")) return 0.20;
            if (code.includes("GRANITE")) return 0.16;
            if (code.includes("TILE") || code.includes("VIT")) return 0.13;
            if (code.includes("EPOXY")) return 0.08;
            if (code.includes("CARPET")) return 0.05;
            // Category-level fallback
            return ({ "Concrete": 0.05, "Steel": 0.05, "Masonry": 0.06, "Finishes": 0.10, "Doors & Windows": 0.03 })[rate.subcategory] ?? 0.08;
          };
          const wasteFactor = getElementWaste();
          const adjQty = Math.round(qty * (1 + wasteFactor) * 100) / 100;

          // Apply state PWD + city tier + seasonal adjustment (category-specific)
          const ip = indianPricing;
          let categoryFactor = ip?.overall ?? 1.0;
          if (ip) {
            // Select the right category factor based on rate subcategory
            if (rate.subcategory === "Concrete") categoryFactor = ip.concrete;
            else if (rate.subcategory === "Steel") categoryFactor = ip.steel;
            else if (rate.subcategory === "Masonry") categoryFactor = ip.masonry;
            else if (rate.subcategory === "Finishes" || rate.subcategory === "Doors & Windows") categoryFactor = ip.finishing;
            else categoryFactor = ip.overall;
          }

          // Apply concrete grade multiplier if available (M30 costs more than M25)
          let gradeMult = 1.0;
          if (rate.subcategory === "Concrete" && is1200Module) {
            const elemGrade = typeof elem === "object" ? ((elem as Record<string, unknown>).concreteGrade as string) : undefined;
            gradeMult = is1200Module.getConcreteGradeMultiplier(elemGrade);
          }

          // Apply category factor to material rate, labor factor to labour rate
          const laborFactor = ip?.labor ?? categoryFactor;
          // Escalate base rate from CPWD DSR baseline to project date
          const esc = getEscalation(rate.subcategory);
          let adjRate = Math.round(rate.rate * esc.total * categoryFactor * gradeMult * 100) / 100;

          // Market rate override for steel — market rates are ALREADY city-specific
          // DO NOT apply PWD/regional/category factors on top of market rates
          let isMarketRate = false;
          if (steelFromMarket && rate.subcategory === "Steel") {
            const isRebar = rate.is1200Code.includes("REBAR");
            const isRailing = rate.is1200Code.includes("RAILING");
            if (isRebar && marketTMTPerKg !== null) {
              adjRate = marketTMTPerKg; // material + labour, no PWD factor
              isMarketRate = true;
            } else if (!isRebar && !isRailing && marketStructSteelPerKg !== null) {
              adjRate = marketStructSteelPerKg;
              isMarketRate = true;
            } else if (isRailing && marketStructSteelPerKg !== null) {
              // Railing uses structural steel rate (already has fab premium)
              adjRate = marketStructSteelPerKg;
              isMarketRate = true;
            }
            if (isMarketRate) {
            }
          }

          const roundedAdjQty = Math.round(adjQty * 100) / 100;
          const roundedAdjRate = Math.round(adjRate);
          const lineTot = Math.round(roundedAdjQty * roundedAdjRate * 100) / 100;

          // M/L/E breakdown: market steel uses actual mat/lab split, else IS 1200 split
          let matCost: number;
          let labCost: number;
          let eqpCost: number;
          if (isMarketRate && marketSteelMaterialPerKg !== null) {
            // Market: we know the exact material price; lab + eqp fill the rest
            const matRatio = marketSteelMaterialPerKg / adjRate; // e.g. 62/82 = 0.756
            matCost = Math.round(lineTot * matRatio * 100) / 100;
            labCost = Math.round(lineTot * (1 - matRatio) * 0.90 * 100) / 100; // 90% of remainder is labor
            eqpCost = Math.round((lineTot - matCost - labCost) * 100) / 100;
          } else {
            matCost = Math.round(adjQty * rate.material * esc.material * categoryFactor * gradeMult * 100) / 100;
            labCost = Math.round(adjQty * rate.labour * esc.labour * laborFactor * gradeMult * 100) / 100;
            eqpCost = Math.round((lineTot - matCost - labCost) * 100) / 100;
          }

          hardCostSubtotal += lineTot;
          costIS1200 += lineTot;
          totalMaterial += matCost;
          totalLabor += labCost;
          totalEquipment += Math.max(0, eqpCost);

          // Note: do NOT add countLabel here — it's added in the storey-grouped display
          rows.push([
            rate.description, rate.unit, qty.toFixed(2),
            `${(wasteFactor * 100).toFixed(0)}%`, adjQty.toFixed(2),
            `₹${adjRate.toFixed(2)}`,
            `₹${matCost.toFixed(2)}`, `₹${labCost.toFixed(2)}`,
            `₹${Math.max(0, eqpCost).toFixed(2)}`, `₹${lineTot.toFixed(2)}`,
          ]);

          // FIX 10: Include storey name in description for clarity
          const lineDesc = elemStorey && !rate.description.includes(elemStorey)
            ? `${rate.description} — ${elemStorey}`
            : rate.description;

          boqLines.push({
            division: is1200Label,
            csiCode: rate.is1200Code,
            description: lineDesc,
            unit: rate.unit,
            quantity: qty,
            wasteFactor,
            adjustedQty: adjQty,
            materialRate: isMarketRate && marketSteelMaterialPerKg !== null
              ? marketSteelMaterialPerKg  // Show actual market material price (₹62/kg)
              : Math.round(rate.material * categoryFactor * 100) / 100,
            laborRate: isMarketRate
              ? Math.round((adjRate - (marketSteelMaterialPerKg ?? adjRate * 0.85)) * 100) / 100
              : Math.round(rate.labour * laborFactor * 100) / 100,
            equipmentRate: isMarketRate
              ? 0  // Steel: negligible equipment for placing
              : Math.round((rate.rate - rate.material - rate.labour) * categoryFactor * 100) / 100,
            unitRate: adjRate,
            materialCost: matCost,
            laborCost: labCost,
            equipmentCost: Math.max(0, eqpCost),
            totalCost: lineTot,
            storey: elemStorey || undefined,
            elementCount: elemCount || undefined,
            is1200Code: rate.is1200Code,
          });
        }
        pathIS1200++;
        continue; // Skip the USD rate path for this element
      }
      // If no IS 1200 rate found → for Indian projects, use a generic IS 1200 rate
      // NEVER fall to USD path for Indian projects (the 0.266 factor produces nonsense)
      if (isIndianProject && is1200Module) {
        const genericRate = is1200Module.getIS1200Rate("IS1200-P2-RCC-WALL"); // generic RCC rate as fallback
        if (genericRate) {
          const ip = indianPricing;
          const cf = ip?.overall ?? 1.0;
          const waste = 0.08;
          const qty2 = sourceArea > 0 ? sourceArea : sourceVolume > 0 ? sourceVolume : quantity;
          const unit2 = sourceArea > 0 ? "m²" : sourceVolume > 0 ? "m³" : "EA";
          const adjQty2 = Math.round(qty2 * (1 + waste) * 100) / 100;
          const adjRate2 = Math.round(genericRate.rate * getEscalation(genericRate.subcategory).total * cf * 100) / 100;
          const lineTot2 = Math.round(adjQty2 * adjRate2 * 100) / 100;
          const matC2 = Math.round(lineTot2 * 0.55 * 100) / 100;
          const labC2 = Math.round(lineTot2 * 0.40 * 100) / 100;
          const eqpC2 = Math.round(lineTot2 * 0.05 * 100) / 100;
          hardCostSubtotal += lineTot2;
          totalMaterial += matC2; totalLabor += labC2; totalEquipment += eqpC2;
          pathIS1200++; costIS1200 += lineTot2;
          rows.push([`${description} (generic rate)`, unit2, qty2.toFixed(2), `${(waste * 100).toFixed(0)}%`, adjQty2.toFixed(2), `₹${adjRate2.toFixed(2)}`, `₹${matC2.toFixed(2)}`, `₹${labC2.toFixed(2)}`, `₹${eqpC2.toFixed(2)}`, `₹${lineTot2.toFixed(2)}`]);
          boqLines.push({
            division: "IS 1200 Part 2 — General (unmapped)", csiCode: "IS1200-P2-GENERIC",
            description: `${description} (generic IS 1200 rate)`, unit: unit2,
            quantity: qty2, wasteFactor: waste, adjustedQty: adjQty2,
            materialRate: Math.round(adjRate2 * 0.55 * 100) / 100, laborRate: Math.round(adjRate2 * 0.40 * 100) / 100,
            equipmentRate: Math.round(adjRate2 * 0.05 * 100) / 100, unitRate: adjRate2,
            materialCost: matC2, laborCost: labC2, equipmentCost: eqpC2, totalCost: lineTot2,
            storey: elemStorey || undefined, elementCount: elemCount || undefined,
            is1200Code: "IS1200-P2-GENERIC",
          });
          continue; // Skip USD path
        }
      }
    }

    // ── Fallback for elements not matched by IS 1200 rate library ──
    // Indian-only product: all elements should match IS 1200 rates above.
    // This fallback catches edge cases (unmapped IFC types, custom elements).
    {
      estimatedItemsCount++;
      const fallbackRate = escalateValue(5000, "construction-cpi-india", IS1200_BASELINE, projectDate);
      const defaultWaste = 0.10;
      const adjQty = quantity * (1 + defaultWaste);
      const lineTotal = adjQty * fallbackRate;
      const breakdown = getCostBreakdown("Finishes"); // default M/L/E split
      hardCostSubtotal += lineTotal;
      totalMaterial += lineTotal * breakdown.material;
      totalLabor += lineTotal * breakdown.labor;
      totalEquipment += lineTotal * breakdown.equipment;

      const cs1 = currencySymbol;
      rows.push([
        description + " (est.)",
        "EA",
        quantity.toFixed(2),
        `${(defaultWaste * 100).toFixed(0)}%`,
        adjQty.toFixed(2),
        `${cs1}${fallbackRate.toFixed(2)}`,
        `${cs1}${(lineTotal * breakdown.material).toFixed(2)}`,
        `${cs1}${(lineTotal * breakdown.labor).toFixed(2)}`,
        `${cs1}${(lineTotal * breakdown.equipment).toFixed(2)}`,
        `${cs1}${lineTotal.toFixed(2)}`,
      ]);

      boqLines.push({
        division: "General",
        csiCode: "00 00 00",
        description: description + " (est.)",
        unit: "EA",
        quantity,
        wasteFactor: defaultWaste,
        adjustedQty: adjQty,
        materialRate: fallbackRate * breakdown.material,
        laborRate: fallbackRate * breakdown.labor,
        equipmentRate: fallbackRate * breakdown.equipment,
        unitRate: fallbackRate,
        materialCost: Math.round(lineTotal * breakdown.material * 100) / 100,
        laborCost: Math.round(lineTotal * breakdown.labor * 100) / 100,
        equipmentCost: Math.round(lineTotal * breakdown.equipment * 100) / 100,
        totalCost: Math.round(lineTotal * 100) / 100,
        is1200Code: "IS1200-EST",
      });
      pathFallback++; costFallback += Math.round(lineTotal * 100) / 100;
    }
  }

  // ── DIAGNOSTIC: Path breakdown ──

  // ── Derived quantities: Formwork, Rebar, Finishing ──
  // For Indian projects, use CPWD rates directly with IS 1200 codes.
  // For non-Indian, use DERIVED_RATES from regional-factors.ts.
  const { DERIVED_RATES } = await import("@/features/boq/constants/regional-factors");

  // Fix 4 (v2): Element-level plaster/ceiling dedup — track which descriptions already
  // have plaster/ceiling from IFC coverings. Uses element description as key (not storey)
  // to prevent both double-counting AND under-counting.
  const descriptionsWithPlaster = new Set<string>();
  const descriptionsWithCeiling = new Set<string>();
  for (const line of boqLines) {
    const d = line.description.toLowerCase();
    const lineKey = `${line.storey || ""}|${d}`;
    if (d.includes("plaster") && !d.includes("formwork") && !d.includes("rebar")) {
      descriptionsWithPlaster.add(lineKey);
    }
    if (d.includes("ceiling") && !d.includes("formwork")) {
      descriptionsWithCeiling.add(lineKey);
    }
  }
  const derivedLines: typeof boqLines = [];

  // IS 1200 codes for derived quantities
  const DERIVED_IS1200: Record<string, { code: string; division: string }> = {
    "formwork-wall":    { code: "IS1200-P5-FW-WALL", division: "IS 1200 Part 5 — Formwork" },
    "formwork-slab":    { code: "IS1200-P5-FW-SLAB", division: "IS 1200 Part 5 — Formwork" },
    "formwork-column":  { code: "IS1200-P5-FW-COL", division: "IS 1200 Part 5 — Formwork" },
    "formwork-beam":    { code: "IS1200-P5-FW-BEAM", division: "IS 1200 Part 5 — Formwork" },
    "rebar":            { code: "IS1200-P6-REBAR-500", division: "IS 1200 Part 6 — Reinforcement" },
    "plastering":       { code: "IS1200-P8-PLASTER", division: "IS 1200 Part 8 — Plastering" },
    "ceiling-plaster":  { code: "IS1200-P8-PLASTER", division: "IS 1200 Part 8 — Plastering" },
    "painting":         { code: "IS1200-P10-PAINT", division: "IS 1200 Part 10 — Painting" },
  };

  for (const elem of expandedElements) {
    if (typeof elem !== "object") continue;
    const e = elem as Record<string, unknown>;
    const st = (e.storey as string) || "";
    const desc = (e.description as string) || "";
    const area = Number(e.grossArea ?? 0);
    const netArea = Number(e.netArea ?? 0);
    const vol = Number(e.totalVolume ?? 0);
    const descLower = desc.toLowerCase();
    const elemIsExternal = e.isExternal === true;
    const elemConcreteGrade = (e.concreteGrade as string) || undefined;

    const applyDerived = (name: string, baseQty: number, rateUSD: number, dUnit: string, source: string, is1200Key: string, customWaste?: number) => {
      if (baseQty <= 0) return;
      const ip = indianPricing;

      // For Indian projects, use CPWD rate × state PWD category factor
      let adjRate: number;
      if (isIndianProject && is1200Key === "rebar" && is1200Module) {
        // Market rate: use directly, NO PWD/regional factor (already city-specific)
        if (steelFromMarket && marketTMTPerKg !== null) {
          adjRate = marketTMTPerKg; // material ₹62 + labour ₹20 = ₹82/kg
        } else {
          // Static fallback: apply PWD factor to IS 1200 rate
          const rebarRate = is1200Module.getIS1200Rate("IS1200-P6-REBAR-500");
          const steelFactor = ip?.steel ?? ip?.overall ?? 1.0;
          adjRate = rebarRate ? Math.round(rebarRate.rate * steelFactor * 100) / 100 : Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
        }
      } else if (isIndianProject && is1200Key.startsWith("formwork") && is1200Module) {
        const fwRates: Record<string, number> = { "formwork-wall": 400, "formwork-slab": 380, "formwork-column": 480, "formwork-beam": 420 };
        const concFactor = ip?.concrete ?? ip?.overall ?? 1.0;
        adjRate = Math.round((fwRates[is1200Key] ?? 400) * concFactor * 100) / 100;
      } else if (isIndianProject && (is1200Key === "plastering-int" || is1200Key === "ceiling-plaster") && is1200Module) {
        const plastRate = is1200Module.getIS1200Rate("IS1200-P8-PLASTER");
        const finFactor = ip?.finishing ?? ip?.overall ?? 1.0;
        adjRate = plastRate ? Math.round(plastRate.rate * finFactor * 100) / 100 : Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
      } else if (isIndianProject && is1200Key === "plastering-ext" && is1200Module) {
        const plastExtRate = is1200Module.getIS1200Rate("IS1200-P8-PLASTER-EXT");
        const finFactor = ip?.finishing ?? ip?.overall ?? 1.0;
        adjRate = plastExtRate ? Math.round(plastExtRate.rate * finFactor * 100) / 100 : Math.round(rateUSD * 1.44 * locationFactor * exchangeRate * 100) / 100;
      } else if (isIndianProject && is1200Key === "painting-int" && is1200Module) {
        const paintRate = is1200Module.getIS1200Rate("IS1200-P10-PAINT");
        const finFactor = ip?.finishing ?? ip?.overall ?? 1.0;
        adjRate = paintRate ? Math.round(paintRate.rate * finFactor * 100) / 100 : Math.round(3.50 * locationFactor * exchangeRate * 100) / 100;
      } else if (isIndianProject && is1200Key === "painting-ext" && is1200Module) {
        const paintExtRate = is1200Module.getIS1200Rate("IS1200-P10-PAINT-EXT");
        const finFactor = ip?.finishing ?? ip?.overall ?? 1.0;
        adjRate = paintExtRate ? Math.round(paintExtRate.rate * finFactor * 100) / 100 : Math.round(4.50 * locationFactor * exchangeRate * 100) / 100;
      } else {
        adjRate = Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
      }

      // Element-type-specific waste factors (replaces category-level defaults)
      const waste = customWaste ?? 0.05;
      const adjQty = Math.round(baseQty * (1 + waste) * 100) / 100;
      // FIX 6: round rate to whole ₹, then multiply — displayed math checks out
      adjRate = Math.round(adjRate);
      const total = Math.round(adjQty * adjRate * 100) / 100;
      // Steel items: 85% material, 10% labor, 5% equipment (rebar is mostly material cost)
      // Non-steel: 45% material, 50% labor, 5% equipment
      const isRebarOrSteel = is1200Key === "rebar" || is1200Key === "structural-steel";
      const breakdown = isRebarOrSteel
        ? { material: 0.85, labor: 0.10, equipment: 0.05 }
        : { material: 0.45, labor: 0.50, equipment: 0.05 };
      const matC = Math.round(total * breakdown.material * 100) / 100;
      const labC = Math.round(total * breakdown.labor * 100) / 100;
      const eqpC = Math.round((total - matC - labC) * 100) / 100; // remainder — guarantees sum = total
      hardCostSubtotal += total;
      totalMaterial += matC; totalLabor += labC; totalEquipment += eqpC;

      // Map derived keys to IS 1200 codes for output
      const derivedIS1200Lookup: Record<string, { code: string; division: string }> = {
        ...DERIVED_IS1200,
        "plastering-int":  { code: "IS1200-P8-PLASTER", division: "IS 1200 Part 8 — Internal Plaster" },
        "plastering-ext":  { code: "IS1200-P8-PLASTER-EXT", division: "IS 1200 Part 8 — External Plaster" },
        "painting-int":    { code: "IS1200-P10-PAINT", division: "IS 1200 Part 10 — Interior Paint" },
        "painting-ext":    { code: "IS1200-P10-PAINT-EXT", division: "IS 1200 Part 10 — Exterior Paint" },
      };
      const is1200Info = isIndianProject ? derivedIS1200Lookup[is1200Key] : null;
      // For market-sourced rebar, show actual market material price (not % split)
      const derivedMatRate = (isRebarOrSteel && steelFromMarket && marketSteelMaterialPerKg !== null)
        ? marketSteelMaterialPerKg  // ₹62/kg — actual market material price
        : Math.round(adjRate * breakdown.material * 100) / 100;
      const derivedLabRate = (isRebarOrSteel && steelFromMarket && marketSteelMaterialPerKg !== null)
        ? Math.round(adjRate - marketSteelMaterialPerKg)  // ₹20/kg — labour remainder
        : Math.round(adjRate * breakdown.labor * 100) / 100;
      const derivedEqpRate = Math.round(adjRate - derivedMatRate - derivedLabRate);

      derivedLines.push({
        division: is1200Info?.division ?? source,
        csiCode: is1200Info?.code ?? "00 00 00",
        description: name, unit: dUnit,
        quantity: Math.round(baseQty * 100) / 100, wasteFactor: waste, adjustedQty: adjQty,
        materialRate: derivedMatRate,
        laborRate: derivedLabRate,
        equipmentRate: Math.max(0, derivedEqpRate),
        unitRate: adjRate, materialCost: matC, laborCost: labC, equipmentCost: eqpC, totalCost: total,
        storey: st || undefined, elementCount: undefined,
        is1200Code: is1200Info?.code ?? (isIndianProject ? "IS1200-DERIVED" : undefined),
      });
    };

    if (descLower.includes("wall")) {
      // Formwork: both faces × area (element-specific waste: 5-7% for walls)
      applyDerived(`Formwork — ${desc}`, area * 2, DERIVED_RATES.formwork.wall.rate, "m²", "Formwork (Measured)", "formwork-wall", 0.06);

      // Rebar: grade-aware estimation (replaces fixed 150 kg/m³)
      const rebarKg = getRebarKgPerM3("wall", elemConcreteGrade, DERIVED_RATES.rebar.wall.kgPerM3);
      applyDerived(`Rebar — ${desc} (Est.)`, vol * rebarKg, DERIVED_RATES.rebar.wall.rate, "kg", "Rebar (Estimated)", "rebar", 0.04);

      // Plaster & Paint — IsExternal differentiation
      const plastKey = `${st}|${descLower}`;
      const hasExistingPlaster = descriptionsWithPlaster.has(plastKey) ||
        // Also check storey-level: if ANY plaster for this description exists
        Array.from(descriptionsWithPlaster).some(k => k.includes(descLower.replace(/\s*\(external\)|\s*\(internal\)/g, "")));

      if (!hasExistingPlaster) {
        const wallNetArea = netArea > 0 ? netArea : area; // Use net area (minus openings) for finishing
        if (elemIsExternal) {
          // External wall: ext plaster + ext paint on outer face, int plaster + int paint on inner face
          applyDerived(`Ext. Plaster (20mm CM 1:4) — ${desc}`, wallNetArea, DERIVED_RATES.finishing.plastering.rate * 1.44, "m²", "Finishing (External Face)", "plastering-ext", 0.11);
          applyDerived(`Int. Plaster (12mm CM 1:6) — ${desc}`, wallNetArea, DERIVED_RATES.finishing.plastering.rate, "m²", "Finishing (Internal Face)", "plastering-int", 0.11);
          applyDerived(`Ext. Weather Coat Paint — ${desc}`, wallNetArea, DERIVED_RATES.finishing.painting?.rate ?? 3.50, "m²", "Painting (External Face)", "painting-ext", 0.07);
          applyDerived(`Int. Emulsion Paint — ${desc}`, wallNetArea, DERIVED_RATES.finishing.painting?.rate ?? 3.50, "m²", "Painting (Internal Face)", "painting-int", 0.07);
        } else {
          // Internal wall / partition: same plaster + paint on both faces
          applyDerived(`Plastering — ${desc}`, wallNetArea * 2, DERIVED_RATES.finishing.plastering.rate, "m²", "Finishing (Measured)", "plastering-int", 0.11);
          applyDerived(`Emulsion Paint — ${desc}`, wallNetArea * 2, DERIVED_RATES.finishing.painting?.rate ?? 3.50, "m²", "Painting (Measured)", "painting-int", 0.07);
        }
      }
    } else if (descLower.includes("slab")) {
      // Formwork: soffit only × area (element-specific waste: 4% for slabs)
      applyDerived(`Formwork — ${desc}`, area, DERIVED_RATES.formwork.slab.rate, "m²", "Formwork (Measured)", "formwork-slab", 0.04);

      // Rebar: grade-aware estimation
      const rebarKg = getRebarKgPerM3("slab", elemConcreteGrade, DERIVED_RATES.rebar.slab.kgPerM3);
      applyDerived(`Rebar — ${desc} (Est.)`, vol * rebarKg, DERIVED_RATES.rebar.slab.rate, "kg", "Rebar (Estimated)", "rebar", 0.04);

      // Ceiling plaster — element-level dedup
      const ceilKey = `${st}|${descLower}`;
      if (!descriptionsWithCeiling.has(ceilKey)) {
        applyDerived(`Ceiling Plaster — ${desc}`, area, DERIVED_RATES.finishing.ceilingPlaster.rate, "m²", "Finishing (Measured)", "ceiling-plaster", 0.11);
      }
    } else if (descLower.includes("column")) {
      const colHeight = Number(e.totalVolume ?? 0) > 0 ? 3.5 : 0;
      const colRadius = vol > 0 && colHeight > 0 ? Math.sqrt(vol / (Math.PI * colHeight)) : 0.3;
      const colFormworkArea = 2 * Math.PI * colRadius * colHeight * Number(e.elementCount ?? 1);
      // Column formwork: element-specific waste 7%
      applyDerived(`Formwork — ${desc}`, colFormworkArea, DERIVED_RATES.formwork.column.rate, "m²", "Formwork (Measured)", "formwork-column", 0.07);
      // Rebar: grade-aware estimation for columns
      const rebarKg = getRebarKgPerM3("column", elemConcreteGrade, DERIVED_RATES.rebar.column.kgPerM3);
      applyDerived(`Rebar — ${desc} (Est.)`, vol * rebarKg, DERIVED_RATES.rebar.column.rate, "kg", "Rebar (Estimated)", "rebar", 0.04);
    } else if (descLower.includes("beam")) {
      // Beam rebar: grade-aware estimation
      const rebarKg = getRebarKgPerM3("beam", elemConcreteGrade, DERIVED_RATES.rebar.beam?.kgPerM3 ?? 160);
      applyDerived(`Rebar — ${desc} (Est.)`, vol * rebarKg, DERIVED_RATES.rebar.beam?.rate ?? DERIVED_RATES.rebar.slab.rate, "kg", "Rebar (Estimated)", "rebar", 0.04);
    }
  }

  // Add derived lines to boqLines
  boqLines.push(...derivedLines);

  // ── Pre-compute aggregate values needed by both standard items and provisional sums ──
  const gfaForProvisional = elements.reduce((sum: number, e: unknown) => {
    const el = e as Record<string, unknown>;
    return sum + (String(el.description ?? "").toLowerCase().includes("slab") ? Number(el.grossArea ?? 0) : 0);
  }, 0) || 500;
  // Filter non-occupied storeys (basement, roof, mechanical) before counting for foundation type
  const NON_OCCUPIED_STOREY = /^-\d|\b(found|footing|basement|roof|terrace|mechan|service|plant)/i;
  const occupiedStoreys = new Set(
    elements.map((e: unknown) => (e as Record<string, unknown>).storey as string).filter((s: string) => s && !NON_OCCUPIED_STOREY.test(s))
  );
  const floorCountForProv = occupiedStoreys.size || 1;
  const cityTierForProv = indianPricing?.cityTier ?? "city";
  const hasStructuralFoundation = !!(inputData?._hasStructuralFoundation);
  const hasMEPData = !!(inputData?._hasMEPData);

  // ── Standard Construction Items (not modeled in IFC but required for every Indian project) ──
  // A QS adds these to every BOQ — DPC, anti-termite, curing, scaffolding, skirting, etc.
  // Quantities are derived from the structural elements already extracted above.
  if (isIndianProject && is1200Module) {
    // Aggregate IFC quantities for standard item derivation
    let stdSlabArea = 0, stdWallArea = 0, stdExtWallArea = 0, stdIntWallLength = 0;
    let stdConcreteVol = 0, stdDoorCount = 0, stdWindowCount = 0;
    let stdWindowArea = 0, stdFootingVol = 0;
    let stdGroundSlabArea = 0, stdHasRoofCovering = false, stdHasFlooring = false;

    for (const elem of elements) {
      const e = elem as Record<string, unknown>;
      const dsc = String(e.description ?? "").toLowerCase();
      const eArea = Number(e.grossArea ?? 0);
      const eVol = Number(e.totalVolume ?? 0);
      const eCount = Number(e.elementCount ?? 1);
      const eSt = String(e.storey ?? "").toLowerCase();
      const eIfcType = String(e.ifcType ?? "");

      if (dsc.includes("slab") || eIfcType === "IfcSlab") {
        stdSlabArea += eArea;
        // Ground floor slab for DPC / anti-termite footprint
        if (eSt.includes("ground") || eSt.includes("level 0") || eSt.includes("floor 0") || eSt === "gf" || eSt.includes("plinth")) {
          stdGroundSlabArea += eArea;
        }
      }
      if (dsc.includes("wall") || eIfcType === "IfcWall" || eIfcType === "IfcWallStandardCase") {
        stdWallArea += eArea;
        if (e.isExternal === true) stdExtWallArea += eArea;
        else stdIntWallLength += eArea / 3.0; // wall length ≈ area ÷ typical 3.0m storey height
      }
      if (["column", "beam", "slab", "wall", "footing", "stair"].some(t => dsc.includes(t))) {
        stdConcreteVol += eVol;
      }
      if (eIfcType === "IfcDoor" || dsc.includes("door")) stdDoorCount += eCount;
      if (eIfcType === "IfcWindow" || dsc.includes("window")) {
        stdWindowCount += eCount;
        stdWindowArea += eArea;
      }
      if (eIfcType === "IfcFooting" || dsc.includes("footing")) stdFootingVol += eVol;
      if (String(e.coveringType ?? "").toUpperCase() === "ROOFING") stdHasRoofCovering = true;
      if (String(e.coveringType ?? "").toUpperCase() === "FLOORING") stdHasFlooring = true;
    }

    // If no ground floor detected, estimate from total slab area ÷ floor count
    if (stdGroundSlabArea === 0 && floorCountForProv > 0) {
      stdGroundSlabArea = stdSlabArea / floorCountForProv;
    }
    const stdTopSlabArea = floorCountForProv > 0 ? stdSlabArea / floorCountForProv : 0;
    // Building perimeter estimate: assume roughly square plan (sqrt(area) × 4)
    const stdPerimeter = stdGroundSlabArea > 0 ? Math.sqrt(stdGroundSlabArea) * 4 : 0;
    const stdIsResidential = ["residential", "housing", "apartment"].some(t =>
      projectTypeInfo.type.toLowerCase().includes(t));
    // Residential units estimate: GFA ÷ ~70 m² avg unit size
    const stdResUnits = stdIsResidential && gfaForProvisional > 0
      ? Math.max(1, Math.round(gfaForProvisional / 70)) : 0;

    // Helper: push a standard construction item to boqLines with IS 1200 rate + regional adjustment
    const addStdItem = (code: string, div: string, desc: string, unit: string, qty: number, waste: number) => {
      if (qty <= 0) return;
      const stdRate = is1200Module!.getIS1200Rate(code);
      if (!stdRate) return;
      const cf = indianPricing?.overall ?? 1.0;
      const lf = indianPricing?.labor ?? cf;
      const adjQty = Math.round(qty * (1 + waste) * 100) / 100;
      const adjRate = Math.round(stdRate.rate * cf);
      const total = Math.round(adjQty * adjRate * 100) / 100;
      const matC = Math.round(adjQty * stdRate.material * cf * 100) / 100;
      const labC = Math.round(adjQty * stdRate.labour * lf * 100) / 100;
      const eqpC = Math.round((total - matC - labC) * 100) / 100;
      hardCostSubtotal += total;
      totalMaterial += matC;
      totalLabor += labC;
      totalEquipment += Math.max(0, eqpC);
      boqLines.push({
        division: div, csiCode: code, description: `${desc} [STANDARD]`,
        unit, quantity: Math.round(qty * 100) / 100, wasteFactor: waste, adjustedQty: adjQty,
        materialRate: Math.round(stdRate.material * cf * 100) / 100,
        laborRate: Math.round(stdRate.labour * lf * 100) / 100,
        equipmentRate: Math.max(0, Math.round((adjRate - stdRate.material * cf - stdRate.labour * lf) * 100) / 100),
        unitRate: adjRate, materialCost: matC, laborCost: labC,
        equipmentCost: Math.max(0, eqpC), totalCost: total,
        is1200Code: code,
      });
    };

    // 1. DPC — 2 coats bitumen at plinth level over ground floor footprint
    addStdItem("IS1200-P21-DPC", "IS 1200 Part 21 — DPC",
      "Damp proof course (2 coats bitumen) at plinth level", "m²", stdGroundSlabArea, 0.05);

    // 2. Anti-termite — chemical treatment to soil (footprint + 1m perimeter strip)
    const antiTermiteArea = stdGroundSlabArea + stdPerimeter * 1.0;
    addStdItem("IS1200-P1-ANTI-TERMITE", "IS 1200 Part 1 — Anti-termite",
      "Anti-termite soil treatment (IS 6313)", "m²", antiTermiteArea, 0);

    // 3. Backfilling — only when real foundation data exists (provisionals handle it otherwise)
    if (hasStructuralFoundation && stdFootingVol > 0) {
      // Excavation vol ≈ 2× foundation concrete; 70% backfilled (30% occupied by concrete)
      const backfillVol = stdFootingVol * 2.0 * 0.70;
      addStdItem("IS1200-P1-BACKFILL", "IS 1200 Part 1 — Earthwork",
        "Backfilling with excavated earth (compacted in 200mm layers)", "m³", backfillVol, 0);
    }

    // 4. Curing — all exposed concrete surfaces (slab tops + wall both faces)
    const curingArea = stdSlabArea + stdWallArea * 2;
    addStdItem("IS1200-P2-CURING", "IS 1200 Part 2 — Curing",
      "Curing of concrete surfaces (water curing 7-14 days)", "m²", curingArea, 0);

    // 5. Scaffolding — external walls above GF, multi-storey only (85% coverage)
    if (floorCountForProv > 1 && stdExtWallArea > 0) {
      const scaffoldArea = stdExtWallArea * 0.85;
      addStdItem("IS1200-P5-SCAFFOLDING", "IS 1200 Part 5 — Scaffolding",
        "Steel scaffolding for external plaster/paint (hire + erect + dismantle)", "m²", scaffoldArea, 0);
    }

    // 6. IPS screeding — base for floor finish, only if no explicit IfcCovering:FLOORING in IFC
    if (!stdHasFlooring) {
      addStdItem("IS1200-P13-IPS", "IS 1200 Part 13 — Flooring",
        "IPS 25mm cement concrete screeding (base for floor finish)", "m²", stdSlabArea, 0.05);
    }

    // 7. Skirting — 100mm tile skirting along internal walls on all floors
    if (stdIntWallLength > 0) {
      addStdItem("IS1200-P13-SKIRTING", "IS 1200 Part 13 — Skirting",
        "Vitrified tile skirting 100mm high along internal walls", "Rmt",
        stdIntWallLength * floorCountForProv, 0.10);
    }

    // 8. Parapet wall — 230mm brick on terrace perimeter, 1.0m high
    if (stdPerimeter > 0) {
      // Area = perimeter × 1.0m height; uses existing brick masonry rate
      addStdItem("IS1200-P3-BRICK-230", "IS 1200 Part 3 — Masonry",
        "Parapet wall 230mm brick at terrace perimeter (1.0m height)", "m²",
        stdPerimeter * 1.0, 0.06);
    }

    // 9. Terrace waterproofing — top floor slab (skip if IFC has IfcCovering:ROOFING)
    if (!stdHasRoofCovering && stdTopSlabArea > 0) {
      addStdItem("IS1200-P21-WATERPROOF", "IS 1200 Part 21 — Waterproofing",
        "Terrace waterproofing (bitumen membrane) on top floor slab", "m²",
        stdTopSlabArea, 0.05);
    }

    // 10. Chajja / sunshade — RCC projection over windows (0.6m × window width)
    if (stdWindowCount > 0) {
      // Avg window width from area/count/height, fallback 1.2m
      const avgWinWidth = stdWindowArea > 0 ? (stdWindowArea / stdWindowCount / 1.2) : 1.2;
      const chajjaArea = stdWindowCount * avgWinWidth * 0.6;
      addStdItem("IS1200-P2-CHAJJA", "IS 1200 Part 2 — Concrete",
        "RCC chajja/sunshade 75mm over windows (0.6m projection)", "m²", chajjaArea, 0.05);
    }

    // 11. Door/window frame grouting — CM 1:4 packing around frames
    if (stdDoorCount + stdWindowCount > 0) {
      // Avg door perimeter ≈ 5.2 Rmt (0.9+2.1+0.9+2.1-0.8), window ≈ 4.0 Rmt
      const groutRmt = stdDoorCount * 5.2 + stdWindowCount * 4.0;
      addStdItem("IS1200-P8-FRAME-GROUT", "IS 1200 Part 8 — Plastering",
        "CM 1:4 grouting around door/window frames", "Rmt", groutRmt, 0.10);
    }

    // 12. Kitchen dado tiling — residential only (1 kitchen/unit, ~4.8 m² dado)
    if (stdIsResidential && stdResUnits > 0) {
      const dadoArea = stdResUnits * 4.8;
      addStdItem("IS1200-P13-DADO-TILE", "IS 1200 Part 13 — Finishes",
        "Kitchen dado tiling (ceramic, 600mm above counter)", "m²", dadoArea, 0.13);
    }

    // 13. Bathroom waterproofing — residential only (2 baths/unit, ~16 m² each)
    if (stdIsResidential && stdResUnits > 0) {
      // 4 m² floor + 12 m² walls (to 1.5m height) = 16 m² per bathroom
      const bathWPArea = stdResUnits * 2 * 16;
      addStdItem("IS1200-P21-WET-AREA-WP", "IS 1200 Part 21 — Waterproofing",
        "Bathroom/wet area waterproofing (membrane + flood test)", "m²", bathWPArea, 0.05);
    }

    // 14. Plinth protection — 600mm wide PCC apron around building perimeter
    if (stdPerimeter > 0) {
      // Volume = perimeter × 0.6m width × 0.075m thickness
      const plinthProtVol = stdPerimeter * 0.6 * 0.075;
      addStdItem("IS1200-P2-PCC-FOOTING", "IS 1200 Part 2 — Concrete",
        "Plinth protection — 600mm wide PCC apron around building", "m³", plinthProtVol, 0.05);
    }

    // 15. Excavation — only when real foundation IFC data exists (provisionals handle it otherwise)
    if (hasStructuralFoundation && stdFootingVol > 0) {
      // Excavation volume ≈ 2× foundation concrete volume (trench/pit)
      const excavVol = stdFootingVol * 2.0;
      addStdItem("IS1200-P1-EXCAVATION-SHALLOW", "IS 1200 Part 1 — Earthwork",
        "Excavation in ordinary soil for foundation (0-1.5m depth)", "m³", excavVol, 0);
    }
  }

  // ── Provisional Sums: MEP, Foundation, External Works ──
  // Skip provisional estimates when real data from structural/MEP IFC is available
  const { estimateMEPCosts, estimateFoundationCosts, estimateExternalWorksCosts, checkQuantitySanity } = await import("@/features/boq/services/boq-intelligence");

  // MEP: skip provisional if real MEP IFC data exists
  const mepSums = hasMEPData ? [] : estimateMEPCosts(gfaForProvisional, projectTypeInfo.type, floorCountForProv, cityTierForProv, isIndianProject);

  // Foundation: skip provisional if real structural IFC data exists
  const soilType = locationData?.soilType as string | undefined;
  const plotArea = locationData?.plotArea ? Number(locationData.plotArea) : undefined;
  const foundSums = hasStructuralFoundation ? [] : estimateFoundationCosts(gfaForProvisional, floorCountForProv, projectTypeInfo.type, cityTierForProv, isIndianProject, soilType || undefined);

  // External works always provisional (rarely in IFC)
  const extSums = estimateExternalWorksCosts(gfaForProvisional, floorCountForProv, cityTierForProv, isIndianProject, (plotArea && plotArea > 0) ? plotArea : undefined);

  const allProvisional = [...foundSums, ...mepSums, ...extSums];
  // Escalate provisional sums from their baseline to project date
  const mepEscFactor = getEscalationFactor("mep-composite", MEP_BASELINE, projectDate);
  for (const prov of allProvisional) {
    prov.amount = Math.round(prov.amount * mepEscFactor);
    prov.rate = Math.round(prov.rate * mepEscFactor);
  }
  let provisionalTotal = 0;

  for (const prov of allProvisional) {
    provisionalTotal += prov.amount;
    hardCostSubtotal += prov.amount;
    totalMaterial += Math.round(prov.amount * 0.55);
    totalLabor += Math.round(prov.amount * 0.40);
    totalEquipment += Math.round(prov.amount * 0.05);

    boqLines.push({
      division: prov.category,
      csiCode: prov.is1200Code ?? "PROV",
      description: `${prov.description} [${prov.confidence.toUpperCase()}]`,
      unit: prov.unit,
      quantity: prov.quantity,
      wasteFactor: 0,
      adjustedQty: prov.quantity,
      materialRate: Math.round(prov.rate * 0.55),
      laborRate: Math.round(prov.rate * 0.40),
      equipmentRate: Math.round(prov.rate * 0.05),
      unitRate: prov.rate,
      materialCost: Math.round(prov.amount * 0.55),
      laborCost: Math.round(prov.amount * 0.40),
      equipmentCost: Math.round(prov.amount * 0.05),
      totalCost: prov.amount,
      is1200Code: prov.is1200Code,
    });
  }

  // ── Quantity Sanity Checker ──
  const sanitizedElements = elements.map((e: unknown) => {
    const el = e as Record<string, unknown>;
    return { description: String(el.description ?? ""), grossArea: Number(el.grossArea ?? 0), totalVolume: Number(el.totalVolume ?? 0), elementCount: Number(el.elementCount ?? 0), storey: String(el.storey ?? "") };
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const quantityWarnings = checkQuantitySanity(sanitizedElements, gfaForProvisional, floorCountForProv);

  // ── Market Intelligence: read from upstream TR-015 node (NOT fetched here) ──
  // TR-015 runs as a separate pipeline node to avoid Vercel timeout.
  // If TR-015 output is connected, use its prices. Otherwise skip (use static rates).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let marketData: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  let marketAdjustments: any = null;
  const upstreamMarket = inputData?._marketData as Record<string, unknown> | undefined;
  if (upstreamMarket && upstreamMarket.steel_per_tonne) {
    marketData = upstreamMarket;
    try {
      const { computeMarketAdjustments } = await import("@/features/boq/services/market-intelligence");
      marketAdjustments = computeMarketAdjustments(marketData);
    } catch { /* non-fatal */ }
  } else if (isIndianProject) {
  }

  // Rebuild rows grouped by storey (if storey data available)
  const hasStoreyData = boqLines.some(l => l.storey && l.storey !== "Unassigned");
  if (hasStoreyData) {
    // Clear inline rows and rebuild grouped
    rows.length = 0;
    const storeyOrder = [...new Set(boqLines.filter(l => l.storey).map(l => l.storey!))];
    // Add lines without storey first
    const unassigned = boqLines.filter(l => !l.storey || l.storey === "Unassigned");
    const cs0 = currencySymbol;

    for (const storey of storeyOrder) {
      const storeyLines = boqLines.filter(l => l.storey === storey);
      if (storeyLines.length === 0) continue;

      rows.push([`── ${storey.toUpperCase()} ──`, "", "", "", "", "", "", "", "", ""]);

      let storeyTotal = 0;
      for (const l of storeyLines) {
        const countLabel = l.elementCount ? ` (${l.elementCount} nr)` : "";
        rows.push([
          `  ${l.description}${countLabel}`, l.unit, l.quantity.toFixed(2),
          `${(l.wasteFactor * 100).toFixed(0)}%`, l.adjustedQty.toFixed(2),
          `${cs0}${l.unitRate.toFixed(2)}`,
          `${cs0}${l.materialCost.toFixed(2)}`, `${cs0}${l.laborCost.toFixed(2)}`,
          `${cs0}${l.equipmentCost.toFixed(2)}`, `${cs0}${l.totalCost.toFixed(2)}`,
        ]);
        storeyTotal += l.totalCost;
      }
      rows.push([`  ${storey} Subtotal`, "", "", "", "", "", "", "", "", `${cs0}${storeyTotal.toFixed(2)}`]);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
    }

    // Unassigned items
    for (const l of unassigned) {
      rows.push([
        l.description, l.unit, l.quantity.toFixed(2),
        `${(l.wasteFactor * 100).toFixed(0)}%`, l.adjustedQty.toFixed(2),
        `${cs0}${l.unitRate.toFixed(2)}`,
        `${cs0}${l.materialCost.toFixed(2)}`, `${cs0}${l.laborCost.toFixed(2)}`,
        `${cs0}${l.equipmentCost.toFixed(2)}`, `${cs0}${l.totalCost.toFixed(2)}`,
      ]);
    }
  }

  // Hard costs subtotal row
  const cs = currencySymbol;
  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  rows.push(["HARD COSTS SUBTOTAL", "", "", "", "", "", `${cs}${totalMaterial.toFixed(2)}`, `${cs}${totalLabor.toFixed(2)}`, `${cs}${totalEquipment.toFixed(2)}`, `${cs}${hardCostSubtotal.toFixed(2)}`]);

  // ── Minimum cost floor enforcement ──
  // Uses dynamic minimum from market intelligence (Claude AI) when available,
  // falls back to static floors as emergency parachute.
  if (isIndianProject && gfaForProvisional > 0) {
    const STATIC_FLOORS: Record<string, number> = {
      residential: 14000, commercial: 22000, retail: 20000,
      healthcare: 35000, hospital: 35000, hospitality: 30000, hotel: 30000,
      wellness: 35000, spa: 35000, educational: 18000,
      industrial: 12000, warehouse: 8000, datacenter: 45000,
    };
    const btKey = projectTypeInfo.type.toLowerCase();
    // Prefer dynamic minimum from market intelligence (city-specific, year-specific)
    let dynamicMin = Number(marketData?.minimum_cost_per_m2 ?? 0);
    // Sanity: if Claude returned per-sqft instead of per-m², convert (1 m² ≈ 10.76 sqft)
    if (dynamicMin > 0 && dynamicMin < 10000) dynamicMin = Math.round(dynamicMin * 10.764);
    const rawStaticMin = STATIC_FLOORS[btKey] ?? STATIC_FLOORS.commercial;
    // Escalate the static floor to the project date so the safety net keeps up with inflation
    const staticMin = Math.round(rawStaticMin * getEscalationFactor("construction-cpi-india", BENCHMARK_BASELINE, projectDate));
    // Always use the HIGHER of dynamic and static — static is physical floor, dynamic is AI suggestion
    const minFloor = Math.max(dynamicMin, staticMin);
    // Diagnostic: dump all marketData keys that contain 'min' or 'bench' or 'range'
    if (marketData) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const mKeys = Object.keys(marketData).filter((k: string) => /min|bench|range|floor|typical/i.test(k));
    }
    const currentCostPerM2 = hardCostSubtotal / gfaForProvisional;
    if (currentCostPerM2 < minFloor) {
      const scaleFactor = minFloor / currentCostPerM2;
      hardCostSubtotal = Math.round(hardCostSubtotal * scaleFactor);
      totalMaterial = Math.round(totalMaterial * scaleFactor);
      totalLabor = Math.round(totalLabor * scaleFactor);
      totalEquipment = Math.round(totalEquipment * scaleFactor);
      rows.push([`⚠️ Minimum cost floor applied: ₹${minFloor.toLocaleString()}/m² (${btKey}) — scaled ×${scaleFactor.toFixed(2)}`, "", "", "", "", "", "", "", "", `${cs}${hardCostSubtotal.toFixed(2)}`]);
    }
  }

  // Project type multiplier info
  if (projectTypeInfo.multiplier !== 1.0) {
    rows.push([`Project Type: ${projectTypeInfo.type} (${projectTypeInfo.multiplier}x)`, "", "", "", "", "", "", "", "", "Applied"]);
  }

  // Location factor info
  if (locationFactor !== 1.0) {
    rows.push([`Location: ${locationLabel} (${locationFactor.toFixed(2)}x)`, "", "", "", "", "", "", "", "", "Applied"]);
  }

  // Escalation
  const escalation = calculateEscalation(hardCostSubtotal, escalationRate, escalationMonths);
  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  rows.push([`Cost Escalation (${escalation.annualRate * 100}%/yr, ${escalation.months}mo)`, "", "", "", "", "", "", "", "", `${cs}${escalation.amount.toFixed(2)}`]);

  const hardCostWithEscalation = hardCostSubtotal + escalation.amount;
  rows.push(["HARD COSTS + ESCALATION", "", "", "", "", "", "", "", "", `${cs}${hardCostWithEscalation.toFixed(2)}`]);

  // Soft costs
  const costSummary = calculateTotalCost(hardCostWithEscalation, true, contingencyPct > 0);
  // Override contingency percentage if user specified a custom value
  if (contingencyPct !== 0.10) {
    const contingencyItem = costSummary.breakdown.find(b => b.item === "Contingency");
    if (contingencyItem) {
      const oldAmt = contingencyItem.amount;
      contingencyItem.amount = Math.round(hardCostWithEscalation * contingencyPct * 100) / 100;
      contingencyItem.percentage = Math.round(contingencyPct * 100 * 10) / 10;
      costSummary.softCosts += contingencyItem.amount - oldAmt;
      costSummary.totalCost += contingencyItem.amount - oldAmt;
    }
  }
  // ── Rate Benchmark Validator (uses total project cost including soft costs) ──
  const { validateBenchmark } = await import("@/features/boq/services/boq-intelligence");
  // FIX 7: Pass dynamic benchmark from market agent when available
  const dynamicBench = marketData ? {
    rangeLow: Number(marketData.typical_range_min) || undefined,
    rangeHigh: Number(marketData.typical_range_max) || undefined,
    minFloor: Number(marketData.absolute_minimum_cost) || undefined,
  } : undefined;
  const benchmarkResult = validateBenchmark(
    costSummary.totalCost,
    gfaForProvisional,
    projectTypeInfo.type,
    indianPricing?.cityTier ?? cityTierForProv,
    dynamicBench,
    projectDate
  );

  // ── Benchmark hard-stop: if cost is far below absolute minimum, refuse to ship ──
  // 30% grace below floor. If below that, something is genuinely broken.
  if (benchmarkResult.severity === "critical" && benchmarkResult.costPerM2 > 0) {
    const floorValue = benchmarkResult.benchmarkLow;
    const graceFloor = Math.round(floorValue * 0.7);
    if (benchmarkResult.costPerM2 < graceFloor) {
      return {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "table",
        data: {
          _hardStop: true,
          _hardStopReason: `Cost estimate ₹${benchmarkResult.costPerM2.toLocaleString("en-IN")}/m² is far below the minimum ₹${floorValue.toLocaleString("en-IN")}/m² for ${projectTypeInfo.type} construction in ${benchmarkResult.cityTier} city. The IFC model may have geometry issues, or the project type detection may be incorrect.`,
          _projectDate: projectDate.toISOString().split("T")[0],
          _marketDataConfidence: marketDataConfidence,
          label: "Bill of Quantities — Hard Stop",
          content: `Hard stop: cost ₹${benchmarkResult.costPerM2.toLocaleString("en-IN")}/m² below ₹${graceFloor.toLocaleString("en-IN")}/m² grace floor.`,
        },
        metadata: { real: true },
        createdAt: new Date(),
      };
    }
  }

  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  rows.push(["SOFT COSTS", "", "", "", "", "", "", "", "", ""]);

  for (const softItem of costSummary.breakdown) {
    rows.push([
      softItem.item, "%", softItem.percentage.toString(), "", "", "", "", "", "",
      `${cs}${softItem.amount.toFixed(2)}`,
    ]);
  }

  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  rows.push(["SOFT COSTS SUBTOTAL", "", "", "", "", "", "", "", "", `${cs}${costSummary.softCosts.toFixed(2)}`]);
  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  rows.push(["TOTAL PROJECT COST", "", "", "", "", "", "", "", "", `${cs}${costSummary.totalCost.toFixed(2)}`]);
  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  // AACE class determined later — use generic text here (detailed AACE in output metadata)
  rows.push(["Estimate accuracy: preliminary. Not suitable for contract pricing.", "", "", "", "", "", "", "", "", ""]);

  // No yellow warnings — all info goes into the content summary
  const warnings: string[] = [];
  // ── Market intelligence and IFC quality → info panel (NOT warnings) ──
  // These are informational — yellow warnings are only for actual problems.
  const infoNotes: string[] = [];

  // Market intelligence summary
  if (marketData?.agent_notes?.length) {
    for (const note of marketData.agent_notes) infoNotes.push(note);
  }

  // IFC Quality Assessment
  const totalElems = elements.length;
  const withGeometry = elements.filter((e: unknown) => {
    const el = e as Record<string, unknown>;
    return (Number(el.grossArea ?? 0) > 0 || Number(el.totalVolume ?? 0) > 0);
  }).length;
  const geometryPct = totalElems > 0 ? Math.round((withGeometry / totalElems) * 100) : 0;
  const hasStructIFC = !!(inputData?._hasStructuralFoundation);
  const hasMEPIFC = !!(inputData?._hasMEPData);

  // FIX 10: Dynamic AACE class based on uploaded IFC files
  const aaceInfo = (() => {
    if (hasStructIFC && hasMEPIFC) return { class: "Class 3", accuracy: "±15-20%", confidence: "HIGH" };
    if (hasStructIFC || hasMEPIFC) return { class: "Class 3-4", accuracy: "±20-25%", confidence: "MEDIUM-HIGH" };
    return { class: "Class 4", accuracy: "±25-30%", confidence: "MEDIUM" };
  })();

  // FIX 8: Dynamic disclaimer with city, state, AACE class, fetch date
  const dynamicDisclaimer = buildDynamicDisclaimer({
    aaceClass: aaceInfo.class,
    accuracy: aaceInfo.accuracy,
    city: locationData?.city,
    state: locationData?.state,
    marketFetchDate: marketData?.fetched_at,
  });

  const ifcQuality = geometryPct > 85 ? "EXCELLENT" : geometryPct > 65 ? "GOOD" : geometryPct > 40 ? "FAIR" : "POOR";
  const confidencePct = Math.min(95, geometryPct + (hasStructIFC ? 8 : 0) + (hasMEPIFC ? 10 : 0));

  // Anomaly Detection — only ACTUAL anomalies go to warnings
  const anomalies: string[] = [];
  const matRatio = hardCostSubtotal > 0 ? totalMaterial / hardCostSubtotal : 0;
  const labRatio = hardCostSubtotal > 0 ? totalLabor / hardCostSubtotal : 0;
  if (matRatio < 0.45) anomalies.push(`Material ratio ${(matRatio * 100).toFixed(0)}% — unusually low (expected 50-65%)`);
  if (labRatio > 0.50) anomalies.push(`Labor ratio ${(labRatio * 100).toFixed(0)}% — unusually high (expected 30-42%)`);
  if (provisionalTotal > hardCostSubtotal * 0.50) anomalies.push(`Provisional sums are ${Math.round((provisionalTotal / hardCostSubtotal) * 100)}% of hard cost — add structural/MEP IFC to reduce`);
  for (const line of boqLines) {
    if (line.totalCost > hardCostSubtotal * 0.25) {
      anomalies.push(`"${line.description}" is ${Math.round((line.totalCost / hardCostSubtotal) * 100)}% of budget — verify quantities`);
      break;
    }
  }
  // Anomalies go into content summary, not warnings

  // ── Upgrade 7: Store analytics for learning (fire-and-forget) ──
  try {
    const { prisma: analyticsDb } = await import("@/lib/db");
    analyticsDb.bOQAnalytics.create({
      data: {
        city: locationData?.city || "", state: locationData?.state || "",
        buildingType: projectTypeInfo.type, gfa: gfaForProvisional, floors: floorCountForProv,
        costPerM2: gfaForProvisional > 0 ? Math.round(costSummary.totalCost / gfaForProvisional) : 0,
        materialRatio: matRatio, laborRatio: labRatio,
        masonRate: Number(marketData?.labor?.mason?.value ?? 0),
        steelRate: Number(marketData?.steel_per_tonne?.value ?? 0),
        cementRate: Number(marketData?.cement_per_bag?.value ?? 0),
        ifcQuality: `${geometryPct}%`, provisionalPct: hardCostSubtotal > 0 ? Math.round((provisionalTotal / hardCostSubtotal) * 100) : 0,
      },
    }).catch(() => {}); // non-fatal
  } catch { /* non-fatal */ }

  // ── Upgrade 8: Natural Language Summary (includes all info notes) ──
  const costPerM2 = gfaForProvisional > 0 ? Math.round(costSummary.totalCost / gfaForProvisional) : 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const provPct = hardCostSubtotal > 0 ? Math.round((provisionalTotal / hardCostSubtotal) * 100) : 0;
  const nlSummary = [
    `This ${Math.round(gfaForProvisional)}m² ${projectTypeInfo.type} in ${locationLabel || "India"} is estimated at ${formatINR(costSummary.totalCost)} (₹${costPerM2.toLocaleString("en-IN")}/m²).`,
    `IFC Quality: ${ifcQuality} (${confidencePct}% confidence) · ${withGeometry}/${totalElems} elements`,
    ...infoNotes,
    anomalies.length === 0 ? `Quality Check: all ratios within expected ranges` : `Quality Check: ${anomalies.length} anomal${anomalies.length === 1 ? "y" : "ies"} — review recommended`,
  ].join("\n");

  // ── Transparency Layer: Pricing Metadata ──
  const marketIntelStatus = marketData?.agent_status as string | undefined;
  const pricingSource: "market_intelligence" | "cpwd_static" | "mixed" =
    marketIntelStatus === "success" ? "market_intelligence"
    : marketIntelStatus === "partial" ? "mixed"
    : fallbackChainUsed ? "mixed"  // Fallback chain found cached prices
    : "cpwd_static";
  const pricingMetadata = {
    source: pricingSource,
    marketIntelligenceStatus: (marketIntelStatus ?? (fallbackChainUsed ? "failed" : "failed")) as "success" | "partial" | "failed" | "timeout",
    staticRateVersion: "CPWD DSR 2025-26",
    ...(pricingSource === "cpwd_static" && {
      staleDateWarning: "Using CPWD DSR 2025-26 static rates (April 2026). Actual prices may differ by 5-15% depending on city and market conditions.",
    }),
    ...(fallbackChainUsed && {
      staleDateWarning: `Some prices from MaterialPriceCache (${fallbackSources.join("; ")}). Others from CPWD DSR 2025-26 static rates.`,
    }),
    ...(marketData?.fetched_at && { lastMarketUpdate: marketData.fetched_at }),
    ...(locationData?.city && { cityUsed: locationData.city }),
    ...(locationData?.state && { stateUsed: locationData.state }),
  };

  // ── Transparency Layer: Per-Line Confidence Scoring ──
  const hasMarketIntel = pricingSource === "market_intelligence";
  for (const line of boqLines) {
    const factors: string[] = [];
    let score: "high" | "medium" | "low" = "high";

    // Rate source factor
    if (line.is1200Code === "IS1200-P2-GENERIC" || line.is1200Code === "IS1200-EST") {
      score = "low";
      factors.push("Rate from generic fallback (unmapped element type)");
    } else if (line.is1200Code === "PROV") {
      score = "low";
      factors.push("Provisional sum estimate — not from IFC data");
    } else if (hasMarketIntel && (line.is1200Code?.includes("REBAR") || line.is1200Code?.includes("STRUCT-STEEL"))) {
      factors.push(`Steel rate from live market data (${locationData?.city ?? "India"}, ${new Date().toLocaleDateString("en-IN", { month: "short", year: "numeric" })})`);
    } else if (isIndianProject && line.is1200Code && !line.is1200Code.includes("DERIVED")) {
      if (hasMarketIntel) {
        factors.push("Rate from IS 1200 / CPWD with market-adjusted PWD factor");
      } else {
        score = score === "high" ? "medium" : score;
        factors.push("Rate from CPWD DSR 2025-26 static rates (market intel unavailable)");
      }
    } else if (line.is1200Code?.includes("DERIVED")) {
      score = score === "high" ? "medium" : score;
      factors.push("Derived quantity (estimated from structural elements)");
    }

    // Quantity source factor
    const desc = line.description.toLowerCase();
    if (desc.includes("(est.)") || desc.includes("estimated")) {
      score = score === "high" ? "medium" : score;
      factors.push("Quantity estimated (not directly from IFC geometry)");
    } else if (!desc.includes("provisional") && !desc.includes("[")) {
      factors.push("Quantity from IFC model");
    }

    // Rebar-specific
    if (desc.includes("rebar")) {
      if (desc.includes("est.")) {
        score = "medium";
        factors.push("Rebar weight estimated from concrete grade / building type");
      }
    }

    // Confidence override if no useful factors
    if (factors.length === 0) {
      factors.push("Standard IS 1200 rate applied");
    }

    // Store on line (using the [key: string] index signature pattern)
    (line as Record<string, unknown>).confidence = { score, factors };

    // Per-line provenance: tag with the rate source for trust signals
    const lineDesc = line.description.toLowerCase();
    const isSteel = lineDesc.includes("steel") || lineDesc.includes("rebar") || lineDesc.includes("railing");
    const isProvisional = line.is1200Code === "PROV" || line.division.includes("PROVISIONAL");
    const lineProvenance: string =
      isProvisional ? marketDataConfidence  // provisionals inherit overall market confidence
      : isSteel && steelFromMarket ? (marketDataConfidence === "live" ? "live" : "cached")
      : hasMarketIntel ? "cached"  // IS1200 rates with market-adjusted PWD
      : "escalated";  // pure IS1200 static + escalation
    (line as Record<string, unknown>)._lineProvenance = lineProvenance;
  }

  // Count confidence distribution for disclaimer
  const highCount = boqLines.filter(l => (l as Record<string, unknown>).confidence && ((l as Record<string, unknown>).confidence as Record<string, unknown>).score === "high").length;
  const highPct = boqLines.length > 0 ? Math.round((highCount / boqLines.length) * 100) : 0;

  // ── Transparency Layer: Model Quality Report ──
  const upstreamModelQuality = inputData?._modelQuality as Record<string, unknown> | undefined;
  const mqIssueCount = (Number(upstreamModelQuality?.zeroVolumeElements && (upstreamModelQuality.zeroVolumeElements as Record<string, unknown>).count) || 0)
    + (Number(upstreamModelQuality?.noMaterialElements && (upstreamModelQuality.noMaterialElements as Record<string, unknown>).count) || 0)
    + (Number(upstreamModelQuality?.unassignedStoreyElements && (upstreamModelQuality.unassignedStoreyElements as Record<string, unknown>).count) || 0);
  const mqPct = totalElems > 0 ? (mqIssueCount / totalElems) * 100 : 0;
  const mqGrade = mqPct === 0 ? "A" : mqPct < 5 ? "B" : mqPct < 15 ? "C" : mqPct < 30 ? "D" : "F";

  const mqRecommendations: string[] = [];
  if (upstreamModelQuality) {
    const zv = upstreamModelQuality.zeroVolumeElements as { count?: number; types?: string[] } | undefined;
    if (zv?.count && zv.count > 0) {
      mqRecommendations.push(`${zv.count} element(s) have zero volume (${zv.types?.join(", ") ?? "unknown"}) — check these elements have valid geometry in the authoring tool`);
    }
    const nm = upstreamModelQuality.noMaterialElements as { count?: number; types?: string[] } | undefined;
    if (nm?.count && nm.count > 5) {
      mqRecommendations.push(`${nm.count} element(s) have no material assigned — assign materials in Revit/ArchiCAD for accurate cost mapping`);
    }
    const us = upstreamModelQuality.unassignedStoreyElements as { count?: number } | undefined;
    if (us?.count && us.count > 5) {
      mqRecommendations.push(`${us.count} element(s) not assigned to any storey — assign to building storeys for accurate floor-wise breakdown`);
    }
    const sd = upstreamModelQuality.suspiciousDimensions as Array<Record<string, unknown>> | undefined;
    if (sd && sd.length > 0) {
      mqRecommendations.push(`${sd.length} element(s) have suspicious dimensions — verify wall thickness and slab depth in the model`);
    }
  }

  const modelQualityReport = {
    overallGrade: mqGrade,
    totalElements: totalElems,
    issuesFound: {
      zeroVolumeElements: (upstreamModelQuality?.zeroVolumeElements as { count: number; types: string[] }) ?? { count: 0, types: [] },
      duplicateElements: (upstreamModelQuality?.duplicateElements as { count: number; estimatedImpact: string }) ?? { count: 0, estimatedImpact: "none" },
      noMaterialElements: (upstreamModelQuality?.noMaterialElements as { count: number; types: string[] }) ?? { count: 0, types: [] },
      unassignedStoreyElements: { count: Number((upstreamModelQuality?.unassignedStoreyElements as Record<string, unknown>)?.count ?? 0) },
      suspiciousDimensions: {
        count: Array.isArray(upstreamModelQuality?.suspiciousDimensions) ? (upstreamModelQuality.suspiciousDimensions as unknown[]).length : 0,
        details: Array.isArray(upstreamModelQuality?.suspiciousDimensions)
          ? (upstreamModelQuality.suspiciousDimensions as Array<Record<string, unknown>>).slice(0, 5).map(d => `${d.elementType} "${d.name}": ${d.dimension} = ${Number(d.value) * 1000}mm (expected ${d.expected})`)
          : [],
      },
      unitInconsistencies: !!(upstreamModelQuality?.unitConversion as Record<string, unknown>)?.conversionApplied,
    },
    recommendations: mqRecommendations,
  };

  // ── Transparency Layer: Honest Disclaimer ──
  const honestDisclaimer = highPct > 80
    ? `This estimate is suitable for preliminary budgeting and feasibility assessment (${aaceInfo.class}, ${aaceInfo.accuracy}). For tendering, verify with a qualified Quantity Surveyor.`
    : highPct >= 50
    ? `This estimate is suitable for early-stage cost planning (${aaceInfo.class}). ${boqLines.length - highCount} of ${boqLines.length} items have medium/low confidence — review flagged items before budgeting decisions.`
    : `This estimate is indicative only (AACE Class 5). The IFC model has quality issues affecting accuracy. See Model Quality Report for details and recommended fixes.`;

  // ── Cost mapping diagnostics — derived from the final boqLines ──
  {
    const cm = diag.stages.costMapping;
    cm.totalLineItems = boqLines.length;
    cm.is1200Mapped = boqLines.filter(l => l.is1200Code && !l.is1200Code.includes("GENERIC") && !l.is1200Code.includes("EST") && l.is1200Code !== "PROV").length;
    cm.genericFallback = boqLines.filter(l => l.is1200Code === "IS1200-P2-GENERIC" || l.is1200Code === "IS1200-EST").length;
    cm.derivedItems = boqLines.filter(l => l.is1200Code?.includes("DERIVED") || l.is1200Code?.includes("FW-") || (l.is1200Code === "IS1200-P6-REBAR-500" && l.description.includes("Est."))).length;
    cm.standardItems = boqLines.filter(l => l.description.includes("[STANDARD]")).length;
    cm.provisionalItems = boqLines.filter(l => l.is1200Code === "PROV").length;
    cm.formworkItems = boqLines.filter(l => l.is1200Code?.includes("FW-")).length;
    cm.rebarItems = boqLines.filter(l => l.is1200Code?.includes("REBAR")).length;
    cm.externalWallItems = boqLines.filter(l => l.description.toLowerCase().includes("(external)") || l.description.toLowerCase().includes("ext. plaster") || l.description.toLowerCase().includes("ext. weather")).length;
    cm.internalWallItems = boqLines.filter(l => l.description.toLowerCase().includes("(internal)") || l.description.toLowerCase().includes("int. plaster") || l.description.toLowerCase().includes("int. emulsion")).length;
    cm.isExternalDifferentiated = cm.externalWallItems > 0 && cm.internalWallItems > 0;
    cm.totalHardCost = Math.round(hardCostSubtotal);
    cm.costPerSqm = gfaForProvisional > 0 ? Math.round(hardCostSubtotal / gfaForProvisional) : 0;
    // Confidence breakdown from the per-line `confidence` set above
    for (const l of boqLines) {
      const c = (l as Record<string, unknown>).confidence as { score?: string } | undefined;
      const k = c?.score === "high" ? "high" : c?.score === "low" ? "low" : "medium";
      cm.confidenceBreakdown[k]++;
    }
    // Rebar sources: `grade_based` if concreteGrade present on the source element, else `heuristic`
    const elemsWithGrade = (elements as Array<Record<string, unknown>>).filter(e => typeof e.concreteGrade === "string" && (e.concreteGrade as string).length > 0).length;
    cm.rebarSources = {
      grade_based: elemsWithGrade,
      heuristic: Math.max(0, cm.rebarItems - elemsWithGrade),
      ...(steelFromMarket ? { market_rate: cm.rebarItems } : {}),
    };
    if (cm.genericFallback > 0) cm.warnings.push(`${cm.genericFallback} line items used generic fallback rates`);
    if (cm.provisionalItems > cm.totalLineItems * 0.4) cm.warnings.push(`Provisional sums make up >40% of line items — add structural/MEP IFC for precision`);

    addLog(diag, "tr-008-cost", "info", `Cost mapping complete: ${cm.totalLineItems} lines (${cm.is1200Mapped} IS1200, ${cm.standardItems} std, ${cm.provisionalItems} prov)`, {
      hardCost: cm.totalHardCost, costPerSqm: cm.costPerSqm,
    });
  }

  // ── Rate staleness check ──
  const staleness = getStalenessLevel(IS1200_BASELINE, projectDate);
  if (staleness.severity === "critical") {
    aaceInfo.class = "Class 5";
    aaceInfo.accuracy = "±40-60%";
    aaceInfo.confidence = "LOW";
  }

  // ── Hard-stop check: rates expired AND no live data ──
  const hardStop = staleness.severity === "critical" && marketDataConfidence === "static" && marketDataStrikes >= 3;

  finalizeDiagnostics(diag);

  // Append a compact diagnostic summary into the NL summary so the
  // existing Execution Log panel surfaces the key facts without diving
  // into the BOQ visualizer's diagnostics panel.
  const diagLogLines = buildExecutionLogSummary(diag);
  const nlSummaryWithDiag = diagLogLines.length > 0
    ? `${nlSummary}\n\n── Pipeline Diagnostics ──\n${diagLogLines.join("\n")}`
    : nlSummary;

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "table",
    data: {
      label: `Bill of Quantities${isIndianProject ? ` (IS 1200 / ${indianPricing?.stateFactor?.state ?? "CPWD"} SOR)` : ""} — ${projectTypeInfo.type} (${activeRegion})`,
      headers,
      rows,
      _currency: currencyCode,
      _currencySymbol: currencySymbol,
      _totalCost: costSummary.totalCost,
      _hardCosts: hardCostWithEscalation,
      _softCosts: costSummary.softCosts,
      _escalation: escalation.amount,
      _region: activeRegion,
      _locationFactor: locationFactor,
      _projectType: projectTypeInfo.type,
      _projectMultiplier: projectTypeInfo.multiplier,
      _disclaimer: honestDisclaimer,
      _aaceClass: aaceInfo.class,
      _aaceAccuracy: aaceInfo.accuracy,
      _projectDate: projectDate.toISOString().split("T")[0],
      ...(staleness.severity !== "ok" && { _stalenessWarning: { severity: staleness.severity, years: staleness.years, message: staleness.message } }),
      _marketDataConfidence: marketDataConfidence,
      _marketDataSource: marketDataSource,
      _marketDataAgeDays: marketDataAgeDays,
      _marketDataStrikes: marketDataStrikes,
      ...(hardStop && { _hardStop: true, _hardStopReason: staleness.severity === "critical" ? "Rate library baseline expired (>4 years) and live market data unavailable" : "Live market data unavailable for 3 consecutive attempts" }),
      content: nlSummaryWithDiag,
      _pricingMetadata: pricingMetadata,
      _modelQualityReport: modelQualityReport,
      _diagnostics: diag,
      _boqData: {
        lines: boqLines,
        subtotalMaterial: Math.round(totalMaterial * 100) / 100,
        subtotalLabor: Math.round(totalLabor * 100) / 100,
        subtotalEquipment: Math.round(totalEquipment * 100) / 100,
        escalation: escalation.amount,
        projectType: projectTypeInfo.type,
        projectMultiplier: projectTypeInfo.multiplier,
        grandTotal: costSummary.totalCost,
        disclaimer: honestDisclaimer,
      },
      _gfa: gfaForProvisional,
      _ifcQuality: {
        score: geometryPct,
        qualityScore: geometryPct,
        label: ifcQuality,
        confidence: confidencePct,
        elementCoverage: totalElems > 0 ? Math.round((withGeometry / totalElems) * 100) : 0,
        withGeometry,
        totalElements: totalElems,
        missingFiles: [],
        anomalies: anomalies.map((a: string) => a),
      },
      _confidenceLevel: aaceInfo.confidence === "HIGH" ? "HIGH" : aaceInfo.confidence === "MEDIUM-HIGH" ? "MEDIUM" : aaceInfo.confidence,
      _benchmark: {
        ...benchmarkResult,
        // Override with dynamic market data when available (from Claude AI)
        ...(marketData?.typical_range_min > 0 ? { rangeLow: marketData.typical_range_min, rangeHigh: marketData.typical_range_max } : {}),
        ...(marketData?.benchmark_label ? { benchmarkLabel: marketData.benchmark_label } : {}),
      },
      ...(marketData && { _marketIntelligence: {
        status: marketData.agent_status,
        steel: `₹${marketData.steel_per_tonne.value.toLocaleString()}/tonne (${marketData.steel_per_tonne.confidence})`,
        cement: `₹${marketData.cement_per_bag.value}/bag ${marketData.cement_per_bag.brand} (${marketData.cement_per_bag.confidence})`,
        sand: `₹${marketData.sand_per_cft.value}/cft ${marketData.sand_per_cft.type} (${marketData.sand_per_cft.confidence})`,
        steelPerTonne: marketData.steel_per_tonne.value,
        steelSource: marketData.steel_per_tonne.source,
        steelConfidence: marketData.steel_per_tonne.confidence,
        cementPerBag: marketData.cement_per_bag.value,
        cementBrand: marketData.cement_per_bag.brand,
        cementSource: marketData.cement_per_bag.source,
        cementConfidence: marketData.cement_per_bag.confidence,
        labor: marketData.labor,
        sources: marketData.sources_summary,
        fetchedAt: marketData.fetched_at,
        searchCount: marketData.search_count,
        durationMs: marketData.duration_ms,
        fallbacksUsed: marketData.fallbacks_used,
      }}),
    },
    metadata: {
      model: isIndianProject ? "is1200-cpwd-v2" : "cost-database-v2",
      real: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      ...(indianPricing && {
        pricingIntelligence: {
          statePWD: indianPricing.stateFactor?.state ?? "CPWD National",
          cityTier: indianPricing.cityTier,
          overallFactor: indianPricing.overall,
          seasonalNotes: indianPricing.seasonal.notes,
          confidence: indianPricing.confidence,
          adjustmentNotes: indianPricing.notes,
        },
      }),
      benchmark: {
        costPerM2: benchmarkResult.costPerM2,
        rangeLow: benchmarkResult.benchmarkLow,
        rangeHigh: benchmarkResult.benchmarkHigh,
        status: benchmarkResult.status,
        severity: benchmarkResult.severity,
        message: benchmarkResult.message,
      },
      ...(marketData && {
        marketIntelligence: {
          status: marketData.agent_status,
          steel: `₹${marketData.steel_per_tonne.value.toLocaleString()}/tonne (${marketData.steel_per_tonne.confidence})`,
          cement: `₹${marketData.cement_per_bag.value}/bag ${marketData.cement_per_bag.brand} (${marketData.cement_per_bag.confidence})`,
          sand: `₹${marketData.sand_per_cft.value}/cft ${marketData.sand_per_cft.type} (${marketData.sand_per_cft.confidence})`,
          // Numeric values for Excel integration
          steelPerTonne: marketData.steel_per_tonne.value,
          steelSource: marketData.steel_per_tonne.source,
          steelConfidence: marketData.steel_per_tonne.confidence,
          cementPerBag: marketData.cement_per_bag.value,
          cementBrand: marketData.cement_per_bag.brand,
          cementSource: marketData.cement_per_bag.source,
          cementConfidence: marketData.cement_per_bag.confidence,
          sandPerCft: marketData.sand_per_cft.value,
          sandType: marketData.sand_per_cft.type,
          sandSource: marketData.sand_per_cft.source,
          labor: marketData.labor,
          sources: marketData.sources_summary,
          fetchedAt: marketData.fetched_at,
          searchCount: marketData.search_count,
          durationMs: marketData.duration_ms,
          fallbacksUsed: marketData.fallbacks_used,
        },
      }),
    },
    createdAt: new Date(),
  };
};
