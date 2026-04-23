/**
 * Phase 2.10.4 — phantom-filter threshold 12 → 16 sqft.
 *
 * Three pinning tests around the new boundary:
 *   (a) a 14-sqft rect that used to survive now gets dropped,
 *   (b) a 10-sqft pooja room still survives via the small-room exemption,
 *   (c) a 20-sqft habitable closet still survives (no false positive).
 *
 * Also a light regression guard for the issue-string format change
 * (the threshold number is interpolated into the log line).
 */

import { describe, expect, it } from "vitest";
import { dropPhantomRooms } from "../stage-4-validators";
import type {
  ArchitectBrief,
  ExtractedRoom,
  RectPx,
} from "../types";

// ─── Fixtures — matched to Phase 2.8 test scale (40x40 ft plot, 1024 px) ──
const PLOT_BOUNDS: RectPx = { x: 0, y: 0, w: 1024, h: 1024 };
const PLOT_W = 40;
const PLOT_D = 40;

function mkRoom(name: string, areaSqft: number): ExtractedRoom {
  const sidePx = Math.round(Math.sqrt(areaSqft) * (1024 / 40));
  return {
    name,
    rectPx: { x: 0, y: 0, w: sidePx, h: sidePx },
    confidence: 0.9,
    labelAsShown: name,
  };
}

function briefWithRoom(name: string, type: string): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: PLOT_W,
    plotDepthFt: PLOT_D,
    facing: "north",
    styleCues: [],
    constraints: [],
    adjacencies: [],
    roomList: [{ name, type, approxAreaSqft: 100 }],
  };
}

describe("Phase 2.10.4 — PHANTOM_MIN_SQFT raised 12 → 16", () => {
  it("DROPS a standard-type room at 14 sqft (would have survived the 12-sqft threshold)", () => {
    const brief = briefWithRoom("Tiny Study", "study");
    const rooms = [mkRoom("Tiny Study", 14)];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept).toHaveLength(0);
    expect(res.droppedNames).toContain("Tiny Study");
    expect(issues.some((m) => /< 16 sqft threshold/.test(m))).toBe(true);
  });

  it("DROPS a standard-type room at 15.9 sqft (just below the new boundary)", () => {
    const brief = briefWithRoom("Alcove", "bedroom");
    const rooms = [mkRoom("Alcove", 15.9)];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept).toHaveLength(0);
  });

  it("KEEPS a pooja room at 10 sqft (small-room exemption still active at 8 sqft)", () => {
    const brief = briefWithRoom("Pooja Room", "pooja");
    const rooms = [mkRoom("Pooja Room", 10)];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0].name).toBe("Pooja Room");
  });

  it("KEEPS a 20-sqft closet (above the 16-sqft standard threshold)", () => {
    const brief = briefWithRoom("Walk-in Closet", "walk_in_closet");
    const rooms = [mkRoom("Walk-in Closet", 20)];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0].name).toBe("Walk-in Closet");
  });

  it("STILL DROPS a pooja room at 6 sqft (below the 8-sqft exempt floor)", () => {
    const brief = briefWithRoom("Pooja Room", "pooja");
    const rooms = [mkRoom("Pooja Room", 6)];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept).toHaveLength(0);
  });

  it("interpolates the new 16-sqft threshold into the phantom issue message", () => {
    const brief = briefWithRoom("Ghost", "bedroom");
    const rooms = [mkRoom("Ghost", 5)];
    const issues: string[] = [];
    dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(issues[0]).toMatch(/< 16 sqft threshold/);
    expect(issues[0]).not.toMatch(/< 12 sqft threshold/);
  });
});
