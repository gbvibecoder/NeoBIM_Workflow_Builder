/**
 * Furniture Catalog — Phase 3: Massive real-home furniture catalog
 *
 * Defines ALL furniture items by room type following real architectural rules:
 *   - Kitchen: work triangle (sink-stove-fridge), counter along wall, upper cabinets
 *   - Bedroom: bed against longest wall, nightstands flanking, wardrobe near door
 *   - Bathroom: toilet against side wall, vanity with mirror, shower in far corner
 *   - Living: sofa facing TV wall, coffee table centered, plants in corners
 *   - Dining: table centered, chairs around, sideboard against wall
 *   - Office: desk facing wall or window, chair behind, bookshelf on side wall
 *   - Hallway: console table, coat hooks, shoe cabinet, runner rug
 *   - Entrance: shoe cabinet, umbrella stand, coat rack, welcome mat
 *   - Veranda/Balcony: outdoor seating, railing planters, hanging lamp
 *   - Utility/Storage: washing machine, shelving, iron board
 *
 * Models generated via 3D AI Studio (Hunyuan 3D) → R2 CDN.
 * R2 storage is unlimited — only quality matters.
 */

export type FurnitureStyle = "modern" | "scandinavian" | "industrial" | "luxury" | "minimal";
export type RoomType =
  | "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "office"
  | "hallway" | "veranda" | "balcony" | "entrance" | "passage" | "utility"
  | "storage" | "closet" | "patio" | "staircase" | "studio" | "other";

export interface FurnitureItem {
  /** GLB filename on R2 CDN (e.g., "modern-sofa.glb") */
  file: string;
  /** Position as fraction of room (0-1) */
  rx: number;
  rz: number;
  /** Size as fraction of room dimensions */
  wF: number;
  dF: number;
  /** Y-rotation in radians */
  rot: number;
  /** Target height in meters for auto-scaling */
  targetH: number;
  /** Priority: higher = placed first, lower = skipped if room is small */
  priority: number;
  /** Minimum room area (m²) required to place this item */
  minArea?: number;
  /** Human-readable description for 3D AI Studio generation prompt */
  aiPrompt?: string;
}

export interface RoomFurnitureSet {
  style: FurnitureStyle;
  roomType: RoomType;
  items: FurnitureItem[];
}

// ─── Modern Style Catalog ─────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// LIVING ROOM — Sofa facing TV wall, coffee table in between, plants in corners
// ══════════════════════════════════════════════════════════════════════════════
const modernLiving: FurnitureItem[] = [
  // ── On R2 CDN ──
  { file: "sofa.glb", rx: 0.5, rz: 0.22, wF: 0.7, dF: 0.35, rot: 0, targetH: 0.88, priority: 10 },
  { file: "coffee-table.glb", rx: 0.5, rz: 0.48, wF: 0.3, dF: 0.22, rot: 0, targetH: 0.45, priority: 9 },
  { file: "tv-unit.glb", rx: 0.5, rz: 0.88, wF: 0.5, dF: 0.18, rot: Math.PI, targetH: 0.55, priority: 8 },
  { file: "floor-lamp.glb", rx: 0.1, rz: 0.1, wF: 0.1, dF: 0.1, rot: 0, targetH: 1.75, priority: 5 },
  { file: "potted-plant.glb", rx: 0.9, rz: 0.1, wF: 0.12, dF: 0.12, rot: 0, targetH: 0.8, priority: 6 },
  // ── Needs generation ──
  { file: "armchair.glb", rx: 0.15, rz: 0.55, wF: 0.2, dF: 0.2, rot: Math.PI / 6, targetH: 0.85, priority: 4, minArea: 14, aiPrompt: "modern accent armchair, dark gray fabric, walnut wood legs, cushioned seat" },
  { file: "side-table.glb", rx: 0.88, rz: 0.22, wF: 0.1, dF: 0.1, rot: 0, targetH: 0.55, priority: 4, minArea: 10, aiPrompt: "modern round side table, black metal frame, marble top" },
  { file: "bookshelf.glb", rx: 0.95, rz: 0.5, wF: 0.1, dF: 0.3, rot: -Math.PI / 2, targetH: 1.6, priority: 3, minArea: 14, aiPrompt: "modern open bookshelf, oak wood, 5 shelves, books and decor items" },
  { file: "wall-clock.glb", rx: 0.5, rz: 0.96, wF: 0.08, dF: 0.02, rot: Math.PI, targetH: 0.35, priority: 2, aiPrompt: "modern minimalist wall clock, 30cm diameter, black metal frame, white face" },
  { file: "curtain-set.glb", rx: 0.5, rz: 0.04, wF: 0.6, dF: 0.05, rot: 0, targetH: 2.4, priority: 3, minArea: 8, aiPrompt: "modern sheer white curtain pair, floor length, on brushed brass rod, 2m wide" },
  { file: "throw-pillow-set.glb", rx: 0.42, rz: 0.2, wF: 0.15, dF: 0.1, rot: 0.15, targetH: 0.2, priority: 2, minArea: 8, aiPrompt: "set of 3 modern throw pillows, mustard and gray, textured fabric on sofa" },
  { file: "potted-plant.glb", rx: 0.1, rz: 0.88, wF: 0.1, dF: 0.1, rot: 0, targetH: 0.8, priority: 3 },
];

