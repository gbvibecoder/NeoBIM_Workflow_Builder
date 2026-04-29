/**
 * Embedded-image extractor — unit tests.
 *
 * Mocks unpdf, sharp, and mammoth via the test seams exposed by
 * `embedded-images.ts`. We don't depend on real fixtures or installed
 * packages — those are exercised end-to-end in spec-extract.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  extractEmbeddedImages,
  _setMammothForImagesForTest,
  _setUnpdfForTest,
  _setSharpForTest,
} from "@/features/brief-renders/services/brief-pipeline/extractors/embedded-images";

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface RawPdfImage {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

function makeRawImage(w: number, h: number): RawPdfImage {
  return {
    width: w,
    height: h,
    channels: 4,
    data: new Uint8Array(w * h * 4),
  };
}

afterEach(() => {
  _setUnpdfForTest(null);
  _setSharpForTest(null);
  _setMammothForImagesForTest(null);
});

// ─── PDF path ──────────────────────────────────────────────────────

describe("extractEmbeddedImages — PDF path", () => {
  beforeEach(() => {
    // Stub sharp to return a simple PNG buffer for any input.
    _setSharpForTest(() => ({
      png: () => ({ toBuffer: async () => Buffer.from("fake-png") }),
    }));
  });

  it("returns 3 entries for a PDF with 3 valid embedded images", async () => {
    _setUnpdfForTest({
      getDocumentProxy: async () => ({ numPages: 2 }),
      extractImages: async (_pdf, page) => {
        if (page === 1) {
          return [makeRawImage(800, 600), makeRawImage(400, 300)];
        }
        if (page === 2) {
          return [makeRawImage(1024, 768)];
        }
        return [];
      },
    });

    const result = await extractEmbeddedImages(Buffer.from("fake pdf"), PDF_MIME);
    expect(result.length).toBe(3);
    expect(result[0].mimeType).toBe("image/png");
    expect(result[0].widthPx).toBe(800);
    expect(result[0].heightPx).toBe(600);
    expect(result[1].widthPx).toBe(400);
    expect(result[2].widthPx).toBe(1024);
    // Indices are 0-based and assigned in encounter order.
    expect(result.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("returns empty array for a PDF with no images", async () => {
    _setUnpdfForTest({
      getDocumentProxy: async () => ({ numPages: 1 }),
      extractImages: async () => [],
    });
    const result = await extractEmbeddedImages(Buffer.from("fake pdf"), PDF_MIME);
    expect(result).toEqual([]);
  });

  it("filters out images smaller than 200px on either dimension", async () => {
    _setUnpdfForTest({
      getDocumentProxy: async () => ({ numPages: 1 }),
      extractImages: async () => [
        makeRawImage(800, 600), // keep
        makeRawImage(50, 50), // drop — too small
        makeRawImage(199, 1024), // drop — width below threshold
        makeRawImage(1024, 199), // drop — height below threshold
        makeRawImage(200, 200), // keep — exactly threshold
      ],
    });
    const result = await extractEmbeddedImages(Buffer.from("fake"), PDF_MIME);
    expect(result.length).toBe(2);
  });

  it("caps at 10 images even when the PDF contains 15", async () => {
    _setUnpdfForTest({
      getDocumentProxy: async () => ({ numPages: 1 }),
      extractImages: async () =>
        Array.from({ length: 15 }, () => makeRawImage(800, 600)),
    });
    const result = await extractEmbeddedImages(Buffer.from("fake"), PDF_MIME);
    expect(result.length).toBe(10);
    expect(result[0].index).toBe(0);
    expect(result[9].index).toBe(9);
  });

  it("returns empty array (does not throw) when getDocumentProxy fails", async () => {
    _setUnpdfForTest({
      getDocumentProxy: async () => {
        throw new Error("malformed PDF");
      },
      extractImages: async () => [],
    });
    const result = await extractEmbeddedImages(Buffer.from("fake"), PDF_MIME);
    expect(result).toEqual([]);
  });

  it("survives a per-page extractImages failure and continues", async () => {
    _setUnpdfForTest({
      getDocumentProxy: async () => ({ numPages: 3 }),
      extractImages: async (_pdf, page) => {
        if (page === 2) throw new Error("page 2 broken");
        return [makeRawImage(800, 600)];
      },
    });
    const result = await extractEmbeddedImages(Buffer.from("fake"), PDF_MIME);
    expect(result.length).toBe(2); // page 1 + page 3
  });

  it("survives a sharp encoding failure on a single image", async () => {
    let sharpCallCount = 0;
    _setSharpForTest(() => {
      sharpCallCount++;
      if (sharpCallCount === 2) {
        return {
          png: () => ({
            toBuffer: async () => {
              throw new Error("sharp blew up");
            },
          }),
        };
      }
      return {
        png: () => ({ toBuffer: async () => Buffer.from("fake-png") }),
      };
    });
    _setUnpdfForTest({
      getDocumentProxy: async () => ({ numPages: 1 }),
      extractImages: async () => [
        makeRawImage(800, 600),
        makeRawImage(800, 600),
        makeRawImage(800, 600),
      ],
    });
    const result = await extractEmbeddedImages(Buffer.from("fake"), PDF_MIME);
    expect(result.length).toBe(2);
  });
});

// ─── DOCX path ─────────────────────────────────────────────────────

describe("extractEmbeddedImages — DOCX path", () => {
  it("returns 2 entries for a DOCX with 2 embedded images", async () => {
    const imageReads: Array<() => Promise<Buffer>> = [
      async () => Buffer.from("img-1-bytes"),
      async () => Buffer.from("img-2-bytes"),
    ];
    const contentTypes = ["image/png", "image/jpeg"];

    _setMammothForImagesForTest({
      images: {
        imgElement(cb) {
          // Capture the callback so we can drive it from convertToHtml below.
          return { __cb: cb };
        },
      },
      convertToHtml: async (_input, options) => {
        const handler = (options.convertImage as { __cb: (img: { read: () => Promise<Buffer>; contentType: string }) => Promise<{ src: string }> }).__cb;
        for (let i = 0; i < imageReads.length; i++) {
          await handler({ read: imageReads[i], contentType: contentTypes[i] });
        }
        return { value: "<p>html</p>", messages: [] };
      },
    });

    const result = await extractEmbeddedImages(Buffer.from("fake docx"), DOCX_MIME);
    expect(result.length).toBe(2);
    expect(result[0].mimeType).toBe("image/png");
    expect(result[0].buffer.toString()).toBe("img-1-bytes");
    expect(result[1].mimeType).toBe("image/jpeg");
    expect(result[1].index).toBe(1);
  });

  it("caps at 10 images when DOCX contains 15", async () => {
    _setMammothForImagesForTest({
      images: {
        imgElement(cb) {
          return { __cb: cb };
        },
      },
      convertToHtml: async (_input, options) => {
        const handler = (options.convertImage as { __cb: (img: { read: () => Promise<Buffer>; contentType: string }) => Promise<{ src: string }> }).__cb;
        for (let i = 0; i < 15; i++) {
          await handler({
            read: async () => Buffer.from(`img-${i}`),
            contentType: "image/png",
          });
        }
        return { value: "<p>html</p>", messages: [] };
      },
    });

    const result = await extractEmbeddedImages(Buffer.from("fake"), DOCX_MIME);
    expect(result.length).toBe(10);
  });

  it("returns empty array (does not throw) when mammoth fails", async () => {
    _setMammothForImagesForTest({
      images: {
        imgElement: () => ({}),
      },
      convertToHtml: async () => {
        throw new Error("DOCX is corrupt");
      },
    });
    const result = await extractEmbeddedImages(Buffer.from("fake"), DOCX_MIME);
    expect(result).toEqual([]);
  });

  it("continues past a single image-read failure", async () => {
    _setMammothForImagesForTest({
      images: {
        imgElement(cb) {
          return { __cb: cb };
        },
      },
      convertToHtml: async (_input, options) => {
        const handler = (options.convertImage as { __cb: (img: { read: () => Promise<Buffer>; contentType: string }) => Promise<{ src: string }> }).__cb;
        await handler({
          read: async () => Buffer.from("img-1"),
          contentType: "image/png",
        });
        await handler({
          read: async () => {
            throw new Error("image 2 corrupt");
          },
          contentType: "image/png",
        });
        await handler({
          read: async () => Buffer.from("img-3"),
          contentType: "image/jpeg",
        });
        return { value: "<p>html</p>", messages: [] };
      },
    });

    const result = await extractEmbeddedImages(Buffer.from("fake"), DOCX_MIME);
    expect(result.length).toBe(2);
    expect(result[0].buffer.toString()).toBe("img-1");
    expect(result[1].buffer.toString()).toBe("img-3");
  });
});

// Ensure spies don't leak between describes.
afterEach(() => {
  vi.clearAllMocks();
});
