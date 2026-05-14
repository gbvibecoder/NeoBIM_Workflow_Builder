import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { pusherTrigger } from "@/lib/pusher-server";

// POST /api/comments/[commentId]/reply — add a reply
export async function POST(
  req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });

  const { commentId } = await params;
  const parent = await prisma.canvasComment.findUnique({ where: { id: commentId } });
  if (!parent) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 404 });

  // Verify user has access to the workflow
  const workflow = await prisma.workflow.findFirst({
    where: { id: parent.workflowId, ownerId: session.user.id, deletedAt: null },
  });
  if (!workflow) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });

  const body = await req.json();
  const { text, mentions } = body as { text?: string; mentions?: string[] };
  if (!text?.trim()) {
    return NextResponse.json({ error: { title: "Invalid input", message: "text is required", code: "VAL_001" } }, { status: 400 });
  }

  const reply = await prisma.canvasComment.create({
    data: {
      workflowId: parent.workflowId,
      authorId: session.user.id,
      parentId: commentId,
      body: text.trim(),
      positionX: parent.positionX,
      positionY: parent.positionY,
      mentions: mentions ?? [],
    },
    include: { author: { select: { id: true, name: true, email: true, image: true } } },
  });

  void pusherTrigger(`private-canvas-${parent.workflowId}`, "canvas-comment:created", { comment: reply });

  return NextResponse.json({ reply }, { status: 201 });
}
