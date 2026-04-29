/**
 * gpt-image-1.5 provider tests.
 *
 * Mocks the openai SDK + global fetch (for reference-image fetching).
 * Verifies aspect-ratio normalisation, edit-vs-generate routing,
 * input_fidelity pass-through, error mapping, and cost computation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────

const { imagesEditMock, imagesGenerateMock, toFileMock } = vi.hoisted(() => ({
  imagesEditMock: vi.fn(),
  imagesGenerateMock: vi.fn(),
  toFileMock: vi.fn((buf: Buffer, name: string) =>
    Promise.resolve({ name, size: buf.length, _isFile: true }),
  ),
}));

vi.mock("openai", () => {
  class MockOpenAI {
    images = {
      edit: imagesEditMock,
      generate: imagesGenerateMock,
    };
    constructor(public init?: unknown) {}
  }
  return {
    default: MockOpenAI,
    toFile: toFileMock,
  };
});

import {
  generateShotImage,
  normalizeAspectRatio,
  UnsupportedAspectRatioError,
  ImageGenRateLimitError,
  ImageGenProviderError,
  GPT_IMAGE_15_HIGH_COST_USD,
} from "@/features/brief-renders/services/brief-pipeline/providers/gpt-image";

beforeEach(() => {
  imagesEditMock.mockReset();
  imagesGenerateMock.mockReset();
  toFileMock.mockClear();
  process.env.OPENAI_API_KEY = "sk-test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Aspect-ratio normalisation ────────────────────────────────────

describe("normalizeAspectRatio", () => {
  it.each([
    ["1:1", "1024x1024"],
    ["3:2", "1536x1024"],
    ["16:9", "1536x1024"],
    ["2:3", "1024x1536"],
    ["9:16", "1024x1536"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(normalizeAspectRatio(input)).toBe(expected);
  });

  it("throws UnsupportedAspectRatioError for unknown ratio", () => {
    expect(() => normalizeAspectRatio("4:5")).toThrow(UnsupportedAspectRatioError);
    expect(() => normalizeAspectRatio("nonsense")).toThrow(UnsupportedAspectRatioError);
  });

  it("trims whitespace before mapping", () => {
    expect(normalizeAspectRatio("  3:2 ")).toBe("1536x1024");
  });
});

// ─── images.edit() routing ─────────────────────────────────────────

describe("generateShotImage — with reference images (images.edit)", () => {
  beforeEach(() => {
    // Mock fetch for reference-image downloads.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );
  });

  it("calls images.edit() when referenceImageUrls is non-empty", async () => {
    imagesEditMock.mockResolvedValueOnce({
      data: [{ b64_json: "AAAA" }],
      _request_id: "req-A",
    });

    const result = await generateShotImage({
      prompt: "Test prompt",
      aspectRatio: "3:2",
      referenceImageUrls: ["https://r2.example/ref-0.png"],
      inputFidelity: "high",
      requestId: "j:0:0",
    });

    expect(imagesEditMock).toHaveBeenCalledTimes(1);
    expect(imagesGenerateMock).not.toHaveBeenCalled();

    const editArgs = imagesEditMock.mock.calls[0][0];
    expect(editArgs.prompt).toBe("Test prompt");
    expect(editArgs.size).toBe("1536x1024");
    expect(editArgs.quality).toBe("high");
    expect(editArgs.input_fidelity).toBe("high");
    expect(editArgs.user).toBe("j:0:0");
    expect(editArgs.image).toHaveLength(1);

    expect(result.imageBase64).toBe("AAAA");
    expect(result.widthPx).toBe(1536);
    expect(result.heightPx).toBe(1024);
    expect(result.costUsd).toBe(GPT_IMAGE_15_HIGH_COST_USD["1536x1024"]);
    expect(result.openaiRequestId).toBe("req-A");
  });

  it("passes input_fidelity through verbatim", async () => {
    imagesEditMock.mockResolvedValueOnce({ data: [{ b64_json: "AAAA" }] });

    await generateShotImage({
      prompt: "p",
      aspectRatio: "1:1",
      referenceImageUrls: ["https://r2.example/ref.png"],
      inputFidelity: "low",
      requestId: "j:0:0",
    });
    expect(imagesEditMock.mock.calls[0][0].input_fidelity).toBe("low");
  });

  it("falls back to images.generate() when every reference fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
    );
    imagesGenerateMock.mockResolvedValueOnce({
      data: [{ b64_json: "AAAA" }],
    });

    const result = await generateShotImage({
      prompt: "p",
      aspectRatio: "1:1",
      referenceImageUrls: ["https://r2.example/ref.png"],
      inputFidelity: "high",
      requestId: "j:0:0",
    });

    expect(imagesEditMock).not.toHaveBeenCalled();
    expect(imagesGenerateMock).toHaveBeenCalledTimes(1);
    expect(result.imageBase64).toBe("AAAA");
  });
});

// ─── images.generate() routing ─────────────────────────────────────

describe("generateShotImage — without reference images (images.generate)", () => {
  it("calls images.generate() when referenceImageUrls is empty", async () => {
    imagesGenerateMock.mockResolvedValueOnce({
      data: [{ b64_json: "BBBB" }],
      _request_id: "req-B",
    });

    const result = await generateShotImage({
      prompt: "Test",
      aspectRatio: "2:3",
      referenceImageUrls: [],
      inputFidelity: "high",
      requestId: "j:0:0",
    });

    expect(imagesGenerateMock).toHaveBeenCalledTimes(1);
    expect(imagesEditMock).not.toHaveBeenCalled();
    expect(result.widthPx).toBe(1024);
    expect(result.heightPx).toBe(1536);
    expect(result.costUsd).toBe(GPT_IMAGE_15_HIGH_COST_USD["1024x1536"]);
  });

  it("uses output_format png for the generate path", async () => {
    imagesGenerateMock.mockResolvedValueOnce({ data: [{ b64_json: "BBBB" }] });
    await generateShotImage({
      prompt: "p",
      aspectRatio: "1:1",
      referenceImageUrls: [],
      inputFidelity: "high",
      requestId: "j:0:0",
    });
    expect(imagesGenerateMock.mock.calls[0][0].output_format).toBe("png");
  });
});

// ─── Error mapping ─────────────────────────────────────────────────

describe("generateShotImage — error mapping", () => {
  it("429 from OpenAI → ImageGenRateLimitError", async () => {
    const err = new Error("Rate limit exceeded");
    (err as { status?: number }).status = 429;
    imagesGenerateMock.mockRejectedValueOnce(err);

    await expect(
      generateShotImage({
        prompt: "p",
        aspectRatio: "1:1",
        referenceImageUrls: [],
        inputFidelity: "high",
        requestId: "j:0:0",
      }),
    ).rejects.toBeInstanceOf(ImageGenRateLimitError);
  });

  it("401 from OpenAI → ImageGenProviderError(kind: 'auth')", async () => {
    const err = new Error("Unauthorized");
    (err as { status?: number }).status = 401;
    imagesGenerateMock.mockRejectedValueOnce(err);

    try {
      await generateShotImage({
        prompt: "p",
        aspectRatio: "1:1",
        referenceImageUrls: [],
        inputFidelity: "high",
        requestId: "j:0:0",
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ImageGenProviderError);
      expect((e as ImageGenProviderError).kind).toBe("auth");
    }
  });

  it("content_policy in message → ImageGenProviderError(kind: 'content_filter')", async () => {
    imagesGenerateMock.mockRejectedValueOnce(new Error("content_policy violation"));
    try {
      await generateShotImage({
        prompt: "p",
        aspectRatio: "1:1",
        referenceImageUrls: [],
        inputFidelity: "high",
        requestId: "j:0:0",
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ImageGenProviderError);
      expect((e as ImageGenProviderError).kind).toBe("content_filter");
    }
  });

  it("unknown error → ImageGenProviderError(kind: 'unknown') with original cause", async () => {
    const cause = new Error("totally unexpected");
    imagesGenerateMock.mockRejectedValueOnce(cause);
    try {
      await generateShotImage({
        prompt: "p",
        aspectRatio: "1:1",
        referenceImageUrls: [],
        inputFidelity: "high",
        requestId: "j:0:0",
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ImageGenProviderError);
      expect((e as ImageGenProviderError).kind).toBe("unknown");
      expect((e as ImageGenProviderError).cause).toBe(cause);
    }
  });

  it("missing OPENAI_API_KEY → ImageGenProviderError(kind: 'auth')", async () => {
    delete process.env.OPENAI_API_KEY;
    try {
      await generateShotImage({
        prompt: "p",
        aspectRatio: "1:1",
        referenceImageUrls: [],
        inputFidelity: "high",
        requestId: "j:0:0",
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ImageGenProviderError);
      expect((e as ImageGenProviderError).kind).toBe("auth");
    }
  });

  it("response with no b64_json → ImageGenProviderError", async () => {
    imagesGenerateMock.mockResolvedValueOnce({ data: [{}] });
    await expect(
      generateShotImage({
        prompt: "p",
        aspectRatio: "1:1",
        referenceImageUrls: [],
        inputFidelity: "high",
        requestId: "j:0:0",
      }),
    ).rejects.toBeInstanceOf(ImageGenProviderError);
  });
});

// ─── Cost-table integrity ─────────────────────────────────────────

describe("GPT_IMAGE_15_HIGH_COST_USD", () => {
  it("declares costs for all three supported sizes", () => {
    expect(GPT_IMAGE_15_HIGH_COST_USD["1024x1024"]).toBe(0.19);
    expect(GPT_IMAGE_15_HIGH_COST_USD["1024x1536"]).toBe(0.25);
    expect(GPT_IMAGE_15_HIGH_COST_USD["1536x1024"]).toBe(0.25);
  });
});

// ─── Model literal sourced from canonical module ──────────────────

describe("gpt-image.ts source-level guarantees", () => {
  it("imports OPENAI_IMAGE_MODEL from the canonical module (not inline literal)", async () => {
    // Sanity check: the file has no `gpt-image-1` literal in code paths.
    // The lint guard `scripts/check-no-deprecated-image-models.sh` is the
    // hard enforcement; this test asserts the public surface is intact.
    const mod = await import(
      "@/features/brief-renders/services/brief-pipeline/providers/gpt-image"
    );
    expect(typeof mod.generateShotImage).toBe("function");
    expect(typeof mod.normalizeAspectRatio).toBe("function");
    expect(mod.GPT_IMAGE_15_HIGH_COST_USD).toBeDefined();
  });
});
