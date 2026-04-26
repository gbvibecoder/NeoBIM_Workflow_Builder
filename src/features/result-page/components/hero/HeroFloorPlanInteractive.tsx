"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { PenTool } from "lucide-react";
import { HeroCta } from "@/features/result-page/components/primitives/HeroCta";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";
import type { FloorPlanInteractiveData } from "@/features/result-page/hooks/useResultPageData";

const FloorPlanViewer = dynamic(
  () => import("@/features/floor-plan/components/FloorPlanViewer").then(m => ({ default: m.FloorPlanViewer })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "rgba(245,245,250,0.45)",
          fontSize: 13,
          background: "#0A0A14",
        }}
      >
        Loading Floor Plan Editor…
      </div>
    ),
  },
);

interface HeroFloorPlanInteractiveProps {
  data: FloorPlanInteractiveData;
}

export function HeroFloorPlanInteractive({ data }: HeroFloorPlanInteractiveProps) {
  const accent = getWorkflowAccent("floor-plan-interactive");
  const handleOpenFull = () => {
    try {
      sessionStorage.setItem("floorPlanProject", JSON.stringify(data.floorPlanProject));
    } catch {
      // sessionStorage may be unavailable
    }
    window.open("/dashboard/floor-plan?source=pipeline", "_blank", "noopener,noreferrer");
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{
        borderRadius: 20,
        overflow: "hidden",
        border: `1px solid ${accent.ring}`,
        boxShadow: accent.glow,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 20px",
          background: accent.gradient,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: accent.base,
            }}
          >
            Interactive Floor Plan
          </span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#F5F5FA",
              letterSpacing: "-0.005em",
            }}
          >
            {data.label}
          </span>
          <span style={{ fontSize: 12, color: "rgba(245,245,250,0.6)" }}>
            {data.summary.totalRooms} rooms · {Math.round(data.summary.totalArea_sqm)} m² · {data.summary.totalWalls} walls · {data.summary.floorCount}{" "}
            {data.summary.floorCount === 1 ? "floor" : "floors"}
          </span>
        </div>
        <HeroCta
          label="Open Full Editor"
          icon={<PenTool size={18} aria-hidden="true" />}
          accent={accent}
          onClick={handleOpenFull}
          size="lg"
        />
      </div>

      <div
        style={{
          height: "min(64vh, 760px)",
          minHeight: 460,
          background: "#0A0A14",
        }}
      >
        <FloorPlanViewer initialProject={data.floorPlanProject} />
      </div>
    </motion.section>
  );
}
