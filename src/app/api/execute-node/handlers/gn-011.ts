import { generateId, uploadBase64ToR2, logger } from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-011 — Interactive 3D Viewer (Three.js HTML generator + DALL-E render)
 * Pure copy from execute-node/route.ts (lines 4574-4973 of the pre-decomposition file).
 */
export const handleGN011: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
  // ── Interactive 3D Viewer ────────────────────────────────────────────
  // Generates a self-contained Three.js HTML file from floor plan geometry.
  // Uses absolute x,y positions from GPT-4o → rooms tile together with no gaps.

  const rawGeometry = (inputData?.geometry ?? (inputData?._raw as Record<string, unknown>)?.geometry ?? null) as Record<string, unknown> | null;

  type LayoutRoom = { name: string; type: string; width: number; depth: number; x: number; y: number; adjacentRooms?: string[]; polygon?: [number, number][]; area?: number };

  // Guess room type from name — comprehensive fuzzy matching for any floor plan
  function guessType(name: string): string {
    const n = name.toLowerCase();
    if (n.includes("living") || n.includes("lounge") || n.includes("drawing") || n.includes("sitting") || n.includes("family room") || n.includes("movie") || n.includes("cinema") || n.includes("theater") || n.includes("theatre") || n.includes("media")) return "living";
    if (n.includes("bed") || n.includes("master") || n.includes("guest bed") || n.includes("nursery")) return "bedroom";
    if (n.includes("kitchen") || n.includes("pantry") || n.includes("kitchenette")) return "kitchen";
    if (n.includes("dining") || n.includes("nook") || n.includes("dinette") || n.includes("breakfast")) return "dining";
    if (n.includes("bath") || n.includes("toilet") || n.includes("wc") || n.includes("powder") || n.includes("lavatory") || n.includes("washroom") || n.includes("restroom") || n.includes("shower") || /t\s*&\s*b/i.test(n) || /\bc\.?\s*b\b/i.test(n)) return "bathroom";
    if (n.includes("verand") || n.includes("porch")) return "veranda";
    if (n.includes("balcon")) return "balcony";
    if (n.includes("hall") || n.includes("corridor") || n.includes("lobby")) return "hallway";
    if (n.includes("passage") || n.includes("foyer")) return "passage";
    if (n.includes("office") || n.includes("study") || n.includes("den") || n.includes("workspace")) return "office";
    if (n.includes("store") || n.includes("storage") || n.includes("cellar") || n.includes("garage") || n.includes("shed") || n.includes("carport")) return "storage";
    if (n.includes("closet") || n.includes("wardrobe") || n.includes("dressing") || n.includes("hanging")) return "closet";
    if (n.includes("utility") || n.includes("laundry") || n.includes("mechanical")) return "utility";
    if (n.includes("patio") || n.includes("terrace") || n.includes("deck") || n.includes("courtyard")) return "patio";
    if (n.includes("entrance") || n.includes("entry") || /\bentr\b/.test(n)) return "entrance";
    if (n.includes("stair") || n.includes("steps")) return "staircase";
    if (n.includes("studio")) return "studio";
    if (n.includes("gym") || n.includes("spa") || n.includes("sauna") || n.includes("workout")) return "living";
    if (n.includes("light well") || n.includes("shaft") || n.includes("void")) return "other";
    // Compound names (Kitchen/Living → try each part)
    const parts = n.split(/[\/,&+]/);
    if (parts.length > 1) {
      for (const part of parts) {
        const sub = guessType(part.trim());
        if (sub !== "other") return sub;
      }
    }
    return "other";
  }

  // ── Convert row-based layout to positioned rooms ──
  function rowsToPositions(rows: Array<Array<Record<string, unknown>>>): { rooms: LayoutRoom[]; width: number; depth: number } {
    const result: LayoutRoom[] = [];
    let currentY = 0;
    let maxRowWidth = 0;

    for (const row of rows) {
      if (!Array.isArray(row) || row.length === 0) continue;
      // Row height = max depth of rooms in this row
      const rowDepth = Math.max(...row.map(r => Math.max(1.0, Number(r.depth ?? 3))));
      let currentX = 0;

      for (const room of row) {
        const w = Math.max(1.0, Number(room.width ?? 3));
        const name = String(room.name ?? "Room");
        result.push({
          name,
          type: String(room.type ?? guessType(name)),
          width: w,
          depth: rowDepth,
          x: currentX,
          y: currentY,
          adjacentRooms: Array.isArray(room.adjacentRooms) ? (room.adjacentRooms as string[]) : undefined,
        });
        currentX += w;
      }

      if (currentX > maxRowWidth) maxRowWidth = currentX;
      currentY += rowDepth;
    }

    return { rooms: result, width: maxRowWidth, depth: currentY };
  }

  const layoutRooms: LayoutRoom[] = [];
  let bW = Number(rawGeometry?.buildingWidth ?? 14);
  let bD = Number(rawGeometry?.buildingDepth ?? 10);

  // ── Priority 0: GPT-4o ACCURATE positions (percentage-based) ──
  // If rooms have positionLeftPercent/positionTopPercent, convert to meters.
  // This is far more accurate than the row-based grid layout.
  const rawRows = rawGeometry?.rows as Array<Array<Record<string, unknown>>> | undefined;
  const allRoomsFlat: Array<Record<string, unknown>> = [];
  if (Array.isArray(rawRows)) {
    for (const row of rawRows) {
      if (Array.isArray(row)) for (const rm of row) allRoomsFlat.push(rm);
    }
  }
  const hasPercentPositions = allRoomsFlat.length > 0 &&
    allRoomsFlat.filter(r => typeof r.positionLeftPercent === "number" && typeof r.positionTopPercent === "number").length >= allRoomsFlat.length * 0.6;

  if (hasPercentPositions) {
    logger.debug(`[GN-011] Using GPT-4o ACCURATE positions (${allRoomsFlat.length} rooms with percentage coordinates)`);
    for (const r of allRoomsFlat) {
      const name = String(r.name ?? "Room");
      const w = Math.max(1.0, Number(r.width ?? 3));
      const d = Math.max(1.0, Number(r.depth ?? 3));
      const leftPct = Number(r.positionLeftPercent ?? 0);
      const topPct = Number(r.positionTopPercent ?? 0);
      const x = Math.round(((leftPct / 100) * bW) * 100) / 100;
      const y = Math.round(((topPct / 100) * bD) * 100) / 100;
      layoutRooms.push({
        name,
        type: String(r.type ?? guessType(name)),
        width: w,
        depth: d,
        x,
        y,
        adjacentRooms: Array.isArray(r.adjacentRooms) ? (r.adjacentRooms as string[]) : undefined,
      });
    }

    // ── Overlap resolution: nudge overlapping rooms apart ──
    for (let i = 0; i < layoutRooms.length; i++) {
      for (let j = i + 1; j < layoutRooms.length; j++) {
        const a = layoutRooms[i], b = layoutRooms[j];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        if (overlapX > 0.2 && overlapY > 0.2) {
          logger.debug(`[GN-011] Overlap: ${a.name} & ${b.name} (${overlapX.toFixed(1)}×${overlapY.toFixed(1)}m) — nudging`);
          const smaller = (a.width * a.depth) < (b.width * b.depth) ? a : b;
          const larger = smaller === a ? b : a;
          if (overlapX < overlapY) {
            smaller.x = smaller.x < larger.x
              ? larger.x - smaller.width - 0.15
              : larger.x + larger.width + 0.15;
          } else {
            smaller.y = smaller.y < larger.y
              ? larger.y - smaller.depth - 0.15
              : larger.y + larger.depth + 0.15;
          }
        }
      }
    }

    // Clamp rooms within building bounds
    for (const rm of layoutRooms) {
      rm.x = Math.max(0, Math.min(rm.x, bW - rm.width));
      rm.y = Math.max(0, Math.min(rm.y, bD - rm.depth));
    }

    // Log positions for debugging
    logger.debug("[GN-011] Room positions (accurate):");
    for (const rm of layoutRooms) {
      const origR = allRoomsFlat.find(r => r.name === rm.name);
      logger.debug(`  ${rm.name}: x=${rm.x.toFixed(1)} y=${rm.y.toFixed(1)} ${rm.width}×${rm.depth}m (from ${origR?.positionLeftPercent ?? "?"}%, ${origR?.positionTopPercent ?? "?"}%)`);
    }
  }

  // ── Priority 1: Row-based layout from GPT-4o (fallback) ──
  if (layoutRooms.length === 0 && Array.isArray(rawRows) && rawRows.length > 0) {
    logger.debug(`[GN-011] Using ROW-BASED layout: ${rawRows.length} rows`);
    const result = rowsToPositions(rawRows);
    for (const rm of result.rooms) layoutRooms.push(rm);
    bW = result.width;
    bD = result.depth;
  }

  // ── Priority 2: Legacy x,y positioned rooms ──
  if (layoutRooms.length === 0) {
    const rawRooms = (rawGeometry?.rooms ?? []) as Array<Record<string, unknown>>;
    for (let idx = 0; idx < rawRooms.length; idx++) {
      const r = rawRooms[idx];
      const hasXY = r.x !== undefined && r.y !== undefined;
      const name = String(r.name ?? "Room");
      layoutRooms.push({
        name,
        type: String(r.type ?? guessType(name)),
        width: Math.max(1.0, Number(r.width ?? 3)),
        depth: Math.max(1.0, Number(r.depth ?? 3)),
        x: hasXY ? Number(r.x) : Number(r.col ?? (idx % 3)) * 3.5,
        y: hasXY ? Number(r.y) : Number(r.row ?? Math.floor(idx / 3)) * 3.5,
        adjacentRooms: Array.isArray(r.adjacentRooms) ? (r.adjacentRooms as string[]) :
                       Array.isArray(r.connections) ? (r.connections as string[]) : undefined,
        polygon: Array.isArray(r.polygon) ? (r.polygon as [number, number][]) : undefined,
        area: typeof r.area === "number" ? r.area : undefined,
      });
    }
  }

  // ── Priority 3: Reconstruct from richRooms/rooms (no geometry at all) ──
  if (layoutRooms.length === 0) {
    const basicRooms = (inputData?.rooms ?? []) as Array<Record<string, unknown>>;
    const richRoomsArr = (inputData?.richRooms ?? []) as Array<Record<string, unknown>>;
    const fallbackSource = richRoomsArr.length > basicRooms.length ? richRoomsArr : basicRooms;

    if (fallbackSource.length > 0) {
      console.warn(`[GN-011] No geometry — reconstructing from ${fallbackSource.length} rooms`);
      // Build rows: 3 rooms per row
      const fakeRows: Array<Array<Record<string, unknown>>> = [];
      let currentRow: Array<Record<string, unknown>> = [];
      for (const fr of fallbackSource) {
        const name = String(fr.name ?? "Room");
        const dimStr = String(fr.dimensions ?? "");
        const dimMatch = dimStr.match(/(\d+\.?\d*)\s*m?\s*[x×X]\s*(\d+\.?\d*)/i);
        currentRow.push({
          name,
          type: String(fr.type ?? guessType(name)),
          width: dimMatch ? Math.max(1.0, parseFloat(dimMatch[1])) : 3,
          depth: dimMatch ? Math.max(1.0, parseFloat(dimMatch[2])) : 3,
          adjacentRooms: Array.isArray(fr.connections) ? fr.connections : undefined,
        });
        if (currentRow.length >= 3) { fakeRows.push(currentRow); currentRow = []; }
      }
      if (currentRow.length > 0) fakeRows.push(currentRow);
      const result = rowsToPositions(fakeRows);
      for (const rm of result.rooms) layoutRooms.push(rm);
      bW = result.width;
      bD = result.depth;
    }
  }

  // ── Priority 4: Hardcoded fallback (only when everything fails) ──
  if (layoutRooms.length < 2) {
    console.warn(`[GN-011] Only ${layoutRooms.length} rooms — using hardcoded fallback`);
    layoutRooms.length = 0;
    const fallbackRows = [
      [
        { name: "Veranda", type: "veranda", width: 1.8, depth: 3.6, adjacentRooms: ["Living Room"] },
        { name: "Living Room", type: "living", width: 3.2, depth: 3.6, adjacentRooms: ["Veranda", "Dining", "Hallway"] },
        { name: "Dining", type: "dining", width: 3.2, depth: 3.6, adjacentRooms: ["Living Room", "Kitchen"] },
        { name: "Kitchen", type: "kitchen", width: 3.2, depth: 3.6, adjacentRooms: ["Dining"] },
      ],
      [
        { name: "Hallway", type: "hallway", width: 11.4, depth: 1.5, adjacentRooms: ["Living Room", "Bedroom 3", "Bedroom 2", "Bedroom 1"] },
      ],
      [
        { name: "Bedroom 3", type: "bedroom", width: 4.1, depth: 3.5, adjacentRooms: ["Hallway"] },
        { name: "Bath", type: "bathroom", width: 2.0, depth: 3.5, adjacentRooms: ["Hallway"] },
        { name: "Bedroom 2", type: "bedroom", width: 3.0, depth: 3.5, adjacentRooms: ["Hallway"] },
        { name: "Bedroom 1", type: "bedroom", width: 2.3, depth: 3.5, adjacentRooms: ["Hallway"] },
      ],
    ];
    const result = rowsToPositions(fallbackRows as unknown as Array<Array<Record<string, unknown>>>);
    for (const rm of result.rooms) layoutRooms.push(rm);
    bW = result.width;
    bD = result.depth;
  }

  // ── Edge snapping: close small gaps between rooms ──
  function snapEdges(rooms: LayoutRoom[]) {
    const TOL = 0.4;
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const gapH = b.x - (a.x + a.width);
        if (gapH > 0.01 && gapH < TOL) a.width += gapH;
        const gapH2 = a.x - (b.x + b.width);
        if (gapH2 > 0.01 && gapH2 < TOL) b.width += gapH2;
        const gapV = b.y - (a.y + a.depth);
        if (gapV > 0.01 && gapV < TOL) a.depth += gapV;
        const gapV2 = a.y - (b.y + b.depth);
        if (gapV2 > 0.01 && gapV2 < TOL) b.depth += gapV2;
      }
    }
  }
  snapEdges(layoutRooms);

  // Compute actual building size from placed rooms
  let maxX = 0, maxZ = 0;
  for (const rm of layoutRooms) {
    const rx = rm.x + rm.width;
    const rz = rm.y + rm.depth;
    if (rx > maxX) maxX = rx;
    if (rz > maxZ) maxZ = rz;
  }
  const finalW = Math.max(bW, maxX);
  const finalD = Math.max(bD, maxZ);

  logger.debug(`[GN-011] ${layoutRooms.length} rooms, building ${finalW.toFixed(1)}x${finalD.toFixed(1)}m`);
  for (const rm of layoutRooms) {
    logger.debug(`  ${rm.name}: x=${rm.x.toFixed(1)} y=${rm.y.toFixed(1)} ${rm.width.toFixed(1)}x${rm.depth.toFixed(1)}m (${rm.type})`);
  }

  // Build FloorPlanGeometry — center derived from x,y
  const fpRooms = layoutRooms.map((rm) => ({
    name: rm.name,
    center: [rm.x + rm.width / 2, rm.y + rm.depth / 2] as [number, number],
    width: rm.width,
    depth: rm.depth,
    type: rm.type as import("@/features/floor-plan/types/floor-plan").FloorPlanRoomType,
    x: rm.x,
    y: rm.y,
    adjacentRooms: rm.adjacentRooms,
    polygon: rm.polygon,
    area: rm.area,
  }));

  // Walls: use SVG-parsed walls if available, otherwise generate perimeter
  const geometryWalls = rawGeometry?.walls as Array<{ start: [number, number]; end: [number, number]; thickness: number; type: "exterior" | "interior" }> | undefined;
  const fpWalls: Array<{ start: [number, number]; end: [number, number]; thickness: number; type: "exterior" | "interior" }> =
    (Array.isArray(geometryWalls) && geometryWalls.length > 4)
      ? geometryWalls
      : [
          { start: [0, 0], end: [finalW, 0], thickness: 0.2, type: "exterior" },
          { start: [finalW, 0], end: [finalW, finalD], thickness: 0.2, type: "exterior" },
          { start: [finalW, finalD], end: [0, finalD], thickness: 0.2, type: "exterior" },
          { start: [0, finalD], end: [0, 0], thickness: 0.2, type: "exterior" },
        ];

  // Pass through building shape + outline for non-rectangular buildings
  const buildingShape = rawGeometry?.buildingShape as string | undefined;
  const buildingOutline = rawGeometry?.buildingOutline as [number, number][] | undefined;

  const fpGeometry: import("@/features/floor-plan/types/floor-plan").FloorPlanGeometry = {
    footprint: { width: finalW, depth: finalD },
    wallHeight: 2.8,
    walls: fpWalls,
    doors: [],
    windows: [],
    rooms: fpRooms,
    ...(buildingShape && { buildingShape }),
    ...(buildingOutline && { buildingOutline }),
  };

  const { buildFloorPlan3D } = await import("@/services/threejs-builder");

  // Fetch source image for image-as-floor approach
  let sourceImageDataUrl = "";
  const sourceImgUrl = inputData?.imageUrl ?? inputData?.url;
  if (sourceImgUrl && typeof sourceImgUrl === "string" && sourceImgUrl.startsWith("http")) {
    try {
      const imgResp = await fetch(sourceImgUrl);
      const imgBuf = Buffer.from(await imgResp.arrayBuffer());
      const imgMime = imgResp.headers.get("content-type") || "image/jpeg";
      sourceImageDataUrl = `data:${imgMime};base64,${imgBuf.toString("base64")}`;
      logger.debug(`[GN-011] Fetched source image: ${(imgBuf.length / 1024).toFixed(0)}KB`);
    } catch (imgErr) {
      console.warn("[GN-011] Failed to fetch source image for 3D floor:", imgErr);
    }
  }

  const html = buildFloorPlan3D(fpGeometry, sourceImageDataUrl || undefined);

  let viewerUrl = "";
  try {
    const { isR2Configured } = await import("@/lib/r2");
    if (isR2Configured()) {
      const r2Result = await uploadBase64ToR2(
        Buffer.from(html, "utf-8").toString("base64"),
        `3d-viewer-${generateId()}.html`,
        "text/html"
      );
      if (r2Result && r2Result.startsWith("http")) viewerUrl = r2Result;
    }
  } catch (r2Err) {
    console.warn("[GN-011] R2 upload failed:", r2Err);
  }

  // ── DALL-E 3 Photorealistic Render (non-blocking) ──
  // Use same key resolution as TR-004: user key → env var fallback
  const renderApiKey = apiKey || process.env.OPENAI_API_KEY || undefined;
  let aiRenderUrl = "";
  try {
    const { generateFloorPlanRender } = await import("@/services/openai");
    const renderRooms = fpRooms.map((r: { name: string; type: string; width: number; depth: number }) => ({
      name: r.name, type: r.type, width: r.width, depth: r.depth,
    }));
    logger.debug(`[GN-011] Generating DALL-E 3 photorealistic render for ${renderRooms.length} rooms...`);
    logger.debug(`[GN-011] API key present: ${!!renderApiKey}, source: ${apiKey ? "user" : process.env.OPENAI_API_KEY ? "env" : "NONE"}, key prefix: ${renderApiKey ? renderApiKey.substring(0, 8) + "..." : "NONE"}`);
    const renderResult = await generateFloorPlanRender(
      renderRooms,
      { width: fpGeometry.footprint.width, depth: fpGeometry.footprint.depth },
      { userApiKey: renderApiKey },
    );
    aiRenderUrl = renderResult.imageUrl;
    logger.debug(`[GN-011] DALL-E render ready: ${aiRenderUrl ? aiRenderUrl.substring(0, 60) + "..." : "EMPTY"} (${(aiRenderUrl.length / 1024).toFixed(0)}KB)`);
  } catch (renderErr: unknown) {
    const errMsg = renderErr instanceof Error ? renderErr.message : String(renderErr);
    const stack = renderErr instanceof Error ? renderErr.stack : "";
    console.warn(`[GN-011] DALL-E render failed (non-critical): ${errMsg}`);
    if (stack) console.warn(`[GN-011] Stack: ${stack}`);
  }
  logger.debug(`[GN-011] Final aiRenderUrl: ${aiRenderUrl ? "YES (" + aiRenderUrl.length + " chars)" : "NONE"}`);

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "html",
    data: {
      html,
      label: `Interactive 3D Floor Plan — ${fpRooms.length} rooms`,
      width: "100%",
      height: "600px",
      fileName: `floorplan-3d-${generateId()}.html`,
      downloadUrl: viewerUrl || undefined,
      mimeType: "text/html",
      roomCount: fpRooms.length,
      wallCount: fpWalls.length,
      floorPlanGeometry: fpGeometry,
      sourceImageUrl: inputData?.imageUrl ?? inputData?.url ?? undefined,
      aiRenderUrl: aiRenderUrl || undefined,
    },
    metadata: { engine: "threejs-r128", real: true },
    createdAt: new Date(),
  };
};
