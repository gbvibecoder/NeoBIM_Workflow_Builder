"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useExecutionStore } from "@/stores/execution-store";
import { useUIStore } from "@/stores/ui-store";
import { executeNode as mockExecuteNode } from "@/services/mock-executor";
import { inputFileStore } from "@/components/canvas/nodes/InputNode";
import { generateId } from "@/lib/utils";
import { awardXP } from "@/lib/award-xp";
import { trackWorkflowExecuted, trackNodeUsed, trackRegenerationUsed } from "@/lib/track";
import type { Execution, ExecutionArtifact } from "@/types/execution";
import type { WorkflowNode } from "@/types/nodes";
import type { LogEntry } from "@/components/canvas/ExecutionLog";

// All node IDs that have real API implementations on the server
const REAL_NODE_IDS = new Set(["TR-001", "TR-003", "TR-004", "TR-005", "TR-012", "GN-003", "GN-004", "GN-009", "GN-010", "TR-007", "TR-008", "EX-002", "EX-003"]);

// Live nodes — ALWAYS use real API execution regardless of NEXT_PUBLIC_ENABLE_MOCK_EXECUTION.
// These are production-ready and should never fall through to mock when authenticated.
const LIVE_NODE_IDS = new Set([
  "TR-001",  // Brief Parser — MUST be live to extract actual PDF text (mock returns hardcoded data)
  "TR-003",  // Design Brief Analyzer (GPT-4o-mini)
  "TR-007",  // Quantity Extractor (web-ifc, no API key)
  "TR-008",  // BOQ / Cost Mapper (cost database, no API key)
  "GN-003",  // Concept Render Generator (DALL-E 3)
  "GN-009",  // Video Walkthrough Generator (Kling 2.1 via fal.ai)
  "GN-010",  // Hi-Fi 3D Reconstructor (Meshy v4)
  "EX-002",  // BOQ Spreadsheet Exporter (xlsx, no API key)
]);

interface APIErrorResponse {
  error: {
    title: string;
    message: string;
    code: string;
    action?: string;
    actionUrl?: string;
  };
  details?: string;
}

// Input node IDs whose user-supplied value should pass through directly
const INPUT_NODE_IDS = new Set(["IN-001", "IN-002", "IN-003", "IN-005", "IN-006"]);

// Demo-allowed node IDs (routed to /api/demo/execute)
const DEMO_NODE_IDS = new Set(["TR-003", "GN-003"]);

// Route execution to real API, demo API, or mock
async function executeNode(
  node: WorkflowNode,
  executionId: string,
  previousArtifact?: ExecutionArtifact | null,
  useRealExecution = false,
  demoMode = false
): Promise<ExecutionArtifact> {
  const { catalogueId, inputValue } = node.data as { catalogueId: string; inputValue?: string };

  // For input nodes, pass through the user's actual typed/selected value
  // instead of using the mock executor (which returns hardcoded placeholder text)
  if (INPUT_NODE_IDS.has(catalogueId)) {
    await new Promise(r => setTimeout(r, 150)); // brief delay for UX
    const nodeData = node.data as Record<string, unknown>;
    let fileData = nodeData.fileData as string | undefined;
    let fileName = nodeData.fileName as string | undefined;
    let mimeType = nodeData.mimeType as string | undefined;

    // Read from inputFileStore (where FileUploadInput stores the actual File object)
    // and convert to base64 so it can be sent to the server API
    const fileObj = inputFileStore.get(node.id);
    if (fileObj && !fileData) {
      console.log(`[INPUT] Converting file "${fileObj.name}" (${fileObj.size} bytes) to base64`);
      const arrayBuffer = await fileObj.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      fileData = btoa(binary);
      fileName = fileObj.name;
      mimeType = fileObj.type || "application/pdf";
      console.log(`[INPUT] base64 length: ${fileData.length} chars`);
    }

    return {
      id: generateId(),
      executionId,
      tileInstanceId: node.id,
      type: "text",
      data: {
        content: inputValue ?? "",
        prompt: inputValue ?? "",
        label: "User Input",
        ...(fileData && { fileData }),
        ...(fileName && { fileName }),
        ...(mimeType && { mimeType }),
      },
      metadata: { source: "user-input" },
      createdAt: new Date(),
    };
  }

  // Demo mode: route allowed nodes to unauthenticated demo endpoint
  if (demoMode && DEMO_NODE_IDS.has(catalogueId)) {
    const res = await fetch("/api/demo/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogueId,
        executionId,
        tileInstanceId: node.id,
        inputData: previousArtifact?.data ?? { prompt: inputValue ?? "" },
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: { message: "Demo request failed" } }));
      throw new Error(errData.error?.message ?? "Demo execution failed");
    }

    const { artifact } = await res.json() as { artifact: ExecutionArtifact };
    return { ...artifact, createdAt: new Date() };
  }

  // Determine if this node should use real API execution:
  // - LIVE_NODE_IDS: always real (ignore mock flag) — these are production-ready
  // - Other REAL_NODE_IDS: only real when mock flag is off
  const isLive = LIVE_NODE_IDS.has(catalogueId);
  const shouldUseRealAPI = isLive || (useRealExecution && REAL_NODE_IDS.has(catalogueId));

  console.log(`[executeNode] ${catalogueId} → isLive=${isLive}, useReal=${useRealExecution}, shouldUseRealAPI=${shouldUseRealAPI}`);

  if (shouldUseRealAPI) {
    // Merge node-level config (e.g. viewType for GN-003/TR-005) into inputData
    const nodeConfig: Record<string, unknown> = {};
    const nd = node.data as Record<string, unknown>;
    if (nd.viewType != null) nodeConfig.viewType = nd.viewType;

    const res = await fetch("/api/execute-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogueId,
        executionId,
        tileInstanceId: node.id,
        inputData: {
          ...(previousArtifact?.data as Record<string, unknown> ?? { prompt: inputValue ?? "" }),
          ...nodeConfig,
        },
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({
        error: {
          title: "Request failed",
          message: "Unable to complete request",
          code: "UNKNOWN"
        }
      })) as APIErrorResponse;

      // Extract user-friendly error info
      const error = errorData.error;

      // Special handling for 429 Rate Limit errors
      if (res.status === 429) {
        const rateLimitError = new Error(error.message);
        (rateLimitError as unknown as Record<string, unknown>).status = 429;
        (rateLimitError as unknown as Record<string, unknown>).title = error.title;
        (rateLimitError as unknown as Record<string, unknown>).action = error.action;
        (rateLimitError as unknown as Record<string, unknown>).actionUrl = error.actionUrl;
        throw rateLimitError;
      }

      // Throw error with user-friendly message
      const err = new Error(error.message);
      (err as unknown as Record<string, unknown>).title = error.title;
      (err as unknown as Record<string, unknown>).code = error.code;
      (err as unknown as Record<string, unknown>).action = error.action;
      (err as unknown as Record<string, unknown>).actionUrl = error.actionUrl;
      throw err;
    }

    const { artifact } = await res.json() as { artifact: ExecutionArtifact };
    return { ...artifact, createdAt: new Date() };
  }

  // SAFETY: LIVE nodes must NEVER use mock data — throw if we somehow got here
  if (LIVE_NODE_IDS.has(catalogueId)) {
    console.error(`[${catalogueId}] BUG: Live node reached mock fallback! This should never happen.`);
    throw new Error(`${catalogueId} requires real API execution but no API path was available. Check server configuration.`);
  }

  // Fall back to mock — pass upstream data so mocks can reflect user input
  console.info(`[${catalogueId}] Using demo/sample data (no real API for this node)`);
  return mockExecuteNode(
    catalogueId,
    executionId,
    node.id,
    (previousArtifact?.data ?? {}) as Record<string, unknown>
  );
}

