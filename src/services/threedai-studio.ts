/**
 * 3D AI Studio — Text-to-3D API Integration for GN-001 Massing Generator
 *
 * Replaces the old procedural massing-generator with AI-generated 3D models
 * using 3D AI Studio's Text-to-3D endpoint.
 *
 * Flow: Build prompt from building requirements → POST task → Poll → Download GLB
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface BuildingRequirements {
  buildingType?: string;
  floors?: number;
  floorToFloorHeight?: number;
  height?: number;
  style?: string;
  massing?: string;
  materials?: string[];
  footprint?: {
    shape?: string;
    width?: number;
    depth?: number;
    area?: number;
  };
  footprint_m2?: number;
  features?: string[];
  context?: {
    site?: string;
    surroundings?: string;
    orientation?: string;
    climate?: string;
  };
  siteArea?: number;
  total_gfa_m2?: number;
  content?: string;
  prompt?: string;
}

export interface ThreeDTaskResult {
  glbUrl: string;
  thumbnailUrl?: string;
  taskId: string;
  prompt: string;
  negativePrompt: string;
  kpis: BuildingKPIs;
  metadata: {
    engine: string;
    model: string;
    generationTimeMs: number;
    pollAttempts: number;
  };
}

export interface BuildingKPIs {
  buildingType: string;
  floors: number;
  floorToFloorHeight: number;
  totalHeight: number;
  footprintArea: number;
  grossFloorArea: number;
  netFloorArea: number;
  efficiency: number;
  floorAreaRatio: number | null;
  siteCoverage: number | null;
  estimatedVolume: number;
  surfaceToVolumeRatio: number;
  facadeArea: number;
  structuralGrid: string;
  sustainability: {
    estimatedEUI: number;
    euiUnit: string;
    daylightPotential: string;
    naturalVentilation: string;
    greenRoofPotential: boolean;
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = "https://api.3daistudio.com";
const GENERATE_ENDPOINT = "/v1/3d-models/tencent/generate/rapid/";
const CONVERT_ENDPOINT = "/v1/tools/convert/";
const POLL_ENDPOINT = "/v1/generation-request/"; // + {task_id}/status/
const INITIAL_POLL_DELAY_MS = 5_000; // first poll after 5s (generation takes 30-60s)
const POLL_INTERVAL_MS = 3_000; // then every 3s
const MAX_POLL_TIME_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

// ─── Prompt Templates ───────────────────────────────────────────────────────────

const NEGATIVE_PROMPT =
  "low quality, blurry, distorted, noise, artifacts, unrealistic proportions, " +
  "toy-like, cartoon, non-architectural, furniture, people, vehicles, trees, " +
  "interior details, text, watermark, signature";

const VIEW_SUFFIX =
  "isometric view, white background, professional architectural visualization, " +
  "high detail architectural massing model, clean geometry, sharp edges, " +
  "accurate proportions, photorealistic rendering";

/** Maps massing type keywords to architectural form descriptions */
const MASSING_VOCAB: Record<string, string> = {
  extruded: "simple extruded rectangular massing volume",
  stepped: "stepped massing with setbacks at upper floors",
  tapered: "tapered form narrowing toward the top",
  twisted: "twisted tower with rotated floor plates",
  podium_tower: "podium-tower typology with a wide base and slender tower rising above",
  stacked: "stacked volumes with offset floor plates",
  cantilever: "cantilevered upper floors extending beyond the base",
  terraced: "terraced form with cascading setbacks creating outdoor terraces",
  sculpted: "sculpturally carved massing with organic curves",
  split: "split massing with two connected volumes",
  courtyard: "courtyard typology with central open space",
  atrium: "atrium building with a tall interior void",
  bar: "elongated bar building with linear form",
  slab: "slab typology with wide flat proportions",
  point_tower: "slender point tower with compact floor plate",
};

