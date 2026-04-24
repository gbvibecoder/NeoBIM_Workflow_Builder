"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CheckCircle2, AlertTriangle, Share2, ArrowDownToLine, Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { NEUTRAL } from "@/features/results-v2/constants";
import { useExecutionResult } from "@/features/results-v2/hooks/useExecutionResult";
import { selectHero } from "@/features/results-v2/lib/select-hero";
import { pickAccent } from "@/features/results-v2/lib/workflow-accent";
import { buildRibbon, type RibbonEntry } from "@/features/results-v2/lib/artifact-grouping";
import type { ExecutionResult, PanelDescriptor } from "@/features/results-v2/types";
import { HeroVideo } from "@/features/results-v2/components/hero/HeroVideo";
import { HeroImage } from "@/features/results-v2/components/hero/HeroImage";
import { HeroViewer3D } from "@/features/results-v2/components/hero/HeroViewer3D";
import { HeroFloorPlan } from "@/features/results-v2/components/hero/HeroFloorPlan";
import { HeroKPI } from "@/features/results-v2/components/hero/HeroKPI";
import { HeroSkeleton } from "@/features/results-v2/components/hero/HeroSkeleton";
import { ArtifactRibbon } from "@/features/results-v2/components/ribbon/ArtifactRibbon";
import { OverviewPanel } from "@/features/results-v2/components/panels/OverviewPanel";
import { GeneratedAssetsPanel } from "@/features/results-v2/components/panels/GeneratedAssetsPanel";
import { BehindTheScenesPanel } from "@/features/results-v2/components/panels/BehindTheScenesPanel";
import { DownloadCenterPanel } from "@/features/results-v2/components/panels/DownloadCenterPanel";
import { AINotesPanel } from "@/features/results-v2/components/panels/AINotesPanel";

interface ResultExperienceProps {
  executionId: string;
}

export function ResultExperience({ executionId }: ResultExperienceProps) {
  const { result, loading, error } = useExecutionResult(executionId);

  if (loading || !result) {
    return <LoadingShell error={error} />;
  }

  return <ResultExperienceInner result={result} />;
}

/**
 * Preview-friendly composer — accepts a normalized ExecutionResult directly,
 * bypassing the hook. Used by `/dashboard/results-v2-preview` to render
 * fixture data side-by-side without any DB access.
 */
