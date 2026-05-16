/**
 * GET /api/config/feature-flags
 *
 * Returns client-safe, USER-SPECIFIC feature flags.
 * Server decides what to expose based on session + allowlist.
 * DO NOT expose raw env vars — only computed booleans.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { shouldUserSeeVip } from "@/features/floor-plan/lib/vip-pipeline/canary";
import { shouldUserSeeBriefRenders } from "@/features/brief-renders/services/brief-pipeline/canary";
import { shouldUseBriefToIfcV2Queue } from "@/features/ifc/services/brief-to-ifc-v2/canary";
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3";

export async function GET() {
  const session = await auth();

  const email = session?.user?.email ?? null;
  const userId = session?.user?.id ?? "";

  return NextResponse.json({
    vipJobsEnabled: shouldUserSeeVip(email, userId),
    briefRendersEnabled: shouldUserSeeBriefRenders(email, userId),
    briefToIfcV2QueueEnabled: shouldUseBriefToIfcV2Queue(email),
    briefToIfcV3Enabled: shouldUseBriefToIfcV3(email),
  });
}
