import OpenAI from "openai";
import { detectOpenAIError, APIError } from "@/lib/user-errors";
import type { FloorPlanRoomType } from "@/types/floor-plan";

function getClient(userApiKey?: string, timeout?: number): OpenAI {
  const key = userApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OpenAI API key configured");
  return new OpenAI({ apiKey: key, timeout: timeout ?? 30000, maxRetries: 1 });
}

// ─── Error Handling ───────────────────────────────────────────────────────────

export class OpenAIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public userMessage: string
  ) {
    super(message);
    this.name = "OpenAIError";
  }
}

async function handleOpenAICall<T>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    // Detect specific OpenAI error types and throw user-friendly errors
    const userError = detectOpenAIError(error);

    const err = error as Record<string, unknown> | null | undefined;

    // Log the original error for debugging
    console.error("[OpenAI Error]", {
      message: err?.message,
      code: err?.code,
      status: err?.status,
      userError: userError.code,
    });

    // Throw APIError with user-friendly message
    throw new APIError(
      userError,
      (typeof err?.status === "number" ? err.status : 500)
    );
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildingDescription {
  projectName: string;
  buildingType: string;
  floors: number;
  totalArea: number; // m²
  height?: number; // metres
  footprint?: number; // m²
  totalGFA?: number; // m² gross floor area
  program?: Array<{ space: string; area_m2?: number; floor?: string }>;
  structure: string;
  facade: string;
  sustainabilityFeatures: string[];
  programSummary: string;
  estimatedCost: string;
  constructionDuration: string;
  narrative: string; // 8-section professional narrative (TR-003 v2)
}


// ─── Helper: Parse user requirements ─────────────────────────────────────────

function parseUserRequirements(prompt: string): { floors?: number; location?: string } {
  const requirements: { floors?: number; location?: string } = {};
  const floorMatch = prompt.match(/(\d+)[-\s]?(story|stories|floor|floors|storey|storeys)/i);
  if (floorMatch) requirements.floors = parseInt(floorMatch[1]);

  // Detect location from prompt — cities, countries, regions
  const locations = [
    "Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad",
    "Berlin", "Munich", "Hamburg", "Frankfurt",
    "London", "Manchester", "Birmingham", "Edinburgh",
    "New York", "Los Angeles", "Chicago", "San Francisco", "Miami", "Seattle", "Boston",
    "Paris", "Lyon", "Marseille",
    "Tokyo", "Osaka", "Kyoto",
    "Dubai", "Abu Dhabi", "Riyadh", "Doha",
    "Singapore", "Hong Kong", "Shanghai", "Beijing",
    "Sydney", "Melbourne", "Brisbane",
    "Toronto", "Vancouver", "Montreal",
    "São Paulo", "Rio de Janeiro", "Mexico City",
    "Stockholm", "Copenhagen", "Oslo", "Helsinki",
    "Amsterdam", "Rotterdam", "Brussels",
    "Zurich", "Geneva", "Vienna",
    "Seoul", "Taipei", "Bangkok", "Jakarta",
    "Lagos", "Nairobi", "Cape Town", "Cairo",
    // Countries
    "India", "Germany", "UK", "United Kingdom", "USA", "United States", "France", "Japan",
    "UAE", "Australia", "Canada", "Brazil", "Sweden", "Norway", "Denmark", "Finland",
    "Netherlands", "Switzerland", "Austria", "South Korea", "Thailand", "Indonesia",
    "Nigeria", "Kenya", "South Africa", "Egypt", "China", "Singapore",
  ];
  const lower = prompt.toLowerCase();
  for (const loc of locations) {
    if (lower.includes(loc.toLowerCase())) {
      requirements.location = loc;
      break;
    }
  }
  return requirements;
}

function enforceUserRequirements(desc: BuildingDescription, req: ReturnType<typeof parseUserRequirements>): BuildingDescription {
  if (req.floors && desc.floors !== req.floors) {
    console.warn(`[TR-003] Forcing floors from ${desc.floors} to ${req.floors}`);
    desc.floors = req.floors;
    desc.narrative = desc.narrative.replace(/\b\d+[-\s]?(story|stories)/gi, `${req.floors}-story`);
    desc.totalArea = req.floors * 800;
  }
  if (req.location && !desc.projectName.toLowerCase().includes(req.location.toLowerCase())) {
    desc.projectName = `${req.location} ${desc.buildingType}`;
  }
  return desc;
}

// ─── generateBuildingDescription ─────────────────────────────────────────────

export async function generateBuildingDescription(
  prompt: string,
  userApiKey?: string
): Promise<BuildingDescription> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a senior architectural consultant with 20 years of international experience, writing for competition boards and award submissions. When generating building descriptions, you MUST consider:
- Local building codes and zoning regulations for the specified location
- Climate-responsive design appropriate for the region
- Local construction methods and structural systems
- Culturally appropriate architectural language and materials
- Realistic floor-to-floor heights (ground floor commercial: 4.0-4.5m, residential: 3.0-3.3m, office: 3.5-3.8m)
- Proper setback requirements if location is specified
- Local parking requirements and ratios

Always specify: building type, total GFA in m², floor count, floor-to-floor heights, structural system, facade materials, sustainability features, and parking provision.
If a location is mentioned, tailor ALL recommendations to that specific city/region's codes and climate.

Generate professional building descriptions suitable for client presentations.

⚠️ CRITICAL REQUIREMENT: FOLLOW USER INPUT EXACTLY
- If user says "7-story" → output MUST have floors: 7
- If user says "Berlin" → output MUST reference Berlin in projectName or narrative
- If user says "retail ground floor" → output MUST include retail on ground floor  
- If user says "rooftop restaurant" → output MUST include rooftop restaurant
- DO NOT change, ignore, or interpret away explicit user specifications
- Expand with professional detail, but NEVER contradict user's input
- Extract and respect ALL specific numbers, locations, and program requirements from user prompt

LOCATION AWARENESS:
When the user mentions a specific city, country, or region, you MUST consider:
- **Local building codes**: FSI/FAR limits, setback requirements, height restrictions typical for that city
- **Climate response**: Design for local climate (monsoon regions → drainage + ventilation; hot-arid → thermal mass + shading; cold → insulation + passive solar; tropical → cross-ventilation + sun protection)
- **Construction methods**: Use locally appropriate structural systems (RCC frame in India; steel frame in US/UK; timber frame in Scandinavia; hybrid in Japan)
- **Local materials**: Reference materials common and cost-effective in that region
- **Parking requirements**: Apply typical local parking ratios for the building type
- **Architectural vernacular**: Reference local architectural character while being contemporary
- **Structural systems**: Choose realistic systems for the building height and type (e.g., shear wall core for high-rise, post-tensioned slabs for large spans)

If no location is specified, default to a temperate climate with international best practices.

Given a project brief, create:
1. An 8-section narrative (500-700 words) in markdown format
2. Structured metadata for system use

Respond with a JSON object with these exact fields:
- projectName (string)
- buildingType (string: e.g. "Mixed-Use Tower", "Educational Campus", "Healthcare Facility")
- floors (number)
- totalArea (number, in square meters)
- structure (string: conceptual structural approach - for design narrative only)
- facade (string: facade material/system description)
- sustainabilityFeatures (array of strings)
- programSummary (string: brief description of building program)
- estimatedCost (string: e.g. "£12.5M")
- constructionDuration (string: e.g. "18 months")
- narrative (string: full 8-section markdown description, see below)

NARRATIVE FORMAT (500-700 words):
Write a professional, client-facing architectural narrative with these 8 sections:

**Project Overview** (2-3 sentences)
Scale, location, and core architectural concept. E.g., "A [height]-story [typology] occupying [area] across [site]. Located in [context], the project responds to [site condition] with [strategy]."

**Spatial Organization**
Vertical/horizontal program distribution. Describe how the building is organized (podium + tower, zoning, floor-by-floor logic) and the functional benefits. Specific floor ranges and dimensions where relevant.

**Facade & Materiality**
Exterior expression: material systems, street-level treatment, distinctive elements. Be specific about materials (e.g., "unitized curtain wall with low-E glazing" not just "glass"). Describe how facade performs (light control, thermal, aesthetic).

**Urban Integration**
How building meets the street and context. Public realm strategy, pedestrian experience, relationship to adjacent buildings/infrastructure. Ground plane treatment, entries, circulation logic.

**Environmental Response**
Climate-specific passive/active strategies. Reference local climate conditions and how design responds (orientation, shading, ventilation, glazing specs, green features). Include sustainability metrics if applicable (energy reduction %, certifications).

**Interior Character**
Spatial quality and user experience. Floor plate dimensions, ceiling heights, key amenities. Describe what it feels like to be inside. Mention views, natural light, flexibility, distinctive spaces.

**Material Palette** (bullet list only)
- Structure: [system]
- Facade: [specific materials + finishes]
- Base: [ground level materials]
- Roof/Top: [crown/rooftop treatment]

**Project Impact**
Why this project matters. What benchmark it sets, who it serves, what it achieves (functional + symbolic). 1-2 sentences that tie everything together.

TERMINOLOGY GUIDELINES:
- Client-facing professional, not technical specs
- YES: "unitized curtain wall," "floor-to-floor heights," "thermal mass," "podium," "setbacks"
- NO: "BIM," "LOD 300," "HVAC zones," "structural grid coordinates"
- Specific > generic: "15-story" not "tall," "2.5m colonnade" not "covered area"
- Material specificity: "fair-faced concrete with board-formed texture" not just "concrete"

QUALITY STANDARD:
Should read like competition board text or architectural award submission. Evocative but precise. Spatial awareness. Context-responsive. Every sentence adds information. No generic fluff.

TARGET: 9/10 quality. Reference: architectural magazine features, design competition entries.`,
        },
        {
          role: "user",
          content: `Generate a building description for: ${prompt}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response");

    const description = JSON.parse(content) as BuildingDescription;
    const requirements = parseUserRequirements(prompt);
    return enforceUserRequirements(description, requirements);
  });
}

// ─── enhanceArchitecturalPrompt ────────────────────────────────────────────────