/** Maps material keywords to descriptive phrases */
const MATERIAL_DESCRIPTORS: Record<string, string> = {
  glass: "glass curtain wall facade",
  aluminum: "aluminum panel cladding",
  concrete: "exposed concrete finish",
  steel: "steel frame structure",
  timber: "mass timber construction",
  brick: "brick masonry facade",
  terracotta: "terracotta rain-screen panels",
  zinc: "zinc standing-seam cladding",
  stone: "natural stone cladding",
  copper: "copper panel facade with patina",
  ceramic: "ceramic tile facade",
  metal: "metal panel cladding",
  wood: "wood-clad exterior",
  composite: "composite panel system",
};

/** Maps style keywords to architectural style descriptions */
const STYLE_DESCRIPTORS: Record<string, string> = {
  parametric: "parametric architecture with computational design patterns",
  brutalist: "brutalist architecture with exposed concrete and bold geometric forms",
  minimalist: "minimalist architecture with clean lines and restrained palette",
  hightech: "high-tech architecture with exposed structural elements",
  "high-tech": "high-tech architecture with exposed structural elements",
  deconstructivist: "deconstructivist architecture with fragmented angular forms",
  artdeco: "art deco architecture with decorative geometric ornamentation",
  "art deco": "art deco architecture with decorative geometric ornamentation",
  organic: "organic architecture with flowing biomorphic curves",
  sustainable: "sustainable green architecture with living walls and solar features",
  modern: "modern contemporary architecture with clean geometric forms",
  contemporary: "contemporary architecture with innovative material expression",
  classical: "neoclassical architecture with columns and symmetrical composition",
  tropical: "tropical modernist architecture with deep overhangs and natural ventilation",
  industrial: "industrial architecture with raw materials and open structural systems",
  nordic: "nordic minimalist architecture with warm wood and clean white surfaces",
  japanese: "japanese-inspired architecture with timber screens and zen proportions",
  futuristic: "futuristic architecture with sleek aerodynamic curves",
};

/** Maps building type to proportional descriptions */
const PROPORTION_BY_TYPE: Record<string, string> = {
  residential: "slender residential proportions",
  office: "efficient commercial office proportions",
  "mixed-use": "mixed-use proportions with retail podium and upper residential/office floors",
  hotel: "elegant hotel proportions with regular floor plates",
  hospital: "broad hospital proportions with deep floor plates for clinical spaces",
  school: "low-rise educational proportions with courtyards",
  museum: "monumental museum proportions with generous ceiling heights",
  library: "compact library proportions with reading room volumes",
  retail: "wide retail proportions with open floor plans",
  warehouse: "large-span industrial warehouse proportions",
  stadium: "sweeping stadium proportions with tiered seating geometry",
  mosque: "mosque proportions with central dome and minarets",
  church: "ecclesiastical proportions with nave and bell tower",
  temple: "temple proportions with traditional architectural elements",
};

// ─── Feature Descriptions ───────────────────────────────────────────────────────

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  terrace: "with outdoor terraces on setback floors",
  canopy: "with a prominent entrance canopy",
  rooftop_garden: "with a green rooftop garden",
  double_skin: "with double-skin facade system",
  atrium: "with a multi-storey atrium",
  skybridge: "with skybridge connections",
  courtyard: "with an enclosed courtyard",
  balcony: "with projecting balconies on each floor",
  loggia: "with recessed loggia openings",
  colonnade: "with a ground-level colonnade",
  arcade: "with covered arcade at street level",
  pergola: "with rooftop pergola structure",
  solar_panels: "with solar panel arrays on the roof",
  green_wall: "with vertical green wall on the facade",
  brise_soleil: "with brise-soleil sun shading devices",
  fins: "with vertical facade fins for solar control",
  podium: "with a podium base for retail/commercial use",
  helipad: "with a rooftop helipad",
  parking: "with integrated parking structure",
  swimming_pool: "with a rooftop swimming pool",
};

// ─── Prompt Builder ─────────────────────────────────────────────────────────────

