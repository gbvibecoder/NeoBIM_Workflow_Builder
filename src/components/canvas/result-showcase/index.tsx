"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUIStore } from "@/stores/ui-store";
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
