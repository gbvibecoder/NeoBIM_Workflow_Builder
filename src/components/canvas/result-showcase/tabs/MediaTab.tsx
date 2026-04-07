"use client";

import { useCallback, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { motion, AnimatePresence } from "framer-motion";
import { Maximize2, X, Download, ExternalLink, Loader2, ArrowLeft, Video, Sparkles, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/hooks/useLocale";
import { useExecutionStore } from "@/stores/execution-store";
import { COLORS } from "../constants";
import type { ShowcaseData } from "../useShowcaseData";

interface MediaTabProps {
  data: ShowcaseData;
  onExpandVideo: () => void;
  onCreateVideo?: () => void;
  isCreatingVideo?: boolean;
}

export function MediaTab({ data, onExpandVideo, onCreateVideo, isCreatingVideo = false }: MediaTabProps) {
  const { t } = useLocale();

  const RENDER_PHASES = useMemo(() => [
    "Exterior Pull-in",
    "Building Orbit",
    "Interior Walkthrough",
    "Section Rise",
  ], []);

  const PHASE_LABELS: Record<string, string> = useMemo(() => ({
    "Exterior Pull-in": t('showcase.phaseExterior'),
    "Building Orbit": t('showcase.phaseOrbit'),
    "Interior Walkthrough": t('showcase.phaseInterior'),
    "Section Rise": t('showcase.phaseSection'),
  }), [t]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Sanitize SVG content to prevent XSS
  const sanitizedSvg = useMemo(() =>
    typeof window !== "undefined" && data.svgContent
      ? DOMPurify.sanitize(data.svgContent, { USE_PROFILES: { svg: true, svgFilters: true } })
      : ""
  , [data.svgContent]);

  // Check for video generation progress
  const videoGenProgress = useExecutionStore(s => {
    if (!data.videoData?.nodeId) return null;
    return s.videoGenProgress.get(data.videoData.nodeId) ?? null;
  });

  const isVideoGenerating = videoGenProgress && (videoGenProgress.status === "rendering" || videoGenProgress.status === "processing" || videoGenProgress.status === "submitting");

  // Show "Create 3D Video Walkthrough" CTA when:
  //  - A 3D model has been generated (GN-011 result available)
  //  - No video exists yet AND nothing is in progress
  //  - The parent passed an onCreateVideo handler
  const canShowCreateCTA = !!onCreateVideo && !!data.model3dData && !data.videoData && !isVideoGenerating;

  // ─── Share Link state + handler ──────────────────────────────────────────
  const [isCreatingShare, setIsCreatingShare] = useState(false);
  const handleShareLink = useCallback(async () => {
    if (isCreatingShare) return;
    const videoUrl = data.videoData?.downloadUrl ?? data.videoData?.videoUrl;
    if (!videoUrl) {
      toast.error(t('toast.shareLinkFailed'), { description: t('video.noVideoAvailable') });
      return;
    }
    setIsCreatingShare(true);
    try {
      const res = await fetch("/api/share/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          title: data.projectTitle,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody?.error?.message ?? errBody?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const { shareUrl } = await res.json() as { shareUrl: string };
      // Best-effort clipboard copy — falls back to a select-all approach if denied.
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch { /* noop */ }
        document.body.removeChild(ta);
      }
      toast.success(t('toast.shareLinkCopied'), {
        description: shareUrl,
        duration: 6000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Share Link] Error:", msg);
      toast.error(t('toast.shareLinkFailed'), { description: msg, duration: 6000 });
    } finally {
      setIsCreatingShare(false);
    }
  }, [isCreatingShare, data.videoData, data.projectTitle, t]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: "100%" }}>
      {/* Create Video Walkthrough CTA — appears when a 3D model exists but no video yet */}
      {canShowCreateCTA && (
        <CreateVideoCTA
          onClick={onCreateVideo!}
          isSubmitting={isCreatingVideo}
          ctaLabel={t('showcase.createVideoWalkthrough')}
          ctaDesc={t('showcase.createVideoWalkthroughDesc')}
          submittingLabel={t('showcase.createVideoSubmitting')}
        />
      )}

      {/* Video Generation Progress */}
      {isVideoGenerating && !data.videoData?.videoUrl && (
        <section>
          <SectionTitle>{t('showcase.videoWalkthrough')}</SectionTitle>
          <div style={{
            borderRadius: 12,
            overflow: "hidden",
            position: "relative",
            boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            background: "linear-gradient(135deg, #0a0a0f 0%, #111122 100%)",
            padding: "48px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            minHeight: 280,
          }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            >
              <Loader2 size={32} style={{ color: COLORS.CYAN }} />
            </motion.div>

            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
                {t('showcase.renderingWalkthrough')}
              </div>
              <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED }}>
                {videoGenProgress.phase ?? t('showcase.initializing')} — {Math.min(Math.max(videoGenProgress.progress ?? 0, 0), 100)}%
              </div>
            </div>

            {/* Progress bar */}
            <div style={{
              width: "70%",
              maxWidth: 320,
              height: 6,
              borderRadius: 3,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}>
              <motion.div
                initial={{ width: "0%" }}
                animate={{ width: `${Math.min(Math.max(videoGenProgress.progress ?? 0, 0), 100)}%` }}
                transition={{ duration: 0.3 }}
                style={{
                  height: "100%",
                  borderRadius: 3,
                  background: `linear-gradient(90deg, ${COLORS.CYAN}, #00d4ff)`,
                  boxShadow: `0 0 8px ${COLORS.CYAN}40`,
                }}
              />
            </div>

            {/* Phase indicators */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
              {RENDER_PHASES.map((phase) => {
                const isActive = videoGenProgress.phase === phase;
                const isPast = RENDER_PHASES.indexOf(phase) < RENDER_PHASES.indexOf(videoGenProgress.phase ?? "");
                return (
                  <div
                    key={phase}
                    style={{
                      fontSize: 8,
                      fontWeight: 600,
                      padding: "3px 8px",
                      borderRadius: 4,
                      background: isActive ? `${COLORS.CYAN}20` : isPast ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${isActive ? `${COLORS.CYAN}40` : "rgba(255,255,255,0.06)"}`,
                      color: isActive ? COLORS.CYAN : isPast ? COLORS.TEXT_MUTED : "rgba(255,255,255,0.2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {PHASE_LABELS[phase] ?? phase}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Video Section */}
      {data.videoData?.videoUrl && (
        <section>
          <SectionTitle>{t('showcase.videoWalkthrough')}</SectionTitle>
          <div style={{
            borderRadius: 12,
            overflow: "hidden",
            position: "relative",
            boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            background: "#000",
          }}>
            <video
              controls
              autoPlay
              muted
              playsInline
              crossOrigin="anonymous"
              src={data.videoData.videoUrl}
              style={{
                width: "100%",
                maxHeight: "calc(100vh - 260px)",
                display: "block",
              }}
            />
            <div style={{
              position: "absolute",
              top: 12,
              right: 12,
              display: "flex",
              gap: 6,
            }}>
              <MediaButton
                icon={<Maximize2 size={10} />}
                label={t('showcase.theaterMode')}
                onClick={onExpandVideo}
              />
              {data.videoData.downloadUrl && (
                <a
                  href={data.videoData.downloadUrl}
                  download
                  style={{ textDecoration: "none" }}
                >
                  <MediaButton
                    icon={<Download size={10} />}
                    label={t('showcase.downloadImage')}
                  />
                </a>
              )}
            </div>
          </div>

          {/* Video metadata strip */}
          <div style={{
            display: "flex",
            gap: 16,
            marginTop: 12,
            padding: "10px 16px",
            background: COLORS.GLASS_BG,
            border: `1px solid ${COLORS.GLASS_BORDER}`,
            borderRadius: 8,
          }}>
            {[
              { label: t('showcase.duration'), value: `${data.videoData.durationSeconds}s` },
              { label: t('showcase.shots'), value: String(data.videoData.shotCount) },
              ...(data.videoData.pipeline ? [{ label: t('showcase.pipeline'), value: data.videoData.pipeline }] : []),
              ...(data.videoData.costUsd != null ? [{ label: t('showcase.cost'), value: `$${data.videoData.costUsd.toFixed(2)}` }] : []),
            ].map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {item.label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_PRIMARY }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          {/* ─── Export action row: Download MP4 (primary) · Preview Full Screen · Share Link ─── */}
          <VideoExportButtons
            downloadUrl={data.videoData.downloadUrl ?? data.videoData.videoUrl}
            videoName={data.videoData.name}
            onPreview={onExpandVideo}
            onShare={handleShareLink}
            isSharing={isCreatingShare}
            downloadLabel={t('showcase.downloadMP4')}
            previewLabel={t('showcase.previewFullScreen')}
            shareLabel={t('showcase.shareLink')}
          />
        </section>
      )}

      {/* Image Gallery */}
      {data.allImageUrls.length > 0 && (
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <SectionTitle>{t('showcase.imagesRenders')}</SectionTitle>
            <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED }}>
              {data.allImageUrls.length} {data.allImageUrls.length > 1 ? t('showcase.conceptRenders') : t('showcase.conceptRender')}
            </span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: data.allImageUrls.length === 1
              ? "1fr"
              : data.allImageUrls.length === 2
                ? "repeat(2, 1fr)"
                : "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}>
            {data.allImageUrls.map((url, i) => {
              const isSingle = data.allImageUrls.length === 1;
              return (
                <motion.div
                  key={url}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.3 }}
                  style={{
                    borderRadius: 12,
                    overflow: "hidden",
                    position: "relative",
                    boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Render ${i + 1}`}
                    onClick={() => setLightboxUrl(url)}
                    style={{
                      width: "100%",
                      height: isSingle ? "calc(100vh - 280px)" : 300,
                      minHeight: isSingle ? 400 : 200,
                      objectFit: "cover",
                      display: "block",
                      cursor: "pointer",
                      transition: "transform 0.3s ease",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.02)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
                  />

                  {/* Top-right action buttons */}
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      display: "flex",
                      gap: 6,
                      opacity: 0,
                      transition: "opacity 0.2s ease",
                    }}
                    className="media-actions"
                  >
                    <a
                      href={url}
                      download={`render_${i + 1}.png`}
                      onClick={e => e.stopPropagation()}
                      style={{ textDecoration: "none" }}
                    >
                      <MediaButton icon={<Download size={10} />} label={t('showcase.downloadImage')} />
                    </a>
                    <MediaButton
                      icon={<ExternalLink size={10} />}
                      label={t('showcase.fullscreen')}
                      onClick={() => setLightboxUrl(url)}
                    />
                  </div>

                  {/* Bottom gradient with label + download */}
                  <div style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: isSingle ? "40px 20px 14px" : "24px 12px 10px",
                    background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <span style={{ fontSize: isSingle ? 13 : 10, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                      {t('showcase.conceptRenderTitle')} {data.allImageUrls.length > 1 ? i + 1 : ""}
                    </span>
                    <a
                      href={url}
                      download={`concept_render_${i + 1}.png`}
                      onClick={e => e.stopPropagation()}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        color: COLORS.CYAN,
                        fontSize: isSingle ? 11 : 9,
                        fontWeight: 600,
                        textDecoration: "none",
                        cursor: "pointer",
                        padding: "4px 10px",
                        borderRadius: 6,
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(0,245,255,0.2)",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "rgba(0,245,255,0.1)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                      }}
                    >
                      <Download size={isSingle ? 12 : 10} />
                      {t('video.download')}
                    </a>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Hover reveal CSS */}
          <style>{`
            div:hover > .media-actions { opacity: 1 !important; }
          `}</style>
        </section>
      )}

      {/* SVG Floor Plan */}
      {data.svgContent && (
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <SectionTitle>{t('showcase.floorPlan')}</SectionTitle>
            <button
              onClick={() => {
                const blob = new Blob([data.svgContent!], { type: "image/svg+xml" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "floor_plan.svg";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                borderRadius: 6,
                background: `${COLORS.CYAN}10`,
                border: `1px solid ${COLORS.CYAN}20`,
                color: COLORS.CYAN,
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Download size={10} />
              {t('showcase.downloadSvg')}
            </button>
          </div>
          <div style={{
            background: "#fff",
            borderRadius: 10,
            padding: 24,
            overflow: "auto",
          }}>
            <div
              dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
              style={{ width: "100%", maxHeight: 600 }}
            />
          </div>
        </section>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxUrl(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100,
              background: "rgba(0,0,0,0.92)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "zoom-out",
              padding: 40,
            }}
          >
            {/* Top-left close button */}
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
              style={{
                position: "absolute",
                top: 20,
                left: 20,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 8,
                padding: "8px 16px",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                zIndex: 101,
              }}
            >
              <ArrowLeft size={14} />
              {t('showcase.back')}
            </button>

            <div style={{
              position: "absolute",
              top: 20,
              right: 20,
              display: "flex",
              gap: 8,
            }}>
              <a
                href={lightboxUrl}
                download
                onClick={e => e.stopPropagation()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  textDecoration: "none",
                  cursor: "pointer",
                }}
              >
                <Download size={14} />
                {t('video.download')}
              </a>
              <button
                onClick={() => setLightboxUrl(null)}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: 8,
                  padding: 8,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              src={lightboxUrl}
              alt="Full view"
              style={{
                maxWidth: "90vw",
                maxHeight: "85vh",
                objectFit: "contain",
                borderRadius: 8,
              }}
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function MediaButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 10px",
        borderRadius: 6,
        background: "rgba(0,0,0,0.7)",
        border: "1px solid rgba(255,255,255,0.15)",
        color: COLORS.TEXT_PRIMARY,
        fontSize: 10,
        fontWeight: 600,
        cursor: "pointer",
        transition: "background 0.15s ease",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "rgba(0,0,0,0.85)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "rgba(0,0,0,0.7)";
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 13,
      fontWeight: 600,
      color: COLORS.TEXT_PRIMARY,
      marginBottom: 14,
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}>
      {children}
    </div>
  );
}

// ─── Video Export Buttons ───────────────────────────────────────────────────
// Three-button action row that appears below the video player + metadata strip
// once a walkthrough has been generated. Primary action is the green/amber
// gradient "Download MP4"; secondary actions are outlined "Preview Full Screen"
// and "Share Link". The Share Link button calls /api/share/video and copies
// the returned slug URL to the clipboard.
function VideoExportButtons({
  downloadUrl,
  videoName,
  onPreview,
  onShare,
  isSharing,
  downloadLabel,
  previewLabel,
  shareLabel,
}: {
  downloadUrl: string;
  videoName: string;
  onPreview: () => void;
  onShare: () => void;
  isSharing: boolean;
  downloadLabel: string;
  previewLabel: string;
  shareLabel: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05, duration: 0.3 }}
      style={{
        display: "flex",
        gap: 10,
        marginTop: 12,
        flexWrap: "wrap",
      }}
    >
      {/* Primary: Download MP4 — green/amber gradient */}
      <a
        href={downloadUrl}
        download={videoName || "walkthrough.mp4"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 22px",
          borderRadius: 10,
          background: "linear-gradient(135deg, #10B981 0%, #F59E0B 100%)",
          color: "#0A0A0F",
          fontSize: 13,
          fontWeight: 700,
          textDecoration: "none",
          letterSpacing: "0.01em",
          boxShadow: "0 6px 24px rgba(16,185,129,0.32), 0 0 0 1px rgba(16,185,129,0.4)",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
          cursor: "pointer",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 10px 32px rgba(16,185,129,0.42), 0 0 0 1px rgba(16,185,129,0.55)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 6px 24px rgba(16,185,129,0.32), 0 0 0 1px rgba(16,185,129,0.4)";
        }}
      >
        <Download size={15} strokeWidth={2.4} />
        {downloadLabel}
      </a>

      {/* Secondary: Preview Full Screen */}
      <button
        type="button"
        onClick={onPreview}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 20px",
          borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.14)",
          color: COLORS.TEXT_PRIMARY,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "rgba(255,255,255,0.08)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
        }}
      >
        <Maximize2 size={14} strokeWidth={2.2} />
        {previewLabel}
      </button>

      {/* Secondary: Share Link */}
      <button
        type="button"
        onClick={onShare}
        disabled={isSharing}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 20px",
          borderRadius: 10,
          background: "rgba(139,92,246,0.08)",
          border: "1px solid rgba(139,92,246,0.3)",
          color: "#C4B5FD",
          fontSize: 13,
          fontWeight: 600,
          cursor: isSharing ? "wait" : "pointer",
          opacity: isSharing ? 0.7 : 1,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          if (isSharing) return;
          e.currentTarget.style.background = "rgba(139,92,246,0.16)";
          e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
        }}
        onMouseLeave={e => {
          if (isSharing) return;
          e.currentTarget.style.background = "rgba(139,92,246,0.08)";
          e.currentTarget.style.borderColor = "rgba(139,92,246,0.3)";
        }}
      >
        {isSharing ? (
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
        ) : (
          <Share2 size={14} strokeWidth={2.2} />
        )}
        {shareLabel}
      </button>

      {/* Spin animation for the Share button loader */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </motion.div>
  );
}

// ─── Create 3D Video Walkthrough CTA ────────────────────────────────────────
// Purple gradient hero card with hover lift + sparkle/video icon. Appears in
// the Media tab when a 3D model exists but no walkthrough has been generated.
function CreateVideoCTA({
  onClick,
  isSubmitting,
  ctaLabel,
  ctaDesc,
  submittingLabel,
}: {
  onClick: () => void;
  isSubmitting: boolean;
  ctaLabel: string;
  ctaDesc: string;
  submittingLabel: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      aria-label={ctaLabel}
    >
      <motion.button
        type="button"
        onClick={onClick}
        disabled={isSubmitting}
        whileHover={isSubmitting ? undefined : { y: -2, scale: 1.005 }}
        whileTap={isSubmitting ? undefined : { scale: 0.995 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 22,
          padding: "26px 28px",
          borderRadius: 16,
          background: "linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(99,102,241,0.14) 50%, rgba(168,85,247,0.16) 100%)",
          border: "1px solid rgba(168,85,247,0.35)",
          boxShadow: "0 10px 50px rgba(139,92,246,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
          cursor: isSubmitting ? "wait" : "pointer",
          textAlign: "left",
          color: COLORS.TEXT_PRIMARY,
          opacity: isSubmitting ? 0.85 : 1,
          transition: "box-shadow 0.25s ease, border-color 0.25s ease",
        }}
        onMouseEnter={e => {
          if (isSubmitting) return;
          e.currentTarget.style.borderColor = "rgba(168,85,247,0.55)";
          e.currentTarget.style.boxShadow = "0 14px 60px rgba(139,92,246,0.32), inset 0 1px 0 rgba(255,255,255,0.08)";
        }}
        onMouseLeave={e => {
          if (isSubmitting) return;
          e.currentTarget.style.borderColor = "rgba(168,85,247,0.35)";
          e.currentTarget.style.boxShadow = "0 10px 50px rgba(139,92,246,0.18), inset 0 1px 0 rgba(255,255,255,0.06)";
        }}
      >
        {/* Icon badge */}
        <div style={{
          width: 60,
          height: 60,
          borderRadius: 16,
          background: "linear-gradient(135deg, #8B5CF6 0%, #6366F1 50%, #A855F7 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 6px 20px rgba(139,92,246,0.45), inset 0 1px 0 rgba(255,255,255,0.25)",
          position: "relative",
        }}>
          {isSubmitting ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            >
              <Loader2 size={26} color="#fff" strokeWidth={2.2} />
            </motion.div>
          ) : (
            <>
              <Video size={26} color="#fff" strokeWidth={2.2} />
              <motion.div
                animate={{ scale: [1, 1.18, 1], opacity: [0.55, 1, 0.55] }}
                transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.16)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(255,255,255,0.35)",
                }}
              >
                <Sparkles size={10} color="#fff" />
              </motion.div>
            </>
          )}
        </div>

        {/* Text + arrow */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 17,
            fontWeight: 700,
            color: COLORS.TEXT_PRIMARY,
            letterSpacing: "-0.01em",
            marginBottom: 4,
          }}>
            {isSubmitting ? submittingLabel : ctaLabel}
            {!isSubmitting && (
              <motion.span
                aria-hidden="true"
                animate={{ x: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                style={{ color: "#C4B5FD", fontSize: 18, fontWeight: 700 }}
              >
                →
              </motion.span>
            )}
          </div>
          <div style={{
            fontSize: 12,
            color: "rgba(220,215,240,0.75)",
            lineHeight: 1.55,
            maxWidth: 540,
          }}>
            {ctaDesc}
          </div>
        </div>

        {/* Status badge */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(168,85,247,0.18)",
            border: "1px solid rgba(168,85,247,0.35)",
            color: "#DDD6FE",
            textTransform: "uppercase",
          }}>
            HD · 1080p
          </span>
          <span style={{
            fontSize: 9,
            fontWeight: 600,
            color: "rgba(196,181,253,0.7)",
            letterSpacing: "0.04em",
          }}>
            Kling 3.0 · ~3-8 min
          </span>
        </div>
      </motion.button>
    </motion.section>
  );
}
