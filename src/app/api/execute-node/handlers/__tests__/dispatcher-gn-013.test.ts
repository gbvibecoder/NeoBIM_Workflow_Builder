/**
 * Dispatcher routing regression: GN-013 (AI IFC Generator) must be
 * present in the `nodeHandlers` registry so the execute-node dispatcher
 * can hand off to the v3 handler.
 *
 * If this test fails, the canvas node will return NODE_NOT_IMPLEMENTED
 * when run. See PHASE_V3_SHIPPED_2026-05-17.md for the one-line
 * REAL_NODE_IDS addition in `route.ts` that pairs with this registry
 * entry.
 */

import { describe, expect, it } from "vitest";

import { nodeHandlers } from "../index";

describe("execute-node dispatcher routing", () => {
  it("registers GN-013 (AI IFC Generator) in nodeHandlers", () => {
    expect(nodeHandlers).toHaveProperty("GN-013");
    expect(typeof nodeHandlers["GN-013"]).toBe("function");
  });
});
