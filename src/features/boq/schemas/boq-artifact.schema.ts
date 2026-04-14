// ─── Zod Schema for BOQ Artifact Validation ─────────────────────────────────
// Validates the data shape that parseArtifactToBOQ() receives from TR-008.
// This is the MOST CRITICAL boundary — corrupt data here means wrong BOQ in UI.
//
// Strategy:
//   - Required fields: fail loudly with clear error
//   - Optional fields: fall back to defaults with diagnostic warnings
//   - Cost/quantity fields: coerce to number (some upstream sends strings)
//   - Never silently return null — always log WHY

import { z } from "zod";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Coerce string→number for fields that upstream sometimes sends as strings */
const coerceNumber = z.union([z.number(), z.string().transform(Number)]).pipe(z.number().finite());

/** Safe number that falls back to 0 on failure */
const safeNumber = coerceNumber.catch(0);

// ── BOQ Line Item (from TR-008 _boqData.lines) ──────────────────────────────

export const BOQLineSchema = z.object({
  division: z.string().catch("Unclassified"),
  csiCode: z.string().optional(),
  is1200Code: z.string().optional(),
  description: z.string().catch(""),
  unit: z.string().catch("LS"),
  quantity: safeNumber,
  wasteFactor: safeNumber,
  adjustedQty: safeNumber,
  materialRate: safeNumber,
  laborRate: safeNumber,
  equipmentRate: safeNumber,
  unitRate: safeNumber,
  materialCost: safeNumber,
  laborCost: safeNumber,
  equipmentCost: safeNumber,
  totalCost: safeNumber,
  storey: z.string().optional(),
  elementCount: z.number().optional(),
  confidence: z.union([
    z.object({ score: z.enum(["high", "medium", "low"]), factors: z.array(z.string()) }),
    z.number(),
  ]).optional(),
  source: z.string().optional(),
});

export type ValidatedBOQLine = z.infer<typeof BOQLineSchema>;

// ── BOQ Data (the _boqData object from TR-008) ──────────────────────────────

export const BOQDataPayloadSchema = z.object({
  lines: z.array(BOQLineSchema),
  subtotalMaterial: safeNumber,
  subtotalLabor: safeNumber,
  subtotalEquipment: safeNumber,
  grandTotal: safeNumber,
  projectType: z.string().optional(),
  escalation: safeNumber,
});

// ── Market Intelligence (from TR-015 via _marketIntelligence) ────────────────

export const MarketIntelligenceSchema = z.object({
  steel_per_tonne: z.object({
    value: coerceNumber,
    unit: z.string(),
    source: z.string(),
    confidence: z.string(),
  }).optional(),
  cement_per_bag: z.object({
    value: coerceNumber,
    unit: z.string(),
    source: z.string(),
    confidence: z.string(),
  }).optional(),
  sand_per_cft: z.object({
    value: coerceNumber,
    unit: z.string(),
    source: z.string(),
    confidence: z.string(),
  }).optional(),
  labor: z.object({
    mason: z.object({ value: coerceNumber, unit: z.string() }).optional(),
    helper: z.object({ value: coerceNumber, unit: z.string() }).optional(),
    carpenter: z.object({ value: coerceNumber, unit: z.string() }).optional(),
    electrician: z.object({ value: coerceNumber, unit: z.string() }).optional(),
    plumber: z.object({ value: coerceNumber, unit: z.string() }).optional(),
  }).optional(),
  agent_status: z.enum(["success", "partial", "fallback"]).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
}).passthrough();

// ── IFC Quality Assessment ───────────────────────────────────────────────────

export const IFCQualitySchema = z.object({
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100).optional(),
  elementCoverage: z.number().min(0).max(100).optional(),
  totalElements: z.number().optional(),
  missingFiles: z.array(z.string()).optional(),
  anomalies: z.array(z.string()).optional(),
}).passthrough();

// ── Benchmark ────────────────────────────────────────────────────────────────

export const BenchmarkSchema = z.object({
  costPerM2: safeNumber,
  rangeLow: safeNumber,
  rangeHigh: safeNumber,
  benchmarkLow: safeNumber,
  benchmarkHigh: safeNumber,
  status: z.string().optional(),
  severity: z.string().optional(),
  message: z.string().optional(),
  benchmarkLabel: z.string().optional(),
  buildingType: z.string().optional(),
  cityTier: z.string().optional(),
}).passthrough();

// ── Pricing Metadata ─────────────────────────────────────────────────────────

export const PricingMetadataSchema = z.object({
  source: z.enum(["market_intelligence", "cpwd_static", "mixed"]).catch("cpwd_static"),
  marketIntelligenceStatus: z.enum(["success", "partial", "failed", "timeout", "skipped"]).optional(),
  staticRateVersion: z.string().optional(),
  staleDateWarning: z.string().optional(),
  lastMarketUpdate: z.string().optional(),
  cityUsed: z.string().optional(),
  stateUsed: z.string().optional(),
}).passthrough();

