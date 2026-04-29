/**
 * POST /api/upload-brief — Phase 1 integration tests.
 *
 * Covers the validation order encoded in the route handler:
 *   1. Auth required
 *   2. Rate limit
 *   3. Missing file in form
 *   4. Wrong extension
 *   5. Oversized payload
 *   6. Magic-byte mismatch (renamed binary blob)
 *   7. Happy paths (PDF + DOCX)
 *
 * Strategy: import the route handler, mock its three external collaborators
 * (auth, rate-limit, r2 upload), and drive `POST` with NextRequest /
 * FormData fixtures. No HTTP server needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────

const authMock = vi.fn();
const rateLimitMock = vi.fn();
const uploadBriefToR2Mock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkEndpointRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock("@/lib/r2", () => ({
  uploadBriefToR2: (...args: unknown[]) => uploadBriefToR2Mock(...args),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]); // PK\x03\x04...
const GARBAGE = Buffer.from("not a real document at all");

function makeFile(name: string, body: Buffer): File {
  // Construct via Blob so File preserves both `name` and `size`. We don't
  // pass a `type` — the route classifies by extension only. The route
  // sets the upload contentType server-side based on the extension.
  //
  // The slice copy converts Buffer → ArrayBuffer-backed Uint8Array. Direct
  // `new File([buffer])` trips TS strict mode because Buffer's underlying
  // buffer can be SharedArrayBuffer, which isn't assignable to BlobPart.
  const view = new Uint8Array(body.byteLength);
  view.set(body);
  return new File([view], name);
}

async function loadRoute() {
  // Reset modules so each test gets a fresh handler with current mock state.
  vi.resetModules();
  return await import("@/app/api/upload-brief/route");
}

function makeFormDataRequest(file: File | null): NextRequest {
  const fd = new FormData();
  if (file) fd.append("file", file);
  // NextRequest extends Web's Request; the route only calls req.formData()
  // which Request supports. Constructing NextRequest directly keeps the
  // type signature exact — no `as any` casts at the call site.
  return new NextRequest("http://localhost/api/upload-brief", {
    method: "POST",
    body: fd,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("POST /api/upload-brief", () => {
  beforeEach(() => {
    authMock.mockReset();
    rateLimitMock.mockReset();
    uploadBriefToR2Mock.mockReset();

    // Sensible defaults — individual tests override.
    authMock.mockResolvedValue({ user: { id: "user-123", email: "alice@example.com" } });
    rateLimitMock.mockResolvedValue({ success: true });
    uploadBriefToR2Mock.mockResolvedValue({
      success: true,
      url: "https://r2.example/briefs/2026/04/28/abc-marx12.pdf",
      key: "briefs/2026/04/28/abc-marx12.pdf",
      size: 100,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const req = makeFormDataRequest(makeFile("brief.pdf", PDF_HEADER));
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("AUTH_001");
  });

  it("returns 429 when rate-limited", async () => {
    rateLimitMock.mockResolvedValueOnce({ success: false });
    const { POST } = await loadRoute();
    const req = makeFormDataRequest(makeFile("brief.pdf", PDF_HEADER));
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_001");
  });

  it("returns 400 when no file is supplied in the form", async () => {
    const { POST } = await loadRoute();
    const req = makeFormDataRequest(null);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    // UserErrors.MISSING_REQUIRED_FIELD => code VAL_004
    expect(body.error.code).toBe("VAL_004");
  });

  it("returns 400 for unsupported extension (.txt)", async () => {
    const { POST } = await loadRoute();
    const req = makeFormDataRequest(makeFile("notes.txt", PDF_HEADER));
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VAL_001");
    expect(body.error.title).toMatch(/invalid file type/i);
  });

  it("returns 413 for oversized payloads (> 50 MB)", async () => {
    const { POST } = await loadRoute();
    // Construct a buffer just past the 50 MB cap. Using the PDF magic at
    // the head so the size check fires before magic-byte validation.
    const big = Buffer.concat([PDF_HEADER, Buffer.alloc(50 * 1024 * 1024)]);
    const req = makeFormDataRequest(makeFile("huge.pdf", big));
    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("VAL_001");
    expect(body.error.message).toMatch(/50MB/);
  });

  it("returns 400 when a .pdf-renamed binary fails the magic-byte check", async () => {
    const { POST } = await loadRoute();
    const req = makeFormDataRequest(makeFile("fake.pdf", GARBAGE));
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VAL_001");
    expect(body.error.message).toMatch(/%PDF-/);
    // Upload must NOT have been attempted — refusing cheap before R2 call.
    expect(uploadBriefToR2Mock).not.toHaveBeenCalled();
  });

  it("returns 400 when a .docx-renamed binary fails the ZIP magic-byte check", async () => {
    const { POST } = await loadRoute();
    const req = makeFormDataRequest(makeFile("fake.docx", GARBAGE));
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VAL_001");
    expect(body.error.message).toMatch(/ZIP header/);
    expect(uploadBriefToR2Mock).not.toHaveBeenCalled();
  });

  it("uploads a valid PDF and returns 200 with briefUrl, fileName, fileSize, mimeType", async () => {
    const { POST } = await loadRoute();
    const file = makeFile("marx12.pdf", PDF_HEADER);
    const req = makeFormDataRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.briefUrl).toContain("briefs/");
    expect(body.fileName).toBe("marx12.pdf");
    expect(body.fileSize).toBe(file.size);
    expect(body.mimeType).toBe("application/pdf");

    // Confirm R2 was called with the correct content type — the route
    // sets it server-side regardless of whatever the browser supplied.
    expect(uploadBriefToR2Mock).toHaveBeenCalledTimes(1);
    const args = uploadBriefToR2Mock.mock.calls[0];
    expect(args[1]).toBe("marx12.pdf");
    expect(args[2]).toBe("application/pdf");
  });

  it("uploads a valid DOCX and returns 200 with the DOCX MIME type", async () => {
    uploadBriefToR2Mock.mockResolvedValueOnce({
      success: true,
      url: "https://r2.example/briefs/2026/04/28/xyz-marx12.docx",
      key: "briefs/2026/04/28/xyz-marx12.docx",
      size: ZIP_HEADER.length,
    });

    const { POST } = await loadRoute();
    const req = makeFormDataRequest(makeFile("marx12.docx", ZIP_HEADER));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.briefUrl).toContain(".docx");
    expect(body.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("returns 500 when the R2 upload fails (e.g. R2 misconfigured)", async () => {
    uploadBriefToR2Mock.mockResolvedValueOnce({
      success: false,
      error: "R2 not configured",
    });

    const { POST } = await loadRoute();
    const req = makeFormDataRequest(makeFile("brief.pdf", PDF_HEADER));
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("NET_001");
    expect(body.error.title).toMatch(/upload failed/i);
  });

  it("is case-insensitive on the file extension", async () => {
    const { POST } = await loadRoute();
    const req = makeFormDataRequest(makeFile("MARX12.PDF", PDF_HEADER));
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
