"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Maximize2, X, Download, ExternalLink } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { COLORS } from "../constants";
import type { ShowcaseData } from "../useShowcaseData";

interface MediaTabProps {
  data: ShowcaseData;
  onExpandVideo: () => void;
}

export function MediaTab({ data, onExpandVideo }: MediaTabProps) {
  const { t } = useLocale();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
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
        </section>
      )}

      {/* Image Gallery */}
      {data.allImageUrls.length > 0 && (
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <SectionTitle>{t('showcase.imagesRenders')}</SectionTitle>
            <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED }}>
              {data.allImageUrls.length} {data.allImageUrls.length > 1 ? t('showcase.conceptRenders') : t('showcase.conceptRender')}
            </span>
          </div>
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
                style={{
                  borderRadius: 10,
                  overflow: "hidden",
                  position: "relative",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                }}
                whileHover={{ scale: 1.01, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Render ${i + 1}`}
                  onClick={() => setLightboxUrl(url)}
                  style={{
                    width: "100%",
                    height: data.allImageUrls.length === 1 ? 400 : 220,
                    objectFit: "cover",
                    display: "block",
                    cursor: "pointer",
                  }}
                />
                {/* Action overlay */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    padding: 8,
                    display: "flex",
                    gap: 4,
                    opacity: 0,
                    transition: "opacity 0.2s ease",
                  }}
                  className="media-actions"
                  onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
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
                {/* Bottom gradient with label */}
                <div style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: "20px 12px 8px",
                  background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
                    {t('showcase.conceptRenderTitle')} {data.allImageUrls.length > 1 ? i + 1 : ""}
                  </span>
                  <a
                    href={url}
                    download={`concept_render_${i + 1}.png`}
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      color: COLORS.CYAN,
                      fontSize: 9,
                      fontWeight: 600,
                      textDecoration: "none",
                      cursor: "pointer",
                    }}
                  >
                    <Download size={10} />
                    Download
                  </a>
                </div>
              </motion.div>
            ))}
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
              background: "rgba(0,0,0,0.92)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "zoom-out",
              padding: 40,
            }}
          >
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
                Download
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
