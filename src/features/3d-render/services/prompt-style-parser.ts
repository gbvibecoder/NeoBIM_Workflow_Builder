/**
 * Prompt-to-Style Parser
 * Extracts rich BuildingStyle from user text prompts for the ArchitecturalViewer.
 * This bridges the gap between the user's natural language description and the
 * procedural 3D renderer's style configuration.
 */

import type { BuildingStyle } from "@/types/architectural-viewer";

// ─── Pattern Libraries ──────────────────────────────────────────────────────

const GLASS_PATTERNS = /\b(glass|glazed|curtain[\s-]?wall|all[\s-]?glass|transparent|crystal|mirror(?:ed)?|reflective|floor[\s-]?to[\s-]?ceiling[\s-]?window|full[\s-]?height[\s-]?glass)\b/i;
const RIVER_PATTERNS = /\b(river|riverside|riverfront|canal|waterway|creek|stream)\b/i;
const LAKE_PATTERNS = /\b(lake|lakeside|lakefront|pond|reservoir|waterfront|harbour|harbor|marina|bay[\s-]?front|seaside|ocean[\s-]?front|beachfront)\b/i;
const MODERN_PATTERNS = /\b(modern|contemporary|minimalist|sleek|futuristic|avant[\s-]?garde|cutting[\s-]?edge|ultra[\s-]?modern|neo[\s-]?modern|high[\s-]?tech|deconstructivist)\b/i;
const TOWER_PATTERNS = /\b(tower|skyscraper|high[\s-]?rise|supertall|megatall|tall[\s-]?building|sky[\s-]?tower)\b/i;

// ─── Material Detection ──────────────────────────────────────────────────────

type ExteriorMaterial = BuildingStyle["exteriorMaterial"];

const MATERIAL_RULES: Array<{ pattern: RegExp; material: ExteriorMaterial }> = [
  { pattern: /\b(glass|glazed|curtain[\s-]?wall|all[\s-]?glass|crystal)\b/i, material: "glass" },
  { pattern: /\b(exposed[\s-]?concrete|béton[\s-]?brut|brutalist|raw[\s-]?concrete|fair[\s-]?faced[\s-]?concrete|board[\s-]?formed)\b/i, material: "concrete" },
  { pattern: /\b(brick|masonry|red[\s-]?brick|clay[\s-]?brick|brick[\s-]?clad|brickwork)\b/i, material: "brick" },
  { pattern: /\b(timber|wood|wooden|clt|cross[\s-]?laminated|cedar|oak[\s-]?clad|wood[\s-]?clad|lumber)\b/i, material: "wood" },
  { pattern: /\b(steel|cor[\s-]?ten|corten|weathering[\s-]?steel|metal[\s-]?clad|zinc|copper[\s-]?clad|aluminum[\s-]?panel)\b/i, material: "steel" },
  { pattern: /\b(stone|limestone|sandstone|granite|marble[\s-]?clad|travertine|slate|natural[\s-]?stone|ashlar)\b/i, material: "stone" },
  { pattern: /\b(terracotta|terra[\s-]?cotta|ceramic[\s-]?panel|fired[\s-]?clay|ceramic[\s-]?facade|baguette)\b/i, material: "terracotta" },
];

function detectExteriorMaterial(text: string): ExteriorMaterial {
  for (const { pattern, material } of MATERIAL_RULES) {
    if (pattern.test(text)) return material;
  }
  return "mixed";
}

// ─── Environment Detection ───────────────────────────────────────────────────

type Environment = BuildingStyle["environment"];

const ENVIRONMENT_RULES: Array<{ pattern: RegExp; env: Environment }> = [
  { pattern: /\b(waterfront|harbour|harbor|marina|pier|dock|seaside|coastal|beachfront|oceanfront|bay[\s-]?front)\b/i, env: "waterfront" },
  { pattern: /\b(coast(?:al)?|beach|shore|cliff[\s-]?top|sea[\s-]?view)\b/i, env: "coastal" },
  { pattern: /\b(desert|arid|sahara|sand[\s-]?dune|oasis|middle[\s-]?east|dubai|abu[\s-]?dhabi|riyadh|doha)\b/i, env: "desert" },
  { pattern: /\b(mountain|alpine|hillside|hill[\s-]?top|slope|highland|ridge|valley)\b/i, env: "mountain" },
  { pattern: /\b(campus|university|academic|school[\s-]?grounds|college)\b/i, env: "campus" },
  { pattern: /\b(park|garden|green[\s-]?space|botanical|arboretum|meadow)\b/i, env: "park" },
  { pattern: /\b(downtown|city[\s-]?center|cbd|central[\s-]?business|metro|urban|midtown|manhattan|high[\s-]?density)\b/i, env: "urban" },
  { pattern: /\b(suburb|residential[\s-]?area|neighborhood|villa[\s-]?plot|low[\s-]?density)\b/i, env: "suburban" },
];

