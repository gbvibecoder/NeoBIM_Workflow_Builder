"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDownToLine, Box, Check, FileText, Film, Image as ImageIcon, Table2, FileSpreadsheet } from "lucide-react";
import { NEUTRAL, MOTION } from "@/features/results-v2/constants";
import type { AccentGradient, ExecutionResult, ResultDownload } from "@/features/results-v2/types";
import { groupDownloads } from "@/features/results-v2/lib/artifact-grouping";
import { PanelHeader } from "@/features/results-v2/components/panels/OverviewPanel";

interface DownloadCenterPanelProps {
  result: ExecutionResult;
  accent: AccentGradient;
}

export function DownloadCenterPanel({ result, accent }: DownloadCenterPanelProps) {
  const reducedMotion = useReducedMotion();
  const groups = groupDownloads(result);
  const flat = result.downloads;
  if (flat.length === 0) return null;

  const order: Array<{ id: ResultDownload["kind"]; label: string; Icon: typeof Film }> = [
    { id: "video", label: "Video", Icon: Film },
    { id: "model3d", label: "3D Model", Icon: Box },
    { id: "drawing", label: "Drawings", Icon: ImageIcon },
    { id: "document", label: "Documents", Icon: FileText },
    { id: "data", label: "Data", Icon: Table2 },
    { id: "other", label: "Other", Icon: FileSpreadsheet },
  ];

  return (
    <motion.section
      id="results-v2-panel-downloads"
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 18, scale: 0.985, filter: "blur(6px)" }}
      whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: MOTION.entrance.duration, ease: MOTION.entrance.ease }}
      aria-labelledby="downloads-heading"
      style={{
        padding: "clamp(40px, 6vw, 88px) clamp(20px, 4vw, 48px)",
        borderTop: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        background: NEUTRAL.BG_BASE,
        backgroundImage: `linear-gradient(180deg, ${accent.start}0d 0%, transparent 18%)`,
      }}
    >
      <PanelHeader id="downloads-heading" label="Download center">
        <span style={{ fontSize: 12, color: NEUTRAL.TEXT_SECONDARY }}>{flat.length} files</span>
      </PanelHeader>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {order
          .filter(group => groups[group.id].length > 0)
          .map(group => (
            <section key={group.id} aria-labelledby={`dl-${group.id}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h3
                id={`dl-${group.id}`}
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: NEUTRAL.TEXT_MUTED,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <group.Icon size={14} aria-hidden style={{ color: accent.start }} />
                {group.label}
                <span style={{ color: NEUTRAL.TEXT_MUTED, fontWeight: 500, marginLeft: 4 }}>
                  {groups[group.id].length}
                </span>
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
                {groups[group.id].map((d, idx) => (
                  <DownloadRow key={`${d.name}-${idx}`} download={d} accent={accent.start} />
                ))}
              </div>
            </section>
          ))}
      </div>
    </motion.section>
  );
}

function DownloadRow({ download, accent }: { download: ResultDownload; accent: string }) {
  const sizeLabel = formatBytes(download.sizeBytes);
  // Micro-delight #2 — arrow → check morph on click (240ms in, dwells 900ms, reverts).
  const [clicked, setClicked] = useState(false);
  const morphHandleRef = useRef<number | null>(null);
  const triggerMorph = () => {
    setClicked(true);
    if (morphHandleRef.current != null) window.clearTimeout(morphHandleRef.current);
    morphHandleRef.current = window.setTimeout(() => setClicked(false), 1100);
  };
  // Cleanup — prevents setState-after-unmount if the user navigates away
  // during the 1.1s morph window.
  useEffect(() => {
    return () => {
      if (morphHandleRef.current != null) window.clearTimeout(morphHandleRef.current);
    };
  }, []);
  return download.downloadUrl ? (
    <motion.a
      href={download.downloadUrl}
      download
      whileTap={{ y: 1, scale: 0.985 }}
      transition={{ duration: 0.08, ease: "easeOut" }}
      onClick={triggerMorph}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        background: NEUTRAL.BG_ELEVATED,
        color: NEUTRAL.TEXT_PRIMARY,
        textDecoration: "none",
        transition: "border-color 160ms ease-out, background 160ms ease-out",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = accent;
        e.currentTarget.style.background = `${accent}0f`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = NEUTRAL.BORDER_SUBTLE;
        e.currentTarget.style.background = NEUTRAL.BG_ELEVATED;
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: NEUTRAL.TEXT_PRIMARY,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {download.name}
        </span>
        <span style={{ fontSize: 11, color: NEUTRAL.TEXT_MUTED, fontFamily: "var(--font-jetbrains), monospace" }}>
          {sizeLabel ?? "—"}
        </span>
      </div>
      <span
        aria-hidden
        style={{
          position: "relative",
          width: 14,
          height: 14,
          color: accent,
        }}
      >
        <AnimatePresence initial={false} mode="wait">
          {clicked ? (
            <motion.span
              key="check"
              initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.7, rotate: 8 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ position: "absolute", inset: 0 }}
            >
              <Check size={14} aria-label="Downloading" />
            </motion.span>
          ) : (
            <motion.span
              key="arrow"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.2 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              style={{ position: "absolute", inset: 0 }}
            >
              <ArrowDownToLine size={14} aria-label="Download" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.a>
  ) : (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px dashed ${NEUTRAL.BORDER_SUBTLE}`,
        background: NEUTRAL.BG_ELEVATED,
        color: NEUTRAL.TEXT_MUTED,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500 }}>{download.name}</span>
      <span style={{ fontSize: 11, fontFamily: "var(--font-jetbrains), monospace" }}>no URL</span>
    </div>
  );
}

function formatBytes(bytes: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
