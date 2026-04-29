/**
 * Stage-log persister tests.
 *
 * The persister is a thin wrapper around `prisma.briefRenderJob.update`.
 * Tests verify shape + error propagation + concurrent-call semantics.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  createStageLogPersister,
  readStageLog,
} from "@/features/brief-renders/services/brief-pipeline/stage-log-store";
import type { BriefStageLogEntry } from "@/features/brief-renders/services/brief-pipeline/types";

function makePrismaMock() {
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockResolvedValue(null);
  const prisma = {
    briefRenderJob: { update, findUnique },
  } as unknown as PrismaClient;
  return { prisma, update, findUnique };
}

const SAMPLE_ENTRY: BriefStageLogEntry = {
  stage: 1,
  name: "Spec Extract",
  status: "success",
  startedAt: "2026-04-28T10:00:00.000Z",
  completedAt: "2026-04-28T10:00:05.000Z",
  durationMs: 5000,
  costUsd: 0.045,
  summary: "12 shots",
  output: { shotCount: 12 },
  error: null,
};

// ─── createStageLogPersister ───────────────────────────────────────

describe("createStageLogPersister", () => {
  let mocks: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    mocks = makePrismaMock();
  });

  it("calls prisma.briefRenderJob.update once with the bound jobId and entries", async () => {
    const persister = createStageLogPersister("job-abc", mocks.prisma);
    await persister([SAMPLE_ENTRY]);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "job-abc" },
      data: { stageLog: [SAMPLE_ENTRY] },
    });
  });

  it("accepts an empty array", async () => {
    const persister = createStageLogPersister("job-empty", mocks.prisma);
    await persister([]);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "job-empty" },
      data: { stageLog: [] },
    });
  });

  it("propagates prisma errors (does not swallow)", async () => {
    mocks.update.mockRejectedValueOnce(new Error("DB connection lost"));
    const persister = createStageLogPersister("job-err", mocks.prisma);
    await expect(persister([SAMPLE_ENTRY])).rejects.toThrow("DB connection lost");
  });

  it("supports rapid back-to-back calls (no shared state between persisters)", async () => {
    const persister = createStageLogPersister("job-rapid", mocks.prisma);
    await Promise.all([
      persister([SAMPLE_ENTRY]),
      persister([SAMPLE_ENTRY, { ...SAMPLE_ENTRY, stage: 2 }]),
      persister([
        SAMPLE_ENTRY,
        { ...SAMPLE_ENTRY, stage: 2 },
        { ...SAMPLE_ENTRY, stage: 3 },
      ]),
    ]);
    expect(mocks.update).toHaveBeenCalledTimes(3);
    // Each call's entries length grows — last write wins on the DB side.
    const calls = mocks.update.mock.calls;
    expect((calls[0][0].data.stageLog as BriefStageLogEntry[]).length).toBe(1);
    expect((calls[2][0].data.stageLog as BriefStageLogEntry[]).length).toBe(3);
  });

  it("two persisters bound to different jobIds write to different rows", async () => {
    const persisterA = createStageLogPersister("job-A", mocks.prisma);
    const persisterB = createStageLogPersister("job-B", mocks.prisma);
    await persisterA([SAMPLE_ENTRY]);
    await persisterB([SAMPLE_ENTRY]);

    expect(mocks.update.mock.calls[0][0].where.id).toBe("job-A");
    expect(mocks.update.mock.calls[1][0].where.id).toBe("job-B");
  });
});

// ─── readStageLog ──────────────────────────────────────────────────

describe("readStageLog", () => {
  let mocks: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    mocks = makePrismaMock();
  });

  it("returns [] when the row is missing", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    const result = await readStageLog("nope", mocks.prisma);
    expect(result).toEqual([]);
  });

  it("returns [] when stageLog is null", async () => {
    mocks.findUnique.mockResolvedValueOnce({ stageLog: null });
    const result = await readStageLog("j", mocks.prisma);
    expect(result).toEqual([]);
  });

  it("returns the parsed array when stageLog is well-shaped", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      stageLog: [SAMPLE_ENTRY, { ...SAMPLE_ENTRY, stage: 2 }],
    });
    const result = await readStageLog("j", mocks.prisma);
    expect(result.length).toBe(2);
    expect(result[0].stage).toBe(1);
    expect(result[1].stage).toBe(2);
  });

  it("filters out entries that don't have a numeric `stage` field", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      stageLog: [
        SAMPLE_ENTRY,
        { foo: "bar" }, // garbage from a prior schema version
        null,
        { stage: "not-a-number" },
      ],
    });
    const result = await readStageLog("j", mocks.prisma);
    expect(result.length).toBe(1);
    expect(result[0].stage).toBe(1);
  });
});