const FLOW_DURATION_MS = 1600;

/** Simple string hash for cache comparison (not cryptographic) */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return hash.toString(36);
}

/** Fire-and-forget: download video from Kling and persist to R2 */
async function persistVideoToR2(
  videoUrl: string,
  filename: string,
  nodeId: string,
  addArtifactFn: (nodeId: string, artifact: ExecutionArtifact) => void,
  currentArtifact: ExecutionArtifact,
) {
  try {
    const res = await fetch("/api/persist-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl, filename }),
    });
    if (!res.ok) {
      console.warn("[persist-video] Failed:", res.status);
      return;
    }
    const { persistedUrl } = await res.json();
    if (persistedUrl) {
      // Update artifact with persisted URL
      const data = { ...(currentArtifact.data as Record<string, unknown>), persistedUrl };
      addArtifactFn(nodeId, { ...currentArtifact, data });
      console.log("[persist-video] Video persisted to R2:", persistedUrl);
    }
  } catch (err) {
    console.warn("[persist-video] Error (non-fatal):", err);
  }
}
const VIDEO_POLL_INTERVAL_MS = 6_000; // Poll every 6 seconds
const VIDEO_POLL_TIMEOUT_MS = 600_000; // 10 minute timeout

/** Poll /api/video-status for a SINGLE video task (floor plans) */
async function pollSingleVideoGeneration(
  nodeId: string,
  taskId: string,
  addArtifactFn: (nodeId: string, artifact: ExecutionArtifact) => void,
  setVideoProgressFn: (nodeId: string, state: { progress: number; status: "submitting" | "processing" | "complete" | "failed"; taskId?: string; failureMessage?: string }) => void,
  clearVideoProgressFn: (nodeId: string) => void,
  currentArtifactData: Record<string, unknown>,
  executionId: string,
): Promise<void> {
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;

  console.log("[POLL] === Starting SINGLE video poll ===");
  console.log("[POLL] taskId:", taskId);

  setVideoProgressFn(nodeId, { progress: 5, status: "processing", taskId });

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, VIDEO_POLL_INTERVAL_MS));

    try {
      console.log("[POLL] Checking single video status...");
      const res = await fetch(`/api/video-status?taskId=${encodeURIComponent(taskId)}`);

      if (!res.ok) {
        console.error("[POLL] HTTP error:", res.status);
        continue;
      }

      const status = await res.json();
      console.log("[POLL] Single status:", JSON.stringify(status));

      setVideoProgressFn(nodeId, {
        progress: status.progress,
        status: status.isComplete ? "complete" : status.hasFailed ? "failed" : "processing",
        taskId,
        failureMessage: status.failureMessage ?? undefined,
      });

      if (status.hasFailed) {
        console.error("[POLL] Single video failed:", status.failureMessage);
        toast.error("Video generation failed", {
          description: status.failureMessage ?? "Unknown error",
          duration: 6000,
        });
        return;
      }

      if (status.isComplete && status.videoUrl) {
        console.log("[RENDER] Single video complete! URL:", status.videoUrl.slice(0, 100));

        const finalArtifact: ExecutionArtifact = {
          id: `video-${nodeId}`,
          executionId,
          tileInstanceId: nodeId,
          type: "video",
          data: {
            ...currentArtifactData,
            videoUrl: status.videoUrl,
            downloadUrl: status.videoUrl,
            label: "Cinematic Walkthrough — 10s · 1 shot",
            videoGenerationStatus: "complete",
            generationProgress: 100,
            durationSeconds: 10,
            shotCount: 1,
          },
          metadata: { engine: "kling-official", real: true },
          createdAt: new Date(),
        };

        addArtifactFn(nodeId, finalArtifact);
        clearVideoProgressFn(nodeId);

        toast.success("Video walkthrough ready!", {
          description: "10s cinematic walkthrough generated successfully",
          duration: 5000,
        });
        return;
      }
    } catch (err) {
      console.error("[POLL] Error:", err);
    }
  }

  // Timeout
  setVideoProgressFn(nodeId, {
    progress: 0,
    status: "failed",
    failureMessage: "Video generation timed out after 10 minutes",
  });
  toast.error("Video generation timed out", { duration: 6000 });
}

