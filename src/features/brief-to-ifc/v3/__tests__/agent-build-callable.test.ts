/**
 * runAgentBuild callable tests (Phase Beta 3 Section 1).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunAgentBuildOptions } from "../agent-build";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeCompletedResponse(overrides?: Record<string, unknown>) {
  return {
    id: "run-123",
    status: "COMPLETED",
    ifcUrl: "https://r2.example/test.ifc",
    entityCount: 2000,
    turns: 12,
    generatorCostUsd: 0.15,
    generatorMs: 45000,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("runAgentBuild", () => {
  it("returns RunAgentBuildResult on successful run", async () => {
    // Mock: POST /runs succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ runId: "run-123", status: "PENDING", statusUrl: "/status" }),
    });
    // Mock: GET /status returns COMPLETED
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeCompletedResponse()),
    });

    const { runAgentBuild } = await import("../agent-build");
    const result = await runAgentBuild(
      { project: { name: "T", type: "office", location: "X", description: "X" }, site: { bounds_m: [10,8], height_limit_m: 4, coordinate_origin: "sw_corner" }, spaces: [], elements: [], materials: [{ id: "m1", name: "X", rgb: [0.5,0.5,0.5], roughness: 0.5, method: "MATT", category: "X" }], brand_language: { primary_text: "X", approved_terms: [], forbidden_terms: [] } },
      { origin: "https://test.example", cookie: "test-cookie", pollTimeoutMs: 1000 },
    );

    expect(result.ifcUrl).toBe("https://r2.example/test.ifc");
    expect(result.runId).toBe("run-123");
    expect(result.entityCount).toBe(2000);
    expect(result.turns).toBe(12);
    expect(result.costUsd).toBe(0.15);
    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it("includes RETRY CONTEXT info when iteration > 1", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ runId: "run-456", status: "PENDING", statusUrl: "/status" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeCompletedResponse({ id: "run-456" })),
    });

    const { runAgentBuild } = await import("../agent-build");
    const result = await runAgentBuild(
      { project: { name: "T", type: "office", location: "X", description: "X" }, site: { bounds_m: [10,8], height_limit_m: 4, coordinate_origin: "sw_corner" }, spaces: [], elements: [], materials: [{ id: "m1", name: "X", rgb: [0.5,0.5,0.5], roughness: 0.5, method: "MATT", category: "X" }], brand_language: { primary_text: "X", approved_terms: [], forbidden_terms: [] } },
      {
        iteration: 2,
        previousAttemptUrl: "https://r2.example/prev.ifc",
        previousMismatches: [
          { type: "missing_parts", item_id: "FURN-DESK", severity: "high", expected: 5, actual: 1, description: "Collapsed" },
        ],
        origin: "https://test.example",
        cookie: "test-cookie",
        pollTimeoutMs: 1000,
      },
    );

    expect(result.retryContext).toContain("Iteration 2");
    expect(result.retryContext).toContain("FURN-DESK");
  });

  it("throws when agent run fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ runId: "run-err", status: "PENDING", statusUrl: "/status" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: "run-err", status: "FAILED", ifcUrl: null, entityCount: null,
        errorCode: "AGENT_ERROR", errorMessage: "Out of turns",
        generatorCostUsd: 0.10, generatorMs: 30000, turns: 50,
      }),
    });

    const { runAgentBuild } = await import("../agent-build");
    await expect(
      runAgentBuild(
        { project: { name: "T", type: "office", location: "X", description: "X" }, site: { bounds_m: [10,8], height_limit_m: 4, coordinate_origin: "sw_corner" }, spaces: [], elements: [], materials: [{ id: "m1", name: "X", rgb: [0.5,0.5,0.5], roughness: 0.5, method: "MATT", category: "X" }], brand_language: { primary_text: "X", approved_terms: [], forbidden_terms: [] } },
        { origin: "https://test.example", cookie: "test-cookie", pollTimeoutMs: 1000 },
      ),
    ).rejects.toThrow(/FAILED/);
  });

  it("maxTurns is forwarded to the runs endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ runId: "run-mt", status: "PENDING", statusUrl: "/status" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeCompletedResponse({ id: "run-mt" })),
    });

    const { runAgentBuild } = await import("../agent-build");
    await runAgentBuild(
      { project: { name: "T", type: "office", location: "X", description: "X" }, site: { bounds_m: [10,8], height_limit_m: 4, coordinate_origin: "sw_corner" }, spaces: [], elements: [], materials: [{ id: "m1", name: "X", rgb: [0.5,0.5,0.5], roughness: 0.5, method: "MATT", category: "X" }], brand_language: { primary_text: "X", approved_terms: [], forbidden_terms: [] } },
      { origin: "https://test.example", cookie: "test-cookie", maxTurns: 30, pollTimeoutMs: 1000 },
    );

    // Check that the POST body included max_turns
    const postCall = mockFetch.mock.calls[0];
    const body = JSON.parse(postCall[1].body);
    expect(body.max_turns).toBe(30);
  });
});