// ══════════════════════════════════════════════════════════════════════════════
// BEDROOM — Bed against wall, nightstands flanking, wardrobe near door side
// ══════════════════════════════════════════════════════════════════════════════
const modernBedroom: FurnitureItem[] = [
  // ── On R2 CDN ──
  { file: "bed.glb", rx: 0.5, rz: 0.35, wF: 0.75, dF: 0.7, rot: 0, targetH: 0.75, priority: 10 },
  { file: "nightstand.glb", rx: 0.88, rz: 0.2, wF: 0.13, dF: 0.13, rot: 0, targetH: 0.58, priority: 9 },
  { file: "nightstand.glb", rx: 0.12, rz: 0.2, wF: 0.13, dF: 0.13, rot: 0, targetH: 0.58, priority: 8 },
  { file: "potted-plant.glb", rx: 0.08, rz: 0.88, wF: 0.08, dF: 0.08, rot: 0, targetH: 0.8, priority: 3 },
  // ── Needs generation ──
  { file: "wardrobe.glb", rx: 0.82, rz: 0.85, wF: 0.3, dF: 0.2, rot: Math.PI, targetH: 2.1, priority: 7, minArea: 10, aiPrompt: "modern sliding door wardrobe, light oak wood, 2 mirrored doors, 180cm tall, full height" },
  { file: "table-lamp.glb", rx: 0.88, rz: 0.2, wF: 0.06, dF: 0.06, rot: 0, targetH: 0.42, priority: 6, aiPrompt: "modern bedside lamp, brass cylindrical base, white linen drum shade" },
  { file: "table-lamp.glb", rx: 0.12, rz: 0.2, wF: 0.06, dF: 0.06, rot: 0, targetH: 0.42, priority: 5 },
  { file: "dresser.glb", rx: 0.18, rz: 0.88, wF: 0.25, dF: 0.14, rot: Math.PI, targetH: 0.82, priority: 5, minArea: 12, aiPrompt: "modern 6-drawer dresser, walnut wood, brass handles, 120cm wide" },
  { file: "full-mirror.glb", rx: 0.18, rz: 0.92, wF: 0.12, dF: 0.03, rot: Math.PI, targetH: 1.6, priority: 4, minArea: 10, aiPrompt: "modern full-length standing mirror, thin black metal frame, 160cm tall, leaning against wall" },
  { file: "bedroom-bench.glb", rx: 0.5, rz: 0.72, wF: 0.4, dF: 0.1, rot: 0, targetH: 0.45, priority: 3, minArea: 14, aiPrompt: "modern upholstered bedroom bench, beige boucle fabric, brass legs, 90cm wide" },
  { file: "curtain-set.glb", rx: 0.5, rz: 0.04, wF: 0.6, dF: 0.05, rot: 0, targetH: 2.4, priority: 3, minArea: 8, aiPrompt: "modern sheer white curtain pair, floor length, on brushed brass rod, 2m wide" },
];

