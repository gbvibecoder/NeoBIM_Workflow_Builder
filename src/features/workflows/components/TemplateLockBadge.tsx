/**
 * Gold "Upgrade to {tier}" lock badge for templates the user can't access yet.
 *
 * Sits in the top-right corner of a template card. The visual language is
 * deliberately premium — gold gradient + warm border + Crown/Lock glyph — so
 * locked tiles read as aspirational rather than punitive.
 *
 * Source of truth for tier names + pricing: STRIPE_PLANS via
 * getUpgradeTargetForTemplate (template-access.ts).
 */
"use client";

import { Crown, Lock } from "lucide-react";
import type { TemplateTier } from "@/features/billing/lib/template-access";

interface TemplateLockBadgeProps {
  tier: TemplateTier;
  /** Plan display label, e.g. "Pro" / "Starter" — typically from
   *  STRIPE_PLANS[tier].name via getUpgradeTargetForTemplate. */
  label: string;
  /** Optional className for absolute-positioning inside a card. */
  className?: string;
}

export function TemplateLockBadge({ tier, label, className }: TemplateLockBadgeProps) {
  const Icon = tier === "PRO" || tier === "TEAM" ? Crown : Lock;
  return (
    <div
      className={className}
      role="status"
      aria-label={`Upgrade to ${label} to unlock`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        background: "linear-gradient(135deg, #FFF8DC 0%, #FAEBD7 100%)",
        border: "1px solid rgba(184, 134, 11, 0.35)",
        color: "#8B6914",
        fontFamily:
          "var(--font-mono, 'JetBrains Mono'), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.2,
        lineHeight: 1,
        whiteSpace: "nowrap",
        boxShadow: "0 1px 2px rgba(184, 134, 11, 0.18)",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
      <span>Upgrade to {label}</span>
    </div>
  );
}
