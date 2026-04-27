import {
  generateId,
  logger,
  generateMassingGeometry,
  generateIFCFile,
  parsePromptToStyle,
  extractMetadata,
  extractBuildingTypeFromText,
  type ExecutionArtifact,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-001 — Massing Generator (Procedural BIM)
 *
 * Generates structured BIM geometry from building parameters via the
 * procedural massing generator. Produces walls, windows, doors, slabs,
 * columns, beams, stairs, MEP, and spaces — all with real coordinates
 * that feed directly into the IFC exporter (EX-001).
 *
 * Optionally generates an AI material palette (via DALL-E) for the GLB
 * preview and uploads GLB + IFC + metadata to R2.
 */
export const handleGN001: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  const rawData = (inputData?._raw ?? inputData) as Record<string, unknown>;
  // Prefer the user's original prompt (preserved through TR-003) for richer
  // text extraction of building parameters.
  const rawOriginal = inputData?._originalPrompt;
  const originalPrompt = (typeof rawOriginal === "string" && rawOriginal.length > 0) ? rawOriginal : "";
  const textContent = originalPrompt || (() => {
    const c = inputData?.content ?? inputData?.prompt;
    return (typeof c === "string" && c.length > 0) ? c : "";
  })();

  // Helper: extract a number from text using regex patterns
  const extractFromText = (patterns: RegExp[], fallback: number): number => {
    for (const pat of patterns) {
      const m = textContent.match(pat);
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(v) && v > 0) return v;
      }
    }
    return fallback;
  };

  // Extract floors
  const rawFloors = Number(rawData?.floors ?? rawData?.number_of_floors ?? 0);
  const floors = rawFloors > 0 ? rawFloors : extractFromText([
    /(\d+)\s*(?:floors?|stor(?:ey|ies)|levels?)/i,
    /(\d+)[-\s]?stor(?:ey|y)/i,
  ], 5);

  // Extract footprint — skip object footprints (handled separately at line 2724)
  const rawFpValue = rawData?.footprint_m2 ?? (typeof rawData?.footprint === "number" ? rawData.footprint : 0);
  const rawFootprint = Number(rawFpValue) || 0;
  const rawTotalArea = Number(rawData?.totalArea ?? rawData?.total_area ?? 0);
  const computedFootprint = rawFootprint > 0
    ? rawFootprint
    : (rawTotalArea > 0 && floors > 0)
      ? Math.round(rawTotalArea / floors)
      : extractFromText([
          /footprint[:\s]*(?:approx\.?\s*)?(\d[\d,]*)\s*m/i,
          /(\d[\d,]*)\s*m²?\s*(?:per\s+floor|footprint)/i,
          /floor\s*(?:area|plate)[:\s]*(\d[\d,]*)/i,
        ], 500);

  // Extract building type — avoid String(undefined) producing "undefined"
  const rawBuildingType = rawData?.buildingType ?? rawData?.building_type ?? rawData?.projectType;
  const buildingType = (typeof rawBuildingType === "string" && rawBuildingType.length > 0)
    ? rawBuildingType
    : (extractBuildingTypeFromText(textContent) ?? "Mixed-Use Building");

  // Extract GFA
  const rawGFA = Number(rawData?.totalGFA ?? rawData?.total_gfa_m2 ?? rawData?.gfa ?? 0);
  const gfa = rawGFA > 0 ? rawGFA : (rawTotalArea > 0 ? rawTotalArea : undefined);

  // Extract height, style, materials, features from raw data
  const rawHeight = Number(rawData?.height ?? 0);
  const floorToFloorH = Number(rawData?.floorToFloorHeight ?? rawData?.floor_height ?? 3.5);
  // Sanity check: if height/floors < 2.5m per floor, the height is unrealistic —
  // recalculate from floors × floor-to-floor height instead.
  const heightPerFloor = (rawHeight > 0 && floors > 0) ? rawHeight / floors : 999;
  const height = (rawHeight > 0 && heightPerFloor >= 2.5) ? rawHeight : (floors > 0 ? Math.round(floors * floorToFloorH) : undefined);

  logger.debug("[GN-001] rawData keys:", Object.keys(rawData ?? {}));

  // ── Procedural BIM Pipeline ──
  // Generates procedural BIM geometry with AI-derived material palette.
  // Produces real BIM elements (walls, windows, doors, slabs, columns, stairs,
  // MEP) that feed directly into the IFC exporter (EX-001).
  logger.debug("[GN-001] Using procedural BIM pipeline");

  const massingInput = {
    floors,
    footprint_m2: computedFootprint,
    building_type: buildingType,
    total_gfa_m2: gfa,
    height,
    content: textContent,
    prompt: String(inputData?.prompt ?? textContent),
  };

  logger.debug("[GN-001] massingInput:", JSON.stringify(massingInput, null, 2));

  let geometry = generateMassingGeometry(massingInput);

  logger.debug("[GN-001] geometry result:", { floors: geometry.floors, height: geometry.totalHeight, footprint: geometry.footprintArea, gfa: geometry.gfa, buildingType: geometry.buildingType });

  // ── VIP Bridge: room-accurate interior geometry (feature-gated) ──
  try {
    const { shouldUseVipBridge, generateBuildingFromVIP, mergeVipIntoGeometry } = await import("@/features/3d-render/services/vip-bridge");
    if (shouldUseVipBridge(buildingType, floors)) {
      logger.info("[GN-001] VIP-BRIDGE: generating room-accurate plans");
      const vipResult = await generateBuildingFromVIP(
        { prompt: textContent, floors, floorToFloorHeight: geometry.totalHeight / geometry.floors, footprint_m2: computedFootprint, buildingType },
        geometry,
      );
      geometry = mergeVipIntoGeometry(geometry, vipResult);
      logger.info("[GN-001] VIP-BRIDGE: merged", { totalElements: vipResult.totalElements, fallbackCount: vipResult.fallbackCount, costUsd: vipResult.costUsd.toFixed(2) });
    }
  } catch (vipErr) {
    logger.warn("[GN-001] VIP-BRIDGE failed (non-fatal, using procedural):", vipErr instanceof Error ? vipErr.message : vipErr);
  }

  // ── AI Material Palette: Generate concept render + extract color palette ──
  let aiThumbnailUrl: string | null = null;
  let aiPalette: Record<string, Partial<import("@/features/3d-render/services/material-mapping").PBRMaterialDef>> | null = null;
  try {
    const { generateAIMaterialPalette, paletteToMaterialOverrides } = await import("@/features/3d-render/services/ai-material-palette");
    const { palette, imageUrl } = await generateAIMaterialPalette(
      textContent || `${buildingType}, ${floors} floors`,
      buildingType,
    );
    aiPalette = paletteToMaterialOverrides(palette);
    aiThumbnailUrl = imageUrl;
    logger.debug("[GN-001] AI palette extracted:", { style: palette.style, facade: palette.facadeMaterial, glassTint: palette.glassTint });
  } catch (paletteErr) {
    console.warn("[GN-001] AI palette generation failed (non-fatal):", paletteErr instanceof Error ? paletteErr.message : paletteErr);
  }

  // ── BIM Pipeline: Generate GLB + IFC + Metadata from geometry ──
  let assetUrls: { glbUrl: string; ifcUrl: string; metadataUrl: string } | null = null;
  try {
    const { generateGLB } = await import("@/features/3d-render/services/glb-generator");
    const { uploadBuildingAssets, isR2Configured: checkR2 } = await import("@/lib/r2");

    const metadata = extractMetadata(geometry);
    const metadataJson = JSON.stringify(metadata);

    // Generate GLB (with AI palette if available) and IFC in parallel
    const [glbBuffer, ifcContent] = await Promise.all([
      generateGLB(geometry, aiPalette ?? undefined),
      Promise.resolve(generateIFCFile(geometry, {
        buildingName: geometry.buildingType,
        projectName: massingInput.content?.slice(0, 80) || geometry.buildingType,
      })),
    ]);

    logger.debug("[GN-001] GLB generated:", { sizeKB: Math.round(glbBuffer.length / 1024) });
    logger.debug("[GN-001] IFC generated:", { sizeKB: Math.round(ifcContent.length / 1024) });
    logger.debug("[GN-001] Metadata:", { elements: Object.keys(metadata.elements).length, storeys: metadata.storeys.length });

    // Upload all to R2 if configured
    if (checkR2()) {
      const buildingId = generateId();
      assetUrls = await uploadBuildingAssets(glbBuffer, ifcContent, metadataJson, buildingId);
      if (assetUrls) {
        logger.debug("[GN-001] Uploaded to R2:", { glb: assetUrls.glbUrl.slice(0, 60), ifc: assetUrls.ifcUrl.slice(0, 60) });
      }
    }
  } catch (pipelineErr) {
    console.warn("[GN-001] BIM pipeline (GLB/IFC/R2) failed (non-fatal):", pipelineErr instanceof Error ? pipelineErr.message : pipelineErr);
  }

  const artifact: ExecutionArtifact = {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "3d",
    data: {
      floors: geometry.floors,
      height: geometry.totalHeight,
      footprint: geometry.footprintArea,
      gfa: geometry.gfa,
      buildingType: geometry.buildingType,
      metrics: geometry.metrics,
      content: massingInput.content || `${geometry.floors}-storey ${geometry.buildingType}, ${geometry.gfa.toLocaleString()} m² GFA`,
      prompt: massingInput.prompt || massingInput.content,
      _geometry: geometry,
      _raw: rawData,
      style: parsePromptToStyle(
        massingInput.prompt || massingInput.content || "",
        geometry.floors,
        geometry.buildingType
      ),
      // ── BIM asset URLs (null if R2 not configured) ──
      glbUrl: assetUrls?.glbUrl ?? null,
      ifcUrl: assetUrls?.ifcUrl ?? null,
      metadataUrl: assetUrls?.metadataUrl ?? null,
      // ── AI concept render thumbnail ──
      thumbnailUrl: aiThumbnailUrl ?? null,
    },
    metadata: { engine: aiPalette ? "bim-ai-hybrid" : "massing-generator", real: true },
    createdAt: new Date(),
  };

  return artifact;
};
