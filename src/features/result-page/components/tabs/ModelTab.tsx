"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import { ExternalLink, Box } from "lucide-react";
import { HeroCta } from "@/features/result-page/components/primitives/HeroCta";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";
import type { ResultPageData, Model3DData } from "@/features/result-page/hooks/useResultPageData";
import type {
  HtmlIframeModelData,
  ProceduralModelData,
  GlbModelData,
  FloorPlanEditorData,
} from "@/features/result-page/hooks/useResultPageData";
import type { BuildingStyle } from "@/types/architectural-viewer";

const ArchitecturalViewer = dynamic(
  () => import("@/features/canvas/components/artifacts/architectural-viewer/ArchitecturalViewer"),
  { ssr: false },
);

const BIMViewer = dynamic(() => import("@/features/canvas/components/artifacts/BIMViewer"), { ssr: false });

const FloorPlanEditor = dynamic(
  () => import("@/features/canvas/components/artifacts/FloorPlanEditor").then(m => ({ default: m.FloorPlanEditor })),
  { ssr: false },
);

const FloorPlanViewer = dynamic(
  () => import("@/features/floor-plan/components/FloorPlanViewer").then(m => ({ default: m.FloorPlanViewer })),
  { ssr: false },
);

interface ModelTabProps {
  data: ResultPageData;
}

/**
 * 3D Model tab — jargon stripped per D2/D4:
 *  - Removed Experimental 3D Preview ConfidenceBadge
 *  - Removed BuildFlow Engine footer branding
 *  - "Open in Floor Plan Editor" + new "Open in IFC Viewer" promoted to HeroCta
 */
