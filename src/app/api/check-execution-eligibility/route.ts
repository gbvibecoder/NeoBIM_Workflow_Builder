import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkExecutionEligibility } from "@/features/billing/lib/check-execution-eligibility";

/**
 * Pre-execution eligibility check.
 * Returns whether the user can execute a workflow — without consuming any
 * rate-limit tokens or referral-bonus credits. The actual gate is enforced by
 * the per-route consumers (execute-node, generate-floor-plan, parse-ifc) using
 * the same helper with `consumeBonusOnCap: true`.
 *
 * Called from WorkflowCanvas.handleRun and from useExecution.runWorkflow so
 * that direct callers (Command Palette, future entry points) also pre-flight.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        canExecute: false,
        blocks: [
          {
            type: "auth",
            title: "Not signed in",
            message: "Please sign in to run workflows.",
            action: "Sign In",
            actionUrl: "/auth/signin",
          },
        ],
      },
      { status: 401 },
    );
  }

  const body = await req
    .json()
    .catch(() => ({ catalogueIds: [] as string[], workflowId: null as string | null }));
  const catalogueIds = Array.isArray(body?.catalogueIds) ? body.catalogueIds : [];
  // workflowId optional — when provided, the helper additionally enforces the
  // "no double execution" lock (block.type = "workflow_already_executed").
  const workflowId = typeof body?.workflowId === "string" ? body.workflowId : null;

  const result = await checkExecutionEligibility({
    userId: session.user.id,
    userRole: ((session.user as { role?: string }).role) ?? "FREE",
    userEmail: session.user.email,
    emailVerified: !!(session.user as { emailVerified?: boolean }).emailVerified,
    intent: {
      kind: "workflow-run",
      catalogueIds,
      workflowId,
    },
    options: { consumeBonusOnCap: false },
  });

  return NextResponse.json(result);
}
