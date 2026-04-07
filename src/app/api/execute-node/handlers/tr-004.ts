import {
  NextResponse,
  analyzeImage,
  generateId,
  formatErrorResponse,
  logger,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * TR-004 — Image Understanding (GPT-4o-mini Vision + CubiCasa5K hybrid)
 * Pure copy from execute-node/route.ts (lines 452-885 of the pre-decomposition file).
 *
 * This is the largest small/medium handler (~430 LOC). Logic preserved verbatim:
 *   • CubiCasa5K ML wall detection (env-controlled URL since the previous sprint)
 *   • GPT-4o vision analysis with multi-image enhancement for IN-008
 *   • Potrace + GPT-4o labelling primary path
 *   • Sharp edge-detection fallback path
 *   • ML wall injection (hybrid)
 */
export const handleTR004: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
  // Image Understanding — GPT-4o-mini Vision
  const imageBase64 = inputData?.fileData ?? inputData?.imageBase64 ?? inputData?.base64 ?? null;
  const imageUrl = inputData?.url ?? null;
  const mimeType = inputData?.mimeType ?? "image/jpeg";

  // Validate image file: type and size (base64 → ~10MB raw ≈ 13.4MB base64)
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (typeof mimeType === "string" && !ALLOWED_IMAGE_TYPES.includes(mimeType.toLowerCase())) {
    return NextResponse.json(
      formatErrorResponse({ title: "Invalid file type", message: "Invalid file type. Please upload a .png, .jpg, or .webp image.", code: "INVALID_FILE_TYPE" }),
      { status: 400 }
    );
  }
  const MAX_IMAGE_BASE64_LEN = 14 * 1024 * 1024;
  if (typeof imageBase64 === "string") {
    if (imageBase64.length === 0) {
      return NextResponse.json(
        formatErrorResponse({ title: "Empty file", message: "The uploaded file is empty. Please select a valid image.", code: "EMPTY_FILE" }),
        { status: 400 }
      );
    }
    if (imageBase64.length > MAX_IMAGE_BASE64_LEN) {
      return NextResponse.json(
        formatErrorResponse({ title: "File too large", message: "File too large. Maximum size is 10MB.", code: "FILE_TOO_LARGE" }),
        { status: 413 }
      );
    }
  }

  let base64Data: string | null = typeof imageBase64 === "string" ? imageBase64 : null;

  // If we have a URL but no base64, try to fetch and convert
  if (!base64Data && imageUrl && typeof imageUrl === "string") {
    try {
      const imgRes = await fetch(imageUrl);
      if (imgRes.ok) {
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        base64Data = buffer.toString("base64");
      }
    } catch {
      // Non-fatal — will fall through to error
    }
  }

  if (!base64Data) {
    return NextResponse.json(
      formatErrorResponse({
        title: "No image data",
        message: "No image was provided for analysis. Upload an image using the Image Upload node.",
        code: "NO_IMAGE_DATA",
      }),
      { status: 400 }
    );
  }

  // ═══ STEP 1: Get walls from CubiCasa5K ML service (non-blocking) ═══
  interface MLWall { start: [number, number]; end: [number, number]; thickness: number; type: string }
  interface MLDoor { type: string; center: [number, number]; width: number }
  interface MLWindow { type: string; center: [number, number]; width: number }
  let mlWalls: MLWall[] = [];
  let mlDoors: MLDoor[] = [];
  let mlWindows: MLWindow[] = [];
  try {
    const mlServiceUrl = process.env.ML_SERVICE_URL || "http://localhost:5001/analyze";
    logger.debug(`[TR-004] Step 1: Getting walls from CubiCasa5K ML at ${mlServiceUrl}...`);
    const mlResponse = await fetch(mlServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64Data }),
      signal: AbortSignal.timeout(5000),
    });
    if (mlResponse.ok) {
      const mlResult = await mlResponse.json();
      mlWalls = mlResult.walls ?? [];
      mlDoors = mlResult.doors ?? [];
      mlWindows = mlResult.windows ?? [];
      logger.debug(`[TR-004] ML walls: ${mlWalls.length} segments, ${mlDoors.length} doors, ${mlWindows.length} windows (${mlResult.inferenceTime}s)`);
    } else {
      logger.debug(`[TR-004] ML service returned ${mlResponse.status}`);
    }
  } catch (mlError: unknown) {
    const msg = mlError instanceof Error ? mlError.message : "connection refused";
    logger.debug(`[TR-004] ML service unavailable: ${msg}`);
  }

  // ═══ STEP 2: GPT-4o analysis (rooms, layout, descriptions) ═══
  // analyzeImage already produces row-based geometry that GN-011 uses
  logger.debug("[TR-004] Step 2: Getting rooms from GPT-4o...");
  const analysis = await analyzeImage(base64Data, mimeType, apiKey);

  // ── Multi-image enhancement: analyze ALL uploaded photos for comprehensive building description ──
  // When user uploads multiple building photos (via IN-008), each shows a different angle.
  // GPT-4o-mini sees ALL images together and produces a comprehensive description covering
  // every angle, facade, side, roofline, and context — so the renovation video shows the FULL building.
  const multiImages = (inputData?.fileDataArray as string[]) ?? [];
  const multiMimes = (inputData?.mimeTypes as string[]) ?? [];
  if (!analysis.isFloorPlan && multiImages.length > 1) {
    try {
      logger.debug(`[TR-004] Multi-image: enhancing analysis with ${multiImages.length} photos`);
      const { getClient } = await import("@/services/openai");
      const multiClient = getClient(apiKey);

      // Build content blocks with ALL images
      const imageBlocks: Array<{ type: "image_url"; image_url: { url: string } }> = multiImages.map((img, i) => {
        const mime = multiMimes[i] ?? "image/jpeg";
        const clean = img.startsWith("data:") ? img : `data:${mime};base64,${img}`;
        return { type: "image_url" as const, image_url: { url: clean } };
      });

      const multiAnalysis = await multiClient.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You are a senior architect. You are given ${multiImages.length} photographs of the SAME building taken from different angles. Describe the COMPLETE building by combining observations from ALL photos. Cover: overall shape and massing, number of floors, full facade on every visible side, materials, window patterns, roof type, entrance locations, surrounding context (street, trees, neighboring buildings). Be specific about dimensions, proportions, and spatial relationships between building sections.`,
          },
          {
            role: "user",
            content: [
              ...imageBlocks,
              { type: "text" as const, text: `These are ${multiImages.length} photos of the same building from different angles. Describe the COMPLETE building — every side, every section, full roofline, all architectural details. What does the full building look like when you walk around it?` },
            ],
          },
        ],
        max_tokens: 2000,
      }, { timeout: 30000 });

      const multiDesc = multiAnalysis.choices[0]?.message?.content;
      if (multiDesc) {
        // Enhance the original description with multi-angle observations
        analysis.description = `${analysis.description}\n\nCOMPLETE BUILDING (from ${multiImages.length} angles):\n${multiDesc}`;
        logger.debug(`[TR-004] Multi-image analysis added ${multiDesc.length} chars`);
      }
    } catch (multiErr) {
      console.warn("[TR-004] Multi-image enhancement failed (non-fatal):", multiErr);
    }
  }

  if (analysis.isFloorPlan && base64Data) {
    // ── PRIMARY: Potrace pixel tracing + GPT-4o labeling ──
    let traceSucceeded = false;
    try {
      logger.debug("[TR-004] Starting Potrace + GPT-4o hybrid analysis...");
      const { traceFloorPlanToSVG } = await import("@/services/floor-plan-tracer");
      const imageBuffer = Buffer.from(base64Data as string, "base64");
      const trace = await traceFloorPlanToSVG(imageBuffer);

      logger.debug(`[TR-004] Potrace: ${trace.wallSegments.length} walls, ${trace.enclosedRegions.length} regions`);

      // Save debug SVG
      try {
        const fs = await import("fs");
        const path = await import("path");
        fs.writeFileSync(path.join(process.cwd(), "public", "debug-floor-plan.svg"), trace.svg);
        logger.debug("[TR-004] SVG saved to public/debug-floor-plan.svg");
      } catch { /* ignore */ }

      if (trace.enclosedRegions.length >= 1) {
        // GPT-4o labels the rooms Potrace found
        const { labelFloorPlanRooms } = await import("@/services/openai");
        const labels = await labelFloorPlanRooms(
          base64Data as string,
          typeof mimeType === "string" ? mimeType : "image/jpeg",
          trace.enclosedRegions,
          trace.width,
          trace.height,
          apiKey,
        );

        logger.debug(`[TR-004] GPT-4o labeled: ${labels.rooms.length} rooms, building ${labels.buildingWidthMeters}x${labels.buildingDepthMeters}m`);

        const bw = labels.buildingWidthMeters || 10;
        const bd = labels.buildingDepthMeters || 8;
        const pxPerMeterX = trace.width / bw;
        const pxPerMeterY = trace.height / bd;

        // Convert pixel regions → meter-space rooms
        const tracedRooms = labels.rooms.map(label => {
          const region = trace.enclosedRegions.find(r => r.id === label.regionId);
          if (!region) return null;
          return {
            name: label.name,
            type: label.type,
            width: label.widthMeters || +(region.bounds.width / pxPerMeterX).toFixed(2),
            depth: label.depthMeters || +(region.bounds.height / pxPerMeterY).toFixed(2),
            x: +(region.bounds.x / pxPerMeterX).toFixed(2),
            y: +(region.bounds.y / pxPerMeterY).toFixed(2),
            adjacentRooms: [] as string[],
          };
        }).filter((r): r is NonNullable<typeof r> => r !== null);

        // Convert wall segments px → meters
        const tracedWalls = trace.wallSegments.map(w => ({
          start: [w.x1 / pxPerMeterX, w.y1 / pxPerMeterY] as [number, number],
          end: [w.x2 / pxPerMeterX, w.y2 / pxPerMeterY] as [number, number],
          thickness: Math.max(w.thickness / pxPerMeterX, 0.1),
          type: "exterior" as const,
        }));

        // Auto-detect adjacency
        for (let i = 0; i < tracedRooms.length; i++) {
          for (let j = i + 1; j < tracedRooms.length; j++) {
            const a = tracedRooms[i], b = tracedRooms[j];
            const ax2 = a.x + a.width, ay2 = a.y + a.depth;
            const bx2 = b.x + b.width, by2 = b.y + b.depth;
            const hOverlap = Math.min(ax2, bx2) - Math.max(a.x, b.x);
            const vOverlap = Math.min(ay2, by2) - Math.max(a.y, b.y);
            const hGap = Math.min(Math.abs(ax2 - b.x), Math.abs(bx2 - a.x));
            const vGap = Math.min(Math.abs(ay2 - b.y), Math.abs(by2 - a.y));
            if ((hOverlap > 0.3 && hGap < 0.8) || (vOverlap > 0.3 && vGap < 0.8)) {
              a.adjacentRooms.push(b.name);
              b.adjacentRooms.push(a.name);
            }
          }
        }

        if (tracedRooms.length >= 1) {
          analysis.geometry = {
            buildingWidth: bw,
            buildingDepth: bd,
            buildingShape: "rectangular",
            walls: tracedWalls,
            rows: [],
            rooms: tracedRooms,
          };
          traceSucceeded = true;
          logger.debug(`[TR-004] ✓ Potrace+GPT-4o: ${tracedRooms.length} rooms, ${tracedWalls.length} walls, ${bw.toFixed(1)}m × ${bd.toFixed(1)}m`);
          tracedRooms.forEach(r => logger.debug(`  ${r.name} (${r.type}): ${r.width}x${r.depth}m at (${r.x},${r.y})`));
        }
      }
    } catch (traceErr) {
      console.warn("[TR-004] Potrace+GPT-4o failed, falling back to Sharp:", traceErr);
    }

    // ── FALLBACK: Sharp pixel detection + GPT-4o labeling ──
    if (!traceSucceeded) {
      try {
        const { detectFloorPlanGeometry } = await import("@/services/floor-plan-detector");
        const sharpResult = await detectFloorPlanGeometry(
          base64Data as string,
          typeof mimeType === "string" ? mimeType : "image/jpeg",
          analysis.footprint ? {
            estimatedFootprintMeters: {
              width: parseFloat(String(analysis.footprint.width)) || 14,
              depth: parseFloat(String(analysis.footprint.depth)) || 10,
            },
          } : undefined,
        );

        logger.debug(`[TR-004] Sharp detection: ${sharpResult.geometry.walls.length} walls, ${sharpResult.geometry.rooms.length} rooms, confidence: ${sharpResult.confidence.toFixed(2)}`);

        const useSharp = sharpResult.confidence >= 0.4
          && sharpResult.geometry.walls.length >= 3
          && sharpResult.geometry.rooms.length >= 2;

        if (useSharp) {
          const { labelDetectedRooms } = await import("@/services/openai");
          const labels = await labelDetectedRooms({
            roomCenters: sharpResult.geometry.rooms.map(r => ({
              center: r.center,
              width: r.width,
              depth: r.depth,
            })),
            imageBase64: base64Data as string,
            mimeType: typeof mimeType === "string" ? mimeType : "image/jpeg",
          }, apiKey);

          const mergedRooms = sharpResult.geometry.rooms.map((room, i) => {
            const label = labels.rooms.find(l => l.index === i);
            return {
              ...room,
              name: label?.name ?? room.name,
              type: (label?.type ?? room.type) as import("@/types/floor-plan").FloorPlanRoomType,
              width: label?.refinedWidth ?? room.width,
              depth: label?.refinedDepth ?? room.depth,
            };
          });

          const sharpFp = labels.footprint ?? sharpResult.geometry.footprint;
          const sharpRows: Array<Array<{ name: string; type: string; width: number; depth: number }>> = [];
          let sharpRow: Array<{ name: string; type: string; width: number; depth: number }> = [];
          for (const rm of mergedRooms) {
            sharpRow.push({ name: rm.name, type: rm.type as string, width: rm.width, depth: rm.depth });
            if (sharpRow.length >= 3) { sharpRows.push(sharpRow); sharpRow = []; }
          }
          if (sharpRow.length > 0) sharpRows.push(sharpRow);
          let sharpY = 0;
          const sharpRooms: Array<{ name: string; type: string; width: number; depth: number; x: number; y: number; adjacentRooms: string[] | undefined }> = [];
          for (const row of sharpRows) {
            const rowDepth = Math.max(...row.map(r => r.depth));
            let sharpX = 0;
            for (const rm of row) {
              sharpRooms.push({ name: rm.name, type: rm.type, width: rm.width, depth: rowDepth, x: sharpX, y: sharpY, adjacentRooms: undefined });
              sharpX += rm.width;
            }
            sharpY += rowDepth;
          }
          analysis.geometry = {
            buildingWidth: sharpFp.width,
            buildingDepth: sharpFp.depth,
            rooms: sharpRooms,
          };

          logger.debug(`[TR-004] Fallback: sharp+GPT hybrid: ${mergedRooms.length} rooms`);
        } else {
          logger.debug("[TR-004] Sharp confidence too low, using GPT-4o geometry as-is");
        }
      } catch (sharpErr) {
        console.warn("[TR-004] Sharp detection also failed, using GPT-4o geometry as-is:", sharpErr);
      }
    }
  }

  // ═══ STEP 3: Merge ML walls into GPT-4o geometry (hybrid) ═══
  if (mlWalls.length > 0 && analysis.geometry) {
    const existingWalls = (analysis.geometry as Record<string, unknown>).walls as MLWall[] | undefined;
    // Use ML walls if we got meaningful data (>3 segments), otherwise keep existing
    if (mlWalls.length > 3 || !existingWalls || existingWalls.length === 0) {
      (analysis.geometry as Record<string, unknown>).walls = mlWalls;
      logger.debug(`[TR-004] ✓ Injected ${mlWalls.length} ML walls into geometry (replacing ${existingWalls?.length ?? 0} existing)`);
    }
    if (mlDoors.length > 0) {
      (analysis.geometry as Record<string, unknown>).doors = mlDoors;
      logger.debug(`[TR-004] ✓ Injected ${mlDoors.length} ML doors`);
    }
    if (mlWindows.length > 0) {
      (analysis.geometry as Record<string, unknown>).windows = mlWindows;
      logger.debug(`[TR-004] ✓ Injected ${mlWindows.length} ML windows`);
    }
  } else if (mlWalls.length > 0 && !analysis.geometry) {
    // GPT-4o didn't produce geometry but ML has walls — create minimal geometry
    analysis.geometry = {
      buildingWidth: parseFloat(String(analysis.footprint?.width ?? "12")),
      buildingDepth: parseFloat(String(analysis.footprint?.depth ?? "8")),
      walls: mlWalls as unknown as NonNullable<typeof analysis.geometry>["walls"],
      rooms: [],
    };
    logger.debug(`[TR-004] ✓ Created geometry with ${mlWalls.length} ML walls (GPT-4o had no geometry)`);
  }

  const roomCount = analysis.geometry
    ? ((analysis.geometry as Record<string, unknown>).rows as unknown[])?.flat()?.length
      ?? ((analysis.geometry as Record<string, unknown>).rooms as unknown[])?.length
      ?? 0
    : 0;
  const wallCount = mlWalls.length;
  const method = mlWalls.length > 3 ? "hybrid (ML walls + GPT-4o rooms)" : "GPT-4o";
  logger.debug(`[TR-004] ✓ Final: ${roomCount} rooms, ${wallCount} walls — ${method}`);

  const roomsText = analysis.rooms?.length
    ? `\nROOMS:\n${analysis.rooms.map(r => `• ${r.name} (${r.dimensions})`).join("\n")}`
    : "";
  const layoutText = analysis.layoutDescription
    ? `\nLAYOUT: ${analysis.layoutDescription}`
    : "";

  const descriptionText = `IMAGE ANALYSIS — ${analysis.buildingType}

Style: ${analysis.style}
Estimated Floors: ${analysis.floors}
${analysis.isFloorPlan ? "Type: 2D Floor Plan" : ""}

${analysis.description}

FACADE: ${analysis.facade}

MASSING: ${analysis.massing}

SITE: ${analysis.siteRelationship}
${roomsText}${layoutText}

KEY FEATURES:
${analysis.features.map(f => `• ${f}`).join("\n")}`;

  // Upload the original image to R2 so downstream nodes (GN-009) can access it via URL
  let sourceImageUrl: string | undefined;
  try {
    const { uploadBase64ToR2, isR2Configured } = await import("@/lib/r2");
    if (isR2Configured()) {
      const imgName = `image-input-${generateId()}.${typeof mimeType === "string" && mimeType.includes("png") ? "png" : "jpg"}`;
      const r2Url = await uploadBase64ToR2(base64Data as string, imgName, (typeof mimeType === "string" ? mimeType : "image/jpeg"));
      // uploadBase64ToR2 returns the URL string (or original data URI on failure)
      if (r2Url && r2Url.startsWith("http")) {
        sourceImageUrl = r2Url;
        logger.debug("[TR-004] Source image uploaded to R2:", sourceImageUrl);
      }
    }
  } catch (r2Err) {
    console.warn("[TR-004] R2 upload of source image failed:", r2Err);
  }

  // Build roomInfo string from extracted rooms for downstream nodes (GN-009)
  const extractedRoomInfo = analysis.rooms?.length
    ? analysis.rooms.map(r => `${r.name} (${r.dimensions})`).join(", ")
    : "";

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "text",
    data: {
      content: descriptionText,
      label: `Image Analysis: ${analysis.buildingType}`,
      prompt: analysis.description,
      _raw: analysis,
      // Pass room data for downstream GN-009
      ...(analysis.isFloorPlan && { isFloorPlan: true }),
      ...(extractedRoomInfo && { roomInfo: extractedRoomInfo }),
      ...(analysis.layoutDescription && { layoutDescription: analysis.layoutDescription }),
      // Pass the original image through so downstream nodes can use it
      ...(sourceImageUrl && { imageUrl: sourceImageUrl, url: sourceImageUrl }),
      ...(typeof mimeType === "string" && { mimeType }),
      // Rich floor plan data for render pipeline (GPT-4o analysis)
      ...(analysis.richRooms && { richRooms: analysis.richRooms }),
      ...(analysis.footprint && { footprint: analysis.footprint }),
      ...(analysis.circulation && { circulation: analysis.circulation }),
      ...(analysis.exteriorPrompt && { exteriorPrompt: analysis.exteriorPrompt }),
      ...(analysis.interiorPrompt && { interiorPrompt: analysis.interiorPrompt }),
      // Geometric data for GN-011 Interactive 3D Viewer
      ...(analysis.geometry && { geometry: analysis.geometry }),
      // Pass multi-image data through for downstream GN-009 (renovation needs all angles)
      ...(multiImages.length > 1 && { fileDataArray: multiImages, mimeTypes: multiMimes, isMultiImage: true }),
    },
    metadata: {
      model: analysis.isFloorPlan
        ? (mlWalls.length > 3 ? "hybrid-cubicasa5k-gpt4o" : (process.env.ANTHROPIC_API_KEY ? "claude-sonnet" : "gpt-4o"))
        : "gpt-4o-mini",
      real: true,
    },
    createdAt: new Date(),
  };
};
