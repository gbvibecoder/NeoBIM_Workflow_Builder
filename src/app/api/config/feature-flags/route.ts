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
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3";

// `briefToIfcV2QueueEnabled` was removed 2026-05-17 — v2 retired in
// favour of v3. No client surface still reads that key; the v2 canary
// helper is intentionally not imported anymore.

export async function GET() {
  const session = await auth();

  const email = session?.user?.email ?? null;
  const userId = session?.user?.id ?? "";

  return NextResponse.json({
    vipJobsEnabled: shouldUserSeeVip(email, userId),
    briefRendersEnabled: shouldUserSeeBriefRenders(email, userId),
    briefToIfcV3Enabled: shouldUseBriefToIfcV3(email),
  });
}
