/**
 * 🔥 ANALYTICS GOAT - Comprehensive Event Tracking
 * Tracks EVERYTHING users do. No event left behind.
 */

import { prisma } from "./db";

// ============================================================
// EVENT TYPES
// ============================================================

export type AnalyticsEvent =
  // Auth Events
  | "user_signup"
  | "user_login"
  | "user_logout"
  | "user_deleted"
  
  // Workflow Events
  | "workflow_created"
  | "workflow_updated"
  | "workflow_deleted"
  | "workflow_first_created"
  | "workflow_published"
  | "workflow_cloned"
  
  // Execution Events
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "execution_first_run"
  
  // Rate Limit Events
  | "rate_limit_hit"
  | "rate_limit_free_tier"
  
  // Billing Events
  | "upgrade_clicked"
  | "payment_initiated"
  | "payment_completed"
  | "payment_failed"
  | "subscription_created"
  | "subscription_cancelled"
  
  // Engagement Events
  | "api_key_created"
  | "api_key_deleted"
  | "template_viewed"
  | "template_used"
  | "community_visited"
  | "settings_updated";

export interface AnalyticsEventData {
  userId?: string;
  eventName: AnalyticsEvent;
  properties?: Record<string, unknown>;
  timestamp?: Date;
  source?: "organic" | "producthunt" | "reddit" | "email" | "twitter" | "direct" | "other";
  sessionId?: string;
}

export interface EventRecord extends AnalyticsEventData {
  id: string;
  timestamp: Date;
}

// ============================================================
// CORE TRACKING FUNCTIONS
// ============================================================

export async function trackEvent(data: AnalyticsEventData): Promise<void> {
  try {
    const event: EventRecord = {
      id: crypto.randomUUID(),
      timestamp: data.timestamp || new Date(),
      ...data,
    };

    await writeEventToLog(event);

    if (data.userId) {
      await updateUserMetrics(data.userId);
    }

  } catch (error) {
    console.error("Analytics error:", error);
  }
}

export async function trackSignup(userId: string, source?: AnalyticsEventData["source"]): Promise<void> {
  await trackEvent({ userId, eventName: "user_signup", source: source || "organic" });
}

export async function trackLogin(userId: string): Promise<void> {
  await trackEvent({ userId, eventName: "user_login" });
}

export async function trackFirstWorkflow(userId: string, workflowId: string): Promise<void> {
  const count = await prisma.workflow.count({ where: { ownerId: userId } });
  if (count === 1) {
    await trackEvent({ userId, eventName: "workflow_first_created", properties: { workflowId } });
  }
  await trackEvent({ userId, eventName: "workflow_created", properties: { workflowId } });
}

export async function trackFirstExecution(userId: string, executionId: string): Promise<void> {
  const count = await prisma.execution.count({ where: { userId } });
  if (count === 1) {
    await trackEvent({ userId, eventName: "execution_first_run", properties: { executionId } });
  }
  await trackEvent({ userId, eventName: "execution_started", properties: { executionId } });
}

export async function trackRateLimitHit(userId: string | undefined, endpoint: string, userRole?: string): Promise<void> {
  await trackEvent({
    userId,
    eventName: userRole === "FREE" ? "rate_limit_free_tier" : "rate_limit_hit",
    properties: { endpoint, userRole },
  });
}

export async function trackUpgradeClick(userId: string, location: string): Promise<void> {
  await trackEvent({ userId, eventName: "upgrade_clicked", properties: { location } });
}

export async function trackPaymentCompleted(userId: string, amount: number, plan: string): Promise<void> {
  await trackEvent({ userId, eventName: "payment_completed", properties: { amount, plan, currency: "USD" } });
}

// ============================================================
// HELPERS
// ============================================================

async function writeEventToLog(event: EventRecord): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const logDir = path.join(process.cwd(), "analytics-logs");
  const today = new Date().toISOString().split("T")[0];
  const logFile = path.join(logDir, `events-${today}.jsonl`);

  try {
    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(logFile, JSON.stringify(event) + "\n", "utf-8");
  } catch (error) {
    console.error("Log write error:", error);
  }
}

async function updateUserMetrics(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { apiKeys: true } });
    if (!user) return;

    const metadata = (user.apiKeys as Record<string, unknown>) || {};
    const analytics = (metadata._analytics || { totalEvents: 0, lastActivity: null }) as { totalEvents: number; lastActivity: string | null };
    analytics.totalEvents += 1;
    analytics.lastActivity = new Date().toISOString();
    metadata._analytics = analytics;

    await prisma.user.update({ where: { id: userId }, data: { apiKeys: metadata as object } });
  } catch (error) {
    console.error("Metrics update error:", error);
  }
}

// ============================================================
// DASHBOARD METRICS
// ============================================================

export interface DashboardMetrics {
  signupsToday: number;
  activeUsers7d: number;
  totalWorkflows: number;
  totalExecutions: number;
  revenue: number;
  conversionRate: number;
  topSources: Array<{ source: string; count: number }>;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [signupsToday, activeUsers7d, totalWorkflows, totalExecutions, paidUsers, totalUsers] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { updatedAt: { gte: sevenDaysAgo } } }),
    prisma.workflow.count(),
    prisma.execution.count(),
    prisma.user.count({ where: { role: { in: ["PRO", "TEAM_ADMIN"] } } }),
    prisma.user.count(),
  ]);

  const topSources = await getTopSources();
  const revenue = paidUsers * 79;
  const conversionRate = totalUsers > 0 ? (paidUsers / totalUsers) * 100 : 0;

  return { signupsToday, activeUsers7d, totalWorkflows, totalExecutions, revenue, conversionRate, topSources };
}

async function getTopSources(): Promise<Array<{ source: string; count: number }>> {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const logDir = path.join(process.cwd(), "analytics-logs");
    const files = await fs.readdir(logDir);
    const sources = new Map<string, number>();

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const content = await fs.readFile(path.join(logDir, file), "utf-8");
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.eventName === "user_signup" && event.source) {
            sources.set(event.source, (sources.get(event.source) || 0) + 1);
          }
        } catch {}
      }
    }

    return Array.from(sources.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function generateDailyReport(): Promise<string> {
  const metrics = await getDashboardMetrics();
  const dayNumber = Math.floor((Date.now() - new Date("2026-03-05").getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return `📊 Day ${dayNumber} Report:
✅ ${metrics.signupsToday} signups today
👥 ${metrics.activeUsers7d} active users (7-day)
🔧 ${metrics.totalWorkflows} workflows created
⚡ ${metrics.totalExecutions} executions run
💰 $${metrics.revenue} revenue (MRR)
📈 ${metrics.conversionRate.toFixed(1)}% conversion rate

Top Sources:
${metrics.topSources.map((s, i) => `${i + 1}. ${s.source}: ${s.count}`).join("\n")}`;
}
