/**
 * VISIBLE_NODE_CATALOGUE invariants.
 *
 *  • Deprecated v2 IFC-pipeline nodes (TR-022, TR-024, EX-006) MUST NOT
 *    appear in the picker subset — they were retired 2026-05-17 and
 *    would lead users back to the broken millimetre-scale path.
 *  • The v3 4-node canvas chain (TR-025/26/27, EX-007) MUST appear.
 *  • IN-009 (Brief input) MUST appear.
 *  • GN-013 (the old mega-node) MUST NOT appear — deleted entirely
 *    in the Canvas Unification phase (2026-05-17).
 *  • NODE_CATALOGUE (the full registry) MUST still contain the
 *    deprecated v2 entries — old workflows in the DB reference them
 *    by id and need a valid catalogue lookup on load.
 *  • The picker subset is strictly smaller than the full catalogue.
 */

import { describe, expect, it } from "vitest";

import {
  NODE_CATALOGUE,
  NODE_CATALOGUE_MAP,
  VISIBLE_NODE_CATALOGUE,
} from "../node-catalogue";

const DEPRECATED_V2_IDS = ["TR-022", "TR-024", "EX-006"];
const V3_VISIBLE_IDS = ["TR-025", "TR-026", "TR-027", "EX-007", "IN-009"];

describe("VISIBLE_NODE_CATALOGUE", () => {
  it("excludes every deprecated v2 IFC pipeline node", () => {
    const visibleIds = new Set(VISIBLE_NODE_CATALOGUE.map((n) => n.id));
    for (const id of DEPRECATED_V2_IDS) {
      expect(visibleIds.has(id)).toBe(false);
    }
  });

  it("includes all 4 v3 canvas-unification nodes + IN-009 in the picker subset", () => {
    const visibleIds = new Set(VISIBLE_NODE_CATALOGUE.map((n) => n.id));
    for (const id of V3_VISIBLE_IDS) {
      expect(visibleIds.has(id)).toBe(true);
    }
  });

  it("no longer includes GN-013 (deleted in Canvas Unification)", () => {
    const visibleIds = new Set(VISIBLE_NODE_CATALOGUE.map((n) => n.id));
    expect(visibleIds.has("GN-013")).toBe(false);
    expect(NODE_CATALOGUE_MAP.get("GN-013")).toBeUndefined();
  });

  it("keeps deprecated v2 entries in the full NODE_CATALOGUE for DB loads", () => {
    for (const id of DEPRECATED_V2_IDS) {
      expect(NODE_CATALOGUE_MAP.get(id)).toBeDefined();
      expect(NODE_CATALOGUE_MAP.get(id)?.deprecated).toBe(true);
      expect(NODE_CATALOGUE_MAP.get(id)?.hiddenFromPicker).toBe(true);
    }
  });

  it("VISIBLE is strictly smaller than NODE_CATALOGUE", () => {
    expect(VISIBLE_NODE_CATALOGUE.length).toBeLessThan(NODE_CATALOGUE.length);
    expect(NODE_CATALOGUE.length - VISIBLE_NODE_CATALOGUE.length).toBe(
      DEPRECATED_V2_IDS.length,
    );
  });

  it("does not accidentally hide IN-002 (PDF Upload — used by many paths, not v2-specific)", () => {
    const visibleIds = new Set(VISIBLE_NODE_CATALOGUE.map((n) => n.id));
    expect(visibleIds.has("IN-002")).toBe(true);
  });
});