export async function enhanceArchitecturalPrompt(
  description: BuildingDescription,
  viewType: "exterior" | "floor_plan" | "site_plan" | "interior",
  style?: string,
  apiKey?: string
): Promise<string> {
  try {
    const client = getClient(apiKey);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `You are an expert AEC visualization prompt engineer. Convert structured building data into precise, detailed DALL-E 3 prompts using proper architectural terminology.

Use specific AEC vocabulary: floor count, facade materials, massing strategy, glazing ratio, setbacks, structural grid, floor-to-floor heights, podium/tower relationship, curtain wall systems, fenestration patterns, etc.

For each view type, emphasize different aspects:
- exterior: overall massing, facade expression, materiality, street presence, context
- floor_plan: spatial layout, room proportions, circulation, structural grid, dimensions
- site_plan: building footprint, setbacks, landscaping, access, parking, orientation
- interior: spatial quality, ceiling heights, natural light, materials, furnishings

Respond with JSON: { "prompt": "<the enhanced DALL-E 3 prompt>" }`,
        },
        {
          role: "user",
          content: `Create an optimised DALL-E 3 prompt for a ${viewType} view of this building:

Building Type: ${description.buildingType}
Floors: ${description.floors}
Total GFA: ${description.totalGFA ?? description.totalArea} m²
Height: ${description.height ?? description.floors * 3.5}m
Footprint: ${description.footprint ?? Math.round(description.totalArea / description.floors)} m²
Program: ${JSON.stringify(description.program ?? [{ space: description.programSummary }])}
Style: ${style ?? "contemporary architectural"}
View Type: ${viewType}
Facade: ${description.facade}
Structure: ${description.structure}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from GPT-4o-mini");

    const parsed = JSON.parse(content) as { prompt: string };
    return parsed.prompt;
  } catch (error) {
    console.error("[enhanceArchitecturalPrompt] Falling back to basic prompt:", error);
    return `Professional architectural concept rendering of a ${description.floors}-story ${description.buildingType}. Exterior perspective view from street level, 3/4 angle. ${description.facade} facade. Show building in realistic urban context with surrounding buildings, street, landscaping, and people for scale. Golden hour lighting. High-quality architectural visualization style similar to Foster+Partners or BIG presentations. Photorealistic materials, accurate proportions, contemporary architectural photography style.`;
  }
}

// ─── buildPhotorealisticPrompt ────────────────────────────────────────────────

/**
 * Builds a photorealistic DALL-E prompt following the Architect's 9-element structure.
 * Target: 300-400 words, client-ready quality (9.5/10).
 */
function buildPhotorealisticPrompt(
  description: BuildingDescription,
  location: string = "urban setting",
  cameraAngle: string = "eye-level corner",
  timeOfDay: string = "golden hour"
): string {
  // Extract key details
  const typology = description.buildingType.toLowerCase();
  const floors = description.floors;
  const facade = description.facade;
  const structure = description.structure;
  
  // Determine location-specific context
  const isMumbai = location.toLowerCase().includes("mumbai");
  const contextElements = isMumbai
    ? "busy Mumbai street corner with moderate pedestrian traffic (8-10 people visible: office workers, shoppers, food vendor). Street lined with mature rain trees with dappled shade. Black/yellow auto-rickshaws and cars with Mumbai license plates. Vendor cart with bright fabric canopy (orange/magenta) in foreground. Shallow puddles from recent monsoon rain reflecting golden light."
    : "urban street with pedestrian activity (6-8 people visible), street trees providing natural shade, parked cars and passing traffic. Adjacent buildings showing mixed architectural styles. Well-maintained sidewalk with street furniture.";
  
  const atmosphericDetails = isMumbai
    ? "Slight atmospheric haze typical of coastal Mumbai (humidity visible in distance). Light smoke from street food vendor. Motion blur on passing auto-rickshaw. Wet pavement reflections. Seagulls in distant sky."
    : "Clear atmospheric depth with slight urban haze. Motion blur on vehicles. Sharp foreground, gradual background softness. Natural depth cues.";
  
  // Time of day settings
  const timeSettings = timeOfDay === "golden hour"
    ? "Golden hour (6:15 PM), warm directional sunlight from southwest casting long shadows. Sky transitioning from warm amber near horizon to deep blue overhead, with wispy cirrus clouds catching pink light."
    : "Midday natural light with even illumination. Clear blue sky with scattered clouds. Balanced shadows.";
  
  const lightingDetails = timeOfDay === "golden hour"
    ? `- **Natural:** Warm directional sunlight (5500K) from SW, long shadows at 65° angle
- **Interior retail:** Warm white LED (3000K) glowing through ground floor glazing
- **Accent:** Uplighting on podium overhang soffit (recessed linear LEDs)
- **Sky:** Gradient from amber (horizon) to deep blue (zenith), high dynamic range`
    : `- **Natural:** Balanced daylight (6500K) from overhead, minimal shadows
- **Interior:** Warm white LED (3000K) visible through glazing
- **Even illumination:** Soft, diffused natural light`;
  
  // Camera composition
  const cameraComposition = cameraAngle === "eye-level corner"
    ? "Eye-level view from street corner, 24mm wide-angle perspective, capturing both street facades. Building occupies right two-thirds of frame, with street context on left third. Slight upward tilt emphasizing verticality without distortion."
    : "Three-quarter aerial view at 45° angle, drone perspective showing roof and massing in urban context. Building centered in frame with surrounding streetscape visible.";
  
  // Build comprehensive prompt following 9-element structure
  return `Photorealistic architectural rendering of a ${floors}-story contemporary ${typology} building in ${location}.

**Camera & Composition:**
${cameraComposition}

**Time of Day:**
${timeSettings}

**Building Description:**
${floors}-story ${typology} with ${facade} facade and ${structure} conceptual structure. The building features ${description.programSummary}. Lower floors have recessed floor-to-ceiling glazing with warm LED lighting visible inside. Upper floors showcase the primary facade system with high-performance tinted glazing. Visible green terrace on upper setback levels. Rooftop with clean architectural profile.

**Materials — Specific Details:**
- **Facade:** ${facade} with subtle reflections of sky and adjacent buildings
- **Glazing:** Tinted low-E glass with light bronze tone, minimal reflection
- **Structure:** ${structure} with clean architectural expression
- **Ground plane:** Honed granite pavers with defined mortar joints
- **Entry:** Recessed with polished metal trim details

**Context & Atmosphere:**
${contextElements}

**Lighting — Specific:**
${lightingDetails}

**Atmospheric Details:**
${atmosphericDetails}

**Style & Rendering Quality:**
Photorealistic architectural visualization, high detail, professional photography composition. Depth of field: sharp focus on building, slight background blur (f/5.6 equivalent). Color grading: ${timeOfDay === "golden hour" ? "warm, saturated, HDR-style contrast" : "balanced, natural, true-to-life colors"}. Reference: Luxigon/MIR/DBOX quality level. No text, watermarks, or labels.`;
}

// ─── generateConceptImage ─────────────────────────────────────────────────────

export async function generateConceptImage(
  descriptionOrPrompt: BuildingDescription | string,
  style: string = "photorealistic architectural render",
  userApiKey?: string,
  location?: string,
  cameraAngle?: string,
  timeOfDay?: string,
  viewType: "exterior" | "floor_plan" | "site_plan" | "interior" = "exterior"
): Promise<{ url: string; revisedPrompt: string }> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey, 60000); // 60s — DALL-E 3 HD images take longer

    let imagePrompt: string;

    if (typeof descriptionOrPrompt === "string") {
      // Backward compatibility: plain string prompt
      imagePrompt = descriptionOrPrompt;
    } else {
      // BuildingDescription object — enhance with GPT-4o-mini, then use photorealistic builder
      try {
        imagePrompt = await enhanceArchitecturalPrompt(
          descriptionOrPrompt,
          viewType,
          style,
          userApiKey
        );
      } catch (enhanceErr) {
        console.error("[generateConceptImage] enhanceArchitecturalPrompt failed, using photorealistic fallback:", enhanceErr);
        // Fallback to existing photorealistic prompt builder
        imagePrompt = buildPhotorealisticPrompt(
          descriptionOrPrompt,
          location || "urban setting",
          cameraAngle || "eye-level corner",
          timeOfDay || "golden hour"
        );
      }
    }

    const response = await client.images.generate({
      model: "dall-e-3",
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
      style: "natural",
    });

    const image = response.data?.[0];
    if (!image?.url) throw new Error("No image URL in DALL-E response");

    return {
      url: image.url,
      revisedPrompt: image.revised_prompt ?? imagePrompt,
    };
  });
}

// ─── generateRenovationRender ─────────────────────────────────────────────────
//
// Two-step pipeline that produces a DALL-E 3 renovation render faithful to the
// original building photo:
//   Step 1: GPT-4o SEES the photo and writes a hyper-detailed DALL-E prompt
//           that captures the exact geometry, proportions, window patterns, etc.
//   Step 2: DALL-E 3 renders the renovated version from that prompt.

export async function generateRenovationRender(
  imageBase64: string,
  buildingAnalysis: string,
  mimeType: string = "image/jpeg",
  userApiKey?: string,
): Promise<{ url: string; revisedPrompt: string; renovationPrompt: string }> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey, 90000); // 90s timeout for 2 API calls
    const imageDataUrl = `data:${mimeType};base64,${imageBase64}`;

    // ── Step 1: GPT-4o vision → hyper-detailed renovation prompt ──
    // GPT-4o CAN see the image — it describes the exact building, then writes
    // a DALL-E prompt that preserves the building's form but applies renovation.
    const promptGeneration = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You are an expert architectural visualization artist. You will receive a photo of an existing building.

Your task: Write a DALL-E 3 image generation prompt that produces a photorealistic render of THIS EXACT SAME BUILDING but COMPLETELY RENOVATED with modern materials and an extension.

CRITICAL RULES:
1. PRESERVE the exact building geometry: same number of floors, same footprint shape, same proportions, same window grid pattern (rows × columns), same roof form.
2. DESCRIBE the building's geometry in extreme detail so DALL-E reproduces the SAME structure: "X-storey rectangular building with Y windows across and Z bays deep, flat/pitched roof, L-shaped/rectangular plan..."
3. ONLY change the surface treatment: replace old/damaged materials with new premium ones.
4. Add a 1-storey contemporary glass rooftop extension.
5. Upgrade the ground floor entrance.
6. Add landscaping around the base.

Your output must be a SINGLE paragraph — the raw DALL-E prompt (no labels, no markdown, no explanation). Start directly with the architectural description.

Include these elements in order:
- Exact building form (floors, proportions, window pattern, plan shape)
- New facade materials (white render + stone + dark metal accents)
- New window systems (same grid, modern aluminum frames, floor-to-ceiling)
- New ground floor (glass entrance, retail/cafe frontage)
- Rooftop extension (glass penthouse, terrace, planters)
- Landscaping (trees, granite pavers, lighting)
- Photographic quality (golden hour, eye-level, V-Ray quality)`,
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            {
              type: "text",
              text: `Here is the building photo. The analysis says: ${buildingAnalysis.slice(0, 500)}\n\nWrite the DALL-E 3 prompt for a renovated version of THIS EXACT building. Preserve its exact geometry and proportions.`,
            },
          ],
        },
      ],
      max_tokens: 1000,
    });

    const renovationPrompt = promptGeneration.choices[0]?.message?.content;
    if (!renovationPrompt) throw new Error("GPT-4o returned empty renovation prompt");

    console.log("[RenovationRender] GPT-4o prompt (first 300 chars):", renovationPrompt.slice(0, 300));

    // ── Step 2: DALL-E 3 renders the renovated building ──
    const response = await client.images.generate({
      model: "dall-e-3",
      prompt: renovationPrompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
      style: "natural",
    });

    const image = response.data?.[0];
    if (!image?.url) throw new Error("No image URL in DALL-E renovation response");

    console.log("[RenovationRender] DALL-E 3 render complete:", image.url.slice(0, 80));

    return {
      url: image.url,
      revisedPrompt: image.revised_prompt ?? renovationPrompt,
      renovationPrompt,
    };
  });
}

// ─── generateFloorPlan (GN-004) ─────────────────────────────────────────────

export interface FloorPlanResult {
  svg: string;
  roomList: Array<{ name: string; area: number; unit: string; floor?: string }>;
  totalArea: number;
  floors: number;
  perFloorRooms?: Array<{ floorLabel: string; rooms: Array<{ name: string; area: number; type: string }> }>;
  positionedRooms?: Array<{ name: string; type: string; x: number; y: number; width: number; depth: number; area: number }>;
}

// ─── Room type detection & colors ───────────────────────────────────────────

interface RoomDef { name: string; area: number; type: string; }

const ROOM_COLORS: Record<string, string> = {
  living: "#E8F5E9", dining: "#E8F5E9", kitchen: "#FFF3E0",
  bedroom: "#E3F2FD", master: "#E3F2FD", bathroom: "#F3E5F5",
  wc: "#F3E5F5", toilet: "#F3E5F5", hallway: "#ECEFF1",
  corridor: "#ECEFF1", foyer: "#ECEFF1", entry: "#ECEFF1",
  office: "#FFF9C4", study: "#FFF9C4", stair: "#E0E0E0",
  balcony: "#F5F5F5", terrace: "#F5F5F5", laundry: "#F3E5F5",
  storage: "#ECEFF1", retail: "#FFEBEE", meeting: "#FFF9C4",
  default: "#F5F5F5",
};

function detectRoomType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("master") || n.includes("main bed")) return "master";
  if (n.includes("bed")) return "bedroom";
  if (n.includes("living") || n.includes("lounge") || n.includes("family")) return "living";
  if (n.includes("dining")) return "dining";
  if (n.includes("kitchen")) return "kitchen";
  if (n.includes("bath") || n.includes("shower")) return "bathroom";
  if (n.includes("wc") || n.includes("toilet") || n.includes("powder")) return "wc";
  if (n.includes("hall") || n.includes("corridor") || n.includes("passage")) return "hallway";
  if (n.includes("foyer") || n.includes("entry") || n.includes("lobby")) return "entry";
  if (n.includes("office") || n.includes("study") || n.includes("work")) return "office";
  if (n.includes("stair")) return "stair";
  if (n.includes("balcon") || n.includes("terrace") || n.includes("deck")) return "balcony";
  if (n.includes("laundry") || n.includes("utility")) return "laundry";
  if (n.includes("storage") || n.includes("closet") || n.includes("pantry")) return "storage";
  if (n.includes("retail") || n.includes("shop")) return "retail";
  if (n.includes("meeting") || n.includes("conference")) return "meeting";
  return "default";
}

function isExteriorRoom(type: string): boolean {
  return ["bedroom", "master", "living", "dining", "office", "kitchen", "study"].includes(type);
}

// ─── Architecture-Aware AI-Positioned Layout ────────────────────────────────

interface PositionedRoom extends RoomDef {
  x: number;       // left edge in meters from building left wall
  y: number;       // top edge in meters from building top wall
  width: number;   // room width in meters (x-axis)
  depth: number;   // room depth in meters (y-axis)
}

interface SharedWall {
  roomA: string;
  roomB: string;
  x1: number; y1: number; x2: number; y2: number;
  orientation: "h" | "v";
  length: number;
}

/** Snap value to 0.1m grid */
function snap(v: number): number { return Math.round(v * 10) / 10; }

/** Validate and fix AI-positioned rooms to fit within footprint */
function validateLayout(rooms: PositionedRoom[], fpW: number, fpH: number): PositionedRoom[] {
  // 1. Snap to grid and enforce minimums
  for (const r of rooms) {
    r.x = snap(Math.max(0, r.x));
    r.y = snap(Math.max(0, r.y));
    r.width = snap(Math.max(1.5, r.width));
    r.depth = snap(Math.max(1.5, r.depth));
  }

  // 2. Clamp to footprint boundary
  for (const r of rooms) {
    if (r.x + r.width > fpW + 0.05) r.width = snap(fpW - r.x);
    if (r.y + r.depth > fpH + 0.05) r.depth = snap(fpH - r.y);
    if (r.width < 1.5) { r.x = snap(Math.max(0, fpW - 1.5)); r.width = snap(fpW - r.x); }
    if (r.depth < 1.5) { r.y = snap(Math.max(0, fpH - 1.5)); r.depth = snap(fpH - r.y); }
    r.area = snap(r.width * r.depth);
  }

  // 3. Resolve overlaps by shrinking the smaller room
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        if (overlapX > 0.15 && overlapY > 0.15) {
          const smaller = a.area <= b.area ? a : b;
          const larger = a.area <= b.area ? b : a;
          if (overlapX <= overlapY) {
            // Nudge horizontally
            if (smaller.x + smaller.width / 2 < larger.x + larger.width / 2) {
              smaller.width = snap(larger.x - smaller.x);
            } else {
              const newX = snap(larger.x + larger.width);
              smaller.width = snap(smaller.width - (newX - smaller.x));
              smaller.x = newX;
            }
          } else {
            // Nudge vertically
            if (smaller.y + smaller.depth / 2 < larger.y + larger.depth / 2) {
              smaller.depth = snap(larger.y - smaller.y);
            } else {
              const newY = snap(larger.y + larger.depth);
              smaller.depth = snap(smaller.depth - (newY - smaller.y));
              smaller.y = newY;
            }
          }
          smaller.width = Math.max(1.0, smaller.width);
          smaller.depth = Math.max(1.0, smaller.depth);
          smaller.area = snap(smaller.width * smaller.depth);
        }
      }
    }
  }

  return rooms;
}