// ══════════════════════════════════════════════════════════════════════════════
// KITCHEN — Work triangle: fridge on right, counter+stove on back wall, sink
// ══════════════════════════════════════════════════════════════════════════════
const modernKitchen: FurnitureItem[] = [
  // ── On R2 CDN ──
  { file: "fridge.glb", rx: 0.9, rz: 0.12, wF: 0.18, dF: 0.2, rot: 0, targetH: 1.85, priority: 10 },
  // ── Needs generation ──
  { file: "kitchen-counter.glb", rx: 0.5, rz: 0.08, wF: 0.65, dF: 0.18, rot: 0, targetH: 0.9, priority: 10, aiPrompt: "modern kitchen counter with cabinets below, white marble top, dark navy blue base cabinets, 200cm wide, integrated sink on left side" },
  { file: "stove-range.glb", rx: 0.35, rz: 0.08, wF: 0.18, dF: 0.18, rot: 0, targetH: 0.9, priority: 9, aiPrompt: "modern gas stove range, stainless steel, 4 burners, oven below, 60cm wide" },
  { file: "range-hood.glb", rx: 0.35, rz: 0.04, wF: 0.18, dF: 0.12, rot: 0, targetH: 0.5, priority: 7, aiPrompt: "modern wall-mounted range hood, stainless steel, chimney style, 60cm wide, with LED lights" },
  { file: "upper-cabinet.glb", rx: 0.6, rz: 0.04, wF: 0.4, dF: 0.1, rot: 0, targetH: 0.7, priority: 7, aiPrompt: "modern wall-mounted kitchen upper cabinets, matte white finish, 2 doors with handles, 120cm wide" },
  { file: "kitchen-island.glb", rx: 0.5, rz: 0.55, wF: 0.35, dF: 0.2, rot: 0, targetH: 0.9, priority: 6, minArea: 12, aiPrompt: "modern kitchen island, dark wood base, white marble top, 120cm wide" },
  { file: "bar-stool.glb", rx: 0.35, rz: 0.62, wF: 0.08, dF: 0.08, rot: 0, targetH: 0.75, priority: 5, minArea: 12, aiPrompt: "modern bar stool, black metal frame, natural wood seat, footrest" },
  { file: "bar-stool.glb", rx: 0.65, rz: 0.62, wF: 0.08, dF: 0.08, rot: 0, targetH: 0.75, priority: 5, minArea: 12 },
  { file: "microwave.glb", rx: 0.65, rz: 0.08, wF: 0.1, dF: 0.1, rot: 0, targetH: 0.3, priority: 4, aiPrompt: "modern built-in microwave oven, stainless steel front, digital display, 45cm wide" },
  { file: "dish-rack.glb", rx: 0.2, rz: 0.08, wF: 0.1, dF: 0.08, rot: 0, targetH: 0.25, priority: 3, aiPrompt: "modern kitchen dish drying rack, stainless steel, with drip tray, plates and cups" },
  { file: "kitchen-pendant.glb", rx: 0.5, rz: 0.5, wF: 0.08, dF: 0.08, rot: 0, targetH: 0.25, priority: 4, aiPrompt: "modern kitchen pendant light, black metal dome shade, brass accent, warm LED" },
  { file: "potted-herb.glb", rx: 0.75, rz: 0.08, wF: 0.06, dF: 0.06, rot: 0, targetH: 0.25, priority: 2, aiPrompt: "kitchen herb planter, 3 small terracotta pots with basil, rosemary, thyme on wooden tray" },
];

