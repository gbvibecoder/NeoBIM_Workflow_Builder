/**
 * Brief-to-IFC v3 — BuildTelemetry (Phase δ.0).
 *
 * A per-build, per-iteration structured record of what actually
 * happened: schema coercions, element counts requested vs built, proxy
 * fallbacks, material misses, agent turn timing, Railway errors. Used
 * to make the "quality 45-55" mystery and the silent-geometry-drop
 * visible in data instead of code-reading.
 *
 * Persistence: a single `ExecutionLog` row with `source="DIAGNOSTIC"`
 * and a `BuildTelemetry`-shaped `metadata` payload, written at the end
 * of every iteration. Avoids a Prisma migration.
 *
 * **Hard invariant: telemetry can NEVER fail a build.** Every public
 * surface here is wrapped in try/catch and swallows errors. Telemetry
 * is observe-only; it does not throw, does not block the agent loop,
 * does not change behaviour. Instrumentation that breaks the thing it
 * observes is worse than no instrumentation.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { appendLog } from "./runtime/append-log";
import type { PrismaClient } from "@prisma/client";

// ─── Limits ──────────────────────────────────────────────────────────

/** Cap how many individual events we hold per category — keeps the
 *  ExecutionLog metadata payload from blowing past Postgres JSON
 *  practical limits on a runaway build. The count fields remain
 *  authoritative even when the events arrays cap out. */
const MAX_EVENTS_PER_CATEGORY = 200;

/** Cap on stringified value previews (e.g. rejected enum value) so a
 *  pathological Opus output cannot bloat the payload. */
const MAX_VALUE_PREVIEW_CHARS = 200;

// ─── Event types ─────────────────────────────────────────────────────

export type CoercionKind =
  | "enum_normalized"
  | "enum_fallback"
  | "rgb_rescaled_255"
  | "rgb_padded"
  | "rgb_truncated"
  | "rgb_clamped"
  | "rgb_coerced"
  | "positive_clamped"
  | "string_default"
  | "tuple_padded"
  | "number_from_string";

export interface SchemaCoercionEvent {
  /** Dot path to the field, e.g. "materials.0.rgb" or "site.height_limit_m". */
  field: string;
  kind: CoercionKind;
  /** Stringified original value, truncated. */
  received: string;
  /** Stringified coerced value, truncated. */
  recovered: string;
}

export interface SchemaRejectionEvent {
  field: string;
  reason: string;
}

export interface ProxyFallbackEvent {
  /** Element type the agent asked for (from brief or agent spec). */
  requested_type: string;
  /** IFC class the proxy fell back to (almost always
   *  IfcBuildingElementProxy). */
  ifc_class: string;
  /** Optional element id for triage. */
  element_id?: string;
  /** Why the fallback happened ("no_add_method", "unknown_type", etc.). */
  reason: string;
}

export interface DroppedElementEvent {
  /** Element type that produced no geometry. */
  type: string;
  /** Optional id. */
  element_id?: string;
  reason: string;
}

export interface MaterialMissEvent {
  element_id?: string;
  requested_material_id: string;
  fallback_material_id: string;
}

export interface RailwayErrorEvent {
  endpoint: string;
  kind: string;
  status?: number;
  message: string;
}

// ─── Snapshot shape — what gets persisted ────────────────────────────

export interface BuildTelemetrySnapshot {
  schemaVersion: "v1";
  runId: string;
  iteration: number;
  briefType: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  /** Whether the build reached `finalize_ifc` successfully. */
  finalized: boolean;

  // Agent loop stats — taken from the generator result when available.
  turns: number;
  generatorCostUsd: number;
  entityCount: number;
  renderPreviewCalls: number;
  /** Recorded quality score from the existing (known-broken) metric —
   *  preserved as-is so δ.2's replacement can compare. */
  finalQualityScore: number | null;

  // Counts (always authoritative even when event arrays are capped).
  counts: {
    schemaCoercions: number;
    schemaRejections: number;
    proxyFallbacks: number;
    droppedElements: number;
    materialMisses: number;
    railwayErrors: number;
    toolErrors: number;
  };

  // Element types: requested in spec vs actually built (from Python
  // telemetry when present).
  elementTypeCounts: {
    requested: Record<string, number>;
    built: Record<string, number>;
  };

