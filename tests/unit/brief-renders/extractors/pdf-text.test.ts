/**
 * PDF text extractor — unit tests.
 *
 * `pdf-parse@1` is non-deterministic on synthetic jspdf-generated inputs
 * (the same exact bytes intermittently throw `bad XRef entry`), so unit
 * tests use the `_setPdfParseForTest` seam to inject a controlled stub.
 * The full integration with real `pdf-parse` is exercised once via the
 * spec-extract orchestrator tests with a fixture PDF.
 *
 * The seam lets us assert the extractor's contract precisely:
 *   • Calls pdf-parse with the input buffer.
 *   • Returns { text, pageCount } unchanged when text is non-empty.
 *   • Throws EmptyPdfError when text is empty / whitespace-only.
 *   • Buffer and Uint8Array inputs both work (Buffer.from coerces).
 *   • Surfaces pdf-parse errors when the buffer is malformed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { EmptyPdfError } from "@/features/brief-renders/services/brief-pipeline/errors";
import {
  extractPdfText,
  _setPdfParseForTest,
} from "@/features/brief-renders/services/brief-pipeline/extractors/pdf-text";

const pdfParseMock = vi.fn();

describe("extractPdfText", () => {
  beforeEach(() => {
    pdfParseMock.mockReset();
    _setPdfParseForTest(pdfParseMock);
  });

  afterEach(() => {
    _setPdfParseForTest(null);
  });

  it("happy path — returns text + page count from pdf-parse output", async () => {
    pdfParseMock.mockResolvedValueOnce({
      text: "Page 1 Marx12 Brief\n\nApartment WE 01bb",
      numpages: 3,
      info: {},
    });
    const result = await extractPdfText(Buffer.from("fake pdf"));
    expect(result.text).toContain("Marx12");
    expect(result.text).toContain("WE 01bb");
    expect(result.pageCount).toBe(3);
    expect(pdfParseMock).toHaveBeenCalledTimes(1);
  });

  it("empty PDF (no text at all) → throws EmptyPdfError", async () => {
    pdfParseMock.mockResolvedValueOnce({ text: "", numpages: 1, info: {} });
    await expect(extractPdfText(Buffer.from("fake"))).rejects.toBeInstanceOf(
      EmptyPdfError,
    );
  });

  it("PDF with whitespace-only text → throws EmptyPdfError", async () => {
    pdfParseMock.mockResolvedValueOnce({
      text: "   \n\n\t  ",
      numpages: 1,
      info: {},
    });
    await expect(extractPdfText(Buffer.from("fake"))).rejects.toBeInstanceOf(
      EmptyPdfError,
    );
  });

  it("malformed buffer (pdf-parse throws) → re-throws", async () => {
    pdfParseMock.mockRejectedValueOnce(new Error("bad XRef entry"));
    await expect(extractPdfText(Buffer.from("garbage"))).rejects.toThrow(
      "bad XRef entry",
    );
  });

  it("preserves arbitrary text content (incl. ASCII-safe German romanizations)", async () => {
    pdfParseMock.mockResolvedValueOnce({
      text: "Wohnflache 32.54 sqm Apartment WE 01bb",
      numpages: 1,
      info: {},
    });
    const result = await extractPdfText(Buffer.from("fake"));
    expect(result.text).toContain("Wohnflache");
    expect(result.text).toContain("32.54");
    expect(result.text).toContain("01bb");
  });

  it("large page count is preserved verbatim", async () => {
    pdfParseMock.mockResolvedValueOnce({
      text: "Page 1\nPage 2\nPage 50\n",
      numpages: 50,
      info: {},
    });
    const result = await extractPdfText(Buffer.from("fake"));
    expect(result.pageCount).toBe(50);
  });

  it("Buffer and Uint8Array inputs both reach pdf-parse as Buffer", async () => {
    pdfParseMock.mockResolvedValue({
      text: "same content",
      numpages: 1,
      info: {},
    });
    const seed = Buffer.from("fake-pdf-bytes");
    const u8 = new Uint8Array(seed.byteLength);
    u8.set(seed);

    await extractPdfText(seed);
    await extractPdfText(u8);

    expect(pdfParseMock).toHaveBeenCalledTimes(2);
    // Both calls must receive a Buffer — the extractor wraps Uint8Array
    // via Buffer.from() before invoking pdf-parse.
    for (const call of pdfParseMock.mock.calls) {
      expect(Buffer.isBuffer(call[0])).toBe(true);
    }
  });

  it("treats numpages as 0 when pdf-parse omits it", async () => {
    // Defensive: not all pdf-parse versions populate every field.
    // The extractor must still produce a valid pageCount (0) rather
    // than NaN / undefined leaking into BriefRenderJob.metadata.
    pdfParseMock.mockResolvedValueOnce({
      text: "some text",
      info: {},
    });
    const result = await extractPdfText(Buffer.from("fake"));
    expect(result.pageCount).toBe(0);
    expect(result.text).toBe("some text");
  });
});