// ══════════════════════════════════════════════════════════════════════════════
// DINING — Table centered, chairs around, sideboard against wall, pendant
// ══════════════════════════════════════════════════════════════════════════════
const modernDining: FurnitureItem[] = [
  // ── On R2 CDN ──
  { file: "dining-table.glb", rx: 0.5, rz: 0.5, wF: 0.55, dF: 0.45, rot: 0, targetH: 0.78, priority: 10 },
  { file: "dining-chair.glb", rx: 0.22, rz: 0.5, wF: 0.14, dF: 0.14, rot: Math.PI / 2, targetH: 0.88, priority: 9 },
  { file: "dining-chair.glb", rx: 0.78, rz: 0.5, wF: 0.14, dF: 0.14, rot: -Math.PI / 2, targetH: 0.88, priority: 9 },
  { file: "dining-chair.glb", rx: 0.5, rz: 0.22, wF: 0.14, dF: 0.14, rot: 0, targetH: 0.88, priority: 8 },
  { file: "dining-chair.glb", rx: 0.5, rz: 0.78, wF: 0.14, dF: 0.14, rot: Math.PI, targetH: 0.88, priority: 8 },
  // ── Needs generation ──
  { file: "dining-pendant.glb", rx: 0.5, rz: 0.5, wF: 0.1, dF: 0.1, rot: 0, targetH: 0.35, priority: 7, aiPrompt: "modern pendant light fixture, 3 black metal shades in a row, brass accents, warm LED, for dining table" },
  { file: "dining-sideboard.glb", rx: 0.5, rz: 0.94, wF: 0.4, dF: 0.1, rot: Math.PI, targetH: 0.8, priority: 6, minArea: 10, aiPrompt: "modern sideboard buffet, walnut wood, 3 doors with brass handles, 150cm wide" },
  { file: "wine-rack.glb", rx: 0.9, rz: 0.92, wF: 0.1, dF: 0.08, rot: -Math.PI / 2, targetH: 0.9, priority: 3, minArea: 12, aiPrompt: "modern wine rack, black metal frame, holds 12 bottles, wall-mounted, with wine glasses" },
  { file: "table-centerpiece.glb", rx: 0.5, rz: 0.5, wF: 0.08, dF: 0.08, rot: 0, targetH: 0.25, priority: 5, aiPrompt: "modern dining table centerpiece, glass vase with eucalyptus, 2 candleholders, on marble tray" },
  { file: "wall-art-frame.glb", rx: 0.5, rz: 0.04, wF: 0.2, dF: 0.02, rot: 0, targetH: 0.6, priority: 2, aiPrompt: "modern abstract wall art in black frame, landscape orientation, warm earth tones, 80x50cm" },
  { file: "potted-plant.glb", rx: 0.9, rz: 0.1, wF: 0.1, dF: 0.1, rot: 0, targetH: 0.8, priority: 3 },
];

// ══════════════════════════════════════════════════════════════════════════════
// BATHROOM — Toilet side wall, vanity+mirror on back wall, shower far corner
// ══════════════════════════════════════════════════════════════════════════════
const modernBathroom: FurnitureItem[] = [
  // ── On R2 CDN ──
  { file: "toilet.glb", rx: 0.75, rz: 0.25, wF: 0.18, dF: 0.22, rot: -Math.PI / 2, targetH: 0.45, priority: 10 },
  { file: "bathroom-vanity.glb", rx: 0.35, rz: 0.08, wF: 0.4, dF: 0.18, rot: 0, targetH: 0.88, priority: 9 },
  // ── Needs generation ──
  { file: "bathroom-mirror.glb", rx: 0.35, rz: 0.04, wF: 0.25, dF: 0.03, rot: 0, targetH: 0.7, priority: 8, aiPrompt: "modern rectangular bathroom mirror with LED backlight strip, 70x50cm, anti-fog, thin black frame" },
  { file: "rain-shower.glb", rx: 0.15, rz: 0.8, wF: 0.25, dF: 0.25, rot: 0, targetH: 2.1, priority: 7, minArea: 4, aiPrompt: "modern frameless glass shower enclosure, corner entry, rain shower head, chrome fixtures, 90x90cm" },
  { file: "towel-warmer.glb", rx: 0.92, rz: 0.6, wF: 0.06, dF: 0.03, rot: -Math.PI / 2, targetH: 0.9, priority: 5, minArea: 4, aiPrompt: "modern heated towel rail, chrome finish, wall-mounted, 5 bars, with white towel draped" },
  { file: "bathtub.glb", rx: 0.35, rz: 0.78, wF: 0.45, dF: 0.22, rot: 0, targetH: 0.55, priority: 6, minArea: 7, aiPrompt: "modern freestanding bathtub, matte white acrylic, oval shape, chrome floor-mounted faucet, 170cm long" },
  { file: "toilet-paper-holder.glb", rx: 0.85, rz: 0.22, wF: 0.04, dF: 0.04, rot: -Math.PI / 2, targetH: 0.15, priority: 4, aiPrompt: "modern wall-mounted toilet paper holder, matte black metal, with roll" },
  { file: "bathroom-shelf.glb", rx: 0.92, rz: 0.4, wF: 0.06, dF: 0.1, rot: -Math.PI / 2, targetH: 0.3, priority: 3, aiPrompt: "modern floating bathroom shelf, matte black metal, 30cm, with soap dispenser and plant" },
  { file: "bath-mat.glb", rx: 0.35, rz: 0.2, wF: 0.18, dF: 0.12, rot: 0, targetH: 0.02, priority: 4, aiPrompt: "modern soft bath mat, charcoal gray, non-slip rubber base, 60x40cm, textured" },
];