/** Find shared walls between adjacent rooms for door placement */
function findSharedWalls(rooms: PositionedRoom[]): SharedWall[] {
  const walls: SharedWall[] = [];
  const tolerance = 0.25;

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];

      // Vertical shared wall: a's right edge ≈ b's left edge
      if (Math.abs((a.x + a.width) - b.x) < tolerance) {
        const yStart = Math.max(a.y, b.y);
        const yEnd = Math.min(a.y + a.depth, b.y + b.depth);
        if (yEnd - yStart > 0.5) {
          const wx = (a.x + a.width + b.x) / 2;
          walls.push({ roomA: a.name, roomB: b.name, x1: wx, y1: yStart, x2: wx, y2: yEnd, orientation: "v", length: yEnd - yStart });
        }
      }
      // Reverse: b's right edge ≈ a's left edge
      if (Math.abs((b.x + b.width) - a.x) < tolerance) {
        const yStart = Math.max(a.y, b.y);
        const yEnd = Math.min(a.y + a.depth, b.y + b.depth);
        if (yEnd - yStart > 0.5) {
          const wx = (b.x + b.width + a.x) / 2;
          walls.push({ roomA: b.name, roomB: a.name, x1: wx, y1: yStart, x2: wx, y2: yEnd, orientation: "v", length: yEnd - yStart });
        }
      }

      // Horizontal shared wall: a's bottom edge ≈ b's top edge
      if (Math.abs((a.y + a.depth) - b.y) < tolerance) {
        const xStart = Math.max(a.x, b.x);
        const xEnd = Math.min(a.x + a.width, b.x + b.width);
        if (xEnd - xStart > 0.5) {
          const wy = (a.y + a.depth + b.y) / 2;
          walls.push({ roomA: a.name, roomB: b.name, x1: xStart, y1: wy, x2: xEnd, y2: wy, orientation: "h", length: xEnd - xStart });
        }
      }
      // Reverse: b's bottom edge ≈ a's top edge
      if (Math.abs((b.y + b.depth) - a.y) < tolerance) {
        const xStart = Math.max(a.x, b.x);
        const xEnd = Math.min(a.x + a.width, b.x + b.width);
        if (xEnd - xStart > 0.5) {
          const wy = (b.y + b.depth + a.y) / 2;
          walls.push({ roomA: b.name, roomB: a.name, x1: xStart, y1: wy, x2: xEnd, y2: wy, orientation: "h", length: xEnd - xStart });
        }
      }
    }
  }

  // Deduplicate (same wall detected both ways)
  const seen = new Set<string>();
  return walls.filter(w => {
    const key = [w.x1, w.y1, w.x2, w.y2].map(v => v.toFixed(1)).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Draw subtle furniture outlines for a room */
function drawFurniture(roomType: string, rx: number, ry: number, rw: number, rh: number, ppm: number): string[] {
  const parts: string[] = [];
  const style = 'fill="none" stroke="#C0C0C0" stroke-width="0.7"';
  const fillStyle = 'fill="#EBEBEB" stroke="#C0C0C0" stroke-width="0.5"';

  // Convert meters to pixels
  const m = (v: number) => v * ppm;

  // Don't draw furniture in tiny rooms
  if (rw < m(2) || rh < m(2)) return parts;

  const t = roomType.toLowerCase();

  if (t === "bedroom" || t === "master") {
    // Bed centered against top wall
    const bedW = Math.min(m(1.6), rw * 0.55);
    const bedH = Math.min(m(2.0), rh * 0.45);
    const bx = rx + (rw - bedW) / 2;
    const by = ry + rh * 0.1;
    parts.push(`<rect x="${bx}" y="${by}" width="${bedW}" height="${bedH}" ${style} rx="2"/>`);
    // Headboard
    parts.push(`<line x1="${bx}" y1="${by}" x2="${bx + bedW}" y2="${by}" stroke="#B0B0B0" stroke-width="2.5"/>`);
    // Pillows
    const pw = bedW * 0.38, ph = m(0.18);
    parts.push(`<rect x="${bx + 3}" y="${by + 3}" width="${pw}" height="${ph}" ${fillStyle} rx="2"/>`);
    if (bedW > m(1.2)) {
      parts.push(`<rect x="${bx + bedW - pw - 3}" y="${by + 3}" width="${pw}" height="${ph}" ${fillStyle} rx="2"/>`);
    }
    // Nightstand
    const nsW = m(0.35);
    if (bx - rx > nsW + 4) {
      parts.push(`<rect x="${bx - nsW - 3}" y="${by}" width="${nsW}" height="${nsW}" ${style}/>`);
    }
  } else if (t === "living" || t === "lounge" || t === "family") {
    // Sofa against bottom wall
    const sofaW = Math.min(m(2.2), rw * 0.55);
    const sofaH = Math.min(m(0.8), rh * 0.2);
    const sx = rx + (rw - sofaW) / 2;
    const sy = ry + rh * 0.62;
    parts.push(`<rect x="${sx}" y="${sy}" width="${sofaW}" height="${sofaH}" ${style} rx="3"/>`);
    parts.push(`<line x1="${sx}" y1="${sy + sofaH}" x2="${sx + sofaW}" y2="${sy + sofaH}" stroke="#B0B0B0" stroke-width="2"/>`);
    // Coffee table
    const ctW = sofaW * 0.4, ctH = m(0.35);
    parts.push(`<rect x="${sx + (sofaW - ctW) / 2}" y="${sy - ctH - 6}" width="${ctW}" height="${ctH}" ${style}/>`);
    // TV unit against opposite wall
    const tvW = Math.min(m(1.4), rw * 0.38);
    parts.push(`<rect x="${rx + (rw - tvW) / 2}" y="${ry + rh * 0.06}" width="${tvW}" height="${m(0.06)}" fill="#D0D0D0" stroke="#B0B0B0" stroke-width="0.5"/>`);
  } else if (t === "kitchen") {
    // L-shaped counter along top and right walls
    const cD = m(0.6);
    const topCW = rw - 4;
    parts.push(`<rect x="${rx + 2}" y="${ry + 2}" width="${topCW}" height="${cD}" ${fillStyle}/>`);
    // Sink circle
    parts.push(`<circle cx="${rx + topCW * 0.6}" cy="${ry + 2 + cD * 0.5}" r="${m(0.14)}" ${style}/>`);
    // Right counter
    const rightCH = Math.min(rh * 0.45, rh - cD - 8);
    if (rightCH > cD) {
      parts.push(`<rect x="${rx + rw - cD - 2}" y="${ry + cD + 2}" width="${cD}" height="${rightCH}" ${fillStyle}/>`);
    }
    // Stove (4 burners)
    const stoveX = rx + topCW * 0.25;
    const stoveY = ry + 2 + cD * 0.5;
    const br = m(0.07);
    parts.push(`<circle cx="${stoveX}" cy="${stoveY - br}" r="${br}" ${style}/>`);
    parts.push(`<circle cx="${stoveX + br * 2.5}" cy="${stoveY - br}" r="${br}" ${style}/>`);
    parts.push(`<circle cx="${stoveX}" cy="${stoveY + br}" r="${br}" ${style}/>`);
    parts.push(`<circle cx="${stoveX + br * 2.5}" cy="${stoveY + br}" r="${br}" ${style}/>`);
  } else if (t === "dining") {
    // Dining table centered
    const tblW = Math.min(m(1.4), rw * 0.4);
    const tblH = Math.min(m(0.8), rh * 0.3);
    const tx = rx + (rw - tblW) / 2;
    const ty = ry + (rh - tblH) / 2;
    parts.push(`<rect x="${tx}" y="${ty}" width="${tblW}" height="${tblH}" ${style} rx="2"/>`);
    // Chairs (circles)
    const chairR = m(0.15);
    parts.push(`<circle cx="${tx + tblW * 0.25}" cy="${ty - chairR - 2}" r="${chairR}" ${style}/>`);
    parts.push(`<circle cx="${tx + tblW * 0.75}" cy="${ty - chairR - 2}" r="${chairR}" ${style}/>`);
    parts.push(`<circle cx="${tx + tblW * 0.25}" cy="${ty + tblH + chairR + 2}" r="${chairR}" ${style}/>`);
    parts.push(`<circle cx="${tx + tblW * 0.75}" cy="${ty + tblH + chairR + 2}" r="${chairR}" ${style}/>`);
  } else if (t === "bathroom") {
    // Bathtub along top wall
    const tubW = Math.min(m(1.7), rw * 0.7);
    const tubH = Math.min(m(0.7), rh * 0.28);
    parts.push(`<rect x="${rx + 3}" y="${ry + 3}" width="${tubW}" height="${tubH}" ${style} rx="3"/>`);
    parts.push(`<rect x="${rx + 6}" y="${ry + 6}" width="${tubW - 6}" height="${tubH - 6}" fill="none" stroke="#D0D0D0" stroke-width="0.3" rx="2"/>`);
    // Sink
    const sinkR = m(0.16);
    parts.push(`<circle cx="${rx + rw - m(0.35)}" cy="${ry + rh * 0.55}" r="${sinkR}" ${style}/>`);
    // Toilet
    const toiletX = rx + rw - m(0.42);
    const toiletY = ry + rh * 0.73;
    const tw = m(0.36);
    parts.push(`<rect x="${toiletX}" y="${toiletY}" width="${tw}" height="${m(0.16)}" ${style}/>`);
    parts.push(`<ellipse cx="${toiletX + tw / 2}" cy="${toiletY + m(0.16) + m(0.15)}" rx="${tw * 0.42}" ry="${m(0.15)}" ${style}/>`);
  } else if (t === "wc" || t === "toilet") {
    // Toilet + sink only
    const sinkR = m(0.14);
    parts.push(`<circle cx="${rx + rw * 0.65}" cy="${ry + rh * 0.28}" r="${sinkR}" ${style}/>`);
    const toiletX = rx + rw * 0.2;
    const toiletY = ry + rh * 0.45;
    const tw = m(0.34);
    parts.push(`<rect x="${toiletX}" y="${toiletY}" width="${tw}" height="${m(0.14)}" ${style}/>`);
    parts.push(`<ellipse cx="${toiletX + tw / 2}" cy="${toiletY + m(0.14) + m(0.13)}" rx="${tw * 0.4}" ry="${m(0.13)}" ${style}/>`);
  } else if (t === "office" || t === "study") {
    // Desk against top wall
    const deskW = Math.min(m(1.3), rw * 0.5);
    const deskH = m(0.55);
    parts.push(`<rect x="${rx + rw * 0.1}" y="${ry + 3}" width="${deskW}" height="${deskH}" ${style}/>`);
    // Chair
    const chairR = m(0.18);
    parts.push(`<circle cx="${rx + rw * 0.1 + deskW * 0.5}" cy="${ry + 3 + deskH + chairR + 3}" r="${chairR}" ${style}/>`);
  }

  return parts;
}

// ─── Enhanced Architectural SVG Renderer ─────────────────────────────────

function renderArchitecturalSvg(
  rooms: PositionedRoom[],
  sharedWalls: SharedWall[],
  title: string,
  ppm: number,
  fpW: number,
  fpH: number,
  ox: number,
  oy: number,
): string {
  const parts: string[] = [];
  const planW = fpW * ppm;
  const planH = fpH * ppm;

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">`);
  parts.push(`<rect width="800" height="600" fill="#FAFAFA"/>`);

  // Title
  parts.push(`<text x="400" y="26" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#222">${escSvg(title)}</text>`);

  // Room fills
  for (const r of rooms) {
    const rx = ox + r.x * ppm;
    const ry = oy + r.y * ppm;
    const rw = r.width * ppm;
    const rh = r.depth * ppm;
    const color = ROOM_COLORS[r.type] ?? ROOM_COLORS.default;
    parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${color}"/>`);
  }

  // Furniture hints (subtle, drawn under walls)
  for (const r of rooms) {
    const rx = ox + r.x * ppm;
    const ry = oy + r.y * ppm;
    const rw = r.width * ppm;
    const rh = r.depth * ppm;
    parts.push(...drawFurniture(r.type, rx, ry, rw, rh, ppm));
  }

  // Interior walls (shared walls between rooms)
  for (const w of sharedWalls) {
    const x1 = ox + w.x1 * ppm, y1 = oy + w.y1 * ppm;
    const x2 = ox + w.x2 * ppm, y2 = oy + w.y2 * ppm;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#333" stroke-width="2.5"/>`);
  }

  // Exterior wall (thick outline)
  parts.push(`<rect x="${ox}" y="${oy}" width="${planW}" height="${planH}" fill="none" stroke="#222" stroke-width="5"/>`);

  // Doors on shared walls (placed at 1/3 along the wall for realistic look)
  const doorWidthM = 0.8;
  const doorPx = doorWidthM * ppm;
  for (const w of sharedWalls) {
    const doorPos = 0.33;
    if (w.orientation === "v") {
      const dx = ox + w.x1 * ppm;
      const dy = oy + (w.y1 + (w.y2 - w.y1) * doorPos) * ppm;
      // Gap in wall
      parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dy + doorPx}" stroke="${ROOM_COLORS.default}" stroke-width="4"/>`);
      // Door arc
      parts.push(`<path d="M ${dx} ${dy + doorPx} A ${doorPx} ${doorPx} 0 0 1 ${dx + doorPx} ${dy}" fill="none" stroke="#666" stroke-width="0.8"/>`);
      parts.push(`<line x1="${dx}" y1="${dy + doorPx}" x2="${dx + doorPx}" y2="${dy}" stroke="#666" stroke-width="0.5" stroke-dasharray="3 2"/>`);
    } else {
      const dx = ox + (w.x1 + (w.x2 - w.x1) * doorPos) * ppm;
      const dy = oy + w.y1 * ppm;
      parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx + doorPx}" y2="${dy}" stroke="${ROOM_COLORS.default}" stroke-width="4"/>`);
      parts.push(`<path d="M ${dx} ${dy} A ${doorPx} ${doorPx} 0 0 0 ${dx + doorPx} ${dy + doorPx}" fill="none" stroke="#666" stroke-width="0.8"/>`);
      parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx + doorPx}" y2="${dy + doorPx}" stroke="#666" stroke-width="0.5" stroke-dasharray="3 2"/>`);
    }
  }

  // Main entrance door on exterior wall
  const entryRoom = rooms.find(r => ["hallway", "entry", "corridor", "foyer", "entrance"].includes(r.type))
    ?? rooms.find(r => r.type === "living" && Math.abs(r.y + r.depth - fpH) < 0.3)
    ?? rooms.find(r => Math.abs(r.y + r.depth - fpH) < 0.3);
  if (entryRoom) {
    const mainDoorPx = 1.0 * ppm;
    if (Math.abs(entryRoom.y + entryRoom.depth - fpH) < 0.3) {
      // Bottom wall entrance
      const dx = ox + (entryRoom.x + entryRoom.width / 2) * ppm - mainDoorPx / 2;
      const dy = oy + planH;
      parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx + mainDoorPx}" y2="${dy}" stroke="#FAFAFA" stroke-width="6"/>`);
      const half = mainDoorPx / 2;
      parts.push(`<path d="M ${dx + half} ${dy} A ${half} ${half} 0 0 0 ${dx} ${dy - half}" fill="none" stroke="#555" stroke-width="1"/>`);
      parts.push(`<path d="M ${dx + half} ${dy} A ${half} ${half} 0 0 1 ${dx + mainDoorPx} ${dy - half}" fill="none" stroke="#555" stroke-width="1"/>`);
      parts.push(`<text x="${dx + half}" y="${dy + 13}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="6.5" font-weight="bold" fill="#666" letter-spacing="1">ENTRANCE</text>`);
    } else if (Math.abs(entryRoom.x) < 0.3) {
      // Left wall entrance
      const mainDoorPxV = 1.0 * ppm;
      const dy = oy + (entryRoom.y + entryRoom.depth / 2) * ppm - mainDoorPxV / 2;
      const dx = ox;
      parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dy + mainDoorPxV}" stroke="#FAFAFA" stroke-width="6"/>`);
      const half = mainDoorPxV / 2;
      parts.push(`<path d="M ${dx} ${dy + half} A ${half} ${half} 0 0 0 ${dx + half} ${dy}" fill="none" stroke="#555" stroke-width="1"/>`);
      parts.push(`<path d="M ${dx} ${dy + half} A ${half} ${half} 0 0 1 ${dx + half} ${dy + mainDoorPxV}" fill="none" stroke="#555" stroke-width="1"/>`);
    }
  }

  // Windows on exterior walls (multiple windows on long walls)
  for (const r of rooms) {
    if (!isExteriorRoom(r.type)) continue;
    const rx = ox + r.x * ppm;
    const ry = oy + r.y * ppm;
    const rw = r.width * ppm;
    const rh = r.depth * ppm;
    const winLen = Math.min(1.2 * ppm, Math.min(rw, rh) * 0.3);
    const winThick = 4;

    // Left exterior wall
    if (r.x < 0.1) {
      const numW = Math.max(1, Math.floor(r.depth / 2.5));
      for (let wi = 0; wi < numW; wi++) {
        const wy = ry + (rh / (numW + 1)) * (wi + 1) - winLen / 2;
        parts.push(`<rect x="${rx - 1}" y="${wy}" width="${winThick}" height="${winLen}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        parts.push(`<line x1="${rx + 1}" y1="${wy + 2}" x2="${rx + 1}" y2="${wy + winLen - 2}" stroke="#4FC3F7" stroke-width="0.5"/>`);
      }
    }
    // Right exterior wall
    if (Math.abs(r.x + r.width - fpW) < 0.1) {
      const numW = Math.max(1, Math.floor(r.depth / 2.5));
      for (let wi = 0; wi < numW; wi++) {
        const wy = ry + (rh / (numW + 1)) * (wi + 1) - winLen / 2;
        parts.push(`<rect x="${rx + rw - winThick + 1}" y="${wy}" width="${winThick}" height="${winLen}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        parts.push(`<line x1="${rx + rw - 1}" y1="${wy + 2}" x2="${rx + rw - 1}" y2="${wy + winLen - 2}" stroke="#4FC3F7" stroke-width="0.5"/>`);
      }
    }
    // Top exterior wall
    if (r.y < 0.1) {
      const numW = Math.max(1, Math.floor(r.width / 2.5));
      for (let wi = 0; wi < numW; wi++) {
        const wx = rx + (rw / (numW + 1)) * (wi + 1) - winLen / 2;
        parts.push(`<rect x="${wx}" y="${ry - 1}" width="${winLen}" height="${winThick}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        parts.push(`<line x1="${wx + 2}" y1="${ry + 1}" x2="${wx + winLen - 2}" y2="${ry + 1}" stroke="#4FC3F7" stroke-width="0.5"/>`);
      }
    }
    // Bottom exterior wall
    if (Math.abs(r.y + r.depth - fpH) < 0.1) {
      const numW = Math.max(1, Math.floor(r.width / 2.5));
      for (let wi = 0; wi < numW; wi++) {
        const wx = rx + (rw / (numW + 1)) * (wi + 1) - winLen / 2;
        parts.push(`<rect x="${wx}" y="${ry + rh - winThick + 1}" width="${winLen}" height="${winThick}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        parts.push(`<line x1="${wx + 2}" y1="${ry + rh - 1}" x2="${wx + winLen - 2}" y2="${ry + rh - 1}" stroke="#4FC3F7" stroke-width="0.5"/>`);
      }
    }
  }

  // Room labels (drawn on top of everything)
  for (const r of rooms) {
    const rx = ox + r.x * ppm;
    const ry = oy + r.y * ppm;
    const rw = r.width * ppm;
    const rh = r.depth * ppm;
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const fontSize = Math.min(11, Math.max(7, Math.min(rw, rh) / 6));

    // Semi-transparent background for label readability
    const labelBgH = fontSize * 3 + 4;
    const labelBgW = Math.min(rw * 0.85, 80);
    parts.push(`<rect x="${cx - labelBgW / 2}" y="${cy - fontSize - 4}" width="${labelBgW}" height="${labelBgH}" fill="white" fill-opacity="0.6" rx="2"/>`);

    // Room name
    parts.push(`<text x="${cx}" y="${cy - 1}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="600" fill="#333">${escSvg(r.name)}</text>`);
    // Dimensions
    parts.push(`<text x="${cx}" y="${cy + fontSize}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(6, fontSize - 2)}" fill="#777">${r.width.toFixed(1)}m × ${r.depth.toFixed(1)}m</text>`);
    // Area
    parts.push(`<text x="${cx}" y="${cy + fontSize * 2}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(6, fontSize - 2)}" fill="#999">${r.area.toFixed(1)} m²</text>`);

    // Stair treads for staircase rooms
    if (r.type === "stair") {
      const steps = Math.max(4, Math.floor(rh / 6));
      for (let s = 0; s < steps; s++) {
        const sy = ry + (s + 0.5) * (rh / steps);
        parts.push(`<line x1="${rx + 3}" y1="${sy}" x2="${rx + rw - 3}" y2="${sy}" stroke="#BBB" stroke-width="0.5"/>`);
      }
      const arrowX = rx + rw / 2;
      parts.push(`<line x1="${arrowX}" y1="${ry + rh - 6}" x2="${arrowX}" y2="${ry + 6}" stroke="#999" stroke-width="0.8"/>`);
      parts.push(`<polygon points="${arrowX},${ry + 6} ${arrowX - 2.5},${ry + 10} ${arrowX + 2.5},${ry + 10}" fill="#999"/>`);
    }
  }

  // Outer dimension lines
  const dimOff = 18;
  const dimFS = 8;

  // Bottom: total width
  const dimY = oy + planH + dimOff;
  parts.push(`<line x1="${ox}" y1="${dimY}" x2="${ox + planW}" y2="${dimY}" stroke="#666" stroke-width="0.8"/>`);
  parts.push(`<line x1="${ox}" y1="${dimY - 4}" x2="${ox}" y2="${dimY + 4}" stroke="#666" stroke-width="0.8"/>`);
  parts.push(`<line x1="${ox + planW}" y1="${dimY - 4}" x2="${ox + planW}" y2="${dimY + 4}" stroke="#666" stroke-width="0.8"/>`);
  parts.push(`<text x="${ox + planW / 2}" y="${dimY + 12}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${dimFS}" fill="#555">${fpW.toFixed(1)} m</text>`);

  // Left: total depth
  const dimX = ox - dimOff;
  parts.push(`<line x1="${dimX}" y1="${oy}" x2="${dimX}" y2="${oy + planH}" stroke="#666" stroke-width="0.8"/>`);
  parts.push(`<line x1="${dimX - 4}" y1="${oy}" x2="${dimX + 4}" y2="${oy}" stroke="#666" stroke-width="0.8"/>`);
  parts.push(`<line x1="${dimX - 4}" y1="${oy + planH}" x2="${dimX + 4}" y2="${oy + planH}" stroke="#666" stroke-width="0.8"/>`);
  parts.push(`<text x="${dimX}" y="${oy + planH / 2}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${dimFS}" fill="#555" transform="rotate(-90 ${dimX} ${oy + planH / 2})">${fpH.toFixed(1)} m</text>`);

  // North arrow with circle
  const nx = 755, ny = 55;
  parts.push(`<circle cx="${nx}" cy="${ny}" r="12" fill="none" stroke="#444" stroke-width="1"/>`);
  parts.push(`<polygon points="${nx},${ny - 10} ${nx - 4},${ny + 2} ${nx + 4},${ny + 2}" fill="#333"/>`);
  parts.push(`<text x="${nx}" y="${ny + 22}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9" font-weight="bold" fill="#333">N</text>`);

  // Scale bar
  const sbY = 583, sbX = 300;
  const metersToDraw = Math.min(10, Math.ceil(planW / ppm));
  const sbLen = metersToDraw * ppm;
  parts.push(`<line x1="${sbX}" y1="${sbY}" x2="${sbX + sbLen}" y2="${sbY}" stroke="#333" stroke-width="1.5"/>`);
  for (let mi = 0; mi <= metersToDraw; mi++) {
    const tx = sbX + mi * ppm;
    const tickH = mi % 2 === 0 ? 5 : 3;
    parts.push(`<line x1="${tx}" y1="${sbY - tickH}" x2="${tx}" y2="${sbY + tickH}" stroke="#333" stroke-width="0.8"/>`);
    if (mi % 2 === 0) {
      parts.push(`<text x="${tx}" y="${sbY + 13}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="7" fill="#666">${mi}</text>`);
    }
  }
  parts.push(`<text x="${sbX + sbLen + 8}" y="${sbY + 4}" font-family="Arial, Helvetica, sans-serif" font-size="7" fill="#666">m</text>`);

  // Area summary
  const totalArea = rooms.reduce((s, r) => s + (r.area ?? 0), 0);
  parts.push(`<text x="400" y="${sbY - 6}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="8" fill="#888">Total Area: ${Math.round(totalArea)} m² — ${rooms.length} rooms</text>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ─── Squarified Treemap Layout (fallback) ───────────────────────────────

interface LayoutRect { x: number; y: number; w: number; h: number; room: RoomDef; }

function layoutTreemap(rooms: RoomDef[], x: number, y: number, w: number, h: number): LayoutRect[] {
  if (rooms.length === 0) return [];
  if (rooms.length === 1) {
    return [{ x, y, w, h, room: rooms[0] }];
  }

  const totalArea = rooms.reduce((s, r) => s + r.area, 0);
  const sorted = [...rooms].sort((a, b) => b.area - a.area);

  // Split into two groups for best aspect ratio
  let bestSplit = 1;
  let bestRatio = Infinity;
  let sumA = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    sumA += sorted[i].area;
    const sumB = totalArea - sumA;
    const ratioA = sumA / totalArea;

    // Calculate aspect ratio of the split
    const isHorizontalSplit = w >= h;
    let aspect: number;
    if (isHorizontalSplit) {
      const wA = w * ratioA;
      const wB = w - wA;
      aspect = Math.max(wA / h, h / wA) + Math.max(wB / h, h / wB);
    } else {
      const hA = h * ratioA;
      const hB = h - hA;
      aspect = Math.max(w / hA, hA / w) + Math.max(w / hB, hB / w);
    }

    if (aspect < bestRatio) {
      bestRatio = aspect;
      bestSplit = i + 1;
    }
  }

  const groupA = sorted.slice(0, bestSplit);
  const groupB = sorted.slice(bestSplit);
  const areaA = groupA.reduce((s, r) => s + r.area, 0);
  const ratio = areaA / totalArea;

  if (w >= h) {
    // Split vertically
    const wA = w * ratio;
    return [
      ...layoutTreemap(groupA, x, y, wA, h),
      ...layoutTreemap(groupB, x + wA, y, w - wA, h),
    ];
  } else {
    // Split horizontally
    const hA = h * ratio;
    return [
      ...layoutTreemap(groupA, x, y, w, hA),
      ...layoutTreemap(groupB, x, y + hA, w, h - hA),
    ];
  }
}

// ─── SVG Renderer ───────────────────────────────────────────────────────────

function renderFloorPlanSvg(
  rects: LayoutRect[],
  title: string,
  pxPerMeter: number,
  planW: number,
  planH: number,
  ox: number,
  oy: number,
): string {
  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">`);
  parts.push(`<rect width="800" height="600" fill="white"/>`);

  // Title
  parts.push(`<text x="400" y="28" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="bold" fill="#222">${escSvg(title)}</text>`);

  // Building outline (thick exterior wall)
  parts.push(`<rect x="${ox}" y="${oy}" width="${planW}" height="${planH}" fill="none" stroke="#222" stroke-width="4"/>`);

  // Room fills + labels + interior walls
  for (const r of rects) {
    const color = ROOM_COLORS[r.room.type] ?? ROOM_COLORS.default;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const roomWidthM = r.w / pxPerMeter;
    const roomHeightM = r.h / pxPerMeter;

    // Room fill
    parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${color}" stroke="#444" stroke-width="1.5"/>`);

    // Room label (name + area)
    const fontSize = Math.min(12, Math.max(8, Math.min(r.w, r.h) / 5));
    parts.push(`<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="600" fill="#333">${escSvg(r.room.name)}</text>`);
    parts.push(`<text x="${cx}" y="${cy + fontSize}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(7, fontSize - 2)}" fill="#666">${r.room.area} m²</text>`);

    // Dimension annotations (width × height in meters along edges)
    if (r.w > 50 && r.h > 40) {
      parts.push(`<text x="${cx}" y="${r.y + 10}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="7" fill="#999">${roomWidthM.toFixed(1)}m</text>`);
      parts.push(`<text x="${r.x + 8}" y="${cy}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="7" fill="#999" transform="rotate(-90 ${r.x + 8} ${cy})">${roomHeightM.toFixed(1)}m</text>`);
    }

    // Door arc — place on the longest wall that is shared with another room
    const doorR = Math.min(18, Math.min(r.w, r.h) * 0.3);
    const isOnLeft = Math.abs(r.x - ox) < 2;
    const isOnTop = Math.abs(r.y - oy) < 2;
    // Door on bottom wall (default), or top if room is at bottom edge
    const isOnBottom = Math.abs((r.y + r.h) - (oy + planH)) < 2;

    if (r.room.type !== "balcony" && r.room.type !== "terrace") {
      let dx: number, dy: number, sweep: string;
      if (!isOnBottom && r.h > 30) {
        // Door on bottom wall
        dx = r.x + 12;
        dy = r.y + r.h;
        // Gap in wall
        parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx + doorR}" y2="${dy}" stroke="white" stroke-width="3"/>`);
        // Arc
        parts.push(`<path d="M ${dx} ${dy} A ${doorR} ${doorR} 0 0 1 ${dx + doorR} ${dy - doorR}" fill="none" stroke="#555" stroke-width="1"/>`);
        // Swing line
        parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dy - doorR}" stroke="#555" stroke-width="0.5" stroke-dasharray="3 2"/>`);
      } else if (!isOnTop && r.h > 30) {
        // Door on top wall
        dx = r.x + 12;
        dy = r.y;
        parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx + doorR}" y2="${dy}" stroke="white" stroke-width="3"/>`);
        parts.push(`<path d="M ${dx} ${dy} A ${doorR} ${doorR} 0 0 0 ${dx + doorR} ${dy + doorR}" fill="none" stroke="#555" stroke-width="1"/>`);
        parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dy + doorR}" stroke="#555" stroke-width="0.5" stroke-dasharray="3 2"/>`);
      } else if (!isOnLeft && r.w > 30) {
        // Door on left wall
        dx = r.x;
        dy = r.y + 12;
        parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dy + doorR}" stroke="white" stroke-width="3"/>`);
        parts.push(`<path d="M ${dx} ${dy} A ${doorR} ${doorR} 0 0 0 ${dx + doorR} ${dy + doorR}" fill="none" stroke="#555" stroke-width="1"/>`);
        parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx + doorR}" y2="${dy}" stroke="#555" stroke-width="0.5" stroke-dasharray="3 2"/>`);
      }
    }

    // Windows on exterior walls (for habitable rooms)
    if (isExteriorRoom(r.room.type)) {
      const winW = Math.min(r.w * 0.4, 30);
      const winH = 4;
      // Check which edges are on the building perimeter and add window there
      if (Math.abs(r.x - ox) < 2) {
        // Left exterior wall
        const wy = r.y + r.h / 2 - winW / 2;
        parts.push(`<rect x="${r.x - 1}" y="${wy}" width="${winH}" height="${winW}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        parts.push(`<line x1="${r.x + 1}" y1="${wy}" x2="${r.x + 1}" y2="${wy + winW}" stroke="#4FC3F7" stroke-width="0.5"/>`);
      }
      if (Math.abs((r.x + r.w) - (ox + planW)) < 2) {
        // Right exterior wall
        const wy = r.y + r.h / 2 - winW / 2;
        parts.push(`<rect x="${r.x + r.w - winH + 1}" y="${wy}" width="${winH}" height="${winW}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        parts.push(`<line x1="${r.x + r.w - 1}" y1="${wy}" x2="${r.x + r.w - 1}" y2="${wy + winW}" stroke="#4FC3F7" stroke-width="0.5"/>`);
      }
      if (Math.abs(r.y - oy) < 2) {
        // Top exterior wall
        const wx = r.x + r.w / 2 - winW / 2;
        parts.push(`<rect x="${wx}" y="${r.y - 1}" width="${winW}" height="${winH}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        parts.push(`<line x1="${wx}" y1="${r.y + 1}" x2="${wx + winW}" y2="${r.y + 1}" stroke="#4FC3F7" stroke-width="0.5"/>`);
      }
      if (Math.abs((r.y + r.h) - (oy + planH)) < 2) {
        // Bottom exterior wall
        const wx = r.x + r.w / 2 - winW / 2;
        parts.push(`<rect x="${wx}" y="${r.y + r.h - winH + 1}" width="${winW}" height="${winH}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        parts.push(`<line x1="${wx}" y1="${r.y + r.h - 1}" x2="${wx + winW}" y2="${r.y + r.h - 1}" stroke="#4FC3F7" stroke-width="0.5"/>`);
      }
    }
  }

  // Re-draw building outline on top so it's crisp
  parts.push(`<rect x="${ox}" y="${oy}" width="${planW}" height="${planH}" fill="none" stroke="#222" stroke-width="4"/>`);

  // North arrow (top-right)
  const nx = 760, ny = 55;
  parts.push(`<polygon points="${nx},${ny - 18} ${nx - 6},${ny} ${nx + 6},${ny}" fill="#333"/>`);
  parts.push(`<text x="${nx}" y="${ny + 12}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#333">N</text>`);

  // Scale bar (bottom-center)
  const sbY = 580;
  const sbX = 300;
  const metersToDraw = Math.min(10, Math.ceil(planW / pxPerMeter));
  const sbLen = metersToDraw * pxPerMeter;
  parts.push(`<line x1="${sbX}" y1="${sbY}" x2="${sbX + sbLen}" y2="${sbY}" stroke="#333" stroke-width="1.5"/>`);
  for (let m = 0; m <= metersToDraw; m += 2) {
    const tx = sbX + m * pxPerMeter;
    parts.push(`<line x1="${tx}" y1="${sbY - 4}" x2="${tx}" y2="${sbY + 4}" stroke="#333" stroke-width="1"/>`);
    parts.push(`<text x="${tx}" y="${sbY + 14}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="8" fill="#666">${m}</text>`);
  }
  parts.push(`<text x="${sbX + sbLen + 8}" y="${sbY + 4}" font-family="Arial, Helvetica, sans-serif" font-size="8" fill="#666">m</text>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

function escSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Multi-floor SVG Renderer ────────────────────────────────────────────

function renderMultiFloorSvg(
  floorLayouts: Array<{ label: string; rooms: RoomDef[]; rects: LayoutRect[] }>,
  title: string,
  pxPerMeter: number,
  planW: number,
  planH: number,
  svgW: number,
  svgH: number,
  margin: number,
  gap: number,
): string {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}">`);
  parts.push(`<rect width="${svgW}" height="${svgH}" fill="white"/>`);

  // Title
  parts.push(`<text x="${svgW / 2}" y="24" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="bold" fill="#222">${escSvg(title)}</text>`);

  // Layout floors in a grid: up to 2 per row
  const floorsPerRow = Math.min(floorLayouts.length, 2);
  const floorSlotW = (svgW - margin * 2 - gap * (floorsPerRow - 1)) / floorsPerRow;

  for (let fi = 0; fi < floorLayouts.length; fi++) {
    const floor = floorLayouts[fi];
    const col = fi % floorsPerRow;
    const row = Math.floor(fi / floorsPerRow);

    // Offset for this floor
    const ox = margin + col * (floorSlotW + gap) + (floorSlotW - planW) / 2;
    const oy = 45 + row * (planH + 70) + 20;

    // Floor label
    parts.push(`<text x="${ox + planW / 2}" y="${oy - 6}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#444">${escSvg(floor.label)}</text>`);

    // Building outline (thick exterior wall)
    parts.push(`<rect x="${ox}" y="${oy}" width="${planW}" height="${planH}" fill="none" stroke="#222" stroke-width="4"/>`);

    // Room fills + labels + interior walls
    for (const r of floor.rects) {
      const rx = r.x + ox;
      const ry = r.y + oy;
      const color = ROOM_COLORS[r.room.type] ?? ROOM_COLORS.default;
      const cx = rx + r.w / 2;
      const cy = ry + r.h / 2;
      const roomWidthM = r.w / pxPerMeter;
      const roomHeightM = r.h / pxPerMeter;

      // Room fill
      parts.push(`<rect x="${rx}" y="${ry}" width="${r.w}" height="${r.h}" fill="${color}" stroke="#444" stroke-width="1.5"/>`);

      // Room label (name + area)
      const fontSize = Math.min(11, Math.max(7, Math.min(r.w, r.h) / 5));
      parts.push(`<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="600" fill="#333">${escSvg(r.room.name)}</text>`);
      parts.push(`<text x="${cx}" y="${cy + fontSize}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(6, fontSize - 2)}" fill="#666">${r.room.area} m²</text>`);

      // Dimension annotations
      if (r.w > 40 && r.h > 35) {
        parts.push(`<text x="${cx}" y="${ry + 9}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="6" fill="#999">${roomWidthM.toFixed(1)}m</text>`);
        parts.push(`<text x="${rx + 7}" y="${cy}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="6" fill="#999" transform="rotate(-90 ${rx + 7} ${cy})">${roomHeightM.toFixed(1)}m</text>`);
      }

      // Door arc
      const doorR = Math.min(15, Math.min(r.w, r.h) * 0.25);
      const isOnLeft = Math.abs(r.x) < 2;
      const isOnBottom = Math.abs((r.y + r.h) - planH) < 2;
      const isOnTop = Math.abs(r.y) < 2;

      if (r.room.type !== "balcony" && r.room.type !== "terrace") {
        if (!isOnBottom && r.h > 25) {
          const dx = rx + 10;
          const dy = ry + r.h;
          parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx + doorR}" y2="${dy}" stroke="white" stroke-width="3"/>`);
          parts.push(`<path d="M ${dx} ${dy} A ${doorR} ${doorR} 0 0 1 ${dx + doorR} ${dy - doorR}" fill="none" stroke="#555" stroke-width="1"/>`);
        } else if (!isOnTop && r.h > 25) {
          const dx = rx + 10;
          const dy = ry;
          parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx + doorR}" y2="${dy}" stroke="white" stroke-width="3"/>`);
          parts.push(`<path d="M ${dx} ${dy} A ${doorR} ${doorR} 0 0 0 ${dx + doorR} ${dy + doorR}" fill="none" stroke="#555" stroke-width="1"/>`);
        } else if (!isOnLeft && r.w > 25) {
          const dx = rx;
          const dy = ry + 10;
          parts.push(`<line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dy + doorR}" stroke="white" stroke-width="3"/>`);
          parts.push(`<path d="M ${dx} ${dy} A ${doorR} ${doorR} 0 0 0 ${dx + doorR} ${dy + doorR}" fill="none" stroke="#555" stroke-width="1"/>`);
        }
      }

      // Windows on exterior walls (for habitable rooms)
      if (isExteriorRoom(r.room.type)) {
        const winW = Math.min(r.w * 0.35, 24);
        const winH = 3;
        if (Math.abs(r.x) < 2) {
          const wy = ry + r.h / 2 - winW / 2;
          parts.push(`<rect x="${rx - 1}" y="${wy}" width="${winH}" height="${winW}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        }
        if (Math.abs((r.x + r.w) - planW) < 2) {
          const wy = ry + r.h / 2 - winW / 2;
          parts.push(`<rect x="${rx + r.w - winH + 1}" y="${wy}" width="${winH}" height="${winW}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        }
        if (Math.abs(r.y) < 2) {
          const wx = rx + r.w / 2 - winW / 2;
          parts.push(`<rect x="${wx}" y="${ry - 1}" width="${winW}" height="${winH}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        }
        if (Math.abs((r.y + r.h) - planH) < 2) {
          const wx = rx + r.w / 2 - winW / 2;
          parts.push(`<rect x="${wx}" y="${ry + r.h - winH + 1}" width="${winW}" height="${winH}" fill="#B3E5FC" stroke="#81D4FA" stroke-width="0.5"/>`);
        }
      }

      // Stair indicator (diagonal lines for staircase rooms)
      if (r.room.type === "stair") {
        const steps = Math.floor(r.h / 6);
        for (let s = 0; s < Math.max(steps, 4); s++) {
          const sy = ry + (s + 0.5) * (r.h / Math.max(steps, 4));
          parts.push(`<line x1="${rx + 2}" y1="${sy}" x2="${rx + r.w - 2}" y2="${sy}" stroke="#999" stroke-width="0.5"/>`);
        }
        // Arrow indicating up direction
        const arrowX = rx + r.w / 2;
        const arrowY1 = ry + r.h - 8;
        const arrowY2 = ry + 8;
        parts.push(`<line x1="${arrowX}" y1="${arrowY1}" x2="${arrowX}" y2="${arrowY2}" stroke="#666" stroke-width="1"/>`);
        parts.push(`<polygon points="${arrowX},${arrowY2} ${arrowX - 3},${arrowY2 + 5} ${arrowX + 3},${arrowY2 + 5}" fill="#666"/>`);
      }
    }

    // Re-draw building outline on top
    parts.push(`<rect x="${ox}" y="${oy}" width="${planW}" height="${planH}" fill="none" stroke="#222" stroke-width="4"/>`);

    // Area summary under each floor
    const totalFloorArea = floor.rooms.reduce((s, r) => s + r.area, 0);
    parts.push(`<text x="${ox + planW / 2}" y="${oy + planH + 14}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="8" fill="#888">Total: ${Math.round(totalFloorArea)} m² — ${floor.rooms.length} rooms</text>`);
  }

  // North arrow (top-right)
  const nx = svgW - 30, ny = 45;
  parts.push(`<polygon points="${nx},${ny - 14} ${nx - 5},${ny} ${nx + 5},${ny}" fill="#333"/>`);
  parts.push(`<text x="${nx}" y="${ny + 10}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="bold" fill="#333">N</text>`);

  // Scale bar (bottom-center)
  const sbY = svgH - 15;
  const sbX = svgW / 2 - 60;
  const metersToDraw = Math.min(8, Math.ceil(planW / pxPerMeter));
  const sbLen = metersToDraw * pxPerMeter;
  parts.push(`<line x1="${sbX}" y1="${sbY}" x2="${sbX + sbLen}" y2="${sbY}" stroke="#333" stroke-width="1.5"/>`);
  for (let m = 0; m <= metersToDraw; m += 2) {
    const tx = sbX + m * pxPerMeter;
    parts.push(`<line x1="${tx}" y1="${sbY - 3}" x2="${tx}" y2="${sbY + 3}" stroke="#333" stroke-width="1"/>`);
    parts.push(`<text x="${tx}" y="${sbY + 12}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="7" fill="#666">${m}</text>`);
  }
  parts.push(`<text x="${sbX + sbLen + 6}" y="${sbY + 3}" font-family="Arial, Helvetica, sans-serif" font-size="7" fill="#666">m</text>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ─── Detect if user prompt describes per-floor room requirements ─────────

function hasPerFloorRequirements(d: Partial<BuildingDescription>): boolean {
  // Check if program entries have floor assignments
  if (d.program && Array.isArray(d.program) && d.program.length > 0) {
    const withFloors = d.program.filter(p => p.floor && p.floor.trim().length > 0);
    if (withFloors.length >= 2) {
      const uniqueFloors = new Set(withFloors.map(p => p.floor!.toLowerCase()));
      if (uniqueFloors.size >= 2) return true;
    }
  }
  // Check programSummary or narrative for per-floor descriptions
  const text = `${d.programSummary ?? ""} ${d.narrative ?? ""}`.toLowerCase();
  if ((text.includes("ground floor") || text.includes("first floor") || text.includes("upper floor") || text.includes("second floor"))
    && (text.includes("bedroom") || text.includes("kitchen") || text.includes("hall") || text.includes("living"))) {
    return true;
  }
  return false;
}

// ─── Main generateFloorPlan function ────────────────────────────────────────

export async function generateFloorPlan(
  description: BuildingDescription | Record<string, unknown>,
  userApiKey?: string
): Promise<FloorPlanResult> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    const d = description as Partial<BuildingDescription>;
    const floors = d.floors ?? 2;
    const totalArea = d.totalArea ?? 2500;
    const typology = d.buildingType ?? "Residential";
    const floorPlate = Math.round(totalArea / floors);

    // Build detailed program from structured data if available
    let programDetail: string;
    if (d.program && Array.isArray(d.program) && d.program.length > 0) {
      programDetail = d.program
        .map((p) => `${p.space}${p.area_m2 ? ` (${p.area_m2} m²)` : ""}${p.floor ? ` [${p.floor}]` : ""}`)
        .join(", ");
    } else {
      programDetail = d.programSummary ?? "residential rooms";
    }

    // Also capture the original user prompt/narrative for better context
    const narrativeContext = d.narrative ?? "";
    const programSummaryContext = d.programSummary ?? "";

    // ── Detect multi-floor building with distinct per-floor layouts ──
    const isMultiFloor = floors >= 2 && hasPerFloorRequirements(d);

    if (isMultiFloor) {
      return generateMultiFloorPlan(client, d, floors, totalArea, typology, programDetail, narrativeContext, programSummaryContext);
    }

    // ── Single floor plan generation ────────────────────────────────

    // ── Calculate footprint dimensions ──────────────────────────────
    const aspect = 1.33;
    const fpWidthM = snap(Math.sqrt(floorPlate * aspect));
    const fpHeightM = snap(floorPlate / fpWidthM);

    // ── Step 1: Ask AI for positioned room layout ──────────────────
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert residential architect creating a precise, dimensioned floor plan layout.
Given a building brief, generate rooms with EXACT positions and dimensions in meters.

COORDINATE SYSTEM:
- Origin (0,0) is the top-left corner of the building
- x increases to the right, y increases downward
- Each room: x (left edge), y (top edge), width (x-axis), depth (y-axis)

CRITICAL LAYOUT RULES:
1. ALL rooms MUST tile PERFECTLY within the footprint rectangle — NO gaps, NO overlaps
2. Room edges MUST align. If two rooms share a wall, their coordinates must match exactly
3. Every point inside the footprint must belong to exactly one room. Think of it as partitioning a rectangle into smaller rectangles
4. Room width:depth ratio must be between 0.5 and 2.5 (no extremely skinny rooms)
5. Sum of all room areas must equal footprint width × depth

ARCHITECTURAL DESIGN RULES:
6. ZONING: Living/dining/kitchen near the entrance (bottom of plan, higher y values). Bedrooms toward the top (lower y, away from noise)
7. ADJACENCY: Kitchen adjacent to dining. Master bedroom near master bath. Wet rooms (bath, WC, kitchen) should share walls for plumbing
8. CIRCULATION: If there's a hallway/corridor, it should connect public and private zones
9. NATURAL LIGHT: Bedrooms, living room, office, and kitchen MUST have at least one exterior wall (edge of footprint)
10. SERVICE ROOMS: Bathrooms, WC, laundry, and storage CAN be interior rooms
11. Entrance/hallway should be near the bottom of the plan (high y values) to create a front-to-back flow

ROOM TYPES: living, dining, kitchen, bedroom, master, bathroom, wc, hallway, corridor, entry, office, study, stair, balcony, laundry, storage, retail, meeting

MINIMUM AREAS: bedroom ≥ 10m², living/hall ≥ 15m², kitchen ≥ 7m², bathroom ≥ 4m², wc ≥ 2.5m², stair ≥ 4m²

CRITICAL: Follow the user's room requirements EXACTLY. Do NOT add rooms they didn't ask for. Do NOT rename rooms.
Use type "wc" for toilet, "bathroom" for bathroom/shower, "living" for hall/living/drawing room.

RESPOND WITH JSON:
{
  "rooms": [
    { "name": "Living Room", "type": "living", "x": 0, "y": 0, "width": 5.0, "depth": 4.2, "area": 21.0 },
    { "name": "Kitchen", "type": "kitchen", "x": 5.0, "y": 0, "width": 3.5, "depth": 2.8, "area": 9.8 }
  ],
  "title": "Residential Floor Plan"
}`,
        },
        {
          role: "user",
          content: `Design a floor plan for: ${typology}
Building footprint: ${fpWidthM}m × ${fpHeightM}m = ${floorPlate} m²
Program requirements: ${programDetail}
${narrativeContext ? `\nDescription: ${narrativeContext.substring(0, 500)}` : ""}
${programSummaryContext ? `\nSummary: ${programSummaryContext}` : ""}

IMPORTANT:
- Rooms MUST perfectly tile the ${fpWidthM}m × ${fpHeightM}m rectangle with NO gaps and NO overlaps
- x + width ≤ ${fpWidthM} and y + depth ≤ ${fpHeightM} for ALL rooms
- Follow the room list EXACTLY — no extra rooms, no renamed rooms
- Room areas MUST sum to approximately ${floorPlate} m²`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response for floor plan");

    const aiResult = JSON.parse(content) as {
      rooms: Array<{ name: string; area: number; type?: string; x?: number; y?: number; width?: number; depth?: number }>;
      title?: string;
    };

    if (!aiResult.rooms || aiResult.rooms.length === 0) {
      throw new Error("AI returned no rooms for floor plan");
    }

    const title = aiResult.title ?? `${typology} — Floor Plan`;

    // ── Check if AI returned positioned rooms ──────────────────────
    const hasPositions = aiResult.rooms.every(r =>
      typeof r.x === "number" && typeof r.y === "number" &&
      typeof r.width === "number" && typeof r.depth === "number"
    );

    const margin = 50;
    const drawW = 700;
    const drawH = 490;
    const pxPerMeter = Math.min(drawW / fpWidthM, drawH / fpHeightM);
    const planW = fpWidthM * pxPerMeter;
    const planH = fpHeightM * pxPerMeter;
    const ox = margin + (drawW - planW) / 2;
    const oy = margin + (drawH - planH) / 2;

    if (hasPositions) {
      // ── AI-positioned architectural layout ──────────────────────
      let posRooms: PositionedRoom[] = aiResult.rooms.map(r => ({
        name: r.name,
        area: r.area ?? snap(r.width! * r.depth!),
        type: r.type ?? detectRoomType(r.name),
        x: r.x!,
        y: r.y!,
        width: r.width!,
        depth: r.depth!,
      }));

      // Validate and fix the layout
      posRooms = validateLayout(posRooms, fpWidthM, fpHeightM);

      // Find shared walls for door placement
      const sharedWalls = findSharedWalls(posRooms);

      // Render enhanced architectural SVG
      const svg = renderArchitecturalSvg(posRooms, sharedWalls, title, pxPerMeter, fpWidthM, fpHeightM, ox, oy);

      const roomList = posRooms.map(r => ({ name: r.name, area: snap(r.width * r.depth), unit: "m²" }));

      return {
        svg, roomList, totalArea, floors,
        positionedRooms: posRooms.map(r => ({
          name: r.name, type: r.type, x: r.x, y: r.y,
          width: r.width, depth: r.depth, area: snap(r.width * r.depth),
        })),
      };
    }

    // ── Fallback: treemap layout (AI didn't return positions) ──────
    const rooms: RoomDef[] = aiResult.rooms.map(r => ({
      name: r.name,
      area: r.area,
      type: r.type ?? detectRoomType(r.name),
    }));

    const roomAreaSum = rooms.reduce((s, r) => s + r.area, 0);
    if (roomAreaSum > 0 && Math.abs(roomAreaSum - floorPlate) > floorPlate * 0.05) {
      const scale = floorPlate / roomAreaSum;
      for (const room of rooms) {
        room.area = Math.round(room.area * scale * 10) / 10;
      }
    }

    const rects = layoutTreemap(rooms, ox, oy, planW, planH);
    const svg = renderFloorPlanSvg(rects, title, pxPerMeter, planW, planH, ox, oy);
    const roomList = rooms.map(r => ({ name: r.name, area: r.area, unit: "m²" }));

    return { svg, roomList, totalArea, floors };
  });
}

// ─── Multi-floor plan generation ────────────────────────────────────────────

async function generateMultiFloorPlan(
  client: ReturnType<typeof getClient>,
  d: Partial<BuildingDescription>,
  floors: number,
  totalArea: number,
  typology: string,
  programDetail: string,
  narrativeContext: string,
  programSummaryContext: string,
): Promise<FloorPlanResult> {
  const floorPlate = Math.round(totalArea / floors);

  // ── Step 1: Ask AI for per-floor room programs ──────────────────
  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert residential floor plan architect. Given a building brief with per-floor requirements, generate SEPARATE room programs for EACH floor.

CRITICAL RULES — FOLLOW THE USER'S REQUIREMENTS EXACTLY:
- If user says "ground floor: 1 hall, 2 bedrooms, kitchen, toilet, bathroom" → output EXACTLY those rooms for ground floor
- If user says "first floor: 2 bedrooms, 1 toilet" → output EXACTLY those rooms for first floor
- Do NOT add rooms the user didn't ask for (no "manager office", "reception", "lobby", "break room")
- Do NOT rename rooms — use the user's exact names (e.g., "Hall" not "Living Room" if user said "hall")
- If user mentions "stairs" or building has multiple floors, add a "Staircase" room on EACH floor
- "toilet" → type "wc", "bathroom" → type "bathroom" (these are different!)
- "hall" → type "living"

RESPOND WITH JSON:
{
  "floors": [
    {
      "floorLabel": "Ground Floor",
      "rooms": [
        { "name": "Hall", "area": 18, "type": "living" },
        { "name": "Bedroom 1", "area": 12, "type": "bedroom" },
        { "name": "Kitchen", "area": 9, "type": "kitchen" },
        { "name": "Staircase", "area": 5, "type": "stair" }
      ]
    },
    {
      "floorLabel": "First Floor",
      "rooms": [
        { "name": "Bedroom 3", "area": 14, "type": "bedroom" },
        { "name": "Staircase", "area": 5, "type": "stair" }
      ]
    }
  ],
  "title": "Residential Duplex — 1089 sq ft"
}

RULES:
- "area" is in m². Each floor's rooms MUST sum to approximately the floor plate area.
- "type" must be one of: living, dining, kitchen, bedroom, master, bathroom, wc, hallway, corridor, entry, office, study, stair, balcony, laundry, storage, retail, meeting
- Respect minimum areas: bedroom ≥ 10m², living/hall ≥ 15m², kitchen ≥ 7m², bathroom ≥ 4m², wc ≥ 2.5m², stair ≥ 4m²
- Number the floors correctly: Ground Floor, First Floor, Second Floor, etc.
- If user mentions windows/doors → every habitable room gets windows (this is handled in SVG rendering, just include the rooms)
- Staircase should be in the SAME position on each floor (same area, same type)`,
      },
      {
        role: "user",
        content: `Generate per-floor room programs for: ${typology} (${floors} floors).
Total building area: ${totalArea} m². Floor plate area: ~${floorPlate} m² per floor.
Program requirements: ${programDetail}.
${narrativeContext ? `\nProject description:\n${narrativeContext.substring(0, 800)}` : ""}
${programSummaryContext ? `\nSummary: ${programSummaryContext}` : ""}

IMPORTANT: Each floor's rooms MUST sum to approximately ${floorPlate} m². Follow the user's per-floor room list EXACTLY.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response for multi-floor plan");

  const aiResult = JSON.parse(content) as {
    floors: Array<{ floorLabel: string; rooms: Array<{ name: string; area: number; type?: string }> }>;
    title?: string;
  };

  if (!aiResult.floors || aiResult.floors.length === 0) {
    throw new Error("AI returned no floors for multi-floor plan");
  }

  // ── Step 2: Normalize and layout each floor ─────────────────────
  const floorLayouts: Array<{ label: string; rooms: RoomDef[]; rects: LayoutRect[] }> = [];

  // Calculate common dimensions for all floors (same footprint)
  const aspect = 1.33;
  const fpWidthM = Math.sqrt(floorPlate * aspect);
  const fpHeightM = floorPlate / fpWidthM;

  // SVG dimensions: side-by-side floors
  const floorCount = aiResult.floors.length;
  const gap = 40; // px gap between floors
  const totalSvgW = 800 * Math.min(floorCount, 2); // max 2 side by side
  const svgH = floorCount > 2 ? 1100 : 600;
  const margin = 40;
  const floorDrawW = (totalSvgW - margin * 2 - gap * (Math.min(floorCount, 2) - 1)) / Math.min(floorCount, 2);
  const floorDrawH = floorCount > 2 ? 420 : 460;
  const pxPerMeter = Math.min(floorDrawW / fpWidthM, floorDrawH / fpHeightM);
  const planW = fpWidthM * pxPerMeter;
  const planH = fpHeightM * pxPerMeter;

  for (const floor of aiResult.floors) {
    const rooms: RoomDef[] = floor.rooms.map(r => ({
      name: r.name,
      area: r.area,
      type: r.type ?? detectRoomType(r.name),
    }));

    // Normalize areas
    const roomAreaSum = rooms.reduce((s, r) => s + r.area, 0);
    if (roomAreaSum > 0 && Math.abs(roomAreaSum - floorPlate) > floorPlate * 0.1) {
      const scale = floorPlate / roomAreaSum;
      for (const room of rooms) {
        room.area = Math.round(room.area * scale * 10) / 10;
      }
    }

    // Layout with treemap (positions calculated per floor, adjusted later)
    const rects = layoutTreemap(rooms, 0, 0, planW, planH);
    floorLayouts.push({ label: floor.floorLabel, rooms, rects });
  }

  // ── Step 3: Render multi-floor SVG ──────────────────────────────
  const title = aiResult.title ?? `${typology} — ${floors}-Floor Plan`;
  const svg = renderMultiFloorSvg(floorLayouts, title, pxPerMeter, planW, planH, totalSvgW, svgH, margin, gap);

  // Flatten room lists with floor labels
  const roomList = floorLayouts.flatMap(fl =>
    fl.rooms.map(r => ({ name: r.name, area: r.area, unit: "m²", floor: fl.label }))
  );

  const perFloorRooms = floorLayouts.map(fl => ({
    floorLabel: fl.label,
    rooms: fl.rooms.map(r => ({ name: r.name, area: r.area, type: r.type })),
  }));

  return { svg, roomList, totalArea, floors, perFloorRooms };
}


// ─── parseBriefDocument (TR-001) ────────────────────────────────────────────

export interface ParsedBrief {
  projectTitle: string;
  projectType: string;
  site?: { address?: string; area?: string; constraints?: string };
  programme?: Array<{ space: string; area_m2?: number; floor?: string }>;
  constraints?: { maxHeight?: string; setbacks?: string; zoning?: string };
  budget?: { amount?: string; currency?: string };
  sustainability?: string;
  designIntent?: string;
  keyRequirements?: string[];
  rawText: string;
}

export async function parseBriefDocument(
  pdfText: string,
  userApiKey?: string
): Promise<ParsedBrief> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    // Truncate very long documents to stay within token limits
    const maxChars = 12000;
    const truncated = pdfText.length > maxChars;
    const text = truncated ? pdfText.slice(0, maxChars) : pdfText;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an architectural brief analyst. Given raw text extracted from a client brief PDF, structure it into the following JSON format:
{
  "projectTitle": "...",
  "projectType": "residential|commercial|mixed-use|institutional|...",
  "site": { "address": "...", "area": "...", "constraints": "..." },
  "programme": [
    { "space": "Retail", "area_m2": 600, "floor": "ground" },
    { "space": "Apartments", "area_m2": 4200, "floor": "upper" }
  ],
  "constraints": { "maxHeight": "...", "setbacks": "...", "zoning": "..." },
  "budget": { "amount": "...", "currency": "..." },
  "sustainability": "...",
  "designIntent": "...",
  "keyRequirements": ["...", "..."]
}
If information is not found in the text, omit the field. Be precise with numbers. Extract ALL programme spaces with their areas.`,
        },
        {
          role: "user",
          content: `Structure this architectural brief:\n\n${text}${truncated ? "\n\n[Document truncated — first 12,000 characters shown]" : ""}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response for brief parsing");

    const parsed = JSON.parse(content) as Omit<ParsedBrief, "rawText">;

    return {
      ...parsed,
      projectTitle: parsed.projectTitle || "Untitled Project",
      projectType: parsed.projectType || "unknown",
      rawText: text,
    };
  });
}

