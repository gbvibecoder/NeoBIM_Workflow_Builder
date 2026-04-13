/**
 * Parametric Apartment Typology Templates
 *
 * Each template is a TOPOLOGY — a graph of room relationships with relative
 * positions and scaling rules. Templates are NOT fixed floor plans. They
 * encode the DNA of how a real Indian architect would arrange a specific
 * apartment type.
 *
 * Dimensions sourced from:
 *   - architectural-rules.ts (SINGLE SOURCE OF TRUTH for min/max)
 *   - NBC 2016, IS:SP7, Neufert Architects' Data
 *   - Indian residential market norms (2BHK 55-85 sqm, 3BHK 80-130 sqm, etc.)
 *
 * The optimizer (layout-optimizer.ts) uses these as warm-start seeds.
 * Grid snapping (snap-to-grid.ts) quantizes the final output to structural grid.
 */

// ============================================================
// TYPES
// ============================================================

export type SlotZone = 'private' | 'public' | 'service' | 'circulation';
export type ConnectionType = 'door' | 'open' | 'adjacent';
export type EntranceSide = 'south' | 'north' | 'east' | 'west';
export type CorridorType = 'linear' | 'L-shape' | 'U-shape' | 'central' | 'none';
export type ScaleAxis = 'width' | 'depth' | 'both';

export interface TemplateSlot {
  /** Unique slot ID within the template — e.g. "bedroom1", "bath1", "living" */
  id: string;
  /** Canonical room type — matches classifyRoom() and architectural-rules.ts */
  roomType: string;
  /** Display name shown to the user */
  label: string;
  /** Whether this slot must be filled (false = optional, e.g. balcony, utility) */
  required: boolean;

  /** Zoning classification */
  zone: SlotZone;
  /** Row index: 0 = back (typically private), higher = front (typically public) */
  row: number;
  /** Column index within the row: 0 = leftmost */
  column: number;

  /** Target dimensions (meters) — scaled by optimizer to match user area */
  idealWidth: number;
  idealDepth: number;
  /** Hard minimums from architectural-rules.ts */
  minWidth: number;
  minDepth: number;
  /** Maximum allowed aspect ratio (longer/shorter) */
  maxAspectRatio: number;

  /** Whether the optimizer may resize this slot */
  scalable: boolean;
  /** Which axis grows when total area increases */
  scaleAxis: ScaleAxis;
}

export interface TemplateConnection {
  /** Source slot ID */
  from: string;
  /** Target slot ID */
  to: string;
  /** Connection type: door = wall with door, open = no wall, adjacent = shared wall only */
  type: ConnectionType;
  /** Whether this connection is mandatory */
  required: boolean;
}

export interface TypologyTemplate {
  /** Unique template identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** One-line description */
  description: string;

  /** When this template is applicable */
  applicability: {
    minBedrooms: number;
    maxBedrooms: number;
    minAreaSqm: number;
    maxAreaSqm: number;
    buildingTypes: string[];
    keywords: string[];
  };

  /** Room slots — each defines a position + dimensions in the template */
  slots: TemplateSlot[];

  /** How rooms connect (doors, open-plan transitions, adjacencies) */
  connections: TemplateConnection[];

  /** Main entrance definition */
  entrance: {
    side: EntranceSide;
    connectsTo: string;
  };

  /** Corridor topology */
  corridorType: CorridorType;
}

// ============================================================
// HELPER: compute ideal area from slot dimensions
// ============================================================

/** Sum of (idealWidth * idealDepth) for all slots in a template */
export function templateIdealArea(template: TypologyTemplate): number {
  return template.slots.reduce((sum, s) => sum + s.idealWidth * s.idealDepth, 0);
}

/** Count of slots in a template */
export function templateSlotCount(template: TypologyTemplate): number {
  return template.slots.length;
}

/** Get all slot IDs referenced by connections */
function connectionSlotIds(template: TypologyTemplate): Set<string> {
  const ids = new Set<string>();
  for (const c of template.connections) {
    ids.add(c.from);
    ids.add(c.to);
  }
  return ids;
}

/** Validate that all connection references point to existing slot IDs */
export function validateTemplate(template: TypologyTemplate): string[] {
  const errors: string[] = [];
  const slotIds = new Set(template.slots.map(s => s.id));

  // Check connections reference valid slots
  for (const conn of template.connections) {
    if (!slotIds.has(conn.from)) errors.push(`Connection from "${conn.from}" references unknown slot`);
    if (!slotIds.has(conn.to)) errors.push(`Connection to "${conn.to}" references unknown slot`);
  }

  // Check entrance connects to existing slot
  if (!slotIds.has(template.entrance.connectsTo)) {
    errors.push(`Entrance connectsTo "${template.entrance.connectsTo}" references unknown slot`);
  }

  // Check at least one bedroom and one bathroom
  const isCommercial = template.applicability.minBedrooms === 0
    && template.applicability.maxBedrooms === 0;

  const hasbedroom = template.slots.some(s =>
    ['master_bedroom', 'bedroom', 'guest_bedroom', 'children_bedroom'].includes(s.roomType),
  );
  const hasBathroom = template.slots.some(s =>
    ['bathroom', 'master_bathroom', 'toilet', 'powder_room', 'half_bath',
     'servant_toilet', 'commercial_toilet'].includes(s.roomType),
  );
  if (!isCommercial && !hasbedroom) errors.push('Template has no bedroom slot');
  if (!hasBathroom) errors.push('Template has no bathroom slot');

  // Check corridor slots are in circulation zone
  for (const slot of template.slots) {
    if (['corridor', 'hallway', 'passage'].includes(slot.roomType) && slot.zone !== 'circulation') {
      errors.push(`Corridor slot "${slot.id}" should be in circulation zone, got "${slot.zone}"`);
    }
  }

  // Check ideal dimensions don't violate aspect ratio
  for (const slot of template.slots) {
    const longer = Math.max(slot.idealWidth, slot.idealDepth);
    const shorter = Math.min(slot.idealWidth, slot.idealDepth);
    const ar = shorter > 0 ? longer / shorter : Infinity;
    if (ar > slot.maxAspectRatio + 0.01) {
      errors.push(`Slot "${slot.id}" ideal AR ${ar.toFixed(2)} exceeds max ${slot.maxAspectRatio}`);
    }
  }

  // Check ideal dimensions meet minimums
  for (const slot of template.slots) {
    if (slot.idealWidth < slot.minWidth - 0.01) {
      errors.push(`Slot "${slot.id}" idealWidth ${slot.idealWidth} < minWidth ${slot.minWidth}`);
    }
    if (slot.idealDepth < slot.minDepth - 0.01) {
      errors.push(`Slot "${slot.id}" idealDepth ${slot.idealDepth} < minDepth ${slot.minDepth}`);
    }
  }

  return errors;
}

