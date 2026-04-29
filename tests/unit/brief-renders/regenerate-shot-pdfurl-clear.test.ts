/**
 * Phase 5 supplements to Phase 4's regenerate-shot tests.
 *
 * Asserts the COMPLETED→RUNNING revert ALSO clears the `pdfUrl`
 * column so a polling client doesn't see a stale download URL after
 * a regen.
 *
 * The revert path uses raw `$executeRaw` SQL — we assert by inspecting
 * the rendered SQL string for the `"pdfUrl" = NULL` clause (Prisma's
 * tagged-template rendering produces a `Sql` object whose `strings`
 * array contains the literal SQL fragments). Note the *quoted* camelCase
 * column name: bare `pdf_url` would throw Postgres 42703 because the
 * column was created via Prisma migration as a quoted camelCase
 * identifier. See `tests/unit/brief-renders/sql-column-quoting.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  canaryMock,
  rateLimitMock,
  scheduleRenderWorkerMock,
  prismaFindFirstMock,
  prismaExecuteRawMock,
  redisGetMock,
  redisSetMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  canaryMock: vi.fn(),
  rateLimitMock: vi.fn(),
  scheduleRenderWorkerMock: vi.fn(),
  prismaFindFirstMock: vi.fn(),
  prismaExecuteRawMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/canary",
  () => ({
    shouldUserSeeBriefRenders: (...args: unknown[]) => canaryMock(...args),
  }),
);

vi.mock("@/lib/rate-limit", () => ({
  redis: {
    get: redisGetMock,
    set: redisSetMock,
  },
  redisConfigured: true,
  checkEndpointRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock("@/lib/qstash", () => ({
  scheduleBriefRenderRenderWorker: (...args: unknown[]) =>
    scheduleRenderWorkerMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    briefRenderJob: { findFirst: prismaFindFirstMock },
    $executeRaw: prismaExecuteRawMock,
  },
}));

import { POST as regenPOST } from "@/app/api/brief-renders/[jobId]/regenerate-shot/route";

const SESSION = { user: { id: "user-A", email: "alice@example.com" } };
const params = { params: Promise.resolve({ jobId: "job-1" }) };

function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/brief-renders/job-1/regenerate-shot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeShot(ai: number, si: number, status = "success") {
  return {
    shotIndex: ai * 4 + si,
    apartmentIndex: ai,
    shotIndexInApartment: si,
    status,
    prompt: "p",
    aspectRatio: "3:2",
    templateVersion: "v1",
    imageUrl: status === "success" ? "https://r2/img.png" : null,
    errorMessage: null,
    costUsd: status === "success" ? 0.25 : null,
    createdAt: "2026-04-28T10:00:00Z",
    startedAt: null,
    completedAt: status === "success" ? "2026-04-28T10:01:00Z" : null,
  };
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(SESSION);
  canaryMock.mockReset().mockReturnValue(true);
  rateLimitMock.mockReset().mockResolvedValue({ success: true, remaining: 9 });
  scheduleRenderWorkerMock.mockReset().mockResolvedValue("msg-id");
  prismaFindFirstMock.mockReset();
  prismaExecuteRawMock.mockReset().mockResolvedValue(1);
  redisGetMock.mockReset().mockResolvedValue(null);
  redisSetMock.mockReset().mockResolvedValue("OK");
});

// ─── pdf_url clearing ────────────────────────────────────────────

describe("regenerate-shot — Phase 5 pdfUrl clearing", () => {
  it("COMPLETED job → revert SQL includes \"pdfUrl\" = NULL (quoted camelCase)", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "COMPLETED",
      currentStage: "completed",
      shots: [makeShot(0, 0)],
    });

    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(200);
    expect(prismaExecuteRawMock).toHaveBeenCalledTimes(1);

    // Prisma's $executeRaw tagged-template call signature is
    // (TemplateStringsArray, ...values). The first call argument has
    // a `strings` (or `raw`) field with the literal SQL fragments.
    const sqlArg = prismaExecuteRawMock.mock.calls[0][0];
    const fragments: string[] = Array.isArray(sqlArg)
      ? sqlArg
      : (sqlArg as { strings?: string[]; raw?: string[] })?.raw ??
        (sqlArg as { strings?: string[] })?.strings ??
        [];
    const joined = fragments.join("");
    expect(joined).toMatch(/"pdfUrl"\s*=\s*NULL/);
  });

  it("RUNNING + awaiting_compile job → revert SQL does NOT include \"pdfUrl\" = NULL", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      shots: [makeShot(0, 0)],
    });

    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(200);
    expect(prismaExecuteRawMock).toHaveBeenCalledTimes(1);

    const sqlArg = prismaExecuteRawMock.mock.calls[0][0];
    const fragments: string[] = Array.isArray(sqlArg)
      ? sqlArg
      : (sqlArg as { strings?: string[]; raw?: string[] })?.raw ??
        (sqlArg as { strings?: string[] })?.strings ??
        [];
    const joined = fragments.join("");
    expect(joined).not.toMatch(/"pdfUrl"\s*=\s*NULL/);
  });

  it("idempotency replay returns cached response (no SQL re-issued)", async () => {
    redisGetMock.mockResolvedValueOnce({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      status: "regeneration_dispatched",
    });
    const res = await regenPOST(
      new NextRequest("http://localhost/api/brief-renders/job-1/regenerate-shot", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "abc" },
        body: JSON.stringify({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(prismaExecuteRawMock).not.toHaveBeenCalled();
    expect(scheduleRenderWorkerMock).not.toHaveBeenCalled();
  });
});
