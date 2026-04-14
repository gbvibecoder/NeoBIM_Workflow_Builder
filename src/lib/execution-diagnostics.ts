/**
 * Universal Execution Diagnostics — structured trace for any workflow run.
 *
 * Replaces the BOQ-specific pipeline-diagnostics in spirit (that module still
 * lives, scoped to TR-007/TR-015/TR-008 internals; its data is folded into a
 * NodeTrace.stats here). This module is the canonical execution-wide story:
 *
 *   ExecutionTrace
 *     ├─ NodeTrace[]   ← one per node executed, in topological order
 *     │    ├─ attempts[]   (WASM parse, web search, fallback, …)
 *     │    ├─ apiCalls[]   (anthropic.messages.create, redis.get, …)
 *     │    ├─ log[]        (chronological detail entries)
 *     │    └─ stats        (node-type-specific structured data)
 *     ├─ DataFlow[]    ← what crossed each edge: type, count, size, fields
 *     └─ warnings/errors (workflow-level, not tied to a single node)
 *
 * Storage: serialized JSON, persisted into Execution.metadata.diagnostics via
 * the existing PATCH /api/executions/[id]/metadata endpoint, hydrated back on
 * results-page mount. JSON-serializable: no Maps, no functions, no class
 * instances, no circular refs.
 *
 * Performance: all helpers are O(1) array.push or object spread. The whole
 * trace for a 30-node workflow with rich logs is ~40-60KB.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type NodeStatus =
  | "pending"   // queued, not yet started
  | "running"   // currently executing
  | "success"   // completed without warnings
  | "warning"   // completed but with notable issues
  | "error"     // failed
  | "skipped";  // bypassed (cycle, disconnected, cache hit)

export type AttemptStatus = "success" | "failed" | "timeout" | "skipped";

export type APIStatus = "success" | "error" | "timeout";

export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

export interface NodeAttempt {
  attemptNumber: number;
  /** Concrete action taken: "WASM parse", "Claude API call", "Redis lookup". */
  action: string;
  status: AttemptStatus;
  durationMs: number;
  /** Why it succeeded or failed, in human language. */
  detail?: string;
  /** What the next attempt fell back to, if any. */
  fallbackUsed?: string;
}

export interface APICallTrace {
  /** Coarse service identifier: anthropic / openai / web-ifc / redis / postgres / fal / r2 / ... */
  service: string;
  /** Sub-API or operation: messages.create, GetLineIDsWithType, MaterialPriceCache.findMany. */
  endpoint?: string;
  method?: string;
  durationMs: number;
  status: APIStatus;
  requestSummary?: string;
  responseSummary?: string;
  error?: string;
  /** True if the call was served from a cache instead of the real backend. */
  cached?: boolean;
}

export interface DataFlow {
  fromNodeId: string;
  toNodeId: string;
  /** Coarse data shape: "IFC quantities", "market prices", "BOQ lines", "image", "text". */
  dataType: string;
  /** Element/row/item count when meaningful (e.g., 36 IFC elements). */
  recordCount?: number;
  /** Best-effort size estimate, e.g., "~45KB JSON". */
  dataSizeEstimate?: string;
  /** Top-level field names in the payload (helps locate "where did X come from?"). */
  sampleFields?: string[];
  warnings?: string[];
}

export interface NodePerformance {
  parseTime?: number;
  apiCallTime?: number;
  computeTime?: number;
  cacheCheckTime?: number;
  totalTime: number;
}

export interface NodeTrace {
  nodeId: string;
  nodeTypeId: string;
  nodeName: string;
  status: NodeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;

  attempts: NodeAttempt[];
  stats: Record<string, unknown>;
  summary: string;
  log: LogEntry[];

  inputSummary: string;
  outputSummary: string;

  apiCalls: APICallTrace[];
  performance: NodePerformance;

  /** True for mock-executor results — surfaces "MOCK DATA — not a real API call" badge. */
  isMock?: boolean;
  /** True for cache-hit short-circuits (e.g., GN-003 reusing previous render). */
  isCacheHit?: boolean;
  /** True if the node fell back to mock execution after a real-handler failure. */
  fellBackToMock?: boolean;
}

export interface ExecutionTrace {
  executionId: string;
  workflowName: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;

  nodes: NodeTrace[];
  dataFlows: DataFlow[];

  warnings: string[];
  errors: string[];
}

// ─── Constructors ───────────────────────────────────────────────────────────

export function createExecutionTrace(executionId: string, workflowName: string): ExecutionTrace {
  return {
    executionId,
    workflowName,
    startedAt: new Date().toISOString(),
    nodes: [],
    dataFlows: [],
    warnings: [],
    errors: [],
  };
}

