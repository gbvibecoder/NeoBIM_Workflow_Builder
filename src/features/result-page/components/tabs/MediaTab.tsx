"use client";

import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Maximize2, X } from "lucide-react";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface MediaTabProps {
  data: ResultPageData;
}

/**
 * Media tab — jargon stripped per D2/D4:
 *  - Removed "AI Concept Art — Not Photorealistic" ConfidenceBadge
 *  - Removed "Cost: $X.XX" line in video metadata strip
 *  - Removed "HD · 1080p" / "Kling 3.0 · ~3-8 min" chips
 *  - Header video lives in HeroVideo; this tab carries the gallery + svg
 */
export function MediaTab({ data }: MediaTabProps) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const sanitizedSvg = useMemo(
    () =>
      typeof window !== "undefined" && data.svgContent
        ? DOMPurify.sanitize(data.svgContent, { USE_PROFILES: { svg: true, svgFilters: true } })
        : "",
    [data.svgContent],
  );

  const hasContent =
    !!data.videoData?.videoUrl ||
    data.allImageUrls.length > 0 ||
    !!data.svgContent;

  if (!hasContent) {
    return (
      <p style={{ padding: 60, textAlign: "center", color: "rgba(245,245,250,0.5)", fontSize: 13 }}>
        No media artifacts yet for this run.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {data.videoData?.videoUrl ? (
        <section>
          <SectionTitle>Video walkthrough</SectionTitle>
          <div
            style={{
              borderRadius: 14,
              overflow: "hidden",
              background: "#000",
              boxShadow: "0 12px 36px rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <video
              src={data.videoData.videoUrl}
              controls
              autoPlay
              muted
              playsInline
              crossOrigin="anonymous"
              style={{ width: "100%", maxHeight: "min(58vh, 620px)", display: "block" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              marginTop: 12,
              padding: "10px 14px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10,
              flexWrap: "wrap",
            }}
          >
            <Meta label="Duration" value={`${data.videoData.durationSeconds}s`} />
            <Meta label="Shots" value={String(data.videoData.shotCount)} />
            {data.videoData.pipeline ? <Meta label="Pipeline" value={data.videoData.pipeline} /> : null}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {data.videoData.downloadUrl ? (
              <a
                href={data.videoData.downloadUrl}
                download={data.videoData.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  borderRadius: 10,
                  background: "rgba(16,185,129,0.12)",
                  border: "1px solid rgba(16,185,129,0.32)",
                  color: "#10B981",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                <Download size={14} aria-hidden="true" />
                Download MP4
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {data.allImageUrls.length > 0 ? (
        <section>
          <SectionTitle>Images & renders</SectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                data.allImageUrls.length === 1
                  ? "1fr"
                  : "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 14,
            }}
          >
            {data.allImageUrls.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setLightbox(url)}
                aria-label={`Open render ${i + 1}`}
                style={{
                  position: "relative",
                  borderRadius: 14,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.06)",
                  cursor: "zoom-in",
                  padding: 0,
                  background: "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Render ${i + 1}`}
                  style={{
                    width: "100%",
                    height: 220,
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(transparent 60%, rgba(0,0,0,0.55))",
                    pointerEvents: "none",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    bottom: 10,
                    left: 12,
                    color: "#F5F5FA",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Render {i + 1}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {data.svgContent ? (
        <section>
          <SectionTitle>Floor plan</SectionTitle>
          <div
            style={{
              background: "#FFFFFF",
              borderRadius: 14,
              padding: 20,
              minHeight: 300,
              maxHeight: "min(60vh, 720px)",
              overflow: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
        </section>
      ) : null}

      <AnimatePresence>
        {lightbox ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 200,
              background: "rgba(0,0,0,0.94)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "zoom-out",
              padding: "clamp(16px, 4vw, 40px)",
            }}
          >
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setLightbox(null)}
              style={{
                position: "absolute",
                top: 20,
                right: 20,
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                padding: 8,
                color: "#F5F5FA",
                cursor: "pointer",
              }}
            >
              <X size={20} />
            </button>
            <a
              href={lightbox}
              download
              onClick={e => e.stopPropagation()}
              style={{
                position: "absolute",
                top: 20,
                left: 20,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.18)",
                color: "#F5F5FA",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <Download size={14} aria-hidden="true" />
              Download
            </a>
            <motion.img
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              src={lightbox}
              alt="Full preview"
              style={{
                maxWidth: "92vw",
                maxHeight: "88vh",
                objectFit: "contain",
                borderRadius: 8,
              }}
              onClick={e => e.stopPropagation()}
            />
            <Maximize2 style={{ display: "none" }} aria-hidden="true" />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          color: "rgba(245,245,250,0.5)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12, color: "#F5F5FA", fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        marginBottom: 14,
        fontSize: 14,
        fontWeight: 600,
        color: "#F5F5FA",
        letterSpacing: "-0.005em",
      }}
    >
      {children}
    </h3>
  );
}
