/**
 * Room Program Validation
 *
 * Validates that a generated floor plan matches what the user asked for.
 * Parses the original prompt for requirements and compares against actual plan.
 */

import type { Floor, Room, RoomType } from "@/types/floor-plan-cad";

// ============================================================
// TYPES
// ============================================================

export interface ProgramRequirement {
  type: "room_count" | "area" | "feature";
  label: string;
  expected: string;
  actual: string;
  met: boolean;
}

export interface ProgramIssue {
  severity: "error" | "warning" | "suggestion";
  message: string;
  roomId?: string;
  fixable?: boolean;
  fixDescription?: string;
}

export interface ProgramValidationResult {
  requirements: ProgramRequirement[];
  issues: ProgramIssue[];
  score: number; // 0-100
  summary: string;
}

// ============================================================
// PROMPT PARSING
// ============================================================

interface ParsedRequirements {
  bedrooms: number | null;
  bathrooms: number | null;
  balconies: number | null;
  parking: number | null;
  totalArea_sqm: number | null;
  hasKitchen: boolean;
  hasLiving: boolean;
  hasDining: boolean;
  hasStudy: boolean;
  hasPuja: boolean;
  hasUtility: boolean;
  hasServantQuarter: boolean;
  rawBHK: number | null;
}

export function parsePromptRequirements(prompt: string): ParsedRequirements {
  const lower = prompt.toLowerCase();
  const result: ParsedRequirements = {
    bedrooms: null,
    bathrooms: null,
    balconies: null,
    parking: null,
    totalArea_sqm: null,
    hasKitchen: true, // Always expected
    hasLiving: true,
    hasDining: false,
    hasStudy: false,
    hasPuja: false,
    hasUtility: false,
    hasServantQuarter: false,
    rawBHK: null,
  };

  // Parse BHK pattern: "3bhk", "3 bhk", "3-bhk"
  const bhkMatch = lower.match(/(\d)\s*[-]?\s*bhk/);
  if (bhkMatch) {
    result.rawBHK = parseInt(bhkMatch[1]);
    result.bedrooms = result.rawBHK;
    // BHK implies: B bedrooms, hall (living), kitchen
    // Bathrooms: typically B (one per bedroom, or B+1 for master)
    result.bathrooms = result.rawBHK;
    result.hasLiving = true;
    result.hasKitchen = true;
    result.hasDining = result.rawBHK >= 2;
  }

  // Explicit bedroom count
  const bedroomMatch = lower.match(/(\d+)\s*(?:bed(?:room)?s?)/);
  if (bedroomMatch) result.bedrooms = parseInt(bedroomMatch[1]);

  // Explicit bathroom count
  const bathMatch = lower.match(/(\d+)\s*(?:bath(?:room)?s?|toilet)/);
  if (bathMatch) result.bathrooms = parseInt(bathMatch[1]);

  // Balconies
  const balconyMatch = lower.match(/(\d+)\s*balcon(?:y|ies)/);
  if (balconyMatch) result.balconies = parseInt(balconyMatch[1]);
  else if (lower.includes("balcon")) result.balconies = 1;

  // Parking
  const parkingMatch = lower.match(/(\d+)\s*(?:parking|garage)/);
  if (parkingMatch) result.parking = parseInt(parkingMatch[1]);
  else if (lower.includes("parking") || lower.includes("garage")) result.parking = 1;

  // Area in sqft or sqm
  const sqftMatch = lower.match(/(\d+)\s*(?:sq\s*ft|sqft|sft|square\s*f(?:ee|oo)t)/);
  if (sqftMatch) result.totalArea_sqm = parseInt(sqftMatch[1]) * 0.0929;

  const sqmMatch = lower.match(/(\d+)\s*(?:sq\s*m|sqm|square\s*met(?:er|re)s?)/);
  if (sqmMatch) result.totalArea_sqm = parseInt(sqmMatch[1]);

  // Feature keywords
  if (lower.includes("dining")) result.hasDining = true;
  if (lower.includes("study") || lower.includes("office")) result.hasStudy = true;
  if (lower.includes("puja") || lower.includes("pooja") || lower.includes("prayer")) result.hasPuja = true;
  if (lower.includes("utility") || lower.includes("laundry")) result.hasUtility = true;
  if (lower.includes("servant") || lower.includes("maid")) result.hasServantQuarter = true;

  return result;
}

// ============================================================
// ROOM COUNTING
// ============================================================

const BEDROOM_TYPES: RoomType[] = ["bedroom", "master_bedroom", "guest_bedroom"];
const BATHROOM_TYPES: RoomType[] = ["bathroom", "toilet", "wc"];
const BALCONY_TYPES: RoomType[] = ["balcony", "terrace", "verandah"];
const PARKING_TYPES: RoomType[] = ["parking", "garage"];

