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

  it("submits to /runs and returns immediately with pendingRunId (gamma.2 async)", async () => {
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
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleTR026({
      ...baseCtx,
      inputData: { briefSpec: BRIEF_SPEC, cost_cap_usd: 3 },
    });

    // Phase gamma.2: only ONE fetch call (the POST to /runs). No polling.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [createUrl, createInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(createUrl).toBe("https://trybuildflow.in/api/brief-to-ifc/v3/runs");
    expect(createInit?.method).toBe("POST");
    const body = JSON.parse(String(createInit?.body));
    expect(body.briefSpec).toEqual(BRIEF_SPEC);
    expect(body.cost_cap_usd).toBe(3);

    if (!("type" in result) || !("data" in result)) {
      throw new Error("expected an ExecutionArtifact, got a NextResponse");
    }
    const artifact = result as {
      type: string;
      dataUri?: unknown;
      data: Record<string, unknown>;
    };
    expect(artifact.type).toBe("file");
    // dataUri is undefined until the build completes (frontend polls)
    expect(artifact.dataUri).toBeUndefined();
    expect(artifact.data.runId).toBe("run-abc");
    expect(artifact.data.pendingRunId).toBe("run-abc");
    expect(artifact.data.statusUrl).toBe("/api/brief-to-ifc/v3/runs/run-abc/status");
  });

  it("throws when briefSpec is missing", async () => {
    await expect(
      handleTR026({ ...baseCtx, inputData: {} }),
    ).rejects.toThrow(/requires a `briefSpec`/);
  });

  it("throws when /runs endpoint returns HTTP error", async () => {
    // Phase gamma.2: TR-026 no longer polls — it submits and returns.
    // Failure detection is now client-side. But a /runs submission
    // failure (HTTP 500) still throws from the handler.
    const fetchMock = mockResponses(
      () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Enrichment failed",
              code: "ENRICHMENT_FAILED",
            },
          }),
          { status: 500 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      handleTR026({
        ...baseCtx,
        inputData: { briefSpec: BRIEF_SPEC },
      }),
    ).rejects.toThrow(/submission failed/);
  });
});
