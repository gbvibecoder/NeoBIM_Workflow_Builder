/**
 * brief-extractor.ts — Structured extraction from PDF brief text.
 *
 * Uses Claude Sonnet 4.6 with tool_use to extract building type, materials,
 * lighting, persona, and space information from the raw PDF text produced
 * by TR-001. The extraction drives all downstream prompt builders so that
 * video walkthrough output matches the uploaded PDF — no hardcoded
 * residential-family defaults.
 *
 * Pattern matches the VIP Pipeline Stage 1 (stage-1-prompt.ts):
 *   - createAnthropicClient() for SDK instantiation
 *   - tool_use for guaranteed schema compliance
 *   - Graceful fallback on any failure (returns empty extraction)
 */

import { logger } from "@/lib/logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BriefRoomEntry {
  roomType: string;
  importance: 1 | 2 | 3;
  materials?: string[];
  palette?: string[];
  inhabitedDetails?: string[];
  adjacentTo?: string;
}

export interface BriefExtraction {
  /** Classified building type. */
  buildingType: string;
  /** Free-text exterior description from the brief. */
  exteriorDescription?: string;
  /** Footprint shape hint, e.g. "rectangular", "L-shape", "courtyard", "tower". */
  footprintHint?: string;
  /** Primary interior space to feature, e.g. "open kitchen-dining", "ICU ward". */
  spaceType?: string;
  /** Inhabitant description, e.g. "DINK couple late 30s". Undefined for commercial/institutional. */
  persona?: string;
  /** Materials from the brief, e.g. ["solid oak floor", "chalk-white walls"]. */
  materialPalette: string[];
  /** Accent colours, e.g. ["deep olive", "cognac leather"]. */
  colorAccents: string[];
  /** Lighting direction from the brief, e.g. "late afternoon golden hour". */
  lightingDirection?: string;
  /** Style references, e.g. ["Apartamento magazine", "warm inhabited"]. */
  styleKeywords: string[];
  /** Inhabited-life props, e.g. ["half-poured wine glass", "folded throw"]. */
  inhabitedDetails: string[];
  /** Materials/elements to avoid, e.g. ["chrome", "glass coffee table"]. */
  avoid: string[];
  /** Ordered room sequence for multi-room interior walkthrough. */
  roomSequence: BriefRoomEntry[];
}

/** Sentinel for when extraction is unavailable or the brief is too sparse. */
export const EMPTY_EXTRACTION: BriefExtraction = {
  buildingType: "other",
  materialPalette: [],
  colorAccents: [],
  styleKeywords: [],
  inhabitedDetails: [],
  avoid: [],
  roomSequence: [],
};

// ─── Extraction via Claude Sonnet 4.6 ───────────────────────────────────────

const MODEL = "claude-sonnet-4-6";

const EXTRACTION_SYSTEM_PROMPT =
  "You are an architectural brief analyst. Given raw text extracted from a PDF " +
  "project brief, extract structured information about the building and its " +
  "interior design direction. Be precise — extract ONLY what the text explicitly " +
  "states. If information is not in the text, leave that field empty/undefined. " +
  "Do NOT invent or assume details that are not described.";

/**
 * Extract structured context from a building description / PDF brief text.
 *
 * Uses Claude Sonnet 4.6 tool_use for guaranteed JSON output.
 * On any failure (no API key, rate limit, parse error), returns EMPTY_EXTRACTION
 * so the pipeline continues with neutral defaults.
 */
