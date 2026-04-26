"use client";

import { motion } from "framer-motion";
import { Box, ExternalLink } from "lucide-react";
import { HeroCta } from "@/features/result-page/components/primitives/HeroCta";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";
import type { Model3DData, FileDownload } from "@/features/result-page/hooks/useResultPageData";

interface HeroModel3DProps {
  model: Model3DData;
  fileDownloads: FileDownload[];
  executionId: string;
  onExploreModelTab: () => void;
}

export function HeroModel3D({ model, fileDownloads, executionId, onExploreModelTab }: HeroModel3DProps) {
  const accent = getWorkflowAccent("3d-model");
  const ifcAccent = getWorkflowAccent("clash"); // amber for IFC entry
  const ifcFile = fileDownloads.find(f => f.name.toLowerCase().endsWith(".ifc"));

  let title = "Explore your 3D model";
  let subtitle = "Orbit, walk through, and inspect every wall.";
  if (model.kind === "procedural") {
    title = `${model.buildingType} · ${model.floors} floors`;
    subtitle = `${Math.round(model.gfa).toLocaleString("en-IN")} m² gross floor area · ${model.height}m height`;
  } else if (model.kind === "glb") {
    title = "Photo-real 3D model";
    if (model.polycount) subtitle = `${model.polycount.toLocaleString("en-IN")} polygons · GLB ready`;
  } else if (model.kind === "html-iframe") {
    title = model.label;
    if (model.roomCount) subtitle = `${model.roomCount} rooms · ${model.wallCount ?? "—"} walls`;
  } else if (model.kind === "floor-plan-editor") {
    title = "2D Editor + 3D Preview";
    subtitle = `${model.roomCount ?? "—"} rooms · ${model.wallCount ?? "—"} walls`;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "relative",
        borderRadius: 20,
        overflow: "hidden",
        background: accent.gradient,
        border: `1px solid ${accent.ring}`,
        boxShadow: accent.glow,
        padding: "clamp(28px, 5vw, 48px)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        minHeight: 360,
      }}
    >
      {/* Animated grid */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${accent.base}10 1px, transparent 1px), linear-gradient(90deg, ${accent.base}10 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          opacity: 0.4,
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 18 }}>
        <motion.span
          animate={{ rotateY: [0, 360] }}
          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 72,
            height: 72,
            borderRadius: 18,
            background: accent.tint,
            border: `1px solid ${accent.ring}`,
            color: accent.base,
          }}
        >
          <Box size={32} />
        </motion.span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: accent.base,
            }}
          >
            3D Model
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 700,
              color: "#F5F5FA",
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          <span style={{ fontSize: 13, color: "rgba(245,245,250,0.62)" }}>{subtitle}</span>
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <HeroCta
          label="Explore 3D Model"
          icon={<Box size={20} aria-hidden="true" />}
          accent={accent}
          onClick={onExploreModelTab}
          size="xl"
        />
        {ifcFile ? (
          <HeroCta
            label="Open in IFC Viewer"
            icon={<ExternalLink size={18} aria-hidden="true" />}
            accent={ifcAccent}
            href={`/dashboard/ifc-viewer?executionId=${executionId}`}
            external
            size="lg"
          />
        ) : null}
      </div>

      {model.kind === "procedural" ? (
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12,
          }}
        >
          {[
            { label: "Floors", value: String(model.floors) },
            { label: "Height", value: `${model.height}m` },
            { label: "Footprint", value: `${model.footprint.toLocaleString("en-IN")} m²` },
            { label: "GFA", value: `${Math.round(model.gfa).toLocaleString("en-IN")} m²` },
          ].map(s => (
            <div
              key={s.label}
              style={{
                background: "rgba(0,0,0,0.32)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 18, fontWeight: 700, color: "#F5F5FA", fontVariantNumeric: "tabular-nums" }}>
                {s.value}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgba(245,245,250,0.55)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </motion.section>
  );
}
