"use client";

import { useMemo } from "react";
import { useResultPageData } from "@/features/result-page/hooks/useResultPageData";
import { selectHero } from "@/features/result-page/lib/select-hero";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { ExecutionDiagnosticsPanel } from "@/components/diagnostics/ExecutionDiagnosticsPanel";
import { InteractiveDotGrid } from "@/features/boq/components/InteractiveDotGrid";

import { PageHeader } from "@/features/result-page/components/PageHeader";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { HeroSection } from "@/features/result-page/components/sections/HeroSection";
import { PartialBanner } from "@/features/result-page/components/sections/PartialBanner";
import { FailureSection } from "@/features/result-page/components/sections/FailureSection";
import { PendingSection } from "@/features/result-page/components/sections/PendingSection";
import { DedicatedVisualizerEntries } from "@/features/result-page/components/sections/DedicatedVisualizerEntries";
import { GeneratedAssetsSection } from "@/features/result-page/components/sections/GeneratedAssetsSection";
import { DataPreviewSection } from "@/features/result-page/components/sections/DataPreviewSection";
import { ExportsSection } from "@/features/result-page/components/sections/ExportsSection";
import { PipelineTimelineSection } from "@/features/result-page/components/sections/PipelineTimelineSection";
import { NotFound } from "@/features/result-page/components/empty/NotFound";
import { Forbidden } from "@/features/result-page/components/empty/Forbidden";

interface ResultPageRootProps {
  executionId: string;
}

/**
 * Phase 2 — single-scroll, BOQ-visualizer-aesthetic result page.
 *
 * - One scrollable column (no tabs).
 * - Light theme that matches the BOQ visualizer family.
 * - Floating <ExecutionDiagnosticsPanel /> bottom-right (P3).
 * - Cinematic motion: scroll-driven section reveals + hero blur-to-focus
 *   entrance + parallax + counter springs (all reduced-motion safe).
 */
export function ResultPageRoot({ executionId }: ResultPageRootProps) {
  const data = useResultPageData(executionId);
  const heroKind = useMemo(() => selectHero(data), [data]);

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
      <InteractiveDotGrid />

      <div style={{ position: "relative", zIndex: 1 }}>
        <PageHeader
          projectTitle={data.projectTitle}
          workflowId={data.workflowId}
          executionId={executionId}
          lifecycle={data.lifecycle}
          successNodes={data.successNodes}
          totalNodes={data.totalNodes}
          startedAt={data.executionMeta.executedAt}
        />

        <main
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            padding: "32px clamp(12px, 3vw, 32px) 96px",
            display: "flex",
            flexDirection: "column",
            gap: 28,
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
              {/* Partial-state banner appears above the hero — only when status === "partial" */}
              {data.lifecycle === "partial" ? (
                <ErrorBoundary>
                  <PartialBanner data={data} />
                </ErrorBoundary>
              ) : null}

              {/* Pending video render replaces the hero with the in-progress card */}
              {heroKind === "pending" ? (
                <ErrorBoundary>
                  <PendingSection progress={data.primaryVideoProgress} />
                </ErrorBoundary>
              ) : (
                <ErrorBoundary>
                  <HeroSection data={data} heroKind={heroKind} />
                </ErrorBoundary>
              )}

              <ErrorBoundary>
                <DedicatedVisualizerEntries data={data} />
              </ErrorBoundary>

              <ErrorBoundary>
                <GeneratedAssetsSection data={data} />
              </ErrorBoundary>

              <ErrorBoundary>
                <DataPreviewSection data={data} />
              </ErrorBoundary>

              <ErrorBoundary>
                <ExportsSection data={data} />
              </ErrorBoundary>

              <ErrorBoundary>
                <PipelineTimelineSection steps={data.pipelineSteps} />
              </ErrorBoundary>
            </>
          )}
        </main>
      </div>

      {/* Floating diagnostics launcher — bottom-right (P3). Same pattern as
          the BOQ visualizer route. The component renders nothing when there
          is no trace yet, so it's safe to mount unconditionally. */}
      <ExecutionDiagnosticsPanel />
    </Frame>
  );
}

/** Outer frame: light bg, full height, owns the scroll. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: "#FAFAF8",
        color: "#111827",
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
          background:
            "linear-gradient(110deg, #F3F4F6 8%, #FFFFFF 18%, #F3F4F6 33%)",
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
