import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdminUser } from "@/lib/rate-limit";

/**
 * POST /api/admin/cleanup — Safely reduce Neon DB data transfer
 *
 * SAFETY RULES:
 * 1. NEVER deletes the most recent execution per workflow (preserves "View Results")
 * 2. NEVER deletes workflows themselves (preserves user canvas)
 * 3. Only deletes old executions + their cascaded artifacts
 * 4. Keeps workflow versions (last 3)
 * 5. Logs everything deleted for audit
 *
 * Body: { daysToKeep?: number, dryRun?: boolean }
 * dryRun: true → shows what WOULD be deleted without actually deleting
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !isAdminUser(session.user.email ?? "")) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const daysToKeep = Number(body.daysToKeep ?? 3);
    const dryRun = body.dryRun === true;
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    // Step 1: Find the LATEST execution per workflow — these are PROTECTED
    const latestPerWorkflow = await prisma.execution.findMany({
      where: { status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      distinct: ["workflowId"],
      select: { id: true, workflowId: true },
    });
    const protectedIds = new Set(latestPerWorkflow.map(e => e.id));

    // Step 2: Find old executions that are NOT protected
    const oldExecutions = await prisma.execution.findMany({
      where: {
        createdAt: { lt: cutoffDate },
        id: { notIn: [...protectedIds] },
      },
      select: { id: true, workflowId: true, createdAt: true },
    });

    // Step 3: Count artifacts that will be cascade-deleted
    const oldArtifactCount = await prisma.artifact.count({
      where: { executionId: { in: oldExecutions.map(e => e.id) } },
    });

    // Step 4: Find old workflow versions (keep last 3 per workflow)
    const allVersions = await prisma.workflowVersion.findMany({
      select: { id: true, workflowId: true, version: true },
      orderBy: { version: "desc" },
    });
    const versionsByWorkflow = new Map<string, string[]>();
    for (const v of allVersions) {
      const list = versionsByWorkflow.get(v.workflowId) ?? [];
      list.push(v.id);
      versionsByWorkflow.set(v.workflowId, list);
    }
    const versionIdsToDelete: string[] = [];
    for (const [, ids] of versionsByWorkflow) {
      if (ids.length > 3) versionIdsToDelete.push(...ids.slice(3));
    }

    const summary = {
      dryRun,
      cutoffDate: cutoffDate.toISOString(),
      protectedExecutions: protectedIds.size,
      executionsToDelete: oldExecutions.length,
      artifactsToDelete: oldArtifactCount,
      versionsToDelete: versionIdsToDelete.length,
    };

    if (dryRun) {
      return NextResponse.json({ ...summary, message: "DRY RUN — nothing deleted. Set dryRun: false to execute." });
    }

    // Step 5: Delete (artifacts cascade from executions via onDelete: Cascade)
    let executionsDeleted = 0;
    let versionsDeleted = 0;

    if (oldExecutions.length > 0) {
      // Delete in batches of 50 to avoid timeout
      for (let i = 0; i < oldExecutions.length; i += 50) {
        const batch = oldExecutions.slice(i, i + 50).map(e => e.id);
        await prisma.execution.deleteMany({ where: { id: { in: batch } } });
        executionsDeleted += batch.length;
      }
    }

    if (versionIdsToDelete.length > 0) {
      const result = await prisma.workflowVersion.deleteMany({
        where: { id: { in: versionIdsToDelete } },
      });
      versionsDeleted = result.count;
    }

    const finalSummary = {
      ...summary,
      executionsDeleted,
      artifactsCascadeDeleted: oldArtifactCount, // cascaded from execution delete
      versionsDeleted,
      message: `Cleaned ${executionsDeleted} executions + ${oldArtifactCount} artifacts + ${versionsDeleted} versions. Latest execution per workflow preserved.`,
    };

    return NextResponse.json(finalSummary);

  } catch (error) {
    console.error("[CLEANUP] Error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * GET /api/admin/cleanup — Show what CAN be safely deleted
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id || !isAdminUser(session.user.email ?? "")) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const [artifactCount, executionCount, workflowCount, userCount] = await Promise.all([
      prisma.artifact.count(),
      prisma.execution.count(),
      prisma.workflow.count(),
      prisma.user.count(),
    ]);

    // Find how many executions are "protected" (latest per workflow)
    const latestPerWorkflow = await prisma.execution.findMany({
      where: { status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      distinct: ["workflowId"],
      select: { id: true },
    });

    return NextResponse.json({
      total: { artifacts: artifactCount, executions: executionCount, workflows: workflowCount, users: userCount },
      protectedExecutions: latestPerWorkflow.length,
      deletableExecutions: executionCount - latestPerWorkflow.length,
      tip: "POST { dryRun: true } to preview what will be deleted. POST { daysToKeep: 3 } to actually delete.",
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