export function ResultExperienceInner({ result }: { result: ExecutionResult }) {
  const reducedMotion = useReducedMotion();
  const variant = useMemo(() => selectHero(result), [result]);
  const accent = useMemo(() => pickAccent(result), [result]);
  const ribbon = useMemo(() => buildRibbon(result), [result]);
  const previews = useMemo(() => buildRibbonPreviews(result), [result]);

  const [activeRibbonId, setActiveRibbonId] = useState<string | null>(ribbon[0]?.id ?? null);
  const [activePanel, setActivePanel] = useState<PanelDescriptor["id"]>("overview");

  const handleRibbonSelect = useCallback((entry: RibbonEntry) => {
    setActiveRibbonId(entry.id);
    setActivePanel(entry.targetPanel);
    const target = document.getElementById(`results-v2-panel-${entry.targetPanel}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Micro-delight #1 — status pill scale pulse on mount when completed.
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (reducedMotion) return;
    if (result.status.state !== "success" && result.status.state !== "partial") return;
    const kick = window.setTimeout(() => setPulse(true), 220);
    const release = window.setTimeout(() => setPulse(false), 920);
    return () => {
      window.clearTimeout(kick);
      window.clearTimeout(release);
    };
  }, [reducedMotion, result.status.state]);

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      style={{ background: NEUTRAL.BG_BASE, minHeight: "100vh", color: NEUTRAL.TEXT_PRIMARY }}
    >
      <ExperienceHeader result={result} accentStart={accent.start} statusPulse={pulse} />

      <ErrorBoundary>
        {variant === "video" && result.video ? (
          <HeroVideo video={result.video} accent={accent} workflowName={result.workflowName} />
        ) : null}
        {variant === "image" && result.images.length > 0 ? (
          <HeroImage images={result.images} accent={accent} workflowName={result.workflowName} />
        ) : null}
        {variant === "viewer3d" && result.model3d ? (
          <HeroViewer3D model={result.model3d} accent={accent} workflowName={result.workflowName} />
        ) : null}
        {variant === "floorPlan" && result.floorPlan ? (
          <HeroFloorPlan floorPlan={result.floorPlan} accent={accent} workflowName={result.workflowName} />
        ) : null}
        {variant === "kpi" ? (
          <HeroKPI
            metrics={result.metrics}
            accent={accent}
            workflowName={result.workflowName}
            boqTotalGfa={result.boqTotalGfa}
          />
        ) : null}
        {variant === "skeleton" ? (
          <HeroSkeleton
            accent={accent}
            workflowName={result.workflowName}
            copy={result.status.state === "failed" ? "Generation failed" : "Rendering cinematic walkthrough"}
            progress={result.video?.progress}
          />
        ) : null}
      </ErrorBoundary>

      {ribbon.length > 0 ? (
        <ArtifactRibbon
          entries={ribbon}
          accent={accent}
          activeId={activeRibbonId}
          onSelect={handleRibbonSelect}
          activePanel={activePanel}
          previews={previews}
        />
      ) : null}

      <ErrorBoundary>
        <OverviewPanel result={result} accent={accent} />
      </ErrorBoundary>
      <ErrorBoundary>
        <GeneratedAssetsPanel result={result} accent={accent} />
      </ErrorBoundary>
      <ErrorBoundary>
        <BehindTheScenesPanel result={result} accent={accent} />
      </ErrorBoundary>
      <ErrorBoundary>
        <DownloadCenterPanel result={result} accent={accent} />
      </ErrorBoundary>
      <ErrorBoundary>
        <AINotesPanel result={result} accent={accent} />
      </ErrorBoundary>
    </motion.main>
  );
}

function buildRibbonPreviews(result: ExecutionResult): Record<string, string | undefined> {
  const firstImage = result.images[0];
  return {
    video: result.video?.downloadUrl ? firstImage ?? undefined : firstImage,
    model3d: result.model3d?.thumbnailUrl ?? firstImage,
    floorPlan: result.floorPlan?.sourceImageUrl ?? firstImage,
    renders: firstImage,
    boq: undefined,
    tables: undefined,
    metrics: undefined,
    pdf: undefined,
  };
}

function ExperienceHeader({
  result,
  accentStart,
  statusPulse,
}: {
  result: ExecutionResult;
  accentStart: string;
  statusPulse: boolean;
}) {
  const state = result.status.state;
  const statusLabel =
    state === "success"
      ? "Complete"
      : state === "partial"
        ? "Partial"
        : state === "failed"
          ? "Failed"
          : state === "running"
            ? "Running"
            : "Pending";

  // Micro-delight #3 — "Link copied · Expires never" tooltip on share click.
  const [shareTip, setShareTip] = useState(false);
  const shareTipHandleRef = useRef<number | null>(null);

  const handleShare = () => {
    if (typeof navigator !== "undefined") {
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.share && nav.clipboard) {
        // Use Web Share on mobile — silent tooltip, native sheet does the rest.
        nav
          .share({ title: result.workflowName, url: window.location.href })
          .catch(() => undefined);
        return;
      }
      if (nav.clipboard) {
        void nav.clipboard.writeText(window.location.href).catch(() => undefined);
      }
    }
    setShareTip(true);
    if (shareTipHandleRef.current != null) window.clearTimeout(shareTipHandleRef.current);
    shareTipHandleRef.current = window.setTimeout(() => setShareTip(false), 2000);
  };

  useEffect(() => {
    return () => {
      if (shareTipHandleRef.current != null) window.clearTimeout(shareTipHandleRef.current);
    };
  }, []);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        height: 56,
        padding: "0 clamp(16px, 4vw, 32px)",
        background: "rgba(7,8,9,0.85)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderBottom: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            color: NEUTRAL.TEXT_PRIMARY,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={14} />
        </Link>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: NEUTRAL.TEXT_PRIMARY,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "clamp(180px, 35vw, 480px)",
          }}
        >
          {result.workflowName}
        </span>
        <StatusPill state={state} label={statusLabel} accent={accentStart} pulse={statusPulse} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
        <button
          type="button"
          aria-label="Share results"
          style={headerButtonStyle}
          onClick={handleShare}
        >
          <Share2 size={14} />
        </button>
        <AnimatePresence>
          {shareTip ? (
            <motion.span
              key="share-tip"
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.2 }}
              role="status"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 36,
                padding: "6px 10px",
                borderRadius: 8,
                background: "rgba(10,12,16,0.92)",
                border: `1px solid ${accentStart}66`,
                color: NEUTRAL.TEXT_PRIMARY,
                fontSize: 11,
                fontWeight: 500,
                whiteSpace: "nowrap",
                boxShadow: `0 8px 22px rgba(0,0,0,0.45), 0 0 20px ${accentStart}33`,
              }}
            >
              Link copied · Expires never
            </motion.span>
          ) : null}
        </AnimatePresence>
        <button
          type="button"
          aria-label="Download center"
          style={headerButtonStyle}
          onClick={() => {
            const target = document.getElementById("results-v2-panel-downloads");
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <ArrowDownToLine size={14} />
        </button>
      </div>
    </header>
  );
}

function StatusPill({
  state,
  label,
  accent,
  pulse,
}: {
  state: ExecutionResult["status"]["state"];
  label: string;
  accent: string;
  pulse: boolean;
}) {
  const tone = state === "failed" ? "#F43F5E" : state === "running" ? accent : "#10B981";
  const Icon = state === "failed" ? AlertTriangle : state === "running" ? Loader2 : CheckCircle2;
  const spinning = state === "running";

  return (
    <motion.span
      initial={{ scale: 1 }}
      animate={pulse ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: `${tone}1a`,
        border: `1px solid ${tone}55`,
        color: tone,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        boxShadow: pulse ? `0 0 24px ${tone}88` : "none",
        transition: "box-shadow 400ms ease-out",
      }}
    >
      <Icon
        size={12}
        aria-hidden
        style={spinning ? { animation: "spin 1.2s linear infinite" } : undefined}
      />
      {label}
    </motion.span>
  );
}

const headerButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: 8,
  color: NEUTRAL.TEXT_PRIMARY,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
  cursor: "pointer",
  fontFamily: "inherit",
};

function LoadingShell({ error }: { error: string | null }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: NEUTRAL.BG_BASE,
        color: NEUTRAL.TEXT_PRIMARY,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        {error ? (
          <>
            <AlertTriangle size={22} style={{ color: "#F43F5E" }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Couldn&apos;t load this result</span>
            <span style={{ fontSize: 12, color: NEUTRAL.TEXT_SECONDARY }}>{error}</span>
          </>
        ) : (
          <>
            <Loader2 size={18} style={{ animation: "spin 1.2s linear infinite", color: NEUTRAL.TEXT_SECONDARY }} />
            <span style={{ fontSize: 13, color: NEUTRAL.TEXT_SECONDARY }}>Loading your results…</span>
          </>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </main>
  );
}
