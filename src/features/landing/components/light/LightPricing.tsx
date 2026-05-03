"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { interpolatePlanString } from "@/features/billing/lib/plan-helpers";
import { ScrollReveal } from "./ScrollReveal";
import type { TranslationKey } from "@/lib/i18n";

interface Plan {
  tier: string;
  /** Matches a key in STRIPE_PLANS (used for interpolation). null = skip. */
  planKey: string | null;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  priceKey: TranslationKey;
  featuresKey: TranslationKey;
  highlighted: boolean;
}

const PLANS: Plan[] = [
  {
    tier: "Mini",
    planKey: "MINI",
    nameKey: "landing.miniTitle",
    descKey: "landing.miniDesc",
    priceKey: "landing.miniPrice",
    featuresKey: "landing.miniFeatures",
    highlighted: false,
  },
  {
    tier: "Starter",
    planKey: "STARTER",
    nameKey: "landing.starterTitle",
    descKey: "landing.starterDesc",
    priceKey: "landing.starterPrice",
    featuresKey: "landing.starterFeatures",
    highlighted: false,
  },
  {
    tier: "Pro",
    planKey: "PRO",
    nameKey: "landing.proTitle",
    descKey: "landing.proDesc",
    priceKey: "landing.proPrice",
    featuresKey: "landing.proFeatures",
    highlighted: true,
  },
  {
    tier: "Team",
    planKey: "TEAM",
    nameKey: "billing.team",
    descKey: "billing.teamDesc",
    priceKey: "landing.startNow",
    featuresKey: "landing.startNow", // placeholder — features handled separately
    highlighted: false,
  },
];

const TEAM_FEATURE_KEYS: TranslationKey[] = [
  "billing.teamFeature1",
  "billing.teamFeature2",
  "billing.teamFeature3",
  "billing.teamFeature4",
  "billing.teamFeature5",
  "billing.teamFeature6",
];

export function LightPricing() {
  const { t, tArray } = useLocale();

  return (
    <section
      id="pricing"
      style={{
        padding: "128px 24px",
        background: "var(--light-bg)",
      }}
    >
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
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

        {/* 4-column grid */}
        <ScrollReveal
          stagger
          className="light-pricing-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 20,
            alignItems: "stretch",
          }}
        >
          {PLANS.map((plan) => {
            const isTeam = plan.tier === "Team";
            const features: readonly string[] = isTeam
              ? TEAM_FEATURE_KEYS.map((k) => interpolatePlanString(t(k), "TEAM"))
              : tArray(plan.featuresKey).map(s => interpolatePlanString(s, plan.planKey));
            const price = isTeam ? "4,999" : t(plan.priceKey);

            return (
              <div
                key={plan.tier}
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
                  href="/register"
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
                  {t("landing.getStarted")}
                </Link>
              </div>
            );
          })}
        </ScrollReveal>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .light-pricing-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 768px) {
          #pricing {
            padding: 80px 24px !important;
          }
          .light-pricing-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
        }
        @media (max-width: 480px) {
          #pricing {
            padding: 64px 16px !important;
          }
        }
      `}</style>
    </section>
  );
}
