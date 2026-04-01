/**
 * Meshy.ai — Text-to-3D API Integration (Alternative to 3D AI Studio)
 *
 * Flow: Build prompt → POST preview task → Poll → GET GLB URL → Re-upload to R2
 * Meshy generates photorealistic 3D models from text descriptions with PBR textures.
 */

import type { BuildingRequirements, ThreeDTaskResult, BuildingKPIs } from "./threedai-studio";

// ─── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = "https://api.meshy.ai/openapi/v2";
const INITIAL_POLL_DELAY_MS = 8_000; // Meshy preview takes 30-90s
const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_TIME_MS = 5 * 60 * 1000; // 5 minutes

const NEGATIVE_PROMPT =
  "low quality, blurry, distorted, noise, artifacts, unrealistic proportions, " +
  "toy-like, cartoon, non-architectural, furniture, people, vehicles, " +
  "interior details, text, watermark, signature, simplified, abstract, blocky, " +
  "flat shading, untextured, plastic, miniature, dollhouse, game asset, low-poly, " +
  "smooth featureless walls, missing windows, blank facade, no detail, " +
  "spaceship, spacecraft, UFO, flying saucer, rocket, vehicle, airplane, robot, " +
  "sci-fi ship, starship, space station, action figure, figurine, diorama, model kit";

const VIEW_SUFFIX =
  "isometric view, white background, ultra-realistic architectural visualization, " +
  "detailed facade with windows and facade panels, real-world building proportions, " +
  "high-resolution PBR materials and textures, sharp edges, accurate scale, " +
  "photorealistic octane render quality, architectural photography lighting, 8K detail";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new Error("MESHY_API_KEY is not configured");
  return key;
}

export function isMeshyTextTo3DConfigured(): boolean {
  return !!process.env.MESHY_API_KEY;
}

// ─── Prompt Builder ─────────────────────────────────────────────────────────────

function buildMeshyPrompt(req: BuildingRequirements): string {
  // If user provided a long descriptive prompt, use it directly with view suffix
  const userContent = req.content || req.prompt || "";
  if (userContent.length > 100) {
    const anchor = "Architectural building exterior (NOT a vehicle or spacecraft): ";
    const trimmed = userContent.slice(0, 400);
    return `${anchor}${trimmed}. ${VIEW_SUFFIX}`.slice(0, 600);
  }

  // Build structured prompt from requirements
  const parts: string[] = [];

  const floors = req.floors ?? 5;
  const buildingType = req.buildingType || "Mixed-Use Building";
  const height = req.height ?? floors * 3.5;

  parts.push(`A highly detailed, ultra-realistic ${floors}-storey ${buildingType}`);
  parts.push(`approximately ${Math.round(height)} meters tall`);

  if (req.footprint?.shape) parts.push(`with a ${req.footprint.shape} footprint`);
  if (req.footprint_m2) parts.push(`of approximately ${req.footprint_m2} m² footprint`);
  if (req.style) parts.push(`in ${req.style} architectural style`);
  if (req.massing) parts.push(`with ${req.massing} massing`);

  if (req.materials?.length) {
    parts.push(`featuring ${req.materials.join(", ")} facade`);
  } else {
    parts.push("featuring glass curtain wall facade with visible mullions");
  }

  if (req.features?.length) {
    parts.push(`with ${req.features.slice(0, 3).join(", ")}`);
  }

  parts.push(VIEW_SUFFIX);

  return parts.join(", ").slice(0, 600);
}

// ─── KPI Calculator ─────────────────────────────────────────────────────────────

