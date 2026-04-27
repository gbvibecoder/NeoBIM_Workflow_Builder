"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useExecutionStore,
  selectHydrateDiagnostics,
} from "@/features/execution/stores/execution-store";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import type { ExecutionArtifact, VideoGenerationState } from "@/types/execution";
import type { FloorPlanGeometry } from "@/features/floor-plan/types/floor-plan";
import type { FloorPlanProject } from "@/types/floor-plan-cad";
import { extractClashSummary, type ClashSummary } from "@/features/result-page/lib/extract-clash-summary";

// ─── Lifecycle states (D4) ──────────────────────────────────────────────────
export type ResultLifecycle =
  | "loading"
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "not-found"
  | "forbidden";

// ─── Normalized artifact-driven shapes ──────────────────────────────────────

export interface KpiMetric {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
}

export interface TableDataItem {
  headers: string[];
  rows: (string | number)[][];
  label?: string;
  tileInstanceId?: string;
  isQuantityTable?: boolean;
}

export interface FileDownload {
  name: string;
  type: string;
  size: number;
  downloadUrl?: string;
  _rawContent?: string;
  ifcEngine?: "ifcopenshell" | "ifc-exporter";
  ifcServicePath?: "python" | "ts-fallback";
  ifcServiceUsed?: boolean;
  ifcServiceSkipReason?: string;
}

export interface VideoSegmentInfo {
  videoUrl: string;
  downloadUrl: string;
  durationSeconds: number;
  label: string;
}

export interface VideoInfo {
  videoUrl: string;
  downloadUrl: string;
  name: string;
  durationSeconds: number;
  shotCount: number;
  pipeline?: string;
  nodeId: string;
  segments?: VideoSegmentInfo[];
  videoJobId?: string;
}

export interface ProceduralModelData {
  kind: "procedural";
  floors: number;
  height: number;
  footprint: number;
  gfa: number;
  buildingType: string;
  style?: Record<string, unknown>;
}

export interface GlbModelData {
  kind: "glb";
  glbUrl: string;
  metadataUrl?: string;
  ifcUrl?: string;
  thumbnailUrl?: string;
  polycount?: number;
  topology?: string;
}

export interface HtmlIframeModelData {
  kind: "html-iframe";
  url: string;
  content: string;
  label: string;
  roomCount?: number;
  wallCount?: number;
  geometry?: FloorPlanGeometry;
  aiRenderUrl?: string;
}

export interface FloorPlanEditorData {
  kind: "floor-plan-editor";
  geometry: FloorPlanGeometry;
  sourceImageUrl: string;
  url: string;
  content: string;
  label: string;
  roomCount?: number;
  wallCount?: number;
  aiRenderUrl?: string;
}

export interface FloorPlanInteractiveData {
  kind: "floor-plan-interactive";
  floorPlanProject: FloorPlanProject;
  boqQuantities: Record<string, unknown>;
  roomSchedule: Array<Record<string, unknown>>;
  svgContent: string;
  label: string;
  summary: {
    totalRooms: number;
    totalArea_sqm: number;
    totalWalls: number;
    totalDoors: number;
    totalWindows: number;
    floorCount: number;
    buildingType: string;
  };
}

export type Model3DData =
  | ProceduralModelData
  | GlbModelData
  | HtmlIframeModelData
  | FloorPlanEditorData
  | FloorPlanInteractiveData;

export interface PipelineStep {
  nodeId: string;
  label: string;
  category: string;
  status: string;
  artifactType?: string;
}

export interface ComplianceItem {
  label: string;
  status: "pass" | "fail" | "warning";
  detail?: string;
}

export interface ExecutionMeta {
  executedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: string;
  workflowId: string | null;
  errorMessage: string | null;
}

export interface BoqSummary {
  totalCost: number;
  gfa: number;
  region: string;
  executionId: string;
  currencySymbol: string;
}

export interface ResultPageData {
  // Identity
  executionId: string;
  projectTitle: string;
  workflowId: string | null;

  // Lifecycle
  lifecycle: ResultLifecycle;
  isVideoGenerating: boolean;
  primaryVideoProgress: VideoGenerationState | null;

  // Counts
  totalArtifacts: number;
  successNodes: number;
  totalNodes: number;

  // Execution metadata
  executionMeta: ExecutionMeta;

