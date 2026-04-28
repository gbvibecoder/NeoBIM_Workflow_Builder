import OpenAI from "openai";
import { detectOpenAIError, APIError } from "@/lib/user-errors";
import type { FloorPlanRoomType } from "@/features/floor-plan/types/floor-plan";
import { OPENAI_IMAGE_MODEL, normalizeImageResponse, fetchAsDataUrl } from "./image-generation";

export function getClient(userApiKey?: string, timeout?: number): OpenAI {
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
  // Location & climate context for accurate renders
  location?: string; // e.g. "Guwahati, Assam, India"
  city?: string;
  country?: string;
  climateZone?: string; // e.g. "tropical monsoon", "arid", "temperate"
  designImplications?: string[]; // from TR-012 site analysis
}


// ─── Helper: Parse user requirements ─────────────────────────────────────────

function parseUserRequirements(prompt: string): { floors?: number; location?: string } {
  const requirements: { floors?: number; location?: string } = {};
  const floorMatch = prompt.match(/(\d+)[-\s]?(story|stories|floor|floors|storey|storeys)/i);
  if (floorMatch) requirements.floors = parseInt(floorMatch[1]);

  // Detect location from prompt — cities, countries, regions
  const locations = [
    "Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad", "Guwahati", "Jaipur", "Lucknow", "Kochi", "Chandigarh", "Bhopal", "Indore", "Surat", "Nagpur", "Visakhapatnam", "Coimbatore",
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
- location (string: full location e.g. "Guwahati, Assam, India" — extract from user input or context)
- city (string: city name only e.g. "Guwahati")
- country (string: country name e.g. "India")
- climateZone (string: e.g. "tropical monsoon", "hot-arid", "temperate continental", "cold")
- designImplications (array of strings: 3-5 location-specific design responses, e.g. "deep overhangs for monsoon rain protection", "raised plinth for flood resilience")

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
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `You are an expert AEC visualization prompt engineer. Convert structured building data into precise, detailed image generation prompts using proper architectural terminology.

Use specific AEC vocabulary: floor count, facade materials, massing strategy, glazing ratio, setbacks, structural grid, floor-to-floor heights, podium/tower relationship, curtain wall systems, fenestration patterns, etc.

For each view type, emphasize different aspects:
- exterior: overall massing, facade expression, materiality, street presence, context
- floor_plan: spatial layout, room proportions, circulation, structural grid, dimensions
- site_plan: building footprint, setbacks, landscaping, access, parking, orientation
- interior: spatial quality, ceiling heights, natural light, materials, furnishings

CRITICAL — LOCATION & CONTEXT ACCURACY:
When a location is provided, the render MUST look like it belongs in that specific city/region:
- Include location-specific vegetation (e.g. tropical palms & bamboo for NE India, pine trees for Scandinavia, date palms for Middle East)
- Show local street character, vehicles, signage style, and pedestrian attire appropriate to the region
- Use climate-appropriate architectural features (deep overhangs for monsoon regions, courtyards for arid climates, pitched roofs for heavy rain/snow)
- Reference local urban density, building heights, and streetscape character
- Include atmospheric conditions typical of the region (humidity haze for tropical, crisp air for alpine, etc.)
- The building MUST have EXACTLY the specified number of floors — count them carefully in your prompt
- Include design implications (if provided) as visible architectural features in the render

ULTRA-PHOTOREALISM REQUIREMENTS (critical — the output must look like a REAL PHOTOGRAPH, not CGI):
- Describe the image as if it's a real DSLR photograph (Canon EOS R5, 35mm, f/4, golden hour)
- Specify material IMPERFECTIONS: weathering, patina, construction joints, slight staining, dust on ledges
- Specify GLASS REFLECTIONS: each pane reflects actual sky/clouds/surroundings differently (not uniform blue)
- Specify LIGHT PHYSICS: caustic reflections, color bleeding between materials, specular highlights on metal
- Specify LENS EFFECTS: shallow depth of field, natural bokeh, subtle vignetting
- Explicitly say "NOT a 3D render, NOT CGI, NOT illustration — a real architectural photograph"
- Reference specific real photographers: Hufton+Crow, Iwan Baan, Nigel Young quality

The prompt must be 250-400 words, richly descriptive, and specific enough that the generated image is unmistakably set in the given location and indistinguishable from a real photograph.

Respond with JSON: { "prompt": "<the enhanced prompt>" }`,
        },
        {
          role: "user",
          content: `Create an optimised DALL-E 3 prompt for a ${viewType} view of this building:

Building Type: ${description.buildingType}
Floors: ${description.floors} (MUST show exactly ${description.floors} floors in the image)
Total GFA: ${description.totalGFA ?? description.totalArea} m²
Height: ${description.height ?? description.floors * 3.5}m
Footprint: ${description.footprint ?? Math.round(description.totalArea / description.floors)} m²
Program: ${JSON.stringify(description.program ?? [{ space: description.programSummary }])}
Style: ${style ?? "contemporary architectural"}
View Type: ${viewType}
Facade: ${description.facade}
Structure: ${description.structure}
Location: ${description.location ?? description.city ?? "unspecified urban setting"}
Climate Zone: ${description.climateZone ?? "temperate"}
${description.designImplications?.length ? `Design Implications (must be visible in render):\n${description.designImplications.map(d => `- ${d}`).join("\n")}` : ""}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from GPT-4o-mini");

    const parsed = JSON.parse(content) as { prompt: string };
    return parsed.prompt;
  } catch (error) {
    console.error("[enhanceArchitecturalPrompt] Falling back to basic prompt:", error);
    const loc = description.location ?? description.city ?? "urban setting";
    const climate = description.climateZone ? ` in a ${description.climateZone} climate` : "";
    return `Professional architectural concept rendering of a ${description.floors}-story ${description.buildingType} in ${loc}${climate}. Exterior perspective view from street level, 3/4 angle. ${description.facade} facade. The building must have EXACTLY ${description.floors} floors visible. Show building in realistic local context with region-appropriate vegetation, street character, vehicles, and people in local attire for scale. ${description.designImplications?.length ? `Key design features: ${description.designImplications.slice(0, 3).join("; ")}.` : ""} Golden hour lighting. High-quality architectural visualization style similar to Foster+Partners or BIG presentations. Photorealistic materials, accurate proportions, contemporary architectural photography style.`;
  }
}

// ─── Location-aware context helpers ──────────────────────────────────────────

/**
 * Generates location-specific street context for photorealistic prompts.
 * Instead of hardcoding Mumbai, dynamically adapts to any city/climate.
 */
function buildLocationContext(location: string, climateZone: string): string {
  const loc = location.toLowerCase();

  // Indian cities
  if (loc.includes("mumbai") || loc.includes("bombay")) {
    return "busy Mumbai street corner with moderate pedestrian traffic (8-10 people visible: office workers, shoppers, food vendor). Street lined with mature rain trees with dappled shade. Black/yellow auto-rickshaws and cars with Mumbai license plates. Vendor cart with bright fabric canopy (orange/magenta) in foreground. Shallow puddles from recent monsoon rain reflecting golden light.";
  }
  if (loc.includes("guwahati") || loc.includes("assam") || loc.includes("northeast india")) {
    return "lush green Guwahati streetscape with tropical vegetation — mature areca nut palms, banana plants, and bamboo groves framing the scene. Local vehicles including Tata Sumos and auto-rickshaws. Pedestrians in mix of modern and traditional Assamese attire (mekhela chador visible on women). Nearby low-rise buildings with corrugated metal roofs and colorful facades. Red laterite earth visible at road edges. Overcast tropical sky with cumulus clouds suggesting monsoon season. A tea stall with bamboo structure visible in foreground.";
  }
  if (loc.includes("delhi") || loc.includes("new delhi") || loc.includes("noida") || loc.includes("gurgaon") || loc.includes("gurugram")) {
    return "wide Delhi boulevard with mixed traffic (auto-rickshaws, cars, two-wheelers). Mature neem and gulmohar trees along the road. Pedestrians in contemporary Indian attire. Adjacent buildings showing Delhi's mixed architectural character. Dry summer atmosphere with warm light.";
  }
  if (loc.includes("bangalore") || loc.includes("bengaluru")) {
    return "tree-lined Bangalore road with rain trees and jacarandas providing canopy shade. Mix of tech workers, two-wheelers, and modern vehicles. Adjacent buildings showing Bangalore's contemporary IT corridor character. Pleasant tropical highland atmosphere.";
  }
  if (loc.includes("chennai") || loc.includes("hyderabad") || loc.includes("kolkata") || loc.includes("pune") || loc.includes("ahmedabad")) {
    return `busy ${location} street with local traffic, auto-rickshaws, and pedestrians in regional attire. Tropical vegetation and mature shade trees lining the road. Adjacent buildings reflecting local architectural character. Warm, humid atmospheric conditions.`;
  }
  if (loc.includes("india")) {
    return `Indian urban street in ${location} with local traffic including auto-rickshaws and two-wheelers. Tropical vegetation, mature shade trees. Pedestrians in mix of modern and traditional Indian attire. Local street vendors and small shops visible. Adjacent buildings showing regional architectural character.`;
  }

  // Middle East
  if (loc.includes("dubai") || loc.includes("abu dhabi") || loc.includes("riyadh") || loc.includes("doha") || loc.includes("qatar") || loc.includes("uae")) {
    return `modern ${location} boulevard with luxury vehicles, date palms, and manicured landscaping. Pedestrians in mix of Western and traditional Gulf attire (kandura/thobe visible). Adjacent towers and modern architecture. Clear desert sky with intense sunlight. Pristine sidewalks and well-maintained street furniture.`;
  }

  // East/Southeast Asia
  if (loc.includes("tokyo") || loc.includes("osaka") || loc.includes("japan")) {
    return `orderly Japanese street in ${location} with compact vehicles, cherry or maple trees, and precise urban infrastructure. Pedestrians in business attire. Clean, well-organized streetscape with distinctive Japanese signage. Adjacent buildings showing characteristic Japanese density and scale.`;
  }
  if (loc.includes("singapore") || loc.includes("bangkok") || loc.includes("kuala lumpur")) {
    return `tropical ${location} street with lush equatorial vegetation, modern vehicles, and diverse pedestrian traffic. Rain trees and tropical palms providing shade. Adjacent buildings showing the city's characteristic mix of modern and heritage architecture. Warm, humid atmosphere.`;
  }

  // Europe
  if (loc.includes("london") || loc.includes("uk") || loc.includes("united kingdom") || loc.includes("manchester") || loc.includes("birmingham")) {
    return `London street with Georgian/Victorian context buildings, black cabs and red buses visible. Mature London plane trees, pedestrians in smart-casual attire. Overcast British sky with soft diffused light. Brick and stone adjacent buildings.`;
  }
  if (loc.includes("berlin") || loc.includes("munich") || loc.includes("germany") || loc.includes("hamburg") || loc.includes("frankfurt")) {
    return `German urban street in ${location} with clean, organized streetscape. Mature linden trees, bicycles parked along the road. Pedestrians in European attire. Adjacent buildings showing characteristic German architectural order. Clear continental European atmosphere.`;
  }
  if (loc.includes("paris") || loc.includes("france")) {
    return "Parisian boulevard with Haussmann-era buildings context, mature chestnut trees, café terraces, pedestrians in elegant attire. Classic wrought-iron balconies on adjacent buildings. Warm Parisian light with slight atmospheric haze.";
  }
  if (loc.includes("stockholm") || loc.includes("copenhagen") || loc.includes("oslo") || loc.includes("scandinavia") || loc.includes("nordic")) {
    return `Nordic streetscape in ${location} with birch trees, clean minimalist urban design. Cyclists and pedestrians in Scandinavian casual wear. Adjacent buildings in characteristic Nordic brick/render. Soft northern light with clean, crisp atmosphere.`;
  }

  // Americas
  if (loc.includes("new york") || loc.includes("manhattan") || loc.includes("brooklyn")) {
    return "New York City streetscape with yellow cabs, fire hydrants, mature honey locusts, diverse pedestrian traffic in urban attire. Brownstones and mixed-height buildings as context. Characteristic NYC energy and density.";
  }
  if (loc.includes("san francisco") || loc.includes("los angeles") || loc.includes("chicago") || loc.includes("miami") || loc.includes("usa") || loc.includes("united states")) {
    return `American urban street in ${location} with local vehicles, street trees, and pedestrian activity. Adjacent buildings reflecting the city's architectural character. Well-maintained sidewalks with American street furniture and signage.`;
  }

  // Climate-based fallback
  if (climateZone.includes("tropical") || climateZone.includes("monsoon")) {
    return `tropical urban street in ${location} with lush vegetation — palms, broad-leafed trees, and flowering plants. Local vehicles and pedestrians. Warm, humid atmosphere with cumulus clouds. Adjacent buildings with climate-responsive features (overhangs, ventilation).`;
  }
  if (climateZone.includes("arid") || climateZone.includes("desert")) {
    return `arid urban setting in ${location} with date palms, xeriscaped landscape. Bright sunlight with sharp shadows. Modern vehicles and pedestrians. Sand-toned adjacent buildings.`;
  }
  if (climateZone.includes("cold") || climateZone.includes("subarctic")) {
    return `cold-climate urban street in ${location} with evergreen trees, clean sidewalks. Bundled-up pedestrians and modern vehicles. Adjacent buildings with heavy insulation and steep roofs. Crisp, clear atmosphere.`;
  }

  // Generic fallback
  return `urban street in ${location} with pedestrian activity (6-8 people visible), street trees providing natural shade, parked cars and passing traffic. Adjacent buildings showing mixed architectural styles. Well-maintained sidewalk with street furniture.`;
}

