/**
 * Billing structured-log metrics.
 *
 * Logging stack: src/lib/logger.ts is a thin console.* wrapper. `.info` is
 * suppressed in production (`if (isDev) console.info(...)`), which would
 * silence most of these metrics in the only environment that matters.
 * We therefore route by severity:
 *
 *   - severity 'info'  → console.log directly (bypasses dev-only gate so
 *                        metrics emit in prod; matches Vercel's stdout
 *                        log scraping).
 *   - severity 'warn'  → logger.warn (always logs).
 *   - severity 'error' → logger.error (always logs).
 *
 * Output shape is a single-line JSON payload so any observability tool
 * (Vercel logs, Sentry breadcrumbs, Datadog log scraping, simple grep)
 * can parse it without a custom format.
 *
 * No new dependencies. No edits to src/lib/logger.ts.
 *
 * Adding a new metric: define the constant, write a typed helper, pick a
 * severity. Never inline metric strings at call sites — import the typed
 * helper so a typo becomes a tsc error instead of disappearing into log
 * search forever.
 */

import { logger } from "@/lib/logger";

// ─── Metric name constants ──────────────────────────────────────────

export const BILLING_ROLE_DOWNGRADED = "billing.role_downgraded" as const;
export const BILLING_ROLE_PRESERVED_IN_GRACE = "billing.role_preserved_in_grace" as const;
export const BILLING_CANCEL_WITH_NO_PERIOD_END = "billing.cancel_with_no_period_end" as const;
export const BILLING_GRACE_WINDOW_FLAG_OFF = "billing.grace_window_flag_off" as const;
export const BILLING_PAST_DUE_PRESERVED = "billing.past_due_preserved" as const;

// ─── Shared types ────────────────────────────────────────────────────

/** Payment provider — identifies which webhook flow produced the event. */
export type Provider = "razorpay" | "stripe";

/** Origin of a role transition. Webhook = cancel/halt event handler;
 *  cron = the hourly grace-window sweep; manual = ops intervention. */
export type TriggeredBy = "webhook" | "cron" | "manual";

// ─── Internal emitter ────────────────────────────────────────────────

type Severity = "info" | "warn" | "error";

function nowIso(): string {
  return new Date().toISOString();
}

function emit(
  payload: { metric: string; severity: Severity; ts: string } & Record<string, unknown>,
): void {
  // Wrap every payload so log scrapers can filter by `kind === "metric"`.
  const enriched = { kind: "metric" as const, ...payload };
  const serialised = JSON.stringify(enriched);

  if (payload.severity === "warn") {
    logger.warn(serialised);
    return;
  }
  if (payload.severity === "error") {
    logger.error(serialised);
    return;
  }
  // 'info' severity: bypass the project logger (which suppresses .info in
  // prod) and write directly so observability tools pick it up.
  console.log(serialised);
}

// ─── Typed helpers — one per metric ─────────────────────────────────

/**
 * A user's role was downgraded to FREE. Emitted exclusively by
 * applyImmediateDowngrade() — the only function in the new code paths
 * that writes role='FREE'. Anywhere else writing this would be a regression.
 */
export function billingRoleDowngraded(args: {
  userId: string;
  fromRole: string;
  toRole: string;
  reason: string;
  triggeredBy: TriggeredBy;
  providerEventId?: string;
}): void {
  emit({
    metric: BILLING_ROLE_DOWNGRADED,
    severity: "info",
    ts: nowIso(),
    userId: args.userId,
    fromRole: args.fromRole,
    toRole: args.toRole,
    reason: args.reason,
    triggeredBy: args.triggeredBy,
    ...(args.providerEventId !== undefined ? { providerEventId: args.providerEventId } : {}),
  });
}

/**
 * A cancel/halt/expire/delete event arrived but the user is still inside
 * their paid period — role kept as-is, only stripeCurrentPeriodEnd refreshed.
 * This is the metric that proves the bug is fixed.
 */
export function billingRolePreservedInGrace(args: {
  userId: string;
  provider: Provider;
  eventType: string;
  graceUntilIso: string;
}): void {
  emit({
    metric: BILLING_ROLE_PRESERVED_IN_GRACE,
    severity: "info",
    ts: nowIso(),
    userId: args.userId,
    provider: args.provider,
    eventType: args.eventType,
    graceUntilIso: args.graceUntilIso,
  });
}

/**
 * A cancel event arrived without a usable currentPeriodEnd. The handler
 * refuses to downgrade and refuses to write a fake period_end — leaves
 * the user untouched and emits this metric so ops can investigate.
 *
 * ALERT METRIC — expected count: 0. Page on any non-zero count.
 */
export function billingCancelWithNoPeriodEnd(args: {
  provider: Provider;
  eventType: string;
  userId: string | null;
  subscriptionId: string | null;
}): void {
  emit({
    metric: BILLING_CANCEL_WITH_NO_PERIOD_END,
    severity: "warn",
    ts: nowIso(),
    provider: args.provider,
    eventType: args.eventType,
    userId: args.userId,
    subscriptionId: args.subscriptionId,
  });
}

/**
 * The grace-window feature flag is off and the handler fell through to the
 * legacy (immediate-downgrade) code path. Expected during shadow-mode
 * rollout. Once the flag is fully ON in production this metric should
 * drop to zero.
 */
export function billingGraceWindowFlagOff(args: {
  handler: string;
  userId: string | null;
  event: string;
}): void {
  emit({
    metric: BILLING_GRACE_WINDOW_FLAG_OFF,
    severity: "info",
    ts: nowIso(),
    handler: args.handler,
    userId: args.userId,
    event: args.event,
  });
}

/**
 * Stripe sent customer.subscription.updated with status='past_due'. Stripe's
 * Smart Retries keep the subscription in past_due for up to ~3 weeks while
 * re-attempting the failed renewal. We preserve role so a transient card
 * decline doesn't kick paying users off their plan. Normal volume is
 * non-zero (cards genuinely fail); a sustained spike means renewal flows
 * are systematically broken.
 */
export function billingPastDuePreserved(args: {
  userId: string;
  provider: Provider;
  attemptCount?: number;
}): void {
  emit({
    metric: BILLING_PAST_DUE_PRESERVED,
    severity: "info",
    ts: nowIso(),
    userId: args.userId,
    provider: args.provider,
    ...(typeof args.attemptCount === "number" ? { attemptCount: args.attemptCount } : {}),
  });
}