function detectEnvironment(text: string): Environment {
  // Check river/lake separately since they map to waterfront
  if (RIVER_PATTERNS.test(text) || LAKE_PATTERNS.test(text)) return "waterfront";
  for (const { pattern, env } of ENVIRONMENT_RULES) {
    if (pattern.test(text)) return env;
  }
  return "suburban";
}

// ─── Usage Detection ─────────────────────────────────────────────────────────

type Usage = BuildingStyle["usage"];

const USAGE_RULES: Array<{ pattern: RegExp; usage: Usage }> = [
  { pattern: /\b(office|co[\s-]?working|coworking|workspace|headquarters|hq|corporate|business[\s-]?center)\b/i, usage: "office" },
  { pattern: /\b(residential|apartment|flat|condo|housing|dwelling|home|living[\s-]?quarter|dormitor)\b/i, usage: "residential" },
  { pattern: /\b(hotel|resort|motel|hospitality|inn|boutique[\s-]?hotel|lodge|guest[\s-]?house)\b/i, usage: "hotel" },
  { pattern: /\b(retail|shop|store|mall|commercial|marketplace|bazaar|showroom|boutique(?![\s-]?hotel))\b/i, usage: "commercial" },
  { pattern: /\b(school|university|college|academy|education|learning[\s-]?center|library|classroom|lecture)\b/i, usage: "educational" },
  { pattern: /\b(hospital|clinic|healthcare|medical[\s-]?center|wellness|health[\s-]?center|pharmacy|surgery)\b/i, usage: "healthcare" },
  { pattern: /\b(museum|gallery|theater|theatre|concert[\s-]?hall|auditorium|cultural[\s-]?center|exhibition|arts[\s-]?center|opera)\b/i, usage: "cultural" },
  { pattern: /\b(warehouse|factory|industrial|manufacturing|logistics|distribution|plant|workshop|depot)\b/i, usage: "industrial" },
  { pattern: /\b(civic|government|municipal|city[\s-]?hall|courthouse|embassy|parliament|public[\s-]?building)\b/i, usage: "civic" },
  { pattern: /\b(mixed[\s-]?use|multi[\s-]?use|live[\s-]?work|mixed[\s-]?development)\b/i, usage: "mixed" },
];

function detectUsage(text: string): Usage {
  for (const { pattern, usage } of USAGE_RULES) {
    if (pattern.test(text)) return usage;
  }
  return "mixed";
}

// ─── Typology Detection ─────────────────────────────────────────────────────

type Typology = BuildingStyle["typology"];

const TYPOLOGY_RULES: Array<{ pattern: RegExp; typology: Typology }> = [
  { pattern: /\b(podium[\s-]?tower|podium[\s-]?and[\s-]?tower|tower[\s-]?on[\s-]?podium|plinth[\s-]?tower|base[\s-]?and[\s-]?tower)\b/i, typology: "podium-tower" },
  { pattern: /\b(courtyard|atrium|enclosed[\s-]?court|central[\s-]?court|quadrangle|u[\s-]?shape|c[\s-]?shape|donut|perimeter[\s-]?block)\b/i, typology: "courtyard" },
  { pattern: /\b(villa|bungalow|mansion|estate|manor|single[\s-]?family|detached[\s-]?house|pavilion)\b/i, typology: "villa" },
  { pattern: /\b(warehouse|shed|hangar|barn|industrial[\s-]?shed)\b/i, typology: "warehouse" },
  { pattern: /\b(slab|linear|bar[\s-]?building|long[\s-]?block|elongated)\b/i, typology: "slab" },
  { pattern: /\b(tower|skyscraper|high[\s-]?rise|supertall)\b/i, typology: "tower" },
];

function detectTypology(text: string, floors: number): Typology {
  for (const { pattern, typology } of TYPOLOGY_RULES) {
    if (pattern.test(text)) return typology;
  }
  // Infer from floor count
  if (floors >= 20) return "tower";
  if (floors >= 8) return "slab";
  if (floors <= 2) return "villa";
  return "generic";
}

