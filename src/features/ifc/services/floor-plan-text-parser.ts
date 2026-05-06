/* ─── Deterministic floor-plan brief parser ────────────────────────────────
   Pure regex-based extraction of `FloorPlanSchema` from PDF text. Runs
   BEFORE GPT in the TR-001 handler — when this module returns a
   non-null result, the brief is treated as a floor-plan brief and GPT
   is bypassed for floor-plan extraction.

   Why deterministic-first:
     · GPT-4o-mini drops the rooms array on briefs longer than its
       reliable JSON-schema-following window. Fixing that means a bigger
       model + few-shot examples → cost + latency. Regex is free and
       deterministic.
     · The regex parser handles the typical Indian-residential brief
       format that the user is feeding the system (numbered sections
       with explicit "Size: X' × Y'" lines and "located in NW quadrant"
       phrases). Add new patterns as new brief formats land.
     · GPT remains the fallback for free-form briefs the regex can't
       handle.

   Detection signal: the parser succeeds only when it finds BOTH a
   plot-size line AND at least one room with explicit dimensions. Loose
   matches (no plot, no rooms) → return null → GPT path runs. */

import type {
  CardinalWall,
  FloorPlanDoor,
  FloorPlanFloor,
  FloorPlanQuadrant,
  FloorPlanRoom,
  FloorPlanSchema,
  FloorPlanWindow,
} from "../types/floor-plan-schema";

/* ── helpers ──────────────────────────────────────────────────────────── */

