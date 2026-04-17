import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAdminSession, unauthorizedResponse, logAudit } from '@/lib/admin-server';
import { reconcileUserSubscription } from '@/features/billing/lib/reconcile';

/**
 * POST /api/admin/users/[id]/reconcile
 *
 * Force re-sync one user's role against their payment provider. Intended for
 * support engineers fixing a specific stuck account — e.g. after confirming
 * with the user that they paid, or after correcting a RAZORPAY_*_PLAN_ID env
 * var and wanting to reapply the role without waiting for the next webhook.
 *
 * Never downgrades — if plan mapping fails the user's current role is kept
 * and the outcome explains why.
 *
 * Body: { dryRun?: boolean }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;

  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body optional
  }
  const dryRun = body.dryRun === true;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      stripeSubscriptionId: true,
      razorpaySubscriptionId: true,
      razorpayPlanId: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const outcome = await reconcileUserSubscription(
    {
      id: user.id,
      role: user.role,
      stripeSubscriptionId: user.stripeSubscriptionId,
      razorpaySubscriptionId: user.razorpaySubscriptionId,
      razorpayPlanId: user.razorpayPlanId,
    },
    { dryRun },
  );

  if (outcome.status === 'reconciled' && !dryRun) {
    await logAudit(session.id, 'USER_ROLE_CHANGED', 'user', user.id, {
      source: 'admin_reconcile_single',
      gateway: outcome.gateway,
      previousRole: outcome.previousRole,
      newRole: outcome.newRole,
      subscriptionId: outcome.subscriptionId,
      planOrPriceId: outcome.planOrPriceId,
    });
  }

  return NextResponse.json({
    dryRun,
    user: { id: user.id, email: user.email, name: user.name, currentRole: user.role },
    outcome,
  });
}