function calculateKPIs(req: BuildingRequirements): BuildingKPIs {
  const floors = req.floors ?? 5;
  const floorToFloorHeight = req.floorToFloorHeight ?? 3.5;
  const totalHeight = req.height ?? floors * floorToFloorHeight;
  const footprintArea = req.footprint_m2 ?? req.footprint?.area ?? 500;
  const grossFloorArea = req.total_gfa_m2 ?? footprintArea * floors;
  const buildingType = req.buildingType ?? "Mixed-Use Building";

  const efficiencyMap: Record<string, number> = {
    office: 82, residential: 80, hotel: 70, retail: 85,
    museum: 65, school: 75, hospital: 60, warehouse: 90,
  };
  const typeKey = Object.keys(efficiencyMap).find(k =>
    buildingType.toLowerCase().includes(k)
  );
  const efficiency = efficiencyMap[typeKey ?? ""] ?? 75;
  const netFloorArea = Math.round(grossFloorArea * efficiency / 100);

  const perimeter = Math.sqrt(footprintArea) * 4; // approximate
  const facadeArea = Math.round(perimeter * totalHeight);
  const volume = Math.round(grossFloorArea * floorToFloorHeight);
  const svRatio = Math.round(((facadeArea + footprintArea * 2) / volume) * 100) / 100;

  return {
    buildingType,
    floors,
    floorToFloorHeight,
    totalHeight: Math.round(totalHeight * 10) / 10,
    footprintArea: Math.round(footprintArea),
    grossFloorArea: Math.round(grossFloorArea),
    netFloorArea,
    efficiency,
    floorAreaRatio: req.siteArea ? Math.round((grossFloorArea / req.siteArea) * 100) / 100 : null,
    siteCoverage: req.siteArea ? Math.round((footprintArea / req.siteArea) * 100) : null,
    estimatedVolume: volume,
    surfaceToVolumeRatio: svRatio,
    facadeArea,
    structuralGrid: `${Math.min(8, Math.round(Math.sqrt(footprintArea) / 3))}m × ${Math.min(8, Math.round(Math.sqrt(footprintArea) / 3))}m`,
    sustainability: {
      estimatedEUI: typeKey === "office" ? 150 : typeKey === "residential" ? 120 : 170,
      euiUnit: "kWh/m²/year",
      daylightPotential: facadeArea / grossFloorArea > 0.4 ? "High" : "Medium",
      naturalVentilation: floors <= 5 ? "Viable" : "Limited",
      greenRoofPotential: true,
    },
  };
}

// ─── Main API Integration ───────────────────────────────────────────────────────

export async function generateWithMeshy(
  requirements: BuildingRequirements
): Promise<ThreeDTaskResult> {
  const apiKey = getApiKey();
  const prompt = buildMeshyPrompt(requirements);
  const startTime = Date.now();

  // Step 1: Create preview task
  const createRes = await fetch(`${API_BASE}/text-to-3d`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      mode: "preview",
      prompt,
      negative_prompt: NEGATIVE_PROMPT,
      ai_model: "meshy-6",
      target_polycount: 50000,
      target_formats: ["glb"],
      should_remesh: true,
    }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => "");
    if (createRes.status === 401) throw new Error("Invalid MESHY_API_KEY — check your API key");
    if (createRes.status === 402) throw new Error("Insufficient Meshy credits — top up at meshy.ai");
    if (createRes.status === 429) throw new Error("Meshy rate limit exceeded — try again in a minute");
    throw new Error(`Meshy API error ${createRes.status}: ${errBody}`);
  }

  const createData = await createRes.json();
  const taskId = createData.result;

  if (!taskId) {
    throw new Error(`Meshy did not return a task ID. Response: ${JSON.stringify(createData)}`);
  }

  // Step 2: Poll for completion
  let pollAttempts = 0;
  const deadline = Date.now() + MAX_POLL_TIME_MS;

  await new Promise(r => setTimeout(r, INITIAL_POLL_DELAY_MS));

  while (Date.now() < deadline) {
    pollAttempts++;

    const pollRes = await fetch(`${API_BASE}/text-to-3d/${taskId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    const pollData = await pollRes.json();
    const status = (pollData.status ?? "").toUpperCase();

    if (status === "SUCCEEDED") {
      // Extract GLB URL
      const glbUrl = pollData.model_urls?.glb;
      if (!glbUrl) {
        throw new Error("Meshy task succeeded but no GLB URL in response");
      }

      // Re-upload to R2 for CORS-safe access
      let finalGlbUrl = glbUrl;
      try {
        const { uploadIFCToR2, isR2Configured } = await import("@/lib/r2");
        if (isR2Configured()) {
          const glbRes = await fetch(glbUrl);
          if (glbRes.ok) {
            const glbBuffer = Buffer.from(await glbRes.arrayBuffer());
            const filename = `meshy-${taskId}-${Date.now()}.glb`;
            const r2Url = await uploadIFCToR2(glbBuffer, filename);
            if (r2Url) finalGlbUrl = r2Url;
          }
        }
      } catch (r2Err) {
        console.warn("[Meshy] R2 re-upload failed, using direct URL:", r2Err);
      }

      const kpis = calculateKPIs(requirements);

      return {
        glbUrl: finalGlbUrl,
        thumbnailUrl: pollData.thumbnail_url,
        taskId,
        prompt,
        negativePrompt: NEGATIVE_PROMPT,
        kpis,
        metadata: {
          engine: "meshy",
          model: "meshy-6",
          generationTimeMs: Date.now() - startTime,
          pollAttempts,
        },
      };
    }

    if (status === "FAILED" || status === "CANCELED") {
      throw new Error(`Meshy generation ${status.toLowerCase()}: ${pollData.error ?? "unknown error"}`);
    }

    // PENDING or IN_PROGRESS — keep polling
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Meshy generation timed out after 5 minutes");
}
