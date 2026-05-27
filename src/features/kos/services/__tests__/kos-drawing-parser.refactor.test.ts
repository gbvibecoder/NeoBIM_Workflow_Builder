/**
 * Unit tests for the 5I PR 2a drawing-parser refactor.
 *
 * Covers all three entry points (file / buffer / S3), the scanned-PDF
 * post-parse detection, error-code mapping, and the threat-equivalent
 * preservation of the deprecated `parseDrawing` CLI alias.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFileMock, fetchKosObjectAsBufferMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  fetchKosObjectAsBufferMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

vi.mock("@/features/kos/services/s3-client", () => ({
  fetchKosObjectAsBuffer: fetchKosObjectAsBufferMock,
}));

import {
  parseDrawing,
  parseDrawingFromBuffer,
  parseDrawingFromFile,
  parseDrawingFromS3,
} from "../kos-drawing-parser";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import type { DrawingParseResult } from "@/features/kos/types/drawing";
import type { Tenant } from "@prisma/client";

const fetchMock = vi.fn();

function buildSuccessfulParseResponse(
  overrides: Partial<DrawingParseResult> = {},
): DrawingParseResult {
  return {
    filename: "test.dxf",
    format: "dxf",
    size_bytes: 1000,
    parser_version: "0.1.0",
    phase: "5C-1",
    drawing_type: "FLOOR_PLAN",
    drawing_type_confidence: 0.9,
    drawing_classification_signals: [],
    drawing_classification_reasoning: "",
    title_block: {
      project_name: null,
      drawing_number: null,
      drawing_title: null,
      revision: null,
      scale: null,
      date: null,
      sheet: null,
      level: null,
      client: null,
      drawn_by: null,
      checked_by: null,
      raw_text_block: "",
      source: "title_block",
      extraction_warnings: [],
    },
    walls: [
      {
        id: "w0",
        start: [0, 0],
        end: [100, 0],
        length_mm: 100,
        thickness_mm: 200,
        angle_degrees: 0,
        layer: "wall",
        detection_tier: 1,
        confidence: 0.85,
      },
    ],
    junctions: [],
    openings: [],
    layers_found: ["wall"],
    drawing_bounds: { min_x: 0, min_y: 0, max_x: 100, max_y: 100 },
    units_detected: "mm",
    stats: {
      total_entities: 1,
      walls_count: 1,
      junctions_count: 0,
      title_block_fields_extracted: 0,
      lines: 0,
      polylines: 0,
      text: 0,
      dimensions: 0,
      circles: 0,
      blocks: 0,
    },
    warnings: [],
    detection_strategy_used: "tier_1",
    overall_confidence: 0.85,
    field_confidences: { walls: 0.85, title_block: 0 },
    missing_data: [],
    downstream_ready: { boq: true, formwork: true, shop_drawings: true },
    duration_ms: 100,
    debug_png_base64: null,
    ...overrides,
  } as DrawingParseResult;
}

function buildScannedPdfResponse(): DrawingParseResult {
  return buildSuccessfulParseResponse({
    format: "pdf",
    walls: [],
    drawing_type: "UNKNOWN",
    drawing_type_confidence: 0,
    title_block: {
      project_name: null,
      drawing_number: null,
      drawing_title: "scanned-image",
      revision: null,
      scale: null,
      date: null,
      sheet: null,
      level: null,
      client: null,
      drawn_by: null,
      checked_by: null,
      raw_text_block: "",
      source: "filename",
      extraction_warnings: [],
    },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fakeTenant = { id: "tenant_1", slug: "kalzen" } as unknown as Tenant;

describe("kos-drawing-parser refactor", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    fetchKosObjectAsBufferMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("IFC_SERVICE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("parseDrawingFromFile", () => {
    it("reads the file, dispatches multipart POST, returns parsed result", async () => {
      readFileMock.mockResolvedValueOnce(Buffer.from("DXFCONTENT"));
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, buildSuccessfulParseResponse()),
      );

      const result = await parseDrawingFromFile({
        filePath: "/tmp/test.dxf",
        sourceFormat: "dxf",
      });

      expect(result.drawing_type).toBe("FLOOR_PLAN");
      expect(readFileMock).toHaveBeenCalledWith("/tmp/test.dxf");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain("/kos/parse-drawing");
      expect(calledInit.method).toBe("POST");
      expect(calledInit.body).toBeInstanceOf(FormData);
    });

    it("readFile failure → KosError KOS_DRAWING_001 with file path in message", async () => {
      readFileMock.mockRejectedValueOnce(
        Object.assign(new Error("ENOENT: no such file"), { name: "Error" }),
      );

      let caught: unknown;
      try {
        await parseDrawingFromFile({
          filePath: "/missing.dxf",
          sourceFormat: "dxf",
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(KosError);
      const err = caught as KosError;
      expect(err.code).toBe("KOS_DRAWING_001");
      expect(err.message).toContain("/missing.dxf");
      expect(err.message).toContain("ENOENT");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("parseDrawingFromBuffer", () => {
    it("dispatches a Buffer directly without hitting fs", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, buildSuccessfulParseResponse()),
      );

      const result = await parseDrawingFromBuffer({
        buffer: Buffer.from("PDFCONTENT"),
        sourceFormat: "pdf",
        filename: "test.pdf",
      });

      expect(result.drawing_type).toBe("FLOOR_PLAN");
      expect(readFileMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("4xx with invalid_extension → KosError KOS_DRAWING_002 surfacing sidecar code", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, {
          error: "invalid_extension",
          message: "file 'test.jpg' must be .dxf or .pdf",
        }),
      );

      let caught: unknown;
      try {
        await parseDrawingFromBuffer({
          buffer: Buffer.from("X"),
          sourceFormat: "jpg" as never,
          filename: "test.jpg",
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_DRAWING_002");
      expect(err.message).toContain("invalid_extension");
      expect(err.message).toContain("400");
    });

    it("network error → KosError KOS_DRAWING_001 (transport)", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("ECONNRESET"));

      await expect(
        parseDrawingFromBuffer({
          buffer: Buffer.from("X"),
          sourceFormat: "dxf",
          filename: "x.dxf",
        }),
      ).rejects.toMatchObject({
        code: "KOS_DRAWING_001",
        httpStatus: 502,
      });
    });

    it("AbortError → KosError KOS_DRAWING_001 timeout message", async () => {
      fetchMock.mockImplementationOnce(() => {
        const e = new Error("aborted");
        e.name = "AbortError";
        return Promise.reject(e);
      });

      let caught: unknown;
      try {
        await parseDrawingFromBuffer({
          buffer: Buffer.from("X"),
          sourceFormat: "dxf",
          filename: "x.dxf",
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_DRAWING_001");
      expect(err.message).toContain("Sidecar did not respond");
    });

    it("scanned-image PDF post-parse detection → KosError KOS_DRAWING_004", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, buildScannedPdfResponse()),
      );

      let caught: unknown;
      try {
        await parseDrawingFromBuffer({
          buffer: Buffer.from("scannedpdf"),
          sourceFormat: "pdf",
          filename: "scanned.pdf",
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_DRAWING_004");
      expect(err.httpStatus).toBe(415);
      expect(err.message).toContain("scanned image");
      expect(err.message).toContain("scanned.pdf");
    });

    it("does NOT trigger scanned-PDF detection on a DXF with zero walls (different format)", async () => {
      // Empty-DXF case — the post-parse guard must not fire because
      // format !== "pdf".
      const emptyDxf = buildSuccessfulParseResponse({
        format: "dxf",
        walls: [],
        title_block: {
          project_name: null,
          drawing_number: null,
          drawing_title: null,
          revision: null,
          scale: null,
          date: null,
          sheet: null,
          level: null,
          client: null,
          drawn_by: null,
          checked_by: null,
          raw_text_block: "",
          source: "filename",
          extraction_warnings: [],
        },
      });
      fetchMock.mockResolvedValueOnce(jsonResponse(200, emptyDxf));

      const result = await parseDrawingFromBuffer({
        buffer: Buffer.from("X"),
        sourceFormat: "dxf",
        filename: "empty.dxf",
      });
      expect(result.walls).toHaveLength(0);
      expect(result.format).toBe("dxf");
    });

    it("does NOT trigger scanned-PDF detection on a vector PDF with walls + title_block.source!=filename", async () => {
      const pdf = buildSuccessfulParseResponse({
        format: "pdf",
        walls: [
          {
            id: "w0",
            start: [0, 0],
            end: [100, 0],
            length_mm: 100,
            thickness_mm: 200,
            angle_degrees: 0,
            layer: "wall",
            detection_tier: 1,
            confidence: 0.85,
          },
        ],
      });
      fetchMock.mockResolvedValueOnce(jsonResponse(200, pdf));

      const result = await parseDrawingFromBuffer({
        buffer: Buffer.from("X"),
        sourceFormat: "pdf",
        filename: "vector.pdf",
      });
      expect(result.walls).toHaveLength(1);
    });

    it("logs kos_parse_dispatch + kos_parse_done with durationMs on success", async () => {
      const infoSpy = vi.spyOn(kosLog, "info");
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, buildSuccessfulParseResponse()),
      );

      await parseDrawingFromBuffer({
        buffer: Buffer.from("X"),
        sourceFormat: "dxf",
        filename: "x.dxf",
        tenantId: "tenant_1",
        drawingId: "draw_1",
      });

      expect(infoSpy).toHaveBeenCalledWith(
        "kos_parse_dispatch",
        expect.objectContaining({
          tenantId: "tenant_1",
          drawingId: "draw_1",
          filename: "x.dxf",
          sourceFormat: "dxf",
        }),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        "kos_parse_done",
        expect.objectContaining({
          tenantId: "tenant_1",
          drawingId: "draw_1",
          durationMs: expect.any(Number),
          drawingType: "FLOOR_PLAN",
        }),
      );
      infoSpy.mockRestore();
    });
  });

  describe("parseDrawingFromS3", () => {
    it("calls fetchKosObjectAsBuffer with the tenant + key, then dispatches", async () => {
      fetchKosObjectAsBufferMock.mockResolvedValueOnce({
        buffer: Buffer.from("DXFFROMS3"),
        contentType: "application/octet-stream",
      });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, buildSuccessfulParseResponse()),
      );

      const result = await parseDrawingFromS3({
        tenant: fakeTenant,
        s3Key: "drawings/tenant_1/cust_1/draw_1/source.dxf",
        sourceFormat: "dxf",
        filename: "source.dxf",
      });

      expect(result.drawing_type).toBe("FLOOR_PLAN");
      expect(fetchKosObjectAsBufferMock).toHaveBeenCalledWith(
        fakeTenant,
        "drawings/tenant_1/cust_1/draw_1/source.dxf",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects S3 keys containing '..' (defence-in-depth path-traversal guard)", async () => {
      let caught: unknown;
      try {
        await parseDrawingFromS3({
          tenant: fakeTenant,
          s3Key: "drawings/../etc/passwd",
          sourceFormat: "dxf",
          filename: "x.dxf",
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_DRAWING_003");
      expect(err.message).toContain("..");
      expect(err.httpStatus).toBe(400);
      expect(fetchKosObjectAsBufferMock).not.toHaveBeenCalled();
    });

    it("S3 fetch failure → KosError KOS_DRAWING_003 with tenant id + key in message", async () => {
      fetchKosObjectAsBufferMock.mockRejectedValueOnce(
        new KosError("KOS_S3_013", "GET failed for s3://kalzen-kos/x", 500),
      );

      let caught: unknown;
      try {
        await parseDrawingFromS3({
          tenant: fakeTenant,
          s3Key: "drawings/tenant_1/cust_1/draw_1/source.dxf",
          sourceFormat: "dxf",
          filename: "source.dxf",
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_DRAWING_003");
      expect(err.message).toContain("KOS_S3_013");
      expect(err.message).toContain("tenant_1");
      expect(err.message).toContain("drawings/tenant_1");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("parseDrawing deprecated alias (CLI backward-compat — threat-equivalent test)", () => {
    it("preserves the existing ParseDrawingArgs call signature used by scripts/kos-drawing-parse-test.ts", async () => {
      readFileMock.mockResolvedValueOnce(Buffer.from("DXF"));
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, buildSuccessfulParseResponse()),
      );

      const result = await parseDrawing({
        filePath: "/tmp/cli.dxf",
        format: "dxf",
        debug: false,
        filename: "cli.dxf",
      });

      expect(result.drawing_type).toBe("FLOOR_PLAN");
      expect(readFileMock).toHaveBeenCalledWith("/tmp/cli.dxf");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("preserves the existing alias when called without an explicit format (defaults to dxf)", async () => {
      readFileMock.mockResolvedValueOnce(Buffer.from("DXF"));
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, buildSuccessfulParseResponse()),
      );

      const result = await parseDrawing({ filePath: "/tmp/cli.dxf" });
      expect(result.drawing_type).toBe("FLOOR_PLAN");
    });
  });
});