/** Poll /api/video-status until video generation completes or fails (DUAL mode) */
async function pollVideoGeneration(
  nodeId: string,
  exteriorTaskId: string,
  interiorTaskId: string,
  addArtifactFn: (nodeId: string, artifact: ExecutionArtifact) => void,
  setVideoProgressFn: (nodeId: string, state: { progress: number; status: "submitting" | "processing" | "complete" | "failed"; exteriorTaskId?: string; interiorTaskId?: string; failureMessage?: string }) => void,
  clearVideoProgressFn: (nodeId: string) => void,
  currentArtifactData: Record<string, unknown>,
  executionId: string,
  videoPipeline: "image2video" | "text2video" = "image2video",
): Promise<void> {
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;

  console.log("[POLL] === Starting video poll ===");
  console.log("[POLL] exteriorTaskId:", exteriorTaskId);
  console.log("[POLL] interiorTaskId:", interiorTaskId);

  setVideoProgressFn(nodeId, {
    progress: 5,
    status: "processing",
    exteriorTaskId,
    interiorTaskId,
  });

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, VIDEO_POLL_INTERVAL_MS));

    try {
      console.log("[POLL] Checking video status...");
      const res = await fetch(
        `/api/video-status?exteriorTaskId=${encodeURIComponent(exteriorTaskId)}&interiorTaskId=${encodeURIComponent(interiorTaskId)}&pipeline=${videoPipeline}`
      );

      if (!res.ok) {
        console.error("[POLL] HTTP error:", res.status);
        continue; // Retry on server errors
      }

      const status = await res.json();
      console.log("[POLL] Status response:", JSON.stringify(status));
      console.log("[POLL] Exterior status:", status.exteriorStatus);
      console.log("[POLL] Interior status:", status.interiorStatus);
      console.log("[POLL] Exterior video URL:", status.exteriorVideoUrl || "NONE");
      console.log("[POLL] Interior video URL:", status.interiorVideoUrl || "NONE");
      console.log("[POLL] Progress:", status.progress);
      console.log("[POLL] isComplete:", status.isComplete);
      console.log("[POLL] hasFailed:", status.hasFailed);
      console.log("[POLL] failureMessage:", status.failureMessage || "NONE");

      // Update progress in store
      setVideoProgressFn(nodeId, {
        progress: status.progress,
        status: status.isComplete ? "complete" : status.hasFailed ? "failed" : "processing",
        exteriorTaskId,
        interiorTaskId,
        failureMessage: status.failureMessage ?? undefined,
      });

      if (status.hasFailed) {
        console.error("[Video Poll] Generation failed:", status.failureMessage);
        toast.error("Video generation failed", {
          description: status.failureMessage ?? "Unknown error",
          duration: 6000,
        });
        // Keep the "failed" state visible — don't clear it
        return;
      }

      if (status.isComplete) {
        // Both clips ready — stitch into one 15s video via ffmpeg
        setVideoProgressFn(nodeId, {
          progress: 90,
          status: "processing",
          exteriorTaskId,
          interiorTaskId,
          failureMessage: undefined,
        });

        console.log("[RENDER] Videos received by frontend:");
        console.log("[RENDER] Exterior URL:", status.exteriorVideoUrl || "NONE");
        console.log("[RENDER] Interior URL:", status.interiorVideoUrl || "NONE");
        console.log("[RENDER] Are both present?", !!status.exteriorVideoUrl && !!status.interiorVideoUrl);

        // Build segments array for sequential playback (no server-side concat needed)
        const segments: { videoUrl: string; downloadUrl: string; durationSeconds: number; label: string }[] = [];
        if (status.exteriorVideoUrl) {
          segments.push({ videoUrl: status.exteriorVideoUrl, downloadUrl: status.exteriorVideoUrl, durationSeconds: 5, label: "Exterior — 5s" });
        }
        if (status.interiorVideoUrl) {
          segments.push({ videoUrl: status.interiorVideoUrl, downloadUrl: status.interiorVideoUrl, durationSeconds: 10, label: "Interior — 10s" });
        }

        // Use exterior as primary videoUrl for backward compat, but segments drive playback
        const finalVideoUrl = status.exteriorVideoUrl ?? "";
        console.log("[RENDER] Segments built:", segments.length, "clips, total", segments.reduce((s, c) => s + c.durationSeconds, 0), "s");
        console.log("[RENDER] Primary videoUrl (exterior):", finalVideoUrl?.slice(0, 100));

        const finalArtifact: ExecutionArtifact = {
          id: `video-${nodeId}`,
          executionId,
          tileInstanceId: nodeId,
          type: "video",
          data: {
            ...currentArtifactData,
            videoUrl: finalVideoUrl,
            downloadUrl: finalVideoUrl,
            interiorVideoUrl: status.interiorVideoUrl ?? "",
            segments,
            label: "Cinematic Walkthrough — 15s · 2 shots",
            videoGenerationStatus: "complete",
            generationProgress: 100,
            durationSeconds: 15,
            shotCount: 2,
          },
          metadata: { engine: "kling-official", real: true },
          createdAt: new Date(),
        };

        addArtifactFn(nodeId, finalArtifact);
        clearVideoProgressFn(nodeId);

        toast.success("Video walkthrough ready!", {
          description: "15s cinematic walkthrough generated successfully",
          duration: 5000,
        });
        return;
      }
    } catch (err) {
      console.error("[Video Poll] Error:", err);
      // Continue polling on network errors
    }
  }

  // Timeout
  setVideoProgressFn(nodeId, {
    progress: 0,
    status: "failed",
    failureMessage: "Video generation timed out after 10 minutes",
  });
  toast.error("Video generation timed out", { duration: 6000 });
  // Keep the "failed" state visible — don't clear it
}

