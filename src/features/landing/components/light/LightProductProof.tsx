"use client";

import { useRef, useEffect, useState } from "react";
import { Play } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

const VIDEO_URL =
  "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos/text-to-concept-building.mp4";

export function LightProductProof() {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [manualPlay, setManualPlay] = useState(false);

  // Detect reduced motion preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // IntersectionObserver for lazy autoplay
  useEffect(() => {
    if (prefersReducedMotion && !manualPlay) return;

    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.load();
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [prefersReducedMotion, manualPlay]);

  const handleManualPlay = () => {
    setManualPlay(true);
    const video = videoRef.current;
    if (video) {
      video.load();
      video.play().catch(() => {});
    }
  };

  return (
    <section
      style={{
        padding: "96px 24px",
        background: "var(--light-surface)",
      }}
    >
      <div
        style={{
          maxWidth: 900,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        {/* Mono label */}
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--light-soft)",
            fontFamily: "var(--font-jetbrains), monospace",
            margin: "0 0 24px",
          }}
        >
          {t("light.proofLabel")}
        </p>

        {/* Video container */}
        <div
          ref={containerRef}
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--light-border)",
            boxShadow:
              "0 1px 2px rgba(26,31,46,0.04), 0 4px 12px rgba(26,31,46,0.06)",
            background: "#000",
          }}
        >
          <video
            ref={videoRef}
            src={prefersReducedMotion && !manualPlay ? undefined : VIDEO_URL}
            muted
            playsInline
            loop
            preload="none"
            aria-label={t("light.proofAriaLabel")}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />

          {/* Reduced motion: show play button overlay */}
          {prefersReducedMotion && !manualPlay && (
            <button
              onClick={handleManualPlay}
              aria-label={t("light.proofAriaLabel")}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(26, 31, 46, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "var(--light-ink)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Play
                  size={24}
                  fill="#fff"
                  style={{ color: "#fff", marginLeft: 2 }}
                />
              </div>
            </button>
          )}
        </div>

        {/* Caption */}
        <div style={{ marginTop: 24 }}>
          <p
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: "var(--light-ink)",
              fontFamily: "var(--font-dm-sans), sans-serif",
              margin: "0 0 4px",
            }}
          >
            {t("light.proofTitle")}
          </p>
          <p
            style={{
              fontSize: 14,
              fontWeight: 400,
              color: "var(--light-soft)",
              fontFamily: "var(--font-dm-sans), sans-serif",
              margin: 0,
            }}
          >
            {t("light.proofSubtitle")}
          </p>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          section:has(> div > [aria-label]) {
            padding: 64px 24px !important;
          }
        }
        @media (max-width: 480px) {
          section:has(> div > [aria-label]) {
            padding: 48px 16px !important;
          }
        }
      `}</style>
    </section>
  );
}