/**
 * Generates location-specific atmospheric details for photorealistic prompts.
 */
function buildAtmosphericDetails(location: string, climateZone: string): string {
  const loc = location.toLowerCase();

  if (loc.includes("mumbai") || loc.includes("bombay")) {
    return "Slight atmospheric haze typical of coastal Mumbai (humidity visible in distance). Light smoke from street food vendor. Motion blur on passing auto-rickshaw. Wet pavement reflections. Seagulls in distant sky.";
  }
  if (loc.includes("guwahati") || loc.includes("assam") || loc.includes("northeast india")) {
    return "Tropical humidity haze with lush green tones saturated by moisture. Dramatic monsoon clouds in background. Light mist rising from vegetation after rain. Reflections on wet road surface. Distant Brahmaputra river valley visible. Rich, saturated greens dominating the landscape.";
  }
  if (loc.includes("delhi") || loc.includes("noida") || loc.includes("gurgaon") || loc.includes("gurugram")) {
    return "Warm atmospheric haze typical of North Indian plains. Dust particles visible in golden light. Motion blur on traffic. Slight pollution haze softening distant buildings.";
  }

  // Tropical/monsoon climates
  if (climateZone.includes("tropical") || climateZone.includes("monsoon") || loc.includes("india") || loc.includes("southeast asia") || loc.includes("singapore") || loc.includes("bangkok")) {
    return `Tropical humidity with lush saturated colors. Cumulus clouds building in background. Wet pavement reflections from recent rain. Light atmospheric haze from warmth and moisture. Rich green vegetation tones.`;
  }
  // Arid climates
  if (climateZone.includes("arid") || climateZone.includes("desert") || loc.includes("dubai") || loc.includes("riyadh")) {
    return "Crystal-clear atmosphere with intense sunlight. Sharp shadows with minimal diffusion. Heat shimmer visible near ground. Distant buildings crisp against blue sky. Sand-tinted ambient light.";
  }
  // Nordic/cold climates
  if (climateZone.includes("cold") || climateZone.includes("subarctic") || loc.includes("stockholm") || loc.includes("oslo") || loc.includes("helsinki")) {
    return "Clean Nordic air with exceptional clarity. Soft, diffused northern light. Crisp shadows. Minimal atmospheric haze. Pale blue sky with high thin clouds.";
  }

  return "Clear atmospheric depth with slight urban haze. Motion blur on vehicles. Sharp foreground, gradual background softness. Natural depth cues.";
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
  // Use description.location if available and caller didn't provide specific location
  const effectiveLocation = (location === "urban setting" && description.location)
    ? description.location
    : location;

  // Extract key details
  const typology = description.buildingType.toLowerCase();
  const floors = description.floors;
  const facade = description.facade;
  const structure = description.structure;
  const climateZone = description.climateZone ?? "";
  const designImpl = description.designImplications ?? [];

  // Determine location-specific context dynamically
  const contextElements = buildLocationContext(effectiveLocation, climateZone);
  const atmosphericDetails = buildAtmosphericDetails(effectiveLocation, climateZone);
  
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
  
  // Design implications as visible features
  const designFeatures = designImpl.length
    ? `\n\n**Location-Specific Design Features:**\n${designImpl.slice(0, 5).map(d => `- ${d}`).join("\n")}`
    : "";

  // Build comprehensive prompt following 9-element structure
  return `Photorealistic architectural rendering of a ${floors}-story contemporary ${typology} building in ${effectiveLocation}. The building MUST have exactly ${floors} floors — count them carefully.

**Camera & Composition:**
${cameraComposition}

**Time of Day:**
${timeSettings}

**Building Description:**
${floors}-story ${typology} (exactly ${floors} visible floors) with ${facade} facade and ${structure} conceptual structure. The building features ${description.programSummary}. Lower floors have recessed floor-to-ceiling glazing with warm LED lighting visible inside. Upper floors showcase the primary facade system with high-performance tinted glazing. Visible green terrace on upper setback levels. Rooftop with clean architectural profile.

**Materials — Specific Details:**
- **Facade:** ${facade} with subtle reflections of sky and adjacent buildings
- **Glazing:** Tinted low-E glass with light bronze tone, minimal reflection
- **Structure:** ${structure} with clean architectural expression
- **Ground plane:** Honed granite pavers with defined mortar joints
- **Entry:** Recessed with polished metal trim details

**Context & Atmosphere (${effectiveLocation}):**
${contextElements}

**Lighting — Specific:**
${lightingDetails}

**Atmospheric Details:**
${atmosphericDetails}
${designFeatures}

**Style & Rendering Quality:**
Photorealistic architectural visualization, high detail, professional photography composition. Depth of field: sharp focus on building, slight background blur (f/5.6 equivalent). Color grading: ${timeOfDay === "golden hour" ? "warm, saturated, HDR-style contrast" : "balanced, natural, true-to-life colors"}. Reference: Luxigon/MIR/DBOX quality level. No text, watermarks, or labels.`;
}

