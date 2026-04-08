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
 * "Deletes" the caller's workflows from their personal view AND wipes
 * all associated R2 objects, while preserving the underlying audit data
 * (Workflow + Execution + Artifact rows) so the admin dashboard's
 * historical metrics, recent activity, and per-user analytics remain
 * intact.
 *
 * Behavior:
 *  - Soft-deletes workflows by setting `deletedAt = now()`. The Workflow
 *    row, its Executions, and their Artifact metadata are intentionally
 *    NOT removed from the database — admin pages don't filter by
 *    deletedAt, so they continue to show full historical activity.
 *  - User-facing endpoints filter `deletedAt: null`, so the workflow
 *    disappears from the owner's My Workflows list immediately.
 *  - R2 storage is still wiped: artifact dataUri values (and any URLs
 *    embedded in the JSON `data` blob) are scanned, mapped to R2 keys,
 *    and deleted in parallel. This is the "free up cloud storage" goal
 *    of the feature.
 *  - The Artifact rows themselves are left in place (with their now-dead
 *    URLs) so admin can still see "this workflow ran N artifacts on
 *    date X with status Y" — exactly the audit signal the platform
 *    operator needs.
 *
 * Safety guarantees:
 *  - Only workflows owned by the authenticated user are touched. Any IDs
 *    that don't belong to the user are silently ignored (no info leak).
 *  - Already-deleted workflows are skipped (idempotent).
 *  - R2 deletion is best-effort and non-blocking on per-object failure.
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

    // 1. Restrict to workflows actually owned by this user AND not already
    //    soft-deleted (idempotent — repeat calls are no-ops).
    const owned = await prisma.workflow.findMany({
      where: { id: { in: ids }, ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    const ownedIds = owned.map((w) => w.id);
    if (ownedIds.length === 0) {
      return NextResponse.json({ success: true, deleted: 0, r2: { deleted: 0, failed: 0 } });
    }

    // 2. Collect R2 keys from artifacts so we can free cloud storage.
    //    Artifacts hang off both Executions and TileInstances of the workflow.
    //    Note: we intentionally do NOT delete the Artifact rows themselves —
    //    admin/audit pages need them to render historical activity.
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

    // 3. Soft-delete: mark the workflows hidden from the user without
    //    triggering any DB cascade. Audit data (Execution + Artifact rows)
    //    is preserved verbatim — admin pages don't filter by deletedAt.
    const result = await prisma.workflow.updateMany({
      where: { id: { in: ownedIds }, ownerId: userId, deletedAt: null },
      data: { deletedAt: new Date() },
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
      deleted: result.count, // number of workflows soft-deleted
      r2: r2Result,
    });
  } catch (error) {
    console.error("[workflows/bulk-delete]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
