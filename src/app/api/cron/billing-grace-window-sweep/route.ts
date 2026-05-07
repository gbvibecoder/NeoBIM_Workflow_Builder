import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/billing-grace-window-sweep
 *
 * Hourly Vercel cron that downgrades users whose paid grace window has
 * expired (stripeCurrentPeriodEnd < now AND user still on a paid role).
 * All gated on BILLING_GRACE_WINDOW_ENABLED — when off, the route emits
 * the flag-off metric and returns immediately.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Mirrors the existing
 * /api/cron/reconcile-subscriptions/route.ts auth pattern exactly so ops
 * has only one secret to manage.
 *
 * Heavy lifting lives in ./run.ts (lazy-imported) — keeps cold-start cost
 * out of route module load if the cron is disabled.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[BILLING_CRON] CRON_SECRET is not set — refusing to run");
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { runGraceWindowSweep } = await import("./run");
  try {
    const report = await runGraceWindowSweep();
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[BILLING_CRON] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