// ─── generateConceptImage ─────────────────────────────────────────────────────

// ─── Elevation Sketch Generator (GPT-4o → SVG) ─────────────────────────────
//
// Generates a precise architectural elevation SVG that serves as a geometric
// reference for gpt-image-1. This ensures correct floor count, proportions,
// facade rhythm, and building massing — things DALL-E 3 cannot get right.

async function generateElevationSketch(
  description: BuildingDescription,
): Promise<string> {
  const floors = description.floors;
  const floorHeight = 3.5; // metres
  const groundFloorHeight = 4.2; // taller ground floor
  const buildingHeight = groundFloorHeight + (floors - 1) * floorHeight;
  const buildingWidth = description.footprint
    ? Math.sqrt(description.footprint * 1.5) // assume 1.5:1 aspect ratio
    : Math.max(floors * 4, 20); // reasonable width based on floors

  // SVG canvas dimensions (pixels)
  const svgW = 1536;
  const svgH = 1024;
  const margin = 80;
  const groundLevel = svgH - margin - 60; // leave room for ground plane

  // Scale building to fit SVG
  const availH = groundLevel - margin;
  const availW = svgW - margin * 2;
  const scale = Math.min(availW / buildingWidth, availH / buildingHeight) * 0.85;

  const bW = buildingWidth * scale;
  const bH = buildingHeight * scale;
  const bX = (svgW - bW) / 2;
  const bY = groundLevel - bH;

  // Generate window grid
  const windowsPerFloor = Math.max(3, Math.round(buildingWidth / 3));
  const windowW = (bW * 0.6) / windowsPerFloor;
  const windowH = floorHeight * scale * 0.5;
  const windowGapX = (bW - windowsPerFloor * windowW) / (windowsPerFloor + 1);

  let windowsSvg = "";
  for (let f = 0; f < floors; f++) {
    const isGround = f === floors - 1;
    const fH = isGround ? groundFloorHeight * scale : floorHeight * scale;
    const fY = bY + (f === 0 ? 0 : groundFloorHeight * scale + (f - 1) * floorHeight * scale);
    const wH = isGround ? fH * 0.7 : windowH;
    const wY = fY + (fH - wH) / 2;

    for (let w = 0; w < windowsPerFloor; w++) {
      const wX = bX + windowGapX + w * (windowW + windowGapX);
      if (isGround && (w === Math.floor(windowsPerFloor / 2))) {
        // Door/entrance on ground floor center
        windowsSvg += `<rect x="${wX}" y="${wY}" width="${windowW * 1.2}" height="${fH * 0.85}" rx="2" fill="#4a90d9" stroke="#2c3e50" stroke-width="1.5"/>`;
        windowsSvg += `<line x1="${wX + windowW * 0.6}" y1="${wY}" x2="${wX + windowW * 0.6}" y2="${wY + fH * 0.85}" stroke="#2c3e50" stroke-width="1"/>`;
      } else {
        windowsSvg += `<rect x="${wX}" y="${wY}" width="${windowW}" height="${wH}" rx="1" fill="#87CEEB" stroke="#2c3e50" stroke-width="1"/>`;
      }
    }
  }

  // Floor lines
  let floorLines = "";
  for (let f = 1; f < floors; f++) {
    const lineY = bY + groundFloorHeight * scale + (f - 1) * floorHeight * scale;
    floorLines += `<line x1="${bX}" y1="${lineY}" x2="${bX + bW}" y2="${lineY}" stroke="#7f8c8d" stroke-width="0.5" stroke-dasharray="4,2"/>`;
  }

  // Floor labels
  let floorLabels = "";
  for (let f = 0; f < floors; f++) {
    const fY = f === 0
      ? bY + groundFloorHeight * scale * 0.5
      : bY + groundFloorHeight * scale + (f - 1) * floorHeight * scale + floorHeight * scale * 0.5;
    const label = f === floors - 1 ? "GF" : `L${floors - f - 1}`;
    floorLabels += `<text x="${bX - 15}" y="${fY + 4}" text-anchor="end" font-size="11" fill="#555" font-family="Arial">${label}</text>`;
  }

  // Context: ground plane, sky gradient, surrounding context boxes
  const contextSvg = `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#87CEEB"/>
        <stop offset="100%" stop-color="#E0F0FF"/>
      </linearGradient>
    </defs>
    <rect width="${svgW}" height="${svgH}" fill="url(#sky)"/>
    <rect x="0" y="${groundLevel}" width="${svgW}" height="${svgH - groundLevel}" fill="#8B7355"/>
    <rect x="0" y="${groundLevel}" width="${svgW}" height="4" fill="#555"/>
    <!-- Smaller context buildings -->
    <rect x="${bX - bW * 0.5}" y="${groundLevel - bH * 0.4}" width="${bW * 0.3}" height="${bH * 0.4}" fill="#C0C0C0" stroke="#999" stroke-width="0.5" opacity="0.5"/>
    <rect x="${bX + bW + bW * 0.2}" y="${groundLevel - bH * 0.6}" width="${bW * 0.25}" height="${bH * 0.6}" fill="#C0C0C0" stroke="#999" stroke-width="0.5" opacity="0.5"/>
    <!-- Trees -->
    <circle cx="${bX - 30}" cy="${groundLevel - 25}" r="20" fill="#2d8a4e" opacity="0.7"/>
    <rect x="${bX - 33}" y="${groundLevel - 8}" width="6" height="12" fill="#5C4033"/>
    <circle cx="${bX + bW + 40}" cy="${groundLevel - 30}" r="22" fill="#2d8a4e" opacity="0.7"/>
    <rect x="${bX + bW + 37}" y="${groundLevel - 10}" width="6" height="14" fill="#5C4033"/>
  `;

  // Dimension annotation
  const heightAnnotation = `
    <line x1="${bX + bW + 20}" y1="${bY}" x2="${bX + bW + 20}" y2="${groundLevel}" stroke="#333" stroke-width="1" marker-start="url(#arrowUp)" marker-end="url(#arrowDown)"/>
    <text x="${bX + bW + 30}" y="${bY + bH / 2}" font-size="12" fill="#333" font-family="Arial">${Math.round(buildingHeight)}m</text>
    <text x="${bX + bW / 2}" y="${bY - 15}" text-anchor="middle" font-size="14" font-weight="bold" fill="#2c3e50" font-family="Arial">${description.buildingType} — ${floors} Floors</text>
  `;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">
  ${contextSvg}
  <!-- Main building -->
  <rect x="${bX}" y="${bY}" width="${bW}" height="${bH}" fill="#E8DCC8" stroke="#2c3e50" stroke-width="2"/>
  ${floorLines}
  ${windowsSvg}
  ${floorLabels}
  ${heightAnnotation}
</svg>`;

  return svg;
}

// ─── Sketch-to-Render Pipeline (gpt-image-1) ────────────────────────────────
//
// Takes an elevation sketch SVG, converts to PNG, then uses gpt-image-1's
// image edit capability to transform it into a photorealistic render while
// preserving the geometry (floor count, proportions, massing).

async function sketchToRender(
  sketchSvg: string,
  description: BuildingDescription,
  renderPrompt: string,
  viewType: "exterior" | "floor_plan" | "site_plan" | "interior",
  apiKey?: string
): Promise<{ url: string; revisedPrompt: string }> {
  const client = getClient(apiKey, 120000); // 120s for gpt-image-1

  // Convert SVG → PNG via sharp
  const sharp = (await import("sharp")).default;
  const pngBuffer = await sharp(Buffer.from(sketchSvg))
    .resize(1536, 1024, { fit: "contain", background: { r: 230, g: 240, b: 255, alpha: 1 } })
    .png()
    .toBuffer();


  // Create File object for gpt-image-1 (convert Buffer → Uint8Array for type safety)
  const imageFile = new File([new Uint8Array(pngBuffer)], "elevation-sketch.png", { type: "image/png" });

  // Build the render prompt — gpt-image-1 will SEE the sketch and transform it
  const location = description.location ?? description.city ?? "urban setting";
  const climate = description.climateZone ?? "";
  const designImpl = description.designImplications ?? [];

  const fullPrompt =
    `Transform this architectural elevation sketch into an ULTRA-PHOTOREALISTIC exterior photograph. ` +
    `This must look like a REAL PHOTOGRAPH taken with a Canon EOS R5, 35mm lens, f/4, ISO 200 — NOT a 3D render or CGI. ` +
    `CRITICAL REQUIREMENTS: ` +
    `1. FLOOR COUNT: The building has EXACTLY ${description.floors} floors. Preserve the overall massing and proportions from the sketch. ` +
    `2. PHOTOREALISM — this is the MOST IMPORTANT requirement: ` +
    `- Real material DEPTH: concrete shows formwork texture and slight weathering, glass has complex reflections of sky/surroundings/clouds, ` +
    `metal has brushed finish with subtle scratches, stone has natural grain variation. ` +
    `- IMPERFECTIONS that prove reality: slight water staining near drip edges, construction joints visible in facade panels, ` +
    `minor scuff marks near ground level, dust accumulation on horizontal ledges, uneven mortar joints. ` +
    `- LIGHT BEHAVIOR: soft caustic reflections from glass onto adjacent surfaces, color bleeding between materials, ` +
    `subsurface scattering in translucent panels, specular highlights on metal trim that shift with viewing angle. ` +
    `- DEPTH OF FIELD: sharp focus on building center, gentle blur at edges (f/4 bokeh), background buildings slightly soft. ` +
    `- LENS EFFECTS: subtle chromatic aberration at frame edges, natural vignetting, micro lens flare from sun reflections on glass. ` +
    `- NO CGI tells: avoid perfectly uniform surfaces, avoid identical repeating patterns, avoid overly saturated colors, ` +
    `avoid unnaturally sharp edges, avoid plastic-looking materials. Every surface must have micro-variation. ` +
    `3. LOCATION: ${location}. ` +
    `Show authentic local context: real-looking vegetation native to the region, local vehicle types, ` +
    `pedestrians in regionally appropriate attire, signage in local language, street infrastructure matching the city. ` +
    `${climate ? `Climate: ${climate}. Building shows climate-responsive features. ` : ""}` +
    `4. MATERIALS: ${description.facade} facade with realistic aging appropriate for ${climate || "local climate"}. ` +
    `${description.structure} structure. Apply materials with photographic texture quality — each panel slightly different shade, ` +
    `glazing reflects actual sky and surroundings (not uniform blue), structural elements show realistic concrete/steel finish. ` +
    `5. ARCHITECTURE: ${description.buildingType} — ${description.programSummary}. ` +
    `Ground floor: active retail/lobby frontage with warm 3000K interior LED light spilling out through floor-to-ceiling glass. ` +
    `${designImpl.length ? `6. LOCAL DESIGN: ${designImpl.slice(0, 3).join(". ")}. ` : ""}` +
    `7. LIGHTING & ATMOSPHERE: Golden hour (6:15 PM), warm directional sunlight from southwest casting long shadows. ` +
    `Sky gradient from amber horizon to blue zenith with wispy cirrus clouds. Interior lights glowing warm through windows. ` +
    `Atmospheric haze appropriate for ${location} — gives depth and distance to the scene. ` +
    `8. SCENE LIFE: 8-10 pedestrians in natural poses (walking, talking, checking phone), 2-3 vehicles, ` +
    `street trees with individual leaf detail, motion blur on one passing vehicle. ` +
    `${renderPrompt ? `Style notes: ${renderPrompt.slice(0, 150)}. ` : ""}` +
    `QUALITY REFERENCE: This should be indistinguishable from a real photograph in a Dezeen/ArchDaily article. ` +
    `Think Foster + Partners project photography by Nigel Young, or Heatherwick Studio shoots by Hufton+Crow. No text, watermarks, or labels.`;


  // Use gpt-image-1 images.edit — it SEES the sketch and renders it photorealistically
  // input_fidelity: "low" — use sketch as loose reference for massing/floor count,
  // but allow full creative freedom for photorealistic materials, depth, and detail.
  // "medium" produced too-literal/flat results that looked CGI.
  const response = await client.images.edit({
    model: OPENAI_IMAGE_MODEL,
    image: imageFile,
    prompt: fullPrompt,
    size: "1536x1024" as "1024x1024", // landscape for exterior renders (type workaround)
    quality: "high",
    input_fidelity: "low" as "high", // loose reference — preserves massing but allows photorealistic detail
  });

  const image = response.data?.[0];
  if (!image?.url && !image?.b64_json) throw new Error("No image in gpt-image-1 render response");

  // Handle URL or base64 response
  let resultUrl = image.url ?? "";
  if (!resultUrl && image.b64_json) {
    try {
      const { uploadToR2, isR2Configured } = await import("@/lib/r2");
      if (isR2Configured()) {
        const resultBuffer = Buffer.from(image.b64_json, "base64");
        const uploadResult = await uploadToR2(resultBuffer, `concept-render-${Date.now()}.png`, "image/png");
        if (uploadResult.success) {
          resultUrl = uploadResult.url;
        }
      }
    } catch (r2Err) {
      console.warn("[SketchToRender] R2 upload failed, using base64:", r2Err);
    }
    if (!resultUrl) {
      resultUrl = `data:image/png;base64,${image.b64_json}`;
    }
  }

  return {
    url: resultUrl,
    revisedPrompt: fullPrompt,
  };
}

/**
 * Softens an architectural prompt for content-policy retry.
 * Removes commonly-flagged terms while preserving structural intent.
 * Used as a Path-3 retry strategy when Path 2 fails (replaces the legacy
 * DALL-E 3 fallback — DALL-E 3 cannot accept reference images and produces
 * generic output, so retrying with the same model under safer parameters is
 * strictly better).
 */
function softenArchitecturalPromptForRetry(prompt: string): string {
  return prompt
    .replace(/\bdemolish(ed|ing)?\b/gi, "renovate")
    .replace(/\bruins?\b/gi, "weathered structure")
    .replace(/\bblood\w*\b/gi, "warm")
    .replace(/\babandoned\b/gi, "vacant")
    .replace(/\bmilitary\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── generateConceptImage ─────────────────────────────────────────────────────
//
// Primary render pipeline for GN-003. Uses a tiered approach:
// 0. PDF brief reference images → gpt-image-1.5 multi-reference edit (HIGHEST
//    fidelity to user's actual brief; fires when referenceImageUrls supplied)
// 1. BuildingDescription → Elevation Sketch (SVG) → gpt-image-1.5 edit
// 2. String prompt → gpt-image-1.5 generate (good accuracy, no sketch)
// 3. Fallback → gpt-image-1.5 retry with softened prompt + smaller size/quality

export async function generateConceptImage(
  descriptionOrPrompt: BuildingDescription | string,
  style: string = "photorealistic architectural render",
  userApiKey?: string,
  location?: string,
  cameraAngle?: string,
  timeOfDay?: string,
  viewType: "exterior" | "floor_plan" | "site_plan" | "interior" = "exterior",
  /** Optional reference images extracted from a PDF brief (R2 URLs). When
   *  present, Path 0 runs first and feeds them to gpt-image-1.5 images.edit()
   *  so the rendered output is anchored to the user's actual visual brief
   *  (mood photos, site shots, sketches) instead of a generic interpretation. */
  referenceImageUrls?: string[],
): Promise<{ url: string; revisedPrompt: string }> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey, 120000); // 120s for gpt-image-1.5

    // ── Path 0: PDF brief references → multi-reference edit (HIGHEST priority) ──
    // gpt-image-1.5 images.edit() accepts up to 16 reference images. When the
    // user uploaded a PDF brief that contained mood photos / site references,
    // those images are FAR more accurate signal than any text description.
    // Use input_fidelity:"low" — references are mood/style anchors, not
    // literal copies (the rendered building should match the BRIEF's vibe,
    // not pixel-copy the references).
    if (referenceImageUrls && referenceImageUrls.length > 0) {
      try {
        const pdfBriefPrompt = typeof descriptionOrPrompt === "string"
          ? descriptionOrPrompt
          : buildPhotorealisticPrompt(
              descriptionOrPrompt,
              location || "urban setting",
              cameraAngle || "eye-level corner",
              timeOfDay || "golden hour",
            );

        const referenceFiles = await Promise.all(
          referenceImageUrls.slice(0, 16).map(async (url, idx) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch reference ${idx}: ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            return new File([new Uint8Array(buf)], `brief-ref-${idx}.png`, { type: "image/png" });
          }),
        );

        const compositePrompt =
          `${pdfBriefPrompt}\n\n` +
          `IMPORTANT: Use the attached ${referenceFiles.length} reference image(s) ` +
          `from the user's brief as PRIMARY visual inspiration — match their style, ` +
          `materials, atmosphere, and architectural language. Do NOT pixel-copy any ` +
          `reference; produce an original ${viewType} render of the described building ` +
          `that visibly belongs to the same design family as the references. ` +
          `Photorealistic, no text or labels in output.`;

        const size = (viewType === "exterior" || viewType === "interior") ? "1536x1024" : "1024x1024";
        const response = await client.images.edit({
          model: OPENAI_IMAGE_MODEL,
          image: referenceFiles,
          prompt: compositePrompt,
          n: 1,
          size: size as "1024x1024",
          quality: "high",
          input_fidelity: "low" as "high", // mood reference, not literal copy
        });

        const { url, revisedPrompt } = await normalizeImageResponse(
          response.data?.[0],
          "concept-pdf-brief",
        );
        return { url, revisedPrompt: revisedPrompt || compositePrompt };
      } catch (pdfRefErr) {
        console.warn(
          "[generateConceptImage] PDF reference path failed, falling through to sketch/text paths:",
          pdfRefErr,
        );
        // Fall through to Path 1
      }
    }

    // ── Path 1: BuildingDescription → Sketch → gpt-image-1 Render (highest accuracy) ──
    if (typeof descriptionOrPrompt !== "string" && viewType === "exterior") {
      try {

        // Generate the architectural elevation sketch
        const sketchSvg = await generateElevationSketch(descriptionOrPrompt);

        // Generate enhanced prompt for the render
        let renderStyle = style;
        try {
          renderStyle = await enhanceArchitecturalPrompt(descriptionOrPrompt, viewType, style, userApiKey);
        } catch { /* use default style */ }

        // Transform sketch into photorealistic render via gpt-image-1
        return await sketchToRender(sketchSvg, descriptionOrPrompt, renderStyle, viewType, userApiKey);
      } catch (sketchErr) {
        console.warn("[generateConceptImage] Sketch pipeline failed, falling back to gpt-image-1 generate:", sketchErr);
        // Fall through to Path 2
      }
    }

    // ── Path 2: Enhanced prompt → gpt-image-1 generate (good accuracy) ──
    let imagePrompt: string;

    if (typeof descriptionOrPrompt === "string") {
      imagePrompt = descriptionOrPrompt;
    } else {
      try {
        imagePrompt = await enhanceArchitecturalPrompt(
          descriptionOrPrompt,
          viewType,
          style,
          userApiKey
        );
      } catch (enhanceErr) {
        console.error("[generateConceptImage] enhanceArchitecturalPrompt failed, using photorealistic fallback:", enhanceErr);
        imagePrompt = buildPhotorealisticPrompt(
          descriptionOrPrompt,
          location || "urban setting",
          cameraAngle || "eye-level corner",
          timeOfDay || "golden hour"
        );
      }
    }

    // Use gpt-image-1.5 for generation (text-correct, extraction-grade)
    try {
      const size = (viewType === "exterior" || viewType === "interior") ? "1536x1024" : "1024x1024";
      const response = await client.images.generate({
        model: OPENAI_IMAGE_MODEL,
        prompt: imagePrompt,
        n: 1,
        size: size as "1024x1024", // type workaround for extended sizes
        quality: "high",
      });

      const image = response.data?.[0];
      let resultUrl = image?.url ?? "";

      // Handle base64 response from gpt-image-1
      if (!resultUrl && image?.b64_json) {
        try {
          const { uploadToR2, isR2Configured } = await import("@/lib/r2");
          if (isR2Configured()) {
            const resultBuffer = Buffer.from(image.b64_json, "base64");
            const uploadResult = await uploadToR2(resultBuffer, `concept-render-${Date.now()}.png`, "image/png");
            if (uploadResult.success) resultUrl = uploadResult.url;
          }
        } catch { /* ignore R2 errors */ }
        if (!resultUrl) resultUrl = `data:image/png;base64,${image.b64_json}`;
      }

      if (!resultUrl) throw new Error("No image in gpt-image-1 response");
      return {
        url: resultUrl,
        revisedPrompt: image?.revised_prompt ?? imagePrompt,
      };
    } catch (gptImgErr) {
      // ── Path 3: Retry gpt-image-1.5 with softened prompt + smaller size ──
      // Replaces the legacy DALL-E 3 fallback. DALL-E 3 cannot accept reference
      // images and produces generic output; retrying with the same model under
      // safer parameters (softened prompt, 1024x1024, medium quality) is strictly
      // better than switching models. Common Path-2 failures this recovers:
      //   - content policy rejections (softened prompt usually passes)
      //   - timeouts (smaller image is faster)
      //   - transient 5xx (clean retry)
      console.warn("[generateConceptImage] gpt-image-1.5 path 2 failed, retrying with softened prompt:", gptImgErr);
      const fallbackClient = getClient(userApiKey, 60000);
      const softened = softenArchitecturalPromptForRetry(imagePrompt);
      const response = await fallbackClient.images.generate({
        model: OPENAI_IMAGE_MODEL,
        prompt: softened,
        n: 1,
        size: "1024x1024",
        quality: "medium",
      });

      const { url, revisedPrompt } = await normalizeImageResponse(response.data?.[0], "concept-fallback");
      return { url, revisedPrompt: revisedPrompt || softened };
    }
  });
}

