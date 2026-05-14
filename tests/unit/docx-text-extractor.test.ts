/**
 * DOCX text extractor (`src/lib/docx-text-extractor.ts`) — unit tests.
 *
 * This is the cross-cutting extractor the canvas TR-001 Brief Parser
 * uses to read `.docx` uploads. Before it existed, TR-001 fed DOCX
 * bytes to the PDF extractor chain and failed with "Invalid PDF
 * structure" — these tests lock in the never-throw contract and the
 * magic-byte sniff that routes DOCX away from the PDF path.
 *
 * mammoth is mocked via `_setMammothForTest`, so the suite runs with
 * no `mammoth` install and no fixture file required.
 */

import { describe, it, expect, afterEach } from "vitest";

import {
  extractTextFromDocx,
  isDocxBuffer,
  _setMammothForTest,
} from "@/lib/docx-text-extractor";

afterEach(() => {
  _setMammothForTest(null);
});

// ─── isDocxBuffer — magic-byte sniff ────────────────────────────────

describe("isDocxBuffer", () => {
  it("returns true for a ZIP/OOXML header (PK\\x03\\x04)", () => {
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(isDocxBuffer(docx)).toBe(true);
  });

  it("returns false for a PDF header (%PDF)", () => {
    const pdf = Buffer.from("%PDF-1.7\n...", "utf8");
    expect(isDocxBuffer(pdf)).toBe(false);
  });

  it("returns false for arbitrary text and for too-short buffers", () => {
    expect(isDocxBuffer(Buffer.from("just some text", "utf8"))).toBe(false);
    expect(isDocxBuffer(Buffer.from([0x50, 0x4b]))).toBe(false);
    expect(isDocxBuffer(Buffer.alloc(0))).toBe(false);
  });
});

// ─── extractTextFromDocx — mocked mammoth ───────────────────────────

describe("extractTextFromDocx", () => {
  const longBrief =
    "EXHIBITION STAND BRIEF — SOL PROPERTIES. 15x15m booth, three project " +
    "models, reception desk, coffee counter, smoked walnut oak finish.";

  it("happy path — returns extracted text and source 'mammoth'", async () => {
    _setMammothForTest({
      extractRawText: async () => ({ value: longBrief, messages: [] }),
    });
    const result = await extractTextFromDocx(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(result.source).toBe("mammoth");
    expect(result.text).toBe(longBrief);
    expect(result.errors.mammoth).toBeUndefined();
    expect(result.latencyMs.mammoth).toBeGreaterThanOrEqual(0);
  });

  it("accepts a Uint8Array and hands mammoth a Buffer", async () => {
    let seen: unknown;
    _setMammothForTest({
      extractRawText: async (input) => {
        seen = input.buffer;
        return { value: longBrief, messages: [] };
      },
    });
    const u8 = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const result = await extractTextFromDocx(u8);
    expect(Buffer.isBuffer(seen)).toBe(true);
    expect(result.text).toBe(longBrief);
  });

  it("never throws — mammoth throwing is captured in errors", async () => {
    _setMammothForTest({
      extractRawText: async () => {
        throw new Error("DOCX is corrupt");
      },
    });
    const result = await extractTextFromDocx(Buffer.from("fake docx"));
    expect(result.source).toBe("failed");
    expect(result.text).toBe("");
    expect(result.errors.mammoth).toContain("DOCX is corrupt");
  });

  it("text below the minimum useful length → source 'failed'", async () => {
    _setMammothForTest({
      extractRawText: async () => ({ value: "tiny", messages: [] }),
    });
    const result = await extractTextFromDocx(Buffer.from("fake docx"));
    expect(result.source).toBe("failed");
    expect(result.text).toBe("");
    expect(result.errors.mammoth).toMatch(/Extracted only/);
  });

  it("empty buffer → source 'failed' without calling mammoth", async () => {
    let called = false;
    _setMammothForTest({
      extractRawText: async () => {
        called = true;
        return { value: longBrief, messages: [] };
      },
    });
    const result = await extractTextFromDocx(Buffer.alloc(0));
    expect(result.source).toBe("failed");
    expect(result.errors.mammoth).toMatch(/Empty DOCX buffer/);
    expect(called).toBe(false);
  });

  it("oversized buffer → source 'failed' without calling mammoth", async () => {
    let called = false;
    _setMammothForTest({
      extractRawText: async () => {
        called = true;
        return { value: longBrief, messages: [] };
      },
    });
    // 31 MB — just over the 30 MB cap.
    const huge = Buffer.alloc(31 * 1024 * 1024);
    const result = await extractTextFromDocx(huge);
    expect(result.source).toBe("failed");
    expect(result.errors.mammoth).toMatch(/exceeds the/);
    expect(called).toBe(false);
  });
});
