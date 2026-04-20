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

export async function GET() {
  const session = await auth();

  return NextResponse.json({
    vipJobsEnabled: shouldUserSeeVip(
      session?.user?.email ?? null,
      session?.user?.id ?? "",
    ),
  });
}
