// ─── Parse TR-008 Artifact → BOQData ────────────────────────────────────────
// Transforms the raw execution artifact into the structured BOQData type.

import type { BOQData, BOQLineItem, SourceType } from "@/features/boq/components/types";
import { computeSensitivities, DEFAULT_PRICES, getDivisionCategory } from "@/features/boq/components/recalc-engine";
import { getConfidenceLevelFromIFCScore, type ConfidenceLevel } from "@/features/boq/constants/quality-thresholds";
import { validateBOQArtifact } from "@/features/boq/schemas/boq-artifact.schema";
import { calculateBOQRange, getAACEDescription } from "@/features/boq/lib/cost-range";
import { computeSeasonalAdjustment } from "@/features/boq/lib/seasonal-adjustment";

/* eslint-disable @typescript-eslint/no-explicit-any */

function inferSource(desc: string, division: string, confidence: number): SourceType {
  if (division.toLowerCase().includes("provisional")) return "provisional";
  if (confidence >= 85) return "ifc-geometry";
  if (confidence >= 60) return "ifc-derived";
  return "benchmark";
}

function inferConfidence(source: string, division: string, description: string): number {
  const d = description.toLowerCase();
  const div = division.toLowerCase();
  if (div.includes("provisional")) return 45;
  if (d.includes("rcc") || d.includes("concrete") || d.includes("steel") || d.includes("brick")) return 90;
  if (d.includes("plaster") || d.includes("flooring") || d.includes("paint")) return 72;
  if (d.includes("hvac") || d.includes("electrical") || d.includes("plumbing")) return 50;
  return 65;
}

// ─── Extract IFC quality from all available sources ─────────────────────────
// TR-008 stores quality as metadata.warnings string OR via upstream _ifcContext
function extractIfcQuality(data: any): BOQData["ifcQuality"] | undefined {
  // Direct quality objects (various naming conventions)
  const ifcQ = data._ifcQuality || data._ifcAssessment;
  if (ifcQ && (ifcQ.score || ifcQ.qualityScore)) {
    return {
      score: ifcQ.score || ifcQ.qualityScore || 0,
      confidence: ifcQ.confidence || ifcQ.overallConfidence || 0,
      elementCoverage: ifcQ.elementCoverage || ifcQ.coverage || 0,
      missingFiles: ifcQ.missingFiles || ifcQ.missing || [],
      anomalies: ifcQ.anomalies || [],
    };
  }

  // Extract from _ifcContext (TR-007 passes this downstream)
  const ifcCtx = data._ifcContext;
  if (ifcCtx) {
    // _ifcContext has: totalFloors, totalGFA, dominantStructure, etc.
    // We can infer quality from geometry completeness
    const geometryPct = ifcCtx.geometryCompleteness ?? ifcCtx.geometryPct ?? 0;
    const overallQuality = ifcCtx.overallQuality;
    if (geometryPct > 0 || overallQuality) {
      const score = geometryPct || (
        overallQuality === "EXCELLENT" ? 92 :
        overallQuality === "GOOD" ? 78 :
        overallQuality === "FAIR" ? 55 : 30
      );
      return {
        score,
        confidence: Math.min(95, score + (ifcCtx.hasStructuralFoundation ? 8 : 0) + (ifcCtx.hasMEPData ? 10 : 0)),
        elementCoverage: geometryPct || score,
        missingFiles: ifcCtx.missingFiles || [],
        anomalies: ifcCtx.anomalies || [],
      };
    }
  }

  // Parse from metadata warnings string (TR-008 embeds IFC quality here)
  // Format: "📋 IFC Quality: GOOD (78% confidence) | 125/150 elements with geometry | ..."
  const metadata = data._metadata || data.metadata;
  const warnings = metadata?.warnings;
  if (typeof warnings === "string" && warnings.includes("IFC Quality")) {
    const qualityMatch = warnings.match(/IFC Quality:\s*(\w+)\s*\((\d+)%\s*confidence\)/);
    const elemMatch = warnings.match(/(\d+)\/(\d+)\s*elements/);
    if (qualityMatch) {
      const label = qualityMatch[1]; // EXCELLENT, GOOD, FAIR, POOR
      const confPct = parseInt(qualityMatch[2], 10);
      const score = label === "EXCELLENT" ? 92 : label === "GOOD" ? 78 : label === "FAIR" ? 55 : 30;
      const coverage = elemMatch ? Math.round((parseInt(elemMatch[1]) / parseInt(elemMatch[2])) * 100) : score;
      return {
        score,
        confidence: confPct,
        elementCoverage: coverage,
        missingFiles: [],
        anomalies: [],
      };
    }
  }

  // Infer from _boqData line items — if most lines have IFC geometry source
  const boqLines = (data._boqData?.lines || []) as any[];
  if (boqLines.length > 5) {
    const withGeometry = boqLines.filter((l: any) => {
      const d = (l.description || "").toLowerCase();
      return d.includes("rcc") || d.includes("concrete") || d.includes("slab") || d.includes("wall") || d.includes("steel") || d.includes("brick");
    }).length;
    const pct = Math.round((withGeometry / boqLines.length) * 100);
    if (pct > 20) {
      return {
        score: Math.min(95, pct + 15), // Boost since these are IFC-sourced
        confidence: Math.min(90, pct + 10),
        elementCoverage: pct,
        missingFiles: data._hasMEPData === false ? ["MEP Services Model"] : [],
        anomalies: [],
      };
    }
  }

  return undefined;
}

