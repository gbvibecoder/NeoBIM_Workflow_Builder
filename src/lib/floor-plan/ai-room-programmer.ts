/**
 * Stage 1: AI Room Programmer
 *
 * Converts a natural-language prompt into a rich, structured room program
 * with adjacency requirements, functional zones, and architectural intent.
 *
 * Uses GPT-4o-mini for fast, cheap parsing. Handles ANY building type:
 * residential, commercial, medical, educational, hospitality, etc.
 *
 * Output feeds directly into Stage 2 (AI Spatial Layout in generateFloorPlan).
 */

import { getClient } from "@/services/openai";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RoomSpec {
  name: string;
  type: string;        // living, bedroom, kitchen, dining, bathroom, hallway, etc.
  areaSqm: number;
  zone: "public" | "private" | "service" | "circulation";
  mustHaveExteriorWall: boolean;
  adjacentTo: string[]; // names of rooms that MUST share a wall with this room
  preferNear: string[]; // names of rooms that SHOULD be nearby (soft constraint)
  floor?: number;       // 0=ground, 1=first, 2=second (multi-floor buildings)
  preferredWidth?: number;  // meters — user-specified width (e.g., "22 feet" → 6.7m)
  preferredDepth?: number;  // meters — user-specified depth
}

export interface AdjacencyRequirement {
  roomA: string;
  roomB: string;
  reason: string;       // e.g. "plumbing stack", "noise separation", "direct access"
}

export interface EnhancedRoomProgram {
  buildingType: string;
  totalAreaSqm: number;
  numFloors: number;
  rooms: RoomSpec[];
  adjacency: AdjacencyRequirement[];
  zones: {
    public: string[];      // room names in public zone (living, dining, entrance)
    private: string[];     // room names in private zone (bedrooms, study)
    service: string[];     // room names in service zone (kitchen, utility, bathroom)
    circulation: string[]; // corridors, hallways, foyer
  };
  entranceRoom: string;    // which room is nearest to the main entrance
  circulationNotes: string; // AI's note on how zones connect
  projectName: string;
  isVastuRequested?: boolean; // true when user asked for vastu/vaastu compliance
  originalPrompt?: string;   // original user prompt (for downstream stages)
}

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert architectural space programmer. Given ANY building description, output a detailed JSON room program with realistic dimensions, adjacency requirements, and functional zones.

YOU HANDLE ALL BUILDING TYPES:
- Residential: apartment, villa, bungalow, duplex, penthouse, farmhouse, studio
- Commercial: office, co-working, retail, showroom, restaurant, café
- Medical: clinic, hospital, dental office, pharmacy, diagnostic center
- Educational: school, college, library, training center
- Hospitality: hotel, resort, guest house, homestay, service apartment
- Industrial: warehouse, factory, workshop
- Mixed-use: ground floor commercial + upper residential
- Custom: any combination the user describes

CRITICAL RULES — ROOM COMPLETENESS (MOST IMPORTANT):
1. You MUST include EVERY room the user mentions explicitly — do NOT skip, merge, or consolidate ANY room
2. If the user says "pooja room", include a "Pooja Room". If they say "powder room", include a "Powder Room"
3. If the user says "servant quarter with attached toilet", include BOTH "Servant Quarter" AND "Servant Toilet" as separate rooms
4. If the user says "walk-in wardrobe", include it as a separate room, NOT merged into the bedroom
5. Count your rooms before outputting. If the user mentions 25 rooms, you must output at least 25 rooms
6. Small rooms are VALID: shoe rack (2 sqm), powder room (2 sqm), pooja room (3 sqm) — include them
7. Each attached bathroom is a SEPARATE room from its bedroom
8. "BHK" = bedrooms + hall + kitchen. "3BHK" = 3 bedrooms + living/hall + kitchen

USER-SPECIFIED DIMENSIONS:
- If the user specifies exact dimensions like "20x15 feet" or "6x5 feet", CONVERT to meters (1 foot = 0.3048m)
- Set "preferredWidth" and "preferredDepth" in meters in the room output
- Set areaSqm = preferredWidth * preferredDepth
- Example: "20x15 feet" = 6.1 x 4.6m → preferredWidth: 6.1, preferredDepth: 4.6, areaSqm: 28
- Do NOT override user-specified sizes with your own estimates
- These are HARD preferences — the layout engine will try to match them within 20%

