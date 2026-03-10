"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useUIStore } from "@/stores/ui-store";
import { useExecutionStore } from "@/stores/execution-store";
import { useShowcaseData } from "./useShowcaseData";
import { ShowcaseHeader } from "./ShowcaseHeader";
import { TabBar } from "./TabBar";
import { COLORS, type TabId } from "./constants";

import { OverviewTab } from "./tabs/OverviewTab";
import { MediaTab } from "./tabs/MediaTab";
import { DataTab } from "./tabs/DataTab";
import { ModelTab } from "./tabs/ModelTab";
import { ExportTab } from "./tabs/ExportTab";

interface ResultShowcaseProps {
  onClose: () => void;
}

export function ResultShowcase({ onClose }: ResultShowcaseProps) {
  const data = useShowcaseData();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const setVideoPlayerNodeId = useUIStore(s => s.setVideoPlayerNodeId);

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
        toast.info("Video regenerating in background...", {
          description: "Kling AI is generating your walkthrough",
          duration: 5000,
        });
        const { retryPollVideoGeneration } = await import("@/hooks/useExecution");
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
          console.error("[Retry Video Poll] Error:", err);
        });
      } else if (artData.videoGenerationStatus === "client-rendering") {
        // Three.js path
        toast.info("Rendering walkthrough...", {
          description: "Three.js rendering in your browser",
          duration: 5000,
        });
        const { retryRenderClientWalkthrough } = await import("@/hooks/useExecution");
        retryRenderClientWalkthrough(
          nodeId,
          artData,
          executionId,
          addArtifact,
          setVideoGenProgress,
          clearVideoGenProgress,
        ).catch(err => {
          console.error("[Retry Client Render] Error:", err);
          setVideoGenProgress(nodeId, {
            progress: 0,
            status: "failed",
            failureMessage: err instanceof Error ? err.message : "Rendering failed",
          });
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Retry Video] Error:", msg);
      toast.error("Video retry failed", { description: msg, duration: 6000 });
      setVideoGenProgress(nodeId, {
        progress: 0,
        status: "failed",
        failureMessage: msg,
      });
    }
  }, [data.videoData?.nodeId]);

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
      />

      {/* Tab Content */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "24px 32px",
      }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={resolvedTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {resolvedTab === "overview" && (
              <OverviewTab
                data={data}
                onExpandVideo={handleExpandVideo}
                onNavigateTab={handleNavigateTab}
                onRetryVideo={handleRetryVideo}
              />
            )}
            {resolvedTab === "media" && (
              <MediaTab
                data={data}
                onExpandVideo={handleExpandVideo}
              />
            )}
            {resolvedTab === "data" && (
              <DataTab data={data} />
            )}
            {resolvedTab === "model" && (
              <ModelTab data={data} />
            )}
            {resolvedTab === "export" && (
              <ExportTab data={data} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
