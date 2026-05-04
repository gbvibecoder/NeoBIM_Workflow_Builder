"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ScrollReveal } from "./ScrollReveal";
import { trackReferralClick } from "./LightTrackingEvents";
import type { TranslationKey } from "@/lib/i18n";

const REWARDS: TranslationKey[] = [
  "light.referral.reward1",
  "light.referral.reward2",
  "light.referral.reward3",
];

const STEPS: { num: string; titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  { num: "01", titleKey: "light.referral.howStep1Title", bodyKey: "light.referral.howStep1Body" },
  { num: "02", titleKey: "light.referral.howStep2Title", bodyKey: "light.referral.howStep2Body" },
  { num: "03", titleKey: "light.referral.howStep3Title", bodyKey: "light.referral.howStep3Body" },
];

export function LightReferral() {
  const { t } = useLocale();
  const { status } = useSession();

  const ctaHref =
    status === "authenticated"
      ? "/dashboard/settings#refer"
      : "/register?intent=refer&ref_landing=light&utm_source=light&utm_content=referral_section";

  const ctaLabel =
    status === "authenticated"
      ? t("light.referral.ctaPrimaryAuth")
      : t("light.referral.ctaPrimaryUnauth");

  return (
    <section
      id="refer"
      style={{
        padding: "var(--light-section-pad) 24px",
        background: "var(--light-bg)",
      }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        {/* Section header */}
        <ScrollReveal style={{ textAlign: "center", marginBottom: 48 }}>
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
            {t("light.referral.label")}
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
            {t("light.referral.headline")}{" "}
            <em style={{ fontStyle: "italic" }}>
              {t("light.referral.headlineEm")}
            </em>
          </h2>
          <p
            style={{
              fontSize: 17,
              fontWeight: 400,
              lineHeight: 1.6,
              color: "var(--light-soft)",
              fontFamily: "var(--font-dm-sans), sans-serif",
              maxWidth: 600,
              margin: "0 auto",
            }}
          >
            {t("light.referral.subhead")}
          </p>
        </ScrollReveal>

        {/* Main referral card */}
        <ScrollReveal>
          <div
            className="light-referral-card"
            style={{
              background: "var(--light-referral-warm, #F5F1E8)",
              border: "1px solid var(--light-border)",
              borderRadius: 16,
              padding: "clamp(32px, 6vw, 56px)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "clamp(24px, 4vw, 48px)",
              alignItems: "center",
            }}
          >
            {/* Left — copy + CTA */}
            <div>
              {/* Pill */}
              <span
                style={{
                  display: "inline-flex",
                  alignSelf: "flex-start",
                  padding: "4px 10px",
                  borderRadius: 4,
                  background: "rgba(74, 107, 77, 0.08)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--light-accent)",
                  marginBottom: 16,
                }}
              >
                {t("light.referral.cardPill")}
              </span>

              {/* Card headline */}
              <h3
                style={{
                  fontSize: "clamp(1.4rem, 2.5vw, 1.8rem)",
                  fontWeight: 400,
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                  color: "var(--light-ink)",
                  fontFamily: "var(--font-instrument), serif",
                  margin: "0 0 16px",
                }}
              >
                {t("light.referral.cardHeadline1")}{" "}
                <em style={{ fontStyle: "italic" }}>
                  {t("light.referral.cardHeadlineEm1")}
                </em>
                <br />
                {t("light.referral.cardHeadline2")}{" "}
                <em style={{ fontStyle: "italic" }}>
                  {t("light.referral.cardHeadlineEm2")}
                </em>
              </h3>

              {/* Body */}
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 400,
                  lineHeight: 1.6,
                  color: "var(--light-soft)",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  margin: "0 0 20px",
                }}
              >
                {t("light.referral.cardBody")}
              </p>

              {/* Reward breakdown */}
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  flexWrap: "wrap",
                  marginBottom: 24,
                }}
              >
                {REWARDS.map((key) => (
                  <span
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--light-ink)",
                      fontFamily: "var(--font-dm-sans), sans-serif",
                    }}
                  >
                    <Check
                      size={14}
                      style={{
                        color: "var(--light-accent)",
                        flexShrink: 0,
                      }}
                    />
                    {t(key)}
                  </span>
                ))}
              </div>

              {/* CTA row */}
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <Link
                  href={ctaHref}
                  onClick={() =>
                    trackReferralClick({
                      authenticated: status === "authenticated",
                      position: "referral_section_primary",
                    })
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 46,
                    padding: "0 24px",
                    borderRadius: 8,
                    background: "var(--light-accent)",
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 600,
                    textDecoration: "none",
                    fontFamily: "var(--font-dm-sans), sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      "#3A5640";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      "var(--light-accent)";
                  }}
                >
                  {ctaLabel}
                </Link>
                <a
                  href="#refer-how"
                  onClick={(e) => {
                    e.preventDefault();
                    document
                      .getElementById("refer-how")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--light-soft)",
                    textDecoration: "none",
                    fontFamily: "var(--font-dm-sans), sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color =
                      "var(--light-ink)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color =
                      "var(--light-soft)";
                  }}
                >
                  {t("light.referral.ctaSecondary")} →
                </a>
              </div>
            </div>

            {/* Right — exchange illustration */}
            <div
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                viewBox="0 0 280 220"
                fill="none"
                style={{
                  width: "100%",
                  maxWidth: 260,
                  height: "auto",
                  display: "block",
                }}
              >
                {/* YOU block */}
                <text
                  x="60"
                  y="28"
                  textAnchor="middle"
                  fontFamily="var(--font-jetbrains), monospace"
                  fontSize="9"
                  fontWeight="500"
                  letterSpacing="0.12em"
                  fill="var(--light-soft, #5A6478)"
                >
                  YOU
                </text>
                <circle
                  cx="60"
                  cy="70"
                  r="28"
                  fill="none"
                  stroke="var(--light-ink, #1A1F2E)"
                  strokeWidth="1"
                  opacity="0.2"
                />
                <circle
                  cx="60"
                  cy="62"
                  r="8"
                  fill="none"
                  stroke="var(--light-ink, #1A1F2E)"
                  strokeWidth="1"
                  opacity="0.35"
                />
                <path
                  d="M44 84 Q52 74 60 74 Q68 74 76 84"
                  stroke="var(--light-ink, #1A1F2E)"
                  strokeWidth="1"
                  fill="none"
                  opacity="0.35"
                />

                {/* FRIEND block */}
                <text
                  x="220"
                  y="28"
                  textAnchor="middle"
                  fontFamily="var(--font-jetbrains), monospace"
                  fontSize="9"
                  fontWeight="500"
                  letterSpacing="0.12em"
                  fill="var(--light-soft, #5A6478)"
                >
                  FRIEND
                </text>
                <circle
                  cx="220"
                  cy="70"
                  r="28"
                  fill="none"
                  stroke="var(--light-ink, #1A1F2E)"
                  strokeWidth="1"
                  opacity="0.2"
                />
                <circle
                  cx="220"
                  cy="62"
                  r="8"
                  fill="none"
                  stroke="var(--light-ink, #1A1F2E)"
                  strokeWidth="1"
                  opacity="0.35"
                />
                <path
                  d="M204 84 Q212 74 220 74 Q228 74 236 84"
                  stroke="var(--light-ink, #1A1F2E)"
                  strokeWidth="1"
                  fill="none"
                  opacity="0.35"
                />

                {/* Top arrow: YOU → FRIEND (invite link) */}
                <line
                  x1="96"
                  y1="56"
                  x2="176"
                  y2="56"
                  stroke="var(--light-accent, #4A6B4D)"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                />
                <polyline
                  points="172,52 178,56 172,60"
                  stroke="var(--light-accent, #4A6B4D)"
                  strokeWidth="1"
                  fill="none"
                />
                <text
                  x="140"
                  y="48"
                  textAnchor="middle"
                  fontFamily="var(--font-jetbrains), monospace"
                  fontSize="7"
                  fontWeight="500"
                  letterSpacing="0.1em"
                  fill="var(--light-accent, #4A6B4D)"
                >
                  INVITE LINK
                </text>

                {/* Bottom arrow: FRIEND → YOU (rewards) */}
                <line
                  x1="176"
                  y1="84"
                  x2="96"
                  y2="84"
                  stroke="#C26A3B"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                />
                <polyline
                  points="100,80 94,84 100,88"
                  stroke="#C26A3B"
                  strokeWidth="1"
                  fill="none"
                />
                <text
                  x="140"
                  y="100"
                  textAnchor="middle"
                  fontFamily="var(--font-jetbrains), monospace"
                  fontSize="6.5"
                  fontWeight="500"
                  letterSpacing="0.06em"
                  fill="#C26A3B"
                >
                  + 1 WORKFLOW · 2 EXECUTIONS
                </text>

                {/* Travelling dots */}
                <circle r="2.5" fill="var(--light-accent, #4A6B4D)">
                  <animateMotion
                    dur="3s"
                    repeatCount="indefinite"
                    path="M96,56 L178,56"
                  />
                </circle>
                <circle r="2.5" fill="#C26A3B">
                  <animateMotion
                    dur="3s"
                    repeatCount="indefinite"
                    path="M176,84 L94,84"
                  />
                </circle>

                {/* Footer caption */}
                <text
                  x="140"
                  y="145"
                  textAnchor="middle"
                  fontFamily="var(--font-instrument), serif"
                  fontStyle="italic"
                  fontSize="15"
                  fill="var(--light-ink, #1A1F2E)"
                  opacity="0.7"
                >
                  Both sides win.
                </text>
              </svg>
            </div>
          </div>
        </ScrollReveal>

        {/* How it works — 3-step sub-section */}
        <div id="refer-how">
        <ScrollReveal
          stagger
          className="light-referral-steps"
          style={{
            maxWidth: 880,
            margin: "48px auto 0",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 32,
          }}
        >
          {STEPS.map((step) => (
            <div key={step.num}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.15em",
                  color: "var(--light-soft)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  margin: "0 0 12px",
                }}
              >
                {step.num}
              </p>
              <h4
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--light-ink)",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  margin: "0 0 8px",
                }}
              >
                {t(step.titleKey)}
              </h4>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: 1.6,
                  color: "var(--light-soft)",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  margin: 0,
                }}
              >
                {t(step.bodyKey)}
              </p>
            </div>
          ))}
        </ScrollReveal>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .light-referral-card {
            grid-template-columns: 1fr !important;
          }
          .light-referral-steps {
            grid-template-columns: 1fr !important;
            gap: 24px !important;
          }
        }
      `}</style>
    </section>
  );
}