/** Client-side Three.js walkthrough rendering */
async function renderClientWalkthrough(
  nodeId: string,
  artifactData: Record<string, unknown>,
  executionId: string,
  addArtifactFn: (nodeId: string, artifact: ExecutionArtifact) => void,
  setVideoProgressFn: (nodeId: string, state: { progress: number; status: "submitting" | "processing" | "rendering" | "complete" | "failed"; phase?: string; failureMessage?: string }) => void,
  clearVideoProgressFn: (nodeId: string) => void,
): Promise<void> {
  setVideoProgressFn(nodeId, {
    progress: 0,
    status: "rendering",
    phase: "Initializing",
  });

  try {
    // Dynamic import for code splitting
    const { renderWalkthrough } = await import("@/services/walkthrough-renderer");

    const buildingConfig = artifactData._buildingConfig as {
      floors?: number;
      floorHeight?: number;
      footprint?: number;
      buildingType?: string;
      style?: Record<string, unknown>;
    } | undefined;

    const result = await renderWalkthrough({
      floors: buildingConfig?.floors ?? 5,
      floorHeight: buildingConfig?.floorHeight ?? 3.6,
      footprint: buildingConfig?.footprint ?? 600,
      buildingType: buildingConfig?.buildingType,
      style: buildingConfig?.style,
      onProgress: (percent, phase) => {
        setVideoProgressFn(nodeId, {
          progress: percent,
          status: percent >= 100 ? "complete" : "rendering",
          phase,
        });
      },
    });

    // Build the final artifact with the rendered video blob URL
    const finalArtifact: ExecutionArtifact = {
      id: `video-${nodeId}`,
      executionId,
      tileInstanceId: nodeId,
      type: "video",
      data: {
        ...artifactData,
        videoUrl: result.blobUrl,
        downloadUrl: result.blobUrl,
        label: "AEC Cinematic Walkthrough — 15s Three.js Render",
        videoGenerationStatus: "complete",
        generationProgress: 100,
        durationSeconds: result.durationSeconds,
        pipeline: `Three.js client-side → WebM (${result.resolution.width}x${result.resolution.height}, ${result.fps}fps, ${(result.fileSizeBytes / 1024 / 1024).toFixed(1)}MB)`,
      },
      metadata: { engine: "threejs-client", real: false },
      createdAt: new Date(),
    };

    addArtifactFn(nodeId, finalArtifact);
    clearVideoProgressFn(nodeId);

    toast.success("Video walkthrough ready!", {
      description: `15s AEC walkthrough rendered (${(result.fileSizeBytes / 1024 / 1024).toFixed(1)}MB)`,
      duration: 5000,
    });
  } catch (err) {
    console.error("[Client Render] Failed:", err);
    setVideoProgressFn(nodeId, {
      progress: 0,
      status: "failed",
      phase: "Error",
      failureMessage: err instanceof Error ? err.message : "Rendering failed",
    });
    toast.error("Video rendering failed", {
      description: err instanceof Error ? err.message : "Unknown error",
      duration: 6000,
    });
    // Don't clear progress — keep the "failed" state visible so the user sees the error
  }
}

interface UseExecutionOptions {
  onLog?: (entry: LogEntry) => void;
}

