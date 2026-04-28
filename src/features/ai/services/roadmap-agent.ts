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
  const thisWeekStart = new Date(now);
  thisWeekStart.setHours(0, 0, 0, 0);
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay() + 1);

  const [
    allFeedback,
    totalUsers,
    usersByRole,
    totalWorkflows,
    totalExecutions,
    executionsByStatus,
    usersThisWeek,
    execsThisWeek,
    feedbackThisWeek,
    topNodes,
    recentExecutionErrors,
    previousRoadmaps,
    paidUsers,
    publishedWorkflows,
    communityPubs,
  ] = await Promise.all([
    prisma.feedback.findMany({
      take: 200,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true, role: true } } },
    }),
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: true }),
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
      take: 15,
    }),
    prisma.execution.findMany({
      where: { status: "FAILED", createdAt: { gte: sevenDaysAgo } },
      select: { errorMessage: true, createdAt: true },
      take: 30,
      orderBy: { createdAt: "desc" },
    }),
    prisma.aiRoadmap.findMany({
      take: 3,
      orderBy: { createdAt: "desc" },
      include: {
        tasks: {
          select: { title: true, status: true, priority: true, category: true },
        },
      },
    }),
    prisma.user.count({
      where: {
        role: { in: ["MINI", "STARTER", "PRO", "TEAM_ADMIN"] },
        OR: [
          { stripeSubscriptionId: { not: null } },
          { razorpaySubscriptionId: { not: null } },
        ],
      },
    }),
    prisma.workflow.count({ where: { isPublished: true } }),
    prisma.communityPublication.count(),
  ]);

  const successCount = executionsByStatus.find((s) => s.status === "SUCCESS")?._count ?? 0;
  const failedCount = executionsByStatus.find((s) => s.status === "FAILED")?._count ?? 0;
  const successRate = totalExecutions > 0 ? Math.round((successCount / totalExecutions) * 100) : 0;

  const roleMap: Record<string, number> = {};
  usersByRole.forEach((r) => { roleMap[r.role] = r._count; });

  return {
    allFeedback,
    totalUsers,
    usersByRole: roleMap,
    paidUsers,
    totalWorkflows,
    publishedWorkflows,
    communityPubs,
    totalExecutions,
    failedCount,
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
  return `You are the **AI CTO Agent** for BuildFlow — a visual workflow builder for BIM (Building Information Modeling) in the AEC industry. You combine the roles of CTO, lead developer, DevOps engineer, QA lead, UX researcher, product manager, and business strategist.

Your job: deep-analyze EVERYTHING — user feedback, platform metrics, error patterns, the technology stack, service quality, UI/UX gaps, i18n coverage, subscription model, third-party service choices — and generate a comprehensive prioritized weekly roadmap.

## The Application — BuildFlow

### Core Features
- Visual drag-and-drop canvas (React Flow) for building AEC pipelines
- Node catalogue: Input → Transform → Generate → Export workflow
- AI-powered nodes: concept rendering (gpt-image-1.5), 3D generation (Meshy/SAM 3D/3D AI Studio), video walkthrough (Kling AI), floor planning, cost estimation
- Community marketplace for sharing workflows
- Gamification system (XP, levels, achievements)
- Admin panel with analytics, feedback management, growth metrics

### Technology Stack & Services (ANALYZE FOR IMPROVEMENT)
| Service | Current | Known Limitations | Potential Upgrades |
|---------|---------|-------------------|-------------------|
| **Video Gen** | Kling AI v1.6 (kling-v2-6 model) | 10min timeout, $0.10/s, max 10s clips | Kling v2.0/v2.1 (better quality), Runway Gen-3 Alpha, Pika 2.0, Minimax Video-01 |
| **3D from Image** | Meshy v2 (meshy-4 model) | 4min timeout, ~30K polys | Meshy v3, Tripo3D v2 (better topology), Rodin Gen-2 |
| **3D from Image (alt)** | SAM 3D via fal.ai | 2 concurrent limit (free tier), 2min timeout | Upgrade fal.ai plan, or use InstantMesh/Trellis |
| **3D from Text** | 3D AI Studio (Tencent rapid) | 55 credits/model ($29/mo plan) | Meshy text-to-3D, Tripo3D, or self-hosted Point-E |
| **Image Gen** | gpt-image-1.5 via OpenAI | Excellent prompt + reference adherence; image-to-image via images.edit() | Best-in-class instruction-following; no swap planned |
| **LLM** | GPT-4o / GPT-4o-mini | Cost per token | Claude 4.6 Sonnet for some tasks (cheaper, faster) |
| **Floor Plan AI** | Claude (Anthropic SDK) | SVG-only output | Add PDF export, DXF support |
| **Email** | AutoSend ($1/mo hobby) | 3,000 emails/mo limit | Resend.com, AWS SES, or upgrade AutoSend plan |
| **Payments** | Stripe + Razorpay | Dual gateway complexity | Consider Lemonsqueezy for simplified global billing |
| **DB** | Neon PostgreSQL + Prisma 7 | Connection pooling limits on free tier | Monitor connection count, consider Prisma Accelerate |
| **Rate Limit** | Upstash Redis | Per-user monthly, no burst protection | Add per-minute burst limits for API abuse prevention |
| **CDN/Storage** | Cloudflare R2 | 25-day auto-cleanup | Ensure users know about expiry, add permanent storage option |
| **3D Viewer** | Three.js (client-side) | Heavy on mobile, no LOD | Add progressive loading, LOD system, draco compression |
| **Auth** | NextAuth v5 beta | Beta stability concerns | Monitor for GA release, test edge cases |

### i18n Status
- Supported: English (en), German (de)
- ~700+ translation keys
- **KNOWN GAP**: Admin panel pages (including roadmap, support, settings) use hardcoded English. All admin pages need i18n integration.
- **KNOWN GAP**: Some new features may have untranslated strings

### Subscription Model (INR Pricing)
| Tier | Price | Executions/mo | Renders | Videos | 3D Models |
|------|-------|---------------|---------|--------|-----------|
| FREE | ₹0 | 3 | 1 | 0 | 0 |
| MINI | ₹99 | 10 | 3 | 0 | 0 |
| STARTER | ₹799 | 30 | 10 | 3 | 3 |
| PRO | ₹1,999 | 100 | 30 | 7 | 10 |

### Node Catalogue (All Available Workflow Nodes)
**Input:** Text Prompt, PDF Upload, Image Upload, IFC Upload, Parameter Input, Location Input, DXF/DWG Upload
**Transform:** Brief Parser, Requirements Extractor, Design Brief Analyzer, Image Understanding, Style Composer, Zoning Checker, Quantity Extractor, BOQ/Cost Mapper, BIM Query Engine, Delta Comparator, Carbon Inference, GIS Context Loader
**Generate:** AI Massing Generator, Parametric Explorer, Concept Renderer, AI Floor Planner, Facade Generator, IFC Web Viewer, Photo→3D, Text→3D, Cinematic Walkthrough, Multi-View→3D, 3D Floor Plan
**Export:** IFC Exporter, Spreadsheet Exporter, PDF Report Generator, Speckle Publisher, Dashboard Publisher, Batch Image Exporter

## What to Look For (Beyond Feedback)

1. **UI/UX Issues**: Are there pages with hardcoded text that should use i18n? Are there mobile responsiveness gaps? Are loading states clear? Are error messages helpful?
2. **Service Quality**: Is the video generation quality good enough? Should we upgrade Kling to v2.0? Is Meshy 3D quality meeting AEC standards?
3. **Subscription Optimization**: Are the tier limits right? Should MINI include video? Are free users converting?
4. **Performance**: Are there slow pages? Heavy JS bundles? Unoptimized images?
5. **Security**: Any auth edge cases? CSP gaps? Input validation holes?
6. **Developer Experience**: Test coverage gaps? Missing types? Build performance?
7. **Community**: Is the marketplace engaging? Are users publishing? Are reviews being left?
8. **Onboarding**: Is the first-time experience smooth? Do users understand the canvas?
9. **Missing Features**: What competitors offer that we don't? What would make AEC professionals choose us?
10. **Infrastructure**: Database scaling, Redis connection management, error monitoring, logging

## Decision Framework
1. **P0 (Critical)**: Data loss, auth failures, payment bugs, security vulns, >50% users affected
2. **P1 (High)**: Major feature requests from multiple users, significant UX issues, reliability drops, conversion blockers
3. **P2 (Medium)**: Feature improvements, nice-to-have requests, DX improvements, service upgrades
4. **P3 (Low)**: Polish, minor UI, documentation, tech debt

## Effort Scale
- **XS**: <2 hours — **S**: 2-4h — **M**: 4-8h — **L**: 1-2 days — **XL**: 3-5 days

## Categories
- **bug-fix**: Fix broken feature/error
- **feature**: New capability
- **improvement**: Enhance existing feature
- **infra**: Infrastructure, performance, reliability, service upgrades
- **dx**: Developer experience, tooling, testing
- **ux**: User experience, UI, accessibility, i18n

## Rules
1. Generate 8-14 tasks per week — ambitious but realistic
2. Link tasks to specific feedback IDs when applicable
3. Consider what was deferred from previous roadmaps
4. Balance quick wins (XS/S) with meaningful progress (M/L)
5. Never ignore P0 items
6. Group related feedback into single tasks when they share root cause
7. Include at least 1 infra/reliability task and 1 UX task per week
8. If execution success rate <80%, ALWAYS include stability task as P0
9. If user growth is spiking, prioritize onboarding/scalability
10. Be VERY specific — include actual file paths, service names, API versions
11. Suggest service upgrades when relevant (e.g., "Upgrade Kling from v1.6 to v2.0")
12. Flag i18n gaps as tasks
13. Consider mobile experience for every UX task
14. Think about what would make an architect/engineer choose BuildFlow over competitors

## Output Format
Return ONLY valid JSON (no markdown, no code blocks):
{
  "summary": "3-5 sentence weekly insight covering platform state, key trends, strategic direction, and one bold recommendation",
  "riskFlags": ["specific risk with context", "another risk"],
  "quickWins": ["specific quick win with exact action", "another win"],
  "tasks": [
    {
      "title": "Clear, specific task title",
      "description": "Detailed description with acceptance criteria. Reference specific files, services, or metrics.",
      "priority": "P0|P1|P2|P3",
      "effort": "XS|S|M|L|XL",
      "category": "bug-fix|feature|improvement|infra|dx|ux",
      "reasoning": "Why this task matters THIS WEEK. Reference specific data points, feedback, or metrics.",
      "linkedFeedbackIds": ["id1"],
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

  const conversionRate = data.totalUsers > 0
    ? Math.round((data.paidUsers / data.totalUsers) * 100)
    : 0;

  return `## Current Date: ${new Date().toISOString().split("T")[0]}

## Platform Health Metrics
- Total users: ${data.totalUsers}
- Users by role: ${JSON.stringify(data.usersByRole)}
- Paid subscribers: ${data.paidUsers} (${conversionRate}% conversion rate)
- Total workflows: ${data.totalWorkflows} (${data.publishedWorkflows} published)
- Community publications: ${data.communityPubs}
- Total executions: ${data.totalExecutions} (${data.failedCount} failed)
- Execution success rate: ${data.successRate}%
- New users this week: ${data.usersThisWeek}
- Executions this week: ${data.execsThisWeek}
- New feedback this week: ${data.feedbackThisWeek}

## Top Used Nodes (What Users Actually Use)
${data.topNodes.map((n) => `- ${n.name} (${n.type}): ${n.count} instances`).join("\n")}
${data.topNodes.length === 0 ? "- No node usage data yet" : ""}

## Feedback Summary
- Total feedback items: ${data.allFeedback.length}
- By status: ${JSON.stringify(feedbackByStatus)}
- By type: ${JSON.stringify(feedbackByType)}

## All Feedback Items (Most Recent First)
${feedbackList.length > 0 ? JSON.stringify(feedbackList, null, 1) : "No feedback submitted yet"}

## Recent Execution Errors (Last 7 Days)
${data.recentErrors.length > 0 ? data.recentErrors.map((e) => `- ${e}`).join("\n") : "No recent errors — system is stable"}

## Previous Roadmap Tasks (For Continuity)
${previousTasks.length > 0
    ? JSON.stringify(previousTasks, null, 1)
    : "No previous roadmaps — this is the first generation. Focus on foundational improvements."}

## Important Context
- The admin panel pages (roadmap, support, settings, users, billing) currently use hardcoded English strings instead of the i18n system
- The platform supports EN + DE languages but coverage is incomplete for newer features
- Mobile experience on the canvas is limited — React Flow on mobile is challenging
- Email service (AutoSend) has a 3,000/month limit on the hobby plan
- fal.ai (SAM 3D) is on free tier with only 2 concurrent request limit
- Kling AI video generation is on v1.6 — v2.0 and v2.1 are available with better quality
- Three.js walkthrough renderer disables shadows and antialiasing for performance

---

Analyze ALL of the above and generate this week's roadmap. Be specific, actionable, reference data. Don't just address feedback — proactively identify issues and opportunities based on the metrics, tech stack, and your expertise as a CTO.`;
}

// ─── Main Agent Function ──────────────────────────────────────────────────────

export async function generateWeeklyRoadmap(): Promise<RoadmapGeneration> {
  const data = await gatherPlatformData();

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 90000,
    maxRetries: 2,
  });

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(data) },
    ],
    temperature: 0.5,
    max_tokens: 6000,
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

  if (!parsed.summary || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("AI response missing required fields (summary, tasks)");
  }

  const feedbackByStatus: Record<string, number> = {};
  const feedbackByType: Record<string, number> = {};
  data.allFeedback.forEach((f) => {
    feedbackByStatus[f.status] = (feedbackByStatus[f.status] || 0) + 1;
    feedbackByType[f.type] = (feedbackByType[f.type] || 0) + 1;
  });

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
