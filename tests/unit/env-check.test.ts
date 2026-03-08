import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Inline the validation logic to test without side effects
function validateEnvVars(env: Record<string, string | undefined>) {
  const required = ["DATABASE_URL", "AUTH_SECRET"];
  const recommended = [
    "OPENAI_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ];

  const missing = required.filter((key) => !env[key]);
  const missingRecommended = recommended.filter((key) => !env[key]);

  return { missing, missingRecommended };
}

describe("Environment Validation", () => {
  it("should identify missing required vars", () => {
    const result = validateEnvVars({});
    expect(result.missing).toContain("DATABASE_URL");
    expect(result.missing).toContain("AUTH_SECRET");
  });

  it("should identify missing recommended vars", () => {
    const result = validateEnvVars({
      DATABASE_URL: "postgres://...",
      AUTH_SECRET: "secret",
    });
    expect(result.missing).toHaveLength(0);
    expect(result.missingRecommended).toContain("OPENAI_API_KEY");
    expect(result.missingRecommended).toContain("STRIPE_SECRET_KEY");
  });

  it("should pass when all vars present", () => {
    const result = validateEnvVars({
      DATABASE_URL: "postgres://...",
      AUTH_SECRET: "secret",
      OPENAI_API_KEY: "sk-...",
      STRIPE_SECRET_KEY: "sk_...",
      STRIPE_WEBHOOK_SECRET: "whsec_...",
      UPSTASH_REDIS_REST_URL: "https://...",
      UPSTASH_REDIS_REST_TOKEN: "token",
    });
    expect(result.missing).toHaveLength(0);
    expect(result.missingRecommended).toHaveLength(0);
  });

  it("should not flag present required vars as missing", () => {
    const result = validateEnvVars({
      DATABASE_URL: "postgres://...",
      AUTH_SECRET: "secret",
    });
    expect(result.missing).toHaveLength(0);
  });

  it("should handle empty string values as missing", () => {
    const result = validateEnvVars({
      DATABASE_URL: "",
      AUTH_SECRET: "secret",
    });
    expect(result.missing).toContain("DATABASE_URL");
  });
});
