import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import type { ExecutionMetadata } from "@/types/execution";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/executions/[id]/metadata
//
// Body: { quantityOverrides?: Record<string, Record<string, number>> }
//
// Top-level shallow-merges the body into Execution.metadata. For each
// known field, the new value REPLACES the old one entirely (full snapshot,
// not delta) — the client sends its complete current state and the server
// last-write-wins. Future metadata fields (e.g. videoGenProgress for
// Task 3) can be added to ExecutionMetadata and patched the same way
// without colliding with quantityOverrides.
//
// Auth + ownership required. The execution must belong to the session user
// AND its parent workflow must not be soft-deleted (matches the existing
// GET/PUT routes' filter pattern).
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // 120/min = 2/sec ceiling, slightly more than the 500ms client-side
    // debounce so a normal editing burst won't trip it. Higher than the
    // existing execution-update limit (30/min) because metadata patches
    // are smaller and fire more often during BOQ editing sessions.
    const rl = await checkEndpointRateLimit(session.user.id, "execution-metadata-patch", 120, "1 m");
    if (!rl.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many requests", message: "Please try again in a moment.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Partial<ExecutionMetadata>;

    // Validate the body shape — only allow known metadata fields
    const patch: ExecutionMetadata = {};
    if (body.quantityOverrides && typeof body.quantityOverrides === "object") {
      // Defensive shape validation: outer object of objects of numbers
      const validated: Record<string, Record<string, number>> = {};
      for (const [tileId, rowMap] of Object.entries(body.quantityOverrides)) {
        if (rowMap && typeof rowMap === "object") {
          const innerValidated: Record<string, number> = {};
          for (const [rowKey, val] of Object.entries(rowMap)) {
            if (typeof val === "number" && Number.isFinite(val)) {
              innerValidated[rowKey] = val;
            }
          }
          validated[tileId] = innerValidated;
        }
      }
      patch.quantityOverrides = validated;
    }

    // Verify ownership AND fetch existing metadata in one query
    const existing = await prisma.execution.findFirst({
      where: { id, userId: session.user.id, workflow: { deletedAt: null } },
      select: { id: true, metadata: true },
    });
    if (!existing) {
      return NextResponse.json(
        formatErrorResponse({ title: "Execution not found", message: "The requested execution could not be found.", code: "NODE_001" }),
        { status: 404 },
      );
    }

    // Top-level merge: preserve unrelated metadata fields (e.g. future
    // videoGenProgress) while replacing the patched ones.
    const currentMetadata = (existing.metadata as ExecutionMetadata | null) ?? {};
    const merged: ExecutionMetadata = { ...currentMetadata, ...patch };

    await prisma.execution.update({
      where: { id },
      data: { metadata: merged as unknown as Prisma.InputJsonValue },
    });

    return NextResponse.json({ success: true, metadata: merged });
  } catch (error) {
    console.error("[executions/metadata PATCH]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
