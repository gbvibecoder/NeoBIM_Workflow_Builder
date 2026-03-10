/**
 * POST /api/files/cleanup
 *
 * Cron endpoint that deletes R2 files older than 25 days.
 * Call this daily via Vercel Cron, GitHub Actions, or any scheduler.
 *
 * Protected by a secret token to prevent unauthorized access.
 */

import { NextResponse } from "next/server";
import { cleanupOldFiles, getStorageInfo, isR2Configured } from "@/lib/r2";

export async function POST(req: Request) {
  // Verify cron secret (set CRON_SECRET in env)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 503 });
  }

  try {
    const result = await cleanupOldFiles();
    const storage = await getStorageInfo();

    return NextResponse.json({
      success: true,
      ...result,
      storage,
    });
  } catch (err) {
    console.error("[Cleanup] Failed:", err);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}

// Also support GET for Vercel Cron (which sends GET requests)
export async function GET(req: Request) {
  return POST(req);
}
