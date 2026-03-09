"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Maximize2, X } from "lucide-react";
import { COLORS } from "../constants";
import type { ShowcaseData } from "../useShowcaseData";

interface MediaTabProps {
  data: ShowcaseData;
  onExpandVideo: () => void;
}

export function MediaTab({ data, onExpandVideo }: MediaTabProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Video Section */}
      {data.videoData?.videoUrl && (
        <section>
          <SectionTitle>Video Walkthrough</SectionTitle>
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
              src={data.videoData.videoUrl}
              style={{
                width: "100%",
                maxHeight: 500,
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
              <button
                onClick={onExpandVideo}
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
                }}
              >
                <Maximize2 size={10} />
                Theater Mode
              </button>
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
              { label: "Duration", value: `${data.videoData.durationSeconds}s` },
              { label: "Shots", value: String(data.videoData.shotCount) },
              ...(data.videoData.pipeline ? [{ label: "Pipeline", value: data.videoData.pipeline }] : []),
              ...(data.videoData.costUsd != null ? [{ label: "Cost", value: `$${data.videoData.costUsd.toFixed(2)}` }] : []),
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
        </section>
      )}

      {/* Image Gallery */}
      {data.allImageUrls.length > 0 && (
        <section>
          <SectionTitle>Images & Renders</SectionTitle>
          <div style={{
            display: "grid",
            gridTemplateColumns: data.allImageUrls.length === 1
              ? "1fr"
              : "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}>
            {data.allImageUrls.map((url, i) => (
              <motion.div
                key={url}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.05 * i }}
                onClick={() => setLightboxUrl(url)}
                style={{
                  borderRadius: 10,
                  overflow: "hidden",
                  cursor: "pointer",
                  position: "relative",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                }}
                whileHover={{ scale: 1.02, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Render ${i + 1}`}
                  style={{
                    width: "100%",
                    height: data.allImageUrls.length === 1 ? 400 : 220,
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* SVG Floor Plan */}
      {data.svgContent && (
        <section>
          <SectionTitle>Floor Plan</SectionTitle>
          <div style={{
            background: "#fff",
            borderRadius: 10,
            padding: 24,
            overflow: "auto",
          }}>
            <div
              dangerouslySetInnerHTML={{ __html: data.svgContent }}
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
              background: "rgba(0,0,0,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "zoom-out",
              padding: 40,
            }}
          >
            <button
              onClick={() => setLightboxUrl(null)}
              style={{
                position: "absolute",
                top: 20,
                right: 20,
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
