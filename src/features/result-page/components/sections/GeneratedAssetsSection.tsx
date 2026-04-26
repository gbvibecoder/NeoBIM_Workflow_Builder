"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Download, X } from "lucide-react";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { SectionHeader } from "@/features/result-page/components/sections/SectionHeader";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface GeneratedAssetsSectionProps {
  data: ResultPageData;
  /** Phase 4.1 Fix 3 — orchestrator-allocated section number. */
  index: number;
}

/** Phase 4.1 Fix 3 eligibility predicate. */
export function isGeneratedAssetsEligible(data: ResultPageData): boolean {
  return data.allImageUrls.length > 0;
}

/**
 * Image gallery + supporting renders. Only renders when there are 1+ image
 * artifacts beyond the hero slot. The hero may already show one; this
 * section shows the rest as a richer grid with the BOQ visualizer's
 * card-on-light-bg aesthetic.
 */
export function GeneratedAssetsSection({ data, index }: GeneratedAssetsSectionProps) {
  const urls = data.allImageUrls;
  const [lightbox, setLightbox] = useState<string | null>(null);
  if (urls.length === 0) return null;

  return (
    <ScrollReveal>
      <section id="generated-assets" style={{ padding: "0 clamp(12px, 3vw, 24px)" }}>
        <SectionHeader
          index={index}
          icon={<ImageIcon size={16} />}
          label="Renders"
          title={urls.length === 1 ? "One render this round" : `${urls.length} renders, drying`}
          subtitle="Hi-resolution PNGs. Click a render to inspect, hover to grab."
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: urls.length === 1 ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {urls.map((url, i) => (
            <motion.button
              key={url}
              type="button"
              onClick={() => setLightbox(url)}
              aria-label={`Open render ${i + 1}`}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, delay: 0.04 * i, ease: [0.25, 0.46, 0.45, 0.94] }}
              style={{
                position: "relative",
                background: "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.06)",
                borderRadius: 16,
                overflow: "hidden",
                padding: 0,
                cursor: "zoom-in",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                aspectRatio: urls.length === 1 ? "16 / 9" : "4 / 3",
                transition: "all 0.2s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Render ${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.55) 100%)",
                  pointerEvents: "none",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: 14,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#FFFFFF",
                  letterSpacing: "0.02em",
                }}
              >
                Render {i + 1}
              </span>
              <a
                href={url}
                download={`render_${i + 1}.png`}
                onClick={e => e.stopPropagation()}
                aria-label={`Download render ${i + 1}`}
                style={{
                  position: "absolute",
                  bottom: 10,
                  right: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.92)",
                  color: "#111827",
                  fontSize: 11,
                  fontWeight: 600,
                  textDecoration: "none",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
                }}
              >
                <Download size={12} aria-hidden="true" />
                PNG
              </a>
            </motion.button>
          ))}
        </div>

        <AnimatePresence>
          {lightbox ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="dialog"
              aria-modal="true"
              aria-label="Render preview"
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
              <button
                type="button"
                aria-label="Close preview"
                onClick={e => {
                  e.stopPropagation();
                  setLightbox(null);
                }}
                style={{
                  position: "absolute",
                  top: 20,
                  right: 20,
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 10,
                  padding: 8,
                  color: "#FFFFFF",
                  cursor: "pointer",
                }}
              >
                <X size={18} />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
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
      </section>
    </ScrollReveal>
  );
}