// ─── estimateCosts (QS AI Estimation) ───────────────────────────────────────

export interface CostEstimateResult {
  lineItems: Array<{
    description: string;
    csiDivision: string;
    unit: string;
    quantity: number;
    unitRate: number;
    totalCost: number;
    confidence: "high" | "medium" | "low";
  }>;
  hardCostTotal: number;
  softCostPercent: number;
  contingencyPercent: number;
  totalProjectCost: number;
  costPerSF: number;
  assumptions: string[];
  exclusions: string[];
  riskFactors: string[];
}

export async function estimateCosts(
  buildingDescription: string,
  totalAreaSF: number,
  region: string = "USA",
  projectType: string = "commercial",
  userApiKey?: string
): Promise<CostEstimateResult> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a Chartered Quantity Surveyor (MRICS) with 20+ years of experience in construction cost estimation. You provide AACE Class 4 preliminary estimates (±15-20% accuracy) based on RSMeans 2024/2025 data.

CRITICAL RULES:
1. Use REAL construction unit rates from RSMeans 2024/2025 — NEVER invent rates
2. All rates in USD national average — regional adjustment applied separately
3. Include ALL CSI MasterFormat divisions relevant to the building type
4. Apply appropriate waste factors (7-15% depending on material)
5. Be CONSERVATIVE — round UP, not down
6. Break costs into Material / Labor / Equipment where possible
7. Account for project complexity based on building type
8. Include soft costs (design fees, permits, GC O&P, contingency)

