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

CRITICAL RULES:
1. Include ALL rooms the user mentions explicitly — do NOT skip any
2. Add essential rooms the user didn't mention:
   - Residential: kitchen (if missing), at least 1 bathroom, living area, corridor (if 3+ rooms)
   - Commercial: reception, restrooms, server/utility room
   - Medical: waiting area, reception, restroom
   - Any building: at least one entrance/foyer area
3. "BHK" = bedrooms + hall + kitchen. "3BHK" = 3 bedrooms + living/hall + kitchen
4. Each bedroom gets an attached bathroom (unless user says otherwise)
5. For 3+ bedrooms: add utility room
6. For villa/bungalow/house: add verandah/porch
7. If user mentions special rooms (home theater, gym, pool, servant quarter), include them

ROOM TYPES (use ONLY these): living, dining, kitchen, bedroom, bathroom, hallway, entrance, utility, balcony, office, storage, staircase, other

ZONE ASSIGNMENT:
- public: living room, dining room, entrance, foyer, reception, waiting area, retail
- private: bedrooms, study, home office, home theater, gym, prayer room
- service: kitchen, bathrooms, utility, laundry, storage, server room, pantry
- circulation: corridor, hallway, foyer, passage, staircase, lobby

ADJACENCY RULES (generate these pairs):
- Kitchen ↔ Dining (serving access)
- Master Bedroom ↔ Master Bathroom (attached bath)
- Each Bedroom ↔ nearest Bathroom (within 1 room distance)
- Living Room ↔ Dining Room (open plan flow)
- Entrance/Foyer ↔ Living Room (arrival sequence)
- Kitchen ↔ Utility (service connection)
- Wet rooms (bathrooms, kitchen, utility) should cluster for shared plumbing
- Corridor must touch both public and private zones

EXTERIOR WALL RULES:
- MUST have exterior wall: all bedrooms, living room, dining room, kitchen, office
- CAN be interior: bathroom, WC, corridor, utility, storage, staircase, closet

SIZE GUIDELINES (sqm, Indian standards):
- Master Bedroom: 14-20, Other Bedrooms: 10-15
- Living Room: 18-30 (larger for 3+ BHK), Dining Room: 10-15, Living+Dining: 22-35
- Kitchen: 8-12, Bathroom: 4-6, WC/Toilet: 2.5-4
- Corridor/Hallway: 5-12, Utility: 3-5, Foyer/Entrance: 4-8
- Balcony/Verandah: 5-12, Home Theater: 15-25, Gym: 10-20, Study/Office: 8-12
- Reception (commercial): 12-25, Waiting Area: 10-20, Meeting Room: 12-20

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
      "zone": "public",
      "mustHaveExteriorWall": true,
      "adjacentTo": ["Dining Room", "Foyer"],
      "preferNear": ["Kitchen"]
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

// ── Main function ────────────────────────────────────────────────────────────

export async function programRooms(
  prompt: string,
  userApiKey?: string
): Promise<EnhancedRoomProgram> {
  const client = getClient(userApiKey);

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned empty response for room program");

  const raw = JSON.parse(content) as EnhancedRoomProgram;

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

  return raw;
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
  const bhkMatch = p.match(/(\d)\s*[-]?\s*bhk/);
  if (bhkMatch) bhk = parseInt(bhkMatch[1], 10);
  if (!bhk) {
    const bedroomMatch = p.match(/(\d+)\s*[-]?\s*bed(?:room)?s?\b/);
    if (bedroomMatch) bhk = parseInt(bedroomMatch[1], 10);
  }
  if (!bhk) {
    const wordNums: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const wordMatch = p.match(/(one|two|three|four|five)\s*[-]?\s*bed(?:room)?s?\b/);
    if (wordMatch) bhk = wordNums[wordMatch[1]] ?? 0;
  }
  if (!bhk) bhk = 2;
  bhk = Math.max(1, Math.min(bhk, 9));

  let buildingType = "Residential Apartment";
  if (p.includes("villa")) buildingType = "Residential Villa";
  else if (p.includes("bungalow")) buildingType = "Residential Bungalow";
  else if (p.includes("house")) buildingType = "Residential House";
  else if (p.includes("office")) buildingType = "Commercial Office";
  else if (p.includes("studio")) buildingType = "Studio Apartment";
  else if (p.includes("penthouse")) buildingType = "Penthouse";
  else if (p.includes("duplex")) buildingType = "Duplex";

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
    numFloors: 1,
    rooms,
    adjacency,
    zones,
    entranceRoom: bhk <= 2 ? "Living + Dining Room" : "Living Room",
    circulationNotes: `Entrance leads to ${bhk <= 2 ? "living + dining" : "corridor separating public and private zones"}.`,
    projectName,
  };
}