function buildMasterPrompt(req: BuildingRequirements): string {
  const parts: string[] = [];

  // 1. Building type and scale
  const floors = req.floors ?? 5;
  const height = req.height ?? floors * (req.floorToFloorHeight ?? 3.5);
  const buildingType = req.buildingType ?? "mixed-use building";
  parts.push(
    `A ${floors}-storey ${buildingType}, approximately ${Math.round(height)} meters tall`
  );

  // 2. Proportions
  const typeKey = buildingType.toLowerCase().replace(/\s+/g, "-");
  if (PROPORTION_BY_TYPE[typeKey]) {
    parts.push(PROPORTION_BY_TYPE[typeKey]);
  }

  // 3. Footprint description
  if (req.footprint) {
    const shape = req.footprint.shape ?? "rectangular";
    const area = req.footprint.area ?? (req.footprint.width && req.footprint.depth
      ? req.footprint.width * req.footprint.depth : null);
    if (req.footprint.width && req.footprint.depth) {
      parts.push(`with a ${shape} footprint of ${req.footprint.width}m × ${req.footprint.depth}m`);
    } else if (area) {
      parts.push(`with a ${shape} footprint of approximately ${area} square meters`);
    }
  } else if (req.footprint_m2) {
    parts.push(`with a footprint of approximately ${req.footprint_m2} square meters`);
  }

  // 4. Massing form
  const massingKey = req.massing?.toLowerCase().replace(/[-\s]+/g, "_") ?? "";
  if (MASSING_VOCAB[massingKey]) {
    parts.push(MASSING_VOCAB[massingKey]);
  }

  // 5. Architectural style — try normalized key first, then raw lowercase
  const styleLower = req.style?.toLowerCase() ?? "";
  const styleNorm = styleLower.replace(/[-\s]+/g, "");
  const styleDesc = STYLE_DESCRIPTORS[styleNorm] ?? STYLE_DESCRIPTORS[styleLower];
  if (styleDesc) parts.push(styleDesc);

  // 6. Materials
  if (req.materials && req.materials.length > 0) {
    const matDescs = req.materials
      .map(m => MATERIAL_DESCRIPTORS[m.toLowerCase()] ?? `${m} facade`)
      .slice(0, 3);
    parts.push(`featuring ${matDescs.join(" and ")}`);
  }

  // 7. Features
  if (req.features && req.features.length > 0) {
    const featDescs = req.features
      .map(f => FEATURE_DESCRIPTIONS[f.toLowerCase().replace(/[-\s]+/g, "_")] ?? "")
      .filter(Boolean)
      .slice(0, 4);
    if (featDescs.length) parts.push(featDescs.join(", "));
  }

  // 8. Context
  if (req.context) {
    const ctxParts: string[] = [];
    if (req.context.site) ctxParts.push(`situated on a ${req.context.site}`);
    if (req.context.surroundings) ctxParts.push(`within a ${req.context.surroundings}`);
    if (req.context.orientation) ctxParts.push(`${req.context.orientation} orientation`);
    if (ctxParts.length) parts.push(ctxParts.join(", "));
  }

  // 9. View and quality suffix
  parts.push(VIEW_SUFFIX);

  return parts.join(", ");
}

function buildMinimalPrompt(req: BuildingRequirements): string {
  const floors = req.floors ?? 5;
  const buildingType = req.buildingType ?? "building";
  const style = req.style ? `, ${req.style} style` : "";
  const materials = req.materials?.length ? `, ${req.materials.join(" and ")} facade` : "";

  return (
    `A ${floors}-storey ${buildingType}${style}${materials}, ` +
    `architectural massing model, ${VIEW_SUFFIX}`
  );
}

function buildCampusPrompt(req: BuildingRequirements): string {
  const buildingType = req.buildingType ?? "campus";
  const floors = req.floors ?? 3;
  const style = req.style
    ? STYLE_DESCRIPTORS[req.style.toLowerCase()] ?? `${req.style} architecture`
    : "modern architecture";

  return (
    `An aerial view of a ${buildingType} campus masterplan with multiple ${floors}-storey buildings, ` +
    `${style}, connected by landscaped pathways and courtyards, ` +
    `coherent architectural language across buildings, ` +
    `site plan view, ${VIEW_SUFFIX}`
  );
}

