import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { pusherTrigger } from "@/lib/pusher-server";

// POST /api/workflows/[id]/comments — create a canvas comment
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
  const userId = session.user.id;

  const rl = await checkEndpointRateLimit(userId, "canvas-comments-create", 30, "1 m");
  if (!rl.success) return NextResponse.json(formatErrorResponse(UserErrors.RATE_LIMIT_FREE()), { status: 429 });

  const { id: workflowId } = await params;
  const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, ownerId: userId, deletedAt: null } });
  if (!workflow) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });

  const body = await req.json();
  const { text, positionX, positionY, mentions } = body as {
    text?: string; positionX?: number; positionY?: number; mentions?: string[];
  };
  if (!text?.trim() || positionX == null || positionY == null) {
    return NextResponse.json({ error: { title: "Invalid input", message: "text, positionX, positionY required", code: "VAL_001" } }, { status: 400 });
  }

  const comment = await prisma.canvasComment.create({
    data: {
      workflowId,
      authorId: userId,
      body: text.trim(),
      positionX,
      positionY,
      mentions: mentions ?? [],
    },
    include: { author: { select: { id: true, name: true, email: true, image: true } } },
  });

  void pusherTrigger(`private-canvas-${workflowId}`, "canvas-comment:created", { comment });

  return NextResponse.json({ comment }, { status: 201 });
}

// GET /api/workflows/[id]/comments — list all comments for workflow
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
  const userId = session.user.id;

  const { id: workflowId } = await params;
  const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, ownerId: userId, deletedAt: null } });
  if (!workflow) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });

  const comments = await prisma.canvasComment.findMany({
    where: { workflowId },
    include: {
      author: { select: { id: true, name: true, email: true, image: true } },
      replies: {
        include: { author: { select: { id: true, name: true, email: true, image: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ comments });
}