// ============================================================
// TEMPLATES
// ============================================================

/**
 * Template 1: 1BHK Studio
 *
 * 30-45 sqm. Open-plan living+kitchen, separate bedroom, 1 bathroom.
 * No corridor — entry opens directly into living.
 *
 *   ┌─────────────┬──────────┐
 *   │  Bedroom    │ Bathroom │   row 0 (private)
 *   │  3.6×3.8    │ 1.8×2.5  │
 *   ├─────────────┴──────────┤
 *   │  Living + Kitchen      │   row 1 (public, open-plan)
 *   │  5.4×4.0               │
 *   ├────────────────────────┤
 *   │  Balcony 5.4×1.5       │   row 2 (outdoor, optional)
 *   └────────────────────────┘
 *         ENTRANCE (south)
 */
const TEMPLATE_1BHK_STUDIO: TypologyTemplate = {
  id: '1bhk-studio',
  name: '1BHK Studio Apartment',
  description: 'Compact open-plan studio with separate bedroom, ideal for singles/couples',
  applicability: {
    minBedrooms: 1, maxBedrooms: 1,
    minAreaSqm: 28, maxAreaSqm: 48,
    buildingTypes: ['apartment', 'flat', 'studio'],
    keywords: ['studio', 'open-plan', 'compact', '1rk', '1room'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'bedroom', label: 'Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.6, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'bathroom', label: 'Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living + Kitchen',
      required: true, zone: 'public', row: 1, column: 0,
      idealWidth: 5.4, idealDepth: 4.0, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 2, column: 0,
      idealWidth: 5.4, idealDepth: 1.8, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'width',
    },
  ],
  connections: [
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'bedroom1', to: 'living', type: 'door', required: true },
    { from: 'living', to: 'balcony', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'none',
};

/**
 * Template 2: 1BHK Standard
 *
 * 35-55 sqm. Separate living, bedroom, kitchen, bathroom. Short corridor.
 *
 *   ┌──────────┬──────────┐
 *   │ Bedroom  │ Bathroom │   row 0 (private)
 *   │ 3.6×4.0  │ 1.8×2.5  │
 *   ├──────────┴──────────┤
 *   │  Corridor 5.4×1.2   │   row 1 (circulation)
 *   ├──────────┬──────────┤
 *   │ Kitchen  │  Living  │   row 2 (public)
 *   │ 2.5×3.5  │ 3.8×3.5  │
 *   └──────────┴──────────┘
 *        ENTRANCE (south)
 */
const TEMPLATE_1BHK_STANDARD: TypologyTemplate = {
  id: '1bhk-standard',
  name: '1BHK Standard Apartment',
  description: 'Standard 1BHK with separate kitchen, bedroom, and living room',
  applicability: {
    minBedrooms: 1, maxBedrooms: 1,
    minAreaSqm: 33, maxAreaSqm: 58,
    buildingTypes: ['apartment', 'flat'],
    keywords: ['standard', '1bhk', 'separate-kitchen'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'bedroom', label: 'Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.6, idealDepth: 4.0, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'bathroom', label: 'Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 5.4, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 2, column: 0,
      idealWidth: 2.5, idealDepth: 3.5, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living Room',
      required: true, zone: 'public', row: 2, column: 1,
      idealWidth: 3.8, idealDepth: 3.6, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'kitchen', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'linear',
};

/**
 * Template 3: 2BHK Linear
 *
 * 55-75 sqm. Rooms arranged along one axis with central corridor.
 *
 *   ┌──────────┬────────┬──────────┬────────┐
 *   │ Bedroom1 │ Bath1  │ Bedroom2 │ Bath2  │   row 0 (private)
 *   │ 3.4×3.8  │1.8×2.5 │ 3.2×3.8  │1.8×2.5 │
 *   ├──────────┴────────┴──────────┴────────┤
 *   │            Corridor 1.2m              │   row 1 (circulation)
 *   ├──────────┬───────────────────┬────────┤
 *   │ Kitchen  │   Living-Dining   │Balcony │   row 2 (public)
 *   │ 2.5×3.5  │    5.4×3.5        │1.5×3.0 │
 *   └──────────┴───────────────────┴────────┘
 *              ENTRANCE (south)
 */
const TEMPLATE_2BHK_LINEAR: TypologyTemplate = {
  id: '2bhk-linear',
  name: '2BHK Linear Apartment',
  description: 'Standard 2BHK with bedrooms on one side, public rooms on the other',
  applicability: {
    minBedrooms: 2, maxBedrooms: 2,
    minAreaSqm: 52, maxAreaSqm: 78,
    buildingTypes: ['apartment', 'flat'],
    keywords: ['linear', '2bhk', 'standard', 'corridor'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'master_bedroom', label: 'Master Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.4, idealDepth: 3.8, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'bath1', roomType: 'master_bathroom', label: 'Attached Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.8, minDepth: 2.4,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom2', roomType: 'bedroom', label: 'Bedroom 2',
      required: true, zone: 'private', row: 0, column: 2,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'bath2', roomType: 'bathroom', label: 'Common Bathroom',
      required: true, zone: 'service', row: 0, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 10.2, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 2, column: 0,
      idealWidth: 2.5, idealDepth: 3.5, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living-Dining',
      required: true, zone: 'public', row: 2, column: 1,
      idealWidth: 5.4, idealDepth: 3.6, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 2, column: 2,
      idealWidth: 1.5, idealDepth: 3.0, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'depth',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom2', type: 'door', required: true },
    { from: 'corridor', to: 'bath2', type: 'door', required: true },
    { from: 'corridor', to: 'kitchen', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
    { from: 'living', to: 'balcony', type: 'door', required: false },
    { from: 'kitchen', to: 'living', type: 'adjacent', required: true },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'linear',
};

/**
 * Template 4: 2BHK L-Shape
 *
 * 60-85 sqm. Public wing perpendicular to private wing. Corridor at junction.
 *
 *   ┌──────────┬────────┐
 *   │ Bedroom1 │ Bath1  │                   row 0 (private wing)
 *   │ 3.4×4.0  │1.8×2.5 │
 *   ├──────────┼────────┼───────────────┐
 *   │ Bedroom2 │ Bath2  │   Living      │   row 1 (junction)
 *   │ 3.2×3.8  │1.8×2.5 │   4.5×4.0     │
 *   ├──────────┴────────┼───────────────┤
 *   │ Corridor 1.2m     │   Dining      │   row 2 (public wing)
 *   ├───────────────────┼───────────────┤
 *   │ Kitchen  │Utility │   Balcony     │   row 3 (service + outdoor)
 *   │ 2.5×3.2  │1.8×2.5 │   1.5×3.0     │
 *   └──────────┴────────┴───────────────┘
 *              ENTRANCE (south)
 */
const TEMPLATE_2BHK_L_SHAPE: TypologyTemplate = {
  id: '2bhk-l-shape',
  name: '2BHK L-Shape Apartment',
  description: 'L-shaped layout with private and public wings meeting at corridor',
  applicability: {
    minBedrooms: 2, maxBedrooms: 2,
    minAreaSqm: 58, maxAreaSqm: 88,
    buildingTypes: ['apartment', 'flat', 'house'],
    keywords: ['l-shape', 'l-shaped', 'corner', 'wing'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'master_bedroom', label: 'Master Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.4, idealDepth: 4.0, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'master_bathroom', label: 'Attached Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.8, minDepth: 2.4,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom2', roomType: 'bedroom', label: 'Bedroom 2',
      required: true, zone: 'private', row: 1, column: 0,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'bath2', roomType: 'bathroom', label: 'Common Bathroom',
      required: true, zone: 'service', row: 1, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living Room',
      required: true, zone: 'public', row: 1, column: 2,
      idealWidth: 4.5, idealDepth: 4.0, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 2, column: 0,
      idealWidth: 5.2, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'dining', roomType: 'dining_room', label: 'Dining Room',
      required: true, zone: 'public', row: 2, column: 1,
      idealWidth: 3.0, idealDepth: 3.2, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 3, column: 0,
      idealWidth: 2.5, idealDepth: 3.2, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'utility', roomType: 'utility', label: 'Utility',
      required: false, zone: 'service', row: 3, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 1.8,
      maxAspectRatio: 2.2, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 3, column: 2,
      idealWidth: 1.5, idealDepth: 3.0, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'depth',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom2', type: 'door', required: true },
    { from: 'corridor', to: 'bath2', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
    { from: 'living', to: 'dining', type: 'open', required: true },
    { from: 'dining', to: 'kitchen', type: 'door', required: true },
    { from: 'kitchen', to: 'utility', type: 'door', required: false },
    { from: 'living', to: 'balcony', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'L-shape',
};

/**
 * Template 5: 3BHK Linear
 *
 * 80-110 sqm. Extended 2BHK with 3 bed-bath pairs. Most common mid-range.
 *
 *   ┌──────────┬────────┬──────────┬────────┬──────────┬────────┐
 *   │ Master   │ MBath  │ Bedroom2 │ Bath2  │ Bedroom3 │ Bath3  │  row 0
 *   │ 3.6×4.0  │2.0×2.8 │ 3.2×3.8  │1.8×2.5 │ 3.0×3.8  │1.8×2.5 │
 *   ├──────────┴────────┴──────────┴────────┴──────────┴────────┤
 *   │                   Corridor 1.2m                           │  row 1
 *   ├──────────┬──────────┬────────────────────────┬────────────┤
 *   │ Kitchen  │ Dining   │      Living Room       │  Balcony   │  row 2
 *   │ 2.8×3.5  │ 3.0×3.5  │      5.0×3.5           │  1.5×3.0   │
 *   └──────────┴──────────┴────────────────────────┴────────────┘
 *                     ENTRANCE (south)
 */
const TEMPLATE_3BHK_LINEAR: TypologyTemplate = {
  id: '3bhk-linear',
  name: '3BHK Linear Apartment',
  description: 'Linear 3BHK with all bedrooms on one side, corridor-separated public zone',
  applicability: {
    minBedrooms: 3, maxBedrooms: 3,
    minAreaSqm: 75, maxAreaSqm: 115,
    buildingTypes: ['apartment', 'flat'],
    keywords: ['linear', '3bhk', 'standard', 'row'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'master_bedroom', label: 'Master Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.6, idealDepth: 4.0, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'bath1', roomType: 'master_bathroom', label: 'Master Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 2.0, idealDepth: 2.8, minWidth: 1.8, minDepth: 2.4,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom2', roomType: 'bedroom', label: 'Bedroom 2',
      required: true, zone: 'private', row: 0, column: 2,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'bath2', roomType: 'bathroom', label: 'Bathroom 2',
      required: true, zone: 'service', row: 0, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom3', roomType: 'bedroom', label: 'Bedroom 3',
      required: true, zone: 'private', row: 0, column: 4,
      idealWidth: 3.0, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'bath3', roomType: 'bathroom', label: 'Common Bathroom',
      required: true, zone: 'service', row: 0, column: 5,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 15.4, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 2, column: 0,
      idealWidth: 2.8, idealDepth: 3.5, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'dining', roomType: 'dining_room', label: 'Dining Room',
      required: true, zone: 'public', row: 2, column: 1,
      idealWidth: 3.0, idealDepth: 3.5, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living Room',
      required: true, zone: 'public', row: 2, column: 2,
      idealWidth: 5.0, idealDepth: 3.6, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 2, column: 3,
      idealWidth: 1.5, idealDepth: 3.0, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'depth',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom2', type: 'door', required: true },
    { from: 'bedroom2', to: 'bath2', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom3', type: 'door', required: true },
    { from: 'corridor', to: 'bath3', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
    { from: 'living', to: 'dining', type: 'open', required: true },
    { from: 'dining', to: 'kitchen', type: 'door', required: true },
    { from: 'living', to: 'balcony', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'linear',
};

/**
 * Template 6: 3BHK Double-Loaded
 *
 * 85-120 sqm. Rooms on BOTH sides of central corridor. Most common Indian layout.
 *
 *   ┌──────────┬────────┬──────────┬────────┐
 *   │ Master   │ MBath  │ Bedroom2 │ Bath2  │   row 0 (private north)
 *   │ 3.6×4.2  │2.0×2.8 │ 3.2×4.0  │1.8×2.5 │
 *   ├──────────┴────────┴──────────┴────────┤
 *   │            Corridor 1.2m              │   row 1 (circulation)
 *   ├──────────┬──────────┬─────────────────┤
 *   │ Kitchen  │ Dining   │   Living Room   │   row 2 (public south)
 *   │ 2.5×3.5  │ 3.2×3.5  │   4.8×3.5       │
 *   ├──────────┤          ├─────────────────┤
 *   │ Utility  │ Bedroom3 │ Balcony  │Bath3 │   row 3 (mixed)
 *   │ 1.8×2.5  │ 3.2×3.5  │ 1.5×3.0  │1.8×2.5│
 *   └──────────┴──────────┴──────────┴──────┘
 *              ENTRANCE (south)
 */
const TEMPLATE_3BHK_DOUBLE_LOADED: TypologyTemplate = {
  id: '3bhk-double-loaded',
  name: '3BHK Double-Loaded Corridor',
  description: 'Classic Indian 3BHK with rooms on both sides of a central corridor',
  applicability: {
    minBedrooms: 3, maxBedrooms: 3,
    minAreaSqm: 82, maxAreaSqm: 125,
    buildingTypes: ['apartment', 'flat'],
    keywords: ['double-loaded', 'central-corridor', '3bhk', 'classic'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'master_bedroom', label: 'Master Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.6, idealDepth: 4.2, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'master_bathroom', label: 'Master Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 2.0, idealDepth: 2.8, minWidth: 1.8, minDepth: 2.4,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom2', roomType: 'bedroom', label: 'Bedroom 2',
      required: true, zone: 'private', row: 0, column: 2,
      idealWidth: 3.2, idealDepth: 4.0, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath2', roomType: 'bathroom', label: 'Bathroom 2',
      required: true, zone: 'service', row: 0, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 10.6, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 2, column: 0,
      idealWidth: 2.5, idealDepth: 3.5, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'dining', roomType: 'dining_room', label: 'Dining Room',
      required: true, zone: 'public', row: 2, column: 1,
      idealWidth: 3.2, idealDepth: 3.5, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living Room',
      required: true, zone: 'public', row: 2, column: 2,
      idealWidth: 4.8, idealDepth: 3.6, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'utility', roomType: 'utility', label: 'Utility',
      required: false, zone: 'service', row: 3, column: 0,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 1.8,
      maxAspectRatio: 2.2, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom3', roomType: 'bedroom', label: 'Bedroom 3',
      required: true, zone: 'private', row: 3, column: 1,
      idealWidth: 3.2, idealDepth: 3.5, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 3, column: 2,
      idealWidth: 1.5, idealDepth: 3.0, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'depth',
    },
    {
      id: 'bath3', roomType: 'bathroom', label: 'Common Bathroom',
      required: true, zone: 'service', row: 3, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom2', type: 'door', required: true },
    { from: 'bedroom2', to: 'bath2', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom3', type: 'door', required: true },
    { from: 'bedroom3', to: 'bath3', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
    { from: 'living', to: 'dining', type: 'open', required: true },
    { from: 'dining', to: 'kitchen', type: 'door', required: true },
    { from: 'kitchen', to: 'utility', type: 'door', required: false },
    { from: 'living', to: 'balcony', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'linear',
};

/**
 * Template 7: 3BHK L-Shape
 *
 * 90-130 sqm. Bedrooms in one wing, public rooms in the other. Balcony at junction.
 *
 *   ┌──────────┬────────┐
 *   │ Master   │ MBath  │                          row 0 (private wing)
 *   │ 3.8×4.2  │2.0×2.8 │
 *   ├──────────┼────────┤
 *   │ Bedroom2 │ Bath2  │                          row 1
 *   │ 3.4×3.8  │1.8×2.5 │
 *   ├──────────┼────────┼──────────┬───────────┐
 *   │ Bedroom3 │ Bath3  │ Living   │ Balcony   │   row 2 (junction)
 *   │ 3.2×3.8  │1.8×2.5 │ 5.0×4.2  │ 1.5×3.0   │
 *   ├──────────┴────────┼──────────┤           │
 *   │ Corridor 1.2m     │ Dining   │           │   row 3
 *   ├──────────┬────────┼──────────┴───────────┤
 *   │ Kitchen  │Utility │ Pooja                │   row 4 (service)
 *   │ 2.8×3.5  │1.8×2.5 │ 1.8×2.0              │
 *   └──────────┴────────┴──────────────────────┘
 *              ENTRANCE (south)
 */
const TEMPLATE_3BHK_L_SHAPE: TypologyTemplate = {
  id: '3bhk-l-shape',
  name: '3BHK L-Shape Apartment',
  description: 'L-shaped 3BHK with bedroom wing and public wing, ideal for corner plots',
  applicability: {
    minBedrooms: 3, maxBedrooms: 3,
    minAreaSqm: 88, maxAreaSqm: 135,
    buildingTypes: ['apartment', 'flat', 'house'],
    keywords: ['l-shape', 'corner', 'wing', 'premium', 'spacious'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'master_bedroom', label: 'Master Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.8, idealDepth: 4.2, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'master_bathroom', label: 'Master Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 2.0, idealDepth: 2.8, minWidth: 1.8, minDepth: 2.4,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom2', roomType: 'bedroom', label: 'Bedroom 2',
      required: true, zone: 'private', row: 1, column: 0,
      idealWidth: 3.4, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'bath2', roomType: 'bathroom', label: 'Bathroom 2',
      required: true, zone: 'service', row: 1, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom3', roomType: 'bedroom', label: 'Bedroom 3',
      required: true, zone: 'private', row: 2, column: 0,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'bath3', roomType: 'bathroom', label: 'Common Bathroom',
      required: true, zone: 'service', row: 2, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living Room',
      required: true, zone: 'public', row: 2, column: 2,
      idealWidth: 5.0, idealDepth: 4.2, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 2, column: 3,
      idealWidth: 1.5, idealDepth: 3.0, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'depth',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 3, column: 0,
      idealWidth: 5.2, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'dining', roomType: 'dining_room', label: 'Dining Room',
      required: true, zone: 'public', row: 3, column: 1,
      idealWidth: 3.2, idealDepth: 3.5, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 4, column: 0,
      idealWidth: 2.8, idealDepth: 3.5, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'utility', roomType: 'utility', label: 'Utility',
      required: false, zone: 'service', row: 4, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 1.8,
      maxAspectRatio: 2.2, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'pooja', roomType: 'pooja_room', label: 'Pooja Room',
      required: false, zone: 'private', row: 4, column: 2,
      idealWidth: 1.8, idealDepth: 2.1, minWidth: 1.8, minDepth: 2.1,
      maxAspectRatio: 1.5, scalable: false, scaleAxis: 'width',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom2', type: 'door', required: true },
    { from: 'bedroom2', to: 'bath2', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom3', type: 'door', required: true },
    { from: 'bedroom3', to: 'bath3', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
    { from: 'living', to: 'dining', type: 'open', required: true },
    { from: 'dining', to: 'kitchen', type: 'door', required: true },
    { from: 'kitchen', to: 'utility', type: 'door', required: false },
    { from: 'living', to: 'balcony', type: 'door', required: false },
    { from: 'corridor', to: 'pooja', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'L-shape',
};

/**
 * Template 8: 4BHK Apartment
 *
 * 120-180 sqm. 4 bedrooms with extended corridor, larger living-dining.
 *
 *   ┌──────────┬────────┬──────────┬────────┐
 *   │ Master   │ MBath  │ Bedroom2 │ Bath2  │   row 0 (private north)
 *   │ 3.8×4.5  │2.0×2.8 │ 3.4×4.2  │1.8×2.5 │
 *   ├──────────┴────────┴──────────┴────────┤
 *   │            Corridor 1.2m              │   row 1 (circulation)
 *   ├──────────┬──────────┬─────────────────┤
 *   │ Kitchen  │ Dining   │   Living Room   │   row 2 (public)
 *   │ 3.0×3.8  │ 3.5×3.8  │   5.5×3.8       │
 *   ├──────────┼──────────┼──────────┬──────┤
 *   │ Utility  │ Bedroom3 │ Bedroom4 │Bath34│   row 3 (private south)
 *   │ 1.8×2.5  │ 3.2×3.8  │ 3.2×3.8  │1.8×2.5│
 *   ├──────────┤          │          ├──────┤
 *   │ Pooja    │          │ Balcony  │Bath4 │   row 4 (optional)
 *   │ 1.8×2.1  │          │ 1.5×3.0  │1.8×2.5│
 *   └──────────┴──────────┴──────────┴──────┘
 *              ENTRANCE (south)
 */
const TEMPLATE_4BHK_APARTMENT: TypologyTemplate = {
  id: '4bhk-apartment',
  name: '4BHK Apartment',
  description: 'Spacious 4BHK with master suite, double-loaded corridor, service entrance',
  applicability: {
    minBedrooms: 4, maxBedrooms: 4,
    minAreaSqm: 115, maxAreaSqm: 185,
    buildingTypes: ['apartment', 'flat'],
    keywords: ['4bhk', 'apartment', 'large', 'premium'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'master_bedroom', label: 'Master Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.8, idealDepth: 4.5, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'master_bathroom', label: 'Master Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 2.0, idealDepth: 2.8, minWidth: 1.8, minDepth: 2.4,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom2', roomType: 'bedroom', label: 'Bedroom 2',
      required: true, zone: 'private', row: 0, column: 2,
      idealWidth: 3.4, idealDepth: 4.2, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath2', roomType: 'bathroom', label: 'Bathroom 2',
      required: true, zone: 'service', row: 0, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 11.0, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 2, column: 0,
      idealWidth: 3.0, idealDepth: 3.8, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'dining', roomType: 'dining_room', label: 'Dining Room',
      required: true, zone: 'public', row: 2, column: 1,
      idealWidth: 3.5, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living Room',
      required: true, zone: 'public', row: 2, column: 2,
      idealWidth: 5.5, idealDepth: 3.8, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'utility', roomType: 'utility', label: 'Utility',
      required: false, zone: 'service', row: 3, column: 0,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 1.8,
      maxAspectRatio: 2.2, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom3', roomType: 'bedroom', label: 'Bedroom 3',
      required: true, zone: 'private', row: 3, column: 1,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bedroom4', roomType: 'bedroom', label: 'Bedroom 4',
      required: true, zone: 'private', row: 3, column: 2,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath3', roomType: 'bathroom', label: 'Bathroom 3',
      required: true, zone: 'service', row: 3, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'pooja', roomType: 'pooja_room', label: 'Pooja Room',
      required: false, zone: 'private', row: 4, column: 0,
      idealWidth: 1.8, idealDepth: 2.1, minWidth: 1.8, minDepth: 2.1,
      maxAspectRatio: 1.5, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 4, column: 1,
      idealWidth: 1.5, idealDepth: 3.0, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'depth',
    },
    {
      id: 'bath4', roomType: 'bathroom', label: 'Common Bathroom',
      required: true, zone: 'service', row: 4, column: 2,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom2', type: 'door', required: true },
    { from: 'bedroom2', to: 'bath2', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom3', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom4', type: 'door', required: true },
    { from: 'bedroom3', to: 'bath3', type: 'door', required: true },
    { from: 'bedroom4', to: 'bath4', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
    { from: 'living', to: 'dining', type: 'open', required: true },
    { from: 'dining', to: 'kitchen', type: 'door', required: true },
    { from: 'kitchen', to: 'utility', type: 'door', required: false },
    { from: 'living', to: 'balcony', type: 'door', required: false },
    { from: 'corridor', to: 'pooja', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'linear',
};

/**
 * Template 9: 4BHK Duplex — Ground Floor
 *
 * 80-120 sqm per floor. Ground floor: living, dining, kitchen, 1 bedroom, staircase.
 *
 *   ┌──────────┬──────────┬────────────────┐
 *   │ Bedroom1 │ Bath1    │   Staircase    │   row 0
 *   │ 3.4×4.0  │ 1.8×2.5  │   3.0×3.0      │
 *   ├──────────┴──────────┴────────────────┤
 *   │            Corridor 1.2m             │   row 1
 *   ├──────────┬──────────┬────────────────┤
 *   │ Kitchen  │ Dining   │   Living Room  │   row 2
 *   │ 2.8×3.5  │ 3.2×3.5  │   5.0×3.5      │
 *   ├──────────┼──────────┼────────────────┤
 *   │ Utility  │ Parking  │   Balcony      │   row 3
 *   │ 1.8×2.5  │ 3.0×5.5  │   1.5×3.0      │
 *   └──────────┴──────────┴────────────────┘
 *              ENTRANCE (south)
 */
const TEMPLATE_4BHK_DUPLEX_GROUND: TypologyTemplate = {
  id: '4bhk-duplex-ground',
  name: '4BHK Duplex — Ground Floor',
  description: 'Ground floor of duplex: public rooms, 1 guest bedroom, staircase, parking',
  applicability: {
    minBedrooms: 1, maxBedrooms: 2,
    minAreaSqm: 75, maxAreaSqm: 125,
    buildingTypes: ['duplex', 'villa', 'house', 'row-house'],
    keywords: ['duplex', 'ground', 'staircase', 'parking', 'villa'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'bedroom', label: 'Guest Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.4, idealDepth: 4.0, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'bathroom', label: 'Guest Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'staircase', roomType: 'staircase', label: 'Staircase',
      required: true, zone: 'circulation', row: 0, column: 2,
      idealWidth: 3.0, idealDepth: 3.0, minWidth: 0.9, minDepth: 2.4,
      maxAspectRatio: 3.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 8.2, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 2, column: 0,
      idealWidth: 2.8, idealDepth: 3.5, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'dining', roomType: 'dining_room', label: 'Dining Room',
      required: true, zone: 'public', row: 2, column: 1,
      idealWidth: 3.2, idealDepth: 3.5, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'width',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living Room',
      required: true, zone: 'public', row: 2, column: 2,
      idealWidth: 5.0, idealDepth: 3.6, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'utility', roomType: 'utility', label: 'Utility',
      required: false, zone: 'service', row: 3, column: 0,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 1.8,
      maxAspectRatio: 2.2, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'parking', roomType: 'parking', label: 'Parking',
      required: false, zone: 'service', row: 3, column: 1,
      idealWidth: 3.0, idealDepth: 5.5, minWidth: 2.7, minDepth: 5.5,
      maxAspectRatio: 2.5, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 3, column: 2,
      idealWidth: 1.5, idealDepth: 3.0, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'depth',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'staircase', type: 'door', required: true },
    { from: 'corridor', to: 'kitchen', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
    { from: 'living', to: 'dining', type: 'open', required: true },
    { from: 'dining', to: 'kitchen', type: 'adjacent', required: true },
    { from: 'kitchen', to: 'utility', type: 'door', required: false },
    { from: 'living', to: 'balcony', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'linear',
};

/**
 * Template 10: 4BHK Duplex — Upper Floor
 *
 * 80-120 sqm per floor. Upper floor: 3 bedrooms, study, staircase.
 *
 *   ┌──────────┬────────┬──────────┬────────┐
 *   │ Master   │ MBath  │ Bedroom2 │ Bath2  │   row 0 (private)
 *   │ 3.8×4.2  │2.0×2.8 │ 3.4×4.0  │1.8×2.5 │
 *   ├──────────┴────────┴──────────┴────────┤
 *   │            Corridor 1.2m              │   row 1 (circulation)
 *   ├──────────┬────────┬──────────┬────────┤
 *   │ Bedroom3 │ Bath3  │ Study    │Stairc. │   row 2
 *   │ 3.2×3.8  │1.8×2.5 │ 2.7×3.0  │3.0×3.0 │
 *   ├──────────┴────────┴──────────┼────────┤
 *   │        Balcony               │ Terrace│   row 3 (outdoor)
 *   │        3.0×1.5               │2.0×2.0 │
 *   └─────────────────────────────┴────────┘
 */
const TEMPLATE_4BHK_DUPLEX_UPPER: TypologyTemplate = {
  id: '4bhk-duplex-upper',
  name: '4BHK Duplex — Upper Floor',
  description: 'Upper floor of duplex: master suite, 2 bedrooms, study, staircase landing',
  applicability: {
    minBedrooms: 3, maxBedrooms: 3,
    minAreaSqm: 72, maxAreaSqm: 125,
    buildingTypes: ['duplex', 'villa', 'house', 'row-house'],
    keywords: ['duplex', 'upper', 'first-floor', 'staircase'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'master_bedroom', label: 'Master Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.8, idealDepth: 4.2, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'master_bathroom', label: 'Master Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 2.0, idealDepth: 2.8, minWidth: 1.8, minDepth: 2.4,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom2', roomType: 'bedroom', label: 'Bedroom 2',
      required: true, zone: 'private', row: 0, column: 2,
      idealWidth: 3.4, idealDepth: 4.0, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath2', roomType: 'bathroom', label: 'Bathroom 2',
      required: true, zone: 'service', row: 0, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 11.0, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom3', roomType: 'bedroom', label: 'Bedroom 3',
      required: true, zone: 'private', row: 2, column: 0,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath3', roomType: 'bathroom', label: 'Bathroom 3',
      required: true, zone: 'service', row: 2, column: 1,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'study', roomType: 'study', label: 'Study',
      required: false, zone: 'private', row: 2, column: 2,
      idealWidth: 2.7, idealDepth: 3.0, minWidth: 2.4, minDepth: 2.7,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'staircase', roomType: 'staircase', label: 'Staircase',
      required: true, zone: 'circulation', row: 2, column: 3,
      idealWidth: 3.0, idealDepth: 3.0, minWidth: 0.9, minDepth: 2.4,
      maxAspectRatio: 3.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 3, column: 0,
      idealWidth: 3.0, idealDepth: 1.8, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'terrace', roomType: 'terrace', label: 'Terrace',
      required: false, zone: 'public', row: 3, column: 1,
      idealWidth: 2.0, idealDepth: 2.0, minWidth: 1.5, minDepth: 2.0,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'both',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom2', type: 'door', required: true },
    { from: 'bedroom2', to: 'bath2', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom3', type: 'door', required: true },
    { from: 'bedroom3', to: 'bath3', type: 'door', required: true },
    { from: 'corridor', to: 'staircase', type: 'door', required: true },
    { from: 'corridor', to: 'study', type: 'door', required: false },
    { from: 'bedroom1', to: 'balcony', type: 'door', required: false },
    { from: 'corridor', to: 'terrace', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'corridor' },
  corridorType: 'linear',
};

/**
 * Template 11: 5BHK Villa
 *
 * 200-350 sqm. Large villa with servant quarter, double-loaded corridor, bedroom wing.
 *
 *   ┌──────────┬────────┬──────────┬────────┬──────────┬────────┐
 *   │ Master   │ MBath  │ Bedroom2 │ Bath2  │ Bedroom3 │ Bath3  │  row 0
 *   │ 4.0×4.5  │2.2×3.0 │ 3.6×4.2  │1.8×2.5 │ 3.6×4.2  │1.8×2.5 │
 *   ├──────────┴────────┴──────────┴────────┴──────────┴────────┤
 *   │                   Corridor 1.2m                           │  row 1
 *   ├──────────┬──────────┬──────────────────────┬──────────────┤
 *   │ Kitchen  │ Dining   │   Living Room        │  Drawing Rm  │  row 2
 *   │ 3.0×3.8  │ 3.5×3.8  │   5.5×4.0            │  3.8×4.0     │
 *   ├──────────┼──────────┼──────────┬────────┬──┴──────────────┤
 *   │ Servant  │Serv.Bath │ Bedroom4 │ Bath4  │  Bedroom5│Bath5 │  row 3
 *   │ 2.8×3.0  │1.2×1.5   │ 3.2×3.8  │1.8×2.5 │  3.2×3.8 │1.8×2.5│
 *   ├──────────┴──────────┼──────────┴────────┼──────────┴──────┤
 *   │ Utility  │ Pooja    │   Balcony         │  Staircase      │  row 4
 *   │ 1.8×2.5  │ 1.8×2.1  │   3.0×1.5         │  3.0×3.0        │
 *   └──────────┴──────────┴───────────────────┴─────────────────┘
 *                        ENTRANCE (south)
 */
const TEMPLATE_5BHK_VILLA: TypologyTemplate = {
  id: '5bhk-villa',
  name: '5BHK Villa',
  description: 'Large villa with 5 bedrooms, servant quarter, drawing room, and service wing',
  applicability: {
    minBedrooms: 5, maxBedrooms: 6,
    minAreaSqm: 195, maxAreaSqm: 360,
    buildingTypes: ['villa', 'house', 'bungalow', 'independent-house'],
    keywords: ['villa', '5bhk', 'bungalow', 'large', 'servant', 'luxury'],
  },
  slots: [
    {
      id: 'bedroom1', roomType: 'master_bedroom', label: 'Master Bedroom',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 4.0, idealDepth: 4.5, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath1', roomType: 'master_bathroom', label: 'Master Bathroom',
      required: true, zone: 'service', row: 0, column: 1,
      idealWidth: 2.2, idealDepth: 3.0, minWidth: 1.8, minDepth: 2.4,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'both',
    },
    {
      id: 'bedroom2', roomType: 'bedroom', label: 'Bedroom 2',
      required: true, zone: 'private', row: 0, column: 2,
      idealWidth: 3.6, idealDepth: 4.2, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath2', roomType: 'bathroom', label: 'Bathroom 2',
      required: true, zone: 'service', row: 0, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom3', roomType: 'bedroom', label: 'Bedroom 3',
      required: true, zone: 'private', row: 0, column: 4,
      idealWidth: 3.6, idealDepth: 4.2, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath3', roomType: 'bathroom', label: 'Bathroom 3',
      required: true, zone: 'service', row: 0, column: 5,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 17.0, idealDepth: 1.2, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'kitchen', roomType: 'kitchen', label: 'Kitchen',
      required: true, zone: 'service', row: 2, column: 0,
      idealWidth: 3.0, idealDepth: 3.8, minWidth: 2.2, minDepth: 2.8,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'dining', roomType: 'dining_room', label: 'Dining Room',
      required: true, zone: 'public', row: 2, column: 1,
      idealWidth: 3.5, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'living', roomType: 'living_room', label: 'Living Room',
      required: true, zone: 'public', row: 2, column: 2,
      idealWidth: 5.5, idealDepth: 4.0, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'drawing', roomType: 'drawing_room', label: 'Drawing Room',
      required: true, zone: 'public', row: 2, column: 3,
      idealWidth: 3.8, idealDepth: 4.0, minWidth: 3.2, minDepth: 3.6,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'servant', roomType: 'servant_quarter', label: 'Servant Quarter',
      required: false, zone: 'service', row: 3, column: 0,
      idealWidth: 2.8, idealDepth: 3.0, minWidth: 2.4, minDepth: 2.7,
      maxAspectRatio: 1.8, scalable: false, scaleAxis: 'both',
    },
    {
      id: 'servant_bath', roomType: 'servant_toilet', label: 'Servant Toilet',
      required: false, zone: 'service', row: 3, column: 1,
      idealWidth: 1.2, idealDepth: 1.5, minWidth: 1.0, minDepth: 1.2,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom4', roomType: 'bedroom', label: 'Bedroom 4',
      required: true, zone: 'private', row: 3, column: 2,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath4', roomType: 'bathroom', label: 'Bathroom 4',
      required: true, zone: 'service', row: 3, column: 3,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'bedroom5', roomType: 'bedroom', label: 'Bedroom 5',
      required: true, zone: 'private', row: 3, column: 4,
      idealWidth: 3.2, idealDepth: 3.8, minWidth: 2.8, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'bath5', roomType: 'bathroom', label: 'Bathroom 5',
      required: true, zone: 'service', row: 3, column: 5,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'utility', roomType: 'utility', label: 'Utility',
      required: false, zone: 'service', row: 4, column: 0,
      idealWidth: 1.8, idealDepth: 2.5, minWidth: 1.5, minDepth: 1.8,
      maxAspectRatio: 2.2, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'pooja', roomType: 'pooja_room', label: 'Pooja Room',
      required: false, zone: 'private', row: 4, column: 1,
      idealWidth: 1.8, idealDepth: 2.1, minWidth: 1.8, minDepth: 2.1,
      maxAspectRatio: 1.5, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'balcony', roomType: 'balcony', label: 'Balcony',
      required: false, zone: 'public', row: 4, column: 2,
      idealWidth: 3.0, idealDepth: 1.8, minWidth: 1.2, minDepth: 1.8,
      maxAspectRatio: 4.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'staircase', roomType: 'staircase', label: 'Staircase',
      required: false, zone: 'circulation', row: 4, column: 3,
      idealWidth: 3.0, idealDepth: 3.0, minWidth: 0.9, minDepth: 2.4,
      maxAspectRatio: 3.0, scalable: false, scaleAxis: 'width',
    },
  ],
  connections: [
    { from: 'corridor', to: 'bedroom1', type: 'door', required: true },
    { from: 'bedroom1', to: 'bath1', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom2', type: 'door', required: true },
    { from: 'bedroom2', to: 'bath2', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom3', type: 'door', required: true },
    { from: 'bedroom3', to: 'bath3', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom4', type: 'door', required: true },
    { from: 'bedroom4', to: 'bath4', type: 'door', required: true },
    { from: 'corridor', to: 'bedroom5', type: 'door', required: true },
    { from: 'bedroom5', to: 'bath5', type: 'door', required: true },
    { from: 'corridor', to: 'living', type: 'open', required: true },
    { from: 'living', to: 'dining', type: 'open', required: true },
    { from: 'living', to: 'drawing', type: 'open', required: true },
    { from: 'dining', to: 'kitchen', type: 'door', required: true },
    { from: 'kitchen', to: 'utility', type: 'door', required: false },
    { from: 'servant', to: 'servant_bath', type: 'door', required: false },
    { from: 'corridor', to: 'servant', type: 'door', required: false },
    { from: 'corridor', to: 'pooja', type: 'door', required: false },
    { from: 'living', to: 'balcony', type: 'door', required: false },
    { from: 'corridor', to: 'staircase', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'living' },
  corridorType: 'linear',
};

/**
 * Template 12: Office Open Plan
 *
 * 50-300 sqm. Commercial office with reception, open workspace, cabins.
 *
 *   ┌──────────┬──────────┬──────────────────┐
 *   │ Cabin 1  │ Cabin 2  │  Conference Room │   row 0 (private offices)
 *   │ 3.0×3.5  │ 3.0×3.5  │  4.0×5.0         │
 *   ├──────────┴──────────┴──────────────────┤
 *   │            Corridor 1.5m               │   row 1 (circulation)
 *   ├─────────────────────────┬──────────────┤
 *   │    Open Workspace       │  Break Room  │   row 2 (workspace)
 *   │    8.0×5.0              │  3.0×3.0      │
 *   ├──────────┬──────────────┼──────────────┤
 *   │Reception │  Waiting     │  Toilet      │   row 3 (public entry)
 *   │ 3.0×3.5  │  3.0×3.0     │  2.0×2.5     │
 *   ├──────────┤              ├──────────────┤
 *   │ Pantry   │              │  Server Room │   row 4 (service)
 *   │ 2.0×2.5  │              │  2.5×2.5      │
 *   └──────────┴──────────────┴──────────────┘
 *              ENTRANCE (south)
 */
const TEMPLATE_OFFICE_OPEN_PLAN: TypologyTemplate = {
  id: 'office-open-plan',
  name: 'Office Open Plan',
  description: 'Commercial office with reception, open workspace, private cabins, conference room',
  applicability: {
    minBedrooms: 0, maxBedrooms: 0,
    minAreaSqm: 48, maxAreaSqm: 310,
    buildingTypes: ['office', 'commercial', 'coworking'],
    keywords: ['office', 'commercial', 'cabin', 'workspace', 'conference', 'coworking'],
  },
  slots: [
    {
      id: 'cabin1', roomType: 'cabin', label: 'Cabin 1',
      required: true, zone: 'private', row: 0, column: 0,
      idealWidth: 3.0, idealDepth: 3.5, minWidth: 2.4, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'cabin2', roomType: 'cabin', label: 'Cabin 2',
      required: true, zone: 'private', row: 0, column: 1,
      idealWidth: 3.0, idealDepth: 3.5, minWidth: 2.4, minDepth: 3.0,
      maxAspectRatio: 1.8, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'conference', roomType: 'conference_room', label: 'Conference Room',
      required: true, zone: 'public', row: 0, column: 2,
      idealWidth: 4.0, idealDepth: 5.0, minWidth: 3.0, minDepth: 4.0,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'corridor', roomType: 'corridor', label: 'Corridor',
      required: true, zone: 'circulation', row: 1, column: 0,
      idealWidth: 10.0, idealDepth: 1.5, minWidth: 1.05, minDepth: 1.2,
      maxAspectRatio: 15.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'workspace', roomType: 'open_workspace', label: 'Open Workspace',
      required: true, zone: 'public', row: 2, column: 0,
      idealWidth: 8.0, idealDepth: 5.0, minWidth: 3.6, minDepth: 4.0,
      maxAspectRatio: 3.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'breakroom', roomType: 'break_room', label: 'Break Room',
      required: false, zone: 'service', row: 2, column: 1,
      idealWidth: 3.0, idealDepth: 3.0, minWidth: 2.4, minDepth: 2.4,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'reception', roomType: 'reception', label: 'Reception',
      required: true, zone: 'public', row: 3, column: 0,
      idealWidth: 3.0, idealDepth: 3.5, minWidth: 2.7, minDepth: 3.0,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'waiting', roomType: 'waiting_area', label: 'Waiting Area',
      required: false, zone: 'public', row: 3, column: 1,
      idealWidth: 3.0, idealDepth: 3.0, minWidth: 2.4, minDepth: 2.4,
      maxAspectRatio: 2.0, scalable: true, scaleAxis: 'both',
    },
    {
      id: 'toilet', roomType: 'commercial_toilet', label: 'Toilet',
      required: true, zone: 'service', row: 3, column: 2,
      idealWidth: 2.0, idealDepth: 2.5, minWidth: 1.5, minDepth: 2.1,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'pantry', roomType: 'pantry', label: 'Pantry',
      required: false, zone: 'service', row: 4, column: 0,
      idealWidth: 2.0, idealDepth: 2.5, minWidth: 1.8, minDepth: 2.0,
      maxAspectRatio: 2.5, scalable: false, scaleAxis: 'width',
    },
    {
      id: 'server', roomType: 'server_room', label: 'Server Room',
      required: false, zone: 'service', row: 4, column: 1,
      idealWidth: 2.5, idealDepth: 2.5, minWidth: 2.0, minDepth: 2.0,
      maxAspectRatio: 2.0, scalable: false, scaleAxis: 'both',
    },
  ],
  connections: [
    { from: 'corridor', to: 'cabin1', type: 'door', required: true },
    { from: 'corridor', to: 'cabin2', type: 'door', required: true },
    { from: 'corridor', to: 'conference', type: 'door', required: true },
    { from: 'corridor', to: 'workspace', type: 'open', required: true },
    { from: 'corridor', to: 'breakroom', type: 'door', required: false },
    { from: 'corridor', to: 'reception', type: 'open', required: true },
    { from: 'reception', to: 'waiting', type: 'open', required: false },
    { from: 'corridor', to: 'toilet', type: 'door', required: true },
    { from: 'corridor', to: 'pantry', type: 'door', required: false },
    { from: 'corridor', to: 'server', type: 'door', required: false },
  ],
  entrance: { side: 'south', connectsTo: 'reception' },
  corridorType: 'linear',
};

// ============================================================
// TEMPLATE REGISTRY
// ============================================================

/** All available typology templates, ordered by bedroom count then area */
export const TYPOLOGY_TEMPLATES: TypologyTemplate[] = [
  TEMPLATE_1BHK_STUDIO,
  TEMPLATE_1BHK_STANDARD,
  TEMPLATE_2BHK_LINEAR,
  TEMPLATE_2BHK_L_SHAPE,
  TEMPLATE_3BHK_LINEAR,
  TEMPLATE_3BHK_DOUBLE_LOADED,
  TEMPLATE_3BHK_L_SHAPE,
  TEMPLATE_4BHK_APARTMENT,
  TEMPLATE_4BHK_DUPLEX_GROUND,
  TEMPLATE_4BHK_DUPLEX_UPPER,
  TEMPLATE_5BHK_VILLA,
  TEMPLATE_OFFICE_OPEN_PLAN,
];

/** Lookup template by ID — O(1) */
const TEMPLATE_MAP = new Map<string, TypologyTemplate>();
for (const t of TYPOLOGY_TEMPLATES) {
  TEMPLATE_MAP.set(t.id, t);
}

export function getTemplateById(id: string): TypologyTemplate | undefined {
  return TEMPLATE_MAP.get(id);
}

/** Get all templates matching a bedroom count */
export function getTemplatesByBedrooms(count: number): TypologyTemplate[] {
  return TYPOLOGY_TEMPLATES.filter(
    t => count >= t.applicability.minBedrooms && count <= t.applicability.maxBedrooms,
  );
}