export async function extractBriefContext(
  buildingDescription: string,
): Promise<BriefExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.debug("[BRIEF-EXTRACT] No ANTHROPIC_API_KEY — returning empty extraction");
    return EMPTY_EXTRACTION;
  }

  // Brief too short for meaningful extraction
  if (!buildingDescription || buildingDescription.trim().length < 50) {
    return EMPTY_EXTRACTION;
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const isOAuth = apiKey.startsWith("sk-ant-oat01-");
    const client = isOAuth
      ? new Anthropic({ authToken: apiKey, apiKey: undefined })
      : new Anthropic({ apiKey });

    const text = buildingDescription.slice(0, 6000); // Keep within token budget

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: EXTRACTION_SYSTEM_PROMPT,
      tools: [
        {
          name: "extract_brief_context",
          description:
            "Extract structured building and interior design context from a project brief. " +
            "Only include information explicitly stated in the text.",
          input_schema: {
            type: "object" as const,
            properties: {
              buildingType: {
                type: "string",
                description:
                  'Building type classification. One of: "residential_house", "residential_apartment", ' +
                  '"residential_villa", "office", "coworking", "hospital", "clinic", "lab", "school", ' +
                  '"university", "library", "museum", "religious", "hotel", "restaurant", "cafe", ' +
                  '"bar", "retail", "showroom", "industrial", "warehouse", "data_center", ' +
                  '"infrastructure", "mixed_use", "other"',
              },
              exteriorDescription: {
                type: "string",
                description:
                  "Free-text architectural description of the building exterior if mentioned. " +
                  'e.g. "5-storey Mehrfamilienhaus built 1999, brick facade with punched windows". Omit if not described.',
              },
              footprintHint: {
                type: "string",
                description:
                  'Footprint shape if discernible: "rectangular", "L-shape", "U-shape", "courtyard", "tower", "linear". Omit if unknown.',
              },
              spaceType: {
                type: "string",
                description:
                  "The primary interior space to feature in video, " +
                  'e.g. "open kitchen-dining", "living room", "operating theater", "open-plan office". ' +
                  "Omit if not clearly specified.",
              },
              persona: {
                type: "string",
                description:
                  "Description of intended inhabitants/users if the brief specifies them, " +
                  'e.g. "DINK couple late 30s", "young family with two children", "medical staff". ' +
                  "Omit for commercial/institutional buildings or when the brief does not specify inhabitants.",
              },
              materialPalette: {
                type: "array",
                items: { type: "string" },
                description:
                  'Materials explicitly mentioned in the brief, e.g. ["solid oak engineered floor", "chalk-white walls", "brushed bronze handles"]. ' +
                  "Empty array if not specified.",
              },
              colorAccents: {
                type: "array",
                items: { type: "string" },
                description:
                  'Accent colours mentioned in the brief, e.g. ["deep olive", "cognac leather", "ink blue"]. ' +
                  "Empty array if not specified.",
              },
              lightingDirection: {
                type: "string",
                description:
                  'Lighting direction from the brief, e.g. "late afternoon golden hour", "bright neutral 5000K daylight". ' +
                  "Omit if not specified.",
              },
              styleKeywords: {
                type: "array",
                items: { type: "string" },
                description:
                  'Style references from the brief, e.g. ["Apartamento magazine", "warm inhabited", "Scandinavian minimal"]. ' +
                  "Empty array if not specified.",
              },
              inhabitedDetails: {
                type: "array",
                items: { type: "string" },
                description:
                  'Inhabited-life props/details mentioned in the brief, e.g. ["half-poured wine glass", "folded cashmere throw", "open cookbook"]. ' +
                  "Empty array for commercial/institutional or if not specified.",
              },
              avoid: {
                type: "array",
                items: { type: "string" },
                description:
                  'Things the brief says to avoid, e.g. ["chrome fixtures", "glass coffee table", "HDR lighting"]. ' +
                  "Empty array if not specified.",
              },
              roomSequence: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    roomType: { type: "string", description: 'Room/space type, e.g. "open kitchen-dining", "ICU bay"' },
                    importance: { type: "number", description: "1 = must show, 2 = should show, 3 = optional" },
                    materials: { type: "array", items: { type: "string" }, description: "Room-specific material overrides" },
                    palette: { type: "array", items: { type: "string" }, description: "Room-specific colour overrides" },
                    inhabitedDetails: { type: "array", items: { type: "string" }, description: "Room-specific life details" },
                    adjacentTo: { type: "string", description: "Name of adjacent room for continuity planning" },
                  },
                  required: ["roomType", "importance"],
                },
                description:
                  "Ordered list of rooms/spaces from the brief, sorted by visual importance for the video walkthrough. " +
                  "Include adjacency info when the brief implies spatial relationships. Empty array if rooms are not specified.",
              },
            },
            required: ["buildingType", "materialPalette", "colorAccents", "styleKeywords", "inhabitedDetails", "avoid", "roomSequence"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "extract_brief_context" },
      messages: [
        {
          role: "user",
          content: `Extract structured context from this architectural brief:\n\n${text}`,
        },
      ],
    });

    // Extract tool_use result
    const toolBlock = response.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    if (!toolBlock) {
      logger.warn("[BRIEF-EXTRACT] No tool_use block in response");
      return EMPTY_EXTRACTION;
    }

    const extracted = toolBlock.input as Record<string, unknown>;

    // Parse roomSequence entries with validation
    const rawRooms = Array.isArray(extracted.roomSequence) ? extracted.roomSequence : [];
    const roomSequence: BriefRoomEntry[] = rawRooms
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).roomType === "string")
      .map((r) => ({
        roomType: r.roomType as string,
        importance: ([1, 2, 3].includes(Number(r.importance)) ? Number(r.importance) : 2) as 1 | 2 | 3,
        materials: Array.isArray(r.materials) ? r.materials as string[] : undefined,
        palette: Array.isArray(r.palette) ? r.palette as string[] : undefined,
        inhabitedDetails: Array.isArray(r.inhabitedDetails) ? r.inhabitedDetails as string[] : undefined,
        adjacentTo: typeof r.adjacentTo === "string" ? r.adjacentTo : undefined,
      }));

    const result: BriefExtraction = {
      buildingType: (extracted.buildingType as string) || "other",
      exteriorDescription: (extracted.exteriorDescription as string) || undefined,
      footprintHint: (extracted.footprintHint as string) || undefined,
      spaceType: (extracted.spaceType as string) || undefined,
      persona: (extracted.persona as string) || undefined,
      materialPalette: Array.isArray(extracted.materialPalette) ? extracted.materialPalette as string[] : [],
      colorAccents: Array.isArray(extracted.colorAccents) ? extracted.colorAccents as string[] : [],
      lightingDirection: (extracted.lightingDirection as string) || undefined,
      styleKeywords: Array.isArray(extracted.styleKeywords) ? extracted.styleKeywords as string[] : [],
      inhabitedDetails: Array.isArray(extracted.inhabitedDetails) ? extracted.inhabitedDetails as string[] : [],
      avoid: Array.isArray(extracted.avoid) ? extracted.avoid as string[] : [],
      roomSequence,
    };

    logger.info(
      `[BRIEF-EXTRACT] Extracted: type=${result.buildingType} space=${result.spaceType ?? "—"} ` +
        `persona=${result.persona ? "yes" : "no"} materials=${result.materialPalette.length} ` +
        `colors=${result.colorAccents.length} rooms=${result.roomSequence.length} ` +
        `footprint=${result.footprintHint ?? "—"} lighting=${result.lightingDirection ?? "—"}`,
    );

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[BRIEF-EXTRACT] Extraction failed, using empty extraction: " + msg);
    return EMPTY_EXTRACTION;
  }
}

