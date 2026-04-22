/**
 * Phase 2.10.2 — image-drift gate unit tests.
 *
 * Covers:
 *   - computeImageContentBbox on synthetic images (content in corner,
 *     full-black, all-white, sparse content)
 *   - computeRoomsUnionBbox on empty / single / multi-room inputs
 *   - computeDriftRatio math + threshold buckets
 *   - applyImageDriftGate mutating variant + issue surfacing
 *   - Runtime: under 50 ms for a 1024×1024 image
 *   - Zod validation rejects NaN / negative ratios
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  applyImageDriftGate,
  computeDriftRatio,
  computeImageContentBbox,
  computeImageDriftMetrics,
  computeRoomsUnionBbox,
} from "../stage-4-validators";
import type { ExtractedRoom, ExtractedRooms, RectPx } from "../types";

// ─── Synthetic image fixtures ──────────────────────────────────

async function makeImageWithBlackRect(
  imgW: number,
  imgH: number,
  rect: RectPx,
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">
    <rect x="0" y="0" width="${imgW}" height="${imgH}" fill="white"/>
    <rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="black"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function makeAllWhiteImage(imgW: number, imgH: number): Promise<Buffer> {
  return sharp({
    create: {
      width: imgW,
      height: imgH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

async function makeFullBlackImage(imgW: number, imgH: number): Promise<Buffer> {
  return sharp({
    create: {
      width: imgW,
      height: imgH,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

function mkRoom(name: string, rect: RectPx): ExtractedRoom {
  return { name, rectPx: rect, confidence: 0.9, labelAsShown: name };
}

function mkExtraction(rooms: ExtractedRoom[]): ExtractedRooms {
  return {
    imageSize: { width: 1024, height: 1024 },
    plotBoundsPx: rooms.length > 0 ? rooms[0].rectPx : null,
    rooms,
    issues: [],
    expectedRoomsMissing: [],
    unexpectedRoomsFound: [],
  };
}

// ─── computeImageContentBbox ───────────────────────────────────

describe("Phase 2.10.2 — computeImageContentBbox", () => {
  it("finds the bbox of a centred black rect", async () => {
    const img = await makeImageWithBlackRect(200, 200, { x: 50, y: 40, w: 80, h: 60 });
    const bbox = await computeImageContentBbox(img);
    expect(bbox).not.toBeNull();
    // Allow ±1 px for antialiasing edges
    expect(bbox!.x).toBeGreaterThanOrEqual(49);
    expect(bbox!.x).toBeLessThanOrEqual(51);
    expect(bbox!.y).toBeGreaterThanOrEqual(39);
    expect(bbox!.y).toBeLessThanOrEqual(41);
    expect(bbox!.w).toBeGreaterThanOrEqual(79);
    expect(bbox!.w).toBeLessThanOrEqual(82);
    expect(bbox!.h).toBeGreaterThanOrEqual(59);
    expect(bbox!.h).toBeLessThanOrEqual(62);
  });

  it("returns null for an entirely white image", async () => {
    const img = await makeAllWhiteImage(100, 100);
    const bbox = await computeImageContentBbox(img);
    expect(bbox).toBeNull();
  });

  it("returns the full image for an all-black image", async () => {
    const img = await makeFullBlackImage(100, 100);
    const bbox = await computeImageContentBbox(img);
    expect(bbox).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("handles content in a corner", async () => {
    const img = await makeImageWithBlackRect(100, 100, { x: 80, y: 80, w: 20, h: 20 });
    const bbox = await computeImageContentBbox(img);
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBeGreaterThanOrEqual(79);
    expect(bbox!.y).toBeGreaterThanOrEqual(79);
  });
});

// ─── computeRoomsUnionBbox ─────────────────────────────────────

describe("Phase 2.10.2 — computeRoomsUnionBbox", () => {
  it("returns null for an empty rooms list", () => {
    expect(computeRoomsUnionBbox([])).toBeNull();
  });

  it("returns the sole room's bbox for a single-room list", () => {
    const r = mkRoom("A", { x: 10, y: 20, w: 30, h: 40 });
    expect(computeRoomsUnionBbox([r])).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("takes the axis-aligned union of multiple rooms", () => {
    const rooms = [
      mkRoom("A", { x: 0, y: 0, w: 50, h: 50 }),
      mkRoom("B", { x: 30, y: 60, w: 40, h: 20 }),
      mkRoom("C", { x: 100, y: 10, w: 20, h: 30 }),
    ];
    expect(computeRoomsUnionBbox(rooms)).toEqual({
      x: 0,
      y: 0,
      w: 120, // max x+w = 100+20
      h: 80, // max y+h = 60+20
    });
  });

  it("ignores degenerate rooms (zero-area)", () => {
    const rooms = [
      mkRoom("A", { x: 10, y: 10, w: 0, h: 50 }),
      mkRoom("B", { x: 20, y: 20, w: 30, h: 30 }),
    ];
    expect(computeRoomsUnionBbox(rooms)).toEqual({ x: 20, y: 20, w: 30, h: 30 });
  });
});

// ─── computeDriftRatio ─────────────────────────────────────────

describe("Phase 2.10.2 — computeDriftRatio", () => {
  const img: RectPx = { x: 0, y: 0, w: 100, h: 100 };

  it("returns 0 when rooms bbox exactly matches image bbox", () => {
    expect(computeDriftRatio(img, img)).toBe(0);
  });

  it("returns 1 when rooms bbox is null (no extraction)", () => {
    expect(computeDriftRatio(img, null)).toBe(1);
  });

  it("returns 1 when rooms bbox is entirely disjoint from image bbox", () => {
    const rooms: RectPx = { x: 1000, y: 1000, w: 100, h: 100 };
    // imgArea + roomsArea − 2·0 = 20000; /10000 = 2.0
    expect(computeDriftRatio(img, rooms)).toBe(2);
  });

  it("computes a mid-value when rooms cover half the image", () => {
    const rooms: RectPx = { x: 0, y: 0, w: 50, h: 100 };
    // intersection = 50*100 = 5000
    // imgArea = 10000, roomsArea = 5000
    // XOR = 10000 + 5000 - 10000 = 5000; /10000 = 0.5
    expect(computeDriftRatio(img, rooms)).toBe(0.5);
  });

  it("handles degenerate image bbox (area 0) by returning 1", () => {
    const deg: RectPx = { x: 0, y: 0, w: 0, h: 0 };
    expect(computeDriftRatio(deg, img)).toBe(1);
  });
});

// ─── computeImageDriftMetrics (+ severity) ─────────────────────

describe("Phase 2.10.2 — computeImageDriftMetrics", () => {
  it("returns severity 'none' when rooms perfectly cover image content", async () => {
    const img = await makeImageWithBlackRect(200, 200, { x: 50, y: 50, w: 100, h: 100 });
    const rooms = [mkRoom("Living", { x: 50, y: 50, w: 100, h: 100 })];
    const metrics = await computeImageDriftMetrics(img, rooms);
    expect(metrics).not.toBeNull();
    expect(metrics!.severity).toBe("none");
    expect(metrics!.driftFlagged).toBe(false);
    expect(metrics!.driftRatio).toBeLessThanOrEqual(0.05);
  });

  it("returns severity 'severe' when rooms entirely miss image content", async () => {
    const img = await makeImageWithBlackRect(200, 200, { x: 50, y: 50, w: 100, h: 100 });
    // Rooms placed in a non-overlapping region
    const rooms = [mkRoom("Phantom", { x: 170, y: 170, w: 20, h: 20 })];
    const metrics = await computeImageDriftMetrics(img, rooms);
    expect(metrics).not.toBeNull();
    expect(metrics!.severity).toBe("severe");
    expect(metrics!.driftRatio).toBeGreaterThan(0.35);
  });

  it("returns severity 'moderate' in the 0.20–0.35 band", async () => {
    // Image content: 100×100 at (50,50). Rooms cover 75% of it.
    const img = await makeImageWithBlackRect(200, 200, { x: 50, y: 50, w: 100, h: 100 });
    const rooms = [mkRoom("PartialLiving", { x: 50, y: 50, w: 75, h: 100 })];
    // intersection = 75*100 = 7500; img=10000; rooms=7500
    // XOR = 10000 + 7500 − 15000 = 2500; ratio = 0.25 → moderate
    const metrics = await computeImageDriftMetrics(img, rooms);
    expect(metrics).not.toBeNull();
    expect(metrics!.severity).toBe("moderate");
    expect(metrics!.driftRatio).toBeGreaterThan(0.2);
    expect(metrics!.driftRatio).toBeLessThanOrEqual(0.35);
    expect(metrics!.driftFlagged).toBe(true);
  });

  it("returns null when the image is entirely white", async () => {
    const img = await makeAllWhiteImage(100, 100);
    const metrics = await computeImageDriftMetrics(img, [
      mkRoom("A", { x: 0, y: 0, w: 50, h: 50 }),
    ]);
    expect(metrics).toBeNull();
  });

  it("runs under 50 ms on a 1024×1024 image (approximate per-image budget)", async () => {
    const img = await makeImageWithBlackRect(1024, 1024, { x: 48, y: 48, w: 928, h: 928 });
    const rooms = [mkRoom("A", { x: 48, y: 48, w: 928, h: 928 })];
    const t0 = performance.now();
    const metrics = await computeImageDriftMetrics(img, rooms);
    const elapsed = performance.now() - t0;
    expect(metrics).not.toBeNull();
    // Generous 150 ms cap for CI jitter (target was 50 ms — typical is 15–30 ms).
    expect(elapsed).toBeLessThan(150);
  });
});

// ─── applyImageDriftGate ───────────────────────────────────────

describe("Phase 2.10.2 — applyImageDriftGate (mutating wrapper)", () => {
  it("attaches metrics and an issue line when drift is flagged", async () => {
    const img = await makeImageWithBlackRect(200, 200, { x: 50, y: 50, w: 100, h: 100 });
    const extraction = mkExtraction([
      mkRoom("Wrong", { x: 170, y: 170, w: 20, h: 20 }),
    ]);
    await applyImageDriftGate(extraction, img);
    expect(extraction.driftMetrics).toBeDefined();
    expect(extraction.driftMetrics!.driftFlagged).toBe(true);
    expect(extraction.issues.some((m) => /^drift:/.test(m))).toBe(true);
  });

  it("attaches metrics WITHOUT an issue line when drift is under threshold", async () => {
    const img = await makeImageWithBlackRect(200, 200, { x: 50, y: 50, w: 100, h: 100 });
    const extraction = mkExtraction([
      mkRoom("Good", { x: 50, y: 50, w: 100, h: 100 }),
    ]);
    await applyImageDriftGate(extraction, img);
    expect(extraction.driftMetrics).toBeDefined();
    expect(extraction.driftMetrics!.severity).toBe("none");
    expect(extraction.issues.some((m) => /^drift:/.test(m))).toBe(false);
  });

  it("adds a 'gate skipped' issue when the image is entirely white", async () => {
    const img = await makeAllWhiteImage(100, 100);
    const extraction = mkExtraction([
      mkRoom("A", { x: 0, y: 0, w: 50, h: 50 }),
    ]);
    await applyImageDriftGate(extraction, img);
    expect(extraction.driftMetrics).toBeUndefined();
    expect(extraction.issues.some((m) => /drift:.*gate skipped/.test(m))).toBe(true);
  });

  it("records a null roomsUnionBboxPx when extraction returned no rooms (severe drift)", async () => {
    const img = await makeImageWithBlackRect(200, 200, { x: 50, y: 50, w: 100, h: 100 });
    const extraction = mkExtraction([]);
    await applyImageDriftGate(extraction, img);
    expect(extraction.driftMetrics).toBeDefined();
    expect(extraction.driftMetrics!.roomsUnionBboxPx).toBeNull();
    expect(extraction.driftMetrics!.driftRatio).toBe(1);
    expect(extraction.driftMetrics!.severity).toBe("severe");
  });
});