// ─── Claude Vision QA — Render Accuracy Validation ──────────────────────────
//
// Uses Claude to verify the generated render matches the architectural spec.
// Checks: floor count, building type recognition, context/location accuracy.
// Returns a pass/fail with specific feedback for regeneration if needed.

export interface RenderQAResult {
  passed: boolean;
  floorCountCorrect: boolean;
  detectedFloors: number;
  locationContextCorrect: boolean;
  feedback: string;
}

export async function validateRenderWithClaude(
  imageUrl: string,
  description: BuildingDescription,
): Promise<RenderQAResult> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("[RenderQA] No ANTHROPIC_API_KEY — skipping QA");
      return { passed: true, floorCountCorrect: true, detectedFloors: description.floors, locationContextCorrect: true, feedback: "QA skipped (no API key)" };
    }

    const client = new Anthropic({ apiKey });

    // Fetch image and convert to base64 for Claude
    let imageContent: { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } } | { type: "image"; source: { type: "url"; url: string } };
    if (imageUrl.startsWith("data:")) {
      const b64 = imageUrl.split(",")[1] ?? "";
      imageContent = { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } };
    } else {
      // Fetch the image and convert to base64
      try {
        const resp = await fetch(imageUrl);
        const buffer = Buffer.from(await resp.arrayBuffer());
        imageContent = { type: "image", source: { type: "base64", media_type: "image/png", data: buffer.toString("base64") } };
      } catch {
        console.warn("[RenderQA] Failed to fetch image for QA");
        return { passed: true, floorCountCorrect: true, detectedFloors: description.floors, locationContextCorrect: true, feedback: "QA skipped (image fetch failed)" };
      }
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          imageContent,
          {
            type: "text",
            text: `You are an architectural render quality checker. Analyze this building render and answer in JSON:

SPECIFICATION:
- Expected floors: ${description.floors}
- Building type: ${description.buildingType}
- Location: ${description.location ?? description.city ?? "not specified"}
- Facade: ${description.facade}

COUNT THE FLOORS CAREFULLY. Look at distinct horizontal floor levels/bands/window rows from ground to roof.

Respond with JSON only:
{
  "detectedFloors": <number of floors you count>,
  "floorCountCorrect": <true if detected matches ${description.floors} ±1>,
  "locationContextCorrect": <true if the setting/vegetation/atmosphere matches the specified location>,
  "buildingTypeMatch": <true if it looks like a ${description.buildingType}>,
  "feedback": "<specific issues found, or 'Render matches specification' if accurate>"
}`
          }
        ]
      }]
    });

    const text = response.content.find(b => b.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { passed: true, floorCountCorrect: true, detectedFloors: description.floors, locationContextCorrect: true, feedback: "QA parse failed — assuming pass" };
    }

    const qa = JSON.parse(jsonMatch[0]) as {
      detectedFloors: number;
      floorCountCorrect: boolean;
      locationContextCorrect: boolean;
      buildingTypeMatch: boolean;
      feedback: string;
    };

    const passed = qa.floorCountCorrect && qa.locationContextCorrect && qa.buildingTypeMatch;

    return {
      passed,
      floorCountCorrect: qa.floorCountCorrect,
      detectedFloors: qa.detectedFloors,
      locationContextCorrect: qa.locationContextCorrect,
      feedback: qa.feedback,
    };
  } catch (err) {
    console.warn("[RenderQA] Claude QA error:", err);
    return { passed: true, floorCountCorrect: true, detectedFloors: description.floors, locationContextCorrect: true, feedback: "QA error — assuming pass" };
  }
}

