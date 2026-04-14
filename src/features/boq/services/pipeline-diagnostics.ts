/**
 * Pipeline Diagnostics — structured execution trace for the BOQ pipeline.
 *
 * Architecture: each node populates its own stage of the diagnostics object
 * and emits a namespaced field on its artifact data:
 *   - TR-007 (parser/aggregation) → `_parserDiagnostics`
 *   - TR-015 (market intelligence) → `_marketDiagnostics`
 *   - TR-008 (cost mapping) → unified `_diagnostics` (collects upstream + own)
 *
 * Collection is deliberately a plain mutable object + array.push to keep the
 * cost negligible during execution. The result is JSON-serializable.
 */

export type DiagnosticStage =
  | "ifc-upload"
  | "tr-007-parse"
  | "tr-007-aggregate"
  | "tr-015-market"
  | "tr-008-cost"
  | "tr-008-derived"
  | "tr-008-standard"
  | "tr-008-provisional"
  | "ex-002-export";

export type DiagnosticLevel = "info" | "warn" | "error" | "debug";

export interface DiagnosticEntry {
  timestamp: number;
  stage: DiagnosticStage;
  level: DiagnosticLevel;
  message: string;
  data?: Record<string, unknown>;
}

export interface ParsingStage {
  parserUsed: "web-ifc-wasm" | "text-regex" | "both" | "pre-parsed" | "none";
  wasmSuccess: boolean;
  wasmError?: string;
  regexFallbackUsed: boolean;
  regexFallbackReason?: string;
  elementsFound: number;
  elementsWithArea: number;
  elementsWithVolume: number;
  elementsWithMaterial: number;
  elementsWithZeroQuantity: number;
  quantitySourceBreakdown: {
    qtoStandard: number;
    custom: number;
    geometryCalculated: number;
    none: number;
  };
  materialTypeBreakdown: {
    ifcMaterial: number;
    layerSet: number;
    constituentSet: number;
    profileSet: number;
    materialList: number;
    none: number;
  };
  geometryTypeBreakdown: {
    extrudedAreaSolid: number;
    booleanResult: number;
    facetedBrep: number;
    mappedItem: number;
    boundingBox: number;
    other: number;
    failed: number;
  };
  storeys: string[];
  modelQuality: Record<string, unknown>;
  unitDetected: string;
  conversionApplied: boolean;
  warnings: string[];
}

export interface AggregationStage {
  inputElements: number;
  outputGroups: number;
  externalWalls: number;
  internalWalls: number;
  elementsLost: number;
}

export interface MarketIntelligenceStage {
  attempted: boolean;
  status: "success" | "partial" | "failed" | "timeout" | "skipped";
  primaryCallMs?: number;
  retryUsed: boolean;
  fallbackCallUsed: boolean;
  webSearchesPerformed: number;
  toolChoiceUsed: string;
  steelPrice?: number;
  steelSource?: string;
  cementPrice?: number;
  cementSource?: string;
  fallbackChainUsed: boolean;
  fallbackChainLevel?: number;
  error?: string;
  cacheHit?: boolean;
  materialPriceCacheHit?: boolean;
}

export interface CostMappingStage {
  totalLineItems: number;
  is1200Mapped: number;
  genericFallback: number;
  derivedItems: number;
  standardItems: number;
  provisionalItems: number;
  formworkItems: number;
  rebarItems: number;
  rebarSources: Record<string, number>;
  isExternalDifferentiated: boolean;
  externalWallItems: number;
  internalWallItems: number;
  confidenceBreakdown: { high: number; medium: number; low: number };
  totalHardCost: number;
  costPerSqm: number;
  warnings: string[];
}

export interface ExportStage {
  sheetsGenerated: number;
  formulaCellsWritten: number;
  totalRows: number;
}

export interface PipelineDiagnostics {
  executionId: string;
  startedAt: string;
  completedAt?: string;
  stages: {
    parsing: ParsingStage;
    aggregation: AggregationStage;
    marketIntelligence: MarketIntelligenceStage;
    costMapping: CostMappingStage;
    export: ExportStage;
  };
  log: DiagnosticEntry[];
}

function emptyParsing(): ParsingStage {
  return {
    parserUsed: "none",
    wasmSuccess: false,
    regexFallbackUsed: false,
    elementsFound: 0,
    elementsWithArea: 0,
    elementsWithVolume: 0,
    elementsWithMaterial: 0,
    elementsWithZeroQuantity: 0,
    quantitySourceBreakdown: { qtoStandard: 0, custom: 0, geometryCalculated: 0, none: 0 },
    materialTypeBreakdown: { ifcMaterial: 0, layerSet: 0, constituentSet: 0, profileSet: 0, materialList: 0, none: 0 },
    geometryTypeBreakdown: { extrudedAreaSolid: 0, booleanResult: 0, facetedBrep: 0, mappedItem: 0, boundingBox: 0, other: 0, failed: 0 },
    storeys: [],
    modelQuality: {},
    unitDetected: "METRE",
    conversionApplied: false,
    warnings: [],
  };
}

function emptyAggregation(): AggregationStage {
  return { inputElements: 0, outputGroups: 0, externalWalls: 0, internalWalls: 0, elementsLost: 0 };
}

