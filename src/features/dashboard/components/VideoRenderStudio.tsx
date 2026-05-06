"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import Link from "next/link";
import {
  Upload,
  ArrowRight,
  RotateCcw,
  Download,
  ChevronRight,
  Eye,
  Check,
  MoveHorizontal,
  PenTool,
  Share2,
  Film,
  AlertTriangle,
} from "lucide-react";
import s from "./VideoRenderStudio.module.css";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type WizardStep = "upload" | "processing" | "gallery" | "video";

/** Which video pipeline the user is running. */
type VideoMode = "quick" | "cinematic";

interface RenderResult {
  id: string;
  label: string;
  angle: string;
  apiAngle: string;
  url: string | null;
}

// Mirror of StructuralAnalysisSchema in /api/generate-3d-render. Only the
// fields the client actually consumes are listed here; extras are ignored.
interface StructuralAnalysis {
  buildingType: "residential" | "commercial" | "mixed-use" | "industrial" | "other";
  roomCount: number;
  rooms: string[];
  footprint: "rectangle" | "L-shape" | "U-shape" | "irregular";
  openingsVisible: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CINEMATIC PIPELINE TYPES (mirror /api/cinematic-status response)
// ═══════════════════════════════════════════════════════════════════════════════

type CinematicStageStatus =
  | "pending"
  | "preparing"
  | "submitted"
  | "processing"
  | "complete"
  | "failed";

interface CinematicStageView {
  name: string;
  status: CinematicStageStatus;
  videoUrl?: string;
  imageUrl?: string;
  error?: string;
  durationSeconds?: number;
}

interface CinematicStatusResponse {
  pipelineId: string;
  pipelineStatus: "processing" | "complete" | "partial" | "failed";
  progress: number;
  currentStage: "overview" | "transition" | "lifestyle" | "stitch" | "complete";
  statusMessage: string;
  stages: {
    overview: CinematicStageView;
    transition: CinematicStageView;
    lifestyle: CinematicStageView;
    stitch: CinematicStageView;
  };
  finalVideoUrl?: string;
  durationSeconds?: number;
  pipeline: "cinematic-multi-stage";
}

/** Stage labels for the cinematic indicator. */
const CINEMATIC_STAGE_LABELS: Record<
  "overview" | "transition" | "lifestyle" | "stitch",
  { label: string; subtitle: string }
> = {
  overview: { label: "Overview", subtitle: "Aerial orbit" },
  transition: { label: "Transition", subtitle: "Descent" },
  lifestyle: { label: "Lifestyle", subtitle: "Interior scene" },
  stitch: { label: "Final Cut", subtitle: "Crossfade & grade" },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COPY
// ═══════════════════════════════════════════════════════════════════════════════

// Full-layout slot is pinned at id "r4" because the cinematic walkthrough
// pipeline (startCinematicGeneration) selects it by id. Do not re-id.
const FULL_LAYOUT_VIEW: Omit<RenderResult, "url"> = {
  id: "r4",
  label: "Full Layout",
  angle: "Top Down",
  apiAngle: "topDown",
};

// Status messages cycled during video generation.
const VIDEO_STATUS_MESSAGES = [
  "Submitting to Kling AI render pipeline...",
  "Generating exterior cinematic sweep...",
  "Building depth map from floor plan geometry...",
  "Rendering interior walkthrough — room by room...",
  "Adding architectural-grade lighting and materials...",
  "Compositing exterior and interior segments...",
  "Arranging furniture placement and soft furnishings...",
  "Stitching final cut with crossfade transitions...",
  "Color grading and final polish in progress.",
];

// Pipeline stages for the render processing view.
const PIPELINE_STAGES = [
  { label: "Floor plan ingested", desc: "Image received and validated", activeAt: 0, doneAt: 10 },
  { label: "Structure detected", desc: "Walls, doors, windows identified", activeAt: 10, doneAt: 30 },
  { label: "Rooms classified", desc: "Room types and adjacency mapped", activeAt: 30, doneAt: 50 },
  { label: "Generating top-down render", desc: "Photorealistic 3D synthesis", activeAt: 50, doneAt: 80 },
  { label: "Per-room cameras", desc: "Interior camera angles computed", activeAt: 80, doneAt: 95 },
  { label: "Final pass", desc: "Quality check and output packaging", activeAt: 95, doneAt: 100 },
];

// Room color palette for gallery thumbnails.
const ROOM_COLORS: Record<string, string> = {
  kitchen: "linear-gradient(135deg, #E8DCC8, #D4C4A8)",
  living: "linear-gradient(135deg, #C8D4C0, #B0C4A0)",
  bedroom: "linear-gradient(135deg, #E8E0D4, #D8D0C4)",
  bath: "linear-gradient(135deg, #C8D4D8, #B8C8D0)",
  hallway: "linear-gradient(135deg, #DCD4C4, #CCC4B4)",
  default: "linear-gradient(135deg, #E0DCD4, #D0C8C0)",
};

function getRoomColor(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(ROOM_COLORS)) {
    if (lower.includes(key)) return val;
  }
  return ROOM_COLORS.default;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPARISON SLIDER
// ═══════════════════════════════════════════════════════════════════════════════

function ComparisonSlider({
  beforeSrc,
  afterSrc,
  fullWidth = false,
}: {
  beforeSrc: string | null;
  afterSrc: string | null;
  /**
   * When true, the slider fills its parent container's width instead of
   * capping at `max-w-3xl`, and the after-image always uses `object-cover`
   * so the render fills the frame instead of letterboxing when its aspect
   * ratio differs from the uploaded plan. Used on the gallery step where
   * the Full Layout render is the hero of the screen.
   */
  fullWidth?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  // True natural aspect ratio of the BEFORE image — NO CLAMPING.
  // Updated by the <img> onLoad handler below. Any shape (triangle,
  // L-shape, U-shape, panorama, tall portrait) sizes the container to its
  // own ratio.
  const [imageAspect, setImageAspect] = useState<number>(4 / 3);
  // Natural aspect ratio of the AFTER (3D render) image. Used to decide
  // whether the AFTER image should `object-cover` (filling the container,
  // matching BEFORE size) or fall back to `object-contain` (letterboxed)
  // when the ratio mismatch is too large to crop safely.
  const [afterAspect, setAfterAspect] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on src clear
    if (!beforeSrc) setImageAspect(4 / 3);
  }, [beforeSrc]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on src clear
    if (!afterSrc) setAfterAspect(null);
  }, [afterSrc]);

