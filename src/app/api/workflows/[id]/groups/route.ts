import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { pusherTrigger } from "@/lib/pusher-server";

// POST /api/workflows/[id]/groups — create a canvas group
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
  const userId = session.user.id;

  const rl = await checkEndpointRateLimit(userId, "canvas-groups-create", 20, "1 m");
  if (!rl.success) return NextResponse.json(formatErrorResponse(UserErrors.RATE_LIMIT_FREE()), { status: 429 });

  const { id: workflowId } = await params;
  const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, ownerId: userId, deletedAt: null } });
  if (!workflow) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });

  const body = await req.json();
  const { label, color, positionX, positionY, width, height } = body as {
    label?: string; color?: string; positionX?: number; positionY?: number; width?: number; height?: number;
  };
  if (positionX == null || positionY == null || width == null || height == null) {
    return NextResponse.json({ error: { title: "Invalid input", message: "positionX, positionY, width, height required", code: "VAL_001" } }, { status: 400 });
  }

  const group = await prisma.canvasGroup.create({
    data: {
      workflowId,
      createdById: userId,
      label: label ?? "Group",
      color: color ?? "purple",
      positionX,
      positionY,
      width,
      height,
    },
  });

  void pusherTrigger(`private-canvas-${workflowId}`, "canvas-group:created", { group });

  return NextResponse.json({ group }, { status: 201 });
}

// GET /api/workflows/[id]/groups — list all groups for workflow
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

  const groups = await prisma.canvasGroup.findMany({
    where: { workflowId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ groups });
}
