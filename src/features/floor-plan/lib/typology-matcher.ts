/**
 * Typology Matcher
 *
 * Given an EnhancedRoomProgram (from ai-room-programmer.ts), find the best
 * matching TypologyTemplate and scale its slot dimensions to match the user's
 * area requirements.
 *
 * The matcher:
 *   1. Filters templates by hard constraints (bedroom count, building type)
 *   2. Scores remaining candidates by room coverage, area fit, special rooms, keywords
 *   3. Scales the winning template's slots to match the user's room areas
 *   4. Computes row/column positions to produce a ready-to-optimize layout
 */

import type { EnhancedRoomProgram, RoomSpec } from './ai-room-programmer';
import {
  TYPOLOGY_TEMPLATES,
  templateIdealArea,
  type TypologyTemplate,
  type TemplateSlot,
} from './typology-templates';
import { classifyRoom } from './room-sizer';
import { getRoomRule } from './architectural-rules';

// ============================================================
// OUTPUT TYPES
// ============================================================

export interface ScaledRoom {
  /** Template slot ID this room was assigned to */
  slotId: string;
  /** Room name from the user's program (e.g., "Master Bedroom") */
  name: string;
  /** Classified room type (e.g., "master_bedroom") */
  type: string;
  /** X position within footprint (meters) */
  x: number;
  /** Y position within footprint (meters) */
  y: number;
  /** Width (meters), scaled from template */
  width: number;
  /** Depth (meters), scaled from template */
  depth: number;
  /** Zone from template slot */
  zone: string;
  /** Row index from template slot */
  row: number;
  /** Column index from template slot */
  column: number;
}

export interface TemplateMatch {
  /** The matched template */
  template: TypologyTemplate;
  /** Confidence score 0-1: how well this template fits the program */
  confidence: number;
  /** Template slots with dimensions scaled to match the user's program */
  scaledRooms: ScaledRoom[];
  /** Room names from the program that don't fit any template slot */
  overflowRooms: string[];
  /** Corridor spine definition */
  corridorSpine: {
    x: number; y: number;
    width: number; depth: number;
  };
  /** Total building footprint after scaling */
  footprint: {
    width: number;
    depth: number;
  };
}

// ============================================================
// CONSTANTS
// ============================================================

/** Minimum confidence to accept a template match */
const MIN_CONFIDENCE = 0.5;

/** Standard room types that every residential template is expected to have */
const STANDARD_ROOM_TYPES = new Set([
  'master_bedroom', 'bedroom', 'guest_bedroom', 'children_bedroom',
  'bathroom', 'master_bathroom', 'toilet', 'powder_room', 'half_bath',
  'kitchen', 'living_room', 'dining_room', 'drawing_room',
  'corridor', 'hallway', 'passage', 'foyer', 'entrance_lobby',
  'balcony',
]);

/** Bedroom room types for counting */
const BEDROOM_TYPES = new Set([
  'master_bedroom', 'bedroom', 'guest_bedroom', 'children_bedroom',
]);

/** Types that can be fuzzy-matched to template slots */
const FUZZY_MAP: Record<string, string[]> = {
  bedroom: ['master_bedroom', 'guest_bedroom', 'children_bedroom'],
  master_bedroom: ['bedroom'],
  guest_bedroom: ['bedroom'],
  children_bedroom: ['bedroom'],
  bathroom: ['master_bathroom', 'toilet', 'powder_room', 'half_bath', 'servant_toilet', 'commercial_toilet'],
  master_bathroom: ['bathroom'],
  toilet: ['bathroom', 'powder_room', 'half_bath'],
  powder_room: ['bathroom', 'toilet', 'half_bath'],
  living_room: ['drawing_room', 'family_room'],
  drawing_room: ['living_room'],
  corridor: ['hallway', 'passage'],
  hallway: ['corridor', 'passage'],
  foyer: ['entrance_lobby'],
  entrance_lobby: ['foyer'],
  study: ['home_office'],
  home_office: ['study'],
  utility: ['laundry', 'store_room'],
  laundry: ['utility'],
  cabin: ['manager_cabin', 'director_cabin'],
  manager_cabin: ['cabin'],
  conference_room: ['meeting_room', 'board_room'],
  meeting_room: ['conference_room'],
};

// ============================================================
// MAIN API
// ============================================================

/**
 * Match a room program to the best typology template and scale dimensions.
 *
 * Returns null if no template achieves confidence >= 0.5.
 */