export function createNodeTrace(nodeId: string, nodeTypeId: string, nodeName: string): NodeTrace {
  return {
    nodeId,
    nodeTypeId,
    nodeName,
    status: "pending",
    attempts: [],
    stats: {},
    summary: "",
    log: [],
    inputSummary: "",
    outputSummary: "",
    apiCalls: [],
    performance: { totalTime: 0 },
  };
}

// ─── Mutators (in-place, append-only — cheap during execution) ──────────────

export function startNodeTrace(node: NodeTrace): NodeTrace {
  node.status = "running";
  node.startedAt = new Date().toISOString();
  return node;
}

export function finishNodeTrace(node: NodeTrace, status: NodeStatus): NodeTrace {
  node.status = status;
  node.completedAt = new Date().toISOString();
  if (node.startedAt) {
    node.durationMs = new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime();
    node.performance.totalTime = node.durationMs;
  }
  return node;
}

export function appendLog(
  node: NodeTrace,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  node.log.push({ timestamp: Date.now(), level, message, ...(data ? { data } : {}) });
}

export function appendAttempt(node: NodeTrace, attempt: Omit<NodeAttempt, "attemptNumber">): void {
  node.attempts.push({ attemptNumber: node.attempts.length + 1, ...attempt });
}

export function appendAPICall(node: NodeTrace, call: APICallTrace): void {
  node.apiCalls.push(call);
}

export function appendDataFlow(trace: ExecutionTrace, flow: DataFlow): void {
  trace.dataFlows.push(flow);
}

export function finalizeExecutionTrace(trace: ExecutionTrace): ExecutionTrace {
  trace.completedAt = new Date().toISOString();
  trace.totalDurationMs = new Date(trace.completedAt).getTime() - new Date(trace.startedAt).getTime();
  return trace;
}

// ─── Inspection helpers ─────────────────────────────────────────────────────

/** Coarse-grained best-effort byte size for a JSON-serializable payload. */
export function estimatePayloadSize(payload: unknown): string {
  if (payload == null) return "0 B";
  try {
    const s = JSON.stringify(payload);
    const bytes = s.length;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `~${(bytes / 1024).toFixed(1)} KB`;
    return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return "?";
  }
}

/** Pull the most-informative top-level field names from an artifact payload. */
export function pickSampleFields(payload: unknown, max = 8): string[] {
  if (!payload || typeof payload !== "object") return [];
  const keys = Object.keys(payload as Record<string, unknown>);
  // Prefer non-private (no leading underscore) fields first, then underscore-prefixed
  const visible = keys.filter(k => !k.startsWith("_"));
  const internal = keys.filter(k => k.startsWith("_"));
  return [...visible, ...internal].slice(0, max);
}

/** Best-effort row/element count for arrays-of-records artifacts. */
export function pickRecordCount(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  // Common containers used across the codebase
  const candidateArrays = [p.rows, p._elements, p._boqData && (p._boqData as Record<string, unknown>).lines, p.elements, p.lines, p.divisions];
  for (const c of candidateArrays) {
    if (Array.isArray(c)) return c.length;
  }
  return undefined;
}

/** Coarse data-type label for a single artifact, used in DataFlow.dataType. */
export function classifyArtifactDataType(artifactType: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return artifactType;
  const p = payload as Record<string, unknown>;
  if (p._boqData || p._totalCost) return "BOQ lines";
  if (p._elements && Array.isArray(p._elements)) return "IFC quantities";
  if (p._marketData || p.steel_per_tonne) return "market prices";
  if (p.divisions) return "IFC parsed";
  if (p.imageUrl || p.url) return "image";
  if (artifactType === "video") return "video";
  if (artifactType === "kpi") return "KPI metrics";
  if (artifactType === "table") return "table";
  if (artifactType === "json") return "JSON";
  if (artifactType === "file") return "file";
  return artifactType;
}

// ─── Real-time canvas log formatter ─────────────────────────────────────────
// Builds the short, meaningful one-liners the canvas ExecutionLog displays
// during a run. Per-node-type so each line is genuinely useful instead of a
// generic "TR-007 done".

interface CanvasLogPayload {
  nodeName: string;
  nodeTypeId: string;
  /** Already-finalized NodeTrace (status + stats populated). */
  trace: NodeTrace;
  /** Output artifact payload — used to pull headline numbers cheaply. */
  output?: unknown;
}

export interface CanvasLogLine {
  level: LogLevel;
  message: string;
  detail?: string;
}

