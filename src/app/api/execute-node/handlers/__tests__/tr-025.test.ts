/**
 * TR-025 (Brief Enricher) handler tests.
 *
 * Mocks `next/headers` + `fetch`. Asserts:
 *   • Calls POST /api/brief-to-ifc/v3/enrich with the brief text.
 *   • Surfaces the BriefSpec on the artifact's `data.briefSpec`.
 *   • Counts spaces/elements/materials for the canvas KPI.
 *   • Accepts brief / briefText / content / inputValue aliases.
 *   • Rejects briefs shorter than 40 chars.
 *   • Throws on non-2xx /enrich response.
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

import { handleTR025 } from "../tr-025";
import type { NodeHandlerContext } from "../types";

const baseCtx: Omit<NodeHandlerContext, "inputData"> = {
  catalogueId: "TR-025",
  executionId: "exe-1",
  tileInstanceId: "tile-1",
  userId: "user-1",
  userRole: "PRO",
  userEmail: "user@buildflow.dev",
  isAdmin: false,
  apiKey: undefined,
  dbExecutionId: undefined,
};

const SAMPLE_BRIEF = "SOL Properties booth, 15 by 15 m exhibition stand with three model displays, coffee counter centre, reception in corner.";

const SAMPLE_SPEC = {
  project: { name: "SOL booth", type: "exhibition_booth" },
  site: { bounds_m: [15, 15], height_limit_m: 4.5 },
  spaces: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
  elements: Array.from({ length: 12 }, (_, i) => ({ id: `e${i}` })),
  materials: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
};

describe("TR-025 handler — Brief Enricher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /api/brief-to-ifc/v3/enrich and returns a json artifact with KPIs", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          brief: SAMPLE_SPEC,
          costUsd: 0.045,
          durationMs: 18_000,
          inputTokens: 1200,
          outputTokens: 800,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleTR025({
      ...baseCtx,
      inputData: { briefText: SAMPLE_BRIEF },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://trybuildflow.in/api/brief-to-ifc/v3/enrich");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      brief: expect.stringContaining("SOL Properties booth"),
    });

    if (!("type" in result) || !("data" in result)) {
      throw new Error("expected an ExecutionArtifact, got a NextResponse");
    }
    const artifact = result as { type: string; data: Record<string, unknown> };
    expect(artifact.type).toBe("json");
    expect(artifact.data.briefSpec).toEqual(SAMPLE_SPEC);
    expect(artifact.data.spaceCount).toBe(3);
    expect(artifact.data.elementCount).toBe(12);
    expect(artifact.data.materialCount).toBe(3);
    expect(artifact.data.enrichmentCostUsd).toBe(0.045);
  });

  it("accepts `brief` and `content` and `inputValue` as aliases", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          brief: SAMPLE_SPEC,
          costUsd: 0.01,
          durationMs: 1_000,
          inputTokens: 100,
          outputTokens: 100,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    for (const key of ["brief", "content", "inputValue"] as const) {
      fetchMock.mockClear();
      await handleTR025({
        ...baseCtx,
        inputData: { [key]: SAMPLE_BRIEF },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects briefs shorter than 40 chars", async () => {
    await expect(
      handleTR025({ ...baseCtx, inputData: { briefText: "Too short brief." } }),
    ).rejects.toThrow(/at least 40 characters/);
  });

  it("throws on non-2xx /enrich response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "ENRICHMENT_FAILED", message: "Anthropic rate limit" },
          }),
          { status: 500 },
        ),
      ),
    );
    await expect(
      handleTR025({
        ...baseCtx,
        inputData: { briefText: SAMPLE_BRIEF },
      }),
    ).rejects.toThrow(/Brief enrichment failed/);
  });
});