// ══════════════════════════════════════════════════════════════════════════════
// OFFICE — Desk against wall/window, chair, bookshelf, monitor, plants
// ══════════════════════════════════════════════════════════════════════════════
const modernOffice: FurnitureItem[] = [
  // ── On R2 CDN ──
  { file: "office-desk.glb", rx: 0.5, rz: 0.25, wF: 0.55, dF: 0.25, rot: 0, targetH: 0.78, priority: 10 },
  { file: "office-chair.glb", rx: 0.5, rz: 0.55, wF: 0.18, dF: 0.18, rot: Math.PI, targetH: 1.15, priority: 9 },
  { file: "potted-plant.glb", rx: 0.92, rz: 0.88, wF: 0.08, dF: 0.08, rot: 0, targetH: 0.8, priority: 4 },
  // ── Needs generation ──
  { file: "bookshelf.glb", rx: 0.95, rz: 0.5, wF: 0.1, dF: 0.28, rot: -Math.PI / 2, targetH: 1.6, priority: 7, minArea: 8, aiPrompt: "modern open bookshelf, oak wood, 5 shelves, books and decorative items, 80cm wide" },
  { file: "desk-lamp.glb", rx: 0.35, rz: 0.2, wF: 0.06, dF: 0.06, rot: 0, targetH: 0.5, priority: 6, aiPrompt: "modern desk lamp, adjustable arm, brushed brass finish, LED warm light" },
  { file: "monitor.glb", rx: 0.5, rz: 0.2, wF: 0.14, dF: 0.06, rot: 0, targetH: 0.45, priority: 8, aiPrompt: "modern 27-inch computer monitor on thin stand, black bezel, showing abstract wallpaper" },
  { file: "filing-cabinet.glb", rx: 0.12, rz: 0.2, wF: 0.1, dF: 0.12, rot: Math.PI / 2, targetH: 0.68, priority: 4, minArea: 8, aiPrompt: "modern 3-drawer filing cabinet, matte white, chrome handles, on casters" },
  { file: "desk-organizer.glb", rx: 0.62, rz: 0.2, wF: 0.06, dF: 0.04, rot: 0, targetH: 0.15, priority: 3, aiPrompt: "modern desk organizer, black metal mesh, pencil holder, tray, card holder set" },
  { file: "wall-clock.glb", rx: 0.5, rz: 0.04, wF: 0.08, dF: 0.02, rot: 0, targetH: 0.3, priority: 2, aiPrompt: "modern minimalist wall clock, 30cm diameter, black metal frame, white face" },
];

