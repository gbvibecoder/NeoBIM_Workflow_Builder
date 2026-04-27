"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useResultPageData } from "@/features/result-page/hooks/useResultPageData";
import { selectHero } from "@/features/result-page/lib/select-hero";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { ExecutionDiagnosticsPanel } from "@/components/diagnostics/ExecutionDiagnosticsPanel";
import { retryPollVideoGeneration } from "@/features/execution/hooks/useExecution";
import { useExecutionStore } from "@/features/execution/stores/execution-store";

import { PageHeader } from "@/features/result-page/components/PageHeader";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { PageBackground } from "@/features/result-page/components/aec/PageBackground";
import { HeroSection } from "@/features/result-page/components/sections/HeroSection";
import { PartialBanner } from "@/features/result-page/components/sections/PartialBanner";
import { FailureSection } from "@/features/result-page/components/sections/FailureSection";
import { PendingSection } from "@/features/result-page/components/sections/PendingSection";
import {
  DedicatedVisualizerEntries,
  isDedicatedVisualizerEntriesEligible,
} from "@/features/result-page/components/sections/DedicatedVisualizerEntries";
import {
  GeneratedAssetsSection,
  isGeneratedAssetsEligible,
} from "@/features/result-page/components/sections/GeneratedAssetsSection";
import {
  DataPreviewSection,
  isDataPreviewEligible,
} from "@/features/result-page/components/sections/DataPreviewSection";
import {
  ExportsSection,
  isExportsEligible,
} from "@/features/result-page/components/sections/ExportsSection";
import {
  PipelineTimelineSection,
  isPipelineTimelineEligible,
} from "@/features/result-page/components/sections/PipelineTimelineSection";
import {
  LogsSection,
  isLogsSectionEligible,
} from "@/features/result-page/components/sections/LogsSection";
import { LiveStatusStrip } from "@/features/result-page/components/sections/LiveStatusStrip";
import { NotFound } from "@/features/result-page/components/empty/NotFound";
import { Forbidden } from "@/features/result-page/components/empty/Forbidden";
import { readSavedNote } from "@/features/result-page/components/features/AnnotateButton";

interface ResultPageRootProps {
  executionId: string;
}

/**
 * Phase 3 — distinct AEC-flavored result page.
 *
 * Architectural personality: section indices, drafting marks, dimension
 * lines, north arrow, monospace technical labels. Three functional
 * additions: per-execution notes (localStorage), smart-share dropdown
 * (deep-links to dedicated visualizers), quality fingerprint widget.
 *
 * Phase 2 wins preserved:
 *  - single scrollable column, no tabs
 *  - light theme on `#FAFAF8`
 *  - ₹ via BOQ's canonical formatINR (no `$`)
 *  - gentle failure UX (amber for partial, red only for full failure)
 *  - floating ExecutionDiagnosticsPanel bottom-right
 */
