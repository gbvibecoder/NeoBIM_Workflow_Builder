"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useLocale } from "@/hooks/useLocale";
import { COLORS } from "../constants";
import type { ShowcaseData, ProceduralModelData, GlbModelData, HtmlIframeModelData } from "../useShowcaseData";

const ArchitecturalViewer = dynamic(
  () => import("../../artifacts/architectural-viewer/ArchitecturalViewer"),
  { ssr: false }
);

const Building3DViewer = dynamic(
  () => import("../../artifacts/Building3DViewer"),
  { ssr: false }
);

interface ModelTabProps {
  data: ShowcaseData;
}

export function ModelTab({ data }: ModelTabProps) {
  const { t } = useLocale();
  const model = data.model3dData;

  if (!model && !data.svgContent) {
    return (
      <div style={{
        height: 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.TEXT_MUTED,
        fontSize: 13,
      }}>
        {t('showcase.no3dModel')}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 0, height: "calc(100vh - 160px)", minHeight: 500 }}>
      {/* Main viewer area */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", borderRadius: 12 }}>
        {model?.kind === "procedural" && (
          <ProceduralViewer model={model} />
        )}
        {model?.kind === "glb" && (
          <GlbViewer model={model} />
        )}
        {model?.kind === "html-iframe" && (
          <HtmlIframeViewer model={model} />
        )}
        {!model && data.svgContent && (
          <div style={{
            background: "#fff",
            borderRadius: 12,
            padding: 24,
            height: "100%",
            overflow: "auto",
          }}>
            <div
              dangerouslySetInnerHTML={{ __html: data.svgContent }}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        )}
      </div>

      {/* Metadata sidebar */}
      {model && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          style={{
            width: 260,
            flexShrink: 0,
            padding: "20px 20px 20px 24px",
            borderLeft: `1px solid ${COLORS.GLASS_BORDER}`,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: COLORS.TEXT_PRIMARY,
            marginBottom: 4,
          }}>
            {t('showcase.buildingSpecs')}
          </div>

          {model.kind === "procedural" && (
            <SpecGrid specs={[
              { label: t('showcase.specBuildingType'), value: model.buildingType },
              { label: t('showcase.specFloors'), value: String(model.floors) },
              { label: t('showcase.specHeight'), value: `${model.height}m` },
              { label: t('showcase.specFootprint'), value: `${model.footprint} m²` },
              { label: t('showcase.specGfa'), value: `${model.gfa.toLocaleString()} m²` },
              { label: t('showcase.specRenderer'), value: t('showcase.procedural') },
            ]} />
          )}

          {model.kind === "glb" && (
            <SpecGrid specs={[
              { label: t('showcase.specFormat'), value: t('showcase.glbFormat') },
              ...(model.polycount ? [{ label: t('showcase.specPolycount'), value: model.polycount.toLocaleString() }] : []),
              ...(model.topology ? [{ label: t('showcase.specTopology'), value: model.topology }] : []),
              { label: t('showcase.specRenderer'), value: t('showcase.threejs') },
            ]} />
          )}

          {model.kind === "html-iframe" && (
            <SpecGrid specs={[
              { label: "Format", value: "Interactive HTML" },
              ...(model.roomCount ? [{ label: "Rooms", value: String(model.roomCount) }] : []),
              ...(model.wallCount ? [{ label: "Walls", value: String(model.wallCount) }] : []),
              { label: "Renderer", value: "Three.js r128" },
              { label: "Controls", value: "Orbit + Walk" },
              { label: "Features", value: "WASD, hover, labels" },
            ]} />
          )}
        </motion.div>
      )}
    </div>
  );
}

function ProceduralViewer({ model }: { model: ProceduralModelData }) {
  const styleData = model.style;

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ArchitecturalViewer
        floors={model.floors}
        height={model.height}
        footprint={model.footprint}
        gfa={model.gfa}
        buildingType={model.buildingType}
        style={styleData ? {
          glassHeavy: !!styleData.glassHeavy,
          hasRiver: !!styleData.hasRiver,
          hasLake: !!styleData.hasLake,
          isModern: !!styleData.isModern,
          isTower: !!styleData.isTower,
          exteriorMaterial: (styleData.exteriorMaterial as string) ?? "mixed",
          environment: (styleData.environment as string) ?? "suburban",
          usage: (styleData.usage as string) ?? "mixed",
          promptText: (styleData.promptText as string) ?? "",
          typology: (styleData.typology as string) ?? "generic",
          facadePattern: (styleData.facadePattern as string) ?? "none",
          floorHeightOverride: styleData.floorHeightOverride ? Number(styleData.floorHeightOverride) : undefined,
          maxFloorCap: Number(styleData.maxFloorCap ?? 30),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any : undefined}
      />
    </div>
  );
}

function GlbViewer({ model }: { model: GlbModelData }) {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {model.thumbnailUrl && (
        <div style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          opacity: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={model.thumbnailUrl}
            alt="3D preview"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      )}
      <Building3DViewer
        glbUrl={model.glbUrl}
        height={typeof window !== "undefined" ? window.innerHeight - 180 : 600}
      />
    </div>
  );
}

function HtmlIframeViewer({ model }: { model: HtmlIframeModelData }) {
  // Prefer URL if available (R2-uploaded), otherwise use inline content via srcdoc
  const hasUrl = model.url && model.url.startsWith("http");

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", borderRadius: 12, overflow: "hidden" }}>
      {hasUrl ? (
        <iframe
          src={model.url}
          title={model.label}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: 12,
            background: "#07070D",
          }}
          allow="fullscreen"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : model.content ? (
        <iframe
          srcDoc={model.content}
          title={model.label}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: 12,
            background: "#07070D",
          }}
          allow="fullscreen"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <div style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07070D",
          color: COLORS.TEXT_MUTED,
          fontSize: 13,
        }}>
          No 3D viewer content available
        </div>
      )}
    </div>
  );
}

function SpecGrid({ specs }: { specs: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {specs.map(spec => (
        <div key={spec.label}>
          <div style={{
            fontSize: 9,
            fontWeight: 500,
            color: COLORS.TEXT_MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 2,
          }}>
            {spec.label}
          </div>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: COLORS.TEXT_PRIMARY,
          }}>
            {spec.value}
          </div>
        </div>
      ))}
    </div>
  );
}
