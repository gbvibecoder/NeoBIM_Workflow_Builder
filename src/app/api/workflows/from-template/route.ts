/**
 * POST /api/workflows/from-template
 *
 * Server-side tier gate for template instantiation. The templates page
 * also gates client-side via canAccessTemplate(), but that's UX only —
 * a determined user can bypass it by editing component state. This route
 * is the authoritative check.
 *
 * Body: { templateId: string }
 *
 * Responses:
 *   201 → { workflowId, name }                    template instantiated
 *   400 → unknown templateId / missing field
 *   401 → not signed in
 *   403 → tier-locked (template requires upgrade)
 *   403 → maxWorkflows reached for current plan
 *   429 → rate limited
 *   500 → unexpected
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit, isAdminUser } from "@/lib/rate-limit";
import { STRIPE_PLANS } from "@/features/billing/lib/plan-data";
import { canAccessTemplate, getUpgradeTargetForTemplate } from "@/features/billing/lib/template-access";
import { PREBUILT_WORKFLOWS } from "@/features/workflows/constants/prebuilt-workflows";
import { trackFirstWorkflow } from "@/lib/analytics";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 },
      );
    }

    const rateLimit = await checkEndpointRateLimit(
      session.user.id,
      "workflows-from-template",
      10,
      "1 m",
    );
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Too many requests",
          message: "Please wait before instantiating more templates.",
          code: "RATE_LIMITED",
        }),
        { status: 429 },
      );
    }

    const body = await req.json().catch(() => null);
    const templateId = typeof body?.templateId === "string" ? body.templateId : null;
    if (!templateId) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Missing template",
          message: "templateId is required.",
          code: "VAL_001",
        }),
        { status: 400 },
      );
    }

    const template = PREBUILT_WORKFLOWS.find((t) => t.id === templateId);
    if (!template) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Unknown template",
          message: `Template "${templateId}" was not found.`,
          code: "VAL_001",
        }),
        { status: 400 },
      );
    }

    // ── Tier gate ────────────────────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, email: true },
    });
    const userRole = user?.role ?? "FREE";

    if (!canAccessTemplate(userRole, template.requiredTier)) {
      const target = getUpgradeTargetForTemplate(userRole, template.requiredTier);
      const tierLabel = target?.label ?? "a higher tier";
      return NextResponse.json(
        formatErrorResponse({
          title: "Template not available on your plan",
          message: `"${template.name}" needs the ${tierLabel} plan. Upgrade to unlock it.`,
          code: "BILL_001",
          action: `Upgrade to ${tierLabel}`,
          actionUrl: "/dashboard/billing",
        }),
        { status: 403 },
      );
    }

    // ── maxWorkflows enforcement (mirrors POST /api/workflows) ───────────
    if (
      (userRole === "FREE" || userRole === "MINI" || userRole === "STARTER") &&
      !isAdminUser(user?.email ?? undefined)
    ) {
      const planLimits =
        userRole === "STARTER"
          ? STRIPE_PLANS.STARTER.limits
          : userRole === "MINI"
            ? STRIPE_PLANS.MINI.limits
            : STRIPE_PLANS.FREE.limits;
      const maxWorkflows = planLimits.maxWorkflows;
      if (maxWorkflows > 0) {
        const currentCount = await prisma.workflow.count({
          where: { ownerId: session.user.id, deletedAt: null },
        });
        if (currentCount >= maxWorkflows) {
          return NextResponse.json(
            formatErrorResponse(UserErrors.WORKFLOW_LIMIT_REACHED(maxWorkflows)),
            { status: 403 },
          );
        }
      }
    }

    // ── Auto-suffix the template name to avoid collisions ────────────────
    const baseName = template.name;
    let finalName = baseName;
    const existing = await prisma.workflow.findFirst({
      where: { ownerId: session.user.id, name: baseName, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      const siblings = await prisma.workflow.findMany({
        where: { ownerId: session.user.id, name: { startsWith: baseName }, deletedAt: null },
        select: { name: true },
      });
      const taken = new Set(siblings.map((w) => w.name));
      let n = 1;
      while (taken.has(`${baseName} (${n})`)) n++;
      finalName = `${baseName} (${n})`;
    }

    // Prisma enum is uppercase; the in-memory template uses lowercase
    // ("simple" | "intermediate" | "advanced") — translate.
    const complexityEnum =
      template.complexity === "advanced"
        ? "ADVANCED"
        : template.complexity === "intermediate"
          ? "INTERMEDIATE"
          : "SIMPLE";

    const workflow = await prisma.workflow.create({
      data: {
        ownerId: session.user.id,
        name: finalName,
        description: template.description,
        tags: template.tags,
        category: template.category,
        complexity: complexityEnum,
        tileGraph: template.tileGraph as unknown as object,
      },
      select: { id: true, name: true },
    });

    await trackFirstWorkflow(session.user.id, workflow.id);

    return NextResponse.json(
      { workflowId: workflow.id, name: workflow.name },
      { status: 201 },
    );
  } catch (error) {
    console.error("[workflows/from-template POST] Error:", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 },
    );
  }
}