// ══════════════════════════════════════════════════════════════════════════════
// HALLWAY — Runner rug, coat hooks, console table, ceiling spots
// ══════════════════════════════════════════════════════════════════════════════
const modernHallway: FurnitureItem[] = [
  { file: "console-table.glb", rx: 0.5, rz: 0.08, wF: 0.35, dF: 0.1, rot: 0, targetH: 0.78, priority: 8, minArea: 3, aiPrompt: "modern narrow console table, walnut wood top, black metal legs, 100cm wide, 30cm deep" },
  { file: "wall-mirror-hall.glb", rx: 0.5, rz: 0.04, wF: 0.2, dF: 0.03, rot: 0, targetH: 0.8, priority: 7, minArea: 3, aiPrompt: "modern hallway wall mirror, round 60cm diameter, thin brass frame, decorative" },
  { file: "coat-hooks.glb", rx: 0.88, rz: 0.04, wF: 0.08, dF: 0.03, rot: 0, targetH: 0.15, priority: 5, aiPrompt: "modern wall-mounted coat hooks, 5 hooks on walnut wood plank, brass hooks, 60cm wide" },
  { file: "hall-pendant.glb", rx: 0.5, rz: 0.5, wF: 0.06, dF: 0.06, rot: 0, targetH: 0.2, priority: 4, aiPrompt: "modern hallway flush-mount ceiling light, round frosted glass, brass trim, 25cm diameter" },
  { file: "potted-plant.glb", rx: 0.85, rz: 0.5, wF: 0.1, dF: 0.1, rot: 0, targetH: 0.8, priority: 3 },
  { file: "wall-art-frame.glb", rx: 0.92, rz: 0.5, wF: 0.12, dF: 0.02, rot: -Math.PI / 2, targetH: 0.45, priority: 2, minArea: 4, aiPrompt: "modern abstract wall art in black frame, landscape orientation, warm earth tones, 80x50cm" },
];

// ══════════════════════════════════════════════════════════════════════════════
// ENTRANCE — Shoe cabinet, umbrella stand, coat rack, welcome mat, mirror
// ══════════════════════════════════════════════════════════════════════════════
const modernEntrance: FurnitureItem[] = [
  { file: "shoe-cabinet.glb", rx: 0.75, rz: 0.08, wF: 0.25, dF: 0.1, rot: 0, targetH: 0.85, priority: 9, aiPrompt: "modern shoe cabinet, matte white, 3 flip-down compartments, holds 12 pairs, 80cm wide" },
  { file: "console-table.glb", rx: 0.35, rz: 0.08, wF: 0.25, dF: 0.08, rot: 0, targetH: 0.78, priority: 8, minArea: 4, aiPrompt: "modern narrow console table, walnut wood top, black metal legs, 100cm wide, 30cm deep" },
  { file: "coat-rack.glb", rx: 0.92, rz: 0.3, wF: 0.08, dF: 0.08, rot: 0, targetH: 1.75, priority: 7, aiPrompt: "modern freestanding coat rack, black metal, 6 hooks, umbrella holder base, 175cm tall" },
  { file: "wall-mirror-hall.glb", rx: 0.35, rz: 0.04, wF: 0.15, dF: 0.03, rot: 0, targetH: 0.7, priority: 6, aiPrompt: "modern hallway wall mirror, round 60cm diameter, thin brass frame, decorative" },
  { file: "welcome-mat.glb", rx: 0.5, rz: 0.85, wF: 0.2, dF: 0.12, rot: 0, targetH: 0.02, priority: 5, aiPrompt: "modern doormat, dark charcoal coir fiber, 60x40cm, natural rubber border" },
  { file: "key-holder.glb", rx: 0.22, rz: 0.04, wF: 0.06, dF: 0.03, rot: 0, targetH: 0.12, priority: 3, aiPrompt: "modern wall-mounted key holder, walnut wood with 4 brass hooks, small shelf on top" },
  { file: "umbrella-stand.glb", rx: 0.92, rz: 0.7, wF: 0.06, dF: 0.06, rot: 0, targetH: 0.55, priority: 4, aiPrompt: "modern umbrella stand, black metal cylindrical, perforated design, holds 4 umbrellas" },
];

