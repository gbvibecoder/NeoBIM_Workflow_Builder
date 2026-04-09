// ─── BOQ Visualizer Types ───────────────────────────────────────────────────

export interface BOQLineItem {
  id: string;
  division: string;
  isCode: string;
  description: string;
  unit: string;
  quantity: number;
  wasteFactor: number;
  adjustedQty: number;
  materialRate: number;
  laborRate: number;
  equipmentRate: number;
  unitRate: number;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  totalCost: number;
  storey?: string;
  elementCount?: number;
  source: "ifc-geometry" | "ifc-derived" | "benchmark" | "provisional";
  confidence: number; // 0-100
  // Sensitivity coefficients: how much totalCost changes per 1% change in material price
  steelSensitivity: number;
  cementSensitivity: number;
  masonSensitivity: number;
  bricksSensitivity: number;
  sandSensitivity: number;
  timberSensitivity: number;
}

export interface BOQData {
  projectName: string;
  location: string;
  date: string;
  currency: string;
  currencySymbol: string;
  gfa: number; // gross floor area m²
  projectType: string;

  lines: BOQLineItem[];

  // Totals
  totalCost: number;
  hardCosts: number;
  softCosts: number;
  escalation: number;
  subtotalMaterial: number;
  subtotalLabor: number;
  subtotalEquipment: number;
  grandTotal: number;

  // Benchmark
  benchmark: {
    costPerM2: number;
    benchmarkLow: number;
    benchmarkHigh: number;
    status: "within" | "below" | "above";
    severity: "ok" | "warning" | "critical";
    message: string;
    buildingType: string;
    cityTier: string;
  };

  // Market intelligence
  market?: {
    steelPerTonne: number;
    steelSource: string;
    steelConfidence: string;
    cementPerBag: number;
    cementBrand: string;
    cementSource: string;
    cementConfidence: string;
    masonRate: number;
    masonSource: string;
    masonConfidence: string;
  };

  // IFC Quality
  ifcQuality?: {
    score: number;
    confidence: number;
    elementCoverage: number;
    missingFiles: string[];
    anomalies: string[];
  };

  // MEP Breakdown
  mepBreakdown?: {
    hvac: { cost: number; percentage: number; reasoning: string };
    electrical: { cost: number; percentage: number; reasoning: string };
    plumbing: { cost: number; percentage: number; reasoning: string };
    fire: { cost: number; percentage: number; reasoning: string };
    lifts: { cost: number; percentage: number; reasoning: string };
  };

  // AACE Classification
  aaceClass?: string;
  confidenceLevel?: "LOW" | "MEDIUM" | "HIGH";

  // NL Summary
  summary: string;
  disclaimer: string;

  // Download URLs (from EX-002/EX-003 artifacts)
  excelUrl?: string;
  pdfUrl?: string;
}

export interface PriceOverrides {
  steel: number; // ₹/tonne
  cement: number; // ₹/bag
  mason: number; // ₹/day
  bricks: number; // ₹/nos
  sand: number; // ₹/cft
  timber: number; // ₹/m²
}

export interface RateOverride {
  lineId: string;
  newRate: number;
  originalRate: number;
}

export type BOQSortKey = "description" | "amount" | "confidence";
export type BOQSortDir = "asc" | "desc";
export type BOQFilterTab = "all" | "structural" | "finishes" | "mep" | "provisional";
export type SourceType = "ifc-geometry" | "ifc-derived" | "benchmark" | "provisional";