  // Bounded event arrays — capped at MAX_EVENTS_PER_CATEGORY.
  schemaCoercions: SchemaCoercionEvent[];
  schemaRejections: SchemaRejectionEvent[];
  proxyFallbacks: ProxyFallbackEvent[];
  droppedElements: DroppedElementEvent[];
  materialMisses: MaterialMissEvent[];
  railwayErrors: RailwayErrorEvent[];
}

// ─── Coercion async-context — what the schema layer writes into ──────

/** Per-request async-context: schema-tolerance helpers append into
 *  whichever array sits in this store. Using AsyncLocalStorage instead
 *  of a module-level mutable so concurrent serverless invocations on
 *  the same isolate cannot cross-contaminate. */
const coercionContext = new AsyncLocalStorage<SchemaCoercionEvent[]>();

/** Run `fn` with a fresh coercion-collection buffer. Returns the
 *  function's result plus every coercion the schema layer reported
 *  while it was executing. The buffer is scoped to the async tree
 *  rooted at `fn`; nothing else writes to it. */
export function withCoercionCollection<T>(
  fn: () => T,
): { result: T; coercions: SchemaCoercionEvent[] } {
  const coercions: SchemaCoercionEvent[] = [];
  const result = coercionContext.run(coercions, fn);
  return { result, coercions };
}

/** Async variant for parse paths that are themselves async. */
export async function withCoercionCollectionAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; coercions: SchemaCoercionEvent[] }> {
  const coercions: SchemaCoercionEvent[] = [];
  const result = await coercionContext.run(coercions, fn);
  return { result, coercions };
}

function truncate(value: unknown): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s == null) return "";
  return s.length > MAX_VALUE_PREVIEW_CHARS
    ? s.slice(0, MAX_VALUE_PREVIEW_CHARS - 3) + "..."
    : s;
}

/** Called by schema-tolerance helpers when they coerce a value. Safe
 *  to call from anywhere — outside a coercion context it is a no-op. */
export function recordCoercion(args: {
  field: string;
  kind: CoercionKind;
  received: unknown;
  recovered: unknown;
}): void {
  try {
    const store = coercionContext.getStore();
    if (!store) return;
    if (store.length >= MAX_EVENTS_PER_CATEGORY) return;
    store.push({
      field: args.field,
      kind: args.kind,
      received: truncate(args.received),
      recovered: truncate(args.recovered),
    });
  } catch {
    /* swallow — telemetry never crashes the build */
  }
}

// ─── Collector — the per-build accumulator ───────────────────────────

export interface BuildTelemetryCollectorArgs {
  runId: string;
  iteration: number;
  briefType?: string | null;
}

/** Mutable accumulator for one iteration of one build. Every mutation
 *  is internally try/caught so any failure is silently swallowed —
 *  callers do not need to wrap individual `record*` calls. */
export class BuildTelemetryCollector {
  readonly runId: string;
  readonly iteration: number;
  private readonly _startedAt: number;
  private readonly _startedAtIso: string;

  private _briefType: string | null;
  private _finalized = false;
  private _turns = 0;
  private _generatorCostUsd = 0;
  private _entityCount = 0;
  private _renderPreviewCalls = 0;
  private _finalQualityScore: number | null = null;

  private readonly _schemaCoercions: SchemaCoercionEvent[] = [];
  private readonly _schemaRejections: SchemaRejectionEvent[] = [];
  private readonly _proxyFallbacks: ProxyFallbackEvent[] = [];
  private readonly _droppedElements: DroppedElementEvent[] = [];
  private readonly _materialMisses: MaterialMissEvent[] = [];
  private readonly _railwayErrors: RailwayErrorEvent[] = [];

  private _schemaCoercionsCount = 0;
  private _schemaRejectionsCount = 0;
  private _proxyFallbacksCount = 0;
  private _droppedElementsCount = 0;
  private _materialMissesCount = 0;
  private _railwayErrorsCount = 0;
  private _toolErrorsCount = 0;

  private readonly _requestedTypes: Record<string, number> = {};
  private readonly _builtTypes: Record<string, number> = {};

  constructor(args: BuildTelemetryCollectorArgs) {
    this.runId = args.runId;
    this.iteration = args.iteration;
    this._briefType = args.briefType ?? null;
    this._startedAt = Date.now();
    this._startedAtIso = new Date(this._startedAt).toISOString();
  }

  // ── safe push helpers ──
  private _push<T>(
    arr: T[],
    counter: () => number,
    incr: (n: number) => void,
    value: T,
  ): void {
    try {
      incr(counter() + 1);
      if (arr.length < MAX_EVENTS_PER_CATEGORY) arr.push(value);
    } catch {
      /* swallow */
    }
  }

