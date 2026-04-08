import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { extractR2KeyFromUrl, deleteManyFromR2 } from "@/lib/r2";

/**
 * POST /api/workflows/bulk-delete
 * Body: { ids: string[] }
 *
 * Permanently deletes the caller's workflows AND their associated R2 objects.
 *
 * Safety guarantees:
 *  - Only workflows owned by the authenticated user are touched. Any IDs that
 *    don't belong to the user are silently ignored (no information leak).
 *  - DB cleanup uses prisma.workflow.deleteMany — Prisma cascades handle
 *    Executions, TileInstances, Artifacts, WorkflowVersions,
 *    CommunityPublications + Reviews, and WorkflowClones (see schema.prisma
 *    onDelete: Cascade chains). This matches the single-delete semantics in
 *    /api/workflows/[id] DELETE so behavior stays consistent.
 *  - R2 deletion is best-effort and non-blocking on per-object failure: we
 *    extract keys from artifact dataUri values BEFORE removing the workflow
 *    rows, then fan-out DeleteObjectCommand calls. Individual failures are
 *    logged but never abort the request.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }
    const userId = session.user.id;

    // Rate-limit: bulk operations are heavier — 10/min is plenty for normal use.
    const rl = await checkEndpointRateLimit(userId, "workflows-bulk-delete", 10, "1 m");
    if (!rl.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Slow down", message: "Too many bulk delete requests. Please wait a moment.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        formatErrorResponse({ title: "Invalid request", message: "Request body must be JSON.", code: "VAL_001" }),
        { status: 400 },
      );
    }

    const rawIds =
      body && typeof body === "object" && "ids" in body && Array.isArray((body as { ids: unknown }).ids)
        ? ((body as { ids: unknown[] }).ids as unknown[])
        : null;
    if (!rawIds) {
      return NextResponse.json(
        formatErrorResponse({ title: "Invalid request", message: "Body must include `ids: string[]`.", code: "VAL_001" }),
        { status: 400 },
      );
    }
    const ids = Array.from(
      new Set(rawIds.filter((x): x is string => typeof x === "string" && x.length > 0)),
    );
    if (ids.length === 0) {
      return NextResponse.json({ success: true, deleted: 0, r2: { deleted: 0, failed: 0 } });
    }
    if (ids.length > 200) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many", message: "You can delete at most 200 workflows at once.", code: "VAL_001" }),
        { status: 400 },
      );
    }

    // 1. Restrict to workflows actually owned by this user.
    const owned = await prisma.workflow.findMany({
      where: { id: { in: ids }, ownerId: userId },
      select: { id: true },
    });
    const ownedIds = owned.map((w) => w.id);
    if (ownedIds.length === 0) {
      return NextResponse.json({ success: true, deleted: 0, r2: { deleted: 0, failed: 0 } });
    }

    // 2. Collect R2 keys from artifacts BEFORE the cascade nukes them.
    //    Artifacts hang off both Executions and TileInstances of the workflow.
    const artifacts = await prisma.artifact.findMany({
      where: {
        OR: [
          { execution: { workflowId: { in: ownedIds } } },
          { tileInstance: { workflowId: { in: ownedIds } } },
        ],
      },
      select: { dataUri: true, data: true },
    });

    const r2Keys: string[] = [];
    for (const a of artifacts) {
      const k = extractR2KeyFromUrl(a.dataUri);
      if (k) r2Keys.push(k);
      // Some artifacts stash extra urls inside the JSON `data` blob — scan
      // shallowly for any string value that looks like an R2 URL.
      if (a.data && typeof a.data === "object") {
        try {
          const stack: unknown[] = [a.data];
          while (stack.length) {
            const cur = stack.pop();
            if (!cur) continue;
            if (typeof cur === "string") {
              const key = extractR2KeyFromUrl(cur);
              if (key) r2Keys.push(key);
            } else if (Array.isArray(cur)) {
              for (const v of cur) stack.push(v);
            } else if (typeof cur === "object") {
              for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v);
            }
          }
        } catch {
          /* ignore malformed json */
        }
      }
    }

    // 3. Delete workflows from DB (cascades handle Execution/TileInstance/
    //    Artifact/WorkflowVersion/CommunityPublication/Review/WorkflowClone).
    const result = await prisma.workflow.deleteMany({
      where: { id: { in: ownedIds }, ownerId: userId },
    });

    // 4. Best-effort R2 cleanup. Never blocks success — failures only logged.
    let r2Result = { deleted: 0, failed: 0 };
    if (r2Keys.length > 0) {
      try {
        r2Result = await deleteManyFromR2(r2Keys);
      } catch (err) {
        console.warn("[workflows/bulk-delete] R2 cleanup failed", err);
      }
    }

    return NextResponse.json({
      success: true,
      deleted: result.count,
      r2: r2Result,
    });
  } catch (error) {
    console.error("[workflows/bulk-delete]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
