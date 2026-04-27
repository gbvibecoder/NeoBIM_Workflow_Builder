import {
  NextResponse,
  generateId,
  formatErrorResponse,
  logger,
  generateConceptImage,
  generateRenovationRender,
  submitDualWalkthrough,
  submitDualTextToVideo,
  submitFloorPlanWalkthrough,
  buildFloorPlanCombinedPrompt,
} from "./deps";
import type { NodeHandler } from "./types";
import { createVideoJobAndEnqueue } from "@/features/3d-render/services/video-job-service";
import {
  extractBriefContext,
  buildBriefDrivenExteriorPrompt,
  buildBriefDrivenInteriorPrompt,
  EMPTY_EXTRACTION,
  type BriefExtraction,
} from "@/features/3d-render/services/brief-extractor";

/**
 * GN-009 — Video Walkthrough Generator (Kling Official API + Three.js fallback)
 * Pure copy from execute-node/route.ts (lines 3952-4500 of the pre-decomposition file).
 *
 * Three execution paths:
 *   1. Image-to-video via Kling (when an upstream image is available)
 *   2. Text-to-video via Kling (PDF → video pipeline)
 *   3. Three.js client-side fallback (no Kling keys)
 */
export const handleGN009: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey, userId, dbExecutionId } = ctx;
  /**
   * Feature flag for the QStash-backed background VideoJob pipeline.
   * When "true", each Kling submit branch below creates a VideoJob row +
   * enqueues a worker instead of returning taskIds to the client.
   * When anything else (including undefined), preserves the legacy behavior
   * so rollback is instant by flipping the env var.
   */
  const useBackgroundJobs = process.env.VIDEO_BG_JOBS === "true";
  // ── Video Walkthrough Generator ────────────────────────────────────
  // Generates a cinematic walkthrough video. Supports three paths:
  // 1. Image-to-video via Kling API (when upstream GN-003 provides a render image)
  // 2. Text-to-video via Kling API (when no image, e.g. PDF → video pipeline)
  // 3. Three.js client-side fallback (when no Kling keys configured)

  // Extract building description from upstream data.
  // IMPORTANT: For the PDF → video pipeline, we use the ORIGINAL PDF text
  // (preserved in _raw.rawText by TR-001) as the sole source of truth.
  // This ensures the video matches exactly what the user uploaded in the PDF.
  const raw = (inputData?._raw ?? null) as Record<string, unknown> | null;

  // Priority: original PDF text (_raw.rawText) > formatted content > fallback
  // _raw.rawText is the original text extracted from the PDF by TR-001,
  // before any GPT rewriting. This is critical for faithful video generation.
  const originalPdfText = (raw?.rawText as string) ?? null;
  const upFloors = Number(raw?.floors ?? inputData?.floors) || 5;
  const upTotalArea = Number(raw?.totalArea ?? inputData?.totalArea) || 0;
  const upHeight = Number(raw?.height ?? inputData?.height) || 0;
  const upFloorHeight = upHeight > 0 ? upHeight / upFloors : 3.6;
  const upFootprint = Number(raw?.footprint ?? inputData?.footprint) || (upTotalArea > 0 ? Math.round(upTotalArea / upFloors) : 600);
  const upBuildingType = String(raw?.buildingType ?? inputData?.buildingType ?? "modern office building");
  const upFacade = String(raw?.facade ?? inputData?.facade ?? "");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const upStructure = String(raw?.structure ?? inputData?.structure ?? "");
  const upNarrative = String(raw?.narrative ?? "");

  // Map facade description to exteriorMaterial for Three.js BuildingStyle
  function inferExteriorMaterial(facade: string): "glass" | "concrete" | "brick" | "wood" | "steel" | "stone" | "terracotta" | "mixed" {
    const f = facade.toLowerCase();
    if (f.includes("glass") || f.includes("curtain wall") || f.includes("glazed")) return "glass";
    if (f.includes("brick") || f.includes("masonry")) return "brick";
    if (f.includes("timber") || f.includes("wood") || f.includes("clt")) return "wood";
    if (f.includes("steel") || f.includes("corten") || f.includes("metal")) return "steel";
    if (f.includes("stone") || f.includes("limestone") || f.includes("marble")) return "stone";
    if (f.includes("terracotta") || f.includes("clay")) return "terracotta";
    if (f.includes("concrete") || f.includes("render") || f.includes("stucco")) return "concrete";
    return "mixed";
  }

  // Map buildingType to usage category
  function inferUsage(bt: string): "residential" | "office" | "mixed" | "commercial" | "hotel" | "educational" | "healthcare" | "cultural" | "industrial" | "civic" {
    const t = bt.toLowerCase();
    if (t.includes("residential") || t.includes("apartment") || t.includes("housing")) return "residential";
    if (t.includes("office") || t.includes("workplace") || t.includes("corporate")) return "office";
    if (t.includes("hotel") || t.includes("hospitality")) return "hotel";
    if (t.includes("school") || t.includes("university") || t.includes("education")) return "educational";
    if (t.includes("hospital") || t.includes("clinic") || t.includes("health")) return "healthcare";
    if (t.includes("museum") || t.includes("gallery") || t.includes("cultural") || t.includes("theater")) return "cultural";
    if (t.includes("retail") || t.includes("shop") || t.includes("commercial")) return "commercial";
    if (t.includes("industrial") || t.includes("warehouse") || t.includes("factory")) return "industrial";
    if (t.includes("mixed")) return "mixed";
    return "office";
  }

  // Map to facade pattern
  function inferFacadePattern(facade: string): "curtain-wall" | "punched-window" | "ribbon-window" | "brise-soleil" | "none" {
    const f = facade.toLowerCase();
    if (f.includes("curtain") || f.includes("glazed")) return "curtain-wall";
    if (f.includes("ribbon")) return "ribbon-window";
    if (f.includes("brise") || f.includes("louvre") || f.includes("louver")) return "brise-soleil";
    if (f.includes("punch")) return "punched-window";
    return "curtain-wall";
  }

  logger.debug("========== GN-009 VIDEO WALKTHROUGH START ==========");
  logger.debug("[GN-009] All input keys:", Object.keys(inputData ?? {}));
  logger.debug("[GN-009] fileData present:", !!(inputData?.fileData));
  logger.debug("[GN-009] fileData length:", typeof inputData?.fileData === "string" ? inputData.fileData.length : 0);
  logger.debug("[GN-009] imageUrl present:", !!(inputData?.imageUrl));
  logger.debug("[GN-009] url present:", !!(inputData?.url));
  logger.debug("[GN-009] svg present:", !!(inputData?.svg));
  logger.debug("[GN-009] content (buildingDesc) present:", !!(inputData?.content));
  logger.debug("[GN-009] content value:", JSON.stringify(inputData?.content)?.slice(0, 200));
  logger.debug("[GN-009] description present:", !!(inputData?.description));
  logger.debug("[GN-009] mimeType:", inputData?.mimeType);
  logger.debug("[GN-009] KLING_ACCESS_KEY set:", !!process.env.KLING_ACCESS_KEY, "KLING_SECRET_KEY set:", !!process.env.KLING_SECRET_KEY);

  const hasKlingKeys = !!(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);

  // ── Resolve the SOURCE IMAGE for Kling (priority order) ──
  let renderImageUrl = "";
  let isFloorPlanInput = false;
  let isRenovationInput = false; // true when user uploaded building photos (IN-008) — triggers renovation prompts
  let roomInfo = "";

  logger.debug("[KLING] Step 1: fileData present:", !!(inputData?.fileData), "size:", typeof inputData?.fileData === "string" ? inputData.fileData.length : 0);
  logger.debug("[KLING] Step 1: url present:", !!(inputData?.url), "imageUrl present:", !!(inputData?.imageUrl), "svg present:", !!(inputData?.svg));

  // ── Priority 1: Direct image upload from IN-003/IN-008 (original user file) ──
  // FIX F: Send base64 directly to Kling API — no temp-image URL needed.
  // Kling's image field accepts both URLs and base64 encoded strings.
  // Skip non-image files (PDFs, docs) — they should use text2video path instead.
  const inputMimeType = (inputData?.mimeType as string) ?? "";
  const isImageFile = inputMimeType.startsWith("image/") || !inputMimeType;
  if (inputData?.fileData && typeof inputData.fileData === "string" && isImageFile) {
    const imgMime = inputMimeType || "image/jpeg";
    const rawImg = inputData.fileData as string;
    const cleanBase64 = rawImg.startsWith("data:") ? rawImg.split(",")[1] ?? rawImg : rawImg;

    logger.debug("[KLING] Step 2: Clean base64 length:", cleanBase64.length, "mime:", imgMime);

    // Strategy: R2 URL (if configured) → raw base64 directly to Kling
    // Try R2 first (if configured) — a URL is fastest for Kling
    try {
      const { uploadToR2, isR2Configured } = await import("@/lib/r2");
      if (isR2Configured()) {
        logger.debug("[KLING] Step 2a: R2 is configured, uploading...");
        const ext = imgMime.includes("png") ? "png" : "jpg";
        const imgBuffer = Buffer.from(cleanBase64, "base64");
        const uploadResult = await uploadToR2(imgBuffer, `building-photo-${generateId()}.${ext}`, imgMime);
        if (uploadResult.success) {
          renderImageUrl = uploadResult.url;
          logger.debug("[KLING] Step 2a: R2 upload succeeded:", renderImageUrl);
        }
      } else {
        logger.debug("[KLING] Step 2a: R2 not configured, skipping");
      }
    } catch (r2Err) {
      console.warn("[KLING] Step 2a: R2 upload failed:", r2Err);
    }

    // FIX F: Send raw base64 directly to Kling (skip temp-image entirely)
    if (!renderImageUrl) {
      logger.debug("[KLING] Step 2b: Sending base64 DIRECTLY to Kling (Fix F — no temp-image URL)");
      renderImageUrl = cleanBase64;
      logger.debug("[KLING] Step 2b: Using raw base64, length:", cleanBase64.length);
    }

    // Only mark as floor plan if TR-004 analysis flagged it or if upstream says so.
    // Building photos from IN-008 are NOT floor plans — they should use image2video path.
    const upstreamIsFloorPlan = !!(inputData?.isFloorPlan);
    isFloorPlanInput = upstreamIsFloorPlan;

    // Building photos from IN-008 trigger renovation prompts —
    // transform the old/existing building into a modernized, polished version.
    // Detect via isMultiImage flag (set by IN-008 handler) or absence of floor plan flag.
    if (!upstreamIsFloorPlan) {
      isRenovationInput = !!(inputData?.isMultiImage) || !!(inputData?.fileDataArray);
    }
  }

  // ── Priority 2: Floor plan SVG from GN-004 ──
  // FIX F: Convert SVG→PNG, then send base64 directly to Kling.
  if (!renderImageUrl && inputData?.svg && typeof inputData.svg === "string") {
    logger.debug("[KLING] Step 2 (SVG): Floor plan SVG detected, converting to PNG...");
    try {
      const sharp = (await import("sharp")).default;
      const pngBuffer = await sharp(Buffer.from(inputData.svg))
        .resize(1280, 960, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png({ quality: 90 })
        .toBuffer();

      // Try R2 first (if configured)
      const { uploadToR2, isR2Configured } = await import("@/lib/r2");
      if (isR2Configured()) {
        const uploadResult = await uploadToR2(pngBuffer, `floorplan-${generateId()}.png`, "image/png");
        if (uploadResult.success) {
          renderImageUrl = uploadResult.url;
          logger.debug("[KLING] Step 2 (SVG): R2 upload:", renderImageUrl);
        } else {
          console.warn("[KLING] Step 2 (SVG): R2 upload failed:", uploadResult.error);
        }
      }

      // FIX F: Send PNG base64 directly to Kling (skip temp-image)
      if (!renderImageUrl) {
        logger.debug("[KLING] Step 2 (SVG): Sending PNG base64 DIRECTLY to Kling (Fix F)");
        renderImageUrl = pngBuffer.toString("base64");
        logger.debug("[KLING] Step 2 (SVG): Using raw base64, length:", renderImageUrl.length);
      }
      isFloorPlanInput = true;
    } catch (svgErr) {
      console.warn("[KLING] Step 2 (SVG): SVG→PNG conversion failed:", svgErr);
    }

    // Extract room info for richer prompts
    const roomList = inputData.roomList as Array<{ name: string; area: number }> | undefined;
    if (roomList?.length) {
      roomInfo = roomList.map(r => `${r.name} (${r.area}m²)`).join(", ");
    }
  }

  // ── Priority 3: URL from upstream (GN-003 concept render or TR-004 R2 upload) ──
  if (!renderImageUrl) {
    renderImageUrl =
      (inputData?.url as string) ??
      (inputData?.images_out as string) ??
      (inputData?.imageUrl as string) ??
      "";
    if (renderImageUrl) {
      logger.debug("[KLING] Step 2 (Priority 3): Using upstream URL:", renderImageUrl.slice(0, 120));
    }
  }

  // Build video from building description (from upstream TR-004 or fallback)
  // Use original PDF text (_raw.rawText) as source of truth when available
  const buildingDesc = originalPdfText
    ?? (inputData?.content as string)
    ?? (inputData?.description as string)
    ?? (inputData?.prompt as string)
    ?? "Modern architectural building";

  // Pick up roomInfo from TR-004 output (GPT-4o extracted rooms) or SVG roomList
  if (!roomInfo && inputData?.roomInfo && typeof inputData.roomInfo === "string") {
    roomInfo = inputData.roomInfo as string;
    logger.debug("[GN-009] roomInfo from TR-004 (GPT-4o):", roomInfo.slice(0, 300));
  }

  // Also pick up layoutDescription from TR-004
  const layoutDescription = (inputData?.layoutDescription as string) ?? "";

  // Fallback renovation detection: if we have building photo data specifically from IN-008
  // (identified by isMultiImage or fileDataArray flags) and it's not a floor plan.
  // DO NOT match IN-003 single image uploads — those use standard prompts.
  if (!isRenovationInput && !isFloorPlanInput) {
    const hasMultiImageMarker = !!(inputData?.isMultiImage) || !!(inputData?.fileDataArray);
    if (hasMultiImageMarker) {
      isRenovationInput = true;
      logger.debug("[GN-009] Fallback: detected IN-008 multi-image markers → enabling renovation mode");
    }
  }

  logger.debug("===== GN-009 VIDEO DEBUG =====");
  logger.debug("[GN-009] All inputData keys:", Object.keys(inputData ?? {}));
  logger.debug("[GN-009] buildingDescription:", JSON.stringify(buildingDesc)?.slice(0, 800));
  logger.debug("[GN-009] roomInfo:", JSON.stringify(roomInfo)?.slice(0, 800));
  logger.debug("[GN-009] layoutDescription:", JSON.stringify(layoutDescription)?.slice(0, 500));
  logger.debug("[GN-009] isFloorPlan:", isFloorPlanInput);
  logger.debug("[GN-009] isRenovation:", isRenovationInput);
  logger.debug("[GN-009] isMultiImage:", !!(inputData?.isMultiImage));
  logger.debug("[GN-009] fileDataArray:", !!(inputData?.fileDataArray));
  logger.debug("[GN-009] renderImageUrl resolved:", renderImageUrl ? renderImageUrl.slice(0, 120) : "EMPTY");
  logger.debug("==============================");

  // ── Structured brief extraction (Claude Sonnet 4.6) ──
  // Extract building type, materials, lighting, persona, and space info from
  // the PDF text so all downstream prompts are brief-driven, not hardcoded.
  // Runs once; the result is passed through the entire prompt chain.
  // Graceful fallback: returns EMPTY_EXTRACTION on any failure.
  let briefExtraction: BriefExtraction = EMPTY_EXTRACTION;
  if (buildingDesc && buildingDesc.length >= 50) {
    briefExtraction = await extractBriefContext(buildingDesc);
  }

  // ── Fallback: generate an exterior concept render when no upstream image ──
  // WF-08 (PDF Brief → Video) sends only text to GN-009. Without a source
  // image, the text-to-video Kling endpoint produces near-static exterior clips
  // and fails to enter the building for interior shots (diagnosis 2026-04-27).
  // Generate a GPT-Image-1.5 exterior concept render so the image-to-video path
  // (with Phase 3 interior reference generation) is used.
  if (!renderImageUrl && hasKlingKeys) {
    const conceptApiKey = apiKey || process.env.OPENAI_API_KEY || undefined;
    if (conceptApiKey) {
      try {
        logger.debug("[GN-009] No upstream image — generating brief-driven exterior concept render");
        // Build prompt from extraction — no hardcoded materials/lighting
        const conceptPrompt = buildBriefDrivenExteriorPrompt(briefExtraction, buildingDesc);
        const conceptResult = await generateConceptImage(
          conceptPrompt,
          "photorealistic architectural exterior, high-end visualization",
          conceptApiKey,
          undefined,
          undefined,
          undefined,
          "exterior",
        );
        if (conceptResult.url) {
          renderImageUrl = conceptResult.url;
          logger.debug("[GN-009] Concept render generated:", renderImageUrl.slice(0, 120));
        }
      } catch (conceptErr) {
        const msg = conceptErr instanceof Error ? conceptErr.message : String(conceptErr);
        logger.warn("[GN-009] Concept render failed, falling back to text-to-video: " + msg);
      }
    }
  }

  if (!hasKlingKeys) {
    // ── No Kling API keys — fall back to Three.js client-side rendering ──
    // Build a rich BuildingStyle from the PDF-extracted description
    const inferredStyle = {
      glassHeavy: upFacade.toLowerCase().includes("glass") || upFacade.toLowerCase().includes("glazed"),
      hasRiver: buildingDesc.toLowerCase().includes("river") || buildingDesc.toLowerCase().includes("waterfront"),
      hasLake: buildingDesc.toLowerCase().includes("lake"),
      isModern: buildingDesc.toLowerCase().includes("modern") || buildingDesc.toLowerCase().includes("contemporary") || !buildingDesc.toLowerCase().includes("traditional"),
      isTower: upFloors > 8,
      exteriorMaterial: inferExteriorMaterial(upFacade),
      environment: (buildingDesc.toLowerCase().includes("urban") || buildingDesc.toLowerCase().includes("city")) ? "urban" as const : "suburban" as const,
      usage: inferUsage(upBuildingType),
      promptText: upNarrative || buildingDesc.slice(0, 200),
      typology: (upFloors > 8 ? "tower" : upFloors <= 3 ? "villa" : "slab") as "tower" | "slab" | "villa",
      facadePattern: inferFacadePattern(upFacade),
      maxFloorCap: 30,
    };

    return {
      id: generateId(),
      executionId: executionId ?? "local",
      tileInstanceId,
      type: "video",
      data: {
        name: `walkthrough_${generateId()}.webm`,
        videoUrl: "",
        downloadUrl: "",
        label: "AEC Cinematic Walkthrough — 15s Three.js Render",
        content: `15s AEC walkthrough: 5s exterior drone orbit + 10s interior flythrough — ${buildingDesc.slice(0, 100)}`,
        durationSeconds: 15,
        shotCount: 4,
        pipeline: "Three.js client-side → WebM video",
        costUsd: 0,
        videoGenerationStatus: "client-rendering",
        _buildingConfig: {
          floors: upFloors,
          floorHeight: upFloorHeight,
          footprint: upFootprint,
          buildingType: upBuildingType,
          style: inferredStyle,
        },
      },
      metadata: { engine: "threejs-client", real: false },
      createdAt: new Date(),
    };
  } else if (renderImageUrl) {
    // ── Kling image-to-video path (has a source image) ──
    // Detect if image is base64 (Fix F) vs URL
    const isBase64Direct = !renderImageUrl.startsWith("http");
    if (!isBase64Direct && (renderImageUrl.includes("localhost") || renderImageUrl.includes("127.0.0.1"))) {
      console.warn("[KLING] Image URL is localhost — Kling API cannot access this.");
      console.warn("[KLING]    To fix: deploy to a public URL, or use ngrok to tunnel localhost.");
    }

    logger.debug("[GN-009] About to call video function:");
    logger.debug("[GN-009] Image being passed (first 100 chars):", renderImageUrl?.slice(0, 100));
    logger.debug("[GN-009] Image type:", renderImageUrl?.startsWith("http") ? "URL" : renderImageUrl?.startsWith("data:") ? "data URI" : "raw base64");
    logger.debug("[GN-009] Image total length:", renderImageUrl?.length);
    logger.debug("[GN-009] Mode: pro");
    logger.debug("[GN-009] isFloorPlan flag:", isFloorPlanInput);
    logger.debug("[GN-009] buildingDesc (first 200 chars):", buildingDesc?.slice(0, 200));

    try {
      if (isFloorPlanInput) {
        // ── Floor plan video: tries Kling 3.0 Omni (12s) → fallback v2.6 (10s) ──
        logger.debug("[GN-009] Function: submitFloorPlanWalkthrough (Omni v3 12s → fallback v2.6 10s)");
        logger.debug("[GN-009] buildFloorPlanCombinedPrompt args — buildingDesc length:", buildingDesc?.length, "roomInfo length:", roomInfo?.length);
        const combinedPrompt = buildFloorPlanCombinedPrompt(buildingDesc, roomInfo);
        logger.debug("[GN-009] FINAL PROMPT SENT TO KLING:", combinedPrompt?.slice(0, 1500));

        const submitted = await submitFloorPlanWalkthrough(renderImageUrl, combinedPrompt, "pro");

        logger.debug("[GN-009] Floor plan task submitted! taskId:", submitted.taskId, "usedOmni:", submitted.usedOmni, "duration:", submitted.durationSeconds);

        // ── New path: background VideoJob via QStash worker ────────────────
        if (useBackgroundJobs) {
          const videoJobId = await createVideoJobAndEnqueue({
            userId,
            executionId: executionId ?? "local",
            dbExecutionId,
            nodeId: tileInstanceId,
            pipeline: "omni",
            isRenovation: false,
            isFloorPlan: true,
            segments: [
              {
                kind: "single",
                taskId: submitted.taskId,
                durationSeconds: submitted.durationSeconds,
              },
            ],
            buildingDescription: buildingDesc,
          });
          logger.debug("[GN-009] BG-JOBS floor-plan VideoJob created:", videoJobId);
          logger.debug("========== GN-009 VIDEO WALKTHROUGH END ==========");
          return {
            id: generateId(),
            executionId: executionId ?? "local",
            tileInstanceId,
            type: "video" as const,
            data: {
              name: `walkthrough_${generateId()}.mp4`,
              videoUrl: "",
              downloadUrl: "",
              label: `Floor Plan → Cinematic Walkthrough — ${submitted.durationSeconds}s (generating...)`,
              content: `${submitted.durationSeconds}s AEC walkthrough: exterior + interior in one continuous shot — ${buildingDesc.slice(0, 100)}`,
              durationSeconds: submitted.durationSeconds,
              shotCount: 1,
              pipeline: `floor plan → AI video · pro → MP4`,
              costUsd: submitted.durationSeconds * 0.10,
              videoGenerationStatus: "queued" as const,
              videoJobId,
              generationProgress: 0,
              isFloorPlanInput: true,
              usedOmni: submitted.usedOmni,
            },
            metadata: {
              engine: "kling-official",
              real: true,
              videoJobId,
              submittedAt: submitted.submittedAt,
              isFloorPlanInput: true,
              usedOmni: submitted.usedOmni,
              videoPipeline: "omni" as const,
            },
            createdAt: new Date(),
          };
        }

        // ── Legacy path: client polls Kling directly via taskIds ───────────
        const fpArtifact = {
          id: generateId(),
          executionId: executionId ?? "local",
          tileInstanceId,
          type: "video" as const,
          data: {
            name: `walkthrough_${generateId()}.mp4`,
            videoUrl: "",
            downloadUrl: "",
            label: submitted.usedOmni
              ? `Floor Plan → Kling 3.0 Walkthrough — ${submitted.durationSeconds}s (generating...)`
              : `Floor Plan → Cinematic Walkthrough — ${submitted.durationSeconds}s (generating...)`,
            content: `${submitted.durationSeconds}s AEC walkthrough: exterior + interior in one continuous shot — ${buildingDesc.slice(0, 100)}`,
            durationSeconds: submitted.durationSeconds,
            shotCount: 1,
            pipeline: submitted.usedOmni
              ? `floor plan → Kling 3.0 Omni (pro, ${submitted.durationSeconds}s) → MP4`
              : `floor plan → Kling v2.6 (pro, ${submitted.durationSeconds}s) → MP4`,
            costUsd: submitted.durationSeconds * 0.10,
            videoGenerationStatus: "processing",
            taskId: submitted.taskId,
            generationProgress: 0,
            isFloorPlanInput: true,
            usedOmni: submitted.usedOmni,
          },
          metadata: {
            engine: "kling-official",
            real: true,
            taskId: submitted.taskId,
            submittedAt: submitted.submittedAt,
            isFloorPlanInput: true,
            usedOmni: submitted.usedOmni,
          },
          createdAt: new Date(),
        };
        logger.debug("[GN-009] Artifact data.taskId:", submitted.taskId);
        logger.debug("[GN-009] Artifact data.usedOmni:", submitted.usedOmni);
        logger.debug("[GN-009] Artifact data.durationSeconds:", submitted.durationSeconds);
        logger.debug("========== GN-009 VIDEO WALKTHROUGH END ==========");
        return fpArtifact;
      } else {
        // ── DUAL video for non-floor-plan (concept renders or building photos) ──
        logger.debug("[GN-009] Function: submitDualWalkthrough (dual 5s+10s), isRenovation:", isRenovationInput);

        // ── RENOVATION PATH: Generate a DALL-E 3 renovation render first ──
        // Kling image2video preserves the source image too faithfully — old cracked
        // walls stay cracked. So for building photo inputs, we first generate a
        // DALL-E 3 "renovated" version of the building, then feed THAT to Kling.
        let klingSourceImage = renderImageUrl;
        let renovationRenderUrl: string | undefined;

        // Use env OPENAI_API_KEY as fallback when user doesn't have a personal key
        const dalleKey = apiKey || process.env.OPENAI_API_KEY || undefined;

        // ── Multi-image: pick the WIDEST image (shows the most of the building) ──
        // Users upload multiple photos from different angles; the widest one typically
        // captures the full facade. Use sharp to compare aspect ratios.
        const allImages = (inputData?.fileDataArray as string[]) ?? [];
        const allMimes = (inputData?.mimeTypes as string[]) ?? [];
        let bestPhotoBase64 = (inputData?.fileData as string) ?? "";
        let bestPhotoMime = (inputData?.mimeType as string) ?? "image/jpeg";

        if (allImages.length > 1) {
          try {
            const sharp = (await import("sharp")).default;
            let bestWidth = 0;
            let bestRatio = 0;
            for (let i = 0; i < allImages.length; i++) {
              const imgBuf = Buffer.from(
                allImages[i].startsWith("data:") ? allImages[i].split(",")[1] ?? allImages[i] : allImages[i],
                "base64",
              );
              const meta = await sharp(imgBuf).metadata();
              const w = meta.width ?? 0;
              const h = meta.height ?? 1;
              const ratio = w / h;
              // Prefer widest aspect ratio (panoramic) or largest width
              if (ratio > bestRatio || (ratio === bestRatio && w > bestWidth)) {
                bestRatio = ratio;
                bestWidth = w;
                bestPhotoBase64 = allImages[i];
                bestPhotoMime = allMimes[i] ?? "image/jpeg";
              }
            }
            logger.debug(`[GN-009] Multi-image: picked widest image (ratio ${bestRatio.toFixed(2)}, ${bestWidth}px) from ${allImages.length} photos`);
          } catch (sharpErr) {
            logger.debug("[GN-009] Sharp dimension check failed, using first image:", sharpErr);
          }
        }

        const originalPhotoBase64 = bestPhotoBase64;
        const originalPhotoMime = bestPhotoMime;

        if (isRenovationInput && dalleKey && originalPhotoBase64) {
          logger.debug("[GN-009] Renovation: GPT-image-1 will edit the ACTUAL photo → renovation render");
          logger.debug("[GN-009] Original photo base64 length:", originalPhotoBase64.length);
          logger.debug("[GN-009] Building analysis:", buildingDesc.slice(0, 300));

          try {
            const dalleResult = await generateRenovationRender(
              originalPhotoBase64.startsWith("data:") ? originalPhotoBase64.split(",")[1] ?? originalPhotoBase64 : originalPhotoBase64,
              buildingDesc,
              originalPhotoMime,
              dalleKey,
            );

            if (dalleResult.url) {
              renovationRenderUrl = dalleResult.url;
              klingSourceImage = dalleResult.url;
              logger.debug("[GN-009] Renovation render SUCCESS! URL:", dalleResult.url.slice(0, 100));
              logger.debug("[GN-009] GPT-image-1 renovation prompt:", dalleResult.renovationPrompt.slice(0, 200));
            }
          } catch (dalleErr) {
            // Non-fatal — fall back to original image for Kling
            console.warn("[GN-009] Renovation render failed, falling back to original photo:", dalleErr);
          }
        } else if (isRenovationInput) {
          logger.debug("[GN-009] Renovation skipped — missing:", !dalleKey ? "OPENAI_API_KEY" : "originalPhotoBase64");
        }

        // Phase 3 — generate a GPT-Image-1.5 eye-level interior reference so the
        // Kling interior task has an actual interior image to animate. Without this,
        // both tasks shared the exterior image and the interior segment produced
        // exterior-looking content. When briefExtraction is available, the prompt is
        // driven by the PDF's materials/lighting/space — no hardcoded residential
        // defaults. Falls back to the legacy template when extraction is empty.
        let interiorImageUrl: string | undefined;
        if (dalleKey && klingSourceImage) {
          try {
            logger.debug("[GN-009] Phase 3: generating interior reference...");
            const { generateLifestyleImage } = await import("@/features/3d-render/services/cinematic-pipeline");

            // Build brief-driven prompt when extraction has data; otherwise
            // let generateLifestyleImage use its built-in template (legacy path).
            const hasExtraction = briefExtraction !== EMPTY_EXTRACTION;
            const interiorPromptOverride = hasExtraction
              ? buildBriefDrivenInteriorPrompt(briefExtraction, buildingDesc)
              : undefined;
            const primaryRoom = briefExtraction.spaceType ?? "Living Room";

            const interiorRef = await generateLifestyleImage({
              floorPlanRef: klingSourceImage,
              description: buildingDesc,
              primaryRoom,
              apiKey: dalleKey,
              promptOverride: interiorPromptOverride,
            });
            interiorImageUrl = interiorRef.url;
            logger.debug("[GN-009] Phase 3: interior reference ready:", interiorImageUrl?.slice(0, 100));
          } catch (interiorErr) {
            const msg = interiorErr instanceof Error ? interiorErr.message : String(interiorErr);
            logger.warn("[GN-009] Phase 3: interior reference generation failed — falling back to exterior image for interior segment. " + msg);
          }
        }

        const submitted = await submitDualWalkthrough(klingSourceImage, buildingDesc, "pro", {
          isRenovation: isRenovationInput,
          interiorImageUrl,   // Phase 3 — undefined on failure → falls back to exterior image
          extraction: briefExtraction !== EMPTY_EXTRACTION ? briefExtraction : undefined,
        });

        logger.debug("[GN-009] Dual tasks submitted! exterior:", submitted.exteriorTaskId, "interior:", submitted.interiorTaskId);

        const exteriorDuration = isRenovationInput ? 10 : 5;
        const interiorDuration = 10;
        const totalDuration = exteriorDuration + interiorDuration;
        const videoLabel = isRenovationInput
          ? `Building Renovation Walkthrough — ${totalDuration}s (generating...)`
          : `AEC Cinematic Walkthrough — ${totalDuration}s (generating...)`;
        const videoContent = isRenovationInput
          ? `${totalDuration}s renovation walkthrough: ${exteriorDuration}s exterior sweep + ${interiorDuration}s renovated interior — ${buildingDesc.slice(0, 100)}`
          : `${totalDuration}s AEC walkthrough: ${exteriorDuration}s exterior + ${interiorDuration}s interior — ${buildingDesc.slice(0, 100)}`;
        const videoPipelineLabel = isRenovationInput
          ? "building photo → AI renovation render → AI video · pro → 2x MP4 video"
          : "concept render → AI video · pro → 2x MP4 video";

        // ── New path: background VideoJob via QStash worker ────────────────
        if (useBackgroundJobs) {
          const videoJobId = await createVideoJobAndEnqueue({
            userId,
            executionId: executionId ?? "local",
            dbExecutionId,
            nodeId: tileInstanceId,
            pipeline: "image2video",
            isRenovation: isRenovationInput,
            isFloorPlan: false,
            segments: [
              { kind: "exterior", taskId: submitted.exteriorTaskId, durationSeconds: exteriorDuration },
              { kind: "interior", taskId: submitted.interiorTaskId, durationSeconds: interiorDuration },
            ],
            buildingDescription: buildingDesc,
          });
          logger.debug("[GN-009] BG-JOBS dual-image2video VideoJob created:", videoJobId);
          logger.debug("========== GN-009 VIDEO WALKTHROUGH END ==========");
          return {
            id: generateId(),
            executionId: executionId ?? "local",
            tileInstanceId,
            type: "video" as const,
            data: {
              name: `walkthrough_${generateId()}.mp4`,
              videoUrl: "",
              downloadUrl: "",
              label: videoLabel,
              content: videoContent,
              durationSeconds: totalDuration,
              shotCount: 2,
              pipeline: videoPipelineLabel,
              costUsd: isRenovationInput ? 2.08 : 1.54, // Phase 3: +$0.04 for GPT-Image-1 interior reference
              segments: [],
              videoGenerationStatus: "queued" as const,
              videoJobId,
              videoPipeline: "image2video" as const,
              generationProgress: 0,
              isFloorPlanInput: false,
              isRenovation: isRenovationInput,
              ...(renovationRenderUrl && { renovationRenderUrl }),
            },
            metadata: {
              engine: "kling-official",
              real: true,
              videoJobId,
              videoPipeline: "image2video" as const,
              submittedAt: submitted.submittedAt,
              isFloorPlanInput: false,
              isRenovation: isRenovationInput,
            },
            createdAt: new Date(),
          };
        }

        // ── Legacy path: client polls Kling directly via taskIds ───────────
        const dualArtifact = {
          id: generateId(),
          executionId: executionId ?? "local",
          tileInstanceId,
          type: "video" as const,
          data: {
            name: `walkthrough_${generateId()}.mp4`,
            videoUrl: "",
            downloadUrl: "",
            label: videoLabel,
            content: videoContent,
            durationSeconds: totalDuration,
            shotCount: 2,
            pipeline: videoPipelineLabel,
            costUsd: isRenovationInput ? 2.08 : 1.54, // Phase 3: +$0.04 for GPT-Image-1 interior reference (10s+10s renovation, 5s+10s standard)
            segments: [],
            videoGenerationStatus: "processing",
            videoPipeline: "image2video",
            exteriorTaskId: submitted.exteriorTaskId,
            interiorTaskId: submitted.interiorTaskId,
            generationProgress: 0,
            isFloorPlanInput: false,
            isRenovation: isRenovationInput,
            ...(renovationRenderUrl && { renovationRenderUrl }),
          },
          metadata: {
            engine: "kling-official",
            real: true,
            videoPipeline: "image2video",
            exteriorTaskId: submitted.exteriorTaskId,
            interiorTaskId: submitted.interiorTaskId,
            submittedAt: submitted.submittedAt,
            isFloorPlanInput: false,
          },
          createdAt: new Date(),
        };
        logger.debug("========== GN-009 VIDEO WALKTHROUGH END ==========");
        return dualArtifact;
      }
    } catch (klingErr) {
      const errMsg = klingErr instanceof Error ? klingErr.message : String(klingErr);
      console.error("[GN-009] Kling API failed:", errMsg);

      const isLocal = !isBase64Direct && (renderImageUrl.includes("localhost") || renderImageUrl.includes("127.0.0.1"));
      const userMessage = isLocal
        ? "Kling cannot access the image because the app is running on localhost. Deploy the app to a public URL, or use ngrok to tunnel localhost (e.g. ngrok http 3000)."
        : `Kling video generation failed: ${errMsg}`;

      return NextResponse.json(
        formatErrorResponse({
          title: "Video generation failed",
          message: userMessage,
          code: "OPENAI_001",
        }),
        { status: 502 }
      );
    }
  } else {
    // ── Kling text-to-video path (FALLBACK) ──
    // This path produces inferior results: near-static exterior clips and no
    // true interior entry (see diagnosis 2026-04-27). It is only reached when
    // the concept render generation above fails or OPENAI_API_KEY is absent.
    // The primary path is now image-to-video via the concept render fallback.
    // Generate ultra-realistic video directly from the ORIGINAL PDF text.
    logger.debug("[GN-009] Text2Video — using original PDF text as source of truth");
    logger.debug("[GN-009] Source:", originalPdfText ? "rawText from PDF" : "fallback content");
    logger.debug("[GN-009] Prompt length:", buildingDesc.length, "chars");
    logger.debug("[GN-009] First 200 chars:", buildingDesc.slice(0, 200));

    const submitted = await submitDualTextToVideo(
      buildingDesc,
      "pro",
    );

    // Fix audit Issue #18: distinguish text-prompt flow from PDF-brief flow.
    const hasPdfSource = originalPdfText != null;
    const textLabel = hasPdfSource
      ? "AEC Cinematic Walkthrough — 15s (generating from PDF summary...)"
      : "AEC Cinematic Walkthrough — 15s (generating from text prompt...)";
    const textPipelineLabel = hasPdfSource
      ? "PDF summary → AI video · pro → 2x MP4 video"
      : "text prompt → AI video · pro → 2x MP4 video";

    // ── New path: background VideoJob via QStash worker ──────────────────
    if (useBackgroundJobs) {
      const videoJobId = await createVideoJobAndEnqueue({
        userId,
        executionId: executionId ?? "local",
        dbExecutionId,
        nodeId: tileInstanceId,
        pipeline: "text2video",
        isRenovation: false,
        isFloorPlan: false,
        segments: [
          { kind: "exterior", taskId: submitted.exteriorTaskId, durationSeconds: 5 },
          { kind: "interior", taskId: submitted.interiorTaskId, durationSeconds: 10 },
        ],
        buildingDescription: buildingDesc,
      });
      logger.debug("[GN-009] BG-JOBS text2video VideoJob created:", videoJobId);
      return {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "video" as const,
        data: {
          name: `walkthrough_${generateId()}.mp4`,
          videoUrl: "",
          downloadUrl: "",
          label: textLabel,
          content: `15s ultra-realistic walkthrough: 5s exterior orbit + 10s interior flythrough — ${buildingDesc.slice(0, 100)}`,
          durationSeconds: 15,
          shotCount: 2,
          pipeline: textPipelineLabel,
          costUsd: 1.50,
          segments: [],
          videoGenerationStatus: "queued" as const,
          videoJobId,
          videoPipeline: "text2video" as const,
          generationProgress: 0,
        },
        metadata: {
          engine: "kling-official",
          real: true,
          videoJobId,
          videoPipeline: "text2video" as const,
          submittedAt: submitted.submittedAt,
        },
        createdAt: new Date(),
      };
    }

    // ── Legacy path: client polls Kling directly via taskIds ─────────────
    return {
      id: generateId(),
      executionId: executionId ?? "local",
      tileInstanceId,
      type: "video",
      data: {
        name: `walkthrough_${generateId()}.mp4`,
        videoUrl: "",
        downloadUrl: "",
        label: textLabel,
        content: `15s ultra-realistic walkthrough: 5s exterior orbit + 10s interior flythrough — ${buildingDesc.slice(0, 100)}`,
        durationSeconds: 15,
        shotCount: 2,
        pipeline: textPipelineLabel,
        costUsd: 1.50,
        segments: [],
        videoGenerationStatus: "processing",
        videoPipeline: "text2video",
        exteriorTaskId: submitted.exteriorTaskId,
        interiorTaskId: submitted.interiorTaskId,
        generationProgress: 0,
      },
      metadata: {
        engine: "kling-official",
        real: true,
        videoPipeline: "text2video",
        exteriorTaskId: submitted.exteriorTaskId,
        interiorTaskId: submitted.interiorTaskId,
        submittedAt: submitted.submittedAt,
      },
      createdAt: new Date(),
    };
  }
};
