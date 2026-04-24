"use client";

/**
 * Renders a video whose segments stream in as the QStash worker finishes
 * each Kling task. As soon as ONE segment is playable the user can hit play
 * — the rest slot into the queue as they complete.
 *
 * Shared between VideoBody (in-canvas view), MediaTab (results showcase),
 * and HeroSection (follow-up migration). Keeping the logic in one place
 * prevents the three sites from drifting (a real risk per the previous
 * audit's Issue #11 finding: phase indicators differed between VideoBody
 * and MediaTab).
 *
 * State contract:
 *   • `view`        — VideoJobClientView from useVideoJob
 *   • `heightPx`    — video element height (defaults to 180 for canvas use)
 *   • `compact`     — smaller text/chip sizes for the in-canvas render
 *
 * Behavior:
 *   • Pure generating (no complete segments yet) → progress card.
 *   • Partial (≥1 complete, ≥1 still rendering) → player on complete segments
 *     + ghost chip(s) for pending ones.
 *   • All complete → normal sequential playback with segment skipper.
 *   • All failed → error card with failure reason.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Film, CheckCircle2, XCircle, Clock } from "lucide-react";
import type { VideoJobClientView } from "@/types/video-job";
import { GeneratingVideoBackdrop } from "@/shared/components/ui/GeneratingVideoBackdrop";

export interface SegmentedVideoPlayerProps {
  view: VideoJobClientView;
  heightPx?: number;
  compact?: boolean;
}

export function SegmentedVideoPlayer({
  view,
  heightPx = 180,
  compact = true,
}: SegmentedVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const playable = view.playableSegments;
  const pendingCount = view.segments.length - playable.length;
  const hasAnyPlayable = playable.length > 0;
  const allFailed = view.status === "failed" && !hasAnyPlayable;

  // Clamp at render time rather than via setState-in-effect. This is the
  // safe-index we pass to the player; if a new segment lands while we're
  // past the last playable slot, render still picks the last available one.
  const safeIdx = Math.min(Math.max(currentIdx, 0), Math.max(0, playable.length - 1));

  const handleEnded = useCallback(() => {
    if (safeIdx < playable.length - 1) {
      setCurrentIdx(safeIdx + 1);
    } else {
      // Last playable segment finished. If more are pending we stay paused
      // at the end of the last one; the next one auto-mounts when ready.
      setIsPlaying(false);
    }
  }, [safeIdx, playable.length]);

  // Auto-play next segment after it loads.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isPlaying) return;
    v.load();
    const onReady = () => {
      v.play().catch(() => {
        /* autoplay blocked; user clicks play */
      });
    };
    if (v.readyState >= 1) onReady();
    else {
      v.addEventListener("loadedmetadata", onReady, { once: true });
      return () => v.removeEventListener("loadedmetadata", onReady);
    }
  }, [currentIdx, isPlaying]);

  // ── All-failed card ───────────────────────────────────────────────────
  if (allFailed) {
    return (
      <div
        style={{
          padding: "16px",
          borderRadius: 8,
          background: "rgba(239,68,68,0.06)",
          border: "1px solid rgba(239,68,68,0.2)",
          textAlign: "center",
          color: "#FCA5A5",
          fontSize: compact ? 11 : 13,
          lineHeight: 1.5,
        }}
      >
        <Film size={compact ? 16 : 20} style={{ marginBottom: 6 }} />
        <div style={{ fontWeight: 600 }}>Video generation failed</div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          {view.failureReason ?? "All segments failed"}
        </div>
      </div>
    );
  }

  // ── Pure generating card (no segments playable yet) ───────────────────
  // Phase 4 — wraps the existing loading UI with a blurred-looping sample
  // video backdrop so the user sees ambient motion during the 2–8 min Kling
  // wait, not a static spinner. Real video takes over when segments complete.
  if (!hasAnyPlayable) {
    return (
      <GeneratingVideoBackdrop compact={compact}>
        <div
          style={{
            padding: compact ? "20px 16px" : "28px 20px",
            textAlign: "center",
          }}
        >
          <Loader2
            size={compact ? 18 : 26}
            style={{
              color: "#00F5FF",
              animation: "spin 1.5s linear infinite",
              marginBottom: 10,
            }}
          />
          <div
            style={{
              fontSize: compact ? 11 : 13,
              fontWeight: 600,
              color: "#00F5FF",
              marginBottom: 6,
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            Generating walkthrough…
          </div>
          <div
            style={{
              fontSize: compact ? 9 : 11,
              color: "#D0D0E0",
              marginBottom: 10,
            }}
          >
            {view.segments.length > 1
              ? `${view.segments.length} segments · streams in as each completes`
              : "1 segment"}
          </div>
          <ProgressBar value={view.progress} />
          <SegmentChipRow segments={view.segments} compact={compact} />
          <style>{`@keyframes spin { from {transform:rotate(0deg)} to {transform:rotate(360deg)} }`}</style>
        </div>
      </GeneratingVideoBackdrop>
    );
  }

  // ── At least one segment playable → render player + chips ────────────
  const currentSegment = playable[safeIdx];

  return (
    <div>
      <div
        style={{
          position: "relative",
          borderRadius: 8,
          overflow: "hidden",
          background: "#000",
          marginBottom: 8,
        }}
      >
        <video
          ref={videoRef}
          src={currentSegment.url}
          controls
          preload="metadata"
          crossOrigin="anonymous"
          playsInline
          onEnded={handleEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          style={{
            width: "100%",
            height: heightPx,
            objectFit: "cover",
            display: "block",
            borderRadius: 8,
          }}
        />
        {/* Segment quick-jump chips overlayed on the player. */}
        {playable.length > 1 && (
          <div style={{ position: "absolute", top: 6, left: 6, display: "flex", gap: 3 }}>
            {playable.map((s, i) => (
              <button
                key={`${s.kind}-${i}`}
                onClick={() => {
                  setCurrentIdx(i);
                  setIsPlaying(true);
                }}
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  background:
                    i === currentIdx
                      ? "rgba(0,245,255,0.85)"
                      : "rgba(0,0,0,0.6)",
                  border: "none",
                  fontSize: compact ? 8 : 10,
                  fontWeight: 600,
                  color: i === currentIdx ? "#000" : "#ccc",
                  cursor: "pointer",
                  backdropFilter: "blur(4px)",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {labelForKind(s.kind)} ({s.durationSeconds}s)
              </button>
            ))}
          </div>
        )}
      </div>

      <SegmentChipRow segments={view.segments} compact={compact} />

      {pendingCount > 0 && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.2)",
            fontSize: compact ? 9 : 11,
            color: "#C4B5FD",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Loader2 size={10} style={{ animation: "spin 1.5s linear infinite" }} />
          {pendingCount} more segment{pendingCount > 1 ? "s" : ""} rendering — slot in automatically when ready.
        </div>
      )}

      <style>{`@keyframes spin { from {transform:rotate(0deg)} to {transform:rotate(360deg)} }`}</style>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "rgba(255,255,255,0.05)",
          overflow: "hidden",
          marginBottom: 4,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.max(clamped, 3)}%`,
            background: "linear-gradient(90deg, #00F5FF, #8B5CF6)",
            borderRadius: 3,
            transition: "width 0.8s ease-out",
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#00F5FF",
          fontFamily: "var(--font-jetbrains), monospace",
        }}
      >
        {clamped}%
      </div>
    </div>
  );
}

function SegmentChipRow({
  segments,
  compact,
}: {
  segments: VideoJobClientView["segments"];
  compact: boolean;
}) {
  if (segments.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
      {segments.map((s, i) => {
        const Icon =
          s.status === "complete"
            ? CheckCircle2
            : s.status === "failed"
              ? XCircle
              : s.status === "processing"
                ? Loader2
                : Clock;
        const color =
          s.status === "complete"
            ? "#10B981"
            : s.status === "failed"
              ? "#EF4444"
              : s.status === "processing"
                ? "#00F5FF"
                : "#8888A0";
        return (
          <span
            key={`${s.kind}-${i}`}
            style={{
              padding: "2px 7px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${color}40`,
              fontSize: compact ? 8 : 10,
              fontWeight: 500,
              color,
              fontFamily: "var(--font-jetbrains), monospace",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon
              size={compact ? 9 : 11}
              style={
                s.status === "processing"
                  ? { animation: "spin 1.5s linear infinite" }
                  : undefined
              }
            />
            {labelForKind(s.kind)} {s.durationSeconds}s
          </span>
        );
      })}
    </div>
  );
}

function labelForKind(kind: "exterior" | "interior" | "single"): string {
  if (kind === "exterior") return "Exterior";
  if (kind === "interior") return "Interior";
  return "Walkthrough";
}