export function parseArtifactToBOQ(artifactData: any): BOQData | null {
  if (!artifactData) return null;

  // ── Zod validation at boundary ─────────────────────────────────────────
  const validation = validateBOQArtifact(artifactData);
  if (validation.warnings.length > 0 && process.env.NODE_ENV === "development") {
    console.warn("[parseArtifactToBOQ] Validation warnings:", validation.warnings);
  }
  if (!validation.success) {
    console.error("[parseArtifactToBOQ] Validation failed:", validation.errors);
    // Don't return null immediately — try legacy parsing as fallback
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: Record<string, any>;
  if (typeof artifactData === "string") {
    try { data = JSON.parse(artifactData); }
    catch { return null; }
  } else {
    data = artifactData;
  }

  // Extract from TR-008 _boqData structure
  const boqData = data._boqData || data.boqData || data;
  const lines: any[] = boqData.lines || boqData.rows || [];

  if (lines.length === 0 && data.rows) {
    // Fallback: parse from table rows format
    return parseFromTableRows(data);
  }

  const parsedLines: BOQLineItem[] = lines.map((line: any, idx: number) => {
    // Derive numeric confidence: prefer explicit number, then structured score, then source-aware default
    let conf: number = typeof line.confidence === "number" ? line.confidence : 0;
    if (!conf && line.confidence?.score) {
      conf = line.confidence.score === "high" ? 85 : line.confidence.score === "medium" ? 65 : 35;
    }
    if (!conf) {
      // Source-aware default so cost ranges are always meaningful
      const src = (line.source || line.division || "").toLowerCase();
      if (src.includes("ifc") && src.includes("geometry")) conf = 85;
      else if (src.includes("ifc") && src.includes("derived")) conf = 70;
      else if (src.includes("provisional")) conf = 30;
      else conf = inferConfidence("", line.division || "", line.description || "");
    }
    // Final NaN guard — confidence must always be a valid number
    if (!conf || !Number.isFinite(conf) || conf < 0) conf = 50;

    // Safe number helper — protects against undefined/NaN/null from upstream
    const n = (v: unknown): number => { const num = Number(v); return Number.isFinite(num) ? num : 0; };

    const matRate = n(line.materialRate);
    const labRate = n(line.laborRate);
    const eqpRate = n(line.equipmentRate);

    return {
      id: `boq-${idx}`,
      division: line.division || "Unclassified",
      isCode: line.is1200Code || line.csiCode || line.isCode || "",
      description: line.description || "",
      unit: line.unit || "LS",
      quantity: n(line.quantity),
      wasteFactor: n(line.wasteFactor) || 0.05,
      adjustedQty: n(line.adjustedQty) || n(line.quantity),
      materialRate: matRate,
      laborRate: labRate,
      equipmentRate: eqpRate,
      unitRate: n(line.unitRate) || (matRate + labRate + eqpRate),
      materialCost: n(line.materialCost),
      laborCost: n(line.laborCost),
      equipmentCost: n(line.equipmentCost),
      totalCost: n(line.totalCost),
      storey: line.storey,
      elementCount: line.elementCount,
      source: inferSource(line.description || "", line.division || "", conf),
      confidence: conf,
      lineConfidence: line.confidence && typeof line.confidence === "object"
        ? { score: line.confidence.score || "medium", factors: line.confidence.factors || [] }
        : undefined,
      steelSensitivity: 0,
      cementSensitivity: 0,
      masonSensitivity: 0,
      bricksSensitivity: 0,
      sandSensitivity: 0,
      timberSensitivity: 0,
    };
  });

  // Compute sensitivity coefficients
  const linesWithSensitivity = computeSensitivities(parsedLines, DEFAULT_PRICES);

  // Market data
  const market = data._marketIntelligence;
  const marketParsed = market ? {
    steelPerTonne: market.steelPerTonne || DEFAULT_PRICES.steel,
    steelSource: market.steelSource || "SAIL Bhilai",
    steelConfidence: market.steelConfidence || "HIGH",
    cementPerBag: market.cementPerBag || DEFAULT_PRICES.cement,
    cementBrand: market.cementBrand || "UltraTech",
    cementSource: market.cementSource || "Regional dealer",
    cementConfidence: market.cementConfidence || "MEDIUM",
    masonRate: market.labor?.mason?.value || DEFAULT_PRICES.mason,
    masonSource: market.labor?.mason?.source || "Local market",
    masonConfidence: market.labor?.mason?.confidence || "MEDIUM",
    sandPerCft: market.sandPerCft || DEFAULT_PRICES.sand,
    sandSource: market.sandSource || "Local market",
    bricksPerNos: market.bricksPerNos || DEFAULT_PRICES.bricks,
    timberPerSqm: market.timberPerSqm || DEFAULT_PRICES.timber,
  } : undefined;

  // Benchmark — read from TR-008 _benchmark (includes dynamic market overrides)
  const bench = data._benchmark || {};
  // Also check for rangeLow/rangeHigh which are market-overridden values
  const benchmarkLow = bench.rangeLow || bench.benchmarkLow || 0;
  const benchmarkHigh = bench.rangeHigh || bench.benchmarkHigh || 0;

  // IFC Quality — robust extraction from multiple sources
  const ifcQuality = extractIfcQuality(data);

  // MEP Breakdown — derive from provisional lines if not provided
  const mepLines = linesWithSensitivity.filter(l =>
    getDivisionCategory(l.division, l.description) === "MEP"
  );
  const totalMep = mepLines.reduce((s, l) => s + l.totalCost, 0);

  const mepBreakdown = data._mepBreakdown || (totalMep > 0 ? buildMepBreakdown(mepLines, totalMep) : undefined);

  // Label parsing for project info
  const label = data.label || "";
  const locationMatch = label.match(/\(([^)]+)\)/);
  const projectTypeMatch = label.match(/—\s*(\w[\w\s]*)\s*\(/);

  // ── Cost Totals ───────────────────────────────────────────────────────────
  // TR-008 sets:
  //   _totalCost = hardCosts + softCosts (the FULL project cost)
  //   _hardCosts = hardCostWithEscalation (material + labor + equipment + escalation)
  //   _softCosts = professional fees, contingency, PM, etc.
  // Line items sum to hard cost subtotal (before escalation & soft costs)
  const lineTotal = linesWithSensitivity.reduce((s, l) => s + l.totalCost, 0);
  const hardCosts = data._hardCosts || boqData.grandTotal || lineTotal;
  const softCosts = data._softCosts || 0;
  const escalation = data._escalation || boqData.escalation || 0;
  // Total project cost is ALWAYS hard + soft (not just line total)
  const totalProjectCost = data._totalCost || (hardCosts + softCosts);

  // Confidence level — derive from IFC quality if available
  const confLevel: ConfidenceLevel = data._confidenceLevel ||
    (ifcQuality ? getConfidenceLevelFromIFCScore(ifcQuality.score) : "LOW");

  // ── Cost Range Calculation ─────────────────────────────────────────────
  const softCostRatio = hardCosts > 0 ? softCosts / hardCosts : 0;
  const rangeResult = calculateBOQRange(linesWithSensitivity, softCostRatio);
  const aaceClassStr = data._aaceClass || "Class 4";

  return {
    projectName: data._projectName || projectTypeMatch?.[1]?.trim() || data._projectType || "Construction Project",
    location: data._region || locationMatch?.[1] || "India",
    date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    currency: data._currency || "INR",
    currencySymbol: data._currencySymbol || "₹",
    gfa: data._gfa || 0,
    projectType: data._projectType || projectTypeMatch?.[1]?.trim() || "Commercial",

    lines: linesWithSensitivity,

    totalCost: totalProjectCost,
    hardCosts,
    softCosts,
    escalation,
    subtotalMaterial: boqData.subtotalMaterial || linesWithSensitivity.reduce((s, l) => s + l.materialCost, 0),
    subtotalLabor: boqData.subtotalLabor || linesWithSensitivity.reduce((s, l) => s + l.laborCost, 0),
    subtotalEquipment: boqData.subtotalEquipment || linesWithSensitivity.reduce((s, l) => s + l.equipmentCost, 0),
    grandTotal: totalProjectCost,

    benchmark: {
      costPerM2: bench.costPerM2 || (data._gfa > 0 ? totalProjectCost / data._gfa : 0),
      benchmarkLow,
      benchmarkHigh,
      status: bench.status || "within",
      severity: bench.severity || "ok",
      message: bench.message || bench.benchmarkLabel || "",
      buildingType: bench.buildingType || data._projectType || "Commercial",
      cityTier: bench.cityTier || "Metro",
    },

    market: marketParsed,
    ifcQuality,
    mepBreakdown,

    aaceClass: aaceClassStr,
    aaceDescription: getAACEDescription(aaceClassStr),
    confidenceLevel: confLevel,

    costRange: {
      totalLow: rangeResult.total.low,
      totalHigh: rangeResult.total.high,
      totalBest: rangeResult.total.best,
      hardLow: rangeResult.hardCosts.low,
      hardHigh: rangeResult.hardCosts.high,
      hardBest: rangeResult.hardCosts.best,
      uncertaintyPercent: rangeResult.total.uncertaintyPercent,
    },

    summary: data.content || data._summary || "",
    disclaimer: data._disclaimer || boqData.disclaimer || "This is an AI-generated estimate for preliminary budgeting purposes only. Verify all quantities with detailed measurement before procurement.",

    // Seasonal info — informational only (costs NOT adjusted by TR-008 yet)
    ...(() => {
      const locState = data._pricingMetadata?.stateUsed || data._region || "";
      if (!locState) return {};
      const seasonal = computeSeasonalAdjustment(locState);
      if (!seasonal.applied) return {};
      return {
        seasonalAdjustment: {
          applied: true,
          month: seasonal.monthName,
          laborMultiplier: seasonal.laborMultiplier,
          overallImpactPercent: seasonal.overallImpactPercent,
          description: `Informational only — standard rates used. ${seasonal.description}`,
        },
      };
    })(),

    // Phase 3: Transparency layer
    ...(data._pricingMetadata && { pricingMetadata: data._pricingMetadata }),
    ...(data._modelQualityReport && { modelQualityReport: data._modelQualityReport }),
    ...(data._diagnostics && { diagnostics: data._diagnostics }),
  };
}

function parseFromTableRows(data: any): BOQData | null {
  // Fallback: parse from the table format (headers + rows)
  const headers: string[] = data.headers || [];
  const rows: any[][] = data.rows || [];

  if (rows.length === 0) return null;

  const descIdx = headers.findIndex((h: string) => h.toLowerCase().includes("description"));
  const unitIdx = headers.findIndex((h: string) => h.toLowerCase().includes("unit"));
  const qtyIdx = headers.findIndex((h: string) => h.toLowerCase().includes("qty"));
  const rateIdx = headers.findIndex((h: string) => h.toLowerCase().includes("rate"));
  const totalIdx = headers.findIndex((h: string) => h.toLowerCase().includes("total"));

  const parsedLines: BOQLineItem[] = rows
    .filter((row: any[]) => row[descIdx] && !String(row[descIdx]).startsWith("─"))
    .map((row: any[], idx: number) => {
      const desc = String(row[descIdx] || "");
      const totalStr = String(row[totalIdx] || "0").replace(/[₹$,]/g, "");
      const rateStr = String(row[rateIdx] || "0").replace(/[₹$,]/g, "");
      const qtyStr = String(row[qtyIdx] || "0").replace(/[,]/g, "");
      const total = parseFloat(totalStr) || 0;
      const rate = parseFloat(rateStr) || 0;
      const qty = parseFloat(qtyStr) || 0;
      const conf = inferConfidence("", "", desc);

      return {
        id: `boq-${idx}`,
        division: "General",
        isCode: "",
        description: desc,
        unit: String(row[unitIdx] || "LS"),
        quantity: qty,
        wasteFactor: 0.05,
        adjustedQty: qty * 1.05,
        materialRate: rate * 0.55,
        laborRate: rate * 0.35,
        equipmentRate: rate * 0.10,
        unitRate: rate,
        materialCost: total * 0.55,
        laborCost: total * 0.35,
        equipmentCost: total * 0.10,
        totalCost: total,
        source: inferSource(desc, "", conf),
        confidence: conf,
        steelSensitivity: 0,
        cementSensitivity: 0,
        masonSensitivity: 0,
        bricksSensitivity: 0,
        sandSensitivity: 0,
        timberSensitivity: 0,
      };
    });

  const linesWithSensitivity = computeSensitivities(parsedLines, DEFAULT_PRICES);
  const lineTotal = linesWithSensitivity.reduce((s, l) => s + l.totalCost, 0);
  const hardCosts = data._hardCosts || lineTotal;
  const softCosts = data._softCosts || 0;
  const totalCost = data._totalCost || (hardCosts + softCosts);
  const ifcQuality = extractIfcQuality(data);
  const bench = data._benchmark || {};

  return {
    projectName: data._projectType || "Construction Project",
    location: data._region || "India",
    date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    currency: data._currency || "INR",
    currencySymbol: data._currencySymbol || "₹",
    gfa: data._gfa || 0,
    projectType: data._projectType || "Commercial",
    lines: linesWithSensitivity,
    totalCost,
    hardCosts,
    softCosts,
    escalation: data._escalation || 0,
    subtotalMaterial: linesWithSensitivity.reduce((s, l) => s + l.materialCost, 0),
    subtotalLabor: linesWithSensitivity.reduce((s, l) => s + l.laborCost, 0),
    subtotalEquipment: linesWithSensitivity.reduce((s, l) => s + l.equipmentCost, 0),
    grandTotal: totalCost,
    benchmark: {
      costPerM2: bench.costPerM2 || (data._gfa ? totalCost / data._gfa : 0),
      benchmarkLow: bench.rangeLow || bench.benchmarkLow || 0,
      benchmarkHigh: bench.rangeHigh || bench.benchmarkHigh || 0,
      status: bench.status || "within",
      severity: bench.severity || "ok",
      message: bench.message || bench.benchmarkLabel || "",
      buildingType: bench.buildingType || data._projectType || "Commercial",
      cityTier: bench.cityTier || "Metro",
    },
    ifcQuality,
    aaceClass: "Class 3",
    confidenceLevel: ifcQuality && ifcQuality.score >= 80 ? "HIGH" : ifcQuality && ifcQuality.score >= 55 ? "MEDIUM" : "LOW",
    summary: data.content || "",
    disclaimer: data._disclaimer || "AI-generated estimate for preliminary budgeting. Verify all quantities before procurement.",
  };
}

function buildMepBreakdown(mepLines: BOQLineItem[], totalMep: number) {
  const categorize = (keywords: string[]) => {
    const lines = mepLines.filter(l => keywords.some(k => l.description.toLowerCase().includes(k)));
    const cost = lines.reduce((s, l) => s + l.totalCost, 0);
    return { cost, percentage: totalMep > 0 ? (cost / totalMep) * 100 : 0 };
  };

  return {
    hvac: { ...categorize(["hvac", "air condition", "ventilat", "duct"]), reasoning: "Based on GFA and building type profile" },
    electrical: { ...categorize(["electric", "wiring", "switch", "panel", "lighting"]), reasoning: "Based on GFA and building type profile" },
    plumbing: { ...categorize(["plumb", "pipe", "drainage", "sanitary", "water"]), reasoning: "Based on GFA and floor count" },
    fire: { ...categorize(["fire", "sprinkler", "alarm", "suppression"]), reasoning: "Statutory requirement for building type" },
    lifts: { ...categorize(["lift", "elevator", "escalator"]), reasoning: "Based on floor count and building use" },
  };
}
