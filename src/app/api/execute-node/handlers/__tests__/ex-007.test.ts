/**
 * EX-007 (IFC Export) handler tests.
 *
 * EX-007 is a pure passthrough of the finalized TR-027 IFC asset; preview
 * rendering lives in TR-032. These tests assert the file-artifact shape +
 * the ifcUrl guard, not any rendering behaviour.
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

import { handleEX007 } from "../ex-007";
import type { NodeHandlerContext } from "../types";

const baseCtx: Omit<NodeHandlerContext, "inputData"> = {
  catalogueId: "EX-007",
  executionId: "exe-1",
  tileInstanceId: "tile-1",
  userId: "user-1",
  userRole: "PRO",
  userEmail: "user@buildflow.dev",
  isAdmin: false,
  apiKey: undefined,
  dbExecutionId: undefined,
};

describe("EX-007 handler — IFC Export (passthrough)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the finalized IFC through as a file artifact with viewer deep link", async () => {
    // EX-007 is a pure passthrough of the TR-027 IFC asset — no preview
    // rendering, no network call. (Preview rendering moved to TR-032.)
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleEX007({
      ...baseCtx,
      inputData: {
        ifcUrl: "https://r2.example/x.ifc",
        runId: "run-ok",
        entityCount: 70,
        verdict: "pass",
        worldBbox: [1, 2, 3],
      },
    });

    // No HTTP call: the asset is already finalized upstream.
    expect(fetchMock).not.toHaveBeenCalled();

    if (!("type" in result) || !("data" in result)) {
      throw new Error("expected an ExecutionArtifact");
    }
    const artifact = result as {
      type: string;
      dataUri?: string;
      data: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };
    // `file` (not `image`) so the result page categorises this as
    // an IFC export and the WorkflowTypeBadge says "IFC Export".
    expect(artifact.type).toBe("file");
    expect(artifact.dataUri).toBe("https://r2.example/x.ifc");
    expect(artifact.data.url).toBe("https://r2.example/x.ifc");
    expect(artifact.data.downloadUrl).toBe("https://r2.example/x.ifc");
    expect(artifact.data.fileName).toMatch(/\.ifc$/);
    expect(artifact.data.type).toBe("application/x-step");
    expect(artifact.data.ifcUrl).toBe("https://r2.example/x.ifc");
    expect(artifact.data.ifcViewerUrl).toBe(
      "/dashboard/ifc-viewer?url=https%3A%2F%2Fr2.example%2Fx.ifc",
    );
    // Upstream metadata (entityCount/verdict/bbox/runId) is passed through
    // verbatim for the result-page hero card.
    expect(artifact.data.runId).toBe("run-ok");
    expect(artifact.data.entityCount).toBe(70);
    expect(artifact.data.verdict).toBe("pass");
    expect(artifact.data.worldBbox).toEqual([1, 2, 3]);
    expect(artifact.metadata.stage).toBe("ifc-export");
    expect(artifact.metadata.mimeType).toBe("application/x-step");
  });

  it("throws when ifcUrl is missing", async () => {
    await expect(
      handleEX007({ ...baseCtx, inputData: {} }),
    ).rejects.toThrow(/requires an `ifcUrl`/);
  });

  it("rejects an implausibly short ifcUrl as missing", async () => {
    // The handler treats a ≤8-char ifcUrl as absent (guards against
    // truncated/garbage upstream values) and throws like the empty case.
    await expect(
      handleEX007({ ...baseCtx, inputData: { ifcUrl: "x.ifc" } }),
    ).rejects.toThrow(/requires an `ifcUrl`/);
  });
});