OUTPUT FORMAT (JSON):
{
  "lineItems": [
    {
      "description": "Concrete Foundations — cast-in-place, 4000 PSI",
      "csiDivision": "03",
      "unit": "CY",
      "quantity": 250,
      "unitRate": 185.00,
      "totalCost": 46250,
      "confidence": "high"
    }
  ],
  "hardCostTotal": 0,
  "softCostPercent": 37.5,
  "contingencyPercent": 10,
  "totalProjectCost": 0,
  "costPerSF": 0,
  "assumptions": ["..."],
  "exclusions": ["Land acquisition", "FF&E", "Financing costs"],
  "riskFactors": ["..."]
}

QUALITY STANDARD:
- Every line item must have a specific CSI division
- Quantities must be realistic for the described building
- Unit rates must be within ±15% of RSMeans 2024 published rates
- Total cost per SF must be reasonable for building type and region
- Include 15-25 line items minimum for a complete estimate`,
        },
        {
          role: "user",
          content: `Provide a preliminary cost estimate for:

Building: ${buildingDescription}
Total Area: ${totalAreaSF.toLocaleString()} SF
Region: ${region}
Project Type: ${projectType}

Generate a complete AACE Class 4 estimate with all major CSI divisions.`,
        },
      ],
      max_tokens: 3000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response for cost estimation");

    const result = JSON.parse(content) as CostEstimateResult;

    // Validate and ensure required fields
    return {
      lineItems: result.lineItems ?? [],
      hardCostTotal: result.hardCostTotal ?? 0,
      softCostPercent: result.softCostPercent ?? 37.5,
      contingencyPercent: result.contingencyPercent ?? 10,
      totalProjectCost: result.totalProjectCost ?? 0,
      costPerSF: result.costPerSF ?? (result.totalProjectCost ? Math.round(result.totalProjectCost / totalAreaSF) : 0),
      assumptions: result.assumptions ?? [],
      exclusions: result.exclusions ?? ["Land acquisition", "FF&E", "Financing costs"],
      riskFactors: result.riskFactors ?? [],
    };
  });
}

// ─── analyzeImage (TR-004) ──────────────────────────────────────────────────

export interface ImageAnalysis {
  buildingType: string;
  floors: number;
  style: string;
  features: string[];
  description: string;
  facade: string;
  massing: string;
  siteRelationship: string;
  /** true when the image is a 2D floor plan / blueprint */
  isFloorPlan?: boolean;
  /** Rooms extracted from a floor plan, e.g. [{name:"Kitchen",dimensions:"3.2m x 2.5m"}] */
  rooms?: { name: string; dimensions: string }[];
  /** Spatial layout description for floor plans */
  layoutDescription?: string;
  /** Rich room data for render pipeline (GPT-4o floor plan analysis) */
  richRooms?: Array<{
    name: string;
    dimensions: string;
    position: string;
    connections: string[];
    doors: string[];
    windows: string[];
    furniture: string[];
  }>;
  /** Overall footprint shape and dimensions */
  footprint?: { shape: string; width: string; depth: string };
  /** Circulation path description */
  circulation?: string;
  /** DALL-E optimized exterior description */
  exteriorPrompt?: string;
  /** DALL-E optimized interior description (best room) */
  interiorPrompt?: string;
  /** Geometric data for 3D reconstruction (GN-011) */
  geometry?: {
    buildingWidth: number;
    buildingDepth: number;
    /** Building shape classification */
    buildingShape?: string;
    /** For non-rectangular buildings: outline vertices in meters [[x,y], ...] */
    buildingOutline?: [number, number][];
    /** Row-based layout (preferred): array of rows, each row = array of rooms left-to-right */
    rows?: Array<Array<{
      name: string;
      type: string;
      width: number;
      depth: number;
      adjacentRooms?: string[];
    }>>;
    /** Absolute x,y positioned rooms */
    rooms: Array<{
      name: string;
      type: string;
      width: number;
      depth: number;
      x: number;
      y: number;
      adjacentRooms?: string[];
      /** Polygon vertices [[x,y], ...] from SVG parsing */
      polygon?: [number, number][];
      /** Area in m² */
      area?: number;
    }>;
    /** Wall segments from SVG parsing */
    walls?: Array<{
      start: [number, number];
      end: [number, number];
      thickness: number;
      type: "exterior" | "interior";
    }>;
  };
}

export async function analyzeImage(
  imageBase64: string,
  mimeType: string = "image/jpeg",
  userApiKey?: string
): Promise<ImageAnalysis> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);
    const imageDataUrl = `data:${mimeType};base64,${imageBase64}`;

    // ── Phase 1: Quick classification with GPT-4o-mini ──
    const quickCheck = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Classify this image. Return JSON: {"isFloorPlan": true/false, "buildingType": "short description"}. Set isFloorPlan=true if the image is a 2D architectural floor plan, blueprint, or layout drawing.`,
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: "Is this a 2D floor plan?" },
          ],
        },
      ],
      max_tokens: 100,
    });

    const checkContent = quickCheck.choices[0]?.message?.content;
    const isFloorPlan = checkContent ? (JSON.parse(checkContent) as { isFloorPlan?: boolean }).isFloorPlan === true : false;
    console.log(`[analyzeImage] Phase 1 done — isFloorPlan: ${isFloorPlan}, using model: ${isFloorPlan ? "gpt-4o" : "gpt-4o-mini"}`);

    // ── Phase 2: Deep analysis ──
    // Floor plans get GPT-4o for rich room-by-room extraction + render prompts.
    // Non-floor-plans use GPT-4o-mini (cheaper, sufficient for building photos).
    const model = isFloorPlan ? "gpt-4o" : "gpt-4o-mini";
    const maxTokens = isFloorPlan ? 5000 : 1500;

    const systemPrompt = isFloorPlan
      ? `You are an expert architectural floor plan analyst. Extract the EXACT room layout from a 2D floor plan image.

STEP 1 — IDENTIFY ROOMS:
Look at the image carefully. List ONLY rooms you can ACTUALLY SEE as enclosed areas.
- Read room labels/names directly from the image text
- If a room has no label, name it by furniture symbols inside it
- Do NOT invent rooms. If you see 4, output 4. If 10, output 10.
- Studios may have 2-3 rooms, small flats 4-5, houses 8-12. ALL are valid.

STEP 2 — READ DIMENSIONS:
- Look for dimension text on or near each room ("3.2M X 3.6M", "11' x 13'4", "208 sq ft")
- Use EXACTLY the dimensions shown. Do NOT inflate or round up.
- Imperial → meters: 1 foot = 0.3048m, 1 inch = 0.0254m
- Sq ft without dimensions → estimate width/depth to match area
- No dimensions visible → estimate from proportions relative to rooms that DO have dimensions

STEP 3 — LOCATE EACH ROOM'S POSITION (CRITICAL):
For EACH room, provide its position in the image as a percentage:
- "positionLeftPercent": percentage from the LEFT edge of the image to the room's LEFT wall (0 = far left, 100 = far right)
- "positionTopPercent": percentage from the TOP edge of the image to the room's TOP wall (0 = top, 100 = bottom)

Look at the image carefully. If a room's left wall is about 1/5 from the left edge, positionLeftPercent ≈ 20. If its top wall is near the top, positionTopPercent ≈ 5.
Be precise — use the wall positions you can actually see.

STEP 4 — ORGANIZE INTO ROWS (for compatibility):
Also describe the layout as horizontal ROWS from TOP to BOTTOM of the plan.
Within each row, list rooms from LEFT to RIGHT.

Rules:
- Each room appears in EXACTLY ONE row
- Within a row, rooms sit side by side (left to right)
- Rooms in the same row should have SIMILAR depth (use the deepest room's depth for the row)
- Rows stack vertically: top row first, bottom row last
- A hallway/corridor that spans the width = its own row
- Include ALL rooms in exactly one row

Example: A 3BHK flat with Veranda left, Living/Dining/Kitchen across the top, Hallway in middle, Bedrooms at bottom:
"rows": [
  [{"name":"Veranda","type":"veranda","width":1.8,"depth":3.6,"positionLeftPercent":2,"positionTopPercent":5},{"name":"Living Room","type":"living","width":3.2,"depth":3.6,"positionLeftPercent":15,"positionTopPercent":5},{"name":"Dining","type":"dining","width":3.2,"depth":3.6,"positionLeftPercent":40,"positionTopPercent":5},{"name":"Kitchen","type":"kitchen","width":3.2,"depth":3.6,"positionLeftPercent":65,"positionTopPercent":5}],
  [{"name":"Hallway","type":"hallway","width":11.4,"depth":1.5,"positionLeftPercent":2,"positionTopPercent":42}],
  [{"name":"Bedroom 3","type":"bedroom","width":4.1,"depth":3.5,"positionLeftPercent":2,"positionTopPercent":58},{"name":"Bath","type":"bathroom","width":2.0,"depth":3.5,"positionLeftPercent":34,"positionTopPercent":58},{"name":"Bedroom 2","type":"bedroom","width":3.0,"depth":3.5,"positionLeftPercent":50,"positionTopPercent":58},{"name":"Bedroom 1","type":"bedroom","width":3.6,"depth":3.5,"positionLeftPercent":75,"positionTopPercent":58}]
]

ACCURACY RULES (MANDATORY):
1. Output ONLY rooms visible in the image. NEVER invent extra rooms.
2. Use dimension text from image EXACTLY.
3. The "rooms" array, "richRooms" array, and geometry must have the SAME rooms.
4. Room types: living|bedroom|kitchen|dining|bathroom|hallway|veranda|balcony|entrance|passage|utility|storage|closet|office|patio|staircase|other
5. adjacentRooms = rooms sharing a wall or connected by a door.

Output JSON:
{
  "buildingType": "e.g. 1BHK Studio / 3BHK Residential Unit",
  "floors": 1,
  "style": "e.g. Modern Minimalist",
  "features": ["feature1", "feature2"],
  "description": "Comprehensive architectural description",
  "facade": "Infer facade from plan context",
  "massing": "Overall footprint shape and total area",
  "siteRelationship": "Orientation and context if visible",
  "isFloorPlan": true,
  "rooms": [{"name": "Living Room", "dimensions": "3.6m x 4.2m"}, ...],
  "layoutDescription": "Spatial relationships, adjacencies, circulation path",
  "richRooms": [
    {
      "name": "Living Room",
      "dimensions": "3.2m x 3.6m",
      "position": "upper-left",
      "connections": ["Kitchen", "Hallway"],
      "doors": ["south wall to hallway"],
      "windows": ["north wall"],
      "furniture": ["sofa", "coffee table"]
    }
  ],
  "footprint": { "shape": "rectangular", "width": "12.7", "depth": "8.6" },
  "circulation": "How rooms connect...",
  "exteriorPrompt": "Ultra-photorealistic architectural exterior render of: [describe building]. 30-degree elevated angle. Golden hour, V-Ray quality, 8K. No people.",
  "interiorPrompt": "Ultra-photorealistic interior render of: [describe best room]. Wide-angle, eye-level. Natural daylight. No people.",
  "geometry": {
    "buildingWidth": 12.7,
    "buildingDepth": 8.6,
    "rows": [
      [
        {"name": "Veranda", "type": "veranda", "width": 1.8, "depth": 3.6, "positionLeftPercent": 2, "positionTopPercent": 5, "adjacentRooms": ["Living Room"]},
        {"name": "Living Room", "type": "living", "width": 3.2, "depth": 3.6, "positionLeftPercent": 15, "positionTopPercent": 5, "adjacentRooms": ["Veranda", "Dining", "Hallway"]},
        {"name": "Dining", "type": "dining", "width": 3.2, "depth": 3.6, "positionLeftPercent": 40, "positionTopPercent": 5, "adjacentRooms": ["Living Room", "Kitchen"]},
        {"name": "Kitchen", "type": "kitchen", "width": 3.2, "depth": 3.6, "positionLeftPercent": 65, "positionTopPercent": 5, "adjacentRooms": ["Dining"]}
      ],
      [
        {"name": "Hallway", "type": "hallway", "width": 11.4, "depth": 1.5, "positionLeftPercent": 2, "positionTopPercent": 42, "adjacentRooms": ["Living Room", "Bedroom 3", "Bedroom 2", "Bedroom 1"]}
      ],
      [
        {"name": "Bedroom 3", "type": "bedroom", "width": 4.1, "depth": 3.5, "positionLeftPercent": 2, "positionTopPercent": 58, "adjacentRooms": ["Hallway"]},
        {"name": "Bath", "type": "bathroom", "width": 2.0, "depth": 3.5, "positionLeftPercent": 34, "positionTopPercent": 58, "adjacentRooms": ["Hallway"]},
        {"name": "Bedroom 2", "type": "bedroom", "width": 3.0, "depth": 3.5, "positionLeftPercent": 50, "positionTopPercent": 58, "adjacentRooms": ["Hallway"]},
        {"name": "Bedroom 1", "type": "bedroom", "width": 3.6, "depth": 3.5, "positionLeftPercent": 75, "positionTopPercent": 58, "adjacentRooms": ["Hallway"]}
      ]
    ]
  }
}`
      : `You are a senior architect analyzing an image. Describe what you see in precise architectural terms. Output JSON with these fields:
{
  "buildingType": "Mixed-Use Tower|Residential Block|...",
  "floors": <number>,
  "style": "Contemporary Nordic|...",
  "features": ["feature1", "feature2"],
  "description": "Detailed 3-4 paragraph architectural description...",
  "facade": "Description of facade treatment, materials, openings...",
  "massing": "Description of building massing, setbacks, volumes...",
  "siteRelationship": "How the building relates to its context...",
  "isFloorPlan": false,
  "rooms": [],
  "layoutDescription": ""
}

Be specific about dimensions, proportions, materials, and spatial relationships. If the image is not architectural, set buildingType to "Not Architectural" and describe what you see.`;

    // Floor plan analysis with GPT-4o needs more time (geometry extraction is heavy)
    const requestTimeout = isFloorPlan ? 90000 : 30000;

    const completion = await client.chat.completions.create({
      model,
      temperature: isFloorPlan ? 0 : 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl, detail: isFloorPlan ? "high" : "auto" } },
            {
              type: "text",
              text: isFloorPlan
                ? "Analyze this floor plan. List EVERY SINGLE ROOM — including bathrooms, closets, hallways, verandas, passages, and utility areas. Each room MUST appear in both the 'rooms' array AND the 'geometry.rooms' array with name, type, width, depth, x, y, and adjacentRooms. Use absolute x,y positions in meters from the building's top-left corner. Rooms must tile together with NO GAPS. A typical home has 8-12 rooms."
                : "Analyze this image in architectural terms. Describe the building, its style, materials, and spatial qualities.",
            },
          ],
        },
      ],
      max_tokens: maxTokens,
    }, { timeout: requestTimeout });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response for image analysis");

    const result = JSON.parse(content) as ImageAnalysis;

    console.log(`[analyzeImage] Model: ${model}, isFloorPlan: ${isFloorPlan}, rooms: ${result.rooms?.length ?? 0}, richRooms: ${result.richRooms?.length ?? 0}`);

    return {
      buildingType: result.buildingType || "Unknown",
      floors: result.floors || 1,
      style: result.style || "Unknown",
      features: result.features || [],
      description: result.description || "No description generated",
      facade: result.facade || "",
      massing: result.massing || "",
      siteRelationship: result.siteRelationship || "",
      isFloorPlan: result.isFloorPlan ?? isFloorPlan,
      rooms: result.rooms ?? [],
      layoutDescription: result.layoutDescription ?? "",
      richRooms: result.richRooms ?? undefined,
      footprint: result.footprint ?? undefined,
      circulation: result.circulation ?? undefined,
      exteriorPrompt: result.exteriorPrompt ?? undefined,
      interiorPrompt: result.interiorPrompt ?? undefined,
      geometry: result.geometry ?? undefined,
    };
  });
}