  // Categorized artifacts
  textContent: string;
  heroImageUrl: string | null;
  allImageUrls: string[];
  videoData: VideoInfo | null;
  kpiMetrics: KpiMetric[];
  tableData: TableDataItem[];
  svgContent: string | null;
  model3dData: Model3DData | null;
  fileDownloads: FileDownload[];
  jsonData: Array<{ label: string; json: Record<string, unknown> }>;

  // Derived
  pipelineSteps: PipelineStep[];
  complianceItems: ComplianceItem[] | null;
  boqSummary: BoqSummary | null;
  clashSummary: ClashSummary | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function asRecord(data: unknown): Record<string, unknown> {
  return (data as Record<string, unknown>) ?? {};
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function findByType(
  artifacts: Map<string, ExecutionArtifact>,
  type: string,
): ExecutionArtifact | undefined {
  for (const a of artifacts.values()) if (a.type === type) return a;
  return undefined;
}

function findAllByType(
  artifacts: Map<string, ExecutionArtifact>,
  type: string,
): ExecutionArtifact[] {
  const out: ExecutionArtifact[] = [];
  for (const a of artifacts.values()) if (a.type === type) out.push(a);
  return out;
}

interface ApiArtifact {
  id?: string;
  tileInstanceId?: string;
  nodeId?: string;
  nodeLabel?: string | null;
  type?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

interface ApiExecutionResponse {
  execution?: {
    id: string;
    workflowId?: string;
    userId?: string;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
    errorMessage?: string | null;
    metadata?: {
      diagnostics?: unknown;
      videoGenProgress?: Record<string, VideoGenerationState>;
      quantityOverrides?: Record<string, Record<string, number>>;
      regenerationCounts?: Record<string, number>;
    } | null;
    workflow?: { id: string; name: string };
    artifacts?: ApiArtifact[];
  };
}

interface FetchedState {
  status: "loading" | "ready" | "not-found" | "forbidden" | "error";
  artifacts: Map<string, ExecutionArtifact>;
  workflowName: string | null;
  workflowId: string | null;
  executionStatus: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  pipelineFromArtifacts: PipelineStep[];
}

// ─── Main hook ───────────────────────────────────────────────────────────────

export function useResultPageData(executionId: string): ResultPageData {
  // Sources of truth (live store first, API fetch as fallback / hydration source)
  const liveArtifacts = useExecutionStore(s => s.artifacts);
  const liveExecution = useExecutionStore(s => s.currentExecution);
  const liveDbExecutionId = useExecutionStore(s => s.currentDbExecutionId);
  const videoGenProgress = useExecutionStore(s => s.videoGenProgress);
  const nodes = useWorkflowStore(s => s.nodes);
  const currentWorkflow = useWorkflowStore(s => s.currentWorkflow);
  const hydrateDiagnostics = useExecutionStore(selectHydrateDiagnostics);

  // The URL id is the DB CUID (post-canvas-run navigation); the in-memory
  // currentExecution.id is a 12-char generateId() value. Recognize either
  // so a fresh post-run mount uses live artifacts directly without a
  // round-trip to /api/executions/[id].
  const matchesLive =
    (liveExecution?.id === executionId || liveDbExecutionId === executionId) &&
    liveArtifacts.size > 0;

  const [fetched, setFetched] = useState<FetchedState>({
    status: "loading",
    artifacts: new Map(),
    workflowName: null,
    workflowId: null,
    executionStatus: "RUNNING",
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    pipelineFromArtifacts: [],
  });

  // ── Fetch on mount when not matching live store ───────────────────────────
  useEffect(() => {
    if (!executionId) return;
    if (matchesLive) {
      setFetched(prev =>
        prev.status === "loading" ? { ...prev, status: "ready" } : prev,
      );
      return;
    }
    let cancelled = false;
    setFetched(prev => ({ ...prev, status: "loading" }));
    fetch(`/api/executions/${executionId}`, { cache: "no-store" })
      .then(async r => {
        if (cancelled) return;
        if (r.status === 401 || r.status === 403) {
          setFetched(prev => ({ ...prev, status: "forbidden" }));
          return;
        }
        if (r.status === 404) {
          setFetched(prev => ({ ...prev, status: "not-found" }));
          return;
        }
        if (!r.ok) {
          setFetched(prev => ({ ...prev, status: "error" }));
          return;
        }
        const json = (await r.json()) as ApiExecutionResponse;
        if (cancelled) return;
        const exec = json.execution;
        if (!exec) {
          setFetched(prev => ({ ...prev, status: "not-found" }));
          return;
        }
        const map = new Map<string, ExecutionArtifact>();
        const pipeline: PipelineStep[] = [];
        const apiArtifacts = exec.artifacts ?? [];
        apiArtifacts.forEach(art => {
          const nodeId = art.tileInstanceId ?? art.nodeId ?? `node-${art.id ?? Math.random()}`;
          map.set(nodeId, {
            id: art.id ?? `restored-${nodeId}`,
            executionId: exec.id,
            tileInstanceId: nodeId,
            type: (art.type ?? "json") as ExecutionArtifact["type"],
            data: art.data ?? {},
            metadata: { ...(art.metadata ?? {}), restored: true },
            createdAt: art.createdAt ? new Date(art.createdAt) : new Date(),
          });
          pipeline.push({
            nodeId,
            label: art.nodeLabel ?? art.type ?? "Node",
            category: deriveCategoryFromType(art.type ?? "json"),
            status: "success",
            artifactType: art.type,
          });
        });

        // Hydrate diagnostics into the store so the Diagnostics tab works
        const traceLike = exec.metadata?.diagnostics;
        if (
          traceLike &&
          typeof traceLike === "object" &&
          (traceLike as { executionId?: unknown }).executionId
        ) {
          hydrateDiagnostics(traceLike as Parameters<typeof hydrateDiagnostics>[0]);
        }

        setFetched({
          status: "ready",
          artifacts: map,
          workflowName: exec.workflow?.name ?? null,
          workflowId: exec.workflow?.id ?? exec.workflowId ?? null,
          executionStatus: exec.status,
          startedAt: exec.startedAt ?? null,
          completedAt: exec.completedAt ?? null,
          errorMessage: exec.errorMessage ?? null,
          pipelineFromArtifacts: pipeline,
        });
      })
      .catch(() => {
        if (!cancelled) setFetched(prev => ({ ...prev, status: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [executionId, matchesLive, hydrateDiagnostics]);

  // ── Build the normalized ResultPageData shape ────────────────────────────
  return useMemo<ResultPageData>(() => {
    const artifacts = matchesLive ? liveArtifacts : fetched.artifacts;

    // Lifecycle resolution
    let lifecycle: ResultLifecycle = "loading";
    if (matchesLive) {
      const liveStatus = liveExecution?.status;
      if (liveStatus === "running" || useExecutionStore.getState().isExecuting) {
        lifecycle = "running";
      } else if (liveStatus === "failed") lifecycle = "failed";
      else if (liveStatus === "partial") lifecycle = "partial";
      else lifecycle = "success";
    } else {
      switch (fetched.status) {
        case "loading":
          lifecycle = "loading";
          break;
        case "not-found":
          lifecycle = "not-found";
          break;
        case "forbidden":
          lifecycle = "forbidden";
          break;
        case "error":
          lifecycle = "failed";
          break;
        case "ready": {
          const s = fetched.executionStatus.toUpperCase();
          if (s === "RUNNING" || s === "PENDING") lifecycle = "running";
          else if (s === "FAILED") lifecycle = "failed";
          else if (s === "PARTIAL") lifecycle = "partial";
          else lifecycle = "success";
          break;
        }
      }
    }

    // Project title + workflow id
    const projectTitle =
      currentWorkflow?.name ??
      fetched.workflowName ??
      "Workflow Results";
    const workflowId =
      liveExecution?.workflowId ??
      currentWorkflow?.id ??
      fetched.workflowId ??
      null;

    // Execution metadata
    const startedAt =
      (matchesLive ? liveExecution?.startedAt : null) ??
      (fetched.startedAt ? new Date(fetched.startedAt) : null);
    const completedAt =
      (matchesLive ? liveExecution?.completedAt : null) ??
      (fetched.completedAt ? new Date(fetched.completedAt) : null);
    const durationMs =
      startedAt && completedAt
        ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
        : null;
    const executionMeta: ExecutionMeta = {
      executedAt: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
      completedAt: completedAt ? new Date(completedAt).toISOString() : null,
      durationMs,
      status: matchesLive ? liveExecution?.status ?? "success" : fetched.executionStatus.toLowerCase(),
      workflowId,
      errorMessage: matchesLive ? liveExecution?.errorMessage ?? null : fetched.errorMessage,
    };

    // ── Text ─────────
    const textArtifact = findByType(artifacts, "text");
    const textContent = textArtifact
      ? asStr(asRecord(textArtifact.data).content) ?? ""
      : "";

    // ── Images ─────────
    const imageArtifacts = findAllByType(artifacts, "image");
    const allImageUrls = imageArtifacts
      .map(a => asStr(asRecord(a.data).url) ?? "")
      .filter(Boolean);
    const heroImageUrl = allImageUrls[0] ?? null;

    // ── Video (single primary) ──
    const videoArtifact = findByType(artifacts, "video");
    let videoData: VideoInfo | null = null;
    if (videoArtifact) {
      const d = asRecord(videoArtifact.data);
      const meta = asRecord(d.metadata);
      const rawSegments = d.segments as Array<Record<string, unknown>> | undefined;
      const segments: VideoSegmentInfo[] | undefined = rawSegments?.map(s => ({
        videoUrl: asStr(s.persistedUrl) ?? asStr(s.videoUrl) ?? "",
        downloadUrl: asStr(s.persistedUrl) ?? asStr(s.downloadUrl) ?? asStr(s.videoUrl) ?? "",
        durationSeconds: asNum(s.durationSeconds) ?? 5,
        label: asStr(s.label) ?? "Segment",
      }));
      videoData = {
        videoUrl: asStr(d.persistedUrl) ?? asStr(d.videoUrl) ?? "",
        downloadUrl: asStr(d.persistedUrl) ?? asStr(d.downloadUrl) ?? asStr(d.videoUrl) ?? "",
        name: asStr(d.name) ?? "walkthrough.mp4",
        durationSeconds: asNum(d.durationSeconds) ?? 15,
        shotCount: asNum(d.shotCount) ?? asNum(meta.shotCount) ?? 3,
        pipeline: asStr(d.pipeline) ?? asStr(meta.pipeline),
        nodeId: videoArtifact.tileInstanceId,
        segments,
        videoJobId: asStr(d.videoJobId) ?? asStr(meta.videoJobId),
      };
    }

    // Live video generation progress for the primary video node
    const primaryVideoProgress = videoData?.nodeId
      ? videoGenProgress.get(videoData.nodeId) ?? null
      : null;
    // If the video URL already exists, the video is ready — stale progress
    // state should never block the finished video from displaying.
    const videoAlreadyReady = !!(videoData?.videoUrl);
    const isVideoGenerating =
      !videoAlreadyReady &&
      !!primaryVideoProgress &&
      (primaryVideoProgress.status === "submitting" ||
        primaryVideoProgress.status === "processing" ||
        primaryVideoProgress.status === "rendering");

    // ── KPIs ─────────
    const kpiMetrics: KpiMetric[] = [];
    findAllByType(artifacts, "kpi").forEach(a => {
      const d = asRecord(a.data);
      const metrics = (d.metrics as KpiMetric[]) ?? [];
      kpiMetrics.push(...metrics);
    });

    // ── Tables ─────────
    const tableData: TableDataItem[] = findAllByType(artifacts, "table").map(a => {
      const d = asRecord(a.data);
      const label = asStr(d.label);
      const isQuantityTable = (label?.toLowerCase().includes("extracted quantities")) ?? false;
      return {
        headers: (d.headers as string[]) ?? [],
        rows: (d.rows as (string | number)[][]) ?? [],
        label,
        tileInstanceId: a.tileInstanceId,
        isQuantityTable,
      };
    });

    // ── BOQ summary detection (TR-008) ─────────
    let boqSummary: BoqSummary | null = null;
    for (const a of artifacts.values()) {
      if (a.type !== "table") continue;
      const d = asRecord(a.data);
      const hasBOQData = !!d._boqData || !!d._totalCost;
      const labelMatch = typeof d.label === "string" && d.label.toLowerCase().includes("bill of quantities");
      const nodeForArtifact = nodes.find(n => n.id === a.tileInstanceId);
      const isTR008 = nodeForArtifact?.data?.catalogueId === "TR-008";
      if (hasBOQData || labelMatch || isTR008) {
        boqSummary = {
          totalCost: asNum(d._totalCost) ?? 0,
          gfa: asNum(d._gfa) ?? 0,
          region: asStr(d._region) ?? "",
          executionId,
          currencySymbol: asStr(d._currencySymbol) ?? "₹",
        };
        break;
      }
    }

    // ── Clash summary detection (TR-016) — D3 ─────────
    const clashSummary = extractClashSummary(artifacts.values());

    // ── SVG ─────────
    const svgArtifact = findByType(artifacts, "svg");
    const svgContent = svgArtifact
      ? asStr(asRecord(svgArtifact.data).svg) ?? asStr(asRecord(svgArtifact.data).content) ?? null
      : null;

    // ── 3D Model (discriminated) ─────────
    let model3dData: Model3DData | null = null;
    const threeDArtifact = findByType(artifacts, "3d");
    if (threeDArtifact) {
      const d = asRecord(threeDArtifact.data);
      if (asStr(d.glbUrl)) {
        model3dData = {
          kind: "glb",
          glbUrl: asStr(d.glbUrl) ?? "",
          metadataUrl: asStr(d.metadataUrl),
          ifcUrl: asStr(d.ifcUrl),
          thumbnailUrl: asStr(d.thumbnailUrl),
          polycount: asNum(d.polycount),
          topology: asStr(d.topology),
        };
      } else if (d.floors || d.height || d.footprint) {
        model3dData = {
          kind: "procedural",
          floors: asNum(d.floors) ?? 5,
          height: asNum(d.height) ?? 21,
          footprint: asNum(d.footprint) ?? 500,
          gfa: asNum(d.gfa) ?? (asNum(d.floors) ?? 5) * (asNum(d.footprint) ?? 500),
          buildingType: asStr(d.buildingType) ?? "Mixed-Use",
          style: d.style as Record<string, unknown> | undefined,
        };
      }
    }

    // GN-012 floor-plan-interactive (json artifact)
    if (!model3dData) {
      for (const a of artifacts.values()) {
        if (a.type !== "json") continue;
        const d = asRecord(a.data);
        if (d.interactive === true && d.floorPlanProject) {
          const summary = asRecord(d.summary ?? {});
          model3dData = {
            kind: "floor-plan-interactive",
            floorPlanProject: d.floorPlanProject as FloorPlanProject,
            boqQuantities: asRecord(d.boqQuantities ?? {}),
            roomSchedule: (d.roomSchedule as Array<Record<string, unknown>>) ?? [],
            svgContent: asStr(d.svgContent) ?? "",
            label: asStr(d.label) ?? "Floor Plan Editor",
            summary: {
              totalRooms: asNum(summary.totalRooms) ?? 0,
              totalArea_sqm: asNum(summary.totalArea_sqm) ?? 0,
              totalWalls: asNum(summary.totalWalls) ?? 0,
              totalDoors: asNum(summary.totalDoors) ?? 0,
              totalWindows: asNum(summary.totalWindows) ?? 0,
              floorCount: asNum(summary.floorCount) ?? 1,
              buildingType: asStr(summary.buildingType) ?? "residential",
            },
          };
          break;
        }
      }
    }

    // GN-011 html-iframe / floor-plan-editor (html artifact)
    const htmlArtifact = findByType(artifacts, "html");
    if (!model3dData && htmlArtifact) {
      const d = asRecord(htmlArtifact.data);
      const hasEditorData = d.floorPlanGeometry && d.sourceImageUrl;
      if (hasEditorData) {
        model3dData = {
          kind: "floor-plan-editor",
          geometry: d.floorPlanGeometry as FloorPlanGeometry,
          sourceImageUrl: asStr(d.sourceImageUrl) ?? "",
          url: asStr(d.downloadUrl) ?? "",
          content: asStr(d.html) ?? "",
          label: asStr(d.label) ?? "Floor Plan Editor",
          roomCount: asNum(d.roomCount),
          wallCount: asNum(d.wallCount),
          aiRenderUrl: typeof d.aiRenderUrl === "string" && d.aiRenderUrl.length > 10 ? d.aiRenderUrl : undefined,
        };
      } else {
        model3dData = {
          kind: "html-iframe",
          url: asStr(d.downloadUrl) ?? "",
          content: asStr(d.html) ?? "",
          label: asStr(d.label) ?? "Interactive 3D Viewer",
          roomCount: asNum(d.roomCount),
          wallCount: asNum(d.wallCount),
          geometry: d.floorPlanGeometry as FloorPlanGeometry | undefined,
          aiRenderUrl: typeof d.aiRenderUrl === "string" && d.aiRenderUrl.length > 10 ? d.aiRenderUrl : undefined,
        };
      }
    }

    // ── File downloads (IFC / PDF / XLSX / etc.) ─────────
    const fileDownloads: FileDownload[] = findAllByType(artifacts, "file").map(a => {
      const d = asRecord(a.data);
      const m = asRecord(a.metadata);
      const engineRaw = asStr(m.engine);
      const ifcEngine: FileDownload["ifcEngine"] =
        engineRaw === "ifcopenshell" || engineRaw === "ifc-exporter" ? engineRaw : undefined;
      const pathRaw = asStr(m.ifcServicePath);
      const ifcServicePath: FileDownload["ifcServicePath"] =
        pathRaw === "python" || pathRaw === "ts-fallback" ? pathRaw : undefined;
      return {
        name: asStr(d.fileName) ?? asStr(d.name) ?? "file",
        type: asStr(d.type) ?? "",
        size: asNum(d.size) ?? 0,
        downloadUrl: asStr(d.downloadUrl) ?? asStr(d.url),
        _rawContent: asStr(d._ifcContent) ?? asStr(d._rawContent),
        ifcEngine,
        ifcServicePath,
        ifcServiceUsed: typeof m.ifcServiceUsed === "boolean" ? m.ifcServiceUsed : undefined,
        ifcServiceSkipReason: asStr(m.ifcServiceSkipReason),
      };
    });
    if (htmlArtifact) {
      const d = asRecord(htmlArtifact.data);
      const dlUrl = asStr(d.downloadUrl);
      if (dlUrl) {
        fileDownloads.push({
          name: asStr(d.fileName) ?? "3d-model.html",
          type: "Interactive 3D Model",
          size: 0,
          downloadUrl: dlUrl,
        });
      }
    }

    // ── JSON ─────────
    const jsonData = findAllByType(artifacts, "json").map(a => {
      const d = asRecord(a.data);
      return {
        label: asStr(d.label) ?? "JSON Data",
        json: (d.json as Record<string, unknown>) ?? d,
      };
    });

    // ── Pipeline steps ─────────
    let pipelineSteps: PipelineStep[];
    if (matchesLive && nodes.length > 0) {
      pipelineSteps = nodes.map(n => {
        const artifact = artifacts.get(n.id);
        return {
          nodeId: n.id,
          label: n.data.label,
          category: n.data.category,
          status: n.data.status,
          artifactType: artifact?.type,
        };
      });
    } else {
      pipelineSteps = fetched.pipelineFromArtifacts;
    }

    // Derived success counts (used by the status pill)
    const totalNodes = matchesLive
      ? nodes.length
      : fetched.pipelineFromArtifacts.length || artifacts.size;
    const successNodes = matchesLive
      ? nodes.filter(n => n.data.status === "success").length
      : fetched.pipelineFromArtifacts.filter(s => s.status === "success").length;

    // Compliance derivation (kept — useful signal, not jargon)
    const complianceKeywords = ["compliance", "pass", "fail", "check", "approved"];
    const complianceMetrics = kpiMetrics.filter(m =>
      complianceKeywords.some(kw => m.label.toLowerCase().includes(kw)),
    );
    let complianceItems: ComplianceItem[] | null = null;
    if (complianceMetrics.length >= 1) {
      complianceItems = complianceMetrics.map(m => {
        const val = String(m.value).toLowerCase();
        let status: "pass" | "fail" | "warning" = "warning";
        if (val.includes("pass") || val.includes("yes") || val.includes("approved") || val === "true") status = "pass";
        else if (val.includes("fail") || val.includes("no") || val.includes("rejected") || val === "false") status = "fail";
        return { label: m.label, status, detail: String(m.value) };
      });
    }

    return {
      executionId,
      projectTitle,
      workflowId,
      lifecycle,
      isVideoGenerating,
      primaryVideoProgress,
      totalArtifacts: artifacts.size,
      successNodes,
      totalNodes,
      executionMeta,
      textContent,
      heroImageUrl,
      allImageUrls,
      videoData,
      kpiMetrics,
      tableData,
      svgContent,
      model3dData,
      fileDownloads,
      jsonData,
      pipelineSteps,
      complianceItems,
      boqSummary,
      clashSummary,
    };
  }, [
    matchesLive,
    liveArtifacts,
    liveExecution,
    videoGenProgress,
    nodes,
    currentWorkflow,
    fetched,
    executionId,
  ]);
}

function deriveCategoryFromType(type: string): string {
  switch (type) {
    case "image":
    case "video":
    case "svg":
    case "3d":
    case "html":
      return "generate";
    case "file":
      return "export";
    case "table":
    case "kpi":
    case "json":
      return "transform";
    case "text":
      return "input";
    default:
      return "transform";
  }
}
