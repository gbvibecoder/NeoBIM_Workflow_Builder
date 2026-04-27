"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import DOMPurify from "dompurify";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight,
  Box,
  Building2,
  Calculator,
  Download,
  ExternalLink,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Maximize2,
  PenTool,
} from "lucide-react";
import { AnimatedNumber } from "@/features/boq/components/AnimatedNumber";
import { formatINR } from "@/features/boq/components/recalc-engine";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";
import { DraftingMarks } from "@/features/result-page/components/aec/DraftingMarks";
import { DimensionLine } from "@/features/result-page/components/aec/DimensionLine";
import { MonoLabel } from "@/features/result-page/components/aec/MonoLabel";
import { MaterialChipsCascade } from "@/features/result-page/components/animations/MaterialChipsCascade";
import { IsometricBuilding } from "@/features/result-page/components/animations/IsometricBuilding";
import { ShutterReveal } from "@/features/result-page/components/animations/ShutterReveal";
import { PhotoDevelop } from "@/features/result-page/components/animations/PhotoDevelop";
import { LiveCostBreakdownDonut } from "@/features/result-page/components/animations/LiveCostBreakdownDonut";
import { RoomScheduleCascade } from "@/features/result-page/components/animations/RoomScheduleCascade";
import { RoomAreaDonut } from "@/features/result-page/components/animations/RoomAreaDonut";
import {
  ElementCategoryCascade,
  __extractIfcCategories,
} from "@/features/result-page/components/animations/ElementCategoryCascade";
import { ElementDistributionDonut } from "@/features/result-page/components/animations/ElementDistributionDonut";
import { ShotTimeline } from "@/features/result-page/components/animations/ShotTimeline";
import { RenderStatsDonut } from "@/features/result-page/components/animations/RenderStatsDonut";
import { MetadataCascade } from "@/features/result-page/components/animations/MetadataCascade";
import { normalizeRegion } from "@/lib/normalize-region";
import type { HeroKind } from "@/features/result-page/lib/select-hero";
import type {
  ResultPageData,
  FloorPlanInteractiveData,
  Model3DData,
} from "@/features/result-page/hooks/useResultPageData";
import type { ClashSummary } from "@/features/result-page/lib/extract-clash-summary";

const FloorPlanViewer = dynamic(
  () => import("@/features/floor-plan/components/FloorPlanViewer").then(m => ({ default: m.FloorPlanViewer })),
  { ssr: false, loading: () => <PreviewSkeleton label="Loading floor plan editor…" /> },
);

interface HeroSectionProps {
  data: ResultPageData;
  heroKind: HeroKind;
}

/**
 * Single adaptive hero. Branches internally so the orchestrator stays clean.
 * Every variant lives on the same white-card / soft-tint design family as
 * the BOQ visualizer.
 */
