/**
 * TR-027 (Geometric Validator) handler tests.
 *
 * Asserts:
 *   • Calls POST /api/brief-to-ifc/v3/validate with ifcUrl.
 *   • Surfaces verdict + worldBbox + failures on the artifact.
 *   • Throws when ifcUrl is missing.
 *   • Throws when /validate returns 404.
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

import { handleTR027 } from "../tr-027";
import type { NodeHandlerContext } from "../types";

const baseCtx: Omit<NodeHandlerContext, "inputData"> = {
  catalogueId: "TR-027",
  executionId: "exe-1",
  tileInstanceId: "tile-1",
  userId: "user-1",
  userRole: "PRO",
  userEmail: "user@buildflow.dev",
  isAdmin: false,
  apiKey: undefined,
  dbExecutionId: undefined,
};

describe("TR-027 handler — Geometric Validator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /api/brief-to-ifc/v3/validate and returns a verdict artifact", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          runId: "run-ok",
          ifcUrl: "https://r2.example/x.ifc",
          validator: {
            verdict: "OK",
            worldBbox: [15.0, 15.0, 4.5],
            worldBboxVerdict: "OK",
            polygonOk: true,
            originOk: true,
            elementCoverageOk: true,
            lengthUnit: "METRE",
            failures: [],
            entityCount: 754,
            schemaName: "IFC2X3",
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleTR027({
      ...baseCtx,
      inputData: { ifcUrl: "https://r2.example/x.ifc", runId: "run-ok" },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://trybuildflow.in/api/brief-to-ifc/v3/validate");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      ifcUrl: "https://r2.example/x.ifc",
    });

    if (!("type" in result) || !("data" in result)) {
      throw new Error("expected an ExecutionArtifact");
    }
    const artifact = result as { type: string; data: Record<string, unknown> };
    expect(artifact.type).toBe("json");
    expect(artifact.data.verdict).toBe("OK");
    expect(artifact.data.worldBbox).toEqual([15.0, 15.0, 4.5]);
    expect(artifact.data.lengthUnit).toBe("METRE");
    // ifcUrl passthrough — EX-007 downstream needs it.
    expect(artifact.data.ifcUrl).toBe("https://r2.example/x.ifc");
  });

  it("throws when ifcUrl is missing", async () => {
    await expect(
      handleTR027({ ...baseCtx, inputData: {} }),
    ).rejects.toThrow(/requires an `ifcUrl`/);
  });

  it("throws on /validate 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "BRIEF_TO_IFC_V3_RUN_NOT_FOUND", message: "No run for this ifcUrl." },
          }),
          { status: 404 },
        ),
      ),
    );
    await expect(
      handleTR027({
        ...baseCtx,
        inputData: { ifcUrl: "https://r2.example/orphan.ifc" },
      }),
    ).rejects.toThrow(/BRIEF_TO_IFC_V3_RUN_NOT_FOUND|HTTP 404/);
  });
});
