import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Use vi.hoisted to declare mocks before hoisting ─────────────────────────
const { mockPrisma, mockMkdir, mockAppendFile, mockReaddir, mockReadFile } =
  vi.hoisted(() => {
    const mockMkdir = vi.fn().mockResolvedValue(undefined);
    const mockAppendFile = vi.fn().mockResolvedValue(undefined);
    const mockReaddir = vi.fn().mockResolvedValue([]);
    const mockReadFile = vi.fn().mockResolvedValue("");

    return {
      mockPrisma: {
        user: {
          findUnique: vi.fn(),
          update: vi.fn(),
          count: vi.fn(),
        },
        workflow: {
          count: vi.fn(),
        },
        execution: {
          count: vi.fn(),
        },
      },
      mockMkdir,
      mockAppendFile,
      mockReaddir,
      mockReadFile,
    };
  });

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("fs/promises", () => ({
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    appendFile: (...args: unknown[]) => mockAppendFile(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  appendFile: (...args: unknown[]) => mockAppendFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import {
  trackEvent,
  trackSignup,
  trackLogin,
  trackFirstWorkflow,
  trackFirstExecution,
  trackRateLimitHit,
  trackUpgradeClick,
  trackPaymentCompleted,
  getDashboardMetrics,
  generateDailyReport,
} from "@/lib/analytics";

describe("Analytics — Core Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.workflow.count.mockResolvedValue(0);
    mockPrisma.execution.count.mockResolvedValue(0);
  });

  // ─── trackEvent ──────────────────────────────────────────────────────────────

  describe("trackEvent", () => {
    it("should write event to log file", async () => {
      await trackEvent({ eventName: "user_login", userId: "u1" });

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockAppendFile).toHaveBeenCalled();
      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.eventName).toBe("user_login");
      expect(parsed.userId).toBe("u1");
      expect(parsed.id).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    });

    it("should update user metrics when userId is provided", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ apiKeys: {} });
      await trackEvent({ eventName: "user_login", userId: "u1" });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "u1" } })
      );
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it("should not update user metrics when userId is missing", async () => {
      await trackEvent({ eventName: "user_login" });

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("should not throw on log write error", async () => {
      mockMkdir.mockRejectedValueOnce(new Error("disk full"));
      await expect(
        trackEvent({ eventName: "user_login", userId: "u1" })
      ).resolves.toBeUndefined();
    });

    it("should not throw when user not found during metrics update", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        trackEvent({ eventName: "user_login", userId: "nonexistent" })
      ).resolves.toBeUndefined();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it("should use provided timestamp instead of generating one", async () => {
      const ts = new Date("2026-01-01T00:00:00Z");
      await trackEvent({ eventName: "user_login", timestamp: ts });

      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.timestamp).toBe(ts.toISOString());
    });

    it("should increment totalEvents in user analytics metadata", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        apiKeys: { _analytics: { totalEvents: 5, lastActivity: null } },
      });
      await trackEvent({ eventName: "user_login", userId: "u1" });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      const analytics = (updateCall.data.apiKeys as Record<string, unknown>)
        ._analytics as { totalEvents: number };
      expect(analytics.totalEvents).toBe(6);
    });

    it("should initialize analytics metadata if not present", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ apiKeys: null });
      await trackEvent({ eventName: "user_login", userId: "u1" });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      const analytics = (updateCall.data.apiKeys as Record<string, unknown>)
        ._analytics as { totalEvents: number };
      expect(analytics.totalEvents).toBe(1);
    });

    it("should not throw when prisma update fails", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ apiKeys: {} });
      mockPrisma.user.update.mockRejectedValueOnce(new Error("db error"));
      await expect(
        trackEvent({ eventName: "user_login", userId: "u1" })
      ).resolves.toBeUndefined();
    });
  });

  // ─── Convenience trackers ─────────────────────────────────────────────────────

  describe("trackSignup", () => {
    it("should track user_signup event with organic source by default", async () => {
      await trackSignup("u1");
      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.eventName).toBe("user_signup");
      expect(parsed.source).toBe("organic");
    });

    it("should track user_signup with custom source", async () => {
      await trackSignup("u1", "producthunt");
      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.source).toBe("producthunt");
    });
  });

  describe("trackLogin", () => {
    it("should track user_login event", async () => {
      await trackLogin("u1");
      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.eventName).toBe("user_login");
      expect(parsed.userId).toBe("u1");
    });
  });

  describe("trackFirstWorkflow", () => {
    it("should emit workflow_first_created when count is 1", async () => {
      mockPrisma.workflow.count.mockResolvedValue(1);
      await trackFirstWorkflow("u1", "wf-1");

      // Two events should be written: first_created + created
      expect(mockAppendFile).toHaveBeenCalledTimes(2);
      const firstLine = mockAppendFile.mock.calls[0][1] as string;
      const secondLine = mockAppendFile.mock.calls[1][1] as string;
      expect(JSON.parse(firstLine.trim()).eventName).toBe(
        "workflow_first_created"
      );
      expect(JSON.parse(secondLine.trim()).eventName).toBe("workflow_created");
    });

    it("should only emit workflow_created when count > 1", async () => {
      mockPrisma.workflow.count.mockResolvedValue(5);
      await trackFirstWorkflow("u1", "wf-5");

      expect(mockAppendFile).toHaveBeenCalledTimes(1);
      const line = mockAppendFile.mock.calls[0][1] as string;
      expect(JSON.parse(line.trim()).eventName).toBe("workflow_created");
    });

    it("should pass workflowId in properties", async () => {
      mockPrisma.workflow.count.mockResolvedValue(3);
      await trackFirstWorkflow("u1", "wf-abc");

      const line = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(line.trim());
      expect(parsed.properties.workflowId).toBe("wf-abc");
    });
  });

  describe("trackFirstExecution", () => {
    it("should emit execution_first_run when count is 1", async () => {
      mockPrisma.execution.count.mockResolvedValue(1);
      await trackFirstExecution("u1", "exec-1");

      expect(mockAppendFile).toHaveBeenCalledTimes(2);
      const firstLine = mockAppendFile.mock.calls[0][1] as string;
      expect(JSON.parse(firstLine.trim()).eventName).toBe(
        "execution_first_run"
      );
    });

    it("should only emit execution_started when count > 1", async () => {
      mockPrisma.execution.count.mockResolvedValue(10);
      await trackFirstExecution("u1", "exec-10");

      expect(mockAppendFile).toHaveBeenCalledTimes(1);
      const line = mockAppendFile.mock.calls[0][1] as string;
      expect(JSON.parse(line.trim()).eventName).toBe("execution_started");
    });

    it("should pass executionId in properties", async () => {
      mockPrisma.execution.count.mockResolvedValue(2);
      await trackFirstExecution("u1", "exec-abc");

      const line = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(line.trim());
      expect(parsed.properties.executionId).toBe("exec-abc");
    });
  });

  describe("trackRateLimitHit", () => {
    it("should track rate_limit_free_tier for FREE users", async () => {
      await trackRateLimitHit("u1", "execute-node", "FREE");

      const line = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(line.trim());
      expect(parsed.eventName).toBe("rate_limit_free_tier");
      expect(parsed.properties.endpoint).toBe("execute-node");
      expect(parsed.properties.userRole).toBe("FREE");
    });

    it("should track rate_limit_hit for non-FREE users", async () => {
      await trackRateLimitHit("u1", "execute-node", "PRO");

      const line = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(line.trim());
      expect(parsed.eventName).toBe("rate_limit_hit");
    });

    it("should track rate_limit_hit when no userRole provided", async () => {
      await trackRateLimitHit("u1", "execute-node");

      const line = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(line.trim());
      expect(parsed.eventName).toBe("rate_limit_hit");
    });

    it("should allow undefined userId", async () => {
      await trackRateLimitHit(undefined, "execute-node", "FREE");

      const line = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(line.trim());
      expect(parsed.userId).toBeUndefined();
    });
  });

  describe("trackUpgradeClick", () => {
    it("should track upgrade_clicked with location", async () => {
      await trackUpgradeClick("u1", "rate-limit-banner");

      const line = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(line.trim());
      expect(parsed.eventName).toBe("upgrade_clicked");
      expect(parsed.properties.location).toBe("rate-limit-banner");
    });
  });

  describe("trackPaymentCompleted", () => {
    it("should track payment_completed with amount and plan", async () => {
      await trackPaymentCompleted("u1", 79, "pro");

      const line = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(line.trim());
      expect(parsed.eventName).toBe("payment_completed");
      expect(parsed.properties.amount).toBe(79);
      expect(parsed.properties.plan).toBe("pro");
      expect(parsed.properties.currency).toBe("USD");
    });
  });
});