// ─── generateRenovationRender ─────────────────────────────────────────────────
//
// Uses OpenAI's gpt-image-1 model via the images.edit endpoint to transform
// the user's ACTUAL building photo into a renovated version.
// Unlike DALL-E 3 (text-to-image only), gpt-image-1 SEES the input image and
// edits it — preserving the exact building structure, proportions, and geometry
// while applying new materials, extensions, and landscaping.

export async function generateRenovationRender(
  imageBase64: string,
  buildingAnalysis: string,
  mimeType: string = "image/jpeg",
  userApiKey?: string,
): Promise<{ url: string; revisedPrompt: string; renovationPrompt: string }> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey, 120000); // 120s — image editing can be slow

    // Convert base64 to a File object for the images.edit API
    const cleanBase64 = imageBase64.startsWith("data:") ? imageBase64.split(",")[1] ?? imageBase64 : imageBase64;
    const imageBuffer = Buffer.from(cleanBase64, "base64");
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    const imageFile = new File([imageBuffer], `building.${ext}`, { type: mimeType });

    // Craft the renovation prompt — gpt-image-1 will SEE the actual building
    // and modify it while preserving structure, proportions, and geometry.
    // Keep the prompt SHORT — gpt-image-1 with input_fidelity:"high" already preserves structure.
    // Long, detailed prompts confuse the model and cause reframing/cropping.
    const renovationPrompt =
      `Restore this building to BRAND NEW condition. Keep the EXACT same framing, angle, composition. ` +
      `Do NOT crop, zoom, or reframe. Output must show the same view as input. ` +
      `IMPORTANT: Remove ALL imperfections — every scratch, crack, stain, tear, peeling paint, ` +
      `discoloration, water damage, graffiti, moss, mold, rust, chipping. ` +
      `Every wall surface must be PERFECTLY SMOOTH, freshly painted, and flawless — like a brand new building. ` +
      `No visible damage of any kind. Pristine, polished, immaculate surfaces throughout. ` +
      `Clean sparkling windows (same positions and sizes). Fresh, well-maintained surroundings. ` +
      `The building must look like it was just built yesterday — but keep the same architecture and style. ` +
      `Ultra-realistic photograph, not a render.`;


    // Use gpt-image-1 images.edit — this model SEES the input image and edits it
    // input_fidelity: "high" ensures the output closely matches the input structure
    // Use "auto" size to preserve the original photo's aspect ratio (avoids cropping wide shots)
    // Fallback to 1536x1024 if auto is not supported
    let response;
    try {
      response = await client.images.edit({
        model: OPENAI_IMAGE_MODEL,
        image: imageFile,
        prompt: renovationPrompt,
        size: "auto" as "1024x1024",
        quality: "high",
        input_fidelity: "high",
      });
    } catch (autoErr) {
      console.warn("[RenovationRender] 'auto' size not supported, falling back to 1536x1024:", autoErr);
      response = await client.images.edit({
        model: OPENAI_IMAGE_MODEL,
        image: imageFile,
        prompt: renovationPrompt,
        size: "1536x1024" as "1024x1024",
        quality: "high",
        input_fidelity: "high",
      });
    }

    const image = response.data?.[0];
    if (!image?.url && !image?.b64_json) throw new Error("No image in gpt-image-1 renovation response");

    // gpt-image-1 returns b64_json by default — we need a URL for Kling
    let resultUrl = image.url ?? "";
    if (!resultUrl && image.b64_json) {
      // Upload the base64 result to R2 for a public URL
      try {
        const { uploadToR2, isR2Configured } = await import("@/lib/r2");
        if (isR2Configured()) {
          const resultBuffer = Buffer.from(image.b64_json, "base64");
          const uploadResult = await uploadToR2(resultBuffer, `renovation-render-${Date.now()}.png`, "image/png");
          if (uploadResult.success) {
            resultUrl = uploadResult.url;
          }
        }
      } catch (r2Err) {
        console.warn("[RenovationRender] R2 upload failed:", r2Err);
      }

      // Fallback: pass as data URI (Kling accepts base64)
      if (!resultUrl) {
        resultUrl = image.b64_json; // raw base64 — Kling can handle this
      }
    }


    return {
      url: resultUrl,
      revisedPrompt: renovationPrompt,
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

// ─── AI Prompt → Room Program parser ─────────────────────────────────────────

export interface AIParsedRoomProgram {
  buildingType: string;
  totalAreaSqm: number;
  numFloors: number;
  rooms: Array<{ name: string; type: string; areaSqm: number }>;
}

/**
 * Uses GPT-4o to parse a natural language prompt into a structured room program.
 * Handles anything: "5bhk villa with home theater", "dental clinic", "farmhouse with outhouse".
 * Falls back to regex-based parsing if the API call fails.
 */
export async function parsePromptWithAI(
  prompt: string,
  userApiKey?: string
): Promise<AIParsedRoomProgram> {
  const client = getClient(userApiKey);

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert architectural space programmer. Given a building description, output a JSON room program with realistic room sizes.

RULES:
- Include ALL rooms the user mentions explicitly
- Add essential rooms the user didn't mention:
  - Residential: kitchen, at least 1 bathroom, living area, corridor/hallway (if 2+ bedrooms)
  - Commercial: reception, restrooms, corridors
- "BHK" = bedrooms + hall + kitchen. "3BHK" means 3 bedrooms + living/hall + kitchen
- Every bedroom gets an attached bathroom (unless user specifies otherwise)
- For 3+ bedrooms: add utility room
- For villa/bungalow/house: add verandah/porch
- If user mentions special rooms (home theater, gym, pool, dance studio, servant quarter), include them with appropriate sizes
- Use realistic Indian residential room sizes in square meters
- Total area should match what's realistic for the building type and room count

ROOM TYPE VALUES (use ONLY these): living, dining, kitchen, bedroom, bathroom, hallway, entrance, utility, balcony, office, storage, staircase, other

SIZE GUIDELINES (sqm):
- Master Bedroom: 14-20, Other Bedrooms: 10-15
- Living Room: 15-30, Dining Room: 10-15, Living+Dining: 20-35
- Kitchen: 7-12, Bathroom: 3-5
- Corridor/Hallway: 5-10, Utility: 3-5
- Balcony/Verandah: 5-12
- Home Theater: 15-25, Gym: 10-20, Study/Office: 8-12

OUTPUT ONLY THIS JSON:
{
  "buildingType": "Residential Villa",
  "totalAreaSqm": 200,
  "numFloors": 1,
  "rooms": [
    { "name": "Living Room", "type": "living", "areaSqm": 25 },
    { "name": "Master Bedroom", "type": "bedroom", "areaSqm": 16 }
  ]
}`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned empty response for room program");

  const parsed = JSON.parse(content) as AIParsedRoomProgram;

  // Validate
  if (!parsed.rooms || !Array.isArray(parsed.rooms) || parsed.rooms.length === 0) {
    throw new Error("AI returned no rooms in room program");
  }

  // Ensure all rooms have required fields
  for (const room of parsed.rooms) {
    if (!room.name) room.name = "Room";
    if (!room.type) room.type = "other";
    if (!room.areaSqm || room.areaSqm <= 0) room.areaSqm = 10;
  }

  if (!parsed.totalAreaSqm || parsed.totalAreaSqm <= 0) {
    parsed.totalAreaSqm = parsed.rooms.reduce((s, r) => s + r.areaSqm, 0);
  }
  if (!parsed.numFloors || parsed.numFloors <= 0) parsed.numFloors = 1;
  if (!parsed.buildingType) parsed.buildingType = "Residential Apartment";

  return parsed;
}

// ─── Main generateFloorPlan function ────────────────────────────────────────

import type { EnhancedRoomProgram } from "@/features/floor-plan/lib/ai-room-programmer";

export async function generateFloorPlan(
  description: BuildingDescription | Record<string, unknown>,
  userApiKey?: string,
  roomProgram?: EnhancedRoomProgram,
): Promise<FloorPlanResult> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    const d = description as Partial<BuildingDescription>;
    const floors = d.floors ?? 2;
    const totalArea = d.totalArea ?? 2500;
    const typology = d.buildingType ?? "Residential";
    const floorPlate = Math.round(totalArea / floors);

    // ── PRIMARY PATH: Deterministic layout engine ─────────────────────
    // If we have a structured room program from Stage 1, use the BSP engine.
    // This produces architecturally correct layouts without any AI calls.
    // Falls through to GPT-4o if the engine fails or isn't available.
    if (roomProgram) {
      try {
        const { layoutFloorPlan } = await import("@/features/floor-plan/lib/layout-engine");
        const placed = layoutFloorPlan(roomProgram);

        if (placed.length > 0) {
          // Validate the deterministic layout
          const { validateRoomLayout } = await import("@/features/floor-plan/lib/layout-validator");
          const validation = validateRoomLayout(
            placed, placed.reduce((maxX, r) => Math.max(maxX, r.x + r.width), 0),
            placed.reduce((maxY, r) => Math.max(maxY, r.y + r.depth), 0),
            roomProgram.adjacency, roomProgram.entranceRoom,
          );

          if (validation.score >= 50) {
            // Layout engine succeeded — build result
            const fpWidthM = placed.reduce((mx, r) => Math.max(mx, r.x + r.width), 0);
            const fpHeightM = placed.reduce((mx, r) => Math.max(mx, r.y + r.depth), 0);
            const title = `${typology} — Floor Plan`;

            // Convert to PositionedRoom format
            const posRooms: PositionedRoom[] = placed.map(r => ({
              name: r.name, type: r.type, area: r.area,
              x: r.x, y: r.y, width: r.width, depth: r.depth,
            }));

            const sharedWalls = findSharedWalls(posRooms);

            const margin = 50;
            const drawW = 700;
            const drawH = 490;
            const pxPerMeter = Math.min(drawW / fpWidthM, drawH / fpHeightM);
            const planW = fpWidthM * pxPerMeter;
            const planH = fpHeightM * pxPerMeter;
            const ox = margin + (drawW - planW) / 2;
            const oy = margin + (drawH - planH) / 2;

            const svg = renderArchitecturalSvg(posRooms, sharedWalls, title, pxPerMeter, fpWidthM, fpHeightM, ox, oy);
            const roomList = posRooms.map(r => ({ name: r.name, area: snap(r.width * r.depth), unit: "m²" }));


            return {
              svg, roomList, totalArea, floors,
              positionedRooms: posRooms.map(r => ({
                name: r.name, type: r.type, x: r.x, y: r.y,
                width: r.width, depth: r.depth, area: snap(r.width * r.depth),
              })),
            };
          } else {
            console.warn(`[generateFloorPlan] Layout engine score too low (${validation.score}/100), falling back to GPT-4o`);
          }
        }
      } catch (engineErr) {
        console.warn("[generateFloorPlan] Layout engine failed, falling back to GPT-4o:", engineErr);
      }
    }

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

    // ── Build zone-aware layout instructions ─────────────────────────
    let zoneInstructions = "";
    let adjacencyInstructions = "";
    if (roomProgram) {
      // Zone placement rules
      const zoneLines: string[] = [];
      if (roomProgram.zones.public.length > 0) {
        zoneLines.push(`PUBLIC ZONE (bottom/south of plan, higher y): ${roomProgram.zones.public.join(", ")}`);
      }
      if (roomProgram.zones.private.length > 0) {
        zoneLines.push(`PRIVATE ZONE (top/north of plan, lower y): ${roomProgram.zones.private.join(", ")}`);
      }
      if (roomProgram.zones.service.length > 0) {
        zoneLines.push(`SERVICE ZONE (interior or grouped together): ${roomProgram.zones.service.join(", ")}`);
      }
      if (roomProgram.zones.circulation.length > 0) {
        zoneLines.push(`CIRCULATION (connects public ↔ private): ${roomProgram.zones.circulation.join(", ")}`);
      }
      zoneInstructions = `\n\nZONE PLACEMENT (follow these strictly):\n${zoneLines.join("\n")}`;

      // Adjacency constraints
      if (roomProgram.adjacency.length > 0) {
        const adjLines = roomProgram.adjacency.map(a =>
          `- "${a.roomA}" MUST share a wall with "${a.roomB}" (${a.reason})`
        );
        adjacencyInstructions = `\n\nREQUIRED ADJACENCIES (rooms must share a wall):\n${adjLines.join("\n")}`;
      }

      // Exterior wall requirements
      const extWallRooms = roomProgram.rooms
        .filter(r => r.mustHaveExteriorWall)
        .map(r => r.name);
      if (extWallRooms.length > 0) {
        zoneInstructions += `\n\nMUST HAVE EXTERIOR WALL (at least one edge on footprint boundary):\n${extWallRooms.join(", ")}`;
      }

      if (roomProgram.circulationNotes) {
        zoneInstructions += `\n\nCIRCULATION STRATEGY: ${roomProgram.circulationNotes}`;
      }
    }

    // ── Step 1: Ask AI for positioned room layout (with retry) ──────
    const MAX_ATTEMPTS = 2;
    let lastAttemptRooms: PositionedRoom[] | null = null;
    let lastValidationFeedback = "";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        {
          role: "system",
          content: `You are an expert architect creating a precise, dimensioned floor plan layout.
Given a building brief, generate rooms with EXACT positions and dimensions in meters.

COORDINATE SYSTEM:
- Origin (0,0) is the top-left corner of the building
- x increases to the right, y increases downward
- Each room: x (left edge), y (top edge), width (x-axis), depth (y-axis)

CRITICAL TILING RULES:
1. ALL rooms MUST tile PERFECTLY within the footprint rectangle — NO gaps, NO overlaps
2. Room edges MUST align exactly. If two rooms share a wall, their coordinates must match to 0.1m precision
3. Every point inside the footprint must belong to exactly one room. Partition the rectangle into smaller rectangles.
4. Room width:depth ratio must be between 0.5 and 3.0 (corridors may be up to 1:4)
5. Sum of all room areas must equal footprint width × depth (within 2%)
6. After placing rooms, verify: for each room, x + width ≤ footprint width AND y + depth ≤ footprint depth

LAYOUT STRATEGY (think step by step):
1. Divide the footprint into 2-3 horizontal bands (rows). Each row spans the full width.
2. Subdivide each row into rooms. Room widths in a row must sum to exactly the footprint width.
3. Row depths must sum to exactly the footprint depth.
4. Place public/entrance rooms in the bottom row (highest y). Place private rooms in the top row (lowest y). Service rooms go in the middle.
${zoneInstructions}
${adjacencyInstructions}

ARCHITECTURAL RULES:
- Kitchen adjacent to dining. Master bedroom adjacent to master bath
- Wet rooms (bath, kitchen, utility) should cluster for shared plumbing
- Bedrooms, living room, and kitchen MUST have at least one exterior wall
- Bathrooms, storage, utility CAN be interior rooms
- Entrance should be at the bottom of the plan (high y)

ROOM TYPES: living, dining, kitchen, bedroom, bathroom, hallway, corridor, entrance, utility, balcony, office, storage, staircase, other

MINIMUM AREAS: bedroom ≥ 10m², living ≥ 15m², kitchen ≥ 7m², bathroom ≥ 3.5m², corridor ≥ 4m²

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

REQUIRED ROOMS (generate ALL of these, EXACTLY as listed):
${d.program && Array.isArray(d.program) && d.program.length > 0
  ? d.program.map((p, i) => `  ${i + 1}. "${p.space}" — ${p.area_m2 ? `${p.area_m2} m²` : "auto-size"}`).join("\n")
  : `Program: ${programDetail}`}
${narrativeContext ? `\nDescription: ${narrativeContext.substring(0, 500)}` : ""}
${programSummaryContext ? `\nSummary: ${programSummaryContext}` : ""}

CRITICAL CONSTRAINTS:
- Output EXACTLY ${d.program?.length ?? "the listed"} rooms — no more, no less
- Use the EXACT room names listed above
- Rooms MUST perfectly tile the ${fpWidthM}m × ${fpHeightM}m rectangle with NO gaps and NO overlaps
- x + width ≤ ${fpWidthM} and y + depth ≤ ${fpHeightM} for ALL rooms
- Room areas MUST sum to approximately ${floorPlate} m²
- Think in horizontal rows: divide depth into rows, then subdivide each row by width`,
        },
      ];

      // If this is a retry, add validation feedback
      if (attempt > 0 && lastValidationFeedback) {
        messages.push({
          role: "assistant",
          content: JSON.stringify({ rooms: lastAttemptRooms, title: `${typology} — Floor Plan` }),
        });
        messages.push({
          role: "user",
          content: `Your previous layout has issues. Fix ALL of these problems:\n\n${lastValidationFeedback}\n\nGenerate a corrected layout. Same rooms, same footprint (${fpWidthM}m × ${fpHeightM}m), but fix the tiling issues.`,
        });
      }

      const completion = await client.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages,
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

      // ── Post-generation: inject missing required rooms ──────────────
      if (d.program && Array.isArray(d.program) && d.program.length > 0) {
        const aiRoomNames = new Set(aiResult.rooms.map(r => r.name.toLowerCase().trim()));
        const missing: Array<{ space: string; area_m2?: number }> = [];
        for (const req of d.program) {
          const reqName = req.space.toLowerCase().trim();
          const found = aiRoomNames.has(reqName) ||
            [...aiRoomNames].some(n => n.includes(reqName) || reqName.includes(n));
          if (!found) missing.push(req);
        }
        if (missing.length > 0) {
          console.warn(`[generateFloorPlan] AI missed ${missing.length} rooms: ${missing.map(m => m.space).join(", ")}. Injecting.`);
          for (const m of missing) {
            const area = m.area_m2 ?? 12;
            const w = snap(Math.sqrt(area * 1.3));
            const h = snap(area / w);
            aiResult.rooms.push({
              name: m.space, area, type: detectRoomType(m.space),
              x: 0, y: 0, width: w, depth: h,
            });
          }
        }
      }

      // ── Check if AI returned positioned rooms ──────────────────────
      const hasPositions = aiResult.rooms.every(r =>
        typeof r.x === "number" && typeof r.y === "number" &&
        typeof r.width === "number" && typeof r.depth === "number"
      );

      if (hasPositions) {
        let posRooms: PositionedRoom[] = aiResult.rooms.map(r => ({
          name: r.name,
          area: r.area ?? snap(r.width! * r.depth!),
          type: r.type ?? detectRoomType(r.name),
          x: r.x!, y: r.y!, width: r.width!, depth: r.depth!,
        }));

        // Stage 2b: Validate the layout
        const { validateRoomLayout, formatValidationErrors } = await import("@/features/floor-plan/lib/layout-validator");
        const validation = validateRoomLayout(
          posRooms, fpWidthM, fpHeightM,
          roomProgram?.adjacency, roomProgram?.entranceRoom,
        );

        if (!validation.valid && attempt < MAX_ATTEMPTS - 1) {
          // Retry: feed errors back to GPT-4o
          console.warn(`[generateFloorPlan] Attempt ${attempt + 1} validation score ${validation.score}/100, retrying...`);
          lastAttemptRooms = posRooms;
          lastValidationFeedback = formatValidationErrors(validation);
          continue; // retry loop
        }

        if (validation.score < 100) {
        }

        // Apply geometric fixes (snap, clamp, overlap resolution)
        posRooms = validateLayout(posRooms, fpWidthM, fpHeightM);

        const title = aiResult.title ?? `${typology} — Floor Plan`;
        const sharedWalls = findSharedWalls(posRooms);

        const margin = 50;
        const drawW = 700;
        const drawH = 490;
        const pxPerMeter = Math.min(drawW / fpWidthM, drawH / fpHeightM);
        const planW = fpWidthM * pxPerMeter;
        const planH = fpHeightM * pxPerMeter;
        const ox = margin + (drawW - planW) / 2;
        const oy = margin + (drawH - planH) / 2;

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
      const title = aiResult.title ?? `${typology} — Floor Plan`;
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

      const margin = 50;
      const drawW = 700;
      const drawH = 490;
      const pxPerMeter = Math.min(drawW / fpWidthM, drawH / fpHeightM);
      const planW = fpWidthM * pxPerMeter;
      const planH = fpHeightM * pxPerMeter;
      const ox = margin + (drawW - planW) / 2;
      const oy = margin + (drawH - planH) / 2;

      const rects = layoutTreemap(rooms, ox, oy, planW, planH);
      const svg = renderFloorPlanSvg(rects, title, pxPerMeter, planW, planH, ox, oy);
      const roomList = rooms.map(r => ({ name: r.name, area: r.area, unit: "m²" }));

      return { svg, roomList, totalArea, floors };
    }

    // Should not reach here, but just in case all attempts exhausted without return
    throw new Error("Floor plan generation failed after all attempts");
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
  /** R2 URLs of reference images extracted from the PDF (mood photos, site
   *  shots, mood-board pages). Downstream image-generation nodes pass these
   *  to gpt-image-1.5 images.edit() so the rendered output is anchored to
   *  the user's actual visual references instead of generic interpretation. */
  referenceImageUrls?: string[];
}

export async function parseBriefDocument(
  pdfText: string,
  userApiKey?: string,
  /** Optional raw PDF buffer. When provided, embedded raster images are
   *  extracted, ranked, and uploaded to R2 — their URLs are returned in
   *  ParsedBrief.referenceImageUrls. Backward compatible: callers passing
   *  only text continue to receive a text-only ParsedBrief. */
  pdfBuffer?: Buffer,
): Promise<ParsedBrief> {
  // Kick off image extraction in parallel with text parsing — the two
  // operations are independent and the wall-clock saving is meaningful
  // (extraction + upload can take 2-4s on a typical brief).
  const referenceImagesPromise: Promise<string[]> = pdfBuffer
    ? import("./pdf-image-extractor")
        .then((m) => m.extractAndUploadBriefReferenceImages(pdfBuffer))
        .catch((err) => {
          console.warn("[parseBriefDocument] reference image extraction failed:", err);
          return [];
        })
    : Promise.resolve([]);

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
    const referenceImageUrls = await referenceImagesPromise;

    return {
      ...parsed,
      projectTitle: parsed.projectTitle || "Untitled Project",
      projectType: parsed.projectType || "unknown",
      rawText: text,
      ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
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


  // Save SVG for debugging
  try {
    const fs = await import("fs");
    const path = await import("path");
    fs.writeFileSync(path.join(process.cwd(), "public", "debug-floor-plan.svg"), svgContent);
  } catch {
  }

  // Parse SVG using existing parser
  const { parseSVGtoFloorPlan } = await import("./claude-vision");
  const result = parseSVGtoFloorPlan(svgContent);
  result.svgContent = svgContent;

  for (const r of result.rooms) {
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

// ─── Photorealistic Floor Plan Render (gpt-image-1.5) ───────────────────────

/**
 * Generates a photorealistic dollhouse render of a floor plan.
 *
 * Architectural fix (2026-04): the previous implementation flattened room
 * data into a text prompt and called images.generate() with no reference
 * image — the model never saw the actual layout, so the output was generic.
 * Now we rasterize the room layout into a PNG via floor-plan-rasterizer.ts
 * and pass it to images.edit() with input_fidelity:"high". The model sees
 * the geometry directly and preserves room positions and proportions.
 *
 * Returns the image as a base64 data URL (the GN-011 Three.js scene
 * embeds it directly without fetching).
 */
export async function generateFloorPlanRender(
  rooms: Array<{ name: string; type: string; width: number; depth: number; x?: number; y?: number }>,
  buildingDimensions: { width: number; depth: number },
  options?: {
    style?: "modern" | "scandinavian" | "industrial" | "luxury" | "minimal";
    userApiKey?: string;
  },
): Promise<{ imageUrl: string; revisedPrompt: string }> {
  const client = getClient(options?.userApiKey, 120000); // 120s — gpt-image-1.5 high-quality renders
  const style = options?.style ?? "modern";

  const styleDescriptions: Record<string, string> = {
    modern: "clean contemporary design with warm wood floors, white walls, designer furniture, indoor plants, and natural light streaming through large windows",
    scandinavian: "Scandinavian hygge style with light oak floors, white and soft gray palette, cozy textiles, minimalist furniture, candles, and warm ambient lighting",
    industrial: "industrial loft style with polished concrete floors, exposed brick walls, metal fixtures, Edison bulbs, and reclaimed wood furniture",
    luxury: "luxury high-end interior with marble floors, gold accents, velvet furniture, crystal chandelier, floor-to-ceiling windows, and designer artwork",
    minimal: "Japanese-inspired minimalist design with tatami mats, shoji screens, low furniture, neutral earth tones, and zen garden elements",
  };

  // Pass the room semantics in the prompt so each room gets appropriate furniture.
  // The schematic provides geometry; this list provides "what each labelled room is for".
  const roomSemantics = rooms
    .map((r) => `${r.name} (${r.type})`)
    .join(", ");

  const prompt =
    `Photorealistic architectural dollhouse cutaway from above at a 45-degree angle, ` +
    `matching the EXACT floor plan layout shown in the reference image. The roof and ` +
    `ceiling are completely removed, like a miniature model home seen from above. ` +
    `EVERY ROOM in the reference must be present, in the SAME POSITION and SAME ` +
    `PROPORTIONS as drawn. Rooms: ${roomSemantics}. Each room is fully furnished ` +
    `and decorated in ${styleDescriptions[style]}. Real wood plank floors in living ` +
    `spaces, clean white walls with subtle shadows between rooms. Each room has ` +
    `appropriate furniture for its labelled type. Warm golden-hour sunlight streaming ` +
    `through windows casting soft long shadows across the interior. Photorealistic, ` +
    `architectural visualization quality, tilt-shift depth of field, 8K detail. ` +
    `IGNORE any text labels in the reference image — render the OUTPUT with NO text, ` +
    `NO labels, NO annotations, NO people. Match the reference floor plan exactly.`;

  return handleOpenAICall(async () => {
    // Rasterize the room layout to a PNG. This is the accuracy anchor —
    // gpt-image-1.5 with input_fidelity:"high" preserves the room positions
    // and proportions exactly, fixing the "generic output" failure mode of
    // the previous text-only DALL-E 3 implementation.
    const { rasterizeFloorPlanToPng } = await import("./floor-plan-rasterizer");
    const layoutPng = await rasterizeFloorPlanToPng(rooms, buildingDimensions);
    const layoutFile = new File([new Uint8Array(layoutPng)], "floor-plan.png", {
      type: "image/png",
    });

    const response = await client.images.edit({
      model: OPENAI_IMAGE_MODEL,
      image: layoutFile,
      prompt,
      n: 1,
      size: "1536x1024" as "1024x1024", // 3:2 landscape; closest supported aspect to old 1792x1024
      quality: "high",
      input_fidelity: "high", // critical: preserve the room layout exactly
    });

    const { url, revisedPrompt } = await normalizeImageResponse(
      response.data?.[0],
      "floor-plan-render",
    );

    // GN-011 consumer expects a data URL embeddable directly in Three.js;
    // convert if R2 returned an HTTP URL.
    const imageUrl = url.startsWith("http") ? await fetchAsDataUrl(url) : url;

    return { imageUrl, revisedPrompt: revisedPrompt || prompt };
  });
}