/**
 * Selects the best prompt template and builds the final prompt string.
 *
 * IMPORTANT: When the user provides a rich architectural description (>100 chars),
 * we use it DIRECTLY as the prompt with minimal additions. This preserves the
 * user's architectural vision (circular building, specific facade descriptions,
 * spatial qualities, etc.) instead of reducing it to generic structured parameters.
 *
 * The structured data from TR-003 is still used for KPI calculation.
 */
export function buildPrompt(req: BuildingRequirements): { prompt: string; negativePrompt: string; template: string } {
  const userText = req.content || req.prompt || "";
  const hasStructuredData = req.floors || req.footprint || req.massing || req.materials?.length;

  let prompt: string;
  let template: string;

  // PRIORITY 1: If user provided a rich description (>100 chars), use it directly.
  // This is the key fix — the user's architectural vision should NOT be reduced
  // to generic parameters like "5-storey mixed-use" by the structured pipeline.
  const isRichDescription = userText.length > 100;

  if (isRichDescription) {
    // Use the user's text directly with only view/quality suffixes.
    // Truncate user text if needed — 3D AI Studio caps prompts at 1024 chars.
    const suffix = `, ${VIEW_SUFFIX}`;
    const maxUserLen = 1024 - suffix.length;
    const trimmedText = userText.length > maxUserLen
      ? userText.slice(0, maxUserLen - 3) + "..."
      : userText;
    prompt = trimmedText + suffix;
    template = "passthrough";
    return { prompt, negativePrompt: NEGATIVE_PROMPT, template };
  }

  // PRIORITY 2: Detect campus/masterplan
  const isCampus = /campus|masterplan|multiple\s*buildings|complex/i.test(
    `${req.buildingType ?? ""} ${userText}`
  );

  if (isCampus) {
    prompt = buildCampusPrompt(req);
    template = "campus";
  } else if (hasStructuredData) {
    // PRIORITY 3: Build from structured data (short prompts + TR-003 extracted params)
    prompt = buildMasterPrompt(req);
    template = "master";
  } else if (userText) {
    // PRIORITY 4: Short text with no structured data
    prompt = `${userText}, architectural massing model, exterior building view, ${VIEW_SUFFIX}`;
    template = "minimal";
  } else {
    prompt = buildMinimalPrompt(req);
    template = "minimal";
  }

  // 3D AI Studio enforces a 1024-char limit on prompts
  if (prompt.length > 1024) {
    prompt = prompt.slice(0, 1021) + "...";
  }

  return { prompt, negativePrompt: NEGATIVE_PROMPT, template };
}

// ─── KPI Calculator ─────────────────────────────────────────────────────────────

const EFFICIENCY_BY_TYPE: Record<string, number> = {
  residential: 0.82,
  office: 0.78,
  "mixed-use": 0.75,
  hotel: 0.70,
  hospital: 0.65,
  school: 0.72,
  museum: 0.68,
  library: 0.75,
  retail: 0.85,
  warehouse: 0.92,
  default: 0.75,
};

const EUI_BY_TYPE: Record<string, number> = {
  residential: 120,
  office: 180,
  "mixed-use": 160,
  hotel: 220,
  hospital: 350,
  school: 140,
  museum: 160,
  library: 150,
  retail: 200,
  warehouse: 80,
  default: 160,
};

const GRID_BY_TYPE: Record<string, string> = {
  residential: "6.0m × 6.0m",
  office: "8.4m × 8.4m",
  "mixed-use": "8.0m × 8.0m",
  hotel: "7.2m × 7.2m",
  hospital: "7.8m × 8.4m",
  school: "7.2m × 7.2m",
  museum: "9.0m × 9.0m",
  warehouse: "12.0m × 12.0m",
  default: "8.0m × 8.0m",
};

