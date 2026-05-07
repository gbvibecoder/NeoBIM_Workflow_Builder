/**
 * Billing feature flags — env-driven, parsed once at module load.
 *
 * BILLING_GRACE_WINDOW_ENABLED defaults to FALSE. When false, every new
 * cancel-grace-window code path skips itself and falls through to the legacy
 * (immediate-downgrade) behaviour, emitting `billing.grace_window_flag_off`
 * so we can observe what the new path WOULD have done before flipping.
 *
 * Call-site rule: NEVER read `process.env.BILLING_*` anywhere except this
 * file. Behaviour cannot be allowed to drift between webhook handlers,
 * crons, the restore script, and tests.
 */

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);

function parseBool(raw: string | undefined): boolean {
  if (!raw) return false;
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

export const billingFeatureFlags = Object.freeze({
  /**
   * Master switch for the cancel-grace-window code paths
   * (cancel/halt/expire/delete handlers + grace-window cron sweep).
   *
   * FALSE → handlers emit `billing.grace_window_flag_off` and fall through
   *         to the legacy (immediate-downgrade) behaviour. Safe default.
   * TRUE  → cancel/halt webhooks preserve role inside the paid grace
   *         window; the hourly cron downgrades only when
   *         `stripeCurrentPeriodEnd <= now()`.
   *
   * Default: FALSE. Flip to TRUE only after the restore script has run
   * cleanly in production and 24h of shadow-mode logs look right.
   */
  graceWindowEnabled: parseBool(process.env.BILLING_GRACE_WINDOW_ENABLED),
});