  // ── recorders ──

  recordSchemaCoercions(coercions: readonly SchemaCoercionEvent[]): void {
    try {
      for (const c of coercions) {
        this._push(
          this._schemaCoercions,
          () => this._schemaCoercionsCount,
          (n) => { this._schemaCoercionsCount = n; },
          c,
        );
      }
    } catch {
      /* swallow */
    }
  }

  recordSchemaRejection(event: SchemaRejectionEvent): void {
    this._push(
      this._schemaRejections,
      () => this._schemaRejectionsCount,
      (n) => { this._schemaRejectionsCount = n; },
      event,
    );
  }

  recordProxyFallback(event: ProxyFallbackEvent): void {
    this._push(
      this._proxyFallbacks,
      () => this._proxyFallbacksCount,
      (n) => { this._proxyFallbacksCount = n; },
      event,
    );
  }

  recordDroppedElement(event: DroppedElementEvent): void {
    this._push(
      this._droppedElements,
      () => this._droppedElementsCount,
      (n) => { this._droppedElementsCount = n; },
      event,
    );
  }

  recordMaterialMiss(event: MaterialMissEvent): void {
    this._push(
      this._materialMisses,
      () => this._materialMissesCount,
      (n) => { this._materialMissesCount = n; },
      event,
    );
  }

  recordRailwayError(event: RailwayErrorEvent): void {
    this._push(
      this._railwayErrors,
      () => this._railwayErrorsCount,
      (n) => { this._railwayErrorsCount = n; },
      event,
    );
  }

  recordToolError(): void {
    try {
      this._toolErrorsCount += 1;
    } catch {
      /* swallow */
    }
  }

  recordRenderPreviewCall(): void {
    try {
      this._renderPreviewCalls += 1;
    } catch {
      /* swallow */
    }
  }

  recordRequestedElementType(type: string): void {
    try {
      if (!type) return;
      this._requestedTypes[type] = (this._requestedTypes[type] ?? 0) + 1;
    } catch {
      /* swallow */
    }
  }

  setBuiltElementTypes(counts: Readonly<Record<string, number>>): void {
    try {
      for (const k of Object.keys(this._builtTypes)) delete this._builtTypes[k];
      for (const [k, v] of Object.entries(counts)) {
        if (typeof v === "number" && Number.isFinite(v)) this._builtTypes[k] = v;
      }
    } catch {
      /* swallow */
    }
  }

  setFinalized(value: boolean): void {
    try { this._finalized = value; } catch { /* swallow */ }
  }

  setTurns(turns: number): void {
    try {
      if (typeof turns === "number" && Number.isFinite(turns)) this._turns = turns;
    } catch { /* swallow */ }
  }

  setGeneratorCostUsd(cost: number): void {
    try {
      if (typeof cost === "number" && Number.isFinite(cost)) this._generatorCostUsd = cost;
    } catch { /* swallow */ }
  }

  setEntityCount(count: number): void {
    try {
      if (typeof count === "number" && Number.isFinite(count)) this._entityCount = count;
    } catch { /* swallow */ }
  }

  setFinalQualityScore(score: number): void {
    try {
      if (typeof score === "number" && Number.isFinite(score)) this._finalQualityScore = score;
    } catch { /* swallow */ }
  }

  setBriefType(type: string | null): void {
    try { this._briefType = type ?? null; } catch { /* swallow */ }
  }