function countRoomsByType(rooms: Room[], types: RoomType[]): number {
  return rooms.filter((r) => types.includes(r.type)).length;
}

// ============================================================
// MAIN VALIDATOR
// ============================================================

export function validateProgram(
  floor: Floor,
  prompt: string | null | undefined,
): ProgramValidationResult {
  const requirements: ProgramRequirement[] = [];
  const issues: ProgramIssue[] = [];

  const reqs = prompt ? parsePromptRequirements(prompt) : null;
  const rooms = floor.rooms;

  // ---- Room count checks ----
  const actualBedrooms = countRoomsByType(rooms, BEDROOM_TYPES);
  const actualBathrooms = countRoomsByType(rooms, BATHROOM_TYPES);
  const actualBalconies = countRoomsByType(rooms, BALCONY_TYPES);
  const actualParking = countRoomsByType(rooms, PARKING_TYPES);
  const hasLiving = rooms.some((r) => r.type === "living_room");
  const hasKitchen = rooms.some((r) => r.type === "kitchen");
  const hasDining = rooms.some((r) => r.type === "dining_room");
  const hasStudy = rooms.some((r) => r.type === "study" || r.type === "home_office");
  const hasPuja = rooms.some((r) => r.type === "puja_room");

  if (reqs) {
    if (reqs.bedrooms !== null) {
      const met = actualBedrooms >= reqs.bedrooms;
      requirements.push({
        type: "room_count", label: "Bedrooms",
        expected: String(reqs.bedrooms), actual: String(actualBedrooms), met,
      });
      if (!met) {
        issues.push({
          severity: "error",
          message: `You asked for ${reqs.bedrooms} bedroom(s) but plan has ${actualBedrooms}`,
          fixable: false,
        });
      }
    }

    if (reqs.bathrooms !== null) {
      const met = actualBathrooms >= reqs.bathrooms;
      requirements.push({
        type: "room_count", label: "Bathrooms",
        expected: String(reqs.bathrooms), actual: String(actualBathrooms), met,
      });
      if (!met) {
        issues.push({
          severity: "warning",
          message: `Expected ${reqs.bathrooms} bathroom(s) but plan has ${actualBathrooms}`,
        });
      }
    }

    if (reqs.balconies !== null) {
      const met = actualBalconies >= reqs.balconies;
      requirements.push({
        type: "room_count", label: "Balconies",
        expected: String(reqs.balconies), actual: String(actualBalconies), met,
      });
      if (!met) {
        issues.push({
          severity: "warning",
          message: `Expected ${reqs.balconies} balcony/ies but plan has ${actualBalconies}`,
        });
      }
    }

    if (reqs.parking !== null) {
      const met = actualParking >= reqs.parking;
      requirements.push({
        type: "room_count", label: "Parking",
        expected: String(reqs.parking), actual: String(actualParking), met,
      });
      if (!met) {
        issues.push({
          severity: "error",
          message: `Expected ${reqs.parking} parking space(s) but plan has ${actualParking}`,
        });
      }
    }

    if (reqs.totalArea_sqm !== null) {
      const totalArea = rooms.reduce((sum, r) => sum + r.area_sqm, 0);
      const tolerance = reqs.totalArea_sqm * 0.15; // 15% tolerance
      const met = Math.abs(totalArea - reqs.totalArea_sqm) <= tolerance;
      requirements.push({
        type: "area", label: "Total Area",
        expected: `${reqs.totalArea_sqm.toFixed(0)} sqm`,
        actual: `${totalArea.toFixed(0)} sqm`, met,
      });
      if (totalArea > reqs.totalArea_sqm + tolerance) {
        issues.push({
          severity: "error",
          message: `Total area (${totalArea.toFixed(0)} sqm) exceeds specified ${reqs.totalArea_sqm.toFixed(0)} sqm by ${(totalArea - reqs.totalArea_sqm).toFixed(0)} sqm`,
        });
      } else if (totalArea < reqs.totalArea_sqm - tolerance) {
        issues.push({
          severity: "warning",
          message: `Total area (${totalArea.toFixed(0)} sqm) is ${(reqs.totalArea_sqm - totalArea).toFixed(0)} sqm less than requested`,
        });
      }
    }

    // Feature checks
    if (reqs.hasKitchen && !hasKitchen) {
      requirements.push({ type: "feature", label: "Kitchen", expected: "Yes", actual: "No", met: false });
      issues.push({ severity: "error", message: "Plan is missing a kitchen" });
    }
    if (reqs.hasLiving && !hasLiving) {
      requirements.push({ type: "feature", label: "Living Room", expected: "Yes", actual: "No", met: false });
      issues.push({ severity: "error", message: "Plan is missing a living room" });
    }
    if (reqs.hasDining && !hasDining) {
      requirements.push({ type: "feature", label: "Dining", expected: "Yes", actual: "No", met: false });
      issues.push({ severity: "warning", message: "Plan is missing a dining room" });
    }
    if (reqs.hasStudy && !hasStudy) {
      requirements.push({ type: "feature", label: "Study", expected: "Yes", actual: "No", met: false });
      issues.push({ severity: "suggestion", message: "Plan is missing a study/office — consider converting a room" });
    }
    if (reqs.hasPuja && !hasPuja) {
      requirements.push({ type: "feature", label: "Puja Room", expected: "Yes", actual: "No", met: false });
      issues.push({ severity: "suggestion", message: "Plan is missing a puja room" });
    }
  }

  // ---- Architectural checks (always run) ----

  // Every habitable room should have NBC-compliant area
  const NBC_MIN_AREAS: Partial<Record<RoomType, number>> = {
    living_room: 9.5, bedroom: 9.5, master_bedroom: 9.5, guest_bedroom: 9.5,
    dining_room: 7.5, kitchen: 5.0, bathroom: 1.8, toilet: 1.2,
  };

  for (const room of rooms) {
    const minArea = NBC_MIN_AREAS[room.type];
    if (minArea && room.area_sqm < minArea) {
      issues.push({
        severity: "warning",
        message: `${room.name} (${room.area_sqm.toFixed(1)} sqm) is below NBC minimum (${minArea} sqm)`,
        roomId: room.id,
        fixable: true,
        fixDescription: `Expand wall to increase area by ${(minArea - room.area_sqm).toFixed(1)} sqm`,
      });
    }
  }

  // Kitchen should have exterior wall for ventilation
  const kitchenRoom = rooms.find((r) => r.type === "kitchen");
  if (kitchenRoom) {
    const hasExteriorWall = floor.walls.some(
      (w) => w.type === "exterior" && (w.left_room_id === kitchenRoom.id || w.right_room_id === kitchenRoom.id)
    );
    if (!hasExteriorWall) {
      issues.push({
        severity: "warning",
        message: "Kitchen has no exterior wall — no natural ventilation",
        roomId: kitchenRoom.id,
      });
    }
  }

  // Living room should be accessible from entrance
  if (hasLiving) {
    const living = rooms.find((r) => r.type === "living_room")!;
    const mainDoor = floor.doors.find((d) => d.type === "main_entrance");
    if (mainDoor) {
      const connectedToEntrance = mainDoor.connects_rooms.includes(living.id);
      const connectedViaLobby = floor.doors.some((d) =>
        d.connects_rooms.includes(living.id) &&
        floor.rooms.some((r) =>
          (r.type === "lobby" || r.type === "foyer" || r.type === "corridor") &&
          d.connects_rooms.includes(r.id)
        )
      );
      if (!connectedToEntrance && !connectedViaLobby) {
        issues.push({
          severity: "warning",
          message: "Living room has no direct access from entrance",
          roomId: living.id,
        });
      }
    }
  }

  // Bathrooms should be attached to bedrooms or corridors
  for (const bath of rooms.filter((r) => BATHROOM_TYPES.includes(r.type))) {
    const connectedRooms = floor.doors
      .filter((d) => d.connects_rooms.includes(bath.id))
      .flatMap((d) => d.connects_rooms)
      .filter((id) => id !== bath.id && id !== "");

    const connectedToBedroomOrCorridor = connectedRooms.some((id) => {
      const room = rooms.find((r) => r.id === id);
      return room && (BEDROOM_TYPES.includes(room.type) || room.type === "corridor" || room.type === "lobby");
    });

    if (!connectedToBedroomOrCorridor && connectedRooms.length > 0) {
      issues.push({
        severity: "suggestion",
        message: `${bath.name} is not attached to any bedroom or corridor`,
        roomId: bath.id,
      });
    }
  }

  // Compute score
  const totalReqs = requirements.length + issues.filter((i) => i.severity === "error").length;
  const metReqs = requirements.filter((r) => r.met).length;
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const score = totalReqs > 0
    ? Math.max(0, Math.round(((metReqs) / Math.max(1, requirements.length)) * 100 - errorCount * 10))
    : 100;

  const summary = errorCount > 0
    ? `${errorCount} critical issue(s) — plan does not match requirements`
    : issues.length > 0
      ? `Plan mostly matches requirements — ${issues.length} suggestion(s)`
      : "Plan matches all requirements";

  return { requirements, issues, score, summary };
}