// ─── Room Labeling (GPT-4o, used after sharp pixel detection) ──────────────

export interface RoomLabelingInput {
  roomCenters: Array<{ center: [number, number]; width: number; depth: number }>;
  imageBase64: string;
  mimeType: string;
}

export interface RoomLabelingResult {
  rooms: Array<{
    index: number;
    name: string;
    type: FloorPlanRoomType;
    refinedWidth?: number;
    refinedDepth?: number;
  }>;
  footprint?: { width: number; depth: number };
}

/**
 * GPT-4o labels detected room regions from pixel analysis.
 * Much cheaper than full geometry extraction — only asks for names/types.
 */
export async function labelDetectedRooms(
  input: RoomLabelingInput,
  userApiKey?: string,
): Promise<RoomLabelingResult> {
  const client = getClient(userApiKey);

  const roomList = input.roomCenters
    .map((r, i) => `  Room ${i}: center=(${r.center[0].toFixed(1)}, ${r.center[1].toFixed(1)}), approx ${r.width.toFixed(1)}m × ${r.depth.toFixed(1)}m`)
    .join("\n");

  const systemPrompt = `You are an architectural floor plan reader. You will be shown a 2D floor plan image along with room regions detected by computer vision. Your job is to READ the text labels visible on the floor plan and assign each detected room a name and type.

Room types: living, bedroom, kitchen, dining, bathroom, veranda, hallway, storage, office, other.

Respond ONLY with a JSON object:
{
  "rooms": [
    { "index": 0, "name": "Living Room", "type": "living" },
    ...
  ],
  "footprint": { "width": <meters>, "depth": <meters> }
}

If you can read dimension text on the plan (e.g. "3.2M × 3.6M"), add "refinedWidth" and "refinedDepth" in meters for that room.
If you cannot determine a room's name from the image, use a reasonable guess based on its size and position (e.g. small rooms near bedrooms → bathroom).`;

  const userPrompt = `I used computer vision to detect these room regions on the attached floor plan:\n${roomList}\n\nPlease read the room name labels visible in the image and assign name + type to each detected room. Also estimate the overall footprint in meters if possible.`;

  return handleOpenAICall(async () => {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 800,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.mimeType};base64,${input.imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    }, { timeout: 45_000 });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      return {
        rooms: (parsed.rooms ?? []).map((r: Record<string, unknown>, i: number) => ({
          index: typeof r.index === "number" ? r.index : i,
          name: String(r.name ?? `Room ${i + 1}`),
          type: (String(r.type ?? "other")) as FloorPlanRoomType,
          refinedWidth: typeof r.refinedWidth === "number" ? r.refinedWidth : undefined,
          refinedDepth: typeof r.refinedDepth === "number" ? r.refinedDepth : undefined,
        })),
        footprint: parsed.footprint ?? undefined,
      };
    } catch {
      // If GPT response isn't valid JSON, return generic labels
      return {
        rooms: input.roomCenters.map((_, i) => ({
          index: i,
          name: `Room ${i + 1}`,
          type: "other" as FloorPlanRoomType,
        })),
      };
    }
  });
}