export function matchTypology(program: EnhancedRoomProgram): TemplateMatch | null {
  const bedroomCount = countBedrooms(program);
  const buildingType = (program.buildingType || '').toLowerCase();

  // Step 1: Filter by hard constraints
  const candidates = TYPOLOGY_TEMPLATES.filter(t => {
    if (bedroomCount < t.applicability.minBedrooms) return false;
    if (bedroomCount > t.applicability.maxBedrooms) return false;
    // Building type: check if any of the template's building types appear in the program's type
    const btMatch = t.applicability.buildingTypes.some(bt =>
      buildingType.includes(bt) || bt.includes(buildingType),
    );
    if (!btMatch) {
      // Fallback: if buildingType is empty or very generic, allow residential templates
      const isResidential = !buildingType || /apartment|flat|house|villa|home|residential|duplex|bungalow|row/i.test(buildingType);
      const templateIsResidential = t.applicability.buildingTypes.some(bt =>
        /apartment|flat|house|villa|duplex/i.test(bt),
      );
      if (!(isResidential && templateIsResidential)) return false;
    }
    return true;
  });

  if (candidates.length === 0) return null;

  // Step 2: Score each candidate
  let bestTemplate: TypologyTemplate | null = null;
  let bestScore = 0;

  for (const template of candidates) {
    const score = scoreTemplate(template, program, bedroomCount, buildingType);
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = template;
    }
  }

  if (!bestTemplate) return null;

  const confidence = Math.min(bestScore / 100, 1.0);
  if (confidence < MIN_CONFIDENCE) return null;

  // Step 3: Scale and position
  return scaleAndPosition(bestTemplate, program, confidence);
}

// ============================================================
// SCORING
// ============================================================

/** Score a template against a room program (0-100 scale) */
function scoreTemplate(
  template: TypologyTemplate,
  program: EnhancedRoomProgram,
  bedroomCount: number,
  buildingType: string,
): number {
  let score = 0;

  // ── A. Room type coverage (40%) ──
  const { matchedCount, totalRooms } = computeRoomCoverage(template, program);
  const coverage = totalRooms > 0 ? matchedCount / totalRooms : 0;
  score += coverage * 40;

  // ── B. Area compatibility (30%) ──
  const templateArea = templateIdealArea(template);
  const programArea = program.totalAreaSqm > 0
    ? program.totalAreaSqm
    : program.rooms.reduce((s, r) => s + r.areaSqm, 0);

  if (programArea > 0 && templateArea > 0) {
    const areaRatio = Math.min(programArea, templateArea) / Math.max(programArea, templateArea);
    score += areaRatio * 30;
  } else {
    score += 15; // neutral if area unknown
  }

  // ── C. Special room handling (20%) ──
  const classifiedTypes = program.rooms.map(r => classifyRoom(r.type, r.name));
  const specialRooms = classifiedTypes.filter(t => !STANDARD_ROOM_TYPES.has(t));
  if (specialRooms.length > 0) {
    const slotTypes = new Set(template.slots.map(s => s.roomType));
    const matchedSpecial = specialRooms.filter(t => slotTypes.has(t)).length;
    score += (matchedSpecial / specialRooms.length) * 20;
  } else {
    score += 20; // no special rooms = no penalty
  }

  // ── D. Keyword / building type bonus (10%) ──
  const promptLower = (program.originalPrompt || '').toLowerCase();
  const combinedText = `${buildingType} ${promptLower}`;
  const keywordMatch = template.applicability.keywords.some(kw =>
    combinedText.includes(kw),
  );
  if (keywordMatch) score += 10;

  return score;
}

/** Count how many program rooms have a matching slot in the template */
function computeRoomCoverage(
  template: TypologyTemplate,
  program: EnhancedRoomProgram,
): { matchedCount: number; totalRooms: number } {
  const matched = new Set<number>();
  const usedSlots2 = new Set<string>();

  // First pass: exact type match
  for (let i = 0; i < program.rooms.length; i++) {
    const room = program.rooms[i];
    const ct = classifyRoom(room.type, room.name);
    const slot = template.slots.find(s =>
      s.roomType === ct && !usedSlots2.has(s.id),
    );
    if (slot) {
      usedSlots2.add(slot.id);
      matched.add(i);
    }
  }

  // Second pass: fuzzy
  for (let i = 0; i < program.rooms.length; i++) {
    if (matched.has(i)) continue;
    const room = program.rooms[i];
    const ct = classifyRoom(room.type, room.name);
    const alternatives = FUZZY_MAP[ct] || [];
    for (const alt of alternatives) {
      const slot = template.slots.find(s =>
        s.roomType === alt && !usedSlots2.has(s.id),
      );
      if (slot) {
        usedSlots2.add(slot.id);
        matched.add(i);
        break;
      }
    }
  }

  return { matchedCount: matched.size, totalRooms: program.rooms.length };
}

