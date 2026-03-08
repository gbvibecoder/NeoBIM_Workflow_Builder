import { describe, it, expect, vi, afterEach } from "vitest";
import { safeErrorMessage } from "@/lib/safe-error";

describe("Safe Error Message", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return generic message in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = safeErrorMessage(new Error("Database connection failed"));
    expect(result).toBe("An unexpected error occurred. Please try again.");
    expect(result).not.toContain("Database");
  });

  it("should return detailed message in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = safeErrorMessage(new Error("Database connection failed"));
    expect(result).toBe("Database connection failed");
  });

  it("should handle non-Error objects in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = safeErrorMessage("raw string error");
    expect(result).toBe("An unexpected error occurred. Please try again.");
  });

  it("should handle non-Error objects in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = safeErrorMessage("raw string error");
    expect(result).toBe("raw string error");
  });

  it("should handle null/undefined in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(safeErrorMessage(null)).toBe("null");
    expect(safeErrorMessage(undefined)).toBe("undefined");
  });

  it("should handle number errors in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(safeErrorMessage(404)).toBe("404");
  });

  it("should never leak error details in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const sensitiveError = new Error("FATAL: password authentication failed for user 'admin'");
    const result = safeErrorMessage(sensitiveError);
    expect(result).not.toContain("password");
    expect(result).not.toContain("admin");
    expect(result).not.toContain("FATAL");
  });
});
