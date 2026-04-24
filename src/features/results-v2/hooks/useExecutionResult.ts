"use client";

import { useEffect, useMemo, useState } from "react";
import { useExecutionStore } from "@/features/execution/stores/execution-store";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import type { ExecutionArtifact } from "@/types/execution";
import { stripPrice } from "@/features/results-v2/lib/strip-price";
import type {
  ExecutionResult,
  ModelAttribution,
  PipelineStepView,
  Result3D,
  ResultDownload,
  ResultFloorPlan,
  ResultMetric,
  ResultTable,
  ResultVideo,
  ResultVideoSegment,
} from "@/features/results-v2/types";

/** Thin shape of the `/api/executions/[id]` response we care about. */
interface ApiExecution {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "success" | "partial" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  workflow?: { id: string; name?: string | null };
  artifacts: Array<{
    id: string;
    tileInstanceId: string;
    nodeId?: string;
    nodeLabel?: string | null;
    type: string;
    data: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }>;
  tileResults?: Array<Record<string, unknown>>;
}

type AnyRecord = Record<string, unknown>;
const asRec = (v: unknown): AnyRecord => (v as AnyRecord) ?? {};

function pickString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function pickNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

/** Normalize artifacts (either Map or array) into an array of the same shape. */
function artifactsToArray(
  source: Map<string, ExecutionArtifact> | ApiExecution["artifacts"],
): Array<{
  tileInstanceId: string;
  nodeLabel: string | null;
  type: string;
  data: AnyRecord;
  metadata: AnyRecord;
  createdAt: string;
}> {
  if (source instanceof Map) {
    return Array.from(source.values()).map(a => ({
      tileInstanceId: a.tileInstanceId,
      nodeLabel: null,
      type: a.type,
      data: stripPrice(asRec(a.data)),
      metadata: stripPrice(asRec(a.metadata)),
      createdAt: a.createdAt.toISOString(),
    }));
  }
  return source.map(a => ({
    tileInstanceId: a.tileInstanceId,
    nodeLabel: a.nodeLabel ?? null,
    type: a.type,
    data: stripPrice(asRec(a.data)),
    metadata: stripPrice(asRec(a.metadata)),
    createdAt: a.createdAt,
  }));
}

function detectVideo(
  artifacts: ReturnType<typeof artifactsToArray>,
  liveProgress: ReadonlyMap<string, { progress: number; status: string; phase?: string; failureMessage?: string }> | null,
): ResultVideo | null {
  const art = artifacts.find(a => a.type === "video");
  if (!art) return null;

  const d = art.data;
  const meta = art.metadata;
  const rawSegments = d.segments as Array<AnyRecord> | undefined;
  const segments: ResultVideoSegment[] | undefined = rawSegments?.map(s => ({
    label: pickString(s.label, "Segment"),
    videoUrl: pickString(s.persistedUrl ?? s.videoUrl),
    downloadUrl: pickString(s.persistedUrl ?? s.downloadUrl ?? s.videoUrl),
    durationSeconds: pickNumber(s.durationSeconds, 5),
  }));

  const progress = liveProgress?.get(art.tileInstanceId) ?? null;
  const statusFromArtifact = pickString(d.videoGenerationStatus);
  const statusFromProgress = progress?.status;
  const status: ResultVideo["status"] = (() => {
    const s = statusFromProgress ?? statusFromArtifact;
    if (s === "complete") return "complete";
    if (s === "failed") return "failed";
    if (s === "rendering" || s === "processing" || s === "submitting" || s === "client-rendering") return "rendering";
    // Fallback: if URL is present, treat as complete; otherwise pending
    if (pickString(d.videoUrl).length > 0 || pickString(d.persistedUrl).length > 0) return "complete";
    return "pending";
  })();

  return {
    nodeId: art.tileInstanceId,
    videoUrl: pickString(d.persistedUrl ?? d.videoUrl),
    downloadUrl: pickString(d.persistedUrl ?? d.downloadUrl ?? d.videoUrl),
    name: pickString(d.name, "walkthrough.mp4"),
    durationSeconds: pickNumber(d.durationSeconds, 15),
    shotCount: pickNumber(d.shotCount ?? meta.shotCount, 2),
    pipeline: pickString(d.pipeline ?? meta.pipeline) || undefined,
    segments,
    videoJobId: pickString(d.videoJobId ?? meta.videoJobId) || undefined,
    status,
    progress: progress?.progress,
    phase: progress?.phase,
    failureMessage: progress?.failureMessage,
  };
}

