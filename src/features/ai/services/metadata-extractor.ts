/**
 * BIM Metadata Extractor
 * Extracts a JSON sidecar from MassingGeometry that maps element IDs
 * to their full BIM properties. This JSON is loaded client-side for
 * click-to-inspect functionality in the BIM viewer.
 */

import type { MassingGeometry, GeometryElement } from "@/types/geometry";

// ─── Output Types ────────────────────────────────────────────────────────────

export interface BIMElementMeta {
  id: string;
  ifcType: string;
  type: string;
  storeyIndex: number;
  storeyName: string;
  properties: GeometryElement["properties"];
}

export interface BIMStoreyMeta {
  index: number;
  name: string;
  elevation: number;
  height: number;
  elementCount: number;
  elementTypes: Record<string, number>;
}

export interface BIMMetadata {
  version: 1;
  generatedAt: string;
  projectInfo: {
    buildingType: string;
    floors: number;
    totalHeight: number;
    gfa: number;
    footprintArea: number;
    metrics: Array<{ label: string; value: string | number; unit?: string }>;
  };
  elements: Record<string, BIMElementMeta>;
  storeys: BIMStoreyMeta[];
  summary: {
    totalElements: number;
    elementsByType: Record<string, number>;
    elementsByDiscipline: Record<string, number>;
  };
}

// ─── Extraction ──────────────────────────────────────────────────────────────

/**
 * Extract BIM metadata from MassingGeometry.
 * Returns a JSON-serializable object mapping element IDs to their properties.
 */
export function extractMetadata(geometry: MassingGeometry): BIMMetadata {
  const elements: Record<string, BIMElementMeta> = {};
  const storeys: BIMStoreyMeta[] = [];
  const elementsByType: Record<string, number> = {};
  const elementsByDiscipline: Record<string, number> = {};
  let totalElements = 0;

  for (const storey of geometry.storeys) {
    const typeCounts: Record<string, number> = {};

    for (const el of storey.elements) {
      // Map element to metadata
      elements[el.id] = {
        id: el.id,
        ifcType: el.ifcType,
        type: el.type,
        storeyIndex: storey.index,
        storeyName: storey.name,
        properties: el.properties,
      };

      // Count by type
      elementsByType[el.type] = (elementsByType[el.type] ?? 0) + 1;
      typeCounts[el.type] = (typeCounts[el.type] ?? 0) + 1;

      // Count by discipline
      const disc = el.properties.discipline ?? "unclassified";
      elementsByDiscipline[disc] = (elementsByDiscipline[disc] ?? 0) + 1;

      totalElements++;
    }

    storeys.push({
      index: storey.index,
      name: storey.name,
      elevation: storey.elevation,
      height: storey.height,
      elementCount: storey.elements.length,
      elementTypes: typeCounts,
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectInfo: {
      buildingType: geometry.buildingType,
      floors: geometry.floors,
      totalHeight: geometry.totalHeight,
      gfa: geometry.gfa,
      footprintArea: geometry.footprintArea,
      metrics: geometry.metrics,
    },
    elements,
    storeys,
    summary: {
      totalElements,
      elementsByType,
      elementsByDiscipline,
    },
  };
}