export function calculateKPIs(req: BuildingRequirements): BuildingKPIs {
  // Clamp inputs to sane ranges — prevents NaN, Infinity, negative values
  const floors = Math.max(req.floors ?? 5, 1);
  const floorToFloor = Math.max(req.floorToFloorHeight ?? 3.5, 2);
  const totalHeight = Math.max(req.height ?? floors * floorToFloor, floorToFloor);
  const buildingType = (req.buildingType ?? "mixed-use").toLowerCase();
  const typeKey = buildingType.replace(/\s+/g, "-");

  // Footprint — guaranteed > 0
  let footprintArea: number;
  if (req.footprint?.area && req.footprint.area > 0) {
    footprintArea = req.footprint.area;
  } else if (req.footprint?.width && req.footprint?.depth && req.footprint.width > 0 && req.footprint.depth > 0) {
    footprintArea = req.footprint.width * req.footprint.depth;
  } else if (req.footprint_m2 && req.footprint_m2 > 0) {
    footprintArea = req.footprint_m2;
  } else if (req.total_gfa_m2 && req.total_gfa_m2 > 0) {
    footprintArea = Math.round(req.total_gfa_m2 / floors);
  } else {
    footprintArea = 500; // default
  }
  footprintArea = Math.max(footprintArea, 1); // safety floor

  const gfa = req.total_gfa_m2 ?? footprintArea * floors;
  const efficiency = EFFICIENCY_BY_TYPE[typeKey] ?? EFFICIENCY_BY_TYPE.default;
  const nfa = Math.round(gfa * efficiency);
  const siteArea = req.siteArea ?? null;

  // Envelope calculations
  const footprintSide = Math.sqrt(footprintArea);
  const perimeter = (req.footprint?.width && req.footprint?.depth)
    ? 2 * (req.footprint.width + req.footprint.depth)
    : 4 * footprintSide;
  const facadeArea = Math.round(perimeter * totalHeight);
  const volume = Math.max(Math.round(footprintArea * totalHeight), 1); // prevent div-by-zero
  const surfaceArea = facadeArea + 2 * footprintArea; // facades + roof + ground
  const svRatio = Math.round((surfaceArea / volume) * 1000) / 1000;

  // Sustainability
  const eui = EUI_BY_TYPE[typeKey] ?? EUI_BY_TYPE.default;
  const daylightPotential = footprintSide <= 18 ? "Excellent" : footprintSide <= 25 ? "Good" : "Moderate";
  const ventPotential = floors <= 6 && footprintSide <= 15 ? "High" : floors <= 12 ? "Moderate" : "Low";

  return {
    buildingType: req.buildingType ?? "Mixed-Use",
    floors,
    floorToFloorHeight: floorToFloor,
    totalHeight: Math.round(totalHeight * 10) / 10,
    footprintArea: Math.round(footprintArea),
    grossFloorArea: Math.round(gfa),
    netFloorArea: nfa,
    efficiency: Math.round(efficiency * 100),
    floorAreaRatio: siteArea ? Math.round((gfa / siteArea) * 100) / 100 : null,
    siteCoverage: siteArea ? Math.round((footprintArea / siteArea) * 100) : null,
    estimatedVolume: volume,
    surfaceToVolumeRatio: svRatio,
    facadeArea,
    structuralGrid: GRID_BY_TYPE[typeKey] ?? GRID_BY_TYPE.default,
    sustainability: {
      estimatedEUI: eui,
      euiUnit: "kWh/m²/year",
      daylightPotential,
      naturalVentilation: ventPotential,
      greenRoofPotential: floors <= 20,
    },
  };
}

