/**
 * Lock affordance for templates the user can't access yet.
 *
 * Renders TWO layers, both absolutely positioned inside the parent
 * `.cardIllus` container:
 *
 *   1. **Crown pin** (always visible) — small cream circle in the top-right,
 *      a quiet "this is locked" indicator that doesn't dominate the card.
 *
 *   2. **Hover reveal** — chunky dark-gold pill button + sub-line, centered
 *      over the card art. The parent CSS module (`page.module.css`) drives
 *      the show/hide via `.card[data-locked="true"]:hover` selectors so the
 *      reveal stays in lockstep with the image-blur on the same hover.
 *
 * The whole component renders pointer-events:none — the click is owned by
 * the parent card so any click on a locked card opens checkout, not just
 * a bullseye on the button.
 *
 * Accessibility: aria-hidden on decorative parts, but the parent card
 * announces "Premium template — requires {tier}. Click to upgrade."
 *
 * Reduced-motion: when `(prefers-reduced-motion: reduce)` is on, all
 * transforms collapse to opacity-only fades (driven by CSS).
 *
 * Source of truth for tier label + price: STRIPE_PLANS via
 * getUpgradeTargetForTemplate(). This component takes pre-computed
 * `label` + `price` props so it never imports billing config directly.
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
}

/** Indian-locale grouping for INR display (₹1,999 / ₹2,999 / ₹4,999). */
function formatINR(n: number): string {
  try {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(n);
  }
}

export function TemplateLockBadge({ tier, label, price }: TemplateLockBadgeProps) {
  const Icon = tier === "PRO" || tier === "TEAM" ? Crown : Lock;

  return (
    <>
      {/* Crown pin — always visible, sits on top of the art */}
      <div
        className={s.pin}
        aria-label={`Premium template — requires ${label}`}
        role="img"
      >
        <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
      </div>

      {/* Center reveal — fades in on parent card hover */}
      <div className={s.reveal} aria-hidden="true">
        <div className={s.cta}>
          <span className={s.ctaIcon}>
            <Crown size={16} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className={s.ctaLabel}>Upgrade to {label}</span>
          <span className={s.shine} aria-hidden="true" />
        </div>
        <div className={s.sub}>
          <strong className={s.subPrice}>₹{formatINR(price)}</strong>
          <span className={s.subSep}>/month</span>
          <span className={s.subDot}>·</span>
          <span>unlocks all {label} templates</span>
        </div>
      </div>
    </>
  );
}
