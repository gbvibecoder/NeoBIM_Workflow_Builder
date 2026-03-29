"use client";

import { useMemo } from "react";
import { useExecutionStore } from "@/stores/execution-store";
import type { ShowcaseData } from "./useShowcaseData";

// ─── Types ───────────────────────────────────────────────────────────────────

export type HeroType =
  | "floor-plan"
  | "floor-plan-interactive"
  | "video"
  | "3d-model"
  | "image"
  | "table"
  | "text"
  | "generic";

export interface RoomInfo {
  name: string;
  area: number;
  type?: string;
}

export interface FloorPlanMeta {
  rooms: RoomInfo[];
  totalArea: number;
  floors: number;
}

export interface InsightMetric {
  label: string;
  value: string | number;
  unit?: string;
}

export interface HeroData {
  type: HeroType;
  floorPlanMeta: FloorPlanMeta | null;
  insights: InsightMetric[];
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useHeroDetection(data: ShowcaseData): HeroData {
  const artifacts = useExecutionStore((s) => s.artifacts);

  return useMemo(() => {
    // ── Determine hero type (priority: most visually impressive first) ──
    let type: HeroType = "generic";

    if (data.videoData) type = "video";
    else if (data.model3dData?.kind === "floor-plan-interactive") type = "floor-plan-interactive";
    else if (data.model3dData) type = "3d-model";
    else if (data.svgContent) type = "floor-plan";
    else if (data.allImageUrls.length > 0) type = "image";
    else if (data.tableData.length > 0) type = "table";
    else if (data.textContent) type = "text";

    // ── Extract floor plan metadata from SVG artifact ──
    let floorPlanMeta: FloorPlanMeta | null = null;

    if (data.svgContent) {
      for (const art of artifacts.values()) {
        if (art.type === "svg") {
          const d = art.data as Record<string, unknown>;
          const roomList = d.roomList as RoomInfo[] | undefined;
          const totalArea = d.totalArea as number | undefined;
          const floors = d.floors as number | undefined;
          if (roomList && roomList.length > 0) {
            floorPlanMeta = {
              rooms: roomList,
              totalArea:
                totalArea ??
                roomList.reduce((s, r) => s + (r.area || 0), 0),
              floors: floors ?? 1,
            };
          }
          break;
        }
      }

      // Fallback: parse from SVG text content
      if (!floorPlanMeta) {
        floorPlanMeta = parseSvgRooms(data.svgContent);
      }
    }

    // ── Build insight metrics ──
    const insights: InsightMetric[] = [];

    switch (type) {
      case "floor-plan": {
        if (floorPlanMeta) {
          if (floorPlanMeta.totalArea > 0) {
            insights.push({
              label: "Total Area",
              value: Math.round(floorPlanMeta.totalArea),
              unit: "m²",
            });
          }
          if (floorPlanMeta.rooms.length > 0) {
            insights.push({
              label: "Rooms",
              value: floorPlanMeta.rooms.length,
            });
          }
          if (floorPlanMeta.floors > 1) {
            insights.push({
              label: "Floors",
              value: floorPlanMeta.floors,
            });
          }
          // Count unique apartments / units
          const unitNames = new Set<string>();
          floorPlanMeta.rooms.forEach((r) => {
            const match = r.name.match(
              /^(Apartment\s*\d+|Unit\s*\d+)/i,
            );
            if (match) unitNames.add(match[1]);
          });
          if (unitNames.size > 1) {
            insights.push({ label: "Units", value: unitNames.size });
          }
        }
        break;
      }

      case "floor-plan-interactive": {
        if (data.model3dData?.kind === "floor-plan-interactive") {
          const s = data.model3dData.summary;
          if (s.totalArea_sqm > 0) insights.push({ label: "Total Area", value: Math.round(s.totalArea_sqm), unit: "m²" });
          if (s.totalRooms > 0) insights.push({ label: "Rooms", value: s.totalRooms });
          if (s.totalWalls > 0) insights.push({ label: "Walls", value: s.totalWalls });
          if (s.floorCount > 1) insights.push({ label: "Floors", value: s.floorCount });
        }
        break;
      }

      case "3d-model": {
        if (data.model3dData?.kind === "procedural") {
          const m = data.model3dData;
          insights.push({ label: "Floors", value: m.floors });
          insights.push({ label: "Height", value: m.height, unit: "m" });
          insights.push({
            label: "Footprint",
            value: m.footprint,
            unit: "m²",
          });
          insights.push({ label: "GFA", value: m.gfa, unit: "m²" });
        } else if (data.model3dData?.kind === "glb") {
          if (data.model3dData.polycount) {
            insights.push({
              label: "Polygons",
              value: data.model3dData.polycount.toLocaleString(),
            });
          }
        } else if (
          data.model3dData?.kind === "floor-plan-editor" ||
          data.model3dData?.kind === "html-iframe"
        ) {
          if (data.model3dData.roomCount) {
            insights.push({
              label: "Rooms",
              value: data.model3dData.roomCount,
            });
          }
          if (data.model3dData.wallCount) {
            insights.push({
              label: "Walls",
              value: data.model3dData.wallCount,
            });
          }
        }
        break;
      }

      case "video": {
        if (data.videoData) {
          insights.push({
            label: "Duration",
            value: data.videoData.durationSeconds,
            unit: "s",
          });
          insights.push({
            label: "Shots",
            value: data.videoData.shotCount,
          });
          if (data.videoData.costUsd != null) {
            insights.push({
              label: "Cost",
              value: `$${data.videoData.costUsd.toFixed(2)}`,
            });
          }
        }
        break;
      }

      case "image": {
        insights.push({
          label: "Images",
          value: data.allImageUrls.length,
        });
        break;
      }

      case "table": {
        const totalRows = data.tableData.reduce(
          (s, t) => s + t.rows.length,
          0,
        );
        insights.push({ label: "Tables", value: data.tableData.length });
        insights.push({ label: "Total Rows", value: totalRows });

        // If cost breakdown exists show sum total
        if (data.costBreakdown && data.costBreakdown.length > 0) {
          const total = data.costBreakdown.reduce(
            (sum, item) => sum + item.value,
            0,
          );
          insights.push({
            label: "Estimated Total",
            value: total.toLocaleString(),
          });
        }
        break;
      }

      case "text": {
        const wordCount = data.textContent
          .split(/\s+/)
          .filter(Boolean).length;
        insights.push({ label: "Words", value: wordCount });
        break;
      }
    }

    return { type, floorPlanMeta, insights };
  }, [data, artifacts]);
}

// ─── SVG Room Parser (fallback) ──────────────────────────────────────────────

function parseSvgRooms(svgContent: string): FloorPlanMeta | null {
  const rooms: RoomInfo[] = [];

  // Match patterns like "Room Name\n15.9 m²" in SVG text content
  const areaPattern =
    /([A-Za-z][A-Za-z0-9 ]+?)\s*[\n\r]+\s*(\d+(?:\.\d+)?)\s*m²/g;
  let match: RegExpExecArray | null;

  while ((match = areaPattern.exec(svgContent)) !== null) {
    const name = match[1].trim();
    const area = parseFloat(match[2]);
    // Sanity check: valid name, reasonable area
    if (
      name &&
      name.length > 1 &&
      name.length < 60 &&
      !isNaN(area) &&
      area > 0 &&
      area < 10000
    ) {
      // Avoid duplicates
      if (!rooms.some((r) => r.name === name && r.area === area)) {
        rooms.push({ name, area });
      }
    }
  }

  if (rooms.length === 0) return null;

  const totalArea = rooms.reduce((s, r) => s + r.area, 0);

  // Detect floor count
  const floorPattern = /(?:Floor|Storey|Level)\s*(\d+)/gi;
  const floorNumbers = new Set<number>();
  let floorMatch: RegExpExecArray | null;
  while ((floorMatch = floorPattern.exec(svgContent)) !== null) {
    floorNumbers.add(parseInt(floorMatch[1]));
  }
  const namedFloors = svgContent.match(
    /(?:First|Second|Third|Fourth|Fifth|Ground)\s+Floor/gi,
  );
  const floors = Math.max(
    floorNumbers.size,
    namedFloors?.length ?? 0,
    1,
  );

  return { rooms, totalArea, floors };
}
