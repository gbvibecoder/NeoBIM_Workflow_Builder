import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { trackFirstWorkflow } from "@/lib/analytics";
import { checkEndpointRateLimit, isAdminUser } from "@/lib/rate-limit";
import { STRIPE_PLANS } from "@/lib/stripe";
import {
  formatErrorResponse,
  UserErrors,
  FormErrors
} from "@/lib/user-errors";

// GET /api/workflows — list user's workflows
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    const workflows = await prisma.workflow.findMany({
      where: { ownerId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        tags: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { executions: true } },
      },
    });

    const response = NextResponse.json({ workflows });
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (error) {
    console.error("[workflows GET] Error:", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}

// POST /api/workflows — create new workflow
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    const rateLimit = await checkEndpointRateLimit(session.user.id, "workflows-create", 10, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please wait before creating more workflows.", code: "RATE_LIMITED" }), { status: 429 });
    }

    // ── Enforce maxWorkflows limit for FREE/MINI/STARTER users ──────────
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, email: true },
    });

    const userRole = user?.role ?? "FREE";
    if ((userRole === "FREE" || userRole === "MINI" || userRole === "STARTER") && !isAdminUser(user?.email ?? undefined)) {
      const planLimits = userRole === "STARTER" ? STRIPE_PLANS.STARTER.limits : userRole === "MINI" ? STRIPE_PLANS.MINI.limits : STRIPE_PLANS.FREE.limits;
      const maxWorkflows = planLimits.maxWorkflows;
      if (maxWorkflows > 0) {
        const currentCount = await prisma.workflow.count({
          where: { ownerId: session.user.id },
        });
        if (currentCount >= maxWorkflows) {
          return NextResponse.json(
            formatErrorResponse(UserErrors.WORKFLOW_LIMIT_REACHED(maxWorkflows)),
            { status: 403 }
          );
        }
      }
    }

    const body = await req.json();
    const { name, description, tags, tileGraph } = body;

    // Validate workflow name
    if (name && typeof name !== "string") {
      return NextResponse.json(
        formatErrorResponse(FormErrors.REQUIRED_FIELD("workflow name")),
        { status: 400 }
      );
    }

    const workflow = await prisma.workflow.create({
      data: {
        ownerId: session.user.id,
        name: name ?? "Untitled Workflow",
        description,
        tags: tags ?? [],
        tileGraph: tileGraph ?? { nodes: [], edges: [] },
      },
    });

    // 🔥 TRACK WORKFLOW CREATION (+ first workflow milestone)
    await trackFirstWorkflow(session.user.id, workflow.id);

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    console.error("[workflows POST] Error:", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}