  // Decide AFTER image fit. If the rendered output ratio is within ±20% of
  // the floor plan ratio, use `cover` so the AFTER fills the container at
  // the same scale as BEFORE (cropping a thin band of empty render edge).
  // Beyond 20%, fall back to `contain` so we don't crop the actual building.
  //
  // `fullWidth` (gallery step) always uses `contain`: fidelity to the generated
  // render is the whole point of this feature, so the entire render must be
  // visible edge-to-edge even if its aspect ratio differs from the frame. Thin
  // gray bars on one axis are acceptable; hiding part of the render is not.
  const afterFit: "cover" | "contain" = (() => {
    if (fullWidth) return "contain";
    if (!afterAspect || imageAspect <= 0) return "contain";
    const diff = Math.abs(afterAspect - imageAspect) / imageAspect;
    return diff < 0.2 ? "cover" : "contain";
  })();

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pct);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      handleMove("touches" in e ? e.touches[0].clientX : e.clientX);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDragging, handleMove]);

  // Auto-reveal animation on first load
  const [hasRevealed, setHasRevealed] = useState(false);
  useEffect(() => {
    if (hasRevealed || (!beforeSrc && !afterSrc)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time reveal flag
    setHasRevealed(true);
    let frame: number;
    let start: number | null = null;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      if (elapsed < 1200) {
        setSliderPos(5 + (45 * elapsed) / 1200);
        frame = requestAnimationFrame(animate);
      } else {
        setSliderPos(50);
      }
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [beforeSrc, afterSrc, hasRevealed]);

  return (
    <div className={fullWidth ? "w-full" : "w-full max-w-3xl mx-auto"}>
      <div className={s.compareWrap}>
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden select-none"
          style={{
            aspectRatio: imageAspect,
            maxHeight: fullWidth ? "min(90vh, 1100px)" : "min(70vh, 600px)",
            minHeight: "240px",
            width: "100%",
            background: "var(--rs-bone)",
            cursor: isDragging ? "grabbing" : "ew-resize",
          }}
          onMouseDown={(e) => { setIsDragging(true); handleMove(e.clientX); }}
          onTouchStart={(e) => { setIsDragging(true); handleMove(e.touches[0].clientX); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setSliderPos((p) => Math.max(5, p - 2));
            if (e.key === "ArrowRight") setSliderPos((p) => Math.min(95, p + 2));
          }}
          tabIndex={0}
          role="slider"
          aria-label="Before/After comparison slider"
          aria-valuemin={5}
          aria-valuemax={95}
          aria-valuenow={Math.round(sliderPos)}
        >
          {/* BEFORE */}
          <div className="absolute inset-0" style={{ background: "var(--rs-bone)" }}>
            {beforeSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={beforeSrc}
                alt="2D Floor Plan"
                className="w-full h-full object-contain"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setImageAspect(img.naturalWidth / img.naturalHeight);
                  }
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--rs-bone)" }}>
                <div className="text-center" style={{ color: "var(--rs-text-mute)" }}>
                  <Upload size={36} style={{ margin: "0 auto 8px", opacity: 0.3 }} aria-hidden="true" />
                  <p style={{ fontSize: 11, fontFamily: "var(--font-jetbrains, monospace)" }}>Floor Plan</p>
                </div>
              </div>
            )}
          </div>

          {/* AFTER */}
          <div className="absolute inset-0" style={{ background: "var(--rs-bone)", clipPath: `inset(0 0 0 ${sliderPos}%)` }}>
            {afterSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={afterSrc}
                alt="3D Render"
                className="w-full h-full"
                style={{ objectFit: afterFit }}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setAfterAspect(img.naturalWidth / img.naturalHeight);
                  }
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--rs-paper)" }}>
                <div className="text-center" style={{ color: "var(--rs-text-mute)" }}>
                  <Film size={36} style={{ margin: "0 auto 8px", opacity: 0.3 }} aria-hidden="true" />
                  <p style={{ fontSize: 11, fontFamily: "var(--font-jetbrains, monospace)" }}>Photoreal Render</p>
                </div>
              </div>
            )}
          </div>

          {/* Slider line + handle */}
          <div className={s.compareHandle} style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}>
            <div className="absolute inset-y-0 w-[2px]" style={{ left: "50%", transform: "translateX(-50%)", background: "var(--rs-paper)", boxShadow: "0 0 8px rgba(0,0,0,0.15)" }} />
            <div
              className={s.compareKnob}
              style={{ touchAction: "none" }}
            >
              <MoveHorizontal size={18} aria-hidden="true" />
            </div>
          </div>

          {/* Corner labels */}
          <div className={s.cornerTagBefore}>FLOOR PLAN</div>
          <div className={s.cornerTagAfter}>
            <span className={s.cornerTagDot} />
            PHOTOREAL · 4K
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD ZONE
// ═══════════════════════════════════════════════════════════════════════════════

function UploadZone({
  onFileSelect,
  uploadedFile,
  previewUrl,
}: {
  onFileSelect: (file: File) => void;
  uploadedFile: File | null;
  previewUrl: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) onFileSelect(file);
  }, [onFileSelect]);

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      {!uploadedFile ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div
            className={s.drop}
            data-drag={dragOver ? "true" : undefined}
          >
            <div className={s.dropIcon}>
              <Upload aria-hidden="true" />
            </div>
            <div className={s.dropTitle}>
              {dragOver ? "Release to upload" : "Drop a floor plan"}
            </div>
            <p className={s.dropSub}>
              PDF, PNG, JPG, or WEBP — up to 10 MB. We handle metric or imperial dimensions, residential or commercial.
            </p>
            <div className={s.dropFormats}>
              <span>PDF</span>
              <span className={s.dropFormatDot} />
              <span>PNG</span>
              <span className={s.dropFormatDot} />
              <span>JPG</span>
              <span className={s.dropFormatDot} />
              <span>WEBP</span>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(f); }}
          />
        </div>
      ) : (
        <div className={s.dropPreview}>
          {previewUrl && (
            <div className="relative" style={{ padding: 12, background: "var(--rs-bone)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Uploaded floor plan" style={{ width: "100%", borderRadius: 10, maxHeight: 320, objectFit: "contain" }} />
              <div className={s.dropPreviewBadge}>
                <Check size={10} aria-hidden="true" /> Uploaded
              </div>
            </div>
          )}
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--rs-rule)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--rs-ink-soft)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{uploadedFile.name}</span>
            <span style={{ fontSize: 11, color: "var(--rs-text-mute)", fontFamily: "var(--font-jetbrains, monospace)" }}>{(uploadedFile.size / 1024 / 1024).toFixed(1)} MB</span>
          </div>
        </div>
      )}

      {/* OR divider */}
      <div className={s.orDivider}>
        <div className={s.orDividerLine} />
        <span className={s.orDividerText}>or</span>
        <div className={s.orDividerLine} />
      </div>

      {/* Generate floor plan link */}
      <Link href="/dashboard/floor-plan" style={{ textDecoration: "none" }}>
        <div className={s.altCard}>
          <div className={s.altCardIcon}>
            <PenTool aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--rs-ink)", margin: 0 }}>
              Generate a floor plan with AI
            </p>
            <p style={{ fontSize: 12, color: "var(--rs-text)", margin: "3px 0 0" }}>
              Describe your project in plain text. We&apos;ll draft a 2D plan you can render in one click.
            </p>
          </div>
          <ChevronRight size={16} className={s.altCardArrow} aria-hidden="true" />
        </div>
      </Link>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESSING VIEW (pipeline feed — right column)
// ═══════════════════════════════════════════════════════════════════════════════

