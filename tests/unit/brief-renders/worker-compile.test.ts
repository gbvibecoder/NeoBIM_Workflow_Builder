/**
 * /api/brief-renders/worker/compile QStash-callback tests.
 *
 * Mocks Stage 4, signature verification, Prisma. Mirrors the shape
 * of `worker-render.test.ts` (Phase 4) for auth + body + result-branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  verifySignatureMock,
  runStage4Mock,
  prismaFindUniqueMock,
} = vi.hoisted(() => ({
  verifySignatureMock: vi.fn(),
  runStage4Mock: vi.fn(),
  prismaFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/qstash", () => ({
  verifyQstashSignature: (...args: unknown[]) =>
    verifySignatureMock(...args),
}));

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/stage-4-pdf-compile",
  () => ({
    runStage4PdfCompile: (...args: unknown[]) => runStage4Mock(...args),
  }),
);

vi.mock("@/lib/db", () => ({
  prisma: {
    briefRenderJob: {
      findUnique: prismaFindUniqueMock,
    },
  },
}));

import { POST as workerPOST } from "@/app/api/brief-renders/worker/compile/route";

function makeReq(body: unknown, signature: string | null = "valid"): NextRequest {
  return new NextRequest("http://localhost/api/brief-renders/worker/compile", {
    method: "POST",
    headers: signature
      ? { "content-type": "application/json", "upstash-signature": signature }
      : { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  verifySignatureMock.mockReset().mockResolvedValue(true);
  runStage4Mock.mockReset();
  prismaFindUniqueMock.mockReset();
});

// ─── Auth + body ──────────────────────────────────────────────────

describe("POST /api/brief-renders/worker/compile — auth + body", () => {
  it("401 when QStash signature is invalid", async () => {
    verifySignatureMock.mockResolvedValueOnce(false);
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(401);
  });

  it("401 when signature header is missing (verify returns false)", async () => {
    verifySignatureMock.mockResolvedValueOnce(false);
    const res = await workerPOST(makeReq({ jobId: "job-1" }, null));
    expect(res.status).toBe(401);
  });

  it("400 on invalid JSON body", async () => {
    const res = await workerPOST(makeReq("{bad"));
    expect(res.status).toBe(400);
  });

  it("400 when jobId is missing", async () => {
    const res = await workerPOST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("404 when job not found", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(null);
    const res = await workerPOST(makeReq({ jobId: "nope" }));
    expect(res.status).toBe(404);
  });
});

// ─── Status guards ────────────────────────────────────────────────

describe("POST /api/brief-renders/worker/compile — status guards", () => {
  it("200 OK no-op when job is not RUNNING", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "CANCELLED",
      currentStage: "completed",
      stageLog: null,
    });
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(runStage4Mock).not.toHaveBeenCalled();
  });

  it("200 OK no-op when currentStage is not awaiting_compile|compiling", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "rendering",
      stageLog: null,
    });
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(runStage4Mock).not.toHaveBeenCalled();
  });

  it("RUNNING + awaiting_compile → invokes Stage 4", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      stageLog: null,
    });
    runStage4Mock.mockResolvedValueOnce({
      status: "success",
      pdfUrl: "https://r2/x.pdf",
      pageCount: 13,
      pdfSizeBytes: 1024,
      costUsd: 0,
    });
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(runStage4Mock).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.pdfUrl).toBe("https://r2/x.pdf");
  });

  it("RUNNING + compiling (retry case) → invokes Stage 4", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "compiling",
      stageLog: null,
    });
    runStage4Mock.mockResolvedValueOnce({
      status: "success",
      pdfUrl: "https://r2/x.pdf",
      pageCount: 13,
      pdfSizeBytes: 1024,
      costUsd: 0,
    });
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(runStage4Mock).toHaveBeenCalledTimes(1);
  });
});

// ─── Result branching ────────────────────────────────────────────

describe("POST /api/brief-renders/worker/compile — result branching", () => {
  it("Stage 4 returns failed → 500 (QStash will retry)", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      stageLog: null,
    });
    runStage4Mock.mockResolvedValueOnce({
      status: "failed",
      error: "image fetch failed",
    });
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("image fetch failed");
  });

  it("Stage 4 returns skipped → 200 (idempotent terminal)", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      currentStage: "awaiting_compile",
      stageLog: null,
    });
    runStage4Mock.mockResolvedValueOnce({
      status: "skipped",
      reason: "already_compiled",
    });
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("skipped");
    expect(body.reason).toBe("already_compiled");
  });
});

// ─── Production hard-fail ────────────────────────────────────────

describe("POST /api/brief-renders/worker/compile — security guard", () => {
  it("throws when SKIP_QSTASH_SIG_VERIFY=true in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SKIP_QSTASH_SIG_VERIFY", "true");
    try {
      await expect(workerPOST(makeReq({ jobId: "job-1" }))).rejects.toThrow(
        /SECURITY/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