// ─── API Client ─────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.THREEDAI_API_KEY;
  if (!key) throw new Error("THREEDAI_API_KEY environment variable is not set");
  return key;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      // Retry on 429 (rate limit) and 5xx
      if (res.status === 429 || res.status >= 500) {
        lastStatus = res.status;
        lastError = new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`[3DAI] Retry ${attempt + 1}/${retries} after ${delay}ms (status ${res.status})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      console.log(`[3DAI] Retry ${attempt + 1}/${retries} after ${delay}ms (${lastError.message})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  if (lastStatus === 429) {
    throw new Error("3D AI Studio rate limit exceeded after retries — wait 1 minute and try again");
  }
  throw lastError ?? new Error("Request failed after retries");
}

/** Shape of the POST /generate/rapid/ response */
interface TaskCreateResponse {
  task_id?: string;
  id?: string;
  created_at?: string;
  status?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Shape of the GET /generation-request/{id}/status/ response */
interface TaskStatusResponse {
  status: string; // "PENDING" | "PROCESSING" | "FINISHED" | "FAILED"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results?: any[];
  error?: string;
  error_code?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Generate a 3D model from building requirements using 3D AI Studio Text-to-3D.
 * Returns the GLB URL and computed KPIs.
 */
export async function generate3DModel(
  requirements: BuildingRequirements
): Promise<ThreeDTaskResult> {
  const apiKey = getApiKey();
  const { prompt, negativePrompt, template } = buildPrompt(requirements);
  const startTime = Date.now();

  console.log(`[3DAI] Generating 3D model (template: ${template})`);
  console.log(`[3DAI] Prompt: ${prompt.slice(0, 200)}...`);

  // Step 1: Create generation task
  const createRes = await fetchWithRetry(`${API_BASE}${GENERATE_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      negative_prompt: negativePrompt,
      enable_pbr: true,
    }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => "");
    // Specific error messages for common codes
    if (createRes.status === 401) throw new Error("Invalid THREEDAI_API_KEY — check your API key");
    if (createRes.status === 402) throw new Error("Insufficient 3D AI Studio credits — top up at 3daistudio.com");
    if (createRes.status === 429) throw new Error("3D AI Studio rate limit exceeded — max 3 req/min");
    throw new Error(`3D AI Studio API error ${createRes.status}: ${errBody}`);
  }

  const createData: TaskCreateResponse = await createRes.json();
  const taskId = createData.task_id ?? createData.id;

  console.log("[3DAI] Create response:", JSON.stringify(createData));

  if (!taskId) {
    throw new Error(`3D AI Studio did not return a task_id. Response: ${JSON.stringify(createData)}`);
  }

  console.log(`[3DAI] Task created: ${taskId}`);

  // Step 2: Poll for completion using the documented endpoint
  let pollAttempts = 0;
  const deadline = Date.now() + MAX_POLL_TIME_MS;

  // Wait a bit before first poll — generation takes 20-60s typically
  await new Promise(r => setTimeout(r, INITIAL_POLL_DELAY_MS));

  while (Date.now() < deadline) {
    pollAttempts++;

    const pollUrl = `${API_BASE}${POLL_ENDPOINT}${taskId}/status/`;
    const pollRes = await fetchWithRetry(pollUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      console.log(`[3DAI] Poll ${pollAttempts} failed: ${pollRes.status}`);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    const pollData: TaskStatusResponse = await pollRes.json();
    const status = pollData.status?.toUpperCase() ?? "UNKNOWN";
    console.log(`[3DAI] Poll ${pollAttempts}: status=${status}`);

    if (status === "FINISHED" || status === "COMPLETED" || status === "SUCCEEDED") {
      let assetUrl = extractAssetUrl(pollData);

      // The API sometimes returns FINISHED with asset=null on the first poll.
      // Re-poll a few times to wait for the asset URL to populate.
      if (!assetUrl) {
        console.log("[3DAI] FINISHED but asset is null — re-polling for URL...");
        for (let retry = 0; retry < 5; retry++) {
          await new Promise(r => setTimeout(r, 2000));
          const retryRes = await fetchWithRetry(pollUrl, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (retryRes.ok) {
            const retryData: TaskStatusResponse = await retryRes.json();
            assetUrl = extractAssetUrl(retryData);
            if (assetUrl) break;
          }
        }
      }

      if (!assetUrl) {
        console.log("[3DAI] Finished response:", JSON.stringify(pollData));
        throw new Error("Task finished but no asset URL found after multiple polls");
      }

      // The API returns a .zip archive with OBJ+textures.
      // Convert to GLB using the API's convert endpoint for direct GLB URL.
      const glbUrl = await convertToGlb(assetUrl, apiKey);

      const kpis = calculateKPIs(requirements);
      const elapsed = Date.now() - startTime;
      console.log(`[3DAI] Done in ${(elapsed / 1000).toFixed(1)}s (${pollAttempts} polls)`);

      return {
        glbUrl,
        thumbnailUrl: extractThumbnailUrl(pollData),
        taskId,
        prompt,
        negativePrompt,
        kpis,
        metadata: {
          engine: "3daistudio",
          model: "tencent-rapid",
          generationTimeMs: elapsed,
          pollAttempts,
        },
      };
    }

    if (status === "FAILED" || status === "ERROR") {
      const errMsg = pollData.error ?? pollData.error_code ?? "unknown error";
      throw new Error(`3D generation failed: ${errMsg}`);
    }

    // PENDING, PROCESSING, or IN_PROGRESS — keep polling
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`3D generation timed out after ${MAX_POLL_TIME_MS / 1000}s (${pollAttempts} polls)`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extract the asset download URL from the status response.
 * The API returns results as: [{ asset: "https://...", asset_type: "ARCHIVE" }]
 */
function extractAssetUrl(data: TaskStatusResponse): string | null {
  if (Array.isArray(data.results) && data.results.length > 0) {
    for (const result of data.results) {
      if (typeof result === "string" && result.startsWith("http")) return result;
      if (typeof result === "object" && result !== null) {
        // Primary format: { asset: "url", asset_type: "ARCHIVE" }
        if (typeof result.asset === "string" && result.asset.startsWith("http")) {
          return result.asset;
        }
        // Fallback keys
        for (const key of ["url", "download_url", "model_url", "glb", "output"]) {
          if (typeof result[key] === "string" && result[key].startsWith("http")) return result[key];
        }
      }
    }
  }
  // Top-level fallbacks
  for (const key of ["asset", "result", "output", "model_url", "download_url", "url"]) {
    const val = data[key];
    if (typeof val === "string" && val.startsWith("http")) return val;
  }
  return null;
}

/**
 * Convert an OBJ archive to GLB using 3D AI Studio's convert endpoint,
 * then download the GLB and upload to our R2 for CORS-safe browser access.
 *
 * The 3D AI Studio URLs are signed and expire after 1 hour, plus they
 * don't have CORS headers — so browsers can't fetch them directly.
 */
async function convertToGlb(archiveUrl: string, apiKey: string): Promise<string> {
  console.log("[3DAI] Converting OBJ → GLB via API...");

  const convertRes = await fetchWithRetry(`${API_BASE}${CONVERT_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model_url: archiveUrl,
      output_format: "glb",
    }),
  });

