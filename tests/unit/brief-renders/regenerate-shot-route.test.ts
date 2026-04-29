/**
 * /api/brief-renders/[jobId]/regenerate-shot integration tests.
 *
 * Mocks auth, canary, prisma, qstash, redis (idempotency cache + rate
 * limit). Verifies precondition checks, ownership 404, atomic reset,
 * idempotency-key replay, and dispatch failure handling.
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

// ─── Helpers ──────────────────────────────────────────────────────

function makeReq(
  body: Record<string, unknown> | string | null,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/brief-renders/job-1/regenerate-shot", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const SESSION = { user: { id: "user-A", email: "alice@example.com" } };

function makeShot(ai: number, si: number, status: string = "success") {
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

const params = { params: Promise.resolve({ jobId: "job-1" }) };

// ─── Tests ────────────────────────────────────────────────────────

describe("POST /api/brief-renders/:jobId/regenerate-shot", () => {
  it("401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await regenPOST(makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }), params);
    expect(res.status).toBe(401);
  });

  it("403 when canary returns false", async () => {
    canaryMock.mockReturnValueOnce(false);
    const res = await regenPOST(makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }), params);
    expect(res.status).toBe(403);
  });

  it("400 when body is invalid JSON", async () => {
    const res = await regenPOST(makeReq("{broken"), params);
    expect(res.status).toBe(400);
  });

  it("400 when body is missing fields", async () => {
    const res = await regenPOST(makeReq({ apartmentIndex: 0 }), params);
    expect(res.status).toBe(400);
  });

  it("429 when rate-limit exceeded", async () => {
    rateLimitMock.mockResolvedValueOnce({ success: false, remaining: 0 });
    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(429);
  });

  it("404 when job belongs to a different user", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(null);
    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(404);
  });

  it("409 when job status is not RUNNING/awaiting_compile or COMPLETED", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "AWAITING_APPROVAL",
      currentStage: null,
      shots: [makeShot(0, 0)],
    });
    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(409);
  });

  it("409 when RUNNING but currentStage is not awaiting_compile", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "rendering",
      shots: [makeShot(0, 0)],
    });
    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(409);
  });

  it("happy path: RUNNING + awaiting_compile → reset shot + dispatch worker", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      shots: [makeShot(0, 0), makeShot(0, 1)],
    });

    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 1 }),
      params,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("regeneration_dispatched");
    expect(body.apartmentIndex).toBe(0);
    expect(body.shotIndexInApartment).toBe(1);
    expect(prismaExecuteRawMock).toHaveBeenCalledTimes(1);
    expect(scheduleRenderWorkerMock).toHaveBeenCalledTimes(1);
    expect(scheduleRenderWorkerMock.mock.calls[0][1]).toEqual({
      apartmentIndex: 0,
      shotIndexInApartment: 1,
    });
  });

  it("happy path: COMPLETED → reverts to RUNNING+awaiting_compile, dispatches worker", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "COMPLETED",
      currentStage: "complete",
      shots: [makeShot(0, 0), makeShot(0, 1)],
    });

    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(200);
    expect(prismaExecuteRawMock).toHaveBeenCalledTimes(1);
    expect(scheduleRenderWorkerMock).toHaveBeenCalledTimes(1);
  });

  it("404 when shot indices don't exist in shots[]", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      shots: [makeShot(0, 0)],
    });
    const res = await regenPOST(
      makeReq({ apartmentIndex: 99, shotIndexInApartment: 99 }),
      params,
    );
    expect(res.status).toBe(404);
  });

  it("503 when QStash dispatch fails", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      shots: [makeShot(0, 0)],
    });
    scheduleRenderWorkerMock.mockRejectedValueOnce(new Error("qstash down"));

    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(503);
  });

  it("Idempotency-Key cache hit → returns cached response without re-dispatch", async () => {
    redisGetMock.mockResolvedValueOnce({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      status: "regeneration_dispatched",
    });

    const res = await regenPOST(
      makeReq(
        { apartmentIndex: 0, shotIndexInApartment: 0 },
        { "idempotency-key": "abc-123" },
      ),
      params,
    );
    expect(res.status).toBe(200);
    expect(prismaFindFirstMock).not.toHaveBeenCalled();
    expect(scheduleRenderWorkerMock).not.toHaveBeenCalled();
  });

  it("Idempotency-Key cache miss → executes + caches the response", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      shots: [makeShot(0, 0)],
    });
    redisGetMock.mockResolvedValueOnce(null);

    const res = await regenPOST(
      makeReq(
        { apartmentIndex: 0, shotIndexInApartment: 0 },
        { "idempotency-key": "fresh-key" },
      ),
      params,
    );
    expect(res.status).toBe(200);
    expect(redisSetMock).toHaveBeenCalledTimes(1);
    // The cached payload contains the response we sent.
    const cacheArgs = redisSetMock.mock.calls[0];
    expect(cacheArgs[1]).toMatchObject({
      jobId: "job-1",
      status: "regeneration_dispatched",
    });
  });

  it("409 when atomic reset returns count=0 (race lost)", async () => {
    prismaFindFirstMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      shots: [makeShot(0, 0)],
    });
    prismaExecuteRawMock.mockResolvedValueOnce(0); // race-loss

    const res = await regenPOST(
      makeReq({ apartmentIndex: 0, shotIndexInApartment: 0 }),
      params,
    );
    expect(res.status).toBe(409);
  });
});
