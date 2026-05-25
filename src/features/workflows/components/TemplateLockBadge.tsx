/**
 * Lock affordance for templates the user can't access yet.
 *
 * Three layers, all absolutely positioned inside the parent `.cardIllus`:
 *
 *   1. **Tier pill** (always visible) — gold gradient pill in the top-right
 *      corner with the tier label ("MINI" / "STARTER" / "PRO" / "TEAM") plus
 *      a Crown (PRO / TEAM) or Lock (MINI / STARTER) icon. The pill *itself*
 *      announces the requirement, so the user can tell PRO from STARTER from
 *      MINI at a glance without reading the card body.
 *
 *   2. **Scrim** — translucent diagonal gradient that fades in on parent
 *      hover. Keeps the artwork *visible underneath* (≈45 % darken) so the
 *      gold button + sub-line read cleanly against the backdrop without
 *      destroying the illustration. (Earlier iteration applied
 *      `filter: blur(3px) brightness(0.45)` directly to the art layer; that
 *      leaked to the resting state via `:focus-within` after any click.
 *      Scrim doesn't have that failure mode — see §Y.)
 *
 *   3. **Hover reveal** — chunky dark-gold pill button + sub-line, centered
 *      over the card art. Driven by `.card[data-locked="true"]:hover` /
 *      `:focus-within` selectors in this module so the reveal stays in
 *      lockstep with the scrim fade.
 *
 * All three are pointer-events:none — clicks belong to the parent card.
 *
 * Mobile: `@media (hover: none)` shows the scrim + reveal persistently so
 * the affordance is reachable on touch devices where `:hover` is unreliable.
 * The card's onClick still fires `openInlineUpgradeCheckout` either way.
 *
 * Reduced-motion: scale + bounce + shine all collapse to opacity-only fades.
 *
 * SSOT for tier label + price: STRIPE_PLANS via getUpgradeTargetForTemplate().
 */
"use client";

import { Crown, Lock } from "lucide-react";
import type { TemplateTier } from "@/features/billing/lib/template-access";
import s from "@/features/workflows/components/TemplateLockBadge.module.css";

interface TemplateLockBadgeProps {
  tier: TemplateTier;
  /** Plan display label, e.g. "Pro" / "Starter" — typically from
   *  STRIPE_PLANS[tier].name via getUpgradeTargetForTemplate. */
  label: string;
  /** Monthly price in INR (₹). Rendered in the sub-line beneath the CTA. */
  price: number;
  /** True when pricing is sales-negotiated (TEAM). Shows "Contact Sales"
   *  instead of a price + self-serve checkout CTA. */
  isCustom?: boolean;
}

/** Indian-locale grouping for INR display (₹1,999 / ₹2,999 / ₹4,999). */
function formatINR(n: number): string {
  try {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(n);
  }
}

export function TemplateLockBadge({ tier, label, price, isCustom }: TemplateLockBadgeProps) {
  const Icon = tier === "PRO" || tier === "TEAM" ? Crown : Lock;
  const tierUpper = label.toUpperCase();

  return (
    <>
      {/* Gold tier pill — always visible in the top-right corner */}
      <div
        className={s.pin}
        aria-label={`Premium template — requires ${label}`}
        role="img"
      >
        <Icon size={12} strokeWidth={2.4} className={s.pinIcon} aria-hidden="true" />
        <span className={s.pinLabel}>{tierUpper}</span>
      </div>

      {/* Translucent scrim — image stays readable underneath */}
      <div className={s.scrim} aria-hidden="true" />

      {/* Center reveal — fades in on parent card hover (or always on mobile) */}
      <div className={s.reveal} aria-hidden="true">
        <div className={s.cta}>
          <span className={s.ctaIcon}>
            <Crown size={16} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className={s.ctaLabel}>{isCustom ? "Contact Sales" : `Upgrade to ${label}`}</span>
          <span className={s.shine} aria-hidden="true" />
        </div>
        <div className={s.sub}>
          {isCustom ? (
            <span>Custom pricing · unlocks all {label} templates</span>
          ) : (
            <>
              <strong className={s.subPrice}>₹{formatINR(price)}</strong>
              <span className={s.subSep}>/month</span>
              <span className={s.subDot}>·</span>
              <span>unlocks all {label} templates</span>
            </>
          )}
        </div>
      </div>
    </>
  );
}