// ══════════════════════════════════════════════════════════════════════════════
// VERANDA / BALCONY / PATIO — Outdoor seating, planters, hanging lights
// ══════════════════════════════════════════════════════════════════════════════
const modernVeranda: FurnitureItem[] = [
  { file: "outdoor-chair.glb", rx: 0.3, rz: 0.4, wF: 0.18, dF: 0.18, rot: Math.PI / 4, targetH: 0.82, priority: 8, aiPrompt: "modern outdoor lounge chair, rattan wicker, dark gray cushion, weather-resistant" },
  { file: "outdoor-chair.glb", rx: 0.7, rz: 0.4, wF: 0.18, dF: 0.18, rot: -Math.PI / 4, targetH: 0.82, priority: 7 },
  { file: "outdoor-table.glb", rx: 0.5, rz: 0.45, wF: 0.12, dF: 0.12, rot: 0, targetH: 0.45, priority: 9, aiPrompt: "modern outdoor side table, round teak wood top, black metal base, 50cm diameter" },
  { file: "railing-planter.glb", rx: 0.5, rz: 0.92, wF: 0.25, dF: 0.06, rot: 0, targetH: 0.2, priority: 5, aiPrompt: "modern railing planter box, white metal, with trailing ivy and small flowers, 60cm wide" },
  { file: "potted-plant.glb", rx: 0.15, rz: 0.25, wF: 0.12, dF: 0.12, rot: 0, targetH: 0.8, priority: 6 },
  { file: "potted-plant.glb", rx: 0.85, rz: 0.75, wF: 0.12, dF: 0.12, rot: 0, targetH: 0.8, priority: 5 },
  { file: "outdoor-lantern.glb", rx: 0.15, rz: 0.1, wF: 0.06, dF: 0.06, rot: 0, targetH: 0.35, priority: 3, aiPrompt: "modern outdoor lantern, black metal frame, frosted glass, LED candle inside, 35cm tall" },
  { file: "outdoor-rug.glb", rx: 0.5, rz: 0.4, wF: 0.4, dF: 0.35, rot: 0, targetH: 0.01, priority: 4, minArea: 5, aiPrompt: "modern outdoor area rug, flatweave, navy blue and white geometric pattern, weather-resistant, 120x80cm" },
];

// ══════════════════════════════════════════════════════════════════════════════
// UTILITY / STORAGE / CLOSET — Practical: washer, shelves, iron board
// ══════════════════════════════════════════════════════════════════════════════
const modernUtility: FurnitureItem[] = [
  { file: "washing-machine.glb", rx: 0.25, rz: 0.12, wF: 0.18, dF: 0.18, rot: 0, targetH: 0.85, priority: 10, aiPrompt: "modern front-load washing machine, white, digital display, chrome handle, 60cm wide" },
  { file: "dryer.glb", rx: 0.55, rz: 0.12, wF: 0.18, dF: 0.18, rot: 0, targetH: 0.85, priority: 8, minArea: 5, aiPrompt: "modern tumble dryer, white, matching washing machine, digital display, 60cm wide" },
  { file: "utility-shelf.glb", rx: 0.85, rz: 0.5, wF: 0.1, dF: 0.3, rot: -Math.PI / 2, targetH: 1.8, priority: 7, aiPrompt: "modern utility metal shelf unit, chrome, 5 shelves, with cleaning supplies and boxes, 80cm wide" },
  { file: "iron-board.glb", rx: 0.5, rz: 0.7, wF: 0.1, dF: 0.3, rot: 0, targetH: 0.9, priority: 4, minArea: 5, aiPrompt: "modern ironing board, folded standing, gray padded cover, black metal legs" },
  { file: "laundry-basket.glb", rx: 0.75, rz: 0.12, wF: 0.1, dF: 0.1, rot: 0, targetH: 0.55, priority: 5, aiPrompt: "modern laundry basket, woven bamboo, white fabric liner, 45cm tall" },
  { file: "mop-bucket.glb", rx: 0.12, rz: 0.8, wF: 0.06, dF: 0.06, rot: 0, targetH: 0.35, priority: 2, aiPrompt: "modern spin mop bucket with mop, gray plastic bucket, microfiber mop head" },
];

