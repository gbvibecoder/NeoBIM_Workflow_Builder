/**
 * TR-026 (IFC Agent Builder) handler tests.
 *
 * Mocks `next/headers`, `setTimeout` (so polling completes instantly),
 * and `fetch`. Asserts:
 *   • Submits to POST /api/brief-to-ifc/v3/runs with briefSpec.
 *   • Polls /status until COMPLETED.
 *   • Surfaces ifcUrl + runId + KPIs on the artifact.
 *   • Throws when briefSpec is missing.
 *   • Throws when run ends with FAILED status.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () =>
    new Headers({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "trybuildflow.in",
      cookie: "__Secure-authjs.session-token=test-cookie",
    }),
  ),
}));

import { handleTR026 } from "../tr-026";
import type { NodeHandlerContext } from "../types";

const baseCtx: Omit<NodeHandlerContext, "inputData"> = {
  catalogueId: "TR-026",
  executionId: "exe-1",
  tileInstanceId: "tile-1",
  userId: "user-1",
  userRole: "PRO",
  userEmail: "user@buildflow.dev",
  isAdmin: false,
  apiKey: undefined,
  dbExecutionId: undefined,
};

const BRIEF_SPEC = {
  project: { name: "x", type: "exhibition_booth" },
  spaces: [],
  elements: [],
  materials: [],
};

function mockResponses(...rs: Array<() => Response>) {
  const fn = vi.fn();
  for (const r of rs) fn.mockImplementationOnce(async () => r());
  return fn;
}

describe("TR-026 handler — IFC Agent Builder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Make every setTimeout fire on next microtask so polling completes
    // instantly. The handler awaits delays of 3 s+; the test must not.
    vi.stubGlobal(
      "setTimeout",
      ((cb: () => void) => {
        cb();
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout,
    );
  });

  it("kicks off /runs then polls /status until COMPLETED and surfaces ifcUrl", async () => {
    const fetchMock = mockResponses(
      () =>
        new Response(
          JSON.stringify({
            runId: "run-abc",
            status: "PENDING",
            statusUrl: "/api/brief-to-ifc/v3/runs/run-abc/status",
          }),
          { status: 202 },
        ),
      () =>
        new Response(
          JSON.stringify({
            id: "run-abc",
            status: "RUNNING",
            ifcUrl: null,
            entityCount: null,
            errorCode: null,
            errorMessage: null,
            generatorCostUsd: 0.05,
            generatorMs: 5_000,
            turns: 2,
          }),
          { status: 200 },
        ),
      () =>
        new Response(
          JSON.stringify({
            id: "run-abc",
            status: "COMPLETED",
            ifcUrl: "https://r2.example/sol.ifc",
            entityCount: 754,
            errorCode: null,
            errorMessage: null,
            generatorCostUsd: 0.196,
            generatorMs: 44_000,
            turns: 10,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleTR026({
      ...baseCtx,
      inputData: { briefSpec: BRIEF_SPEC, cost_cap_usd: 3 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [createUrl, createInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(createUrl).toBe("https://trybuildflow.in/api/brief-to-ifc/v3/runs");
    expect(createInit?.method).toBe("POST");
    const body = JSON.parse(String(createInit?.body));
    expect(body.briefSpec).toEqual(BRIEF_SPEC);
    expect(body.cost_cap_usd).toBe(3);

    // The /runs endpoint uses a zod `.strict()` schema — any unknown
    // key (e.g. analytics-style `source: "canvas"`) would 400 before
    // the agent starts. Lock in the allow-list of permitted keys so a
    // future "let's tag every request with metadata" patch can't
    // silently re-break prod canvas runs the way the original ship did.
    const ALLOWED_KEYS = new Set([
      "brief",
      "briefSpec",
      "project_type",
      "max_turns",
      "cost_cap_usd",
      "workflow_id",
      // Phase gamma.1: Direct Agent Mode fields
      "brief_text",
      "suggestions",
      "previous_feedback",
      "iteration",
    ]);
    for (const key of Object.keys(body)) {
      expect(ALLOWED_KEYS.has(key), `unexpected key "${key}" in /runs body`).toBe(true);
    }

    if (!("type" in result) || !("data" in result)) {
      throw new Error("expected an ExecutionArtifact, got a NextResponse");
    }
    const artifact = result as {
      type: string;
      dataUri?: string;
      data: Record<string, unknown>;
    };
    expect(artifact.type).toBe("file");
    expect(artifact.dataUri).toBe("https://r2.example/sol.ifc");
    expect(artifact.data.runId).toBe("run-abc");
    expect(artifact.data.entityCount).toBe(754);
    expect(artifact.data.turns).toBe(10);
    expect(artifact.data.generatorCostUsd).toBe(0.196);
  });

  it("throws when briefSpec is missing", async () => {
    await expect(
      handleTR026({ ...baseCtx, inputData: {} }),
    ).rejects.toThrow(/requires a `briefSpec`/);
  });

  it("throws when the run ends with FAILED status", async () => {
    const fetchMock = mockResponses(
      () =>
        new Response(
          JSON.stringify({
            runId: "run-fail",
            status: "PENDING",
            statusUrl: "/api/brief-to-ifc/v3/runs/run-fail/status",
          }),
          { status: 202 },
        ),
      () =>
        new Response(
          JSON.stringify({
            id: "run-fail",
            status: "FAILED",
            ifcUrl: null,
            entityCount: 0,
            errorCode: "VISUAL_GEOMETRY_INVALID",
            errorMessage: "world bbox 0.005x0.005m",
            generatorCostUsd: 0.05,
            generatorMs: 5_000,
            turns: 3,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      handleTR026({
        ...baseCtx,
        inputData: { briefSpec: BRIEF_SPEC },
      }),
    ).rejects.toThrow(/FAILED|VISUAL_GEOMETRY_INVALID/);
  });
});
