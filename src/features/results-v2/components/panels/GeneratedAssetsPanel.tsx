"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { Box, Film, Image as ImageIcon, LayoutGrid, Table2 } from "lucide-react";
import { NEUTRAL, MOTION } from "@/features/results-v2/constants";
import type { AccentGradient, ExecutionResult, ResultTable } from "@/features/results-v2/types";
import { PanelHeader } from "@/features/results-v2/components/panels/OverviewPanel";

interface GeneratedAssetsPanelProps {
  result: ExecutionResult;
  accent: AccentGradient;
}

/**
 * Adaptive grid of secondary generated assets. Deliberately NOT three
 * identical rectangles — each card carries the actual asset preview,
 * type-specific iconography, and meaningful metadata.
 */
export function GeneratedAssetsPanel({ result, accent }: GeneratedAssetsPanelProps) {
  const reducedMotion = useReducedMotion();
  const cards = buildCards(result);
  if (cards.length === 0) return null;

  return (
    <motion.section
      id="results-v2-panel-assets"
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 18, scale: 0.985, filter: "blur(6px)" }}
      whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: MOTION.entrance.duration, ease: MOTION.entrance.ease }}
      aria-labelledby="assets-heading"
      style={{
        padding: "clamp(40px, 6vw, 88px) clamp(20px, 4vw, 48px)",
        borderTop: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        background: NEUTRAL.BG_BASE,
        backgroundImage: `linear-gradient(180deg, ${accent.start}0d 0%, transparent 18%)`,
      }}
    >
      <PanelHeader id="assets-heading" label="Generated assets" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {cards.map((card, idx) => (
          <motion.article
            key={card.id}
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
            whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{
              duration: MOTION.entrance.duration,
              delay: idx * MOTION.entrance.stagger,
              ease: MOTION.entrance.ease,
            }}
            whileHover={reducedMotion ? undefined : { y: -2 }}
            style={{
              borderRadius: 14,
              overflow: "hidden",
              border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
              background: NEUTRAL.BG_ELEVATED,
            }}
          >
            {card.preview ? (
              <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 10", overflow: "hidden" }}>
                {card.kind === "image" ? (
                  <Image
                    src={card.preview}
                    alt={card.title}
                    fill
                    sizes="(max-width: 767px) 100vw, (max-width: 1279px) 50vw, 33vw"
                    unoptimized
                    style={{ objectFit: "cover" }}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.preview} alt={card.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
              </div>
            ) : (
              <div
                aria-hidden
                style={{
                  aspectRatio: "16 / 10",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `linear-gradient(135deg, ${accent.start}1a, ${accent.end}1a)`,
                }}
              >
                <card.Icon size={40} strokeWidth={1.25} style={{ color: accent.start, opacity: 0.7 }} />
              </div>
            )}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: NEUTRAL.TEXT_MUTED,
                }}
              >
                {card.kindLabel}
              </span>
              <h3
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  color: NEUTRAL.TEXT_PRIMARY,
                  lineHeight: 1.3,
                }}
              >
                {card.title}
              </h3>
              {card.meta ? (
                <span style={{ fontSize: 12, color: NEUTRAL.TEXT_SECONDARY }}>{card.meta}</span>
              ) : null}
            </div>
          </motion.article>
        ))}
      </div>
    </motion.section>
  );
}

interface AssetCard {
  id: string;
  title: string;
  kindLabel: string;
  kind: "video" | "image" | "3d" | "floor-plan" | "table";
  preview?: string;
  meta?: string;
  Icon: typeof Box | typeof Film | typeof ImageIcon | typeof LayoutGrid | typeof Table2;
}

function buildCards(result: ExecutionResult): AssetCard[] {
  const cards: AssetCard[] = [];

  if (result.video) {
    cards.push({
      id: "video",
      title: result.video.name,
      kindLabel: "Video",
      kind: "video",
      meta: `${result.video.durationSeconds}s · ${result.video.shotCount} shots`,
      Icon: Film,
    });
  }
  if (result.model3d) {
    cards.push({
      id: "model3d",
      title:
        result.model3d.kind === "procedural"
          ? result.model3d.buildingType ?? "3D Model"
          : result.model3d.kind === "glb"
            ? "GLB 3D Model"
            : "Interactive 3D Viewer",
      kindLabel: "3D Model",
      kind: "3d",
      meta:
        result.model3d.kind === "procedural" && result.model3d.gfa
          ? `${Math.round(result.model3d.gfa).toLocaleString()} m² GFA`
          : undefined,
      preview: result.model3d.thumbnailUrl,
      Icon: Box,
    });
  }
  if (result.floorPlan && result.floorPlan.sourceImageUrl) {
    cards.push({
      id: "floor-plan-source",
      title: result.floorPlan.label,
      kindLabel: "Floor Plan",
      kind: "floor-plan",
      preview: result.floorPlan.sourceImageUrl,
      meta:
        result.floorPlan.roomCount != null
          ? `${result.floorPlan.roomCount} rooms`
          : undefined,
      Icon: LayoutGrid,
    });
  }
  result.images.slice(0, 6).forEach((url, idx) => {
    cards.push({
      id: `render-${idx}`,
      title: idx === 0 ? "Primary Render" : `Render ${idx + 1}`,
      kindLabel: "Render",
      kind: "image",
      preview: url,
      Icon: ImageIcon,
    });
  });
  result.tables.slice(0, 2).forEach((t: ResultTable, idx) => {
    cards.push({
      id: `table-${idx}`,
      title: t.label,
      kindLabel: t.isBoq ? "Bill of Quantities" : "Table",
      kind: "table",
      meta: `${t.rows.length} rows · ${t.headers.length} columns`,
      Icon: Table2,
    });
  });

  return cards;
}