  /** Merge a Python-side telemetry payload returned from the sandbox
   *  finalize endpoint. Shape is the Python-defined snapshot dict.
   *  Tolerant: any field can be missing or the wrong type. */
  mergePythonTelemetry(payload: unknown): void {
    try {
      if (!payload || typeof payload !== "object") return;
      const p = payload as Record<string, unknown>;

      const proxyFallbacks = p.proxy_fallbacks;
      if (Array.isArray(proxyFallbacks)) {
        for (const e of proxyFallbacks) {
          if (!e || typeof e !== "object") continue;
          const ev = e as Record<string, unknown>;
          this.recordProxyFallback({
            requested_type: String(ev.requested_type ?? "unknown"),
            ifc_class: String(ev.ifc_class ?? "IfcBuildingElementProxy"),
            element_id: typeof ev.element_id === "string" ? ev.element_id : undefined,
            reason: String(ev.reason ?? "unspecified"),
          });
        }
      }

      const materialMisses = p.material_misses;
      if (Array.isArray(materialMisses)) {
        for (const e of materialMisses) {
          if (!e || typeof e !== "object") continue;
          const ev = e as Record<string, unknown>;
          this.recordMaterialMiss({
            element_id: typeof ev.element_id === "string" ? ev.element_id : undefined,
            requested_material_id: String(ev.requested_material_id ?? ""),
            fallback_material_id: String(ev.fallback_material_id ?? ""),
          });
        }
      }

      const droppedElements = p.dropped_elements;
      if (Array.isArray(droppedElements)) {
        for (const e of droppedElements) {
          if (!e || typeof e !== "object") continue;
          const ev = e as Record<string, unknown>;
          this.recordDroppedElement({
            type: String(ev.type ?? "unknown"),
            element_id: typeof ev.element_id === "string" ? ev.element_id : undefined,
            reason: String(ev.reason ?? "unspecified"),
          });
        }
      }

      const builtCounts = p.built_element_counts;
      if (builtCounts && typeof builtCounts === "object") {
        const sanitized: Record<string, number> = {};
        for (const [k, v] of Object.entries(builtCounts as Record<string, unknown>)) {
          if (typeof v === "number" && Number.isFinite(v)) sanitized[k] = v;
        }
        this.setBuiltElementTypes(sanitized);
      }
    } catch {
      /* swallow — Python telemetry merge never crashes the build */
    }
  }

  snapshot(): BuildTelemetrySnapshot {
    const endedAt = Date.now();
    return {
      schemaVersion: "v1",
      runId: this.runId,
      iteration: this.iteration,
      briefType: this._briefType,
      startedAt: this._startedAtIso,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - this._startedAt,
      finalized: this._finalized,
      turns: this._turns,
      generatorCostUsd: this._generatorCostUsd,
      entityCount: this._entityCount,
      renderPreviewCalls: this._renderPreviewCalls,
      finalQualityScore: this._finalQualityScore,
      counts: {
        schemaCoercions: this._schemaCoercionsCount,
        schemaRejections: this._schemaRejectionsCount,
        proxyFallbacks: this._proxyFallbacksCount,
        droppedElements: this._droppedElementsCount,
        materialMisses: this._materialMissesCount,
        railwayErrors: this._railwayErrorsCount,
        toolErrors: this._toolErrorsCount,
      },
      elementTypeCounts: {
        requested: { ...this._requestedTypes },
        built: { ...this._builtTypes },
      },
      schemaCoercions: [...this._schemaCoercions],
      schemaRejections: [...this._schemaRejections],
      proxyFallbacks: [...this._proxyFallbacks],
      droppedElements: [...this._droppedElements],
      materialMisses: [...this._materialMisses],
      railwayErrors: [...this._railwayErrors],
    };
  }
}

/** Persist a telemetry snapshot. Writes one `ExecutionLog` row with
 *  `source="DIAGNOSTIC"` and the snapshot as `metadata`. Never throws
 *  — appendLog already swallows DB failures, and we wrap the call
 *  defensively in case of a future contract change. */
export async function emitBuildTelemetry(
  prisma: PrismaClient,
  snapshot: BuildTelemetrySnapshot,
): Promise<void> {
  try {
    await appendLog(prisma, {
      executionId: snapshot.runId,
      level: "INFO",
      source: "DIAGNOSTIC",
      message:
        `BuildTelemetry iter=${snapshot.iteration} ` +
        `finalized=${snapshot.finalized} ` +
        `coercions=${snapshot.counts.schemaCoercions} ` +
        `proxies=${snapshot.counts.proxyFallbacks} ` +
        `materialMisses=${snapshot.counts.materialMisses} ` +
        `turns=${snapshot.turns} ` +
        `qualityScore=${snapshot.finalQualityScore ?? "-"}`,
      metadata: snapshot as unknown as Record<string, unknown>,
    });
  } catch (err) {
    console.warn(
      `[telemetry] emitBuildTelemetry swallowed error for run ${snapshot.runId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Convenience: snapshot + emit in a single call, never throws. */
export async function snapshotAndEmit(
  prisma: PrismaClient,
  collector: BuildTelemetryCollector,
): Promise<BuildTelemetrySnapshot | null> {
  let snap: BuildTelemetrySnapshot | null = null;
  try {
    snap = collector.snapshot();
  } catch (err) {
    console.warn(
      `[telemetry] snapshot threw for run ${collector.runId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  await emitBuildTelemetry(prisma, snap);
  return snap;
}
