"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useUIStore } from "@/shared/stores/ui-store";
import {
  useResultPageData,
  type ResultPageData,
} from "@/features/result-page/hooks/useResultPageData";
import { selectHero } from "@/features/result-page/lib/select-hero";
import { selectPrimaryKpi } from "@/features/result-page/lib/select-primary-kpi";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";
import { ResultPageHeader } from "@/features/result-page/components/ResultPageHeader";
import { TabBar, type ResultTabId } from "@/features/result-page/components/tabs/TabBar";
import { OverviewTab } from "@/features/result-page/components/tabs/OverviewTab";
import { MediaTab } from "@/features/result-page/components/tabs/MediaTab";
import { DataTab } from "@/features/result-page/components/tabs/DataTab";
import { ModelTab } from "@/features/result-page/components/tabs/ModelTab";
import { ExportTab } from "@/features/result-page/components/tabs/ExportTab";
import { DiagnosticsTab } from "@/features/result-page/components/tabs/DiagnosticsTab";
import { HeroFailure } from "@/features/result-page/components/hero/HeroFailure";
import { HeroPending } from "@/features/result-page/components/hero/HeroPending";
import { HeroVideo } from "@/features/result-page/components/hero/HeroVideo";
import { HeroFloorPlanInteractive } from "@/features/result-page/components/hero/HeroFloorPlanInteractive";
import { HeroFloorPlanSvg } from "@/features/result-page/components/hero/HeroFloorPlanSvg";
import { HeroModel3D } from "@/features/result-page/components/hero/HeroModel3D";
import { HeroBoq } from "@/features/result-page/components/hero/HeroBoq";
import { HeroImage } from "@/features/result-page/components/hero/HeroImage";
import { HeroClash } from "@/features/result-page/components/hero/HeroClash";
import { HeroGeneric } from "@/features/result-page/components/hero/HeroGeneric";
import { PrimaryKpi } from "@/features/result-page/components/primitives/PrimaryKpi";
import { NotFound } from "@/features/result-page/components/empty/NotFound";
import { Forbidden } from "@/features/result-page/components/empty/Forbidden";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { useExecutionStore } from "@/features/execution/stores/execution-store";

interface ResultPageRootProps {
  executionId: string;
}

