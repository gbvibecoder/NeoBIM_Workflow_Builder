/**
 * EX-007 (IFC Export + Preview) handler tests.
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

describe("EX-007 handler — IFC Export + Preview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders previews and returns top + iso image URLs + viewer deep link", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          runId: "run-ok",
          ifcUrl: "https://r2.example/x.ifc",
          topPngUrl: "https://r2.example/top.png",
          isoPngUrl: "https://r2.example/iso.png",
          meshCount: 70,
          durationMs: 8_400,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleEX007({
      ...baseCtx,
      inputData: { ifcUrl: "https://r2.example/x.ifc", runId: "run-ok" },
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://trybuildflow.in/api/brief-to-ifc/v3/render-previews");

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
    expect(artifact.data.topPngUrl).toBe("https://r2.example/top.png");
    expect(artifact.data.isoPngUrl).toBe("https://r2.example/iso.png");
    const images = artifact.data.images as Array<{ label: string; url: string }>;
    expect(images).toHaveLength(2);
    expect(images[0].label).toBe("Top view");
    expect(images[1].label).toBe("Isometric view");
    expect(artifact.metadata.mimeType).toBe("application/x-step");
  });

  it("throws when ifcUrl is missing", async () => {
    await expect(
      handleEX007({ ...baseCtx, inputData: {} }),
    ).rejects.toThrow(/requires an `ifcUrl`/);
  });

  it("throws on render-previews error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "PREVIEW_RENDER_EMPTY", message: "no_meshes" },
          }),
          { status: 502 },
        ),
      ),
    );
    await expect(
      handleEX007({
        ...baseCtx,
        inputData: { ifcUrl: "https://r2.example/empty.ifc" },
      }),
    ).rejects.toThrow(/Preview rendering failed/);
  });
});