// ─── Dashboard Metrics ──────────────────────────────────────────────────────

describe("Analytics — Dashboard Metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getDashboardMetrics", () => {
    it("should aggregate counts from prisma", async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(5) // signupsToday
        .mockResolvedValueOnce(25) // activeUsers7d
        .mockResolvedValueOnce(3) // paidUsers
        .mockResolvedValueOnce(100); // totalUsers
      mockPrisma.workflow.count.mockResolvedValue(50);
      mockPrisma.execution.count.mockResolvedValue(200);
      mockReaddir.mockResolvedValue([]);

      const metrics = await getDashboardMetrics();

      expect(metrics.signupsToday).toBe(5);
      expect(metrics.activeUsers7d).toBe(25);
      expect(metrics.totalWorkflows).toBe(50);
      expect(metrics.totalExecutions).toBe(200);
      expect(metrics.revenue).toBe(3 * 79);
      expect(metrics.conversionRate).toBeCloseTo(3, 0);
    });

    it("should return 0 conversion rate when no users", async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.workflow.count.mockResolvedValue(0);
      mockPrisma.execution.count.mockResolvedValue(0);
      mockReaddir.mockResolvedValue([]);

      const metrics = await getDashboardMetrics();

      expect(metrics.conversionRate).toBe(0);
    });

    it("should return topSources from log files", async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.workflow.count.mockResolvedValue(0);
      mockPrisma.execution.count.mockResolvedValue(0);

      mockReaddir.mockResolvedValue(["events-2026-03-10.jsonl"]);
      mockReadFile.mockResolvedValue(
        [
          JSON.stringify({
            eventName: "user_signup",
            source: "producthunt",
          }),
          JSON.stringify({
            eventName: "user_signup",
            source: "producthunt",
          }),
          JSON.stringify({ eventName: "user_signup", source: "reddit" }),
          JSON.stringify({ eventName: "user_login", source: "direct" }),
        ].join("\n")
      );

      const metrics = await getDashboardMetrics();

      expect(metrics.topSources.length).toBeGreaterThanOrEqual(1);
      expect(metrics.topSources[0].source).toBe("producthunt");
      expect(metrics.topSources[0].count).toBe(2);
    });

    it("should handle empty log directory gracefully", async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.workflow.count.mockResolvedValue(0);
      mockPrisma.execution.count.mockResolvedValue(0);
      mockReaddir.mockRejectedValue(new Error("ENOENT"));

      const metrics = await getDashboardMetrics();
      expect(metrics.topSources).toEqual([]);
    });

    it("should ignore non-jsonl files", async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.workflow.count.mockResolvedValue(0);
      mockPrisma.execution.count.mockResolvedValue(0);
      mockReaddir.mockResolvedValue(["readme.txt", ".DS_Store"]);

      const metrics = await getDashboardMetrics();
      expect(metrics.topSources).toEqual([]);
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("should handle malformed JSONL lines gracefully", async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.workflow.count.mockResolvedValue(0);
      mockPrisma.execution.count.mockResolvedValue(0);
      mockReaddir.mockResolvedValue(["events-2026-03-10.jsonl"]);
      mockReadFile.mockResolvedValue(
        "not-valid-json\n" +
          JSON.stringify({ eventName: "user_signup", source: "email" })
      );

      const metrics = await getDashboardMetrics();
      expect(metrics.topSources).toEqual([{ source: "email", count: 1 }]);
    });

    it("should limit topSources to 5 entries", async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.workflow.count.mockResolvedValue(0);
      mockPrisma.execution.count.mockResolvedValue(0);
      mockReaddir.mockResolvedValue(["events-2026-03-10.jsonl"]);

      const sources = [
        "organic",
        "producthunt",
        "reddit",
        "email",
        "twitter",
        "direct",
        "other",
      ];
      const lines = sources
        .map((s) => JSON.stringify({ eventName: "user_signup", source: s }))
        .join("\n");
      mockReadFile.mockResolvedValue(lines);

      const metrics = await getDashboardMetrics();
      expect(metrics.topSources.length).toBeLessThanOrEqual(5);
    });
  });

  describe("generateDailyReport", () => {
    it("should return a formatted report string", async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(2) // signupsToday
        .mockResolvedValueOnce(10) // activeUsers7d
        .mockResolvedValueOnce(1) // paidUsers
        .mockResolvedValueOnce(20); // totalUsers
      mockPrisma.workflow.count.mockResolvedValue(15);
      mockPrisma.execution.count.mockResolvedValue(30);
      mockReaddir.mockResolvedValue([]);

      const report = await generateDailyReport();

      expect(report).toContain("Day");
      expect(report).toContain("2 signups today");
      expect(report).toContain("10 active users");
      expect(report).toContain("15 workflows created");
      expect(report).toContain("30 executions run");
      expect(report).toContain("$79 revenue");
      expect(report).toContain("conversion rate");
      expect(report).toContain("Top Sources");
    });
  });
});