export function ModelTab({ data }: ModelTabProps) {
  const model = data.model3dData;
  const sanitizedSvg = useMemo(
    () =>
      typeof window !== "undefined" && data.svgContent
        ? DOMPurify.sanitize(data.svgContent, { USE_PROFILES: { svg: true, svgFilters: true } })
        : "",
    [data.svgContent],
  );

  const ifcFile = data.fileDownloads.find(f => f.name.toLowerCase().endsWith(".ifc"));
  const accent = getWorkflowAccent("3d-model");
  const ifcAccent = getWorkflowAccent("clash"); // amber for IFC entry

  if (!model && !data.svgContent) {
    return (
      <p style={{ padding: 60, textAlign: "center", color: "rgba(245,245,250,0.5)", fontSize: 13 }}>
        No 3D model artifact for this run.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          height: "min(70vh, 760px)",
          minHeight: 460,
          background: "#08080F",
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}
      >
        {model?.kind === "floor-plan-interactive" ? (
          <FloorPlanViewer initialProject={model.floorPlanProject} />
        ) : model?.kind === "floor-plan-editor" ? (
          <FloorPlanEditorBranch model={model} />
        ) : model?.kind === "html-iframe" ? (
          <HtmlIframeViewer model={model} />
        ) : model?.kind === "procedural" ? (
          <ProceduralBranch model={model} />
        ) : model?.kind === "glb" ? (
          <GlbBranch model={model} />
        ) : data.svgContent ? (
          <div
            style={{
              background: "#FFFFFF",
              padding: 24,
              height: "100%",
              overflow: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
        ) : null}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        {(model?.kind === "floor-plan-editor" || model?.kind === "html-iframe") && model.geometry ? (
          <HeroCta
            label="Open in Floor Plan Editor"
            sublabel="CAD editor with Vastu & BOQ analysis"
            icon={<ExternalLink size={18} aria-hidden="true" />}
            accent={accent}
            onClick={() => {
              try {
                if (model.geometry) sessionStorage.setItem("fp-editor-geometry", JSON.stringify(model.geometry));
              } catch {
                // sessionStorage unavailable
              }
              window.open("/dashboard/floor-plan?source=pipeline", "_blank", "noopener,noreferrer");
            }}
            size="lg"
          />
        ) : null}
        {ifcFile ? (
          <HeroCta
            label="Open in IFC Viewer"
            sublabel="Inspect the BIM model element-by-element"
            icon={<Box size={18} aria-hidden="true" />}
            accent={ifcAccent}
            href={`/dashboard/ifc-viewer?executionId=${data.executionId}`}
            external
            size="lg"
          />
        ) : null}
      </motion.div>
    </div>
  );
}

function FloorPlanEditorBranch({ model }: { model: FloorPlanEditorData }) {
  // FloorPlanEditor's onGenerate3D fires when the user asks the embedded
  // editor to materialise a Three.js HTML version. From the result page we
  // don't synthesise one inline — the Model tab is read-only here, so the
  // callback is a no-op. The dedicated /dashboard/floor-plan editor (which
  // the HeroCta below opens) handles the full generate flow.
  return (
    <FloorPlanEditor
      geometry={model.geometry}
      sourceImageUrl={model.sourceImageUrl}
      onGenerate3D={() => {
        /* no-op — see comment above */
      }}
    />
  );
}

function ProceduralBranch({ model }: { model: ProceduralModelData }) {
  const style = useMemo(() => toBuildingStyle(model.style), [model.style]);
  return (
    <ArchitecturalViewer
      floors={model.floors}
      height={model.height}
      footprint={model.footprint}
      gfa={model.gfa}
      buildingType={model.buildingType}
      style={style}
    />
  );
}

function toBuildingStyle(raw: Record<string, unknown> | undefined): BuildingStyle | undefined {
  if (!raw) return undefined;
  const materials = ["glass", "concrete", "brick", "wood", "steel", "stone", "terracotta", "mixed"] as const;
  const envs = ["urban", "suburban", "waterfront", "park", "desert", "coastal", "mountain", "campus"] as const;
  const usages = [
    "residential",
    "office",
    "mixed",
    "commercial",
    "hotel",
    "educational",
    "healthcare",
    "cultural",
    "industrial",
    "civic",
  ] as const;
  const typologies = ["tower", "slab", "courtyard", "villa", "warehouse", "podium-tower", "generic"] as const;
  const facades = ["curtain-wall", "punched-window", "ribbon-window", "brise-soleil", "none"] as const;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
  return {
    glassHeavy: !!raw.glassHeavy,
    hasRiver: !!raw.hasRiver,
    hasLake: !!raw.hasLake,
    isModern: !!raw.isModern,
    isTower: !!raw.isTower,
    exteriorMaterial: pick(raw.exteriorMaterial, materials, "mixed"),
    environment: pick(raw.environment, envs, "suburban"),
    usage: pick(raw.usage, usages, "mixed"),
    promptText: typeof raw.promptText === "string" ? raw.promptText : "",
    typology: pick(raw.typology, typologies, "generic"),
    facadePattern: pick(raw.facadePattern, facades, "none"),
    floorHeightOverride: typeof raw.floorHeightOverride === "number" ? raw.floorHeightOverride : undefined,
    maxFloorCap: typeof raw.maxFloorCap === "number" ? raw.maxFloorCap : 30,
  };
}

function GlbBranch({ model }: { model: GlbModelData }) {
  return (
    <BIMViewer glbUrl={model.glbUrl} metadataUrl={model.metadataUrl} ifcUrl={model.ifcUrl} height={620} />
  );
}

function HtmlIframeViewer({ model }: { model: HtmlIframeModelData }) {
  const blobUrl = useMemo(() => {
    if (!model.content) return null;
    const blob = new Blob([model.content], { type: "text/html" });
    return URL.createObjectURL(blob);
  }, [model.content]);

  if (!blobUrl && !model.url) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(245,245,250,0.4)",
          fontSize: 13,
        }}
      >
        No 3D viewer content available
      </div>
    );
  }
  return (
    <iframe
      src={blobUrl ?? model.url}
      title={model.label}
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        background: "#0A0A14",
      }}
      allow="fullscreen"
      sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock"
    />
  );
}

// Mark unused imports as referenced for the type-only re-uses
export type { Model3DData };