interface RateLimitInfo {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

interface TopologicalSortResult {
  sorted: WorkflowNode[];
  hasCycle: boolean;
  cycleNodeLabels: string[];
  disconnectedNodes: WorkflowNode[];
}

// Topological sort using Kahn's algorithm — detects cycles and disconnected nodes
function topologicalSort(nodes: WorkflowNode[], edges: { source: string; target: string }[]): TopologicalSortResult {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    graph.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (graph.has(edge.source) && inDegree.has(edge.target)) {
      graph.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  // Start with nodes that have no incoming edges
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  const sorted: WorkflowNode[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodeMap.get(current);
    if (node) sorted.push(node);

    for (const neighbor of graph.get(current) || []) {
      inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1);
      if (inDegree.get(neighbor) === 0) queue.push(neighbor);
    }
  }

  const sortedIds = new Set(sorted.map(n => n.id));
  const unreached = nodes.filter(n => !sortedIds.has(n.id));

  // Determine which unreached nodes are in cycles vs truly disconnected
  // Nodes in a cycle have remaining inDegree > 0 after Kahn's
  // Truly disconnected (no edges at all) have inDegree 0 — but these are always processed
  // So all unreached after Kahn's = cycle participants
  const cycleNodes = unreached.filter(n => (inDegree.get(n.id) ?? 0) > 0);
  const disconnectedNodes = unreached.filter(n => (inDegree.get(n.id) ?? 0) === 0);

  // Append genuinely disconnected nodes (sorted by x-position) to execution order
  sorted.push(...disconnectedNodes.sort((a, b) => a.position.x - b.position.x));

  return {
    sorted,
    hasCycle: cycleNodes.length > 0,
    cycleNodeLabels: cycleNodes.map(n => n.data.label),
    disconnectedNodes,
  };
}

// Find upstream artifact for a node by looking at incoming edges
function getUpstreamArtifact(
  nodeId: string,
  edges: { source: string; target: string }[],
  artifactMap: Map<string, ExecutionArtifact>
): ExecutionArtifact | null {
  const incomingEdges = edges.filter(e => e.target === nodeId);

  if (incomingEdges.length === 0) return null;

  if (incomingEdges.length === 1) {
    return artifactMap.get(incomingEdges[0].source) ?? null;
  }

  // Multiple inputs — merge data from all upstream nodes
  const mergedData: Record<string, unknown> = {};
  let firstArtifact: ExecutionArtifact | null = null;

  for (const edge of incomingEdges) {
    const artifact = artifactMap.get(edge.source);
    if (artifact) {
      if (!firstArtifact) firstArtifact = artifact;
      if (artifact.data && typeof artifact.data === "object") {
        Object.assign(mergedData, artifact.data);
      }
    }
  }

  if (!firstArtifact) return null;

  return { ...firstArtifact, data: mergedData };
}

export function useExecution({ onLog }: UseExecutionOptions = {}) {
  const nodes = useWorkflowStore(s => s.nodes);
  const workflowEdges = useWorkflowStore(s => s.edges);
  const currentWorkflow = useWorkflowStore(s => s.currentWorkflow);
  const updateNodeStatus = useWorkflowStore(s => s.updateNodeStatus);
  const setEdgeFlowing = useWorkflowStore(s => s.setEdgeFlowing);
  const {
    startExecution,
    addTileResult,
    addArtifact,
    completeExecution,
    setProgress,
    isExecuting,
    isRateLimited,
    setRateLimited,
    incrementRegenCount,
    getRegenRemaining,
    setRegeneratingNode,
    regeneratingNodeId,
    artifacts,
    setVideoGenProgress,
    clearVideoGenProgress,
  } = useExecutionStore();
  
  const isDemoMode = useUIStore(s => s.isDemoMode);
  const [rateLimitHit, setRateLimitHit] = useState<RateLimitInfo | null>(null);

  // Warn user before navigating away during execution
  useEffect(() => {
    if (!isExecuting) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Workflow is still running. Are you sure you want to leave?";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isExecuting]);

  const log = useCallback((type: LogEntry["type"], message: string, detail?: string) => {
    onLog?.({ timestamp: new Date(), type, message, detail });
  }, [onLog]);

  const runWorkflow = useCallback(async () => {
    if (isExecuting) return;

    // Guard: empty canvas
    if (nodes.length === 0) {
      toast.error("Add at least one node to run a workflow");
      return;
    }

    // Guard: cycle detection (run before expensive validation)
    const sortCheck = topologicalSort(nodes as WorkflowNode[], workflowEdges);
    if (sortCheck.hasCycle) {
      toast.error("Circular connection detected. Please remove the loop and try again.", {
        description: `Cycle involves: ${sortCheck.cycleNodeLabels.join(", ")}`,
        duration: 6000,
      });
      return;
    }

    // Guard: warn about disconnected nodes
    if (sortCheck.disconnectedNodes.length > 0) {
      for (const dn of sortCheck.disconnectedNodes) {
        console.warn(`[useExecution] Skipping disconnected node: ${dn.data.label}`);
      }
      toast.warning(
        `${sortCheck.disconnectedNodes.length} node${sortCheck.disconnectedNodes.length > 1 ? "s are" : " is"} not connected and will be skipped.`,
        { duration: 4000 }
      );
    }

    // Guard: validate input nodes before starting
    for (const node of nodes as WorkflowNode[]) {
      const catalogueId = node.data.catalogueId;
      // Text Prompt (IN-001): must have non-empty text
      if (catalogueId === "IN-001") {
        const val = (node.data.inputValue as string | undefined) ?? "";
        if (!val.trim()) {
          toast.error("Please enter text in the Text Prompt node before running");
          return;
        }
        if (val.length > 4000) {
          toast.error("Text is too long (maximum 4,000 characters). Try shortening your description.", {
            description: `Current length: ${val.length} characters`,
          });
          return;
        }
      }
      // File upload nodes: must have a file selected (check both node.data and inputFileStore)
      if (["IN-002", "IN-003", "IN-005", "IN-006"].includes(catalogueId)) {
        const nd = node.data as Record<string, unknown>;
        if (!nd.fileData && !nd.inputValue && !inputFileStore.has(node.id)) {
          toast.error(`Please upload a file to the "${node.data.label}" node before running`);
          return;
        }
      }
    }

    const executionId = generateId();
    const execution: Execution = {
      id: executionId,
      workflowId: currentWorkflow?.id ?? "unsaved",
      userId: "demo",
      status: "running",
      startedAt: new Date(),
      tileResults: [],
      createdAt: new Date(),
    };

    startExecution(execution);
    log("start", "Workflow execution started", `${nodes.length} nodes queued`);

    // Determine if we should use real execution (OPENAI_API_KEY configured)
    const useReal = process.env.NEXT_PUBLIC_ENABLE_MOCK_EXECUTION !== "true";

    toast.success("Workflow running…", { duration: 2000 });

    // Auto-save workflow before execution so results can be persisted to DB
    let dbExecutionId: string | null = null;
    let workflowId = currentWorkflow?.id;
    const isPersisted = workflowId && workflowId.length >= 20 && workflowId.startsWith("c");

    if (!isDemoMode && !isPersisted) {
      // Workflow not yet saved — save it first so we have a DB ID for execution records
      try {
        const { saveWorkflow } = useWorkflowStore.getState();
        const savedId = await saveWorkflow();
        if (savedId) {
          workflowId = savedId;
          log("info", "Workflow auto-saved before execution", savedId);
          // Update URL so refresh can restore this workflow
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            if (!url.searchParams.has("id")) {
              url.searchParams.set("id", savedId);
              window.history.replaceState({}, "", url.toString());
            }
          }
        }
      } catch {
        // Non-fatal — continue with execution even if save fails
      }
    }

    // Persist execution to DB if workflow is saved (skip in demo mode)
    if (!isDemoMode && workflowId && workflowId.length >= 20 && workflowId.startsWith("c")) {
      try {
        const res = await fetch("/api/executions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId, triggerType: "manual" }),
        });
        if (res.ok) {
          const { execution: dbEx } = await res.json() as { execution: { id: string } };
          dbExecutionId = dbEx.id;
          log("info", "Execution record created", dbExecutionId);
        }
      } catch {
        // Non-fatal — DB save is best-effort
      }
    }

    // Reuse already-computed topological sort (cycle check already passed above)
    const orderedNodes = sortCheck.sorted;

    let hasError = false;
    // Map of nodeId → artifact for edge-based data routing
    const artifactMap = new Map<string, ExecutionArtifact>();

    for (let i = 0; i < orderedNodes.length; i++) {
      const node = orderedNodes[i] as WorkflowNode;
      setProgress(Math.round((i / orderedNodes.length) * 100));

      updateNodeStatus(node.id, "running");
      log("running", `Running: ${node.data.label}`, node.data.catalogueId);

      try {
        // Get upstream data from connected nodes (via edges), not just previous in array
        const upstreamArtifact = getUpstreamArtifact(node.id, workflowEdges, artifactMap);

        // ── Cache check for image nodes (GN-003) — reuse DALL-E render if upstream unchanged ──
        const nodeCatalogueId = (node.data as { catalogueId: string }).catalogueId;
        if (nodeCatalogueId === "GN-003") {
          const prevArtifacts = useExecutionStore.getState().previousArtifacts;
          const prevArtifact = prevArtifacts.get(node.id);
          if (prevArtifact && prevArtifact.type === "image") {
            const prevHash = (prevArtifact.metadata as Record<string, unknown>)?._upstreamHash as string | undefined;
            const curHash = simpleHash(
              JSON.stringify(upstreamArtifact?.data ?? {}) +
              String((node.data as Record<string, unknown>).viewType ?? "exterior"),
            );
            if (prevHash && prevHash === curHash) {
              log("info", `${node.data.label} — reusing cached render (same input)`, "cache-hit");
              toast.info(`${node.data.label}: reusing cached render`, { duration: 2000 });
              artifactMap.set(node.id, prevArtifact);
              addArtifact(node.id, prevArtifact);
              addTileResult({
                tileInstanceId: node.id,
                catalogueId: node.data.catalogueId,
                status: "success",
                startedAt: new Date(),
                completedAt: new Date(),
                artifact: prevArtifact,
              });
              updateNodeStatus(node.id, "success");
              setEdgeFlowing(node.id, true);
              setTimeout(() => setEdgeFlowing(node.id, false), FLOW_DURATION_MS);
              continue;
            }
          }
        }

        // For GN-009 (Video): ensure uploaded image data reaches the node
        // regardless of edge structure — search ALL artifacts for fileData/imageUrl
        if (nodeCatalogueId === "GN-009" && upstreamArtifact) {
          const upData = upstreamArtifact.data as Record<string, unknown>;
          if (!upData.fileData && !upData.url && !upData.imageUrl) {
            for (const [, art] of artifactMap) {
              const d = art.data as Record<string, unknown>;
              if (d?.fileData && typeof d.fileData === "string") {
                upData.fileData = d.fileData;
                if (d.mimeType) upData.mimeType = d.mimeType;
                if (d.fileName) upData.fileName = d.fileName;
                console.log("[Execution] Injected fileData into GN-009 from upstream input node");
                break;
              }
              if (d?.imageUrl && typeof d.imageUrl === "string") {
                upData.imageUrl = d.imageUrl;
                upData.url = d.imageUrl;
                console.log("[Execution] Injected imageUrl into GN-009 from upstream node");
                break;
              }
            }
          }
        }

        const artifact = await executeNode(node, executionId, upstreamArtifact, useReal, isDemoMode);
        artifactMap.set(node.id, artifact);

        // Stamp upstream hash on image artifacts for future cache detection
        if (nodeCatalogueId === "GN-003" && artifact.type === "image") {
          const upHash = simpleHash(
            JSON.stringify(upstreamArtifact?.data ?? {}) +
            String((node.data as Record<string, unknown>).viewType ?? "exterior"),
          );
          artifact.metadata = { ...artifact.metadata, _upstreamHash: upHash };
        }

        addArtifact(node.id, artifact);
        addTileResult({
          tileInstanceId: node.id,
          catalogueId: node.data.catalogueId,
          status: "success",
          startedAt: new Date(),
          completedAt: new Date(),
          artifact,
        });

        updateNodeStatus(node.id, "success");
        log("success", `${node.data.label} completed`, String(artifact.type));
        trackNodeUsed(node.data.catalogueId, node.data.label);

        // If this is a video node with background generation, start polling or client rendering
        const artData = artifact.data as Record<string, unknown> | undefined;
        if (artifact.type === "video" && artData?.videoGenerationStatus) {
          if (
            artData.videoGenerationStatus === "processing" &&
            artData.taskId &&
            !artData.exteriorTaskId
          ) {
            // Single video path (floor plans): poll single task
            log("info", "Single video generation started — polling for progress");
            toast.info("Video generating in background...", {
              description: "10s AEC walkthrough — you'll be notified when it's ready",
              duration: 5000,
            });

            pollSingleVideoGeneration(
              node.id,
              artData.taskId as string,
              addArtifact,
              setVideoGenProgress,
              clearVideoGenProgress,
              artData,
              executionId,
            ).catch(err => {
              console.error("[Video Poll] Unhandled error:", err);
            });
          } else if (
            artData.videoGenerationStatus === "processing" &&
            artData.exteriorTaskId &&
            artData.interiorTaskId
          ) {
            // Dual video path (concept renders): poll both tasks via Kling API
            const pipeline = (artData.videoPipeline as string) === "text2video" ? "text2video" as const : "image2video" as const;
            log("info", `Dual video generation started in background (${pipeline}) — polling for progress`);
            toast.info("Video generating in background...", {
              description: pipeline === "text2video"
                ? "15s ultra-realistic walkthrough from PDF summary — you'll be notified when it's ready"
                : "15s AEC walkthrough — you'll be notified when it's ready",
              duration: 5000,
            });

            pollVideoGeneration(
              node.id,
              artData.exteriorTaskId as string,
              artData.interiorTaskId as string,
              addArtifact,
              setVideoGenProgress,
              clearVideoGenProgress,
              artData,
              executionId,
              pipeline,
            ).catch(err => {
              console.error("[Video Poll] Unhandled error:", err);
            });
          } else if (artData.videoGenerationStatus === "client-rendering") {
            // Three.js client-side rendering path
            log("info", "Starting client-side Three.js walkthrough rendering");
            toast.info("Rendering 15s walkthrough...", {
              description: "Three.js AEC cinematic walkthrough — rendering in your browser",
              duration: 5000,
            });

            // Fire-and-forget: render in background
            renderClientWalkthrough(
              node.id,
              artData,
              executionId,
              addArtifact,
              setVideoGenProgress,
              clearVideoGenProgress,
            ).catch(err => {
              console.error("[Client Render] Unhandled error:", err);
              setVideoGenProgress(node.id, {
                progress: 0,
                status: "failed",
                phase: "Error",
                failureMessage: err instanceof Error ? err.message : "Rendering failed",
              });
            });
          }
        }

        // Show warnings if any
        if (artifact.metadata?.warnings && Array.isArray(artifact.metadata.warnings)) {
          for (const warning of artifact.metadata.warnings) {
            toast.warning(warning, { duration: 4000 });
          }
        }

        // Persist artifact to DB (stored in tileResults JSON on the Execution)
        if (dbExecutionId) {
          fetch(`/api/executions/${dbExecutionId}/artifacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeId: node.id,
              nodeLabel: node.data.label,
              type: artifact.type,
              title: String(artifact.type),
              data: artifact.data,
            }),
          }).catch((err) => { console.error("[useExecution] Failed to persist artifact:", err); });
        }

        // Animate outgoing edges as data flows to the next node
        setEdgeFlowing(node.id, true);
        setTimeout(() => setEdgeFlowing(node.id, false), FLOW_DURATION_MS);

      } catch (error) {
        const errRecord = error as unknown as Record<string, unknown>;
        const errTitle = (errRecord.title as string) || "Error";
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        const errAction = errRecord.action as string | undefined;
        const errActionUrl = errRecord.actionUrl as string | undefined;

        // Check if this is a rate limit error — must stop execution
        if (errRecord.status === 429) {
          hasError = true;
          updateNodeStatus(node.id, "error");
          log("error", "Rate limit exceeded", errMsg);
          setRateLimited(true); // persist in store for UI to react immediately
          setRateLimitHit({
            title: errTitle,
            message: errMsg,
            action: errAction,
            actionUrl: errActionUrl,
          });
          addTileResult({
            tileInstanceId: node.id,
            catalogueId: node.data.catalogueId,
            status: "error",
            startedAt: new Date(),
            completedAt: new Date(),
            errorMessage: errMsg,
          });
          break;
        }

        // LIVE nodes must NEVER fall back to mock — they hard-fail so the user
        // sees the real error instead of getting silent garbage data.
        // This covers GN-009 (Video Walkthrough / Kling), TR-001 (Brief Parser), and all other LIVE nodes.
        if (LIVE_NODE_IDS.has(node.data.catalogueId)) {
          hasError = true;
          updateNodeStatus(node.id, "error");
          console.error(`[${node.data.catalogueId} LIVE-FAIL] Real execution failed — NO mock fallback for live nodes.`, {
            catalogueId: node.data.catalogueId,
            label: node.data.label,
            error: errMsg,
          });
          log("error", `${node.data.label} failed`, errMsg);
          toast.error(errTitle || `${node.data.label} failed`, {
            description: errMsg,
            duration: 8000,
          });
          addTileResult({
            tileInstanceId: node.id,
            catalogueId: node.data.catalogueId,
            status: "error",
            startedAt: new Date(),
            completedAt: new Date(),
            errorMessage: errMsg,
          });
          break;
        }

        // Non-fatal error for non-LIVE nodes — fall back to mock execution and continue
        console.error(`[${node.data.catalogueId} FALLBACK] Real execution failed, falling back to mock.`, {
          catalogueId: node.data.catalogueId,
          label: node.data.label,
          error: errMsg,
        });
        log("error", `${node.data.label} failed — falling back to mock`, errMsg);
        toast.error(`${node.data.label}: using mock data`, {
          description: errMsg,
          duration: 5000,
        });

        try {
          const upstreamArtifact = getUpstreamArtifact(node.id, workflowEdges, artifactMap);
          const mockArtifact = await mockExecuteNode(
            node.data.catalogueId,
            executionId,
            node.id,
            ((upstreamArtifact?.data ?? {}) as Record<string, unknown>)
          );
          artifactMap.set(node.id, mockArtifact);
          addArtifact(node.id, mockArtifact);
          addTileResult({
            tileInstanceId: node.id,
            catalogueId: node.data.catalogueId,
            status: "success",
            startedAt: new Date(),
            completedAt: new Date(),
            artifact: mockArtifact,
          });
          updateNodeStatus(node.id, "success");
          log("info", `${node.data.label} completed with mock fallback`);

          // Check if mock artifact requires background video generation (same as success path)
          const mockArtData = mockArtifact.data as Record<string, unknown> | undefined;
          if (mockArtifact.type === "video" && mockArtData?.videoGenerationStatus === "client-rendering") {
            log("info", "Starting client-side Three.js walkthrough rendering (mock fallback)");
            toast.info("Rendering 15s walkthrough...", {
              description: "Three.js AEC cinematic walkthrough — rendering in your browser",
              duration: 5000,
            });
            renderClientWalkthrough(
              node.id,
              mockArtData,
              executionId,
              addArtifact,
              setVideoGenProgress,
              clearVideoGenProgress,
            ).catch(err => {
              console.error("[Client Render] Unhandled error:", err);
              setVideoGenProgress(node.id, {
                progress: 0,
                status: "failed",
                phase: "Error",
                failureMessage: err instanceof Error ? err.message : "Rendering failed",
              });
            });
          }

          setEdgeFlowing(node.id, true);
          setTimeout(() => setEdgeFlowing(node.id, false), FLOW_DURATION_MS);
        } catch {
          // Mock also failed — mark error but continue pipeline
          hasError = true;
          updateNodeStatus(node.id, "error");
          addTileResult({
            tileInstanceId: node.id,
            catalogueId: node.data.catalogueId,
            status: "error",
            startedAt: new Date(),
            completedAt: new Date(),
            errorMessage: errMsg,
          });
        }
      }
    }

    setProgress(100);
    completeExecution(hasError ? "partial" : "success");
    log(hasError ? "error" : "success",
      hasError ? "Workflow completed with errors" : "Workflow completed successfully",
      `${orderedNodes.length} nodes executed`
    );

    // Update DB execution status
    if (dbExecutionId) {
      fetch(`/api/executions/${dbExecutionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: hasError ? "PARTIAL" : "SUCCESS" }),
      }).catch((err) => { console.error("[useExecution] Failed to update execution status:", err); });
    }

    // Track workflow execution analytics
    const catalogueIds = orderedNodes.map(n => (n.data as { catalogueId: string }).catalogueId);
    trackWorkflowExecuted(orderedNodes.length, catalogueIds);

    if (!hasError) {
      toast.success("Workflow completed", {
        description: `${orderedNodes.length} nodes executed`,
        duration: 4000,
      });

      // Award XP for workflow run (fire-and-forget)
      awardXP("workflow-run");
      awardXP("workflow-run-repeat");

      // Check for special node achievements
      const usedCatalogueIds = new Set(catalogueIds);
      if (usedCatalogueIds.has("GN-003")) {
        awardXP("render-generated");
      }
      if (usedCatalogueIds.has("TR-008") && usedCatalogueIds.has("EX-002")) {
        awardXP("boq-generated");
      }
    }
  }, [
    nodes,
    workflowEdges,
    currentWorkflow,
    isExecuting,
    isDemoMode,
    startExecution,
    updateNodeStatus,
    setEdgeFlowing,
    addArtifact,
    addTileResult,
    completeExecution,
    setProgress,
    setRateLimited,
    setVideoGenProgress,
    clearVideoGenProgress,
    log,
  ]);

  const regenerateNode = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId) as WorkflowNode | undefined;
    if (!node || isExecuting || regeneratingNodeId) return;

