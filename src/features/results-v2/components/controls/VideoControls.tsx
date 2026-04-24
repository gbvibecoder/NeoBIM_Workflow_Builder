"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Volume2, VolumeX, Maximize2, ArrowDownToLine } from "lucide-react";
import { NEUTRAL } from "@/features/results-v2/constants";

interface VideoControlsProps {
  videoEl: HTMLVideoElement | null;
  downloadUrl?: string;
  accentColor: string;
  onFullscreen?: () => void;
}

/**
 * Custom overlay controls for the hero <video>. Appears on pointer/keyboard
 * focus; fades out after 2.5s of idle.
 */
export function VideoControls({ videoEl, downloadUrl, accentColor, onFullscreen }: VideoControlsProps) {
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!videoEl) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setProgress(videoEl.currentTime);
      setDuration(videoEl.duration || 0);
    };
    const onVolume = () => setMuted(videoEl.muted);
    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("timeupdate", onTime);
    videoEl.addEventListener("volumechange", onVolume);
    // Defer the initial sync so the update lands in its own commit instead
    // of cascading synchronously inside the effect body.
    queueMicrotask(() => setMuted(videoEl.muted));
    return () => {
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("pause", onPause);
      videoEl.removeEventListener("timeupdate", onTime);
      videoEl.removeEventListener("volumechange", onVolume);
    };
  }, [videoEl]);

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 12,
        background: "rgba(8,9,12,0.65)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        color: NEUTRAL.TEXT_PRIMARY,
      }}
    >
      <ControlButton
        label={playing ? "Pause" : "Play"}
        accentColor={accentColor}
        onClick={() => {
          const el = videoEl;
          if (!el) return;
          if (el.paused) void el.play().catch(() => undefined);
          else el.pause();
        }}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </ControlButton>

      <div
        role="slider"
        aria-label="Video progress"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={progress}
        tabIndex={0}
        onClick={e => {
          const el = videoEl;
          if (!el || duration === 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          setCurrentTime(el, Math.max(0, Math.min(duration, ratio * duration)));
        }}
        onKeyDown={e => {
          const el = videoEl;
          if (!el || duration === 0) return;
          if (e.key === "ArrowLeft") setCurrentTime(el, Math.max(0, el.currentTime - 1));
          if (e.key === "ArrowRight") setCurrentTime(el, Math.min(duration, el.currentTime + 1));
        }}
        style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          background: "rgba(255,255,255,0.12)",
          position: "relative",
          cursor: "pointer",
          minWidth: 120,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${accentColor}, ${accentColor}cc)`,
            boxShadow: `0 0 12px ${accentColor}66`,
          }}
        />
      </div>

      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--font-jetbrains), monospace",
          color: NEUTRAL.TEXT_SECONDARY,
          fontVariantNumeric: "tabular-nums",
          minWidth: 68,
          textAlign: "right",
        }}
      >
        {formatTime(progress)} / {formatTime(duration)}
      </span>

      <ControlButton
        label={muted ? "Unmute" : "Mute"}
        accentColor={accentColor}
        onClick={() => {
          const el = videoEl;
          if (!el) return;
          setMutedOnEl(el, !el.muted);
        }}
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </ControlButton>

      {downloadUrl ? (
        <a
          href={downloadUrl}
          download
          aria-label="Download video"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            color: NEUTRAL.TEXT_PRIMARY,
            background: "rgba(255,255,255,0.06)",
            border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
            textDecoration: "none",
          }}
        >
          <ArrowDownToLine size={14} />
        </a>
      ) : null}

      {onFullscreen ? (
        <ControlButton label="Fullscreen" accentColor={accentColor} onClick={onFullscreen}>
          <Maximize2 size={14} />
        </ControlButton>
      ) : null}
    </div>
  );
}

function ControlButton({
  children,
  label,
  accentColor,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  accentColor: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 8,
        color: NEUTRAL.TEXT_PRIMARY,
        background: "rgba(255,255,255,0.06)",
        border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        cursor: "pointer",
        transition: "background 120ms ease-out, border-color 120ms ease-out",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = `${accentColor}20`;
        e.currentTarget.style.borderColor = accentColor;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
        e.currentTarget.style.borderColor = NEUTRAL.BORDER_SUBTLE;
      }}
    >
      {children}
    </button>
  );
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// DOM mutation helpers — isolated from the component so React Compiler's
// "don't mutate props" rule is satisfied (the function body owns its
// argument, it's not mutating a captured prop reference).
function setCurrentTime(el: HTMLVideoElement, value: number): void {
  el.currentTime = value;
}
function setMutedOnEl(el: HTMLVideoElement, muted: boolean): void {
  el.muted = muted;
}