// ─── Prompt Helpers (used by gn-009.ts to build brief-driven prompts) ───────

/** Format materials for prompt insertion. Returns neutral fallback when empty. */
export function formatMaterials(extraction: BriefExtraction): string {
  if (extraction.materialPalette.length > 0) {
    return extraction.materialPalette.join(", ");
  }
  return "materials appropriate to the building type and function";
}

/** Format lighting for prompt insertion. Returns neutral fallback when empty. */
export function formatLighting(extraction: BriefExtraction): string {
  return extraction.lightingDirection ?? "well-balanced architectural photography lighting";
}

/** Format colour accents for prompt insertion. Omits when empty. */
export function formatColors(extraction: BriefExtraction): string {
  if (extraction.colorAccents.length > 0) {
    return `Colour accents: ${extraction.colorAccents.join(", ")}. `;
  }
  return "";
}

/** Format style keywords for prompt insertion. Omits when empty. */
export function formatStyle(extraction: BriefExtraction): string {
  if (extraction.styleKeywords.length > 0) {
    return `Style reference: ${extraction.styleKeywords.join(", ")}. `;
  }
  return "";
}

/** Format avoidance list for prompt insertion. Omits when empty. */
export function formatAvoid(extraction: BriefExtraction): string {
  if (extraction.avoid.length > 0) {
    return `AVOID: ${extraction.avoid.join(", ")}. `;
  }
  return "";
}

