import {
  generateId,
  logger,
  generateMassingGeometry,
  generate3DModel,
  is3DAIConfigured,
  generateWithMeshy,
  isMeshyTextTo3DConfigured,
  generateIFCFile,
  parsePromptToStyle,
  extractMetadata,
  extractBuildingTypeFromText,
  type BuildingRequirements,
  type ExecutionArtifact,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-001 — Massing Generator (3D AI Studio + Meshy + image-to-3D + procedural fallback)
 * Pure copy from execute-node/route.ts (lines 5197-5632 of the pre-decomposition file).
 *
 * Tries multiple paths in order, preserving the original `if (!artifact)` chain:
 *   1. 3D AI Studio Text-to-3D
 *   2. Meshy.ai Text-to-3D
 *   3. Image-to-3D (DALL-E → SAM 3D) — flag-gated
 *   4. Procedural BIM generator with AI palette
 */
export const handleGN001: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // ── Massing Generator (3D AI Studio — Text-to-3D) ────────────────
  // Takes building description from TR-003 and generates a real AI 3D model.
  // Primary: 3D AI Studio Text-to-3D API → GLB model
  // Fallback: procedural massing-generator (if API key not configured)
  const rawData = (inputData?._raw ?? inputData) as Record<string, unknown>;
  // Prefer the user's original prompt (preserved through TR-003) over the
  // formatted/summarized content. This ensures rich architectural descriptions
  // pass through to 3D AI Studio without being reduced to generic parameters.
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

  // Always prefer 3D AI Studio for best visual quality.
  // All explicit parameters (floors, height, footprint, style, materials) are
  // captured and included in the prompt so the AI model matches the input.
  const hasExplicitParams = rawFloors > 0;
  if (hasExplicitParams) {
    logger.debug("[GN-001] Explicit parametric input detected (floors=" + floors + ", height=" + height + ") — will pass all params to 3D AI Studio for accurate generation");
  }

  let artifact: ExecutionArtifact | undefined;

  if (is3DAIConfigured()) {
    // ── PRIMARY PATH: 3D AI Studio Text-to-3D ──
    logger.debug("[GN-001] Using 3D AI Studio Text-to-3D API");

    // When content is raw JSON from IN-005 (e.g. '{"floors":12,"gfa":6000}'),
    // clear it so buildMasterPrompt generates a proper natural language prompt
    // from the structured parameters instead.
    const isJsonContent = textContent.startsWith("{") || textContent.startsWith("[");
    const cleanContent = isJsonContent ? "" : textContent;

    const requirements: BuildingRequirements = {
      buildingType,
      floors,
      floorToFloorHeight: floorToFloorH,
      height,
      style: (typeof (rawData?.style ?? rawData?.architecturalStyle) === "string") ? String(rawData?.style ?? rawData?.architecturalStyle) : "",
      massing: (typeof (rawData?.massing ?? rawData?.massingType) === "string") ? String(rawData?.massing ?? rawData?.massingType) : "",
      materials: Array.isArray(rawData?.materials) ? rawData.materials as string[] : undefined,
      footprint_m2: computedFootprint,
      features: Array.isArray(rawData?.features) ? rawData.features as string[] : undefined,
      context: (rawData?.context ?? undefined) as BuildingRequirements["context"],
      siteArea: Number(rawData?.siteArea ?? rawData?.site_area ?? 0) || undefined,
      total_gfa_m2: gfa,
      content: cleanContent,
      prompt: cleanContent,
    };

    // If footprint is an object (from structured input)
    if (rawData?.footprint && typeof rawData.footprint === "object") {
      const fp = rawData.footprint as Record<string, unknown>;
      requirements.footprint = {
        shape: String(fp.shape ?? "rectangular"),
        width: Number(fp.width ?? 0) || undefined,
        depth: Number(fp.depth ?? 0) || undefined,
        area: Number(fp.area ?? 0) || undefined,
      };
    }

    logger.debug("[GN-001] requirements:", JSON.stringify(requirements, null, 2));

    let result;
    let apiSucceeded = true;
    try {
      result = await generate3DModel(requirements);
    } catch (genErr) {
      const genMsg = genErr instanceof Error ? genErr.message : String(genErr);
      console.warn("[GN-001] 3D AI Studio API failed, falling back to procedural generator:", genMsg);
      apiSucceeded = false;
    }

    if (!apiSucceeded || !result) {
      // Fall through to procedural massing generator below
    } else {

      logger.debug("[GN-001] 3D AI Studio result:", {
        taskId: result.taskId,
        glbUrl: result.glbUrl?.slice(0, 80),
        generationTimeMs: result.metadata.generationTimeMs,
        pollAttempts: result.metadata.pollAttempts,
      });

      // Build KPI metrics array for display
      const kpis = result.kpis;
      const metrics = [
        { label: "Gross Floor Area", value: kpis.grossFloorArea.toLocaleString(), unit: "m²" },
        { label: "Net Floor Area", value: kpis.netFloorArea.toLocaleString(), unit: "m²" },
        { label: "Efficiency", value: String(kpis.efficiency), unit: "%" },
        { label: "Building Height", value: String(kpis.totalHeight), unit: "m" },
        { label: "Floors", value: String(kpis.floors), unit: "" },
        { label: "Footprint Area", value: kpis.footprintArea.toLocaleString(), unit: "m²" },
        { label: "Estimated Volume", value: kpis.estimatedVolume.toLocaleString(), unit: "m³" },
        { label: "Facade Area", value: kpis.facadeArea.toLocaleString(), unit: "m²" },
        { label: "S/V Ratio", value: String(kpis.surfaceToVolumeRatio), unit: "" },
        { label: "Structural Grid", value: kpis.structuralGrid, unit: "" },
        { label: "Est. EUI", value: String(kpis.sustainability.estimatedEUI), unit: kpis.sustainability.euiUnit },
        { label: "Daylight Potential", value: kpis.sustainability.daylightPotential, unit: "" },
        ...(kpis.floorAreaRatio !== null ? [{ label: "Floor Area Ratio", value: String(kpis.floorAreaRatio), unit: "" }] : []),
        ...(kpis.siteCoverage !== null ? [{ label: "Site Coverage", value: String(kpis.siteCoverage), unit: "%" }] : []),
      ];

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "3d",
        data: {
          glbUrl: result.glbUrl,
          thumbnailUrl: result.thumbnailUrl,
          floors: kpis.floors,
          height: kpis.totalHeight,
          footprint: kpis.footprintArea,
          gfa: kpis.grossFloorArea,
          buildingType: kpis.buildingType,
          metrics,
          content: textContent || `${kpis.floors}-storey ${kpis.buildingType}, ${kpis.grossFloorArea.toLocaleString()} m² GFA`,
          prompt: result.prompt,
          kpis,
          _raw: rawData,
        },
        metadata: {
          engine: "3daistudio",
          model: result.metadata.model,
          real: true,
          taskId: result.taskId,
          generationTimeMs: result.metadata.generationTimeMs,
        },
        createdAt: new Date(),
      };
    } // end API success block
  }

  // ── FALLBACK 1: Meshy.ai Text-to-3D ──
  // Try Meshy if 3D AI Studio didn't produce an artifact (skip for parametric input)
  if (!artifact && isMeshyTextTo3DConfigured()) {
    logger.debug("[GN-001] Trying Meshy.ai Text-to-3D as fallback");

    const meshyRequirements: BuildingRequirements = {
      buildingType,
      floors,
      floorToFloorHeight: Number(rawData?.floorToFloorHeight ?? rawData?.floor_height ?? 3.5),
      height,
      style: (typeof (rawData?.style ?? rawData?.architecturalStyle) === "string") ? String(rawData?.style ?? rawData?.architecturalStyle) : "",
      massing: (typeof (rawData?.massing ?? rawData?.massingType) === "string") ? String(rawData?.massing ?? rawData?.massingType) : "",
      materials: Array.isArray(rawData?.materials) ? rawData.materials as string[] : undefined,
      footprint_m2: computedFootprint,
      features: Array.isArray(rawData?.features) ? rawData.features as string[] : undefined,
      siteArea: Number(rawData?.siteArea ?? rawData?.site_area ?? 0) || undefined,
      total_gfa_m2: gfa,
      content: textContent,
      prompt: String(inputData?.prompt ?? textContent),
    };

    try {
      const meshyResult = await generateWithMeshy(meshyRequirements);
      logger.debug("[GN-001] Meshy result:", {
        taskId: meshyResult.taskId,
        glbUrl: meshyResult.glbUrl?.slice(0, 80),
        generationTimeMs: meshyResult.metadata.generationTimeMs,
      });

      const kpis = meshyResult.kpis;
      const metrics = [
        { label: "Gross Floor Area", value: kpis.grossFloorArea.toLocaleString(), unit: "m²" },
        { label: "Net Floor Area", value: kpis.netFloorArea.toLocaleString(), unit: "m²" },
        { label: "Efficiency", value: String(kpis.efficiency), unit: "%" },
        { label: "Building Height", value: String(kpis.totalHeight), unit: "m" },
        { label: "Floors", value: String(kpis.floors), unit: "" },
        { label: "Footprint Area", value: kpis.footprintArea.toLocaleString(), unit: "m²" },
        { label: "Estimated Volume", value: kpis.estimatedVolume.toLocaleString(), unit: "m³" },
        { label: "Facade Area", value: kpis.facadeArea.toLocaleString(), unit: "m²" },
        { label: "S/V Ratio", value: String(kpis.surfaceToVolumeRatio), unit: "" },
        { label: "Structural Grid", value: kpis.structuralGrid, unit: "" },
        { label: "Est. EUI", value: String(kpis.sustainability.estimatedEUI), unit: kpis.sustainability.euiUnit },
        { label: "Daylight Potential", value: kpis.sustainability.daylightPotential, unit: "" },
        ...(kpis.floorAreaRatio !== null ? [{ label: "Floor Area Ratio", value: String(kpis.floorAreaRatio), unit: "" }] : []),
        ...(kpis.siteCoverage !== null ? [{ label: "Site Coverage", value: String(kpis.siteCoverage), unit: "%" }] : []),
      ];

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "3d",
        data: {
          glbUrl: meshyResult.glbUrl,
          thumbnailUrl: meshyResult.thumbnailUrl,
          floors: kpis.floors,
          height: kpis.totalHeight,
          footprint: kpis.footprintArea,
          gfa: kpis.grossFloorArea,
          buildingType: kpis.buildingType,
          metrics,
          content: textContent || `${kpis.floors}-storey ${kpis.buildingType}, ${kpis.grossFloorArea.toLocaleString()} m² GFA`,
          prompt: meshyResult.prompt,
          kpis,
          _raw: rawData,
        },
        metadata: {
          engine: "meshy",
          model: meshyResult.metadata.model,
          real: true,
          taskId: meshyResult.taskId,
          generationTimeMs: meshyResult.metadata.generationTimeMs,
        },
        createdAt: new Date(),
      };
    } catch (meshyErr) {
      const meshyMsg = meshyErr instanceof Error ? meshyErr.message : String(meshyErr);
      console.warn("[GN-001] Meshy.ai API failed, falling back to procedural generator:", meshyMsg);
    }
  }

  // ── FALLBACK 2: Image-to-3D pipeline (DALL-E → SAM 3D) ──
  // Generates a photorealistic image first, then converts to 3D.
  // Often produces better architectural results than direct text-to-3D.
  // Skip for parametric input — procedural generator is more precise.
  if (!artifact && process.env.ENABLE_IMAGE_TO_3D_PIPELINE === "true" && process.env.OPENAI_API_KEY) {
    logger.debug("[GN-001] Trying Image-to-3D pipeline (DALL-E → SAM 3D) as fallback");
    try {
      const { textTo3D } = await import("@/features/3d-render/services/text-to-3d-service");
      const img3dResult = await textTo3D({
        prompt: textContent || `${buildingType}, ${floors} floors`,
        buildingDescription: rawData as unknown as import("@/services/openai").BuildingDescription | undefined,
        viewType: "exterior",
      });

      const sam3dGlbUrl = img3dResult.job.glbModel?.downloadUrl;
      if (sam3dGlbUrl) {
        // Re-upload to R2 for CORS
        let finalGlbUrl = sam3dGlbUrl;
        try {
          const { uploadIFCToR2, isR2Configured: checkR2 } = await import("@/lib/r2");
          if (checkR2()) {
            const glbRes = await fetch(sam3dGlbUrl);
            if (glbRes.ok) {
              const glbBuf = Buffer.from(await glbRes.arrayBuffer());
              const r2Result = await uploadIFCToR2(glbBuf, `img2_3d-${Date.now()}.glb`);
              if (r2Result?.url) finalGlbUrl = r2Result.url;
            }
          }
        } catch { /* keep direct URL */ }

        artifact = {
          id: generateId(),
          executionId: executionId ?? "local",
          tileInstanceId,
          type: "3d",
          data: {
            glbUrl: finalGlbUrl,
            thumbnailUrl: img3dResult.imageUrl,
            floors,
            height: height ?? floors * 3.5,
            footprint: computedFootprint,
            gfa,
            buildingType,
            content: textContent || `${floors}-storey ${buildingType}`,
            prompt: img3dResult.revisedPrompt,
            _raw: rawData,
          },
          metadata: {
            engine: "dalle-sam3d",
            model: "gpt-image-1+sam3d",
            real: true,
          },
          createdAt: new Date(),
        };
        logger.debug("[GN-001] Image-to-3D pipeline succeeded:", { glbUrl: finalGlbUrl.slice(0, 60) });
      }
    } catch (img3dErr) {
      const msg = img3dErr instanceof Error ? img3dErr.message : String(img3dErr);
      console.warn("[GN-001] Image-to-3D pipeline failed:", msg);
    }
  }

  if (!artifact) {
    // ── UNIFIED BIM+AI Pipeline ──
    // Generates procedural BIM geometry with AI-derived material palette.
    // Result: ONE model with real BIM elements that LOOKS photorealistic.
    logger.debug("[GN-001] Using unified BIM+AI pipeline");

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

    const geometry = generateMassingGeometry(massingInput);

    logger.debug("[GN-001] geometry result:", { floors: geometry.floors, height: geometry.totalHeight, footprint: geometry.footprintArea, gfa: geometry.gfa, buildingType: geometry.buildingType });

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

    // ── Unified BIM Pipeline: Generate GLB + IFC + Metadata from same geometry ──
    let assetUrls: { glbUrl: string; ifcUrl: string; metadataUrl: string } | null = null;
    try {
      // Dynamic imports to avoid DOM polyfill at module load time
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
      console.warn("[GN-001] BIM pipeline (GLB/IFC/R2) failed, continuing with procedural fallback:", pipelineErr instanceof Error ? pipelineErr.message : pipelineErr);
    }

    artifact = {
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
        // ── BIM asset URLs (null if R2 not configured → falls back to ArchitecturalViewer) ──
        glbUrl: assetUrls?.glbUrl ?? null,
        ifcUrl: assetUrls?.ifcUrl ?? null,
        metadataUrl: assetUrls?.metadataUrl ?? null,
        // ── AI concept render thumbnail ──
        thumbnailUrl: aiThumbnailUrl ?? null,
      },
      metadata: { engine: aiPalette ? "bim-ai-hybrid" : "massing-generator", real: true },
      createdAt: new Date(),
    };
  }

  return artifact;
};