// ─── GPT-4o SVG Floor Plan Analysis ──────────────────────────────────────────

export async function analyzeFloorPlanSVG(
  imageBase64: string,
  mimeType: string = "image/jpeg",
  userApiKey?: string
) {
  const client = getClient(userApiKey);

  console.log("[GPT-4o SVG] Generating SVG floor plan...");

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 8000,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
          {
            type: "text",
            text: `Look at this floor plan image. Recreate it as an SVG drawing.

The SVG must be a FAITHFUL reproduction of the floor plan layout.
Use a coordinate system where 1 unit = 1 meter.

Read dimension labels from the image to determine exact sizes.
If imperial (feet/inches), convert to meters (1 foot = 0.3048m).
If no dimensions, estimate from typical room sizes.

SVG RULES:

1. viewBox="0 0 {widthMeters} {depthMeters}"

2. BUILDING OUTLINE: A <polygon> with id="building-outline" class="outline"
   - For rectangular: 4-point polygon
   - For irregular: polygon with all vertices

3. ROOMS: For EACH room, a <rect> or <polygon> with:
   - class="room"
   - data-name="{room label}" (e.g., "Living Room")
   - data-type="{type}" (living|dining|kitchen|bedroom|bathroom|balcony|hallway|entrance|veranda|staircase|utility|storage|other)
   - For rectangular rooms: use <rect x="..." y="..." width="..." height="..." class="room" data-name="..." data-type="..."/>
   - For non-rectangular rooms: use <polygon points="x1,y1 x2,y2 ..." class="room" data-name="..." data-type="..."/>
   - fill based on type: living=#D4A574, kitchen=#E8E0D8, bedroom=#C4956A, bathroom=#B8C8D8, balcony=#8B9F7B, hallway=#C5C0B8, other=#CCBBAA

4. WALLS: For each wall segment, a <line> with:
   - class="wall exterior" or class="wall interior"
   - x1, y1, x2, y2 (ALL must be valid numbers, no undefined)
   - stroke="#333" stroke-width="0.2" (exterior) or "0.12" (interior)

5. Room labels: <text> with class="label" at room center

CRITICAL RULES:
- ALL coordinates in meters (1 SVG unit = 1 meter)
- Room shapes must EXACTLY fill the building outline — no gaps
- Adjacent rooms share edges — coordinates must match exactly
- Only include rooms clearly visible in the image
- ALL <line> elements MUST have valid numeric x1, y1, x2, y2
- Use <rect> for rectangular rooms, <polygon> only for non-rectangular

OUTPUT ONLY THE SVG. Start with <svg, end with </svg>. No explanation. No markdown.`,
          },
        ],
      },
    ],
  });

  const svgText = response.choices[0]?.message?.content?.trim() || "";

  // Clean up SVG
  let svgContent = svgText;
  if (svgContent.includes("```")) {
    svgContent = svgContent.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
  }
  const svgStart = svgContent.indexOf("<svg");
  if (svgStart > 0) svgContent = svgContent.substring(svgStart);
  const svgEnd = svgContent.lastIndexOf("</svg>");
  if (svgEnd > 0) svgContent = svgContent.substring(0, svgEnd + 6);

  if (!svgContent.startsWith("<svg")) {
    throw new Error("GPT-4o did not return valid SVG");
  }

  console.log(`[GPT-4o SVG] SVG size: ${svgContent.length} chars`);
  console.log("[GPT-4o SVG] First 300 chars:", svgContent.substring(0, 300));

  // Save SVG for debugging
  try {
    const fs = await import("fs");
    const path = await import("path");
    fs.writeFileSync(path.join(process.cwd(), "public", "debug-floor-plan.svg"), svgContent);
    console.log("[GPT-4o SVG] Saved to public/debug-floor-plan.svg");
  } catch {
    console.log("[GPT-4o SVG] Could not save debug file");
  }

  // Parse SVG using existing parser
  const { parseSVGtoFloorPlan } = await import("./claude-vision");
  const result = parseSVGtoFloorPlan(svgContent);
  result.svgContent = svgContent;

  console.log(`[GPT-4o SVG] Parsed: ${result.rooms.length} rooms, ${result.walls?.length ?? 0} walls`);
  for (const r of result.rooms) {
    console.log(`  ${r.name} (${r.type}): ${r.width}x${r.depth}m polygon:${r.polygon?.length ?? 0}pts area=${r.area}m²`);
  }

  return result;
}

