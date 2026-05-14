import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { pusherTrigger } from "@/lib/pusher-server";

// POST /api/comments/[commentId]/resolve — toggle resolved
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });

  const { commentId } = await params;
  const existing = await prisma.canvasComment.findUnique({
    where: { id: commentId },
    include: { workflow: { select: { ownerId: true } } },
  });
  if (!existing) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 404 });

  // Authorization: only workflow owner can resolve/reopen comments
  if (existing.workflow.ownerId !== session.user.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });
  }

  // Toggle: if resolved → re-open, if open → resolve
  const isResolved = !!existing.resolvedAt;
  const comment = await prisma.canvasComment.update({
    where: { id: commentId },
    data: isResolved
      ? { resolvedAt: null, resolvedById: null }
      : { resolvedAt: new Date(), resolvedById: session.user.id },
    include: { author: { select: { id: true, name: true, email: true, image: true } } },
  });

  void pusherTrigger(`private-canvas-${existing.workflowId}`, "canvas-comment:resolved", {
    commentId,
    resolvedById: isResolved ? null : session.user.id,
    resolvedAt: isResolved ? null : comment.resolvedAt,
  });

  return NextResponse.json({ comment });
}
