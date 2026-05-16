/**
 * Smoke test for the GN-013 (AI IFC Generator) canvas handler.
 *
 * Mocks `next/headers` + `fetch` so the handler's only side effect is the
 * single HTTP self-call to `/api/brief-to-ifc/v3/generate`. Asserts:
 *   • Reads brief / briefSpec / content input shapes correctly
 *   • Forwards the session cookie
 *   • Surfaces the IFC URL on the artifact's dataUri and the entityCount
 *     on metadata
 *   • Throws when neither brief nor briefSpec is supplied
 *   • Throws when /generate returns ok=false
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

import { handleGN013 } from "../gn-013-ai-ifc";

import type { NodeHandlerContext } from "../types";

const baseCtx: Omit<NodeHandlerContext, "inputData"> = {
  catalogueId: "GN-013",
  executionId: "exe-1",
  tileInstanceId: "tile-1",
  userId: "user-1",
  userRole: "PRO",
  userEmail: "user@buildflow.dev",
  isAdmin: false,
  apiKey: undefined,
  dbExecutionId: undefined,
};

describe("GN-013 handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /api/brief-to-ifc/v3/generate with brief and returns a file artifact", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          ifcUrl: "https://r2.example/test.ifc",
          entityCount: 442,
          costUsd: 0.127,
          durationMs: 44_000,
          turns: 9,
          finalValidation: { world_bbox: { verdict: "OK" } },
          error: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleGN013({
      ...baseCtx,
      inputData: {
        brief: "Small open-plan office 5 by 5 m, 4 hot desks, a coffee bar in the corner.",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://trybuildflow.in/api/brief-to-ifc/v3/generate");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.cookie).toContain("test-cookie");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      brief: expect.stringContaining("open-plan office"),
    });

    // Result is ExecutionArtifact | NextResponse; narrow to artifact.
    if (!("type" in result) || !("metadata" in result)) {
      throw new Error("expected an ExecutionArtifact, got a NextResponse");
    }
    const artifact = result as {
      type: string;
      dataUri?: string;
      metadata: Record<string, unknown>;
    };
    expect(artifact.type).toBe("file");
    expect(artifact.dataUri).toBe("https://r2.example/test.ifc");
    expect(artifact.metadata.entityCount).toBe(442);
    expect(artifact.metadata.costUsd).toBe(0.127);
  });

  it("accepts `content` from upstream nodes as a brief alias", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          ifcUrl: "https://r2.example/x.ifc",
          entityCount: 100,
          costUsd: 0.2,
          durationMs: 30_000,
          turns: 5,
          finalValidation: null,
          error: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await handleGN013({
      ...baseCtx,
      inputData: {
        content: "Generate a 4 by 5 meter bedroom with a queen bed and two bedside tables.",
      },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      brief: expect.stringContaining("bedroom"),
    });
  });

  it("forwards briefSpec when provided", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          ifcUrl: "https://r2.example/y.ifc",
          entityCount: 50,
          costUsd: 0.15,
          durationMs: 20_000,
          turns: 4,
          finalValidation: null,
          error: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const briefSpec = { project: { name: "test" }, site: {} };
    await handleGN013({
      ...baseCtx,
      inputData: { briefSpec },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init?.body))).toEqual({ briefSpec });
  });

  it("throws when input has neither brief nor briefSpec", async () => {
    await expect(
      handleGN013({ ...baseCtx, inputData: {} }),
    ).rejects.toThrow(/needs `brief`|`briefSpec`/);
  });

  it("throws when /generate returns ok=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            ifcUrl: null,
            entityCount: 0,
            costUsd: 0.05,
            durationMs: 5_000,
            turns: 2,
            finalValidation: null,
            error: { code: "VISUAL_GEOMETRY_INVALID", message: "bbox 0.005x0.005m" },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      handleGN013({
        ...baseCtx,
        inputData: {
          brief: "Tiny brief just to fail visual gate testing this string is forty plus chars.",
        },
      }),
    ).rejects.toThrow(/VISUAL_GEOMETRY_INVALID|no IFC URL/);
  });
});