function detectModel3D(artifacts: ReturnType<typeof artifactsToArray>): Result3D | null {
  const art = artifacts.find(a => a.type === "3d");
  if (art) {
    const d = art.data;
    const glbUrl = pickString(d.glbUrl);
    if (glbUrl) {
      return {
        kind: "glb",
        glbUrl,
        ifcUrl: pickString(d.ifcUrl) || undefined,
        thumbnailUrl: pickString(d.thumbnailUrl) || undefined,
        polycount: typeof d.polycount === "number" ? d.polycount : undefined,
      };
    }
    if (d.floors != null || d.height != null || d.footprint != null) {
      return {
        kind: "procedural",
        floors: pickNumber(d.floors, 5),
        height: pickNumber(d.height, 21),
        footprint: pickNumber(d.footprint, 500),
        gfa: pickNumber(d.gfa, pickNumber(d.floors, 5) * pickNumber(d.footprint, 500)),
        buildingType: pickString(d.buildingType, "Mixed-Use"),
      };
    }
  }

  const html = artifacts.find(a => a.type === "html");
  if (html) {
    const d = html.data;
    return {
      kind: "html-iframe",
      iframeUrl: pickString(d.downloadUrl),
      iframeContent: pickString(d.html),
    };
  }

  return null;
}

function detectFloorPlan(artifacts: ReturnType<typeof artifactsToArray>): ResultFloorPlan | null {
  // Interactive floor plan (GN-012): json artifact with interactive:true
  const interactive = artifacts.find(a => a.type === "json" && a.data.interactive === true && a.data.floorPlanProject);
  if (interactive) {
    const summary = asRec(interactive.data.summary);
    return {
      kind: "interactive",
      svg: pickString(interactive.data.svgContent) || undefined,
      roomCount: typeof summary.totalRooms === "number" ? summary.totalRooms : undefined,
      wallCount: typeof summary.totalWalls === "number" ? summary.totalWalls : undefined,
      totalArea: typeof summary.totalArea_sqm === "number" ? summary.totalArea_sqm : undefined,
      buildingType: pickString(summary.buildingType) || undefined,
      label: pickString(interactive.data.label, "Floor Plan"),
    };
  }

  // Floor plan editor (html artifact with geometry + source image)
  const editor = artifacts.find(a => a.type === "html" && a.data.floorPlanGeometry && a.data.sourceImageUrl);
  if (editor) {
    const d = editor.data;
    return {
      kind: "editor",
      sourceImageUrl: pickString(d.sourceImageUrl),
      aiRenderUrl: pickString(d.aiRenderUrl) || undefined,
      roomCount: typeof d.roomCount === "number" ? d.roomCount : undefined,
      wallCount: typeof d.wallCount === "number" ? d.wallCount : undefined,
      label: pickString(d.label, "Floor Plan"),
    };
  }

  // SVG-only floor plan fallback
  const svg = artifacts.find(a => a.type === "svg");
  if (svg) {
    return {
      kind: "svg",
      svg: pickString(svg.data.svg ?? svg.data.content),
      label: pickString(svg.data.label, "Floor Plan"),
    };
  }

  return null;
}

function detectMetrics(artifacts: ReturnType<typeof artifactsToArray>): ResultMetric[] {
  const out: ResultMetric[] = [];
  for (const a of artifacts) {
    if (a.type !== "kpi") continue;
    const raw = a.data.metrics;
    if (!Array.isArray(raw)) continue;
    for (const m of raw) {
      const mm = asRec(m);
      const label = pickString(mm.label);
      const value = typeof mm.value === "number" ? mm.value : pickString(mm.value);
      if (!label) continue;
      // stripPrice already removed currency-ish values, but double-check.
      if (typeof value === "string" && /^\s*\$\s*[0-9]/.test(value)) continue;
      if (/cost|price|usd|dollar|amount|spend/i.test(label)) continue;
      out.push({
        label,
        value,
        unit: pickString(mm.unit) || undefined,
      });
    }
  }
  return out;
}

function detectTables(artifacts: ReturnType<typeof artifactsToArray>): ResultTable[] {
  const out: ResultTable[] = [];
  for (const a of artifacts) {
    if (a.type !== "table") continue;
    const d = a.data;
    const headers = Array.isArray(d.headers) ? (d.headers as string[]) : [];
    const rows = Array.isArray(d.rows) ? (d.rows as (string | number)[][]) : [];
    const label = pickString(d.label, "Table");
    const isBoq =
      label.toLowerCase().includes("bill of quantities") ||
      Boolean(d._boqData) ||
      Boolean(d._totalCost);
    out.push({ label, headers, rows, isBoq });
  }
  return out;
}

