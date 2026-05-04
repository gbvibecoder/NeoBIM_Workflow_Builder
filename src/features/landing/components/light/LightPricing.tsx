"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { interpolatePlanString } from "@/features/billing/lib/plan-helpers";
import { ScrollReveal } from "./ScrollReveal";
import { trackCTAClick } from "./LightTrackingEvents";
import { CONTACT_EMAIL } from "@/constants/contact";
import type { TranslationKey } from "@/lib/i18n";

interface Plan {
  tier: string;
  planKey: string | null;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  priceKey: TranslationKey;
  featuresKey: TranslationKey | null;
  featureKeys: TranslationKey[] | null;
  ctaKey: TranslationKey;
  highlighted: boolean;
  showReassurance: boolean;
}

const FREE_FEATURE_KEYS: TranslationKey[] = [
  "light.freeFeature1",
  "light.freeFeature2",
  "light.freeFeature3",
  "light.freeFeature4",
];

const TEAM_FEATURE_KEYS: TranslationKey[] = [
  "billing.teamFeature1",
  "billing.teamFeature2",
  "billing.teamFeature3",
  "billing.teamFeature4",
  "billing.teamFeature5",
  "billing.teamFeature6",
];

const ALL_PLANS: Plan[] = [
  {
    tier: "Free",
    planKey: null,
    nameKey: "light.freeName",
    descKey: "light.freeDesc",
    priceKey: "light.freePrice",
    featuresKey: null,
    featureKeys: FREE_FEATURE_KEYS,
    ctaKey: "light.freeCta",
    highlighted: false,
    showReassurance: true,
  },
  {
    tier: "Mini",
    planKey: "MINI",
    nameKey: "landing.miniTitle",
    descKey: "landing.miniDesc",
    priceKey: "landing.miniPrice",
    featuresKey: "landing.miniFeatures",
    featureKeys: null,
    ctaKey: "light.miniCta",
    highlighted: false,
    showReassurance: true,
  },
  {
    tier: "Starter",
    planKey: "STARTER",
    nameKey: "landing.starterTitle",
    descKey: "landing.starterDesc",
    priceKey: "landing.starterPrice",
    featuresKey: "landing.starterFeatures",
    featureKeys: null,
    ctaKey: "light.starterCta",
    highlighted: false,
    showReassurance: true,
  },
  {
    tier: "Pro",
    planKey: "PRO",
    nameKey: "landing.proTitle",
    descKey: "landing.proDesc",
    priceKey: "landing.proPrice",
    featuresKey: "landing.proFeatures",
    featureKeys: null,
    ctaKey: "light.heroPrimaryCTA",
    highlighted: true,
    showReassurance: true,
  },
  {
    tier: "Team",
    planKey: "TEAM",
    nameKey: "billing.team",
    descKey: "billing.teamDesc",
    priceKey: "light.teamPrice",
    featuresKey: null,
    featureKeys: TEAM_FEATURE_KEYS,
    ctaKey: "light.teamCta",
    highlighted: false,
    showReassurance: false,
  },
];