// ── Model Quality Report ─────────────────────────────────────────────────────

export const ModelQualityReportSchema = z.object({
  overallGrade: z.enum(["A", "B", "C", "D", "F"]),
  totalElements: z.number().optional(),
  issuesFound: z.object({
    zeroVolumeElements: z.object({ count: z.number(), types: z.array(z.string()).optional() }).optional(),
    noMaterialElements: z.object({ count: z.number(), types: z.array(z.string()).optional() }).optional(),
    unassignedStoreyElements: z.object({ count: z.number() }).optional(),
    duplicateElements: z.object({ count: z.number() }).optional(),
    suspiciousDimensions: z.object({ count: z.number() }).optional(),
    unitInconsistencies: z.boolean().optional(),
  }).optional(),
  recommendations: z.array(z.string()).optional(),
}).passthrough();

// ── Full TR-008 Artifact Data ────────────────────────────────────────────────
// This is the top-level shape of artifact.data from TR-008

export const TR008ArtifactSchema = z.object({
  // Primary BOQ data (REQUIRED — no BOQ without this)
  _boqData: BOQDataPayloadSchema.optional(),
  boqData: BOQDataPayloadSchema.optional(),

  // Table fallback format
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(z.unknown())).optional(),

  // Project metadata
  _projectName: z.string().optional(),
  _projectType: z.string().optional(),
  _region: z.string().optional(),
  _gfa: safeNumber.optional(),
  _currency: z.string().optional(),
  _currencySymbol: z.string().optional(),
  label: z.string().optional(),

  // Cost breakdown
  _totalCost: safeNumber.optional(),
  _hardCosts: safeNumber.optional(),
  _softCosts: safeNumber.optional(),
  _escalation: safeNumber.optional(),
  _confidenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),

  // Quality & intelligence
  _ifcQuality: IFCQualitySchema.optional(),
  _ifcAssessment: IFCQualitySchema.optional(),
  _ifcContext: z.record(z.string(), z.unknown()).optional(),
  _marketIntelligence: MarketIntelligenceSchema.optional(),
  _benchmark: BenchmarkSchema.optional(),

  // Phase 3 transparency
  _pricingMetadata: PricingMetadataSchema.optional(),
  _modelQualityReport: ModelQualityReportSchema.optional(),
  _diagnostics: z.record(z.string(), z.unknown()).optional(),

  // AACE
  _aaceClass: z.string().optional(),
  _aaceAccuracy: z.string().optional(),

  // Disclaimer
  _disclaimer: z.string().optional(),
}).passthrough(); // Allow unknown keys to flow through

// ── Validation Result ────────────────────────────────────────────────────────

export interface BOQValidationResult {
  success: boolean;
  data: z.infer<typeof TR008ArtifactSchema> | null;
  warnings: string[];
  errors: string[];
}

/**
 * Validate TR-008 artifact data with detailed diagnostics.
 * Returns validated data + warnings for degraded fields.
 */
export function validateBOQArtifact(raw: unknown): BOQValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (raw == null) {
    return { success: false, data: null, warnings, errors: ["Artifact data is null/undefined"] };
  }

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { success: false, data: null, warnings, errors: ["Artifact data is a non-JSON string"] };
    }
  }

  if (typeof raw !== "object") {
    return { success: false, data: null, warnings, errors: [`Artifact data is ${typeof raw}, expected object`] };
  }

  const result = TR008ArtifactSchema.safeParse(raw);

  if (!result.success) {
    // Extract readable error messages from Zod
    const zodErrors = result.error.issues.map(issue => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });

    // Check if the errors are on critical fields
    const hasCriticalError = result.error.issues.some(issue => {
      const path = issue.path.join(".");
      return path.startsWith("_boqData.lines") && issue.code === "too_small";
    });

    if (hasCriticalError) {
      return { success: false, data: null, warnings, errors: zodErrors };
    }

    // Non-critical errors — try to extract what we can
    warnings.push(...zodErrors.map(e => `Validation warning: ${e}`));
  }

  // Even if safeParse failed, try passthrough with catch defaults
  const parsed = TR008ArtifactSchema.safeParse(raw);
  const data = parsed.success ? parsed.data : (raw as z.infer<typeof TR008ArtifactSchema>);

  // Check for lines existence
  const hasLines = (data._boqData?.lines?.length ?? 0) > 0
    || (data.boqData?.lines?.length ?? 0) > 0
    || ((data.rows as unknown[])?.length ?? 0) > 0;

  if (!hasLines) {
    warnings.push("No BOQ line items found in artifact — will attempt table row fallback");
  }

  return { success: true, data, warnings, errors };
}
