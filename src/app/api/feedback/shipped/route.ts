import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/feedback/shipped
 *
 * Returns recently shipped (DONE) feedback with submitter first name
 * and optionally linked AI roadmap tasks. Auth required.
 * Limit: 6 most recent DONE items.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const shipped = await prisma.feedback.findMany({
      where: { status: "DONE" },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: { name: true },
        },
      },
    });

    // Find linked roadmap tasks for attribution
    const feedbackIds = shipped.map((f) => f.id);
    let linkedTasks: Array<{
      id: string;
      title: string;
      linkedFeedbackIds: string[];
    }> = [];

    if (feedbackIds.length > 0) {
      try {
        linkedTasks = await prisma.aiRoadmapTask.findMany({
          where: { linkedFeedbackIds: { hasSome: feedbackIds } },
          select: {
            id: true,
            title: true,
            linkedFeedbackIds: true,
          },
        });
      } catch {
        // AiRoadmapTask may not exist in all environments
      }
    }

    const tasksByFeedback = new Map<string, typeof linkedTasks>();
    for (const task of linkedTasks) {
      for (const fbId of task.linkedFeedbackIds) {
        const existing = tasksByFeedback.get(fbId) ?? [];
        existing.push(task);
        tasksByFeedback.set(fbId, existing);
      }
    }

    const items = shipped.map((f) => {
      const firstName = f.user.name?.split(" ")[0] ?? "An architect";
      return {
        id: f.id,
        type: f.type,
        title: f.title,
        quote: (f.description ?? "").split("\n")[0].slice(0, 140),
        category: f.category,
        shippedAt: f.updatedAt.toISOString(),
        submittedAt: f.createdAt.toISOString(),
        submitterFirstName: firstName,
        linkedTasks: (tasksByFeedback.get(f.id) ?? []).map((t) => ({
          id: t.id,
          title: t.title,
        })),
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[shipped feedback]", err);
    return NextResponse.json({ items: [] });
  }
}
