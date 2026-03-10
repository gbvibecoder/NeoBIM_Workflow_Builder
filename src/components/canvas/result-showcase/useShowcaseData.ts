"use client";

import { useMemo } from "react";
import { useExecutionStore } from "@/stores/execution-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { ExecutionArtifact } from "@/types/execution";
import type { TabId } from "./constants";

// ─── Types ──────────────────────────────────────────────────────────────────

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
}

export interface FileDownload {
  name: string;
  type: string;
  size: number;
  downloadUrl?: string;
}

export interface VideoInfo {
  videoUrl: string;
  downloadUrl: string;
  name: string;
  durationSeconds: number;
  shotCount: number;
  pipeline?: string;
  costUsd?: number;
  nodeId: string;
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
  thumbnailUrl?: string;
  polycount?: number;
  topology?: string;
}

export type Model3DData = ProceduralModelData | GlbModelData;

export interface PipelineStep {
  nodeId: string;
  label: string;
  category: string;
  status: string;
  artifactType?: string;
}

export interface CostItem {
  label: string;
  value: number;
  total: number;
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
}

export interface ShowcaseData {
  projectTitle: string;
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
  availableTabs: TabId[];
  pipelineSteps: PipelineStep[];
  costBreakdown: CostItem[] | null;
  complianceItems: ComplianceItem[] | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function findByType(artifacts: Map<string, ExecutionArtifact>, type: string): ExecutionArtifact | undefined {
  for (const a of artifacts.values()) {
    if (a.type === type) return a;
  }
  return undefined;
}

function findAllByType(artifacts: Map<string, ExecutionArtifact>, type: string): ExecutionArtifact[] {
  const result: ExecutionArtifact[] = [];
  for (const a of artifacts.values()) {
    if (a.type === type) result.push(a);
  }
  return result;
}

function asRecord(data: unknown): Record<string, unknown> {
  return (data as Record<string, unknown>) ?? {};
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useShowcaseData(): ShowcaseData {
  const artifacts = useExecutionStore(s => s.artifacts);
  const currentExecution = useExecutionStore(s => s.currentExecution);
  const nodes = useWorkflowStore(s => s.nodes);
  const currentWorkflow = useWorkflowStore(s => s.currentWorkflow);

  return useMemo(() => {
    const projectTitle = currentWorkflow?.name ?? "Workflow Results";
    const successNodes = nodes.filter(n => n.data.status === "success").length;

    // Execution metadata
    const startedAt = currentExecution?.startedAt ?? currentExecution?.createdAt;
    const completedAt = currentExecution?.completedAt;
    const durationMs = startedAt && completedAt
      ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
      : null;
    const executionMeta: ExecutionMeta = {
      executedAt: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
      completedAt: completedAt ? new Date(completedAt).toISOString() : null,
      durationMs,
      status: currentExecution?.status ?? "success",
      workflowId: currentExecution?.workflowId ?? currentWorkflow?.id ?? null,
    };

    // ── Text ──
    const textArtifact = findByType(artifacts, "text");
    const textContent = textArtifact
      ? (asRecord(textArtifact.data)?.content as string) ?? ""
      : "";

    // ── Images ──
    const imageArtifacts = findAllByType(artifacts, "image");
    const allImageUrls = imageArtifacts
      .map(a => (asRecord(a.data)?.url as string) ?? "")
      .filter(Boolean);
    const heroImageUrl = allImageUrls[0] ?? null;

    // ── Video ──
    const videoArtifact = findByType(artifacts, "video");
    let videoData: VideoInfo | null = null;
    if (videoArtifact) {
      const d = asRecord(videoArtifact.data);
      const meta = asRecord(d.metadata);
      videoData = {
        videoUrl: (d.videoUrl as string) ?? "",
        downloadUrl: (d.downloadUrl as string) ?? (d.videoUrl as string) ?? "",
        name: (d.name as string) ?? "walkthrough.mp4",
        durationSeconds: (d.durationSeconds as number) ?? 15,
        shotCount: (d.shotCount as number) ?? (meta.shotCount as number) ?? 3,
        pipeline: (d.pipeline as string) ?? (meta.pipeline as string),
        costUsd: (d.costUsd as number) ?? (meta.costUsd as number) ?? undefined,
        nodeId: videoArtifact.tileInstanceId,
      };
    }

    // ── KPI ──
    const kpiArtifacts = findAllByType(artifacts, "kpi");
    const kpiMetrics: KpiMetric[] = [];
    kpiArtifacts.forEach(a => {
      const d = asRecord(a.data);
      const metrics = (d.metrics as KpiMetric[]) ?? [];
      kpiMetrics.push(...metrics);
    });

    // ── Tables ──
    const tableArtifacts = findAllByType(artifacts, "table");
    const tableData: TableDataItem[] = tableArtifacts.map(a => {
      const d = asRecord(a.data);
      return {
        headers: (d.headers as string[]) ?? [],
        rows: (d.rows as (string | number)[][]) ?? [],
        label: d.label as string | undefined,
      };
    });

    // ── SVG ──
    const svgArtifact = findByType(artifacts, "svg");
    const svgContent = svgArtifact
      ? (asRecord(svgArtifact.data)?.svg as string) ?? (asRecord(svgArtifact.data)?.content as string) ?? null
      : null;

    // ── 3D Model (discriminated) ──
    const threeDArtifact = findByType(artifacts, "3d");
    let model3dData: Model3DData | null = null;
    if (threeDArtifact) {
      const d = asRecord(threeDArtifact.data);
      if (d.glbUrl) {
        model3dData = {
          kind: "glb",
          glbUrl: d.glbUrl as string,
          thumbnailUrl: d.thumbnailUrl as string | undefined,
          polycount: d.polycount as number | undefined,
          topology: d.topology as string | undefined,
        };
      } else if (d.floors || d.height || d.footprint) {
        model3dData = {
          kind: "procedural",
          floors: (d.floors as number) ?? 5,
          height: (d.height as number) ?? 21,
          footprint: (d.footprint as number) ?? 500,
          gfa: (d.gfa as number) ?? ((d.floors as number) ?? 5) * ((d.footprint as number) ?? 500),
          buildingType: (d.buildingType as string) ?? "Mixed-Use",
          style: d.style as Record<string, unknown> | undefined,
        };
      }
    }

    // ── Files ──
    const fileArtifacts = findAllByType(artifacts, "file");
    const fileDownloads: FileDownload[] = fileArtifacts.map(a => {
      const d = asRecord(a.data);
      return {
        name: (d.name as string) ?? "file",
        type: (d.type as string) ?? "",
        size: (d.size as number) ?? 0,
        downloadUrl: d.downloadUrl as string | undefined,
      };
    });

    // ── JSON ──
    const jsonArtifacts = findAllByType(artifacts, "json");
    const jsonData = jsonArtifacts.map(a => {
      const d = asRecord(a.data);
      return {
        label: (d.label as string) ?? "JSON Data",
        json: (d.json as Record<string, unknown>) ?? d,
      };
    });

    // ── Pipeline steps ──
    const pipelineSteps: PipelineStep[] = nodes.map(n => {
      const artifact = artifacts.get(n.id);
      return {
        nodeId: n.id,
        label: n.data.label,
        category: n.data.category,
        status: n.data.status,
        artifactType: artifact?.type,
      };
    });

    // ── Cost breakdown (derived from KPI) ──
    const costKeywords = ["cost", "price", "budget", "expense", "total", "amount", "rate"];
    const costMetrics = kpiMetrics.filter(m =>
      costKeywords.some(kw => m.label.toLowerCase().includes(kw))
    );
    let costBreakdown: CostItem[] | null = null;
    if (costMetrics.length >= 2) {
      const maxVal = Math.max(...costMetrics.map(m => {
        const v = typeof m.value === "number" ? m.value : parseFloat(String(m.value));
        return isNaN(v) ? 0 : v;
      }));
      costBreakdown = costMetrics.map(m => {
        const v = typeof m.value === "number" ? m.value : parseFloat(String(m.value));
        return { label: m.label, value: isNaN(v) ? 0 : v, total: maxVal };
      });
    }

    // ── Compliance (derived from KPI) ──
    const complianceKeywords = ["compliance", "pass", "fail", "check", "status", "approved", "code"];
    const complianceMetrics = kpiMetrics.filter(m =>
      complianceKeywords.some(kw => m.label.toLowerCase().includes(kw))
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

    // ── Available tabs ──
    const availableTabs: TabId[] = ["overview"]; // always present
    if (videoData || allImageUrls.length > 0 || svgContent) {
      availableTabs.push("media");
    }
    if (tableData.length > 0 || jsonData.length > 0 || kpiMetrics.length > 0) {
      availableTabs.push("data");
    }
    if (model3dData || svgContent) {
      availableTabs.push("model");
    }
    availableTabs.push("export"); // always present

    return {
      projectTitle,
      totalArtifacts: artifacts.size,
      successNodes,
      totalNodes: nodes.length,
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
      availableTabs,
      pipelineSteps,
      costBreakdown,
      complianceItems,
    };
  }, [artifacts, nodes, currentWorkflow, currentExecution]);
}
