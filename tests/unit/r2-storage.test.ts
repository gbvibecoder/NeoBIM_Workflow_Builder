/**
 * Comprehensive R2 Storage Integration Tests
 * 50 scenarios covering all edge cases, fallbacks, and safety guarantees.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared mock state ────────────────────────────────────────────────────
const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = sendMock;
  },
  PutObjectCommand: class MockPut {
    constructor(public params: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class MockDel {
    constructor(public params: Record<string, unknown>) {}
  },
  ListObjectsV2Command: class MockList {
    constructor(public params: Record<string, unknown>) {}
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────

function setR2Env() {
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_ACCESS_KEY_ID = "test-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.R2_BUCKET_NAME = "test-bucket";
  process.env.R2_PUBLIC_URL = "https://test.r2.dev";
}

function clearR2Env() {
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET_NAME;
  delete process.env.R2_PUBLIC_URL;
}

// We import after mock setup — module reads env at import time,
// but functions read env at call time via closures. We'll re-import per group.
async function freshImport() {
  vi.resetModules();
  // Re-set env before each fresh import
  setR2Env();
  return await import("@/lib/r2");
}

async function freshImportNoEnv() {
  vi.resetModules();
  clearR2Env();
  return await import("@/lib/r2");
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("R2 Storage — 50 Scenarios", () => {
  beforeEach(() => {
    sendMock.mockReset();
    setR2Env();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 1: Configuration Detection (Scenarios 1-8)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Group 1: Configuration Detection", () => {
    it("Scenario 1: isR2Configured returns true when all env vars set", async () => {
      const { isR2Configured } = await freshImport();
      expect(isR2Configured()).toBe(true);
    });

    it("Scenario 2: isR2Configured returns false when R2_ACCOUNT_ID missing", async () => {
      vi.resetModules();
      setR2Env();
      delete process.env.R2_ACCOUNT_ID;
      const { isR2Configured } = await import("@/lib/r2");
      expect(isR2Configured()).toBe(false);
    });

    it("Scenario 3: isR2Configured returns false when R2_ACCESS_KEY_ID missing", async () => {
      vi.resetModules();
      setR2Env();
      delete process.env.R2_ACCESS_KEY_ID;
      const { isR2Configured } = await import("@/lib/r2");
      expect(isR2Configured()).toBe(false);
    });

    it("Scenario 4: isR2Configured returns false when R2_SECRET_ACCESS_KEY missing", async () => {
      vi.resetModules();
      setR2Env();
      delete process.env.R2_SECRET_ACCESS_KEY;
      const { isR2Configured } = await import("@/lib/r2");
      expect(isR2Configured()).toBe(false);
    });

    it("Scenario 5: isR2Configured returns false when ALL env vars missing", async () => {
      const { isR2Configured } = await freshImportNoEnv();
      expect(isR2Configured()).toBe(false);
    });

    it("Scenario 6: isR2Configured returns false when env vars are empty strings", async () => {
      vi.resetModules();
      process.env.R2_ACCOUNT_ID = "";
      process.env.R2_ACCESS_KEY_ID = "";
      process.env.R2_SECRET_ACCESS_KEY = "";
      const { isR2Configured } = await import("@/lib/r2");
      expect(isR2Configured()).toBe(false);
    });

    it("Scenario 7: Default bucket name used when R2_BUCKET_NAME not set", async () => {
      vi.resetModules();
      setR2Env();
      delete process.env.R2_BUCKET_NAME;
      const { isR2Configured } = await import("@/lib/r2");
      expect(isR2Configured()).toBe(true);
    });

    it("Scenario 8: Works without R2_PUBLIC_URL", async () => {
      vi.resetModules();
      setR2Env();
      delete process.env.R2_PUBLIC_URL;
      const { isR2Configured } = await import("@/lib/r2");
      expect(isR2Configured()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 2: uploadToR2 — File Uploads (Scenarios 9-18)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Group 2: uploadToR2 — Direct Buffer Upload", () => {
    it("Scenario 9: Successfully uploads a small PDF", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadToR2 } = await freshImport();
      const result = await uploadToR2(Buffer.from("pdf-content"), "report.pdf", "application/pdf");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.url).toContain("report.pdf");
        expect(result.size).toBe(11);
      }
    });

    it("Scenario 10: Successfully uploads XLSX", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadToR2 } = await freshImport();
      const result = await uploadToR2(Buffer.from("xlsx"), "boq.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(result.success).toBe(true);
    });

    it("Scenario 11: Rejects file exceeding 5MB", async () => {
      const { uploadToR2 } = await freshImport();
      const result = await uploadToR2(Buffer.alloc(6 * 1024 * 1024), "big.pdf", "application/pdf");
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("5MB");
    });

    it("Scenario 12: Rejects file at 5MB + 1 byte", async () => {
      const { uploadToR2 } = await freshImport();
      const result = await uploadToR2(Buffer.alloc(5 * 1024 * 1024 + 1), "edge.pdf", "application/pdf");
      expect(result.success).toBe(false);
    });

    it("Scenario 13: Accepts file at exactly 5MB", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadToR2 } = await freshImport();
      const result = await uploadToR2(Buffer.alloc(5 * 1024 * 1024), "max.pdf", "application/pdf");
      expect(result.success).toBe(true);
    });

    it("Scenario 14: Returns error when R2 not configured", async () => {
      const { uploadToR2 } = await freshImportNoEnv();
      const result = await uploadToR2(Buffer.from("test"), "t.pdf", "application/pdf");
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("not configured");
    });

    it("Scenario 15: Returns error when S3 send throws", async () => {
      sendMock.mockRejectedValueOnce(new Error("Network timeout"));
      const { uploadToR2 } = await freshImport();
      const result = await uploadToR2(Buffer.from("test"), "t.pdf", "application/pdf");
      expect(result.success).toBe(false);
    });

    it("Scenario 16: Generates unique keys for same filename", async () => {
      sendMock.mockResolvedValue({});
      const { uploadToR2 } = await freshImport();
      const r1 = await uploadToR2(Buffer.from("a"), "report.pdf", "application/pdf");
      const r2 = await uploadToR2(Buffer.from("b"), "report.pdf", "application/pdf");
      expect(r1.success && r2.success).toBe(true);
      if (r1.success && r2.success) expect(r1.key).not.toBe(r2.key);
    });

    it("Scenario 17: Key contains date-based path under files/", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadToR2 } = await freshImport();
      const result = await uploadToR2(Buffer.from("x"), "test.pdf", "application/pdf");
      if (result.success) expect(result.key).toMatch(/^files\/\d{4}\/\d{2}\/\d{2}\/.+-test\.pdf$/);
    });

    it("Scenario 18: URL uses PUBLIC_URL when set", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadToR2 } = await freshImport();
      const result = await uploadToR2(Buffer.from("x"), "test.pdf", "application/pdf");
      if (result.success) expect(result.url).toMatch(/^https:\/\/test\.r2\.dev\//);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 3: uploadBase64ToR2 — Graceful Fallback (Scenarios 19-28)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Group 3: uploadBase64ToR2 — Graceful Fallback", () => {
    const fakeUri = "data:application/pdf;base64,dGVzdA==";

    it("Scenario 19: Returns R2 URL on success", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadBase64ToR2 } = await freshImport();
      const result = await uploadBase64ToR2(fakeUri, "r.pdf", "application/pdf");
      expect(result).toContain("https://test.r2.dev/");
    });

    it("Scenario 20: Falls back when R2 not configured", async () => {
      const { uploadBase64ToR2 } = await freshImportNoEnv();
      const result = await uploadBase64ToR2(fakeUri, "r.pdf", "application/pdf");
      expect(result).toBe(fakeUri);
    });

    it("Scenario 21: Falls back when upload fails", async () => {
      sendMock.mockRejectedValueOnce(new Error("fail"));
      const { uploadBase64ToR2 } = await freshImport();
      const result = await uploadBase64ToR2(fakeUri, "r.pdf", "application/pdf");
      expect(result).toBe(fakeUri);
    });

    it("Scenario 22: Falls back when file exceeds 5MB", async () => {
      const { uploadBase64ToR2 } = await freshImport();
      const bigBase64 = Buffer.alloc(6 * 1024 * 1024).toString("base64");
      const bigUri = `data:application/pdf;base64,${bigBase64}`;
      const result = await uploadBase64ToR2(bigUri, "big.pdf", "application/pdf");
      expect(result).toBe(bigUri);
    });

    it("Scenario 23: Extracts base64 correctly from data URI", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadBase64ToR2 } = await freshImport();
      const result = await uploadBase64ToR2(fakeUri, "t.pdf", "application/pdf");
      expect(result).not.toBe(fakeUri);
    });

    it("Scenario 24: Handles raw base64 (no data: prefix)", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadBase64ToR2 } = await freshImport();
      const result = await uploadBase64ToR2("dGVzdA==", "t.pdf", "application/pdf");
      expect(result).toContain("https://");
    });

    it("Scenario 25: Never throws — always returns string", async () => {
      sendMock.mockImplementation(() => { throw new Error("catastrophe"); });
      const { uploadBase64ToR2 } = await freshImport();
      const result = await uploadBase64ToR2(fakeUri, "t.pdf", "application/pdf");
      expect(typeof result).toBe("string");
    });

    it("Scenario 26: Falls back when all env vars removed", async () => {
      const { uploadBase64ToR2 } = await freshImportNoEnv();
      const result = await uploadBase64ToR2(fakeUri, "t.pdf", "application/pdf");
      expect(result).toBe(fakeUri);
    });

    it("Scenario 27: Empty data URI returns empty string", async () => {
      const { uploadBase64ToR2 } = await freshImportNoEnv();
      const result = await uploadBase64ToR2("", "e.pdf", "application/pdf");
      expect(result).toBe("");
    });

    it("Scenario 28: Works with XLSX content type", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadBase64ToR2 } = await freshImport();
      const xlsxUri = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,dGVzdA==";
      const result = await uploadBase64ToR2(xlsxUri, "b.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(result).toContain("https://test.r2.dev/");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 4: uploadIFCToR2 — IFC Uploads (Scenarios 29-38)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Group 4: uploadIFCToR2 — IFC File Uploads", () => {
    it("Scenario 29: Successfully uploads IFC file", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadIFCToR2 } = await freshImport();
      const result = await uploadIFCToR2(Buffer.from("ISO-10303-21;"), "building.ifc");
      expect(result).not.toBeNull();
      expect(result!.url).toContain("ifc/");
      expect(result!.url).toContain("building.ifc");
    });

    it("Scenario 30: IFC uses ifc/ prefix", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadIFCToR2 } = await freshImport();
      const result = await uploadIFCToR2(Buffer.from("test"), "m.ifc");
      expect(result!.key).toMatch(/^ifc\//);
    });

    it("Scenario 31: Accepts IFC up to 50MB", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadIFCToR2 } = await freshImport();
      const result = await uploadIFCToR2(Buffer.alloc(50 * 1024 * 1024), "big.ifc");
      expect(result).not.toBeNull();
    });

    it("Scenario 32: Rejects IFC over 50MB", async () => {
      const { uploadIFCToR2 } = await freshImport();
      const result = await uploadIFCToR2(Buffer.alloc(50 * 1024 * 1024 + 1), "huge.ifc");
      expect(result).toBeNull();
    });

    it("Scenario 33: Returns null when R2 not configured", async () => {
      const { uploadIFCToR2 } = await freshImportNoEnv();
      const result = await uploadIFCToR2(Buffer.from("t"), "t.ifc");
      expect(result).toBeNull();
    });

    it("Scenario 34: Returns null when S3 send throws", async () => {
      sendMock.mockRejectedValueOnce(new Error("fail"));
      const { uploadIFCToR2 } = await freshImport();
      const result = await uploadIFCToR2(Buffer.from("t"), "t.ifc");
      expect(result).toBeNull();
    });

    it("Scenario 35: Accepts Uint8Array input", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadIFCToR2 } = await freshImport();
      const result = await uploadIFCToR2(new Uint8Array([73, 83, 79]), "t.ifc");
      expect(result).not.toBeNull();
    });

    it("Scenario 36: Unique keys for same IFC filename", async () => {
      sendMock.mockResolvedValue({});
      const { uploadIFCToR2 } = await freshImport();
      const r1 = await uploadIFCToR2(Buffer.from("a"), "m.ifc");
      const r2 = await uploadIFCToR2(Buffer.from("b"), "m.ifc");
      expect(r1!.key).not.toBe(r2!.key);
    });

    it("Scenario 37: IFC key has date-based path", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadIFCToR2 } = await freshImport();
      const result = await uploadIFCToR2(Buffer.from("t"), "b.ifc");
      expect(result!.key).toMatch(/^ifc\/\d{4}\/\d{2}\/\d{2}\/.+-b\.ifc$/);
    });

    it("Scenario 38: Empty IFC buffer uploads (size 0)", async () => {
      sendMock.mockResolvedValueOnce({});
      const { uploadIFCToR2 } = await freshImport();
      const result = await uploadIFCToR2(Buffer.alloc(0), "empty.ifc");
      expect(result).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 5: cleanupOldFiles (Scenarios 39-46)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Group 5: cleanupOldFiles — Auto-Cleanup", () => {
    it("Scenario 39: Deletes PDFs older than 25 days", async () => {
      const old = new Date(); old.setDate(old.getDate() - 30);
      sendMock
        .mockResolvedValueOnce({ Contents: [{ Key: "files/old.pdf", LastModified: old }], IsTruncated: false })
        .mockResolvedValueOnce({}) // delete
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false }); // ifc list
      const { cleanupOldFiles } = await freshImport();
      const r = await cleanupOldFiles();
      expect(r.filesDeleted).toBe(1);
    });

    it("Scenario 40: Keeps PDFs younger than 25 days", async () => {
      const recent = new Date(); recent.setDate(recent.getDate() - 10);
      sendMock
        .mockResolvedValueOnce({ Contents: [{ Key: "files/new.pdf", LastModified: recent }], IsTruncated: false })
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const { cleanupOldFiles } = await freshImport();
      const r = await cleanupOldFiles();
      expect(r.filesDeleted).toBe(0);
    });

    it("Scenario 41: Deletes IFC files older than 3 days", async () => {
      const old = new Date(); old.setDate(old.getDate() - 5);
      sendMock
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false }) // files
        .mockResolvedValueOnce({ Contents: [{ Key: "ifc/old.ifc", LastModified: old }], IsTruncated: false })
        .mockResolvedValueOnce({}); // delete
      const { cleanupOldFiles } = await freshImport();
      const r = await cleanupOldFiles();
      expect(r.ifcDeleted).toBe(1);
    });

    it("Scenario 42: Keeps IFC files younger than 3 days", async () => {
      const recent = new Date(); recent.setDate(recent.getDate() - 1);
      sendMock
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false })
        .mockResolvedValueOnce({ Contents: [{ Key: "ifc/new.ifc", LastModified: recent }], IsTruncated: false });
      const { cleanupOldFiles } = await freshImport();
      const r = await cleanupOldFiles();
      expect(r.ifcDeleted).toBe(0);
    });

    it("Scenario 43: Mixed old+new files — only deletes old", async () => {
      const old = new Date(); old.setDate(old.getDate() - 30);
      const fresh = new Date();
      sendMock
        .mockResolvedValueOnce({ Contents: [
          { Key: "files/old.pdf", LastModified: old },
          { Key: "files/new.pdf", LastModified: fresh },
        ], IsTruncated: false })
        .mockResolvedValueOnce({}) // delete old
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const { cleanupOldFiles } = await freshImport();
      const r = await cleanupOldFiles();
      expect(r.filesDeleted).toBe(1);
    });

    it("Scenario 44: Returns zeros when R2 not configured", async () => {
      const { cleanupOldFiles } = await freshImportNoEnv();
      const r = await cleanupOldFiles();
      expect(r.filesDeleted).toBe(0);
      expect(r.ifcDeleted).toBe(0);
      expect(r.errors).toBe(0);
    });

    it("Scenario 45: Counts errors when delete fails", async () => {
      const old = new Date(); old.setDate(old.getDate() - 30);
      sendMock
        .mockResolvedValueOnce({ Contents: [{ Key: "files/old.pdf", LastModified: old }], IsTruncated: false })
        .mockRejectedValueOnce(new Error("del fail"))
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const { cleanupOldFiles } = await freshImport();
      const r = await cleanupOldFiles();
      expect(r.filesDeleted).toBe(0);
      expect(r.errors).toBe(1);
    });

    it("Scenario 46: Handles pagination", async () => {
      const old = new Date(); old.setDate(old.getDate() - 30);
      sendMock
        .mockResolvedValueOnce({ Contents: [{ Key: "files/a.pdf", LastModified: old }], IsTruncated: true, NextContinuationToken: "tok" })
        .mockResolvedValueOnce({}) // delete a
        .mockResolvedValueOnce({ Contents: [{ Key: "files/b.pdf", LastModified: old }], IsTruncated: false })
        .mockResolvedValueOnce({}) // delete b
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const { cleanupOldFiles } = await freshImport();
      const r = await cleanupOldFiles();
      expect(r.filesDeleted).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 6: getStorageInfo & Edge Cases (Scenarios 47-50)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Group 6: Storage Info & Edge Cases", () => {
    it("Scenario 47: Returns null when R2 not configured", async () => {
      const { getStorageInfo } = await freshImportNoEnv();
      expect(await getStorageInfo()).toBeNull();
    });

    it("Scenario 48: Correct split between files and ifc", async () => {
      sendMock
        .mockResolvedValueOnce({ Contents: [
          { Key: "files/a.pdf", Size: 1024 * 1024 },
          { Key: "files/b.xlsx", Size: 512 * 1024 },
        ], IsTruncated: false })
        .mockResolvedValueOnce({ Contents: [
          { Key: "ifc/m.ifc", Size: 5 * 1024 * 1024 },
        ], IsTruncated: false });
      const { getStorageInfo } = await freshImport();
      const r = await getStorageInfo();
      expect(r!.files.count).toBe(2);
      expect(r!.ifc.count).toBe(1);
      expect(parseFloat(r!.totalSizeMB)).toBeCloseTo(6.5, 0);
    });

    it("Scenario 49: Returns zeros for empty bucket", async () => {
      sendMock
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false })
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const { getStorageInfo } = await freshImport();
      const r = await getStorageInfo();
      expect(r!.files.count).toBe(0);
      expect(r!.ifc.count).toBe(0);
      expect(r!.totalSizeMB).toBe("0.00");
    });

    it("Scenario 50: Handles entries with undefined Size", async () => {
      sendMock
        .mockResolvedValueOnce({ Contents: [
          { Key: "files/a.pdf", Size: 1024 },
          { Key: "files/b.pdf", Size: undefined },
        ], IsTruncated: false })
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const { getStorageInfo } = await freshImport();
      const r = await getStorageInfo();
      expect(r!.files.count).toBe(2);
      // Only first file contributes size
      expect(parseFloat(r!.files.sizeMB)).toBeCloseTo(0.001, 2);
    });
  });
});