/** Convert "10' 6\"", "12'", "10.5", "10' 6 in" to decimal feet. */
function parseFeet(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  /* "X'-Y\"" / "X' Y\"" / "X' Y in" — combined feet+inches. */
  const ftIn = trimmed.match(/^(\d+(?:\.\d+)?)\s*['′]?\s*[-–]?\s*(\d+(?:\.\d+)?)\s*(?:["″]|in\b|inch)/);
  if (ftIn) return parseFloat(ftIn[1]) + parseFloat(ftIn[2]) / 12;
  /* "X' " — feet only. */
  const ft = trimmed.match(/^(\d+(?:\.\d+)?)\s*['′]?\s*(?:ft\b|feet|$)/);
  if (ft) return parseFloat(ft[1]);
  /* Plain number — assume feet. */
  const num = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (num) return parseFloat(num[1]);
  return null;
}

/** Map quadrant phrases ("NW", "north-west", "south east") to schema enum. */
function parseQuadrant(raw: string): FloorPlanQuadrant {
  const s = raw.toLowerCase().replace(/[\s\-_]/g, "");
  if (s.includes("northwest") || s === "nw") return "NW";
  if (s.includes("northeast") || s === "ne") return "NE";
  if (s.includes("southwest") || s === "sw") return "SW";
  if (s.includes("southeast") || s === "se") return "SE";
  if (s.startsWith("north") || s === "n") return "N";
  if (s.startsWith("south") || s === "s") return "S";
  if (s.startsWith("east") || s === "e") return "E";
  if (s.startsWith("west") || s === "w") return "W";
  return "center";
}

/** Map "north"/"south"/"east"/"west" wall references. */
function parseCardinalWall(raw: string): CardinalWall | null {
  const s = raw.toLowerCase().trim();
  if (s.startsWith("n")) return "N";
  if (s.startsWith("s")) return "S";
  if (s.startsWith("e")) return "E";
  if (s.startsWith("w")) return "W";
  return null;
}

/* ── plot-size extraction ────────────────────────────────────────────── */

/** Match a plot-size line like:
 *    "Plot Size: 24 ft (depth) x 50 ft (width)"
 *    "Plot: 24 × 50 ft"
 *    "24' x 50' plot"
 *    "Plot Size: 24 feet (depth) x 50 feet (width)" */
function extractPlotSize(text: string): { plotWidthFt: number; plotDepthFt: number } | null {
  /* "Plot Size: 24 ft (depth) x 50 ft (width)" — explicit width/depth labels. */
  const labelled = text.match(
    /(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*\(\s*depth\s*\)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*\(\s*width\s*\)/i,
  );
  if (labelled) {
    return {
      plotWidthFt: parseFloat(labelled[2]),
      plotDepthFt: parseFloat(labelled[1]),
    };
  }
  const labelledRev = text.match(
    /(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*\(\s*width\s*\)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*\(\s*depth\s*\)/i,
  );
  if (labelledRev) {
    return {
      plotWidthFt: parseFloat(labelledRev[1]),
      plotDepthFt: parseFloat(labelledRev[2]),
    };
  }
  /* "Plot Size: 24 ft x 50 ft" — no labels, use first as depth, second as width.
     Convention: in plan drawings, "depth" is the smaller dim (entry side) and
     "width" is the larger. Fall through to brief-heuristic only if no labels. */
  const plain = text.match(
    /Plot\s*(?:Size|Dimension)?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')/i,
  );
  if (plain) {
    const a = parseFloat(plain[1]);
    const b = parseFloat(plain[2]);
    /* Heuristic: width >= depth typically. */
    return { plotWidthFt: Math.max(a, b), plotDepthFt: Math.min(a, b) };
  }
  return null;
}

/* ── room block extraction ───────────────────────────────────────────── */

/** Common usage hints — name → schema usage value. */
const USAGE_HINTS: Array<{ rx: RegExp; usage: string }> = [
  { rx: /\bliving|hall|drawing|lounge\b/i, usage: "living" },
  { rx: /\bbed\s*room|master|guest\s*room\b/i, usage: "bedroom" },
  { rx: /\bkitchen\b/i, usage: "kitchen" },
  { rx: /\btoilet|bath\s*room|wc\s|powder\b/i, usage: "toilet" },
  { rx: /\bwash\s*area|laundry|utility\b/i, usage: "wash" },
  { rx: /\boffice|study\b/i, usage: "office" },
  { rx: /\bconference|meeting|boardroom\b/i, usage: "conference" },
  { rx: /\breception\b/i, usage: "reception" },
  { rx: /\bshop|store|retail\b/i, usage: "shop" },
  { rx: /\brestaurant|cafe|dining\b/i, usage: "restaurant" },
  { rx: /\blobby\b/i, usage: "lobby" },
  { rx: /\bwarehouse|storage\b/i, usage: "warehouse" },
  { rx: /\bfactory|workshop|plant\b/i, usage: "factory" },
  { rx: /\bbalcony|terrace|verandah\b/i, usage: "balcony" },
  { rx: /\bcorridor|passage\b/i, usage: "corridor" },
];

function inferUsage(roomName: string): string | undefined {
  for (const { rx, usage } of USAGE_HINTS) {
    if (rx.test(roomName)) return usage;
  }
  return undefined;
}

/** Common finish-material patterns. */
function inferFinish(blockText: string): string | undefined {
  const m = blockText.match(/(?:flooring|finish|tiles?)[:\s]+([a-z][a-z\s\-]+(?:tiles?|marble|granite|wood|carpet|epoxy|concrete))/i);
  if (m) return m[1].trim().toLowerCase();
  if (/anti[\s-]?skid/i.test(blockText)) return "anti-skid tiles";
  if (/vitrified/i.test(blockText)) return "vitrified tiles";
  if (/marble/i.test(blockText)) return "marble";
  if (/dado/i.test(blockText)) return "dado tiles";
  return undefined;
}

/** Extract one room from a block of text, looking for a Size line and a
 *  "Located in <quadrant>" phrase. Returns null if either is missing. */
function extractRoom(name: string, blockText: string): FloorPlanRoom | null {
  /* Size: "X' × Y'" or "X feet × Y feet" or 'Size: 15' x 12''. */
  const sizeMatch = blockText.match(
    /(?:Size|Dimensions?|Area)[:\s]+(\d+(?:\.\d+)?)\s*['′]?\s*(?:[-–]?\s*\d+(?:\.\d+)?\s*(?:["″]|in)?)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*['′]?\s*(?:[-–]?\s*\d+(?:\.\d+)?\s*(?:["″]|in)?)?/i,
  );
  /* Inline pattern: "10' x 10'6\"" without the Size label. */
  const sizeInline = blockText.match(
    /(\d+(?:\.\d+)?)\s*['′]\s*[-–]?\s*(?:\d+(?:\.\d+)?\s*["″]?)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*['′]\s*[-–]?\s*(\d+(?:\.\d+)?)?\s*["″]?/i,
  );
  let widthFt: number | null = null;
  let lengthFt: number | null = null;
  if (sizeMatch) {
    /* Reparse the matched substring more carefully to capture inches. */
    const matchText = sizeMatch[0];
    const dims = matchText.match(
      /(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet)?\s*[-–]?\s*(\d+(?:\.\d+)?)?\s*(?:"|″|in|inch)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet)?\s*[-–]?\s*(\d+(?:\.\d+)?)?\s*(?:"|″|in|inch)?/i,
    );
    if (dims) {
      widthFt = parseFloat(dims[1]) + (dims[2] ? parseFloat(dims[2]) / 12 : 0);
      lengthFt = parseFloat(dims[3]) + (dims[4] ? parseFloat(dims[4]) / 12 : 0);
    }
  } else if (sizeInline) {
    widthFt = parseFloat(sizeInline[1]);
    lengthFt = parseFloat(sizeInline[2]) + (sizeInline[3] ? parseFloat(sizeInline[3]) / 12 : 0);
  }
  if (widthFt === null || lengthFt === null || widthFt <= 0 || lengthFt <= 0) return null;

  /* Quadrant: "located in NW quadrant" / "on the south-east side" / "located on extreme South-East". */
  const quadrantMatch = blockText.match(
    /(?:located|on the|in the|towards|extreme)\s+(?:[a-z\-]+\s+)*(north[\s-]?west|north[\s-]?east|south[\s-]?west|south[\s-]?east|north|south|east|west|nw|ne|sw|se|n|s|e|w)\b(?:\s+(?:quadrant|side|corner|interior|wall))?/i,
  );
  const quadrant: FloorPlanQuadrant = quadrantMatch
    ? parseQuadrant(quadrantMatch[1])
    : "center";

  /* Doors: "Door on N wall" / "Main entry from south side" — collect all walls mentioned. */
  const doors: FloorPlanDoor[] = [];
  const doorRx = /(?:door|entry|access|opens|connects)\s+(?:from|on|to|towards)?\s*(?:the\s+)?(north|south|east|west|n|s|e|w)\s*(?:wall|side|direction)?/gi;
  for (const m of blockText.matchAll(doorRx)) {
    const wall = parseCardinalWall(m[1]);
    if (wall) doors.push({ wall });
  }

  /* Windows: "Window on N wall". */
  const windows: FloorPlanWindow[] = [];
  const winRx = /window(?:s)?\s+(?:on|in)\s+(?:the\s+)?(north|south|east|west|n|s|e|w)\s*wall/gi;
  for (const m of blockText.matchAll(winRx)) {
    const wall = parseCardinalWall(m[1]);
    if (wall) windows.push({ wall });
  }

  return {
    name: name.trim(),
    widthFt,
    lengthFt,
    quadrant,
    doors: doors.length > 0 ? doors : undefined,
    windows: windows.length > 0 ? windows : undefined,
    usage: inferUsage(name),
    finishMaterial: inferFinish(blockText),
  };
}

/* ── section splitter ────────────────────────────────────────────────── */

/** Split brief text into named sections. Handles three patterns:
 *    "1. General Overview:"
 *    "3. Living Room (Hall):"
 *    "## Living Room"  (markdown heads)
 *  Returns map: section title (clean) → body text up to next section. */
function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  /* Detect numbered or markdown headings. The lookahead matches the next
     heading (or end of text) to bound the body. */
  const headingRx = /(?:^|\n)\s*(?:\d+[.)]\s*|##+\s*)([A-Za-z][A-Za-z0-9 \-/&\(\)]+?)\s*[:\n]/g;
  const matches: Array<{ name: string; start: number; end: number }> = [];
  for (const m of text.matchAll(headingRx)) {
    matches.push({ name: m[1].trim(), start: (m.index ?? 0) + m[0].length, end: text.length });
  }
  for (let i = 0; i < matches.length; i++) {
    matches[i].end = i + 1 < matches.length ? matches[i + 1].start - matches[i + 1].name.length - 5 : text.length;
    out.set(matches[i].name, text.slice(matches[i].start, matches[i].end));
  }
  return out;
}

/* ── building-category inference ─────────────────────────────────────── */

function inferBuildingCategory(text: string): "residential" | "commercial" | "industrial" | "institutional" | "hospitality" {
  const t = text.toLowerCase();
  if (/\b(2bhk|3bhk|bhk|villa|apartment|residenc|bedroom|family unit)\b/.test(t)) return "residential";
  if (/\b(office|workspace|cubicle|conference)\b/.test(t)) return "commercial";
  if (/\b(retail|mall|shop|store|cafe|restaurant)\b/.test(t)) return "commercial";
  if (/\b(hotel|hospitality|guest house|resort)\b/.test(t)) return "hospitality";
  if (/\b(school|hospital|institutional|library|church)\b/.test(t)) return "institutional";
  if (/\b(warehouse|factory|workshop|plant|industrial)\b/.test(t)) return "industrial";
  return "residential";
}

/* ── main entry ──────────────────────────────────────────────────────── */

export interface FloorPlanExtractionResult {
  /** The parsed schema (when extraction succeeded). */
  schema: FloorPlanSchema | null;
  /** True if the text contained ENOUGH floor-plan signals (plot dim + at
   *  least one room with dimensions). False = not a floor-plan brief. */
  isFloorPlanBrief: boolean;
  /** Diagnostic — what was found, for debugging. */
  diagnostics: {
    plotFound: boolean;
    sectionCount: number;
    roomsFound: number;
    staircaseFound: boolean;
    upperFloorsImplied: boolean;
    buildingCategory: string;
  };
}

/**
 * Run the deterministic floor-plan parser over the brief text.
 *
 * Returns `{schema: null, isFloorPlanBrief: false}` when the text doesn't
 * look like a floor-plan brief — caller falls back to GPT.
 */
export function extractFloorPlanFromText(text: string): FloorPlanExtractionResult {
  const plot = extractPlotSize(text);
  const sections = splitSections(text);
  const buildingCategory = inferBuildingCategory(text);
  const upperFloorsImplied = /upper\s+floor|upper\s+stor|first\s+floor|second\s+floor|g\s*\+\s*\d/i.test(text);
  /* "Dog-legged staircase" or just "staircase" near "stair". */
  const staircaseMatch = text.match(/(dog[\s-]?legged|straight)?\s*staircase/i);
  const staircaseFound = !!staircaseMatch;
  const staircaseQuadrantMatch = text.match(
    /staircase[\s\S]{0,200}?(?:located|on)\s+(?:the\s+)?(north[\s-]?west|north[\s-]?east|south[\s-]?west|south[\s-]?east|north|south|east|west|nw|ne|sw|se|n|s|e|w)/i,
  );
  const staircaseQuadrant: FloorPlanQuadrant = staircaseQuadrantMatch
    ? parseQuadrant(staircaseQuadrantMatch[1])
    : "SW";
  const staircaseType = /dog[\s-]?legged/i.test(text) ? "dog-legged" : "straight";

  const rooms: FloorPlanRoom[] = [];
  for (const [sectionName, sectionBody] of sections) {
    /* Skip sections that are clearly not rooms. */
    if (/general|overview|entry|circulation|opening|structural|service|finish|material|note/i.test(sectionName)) continue;
    if (/staircase|stair/i.test(sectionName)) continue;
    /* Sections that name a room (e.g., "Living Room (Hall)", "Bedroom 1"). */
    const room = extractRoom(sectionName, sectionBody);
    if (room) rooms.push(room);
  }

  const isFloorPlanBrief = !!plot && rooms.length > 0;
  if (!isFloorPlanBrief) {
    return {
      schema: null,
      isFloorPlanBrief: false,
      diagnostics: {
        plotFound: !!plot,
        sectionCount: sections.size,
        roomsFound: rooms.length,
        staircaseFound,
        upperFloorsImplied,
        buildingCategory,
      },
    };
  }

  /* Build the FloorPlanSchema. When "upper floors" implied (brief mentions
     stairs going up) we replicate the ground-floor layout into a first
     floor — produces a proper G+1 building, not a flat single-storey. */
  const groundFloor: FloorPlanFloor = {
    name: "Ground Floor",
    index: 0,
    rooms,
    staircase: staircaseFound
      ? {
          quadrant: staircaseQuadrant,
          type: staircaseType,
          hasGeometry: true,
        }
      : undefined,
  };
  const floors: FloorPlanFloor[] = [groundFloor];
  if (upperFloorsImplied) {
    /* Replicate the ground floor as the first floor — same room layout,
       same staircase. Real residential briefs in India typically have
       identical-or-similar upper floors; if the user has a different
       layout, the GPT extraction or a manual override can populate it. */
    const firstFloor: FloorPlanFloor = {
      name: "First Floor",
      index: 1,
      rooms: rooms.map((r) => ({ ...r })),
      staircase: staircaseFound
        ? {
            quadrant: staircaseQuadrant,
            type: staircaseType,
            hasGeometry: true,
          }
        : undefined,
    };
    floors.push(firstFloor);
  }
  /* Roof stub (always present — completes the building shell). */
  floors.push({
    name: "Roof",
    index: floors.length,
    rooms: [],
    isRoofStub: true,
  });

  return {
    schema: {
      plotWidthFt: plot!.plotWidthFt,
      plotDepthFt: plot!.plotDepthFt,
      buildingCategory,
      floors,
      rawText: text,
    },
    isFloorPlanBrief: true,
    diagnostics: {
      plotFound: true,
      sectionCount: sections.size,
      roomsFound: rooms.length,
      staircaseFound,
      upperFloorsImplied,
      buildingCategory,
    },
  };
}