export function HeroSection({ data, heroKind }: HeroSectionProps) {
  const accent = getWorkflowAccent(heroKind);
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const parallaxY = useTransform(scrollY, [0, 600], [0, reduce ? 0 : -32]);

  return (
    <motion.section
      ref={containerRef}
      initial={reduce ? { opacity: 1 } : { opacity: 0, filter: "blur(10px)", scale: 0.98 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, filter: "blur(0px)", scale: 1 }}
      transition={reduce ? { duration: 0 } : { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        position: "relative",
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 20,
        boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: accent.stripe,
        }}
      />
      <motion.div
        aria-hidden="true"
        style={{
          y: parallaxY,
          position: "absolute",
          top: -60,
          right: -60,
          width: 360,
          height: 360,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent.halo} 0%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      {/* Drafting-mark corner brackets — quietly architectural */}
      <DraftingMarks color="#94A3B8" length={14} inset={10} opacity={0.42} />

      <div style={{ position: "relative", zIndex: 1 }}>
        {heroKind === "video" && data.videoData ? <VideoVariant data={data} /> : null}
        {heroKind === "image" && data.allImageUrls.length > 0 ? (
          <ImageVariant urls={data.allImageUrls} />
        ) : null}
        {heroKind === "floor-plan-interactive" && data.model3dData?.kind === "floor-plan-interactive" ? (
          <FloorPlanInteractiveVariant model={data.model3dData} />
        ) : null}
        {heroKind === "floor-plan-svg" && data.svgContent ? (
          <FloorPlanSvgVariant svgContent={data.svgContent} />
        ) : null}
        {heroKind === "3d-model" && data.model3dData ? <Model3DVariant data={data} model={data.model3dData} /> : null}
        {heroKind === "boq" && data.boqSummary ? <BoqVariant data={data} /> : null}
        {heroKind === "clash" && data.clashSummary ? <ClashVariant summary={data.clashSummary} /> : null}
        {heroKind === "table" && data.tableData.length > 0 ? <TableVariant data={data} /> : null}
        {heroKind === "text" && data.textContent ? <TextVariant text={data.textContent} /> : null}
        {heroKind === "generic" ? <GenericVariant data={data} /> : null}
      </div>
    </motion.section>
  );
}

// ─── Variants ────────────────────────────────────────────────────────────────

function VideoVariant({ data }: { data: ResultPageData }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotion();
  const segments = useMemo(() => data.videoData?.segments ?? [], [data.videoData?.segments]);
  const [activeIdx, setActiveIdx] = useState(0);

  // Determine the currently-playing segment URL
  const activeSegment = segments[activeIdx];
  const url = activeSegment?.videoUrl || data.videoData?.videoUrl || "";
  const downloadUrl = activeSegment?.downloadUrl || data.videoData?.downloadUrl || "";

  // Auto-play on intersection
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url || reduce) return;
    const obs = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
            void el.play().catch(() => {});
          } else {
            el.pause();
          }
        }
      },
      { threshold: [0, 0.3, 0.6, 1] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [url, reduce]);

  // When a segment finishes, auto-advance to the next playable segment
  useEffect(() => {
    const el = videoRef.current;
    if (!el || segments.length <= 1) return;
    const handleEnded = () => {
      const next = segments.findIndex((s, i) => i > activeIdx && !!s.videoUrl);
      if (next >= 0) {
        setActiveIdx(next);
      }
    };
    el.addEventListener("ended", handleEnded);
    return () => el.removeEventListener("ended", handleEnded);
  }, [activeIdx, segments]);

  // When activeIdx changes, reload the video
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    el.load();
    void el.play().catch(() => {});
  }, [url]);

  return (
    <div>
      <div
        style={{
          position: "relative",
          background: "#000",
          aspectRatio: "16 / 9",
          maxHeight: "min(64vh, 700px)",
        }}
      >
        <video
          ref={videoRef}
          src={url}
          muted
          loop={segments.length <= 1}
          playsInline
          controls
          crossOrigin="anonymous"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <ShutterReveal />
      </div>
      <div
        style={{
          padding: "20px 24px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#F5F3FF",
              color: "#7C3AED",
              flexShrink: 0,
            }}
          >
            <Film size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#7C3AED",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
              }}
            >
              Cinematic walkthrough
            </div>
            <div style={{ marginTop: 6 }}>
              <MonoLabel size={12} color="#0F172A" uppercase={false}>
                {`${String(data.videoData?.durationSeconds ?? 15).padStart(2, "0")}.000s`}
                {" · "}
                {`${segments.length || data.videoData?.shotCount || 1} shots`}
                {data.videoData?.pipeline ? ` · ${data.videoData.pipeline}` : ""}
                {" · 1080p"}
              </MonoLabel>
            </div>
          </div>
        </div>
        {downloadUrl ? (
          <a
            href={downloadUrl}
            download={data.videoData?.name ?? "walkthrough.mp4"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 10,
              background: "#7C3AED",
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              boxShadow: "0 2px 6px rgba(124,58,237,0.18)",
            }}
          >
            <Download size={14} aria-hidden="true" />
            Download MP4
          </a>
        ) : null}
      </div>

      {data.videoData ? (
        <div className="video-hero-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "clamp(20px, 3vw, 36px)", padding: "0 24px 24px", alignItems: "start" }}>
          <div>
            <ShotTimeline
              video={data.videoData}
              activeSegmentIndex={activeIdx}
              onSegmentSelect={(seg, idx) => setActiveIdx(idx)}
            />
          </div>
          <div className="video-hero-donut" style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 8 }}>
            <RenderStatsDonut video={data.videoData} />
          </div>
          <style>{`
            @media (max-width: 900px) {
              .video-hero-grid {
                grid-template-columns: minmax(0, 1fr) !important;
              }
              .video-hero-donut {
                justify-content: flex-start !important;
                padding-top: 0 !important;
              }
            }
          `}</style>
        </div>
      ) : null}
    </div>
  );
}

