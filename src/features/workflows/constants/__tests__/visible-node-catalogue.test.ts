/**
 * VISIBLE_NODE_CATALOGUE invariants.
 *
 *  • Deprecated v2 IFC-pipeline nodes (TR-022, TR-024, EX-006) MUST NOT
 *    appear in the picker subset — they were retired 2026-05-17 and
 *    would lead users back to the broken millimetre-scale path.
 *  • GN-013 (the v3 replacement) MUST appear.
 *  • NODE_CATALOGUE (the full registry) MUST still contain the
 *    deprecated entries — old workflows in the DB reference them by id
 *    and need a valid catalogue lookup on load.
 *  • The picker subset is strictly smaller than the full catalogue.
 */

import { describe, expect, it } from "vitest";

import {
  NODE_CATALOGUE,
  NODE_CATALOGUE_MAP,
  VISIBLE_NODE_CATALOGUE,
} from "../node-catalogue";

const DEPRECATED_V2_IDS = ["TR-022", "TR-024", "EX-006"];

describe("VISIBLE_NODE_CATALOGUE", () => {
  it("excludes every deprecated v2 IFC pipeline node", () => {
    const visibleIds = new Set(VISIBLE_NODE_CATALOGUE.map((n) => n.id));
    for (const id of DEPRECATED_V2_IDS) {
      expect(visibleIds.has(id)).toBe(false);
    }
  });

  it("includes GN-013 (the v3 replacement) in the picker subset", () => {
    const visibleIds = new Set(VISIBLE_NODE_CATALOGUE.map((n) => n.id));
    expect(visibleIds.has("GN-013")).toBe(true);
  });

  it("keeps deprecated entries in the full NODE_CATALOGUE for DB loads", () => {
    for (const id of DEPRECATED_V2_IDS) {
      expect(NODE_CATALOGUE_MAP.get(id)).toBeDefined();
      expect(NODE_CATALOGUE_MAP.get(id)?.deprecated).toBe(true);
      expect(NODE_CATALOGUE_MAP.get(id)?.hiddenFromPicker).toBe(true);
      expect(NODE_CATALOGUE_MAP.get(id)?.replacedBy).toBe("GN-013");
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