function ProcessingView({ progress }: { progress: number }) {
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStageIdx((prev) => (prev + 1) % PIPELINE_STAGES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  // stageIdx kept for interval parity; stage activation driven by progress thresholds
  void stageIdx;

  return (
    <div className={s.feed}>
      <div className={s.feedHead}>
        <span className={s.feedTitle}>Pipeline</span>
        <span className={s.feedPct}>{Math.round(progress)}%</span>
      </div>
      <div className={s.progressTrack}>
        <div className={s.progressFill} style={{ width: `${progress}%` }} />
      </div>
      {PIPELINE_STAGES.map((stage, i) => {
        const status = progress >= stage.doneAt ? "done" : progress >= stage.activeAt ? "active" : "pending";
        return (
          <div key={i} className={s.stageItem} style={{ animationDelay: `${i * 0.08}s` }}>
            <div className={s.stageMark} data-status={status}>
              {status === "done" && <Check size={10} color="#fff" strokeWidth={3} aria-hidden="true" />}
              {status === "active" && <div className={s.blinkDot} style={{ width: 6, height: 6 }} />}
            </div>
            <div className={s.stageBody}>
              <div className={s.stageTitle} data-status={status}>{stage.label}</div>
              {stage.desc && <div className={s.stageDesc}>{stage.desc}</div>}
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <span style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 10, color: "var(--rs-text-mute)" }}>
          {mins}:{secs.toString().padStart(2, "0")} elapsed
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CINEMATIC STAGE INDICATOR
// ═══════════════════════════════════════════════════════════════════════════════

function CinematicStagePreview({
  stage,
  isActive,
  isPast,
}: {
  stage: CinematicStageView;
  isActive: boolean;
  isPast: boolean;
}) {
  const meta = CINEMATIC_STAGE_LABELS[stage.name as keyof typeof CINEMATIC_STAGE_LABELS];
  const failed = stage.status === "failed";
  const complete = stage.status === "complete";
  const inProgress =
    stage.status === "preparing" ||
    stage.status === "submitted" ||
    stage.status === "processing";

  const tileState = failed ? "failed" : (complete || isPast) ? "done" : isActive ? "active" : "pending";

  return (
    <div className={s.cinematicTile} data-state={tileState}>
      <div className={s.cinematicTilePreview}>
        {stage.videoUrl ? (
          <video
            src={stage.videoUrl}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
            style={{ background: "#000" }}
          />
        ) : stage.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stage.imageUrl}
            alt={`${meta?.label ?? "Stage"} preview`}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {inProgress ? (
              <span style={{ fontSize: 9, fontFamily: "var(--font-jetbrains, monospace)", color: "var(--rs-ember)", animation: "pulse 1.6s ease-in-out infinite" }}>
                rendering...
              </span>
            ) : failed ? (
              <span style={{ fontSize: 9, fontFamily: "var(--font-jetbrains, monospace)", color: "#ef4444" }}>failed</span>
            ) : (
              <span style={{ fontSize: 9, fontFamily: "var(--font-jetbrains, monospace)", color: "var(--rs-dim-2)" }}>queued</span>
            )}
          </div>
        )}
      </div>

      <div className={s.cinematicTileFooter}>
        <div
          className={s.cinematicTileMark}
          style={{
            background: failed ? "#dc2626" : complete ? "var(--rs-sage)" : inProgress ? "var(--rs-blueprint)" : "var(--rs-rule-strong)",
          }}
        >
          {failed ? (
            <AlertTriangle size={9} color="#fff" strokeWidth={3} aria-hidden="true" />
          ) : complete ? (
            <Check size={9} color="#fff" strokeWidth={3} aria-hidden="true" />
          ) : inProgress ? (
            <div className={s.blinkDot} style={{ width: 4, height: 4, background: "#fff" }} />
          ) : null}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className={s.cinematicTileName} style={{ color: isActive ? "var(--rs-blueprint)" : complete ? "var(--rs-sage)" : failed ? "#dc2626" : "var(--rs-ink-soft)" }}>
            {meta?.label ?? stage.name}
          </p>
          <p className={s.cinematicTileSub}>
            {failed ? (stage.error ?? "Failed") : meta?.subtitle ?? ""}
            {stage.durationSeconds && complete ? ` · ${stage.durationSeconds}s` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function CinematicStageIndicator({
  status,
  elapsed,
}: {
  status: CinematicStatusResponse;
  elapsed: number;
}) {
  const stageOrder = ["overview", "transition", "lifestyle", "stitch"] as const;
  const currentIdx = stageOrder.indexOf(
    status.currentStage === "complete"
      ? "stitch"
      : (status.currentStage as (typeof stageOrder)[number]),
  );

  const elapsedMins = Math.floor(elapsed / 60);
  const elapsedSecs = elapsed % 60;
  const elapsedLabel = `${elapsedMins}:${elapsedSecs.toString().padStart(2, "0")}`;

  return (
    <div className={s.cinematicIndicator}>
      <div className={s.cinematicHeader}>
        <div className={s.cinematicHeaderLeft}>
          <Film size={14} style={{ color: "var(--rs-blueprint)", flexShrink: 0 }} aria-hidden="true" />
          <p className={s.cinematicHeaderMsg}>{status.statusMessage}</p>
        </div>
        <span className={s.cinematicHeaderTime}>
          {elapsedLabel} · {Math.round(status.progress)}%
        </span>
      </div>

      <div className={s.cinematicProgress}>
        <div
          className={s.cinematicProgressFill}
          style={{ width: `${Math.max(2, status.progress)}%` }}
        />
      </div>

      <div className={s.cinematicStages}>
        {stageOrder.map((stageName, idx) => (
          <CinematicStagePreview
            key={stageName}
            stage={status.stages[stageName]}
            isActive={idx === currentIdx}
            isPast={idx < currentIdx}
          />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function VideoSection({
  mode,
  videoProgress,
  videoReady,
  videoUrl,
  videoStatusText,
  videoError,
  videoElapsed,
  isSharing,
  cinematicStatus,
  cinematicElapsed,
  onGenerate,
  onGenerateCinematic,
  onDownload,
  onPreview,
  onShare,
  onRetry,
  onDownload4K,
  videoRef,
}: {
  mode: VideoMode | null;
  videoProgress: number;
  videoReady: boolean;
  videoUrl: string | null;
  videoStatusText: string;
  videoError: string | null;
  videoElapsed: number;
  isSharing: boolean;
  cinematicStatus: CinematicStatusResponse | null;
  cinematicElapsed: number;
  onGenerate: () => void;
  onGenerateCinematic: () => void;
  onDownload: () => void;
  onPreview: () => void;
  onShare: () => void;
  onRetry: () => void;
  onDownload4K: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const elapsedMins = Math.floor(videoElapsed / 60);
  const elapsedSecs = videoElapsed % 60;
  const elapsedLabel = `${elapsedMins}:${elapsedSecs.toString().padStart(2, "0")}`;

  const showCinematicIndicator =
    mode === "cinematic" && cinematicStatus !== null;
  const cinematicPartial =
    cinematicStatus?.pipelineStatus === "partial";

  return (
    <div style={{ marginTop: 32 }}>
      {/* Mode selection — shown before generation starts */}
      {!videoReady && videoProgress === 0 && !videoError && (
        <div className={s.modes}>
          {/* Quick card */}
          <div className={s.mode}>
            <div className={s.modeTag}>
              <span className={s.modeTagPillStd}>Quick</span>
              <span className={s.modeTagTime}>15s · 1080p</span>
            </div>
            <h4 className={s.modeH4}>Preview reel</h4>
            <p className={s.modeDesc}>
              Two segments — a slow exterior orbit followed by an interior approach. Best for quick client checks and internal reviews.
            </p>
            <div className={s.modeReel}>
              <div className={s.modeReelBar}>
                <span className={s.modeReelDot} />
                <span className={s.modeReelDot} />
                <span className={s.modeReelDot} />
              </div>
              <div className={s.modeReelFrames}>
                <div className={s.modeReelFrame} />
                <div className={s.modeReelFrame} />
                <div className={s.modeReelFrame} />
                <div className={s.modeReelFrame} />
              </div>
            </div>
            <div className={s.modeMeta}>
              <span className={s.modePrice}>$1.20 / render</span>
              <span className={s.modeBest}>Best for internal review</span>
            </div>
            <button className={s.modeGoStd} onClick={onGenerate}>
              Generate preview <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>

          {/* Cinematic card */}
          <div className={`${s.mode} ${s.modeFeatured}`}>
            <div className={s.modeTag}>
              <span className={s.modeTagPillFeatured}>Cinematic</span>
              <span className={s.modeTagTime}>24s · 4K</span>
            </div>
            <h4 className={s.modeH4}>Full presentation</h4>
            <p className={s.modeDesc}>
              Three orchestrated segments with motion grading and atmospheric lighting. Built for sales decks, listings, and pitch screens.
            </p>
            <div className={s.modeReel}>
              <div className={s.modeReelBar}>
                <span className={s.modeReelDot} />
                <span className={s.modeReelDot} />
                <span className={s.modeReelDot} />
              </div>
              <div className={s.modeReelFrames}>
                <div className={s.modeReelFrame} />
                <div className={s.modeReelFrame} />
                <div className={s.modeReelFrame} />
                <div className={s.modeReelFrame} />
              </div>
            </div>
            <div className={s.modeMeta}>
              <span className={s.modePrice}>$2.54 / render</span>
              <span className={s.modeBest}>Best for client decks</span>
            </div>
            <button className={s.modeGoFeatured} onClick={onGenerateCinematic}>
              Generate cinematic <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Cinematic stage indicator */}
      {showCinematicIndicator && cinematicStatus && (
        <CinematicStageIndicator
          status={cinematicStatus}
          elapsed={cinematicElapsed}
        />
      )}

      {cinematicPartial && (
        <div className={s.partialWarn}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: "#92400e" }} aria-hidden="true" />
          <span>
            We delivered a partial cinematic walkthrough — some stages couldn&apos;t be
            completed but the rest are stitched into your final video below.
          </span>
        </div>
      )}

      {/* Player shell */}
      <div className={s.playerShell}>
        <div className={s.playerScreen}>
          {videoError ? (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="text-center" style={{ maxWidth: 360 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <AlertTriangle size={20} style={{ color: "#ef4444" }} aria-hidden="true" />
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--rs-cream)", marginBottom: 4 }}>Video generation failed</p>
                <p style={{ fontSize: 11, color: "var(--rs-dim)", fontStyle: "italic", wordBreak: "break-word" }}>{videoError}</p>
              </div>
            </div>
          ) : videoReady && videoUrl ? (
            <>
              <div className={s.playerOverlay}>
                <span className={s.playerOverlayDot} />
                {mode === "cinematic" ? "Cinematic · 24s · 4K" : "Preview · 15s · 1080p"}
              </div>
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                autoPlay
                muted
                playsInline
                crossOrigin="anonymous"
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "cover", background: "#000" }}
              />
            </>
          ) : videoProgress > 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div style={{ width: "60%", maxWidth: 360 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--rs-dim)", marginBottom: 8, fontWeight: 500 }}>
                  <span>Rendering walkthrough</span>
                  <span style={{ fontFamily: "var(--font-jetbrains, monospace)" }}>{elapsedLabel} · {Math.round(videoProgress)}%</span>
                </div>
                <div style={{ height: 3, background: "var(--rs-rule-d)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2, background: "linear-gradient(90deg, var(--rs-ember), var(--rs-ember-2))", width: `${videoProgress}%`, transition: "width 0.6s ease-out" }} />
                </div>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={videoStatusText}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.35 }}
                    style={{ fontSize: 11, color: "var(--rs-dim)", marginTop: 10, textAlign: "center", fontStyle: "italic" }}
                  >
                    {videoStatusText}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <Film size={36} style={{ color: "var(--rs-dim-2)", margin: "0 auto 8px" }} aria-hidden="true" />
                <p style={{ fontSize: 12, color: "var(--rs-dim-2)" }}>Your walkthrough will appear here</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3 mt-5 flex-wrap">
        {videoError && (
          <button className={s.btnPrimary} onClick={onRetry}>
            <RotateCcw size={14} aria-hidden="true" /> Try Again
          </button>
        )}
        {videoReady && videoUrl && (
          <>
            <button className={s.btnEmber} onClick={onDownload}>
              <Download size={14} aria-hidden="true" /> Download MP4
            </button>
            <button className={s.btnGhost} onClick={onPreview}>
              <Eye size={14} aria-hidden="true" /> Fullscreen
            </button>
            <button className={s.btnGhost} onClick={onShare} disabled={isSharing}>
              <Share2 size={14} aria-hidden="true" /> {isSharing ? "Copying..." : "Share Link"}
            </button>
            <button className={s.btnGhostEmber} onClick={onDownload4K}>
              <Download size={14} aria-hidden="true" /> Download 4K
              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 700, background: "var(--rs-ember-glow)", color: "var(--rs-burnt)", fontFamily: "var(--font-jetbrains, monospace)" }}>PRO</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP INDICATOR
// ═══════════════════════════════════════════════════════════════════════════════

function StepIndicator({ step }: { step: WizardStep }) {
  const steps: { key: WizardStep; label: string; num: number }[] = [
    { key: "upload", label: "Upload", num: 1 },
    { key: "processing", label: "Render", num: 2 },
    { key: "gallery", label: "Gallery", num: 3 },
    { key: "video", label: "Walkthrough", num: 4 },
  ];
  const currentIdx = steps.findIndex((s) => s.key === step);

  return (
    <div className={s.stepper}>
      {steps.map((st, i) => {
        const isActive = i === currentIdx;
        const isPast = i < currentIdx;
        const state = isActive ? "active" : isPast ? "done" : "pending";
        return (
          <React.Fragment key={st.key}>
            <div className={s.step}>
              <div className={s.stepNum} data-state={state}>
                {isPast ? (
                  <Check size={12} color="#fff" strokeWidth={3} aria-hidden="true" />
                ) : (
                  <span>{st.num}</span>
                )}
              </div>
              <span className={s.stepLabel} data-state={state}>
                {st.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={s.stepLine}>
                {i < currentIdx && (
                  <motion.div
                    className={s.stepLineFilled}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
                    style={{ transformOrigin: "left" }}
                  />
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function VideoRenderStudio() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Natural pixel dimensions of the uploaded floor plan, read from the
  // <img> onLoad. Sent to /api/generate-3d-render so it can pick a non-square
  // GPT-Image-1 output size that matches the floor plan ratio.
  const [uploadedDims, setUploadedDims] = useState<{ width: number; height: number } | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renders, setRenders] = useState<RenderResult[]>([]);
  const [selectedRender, setSelectedRender] = useState("r4");
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  // ── Video state (real pipeline) ──
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoStatusText, setVideoStatusText] = useState<string>("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const [isSharingVideo, setIsSharingVideo] = useState(false);
  const [fullDescription, setFullDescription] = useState<string>("");
  // Structural analysis from the first (full-layout) API call. Drives the
  // dynamic room thumbnails and seeds the cinematic pipeline's buildingType.
  const [structural, setStructural] = useState<StructuralAnalysis | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoAbortRef = useRef<AbortController | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localBlobUrlRef = useRef<string | null>(null);
  const renderProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cinematic pipeline state ──
  // Tracks an in-flight or completed multi-stage cinematic walkthrough.
  // Lives alongside (not inside) the quick-path state so the two flows don't
  // step on each other. The active flow is decided by `videoMode`.
  const [videoMode, setVideoMode] = useState<VideoMode | null>(null);
  const [cinematicStatus, setCinematicStatus] =
    useState<CinematicStatusResponse | null>(null);
  const [cinematicElapsed, setCinematicElapsed] = useState(0);
  const cinematicTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cinematicPollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!uploadedFile) {
      setPreviewUrl(null);
      setUploadedDims(null);
      return;
    }
    const url = URL.createObjectURL(uploadedFile);
    setPreviewUrl(url);
    // Read the floor plan's natural dimensions so we can send them to the
    // render API and pick a matching GPT-Image-1 output size.
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setUploadedDims({ width: probe.naturalWidth, height: probe.naturalHeight });
      }
    };
    probe.src = url;
    return () => URL.revokeObjectURL(url);
  }, [uploadedFile]);

  // Elapsed-time ticker — runs while a video is being generated.
  useEffect(() => {
    const isGenerating = videoProgress > 0 && !videoReady && !videoError;
    if (!isGenerating) {
      if (videoTimerRef.current) {
        clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
      return;
    }
    videoTimerRef.current = setInterval(() => {
      setVideoElapsed((p) => p + 1);
    }, 1000);
    return () => {
      if (videoTimerRef.current) {
        clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
    };
  }, [videoProgress, videoReady, videoError]);

  // Revoke any local blob URL on unmount (Three.js fallback path).
  useEffect(() => {
    return () => {
      if (localBlobUrlRef.current) {
        URL.revokeObjectURL(localBlobUrlRef.current);
        localBlobUrlRef.current = null;
      }
      if (videoAbortRef.current) videoAbortRef.current.abort();
      if (cinematicPollAbortRef.current) cinematicPollAbortRef.current.abort();
      if (renderProgressTimerRef.current) {
        clearInterval(renderProgressTimerRef.current);
        renderProgressTimerRef.current = null;
      }
    };
  }, []);

  // ── Cinematic elapsed-time ticker — runs while a cinematic pipeline is in flight. ──
  useEffect(() => {
    const isCinematicGenerating =
      videoMode === "cinematic" &&
      cinematicStatus !== null &&
      cinematicStatus.pipelineStatus === "processing";
    if (!isCinematicGenerating) {
      if (cinematicTimerRef.current) {
        clearInterval(cinematicTimerRef.current);
        cinematicTimerRef.current = null;
      }
      return;
    }
    cinematicTimerRef.current = setInterval(() => {
      setCinematicElapsed((p) => p + 1);
    }, 1000);
    return () => {
      if (cinematicTimerRef.current) {
        clearInterval(cinematicTimerRef.current);
        cinematicTimerRef.current = null;
      }
    };
  }, [videoMode, cinematicStatus]);

  const [renderError, setRenderError] = useState<string | null>(null);
  const [upgradeBlock, setUpgradeBlock] = useState<{ title: string; message: string; action: string; actionUrl: string } | null>(null);
  const handleFileSelect = useCallback((file: File) => setUploadedFile(file), []);

  // ─── Wizard ↔ Browser History API Integration ─────────────────────────────
  const stepRef = useRef(step);
  const rendersRef = useRef(renders);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { rendersRef.current = renders; }, [renders]);

  const goToStep = useCallback((next: WizardStep) => {
    setStep(next);
    if (typeof window === "undefined") return;
    if (next === "gallery" || next === "video") {
      try {
        window.history.pushState({ step: next }, "", `#${next}`);
      } catch {
        /* SecurityError on file:// — ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = (e: PopStateEvent) => {
      let next: WizardStep = (e.state?.step as WizardStep) ?? "upload";

      if ((next === "gallery" || next === "video") && rendersRef.current.length === 0) {
        next = "upload";
      }

      if (stepRef.current === "video" && next !== "video" && videoAbortRef.current) {
        videoAbortRef.current.abort();
        videoAbortRef.current = null;
      }

      setStep(next);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const startRendering = useCallback(async () => {
    if (!uploadedFile) return;
    setStep("processing");
    setRenderProgress(0);
    setRenderError(null);
    setStructural(null);

    // ── Simulated progress curve ──
    // The API is a single blocking POST (~30-120s). Drive the progress bar
    // with a client-side timer so the user sees smooth advancement. Capped
    // at 95% until the API actually returns, then jump to 100.
    if (renderProgressTimerRef.current) clearInterval(renderProgressTimerRef.current);
    renderProgressTimerRef.current = setInterval(() => {
      setRenderProgress((p) => {
        if (p < 30) return Math.min(30, p + 1.5);
        if (p < 60) return Math.min(60, p + 0.8);
        if (p < 90) return Math.min(90, p + 0.4);
        return Math.min(95, p + 0.15);
      });
    }, 800);

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const callRender = async (
      apiAngle: string,
      label: string,
      cachedStructuralJson: string | null,
      retries = 2
    ): Promise<{ image: string; structural?: StructuralAnalysis; fullDescription?: string }> => {
      const formData = new FormData();
      formData.append("image", uploadedFile);
      formData.append("angle", apiAngle);
      if (cachedStructuralJson) formData.append("cachedStructural", cachedStructuralJson);
      if (uploadedDims) {
        formData.append("originalWidth", String(uploadedDims.width));
        formData.append("originalHeight", String(uploadedDims.height));
      }

      const res = await fetch("/api/generate-3d-render", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok && data.error && typeof data.error === "object" && (data.error.code === "PLAN_001" || data.error.code === "RATE_001" || data.error.code === "AUTH_001")) {
        setUpgradeBlock({ title: data.error.title, message: data.error.message, action: data.error.action, actionUrl: data.error.actionUrl });
        throw new Error("__PLAN_GATE__");
      }

      if (res.status === 429 && retries > 0) {
        const waitMs = (3 - retries) * 15000;
        await delay(waitMs);
        return callRender(apiAngle, label, cachedStructuralJson, retries - 1);
      }

      if (!res.ok) {
        const errMsg = typeof data.error === "object" ? (data.error?.message || "Render failed") : (data.error || `Failed to generate ${label} render`);
        throw new Error(errMsg);
      }

      return {
        image: data.image as string,
        structural: data.structural as StructuralAnalysis | undefined,
        fullDescription: data.fullDescription as string | undefined,
      };
    };

    try {
      const first = await callRender(FULL_LAYOUT_VIEW.apiAngle, FULL_LAYOUT_VIEW.label, null);
      // ── API returned — clear simulated timer, jump to 100% ──
      if (renderProgressTimerRef.current) {
        clearInterval(renderProgressTimerRef.current);
        renderProgressTimerRef.current = null;
      }
      setStructural(first.structural ?? null);
      setFullDescription(first.fullDescription ?? "");

      const fullLayoutResult: RenderResult = { ...FULL_LAYOUT_VIEW, url: first.image };
      setRenderProgress(100);
      setRenders([fullLayoutResult]);
      setSelectedRender("r4");
      goToStep("gallery");
    } catch (err: unknown) {
      // ── Clear simulated timer on failure too ──
      if (renderProgressTimerRef.current) {
        clearInterval(renderProgressTimerRef.current);
        renderProgressTimerRef.current = null;
      }
      const msg = err instanceof Error ? err.message : "Render generation failed";
      if (msg === "__PLAN_GATE__") {
        setStep("upload");
        return;
      }
      setRenderError(msg);
      setStep("upload");
    }
  }, [uploadedFile, uploadedDims, goToStep]);

  // ─── REAL VIDEO GENERATION PIPELINE ───────────────────────────────────────
  const startVideoGeneration = useCallback(async () => {
    if (videoAbortRef.current) videoAbortRef.current.abort();
    if (localBlobUrlRef.current) {
      URL.revokeObjectURL(localBlobUrlRef.current);
      localBlobUrlRef.current = null;
    }
    setVideoUrl(null);
    setVideoReady(false);
    setVideoError(null);
    setVideoElapsed(0);
    setVideoProgress(0.1);
    setVideoStatusText(VIDEO_STATUS_MESSAGES[0]);

    const abort = new AbortController();
    videoAbortRef.current = abort;

    const fullLayout = renders.find((r) => r.id === "r4");
    const firstWithUrl = renders.find((r) => !!r.url);
    const sourceImageRaw = fullLayout?.url ?? firstWithUrl?.url ?? previewUrl ?? null;

    if (!sourceImageRaw) {
      setVideoError("No source image available. Please re-render the floor plan first.");
      setVideoProgress(0);
      return;
    }

    const rooms = renders
      .filter((r) => r.id !== "r4" && !!r.url)
      .map((r) => r.label);

    try {
      const res = await fetch("/api/generate-video-walkthrough", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceImage: sourceImageRaw,
          description: fullDescription,
          rooms,
          buildingType: rooms.length > 0 ? "modern apartment" : "modern building",
        }),
        signal: abort.signal,
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : "Video request failed");
      }

      if (data.status === "client-rendering") {
        await renderClientFallback(
          data.buildingConfig,
          typeof data.reason === "string" ? data.reason : undefined,
          typeof data.klingError === "string" ? data.klingError : undefined,
          abort,
        );
        return;
      }

      if (data.status === "processing" && data.exteriorTaskId && data.interiorTaskId) {
        await pollKlingTasks(data.exteriorTaskId, data.interiorTaskId, abort);
        return;
      }

      throw new Error("Unexpected response from video service");
    } catch (err) {
      if (abort.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Video generation failed";
      console.error("[VideoRenderStudio] startVideoGeneration error:", msg);
      setVideoError(msg);
      setVideoProgress(0);
      setVideoStatusText("");
    } finally {
      if (videoAbortRef.current === abort) videoAbortRef.current = null;
    }
  }, [renders, previewUrl, fullDescription]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderClientFallback = useCallback(
    async (
      buildingConfig: { floors?: number; floorHeight?: number; footprint?: number; buildingType?: string } | null,
      reason: string | undefined,
      klingError: string | undefined,
      abort: AbortController,
    ) => {
      if (reason === "kling-failed" && klingError) {
        const truncated =
          klingError.length > 80 ? klingError.slice(0, 77) + "..." : klingError;
        setVideoStatusText(`Kling AI unavailable, rendering locally... (${truncated})`);
        toast.error("Kling AI unavailable", {
          description: klingError,
          duration: 8000,
        });
      } else if (reason === "kling-not-configured") {
        setVideoStatusText("Rendering locally (Kling API not configured)");
      } else {
        setVideoStatusText("Rendering locally with Three.js...");
      }
      setVideoProgress(5);

      try {
        const { renderWalkthrough } = await import("@/features/3d-render/services/walkthrough-renderer");
        const result = await renderWalkthrough({
          floors: buildingConfig?.floors ?? 2,
          floorHeight: buildingConfig?.floorHeight ?? 3.0,
          footprint: buildingConfig?.footprint ?? 200,
          buildingType: buildingConfig?.buildingType ?? "modern apartment",
          onProgress: (percent, phase) => {
            if (abort.signal.aborted) return;
            setVideoProgress(Math.max(5, Math.min(99, percent)));
            setVideoStatusText(`${phase} (${percent}%)`);
          },
        });

        if (abort.signal.aborted) {
          URL.revokeObjectURL(result.blobUrl);
          return;
        }

        localBlobUrlRef.current = result.blobUrl;
        setVideoUrl(result.blobUrl);
        setVideoProgress(100);
        setVideoStatusText("Your video is ready!");
        setVideoReady(true);
      } catch (err) {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Three.js rendering failed";
        throw new Error(msg);
      }
    },
    [],
  );

  const pollKlingTasks = useCallback(
    async (
      exteriorTaskId: string,
      interiorTaskId: string,
      abort: AbortController,
    ) => {
      const POLL_INTERVAL_MS = 6000;
      const TIMEOUT_MS = 10 * 60 * 1000;
      const startedAt = Date.now();
      let messageIdx = 1;

      const setRotatingStatus = () => {
        setVideoStatusText(VIDEO_STATUS_MESSAGES[messageIdx % VIDEO_STATUS_MESSAGES.length]);
        messageIdx++;
      };

      while (!abort.signal.aborted) {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          throw new Error("Video generation timed out after 10 minutes. Please try again.");
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (abort.signal.aborted) return;

        let statusJson: {
          exteriorStatus?: string;
          interiorStatus?: string;
          exteriorVideoUrl?: string | null;
          interiorVideoUrl?: string | null;
          progress?: number;
          isComplete?: boolean;
          hasFailed?: boolean;
          failureMessage?: string | null;
        };
        try {
          const params = new URLSearchParams({
            exteriorTaskId,
            interiorTaskId,
            pipeline: "image2video",
          });
          const sres = await fetch(`/api/video-status?${params}`, { signal: abort.signal });
          if (!sres.ok) {
            console.warn("[VideoRenderStudio] poll non-200:", sres.status);
            continue;
          }
          statusJson = await sres.json();
        } catch (pollErr) {
          if (abort.signal.aborted) return;
          console.warn("[VideoRenderStudio] poll error (transient):", pollErr);
          continue;
        }

        if (statusJson.hasFailed) {
          throw new Error(statusJson.failureMessage ?? "Kling video generation failed");
        }

        const serverProgress = typeof statusJson.progress === "number" ? statusJson.progress : 0;
        const cappedProgress = Math.max(10, Math.min(80, serverProgress));
        setVideoProgress(cappedProgress);

        setRotatingStatus();

        if (
          statusJson.isComplete &&
          statusJson.exteriorVideoUrl &&
          statusJson.interiorVideoUrl
        ) {
          setVideoProgress(85);
          setVideoStatusText("Stitching scenes together...");

          let finalUrl: string | null = null;
          try {
            const cres = await fetch("/api/concat-videos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                exteriorUrl: statusJson.exteriorVideoUrl,
                interiorUrl: statusJson.interiorVideoUrl,
              }),
              signal: abort.signal,
            });
            const cdata = await cres.json();
            if (cres.ok && cdata.videoUrl) {
              finalUrl = cdata.videoUrl as string;
            } else if (cres.status === 503) {
              console.warn("[VideoRenderStudio] R2 not configured, using interior segment directly");
              finalUrl = statusJson.interiorVideoUrl;
            } else {
              const cmsg = cdata?.error?.message ?? cdata?.error ?? "Concat failed";
              throw new Error(typeof cmsg === "string" ? cmsg : "Concat failed");
            }
          } catch (concatErr) {
            if (abort.signal.aborted) return;
            console.warn("[VideoRenderStudio] concat failed, falling back to interior:", concatErr);
            finalUrl = statusJson.interiorVideoUrl;
          }

          if (!finalUrl) {
            throw new Error("Both concat and fallback failed — no video URL available");
          }

          setVideoProgress(100);
          setVideoStatusText("Your video is ready!");
          setVideoUrl(finalUrl);
          setVideoReady(true);
          return;
        }
      }
    },
    [],
  );

  const startCinematicGeneration = useCallback(async () => {
    if (videoAbortRef.current) videoAbortRef.current.abort();
    if (cinematicPollAbortRef.current) cinematicPollAbortRef.current.abort();
    if (localBlobUrlRef.current) {
      URL.revokeObjectURL(localBlobUrlRef.current);
      localBlobUrlRef.current = null;
    }
    setVideoUrl(null);
    setVideoReady(false);
    setVideoError(null);
    setVideoElapsed(0);
    setVideoProgress(0);
    setVideoStatusText("");
    setVideoMode("cinematic");
    setCinematicStatus(null);
    setCinematicElapsed(0);

    const fullLayout = renders.find((r) => r.id === "r4");
    const sourceImage = fullLayout?.url ?? null;
    if (!sourceImage) {
      toast.error("Cinematic walkthrough needs the Full Layout render", {
        description: "Please render the floor plan first, then try again.",
      });
      setVideoMode(null);
      return;
    }
    if (!uploadedFile) {
      toast.error("Original floor plan missing", {
        description: "Re-upload your floor plan before generating a cinematic walkthrough.",
      });
      setVideoMode(null);
      return;
    }

    let floorPlanDataUrl: string;
    try {
      floorPlanDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () =>
          reject(reader.error ?? new Error("FileReader failed"));
        reader.readAsDataURL(uploadedFile);
      });
    } catch (readErr) {
      const msg = readErr instanceof Error ? readErr.message : String(readErr);
      toast.error("Could not read floor plan file", { description: msg });
      setVideoMode(null);
      return;
    }

    const rooms = renders
      .filter((r) => r.id !== "r4" && !!r.url)
      .map((r) => r.label);

    const primaryRoom =
      rooms.find((r) => r.toLowerCase().includes("living")) ??
      rooms[0] ??
      "Living Room";

    const submitAbort = new AbortController();
    cinematicPollAbortRef.current = submitAbort;

    let pipelineId: string;
    try {
      toast.info("Producing cinematic walkthrough", {
        description: "Generating the eye-level lifestyle render...",
        duration: 4000,
      });
      const detectedBuildingType =
        structural && structural.buildingType !== "other"
          ? structural.buildingType
          : "building";

      const res = await fetch("/api/generate-cinematic-walkthrough", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceImage,
          floorPlanImage: floorPlanDataUrl,
          description: fullDescription,
          rooms,
          buildingType: detectedBuildingType,
          primaryRoom,
        }),
        signal: submitAbort.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error && typeof data.error === "object" && (data.error.code === "PLAN_001" || data.error.code === "RATE_001" || data.error.code === "AUTH_001")) {
          setUpgradeBlock({ title: data.error.title, message: data.error.message, action: data.error.action, actionUrl: data.error.actionUrl });
          setVideoMode(null);
          return;
        }
        const msg =
          data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
        const msgStr = typeof msg === "string" ? msg : "Cinematic submit failed";
        const tagged = res.status === 429 ? `RATE_LIMIT::${msgStr}` : msgStr;
        throw new Error(tagged);
      }
      pipelineId = data.pipelineId as string;
      setCinematicStatus({
        pipelineId,
        pipelineStatus: "processing",
        progress: 5,
        currentStage: "overview",
        statusMessage: "Creating cinematic overview of your floor plan...",
        stages: {
          overview: {
            name: "overview",
            status: data.stages?.overview?.status ?? "submitted",
            durationSeconds: 10,
          },
          transition: {
            name: "transition",
            status: data.stages?.transition?.status ?? "pending",
            durationSeconds: 5,
          },
          lifestyle: {
            name: "lifestyle",
            status: data.stages?.lifestyle?.status ?? "submitted",
            imageUrl: data.stages?.lifestyle?.sourceImageUrl,
            durationSeconds: 10,
          },
          stitch: {
            name: "stitch",
            status: data.stages?.stitch?.status ?? "pending",
          },
        },
        pipeline: "cinematic-multi-stage",
      });
    } catch (err) {
      if (submitAbort.signal.aborted) return;
      const rawMsg = err instanceof Error ? err.message : "Cinematic submit failed";
      const isRateLimit = rawMsg.startsWith("RATE_LIMIT::");
      const msg = isRateLimit ? rawMsg.slice("RATE_LIMIT::".length) : rawMsg;
      console.error("[VideoRenderStudio] cinematic submit error:", msg);
      if (isRateLimit) {
        toast.warning("Cinematic walkthrough limit reached", {
          description:
            "Try the standard 3D Video Walkthrough — same source image, no extra wait.",
          duration: 8000,
        });
      } else {
        toast.error("Cinematic walkthrough failed", { description: msg });
      }
      setVideoError(msg);
      setVideoMode(null);
      return;
    }

    const POLL_INTERVAL_MS = 5000;
    const TIMEOUT_MS = 20 * 60 * 1000;
    const startedAt = Date.now();

    while (!submitAbort.signal.aborted) {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        toast.error("Cinematic walkthrough timed out", {
          description: "Generation took longer than 20 minutes. Please try again.",
        });
        setVideoError("Cinematic generation timed out after 20 minutes");
        return;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (submitAbort.signal.aborted) return;

      let statusJson: CinematicStatusResponse;
      try {
        const sres = await fetch(
          `/api/cinematic-status?pipelineId=${encodeURIComponent(pipelineId)}`,
          { signal: submitAbort.signal },
        );
        if (!sres.ok) {
          if (sres.status === 404) {
            const data = await sres.json().catch(() => ({}));
            const msg =
              data?.error?.message ?? "Cinematic pipeline not found (it may have expired)";
            setVideoError(msg);
            return;
          }
          console.warn("[VideoRenderStudio] cinematic poll non-200:", sres.status);
          continue;
        }
        statusJson = (await sres.json()) as CinematicStatusResponse;
      } catch (pollErr) {
        if (submitAbort.signal.aborted) return;
        console.warn("[VideoRenderStudio] cinematic poll error (transient):", pollErr);
        continue;
      }

      setCinematicStatus(statusJson);

      if (
        statusJson.pipelineStatus === "complete" &&
        statusJson.finalVideoUrl
      ) {
        setVideoUrl(statusJson.finalVideoUrl);
        setVideoReady(true);
        setVideoProgress(100);
        setVideoStatusText("Your cinematic walkthrough is ready!");
        toast.success("Cinematic walkthrough ready!");
        return;
      }

      if (statusJson.pipelineStatus === "failed") {
        const errors: string[] = [];
        if (statusJson.stages.overview.error)
          errors.push(`Overview: ${statusJson.stages.overview.error}`);
        if (statusJson.stages.lifestyle.error)
          errors.push(`Lifestyle: ${statusJson.stages.lifestyle.error}`);
        if (statusJson.stages.stitch.error)
          errors.push(`Stitch: ${statusJson.stages.stitch.error}`);
        const errMsg =
          errors.length > 0
            ? errors.join(" · ")
            : "Cinematic generation failed";
        setVideoError(errMsg);
        toast.error("Cinematic walkthrough failed", { description: errMsg });
        return;
      }

      if (
        statusJson.pipelineStatus === "partial" &&
        statusJson.finalVideoUrl
      ) {
        setVideoUrl(statusJson.finalVideoUrl);
        setVideoReady(true);
        setVideoProgress(100);
        setVideoStatusText(
          "Partial walkthrough delivered — some stages couldn't be completed.",
        );
        toast.warning("Partial cinematic walkthrough", {
          description: "Some stages failed but we delivered what we have.",
          duration: 6000,
        });
        return;
      }
    }
  }, [renders, uploadedFile, fullDescription, structural]);

  const handleDownloadVideo = useCallback(async () => {
    if (!videoUrl) return;

    const isBlobUrl = videoUrl.startsWith("blob:");
    const filename = isBlobUrl
      ? "buildflow-walkthrough.webm"
      : "buildflow-walkthrough.mp4";

    if (isBlobUrl) {
      const a = document.createElement("a");
      a.href = videoUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Downloading your walkthrough...");
      return;
    }

    toast.info("Preparing download...");
    try {
      const res = await fetch(videoUrl, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      toast.success("Downloaded!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Download failed";
      console.error("[Download MP4] Error:", msg);
      toast.error("Couldn't download — opening in a new tab", { description: msg });
      window.open(videoUrl, "_blank", "noopener,noreferrer");
    }
  }, [videoUrl]);

  const handlePreviewFullscreen = useCallback(() => {
    const el = videoElementRef.current;
    if (!el) return;
    const anyEl = el as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (typeof el.requestFullscreen === "function") {
        void el.requestFullscreen();
      } else if (typeof anyEl.webkitRequestFullscreen === "function") {
        void anyEl.webkitRequestFullscreen();
      } else if (typeof anyEl.webkitEnterFullscreen === "function") {
        anyEl.webkitEnterFullscreen();
      } else {
        toast.info("Fullscreen isn't supported in this browser.");
      }
    } catch (err) {
      console.warn("[VideoRenderStudio] fullscreen failed:", err);
      toast.error("Couldn't enter fullscreen.");
    }
  }, []);

  const handleShareVideo = useCallback(async () => {
    if (!videoUrl || isSharingVideo) return;
    if (videoUrl.startsWith("blob:")) {
      toast.error("Local previews can't be shared. Generate a Kling video to share publicly.");
      return;
    }
    setIsSharingVideo(true);
    try {
      const res = await fetch("/api/share/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          title: "3D Walkthrough",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : "Share failed");
      }
      const shareUrl: string = data.shareUrl;
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } catch {
          /* noop */
        }
        document.body.removeChild(ta);
      }
      toast.success("Share link copied!", { description: shareUrl, duration: 6000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't create share link", { description: msg });
    } finally {
      setIsSharingVideo(false);
    }
  }, [videoUrl, isSharingVideo]);

  const handleDownload4K = useCallback(() => {
    toast.info("4K renders coming soon", {
      description: "Pro plan unlocks 4K. The current 1080p MP4 is already downloaded.",
      duration: 5000,
    });
  }, []);

  const handleRetryVideo = useCallback(() => {
    setVideoError(null);
    if (videoMode === "cinematic") {
      void startCinematicGeneration();
    } else {
      void startVideoGeneration();
    }
  }, [videoMode, startCinematicGeneration, startVideoGeneration]);

  const handleReset = useCallback(() => {
    if (videoAbortRef.current) {
      videoAbortRef.current.abort();
      videoAbortRef.current = null;
    }
    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    if (cinematicPollAbortRef.current) {
      cinematicPollAbortRef.current.abort();
      cinematicPollAbortRef.current = null;
    }
    if (cinematicTimerRef.current) {
      clearInterval(cinematicTimerRef.current);
      cinematicTimerRef.current = null;
    }
    if (localBlobUrlRef.current) {
      URL.revokeObjectURL(localBlobUrlRef.current);
      localBlobUrlRef.current = null;
    }
    if (renderProgressTimerRef.current) {
      clearInterval(renderProgressTimerRef.current);
      renderProgressTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState({ step: "upload" }, "", window.location.pathname);
      } catch {
        /* ignore */
      }
    }
    setStep("upload");
    setUploadedFile(null);
    setPreviewUrl(null);
    setUploadedDims(null);
    setRenderProgress(0);
    setRenders([]);
    setSelectedRender("r4");
    setVideoProgress(0);
    setVideoReady(false);
    setVideoUrl(null);
    setVideoStatusText("");
    setVideoError(null);
    setVideoElapsed(0);
    setFullDescription("");
    setVideoMode(null);
    setCinematicStatus(null);
    setCinematicElapsed(0);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className={`${s.page} h-full overflow-y-auto flex flex-col`}>
      {/* Upgrade / Verify popup */}
      {upgradeBlock && (() => {
        const isVerify = upgradeBlock.actionUrl?.includes("settings");
        const isUp = !isVerify;
        return (
          <div className={s.upgradeOverlay}>
            <div className={s.upgradeCard}>
              <div className={s.upgradeBar} />
              <div style={{ padding: "40px 32px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 12 }}>{isUp ? "\uD83C\uDFAC" : "\uD83D\uDCEC"}</div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--rs-ink)", letterSpacing: "-0.02em", margin: "0 0 8px", fontFamily: "var(--font-display, Georgia, serif)" }}>
                  {isUp ? "This feature needs a bigger engine" : "One quick thing before your render"}
                </h2>
                <p style={{ fontSize: 13, color: "var(--rs-text)", lineHeight: 1.65, margin: "0 auto 20px", maxWidth: 380 }}>
                  {isUp ? "3D renders, cinematic walkthroughs, AI video — the premium pipeline. Unlock the full creative arsenal." : "Verify your email to unlock your final free render. Quick click, back in 10 seconds."}
                </p>
              </div>
              <div style={{ padding: "0 32px 24px" }}>
                <div style={{ background: "var(--rs-bone)", border: "1px solid var(--rs-rule)", borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12, color: "var(--rs-blueprint)", fontFamily: "var(--font-jetbrains, monospace)" }}>
                    {isUp ? "Unlock with Starter" : "After verification"}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {(isUp
                      ? [{ icon: "\uD83C\uDFAC", text: "Cinematic video walkthroughs" }, { icon: "\uD83E\uDDCA", text: "Interactive 3D models" }, { icon: "\uD83C\uDFA8", text: "10 photorealistic renders/month" }, { icon: "\u26A1", text: "Priority render queue" }]
                      : [{ icon: "\u2705", text: "Unlock your final free render" }, { icon: "\uD83D\uDD10", text: "Secure your account" }, { icon: "\uD83D\uDCE9", text: "Get notified on new features" }, { icon: "\u26A1", text: "Takes 10 seconds" }]
                    ).map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 16 }}>{f.icon}</span>
                        <span style={{ fontSize: 12, color: "var(--rs-text)", fontWeight: 500 }}>{f.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <a href={upgradeBlock.actionUrl} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", padding: "14px 24px", borderRadius: 12, background: "var(--rs-blueprint)", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none", letterSpacing: "-0.01em" }}>
                  {upgradeBlock.action} <ArrowRight size={16} aria-hidden="true" />
                </a>
                <button onClick={() => setUpgradeBlock(null)} style={{ width: "100%", marginTop: 10, padding: "10px", borderRadius: 8, background: "transparent", border: "none", color: "var(--rs-text-mute)", fontSize: 11, cursor: "pointer", fontStyle: "italic" }}>
                  {isUp ? "Not now" : "I'll verify later"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── CONTENT ─── */}
      <div className="flex-1 w-full" style={{ paddingBottom: 48, paddingTop: 20 }}>
        <div className={step === "gallery" ? "max-w-[1400px] mx-auto px-4 sm:px-6" : "max-w-4xl mx-auto px-6"}>
          <StepIndicator step={step} />

          {step !== "upload" && (
            <div className="flex justify-end mb-3">
              <button className={s.startOver} onClick={handleReset}>
                <RotateCcw size={11} aria-hidden="true" /> Start Over
              </button>
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {/* ════════ UPLOAD STATE ════════ */}
          {step === "upload" && (
            <motion.div key="upload" className="max-w-4xl mx-auto px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -40 }}>
              {/* Hero */}
              <div style={{ textAlign: "center", marginBottom: 40 }}>
                <div className={s.eyebrow} style={{ justifyContent: "center" }}>
                  <span className={s.eyebrowDot} />
                  RENDER STUDIO · v2.4
                </div>
                <h1 className={s.heroTitle}>
                  From flat to <em>photoreal.</em>
                </h1>
                <p className={s.heroLead}>
                  Upload an architectural floor plan. We render it in 3D — room by room — at architectural-grade fidelity, in under three minutes.
                </p>
                <div className={s.heroStats}>
                  {[
                    { v: "3 min", l: "Render time" },
                    { v: "4K", l: "Output" },
                    { v: "9", l: "Room cameras" },
                    { v: "Photoreal", l: "Output mode" },
                  ].map((stat) => (
                    <div key={stat.l} className={s.heroStat}>
                      <span className={s.heroStatV}>{stat.v}</span>
                      <span className={s.heroStatL}>{stat.l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {renderError && (
                <div className={s.errorBox} style={{ maxWidth: 600, margin: "0 auto 16px" }}>
                  <p className={s.errorTitle}>Render failed</p>
                  <p className={s.errorMsg}>{renderError}</p>
                </div>
              )}

              <UploadZone onFileSelect={handleFileSelect} uploadedFile={uploadedFile} previewUrl={previewUrl} />

              {uploadedFile && (
                <div className="flex justify-center" style={{ marginTop: 28 }}>
                  <button className={s.btnPrimary} onClick={startRendering}>
                    Transform to Photorealistic 3D <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              )}

              {/* Footer microcopy */}
              <p style={{ textAlign: "center", marginTop: 40, fontSize: 10, color: "var(--rs-text-mute)", fontFamily: "var(--font-jetbrains, monospace)", letterSpacing: "0.02em" }}>
                &#9650; Trained on 240,000 architectural drawings · Powered by GPT Image 1.5
              </p>
            </motion.div>
          )}

          {/* ════════ PROCESSING STATE ════════ */}
          {step === "processing" && (
            <motion.div key="processing" className="max-w-[1400px] mx-auto px-6" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
              <div className={s.renderLayout}>
                {/* Left column — scan frame */}
                <div className={s.renderStage}>
                  <div className={s.renderStageLabel}>
                    <div className={s.blinkDot} />
                    ANALYZING · {uploadedFile?.name?.split(".")[0]?.toUpperCase().slice(0, 24) || "FLOOR PLAN"}
                  </div>
                  <div className={s.scanFrame}>
                    {previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="" className={s.scanFrameImg} draggable={false} />
                    )}
                    <div className={s.scanBeam} />
                    <div className={s.bracket} data-pos="tl" />
                    <div className={s.bracket} data-pos="tr" />
                    <div className={s.bracket} data-pos="bl" />
                    <div className={s.bracket} data-pos="br" />
                    {structural?.rooms?.slice(0, 3).map((room, i) => (
                      <div key={room} className={s.pin} style={{ top: `${28 + i * 20}%`, left: `${18 + i * 18}%`, animationDelay: `${0.4 + i * 0.25}s` }}>
                        <div className={s.pinDot} />
                        <span className={s.pinLabel}>{room}</span>
                      </div>
                    ))}
                  </div>
                  <div className={s.meter}>
                    <div className={s.meterCell}>
                      <div className={s.meterLabel}>Resolution</div>
                      <div className={s.meterValue}>4K</div>
                    </div>
                    <div className={s.meterCell}>
                      <div className={s.meterLabel}>Rooms</div>
                      <div className={s.meterValue}>{structural?.roomCount ?? "—"}</div>
                    </div>
                    <div className={s.meterCell}>
                      <div className={s.meterLabel}>Type</div>
                      <div className={s.meterValue} style={{ fontSize: 13, textTransform: "capitalize" }}>{structural?.footprint ?? "—"}</div>
                    </div>
                    <div className={s.meterCell}>
                      <div className={s.meterLabel}>Progress</div>
                      <div className={s.meterValue}>{Math.round(renderProgress)}%</div>
                    </div>
                  </div>
                </div>

                {/* Right column — pipeline feed */}
                <ProcessingView progress={renderProgress} />
              </div>
            </motion.div>
          )}

          {/* ════════ GALLERY STATE ════════ */}
          {step === "gallery" && (
            <motion.div key="gallery" className="max-w-[1400px] mx-auto px-4 sm:px-6" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
              <div className={s.galHeader}>
                <div>
                  <h2 className={s.galTitle}>Render <em>ready</em></h2>
                  <p className={s.galSub}>
                    {structural?.roomCount ?? "—"} rooms · 4K · scroll to inspect
                  </p>
                </div>
                <div className={s.galActions}>
                  <button className={s.btnGhost} onClick={handleReset}>
                    <RotateCcw size={12} aria-hidden="true" /> Regenerate
                  </button>
                </div>
              </div>

              <ComparisonSlider
                beforeSrc={previewUrl}
                afterSrc={renders.find(r => r.id === selectedRender)?.url ?? null}
                fullWidth
              />

              {/* Next card — CTA to video */}
              <div className={s.nextCard}>
                <div>
                  <h3 className={s.nextCardTitle}>Bring it to <em>life</em></h3>
                  <p className={s.nextCardSub}>
                    Generate a cinematic walkthrough — fly the camera through every room with photoreal lighting and grade.
                  </p>
                </div>
                <button className={s.ncBtn} onClick={() => goToStep("video")}>
                  Create walkthrough <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ════════ VIDEO STATE ════════ */}
          {step === "video" && (
            <motion.div key="video" className="max-w-4xl mx-auto px-6" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
              {/* Header */}
              <div className={s.vidHead}>
                <div className={s.eyebrow} style={{ justifyContent: "center", marginBottom: 12 }}>
                  <span className={s.eyebrowDot} style={{ background: "var(--rs-ember)" }} />
                  <span style={{ color: "var(--rs-ember)" }}>CINEMATIC WALKTHROUGH</span>
                </div>
                <h2 className={s.vidHeadTitle}>
                  From render to <em>cinema</em>
                </h2>
                <p className={s.vidHeadSub}>
                  Pick your runtime. We&apos;ll generate a multi-shot walkthrough — exterior orbit, descent, and an interior tour at architectural cadence.
                </p>
              </div>

              {/* Comparison slider (compact) */}
              <div style={{ marginBottom: 24 }}>
                <ComparisonSlider beforeSrc={previewUrl} afterSrc={renders.find(r => r.id === selectedRender)?.url ?? null} />
              </div>

              <VideoSection
                mode={videoMode}
                videoProgress={videoProgress}
                videoReady={videoReady}
                videoUrl={videoUrl}
                videoStatusText={videoStatusText}
                videoError={videoError}
                videoElapsed={videoElapsed}
                isSharing={isSharingVideo}
                cinematicStatus={cinematicStatus}
                cinematicElapsed={cinematicElapsed}
                videoRef={videoElementRef}
                onGenerate={() => {
                  setVideoMode("quick");
                  void startVideoGeneration();
                }}
                onGenerateCinematic={startCinematicGeneration}
                onDownload={handleDownloadVideo}
                onPreview={handlePreviewFullscreen}
                onShare={handleShareVideo}
                onRetry={handleRetryVideo}
                onDownload4K={handleDownload4K}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── FOOTER ─── */}
      <div className={s.footer}>
        <p className={s.footerText}>
          Powered by GPT Image 1.5 · Kling 3.0 · Three.js
        </p>
      </div>
    </div>
  );
}
