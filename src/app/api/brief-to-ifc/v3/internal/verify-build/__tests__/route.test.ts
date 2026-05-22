/**
 * Internal verify-build route tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth
vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve({ user: { id: "user-1" } }),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Set env
vi.stubEnv("NEOBIM_IFC_SERVICE_URL", "https://railway.example");

beforeEach(() => {
  mockFetch.mockReset();
});

describe("POST /api/brief-to-ifc/v3/internal/verify-build", () => {
  it("proxies to Railway and returns VerifierReport", async () => {
    const report = {
      verified: true,
      parts_coverage: 1.0,
      trim_coverage: 1.0,
      mismatches: [],
      summary: "All OK",
      verified_at: "2026-05-18T00:00:00Z",
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(report),
    });

    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/brief-to-ifc/v3/internal/verify-build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ifcUrl: "https://r2.example/test.ifc", spec: {} }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.verified).toBe(true);
  });

  it("returns 502 when Railway returns 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/brief-to-ifc/v3/internal/verify-build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ifcUrl: "https://r2.example/test.ifc", spec: {} }),
    });
    const res = await POST(req);

    expect(res.status).toBe(502);
  });

  it("returns 400 when ifcUrl missing", async () => {
    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/brief-to-ifc/v3/internal/verify-build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: {} }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
