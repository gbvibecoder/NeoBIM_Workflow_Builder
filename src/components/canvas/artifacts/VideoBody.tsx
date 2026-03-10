"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { Download, Maximize2, Clock, DollarSign, Clapperboard, SkipForward, Loader2, Film } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useExecutionStore } from "@/stores/execution-store";
import type { VideoArtifactData, VideoSegment } from "@/types/execution";

interface VideoBodyProps {
  data: VideoArtifactData;
  nodeId?: string;
}

export function VideoBody({ data: rawData, nodeId }: VideoBodyProps) {
  // Guard against null/undefined data
  const data = rawData ?? ({} as VideoArtifactData);
  const setVideoPlayerNodeId = useUIStore(s => s.setVideoPlayerNodeId);
  const videoGenProgress = useExecutionStore(s => nodeId ? s.videoGenProgress.get(nodeId) : undefined);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Check if video is still generating
  const artData = data as unknown as Record<string, unknown>;
  const isGenerating = artData?.videoGenerationStatus === "processing" ||
    artData?.videoGenerationStatus === "client-rendering" ||
    (videoGenProgress && (videoGenProgress.status === "processing" || videoGenProgress.status === "rendering"));
  const isClientRendering = artData?.videoGenerationStatus === "client-rendering" ||
    videoGenProgress?.status === "rendering";
  const isFailed = videoGenProgress?.status === "failed";
  const progress = videoGenProgress?.progress ?? (artData?.generationProgress as number) ?? 0;
  const currentPhase = videoGenProgress?.phase;

  const segments: VideoSegment[] = data?.segments ?? [];
  const hasSegments = segments.length > 1;
  const hasVideoUrl = !!data?.videoUrl;

  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const currentSegment = hasSegments ? segments[currentSegmentIndex] : null;
  const currentVideoUrl = hasSegments
    ? currentSegment?.videoUrl ?? data?.videoUrl
    : data?.videoUrl;

  const totalDuration = data?.durationSeconds ?? 0;
  const shotCount = data?.shotCount ?? (hasSegments ? segments.length : 1);
  const costUsd = data?.costUsd;

  // When a segment ends, auto-advance to next segment
  const handleVideoEnded = useCallback(() => {
    if (hasSegments && currentSegmentIndex < segments.length - 1) {
      setCurrentSegmentIndex(prev => prev + 1);
    } else {
      setCurrentSegmentIndex(0);
      setIsPlaying(false);
    }
  }, [hasSegments, currentSegmentIndex, segments.length]);

  // Auto-play when segment changes — wait for loadedmetadata before play
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasSegments || !isPlaying) return;

    video.load();

    const onReady = () => {
      video.play().catch((err) => {
        console.warn("[VideoBody] Auto-play blocked:", err.message);
      });
    };

    if (video.readyState >= 1) {
      onReady();
    } else {
      video.addEventListener("loadedmetadata", onReady, { once: true });
      return () => video.removeEventListener("loadedmetadata", onReady);
    }
  }, [currentSegmentIndex, hasSegments, isPlaying]);

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);

  const skipToSegment = (index: number) => {
    setCurrentSegmentIndex(index);
    setIsPlaying(true);
  };

  // ── Generating State UI ──────────────────────────────────────────────
  if (isGenerating || (isFailed && !hasVideoUrl)) {
    return (
      <div style={{ padding: "0 12px 10px 14px" }}>
        <div style={{
          borderRadius: 8,
          overflow: "hidden",
          background: "linear-gradient(135deg, rgba(0,245,255,0.03), rgba(139,92,246,0.03))",
          border: "1px solid rgba(0,245,255,0.12)",
          padding: "20px 16px",
          textAlign: "center",
        }}>
          {/* Animated icon */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 12,
          }}>
            {isFailed ? (
              <div style={{
                width: 40, height: 40, borderRadius: "50%",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Film size={18} style={{ color: "#EF4444" }} />
              </div>
            ) : (
              <div style={{
                width: 40, height: 40, borderRadius: "50%",
                background: "rgba(0,245,255,0.08)",
                border: "1px solid rgba(0,245,255,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "pulse 2s ease-in-out infinite",
              }}>
                <Loader2 size={18} style={{
                  color: "#00F5FF",
                  animation: "spin 1.5s linear infinite",
                }} />
              </div>
            )}
          </div>

          {/* Status text */}
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: isFailed ? "#EF4444" : "#00F5FF",
            marginBottom: 4,
            fontFamily: "'Space Mono', monospace",
          }}>
            {isFailed ? "Generation Failed" : "Generating Video..."}
          </div>

          <div style={{
            fontSize: 9,
            color: "#5C5C78",
            marginBottom: 12,
            lineHeight: 1.4,
          }}>
            {isFailed
              ? (videoGenProgress?.failureMessage ?? "Unknown error")
              : isClientRendering
                ? `Three.js walkthrough${currentPhase ? ` — ${currentPhase}` : ""}`
                : "15s AEC walkthrough (exterior + interior)"
            }
          </div>

          {/* Progress bar */}
          {!isFailed && (
            <div style={{ marginBottom: 8 }}>
              <div style={{
                height: 6,
                borderRadius: 3,
                background: "rgba(255,255,255,0.05)",
                overflow: "hidden",
                marginBottom: 4,
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.max(progress, 3)}%`,
                  background: "linear-gradient(90deg, #00F5FF, #8B5CF6)",
                  borderRadius: 3,
                  transition: "width 0.8s ease-out",
                }} />
              </div>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#00F5FF",
                fontFamily: "'Space Mono', monospace",
              }}>
                {progress}%
              </div>
            </div>
          )}

          {/* Phase/Segment status indicators */}
          {!isFailed && (
            <div style={{
              display: "flex",
              gap: 4,
              justifyContent: "center",
              flexWrap: "wrap",
            }}>
              {isClientRendering ? (
                // 4-phase indicators for Three.js client rendering
                ["Exterior Pull-in", "Building Orbit", "Interior Walkthrough", "Section Rise"].map((phase) => {
                  const phases = ["Exterior Pull-in", "Building Orbit", "Interior Walkthrough", "Section Rise"];
                  const isActive = currentPhase === phase;
                  const isPast = phases.indexOf(phase) < phases.indexOf(currentPhase ?? "");
                  return (
                    <span key={phase} style={{
                      padding: "2px 6px", borderRadius: 3,
                      background: isActive ? "rgba(0,245,255,0.1)" : isPast ? "rgba(139,92,246,0.06)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${isActive ? "rgba(0,245,255,0.2)" : isPast ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.06)"}`,
                      fontSize: 7, fontWeight: 500,
                      color: isActive ? "#00F5FF" : isPast ? "#8B5CF6" : "#3C3C50",
                      fontFamily: "'Space Mono', monospace",
                    }}>
                      {phase} {isPast ? "✓" : isActive ? "..." : ""}
                    </span>
                  );
                })
              ) : (
                // 2-segment indicators for Kling API
                <>
                  <span style={{
                    padding: "2px 6px", borderRadius: 3,
                    background: progress >= 33 ? "rgba(0,245,255,0.1)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${progress >= 33 ? "rgba(0,245,255,0.2)" : "rgba(255,255,255,0.06)"}`,
                    fontSize: 8, fontWeight: 500,
                    color: progress >= 33 ? "#00F5FF" : "#3C3C50",
                    fontFamily: "'Space Mono', monospace",
                  }}>
                    Exterior 5s {progress >= 33 ? (progress >= 50 ? "done" : "...") : "queued"}
                  </span>
                  <span style={{
                    padding: "2px 6px", borderRadius: 3,
                    background: progress >= 67 ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${progress >= 67 ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)"}`,
                    fontSize: 8, fontWeight: 500,
                    color: progress >= 67 ? "#8B5CF6" : "#3C3C50",
                    fontFamily: "'Space Mono', monospace",
                  }}>
                    Interior 10s {progress >= 67 ? (progress >= 90 ? "done" : "...") : "queued"}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Inline CSS for animations */}
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }
        `}</style>
      </div>
    );
  }

  // ── Normal Video Player UI ──────────────────────────────────────────
  return (
    <div style={{ padding: "0 12px 10px 14px" }}>
      {/* Embedded video player */}
      <div style={{
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        background: "#000",
        marginBottom: 8,
      }}>
        {currentVideoUrl ? (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            controls
            preload="metadata"
            crossOrigin="anonymous"
            playsInline
            onEnded={handleVideoEnded}
            onPlay={handlePlay}
            onPause={handlePause}
            style={{
              width: "100%",
              height: 180,
              objectFit: "cover",
              display: "block",
              borderRadius: 8,
            }}
          />
        ) : (
          <div style={{
            width: "100%",
            height: 180,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.3)",
            borderRadius: 8,
            fontSize: 11,
            color: "#5C5C78",
          }}>
            <Film size={16} style={{ marginRight: 6, opacity: 0.5 }} />
            No video available
          </div>
        )}

        {/* Segment indicator overlay */}
        {hasSegments && (
          <div style={{
            position: "absolute",
            top: 6,
            left: 6,
            display: "flex",
            gap: 3,
          }}>
            {segments.map((seg, i) => (
              <button
                key={i}
                onClick={() => skipToSegment(i)}
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: i === currentSegmentIndex
                    ? "rgba(0,245,255,0.85)"
                    : "rgba(0,0,0,0.6)",
                  border: "none",
                  fontSize: 8,
                  fontWeight: 600,
                  color: i === currentSegmentIndex ? "#000" : "#ccc",
                  cursor: "pointer",
                  backdropFilter: "blur(4px)",
                  transition: "all 0.15s ease",
                  fontFamily: "'Space Mono', monospace",
                }}
              >
                {String(seg.label?.split("—")[0]?.trim() ?? `Part ${i + 1}`)} ({seg.durationSeconds}s)
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Segment labels */}
      {hasSegments && (
        <div style={{
          display: "flex",
          gap: 4,
          marginBottom: 6,
        }}>
          {segments.map((seg, i) => (
            <button
              key={i}
              onClick={() => skipToSegment(i)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: "4px 6px",
                borderRadius: 5,
                background: i === currentSegmentIndex
                  ? "rgba(0,245,255,0.1)"
                  : "rgba(255,255,255,0.03)",
                border: `1px solid ${i === currentSegmentIndex ? "rgba(0,245,255,0.25)" : "rgba(255,255,255,0.06)"}`,
                fontSize: 8,
                fontWeight: 500,
                color: i === currentSegmentIndex ? "#00F5FF" : "#5C5C78",
                cursor: "pointer",
                transition: "all 0.15s ease",
                fontFamily: "'Space Mono', monospace",
              }}
            >
              {i < currentSegmentIndex ? null : i === currentSegmentIndex ? (
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#00F5FF", flexShrink: 0 }} />
              ) : (
                <SkipForward size={7} />
              )}
              {String(seg.label ?? `Part ${i + 1}`)}
            </button>
          ))}
        </div>
      )}

      {/* Metadata strip */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
        flexWrap: "wrap",
      }}>
        {/* Duration badge */}
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "2px 7px", borderRadius: 4,
          background: "rgba(0,245,255,0.08)",
          border: "1px solid rgba(0,245,255,0.15)",
          fontSize: 9, fontWeight: 600, color: "#00F5FF",
          fontFamily: "'Space Mono', monospace",
        }}>
          <Clock size={8} />
          {totalDuration}s
        </span>

        {/* Shots badge */}
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "2px 7px", borderRadius: 4,
          background: "rgba(255,191,0,0.08)",
          border: "1px solid rgba(255,191,0,0.15)",
          fontSize: 9, fontWeight: 600, color: "#FFBF00",
          fontFamily: "'Space Mono', monospace",
        }}>
          <Clapperboard size={8} />
          {shotCount} shots
        </span>

        {/* Pipeline */}
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "2px 7px", borderRadius: 4,
          background: "rgba(139,92,246,0.08)",
          border: "1px solid rgba(139,92,246,0.15)",
          fontSize: 9, fontWeight: 500, color: "#8B5CF6",
          fontFamily: "'Space Mono', monospace",
        }}>
          {data?.pipeline?.includes("Three.js") ? "Three.js" : "Kling 3.0"}
        </span>

        {/* Cost badge */}
        {costUsd != null && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "2px 7px", borderRadius: 4,
            background: "rgba(255,191,0,0.08)",
            border: "1px solid rgba(255,191,0,0.15)",
            fontSize: 9, fontWeight: 700, color: "#FFBF00",
            fontFamily: "'Space Mono', monospace",
          }}>
            <DollarSign size={8} />
            ${costUsd.toFixed(2)}
          </span>
        )}
      </div>

      {/* Action row */}
      <div style={{ display: "flex", gap: 6 }}>
        {/* Fullscreen button */}
        {nodeId && (
          <button
            onClick={() => setVideoPlayerNodeId(nodeId)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 6,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 10, fontWeight: 500, color: "#8888A0",
              cursor: "pointer", transition: "all 0.15s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#F0F0F5"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#8888A0"; }}
          >
            <Maximize2 size={10} />
            Fullscreen
          </button>
        )}

        {/* Download button — only show when URL exists */}
        {(data?.downloadUrl || data?.videoUrl) && <a
          href={data?.downloadUrl ?? data?.videoUrl}
          download={data?.name ?? "walkthrough.mp4"}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 6,
            background: "rgba(0,245,255,0.08)",
            border: "1px solid rgba(0,245,255,0.2)",
            fontSize: 10, fontWeight: 500, color: "#00F5FF",
            textDecoration: "none", cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,245,255,0.15)"; e.currentTarget.style.borderColor = "rgba(0,245,255,0.4)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,245,255,0.08)"; e.currentTarget.style.borderColor = "rgba(0,245,255,0.2)"; }}
        >
          <Download size={10} />
          Download
        </a>}
      </div>
    </div>
  );
}