function PricingCard({
  plan,
  features,
  price,
  t,
}: {
  plan: Plan;
  features: readonly string[];
  price: string;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div
      className="light-pricing-card"
      style={{
        position: "relative",
        background: "var(--light-surface)",
        border: plan.highlighted
          ? "1.5px solid var(--light-accent)"
          : "1px solid var(--light-border)",
        borderRadius: 10,
        padding: "32px 24px",
        display: "flex",
        flexDirection: "column",
        transition:
          "border-color 200ms ease-out, transform 200ms ease-out, box-shadow 200ms ease-out",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        if (!plan.highlighted) {
          el.style.borderColor = "var(--light-border-strong)";
        }
        el.style.transform = "translateY(-2px)";
        el.style.boxShadow =
          "0 2px 4px rgba(26,31,46,0.06), 0 8px 24px rgba(26,31,46,0.08)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        if (!plan.highlighted) {
          el.style.borderColor = "var(--light-border)";
        }
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {/* Most Popular pill */}
      {plan.highlighted && (
        <span
          style={{
            position: "absolute",
            top: -12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--light-accent)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            padding: "4px 12px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        >
          {t("light.mostPopular")}
        </span>
      )}

      {/* Plan name */}
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--light-ink)",
          fontFamily: "var(--font-dm-sans), sans-serif",
          margin: "0 0 4px",
        }}
      >
        {t(plan.nameKey)}
      </h3>

      {/* Description */}
      <p
        style={{
          fontSize: 14,
          fontWeight: 400,
          color: "var(--light-soft)",
          fontFamily: "var(--font-dm-sans), sans-serif",
          margin: "0 0 16px",
          lineHeight: 1.5,
        }}
      >
        {t(plan.descKey)}
      </p>

      {/* Price */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginBottom: 16,
        }}
      >
        <span
          style={{
            fontSize: 14,
            color: "var(--light-soft)",
            fontWeight: 500,
          }}
        >
          {"\u20B9"}
        </span>
        <span
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: "var(--light-ink)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        >
          {price}
        </span>
        <span
          style={{
            fontSize: 13,
            color: "var(--light-soft)",
            marginLeft: 4,
          }}
        >
          / {t("billing.perMonthShort")}
        </span>
      </div>

      {/* Features */}
      <ul
        style={{
          listStyle: "none",
          margin: "0 0 24px",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {features.map((feature, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 13,
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 1,
                background: "rgba(26, 31, 46, 0.06)",
              }}
            >
              <Check
                size={10}
                strokeWidth={3}
                style={{ color: "var(--light-ink)" }}
              />
            </div>
            <span
              style={{
                color: "var(--light-soft)",
                lineHeight: 1.5,
                fontFamily: "var(--font-dm-sans), sans-serif",
              }}
            >
              {feature}
            </span>
          </li>
        ))}
      </ul>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* CTA */}
      <Link
        href={`/register?plan=${plan.tier.toLowerCase()}`}
        onClick={() =>
          trackCTAClick(t(plan.ctaKey), `pricing_${plan.tier.toLowerCase()}`)
        }
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: 44,
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
          fontFamily: "var(--font-dm-sans), sans-serif",
          ...(plan.highlighted
            ? {
                background: "var(--light-accent)",
                color: "#fff",
                border: "none",
              }
            : {
                background: "transparent",
                color: "var(--light-accent)",
                border: "1px solid var(--light-accent)",
              }),
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLElement;
          if (plan.highlighted) {
            el.style.background = "#3A5640";
          } else {
            el.style.background = "rgba(74, 107, 77, 0.06)";
          }
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          if (plan.highlighted) {
            el.style.background = "var(--light-accent)";
          } else {
            el.style.background = "transparent";
          }
        }}
      >
        {t(plan.ctaKey)}
      </Link>

      {/* Reassurance line */}
      {plan.showReassurance && (
        <p
          style={{
            fontSize: 12,
            fontWeight: 400,
            color: "var(--light-soft)",
            fontFamily: "var(--font-dm-sans), sans-serif",
            margin: "8px 0 0",
            textAlign: "center",
          }}
        >
          {t("light.cardReassurance")}
        </p>
      )}

      {/* Team: contact sales */}
      {plan.tier === "Team" && (
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--light-accent)",
            fontFamily: "var(--font-dm-sans), sans-serif",
            margin: "10px 0 0",
            textAlign: "center",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.textDecoration = "underline";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.textDecoration = "none";
          }}
        >
          {t("light.teamContact")}
        </a>
      )}
    </div>
  );
}

export function LightPricing() {
  const { t, tArray } = useLocale();

  return (
    <section
      id="pricing"
      style={{
        padding: "var(--light-section-pad) 24px",
        background: "var(--light-bg)",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Section header */}
        <ScrollReveal style={{ textAlign: "center", marginBottom: 64 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--light-soft)",
              fontFamily: "var(--font-jetbrains), monospace",
              margin: "0 0 16px",
            }}
          >
            {t("light.pricingLabel")}
          </p>
          <h2
            style={{
              fontSize: "clamp(1.8rem, 3.5vw, 2.5rem)",
              fontWeight: 400,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              color: "var(--light-ink)",
              fontFamily: "var(--font-instrument), serif",
              margin: "0 0 12px",
            }}
          >
            {t("light.pricingTitle")}
          </h2>
          <p
            style={{
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 1.6,
              color: "var(--light-soft)",
              fontFamily: "var(--font-dm-sans), sans-serif",
              maxWidth: 520,
              margin: "0 auto",
            }}
          >
            {t("light.pricingSubtitle")}
          </p>
        </ScrollReveal>

        {/* 5-column grid: Free + Mini + Starter + Pro + Team */}
        <ScrollReveal
          stagger
          className="light-pricing-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          {ALL_PLANS.map((plan) => {
            const features: readonly string[] = plan.featureKeys
              ? plan.featureKeys.map((k) =>
                  interpolatePlanString(t(k), plan.planKey),
                )
              : plan.featuresKey
                ? tArray(plan.featuresKey).map((s) =>
                    interpolatePlanString(s, plan.planKey),
                  )
                : [];
            const price = t(plan.priceKey);

            return (
              <PricingCard
                key={plan.tier}
                plan={plan}
                features={features}
                price={price}
                t={t}
              />
            );
          })}
        </ScrollReveal>
      </div>

      <style>{`
        @media (max-width: 1200px) {
          .light-pricing-grid {
            grid-template-columns: repeat(3, 1fr) !important;
          }
        }
        @media (max-width: 900px) {
          .light-pricing-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          #pricing {
            padding: var(--light-section-pad) 24px !important;
          }
          .light-pricing-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
        }
        @media (max-width: 480px) {
          #pricing {
            padding: var(--light-section-pad) 16px !important;
          }
        }
      `}</style>
    </section>
  );
}