ESSENTIAL ROOMS TO ADD (if user didn't mention them):
- Residential: kitchen (if missing), at least 1 bathroom, living area, corridor (if 5+ rooms per floor)
- Commercial: reception, restrooms, server/utility room
- Medical: waiting area, reception, restroom
- Any building: at least one entrance/foyer area
- For villa/bungalow/house: add verandah/porch
- For 3+ bedrooms: add utility room

ROOM TYPES (use ONLY these): living, dining, kitchen, bedroom, bathroom, hallway, entrance, utility, balcony, office, storage, staircase, other

ZONE ASSIGNMENT:
- public: living room, dining room, entrance, foyer, reception, waiting area, verandah, TV lounge, family room
- private: bedrooms, study, home office, home theater, gym, prayer room, pooja room, walk-in closet/wardrobe
- service: kitchen, bathrooms, utility, laundry, storage, server room, pantry, servant quarter, car parking
- circulation: corridor, hallway, foyer, passage, staircase, lobby

ADJACENCY RULES (generate these pairs):
- Kitchen ↔ Dining (serving access)
- Master Bedroom ↔ Master Bathroom (attached bath)
- Master Bedroom ↔ Walk-in Wardrobe (direct access)
- Each Bedroom ↔ its attached Bathroom
- Living Room ↔ Dining Room (open plan flow)
- Entrance/Foyer ↔ Living Room (arrival sequence)
- Kitchen ↔ Utility (service connection)
- Servant Quarter ↔ Servant Toilet (attached)
- Wet rooms (bathrooms, kitchen, utility) should cluster for shared plumbing
- Corridor must touch both public and private zones

EXTERIOR WALL RULES:
- MUST have exterior wall: all bedrooms, living room, dining room, kitchen, office, balcony, verandah, terrace, car parking
- CAN be interior: bathroom, WC, corridor, utility, storage, staircase, closet, pooja room, powder room

SIZE GUIDELINES (sqm, Indian standards):
- Master Bedroom: 14-20, Other Bedrooms: 10-15
- Living Room: 18-30 (larger for 3+ BHK), Dining Room: 10-15, Living+Dining: 22-35
- Kitchen: 8-12, Bathroom: 4-6, WC/Toilet: 2.5-4
- Corridor/Hallway: 5-12, Utility: 3-5, Foyer/Entrance: 4-8
- Balcony/Verandah: 5-12, Home Theater: 15-25, Gym: 10-20, Study/Office: 8-12
- Pooja Room: 2.5-4, Powder Room: 2-3, Shoe Rack: 2-3, Walk-in Wardrobe: 4-6
- Servant Quarter: 7-10, Car Parking: 25-35, Terrace Garden: 10-20
- Family Lounge: 12-18, TV Lounge: 10-15
- Reception (commercial): 12-25, Waiting Area: 10-20, Meeting Room: 12-20

MULTI-FLOOR BUILDINGS:
For duplex, multi-story, or 2+ floor buildings, assign each room a "floor" field:
- floor: 0 = ground floor
- floor: 1 = first floor
- floor: 2 = second floor

CRITICAL FLOOR ASSIGNMENT:
- When the user says "Ground floor: X, Y, Z" and "First floor: A, B, C":
  Rooms X, Y, Z MUST have floor: 0
  Rooms A, B, C MUST have floor: 1
- Do NOT put first floor rooms on the ground floor or vice versa
- If a room's floor isn't clear from context, use these defaults:
  Living, dining, kitchen, guest rooms, foyer, car parking → floor: 0
  Master bedroom, kids bedrooms, study, family lounge → floor: 1
- A "Staircase" room (type: "staircase", ~12 sqm) MUST appear on EVERY floor it connects
- Set numFloors to the total number of floors

If the user says "duplex", "2-story", "two floors", "ground floor + first floor", set numFloors: 2 and assign floor numbers.
If single floor (default), omit the "floor" field or set floor: 0 for all rooms.

OUTPUT THIS EXACT JSON STRUCTURE:
{
  "buildingType": "Residential Villa",
  "totalAreaSqm": 200,
  "numFloors": 1,
  "rooms": [
    {
      "name": "Living Room",
      "type": "living",
      "areaSqm": 25,
      "preferredWidth": 5.5,
      "preferredDepth": 4.5,
      "zone": "public",
      "mustHaveExteriorWall": true,
      "adjacentTo": ["Dining Room", "Foyer"],
      "preferNear": ["Kitchen"],
      "floor": 0
    }
  ],
  "adjacency": [
    { "roomA": "Kitchen", "roomB": "Dining Room", "reason": "serving access" },
    { "roomA": "Master Bedroom", "roomB": "Bathroom 1", "reason": "attached bath" }
  ],
  "zones": {
    "public": ["Living Room", "Dining Room", "Foyer"],
    "private": ["Master Bedroom", "Bedroom 2"],
    "service": ["Kitchen", "Bathroom 1", "Bathroom 2", "Utility"],
    "circulation": ["Corridor"]
  },
  "entranceRoom": "Foyer",
  "circulationNotes": "Foyer leads to corridor which separates public zone (south) from private zone (north). Kitchen accessible from dining room.",
  "projectName": "2BHK Villa"
}`;

// ── Room size limits (post-AI clamp) ────────────────────────────────────────

/**
 * Maximum area for utility/service rooms. Returns null if no limit applies.
 * Prevents AI from assigning absurdly large areas to small rooms like shoe racks.
 */
function getMaxAreaForRoomType(name: string, type: string): number | null {
  const n = name.toLowerCase();
  const MAX_SIZES: Array<{ pattern: RegExp; max: number }> = [
    { pattern: /shoe\s*(?:rack|cabinet|closet|storage)/, max: 4 },
    { pattern: /powder\s*room/, max: 4 },
    { pattern: /linen\s*(?:storage|closet|cupboard)/, max: 4 },
    { pattern: /coat\s*closet/, max: 4 },
    { pattern: /servant\s*toilet|maid.*toilet/, max: 4 },
    { pattern: /pooja|puja|prayer|mandir/, max: 8 },
    { pattern: /store\s*room|storage\s*room/, max: 8 },
    { pattern: /pantry/, max: 8 },
    { pattern: /utility\s*room/, max: 8 },
    { pattern: /washing\s*area/, max: 6 },
    { pattern: /laundry/, max: 8 },
    { pattern: /balcony/, max: 10 },
    { pattern: /umbrella/, max: 3 },
    { pattern: /kitchenette/, max: 8 },
  ];

  for (const { pattern, max } of MAX_SIZES) {
    if (pattern.test(n)) return max;
  }
  // Generic type-based limits for small rooms
  if (type === "storage") return 10;
  return null;
}

// ── Main function ────────────────────────────────────────────────────────────

export async function programRooms(
  prompt: string,
  userApiKey?: string
): Promise<EnhancedRoomProgram> {
  // Estimate complexity — complex prompts need explicit room-count instruction
  const mentionedRooms = extractMentionedRooms(prompt);
  const isComplex = mentionedRooms.length >= 10;

  // Complex prompts need longer timeout — GPT-4o-mini generating 25+ room JSON
  // can take 30-60s. Default 30s timeout causes fallback to regex.
  const client = getClient(userApiKey, isComplex ? 90_000 : 45_000);

  const userMessage = isComplex
    ? `${prompt}\n\nIMPORTANT: This prompt mentions at least ${mentionedRooms.length} distinct rooms/spaces: ${mentionedRooms.join(", ")}. You MUST include ALL of them as separate rooms in your output. Do NOT merge or skip any.`
    : prompt;

  let raw: EnhancedRoomProgram | null = null;

  // Attempt 1: primary AI call with sufficient token budget
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: isComplex ? 8192 : 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }, { timeout: isComplex ? 90_000 : 45_000 });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("AI returned empty response for room program");

    raw = JSON.parse(content) as EnhancedRoomProgram;
  } catch (firstErr) {
    // Attempt 2: retry with explicit room list in a simpler prompt format
    if (isComplex) {
      console.warn("[programRooms] First attempt failed for complex prompt, retrying with room list:", firstErr);
      try {
        const retryMessage = `Generate a room program for this building. Here are ALL the rooms that MUST be included:\n\n${mentionedRooms.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nOriginal description: ${prompt}\n\nInclude EVERY room listed above. Do NOT skip any.`;
        const completion2 = await client.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.2,
          max_tokens: 8192,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: retryMessage },
          ],
        }, { timeout: 90_000 });
        const content2 = completion2.choices[0]?.message?.content;
        if (content2) {
          raw = JSON.parse(content2) as EnhancedRoomProgram;
        }
      } catch (retryErr) {
        console.warn("[programRooms] Retry also failed:", retryErr);
      }
    }

    if (!raw) throw firstErr as Error;
  }

  // ── Validate & sanitize ──

  if (!raw.rooms || !Array.isArray(raw.rooms) || raw.rooms.length === 0) {
    throw new Error("AI returned no rooms in room program");
  }

  // Ensure every room has required fields
  const validZones = new Set(["public", "private", "service", "circulation"]);
  for (const room of raw.rooms) {
    if (!room.name) room.name = "Room";
    if (!room.type) room.type = "other";
    if (!room.areaSqm || room.areaSqm <= 0) room.areaSqm = 10;
    if (!validZones.has(room.zone)) room.zone = "other" as RoomSpec["zone"];
    if (typeof room.mustHaveExteriorWall !== "boolean") {
      room.mustHaveExteriorWall = !["bathroom", "utility", "storage", "hallway", "staircase"].includes(room.type);
    }
    if (!Array.isArray(room.adjacentTo)) room.adjacentTo = [];
    if (!Array.isArray(room.preferNear)) room.preferNear = [];
    if (room.floor !== undefined && room.floor !== null) {
      room.floor = Math.max(0, Math.floor(Number(room.floor) || 0));
    }
    // Preserve user-specified dimensions from AI output
    if (room.preferredWidth && room.preferredWidth > 0) {
      room.preferredWidth = Number(room.preferredWidth);
    }
    if (room.preferredDepth && room.preferredDepth > 0) {
      room.preferredDepth = Number(room.preferredDepth);
    }

    // ── Clamp utility/service room areas to realistic maximums ──
    // AI sometimes assigns wildly large areas to small utility rooms
    if (!room.preferredWidth && !room.preferredDepth) {
      const maxArea = getMaxAreaForRoomType(room.name, room.type);
      if (maxArea !== null && room.areaSqm > maxArea) {
        console.warn(`[SIZE-CLAMP] ${room.name}: AI assigned ${room.areaSqm.toFixed(1)} sqm, clamped to ${maxArea} sqm`);
        room.areaSqm = maxArea;
      }
    }
  }

  // ── Post-AI room faithfulness check ──
  // Compare AI output against rooms extracted from the prompt, inject missing ones
  const missingRooms = findMissingRooms(mentionedRooms, raw.rooms, prompt);
  if (missingRooms.length > 0) {
    console.warn(`[programRooms] AI missed ${missingRooms.length} rooms from prompt: ${missingRooms.map(r => r.name).join(", ")}`);
    raw.rooms.push(...missingRooms);
  }

  // Ensure adjacency is valid
  if (!Array.isArray(raw.adjacency)) raw.adjacency = [];
  const roomNames = new Set(raw.rooms.map(r => r.name));
  raw.adjacency = raw.adjacency.filter(
    a => roomNames.has(a.roomA) && roomNames.has(a.roomB)
  );

  // Ensure zones contain only valid room names
  if (!raw.zones || typeof raw.zones !== "object") {
    raw.zones = { public: [], private: [], service: [], circulation: [] };
  }
  for (const key of ["public", "private", "service", "circulation"] as const) {
    if (!Array.isArray(raw.zones[key])) raw.zones[key] = [];
    raw.zones[key] = raw.zones[key].filter(n => roomNames.has(n));
  }

  // Ensure all rooms appear in exactly one zone
  const zoned = new Set([
    ...raw.zones.public,
    ...raw.zones.private,
    ...raw.zones.service,
    ...raw.zones.circulation,
  ]);
  for (const room of raw.rooms) {
    if (!zoned.has(room.name)) {
      raw.zones[room.zone]?.push(room.name);
    }
  }

  // Ensure totals
  if (!raw.totalAreaSqm || raw.totalAreaSqm <= 0) {
    raw.totalAreaSqm = raw.rooms.reduce((s, r) => s + r.areaSqm, 0);
  }
  // Fix: totalAreaSqm must be at least the sum of room areas
  const actualTotal = raw.rooms.reduce((s, r) => s + r.areaSqm, 0);
  if (raw.totalAreaSqm < actualTotal) {
    raw.totalAreaSqm = actualTotal;
  }

  if (!raw.numFloors || raw.numFloors <= 0) raw.numFloors = 1;
  if (!raw.buildingType) raw.buildingType = "Residential Apartment";
  if (!raw.entranceRoom) raw.entranceRoom = raw.rooms[0]?.name ?? "Entrance";
  if (!raw.circulationNotes) raw.circulationNotes = "";

  // Generate project name
  if (!raw.projectName) {
    const bedroomCount = raw.rooms.filter(
      r => r.type === "bedroom" || r.name.toLowerCase().includes("bedroom")
    ).length;
    raw.projectName = bedroomCount > 0
      ? `${bedroomCount}BHK ${raw.buildingType.split(" ").pop()}`
      : raw.buildingType;
  }

  // ── Vastu flag ──
  raw.isVastuRequested = /vastu|vaastu|vastu.?compliant/i.test(prompt);
  raw.originalPrompt = prompt;

  console.log(`[STAGE-1] Rooms from AI: ${raw.rooms.length}`, raw.rooms.map(r => `${r.name} (floor:${r.floor ?? 0})`));

  return raw;
}

// ── Extract room names mentioned in the user prompt ─────────────────────────

/**
 * Regex-based extraction of room/space names from a natural language prompt.
 * Returns a list of canonical room names the user explicitly mentioned.
 * This is used to validate AI output and inject missing rooms.
 */
export function extractMentionedRooms(prompt: string): string[] {
  const p = prompt.toLowerCase();
  const found: string[] = [];

  // Known room patterns — order matters (longer patterns first to avoid partial matches)
  const ROOM_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
    // Specific rooms (longer names first)
    { pattern: /walk[- ]?in\s+wardrobe|walk[- ]?in\s+closet/g, name: "Walk-in Wardrobe" },
    { pattern: /master\s+bath(?:room)?/g, name: "Master Bathroom" },
    { pattern: /master\s+bed(?:room)?(?:\s+suite)?/g, name: "Master Bedroom" },
    { pattern: /kids?\s+bed(?:room)?\s*1|(?:first|1st)\s+kids?\s+bed(?:room)?/g, name: "Kids Bedroom 1" },
    { pattern: /kids?\s+bed(?:room)?\s*2|(?:second|2nd)\s+kids?\s+bed(?:room)?/g, name: "Kids Bedroom 2" },
    { pattern: /kids?\s+bed(?:room)?\s*3/g, name: "Kids Bedroom 3" },
    { pattern: /kids?\s+bath(?:room)?\s*1/g, name: "Kids Bathroom 1" },
    { pattern: /kids?\s+bath(?:room)?\s*2/g, name: "Kids Bathroom 2" },
    { pattern: /guest\s+bed(?:room)?/g, name: "Guest Bedroom" },
    { pattern: /guest\s+bath(?:room)?/g, name: "Guest Bathroom" },
    { pattern: /servant\s+quarter|servants?\s+room|maid'?s?\s+room/g, name: "Servant Quarter" },
    { pattern: /servant\s+toilet|maid'?s?\s+(?:bath|toilet)|servant\s+quarter\s+[\w\s]*?(?:attached|with)\s+[\w\s]*?(?:indian\s+)?toilet/g, name: "Servant Toilet" },
    { pattern: /powder\s+room/g, name: "Powder Room" },
    { pattern: /pooja\s+room|puja\s+room|prayer\s+room|mandir/g, name: "Pooja Room" },
    { pattern: /shoe\s+(?:rack|cabinet|closet|storage)/g, name: "Shoe Rack" },
    { pattern: /coat\s+closet/g, name: "Coat Closet" },
    { pattern: /utility\s+room|laundry\s+room/g, name: "Utility Room" },
    { pattern: /utility\s+balcony|drying\s+(?:balcony|area)/g, name: "Utility Balcony" },
    { pattern: /terrace\s+garden/g, name: "Terrace Garden" },
    { pattern: /car\s+parking|garage|covered\s+parking/g, name: "Car Parking" },
    { pattern: /family\s+(?:lounge|room)|tv\s+lounge|family\s+tv/g, name: "Family Lounge" },
    { pattern: /home\s+theater|home\s+theatre/g, name: "Home Theater" },
    { pattern: /mini\s+bar/g, name: "Mini Bar" },
    { pattern: /study\s+room|shared\s+study/g, name: "Study Room" },
    { pattern: /sit[- ]?out|verandah|veranda|porch/g, name: "Verandah" },
    { pattern: /living\s+room|formal\s+living/g, name: "Living Room" },
    { pattern: /dining\s+(?:room|area)/g, name: "Dining Room" },
    { pattern: /(?:open\s+)?kitchen|wet\s+kitchen|dry\s+kitchen|modular\s+kitchen/g, name: "Kitchen" },
    { pattern: /foyer|entrance\s+(?:hall|area)/g, name: "Foyer" },
    { pattern: /(?:master\s+)?balcony|private\s+balcony/g, name: "Balcony" },
    { pattern: /(?:internal\s+)?staircase/g, name: "Staircase" },
    { pattern: /linen\s+(?:storage|closet|cupboard)/g, name: "Linen Storage" },
    { pattern: /breakfast\s+(?:bar|nook|area)/g, name: "Breakfast Bar" },
    { pattern: /swimming\s+pool|pool/g, name: "Swimming Pool" },
    { pattern: /gym|fitness|workout/g, name: "Gym" },
    { pattern: /store\s*room|storage\s*room/g, name: "Store Room" },
    { pattern: /reception/g, name: "Reception" },
    { pattern: /waiting\s+area/g, name: "Waiting Area" },
    { pattern: /conference\s+room|meeting\s+room/g, name: "Meeting Room" },
    { pattern: /server\s+room/g, name: "Server Room" },
    { pattern: /pantry/g, name: "Pantry" },
  ];

  const seen = new Set<string>();
  for (const { pattern, name } of ROOM_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    if (pattern.test(p) && !seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  }

  // Detect numbered bedrooms: "bedroom 1", "bedroom 2", etc.
  let numberedBedMatch: RegExpExecArray | null;
  const numberedBedRe = /(?:bed(?:room)?)\s*(\d)/g;
  while ((numberedBedMatch = numberedBedRe.exec(p)) !== null) {
    const name = `Bedroom ${numberedBedMatch[1]}`;
    if (!seen.has(name)) { seen.add(name); found.push(name); }
  }

  // Detect BHK patterns: "4bhk", "10bhk" etc. implies N bedrooms
  const bhkMatch = p.match(/(\d+)\s*[-]?\s*bhk/);
  if (bhkMatch) {
    const count = parseInt(bhkMatch[1], 10);
    // Only add generic bedrooms if specific ones weren't found
    const specificBedrooms = found.filter(n =>
      n.toLowerCase().includes("bedroom") || n.toLowerCase().includes("master")
    ).length;
    if (specificBedrooms < count) {
      for (let i = specificBedrooms + 1; i <= count; i++) {
        const name = `Bedroom ${i}`;
        if (!seen.has(name)) { seen.add(name); found.push(name); }
      }
    }
  }

  return found;
}

// ── Find rooms mentioned in prompt but missing from AI output ───────────────

function findMissingRooms(
  mentionedRooms: string[],
  aiRooms: RoomSpec[],
  prompt: string,
): RoomSpec[] {
  const missing: RoomSpec[] = [];
  const aiNames = aiRooms.map(r => r.name.toLowerCase());

  // Detect floor context from prompt
  const p = prompt.toLowerCase();
  const isMultiFloor = p.includes("duplex") || p.includes("2-story") || p.includes("two floor") ||
    p.includes("2 floor") || (p.includes("ground floor") && p.includes("first floor"));

  for (const mentioned of mentionedRooms) {
    const mentionedLower = mentioned.toLowerCase();

    // Check if AI already has this room (fuzzy match)
    const found = aiNames.some(aiName => {
      // Exact match
      if (aiName === mentionedLower) return true;
      // One contains the other
      if (aiName.includes(mentionedLower) || mentionedLower.includes(aiName)) return true;
      // Key word match (e.g., "pooja" in "pooja room")
      const mentionedWords = mentionedLower.split(/\s+/);
      const aiWords = aiName.split(/\s+/);
      const keyMatch = mentionedWords.some(w => w.length > 3 && aiWords.some(aw => aw.includes(w) || w.includes(aw)));
      return keyMatch;
    });

    if (!found) {
      const spec = inferRoomSpec(mentioned, prompt, isMultiFloor);
      missing.push(spec);
    }
  }

  return missing;
}

// ── Infer room spec for a missing room ──────────────────────────────────────

function inferRoomSpec(roomName: string, prompt: string, isMultiFloor: boolean): RoomSpec {
  const name = roomName.toLowerCase();
  const p = prompt.toLowerCase();

  // Try to extract user-specified dimensions from prompt
  const dims = extractDimensionsForRoom(name, p);
  const areaSqm = dims?.area ?? inferDefaultArea(name);
  const { type, zone, exterior } = inferRoomTypeAndZone(name);
  const floor = inferFloor(name, p, isMultiFloor);

  return {
    name: roomName,
    type,
    areaSqm,
    zone,
    mustHaveExteriorWall: exterior,
    adjacentTo: [],
    preferNear: [],
    floor,
    preferredWidth: dims?.width,
    preferredDepth: dims?.depth,
  };
}

function extractDimensionsForRoom(roomName: string, prompt: string): { area: number; width: number; depth: number } | null {
  // Look for patterns like "pooja room 6x5 feet" or "living room 20x15 feet"
  const keywords = roomName.split(/\s+/).filter(w => w.length > 2);
  for (const keyword of keywords) {
    const pattern = new RegExp(
      `${keyword}[^.]*?(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:feet|ft|foot)`,
      "i"
    );
    const match = prompt.match(pattern);
    if (match) {
      const w = Math.round(parseFloat(match[1]) * 0.3048 * 10) / 10;
      const d = Math.round(parseFloat(match[2]) * 0.3048 * 10) / 10;
      return { area: Math.round(w * d * 10) / 10, width: w, depth: d };
    }

    // Also check for "Xm x Ym" or "X x Y meters"
    const mPattern = new RegExp(
      `${keyword}[^.]*?(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:m(?:eters?)?|sqm?)`,
      "i"
    );
    const mMatch = prompt.match(mPattern);
    if (mMatch) {
      const w = parseFloat(mMatch[1]);
      const d = parseFloat(mMatch[2]);
      return { area: Math.round(w * d * 10) / 10, width: w, depth: d };
    }
  }
  return null;
}

function inferDefaultArea(name: string): number {
  const DEFAULTS: Array<{ pattern: RegExp; area: number }> = [
    { pattern: /master\s+bed/, area: 18 },
    { pattern: /kids?\s+bed|bed(?:room)?/, area: 14 },
    { pattern: /guest\s+bed/, area: 15 },
    { pattern: /master\s+bath/, area: 7 },
    { pattern: /bath(?:room)?|toilet/, area: 4 },
    { pattern: /powder/, area: 2.5 },
    { pattern: /living/, area: 25 },
    { pattern: /dining/, area: 12 },
    { pattern: /kitchen/, area: 10 },
    { pattern: /foyer|entrance/, area: 6 },
    { pattern: /corridor|hallway/, area: 8 },
    { pattern: /staircase/, area: 12 },
    { pattern: /pooja|prayer|puja|mandir/, area: 3 },
    { pattern: /utility(?:\s+room)?$/, area: 4 },
    { pattern: /utility\s+balcony/, area: 5 },
    { pattern: /servant\s+quarter/, area: 8 },
    { pattern: /servant\s+toilet/, area: 2.5 },
    { pattern: /car\s+parking|garage/, area: 28 },
    { pattern: /walk[- ]?in\s+wardrobe|walk[- ]?in\s+closet/, area: 5 },
    { pattern: /shoe\s+rack|coat\s+closet/, area: 2.5 },
    { pattern: /verandah|veranda|porch|sit[- ]?out/, area: 10 },
    { pattern: /balcony/, area: 5 },
    { pattern: /terrace/, area: 15 },
    { pattern: /study/, area: 11 },
    { pattern: /family\s+lounge|tv\s+lounge|lounge/, area: 15 },
    { pattern: /home\s+theat/, area: 20 },
    { pattern: /pool/, area: 30 },
    { pattern: /gym/, area: 15 },
    { pattern: /store/, area: 4 },
    { pattern: /linen/, area: 2 },
    { pattern: /reception/, area: 15 },
    { pattern: /waiting/, area: 12 },
    { pattern: /meeting|conference/, area: 15 },
  ];

  for (const { pattern, area } of DEFAULTS) {
    if (pattern.test(name)) return area;
  }
  return 8; // safe default
}

function inferRoomTypeAndZone(name: string): { type: string; zone: RoomSpec["zone"]; exterior: boolean } {
  const MAPPING: Array<{ pattern: RegExp; type: string; zone: RoomSpec["zone"]; exterior: boolean }> = [
    { pattern: /bed(?:room)?|master\s+bed|kids?\s+bed|guest\s+bed/, type: "bedroom", zone: "private", exterior: true },
    { pattern: /bath(?:room)?|toilet|powder|wc/, type: "bathroom", zone: "service", exterior: false },
    { pattern: /living|lounge|family\s+room|tv\s+lounge/, type: "living", zone: "public", exterior: true },
    { pattern: /dining/, type: "dining", zone: "public", exterior: true },
    { pattern: /kitchen/, type: "kitchen", zone: "service", exterior: true },
    { pattern: /corridor|hallway|passage/, type: "hallway", zone: "circulation", exterior: false },
    { pattern: /staircase/, type: "staircase", zone: "circulation", exterior: false },
    { pattern: /foyer|entrance/, type: "entrance", zone: "circulation", exterior: true },
    { pattern: /utility/, type: "utility", zone: "service", exterior: false },
    { pattern: /balcony|verandah|veranda|porch|terrace|sit[- ]?out/, type: "balcony", zone: "public", exterior: true },
    { pattern: /car\s+parking|garage/, type: "other", zone: "service", exterior: true },
    { pattern: /servant/, type: "other", zone: "service", exterior: false },
    { pattern: /pooja|prayer|puja|mandir/, type: "other", zone: "private", exterior: false },
    { pattern: /wardrobe|closet|shoe|coat|linen/, type: "storage", zone: "private", exterior: false },
    { pattern: /study|office/, type: "office", zone: "private", exterior: true },
    { pattern: /pool/, type: "other", zone: "public", exterior: true },
    { pattern: /gym|fitness/, type: "other", zone: "private", exterior: true },
    { pattern: /store|storage/, type: "storage", zone: "service", exterior: false },
    { pattern: /home\s+theat/, type: "other", zone: "private", exterior: false },
    { pattern: /reception|waiting/, type: "other", zone: "public", exterior: false },
    { pattern: /meeting|conference/, type: "office", zone: "public", exterior: true },
  ];

  for (const { pattern, type, zone, exterior } of MAPPING) {
    if (pattern.test(name)) return { type, zone, exterior };
  }
  return { type: "other", zone: "service", exterior: false };
}

function inferFloor(name: string, prompt: string, isMultiFloor: boolean): number | undefined {
  if (!isMultiFloor) return 0;

  // Check if the room name appears after "first floor" or "upper floor" context
  const groundFloorSection = prompt.match(/ground\s+floor[:\s]+([\s\S]*?)(?=first\s+floor|upper\s+floor|$)/i);
  const firstFloorSection = prompt.match(/first\s+floor[:\s]+([\s\S]*?)(?=second\s+floor|$)/i);

  const keywords = name.split(/\s+/).filter(w => w.length > 3);

  if (groundFloorSection) {
    const gfText = groundFloorSection[1].toLowerCase();
    if (keywords.some(kw => gfText.includes(kw.toLowerCase()))) return 0;
  }
  if (firstFloorSection) {
    const ffText = firstFloorSection[1].toLowerCase();
    if (keywords.some(kw => ffText.includes(kw.toLowerCase()))) return 1;
  }

  // Defaults based on room type
  const GROUND_FLOOR = /living|dining|kitchen|guest|servant|car\s+park|garage|foyer|entrance|powder|pooja|prayer|shoe|coat|verandah/;
  const FIRST_FLOOR = /master|kids|study|family\s+lounge|terrace|walk[- ]?in|home\s+theat|utility\s+balcony/;

  if (GROUND_FLOOR.test(name)) return 0;
  if (FIRST_FLOOR.test(name)) return 1;

  return 0; // default to ground
}

// ── Convert EnhancedRoomProgram → BuildingDescription (for generateFloorPlan) ──

export function programToDescription(program: EnhancedRoomProgram): {
  buildingType: string;
  totalArea: number;
  floors: number;
  program: Array<{ space: string; area_m2?: number }>;
  programSummary: string;
  narrative: string;
  structure: string;
  facade: string;
  sustainabilityFeatures: string[];
  estimatedCost: string;
  constructionDuration: string;
  projectName: string;
} {
  return {
    buildingType: program.buildingType,
    totalArea: program.totalAreaSqm,
    floors: program.numFloors,
    program: program.rooms.map(r => ({ space: r.name, area_m2: Math.round(r.areaSqm) })),
    programSummary: `${program.projectName} with ${program.rooms.map(r => r.name).join(", ")}`,
    narrative: program.circulationNotes || `AI-generated room program for ${program.buildingType}`,
    structure: "RCC frame",
    facade: "Contemporary",
    sustainabilityFeatures: ["Natural ventilation", "Cross ventilation"],
    estimatedCost: "",
    constructionDuration: "",
    projectName: program.projectName,
  };
}

// ── Regex fallback (offline, no API key) ─────────────────────────────────────

export function programRoomsFallback(prompt: string): EnhancedRoomProgram {
  const p = prompt.toLowerCase().trim();

  let bhk = 0;
  const bhkMatch = p.match(/(\d+)\s*[-]?\s*bhk/);
  if (bhkMatch) bhk = parseInt(bhkMatch[1], 10);
  if (!bhk) {
    const bedroomMatch = p.match(/(\d+)\s*[-]?\s*bed(?:room)?s?\b/);
    if (bedroomMatch) bhk = parseInt(bedroomMatch[1], 10);
  }
  if (!bhk) {
    const wordNums: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12,
    };
    const wordMatch = p.match(/(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*[-]?\s*bed(?:room)?s?\b/);
    if (wordMatch) bhk = wordNums[wordMatch[1]] ?? 0;
  }
  if (!bhk) bhk = 2;
  bhk = Math.max(1, Math.min(bhk, 20));

  // Detect multi-floor
  let numFloors = 1;
  if (
    p.includes("duplex") || p.includes("2-story") || p.includes("2 story") ||
    p.includes("two story") || p.includes("two-story") || p.includes("two floor") ||
    p.includes("2 floor") || (p.includes("ground floor") && p.includes("first floor"))
  ) {
    numFloors = 2;
  } else if (
    p.includes("triplex") || p.includes("3-story") || p.includes("3 story") ||
    p.includes("three story") || p.includes("three floor") || p.includes("3 floor")
  ) {
    numFloors = 3;
  }

  let buildingType = "Residential Apartment";
  if (p.includes("duplex")) buildingType = "Duplex";
  else if (p.includes("villa")) buildingType = "Residential Villa";
  else if (p.includes("bungalow")) buildingType = "Residential Bungalow";
  else if (p.includes("house")) buildingType = "Residential House";
  else if (p.includes("office")) buildingType = "Commercial Office";
  else if (p.includes("studio")) buildingType = "Studio Apartment";
  else if (p.includes("penthouse")) buildingType = "Penthouse";

  const areaPerBhk: Record<number, number> = { 1: 55, 2: 90, 3: 140, 4: 200, 5: 280 };
  const totalArea = areaPerBhk[bhk] ?? bhk * 45 + 20;

  const rooms: RoomSpec[] = [];
  const adjacency: AdjacencyRequirement[] = [];

  // Public zone
  if (bhk <= 2) {
    rooms.push({ name: "Living + Dining Room", type: "living", areaSqm: Math.round(totalArea * 0.22), zone: "public", mustHaveExteriorWall: true, adjacentTo: ["Kitchen", "Foyer"], preferNear: [] });
  } else {
    rooms.push({ name: "Living Room", type: "living", areaSqm: Math.round(totalArea * 0.15), zone: "public", mustHaveExteriorWall: true, adjacentTo: ["Dining Room", "Corridor"], preferNear: [] });
    rooms.push({ name: "Dining Room", type: "dining", areaSqm: Math.round(totalArea * 0.08), zone: "public", mustHaveExteriorWall: true, adjacentTo: ["Living Room", "Kitchen"], preferNear: [] });
    adjacency.push({ roomA: "Living Room", roomB: "Dining Room", reason: "open plan flow" });
  }

  // Service zone
  rooms.push({ name: "Kitchen", type: "kitchen", areaSqm: Math.max(8, Math.round(totalArea * 0.08)), zone: "service", mustHaveExteriorWall: true, adjacentTo: bhk <= 2 ? ["Living + Dining Room"] : ["Dining Room"], preferNear: ["Utility"] });
  adjacency.push({ roomA: "Kitchen", roomB: bhk <= 2 ? "Living + Dining Room" : "Dining Room", reason: "serving access" });

  // Private zone - bedrooms
  rooms.push({ name: "Master Bedroom", type: "bedroom", areaSqm: Math.max(14, Math.round(totalArea * 0.14)), zone: "private", mustHaveExteriorWall: true, adjacentTo: ["Bathroom 1"], preferNear: [] });
  adjacency.push({ roomA: "Master Bedroom", roomB: "Bathroom 1", reason: "attached bath" });

  for (let i = 2; i <= bhk; i++) {
    rooms.push({ name: `Bedroom ${i}`, type: "bedroom", areaSqm: Math.max(10, Math.round(totalArea * 0.10)), zone: "private", mustHaveExteriorWall: true, adjacentTo: [], preferNear: [`Bathroom ${Math.min(i, bhk)}`] });
  }

  // Service zone - bathrooms
  const numBath = Math.max(1, bhk);
  for (let i = 1; i <= numBath; i++) {
    const name = numBath === 1 ? "Bathroom" : `Bathroom ${i}`;
    rooms.push({ name, type: "bathroom", areaSqm: i === 1 ? 5 : 4, zone: "service", mustHaveExteriorWall: false, adjacentTo: [], preferNear: [] });
  }

  // Circulation
  if (bhk >= 2) {
    rooms.push({ name: "Corridor", type: "hallway", areaSqm: Math.round(totalArea * 0.06), zone: "circulation", mustHaveExteriorWall: false, adjacentTo: [], preferNear: [] });
  }

  // Utility
  if (bhk >= 3) {
    rooms.push({ name: "Utility", type: "utility", areaSqm: 4, zone: "service", mustHaveExteriorWall: false, adjacentTo: ["Kitchen"], preferNear: [] });
    adjacency.push({ roomA: "Kitchen", roomB: "Utility", reason: "service connection" });
  }

  // Verandah for villas/houses
  if (p.includes("villa") || p.includes("bungalow") || p.includes("house")) {
    rooms.push({ name: "Verandah", type: "balcony", areaSqm: Math.round(totalArea * 0.06), zone: "public", mustHaveExteriorWall: true, adjacentTo: [], preferNear: ["Living Room", "Living + Dining Room"] });
  }

  // Multi-floor: assign floor numbers and add staircases
  if (numFloors >= 2) {
    let bathIdx = 0;
    for (const room of rooms) {
      if (room.zone === "public" || room.type === "kitchen") {
        room.floor = 0;
      } else if (room.type === "bedroom") {
        // Distribute bedrooms across upper floors
        room.floor = Math.min(1, numFloors - 1);
      } else if (room.type === "bathroom") {
        // First bathroom on ground floor (powder room), rest on same floor as paired bedroom
        room.floor = bathIdx === 0 ? 0 : Math.min(1, numFloors - 1);
        bathIdx++;
      } else if (room.zone === "circulation") {
        room.floor = 0;
      } else {
        room.floor = 0;
      }
    }

    // Add staircase on each floor
    for (let f = 0; f < numFloors; f++) {
      rooms.push({
        name: "Staircase", type: "staircase", areaSqm: 12,
        zone: "circulation", mustHaveExteriorWall: false,
        adjacentTo: [], preferNear: [], floor: f,
      });
    }
  }

  const zones = {
    public: rooms.filter(r => r.zone === "public").map(r => r.name),
    private: rooms.filter(r => r.zone === "private").map(r => r.name),
    service: rooms.filter(r => r.zone === "service").map(r => r.name),
    circulation: rooms.filter(r => r.zone === "circulation").map(r => r.name),
  };

  const projectName = `${bhk}BHK ${buildingType.split(" ").pop()}`;

  return {
    buildingType,
    totalAreaSqm: totalArea,
    numFloors,
    rooms,
    adjacency,
    zones,
    entranceRoom: bhk <= 2 ? "Living + Dining Room" : "Living Room",
    circulationNotes: `Entrance leads to ${bhk <= 2 ? "living + dining" : "corridor separating public and private zones"}.`,
    projectName,
  };
}