// ─── GPT-4o Room Labeler (for Potrace pipeline) ─────────────────────────────

/**
 * Takes Potrace-detected regions + original image → GPT-4o labels the rooms.
 * GPT-4o only reads text and classifies — geometry comes from pixel tracing.
 */
export async function labelFloorPlanRooms(
  imageBase64: string,
  mimeType: string,
  regions: Array<{
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
    center: { x: number; y: number };
    area: number;
  }>,
  imageWidth: number,
  imageHeight: number,
  userApiKey?: string,
): Promise<{
  buildingWidthMeters: number;
  buildingDepthMeters: number;
  rooms: Array<{
    regionId: number;
    name: string;
    type: string;
    widthMeters: number;
    depthMeters: number;
  }>;
}> {
  const client = getClient(userApiKey);

  const regionDescriptions = regions
    .map(
      (r) =>
        `Region ${r.id}: position (${Math.round(r.center.x)}px, ${Math.round(r.center.y)}px), ` +
        `size ${Math.round(r.bounds.width)}x${Math.round(r.bounds.height)}px, ` +
        `at ${Math.round((r.center.x / imageWidth) * 100)}% from left, ${Math.round((r.center.y / imageHeight) * 100)}% from top`,
    )
    .join("\n");

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2000,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
          {
            type: "text",
            text: `I detected these enclosed regions in this floor plan using computer vision:

${regionDescriptions}

Image size: ${imageWidth} x ${imageHeight} pixels

For each region, tell me:
1. What room is it? Read the label text from the image.
2. What type? (living|dining|kitchen|bedroom|bathroom|balcony|hallway|entrance|veranda|staircase|utility|storage|other)
3. Real-world dimensions in meters. Read dimension labels from image. Convert feet/inches to meters if needed.

Also give the total building width and depth in meters.

RULES:
- Match each region ID to the room at that position in the image
- Read dimension text directly from the image
- Only label regions that are clearly rooms — skip tiny artifacts
- If a region doesn't match any room, skip it

JSON response:
{
  "buildingWidthMeters": 13.0,
  "buildingDepthMeters": 9.0,
  "rooms": [
    { "regionId": 0, "name": "Living Room", "type": "living", "widthMeters": 3.2, "depthMeters": 3.6 }
  ]
}`,
          },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() || "{}";
  try {
    return JSON.parse(text);
  } catch {
    console.error("[labelFloorPlanRooms] Failed to parse JSON:", text.substring(0, 200));
    return { buildingWidthMeters: 10, buildingDepthMeters: 8, rooms: [] };
  }
}

// ─── DALL-E 3 Photorealistic Floor Plan Render ──────────────────────────────

/**
 * Generates a photorealistic aerial render of a floor plan using DALL-E 3.
 * Takes room descriptions and building info → creates an architectural visualization.
 * Returns the image as a base64 data URL.
 */
export async function generateFloorPlanRender(
  rooms: Array<{ name: string; type: string; width: number; depth: number }>,
  buildingDimensions: { width: number; depth: number },
  options?: {
    style?: "modern" | "scandinavian" | "industrial" | "luxury" | "minimal";
    userApiKey?: string;
  },
): Promise<{ imageUrl: string; revisedPrompt: string }> {
  const client = getClient(options?.userApiKey, 60000); // 60s — DALL-E 3 HD images take longer
  const style = options?.style ?? "modern";

  const roomList = rooms
    .map(r => `${r.name} (${r.type}, ${r.width.toFixed(1)}m x ${r.depth.toFixed(1)}m)`)
    .join(", ");

  const styleDescriptions: Record<string, string> = {
    modern: "clean contemporary design with warm wood floors, white walls, designer furniture, indoor plants, and natural light streaming through large windows",
    scandinavian: "Scandinavian hygge style with light oak floors, white and soft gray palette, cozy textiles, minimalist furniture, candles, and warm ambient lighting",
    industrial: "industrial loft style with polished concrete floors, exposed brick walls, metal fixtures, Edison bulbs, and reclaimed wood furniture",
    luxury: "luxury high-end interior with marble floors, gold accents, velvet furniture, crystal chandelier, floor-to-ceiling windows, and designer artwork",
    minimal: "Japanese-inspired minimalist design with tatami mats, shoji screens, low furniture, neutral earth tones, and zen garden elements",
  };

  const prompt = `Architectural dollhouse cutaway from above at a 45-degree angle, looking into a ${buildingDimensions.width.toFixed(0)}m x ${buildingDimensions.depth.toFixed(0)}m residential floor plan with the ceiling/roof completely removed, open top view like a miniature model home. Rooms: ${roomList}. Interior is fully furnished and decorated in ${styleDescriptions[style]}. Real wood plank floors in living spaces, clean white walls with subtle shadows between rooms. Each room has appropriate furniture arranged naturally. Warm golden-hour sunlight streaming through windows casting soft long shadows across the interior. Photorealistic, architectural visualization quality, tilt-shift depth of field, 8K detail. No text, no labels, no annotations, no people.`;

  console.log(`[DALL-E 3] Generating floor plan render (${style})...`);

  return handleOpenAICall(async () => {
    const response = await client.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1792x1024",
      quality: "hd",
      style: "natural",
    });

    const imageUrl = response.data?.[0]?.url;
    const revisedPrompt = response.data?.[0]?.revised_prompt ?? "";

    if (!imageUrl) throw new Error("DALL-E 3 returned no image");

    console.log(`[DALL-E 3] Render generated successfully`);

    // Fetch the image and convert to base64 data URL for persistence
    const imgResponse = await fetch(imageUrl);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const base64 = imgBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;

    console.log(`[DALL-E 3] Image fetched: ${(imgBuffer.length / 1024).toFixed(0)}KB`);

    return { imageUrl: dataUrl, revisedPrompt };
  });
}
