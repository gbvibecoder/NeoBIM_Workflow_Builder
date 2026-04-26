"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import { LayoutGrid, Box } from "lucide-react";
import { HeroCta } from "@/features/result-page/components/primitives/HeroCta";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";

interface HeroFloorPlanSvgProps {
  svgContent: string;
  has3DEditor?: boolean;
  onOpen3D?: () => void;
}

export function HeroFloorPlanSvg({ svgContent, has3DEditor, onOpen3D }: HeroFloorPlanSvgProps) {
  const accent = getWorkflowAccent("floor-plan-svg");
  const sanitized = useMemo(
    () =>
      typeof window !== "undefined"
        ? DOMPurify.sanitize(svgContent, { USE_PROFILES: { svg: true, svgFilters: true } })
        : "",
    [svgContent],
  );

  const handleDownload = () => {
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "floor_plan.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{
        display: "grid",
        gap: 16,
        gridTemplateColumns: "minmax(0, 1fr)",
      }}
    >
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 18,
          padding: 20,
          minHeight: 360,
          maxHeight: "min(64vh, 720px)",
          overflow: "auto",
          boxShadow: accent.glow,
          border: `1px solid ${accent.ring}`,
        }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {has3DEditor && onOpen3D ? (
          <HeroCta
            label="Open 3D Editor"
            icon={<Box size={18} aria-hidden="true" />}
            accent={accent}
            onClick={onOpen3D}
            size="lg"
          />
        ) : null}
        <HeroCta
          label="Download SVG"
          icon={<LayoutGrid size={18} aria-hidden="true" />}
          accent={getWorkflowAccent("generic")}
          onClick={handleDownload}
          size="lg"
        />
      </div>
    </motion.section>
  );
}
