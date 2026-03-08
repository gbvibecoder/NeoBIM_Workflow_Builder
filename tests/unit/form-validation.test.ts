import { describe, it, expect } from "vitest";

// Mirrors the register route's validation logic
const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

function validateEmail(email: string): boolean {
  if (!email || !email.trim()) return false;
  return emailRegex.test(email.trim().toLowerCase());
}

function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (!password || password.length < 8) return { valid: false, reason: "too_short" };
  if (password.length > 128) return { valid: false, reason: "too_long" };
  if (!passwordRegex.test(password)) return { valid: false, reason: "weak" };
  return { valid: true };
}

describe("Form Validation — Email", () => {
  it("should reject empty email", () => {
    expect(validateEmail("")).toBe(false);
  });

  it("should reject whitespace-only email", () => {
    expect(validateEmail("   ")).toBe(false);
  });

  it("should reject email missing TLD (test@domain)", () => {
    expect(validateEmail("test@domain")).toBe(false);
  });

  it("should reject email with leading dot in domain (test@.com)", () => {
    expect(validateEmail("test@.com")).toBe(false);
  });

  it("should reject email with double dots in domain (test@domain..com)", () => {
    expect(validateEmail("test@domain..com")).toBe(false);
  });

  it("should reject email without @ symbol", () => {
    expect(validateEmail("testdomain.com")).toBe(false);
  });

  it("should accept valid email", () => {
    expect(validateEmail("user@example.com")).toBe(true);
  });

  it("should accept email with subdomain", () => {
    expect(validateEmail("user@mail.example.co.uk")).toBe(true);
  });
});

describe("Form Validation — Password", () => {
  it("should reject password under 8 chars", () => {
    const result = validatePassword("Ab1");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("too_short");
  });

  it("should reject empty password", () => {
    const result = validatePassword("");
    expect(result.valid).toBe(false);
  });

  it("should reject password without uppercase", () => {
    const result = validatePassword("abcdef1234");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("weak");
  });

  it("should reject password without lowercase", () => {
    const result = validatePassword("ABCDEF1234");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("weak");
  });

  it("should reject password without number", () => {
    const result = validatePassword("Abcdefghij");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("weak");
  });

  it("should accept valid password (Abcdef1234)", () => {
    const result = validatePassword("Abcdef1234");
    expect(result.valid).toBe(true);
  });

  it("should reject password over 128 chars", () => {
    const result = validatePassword("A1" + "a".repeat(127));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("too_long");
  });

  it("should accept password at exactly 8 chars", () => {
    const result = validatePassword("Abcdef12");
    expect(result.valid).toBe(true);
  });
});