function detectDownloads(artifacts: ReturnType<typeof artifactsToArray>, video: ResultVideo | null): ResultDownload[] {
  const out: ResultDownload[] = [];

  if (video?.downloadUrl) {
    out.push({
      name: video.name,
      kind: "video",
      sizeBytes: 0,
      downloadUrl: video.downloadUrl,
    });
  }

  for (const a of artifacts) {
    if (a.type === "file") {
      const d = a.data;
      const name = pickString(d.fileName ?? d.name, "file");
      const downloadUrl = pickString(d.downloadUrl ?? d.url) || undefined;
      const lower = name.toLowerCase();
      let kind: ResultDownload["kind"] = "other";
      if (lower.endsWith(".mp4") || lower.endsWith(".webm")) kind = "video";
      else if (lower.endsWith(".glb") || lower.endsWith(".ifc") || lower.endsWith(".gltf")) kind = "model3d";
      else if (lower.endsWith(".pdf") || lower.endsWith(".docx")) kind = "document";
      else if (lower.endsWith(".svg") || lower.endsWith(".dxf") || lower.endsWith(".dwg")) kind = "drawing";
      else if (lower.endsWith(".xlsx") || lower.endsWith(".csv") || lower.endsWith(".json")) kind = "data";
      out.push({ name, kind, sizeBytes: pickNumber(d.size, 0), downloadUrl });
    } else if (a.type === "html") {
      const d = a.data;
      const downloadUrl = pickString(d.downloadUrl) || undefined;
      if (downloadUrl) {
        out.push({
          name: pickString(d.fileName, "3d-model.html"),
          kind: "model3d",
          sizeBytes: 0,
          downloadUrl,
        });
      }
    }
  }
  return out;
}

function detectModels(artifacts: ReturnType<typeof artifactsToArray>): ModelAttribution[] {
  const seen = new Set<string>();
  const out: ModelAttribution[] = [];
  const push = (name: string, family: ModelAttribution["family"]) => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, family });
  };
  for (const a of artifacts) {
    const m = a.metadata;
    const d = a.data;
    const engine = pickString(m.engine ?? d.engine).toLowerCase();
    const model = pickString(m.model ?? d.model).toLowerCase();
    if (engine.includes("kling") || model.includes("kling")) push("Kling 3.0", "kling");
    if (engine.includes("dall-e") || model.includes("dall-e") || engine.includes("gpt-image") || model.includes("gpt-image")) push("DALL-E 3", "openai");
    if (model.includes("gpt-4o") || engine.includes("gpt-4o")) push("GPT-4o", "openai");
    if (model.includes("claude")) push("Claude", "anthropic");
    if (engine.includes("replicate") || model.includes("replicate")) push("Replicate", "replicate");
  }
  return out;
}

function detectSummaryText(artifacts: ReturnType<typeof artifactsToArray>): string | null {
  const t = artifacts.find(a => a.type === "text");
  if (!t) return null;
  return pickString(t.data.content) || null;
}

function detectBoqSummary(artifacts: ReturnType<typeof artifactsToArray>): {
  gfa: number | null;
  currency: string | null;
} {
  for (const a of artifacts) {
    if (a.type !== "table") continue;
    const d = a.data;
    if (d._boqData || d._totalCost) {
      return {
        gfa: typeof d._gfa === "number" ? d._gfa : null,
        currency: pickString(d._currencySymbol) || null,
      };
    }
  }
  return { gfa: null, currency: null };
}

function normalize(
  executionId: string,
  workflowName: string,
  workflowId: string | null,
  status: ApiExecution["status"],
  startedAt: string | null,
  completedAt: string | null,
  artifactsSource: Map<string, ExecutionArtifact> | ApiExecution["artifacts"],
  nodes: Array<{ id: string; data: { label: string; category: string; catalogueId?: string; status: string } }>,
  liveProgress: ReadonlyMap<string, { progress: number; status: string; phase?: string; failureMessage?: string }> | null,
): ExecutionResult {
  const artifacts = artifactsToArray(artifactsSource);

  const video = detectVideo(artifacts, liveProgress);
  const model3d = detectModel3D(artifacts);
  const floorPlan = detectFloorPlan(artifacts);
  const tables = detectTables(artifacts);
  const metrics = detectMetrics(artifacts);
  const downloads = detectDownloads(artifacts, video);
  const models = detectModels(artifacts);
  const summaryText = detectSummaryText(artifacts);
  const boq = detectBoqSummary(artifacts);

  const images = artifacts
    .filter(a => a.type === "image")
    .map(a => pickString(a.data.url))
    .filter(Boolean);

  const pipeline: PipelineStepView[] = nodes.map(n => {
    const art = artifacts.find(a => a.tileInstanceId === n.id);
    const nodeStatus = n.data.status;
    const cat = n.data.category;
    return {
      nodeId: n.id,
      label: n.data.label,
      category: (cat === "input" || cat === "transform" || cat === "generate" || cat === "export") ? cat : "transform",
      catalogueId: n.data.catalogueId ?? "",
      status:
        nodeStatus === "success" ? "success" :
        nodeStatus === "error" ? "error" :
        nodeStatus === "running" ? "running" :
        nodeStatus === "skipped" ? "skipped" : "idle",
      artifactType: art?.type,
    };
  });

  const durationMs = startedAt && completedAt
    ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
    : null;

  return {
    executionId,
    workflowId,
    workflowName,
    status: {
      state: status,
      startedAt,
      completedAt,
      durationMs,
    },
    video,
    images,
    model3d,
    floorPlan,
    tables,
    metrics,
    boqTotalGfa: boq.gfa,
    boqCurrencySymbol: boq.currency,
    downloads,
    pipeline,
    models,
    summaryText,
  };
}

