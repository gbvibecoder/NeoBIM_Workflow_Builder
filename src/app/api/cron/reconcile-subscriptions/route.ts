import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/reconcile-subscriptions
 *
 * Vercel Cron hits this endpoint on a schedule (see vercel.json). It runs the
 * same deep-scan reconcile the admin panel uses, so any payment that missed
 * our webhooks — provider-side dashboard misconfig, retry exhaustion,
 * transient verify failures — gets picked up within at most one cron cycle.
 *
 * Auth: Vercel Cron requests arrive with `Authorization: Bearer ${CRON_SECRET}`.
 * We reject anything without a matching secret so this endpoint can't be
 * abused as an open-API way to reconcile.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[CRON_RECONCILE] CRON_SECRET is not set — refusing to run');
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Lazy-load the deep-scan implementation so edge cold-starts don't pull
  // Stripe / Razorpay SDKs unless this endpoint actually runs.
  const { runCronReconcile } = await import('./run');
  try {
    const report = await runCronReconcile();
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error('[CRON_RECONCILE] failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
