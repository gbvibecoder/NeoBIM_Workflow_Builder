/**
 * Rasterizes a room layout into a top-down PNG suitable as a reference image
 * for gpt-image-1.5 images.edit(). The output is intentionally schematic —
 * walls, room boundaries, and small labels — to give the model a strong
 * structural anchor without dictating visual style.
 *
 * Architectural rule from CLAUDE.md: structural input MUST be passed as a
 * reference image, not described in text. This module is the canonical way
 * to convert room data into that reference image.
 *
 * Implementation matches the sketchToRender pattern (build SVG in code,
 * convert to PNG via sharp) — no extra dependencies introduced.
 */

interface RasterRoom {
  name: string;
  type: string;
  width: number; // meters
  depth: number; // meters
  x?: number; // optional top-left in meters; auto-laid-out if absent
  y?: number;
}

interface RasterBuildingDimensions {
  width: number; // meters
  depth: number; // meters
}

const PX_PER_METER = 50;
const PADDING_PX = 40;
const STROKE_BUILDING = "#1f2937";
const STROKE_ROOM = "#374151";
const FILL_ROOM = "#f3f4f6";
const TEXT_COLOR = "#111827";

/**
 * Escape characters that have special meaning in SVG text content.
 * Room names like "Kitchen & Dining" must not break the SVG parse.
 */
function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Auto-layout rooms in a simple row-pack within the building footprint.
 * Used when the caller doesn't provide x/y coordinates.
 */
function autoLayoutRooms(
  rooms: RasterRoom[],
  building: RasterBuildingDimensions,
): RasterRoom[] {
  const placed: RasterRoom[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxDepth = 0;

  for (const room of rooms) {
    if (room.x !== undefined && room.y !== undefined) {
      placed.push(room);
      continue;
    }
    if (cursorX + room.width > building.width && cursorX > 0) {
      cursorX = 0;
      cursorY += rowMaxDepth;
      rowMaxDepth = 0;
    }
    placed.push({ ...room, x: cursorX, y: cursorY });
    cursorX += room.width;
    rowMaxDepth = Math.max(rowMaxDepth, room.depth);
  }

  return placed;
}

/**
 * Build the SVG string for the floor plan schematic. Coordinates are in
 * pixels (meters * PX_PER_METER) with a constant padding around the
 * building outline.
 */
function buildFloorPlanSvg(
  rooms: RasterRoom[],
  building: RasterBuildingDimensions,
): string {
  const buildingWpx = building.width * PX_PER_METER;
  const buildingHpx = building.depth * PX_PER_METER;
  const canvasW = buildingWpx + PADDING_PX * 2;
  const canvasH = buildingHpx + PADDING_PX * 2;

  const buildingX = PADDING_PX;
  const buildingY = PADDING_PX;

  const roomElements = rooms
    .map((room) => {
      const x = buildingX + (room.x ?? 0) * PX_PER_METER;
      const y = buildingY + (room.y ?? 0) * PX_PER_METER;
      const w = room.width * PX_PER_METER;
      const h = room.depth * PX_PER_METER;
      const safeName = escapeSvgText(room.name);
      const dims = `${room.width.toFixed(1)}m × ${room.depth.toFixed(1)}m`;

      return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${FILL_ROOM}" stroke="${STROKE_ROOM}" stroke-width="2" />
        <text x="${x + 8}" y="${y + 18}" font-family="sans-serif" font-size="14" font-weight="600" fill="${TEXT_COLOR}">${safeName}</text>
        <text x="${x + 8}" y="${y + 34}" font-family="sans-serif" font-size="11" fill="${TEXT_COLOR}" opacity="0.7">${dims}</text>
      `;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasW} ${canvasH}" width="${canvasW}" height="${canvasH}">
    <rect width="${canvasW}" height="${canvasH}" fill="#ffffff" />
    <rect x="${buildingX}" y="${buildingY}" width="${buildingWpx}" height="${buildingHpx}" fill="none" stroke="${STROKE_BUILDING}" stroke-width="4" />
    ${roomElements}
  </svg>`;
}

/**
 * Rasterize a room layout into a PNG buffer. The PNG is letter-boxed to the
 * 1536×1024 frame that gpt-image-1.5 expects for landscape edits — same
 * pattern as sketchToRender uses for elevation sketches.
 */
export async function rasterizeFloorPlanToPng(
  rooms: RasterRoom[],
  building: RasterBuildingDimensions,
): Promise<Buffer> {
  const placed = autoLayoutRooms(rooms, building);
  const svg = buildFloorPlanSvg(placed, building);

  const sharp = (await import("sharp")).default;
  const pngBuffer = await sharp(Buffer.from(svg))
    .resize(1536, 1024, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  return pngBuffer;
}