export function formatCanvasLogLines(p: CanvasLogPayload): CanvasLogLine[] {
  const { nodeName, nodeTypeId, trace, output } = p;
  const ms = trace.durationMs ?? 0;
  const sec = (ms / 1000).toFixed(1);
  const lines: CanvasLogLine[] = [];
  const out = (output ?? {}) as Record<string, unknown>;

  // Per-node-type smart summaries — these are the "behind-the-scenes" lines.
  switch (nodeTypeId) {
    case "TR-007": {
      const elements = Array.isArray(out._elements) ? (out._elements as unknown[]).length : 0;
      const pd = (out._parserDiagnostics as Record<string, unknown> | undefined);
      const stages = (pd?.stages as Record<string, unknown> | undefined);
      const parsing = (stages?.parsing as Record<string, unknown> | undefined);
      const elementsFound = (parsing?.elementsFound as number) ?? elements;
      const withArea = (parsing?.elementsWithArea as number) ?? 0;
      const zero = (parsing?.elementsWithZeroQuantity as number) ?? 0;
      const fileMeta = parsing?.fileMetadata as Record<string, unknown> | undefined;
      const storeys = (parsing?.storeys as string[] | undefined)?.length ?? 0;

      // File-context line — what kind of file are we even looking at?
      if (fileMeta) {
        const sizeKB = (fileMeta.fileSizeBytes as number | undefined);
        const sizeStr = sizeKB ? (sizeKB > 1024 * 1024 ? `${(sizeKB / 1024 / 1024).toFixed(1)}MB` : `${Math.round(sizeKB / 1024)}KB`) : "?";
        const author = (fileMeta.authoringApplication as string | undefined) ?? "unknown tool";
        const schema = (fileMeta.ifcSchema as string | undefined) ?? "IFC";
        lines.push({ level: "info", message: `${nodeName}: ${schema} file (${sizeStr}) authored by ${author}` });
      }

      lines.push({
        level: zero > 0 ? "warn" : "success",
        message: `${nodeName}: ${elementsFound} elements found${storeys > 0 ? ` across ${storeys} storeys` : ""}, ${withArea} with geometry`,
      });

      // Qto presence — the single most important fact about quantity provenance
      const qtoCount = (fileMeta?.qtoBaseSetCount as number | undefined) ?? 0;
      if (fileMeta && qtoCount === 0 && elementsFound > 0) {
        lines.push({ level: "warn", message: `${nodeName}: ⚠ No Qto_* base quantities in file — measurements rely on geometry computation` });
      }

      if (zero > 0) {
        const gtb = (parsing?.geometryTypeBreakdown as Record<string, number> | undefined);
        const failedTypes: string[] = [];
        if (gtb?.facetedBrep) failedTypes.push(`${gtb.facetedBrep} FacetedBrep`);
        if (gtb?.booleanResult) failedTypes.push(`${gtb.booleanResult} BooleanResult`);
        if (gtb?.failed) failedTypes.push(`${gtb.failed} unrecognized`);
        lines.push({
          level: "warn",
          message: `${nodeName}: ⚠ ${zero} of ${elementsFound} elements have zero geometric quantities${failedTypes.length ? ` (${failedTypes.join(", ")} — not supported by WASM)` : ""}`,
        });
        if (zero === elementsFound) {
          lines.push({ level: "warn", message: `${nodeName}: Using element COUNTS as quantities — accuracy severely limited` });
        }
      }

      // Surface the first smart warning prominently (the most actionable insight)
      const sw = parsing?.smartWarnings as string[] | undefined;
      if (sw && sw.length > 0) {
        lines.push({ level: "warn", message: `${nodeName}: ${sw[0]}` });
      }
      const fixes = parsing?.smartFixes as string[] | undefined;
      if (fixes && fixes.length > 0) {
        lines.push({ level: "info", message: `${nodeName}: ${fixes[0]}` });
      }
      break;
    }
    case "TR-015": {
      const md = (out._marketData as Record<string, unknown> | undefined);
      const status = (md?.agent_status as string | undefined) ?? "?";
      const steel = (md?.steel_per_tonne as { value?: number; source?: string } | undefined);
      const cement = (md?.cement_per_bag as { value?: number; brand?: string } | undefined);
      const md2 = (out._marketDiagnostics as Record<string, unknown> | undefined);
      const stages = (md2?.stages as Record<string, unknown> | undefined);
      const market = (stages?.marketIntelligence as Record<string, unknown> | undefined);
      const searches = (market?.webSearchesPerformed as number | undefined) ?? 0;
      const cacheHit = market?.cacheHit;
      const city = (md?.city as string | undefined) ?? (md?.cityUsed as string | undefined);
      const state = (md?.state as string | undefined) ?? (md?.stateUsed as string | undefined);

      // Pre-call line — sets context before the result line
      if (city || state) {
        lines.push({
          level: "info",
          message: `${nodeName}: ${cacheHit ? "Reading cached prices for" : "Fetching live prices for"} ${[city, state].filter(Boolean).join(", ")}…`,
        });
      }

      const steelStr = steel?.value ? `Steel ₹${Math.round(steel.value / 1000)}K/t` : "";
      const cementStr = cement?.value ? `Cement ₹${cement.value}${cement.brand ? ` (${cement.brand})` : ""}` : "";
      const detailParts: string[] = [];
      if (searches > 0) detailParts.push(`${searches} web search${searches === 1 ? "" : "es"}`);
      if (cacheHit) detailParts.push("cache HIT");
      const detail = detailParts.length ? ` · ${detailParts.join(", ")}` : "";
      lines.push({
        level: status === "success" ? "success" : status === "partial" ? "warn" : "error",
        message: `${nodeName}: ${status.toUpperCase()} in ${sec}s — ${[steelStr, cementStr].filter(Boolean).join(", ")}${detail}`,
      });
      break;
    }
    case "TR-008": {
      const boq = (out._boqData as Record<string, unknown> | undefined);
      const total = (out._totalCost as number | undefined) ?? (boq?.grandTotal as number | undefined);
      const lineCount = Array.isArray(boq?.lines) ? (boq!.lines as unknown[]).length : 0;
      const gfa = out._gfa as number | undefined;
      const aace = out._aaceClass as string | undefined;
      const perSqm = total && gfa ? Math.round(total / gfa) : 0;
      const pd = (out._diagnostics as Record<string, unknown> | undefined);
      const stages = (pd?.stages as Record<string, unknown> | undefined);
      const cm = (stages?.costMapping as Record<string, unknown> | undefined);
      const breakdown: string[] = [];
      if (cm) {
        if (cm.is1200Mapped) breakdown.push(`${cm.is1200Mapped} IS1200`);
        if (cm.genericFallback) breakdown.push(`${cm.genericFallback} generic`);
        if (cm.standardItems) breakdown.push(`${cm.standardItems} std`);
        if (cm.provisionalItems) breakdown.push(`${cm.provisionalItems} prov`);
      }
      lines.push({
        level: "success",
        message: `${nodeName}: ${lineCount} BOQ line items mapped${breakdown.length ? ` (${breakdown.join(", ")})` : ""}`,
      });
      if (total) {
        const cr = total >= 1e7 ? `₹${(total / 1e7).toFixed(2)} Cr` : `₹${Math.round(total / 1e5)}L`;
        const sqm = perSqm ? ` (₹${perSqm.toLocaleString()}/m²)` : "";
        lines.push({ level: "info", message: `${nodeName}: ${cr} total${sqm} — ${aace ?? "AACE Class 4"}` });
      }
      // Benchmark sanity check — flag if cost/sqm is far above expected range
      const bench = out._benchmark as Record<string, unknown> | undefined;
      if (perSqm > 0 && bench) {
        const high = (bench.rangeHigh as number | undefined) ?? (bench.benchmarkHigh as number | undefined);
        if (high && perSqm > high * 1.3) {
          const overPct = Math.round(((perSqm - high) / high) * 100);
          lines.push({ level: "warn", message: `${nodeName}: ⚠ Cost/m² is ${overPct}% above benchmark — likely due to element-count quantities` });
        }
      }
      break;
    }
    case "EX-002": {
      const sheets = out._sheetsGenerated as number | undefined;
      const formulas = out._formulaCellsWritten as number | undefined;
      const rows = out._totalRows as number | undefined;
      lines.push({
        level: "success",
        message: `${nodeName}: Excel generated${sheets ? ` (${sheets} sheets, ${rows ?? "?"} rows, ${formulas ?? "?"} formulas)` : ""}`,
      });
      break;
    }
    case "GN-003": {
      lines.push({
        level: trace.isCacheHit ? "info" : "success",
        message: `${nodeName}: ${trace.isCacheHit ? "reused cached render" : "image generated"} in ${sec}s`,
      });
      break;
    }
    case "GN-009": {
      lines.push({
        level: "info",
        message: `${nodeName}: video generation queued (${sec}s setup)`,
      });
      break;
    }
    default: {
      const status = trace.status;
      const tag = trace.isMock ? " (mock)" : trace.fellBackToMock ? " (mock fallback)" : "";
      lines.push({
        level: status === "error" ? "error" : status === "warning" ? "warn" : "success",
        message: `${nodeName}${tag}: ${status} in ${sec}s`,
      });
    }
  }

  return lines;
}