// ============================================================
// SCALING + POSITIONING
// ============================================================

/**
 * Scale a template's slots to match the program's room areas
 * and compute row/column positions.
 */
function scaleAndPosition(
  template: TypologyTemplate,
  program: EnhancedRoomProgram,
  confidence: number,
): TemplateMatch {
  // Step 1: Assign program rooms to template slots
  const { assignments, overflow } = assignRoomsToSlots(template, program);

  // Step 2: Compute scale factor from assigned rooms
  let totalProgramArea = 0;
  let totalTemplateArea = 0;
  for (const [slotId, room] of assignments) {
    totalProgramArea += room.areaSqm;
    const slot = template.slots.find(s => s.id === slotId)!;
    totalTemplateArea += slot.idealWidth * slot.idealDepth;
  }
  // If no rooms assigned, use totalAreaSqm vs template ideal area
  if (totalTemplateArea === 0) {
    totalTemplateArea = templateIdealArea(template);
    totalProgramArea = program.totalAreaSqm > 0
      ? program.totalAreaSqm
      : totalTemplateArea;
  }

  const scaleFactor = totalTemplateArea > 0
    ? Math.sqrt(totalProgramArea / totalTemplateArea)
    : 1.0;

  // Step 3: Scale each slot's dimensions
  const scaledSlots: Array<{
    slot: TemplateSlot;
    scaledWidth: number;
    scaledDepth: number;
    assignedRoom: RoomSpec | null;
  }> = [];

  for (const slot of template.slots) {
    // Skip optional unmatched slots
    if (!slot.required && !assignments.has(slot.id)) continue;

    const assignedRoom = assignments.get(slot.id) ?? null;
    let w = slot.idealWidth;
    let d = slot.idealDepth;

    // Apply global scale to scalable dimensions
    if (slot.scalable) {
      if (slot.scaleAxis === 'both') {
        w *= scaleFactor;
        d *= scaleFactor;
      } else if (slot.scaleAxis === 'width') {
        w *= scaleFactor;
      } else {
        d *= scaleFactor;
      }
    }

    // Clamp to minimums from template (which match architectural-rules.ts)
    w = Math.max(w, slot.minWidth);
    d = Math.max(d, slot.minDepth);

    // Clamp to max from architectural-rules.ts area cap
    const rule = getRoomRule(slot.roomType);
    const maxArea = rule.area.max;

    // If a program room was assigned, adjust to match its specific target area
    if (assignedRoom) {
      const targetArea = assignedRoom.areaSqm;
      const currentArea = w * d;
      if (currentArea > 0 && targetArea > 0) {
        const areaAdjust = Math.sqrt(targetArea / currentArea);
        w *= areaAdjust;
        d *= areaAdjust;
      }
      // Re-clamp to minimums
      w = Math.max(w, slot.minWidth);
      d = Math.max(d, slot.minDepth);
    }

    // Clamp to max area (don't let rooms get absurdly large)
    if (w * d > maxArea * 1.2) {
      const areaClamp = Math.sqrt((maxArea * 1.2) / (w * d));
      w *= areaClamp;
      d *= areaClamp;
      // But never below minimums
      w = Math.max(w, slot.minWidth);
      d = Math.max(d, slot.minDepth);
    }

    // Enforce aspect ratio
    const longer = Math.max(w, d);
    const shorter = Math.min(w, d);
    if (shorter > 0 && longer / shorter > slot.maxAspectRatio) {
      // Reduce the longer dimension
      if (w >= d) {
        w = d * slot.maxAspectRatio;
      } else {
        d = w * slot.maxAspectRatio;
      }
    }

    // Round to 100mm grid
    w = Math.round(w * 10) / 10;
    d = Math.round(d * 10) / 10;

    scaledSlots.push({ slot, scaledWidth: w, scaledDepth: d, assignedRoom });
  }

  // Step 4: Compute positions from rows and columns
  // Group slots by row
  const rowMap = new Map<number, typeof scaledSlots>();
  for (const entry of scaledSlots) {
    const row = entry.slot.row;
    if (!rowMap.has(row)) rowMap.set(row, []);
    rowMap.get(row)!.push(entry);
  }

  // Sort rows by row number, within each row sort by column
  const sortedRows = [...rowMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entries]) => entries.sort((a, b) => a.slot.column - b.slot.column));

  // Compute row depths and position
  const scaledRooms: ScaledRoom[] = [];
  let corridorSpine = { x: 0, y: 0, width: 0, depth: 0 };
  let yOffset = 0;
  let maxRowWidth = 0;

  for (const rowEntries of sortedRows) {
    const rowDepth = Math.max(...rowEntries.map(e => e.scaledDepth));
    let xOffset = 0;

    for (const entry of rowEntries) {
      const name = entry.assignedRoom
        ? entry.assignedRoom.name
        : entry.slot.label;

      // Use the room's own scaled depth — NOT the row max. This prevents
      // bathrooms (2.5m) from being stretched to bedroom depth (4.2m).
      // Shorter rooms align to the top of the row; the optimizer handles gaps.
      const roomDepth = entry.scaledDepth;

      const room: ScaledRoom = {
        slotId: entry.slot.id,
        name,
        type: entry.slot.roomType,
        x: round1(xOffset),
        y: round1(yOffset),
        width: entry.scaledWidth,
        depth: round1(roomDepth),
        zone: entry.slot.zone,
        row: entry.slot.row,
        column: entry.slot.column,
      };
      scaledRooms.push(room);

      // Track corridor
      if (['corridor', 'hallway', 'passage'].includes(entry.slot.roomType)) {
        corridorSpine = {
          x: room.x,
          y: room.y,
          width: entry.scaledWidth,
          depth: round1(roomDepth),
        };
      }

      xOffset += entry.scaledWidth;
    }

    maxRowWidth = Math.max(maxRowWidth, xOffset);
    yOffset += rowDepth;
  }

  // Step 5: Normalize corridor width to span the full building
  if (corridorSpine.width > 0) {
    corridorSpine.width = round1(maxRowWidth);
    // Also update the corridor room in scaledRooms
    const corridorRoom = scaledRooms.find(r =>
      ['corridor', 'hallway', 'passage'].includes(r.type),
    );
    if (corridorRoom) {
      corridorRoom.width = corridorSpine.width;
    }
  }

  const footprint = {
    width: round1(maxRowWidth),
    depth: round1(yOffset),
  };

  return {
    template,
    confidence,
    scaledRooms,
    overflowRooms: overflow,
    corridorSpine,
    footprint,
  };
}

