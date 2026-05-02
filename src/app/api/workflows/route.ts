import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { trackFirstWorkflow } from "@/lib/analytics";
import { checkEndpointRateLimit, isAdminUser } from "@/lib/rate-limit";
import { STRIPE_PLANS } from "@/features/billing/lib/stripe";
import {
  formatErrorResponse,
  UserErrors,
  FormErrors
} from "@/lib/user-errors";

// GET /api/workflows — list user's workflows (supports optional pagination)
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")));

    const [workflows, total] = await Promise.all([
      prisma.workflow.findMany({
        where: { ownerId: session.user.id, deletedAt: null, name: { not: "__standalone_tools__" } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          tags: true,
          isPublished: true,
          createdAt: true,
          updatedAt: true,
          thumbnail: true,
          category: true,
          _count: { select: { executions: true } },
          executions: {
            take: 12,
            orderBy: { completedAt: "desc" },
            where: { completedAt: { not: null } },
            select: {
              id: true,
              status: true,
              completedAt: true,
            },
          },
        },
      }),
      prisma.workflow.count({ where: { ownerId: session.user.id, deletedAt: null } }),
    ]);

    const response = NextResponse.json({ workflows, total, page, totalPages: Math.ceil(total / limit) });
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
        // Limit only counts live (non-deleted) workflows — soft-deleted
        // workflows still occupy a DB row but should not block the user
        // from creating a new one.
        const currentCount = await prisma.workflow.count({
          where: { ownerId: session.user.id, deletedAt: null },
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
    const { name, description, tags, tileGraph, autoSuffix } = body;

    // Validate workflow name
    if (name && typeof name !== "string") {
      return NextResponse.json(
        formatErrorResponse(FormErrors.REQUIRED_FIELD("workflow name")),
        { status: 400 }
      );
    }

    // ── Unique-name handling ──
    // If autoSuffix is true (template clones, auto-saves on Run, etc.) we
    // append " (N)" to the requested name until it's unique for this user.
    // If autoSuffix is false (user explicitly typed a name) and the name
    // already exists, we return 409 so the UI can prompt for a different one.
    const requestedName = (typeof name === "string" && name.trim()) ? name.trim() : "Untitled Workflow";

    let finalName = requestedName;
    // Name uniqueness only considers live (non-deleted) workflows so users
    // can re-create workflows with the same name as ones they soft-deleted.
    const existingSame = await prisma.workflow.findFirst({
      where: { ownerId: session.user.id, name: requestedName, deletedAt: null },
      select: { id: true },
    });

    if (existingSame) {
      if (autoSuffix === false) {
        return NextResponse.json(
          formatErrorResponse({
            title: "Name already in use",
            message: `A workflow named "${requestedName}" already exists. Please choose a different name.`,
            code: "VAL_002",
          }),
          { status: 409 }
        );
      }
      // Find the next free " (N)" suffix
      const siblings = await prisma.workflow.findMany({
        where: {
          ownerId: session.user.id,
          name: { startsWith: requestedName },
          deletedAt: null,
        },
        select: { name: true },
      });
      const taken = new Set(siblings.map((w) => w.name));
      let n = 1;
      while (taken.has(`${requestedName} (${n})`)) n++;
      finalName = `${requestedName} (${n})`;
    }

    const workflow = await prisma.workflow.create({
      data: {
        ownerId: session.user.id,
        name: finalName,
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
