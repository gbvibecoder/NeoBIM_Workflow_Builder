/**
 * Geometry fallback for sparse IFCs — SINGLE SOURCE OF TRUTH.
 *
 * When an IFC element lacks extractable geometry data (e.g., ArchiCAD IfcFacetedBrep
 * that web-ifc cannot tessellate), we estimate area/volume from element type × count
 * using standard Indian construction dimensions.
 *
 * CONSUMED BY:
 *   - tr-007.ts (server-side TR-007 handler — Mode 1 + Mode 3 cascades)
 *   - useExecution.ts (client-side fast path for IFCs >1.5MB)
 *
 * DO NOT DUPLICATE THIS TABLE. If you need to add a new element type, add it HERE
 * and both consumers will pick it up automatically.
 */

export interface GeometryFallback {
  areaFactor?: number;       // m² per element (face/surface area)
  volumeFactor?: number;     // m³ per element (concrete/material volume)
  primaryUnit: "m²" | "m³"; // which factor is the primary quantity
}

export const GEOMETRY_FALLBACKS: Record<string, GeometryFallback> = {
  IfcWall:              { areaFactor: 18,   volumeFactor: 4.14,  primaryUnit: "m²" },  // 3m×6m face; 3×6×0.23m brick
  IfcWallStandardCase:  { areaFactor: 18,   volumeFactor: 4.14,  primaryUnit: "m²" },
  IfcSlab:              { areaFactor: 36,   volumeFactor: 5.4,   primaryUnit: "m²" },  // 6m×6m; ×0.15m thick
  IfcRoof:              { areaFactor: 36,   volumeFactor: 5.4,   primaryUnit: "m²" },
  IfcColumn:            { areaFactor: 4.8,  volumeFactor: 0.48,  primaryUnit: "m³" },  // 4×0.4×3m surface; 0.4²×3m vol
  IfcBeam:              { areaFactor: 7.5,  volumeFactor: 0.675, primaryUnit: "m³" },  // 2(0.45×5)+0.3×5; 0.3×0.45×5m
  IfcFooting:           {                   volumeFactor: 0.675, primaryUnit: "m³" },  // underground, no plaster surface
  IfcStair:             { areaFactor: 4.8,  volumeFactor: 0.72,  primaryUnit: "m²" },  // 1.2m×4m flight; ×0.15m avg
  IfcStairFlight:       { areaFactor: 4.8,  volumeFactor: 0.72,  primaryUnit: "m²" },
  IfcCovering:          { areaFactor: 1,                         primaryUnit: "m²" },  // finish layer, no volume
  IfcCurtainWall:       { areaFactor: 4.5,                       primaryUnit: "m²" },  // glass/aluminum panel
  IfcDoor:              { areaFactor: 1.89,                      primaryUnit: "m²" },  // 0.9m × 2.1m
  IfcWindow:            { areaFactor: 1.8,                       primaryUnit: "m²" },  // 1.5m × 1.2m
};

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface GeometryFallbackResult {
  primaryQty: number;
  unit: "m²" | "m³";
  estArea?: number;
  estVolume?: number;
}

/**
 * Estimate geometry from element type and count.
 * Returns null if no fallback exists for the given type (e.g., IfcFlowTerminal).
 */
export function estimateGeometryFromType(
  elementType: string,
  count: number,
): GeometryFallbackResult | null {
  const fb = GEOMETRY_FALLBACKS[elementType];
  if (!fb) return null;
  const estArea = fb.areaFactor ? r2(count * fb.areaFactor) : undefined;
  const estVolume = fb.volumeFactor ? r2(count * fb.volumeFactor) : undefined;
  const primaryQty = fb.primaryUnit === "m²" ? (estArea ?? estVolume!) : (estVolume ?? estArea!);
  return { primaryQty, unit: fb.primaryUnit, estArea, estVolume };
}

/**
 * Decide whether to use geometry fallback based on parsed values.
 * Returns true when geometry is missing (both zero) or sparse (partial extraction failure).
 */
export function shouldUseGeometryFallback(params: {
  elementType: string;
  count: number;
  grossArea: number;
  volume: number;
}): boolean {
  const { elementType, count, grossArea, volume } = params;

  // Only apply fallback if the element type has a GEOMETRY_FALLBACKS entry
  const fb = GEOMETRY_FALLBACKS[elementType];
  if (!fb) return false;

  // Both zero → definitely fallback
  if (grossArea === 0 && volume === 0) return true;

  // Sparse detection (Fix #2.2): per-element value < 20% of fallback estimate
  if (count <= 1) return grossArea === 0 && volume === 0;

  const estArea = fb.areaFactor ? count * fb.areaFactor : undefined;
  const estVolume = fb.volumeFactor ? count * fb.volumeFactor : undefined;

  const areaIsSparse = estArea !== undefined && grossArea > 0
    && (grossArea / count) < (estArea / count * 0.2);
  const volumeIsSparse = estVolume !== undefined && volume > 0
    && (volume / count) < (estVolume / count * 0.2);

  return areaIsSparse && volumeIsSparse;
}
