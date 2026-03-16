import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fal.ai client before importing service
vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    subscribe: vi.fn(),
    queue: {
      submit: vi.fn(),
      status: vi.fn(),
      result: vi.fn(),
    },
  },
}));

import { fal } from "@fal-ai/client";
import { convertImageTo3D, getConcurrencyInfo, clearCache } from "@/services/sam3d-service";

describe("SAM 3D Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    process.env.FAL_KEY = "test-fal-key";
  });

  it("should throw if FAL_KEY is not set", async () => {
    delete process.env.FAL_KEY;
    await expect(convertImageTo3D("https://example.com/building.jpg")).rejects.toThrow("FAL_KEY");
  });

  it("should call fal.subscribe with correct parameters", async () => {
    const mockResponse = {
      requestId: "mock-req-1",
      data: {
        mesh: {
          url: "https://fal.ai/output/model.glb",
          content_type: "model/gltf-binary",
          file_name: "model.glb",
          file_size: 1024,
        },
        gaussian_splat: {
          url: "https://fal.ai/output/model.ply",
          content_type: "application/octet-stream",
          file_name: "model.ply",
          file_size: 2048,
        },
        seed: 42,
        timings: { inference: 5.2 },
      },
    };

    vi.mocked(fal.subscribe).mockResolvedValueOnce(mockResponse);

    const result = await convertImageTo3D("https://example.com/building.jpg", { seed: 42 });

    expect(fal.config).toHaveBeenCalledWith({ credentials: "test-fal-key" });
    expect(fal.subscribe).toHaveBeenCalledWith(
      "fal-ai/sam-3/3d-objects",
      expect.objectContaining({
        input: { image_url: "https://example.com/building.jpg", seed: 42 },
      })
    );

    expect(result.status).toBe("completed");
    expect(result.glbModel).toBeDefined();
    expect(result.glbModel?.downloadUrl).toBe("https://fal.ai/output/model.glb");
    expect(result.glbModel?.format).toBe("glb");
    expect(result.glbModel?.fileSize).toBe(1024);
    expect(result.glbModel?.seed).toBe(42);
    expect(result.glbModel?.costUsd).toBe(0.02);

    expect(result.plyModel).toBeDefined();
    expect(result.plyModel?.downloadUrl).toBe("https://fal.ai/output/model.ply");
    expect(result.plyModel?.format).toBe("ply");
  });

  it("should cache successful results", async () => {
    const mockResponse = {
      requestId: "mock-req-cache",
      data: {
        mesh: { url: "https://fal.ai/output/model.glb", file_size: 512 },
        seed: 99,
      },
    };

    vi.mocked(fal.subscribe).mockResolvedValue(mockResponse);

    const result1 = await convertImageTo3D("https://example.com/cached.jpg");
    const result2 = await convertImageTo3D("https://example.com/cached.jpg");

    // Should only call fal.subscribe once due to caching
    expect(fal.subscribe).toHaveBeenCalledTimes(1);
    expect(result1.id).toBe(result2.id);
  });

  it("should handle API errors", async () => {
    vi.mocked(fal.subscribe).mockRejectedValueOnce(
      Object.assign(new Error("Validation error"), { status: 422 })
    );

    await expect(convertImageTo3D("https://example.com/invalid.jpg")).rejects.toThrow();
  });

  it("should retry on 5xx errors", async () => {
    const serverError = Object.assign(new Error("Server error"), { status: 500 });
    const successResponse = {
      requestId: "mock-req-retry",
      data: {
        mesh: { url: "https://fal.ai/output/retry.glb", file_size: 256 },
        seed: 1,
      },
    };

    vi.mocked(fal.subscribe)
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(successResponse);

    const result = await convertImageTo3D("https://example.com/retry.jpg");
    expect(result.status).toBe("completed");
    expect(fal.subscribe).toHaveBeenCalledTimes(2);
  });

  it("getConcurrencyInfo should return correct values", () => {
    const info = getConcurrencyInfo();
    expect(info.max).toBe(2);
    expect(info.active).toBe(0);
    expect(info.available).toBe(2);
  });

  it("should include text prompt when provided", async () => {
    const mockResponse = {
      requestId: "mock-req-prompt",
      data: {
        mesh: { url: "https://fal.ai/output/prompted.glb", file_size: 128 },
        seed: 7,
      },
    };

    vi.mocked(fal.subscribe).mockResolvedValueOnce(mockResponse);

    await convertImageTo3D("https://example.com/building.jpg", {
      textPrompt: "modern glass building",
    });

    expect(fal.subscribe).toHaveBeenCalledWith(
      "fal-ai/sam-3/3d-objects",
      expect.objectContaining({
        input: {
          image_url: "https://example.com/building.jpg",
          text_prompt: "modern glass building",
        },
      })
    );
  });
});