/**
 * Primary read hook for results-v2. When `executionId` matches the currently
 * running execution in the store, the live store is the source of truth.
 * Otherwise it fetches from `/api/executions/[id]` and normalizes that
 * payload. Either way, the output shape is identical.
 */
export function useExecutionResult(executionId: string): {
  result: ExecutionResult | null;
  loading: boolean;
  error: string | null;
} {
  const liveArtifacts = useExecutionStore(s => s.artifacts);
  const currentExecution = useExecutionStore(s => s.currentExecution);
  const videoGenProgress = useExecutionStore(s => s.videoGenProgress);
  const nodes = useWorkflowStore(s => s.nodes);
  const currentWorkflow = useWorkflowStore(s => s.currentWorkflow);

  const isLive = currentExecution?.id === executionId;

  // Single compound state — avoids synchronous setState-in-effect cascades.
  const [apiState, setApiState] = useState<{
    data: ApiExecution | null;
    loading: boolean;
    error: string | null;
    /** The executionId that `data` is for — used to invalidate stale reads when the prop changes. */
    key: string | null;
  }>({ data: null, loading: false, error: null, key: null });

  useEffect(() => {
    if (isLive) {
      // When live, the store is the source of truth; no fetch needed. All
      // state updates happen in async paths below, never synchronously in
      // this effect body.
      return;
    }
    let cancelled = false;
    fetch(`/api/executions/${executionId}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(body => {
        if (cancelled) return;
        setApiState({
          data: (body as { execution: ApiExecution }).execution ?? null,
          loading: false,
          error: null,
          key: executionId,
        });
      })
      .catch(err => {
        if (cancelled) return;
        setApiState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load execution",
          key: executionId,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [executionId, isLive]);

  // Derived state — avoids synchronous setState-in-effect cascades. When
  // the effect's executionId doesn't match `apiState.key`, we're in the
  // pre-fetch window and `loading` is implicitly true.
  const loading = isLive ? false : apiState.key !== executionId || apiState.loading;
  const error = isLive ? null : apiState.error;
  const apiData = apiState.key === executionId ? apiState.data : null;

  const result = useMemo<ExecutionResult | null>(() => {
    if (isLive) {
      return normalize(
        executionId,
        currentWorkflow?.name ?? "Workflow Results",
        currentExecution?.workflowId ?? currentWorkflow?.id ?? null,
        currentExecution?.status ?? "success",
        currentExecution?.startedAt?.toISOString() ?? currentExecution?.createdAt?.toISOString() ?? null,
        currentExecution?.completedAt?.toISOString() ?? null,
        liveArtifacts,
        nodes.map(n => ({
          id: n.id,
          data: {
            label: n.data.label,
            category: String(n.data.category),
            catalogueId: n.data.catalogueId,
            status: String(n.data.status),
          },
        })),
        videoGenProgress,
      );
    }
    if (!apiData) return null;
    // When hydrating from API, we don't have canvas nodes — build a minimal
    // pipeline from tileResults so the BehindTheScenes panel still has something
    // meaningful to show.
    const pseudoNodes = (apiData.tileResults ?? []).map((r, idx) => {
      const rec = r as AnyRecord;
      return {
        id: pickString(rec.nodeId, `node-${idx}`),
        data: {
          label: pickString(rec.nodeLabel, `Step ${idx + 1}`),
          category: pickString(rec.category, "transform"),
          catalogueId: pickString(rec.catalogueId) || undefined,
          status: pickString(rec.status, "success"),
        },
      };
    });
    return normalize(
      executionId,
      apiData.workflow?.name ?? "Workflow Results",
      apiData.workflowId ?? null,
      apiData.status,
      apiData.startedAt,
      apiData.completedAt,
      apiData.artifacts,
      pseudoNodes,
      null,
    );
  }, [isLive, apiData, executionId, currentExecution, currentWorkflow, liveArtifacts, nodes, videoGenProgress]);

  return { result, loading, error };
}
