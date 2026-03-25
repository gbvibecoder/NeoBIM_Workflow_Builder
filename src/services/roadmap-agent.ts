import OpenAI from "openai";
import { prisma } from "@/lib/db";
import { NODE_NAMES } from "@/lib/admin-server";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoadmapTask {
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2" | "P3";
  effort: "XS" | "S" | "M" | "L" | "XL";
  category: "bug-fix" | "feature" | "improvement" | "infra" | "dx" | "ux";
  reasoning: string;
  linkedFeedbackIds: string[];
  sortOrder: number;
}

export interface RoadmapGeneration {
  summary: string;
  riskFlags: string[];
  quickWins: string[];
  tasks: RoadmapTask[];
  feedbackAnalysis: {
    totalAnalyzed: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    topThemes: string[];
  };
  metricsSnapshot: {
    totalUsers: number;
    totalWorkflows: number;
    totalExecutions: number;
    executionSuccessRate: number;
    usersThisWeek: number;
    execsThisWeek: number;
    feedbackThisWeek: number;
  };
}

// ─── Data Gathering ───────────────────────────────────────────────────────────

async function gatherPlatformData() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thisWeekStart = new Date(now);
  thisWeekStart.setHours(0, 0, 0, 0);
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay() + 1); // Monday

  const [
    allFeedback,
    totalUsers,
    totalWorkflows,
    totalExecutions,
    executionsByStatus,
    usersThisWeek,
    execsThisWeek,
    feedbackThisWeek,
    topNodes,
    recentExecutionErrors,
    previousRoadmaps,
  ] = await Promise.all([
    // All feedback (recent 200 to keep token limits manageable)
    prisma.feedback.findMany({
      take: 200,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true, role: true } } },
    }),
    prisma.user.count(),
    prisma.workflow.count(),
    prisma.execution.count(),
    prisma.execution.groupBy({ by: ["status"], _count: true }),
    prisma.user.count({ where: { createdAt: { gte: thisWeekStart } } }),
    prisma.execution.count({ where: { createdAt: { gte: thisWeekStart } } }),
    prisma.feedback.count({ where: { createdAt: { gte: thisWeekStart } } }),
    prisma.tileInstance.groupBy({
      by: ["tileType"],
      _count: true,
      orderBy: { _count: { tileType: "desc" } },
      take: 10,
    }),
    // Recent failed executions for error pattern analysis
    prisma.execution.findMany({
      where: { status: "FAILED", createdAt: { gte: sevenDaysAgo } },
      select: { errorMessage: true, createdAt: true },
      take: 30,
      orderBy: { createdAt: "desc" },
    }),
    // Previous roadmaps for continuity
    prisma.aiRoadmap.findMany({
      take: 3,
      orderBy: { createdAt: "desc" },
      include: {
        tasks: {
          select: { title: true, status: true, priority: true, category: true },
        },
      },
    }),
  ]);

  const successCount = executionsByStatus.find((s) => s.status === "SUCCESS")?._count ?? 0;
  const successRate = totalExecutions > 0 ? Math.round((successCount / totalExecutions) * 100) : 0;

  return {
    allFeedback,
    totalUsers,
    totalWorkflows,
    totalExecutions,
    successRate,
    usersThisWeek,
    execsThisWeek,
    feedbackThisWeek,
    topNodes: topNodes.map((n) => ({
      type: n.tileType,
      name: NODE_NAMES[n.tileType] || n.tileType,
      count: n._count,
    })),
    recentErrors: recentExecutionErrors
      .filter((e) => e.errorMessage)
      .map((e) => e.errorMessage!)
      .slice(0, 15),
    previousRoadmaps,
  };
}

// ─── Prompt Construction ──────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are the AI CTO Agent for BuildFlow — a visual workflow builder for BIM (Building Information Modeling). You combine the roles of CTO, lead developer, DevOps engineer, QA lead, UX researcher, and product manager.

Your job: analyze ALL platform data (user feedback, metrics, error patterns, usage data, past roadmap history) and generate a prioritized weekly roadmap with actionable tasks.

## Your Expertise
- BIM/AEC (Architecture, Engineering, Construction) domain knowledge
- Full-stack web development (Next.js, React, TypeScript, PostgreSQL)
- AI/ML integration (OpenAI, 3D generation, image processing)
- Infrastructure & DevOps (Vercel, Neon DB, Cloudflare R2, Upstash Redis)
- UX/UI design for professional tools
- Payment systems (Stripe, Razorpay)

## Decision Framework
1. **P0 (Critical)**: Data loss, auth failures, payment bugs, security vulnerabilities, >50% of users affected
2. **P1 (High)**: Major feature requests from multiple users, significant UX issues, performance degradation, reliability drops
3. **P2 (Medium)**: Feature improvements, nice-to-have features requested by users, developer experience
4. **P3 (Low)**: Polish, minor UI tweaks, documentation, technical debt that doesn't affect users

## Effort Scale
- **XS**: <2 hours (config change, copy fix, simple bug fix)
- **S**: 2-4 hours (small feature, straightforward bug fix)
- **M**: 4-8 hours (medium feature, complex bug fix)
- **L**: 1-2 days (significant feature, architecture change)
- **XL**: 3-5 days (major feature, infrastructure overhaul)

## Categories
- **bug-fix**: Fix a broken feature or error
- **feature**: New capability or feature
- **improvement**: Enhance existing feature
- **infra**: Infrastructure, performance, reliability
- **dx**: Developer experience, tooling, testing
- **ux**: User experience, UI, accessibility