export function ResultPageRoot({ executionId }: ResultPageRootProps) {
  const data = useResultPageData(executionId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const heroKind = useMemo(() => selectHero(data), [data]);

  // Smart-share deep-link: if arriving with `?open=boq|editor|ifc`, route the
  // recipient to the relevant dedicated visualizer instead of the wrapper.
  useEffect(() => {
    const target = searchParams.get("open");
    if (!target) return;
    if (data.lifecycle === "loading") return;
    if (target === "boq" && data.boqSummary) {
      router.replace(`/dashboard/results/${executionId}/boq`);
      return;
    }
    if (target === "ifc" && data.fileDownloads.some(f => f.name.toLowerCase().endsWith(".ifc"))) {
      router.replace(`/dashboard/ifc-viewer?executionId=${executionId}`);
      return;
    }
    if (
      target === "editor" &&
      (data.model3dData?.kind === "floor-plan-interactive" ||
        data.model3dData?.kind === "floor-plan-editor")
    ) {
      try {
        if (data.model3dData.kind === "floor-plan-interactive") {
          sessionStorage.setItem("floorPlanProject", JSON.stringify(data.model3dData.floorPlanProject));
        } else if (data.model3dData.kind === "floor-plan-editor" && data.model3dData.geometry) {
          sessionStorage.setItem("fp-editor-geometry", JSON.stringify(data.model3dData.geometry));
        }
      } catch {
        // sessionStorage unavailable — the editor will open empty
      }
      router.replace("/dashboard/floor-plan?source=pipeline");
    }
  }, [searchParams, data, executionId, router]);

  // Annotate state — read once, pass into header. Header keeps its own copy
  // so the textarea writes don't re-render the entire page.
  const [initialNote, setInitialNote] = useState("");
  useEffect(() => {
    setInitialNote(readSavedNote(executionId));
  }, [executionId]);

  // ── Resume legacy video polling if canvas page polling was interrupted ──
  // When user navigates from canvas → result page, the canvas unmounts and
  // its AbortController kills the pollVideoGeneration loop. The result page
  // hydrates stale videoGenProgress from the DB, showing 4% forever.
  // This effect detects that state and restarts polling.
  const pollResumedRef = useRef(false);
  const addArtifact = useExecutionStore(s => s.addArtifact);
  const setVideoGenProgress = useExecutionStore(s => s.setVideoGenProgress);
  const clearVideoGenProgress = useExecutionStore(s => s.clearVideoGenProgress);
  useEffect(() => {
    if (pollResumedRef.current) return;
    const vd = data.videoData;
    if (!vd || !data.isVideoGenerating) return;
    // Only resume for legacy path (has task IDs, no videoJobId)
    if (vd.videoJobId) return;
    if (!vd.exteriorTaskId || !vd.interiorTaskId) return;
    if (vd.videoUrl) return; // Already have a URL — no need to poll

    pollResumedRef.current = true;
    const ctrl = new AbortController();
    const pipeline = (vd.videoPipeline === "text2video" ? "text2video" : "image2video") as "image2video" | "text2video";

    retryPollVideoGeneration(
      vd.nodeId,
      vd.exteriorTaskId,
      vd.interiorTaskId,
      addArtifact,
      setVideoGenProgress,
      clearVideoGenProgress,
      {},
      executionId,
      pipeline,
      ctrl.signal,
    ).catch(() => {});

    return () => { ctrl.abort(); };
  }, [data.videoData, data.isVideoGenerating, executionId, addArtifact, setVideoGenProgress, clearVideoGenProgress]);

  // North-arrow eligibility: floor-plan / model-3d / SVG floor plan workflows
  const showNorthArrow =
    data.model3dData?.kind === "floor-plan-interactive" ||
    data.model3dData?.kind === "floor-plan-editor" ||
    data.model3dData?.kind === "html-iframe" ||
    !!data.svgContent;

  // ── Terminal lifecycle states ──
  if (data.lifecycle === "not-found") {
    return (
      <Frame>
        <NotFound executionId={executionId} />
      </Frame>
    );
  }
  if (data.lifecycle === "forbidden") {
    return (
      <Frame>
        <Forbidden />
      </Frame>
    );
  }

  return (
    <Frame>
      <PageBackground />

      <div style={{ position: "relative", zIndex: 1 }}>
        <PageHeader data={data} initialNote={initialNote} showNorthArrow={showNorthArrow} />

        {/* Phase 4.1 Fix 5 — workflow-aware mono ticker beneath the header */}
        <LiveStatusStrip data={data} />

        <main
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            padding: "32px clamp(12px, 3vw, 32px) 96px",
            display: "flex",
            flexDirection: "column",
            gap: 56,
          }}
        >
          {data.lifecycle === "loading" ? (
            <SkeletonHero />
          ) : data.lifecycle === "failed" && data.totalArtifacts === 0 ? (
            <ErrorBoundary>
              <FailureSection
                errorMessage={data.executionMeta.errorMessage}
                workflowId={data.workflowId}
                executionId={executionId}
              />
            </ErrorBoundary>
          ) : (
            <>
              {data.lifecycle === "partial" ? (
                <ErrorBoundary>
                  <PartialBanner data={data} />
                </ErrorBoundary>
              ) : null}

              {heroKind === "pending" ? (
                <ErrorBoundary>
                  <PendingSection progress={data.primaryVideoProgress} previewImageUrls={data.allImageUrls} />
                </ErrorBoundary>
              ) : (
                <ErrorBoundary>
                  <HeroSection data={data} heroKind={heroKind} />
                </ErrorBoundary>
              )}

              {/* Phase 4.1 Fix 3 — section indices derived from rendered count.
                  Each section's eligibility predicate is consulted in declaration
                  order; only eligible sections receive an index. Numbering reads
                  01 · 02 · 03 · … with no gaps. */}
              {(() => {
                let counter = 0;
                const next = () => ++counter;
                const willDedicated = isDedicatedVisualizerEntriesEligible(data);
                const willAssets = isGeneratedAssetsEligible(data);
                const willData = isDataPreviewEligible(data);
                const willExports = isExportsEligible(data);
                const willPipeline = isPipelineTimelineEligible(data.pipelineSteps);
                const willLogs = isLogsSectionEligible();
                const dedicatedIdx = willDedicated ? next() : 0;
                const assetsIdx = willAssets ? next() : 0;
                const dataIdx = willData ? next() : 0;
                const exportsIdx = willExports ? next() : 0;
                const pipelineIdx = willPipeline ? next() : 0;
                const logsIdx = willLogs ? next() : 0;
                return (
                  <>
                    {willDedicated ? (
                      <ErrorBoundary>
                        <DedicatedVisualizerEntries data={data} index={dedicatedIdx} />
                      </ErrorBoundary>
                    ) : null}
                    {willAssets ? (
                      <ErrorBoundary>
                        <GeneratedAssetsSection data={data} index={assetsIdx} />
                      </ErrorBoundary>
                    ) : null}
                    {willData ? (
                      <ErrorBoundary>
                        <DataPreviewSection data={data} index={dataIdx} />
                      </ErrorBoundary>
                    ) : null}
                    {willExports ? (
                      <ErrorBoundary>
                        <ExportsSection data={data} index={exportsIdx} />
                      </ErrorBoundary>
                    ) : null}
                    {willPipeline ? (
                      <ErrorBoundary>
                        <PipelineTimelineSection steps={data.pipelineSteps} index={pipelineIdx} />
                      </ErrorBoundary>
                    ) : null}
                    {willLogs ? (
                      <ErrorBoundary>
                        <LogsSection index={logsIdx} />
                      </ErrorBoundary>
                    ) : null}
                  </>
                );
              })()}
            </>
          )}
        </main>
      </div>

      <ExecutionDiagnosticsPanel />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: "#FAFAF8",
        color: "#0F172A",
        position: "relative",
      }}
    >
      {children}
    </div>
  );
}

function SkeletonHero() {
  return (
    <ScrollReveal>
      <div
        style={{
          height: 360,
          borderRadius: 20,
          background: "linear-gradient(110deg, #F1F5F9 8%, #FFFFFF 18%, #F1F5F9 33%)",
          backgroundSize: "200% 100%",
          animation: "result-skeleton-shimmer 1.6s linear infinite",
          border: "1px solid rgba(0,0,0,0.06)",
        }}
      />
      <style>{`
        @keyframes result-skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </ScrollReveal>
  );
}
