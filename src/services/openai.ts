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

// ─── generateFloorPlan (GN-004) ─────────────────────────────────────────────

export interface FloorPlanResult {
  svg: string;
  roomList: Array<{ name: string; area: number; unit: string; floor?: string }>;
  totalArea: number;
  floors: number;
  perFloorRooms?: Array<{ floorLabel: string; rooms: Array<{ name: string; area: number; type: string }> }>;
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

// ─── Squarified Treemap Layout ──────────────────────────────────────────────

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

    // ── Step 1: Ask AI for room program ONLY (no SVG) ───────────────
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert residential and architectural space planner. Given a building brief, generate a precise room program.

CRITICAL: You MUST follow the user's room requirements EXACTLY:
- If user says "1 hall, 2 bedrooms, kitchen, toilet, bathroom" → output EXACTLY those rooms, no more, no less
- Do NOT add rooms the user didn't ask for (no "manager office", "break room", "lobby" etc.)
- Do NOT rename rooms — use the user's exact names (e.g., "Hall" not "Living Room" if user said "hall")
- If user says "toilet" include a toilet (type: "wc"). If user says "bathroom" include a bathroom (type: "bathroom"). These are DIFFERENT rooms.
- Include a staircase (type: "stair") ONLY if user mentions stairs or the building has multiple floors

RESPOND WITH JSON:
{
  "rooms": [
    { "name": "Hall", "area": 22, "type": "living" },
    { "name": "Kitchen", "area": 10, "type": "kitchen" },
    ...
  ],
  "title": "Residential Ground Floor Plan"
}

RULES:
- "area" is in m². Room areas MUST sum to approximately the floor plate area given.
- "type" must be one of: living, dining, kitchen, bedroom, master, bathroom, wc, hallway, corridor, entry, office, study, stair, balcony, laundry, storage, retail, meeting
- Use type "wc" for toilet, type "bathroom" for bathroom/shower
- Use type "living" for hall/living room/drawing room
- Respect minimum areas: bedroom ≥ 10m², living/hall ≥ 15m², kitchen ≥ 7m², bathroom ≥ 4m², wc ≥ 2.5m², stair ≥ 4m²
- Title should describe the floor plan accurately`,
        },
        {
          role: "user",
          content: `Generate a room program for: ${typology}.
Total area: ${totalArea} m². Floor plate area: ~${floorPlate} m² per floor.
Program requirements: ${programDetail}.
${narrativeContext ? `\nAdditional context:\n${narrativeContext.substring(0, 500)}` : ""}
${programSummaryContext ? `\nSummary: ${programSummaryContext}` : ""}

IMPORTANT: Room areas MUST sum to approximately ${floorPlate} m². Follow the user's room list EXACTLY.`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response for floor plan");

    const aiResult = JSON.parse(content) as {
      rooms: Array<{ name: string; area: number; type?: string }>;
      title?: string;
    };

    if (!aiResult.rooms || aiResult.rooms.length === 0) {
      throw new Error("AI returned no rooms for floor plan");
    }

    // ── Step 2: Normalize room areas to match floor plate ───────────
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

    // ── Step 3: Deterministic layout via treemap ────────────────────
    const aspect = 1.33;
    const fpWidthM = Math.sqrt(floorPlate * aspect);
    const fpHeightM = floorPlate / fpWidthM;

    const margin = 50;
    const drawW = 700;
    const drawH = 490;
    const pxPerMeter = Math.min(drawW / fpWidthM, drawH / fpHeightM);
    const planW = fpWidthM * pxPerMeter;
    const planH = fpHeightM * pxPerMeter;
    const ox = margin + (drawW - planW) / 2;
    const oy = margin + (drawH - planH) / 2;

    const rects = layoutTreemap(rooms, ox, oy, planW, planH);

    // ── Step 4: Render SVG deterministically ────────────────────────
    const title = aiResult.title ?? `${typology} — Floor Plan`;
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
