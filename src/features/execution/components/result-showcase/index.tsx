"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useUIStore } from "@/shared/stores/ui-store";
import { useExecutionStore } from "@/features/execution/stores/execution-store";
import { useLocale } from "@/hooks/useLocale";
import { generateId } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ExecutionArtifact } from "@/types/execution";
import { useShowcaseData } from "@/features/execution/components/result-showcase/useShowcaseData";
import { ShowcaseHeader } from "@/features/execution/components/result-showcase/ShowcaseHeader";
import { TabBar } from "@/features/execution/components/result-showcase/TabBar";
import { COLORS, type TabId } from "@/features/execution/components/result-showcase/constants";

import { OverviewTab } from "@/features/execution/components/result-showcase/tabs/OverviewTab";
import { MediaTab } from "@/features/execution/components/result-showcase/tabs/MediaTab";
import { DataTab } from "@/features/execution/components/result-showcase/tabs/DataTab";
import { ModelTab } from "@/features/execution/components/result-showcase/tabs/ModelTab";
import { ExportTab } from "@/features/execution/components/result-showcase/tabs/ExportTab";

interface ResultShowcaseProps {
  onClose: () => void;
}

export function ResultShowcase({ onClose }: ResultShowcaseProps) {
  const { t } = useLocale();
  const data = useShowcaseData();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const hasAutoSwitched = useRef(false);
  const setVideoPlayerNodeId = useUIStore(s => s.setVideoPlayerNodeId);

  // Auto-switch to "model" tab when 3D model becomes available
  // (but NOT for floor-plan-interactive — that renders directly in the Overview tab)
  useEffect(() => {
    if (!hasAutoSwitched.current && data.model3dData && data.availableTabs.includes("model")) {
      if (data.model3dData.kind !== "floor-plan-interactive") {
        setActiveTab("model");
      }
      hasAutoSwitched.current = true;
    }
  }, [data.model3dData, data.availableTabs]);

  const handleExpandVideo = () => {
    if (data.videoData?.nodeId) {
      setVideoPlayerNodeId(data.videoData.nodeId);
    }
  };

  const handleNavigateTab = (tab: TabId) => {
    if (data.availableTabs.includes(tab)) {
      setActiveTab(tab);
    }
  };

  // ── Create a fresh GN-009 video walkthrough from existing 3D model + renders ──
  // Used by the "Create 3D Video Walkthrough" CTA in MediaTab when no video exists yet.
  // Synthesizes the same inputData a workflow-canvas GN-009 invocation would receive,
  // then plugs into the existing videoGenProgress + polling pipeline so VideoBody/MediaTab
  // light up automatically without any new infrastructure.
  const [isCreatingVideo, setIsCreatingVideo] = useState(false);
  const handleCreateVideoWalkthrough = useCallback(async () => {
    if (isCreatingVideo) return;
    if (data.videoData) {
      // Already exists — open in fullscreen instead
      if (data.videoData.nodeId) setVideoPlayerNodeId(data.videoData.nodeId);
      return;
    }
    if (!data.model3dData) {
      toast.error(t('toast.videoCreateNoModel'));
      return;
    }

    setIsCreatingVideo(true);
    const { addArtifact, setVideoGenProgress, clearVideoGenProgress, currentExecution } =
      useExecutionStore.getState();
    const executionId = currentExecution?.id ?? "cta-create";
    const nodeId = `gn-009-cta-${generateId()}`;

    // Build inputData from current execution artifacts.
    // Priority for source image: aiRenderUrl (DALL-E render) > heroImageUrl > sourceImageUrl.
    let imageUrl: string | null = null;
    let geometry: import("@/features/floor-plan/types/floor-plan").FloorPlanGeometry | null = null;
    let isFloorPlanModel = false;

    if (data.model3dData.kind === "floor-plan-editor") {
      imageUrl = data.model3dData.aiRenderUrl ?? data.heroImageUrl ?? data.model3dData.sourceImageUrl;
      geometry = data.model3dData.geometry;
      isFloorPlanModel = true;
    } else if (data.model3dData.kind === "html-iframe") {
      imageUrl = data.model3dData.aiRenderUrl ?? data.heroImageUrl;
      geometry = data.model3dData.geometry ?? null;
      isFloorPlanModel = !!data.model3dData.geometry;
    } else {
      imageUrl = data.heroImageUrl;
    }

    // Build a roomList from geometry for richer Kling prompts
    const roomList = geometry?.rooms?.map(r => ({
      name: r.name,
      area: Math.round((r.width ?? 0) * (r.depth ?? 0)),
    }));

    const inputData: Record<string, unknown> = {
      content: data.textContent || `Modern architectural building with ${geometry?.rooms?.length ?? 0} rooms`,
      description: data.textContent || "",
    };
    if (imageUrl) {
      inputData.url = imageUrl;
      inputData.imageUrl = imageUrl;
    }
    if (geometry) {
      inputData.geometry = geometry;
      inputData.isFloorPlan = isFloorPlanModel;
    }
    if (roomList && roomList.length > 0) {
      inputData.roomList = roomList;
      inputData.roomInfo = roomList.map(r => `${r.name} (${r.area}m²)`).join(", ");
    }

    // Pre-create a placeholder video artifact so MediaTab's progress UI binds to nodeId.
    // useShowcaseData will see the new "video" artifact and expose data.videoData.nodeId,
    // which the existing isVideoGenerating selector reads.
    const placeholderArtifact: ExecutionArtifact = {
      id: `video-${nodeId}`,
      executionId,
      tileInstanceId: nodeId,
      type: "video",
      data: {
        name: `walkthrough_${nodeId}.mp4`,
        videoUrl: "",
        downloadUrl: "",
        durationSeconds: 15,
        shotCount: 2,
        videoGenerationStatus: "submitting",
        label: "Cinematic Walkthrough — pending",
      },
      metadata: { engine: "kling-official", real: true, source: "showcase-cta" },
      createdAt: new Date(),
    };
    addArtifact(nodeId, placeholderArtifact);
    setVideoGenProgress(nodeId, { progress: 0, status: "submitting" });

    toast.info(t('toast.videoCreateStarting'), { duration: 4000 });

    try {
      const res = await fetch("/api/execute-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogueId: "GN-009",
          executionId,
          tileInstanceId: nodeId,
          inputData,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody?.error?.message ?? errBody?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const result = await res.json();
      const artifact = result.artifact as ExecutionArtifact | undefined;
      if (!artifact) throw new Error("No artifact returned");

      // Replace placeholder with the real artifact (still has videoGenerationStatus: processing)
      addArtifact(nodeId, { ...artifact, tileInstanceId: nodeId });
      const artData = artifact.data as Record<string, unknown>;

      if (
        artData.videoGenerationStatus === "processing" &&
        artData.exteriorTaskId &&
        artData.interiorTaskId
      ) {
        const pipeline = (artData.videoPipeline as string) === "text2video" ? "text2video" as const : "image2video" as const;
        toast.info(t('toast.videoRegenerating'), {
          description: t('toast.klingGenerating'),
          duration: 5000,
        });
        const { retryPollVideoGeneration } = await import("@/features/execution/hooks/useExecution");
        retryPollVideoGeneration(
          nodeId,
          artData.exteriorTaskId as string,
          artData.interiorTaskId as string,
          addArtifact,
          setVideoGenProgress,
          clearVideoGenProgress,
          artData,
          executionId,
          pipeline,
        ).catch(err => {
          logger.error("[Create Video Poll] Error:", err);
        });
      } else if (
        artData.videoGenerationStatus === "processing" &&
        artData.taskId
      ) {
        // Single-task path (Omni floor plans). Reuse the dual poller's failure-tolerant
        // status endpoint by treating taskId as both exterior and interior is wrong —
        // instead we fall back to polling /api/video-status with just taskId.
        toast.info(t('toast.videoRegenerating'), {
          description: t('toast.klingGenerating'),
          duration: 5000,
        });
        // Lightweight inline poller for single-task floor plan walkthroughs
        const pollSingle = async () => {
          const POLL_MS = 6000;
          const TIMEOUT_MS = 600_000;
          const deadline = Date.now() + TIMEOUT_MS;
          const tid = artData.taskId as string;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, POLL_MS));
            try {
              const sres = await fetch(`/api/video-status?taskId=${encodeURIComponent(tid)}`);
              if (!sres.ok) continue;
              const status = await sres.json();
              setVideoGenProgress(nodeId, {
                progress: status.progress ?? 0,
                status: status.isComplete ? "complete" : status.hasFailed ? "failed" : "processing",
                failureMessage: status.failureMessage ?? undefined,
              });
              if (status.hasFailed) {
                toast.error(t('toast.videoRetryFailed'), { description: status.failureMessage ?? "" });
                return;
              }
              if (status.isComplete && status.videoUrl) {
                const finalArt: ExecutionArtifact = {
                  id: `video-${nodeId}`,
                  executionId,
                  tileInstanceId: nodeId,
                  type: "video",
                  data: {
                    ...artData,
                    videoUrl: status.videoUrl,
                    downloadUrl: status.videoUrl,
                    videoGenerationStatus: "complete",
                    generationProgress: 100,
                  },
                  metadata: { engine: "kling-official", real: true },
                  createdAt: new Date(),
                };
                addArtifact(nodeId, finalArt);
                clearVideoGenProgress(nodeId);
                toast.success("Video walkthrough ready!", { duration: 5000 });
                return;
              }
            } catch (err) {
              logger.error("[Create Video Single Poll] Error:", err);
            }
          }
          setVideoGenProgress(nodeId, { progress: 0, status: "failed", failureMessage: "Timed out" });
        };
        void pollSingle();
      } else if (artData.videoGenerationStatus === "client-rendering") {
        toast.info(t('toast.renderingWalkthrough'), {
          description: t('toast.threejsRendering'),
          duration: 5000,
        });
        const { retryRenderClientWalkthrough } = await import("@/features/execution/hooks/useExecution");
        retryRenderClientWalkthrough(
          nodeId,
          artData,
          executionId,
          addArtifact,
          setVideoGenProgress,
          clearVideoGenProgress,
        ).catch(err => {
          logger.error("[Create Video Client Render] Error:", err);
          setVideoGenProgress(nodeId, {
            progress: 0,
            status: "failed",
            failureMessage: err instanceof Error ? err.message : "Rendering failed",
          });
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error("[Create Video] Error:", msg);
      toast.error(t('toast.videoCreateFailed'), { description: msg, duration: 6000 });
      // Mark progress as failed but keep placeholder so user can see the error state
      setVideoGenProgress(nodeId, { progress: 0, status: "failed", failureMessage: msg });
    } finally {
      setIsCreatingVideo(false);
    }
  }, [isCreatingVideo, data.videoData, data.model3dData, data.heroImageUrl, data.textContent, setVideoPlayerNodeId, t]);

  const handleRetryVideo = useCallback(async () => {
    const nodeId = data.videoData?.nodeId;
    if (!nodeId) return;

    const { addArtifact, setVideoGenProgress, clearVideoGenProgress, currentExecution, artifacts } = useExecutionStore.getState();
    const executionId = currentExecution?.id ?? "retry";

    // Gather upstream data: find render image (GN-003 artifact) and building description
    const inputData: Record<string, unknown> = {};
    for (const [, art] of artifacts) {
      const d = art.data as Record<string, unknown>;
      if (art.type === "image" && d?.url) {
        inputData.url = d.url;
        inputData.imageUrl = d.url;
      }
      if (art.type === "text" && d?.content) {
        inputData.content = d.content;
        inputData.description = d.content;
      }
    }

    // Set progress to submitting
    setVideoGenProgress(nodeId, { progress: 0, status: "submitting" });

    try {
      const res = await fetch("/api/execute-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogueId: "GN-009",
          executionId,
          tileInstanceId: nodeId,
          inputData,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message ?? `HTTP ${res.status}`);
      }

      const result = await res.json();
      const artifact = result.artifact;
      if (!artifact) throw new Error("No artifact returned");

      addArtifact(nodeId, artifact);

      const artData = artifact.data as Record<string, unknown>;

      if (artData.videoGenerationStatus === "processing" && artData.exteriorTaskId && artData.interiorTaskId) {
        // Kling path: import and call pollVideoGeneration dynamically
        toast.info(t('toast.videoRegenerating'), {
          description: t('toast.klingGenerating'),
          duration: 5000,
        });
        const { retryPollVideoGeneration } = await import("@/features/execution/hooks/useExecution");
        retryPollVideoGeneration(
          nodeId,
          artData.exteriorTaskId as string,
          artData.interiorTaskId as string,
          addArtifact,
          setVideoGenProgress,
          clearVideoGenProgress,
          artData,
          executionId,
        ).catch(err => {
          logger.error("[Retry Video Poll] Error:", err);
        });
      } else if (artData.videoGenerationStatus === "client-rendering") {
        // Three.js path
        toast.info(t('toast.renderingWalkthrough'), {
          description: t('toast.threejsRendering'),
          duration: 5000,
        });
        const { retryRenderClientWalkthrough } = await import("@/features/execution/hooks/useExecution");
        retryRenderClientWalkthrough(
          nodeId,
          artData,
          executionId,
          addArtifact,
          setVideoGenProgress,
          clearVideoGenProgress,
        ).catch(err => {
          logger.error("[Retry Client Render] Error:", err);
          setVideoGenProgress(nodeId, {
            progress: 0,
            status: "failed",
            failureMessage: err instanceof Error ? err.message : "Rendering failed",
          });
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error("[Retry Video] Error:", msg);
      toast.error(t('toast.videoRetryFailed'), { description: msg, duration: 6000 });
      setVideoGenProgress(nodeId, {
        progress: 0,
        status: "failed",
        failureMessage: msg,
      });
    }
  }, [data.videoData?.nodeId, t]);

  // ── Persist completed video artifact to DB so it survives page refresh ──
  const artifacts = useExecutionStore(s => s.artifacts);
  const currentExecution = useExecutionStore(s => s.currentExecution);
  const persistedVideoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentExecution?.id) return;
    const execId = currentExecution.id;
    // Only persist for real DB executions (CUID IDs start with 'c', 25+ chars)
    if (execId.length < 20 || !execId.startsWith("c")) return;

    for (const [nodeId, art] of artifacts) {
      if (art.type !== "video") continue;
      const d = art.data as Record<string, unknown>;
      const videoUrl = (d.videoUrl as string) ?? "";
      const status = d.videoGenerationStatus as string | undefined;
      if (!videoUrl || status !== "complete") continue;

      // Build a unique key so we only persist once per video URL
      const key = `${execId}:${nodeId}:${videoUrl}`;
      if (persistedVideoRef.current === key) continue;
      persistedVideoRef.current = key;

      // Fire-and-forget: append the completed video artifact to the execution's tileResults
      fetch(`/api/executions/${execId}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId,
          nodeLabel: "Video Walkthrough",
          type: "video",
          title: "video",
          data: d,
        }),
      }).catch(() => { /* best-effort */ });
    }
  }, [artifacts, currentExecution?.id]);

  // Ensure active tab is valid
  const resolvedTab = data.availableTabs.includes(activeTab) ? activeTab : "overview";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "absolute",
        inset: 0,
        background: `linear-gradient(145deg, ${COLORS.BG_BASE}f8, ${COLORS.BG_BASE})`,
        overflow: "hidden",
        zIndex: 55,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ShowcaseHeader
        projectTitle={data.projectTitle}
        totalArtifacts={data.totalArtifacts}
        successNodes={data.successNodes}
        totalNodes={data.totalNodes}
        onClose={onClose}
      />

      <TabBar
        availableTabs={data.availableTabs}
        activeTab={resolvedTab}
        onTabChange={setActiveTab}
        modelTabIs2DFloorPlan={
          data.model3dData?.kind === "floor-plan-interactive" ||
          data.model3dData?.kind === "floor-plan-editor"
        }
      />

      {/* Tab Content */}
      <div className="showcase-tab-content" style={{
        flex: 1,
        overflow: resolvedTab === "model" ? "hidden" : "auto",
        padding: resolvedTab === "model" ? "0" : "24px clamp(12px, 3vw, 32px)",
      }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={resolvedTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            style={resolvedTab === "model" ? { height: "100%" } : undefined}
          >
            {/* Error Boundaries are placed at the per-tab orchestration level
                so a crash in one tab doesn't tear down the whole showcase. The
                shared ErrorBoundary class component (src/components/ErrorBoundary.tsx)
                logs to Sentry and renders a recoverable fallback. */}
            {resolvedTab === "overview" && (
              <ErrorBoundary>
                <OverviewTab
                  data={data}
                  onExpandVideo={handleExpandVideo}
                  onNavigateTab={handleNavigateTab}
                  onRetryVideo={handleRetryVideo}
                />
              </ErrorBoundary>
            )}
            {resolvedTab === "media" && (
              <ErrorBoundary>
                <MediaTab
                  data={data}
                  onExpandVideo={handleExpandVideo}
                  onCreateVideo={handleCreateVideoWalkthrough}
                  isCreatingVideo={isCreatingVideo}
                />
              </ErrorBoundary>
            )}
            {resolvedTab === "data" && (
              <ErrorBoundary>
                <DataTab data={data} />
              </ErrorBoundary>
            )}
            {resolvedTab === "model" && (
              <ErrorBoundary>
                <ModelTab data={data} />
              </ErrorBoundary>
            )}
            {resolvedTab === "export" && (
              <ErrorBoundary>
                <ExportTab data={data} />
              </ErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