// ══════════════════════════════════════════════════════════════════════════════
// STUDIO — Combined living+sleeping, compact layout
// ══════════════════════════════════════════════════════════════════════════════
const modernStudio: FurnitureItem[] = [
  { file: "sofa.glb", rx: 0.5, rz: 0.22, wF: 0.6, dF: 0.3, rot: 0, targetH: 0.88, priority: 10 },
  { file: "coffee-table.glb", rx: 0.5, rz: 0.45, wF: 0.25, dF: 0.18, rot: 0, targetH: 0.45, priority: 9 },
  { file: "tv-unit.glb", rx: 0.5, rz: 0.88, wF: 0.4, dF: 0.14, rot: Math.PI, targetH: 0.55, priority: 8 },
  { file: "floor-lamp.glb", rx: 0.1, rz: 0.1, wF: 0.08, dF: 0.08, rot: 0, targetH: 1.75, priority: 5 },
  { file: "potted-plant.glb", rx: 0.9, rz: 0.1, wF: 0.1, dF: 0.1, rot: 0, targetH: 0.8, priority: 4 },
  { file: "bookshelf.glb", rx: 0.95, rz: 0.5, wF: 0.1, dF: 0.25, rot: -Math.PI / 2, targetH: 1.6, priority: 3, minArea: 10, aiPrompt: "modern open bookshelf, oak wood, 5 shelves, books and decorative items, 80cm wide" },
];

// ─── Catalog Registry ──────────────────────────────────────────────────────────

const CATALOG: RoomFurnitureSet[] = [
  { style: "modern", roomType: "living", items: modernLiving },
  { style: "modern", roomType: "bedroom", items: modernBedroom },
  { style: "modern", roomType: "kitchen", items: modernKitchen },
  { style: "modern", roomType: "dining", items: modernDining },
  { style: "modern", roomType: "bathroom", items: modernBathroom },
  { style: "modern", roomType: "office", items: modernOffice },
  { style: "modern", roomType: "hallway", items: modernHallway },
  { style: "modern", roomType: "entrance", items: modernEntrance },
  { style: "modern", roomType: "veranda", items: modernVeranda },
  { style: "modern", roomType: "balcony", items: modernVeranda },    // reuse veranda set
  { style: "modern", roomType: "patio", items: modernVeranda },      // reuse veranda set
  { style: "modern", roomType: "utility", items: modernUtility },
  { style: "modern", roomType: "storage", items: modernUtility },    // reuse utility set
  { style: "modern", roomType: "closet", items: modernUtility },     // reuse utility set
  { style: "modern", roomType: "studio", items: modernStudio },
];

/**
 * Get furniture items for a room type and style.
 * Filters by minimum area if provided.
 */
export function getFurnitureForRoom(
  roomType: RoomType,
  style: FurnitureStyle = "modern",
  roomArea?: number
): FurnitureItem[] {
  const set = CATALOG.find((s) => s.style === style && s.roomType === roomType);
  if (!set) return [];

  let items = [...set.items];

  // Filter by minimum area
  if (roomArea !== undefined) {
    items = items.filter((item) => !item.minArea || roomArea >= item.minArea);
  }

  // Sort by priority (highest first)
  items.sort((a, b) => b.priority - a.priority);

  return items;
}

/**
 * Get all unique 3D AI Studio prompts for furniture that needs generating.
 * Returns only items that have aiPrompt defined.
 */
export function getAllAIPrompts(): Array<{ file: string; prompt: string; targetH: number }> {
  const seen = new Set<string>();
  const prompts: Array<{ file: string; prompt: string; targetH: number }> = [];

  for (const set of CATALOG) {
    for (const item of set.items) {
      if (item.aiPrompt && !seen.has(item.file)) {
        seen.add(item.file);
        prompts.push({
          file: item.file,
          prompt: item.aiPrompt,
          targetH: item.targetH,
        });
      }
    }
  }

  return prompts;
}

/**
 * Get all styles available for a room type.
 */
export function getAvailableStyles(roomType: RoomType): FurnitureStyle[] {
  return CATALOG.filter((s) => s.roomType === roomType).map((s) => s.style);
}
