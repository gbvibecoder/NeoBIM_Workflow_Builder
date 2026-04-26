"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Maximize2 } from "lucide-react";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";

interface HeroImageProps {
  imageUrls: string[];
}

export function HeroImage({ imageUrls }: HeroImageProps) {
  const accent = getWorkflowAccent("image");
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const url = imageUrls[Math.min(activeIdx, imageUrls.length - 1)];

  if (!url) return null;

  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div
        style={{
          position: "relative",
          borderRadius: 18,
          overflow: "hidden",
          background: "#000",
          boxShadow: accent.glow,
          border: `1px solid ${accent.ring}`,
          minHeight: 300,
          maxHeight: "min(60vh, 720px)",
          cursor: "zoom-in",
        }}
        onClick={() => setLightbox(url)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`Render ${activeIdx + 1}`}
          style={{
            width: "100%",
            height: "100%",
            maxHeight: "min(60vh, 720px)",
            objectFit: "contain",
            display: "block",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            display: "flex",
            gap: 8,
          }}
        >
          <a
            href={url}
            download={`render_${activeIdx + 1}.png`}
            onClick={e => e.stopPropagation()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.6)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#F5F5FA",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              backdropFilter: "blur(12px)",
            }}
          >
            <Download size={13} aria-hidden="true" />
            Download
          </a>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setLightbox(url);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.6)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#F5F5FA",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              backdropFilter: "blur(12px)",
            }}
          >
            <Maximize2 size={13} aria-hidden="true" />
            Fullscreen
          </button>
        </div>
      </div>
      {imageUrls.length > 1 ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {imageUrls.map((u, i) => (
            <button
              key={u}
              type="button"
              aria-label={`Show render ${i + 1}`}
              onClick={() => setActiveIdx(i)}
              style={{
                width: 72,
                height: 48,
                borderRadius: 8,
                overflow: "hidden",
                border: i === activeIdx ? `2px solid ${accent.base}` : "2px solid rgba(255,255,255,0.08)",
                opacity: i === activeIdx ? 1 : 0.55,
                padding: 0,
                cursor: "pointer",
                background: "none",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </button>
          ))}
        </div>
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
            aria-label="Image preview"
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
