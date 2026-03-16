import { describe, it, expect } from "vitest";
import {
  validateTR001Input,
  validateTR004Input,
  validateTR012Input,
  validateGN004Input,
  validateGN007Input,
  validateGN008Input,
  validateNodeInput,
  assertValidInput,
} from "@/lib/validation";
import { APIError } from "@/lib/user-errors";

// ─── TR-001: Brief Parser ───────────────────────────────────────────────────

describe("Validation — TR-001 (Brief Parser)", () => {
  it("should accept input with sufficient text content via 'content'", () => {
    const result = validateTR001Input({
      content: "This is a sufficiently long design brief document for parsing.",
    });
    expect(result.valid).toBe(true);
  });

  it("should accept input with sufficient text content via 'prompt'", () => {
    const result = validateTR001Input({
      prompt: "Design a mixed-use building with ground floor retail.",
    });
    expect(result.valid).toBe(true);
  });

  it("should accept input with sufficient text content via 'rawText'", () => {
    const result = validateTR001Input({
      rawText: "A comprehensive brief about a hospital building project.",
    });
    expect(result.valid).toBe(true);
  });

  it("should accept input with fileData (PDF buffer)", () => {
    const result = validateTR001Input({
      fileData: Buffer.from("PDF content here"),
    });
    expect(result.valid).toBe(true);
  });

  it("should accept input with buffer field", () => {
    const result = validateTR001Input({
      buffer: new Uint8Array([1, 2, 3]),
    });
    expect(result.valid).toBe(true);
  });

  it("should accept when text is short but fileData is present", () => {
    const result = validateTR001Input({
      content: "Short",
      fileData: Buffer.from("data"),
    });
    expect(result.valid).toBe(true);
  });

  it("should reject when text is too short and no file data", () => {
    const result = validateTR001Input({ content: "Short" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No document content");
  });

  it("should reject when no input is provided", () => {
    const result = validateTR001Input(null);
    expect(result.valid).toBe(false);
  });

  it("should reject when undefined is provided", () => {
    const result = validateTR001Input(undefined);
    expect(result.valid).toBe(false);
  });

  it("should reject empty object", () => {
    const result = validateTR001Input({});
    expect(result.valid).toBe(false);
  });

  it("should reject empty string content", () => {
    const result = validateTR001Input({ content: "" });
    expect(result.valid).toBe(false);
  });

  it("should reject whitespace-only content under 20 chars", () => {
    const result = validateTR001Input({ content: "        " });
    expect(result.valid).toBe(false);
  });
});

// ─── TR-004: Image Understanding ────────────────────────────────────────────

describe("Validation — TR-004 (Image Understanding)", () => {
  it("should accept input with base64 fileData", () => {
    const result = validateTR004Input({ fileData: "data:image/png;base64,abc123" });
    expect(result.valid).toBe(true);
  });

  it("should accept input with imageBase64", () => {
    const result = validateTR004Input({ imageBase64: "abc123==" });
    expect(result.valid).toBe(true);
  });

  it("should accept input with base64 field", () => {
    const result = validateTR004Input({ base64: "abc123==" });
    expect(result.valid).toBe(true);
  });

  it("should accept input with url", () => {
    const result = validateTR004Input({
      url: "https://example.com/image.png",
    });
    expect(result.valid).toBe(true);
  });

  it("should reject when neither image nor URL is provided", () => {
    const result = validateTR004Input({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No image provided");
  });

  it("should reject null input", () => {
    const result = validateTR004Input(null);
    expect(result.valid).toBe(false);
  });

  it("should reject undefined input", () => {
    const result = validateTR004Input(undefined);
    expect(result.valid).toBe(false);
  });

  it("should accept when both base64 and url are provided", () => {
    const result = validateTR004Input({
      fileData: "base64data",
      url: "https://example.com/img.png",
    });
    expect(result.valid).toBe(true);
  });
});

// ─── TR-012: Site Analysis ──────────────────────────────────────────────────

describe("Validation — TR-012 (Site Analysis)", () => {
  it("should accept valid address via 'content'", () => {
    const result = validateTR012Input({ content: "Berlin, Germany" });
    expect(result.valid).toBe(true);
  });

  it("should accept valid address via 'prompt'", () => {
    const result = validateTR012Input({
      prompt: "123 Main Street, Munich",
    });
    expect(result.valid).toBe(true);
  });

  it("should accept valid address via 'address'", () => {
    const result = validateTR012Input({ address: "Vienna, Austria" });
    expect(result.valid).toBe(true);
  });

  it("should reject address shorter than 3 chars", () => {
    const result = validateTR012Input({ content: "NY" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Address too short");
  });

  it("should reject empty address", () => {
    const result = validateTR012Input({ content: "" });
    expect(result.valid).toBe(false);
  });

  it("should reject whitespace-only address", () => {
    const result = validateTR012Input({ content: "  " });
    expect(result.valid).toBe(false);
  });

  it("should reject null input", () => {
    const result = validateTR012Input(null);
    expect(result.valid).toBe(false);
  });

  it("should reject undefined input", () => {
    const result = validateTR012Input(undefined);
    expect(result.valid).toBe(false);
  });

  it("should reject non-string address", () => {
    const result = validateTR012Input({ content: 12345 });
    expect(result.valid).toBe(false);
  });

  it("should accept exactly 3 character address", () => {
    const result = validateTR012Input({ content: "NYC" });
    expect(result.valid).toBe(true);
  });
});

// ─── GN-004: Floor Plan Generator ───────────────────────────────────────────

describe("Validation — GN-004 (Floor Plan Generator)", () => {
  it("should always return valid for any input", () => {
    expect(validateGN004Input(null).valid).toBe(true);
    expect(validateGN004Input(undefined).valid).toBe(true);
    expect(validateGN004Input({}).valid).toBe(true);
    expect(validateGN004Input({ anything: "goes" }).valid).toBe(true);
    expect(validateGN004Input("string input").valid).toBe(true);
    expect(validateGN004Input(42).valid).toBe(true);
  });
});

// ─── GN-007: Image to 3D (SAM 3D) ──────────────────────────────────────────

describe("Validation — GN-007 (Image to 3D)", () => {
  it("should accept input with url", () => {
    const result = validateGN007Input({
      url: "https://example.com/building.jpg",
    });
    expect(result.valid).toBe(true);
  });

  it("should accept input with imageUrl", () => {
    const result = validateGN007Input({
      imageUrl: "https://example.com/building.jpg",
    });
    expect(result.valid).toBe(true);
  });

  it("should accept input with fileData (base64)", () => {
    const result = validateGN007Input({ fileData: "base64encodeddata" });
    expect(result.valid).toBe(true);
  });

  it("should accept input with imageBase64", () => {
    const result = validateGN007Input({ imageBase64: "base64data" });
    expect(result.valid).toBe(true);
  });

  it("should accept input with base64 field", () => {
    const result = validateGN007Input({ base64: "base64data" });
    expect(result.valid).toBe(true);
  });

  it("should reject when no image provided", () => {
    const result = validateGN007Input({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No image provided");
  });

  it("should reject null input", () => {
    const result = validateGN007Input(null);
    expect(result.valid).toBe(false);
  });

  it("should reject undefined input", () => {
    const result = validateGN007Input(undefined);
    expect(result.valid).toBe(false);
  });
});

// ─── GN-008: Text to 3D Generator ──────────────────────────────────────────

describe("Validation — GN-008 (Text to 3D)", () => {
  it("should accept input with _raw object", () => {
    const result = validateGN008Input({
      _raw: { projectName: "Test", buildingType: "Office" },
    });
    expect(result.valid).toBe(true);
  });

  it("should accept input with projectName", () => {
    const result = validateGN008Input({ projectName: "Modern Villa" });
    expect(result.valid).toBe(true);
  });

  it("should accept valid prompt (>= 10 chars)", () => {
    const result = validateGN008Input({
      prompt: "A modern glass office building",
    });
    expect(result.valid).toBe(true);
  });

  it("should accept valid content (>= 10 chars)", () => {
    const result = validateGN008Input({
      content: "A residential tower with 20 floors",
    });
    expect(result.valid).toBe(true);
  });

  it("should reject short prompt (< 10 chars)", () => {
    const result = validateGN008Input({ prompt: "Building" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too short");
  });

  it("should reject empty prompt", () => {
    const result = validateGN008Input({ prompt: "" });
    expect(result.valid).toBe(false);
  });

  it("should reject prompt longer than 2000 chars", () => {
    const result = validateGN008Input({ prompt: "A".repeat(2001) });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too long");
  });

  it("should accept prompt of exactly 2000 chars", () => {
    const result = validateGN008Input({
      prompt: "A".repeat(10) + "B".repeat(1990),
    });
    expect(result.valid).toBe(true);
  });

  it("should reject null input (prompt fallback is empty)", () => {
    const result = validateGN008Input(null);
    expect(result.valid).toBe(false);
  });

  it("should reject undefined input", () => {
    const result = validateGN008Input(undefined);
    expect(result.valid).toBe(false);
  });

  it("should reject whitespace-only prompt", () => {
    const result = validateGN008Input({ prompt: "   \t\n   " });
    expect(result.valid).toBe(false);
  });
});

// ─── validateNodeInput — Dispatcher ─────────────────────────────────────────

describe("Validation — validateNodeInput Dispatcher", () => {
  it("should route TR-001 correctly", () => {
    const result = validateNodeInput("TR-001", {
      content: "A comprehensive design brief for a hospital.",
    });
    expect(result.valid).toBe(true);
  });

  it("should route TR-004 correctly", () => {
    const result = validateNodeInput("TR-004", {
      url: "https://example.com/plan.png",
    });
    expect(result.valid).toBe(true);
  });

  it("should route TR-012 correctly", () => {
    const result = validateNodeInput("TR-012", { content: "Berlin, Germany" });
    expect(result.valid).toBe(true);
  });

  it("should route GN-004 correctly (always valid)", () => {
    const result = validateNodeInput("GN-004", null);
    expect(result.valid).toBe(true);
  });

  it("should route GN-007 correctly", () => {
    const result = validateNodeInput("GN-007", {
      url: "https://example.com/render.jpg",
    });
    expect(result.valid).toBe(true);
  });

  it("should route GN-008 correctly", () => {
    const result = validateNodeInput("GN-008", {
      prompt: "Modern office building in downtown",
    });
    expect(result.valid).toBe(true);
  });

  it("should return valid for unknown node IDs", () => {
    const result = validateNodeInput("UNKNOWN-999", { anything: true });
    expect(result.valid).toBe(true);
  });

  it("should route TR-003 correctly", () => {
    const result = validateNodeInput("TR-003", {
      prompt: "Design a modern hospital",
    });
    expect(result.valid).toBe(true);
  });

  it("should route GN-003 correctly", () => {
    const result = validateNodeInput("GN-003", {
      prompt: "Render a glass skyscraper",
    });
    expect(result.valid).toBe(true);
  });

  it("should route TR-007 correctly", () => {
    const result = validateNodeInput("TR-007", null);
    expect(result.valid).toBe(true);
  });

  it("should route TR-008 correctly", () => {
    const result = validateNodeInput("TR-008", {
      elements: [{ name: "Wall" }],
    });
    expect(result.valid).toBe(true);
  });

  it("should route EX-002 correctly", () => {
    const result = validateNodeInput("EX-002", {
      rows: [["Wall", 10]],
      headers: ["Item", "Qty"],
    });
    expect(result.valid).toBe(true);
  });
});

// ─── assertValidInput ───────────────────────────────────────────────────────

describe("Validation — assertValidInput", () => {
  it("should not throw for valid TR-001 input", () => {
    expect(() =>
      assertValidInput("TR-001", {
        content: "A sufficiently long design brief for a building project.",
      })
    ).not.toThrow();
  });

  it("should throw APIError for invalid TR-001 input", () => {
    expect(() => assertValidInput("TR-001", {})).toThrow(APIError);
  });

  it("should throw APIError with statusCode 400", () => {
    try {
      assertValidInput("TR-004", {});
    } catch (e) {
      expect(e).toBeInstanceOf(APIError);
      expect((e as APIError).statusCode).toBe(400);
    }
  });

  it("should throw APIError with relevant userError", () => {
    try {
      assertValidInput("GN-008", { prompt: "Short" });
    } catch (e) {
      expect(e).toBeInstanceOf(APIError);
      expect((e as APIError).userError.code).toBe("VAL_002"); // PROMPT_TOO_SHORT
    }
  });

  it("should not throw for unknown node IDs", () => {
    expect(() =>
      assertValidInput("FUTURE-001", { anything: true })
    ).not.toThrow();
  });

  it("should not throw for valid TR-012 input", () => {
    expect(() =>
      assertValidInput("TR-012", { address: "Munich, Germany" })
    ).not.toThrow();
  });

  it("should throw for invalid TR-012 input", () => {
    expect(() => assertValidInput("TR-012", { content: "AB" })).toThrow(
      APIError
    );
  });

  it("should not throw for valid GN-004 input (any input)", () => {
    expect(() => assertValidInput("GN-004", null)).not.toThrow();
  });

  it("should throw for invalid GN-007 input (no image)", () => {
    expect(() => assertValidInput("GN-007", {})).toThrow(APIError);
  });

  it("should use INVALID_INPUT as fallback userError when none specified", () => {
    // TR-003 with non-string prompt returns INVALID_INPUT
    try {
      assertValidInput("TR-003", { prompt: 12345 });
    } catch (e) {
      expect(e).toBeInstanceOf(APIError);
      expect((e as APIError).userError.code).toBe("VAL_001");
    }
  });
});
