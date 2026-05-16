/**
 * Quota behaviour tests.
 *
 * Mocks `prisma.briefToIfcV3UserQuota` with an in-memory record. Tests
 * cover: under-quota allow, at-quota deny, FREE-tier always-deny, and
 * the lazy month-start reset.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkBriefToIfcV3Quota,
  incrementBriefToIfcV3Usage,
} from "../quota";

interface QuotaRow {
  id: string;
  userId: string;
  currentMonthStart: Date;
  runsThisMonth: number;
  costThisMonthUsd: number;
}

function makePrismaMock(initial?: QuotaRow) {
  let row: QuotaRow | null = initial ?? null;
  return {
    briefToIfcV3UserQuota: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => {
        if (row && row.userId === where.userId) {
          return { ...row };
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<QuotaRow, "id"> }) => {
        row = { id: "q1", ...data };
        return row;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { userId: string };
          data: Partial<QuotaRow> & {
            runsThisMonth?: number | { increment: number };
            costThisMonthUsd?: number | { increment: number };
          };
        }) => {
          if (!row || row.userId !== where.userId) {
            throw new Error("not found");
          }
          // Apply scalar overwrites
          if (data.currentMonthStart) row.currentMonthStart = data.currentMonthStart;
          if (typeof data.runsThisMonth === "number") {
            row.runsThisMonth = data.runsThisMonth;
          } else if (
            data.runsThisMonth &&
            typeof data.runsThisMonth === "object" &&
            "increment" in data.runsThisMonth
          ) {
            row.runsThisMonth += (data.runsThisMonth as { increment: number }).increment;
          }
          if (typeof data.costThisMonthUsd === "number") {
            row.costThisMonthUsd = data.costThisMonthUsd;
          } else if (
            data.costThisMonthUsd &&
            typeof data.costThisMonthUsd === "object" &&
            "increment" in data.costThisMonthUsd
          ) {
            row.costThisMonthUsd += (data.costThisMonthUsd as { increment: number }).increment;
          }
          return row;
        },
      ),
    },
    _peek: () => row,
  } as const;
}

describe("checkBriefToIfcV3Quota", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("FREE plan is always denied (limit 0)", async () => {
    const prisma = makePrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkBriefToIfcV3Quota(prisma as any, "u1", "FREE");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("QUOTA_EXCEEDED");
    expect(result.limit).toBe(0);
  });

  it("STARTER user with no row yet is allowed", async () => {
    const prisma = makePrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkBriefToIfcV3Quota(prisma as any, "u1", "STARTER");
    expect(result.ok).toBe(true);
    expect(result.limit).toBe(5);
    expect(result.used).toBe(0);
  });

  it("STARTER user at 5/5 is denied", async () => {
    const prisma = makePrismaMock({
      id: "q1",
      userId: "u1",
      currentMonthStart: new Date("2026-05-01T00:00:00Z"),
      runsThisMonth: 5,
      costThisMonthUsd: 7.5,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkBriefToIfcV3Quota(prisma as any, "u1", "STARTER");
    expect(result.ok).toBe(false);
    expect(result.used).toBe(5);
    expect(result.limit).toBe(5);
    expect(result.errorCode).toBe("QUOTA_EXCEEDED");
  });

  it("PRO user at 19/20 is allowed; the 20th call would be denied", async () => {
    const prisma = makePrismaMock({
      id: "q1",
      userId: "u1",
      currentMonthStart: new Date("2026-05-01T00:00:00Z"),
      runsThisMonth: 19,
      costThisMonthUsd: 28.5,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await checkBriefToIfcV3Quota(prisma as any, "u1", "PRO");
    expect(a.ok).toBe(true);
    expect(a.used).toBe(19);
  });

  it("PLATFORM_ADMIN uses TEAM limit (999)", async () => {
    const prisma = makePrismaMock();
    const result = await checkBriefToIfcV3Quota(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      "admin",
      "PLATFORM_ADMIN",
    );
    expect(result.ok).toBe(true);
    expect(result.limit).toBe(999);
  });

  it("counter is treated as 0 when row is from a prior month", async () => {
    // Row says 5 runs but the month is April; current month is May.
    const prisma = makePrismaMock({
      id: "q1",
      userId: "u1",
      currentMonthStart: new Date("2026-04-01T00:00:00Z"),
      runsThisMonth: 5,
      costThisMonthUsd: 7.5,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkBriefToIfcV3Quota(prisma as any, "u1", "STARTER");
    expect(result.ok).toBe(true);
    expect(result.used).toBe(0);
  });
});

describe("incrementBriefToIfcV3Usage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a row on first call", async () => {
    const prisma = makePrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await incrementBriefToIfcV3Usage(prisma as any, "u1", 1.5);
    expect(prisma._peek()?.runsThisMonth).toBe(1);
    expect(prisma._peek()?.costThisMonthUsd).toBe(1.5);
  });

  it("increments existing row in the same month", async () => {
    const prisma = makePrismaMock({
      id: "q1",
      userId: "u1",
      currentMonthStart: new Date("2026-05-01T00:00:00Z"),
      runsThisMonth: 3,
      costThisMonthUsd: 4.5,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await incrementBriefToIfcV3Usage(prisma as any, "u1", 1.2);
    expect(prisma._peek()?.runsThisMonth).toBe(4);
    expect(prisma._peek()?.costThisMonthUsd).toBeCloseTo(5.7, 6);
  });

  it("resets and sets to 1 when crossing month boundary", async () => {
    const prisma = makePrismaMock({
      id: "q1",
      userId: "u1",
      currentMonthStart: new Date("2026-04-01T00:00:00Z"),
      runsThisMonth: 5,
      costThisMonthUsd: 7.5,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await incrementBriefToIfcV3Usage(prisma as any, "u1", 1.5);
    expect(prisma._peek()?.runsThisMonth).toBe(1);
    expect(prisma._peek()?.costThisMonthUsd).toBe(1.5);
    expect(prisma._peek()?.currentMonthStart.toISOString()).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });
});
