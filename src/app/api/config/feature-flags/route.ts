/**
 * GET /api/config/feature-flags
 *
 * Returns client-safe feature flags. Server decides what to expose.
 * DO NOT expose raw env vars — only computed booleans.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    vipJobsEnabled: process.env.PIPELINE_VIP_JOBS === "true",
  });
}
