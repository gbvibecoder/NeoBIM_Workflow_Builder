import {
  generateId,
  findUnitRate,
  calculateTotalCost,
  calculateLineItemCost,
  calculateEscalation,
  detectProjectType,
  buildDynamicDisclaimer,
  getCostBreakdown,
  detectRegionFromText,
} from "./deps";
import type { NodeHandler } from "./types";

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
    // steelFromMarket stays false — will use static IS 1200 rates
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

  // ── Location-aware pricing (from IN-006 Location Input or text detection) ──
  // IN-006 stores JSON in inputData.content/prompt: { country, state, city, currency }
  let locationData: { country?: string; state?: string; city?: string; currency?: string; escalation?: string; contingency?: string; months?: string; soilType?: string; plotArea?: string } | null = null;
  for (const field of [inputData?.content, inputData?.prompt, inputData?.region, inputData?.location]) {
    if (typeof field === "string" && field.startsWith("{")) {
      try { locationData = JSON.parse(field); break; } catch { /* not JSON */ }
    }
  }

  // Import regional factors
  const { resolveProjectLocation } = await import("@/constants/regional-factors");

  let activeRegion = "USA (baseline)";
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let regionWasAutoDetected = true;
  let locationFactor = 1.0;
  let currencySymbol = "$";
  let currencyCode = "USD";
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
    const regionInput = inputData?.region ?? inputData?.location ?? "USA (baseline)";
    const upstreamNarrative = inputData?.content ?? inputData?.narrative ?? "";
    const explicitRegion = regionInput !== "USA (baseline)" ? regionInput : "";
    const detectedRegion = detectRegionFromText(
      typeof explicitRegion === "string" && explicitRegion
        ? explicitRegion
        : (typeof upstreamNarrative === "string" ? upstreamNarrative : "")
    );
    activeRegion = (typeof detectedRegion === "string" && detectedRegion) || (typeof regionInput === "string" ? regionInput : "USA (baseline)");
    regionWasAutoDetected = !detectedRegion && regionInput === "USA (baseline)";
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
  let indianPricing: Awaited<ReturnType<typeof import("@/constants/indian-pricing-factors").calculateIndianPricingAdjustment>> | null = null;
  if (isIndianProject) {
    is1200Module = await import("@/features/boq/constants/is1200-rates");
    const { calculateIndianPricingAdjustment } = await import("@/constants/indian-pricing-factors");
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

  // Process each element (may include expanded material layers)
  for (const elem of expandedElements) {
    const description = typeof elem === "string" ? elem : elem.description ?? elem[0];
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
            // Rebar: estimated from concrete volume × kg/m³ ratio
            const isStructSteel = rate.subcategory === "Steel" && !rate.is1200Code.includes("REBAR");
            if (isStructSteel && sourceVolume > 0) {
              qty = sourceVolume * 7850; // steel density 7850 kg/m³
            } else if (sourceVolume > 0) {
              qty = sourceVolume * 150; // rebar estimate from concrete volume
            } else {
              qty = (elemCount || 1) * 50; // fallback: 50 kg per element
            }
          } else if (rate.unit === "Rmt") {
            qty = quantity; // linear measure
          } else {
            qty = quantity;
          }

          const wasteFactor = is1200Module.getIS1200Rate(rate.is1200Code)
            ? (({ "Concrete": 0.07, "Steel": 0.10, "Masonry": 0.08, "Finishes": 0.12, "Doors & Windows": 0.03 })[rate.subcategory] ?? 0.08)
            : 0.08;
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
          let adjRate = Math.round(rate.rate * categoryFactor * gradeMult * 100) / 100;

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
            matCost = Math.round(adjQty * rate.material * categoryFactor * gradeMult * 100) / 100;
            labCost = Math.round(adjQty * rate.labour * laborFactor * gradeMult * 100) / 100;
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
          const adjRate2 = Math.round(genericRate.rate * cf * 100) / 100;
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

    // ── Standard path: USD rates with regional factor conversion (non-Indian projects only) ──
    // Build specific search: try "Concrete Wall" before generic "Wall"
    // Material/category context from TR-007 helps disambiguate rate matching
    const specificDesc = elemCategory && !description.toLowerCase().includes(elemCategory.toLowerCase())
      ? `${elemCategory} ${description}`
      : description;
    const unitRateData = findUnitRate(specificDesc) || findUnitRate(description);

    if (unitRateData && unitRateData.category === "hard") {
      // Select correct quantity and convert metric → imperial to match rate unit
      const rateU = unitRateData.unit.toUpperCase();
      let convertedQty = quantity;
      let displayUnit = unitRateData.unit;

      if (rateU === "CY" && sourceVolume > 0) {
        // Rate expects volume in CY — use totalVolume (m³ → CY)
        convertedQty = Math.round(sourceVolume * 1.30795 * 100) / 100;
      } else if (rateU === "CY" && (sourceUnit === "m³" || sourceUnit === "m3")) {
        convertedQty = Math.round(quantity * 1.30795 * 100) / 100;
      } else if ((rateU === "SF" || rateU === "SFCA") && sourceArea > 0) {
        // Rate expects area in SF — use grossArea (m² → SF)
        convertedQty = Math.round(sourceArea * 10.7639 * 100) / 100;
      } else if ((rateU === "SF" || rateU === "SFCA") && (sourceUnit === "m²" || sourceUnit === "m2")) {
        convertedQty = Math.round(quantity * 10.7639 * 100) / 100;
      } else if (rateU === "LF" && sourceUnit === "m") {
        convertedQty = Math.round(quantity * 3.28084 * 100) / 100;
      } else if (rateU === "TON" && sourceVolume > 0) {
        // Steel: m³ → tonnage (7850 kg/m³ density)
        convertedQty = Math.round(sourceVolume * 7.85 * 100) / 100;
        displayUnit = "ton";
      }

      const lineItem = calculateLineItemCost(unitRateData, convertedQty, activeRegion, projectTypeInfo.type);

      // Apply location-based factor (country × city tier) and convert currency
      const lf = locationFactor; // 1.0 for USA baseline
      const fx = exchangeRate;   // 1.0 for USD
      const cs = currencySymbol; // "$" for USD
      const adjRate = Math.round(lineItem.adjustedRate * lf * fx * 100) / 100;
      const matCost = Math.round(lineItem.materialCost * lf * fx * 100) / 100;
      const labCost = Math.round(lineItem.laborCost * lf * fx * 100) / 100;
      const eqpCost = Math.round(lineItem.equipmentCost * lf * fx * 100) / 100;
      const lineTot = Math.round(lineItem.lineTotal * lf * fx * 100) / 100;

      hardCostSubtotal += lineTot;
      totalMaterial += matCost;
      totalLabor += labCost;
      totalEquipment += eqpCost;

      rows.push([
        description,
        displayUnit,
        convertedQty.toFixed(2),
        `${(lineItem.wasteFactor * 100).toFixed(0)}%`,
        lineItem.totalQty.toFixed(2),
        `${cs}${adjRate.toFixed(2)}`,
        `${cs}${matCost.toFixed(2)}`,
        `${cs}${labCost.toFixed(2)}`,
        `${cs}${eqpCost.toFixed(2)}`,
        `${cs}${lineTot.toFixed(2)}`,
      ]);

      boqLines.push({
        division: unitRateData.subcategory,
        csiCode: "00 00 00",
        description,
        unit: displayUnit,
        quantity: convertedQty,
        wasteFactor: lineItem.wasteFactor,
        adjustedQty: lineItem.totalQty,
        materialRate: Math.round(adjRate * getCostBreakdown(unitRateData.subcategory).material * 100) / 100,
        laborRate: Math.round(adjRate * getCostBreakdown(unitRateData.subcategory).labor * 100) / 100,
        equipmentRate: Math.round(adjRate * getCostBreakdown(unitRateData.subcategory).equipment * 100) / 100,
        unitRate: adjRate,
        materialCost: matCost,
        laborCost: labCost,
        equipmentCost: eqpCost,
        totalCost: lineTot,
        storey: elemStorey || undefined,
        elementCount: elemCount || undefined,
        is1200Code: isIndianProject ? "IS1200-CSI-MAPPED" : undefined,
      });
      pathUSD++; costUSD += lineTot;
    } else {
      // Fallback for unknown items — estimate with default waste
      estimatedItemsCount++;
      // For Indian projects: use ₹5,000/unit as reasonable fallback (not USD×0.266 which gives nonsense)
      const fallbackRate = isIndianProject ? 5000 : 100 * locationFactor * exchangeRate;
      const defaultWaste = 0.10;
      const adjQty = quantity * (1 + defaultWaste);
      const lineTotal = adjQty * fallbackRate;
      const breakdown = getCostBreakdown("Finishes"); // default
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
        is1200Code: isIndianProject ? "IS1200-EST" : undefined,
      });
      pathFallback++; costFallback += Math.round(lineTotal * 100) / 100;
    }
  }

  // ── DIAGNOSTIC: Path breakdown ──

  // ── Derived quantities: Formwork, Rebar, Finishing ──
  // For Indian projects, use CPWD rates directly with IS 1200 codes.
  // For non-Indian, use DERIVED_RATES from regional-factors.ts.
  const { DERIVED_RATES } = await import("@/constants/regional-factors");

  // Fix 4: Plaster dedup — find storeys that already have plaster from IFC Geometry extraction
  // (IfcCovering CEILING/FLOORING or explicit plaster elements). Skip derived plaster for those.
  const storeysWithPlaster = new Set<string>();
  const storeysWithCeiling = new Set<string>();
  for (const line of boqLines) {
    const d = line.description.toLowerCase();
    const s = line.storey || "";
    if (d.includes("plaster") && !d.includes("formwork") && !d.includes("rebar")) {
      storeysWithPlaster.add(s);
    }
    if (d.includes("ceiling") && !d.includes("formwork")) {
      storeysWithCeiling.add(s);
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
    const vol = Number(e.totalVolume ?? 0);
    const descLower = desc.toLowerCase();

    const applyDerived = (name: string, baseQty: number, rateUSD: number, dUnit: string, source: string, is1200Key: string) => {
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
      } else if (isIndianProject && (is1200Key === "plastering" || is1200Key === "ceiling-plaster") && is1200Module) {
        const plastRate = is1200Module.getIS1200Rate("IS1200-P8-PLASTER");
        const finFactor = ip?.finishing ?? ip?.overall ?? 1.0;
        adjRate = plastRate ? Math.round(plastRate.rate * finFactor * 100) / 100 : Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
      } else {
        adjRate = Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
      }

      const waste = 0.05;
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

      const is1200Info = isIndianProject ? DERIVED_IS1200[is1200Key] : null;
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
      applyDerived(`Formwork — ${desc}`, area * 2, DERIVED_RATES.formwork.wall.rate, "m²", "Formwork (Measured)", "formwork-wall");
      applyDerived(`Rebar — ${desc} (Est.)`, vol * DERIVED_RATES.rebar.wall.kgPerM3, DERIVED_RATES.rebar.wall.rate, "kg", "Rebar (Estimated)", "rebar");
      // Fix 4: Skip derived plaster if IFC already has plaster for this storey
      if (!storeysWithPlaster.has(st)) {
        applyDerived(`Plastering — ${desc}`, area * 2, DERIVED_RATES.finishing.plastering.rate, "m²", "Finishing (Measured)", "plastering");
      }
    } else if (descLower.includes("slab")) {
      applyDerived(`Formwork — ${desc}`, area, DERIVED_RATES.formwork.slab.rate, "m²", "Formwork (Measured)", "formwork-slab");
      applyDerived(`Rebar — ${desc} (Est.)`, vol * DERIVED_RATES.rebar.slab.kgPerM3, DERIVED_RATES.rebar.slab.rate, "kg", "Rebar (Estimated)", "rebar");
      // Fix 4: Skip derived ceiling plaster if IFC already has ceiling for this storey
      if (!storeysWithCeiling.has(st)) {
        applyDerived(`Ceiling Plaster — ${desc}`, area, DERIVED_RATES.finishing.ceilingPlaster.rate, "m²", "Finishing (Measured)", "ceiling-plaster");
      }
    } else if (descLower.includes("column")) {
      const colHeight = Number(e.totalVolume ?? 0) > 0 ? 3.5 : 0;
      const colRadius = vol > 0 && colHeight > 0 ? Math.sqrt(vol / (Math.PI * colHeight)) : 0.3;
      const colFormworkArea = 2 * Math.PI * colRadius * colHeight * Number(e.elementCount ?? 1);
      applyDerived(`Formwork — ${desc}`, colFormworkArea, DERIVED_RATES.formwork.column.rate, "m²", "Formwork (Measured)", "formwork-column");
      applyDerived(`Rebar — ${desc} (Est.)`, vol * DERIVED_RATES.rebar.column.kgPerM3, DERIVED_RATES.rebar.column.rate, "kg", "Rebar (Estimated)", "rebar");
    }
  }

  // Add derived lines to boqLines
  boqLines.push(...derivedLines);

  // ── Provisional Sums: MEP, Foundation, External Works ──
  // Skip provisional estimates when real data from structural/MEP IFC is available
  const { estimateMEPCosts, estimateFoundationCosts, estimateExternalWorksCosts, checkQuantitySanity } = await import("@/features/boq/services/boq-intelligence");
  const gfaForProvisional = elements.reduce((sum: number, e: unknown) => {
    const el = e as Record<string, unknown>;
    return sum + (String(el.description ?? "").toLowerCase().includes("slab") ? Number(el.grossArea ?? 0) : 0);
  }, 0) || 500;
  const floorCountForProv = new Set(elements.map((e: unknown) => (e as Record<string, unknown>).storey).filter(Boolean)).size || 1;
  const cityTierForProv = indianPricing?.cityTier ?? "city";

  // Diagnostic: cost per m² tracing

  // Check flags from TR-007 multi-IFC merge
  const hasStructuralFoundation = !!(inputData?._hasStructuralFoundation);
  const hasMEPData = !!(inputData?._hasMEPData);

  // MEP: skip provisional if real MEP IFC data exists
  const mepSums = hasMEPData ? [] : estimateMEPCosts(gfaForProvisional, projectTypeInfo.type, floorCountForProv, cityTierForProv, isIndianProject);

  // Foundation: skip provisional if real structural IFC data exists
  const soilType = locationData?.soilType as string | undefined;
  const plotArea = locationData?.plotArea ? Number(locationData.plotArea) : undefined;
  const foundSums = hasStructuralFoundation ? [] : estimateFoundationCosts(gfaForProvisional, floorCountForProv, projectTypeInfo.type, cityTierForProv, isIndianProject, soilType || undefined);

  // External works always provisional (rarely in IFC)
  const extSums = estimateExternalWorksCosts(gfaForProvisional, floorCountForProv, cityTierForProv, isIndianProject, (plotArea && plotArea > 0) ? plotArea : undefined);

  const allProvisional = [...foundSums, ...mepSums, ...extSums];
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
    const staticMin = STATIC_FLOORS[btKey] ?? STATIC_FLOORS.commercial;
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
    dynamicBench
  );

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
      _disclaimer: dynamicDisclaimer,
      _aaceClass: aaceInfo.class,
      _aaceAccuracy: aaceInfo.accuracy,
      content: nlSummary,
      _boqData: {
        lines: boqLines,
        subtotalMaterial: Math.round(totalMaterial * 100) / 100,
        subtotalLabor: Math.round(totalLabor * 100) / 100,
        subtotalEquipment: Math.round(totalEquipment * 100) / 100,
        escalation: escalation.amount,
        projectType: projectTypeInfo.type,
        projectMultiplier: projectTypeInfo.multiplier,
        grandTotal: costSummary.totalCost,
        disclaimer: dynamicDisclaimer,
      },
      _gfa: gfaForProvisional,
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