function emptyMarket(): MarketIntelligenceStage {
  return {
    attempted: false,
    status: "skipped",
    retryUsed: false,
    fallbackCallUsed: false,
    webSearchesPerformed: 0,
    toolChoiceUsed: "",
    fallbackChainUsed: false,
  };
}

function emptyCostMapping(): CostMappingStage {
  return {
    totalLineItems: 0,
    is1200Mapped: 0,
    genericFallback: 0,
    derivedItems: 0,
    standardItems: 0,
    provisionalItems: 0,
    formworkItems: 0,
    rebarItems: 0,
    rebarSources: {},
    isExternalDifferentiated: false,
    externalWallItems: 0,
    internalWallItems: 0,
    confidenceBreakdown: { high: 0, medium: 0, low: 0 },
    totalHardCost: 0,
    costPerSqm: 0,
    warnings: [],
  };
}

function emptyExport(): ExportStage {
  return { sheetsGenerated: 0, formulaCellsWritten: 0, totalRows: 0 };
}

export function createDiagnostics(executionId: string): PipelineDiagnostics {
  return {
    executionId,
    startedAt: new Date().toISOString(),
    stages: {
      parsing: emptyParsing(),
      aggregation: emptyAggregation(),
      marketIntelligence: emptyMarket(),
      costMapping: emptyCostMapping(),
      export: emptyExport(),
    },
    log: [],
  };
}

export function addLog(
  diag: PipelineDiagnostics | undefined,
  stage: DiagnosticStage,
  level: DiagnosticLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!diag) return;
  diag.log.push({ timestamp: Date.now(), stage, level, message, ...(data ? { data } : {}) });
}

export function finalizeDiagnostics(diag: PipelineDiagnostics): PipelineDiagnostics {
  diag.completedAt = new Date().toISOString();
  return diag;
}

/**
 * Merge upstream parser diagnostics (from TR-007's `_parserDiagnostics`) into
 * the unified diagnostics container. Used by TR-008 when rolling up the
 * pipeline trace.
 */
export function mergeParserDiagnostics(
  target: PipelineDiagnostics,
  source: Partial<PipelineDiagnostics> | undefined,
): void {
  if (!source) return;
  if (source.stages?.parsing) {
    target.stages.parsing = { ...target.stages.parsing, ...source.stages.parsing };
  }
  if (source.stages?.aggregation) {
    target.stages.aggregation = { ...target.stages.aggregation, ...source.stages.aggregation };
  }
  if (Array.isArray(source.log)) {
    target.log.push(...source.log);
  }
}

export function mergeMarketDiagnostics(
  target: PipelineDiagnostics,
  source: Partial<PipelineDiagnostics> | undefined,
): void {
  if (!source) return;
  if (source.stages?.marketIntelligence) {
    target.stages.marketIntelligence = {
      ...target.stages.marketIntelligence,
      ...source.stages.marketIntelligence,
    };
  }
  if (Array.isArray(source.log)) {
    target.log.push(...source.log);
  }
}

/** A short single-line summary suitable for the existing Execution Log panel. */
export function buildExecutionLogSummary(diag: PipelineDiagnostics): string[] {
  const p = diag.stages.parsing;
  const m = diag.stages.marketIntelligence;
  const c = diag.stages.costMapping;
  const lines: string[] = [];

  if (p.elementsFound > 0) {
    const zeroNote = p.elementsWithZeroQuantity > 0 ? `, ${p.elementsWithZeroQuantity} zero-volume` : "";
    lines.push(`Parsing: ${p.elementsFound} elements found, ${p.elementsWithArea} with area${zeroNote}`);
  }

  if (m.attempted) {
    if (m.status === "success" || m.status === "partial") {
      const ms = m.primaryCallMs ? `${(m.primaryCallMs / 1000).toFixed(1)}s` : "?";
      const steel = m.steelPrice ? `Steel ₹${Math.round(m.steelPrice / 1000)}K` : "";
      const cement = m.cementPrice ? `Cement ₹${m.cementPrice}` : "";
      lines.push(`Market Intelligence: ${m.status.toUpperCase()} in ${ms} — ${steel}, ${cement}`);
    } else {
      lines.push(`Market Intelligence: ${m.status.toUpperCase()}${m.error ? ` — ${m.error}` : ""}`);
    }
  }

  if (c.totalLineItems > 0) {
    lines.push(`Cost Mapping: ${c.totalLineItems} line items, ${c.is1200Mapped} IS1200 mapped, ${c.standardItems} standard items`);
  }

  if (p.elementsWithZeroQuantity > 0) {
    const failedTypes: string[] = [];
    if (p.geometryTypeBreakdown.booleanResult > 0) failedTypes.push("IfcBooleanResult");
    if (p.geometryTypeBreakdown.facetedBrep > 0) failedTypes.push("IfcFacetedBrep");
    if (failedTypes.length > 0) {
      lines.push(`⚠ ${p.elementsWithZeroQuantity} elements have zero volume — unsupported geometry (${failedTypes.join(", ")})`);
    } else {
      lines.push(`⚠ ${p.elementsWithZeroQuantity} elements have zero volume`);
    }
  }

  return lines;
}