## Rules
1. Generate 6-12 tasks per week — realistic, not aspirational
2. Always link tasks to specific feedback IDs when applicable
3. Consider what was deferred from previous roadmaps
4. Balance quick wins (XS/S) with meaningful progress (M/L)
5. Never ignore P0 items — they come first
6. Group related feedback into single tasks when they share root cause
7. Include at least 1 infra/reliability task per week
8. Consider the execution success rate — if dropping, prioritize stability
9. If user growth is spiking, prioritize onboarding and scalability
10. Be specific and actionable — no vague tasks like "improve performance"

## Output Format
Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "summary": "2-4 sentence weekly insight covering the state of the platform, key trends, and strategic direction",
  "riskFlags": ["specific risk 1", "specific risk 2"],
  "quickWins": ["quick win 1 that can be done in <2hrs", "quick win 2"],
  "tasks": [
    {
      "title": "Clear, actionable task title",
      "description": "Detailed description with acceptance criteria",
      "priority": "P0|P1|P2|P3",
      "effort": "XS|S|M|L|XL",
      "category": "bug-fix|feature|improvement|infra|dx|ux",
      "reasoning": "Why this task matters this week, referencing specific data",
      "linkedFeedbackIds": ["feedback_cuid_1", "feedback_cuid_2"],
      "sortOrder": 1
    }
  ]
}`;
}

function buildUserPrompt(data: Awaited<ReturnType<typeof gatherPlatformData>>) {
  const feedbackByStatus: Record<string, number> = {};
  const feedbackByType: Record<string, number> = {};
  data.allFeedback.forEach((f) => {
    feedbackByStatus[f.status] = (feedbackByStatus[f.status] || 0) + 1;
    feedbackByType[f.type] = (feedbackByType[f.type] || 0) + 1;
  });

  const feedbackList = data.allFeedback.map((f) => ({
    id: f.id,
    type: f.type,
    status: f.status,
    title: f.title,
    description: f.description.slice(0, 300),
    category: f.category,
    userRole: f.user?.role,
    createdAt: f.createdAt.toISOString().split("T")[0],
  }));

  const previousTasks = data.previousRoadmaps.flatMap((r) =>
    r.tasks.map((t) => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      weekOf: r.weekOf.toISOString().split("T")[0],
    }))
  );

  return `## Current Date: ${new Date().toISOString().split("T")[0]}

## Platform Metrics
- Total users: ${data.totalUsers}
- Total workflows: ${data.totalWorkflows}
- Total executions: ${data.totalExecutions}
- Execution success rate: ${data.successRate}%
- New users this week: ${data.usersThisWeek}
- Executions this week: ${data.execsThisWeek}
- New feedback this week: ${data.feedbackThisWeek}

## Top Used Nodes
${data.topNodes.map((n) => `- ${n.name} (${n.type}): ${n.count} instances`).join("\n")}

## Feedback Summary
- Total feedback items: ${data.allFeedback.length}
- By status: ${JSON.stringify(feedbackByStatus)}
- By type: ${JSON.stringify(feedbackByType)}

## All Feedback Items
${JSON.stringify(feedbackList, null, 1)}

## Recent Execution Errors (last 7 days)
${data.recentErrors.length > 0 ? data.recentErrors.map((e) => `- ${e}`).join("\n") : "No recent errors"}

## Previous Roadmap Tasks (for continuity)
${previousTasks.length > 0
    ? JSON.stringify(previousTasks, null, 1)
    : "No previous roadmaps — this is the first generation"}

---

Analyze all of the above data and generate this week's roadmap. Remember: be specific, actionable, and link to feedback IDs where applicable. Prioritize based on user impact and platform health.`;
}

// ─── Main Agent Function ──────────────────────────────────────────────────────

export async function generateWeeklyRoadmap(): Promise<RoadmapGeneration> {
  const data = await gatherPlatformData();

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000,
    maxRetries: 2,
  });

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(data) },
    ],
    temperature: 0.4,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned empty response");
  }

  let parsed: {
    summary: string;
    riskFlags: string[];
    quickWins: string[];
    tasks: RoadmapTask[];
  };

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  // Validate structure
  if (!parsed.summary || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("AI response missing required fields (summary, tasks)");
  }

  // Build feedback analysis
  const feedbackByStatus: Record<string, number> = {};
  const feedbackByType: Record<string, number> = {};
  data.allFeedback.forEach((f) => {
    feedbackByStatus[f.status] = (feedbackByStatus[f.status] || 0) + 1;
    feedbackByType[f.type] = (feedbackByType[f.type] || 0) + 1;
  });

  // Extract top themes from task categories/titles
  const themes = [...new Set(parsed.tasks.map((t) => t.category))];

  return {
    summary: parsed.summary,
    riskFlags: parsed.riskFlags || [],
    quickWins: parsed.quickWins || [],
    tasks: parsed.tasks.map((t, i) => ({
      ...t,
      sortOrder: t.sortOrder ?? i + 1,
      linkedFeedbackIds: t.linkedFeedbackIds || [],
    })),
    feedbackAnalysis: {
      totalAnalyzed: data.allFeedback.length,
      byType: feedbackByType,
      byStatus: feedbackByStatus,
      topThemes: themes,
    },
    metricsSnapshot: {
      totalUsers: data.totalUsers,
      totalWorkflows: data.totalWorkflows,
      totalExecutions: data.totalExecutions,
      executionSuccessRate: data.successRate,
      usersThisWeek: data.usersThisWeek,
      execsThisWeek: data.execsThisWeek,
      feedbackThisWeek: data.feedbackThisWeek,
    },
  };
}