function ImageVariant({ urls }: { urls: string[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const url = urls[Math.min(activeIdx, urls.length - 1)];
  if (!url) return null;
  // Phase 4.2 Fix 4 — best-effort metadata. Real DALL-E render metadata
  // isn't routinely available in the artifact (size/style/seed need their
  // own pipeline plumbing — see PRODUCT QUESTIONS in the report). We show
  // the constants we know are true and skip what we can't verify.
  const metadataChips = [
    { label: "Engine", value: "DALL-E 3", color: "#0D9488" },
    { label: "Format", value: "PNG · Hi-res", color: "#7C3AED" },
    ...(urls.length > 1
      ? [{ label: "Variants", value: String(urls.length), color: "#0EA5E9" }]
      : []),
  ];
  return (
    <div>
      <div
        style={{
          position: "relative",
          background: "#FAFAF8",
          aspectRatio: "16 / 9",
          maxHeight: "min(60vh, 680px)",
          cursor: "zoom-in",
        }}
        onClick={() => setLightbox(url)}
      >
        <PhotoDevelop style={{ width: "100%", height: "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Render ${activeIdx + 1}`}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        </PhotoDevelop>
      </div>
      <div
        style={{
          padding: "20px 24px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#F0FDFA",
              color: "#0D9488",
            }}
          >
            <ImageIcon size={16} />
          </span>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#0D9488",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
              }}
            >
              Concept renders
            </div>
            <div style={{ fontSize: 13, color: "#4B5563", marginTop: 2 }}>
              {urls.length} {urls.length === 1 ? "render" : "renders"} ready · click to view fullsize
            </div>
            {/* Phase 4.2 Fix 4 — metadata cascade */}
            <MetadataCascade chips={metadataChips} />
          </div>
        </div>
        {urls.length > 1 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {urls.map((u, i) => (
              <button
                key={u}
                type="button"
                aria-label={`Show render ${i + 1}`}
                onClick={() => setActiveIdx(i)}
                style={{
                  width: 56,
                  height: 40,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: i === activeIdx ? "2px solid #0D9488" : "1px solid rgba(0,0,0,0.08)",
                  padding: 0,
                  background: "none",
                  cursor: "pointer",
                  opacity: i === activeIdx ? 1 : 0.7,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "clamp(16px, 4vw, 40px)",
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Full preview"
            style={{ maxWidth: "92vw", maxHeight: "88vh", objectFit: "contain", borderRadius: 8 }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

function FloorPlanInteractiveVariant({ model }: { model: FloorPlanInteractiveData }) {
  const summary = model.summary;
  // Phase 4.2 Fix 1 — defensive room extraction from heterogeneous roomSchedule
  const rooms = (model.roomSchedule ?? [])
    .map(r => {
      const name = typeof r.name === "string" ? r.name : typeof r.label === "string" ? r.label : "Room";
      const areaRaw = r.area ?? r.area_sqm ?? r.areaSqm;
      const area = typeof areaRaw === "number" ? areaRaw : parseFloat(String(areaRaw ?? ""));
      const type = typeof r.type === "string" ? r.type : undefined;
      return { name, area: Number.isFinite(area) ? area : 0, type };
    })
    .filter(r => r.area > 0);
  const totalArea = summary.totalArea_sqm > 0
    ? summary.totalArea_sqm
    : rooms.reduce((s, r) => s + r.area, 0);
  const showDonut = rooms.length >= 2 && totalArea > 0;

  const handleOpenFull = () => {
    try {
      sessionStorage.setItem("floorPlanProject", JSON.stringify(model.floorPlanProject));
    } catch {
      // unavailable
    }
    window.open("/dashboard/floor-plan?source=pipeline", "_blank", "noopener,noreferrer");
  };
  return (
    <div>
      {/* Phase 4.2 Fix 1 — hero block above the embedded editor: 2-col grid
          mirroring BoqVariant. Left: title + KPI tiles + room cascade.
          Right: RoomAreaDonut. Below: the dedicated FloorPlanViewer. */}
      <div style={{ padding: "32px clamp(24px, 4vw, 40px) 16px" }}>
        <div className="floorplan-hero-grid" style={{ display: "grid", gridTemplateColumns: showDonut ? "minmax(0, 1.3fr) minmax(0, 1fr)" : "minmax(0, 1fr)", gap: "clamp(20px, 3vw, 36px)", alignItems: "start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "#F0FDFA",
                  color: "#0D9488",
                }}
              >
                <PenTool size={16} />
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#0D9488",
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                }}
              >
                Interactive Floor Plan
              </span>
            </div>
            <h2
              style={{
                margin: 0,
                marginBottom: 16,
                fontSize: "clamp(22px, 3vw, 30px)",
                fontWeight: 700,
                color: "#0F172A",
                letterSpacing: "-0.01em",
              }}
            >
              {model.label}
            </h2>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 8 }}>
              <Stat label="Rooms" value={String(summary.totalRooms)} large />
              <Stat label="Built-up area" value={`${Math.round(totalArea).toLocaleString("en-IN")} m²`} large />
              <Stat label="Walls" value={String(summary.totalWalls)} large />
              {summary.totalDoors > 0 ? <Stat label="Doors" value={String(summary.totalDoors)} large /> : null}
              {summary.totalWindows > 0 ? <Stat label="Windows" value={String(summary.totalWindows)} large /> : null}
              {summary.floorCount > 1 ? <Stat label="Floors" value={String(summary.floorCount)} large /> : null}
            </div>
            <RoomScheduleCascade rooms={rooms} />
          </div>
          {showDonut ? (
            <div className="floorplan-hero-donut" style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 8 }}>
              <RoomAreaDonut rooms={rooms} totalArea={totalArea} />
            </div>
          ) : null}
        </div>
        <style>{`
          @media (max-width: 900px) {
            .floorplan-hero-grid {
              grid-template-columns: minmax(0, 1fr) !important;
            }
            .floorplan-hero-donut {
              justify-content: flex-start !important;
              padding-top: 0 !important;
            }
          }
        `}</style>
      </div>

      {/* Embedded dedicated viewer (preserved sacred component) */}
      <div style={{ height: "min(60vh, 640px)", minHeight: 420, background: "#FAFAF8" }}>
        <FloorPlanViewer initialProject={model.floorPlanProject} />
      </div>

      {/* Bottom CTA row */}
      <div
        style={{
          padding: "20px 24px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={handleOpenFull}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 10,
            background: "#0D9488",
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(13,148,136,0.18)",
          }}
        >
          <PenTool size={14} aria-hidden="true" />
          Open Floor Plan Editor
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function FloorPlanSvgVariant({ svgContent }: { svgContent: string }) {
  const sanitized = useMemo(
    () =>
      typeof window !== "undefined"
        ? DOMPurify.sanitize(svgContent, { USE_PROFILES: { svg: true, svgFilters: true } })
        : "",
    [svgContent],
  );
  const handleDownload = () => {
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "floor_plan.svg";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div
        style={{
          background: "#FAFAF8",
          padding: 32,
          minHeight: 420,
          maxHeight: "min(60vh, 720px)",
          overflow: "auto",
        }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
      <div style={{ padding: "20px 24px 24px", display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#F0FDFA",
              color: "#0D9488",
            }}
          >
            <LayoutGrid size={16} />
          </span>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#0D9488",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
              }}
            >
              Floor plan
            </div>
            <div style={{ fontSize: 13, color: "#4B5563", marginTop: 2 }}>
              SVG drawing — open below to inspect rooms or download.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 10,
            background: "#FFFFFF",
            border: "1px solid rgba(13,148,136,0.32)",
            color: "#0D9488",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Download size={14} aria-hidden="true" />
          Download SVG
        </button>
      </div>
    </div>
  );
}

function Model3DVariant({ data, model }: { data: ResultPageData; model: Model3DData }) {
  const ifcFile = data.fileDownloads.find(f => f.name.toLowerCase().endsWith(".ifc"));
  let title = "Explore your 3D model";
  let subtitle = "Orbit, walk through, and inspect every wall.";
  const stats: Array<{ label: string; value: string }> = [];
  if (model.kind === "procedural") {
    title = `${model.buildingType} · ${model.floors} floors`;
    subtitle = `${Math.round(model.gfa).toLocaleString("en-IN")} m² gross floor area · ${model.height}m height`;
    stats.push({ label: "Floors", value: String(model.floors) });
    stats.push({ label: "Height", value: `${model.height}m` });
    stats.push({ label: "Footprint", value: `${model.footprint.toLocaleString("en-IN")} m²` });
    stats.push({ label: "GFA", value: `${Math.round(model.gfa).toLocaleString("en-IN")} m²` });
  } else if (model.kind === "glb") {
    title = "Photo-real 3D model";
    if (model.polycount) subtitle = `${model.polycount.toLocaleString("en-IN")} polygons · GLB ready`;
    if (model.polycount) stats.push({ label: "Polygons", value: model.polycount.toLocaleString("en-IN") });
    if (model.topology) stats.push({ label: "Topology", value: model.topology });
  } else if (model.kind === "html-iframe") {
    title = model.label;
    if (model.roomCount) {
      subtitle = `${model.roomCount} rooms · ${model.wallCount ?? "—"} walls`;
      stats.push({ label: "Rooms", value: String(model.roomCount) });
      if (model.wallCount) stats.push({ label: "Walls", value: String(model.wallCount) });
    }
  } else if (model.kind === "floor-plan-editor") {
    title = "2D Editor + 3D Preview";
    if (model.roomCount) stats.push({ label: "Rooms", value: String(model.roomCount) });
    if (model.wallCount) stats.push({ label: "Walls", value: String(model.wallCount) });
  }

  return (
    <div style={{ padding: "32px clamp(24px, 4vw, 40px)", position: "relative" }}>
      {/* Phase 4 signature · isometric wireframe draws itself, then sits as ambient backdrop */}
      <IsometricBuilding color="#0D9488" ambientOpacity={0.10} width={300} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22, position: "relative" }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "#F0FDFA",
            color: "#0D9488",
            flexShrink: 0,
          }}
        >
          <Box size={26} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#0D9488",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            3D Model
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 700,
              color: "#111827",
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          <p style={{ margin: 0, marginTop: 6, fontSize: 14, color: "#4B5563" }}>{subtitle}</p>
        </div>
      </div>

      {stats.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
            marginBottom: 24,
          }}
        >
          {stats.map(s => (
            <div
              key={s.label}
              style={{
                background: "#FAFAF8",
                border: "1px solid rgba(0,0,0,0.06)",
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#6B7280",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#111827",
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 4,
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Phase 4.2 Fix 2 — IFC signature theater: cascade + donut when an
          IFC artifact is present. The existing IsometricBuilding wireframe
          stays as ambient watermark in the corner. */}
      {ifcFile && __extractIfcCategories(data).length > 0 ? (
        <div className="ifc-hero-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "clamp(20px, 3vw, 36px)", alignItems: "start", marginBottom: 24, position: "relative" }}>
          <div>
            <ElementCategoryCascade data={data} />
          </div>
          <div className="ifc-hero-donut" style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 8 }}>
            <ElementDistributionDonut data={data} />
          </div>
          <style>{`
            @media (max-width: 900px) {
              .ifc-hero-grid {
                grid-template-columns: minmax(0, 1fr) !important;
              }
              .ifc-hero-donut {
                justify-content: flex-start !important;
                padding-top: 0 !important;
              }
            }
          `}</style>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {ifcFile ? (
          <a
            href={`/dashboard/ifc-viewer?executionId=${data.executionId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 20px",
              borderRadius: 12,
              background: "#0D9488",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
              boxShadow: "0 2px 6px rgba(13,148,136,0.18)",
            }}
          >
            <ExternalLink size={15} aria-hidden="true" />
            Open in IFC Viewer
            <ArrowRight size={15} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function BoqVariant({ data }: { data: ResultPageData }) {
  const boq = data.boqSummary;
  if (!boq) return null;
  const previewTable =
    data.tableData.find(
      t =>
        t.label?.toLowerCase().includes("bill of quantities") ||
        t.label?.toLowerCase().includes("boq"),
    ) ?? data.tableData[0];
  const previewRows = previewTable?.rows.slice(0, 4) ?? [];
  const totalCost = boq.totalCost;
  const costPerM2 = boq.gfa > 0 ? totalCost / boq.gfa : 0;
  return (
    <div style={{ padding: "32px clamp(24px, 4vw, 40px)" }}>
      {/* Phase 4.1 Fix 2 — left column (KPI + chips + stats) | right column (donut viz) */}
      <div className="boq-hero-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "clamp(20px, 3vw, 36px)", alignItems: "start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 10,
                background: "#F0FDFA",
                color: "#0D9488",
              }}
            >
              <Calculator size={16} />
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#0D9488",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
              }}
            >
              Total Project Cost
            </span>
          </div>
          <div
            style={{
              fontSize: "clamp(40px, 7vw, 88px)",
              fontWeight: 700,
              color: "#0D9488",
              letterSpacing: "-0.025em",
              fontVariantNumeric: "tabular-nums",
              fontFeatureSettings: "'tnum', 'ss01', 'cv11'",
              lineHeight: 0.96,
              marginBottom: 4,
            }}
          >
            <AnimatedNumber value={totalCost} formatter={(n: number) => formatINR(n)} duration={1600} />
          </div>
          {/* Dimension-line callout — drawn in left-to-right after the cost number lands. */}
          <div style={{ maxWidth: 360, marginBottom: 4 }}>
            <DimensionLine color="#0D9488" delay={1.6} duration={0.6} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <MonoLabel size={10} color="#94A3B8">Total Project</MonoLabel>
              <MonoLabel size={10} color="#94A3B8">Estimate · ±15%</MonoLabel>
            </div>
          </div>

          {/* Phase 4.1 Fix 1 · material chips cascade with halo + connecting line */}
          <MaterialChipsCascade totalCost={boq.totalCost} />
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24, marginTop: 4 }}>
            {boq.gfa > 0 ? <Stat label="Built-up area" value={`${Math.round(boq.gfa).toLocaleString("en-IN")} m²`} large /> : null}
            {costPerM2 > 0 ? (
              <Stat
                label="Cost / m²"
                value={`₹${costPerM2.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                large
              />
            ) : null}
            <Stat label="Region" value={normalizeRegion(boq.region)} large />
          </div>
        </div>

        {/* Right column · live cost breakdown donut */}
        <div className="boq-hero-donut" style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 8 }}>
          <LiveCostBreakdownDonut totalCost={boq.totalCost} />
        </div>
      </div>
      <style>{`
        @media (max-width: 900px) {
          .boq-hero-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .boq-hero-donut {
            justify-content: flex-start !important;
            padding-top: 0 !important;
          }
        }
      `}</style>

      {previewRows.length > 0 && previewTable ? (
        <div
          style={{
            background: "#FAFAF8",
            border: "1px solid rgba(0,0,0,0.06)",
            borderRadius: 14,
            overflow: "hidden",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#FFFFFF",
            }}
          >
            <span style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              BOQ preview · first {previewRows.length} of {previewTable.rows.length} lines
            </span>
            <span style={{ fontSize: 11, color: "#0D9488", fontWeight: 600 }}>Open visualizer for full table</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#4B5563" }}>
              <thead>
                <tr>
                  {previewTable.headers.slice(0, 5).map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: "10px 14px",
                        textAlign: i === previewTable.headers.length - 1 ? "right" : "left",
                        fontWeight: 600,
                        color: "#6B7280",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        background: "#F9FAFB",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "#FFFFFF" : "#FAFAF8" }}>
                    {row.slice(0, 5).map((cell, ci) => (
                      <td
                        key={ci}
                        style={{
                          padding: "10px 14px",
                          borderTop: "1px solid rgba(0,0,0,0.04)",
                          textAlign: ci === row.length - 1 ? "right" : "left",
                          whiteSpace: "nowrap",
                          color: "#111827",
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <a
        href={`/dashboard/results/${boq.executionId}/boq`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 22px",
          borderRadius: 14,
          background: "#0D9488",
          color: "#FFFFFF",
          fontSize: 15,
          fontWeight: 600,
          textDecoration: "none",
          boxShadow: "0 4px 14px rgba(13,148,136,0.22)",
        }}
      >
        <Calculator size={16} aria-hidden="true" />
        Open BOQ Visualizer
        <ArrowRight size={16} aria-hidden="true" />
      </a>
    </div>
  );
}

function ClashVariant({ summary }: { summary: ClashSummary }) {
  const reduce = useReducedMotion();
  const hasClashes = summary.total > 0;
  return (
    <div style={{ padding: "32px clamp(24px, 4vw, 40px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 10,
            background: "#FEF3C7",
            color: "#D97706",
          }}
        >
          <Building2 size={16} />
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#D97706",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
          }}
        >
          Clash detection
        </span>
      </div>
      <h2
        style={{
          margin: 0,
          marginBottom: 16,
          fontSize: "clamp(22px, 2.6vw, 28px)",
          fontWeight: 700,
          color: "#111827",
        }}
      >
        {hasClashes ? "Conflicts to coordinate" : "No clashes detected"}
      </h2>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <span
          style={{
            fontSize: "clamp(48px, 8vw, 96px)",
            fontWeight: 700,
            color: "#D97706",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.03em",
            lineHeight: 0.92,
          }}
        >
          {reduce ? summary.total : <AnimatedNumber value={summary.total} duration={900} />}
        </span>
        <span style={{ fontSize: 14, color: "#6B7280", paddingBottom: 8 }}>
          total {summary.total === 1 ? "clash" : "clashes"} detected
        </span>
      </div>
      {hasClashes ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SeverityChip label="Critical" count={summary.critical} bg="#FEE2E2" color="#DC2626" />
          <SeverityChip label="Major" count={summary.major} bg="#FEF3C7" color="#D97706" />
          <SeverityChip label="Minor" count={summary.minor} bg="#FFFBEB" color="#A16207" />
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>
          The clash report is included in the Data section below for review.
        </p>
      )}
    </div>
  );
}

function TableVariant({ data }: { data: ResultPageData }) {
  const t = data.tableData[0];
  if (!t) return null;
  return (
    <div style={{ padding: "32px clamp(24px, 4vw, 40px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 10,
            background: "#EFF6FF",
            color: "#1E40AF",
          }}
        >
          <LayoutGrid size={16} />
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#1E40AF",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
          }}
        >
          {t.label ?? "Tabular data"}
        </span>
      </div>
      <h2
        style={{
          margin: 0,
          marginBottom: 16,
          fontSize: "clamp(22px, 2.6vw, 28px)",
          fontWeight: 700,
          color: "#111827",
        }}
      >
        {t.rows.length} rows ready
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: "#4B5563", lineHeight: 1.55 }}>
        Open the Data section below to browse the full table or export to CSV.
      </p>
    </div>
  );
}

function TextVariant({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const preview = lines.slice(0, 8).join("\n");
  const hasMore = lines.length > 8;
  return (
    <div style={{ padding: "32px clamp(24px, 4vw, 40px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 10,
            background: "#F0FDFA",
            color: "#0D9488",
          }}
        >
          <PenTool size={16} />
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#0D9488",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
          }}
        >
          Project brief
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 15,
          color: "#111827",
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
        }}
      >
        {expanded ? text : preview}
        {hasMore ? (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginLeft: 8,
              padding: 0,
              background: "none",
              border: "none",
              color: "#0D9488",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {expanded ? "Show less" : `Show ${lines.length - 8} more lines`}
          </button>
        ) : null}
      </p>
    </div>
  );
}

function GenericVariant({ data }: { data: ResultPageData }) {
  return (
    <div style={{ padding: "32px clamp(24px, 4vw, 40px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 10,
            background: "#F3F4F6",
            color: "#4B5563",
          }}
        >
          <Maximize2 size={16} />
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#4B5563",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
          }}
        >
          Run complete
        </span>
      </div>
      <h2
        style={{
          margin: 0,
          marginBottom: 6,
          fontSize: "clamp(22px, 2.6vw, 28px)",
          fontWeight: 700,
          color: "#111827",
        }}
      >
        {data.projectTitle}
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: "#4B5563", lineHeight: 1.6 }}>
        {data.totalArtifacts > 0
          ? `${data.totalArtifacts} artifact${data.totalArtifacts === 1 ? "" : "s"} produced. Scroll for details.`
          : "Workflow finished. Open the diagnostics panel for the full execution trace."}
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function PreviewSkeleton({ label }: { label: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#9CA3AF",
        fontSize: 13,
        background: "#FAFAF8",
      }}
    >
      {label}
    </div>
  );
}

function Stat({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#6B7280",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: large ? 18 : 13,
          fontWeight: large ? 700 : 600,
          color: "#111827",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SeverityChip({ label, count, bg, color }: { label: string; count: number; bg: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 9999,
        background: bg,
        color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{count}</span>
      <span style={{ letterSpacing: "0.04em" }}>{label}</span>
    </span>
  );
}