    const remaining = getRegenRemaining(nodeId);
    if (remaining <= 0) {
      toast.error("Maximum regeneration attempts reached", { description: "You can regenerate each node up to 3 times per execution." });
      return;
    }

    if (!incrementRegenCount(nodeId)) return;

    setRegeneratingNode(nodeId);
    updateNodeStatus(nodeId, "running");

    const useReal = process.env.NEXT_PUBLIC_ENABLE_MOCK_EXECUTION !== "true";
    const executionId = useExecutionStore.getState().currentExecution?.id ?? generateId();

    try {
      const upstreamArtifact = getUpstreamArtifact(nodeId, workflowEdges, artifacts);
      const artifact = await executeNode(node, executionId, upstreamArtifact, useReal, isDemoMode);
      addArtifact(nodeId, artifact);
      updateNodeStatus(nodeId, "success");
      trackRegenerationUsed(nodeId, node.data.catalogueId);
      toast.success(`${node.data.label} regenerated`, { duration: 2000 });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Regeneration failed";
      updateNodeStatus(nodeId, "error");
      toast.error(`Regeneration failed: ${errMsg}`);
    } finally {
      setRegeneratingNode(null);
    }
  }, [nodes, isExecuting, regeneratingNodeId, workflowEdges, isDemoMode, getRegenRemaining, incrementRegenCount, setRegeneratingNode, updateNodeStatus, addArtifact, artifacts]);

  const resetExecution = useCallback(() => {
    nodes.forEach((node) => updateNodeStatus(node.id, "idle"));
  }, [nodes, updateNodeStatus]);

  const clearRateLimitError = useCallback(() => {
    setRateLimitHit(null);
    setRateLimited(false);
  }, [setRateLimited]);

  return {
    runWorkflow,
    regenerateNode,
    resetExecution,
    isExecuting,
    isRateLimited,
    regeneratingNodeId,
    rateLimitHit,
    clearRateLimitError,
  };
}

// ─── Exported wrappers for retry from ResultShowcase ────────────────────────

export { pollVideoGeneration as retryPollVideoGeneration };
export { renderClientWalkthrough as retryRenderClientWalkthrough };
