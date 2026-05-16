/**
 * GET /api/brief-to-ifc/v3/quota
 *
 * Returns the user's monthly v3 quota status:
 *   { limit: number, used: number, remaining: number, unlimited: boolean }
 *
 * Used by the submit form to show "X / Y runs remaining this month"
 * BEFORE the user clicks Generate, so they know upfront whether they
 * have headroom on their plan.
 *
 * unlimited=true when the plan-data limit is >= 999 (TEAM / admin).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3";
import { checkBriefToIfcV3Quota } from "@/features/brief-to-ifc/v3/quota/quota";

export const dynamic = "force-dynamic";

const UNLIMITED_THRESHOLD = 999;

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  if (!shouldUseBriefToIfcV3(session.user.email ?? null)) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Feature not available",
        message: "The v3 AI IFC pipeline is not available for your account.",
        code: "BRIEF_TO_IFC_V3_NOT_AVAILABLE",
      }),
      { status: 403 },
    );
  }

  const role = (session.user as { role?: string }).role ?? "FREE";
  const result = await checkBriefToIfcV3Quota(prisma, session.user.id, role);
  const limit = result.limit;
  const used = result.used;
  const remaining = Math.max(0, limit - used);
  const unlimited = limit >= UNLIMITED_THRESHOLD;

  return NextResponse.json(
    { limit, used, remaining, unlimited, role },
    { headers: { "Cache-Control": "no-store" } },
  );
}
