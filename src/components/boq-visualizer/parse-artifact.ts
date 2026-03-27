// ─── Parse TR-008 Artifact → BOQData ────────────────────────────────────────
// Transforms the raw execution artifact into the structured BOQData type.

import type { BOQData, BOQLineItem, SourceType } from "./types";
import { computeSensitivities, DEFAULT_PRICES, getDivisionCategory } from "./recalc-engine";

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

export function parseArtifactToBOQ(artifactData: any): BOQData | null {
  if (!artifactData) return null;

  const data = typeof artifactData === "string" ? JSON.parse(artifactData) : artifactData;

  // Extract from TR-008 _boqData structure
  const boqData = data._boqData || data.boqData || data;
  const lines: any[] = boqData.lines || boqData.rows || [];

  if (lines.length === 0 && data.rows) {
    // Fallback: parse from table rows format
    return parseFromTableRows(data);
  }

  const parsedLines: BOQLineItem[] = lines.map((line: any, idx: number) => {
    const conf = line.confidence ?? inferConfidence("", line.division || "", line.description || "");
    return {
      id: `boq-${idx}`,
      division: line.division || "Unclassified",
      isCode: line.is1200Code || line.csiCode || line.isCode || "",
      description: line.description || "",
      unit: line.unit || "LS",
      quantity: line.quantity || 0,
      wasteFactor: line.wasteFactor || 0.05,
      adjustedQty: line.adjustedQty || line.quantity || 0,
      materialRate: line.materialRate || 0,
      laborRate: line.laborRate || 0,
      equipmentRate: line.equipmentRate || 0,
      unitRate: line.unitRate || line.materialRate + line.laborRate + line.equipmentRate || 0,
      materialCost: line.materialCost || 0,
      laborCost: line.laborCost || 0,
      equipmentCost: line.equipmentCost || 0,
      totalCost: line.totalCost || 0,
      storey: line.storey,
      elementCount: line.elementCount,
      source: inferSource(line.description || "", line.division || "", conf),
      confidence: conf,
      steelSensitivity: 0,
      cementSensitivity: 0,
      masonSensitivity: 0,
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
  } : undefined;

  // Benchmark
  const bench = data._benchmark || {};

  // IFC Quality
  const ifcQ = data._ifcQuality || data._ifcAssessment;

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

  return {
    projectName: data._projectName || projectTypeMatch?.[1]?.trim() || data._projectType || "Construction Project",
    location: data._region || locationMatch?.[1] || "India",
    date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    currency: data._currency || "INR",
    currencySymbol: data._currencySymbol || "₹",
    gfa: data._gfa || 0,
    projectType: data._projectType || projectTypeMatch?.[1]?.trim() || "Commercial",

    lines: linesWithSensitivity,

    totalCost: data._totalCost || boqData.grandTotal || linesWithSensitivity.reduce((s, l) => s + l.totalCost, 0),
    hardCosts: data._hardCosts || boqData.subtotalMaterial + boqData.subtotalLabor + boqData.subtotalEquipment || 0,
    softCosts: data._softCosts || 0,
    escalation: data._escalation || boqData.escalation || 0,
    subtotalMaterial: boqData.subtotalMaterial || linesWithSensitivity.reduce((s, l) => s + l.materialCost, 0),
    subtotalLabor: boqData.subtotalLabor || linesWithSensitivity.reduce((s, l) => s + l.laborCost, 0),
    subtotalEquipment: boqData.subtotalEquipment || linesWithSensitivity.reduce((s, l) => s + l.equipmentCost, 0),
    grandTotal: boqData.grandTotal || data._totalCost || 0,

    benchmark: {
      costPerM2: bench.costPerM2 || 0,
      benchmarkLow: bench.benchmarkLow || 0,
      benchmarkHigh: bench.benchmarkHigh || 0,
      status: bench.status || "within",
      severity: bench.severity || "ok",
      message: bench.message || "",
      buildingType: bench.buildingType || "Commercial",
      cityTier: bench.cityTier || "Metro",
    },

    market: marketParsed,

    ifcQuality: ifcQ ? {
      score: ifcQ.score || ifcQ.qualityScore || 0,
      confidence: ifcQ.confidence || ifcQ.overallConfidence || 0,
      elementCoverage: ifcQ.elementCoverage || ifcQ.coverage || 0,
      missingFiles: ifcQ.missingFiles || ifcQ.missing || [],
      anomalies: ifcQ.anomalies || [],
    } : undefined,

    mepBreakdown,

    aaceClass: data._aaceClass || "Class 3",
    confidenceLevel: data._confidenceLevel || "MEDIUM",

    summary: data.content || data._summary || "",
    disclaimer: data._disclaimer || boqData.disclaimer || "This is an AI-generated estimate for preliminary budgeting purposes only. Verify all quantities with detailed measurement before procurement.",
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
      };
    });

  const linesWithSensitivity = computeSensitivities(parsedLines, DEFAULT_PRICES);
  const totalCost = linesWithSensitivity.reduce((s, l) => s + l.totalCost, 0);

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
    hardCosts: data._hardCosts || totalCost * 0.77,
    softCosts: data._softCosts || totalCost * 0.23,
    escalation: data._escalation || 0,
    subtotalMaterial: linesWithSensitivity.reduce((s, l) => s + l.materialCost, 0),
    subtotalLabor: linesWithSensitivity.reduce((s, l) => s + l.laborCost, 0),
    subtotalEquipment: linesWithSensitivity.reduce((s, l) => s + l.equipmentCost, 0),
    grandTotal: data._totalCost || totalCost,
    benchmark: {
      costPerM2: data._benchmark?.costPerM2 || (data._gfa ? totalCost / data._gfa : 0),
      benchmarkLow: data._benchmark?.benchmarkLow || 0,
      benchmarkHigh: data._benchmark?.benchmarkHigh || 0,
      status: data._benchmark?.status || "within",
      severity: data._benchmark?.severity || "ok",
      message: data._benchmark?.message || "",
      buildingType: data._benchmark?.buildingType || "Commercial",
      cityTier: data._benchmark?.cityTier || "Metro",
    },
    aaceClass: "Class 3",
    confidenceLevel: "MEDIUM",
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
