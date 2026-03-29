/**
 * HTTP client for the IfcOpenShell Python microservice.
 *
 * Calls the Python FastAPI service to generate production-quality IFC4 files
 * via IfcOpenShell. Returns null on any failure so the caller can fall back
 * to the existing TypeScript IFC exporter.
 */

import type { MassingGeometry } from "@/types/geometry";

// ── Response types ──────────────────────────────────────────────────

export interface IFCServiceFile {
  discipline: string;
  file_name: string;
  download_url: string;
  size: number;
  schema_version: string;
  entity_count: number;
}

export interface IFCServiceResponse {
  status: "success" | "error";
  files: IFCServiceFile[];
  metadata: {
    engine: string;
    ifcopenshell_version: string;
    generation_time_ms: number;
    validation_passed: boolean;
    entity_counts: Record<string, number>;
  };
  error?: string;
}

// ── Client ──────────────────────────────────────────────────────────

const IFC_SERVICE_URL = process.env.IFC_SERVICE_URL;
const IFC_SERVICE_API_KEY = process.env.IFC_SERVICE_API_KEY;
const TIMEOUT_MS = 30_000;

/**
 * Generate IFC files via the Python IfcOpenShell microservice.
 *
 * @returns The service response with R2 download URLs, or `null` if the
 *          service is unavailable / errors out (triggering TS fallback).
 */
export async function generateIFCViaService(
  geometry: MassingGeometry,
  options: {
    projectName: string;
    buildingName: string;
    author?: string;
  },
  filePrefix: string,
): Promise<IFCServiceResponse | null> {
  if (!IFC_SERVICE_URL) {
    return null; // Service not configured — use TS fallback
  }

  try {
    const body = JSON.stringify({
      geometry: {
        buildingType: geometry.buildingType,
        floors: geometry.floors,
        totalHeight: geometry.totalHeight,
        footprintArea: geometry.footprintArea,
        gfa: geometry.gfa,
        footprint: geometry.footprint,
        storeys: geometry.storeys,
        boundingBox: geometry.boundingBox,
        metrics: geometry.metrics || [],
      },
      options: {
        projectName: options.projectName,
        buildingName: options.buildingName,
        author: options.author || "NeoBIM",
        disciplines: ["architectural", "structural", "mep", "combined"],
      },
      filePrefix,
    });

    const response = await fetch(`${IFC_SERVICE_URL}/api/v1/export-ifc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(IFC_SERVICE_API_KEY
          ? { Authorization: `Bearer ${IFC_SERVICE_API_KEY}` }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(
        `[IFC Service] HTTP ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data: IFCServiceResponse = await response.json();

    if (data.status !== "success" || !data.files?.length) {
      console.warn(`[IFC Service] Error response:`, data.error);
      return null;
    }

    return data;
  } catch (err) {
    // Network error, timeout, or JSON parse error → fall back to TS exporter
    console.warn(`[IFC Service] Unavailable, falling back to TS exporter:`, err);
    return null;
  }
}