/** Format inhabited details for prompt insertion. Omits when empty or non-residential. */
export function formatInhabitedDetails(extraction: BriefExtraction): string {
  if (extraction.inhabitedDetails.length > 0) {
    return `Subtle life details: ${extraction.inhabitedDetails.join(", ")}. `;
  }
  return "";
}

/** Format persona for prompt insertion. Omits when absent. */
export function formatPersona(extraction: BriefExtraction): string {
  if (extraction.persona) {
    return `Inhabitants: ${extraction.persona}. `;
  }
  return "";
}

/**
 * Build a complete interior image prompt from extraction data.
 *
 * Multi-room continuity: when roomSequence has 2+ rooms, the composition
 * shows the primary room with a visible threshold (doorway / archway /
 * opening) toward the secondary room. This guides Kling's camera motion
 * through the threshold for in-flow continuity in a single 10s clip.
 *
 * Single-room: straight-ahead composition into the primary space.
 */
export function buildBriefDrivenInteriorPrompt(
  extraction: BriefExtraction,
  description: string,
): string {
  const rooms = [...extraction.roomSequence].sort((a, b) => a.importance - b.importance);
  const primary = rooms[0];
  const secondary = rooms[1]; // undefined when < 2 rooms
  const space = primary?.roomType ?? extraction.spaceType ?? "primary interior space";
  const materials = formatMaterials(extraction);
  const lighting = formatLighting(extraction);
  const colors = formatColors(extraction);
  const style = formatStyle(extraction);
  const avoid = formatAvoid(extraction);
  const inhabited = formatInhabitedDetails(extraction);
  const desc = description.slice(0, 1200);

  // Multi-room threshold composition
  const thresholdClause = secondary
    ? `On one side of the frame, a visible doorway or archway leads toward the adjacent ${secondary.roomType}. ` +
      "This threshold creates a natural path for forward camera movement into the next space. "
    : "";

  return (
    `Photorealistic eye-level interior architecture photograph of the ${space}. ` +
    "Camera at human eye level (1.5 meters height), positioned in the doorway looking across the " +
    "entire space toward the far wall, capturing the full width at a wide-angle 28mm perspective. " +
    `The space is fully furnished appropriate to its function as a ${space}. ` +
    `${thresholdClause}` +
    `Materials: ${materials}. ` +
    `${colors}` +
    `Lighting: ${lighting}. ` +
    `${style}` +
    `${inhabited}` +
    `${avoid}` +
    "Style: ultra-high-end architectural photography, photorealistic, " +
    "shallow architectural depth of field, 4K crisp detail. " +
    "IMPORTANT: NO people in this image, NO animals, NO text, NO labels, NO watermark. " +
    `\n\nLayout context: ${desc}`
  );
}

/**
 * Build a concept render prompt from extraction data.
 * Used by the concept-render fallback in gn-009.ts when no upstream image exists.
 */
export function buildBriefDrivenExteriorPrompt(
  extraction: BriefExtraction,
  description: string,
): string {
  const materials = formatMaterials(extraction);
  const lighting = formatLighting(extraction);
  const colors = formatColors(extraction);
  const style = formatStyle(extraction);
  const desc = description.slice(0, 1200);

  const extDesc = extraction.exteriorDescription
    ? `Building: ${extraction.exteriorDescription}. `
    : "";
  const footprint = extraction.footprintHint
    ? `Footprint shape: ${extraction.footprintHint}. `
    : "";

  return (
    `Photorealistic exterior architectural render of this building. ` +
    `${extDesc}` +
    `${footprint}` +
    `Materials: ${materials}. ` +
    `${colors}` +
    `Lighting: ${lighting}. ` +
    `${style}` +
    "Eye-level 3/4 corner perspective showing the complete building facade. " +
    "Physically accurate proportions, high-end architectural visualization, " +
    "V-Ray/Corona quality, no distortion, no text, no watermark. " +
    `\n\nBuilding description: ${desc}`
  );
}
