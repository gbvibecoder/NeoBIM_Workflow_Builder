import OpenAI from "openai";
import { detectOpenAIError, APIError } from "@/lib/user-errors";

function getClient(userApiKey?: string): OpenAI {
  const key = userApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OpenAI API key configured");
  return new OpenAI({ apiKey: key });
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
  const floorMatch = prompt.match(/(\d+)[-\s]?(story|stories|floor|floors)/i);
  if (floorMatch) requirements.floors = parseInt(floorMatch[1]);
  const cities = ["Berlin", "Mumbai", "London", "New York", "Paris", "Tokyo", "Dubai", "Singapore"];
  for (const city of cities) {
    if (prompt.toLowerCase().includes(city.toLowerCase())) {
      requirements.location = city;
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
          content: `You are an expert architectural writer for competition boards and award submissions. Generate professional building descriptions suitable for client presentations.

⚠️ CRITICAL REQUIREMENT: FOLLOW USER INPUT EXACTLY
- If user says "7-story" → output MUST have floors: 7
- If user says "Berlin" → output MUST reference Berlin in projectName or narrative
- If user says "retail ground floor" → output MUST include retail on ground floor  
- If user says "rooftop restaurant" → output MUST include rooftop restaurant
- DO NOT change, ignore, or interpret away explicit user specifications
- Expand with professional detail, but NEVER contradict user's input
- Extract and respect ALL specific numbers, locations, and program requirements from user prompt

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
  description: BuildingDescription,
  style: string = "photorealistic architectural render",
  userApiKey?: string,
  location?: string,
  cameraAngle?: string,
  timeOfDay?: string
): Promise<{ url: string; revisedPrompt: string }> {
  void style;
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    // Build comprehensive photorealistic prompt (300-400 words)
    const imagePrompt = buildPhotorealisticPrompt(
      description,
      location || "urban setting",
      cameraAngle || "eye-level corner",
      timeOfDay || "golden hour"
    );

    const response = await client.images.generate({
      model: "dall-e-3",
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
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
  roomList: Array<{ name: string; area: number; unit: string }>;
  totalArea: number;
  floors: number;
}

export async function generateFloorPlan(
  description: BuildingDescription | Record<string, unknown>,
  userApiKey?: string
): Promise<FloorPlanResult> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    const d = description as Partial<BuildingDescription>;
    const floors = d.floors ?? 5;
    const totalArea = d.totalArea ?? 2500;
    const typology = d.buildingType ?? "Mixed-Use";
    const program = d.programSummary ?? "offices and residential units";

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an architectural floor plan generator. Given building specifications, produce a JSON response with:
1. "svg" — a complete SVG string (viewBox="0 0 800 600") of a schematic floor plan showing rooms with labels.
2. "roomList" — array of { name, area (m²), unit: "m²" } for each room.
3. "totalArea" — total floor area in m².
4. "floors" — number of floors.

SVG RULES:
- viewBox="0 0 800 600"
- Use rect for rooms, line/polyline for walls
- Fill rooms with light pastel colors: #E8F5E9 (living), #E3F2FD (bedrooms), #FFF3E0 (kitchen), #F3E5F5 (bathroom), #ECEFF1 (corridor), #FFF9C4 (office), #FFEBEE (retail)
- Stroke: #333 for walls (stroke-width 2), #999 for internal partitions (stroke-width 1)
- Add text labels (font-size 12, fill #333) centered in each room with room name and area
- Show door arcs as small quarter-circle paths (stroke #666, fill none)
- Include a north arrow indicator (top-right)
- Include a scale bar at the bottom (e.g., "0 — 5m — 10m")
- Title text at top: "[Building Type] — Typical Floor Plan"
- Use professional architectural drawing conventions
- NO embedded images, NO external references
- Keep it clean, readable, and architecturally plausible

Generate a TYPICAL FLOOR plan — the most representative floor. Show realistic room proportions.`,
        },
        {
          role: "user",
          content: `Generate a floor plan for: ${floors}-story ${typology}, total area ${totalArea} m². Program: ${program}. Floor plate: ~${Math.round(totalArea / floors)} m² per floor.`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response for floor plan");

    const result = JSON.parse(content) as FloorPlanResult;

    // Ensure SVG has valid structure
    if (!result.svg || !result.svg.includes("<svg")) {
      throw new Error("Generated response does not contain valid SVG");
    }

    return {
      svg: result.svg,
      roomList: result.roomList ?? [],
      totalArea: result.totalArea ?? totalArea,
      floors: result.floors ?? floors,
    };
  });
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
}

export async function analyzeImage(
  imageBase64: string,
  mimeType: string = "image/jpeg",
  userApiKey?: string
): Promise<ImageAnalysis> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a senior architect analyzing an image. Describe what you see in precise architectural terms. Output JSON with these fields:
{
  "buildingType": "Mixed-Use Tower|Residential Block|...",
  "floors": <number>,
  "style": "Contemporary Nordic|...",
  "features": ["feature1", "feature2"],
  "description": "Detailed 3-4 paragraph architectural description...",
  "facade": "Description of facade treatment, materials, openings...",
  "massing": "Description of building massing, setbacks, volumes...",
  "siteRelationship": "How the building relates to its context..."
}
Be specific about dimensions, proportions, materials, and spatial relationships. If the image is not architectural, set buildingType to "Not Architectural" and describe what you see.`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
            {
              type: "text",
              text: "Analyze this image in architectural terms. Describe the building, its style, materials, and spatial qualities.",
            },
          ],
        },
      ],
      max_tokens: 1500,
    });

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
    };
  });
}
