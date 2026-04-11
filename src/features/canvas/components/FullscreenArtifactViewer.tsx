"use client";

import React from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useUIStore } from "@/shared/stores/ui-store";
import { useExecutionStore } from "@/features/execution/stores/execution-store";

// Architectural 3D walkthrough viewer — client-only
const ArchitecturalViewer = dynamic(
  () => import("@/features/canvas/components/artifacts/architectural-viewer/ArchitecturalViewer"),
  { ssr: false }
);

export function FullscreenArtifactViewer() {
  const nodeId = useUIStore(s => s.artifactViewerNodeId);
  const close = useUIStore(s => s.setArtifactViewerNodeId);
  const artifact = useExecutionStore(s => nodeId ? s.artifacts.get(nodeId) : undefined);

  const handleClose = React.useCallback(() => close(null), [close]);

  if (!nodeId || !artifact) return null;

  const d = artifact.data as Record<string, unknown>;
  const rawData = (d?._raw as Record<string, unknown>) ?? {};
  const floors = (d?.floors as number) ?? (rawData.floors as number) ?? 2;
  const totalArea = (d?.totalArea as number) ?? (rawData.totalArea as number) ?? 200;
  const height = (d?.height as number) ?? (rawData.height as number) ?? floors * 3.0;
  const footprint = (d?.footprint as number) ?? (rawData.footprint as number) ?? Math.round(totalArea / Math.max(floors, 1));
  const gfa = (d?.gfa as number) ?? totalArea;
  const buildingType = (d?.buildingType as string) ?? (rawData.buildingType as string) ?? "Residential";
  const style = d?.style as Record<string, unknown> | undefined;

  // Extract room data from GN-004 output for accurate 3D labels
  const geometry = d?.geometry as Record<string, unknown> | undefined;
  const roomListData = (d?.roomList ?? geometry?.rooms ?? []) as Array<Record<string, unknown>>;
  const rooms = roomListData.length > 0 ? roomListData.map((r, i) => {
    const area = Number(r.area ?? 10);
    const w = Number(r.width ?? Math.sqrt(area * 1.2));
    const dep = Number(r.depth ?? area / w);
    return {
      name: String(r.name ?? `Room ${i + 1}`),
      type: String(r.type ?? "living"),
      area,
      width: w,
      depth: dep,
      x: Number(r.x ?? (i % 3) * (w + 0.2)),
      z: Number(r.z ?? r.y ?? Math.floor(i / 3) * (dep + 0.2)),
    };
  }) : undefined;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "absolute", inset: 0, zIndex: 60,
        background: "rgba(4,4,8,0.98)",
        display: "flex", flexDirection: "column",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#F0F0F5" }}>
          3D Architectural Walkthrough
        </span>
        <button
          onClick={handleClose}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8,
            background: "rgba(255,255,255,0.06)", border: "none",
            color: "#8888A0", fontSize: 12, fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <X size={12} /> Close
        </button>
      </div>
      <div style={{ flex: 1 }}>
        <ArchitecturalViewer
          floors={floors}
          height={height}
          footprint={footprint}
          gfa={gfa}
          buildingType={buildingType}
          rooms={rooms}
          style={style ? {
            glassHeavy: !!style.glassHeavy,
            hasRiver: !!style.hasRiver,
            hasLake: !!style.hasLake,
            isModern: !!style.isModern,
            isTower: !!style.isTower,
            exteriorMaterial: (style.exteriorMaterial as string) ?? "mixed",
            environment: (style.environment as string) ?? "suburban",
            usage: (style.usage as string) ?? "mixed",
            promptText: (style.promptText as string) ?? "",
            typology: (style.typology as string) ?? "generic",
            facadePattern: (style.facadePattern as string) ?? "none",
            floorHeightOverride: style.floorHeightOverride ? Number(style.floorHeightOverride) : undefined,
            maxFloorCap: Number(style.maxFloorCap ?? 30),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any : undefined}
        />
      </div>
    </motion.div>
  );
}