export function ResultPageRoot({ executionId }: ResultPageRootProps) {
  const data = useResultPageData(executionId);
  const heroKind = useMemo(() => selectHero(data), [data]);
  const primaryKpi = useMemo(() => selectPrimaryKpi(data), [data]);
  const accent = getWorkflowAccent(heroKind);
  const setVideoPlayerNodeId = useUIStore(s => s.setVideoPlayerNodeId);
  const hasTrace = useExecutionStore(s => !!s.currentTrace);

  // Tab availability
  const availableTabs = useMemo<ResultTabId[]>(() => {
    if (data.lifecycle === "loading") return ["overview"];
    const tabs: ResultTabId[] = ["overview"];
    if (data.videoData?.videoUrl || data.allImageUrls.length > 0 || data.svgContent) tabs.push("media");
    if (data.tableData.length > 0 || data.jsonData.length > 0 || data.kpiMetrics.length > 0) tabs.push("data");
    if (data.model3dData) tabs.push("model");
    if (data.fileDownloads.length > 0 || data.allImageUrls.length > 0 || data.videoData?.videoUrl || data.tableData.length > 0 || data.svgContent || data.jsonData.length > 0 || data.textContent) tabs.push("export");
    tabs.push("diagnostics");
    return tabs;
  }, [data]);

  const [activeTab, setActiveTab] = useState<ResultTabId>("overview");
  // Derive the resolved tab inline — avoids the React effect-state cascade
  // lint rule and keeps the tab fallback purely computed.
  const resolvedTab: ResultTabId = availableTabs.includes(activeTab) ? activeTab : "overview";

  const modelTabIs2DFloorPlan =
    data.model3dData?.kind === "floor-plan-interactive" ||
    data.model3dData?.kind === "floor-plan-editor";

  // Dispatch terminal lifecycle states early
  if (data.lifecycle === "not-found") return <ScaffoldFrame><NotFound executionId={executionId} /></ScaffoldFrame>;
  if (data.lifecycle === "forbidden") return <ScaffoldFrame><Forbidden /></ScaffoldFrame>;
  if (data.lifecycle === "loading") {
    return (
      <ScaffoldFrame>
        <ResultPageHeader
          projectTitle={data.projectTitle}
          workflowId={data.workflowId}
          executionId={executionId}
          lifecycle="loading"
          successNodes={0}
          totalNodes={0}
        />
        <main style={{ padding: "clamp(20px, 4vw, 40px) clamp(12px, 3vw, 28px)" }}>
          <SkeletonHero />
        </main>
      </ScaffoldFrame>
    );
  }

  return (
    <ScaffoldFrame>
      <ResultPageHeader
        projectTitle={data.projectTitle}
        workflowId={data.workflowId}
        executionId={executionId}
        lifecycle={data.lifecycle}
        successNodes={data.successNodes}
        totalNodes={data.totalNodes}
      />
      <TabBar
        available={availableTabs}
        active={resolvedTab}
        onChange={setActiveTab}
        modelTabIs2DFloorPlan={modelTabIs2DFloorPlan}
        accentColor={accent.base}
      />
      <main
        style={{
          padding: "clamp(20px, 4vw, 36px) clamp(12px, 3vw, 28px)",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {resolvedTab === "overview" ? (
          <ErrorBoundary>
            <RenderHero
              heroKind={heroKind}
              data={data}
              onFullscreenVideo={() => {
                if (data.videoData?.nodeId) setVideoPlayerNodeId(data.videoData.nodeId);
              }}
              onSwitchTab={setActiveTab}
            />
            {primaryKpi && heroKind !== "boq" && heroKind !== "clash" && heroKind !== "failure" && heroKind !== "pending" ? (
              <section
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${accent.ring}`,
                  borderRadius: 18,
                  padding: "clamp(20px, 3vw, 32px)",
                }}
              >
                <PrimaryKpi kpi={primaryKpi} accent={accent} />
              </section>
            ) : null}
            <OverviewTab data={data} />
          </ErrorBoundary>
        ) : null}
        <AnimatePresence mode="wait">
          <motion.div
            key={resolvedTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {resolvedTab === "media" ? <ErrorBoundary><MediaTab data={data} /></ErrorBoundary> : null}
            {resolvedTab === "data" ? <ErrorBoundary><DataTab data={data} /></ErrorBoundary> : null}
            {resolvedTab === "model" ? <ErrorBoundary><ModelTab data={data} /></ErrorBoundary> : null}
            {resolvedTab === "export" ? <ErrorBoundary><ExportTab data={data} /></ErrorBoundary> : null}
            {resolvedTab === "diagnostics" ? <ErrorBoundary><DiagnosticsTab hasTrace={hasTrace} /></ErrorBoundary> : null}
          </motion.div>
        </AnimatePresence>
      </main>
    </ScaffoldFrame>
  );
}

function RenderHero({
  heroKind,
  data,
  onFullscreenVideo,
  onSwitchTab,
}: {
  heroKind: ReturnType<typeof selectHero>;
  data: ResultPageData;
  onFullscreenVideo: () => void;
  onSwitchTab: (id: ResultTabId) => void;
}) {
  const primaryKpi = selectPrimaryKpi(data);
  if (heroKind === "failure") {
    return <HeroFailure errorMessage={data.executionMeta.errorMessage} workflowId={data.workflowId} />;
  }
  if (heroKind === "pending") {
    return <HeroPending progress={data.primaryVideoProgress} />;
  }
  if (heroKind === "video" && data.videoData) {
    return <HeroVideo video={data.videoData} onFullscreen={onFullscreenVideo} />;
  }
  if (heroKind === "floor-plan-interactive" && data.model3dData?.kind === "floor-plan-interactive") {
    return <HeroFloorPlanInteractive data={data.model3dData} />;
  }
  if (heroKind === "3d-model" && data.model3dData) {
    return (
      <HeroModel3D
        model={data.model3dData}
        fileDownloads={data.fileDownloads}
        executionId={data.executionId}
        onExploreModelTab={() => onSwitchTab("model")}
      />
    );
  }
  if (heroKind === "floor-plan-svg" && data.svgContent) {
    return (
      <HeroFloorPlanSvg
        svgContent={data.svgContent}
        has3DEditor={!!data.model3dData}
        onOpen3D={() => onSwitchTab("model")}
      />
    );
  }
  if (heroKind === "boq" && data.boqSummary) {
    return <HeroBoq boq={data.boqSummary} kpi={primaryKpi} tableData={data.tableData} />;
  }
  if (heroKind === "image" && data.allImageUrls.length > 0) {
    return <HeroImage imageUrls={data.allImageUrls} />;
  }
  if (heroKind === "clash" && data.clashSummary) {
    return <HeroClash summary={data.clashSummary} onViewAll={() => onSwitchTab("data")} />;
  }
  return <HeroGeneric projectTitle={data.projectTitle} totalArtifacts={data.totalArtifacts} />;
}

function ScaffoldFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#070809",
        color: "#F5F5FA",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

function SkeletonHero() {
  return (
    <div
      style={{
        height: 360,
        borderRadius: 20,
        background: "linear-gradient(110deg, rgba(255,255,255,0.03) 8%, rgba(255,255,255,0.06) 18%, rgba(255,255,255,0.03) 33%)",
        backgroundSize: "200% 100%",
        animation: "result-skeleton-shimmer 1.6s linear infinite",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <style>{`
        @keyframes result-skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