// ─── Facade Pattern Detection ────────────────────────────────────────────────

type FacadePattern = BuildingStyle["facadePattern"];

const FACADE_RULES: Array<{ pattern: RegExp; facade: FacadePattern }> = [
  { pattern: /\b(curtain[\s-]?wall|unitized[\s-]?facade|structural[\s-]?glazing|stick[\s-]?system)\b/i, facade: "curtain-wall" },
  { pattern: /\b(brise[\s-]?soleil|sun[\s-]?shade|solar[\s-]?screen|louver|louvre|fin|shading[\s-]?device|sun[\s-]?screen)\b/i, facade: "brise-soleil" },
  { pattern: /\b(ribbon[\s-]?window|horizontal[\s-]?window|band[\s-]?window|strip[\s-]?window|continuous[\s-]?window)\b/i, facade: "ribbon-window" },
  { pattern: /\b(punched[\s-]?window|recessed[\s-]?window|deep[\s-]?set|traditional[\s-]?window)\b/i, facade: "punched-window" },
];

function detectFacadePattern(text: string, material: ExteriorMaterial): FacadePattern {
  for (const { pattern, facade } of FACADE_RULES) {
    if (pattern.test(text)) return facade;
  }
  // Infer from material
  if (material === "glass") return "curtain-wall";
  if (material === "brick" || material === "stone") return "punched-window";
  if (material === "concrete") return "ribbon-window";
  if (material === "terracotta") return "brise-soleil";
  return "none";
}

// ─── Floor Height Override ───────────────────────────────────────────────────

function detectFloorHeight(text: string, usage: Usage): number | undefined {
  // Check for explicit floor height in text
  const heightMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:eter|etre)?s?\s*(?:floor[\s-]?(?:to[\s-]?floor|height)|ceiling[\s-]?height|storey[\s-]?height)/i);
  if (heightMatch) {
    const h = parseFloat(heightMatch[1]);
    if (h >= 2.5 && h <= 8.0) return h;
  }

  const heightMatch2 = text.match(/(?:floor[\s-]?(?:to[\s-]?floor|height)|ceiling[\s-]?height|storey[\s-]?height)\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*m/i);
  if (heightMatch2) {
    const h = parseFloat(heightMatch2[1]);
    if (h >= 2.5 && h <= 8.0) return h;
  }

  // Infer from usage
  switch (usage) {
    case "industrial": return 6.0;
    case "cultural": return 5.0;
    case "commercial": return 4.2;
    case "office": return 3.8;
    case "healthcare": return 3.6;
    case "hotel": return 3.4;
    case "residential": return 3.0;
    default: return undefined;
  }
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a user's text prompt into a rich BuildingStyle for the ArchitecturalViewer.
 * Extracts materials, environment, usage, typology, facade patterns, and more.
 */
export function parsePromptToStyle(
  promptText: string,
  floors: number = 5,
  buildingType: string = ""
): BuildingStyle {
  // Combine prompt + building type for broader matching
  const combined = `${promptText} ${buildingType}`.trim();

  const exteriorMaterial = detectExteriorMaterial(combined);
  const usage = detectUsage(combined);
  const environment = detectEnvironment(combined);
  const typology = detectTypology(combined, floors);
  const facadePattern = detectFacadePattern(combined, exteriorMaterial);
  const floorHeightOverride = detectFloorHeight(combined, usage);

  const glassHeavy = GLASS_PATTERNS.test(combined) || exteriorMaterial === "glass" || facadePattern === "curtain-wall";
  const hasRiver = RIVER_PATTERNS.test(combined);
  const hasLake = LAKE_PATTERNS.test(combined) && !hasRiver; // prefer river if both mentioned
  const isModern = MODERN_PATTERNS.test(combined) || exteriorMaterial === "glass" || exteriorMaterial === "steel";
  const isTower = TOWER_PATTERNS.test(combined) || floors >= 10 || typology === "tower" || typology === "podium-tower";

  return {
    glassHeavy,
    hasRiver,
    hasLake,
    isModern,
    isTower,
    exteriorMaterial,
    environment,
    usage,
    promptText: promptText.slice(0, 500), // cap length for display
    typology,
    facadePattern,
    floorHeightOverride,
    maxFloorCap: 30,
  };
}