// ============================================================
// ROOM-TO-SLOT ASSIGNMENT
// ============================================================

/**
 * Assign program rooms to template slots. Returns assignments and overflow.
 *
 * Strategy: exact type match first (largest rooms first), then fuzzy match.
 */
function assignRoomsToSlots(
  template: TypologyTemplate,
  program: EnhancedRoomProgram,
): { assignments: Map<string, RoomSpec>; overflow: string[] } {
  const assignments = new Map<string, RoomSpec>();
  const usedSlots = new Set<string>();
  const matchedRoomIndices = new Set<number>();

  // Sort rooms by area descending — assign largest rooms first to give them
  // priority for the best-fitting slots
  const sortedIndices = program.rooms
    .map((_, i) => i)
    .sort((a, b) => program.rooms[b].areaSqm - program.rooms[a].areaSqm);

  // First pass: exact type match
  for (const i of sortedIndices) {
    const room = program.rooms[i];
    const ct = classifyRoom(room.type, room.name);
    const slot = template.slots.find(s =>
      s.roomType === ct && !usedSlots.has(s.id),
    );
    if (slot) {
      assignments.set(slot.id, room);
      usedSlots.add(slot.id);
      matchedRoomIndices.add(i);
    }
  }

  // Second pass: fuzzy match for unmatched rooms
  for (const i of sortedIndices) {
    if (matchedRoomIndices.has(i)) continue;
    const room = program.rooms[i];
    const ct = classifyRoom(room.type, room.name);
    const alternatives = FUZZY_MAP[ct] || [];
    for (const alt of alternatives) {
      const slot = template.slots.find(s =>
        s.roomType === alt && !usedSlots.has(s.id),
      );
      if (slot) {
        assignments.set(slot.id, room);
        usedSlots.add(slot.id);
        matchedRoomIndices.add(i);
        break;
      }
    }
  }

  // Overflow: program rooms that weren't assigned to any slot
  const overflow: string[] = [];
  for (let i = 0; i < program.rooms.length; i++) {
    if (!matchedRoomIndices.has(i)) {
      overflow.push(program.rooms[i].name);
    }
  }

  return { assignments, overflow };
}

// ============================================================
// HELPERS
// ============================================================

/** Count bedrooms in a program using classifyRoom */
function countBedrooms(program: EnhancedRoomProgram): number {
  let count = 0;
  for (const room of program.rooms) {
    const ct = classifyRoom(room.type, room.name);
    if (BEDROOM_TYPES.has(ct)) count++;
  }
  return count;
}

/** Round to 1 decimal place (100mm precision) */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