  if (!convertRes.ok) {
    const errBody = await convertRes.text().catch(() => "");
    throw new Error(`GLB conversion failed: ${convertRes.status} ${errBody}`);
  }

  const convertData: TaskCreateResponse = await convertRes.json();
  const convertTaskId = convertData.task_id ?? convertData.id;

  if (!convertTaskId) {
    throw new Error("Convert endpoint did not return a task_id");
  }

  console.log(`[3DAI] Conversion task: ${convertTaskId}`);

  // Poll conversion — typically completes in 10-15s
  const convDeadline = Date.now() + 2 * 60 * 1000; // 2 min max for conversion
  let convPolls = 0;
  await new Promise(r => setTimeout(r, 3000)); // initial wait

  while (Date.now() < convDeadline) {
    convPolls++;
    const pollUrl = `${API_BASE}${POLL_ENDPOINT}${convertTaskId}/status/`;
    const pollRes = await fetchWithRetry(pollUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      console.log(`[3DAI] Convert poll ${convPolls} failed: ${pollRes.status}`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    const pollData: TaskStatusResponse = await pollRes.json();
    const status = pollData.status?.toUpperCase() ?? "UNKNOWN";
    console.log(`[3DAI] Convert poll ${convPolls}: status=${status}`);

    if (status === "FINISHED" || status === "COMPLETED") {
      let sourceGlbUrl = extractAssetUrl(pollData);
      if (!sourceGlbUrl) {
        // Re-poll once for asset URL (same race condition as generation)
        await new Promise(r => setTimeout(r, 2000));
        const retryRes = await fetchWithRetry(pollUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (retryRes.ok) {
          const retryData: TaskStatusResponse = await retryRes.json();
          sourceGlbUrl = extractAssetUrl(retryData);
        }
        if (!sourceGlbUrl) {
          throw new Error("GLB conversion finished but no download URL found");
        }
      }

      // Download the GLB and re-upload to our R2 for CORS-safe browser access
      return await reuploadToR2(sourceGlbUrl);
    }

    if (status === "FAILED" || status === "ERROR") {
      throw new Error(`GLB conversion failed: ${pollData.error ?? pollData.failure_reason ?? "unknown"}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error("GLB conversion timed out");
}

/**
 * Download the GLB from the source URL (3D AI Studio's signed R2 URL)
 * and re-upload it to our own R2 bucket for CORS-safe, permanent browser access.
 * Falls back to a proxy API route if R2 is not configured.
 */
async function reuploadToR2(sourceUrl: string): Promise<string> {
  console.log("[3DAI] Downloading GLB for R2 re-upload...");

  const dlRes = await fetch(sourceUrl);
  if (!dlRes.ok) {
    // Source URL has no CORS headers — proxy instead of returning raw URL
    console.warn(`[3DAI] GLB download failed (${dlRes.status}), using proxy route`);
    return `/api/proxy-glb?url=${encodeURIComponent(sourceUrl)}`;
  }

  const glbBuffer = Buffer.from(await dlRes.arrayBuffer());
  console.log(`[3DAI] GLB downloaded: ${(glbBuffer.length / 1024).toFixed(0)} KB`);

  try {
    const { uploadIFCToR2, isR2Configured } = await import("@/lib/r2");
    if (!isR2Configured()) {
      console.warn("[3DAI] R2 not configured — using proxy route instead");
      // Encode the source URL for our proxy
      return `/api/proxy-glb?url=${encodeURIComponent(sourceUrl)}`;
    }

    const filename = `gn001-${Date.now()}.glb`;
    const result = await uploadIFCToR2(glbBuffer, filename);
    if (result?.url) {
      console.log(`[3DAI] GLB uploaded to R2: ${result.url}`);
      return result.url;
    }

    console.warn("[3DAI] R2 upload returned null, using proxy route");
    return `/api/proxy-glb?url=${encodeURIComponent(sourceUrl)}`;
  } catch (err) {
    console.warn("[3DAI] R2 upload failed:", err);
    return `/api/proxy-glb?url=${encodeURIComponent(sourceUrl)}`;
  }
}

function extractThumbnailUrl(data: TaskStatusResponse): string | undefined {
  if (Array.isArray(data.results)) {
    for (const result of data.results) {
      if (typeof result === "object" && result !== null) {
        for (const key of ["thumbnail", "thumbnail_url", "preview", "preview_url", "image_url"]) {
          if (typeof result[key] === "string" && result[key].startsWith("http")) return result[key];
        }
      }
    }
  }
  for (const key of ["thumbnail", "thumbnail_url", "preview", "preview_url", "image_url"]) {
    const val = data[key];
    if (typeof val === "string" && val.startsWith("http")) return val;
  }
  return undefined;
}

// ─── Configuration Check ────────────────────────────────────────────────────────

export function is3DAIConfigured(): boolean {
  return !!process.env.THREEDAI_API_KEY;
}
