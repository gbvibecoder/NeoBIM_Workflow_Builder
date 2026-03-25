import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { AiRoadmapTask } from "@prisma/client";
import { getAdminSession, unauthorizedResponse, logAudit } from "@/lib/admin-server";
import { generateWeeklyRoadmap } from "@/services/roadmap-agent";

// GET — List roadmaps (newest first)
export async function GET(req: Request) {
  const admin = await getAdminSession();
  if (!admin) return unauthorizedResponse();

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") || "10")));

  const [items, total] = await Promise.all([
    prisma.aiRoadmap.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        tasks: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            title: true,
            priority: true,
            effort: true,
            category: true,
            status: true,
          },
        },
      },
    }),
    prisma.aiRoadmap.count(),
  ]);

  return NextResponse.json({
    items: items.map((r) => ({
      ...r,
      weekOf: r.weekOf.toISOString(),
      createdAt: r.createdAt.toISOString(),
      taskStats: {
        total: r.tasks.length,
        todo: r.tasks.filter((t) => t.status === "todo").length,
        inProgress: r.tasks.filter((t) => t.status === "in-progress").length,
        done: r.tasks.filter((t) => t.status === "done").length,
        deferred: r.tasks.filter((t) => t.status === "deferred").length,
        dropped: r.tasks.filter((t) => t.status === "dropped").length,
      },
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

// POST — Generate a new roadmap
export async function POST() {
  const admin = await getAdminSession();
  if (!admin) return unauthorizedResponse();

  try {
    const result = await generateWeeklyRoadmap();

    // Calculate Monday of current week
    const now = new Date();
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); // Monday

    const roadmap = await prisma.aiRoadmap.create({
      data: {
        weekOf: monday,
        summary: result.summary,
        riskFlags: result.riskFlags,
        quickWins: result.quickWins,
        feedbackAnalysis: JSON.parse(JSON.stringify(result.feedbackAnalysis)),
        metricsSnapshot: JSON.parse(JSON.stringify(result.metricsSnapshot)),
        generatedBy: admin.displayName,
        tasks: {
          create: result.tasks.map((t) => ({
            title: t.title,
            description: t.description,
            priority: t.priority,
            effort: t.effort,
            category: t.category,
            status: "todo",
            reasoning: t.reasoning,
            linkedFeedbackIds: t.linkedFeedbackIds,
            sortOrder: t.sortOrder,
          })),
        },
      },
      include: {
        tasks: { orderBy: { sortOrder: "asc" } },
      },
    });

    logAudit(admin.id, "ROADMAP_GENERATED", "AiRoadmap", roadmap.id, {
      taskCount: result.tasks.length,
      weekOf: monday.toISOString(),
    }).catch(() => {});

    const roadmapWithTasks = roadmap as typeof roadmap & { tasks: AiRoadmapTask[] };

    return NextResponse.json({
      ...roadmapWithTasks,
      weekOf: roadmapWithTasks.weekOf.toISOString(),
      createdAt: roadmapWithTasks.createdAt.toISOString(),
      tasks: roadmapWithTasks.tasks.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[Roadmap Agent Error]", error);
    const message = error instanceof Error ? error.message : "Failed to generate roadmap";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
