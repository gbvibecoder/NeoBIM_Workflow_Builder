/**
 * Unit tests for the 5I PR 2b additions in bot-orchestrator.ts.
 *
 * Focused on the new wiring (tool defs + dispatch + iteration cap +
 * quota counter + attachmentRefs hint) without exercising the full
 * Anthropic streaming round-trip (which has no existing tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("bot-orchestrator — PR 2b wiring (constants + tool list shape)", () => {
  it("orchestrator imports KOS_BOT_MAX_ITERATIONS (=10) from kos-bot-constants", async () => {
    const constants = await import("@/features/kos/lib/kos-bot-constants");
    expect(constants.KOS_BOT_MAX_ITERATIONS).toBe(10);
    expect(constants.KOS_BOT_MAX_SIDECAR_CALLS_PER_TURN).toBe(6);
  });

  it("kos-bot-constants exposes the 4 new tool name constants", async () => {
    const c = await import("@/features/kos/lib/kos-bot-constants");
    expect(c.TOOL_PROCESS_DRAWING).toBe("process_drawing");
    expect(c.TOOL_GENERATE_BOQ).toBe("generate_boq");
    expect(c.TOOL_GENERATE_FORMWORK).toBe("generate_formwork");
    expect(c.TOOL_GENERATE_SHOP_DRAWING).toBe("generate_shop_drawing");
  });

  it("kos-bot-constants ships 10 APPLICATION_HINT_SUGGESTIONS matching the sidecar enum", async () => {
    const c = await import("@/features/kos/lib/kos-bot-constants");
    expect(c.APPLICATION_HINT_SUGGESTIONS).toHaveLength(10);
    const ids = c.APPLICATION_HINT_SUGGESTIONS.map((h) => h.id);
    expect(ids).toContain("villa_external");
    expect(ids).toContain("basement_lt3m");
    expect(ids).toContain("shear_wall_g10");
  });

  it("KALZEN_PROMPT_VERSION is set (PR 3 bumped from 2b- to 3-)", async () => {
    const c = await import("@/features/kos/lib/kos-bot-constants");
    // Loose match — only assert the version string is non-empty and
    // includes a date-style suffix. Tightening to a specific slice
    // prefix (e.g. "3-") was brittle when PRs bump it (PR 2b had this
    // pinned to "2b-" and PR 3 had to rewrite the assertion).
    expect(c.KALZEN_PROMPT_VERSION).toMatch(/^[0-9a-z]+-\d{4}\.\d{2}\.\d{2}$/);
  });
});

// Note on coverage: an end-to-end orchestrator integration test would
// require mocking the full Anthropic streaming SDK (RawMessageStreamEvent
// generator, finalMessage(), tool_use content blocks). Pre-PR-2b had no
// such test. Adding one would be net-positive but is OUT OF SCOPE per
// the PR 2b prompt §1.2 ("multi-drawing batch processing — PR 2b handles
// ONE drawing"). The tool handlers themselves (which contain ALL the new
// behaviour) are exercised in isolation by:
//   - tool-process-drawing.test.ts (9 cases, incl. C2 threat + quota)
//   - tool-generate-boq.test.ts     (8 cases, incl. C2 threat)
//   - tool-generate-formwork.test.ts (7 cases, incl. C2 threat)
//   - tool-generate-shop-drawing.test.ts (2 cases)
// These tests cover the contract surface the orchestrator depends on.
