"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Sparkles,
  Zap,
  Building2,
  Crown,
  Users,
  Video,
  Box,
  Image as ImageIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "@/hooks/useLocale";
import { trackViewContent } from "@/lib/meta-pixel";
import { fadeUp, smoothEase } from "@/features/landing/lib/landing-helpers";
import { STRIPE_PLANS } from "@/features/billing/lib/plan-data";
import { formatPlanLimit, interpolatePlanString } from "@/features/billing/lib/plan-helpers";

// Shared CTA button style — mirrors dashboard/billing buttons:
// solid plan color + inset highlight/shadow + outer color glow.
const ctaBase: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "14px 20px",
  borderRadius: 12,
  color: "white",
  fontSize: 15,
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: "0.02em",
  textDecoration: "none",
  cursor: "pointer",
  transition: "box-shadow 0.2s, transform 0.2s",
};

function ctaStyle(colorHex: string, rgb: string, highlighted = false): React.CSSProperties {
  const baseShadow = highlighted
    ? `inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.2), 0 10px 28px rgba(${rgb},0.6)`
    : `inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.18), 0 6px 18px rgba(${rgb},0.45)`;
  return { ...ctaBase, background: colorHex, boxShadow: baseShadow };
}
// Hover = amplify the resting glow (higher opacity + halo ring at same position).
// We deliberately keep offset/blur close to the resting shadow so the light
// doesn't disperse on hover — it just pulses brighter. No 1px colored outline
// ring — that read as a harsh border-highlight on hover.
function ctaHoverShadow(rgb: string, highlighted = false) {
  return highlighted
    ? `inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.22), 0 10px 30px rgba(${rgb},0.85), 0 0 22px rgba(${rgb},0.5)`
    : `inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.22), 0 6px 22px rgba(${rgb},0.75), 0 0 18px rgba(${rgb},0.4)`;
}

interface Credit {
  icon: React.ReactNode;
  label: string;
  value: string; // "0" → em-dash, "∞" → green, else plan color
}

interface Plan {
  tier: string;
  name: string;
  desc: string;
  price: string;
  isCustom: boolean;
  savings: string | null;
  color: string;
  rgb: string;
  gradient: string;
  icon: React.ReactNode;
  credits: Credit[];
  features: readonly string[];
  cta: string;
  ctaHref: string;
  ctaTrack: string | null;
  ctaIsLink: boolean;
  ctaIcon: React.ReactNode;
  ctaIconPosition: "left" | "right";
  badge: string | null;
  highlighted: boolean;
}

export function PricingSection() {
  const { t, tArray } = useLocale();
  const { data: session } = useSession();
  const ctaHref = (tier: string) => session ? "/dashboard" : `/register?plan=${tier.toLowerCase()}`;

  const plans: Plan[] = [
    {
      tier: "Mini",
      name: t("landing.miniTitle"),
      desc: t("landing.miniDesc"),
      price: t("landing.miniPrice"),
      isCustom: false,
      savings: interpolatePlanString(t("landing.miniHighlight"), "MINI"),
      color: "#F59E0B",
      rgb: "245,158,11",
      gradient: "linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)",
      icon: <Zap size={18} />,
      credits: [
        { icon: <Video size={13} />, label: t("billing.videoCredits"), value: formatPlanLimit(STRIPE_PLANS.MINI.limits.videoPerMonth) },
        { icon: <Box size={13} />, label: t("billing.modelCredits"), value: formatPlanLimit(STRIPE_PLANS.MINI.limits.modelsPerMonth) },
        { icon: <ImageIcon size={13} />, label: t("billing.renderCredits"), value: formatPlanLimit(STRIPE_PLANS.MINI.limits.rendersPerMonth) },
      ],
      features: tArray("landing.miniFeatures").map(s => interpolatePlanString(s, "MINI")),
      cta: t("landing.startNow"),
      ctaHref: ctaHref("Mini"),
      ctaTrack: "pricing_cta_mini",
      ctaIsLink: true,
      ctaIcon: <ArrowRight size={17} strokeWidth={2.5} style={{ opacity: 0.9 }} />,
      ctaIconPosition: "right",
      badge: null,
      highlighted: false,
    },
    {
      tier: "Starter",
      name: t("landing.starterTitle"),
      desc: t("landing.starterDesc"),
      price: t("landing.starterPrice"),
      isCustom: false,
      savings: t("landing.starterHighlight"),
      color: "#10B981",
      rgb: "16,185,129",
      gradient: "linear-gradient(135deg, #10B981 0%, #34D399 100%)",
      icon: <Building2 size={18} />,
      credits: [
        { icon: <Video size={13} />, label: t("billing.videoCredits"), value: formatPlanLimit(STRIPE_PLANS.STARTER.limits.videoPerMonth) },
        { icon: <Box size={13} />, label: t("billing.modelCredits"), value: formatPlanLimit(STRIPE_PLANS.STARTER.limits.modelsPerMonth) },
        { icon: <ImageIcon size={13} />, label: t("billing.renderCredits"), value: formatPlanLimit(STRIPE_PLANS.STARTER.limits.rendersPerMonth) },
      ],
      features: tArray("landing.starterFeatures").map(s => interpolatePlanString(s, "STARTER")),
      cta: t("landing.startNow"),
      ctaHref: ctaHref("Starter"),
      ctaTrack: "pricing_cta_starter",
      ctaIsLink: true,
      ctaIcon: <ArrowRight size={17} strokeWidth={2.5} style={{ opacity: 0.9 }} />,
      ctaIconPosition: "right",
      badge: null,
      highlighted: false,
    },
    {
      tier: "Pro",
      name: t("landing.proTitle"),
      desc: t("landing.proDesc"),
      price: t("landing.proPrice"),
      isCustom: false,
      savings: t("landing.proHighlight"),
      color: "#4F8AFF",
      rgb: "79,138,255",
      gradient: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
      icon: <Crown size={18} />,
      credits: [
        { icon: <Video size={13} />, label: t("billing.videoCredits"), value: formatPlanLimit(STRIPE_PLANS.PRO.limits.videoPerMonth) },
        { icon: <Box size={13} />, label: t("billing.modelCredits"), value: formatPlanLimit(STRIPE_PLANS.PRO.limits.modelsPerMonth) },
        { icon: <ImageIcon size={13} />, label: t("billing.renderCredits"), value: formatPlanLimit(STRIPE_PLANS.PRO.limits.rendersPerMonth) },
      ],
      features: tArray("landing.proFeatures").map(s => interpolatePlanString(s, "PRO")),
      cta: t("landing.startNow"),
      ctaHref: ctaHref("Pro"),
      ctaTrack: "pricing_cta_pro",
      ctaIsLink: true,
      ctaIcon: <ArrowRight size={17} strokeWidth={2.5} style={{ opacity: 0.9 }} />,
      ctaIconPosition: "right",
      badge: t("landing.mostPopular"),
      highlighted: true,
    },
    {
      tier: "Team",
      name: t("billing.team"),
      desc: t("billing.teamDesc"),
      price: "4,999",
      isCustom: false,
      savings: null,
      color: "#8B5CF6",
      rgb: "139,92,246",
      gradient: "linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)",
      icon: <Users size={18} />,
      credits: [
        { icon: <Video size={13} />, label: t("billing.videoCredits"), value: formatPlanLimit(STRIPE_PLANS.TEAM.limits.videoPerMonth) },
        { icon: <Box size={13} />, label: t("billing.modelCredits"), value: formatPlanLimit(STRIPE_PLANS.TEAM.limits.modelsPerMonth) },
        { icon: <ImageIcon size={13} />, label: t("billing.renderCredits"), value: formatPlanLimit(STRIPE_PLANS.TEAM.limits.rendersPerMonth) },
      ],
      features: [
        t("billing.teamFeature1"),
        t("billing.teamFeature2"),
        t("billing.teamFeature3"),
        t("billing.teamFeature4"),
        interpolatePlanString(t("billing.teamFeature5"), "TEAM"),
        t("billing.teamFeature6"),
      ],
      cta: t("landing.startNow"),
      ctaHref: ctaHref("Team"),
      ctaTrack: "pricing_cta_team",
      ctaIsLink: true,
      ctaIcon: <ArrowRight size={17} strokeWidth={2.5} style={{ opacity: 0.9 }} />,
      ctaIconPosition: "right",
      badge: null,
      highlighted: false,
    },
  ];

  return (
    <section
      id="pricing"
      className="landing-section"
      style={{
        padding: "120px 48px",
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(180deg, #07070D 0%, #0A0A14 50%, #07070D 100%)",
      }}
    >
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div className="isometric-grid" style={{ opacity: 0.25 }} />
        <svg
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          viewBox="0 0 1440 800"
          fill="none"
          preserveAspectRatio="xMidYMid slice"
        >
          <path
            d="M200 400 Q720 300 1240 400"
            stroke="rgba(79,138,255,0.06)"
            strokeWidth="80"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M200 400 Q720 300 1240 400"
            stroke="rgba(79,138,255,0.1)"
            strokeWidth="1.5"
            fill="none"
            className="wire-animate"
          />
          <line x1="300" y1="700" x2="500" y2="700" stroke="rgba(79,138,255,0.1)" strokeWidth="0.5" />
          <text x="400" y="720" className="dimension-label" textAnchor="middle">
            {t("landing.svgStarter")}
          </text>
          <line x1="600" y1="700" x2="840" y2="700" stroke="rgba(79,138,255,0.15)" strokeWidth="0.5" />
          <text x="720" y="720" className="dimension-label" textAnchor="middle">
            {t("landing.svgProfessional")}
          </text>
          <line x1="940" y1="700" x2="1140" y2="700" stroke="rgba(139,92,246,0.1)" strokeWidth="0.5" />
          <text x="1040" y="720" className="dimension-label" textAnchor="middle">
            {t("landing.svgEnterprise")}
          </text>
        </svg>
        <div
          className="orb-drift-2"
          style={{
            position: "absolute",
            top: "5%",
            left: "5%",
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)",
            filter: "blur(25px)",
          }}
        />
        <div
          className="orb-drift-3"
          style={{
            position: "absolute",
            bottom: "10%",
            right: "5%",
            width: 350,
            height: 350,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)",
            filter: "blur(20px)",
          }}
        />
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          transition={{ duration: 0.6, ease: smoothEase }}
          style={{ textAlign: "center", marginBottom: 80 }}
        >
          <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block" }}>
            {t("landing.pricingSection")}
          </span>
          <div className="accent-line" />
          <h2
            style={{
              fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)",
              fontWeight: 900,
              color: "#F0F0F5",
              letterSpacing: "-0.04em",
              lineHeight: 1.05,
              marginBottom: 16,
            }}
          >
            {t("landing.simpleTransparent")}
            <span
              style={{
                background: "linear-gradient(135deg, #4F8AFF, #A78BFA)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {t("landing.transparent")}
            </span>
            {t("landing.pricingTitle")}
          </h2>
          <p style={{ fontSize: 16, color: "#7C7C96", marginBottom: 12 }}>{t("landing.choosePlan")}</p>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 20px",
              borderRadius: 100,
              background: "rgba(79,138,255,0.04)",
              border: "1px solid rgba(79,138,255,0.1)",
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#4F8AFF",
                boxShadow: "0 0 6px rgba(79,138,255,0.5)",
              }}
            />
            <span style={{ fontSize: 13, color: "#9898B0" }}>{t("billing.freeTierNote")}</span>
          </div>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
          className="landing-grid-4"
          style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, alignItems: "stretch" }}
        >
          {plans.map((plan) => {
            const cardBase: React.CSSProperties = {
              position: "relative",
              borderRadius: 20,
              border: plan.highlighted
                ? `2px solid rgba(${plan.rgb},0.4)`
                : "1px solid rgba(255,255,255,0.06)",
              background: "#0D0D1A",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: plan.highlighted
                ? `0 16px 48px rgba(${plan.rgb},0.12), 0 0 0 1px rgba(${plan.rgb},0.15)`
                : "0 4px 20px rgba(0,0,0,0.25)",
            };

            return (
              <motion.div
                key={plan.tier}
                variants={fadeUp}
                transition={{ duration: 0.5, ease: smoothEase }}
                style={cardBase}
              >
                {/* Top accent gradient bar */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: plan.gradient,
                    zIndex: 2,
                  }}
                />

                {/* Badge (Most Popular / etc.) */}
                {plan.badge && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "50%",
                      transform: "translateX(-50%)",
                      zIndex: 20,
                      background: plan.gradient,
                      color: "white",
                      padding: "6px 14px",
                      borderRadius: "0 0 10px 10px",
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      whiteSpace: "nowrap",
                      lineHeight: 1,
                    }}
                  >
                    <Sparkles size={11} />
                    {plan.badge}
                  </div>
                )}

                {/* Content */}
                <div
                  style={{
                    position: "relative",
                    zIndex: 10,
                    padding: "32px 20px 24px",
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* Icon tile + name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: `linear-gradient(135deg, rgba(${plan.rgb},0.15) 0%, rgba(${plan.rgb},0.05) 100%)`,
                        border: `1px solid rgba(${plan.rgb},0.2)`,
                        color: plan.color,
                        flexShrink: 0,
                      }}
                    >
                      {plan.icon}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h3
                        style={{
                          fontSize: 17,
                          fontWeight: 800,
                          color: "#F0F0F5",
                          marginBottom: 2,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {plan.name}
                      </h3>
                      <p style={{ fontSize: 11, color: "#7C7C96", margin: 0, lineHeight: 1.3 }}>{plan.desc}</p>
                    </div>
                  </div>

                  {/* Price */}
                  <div style={{ marginBottom: 20 }}>
                    {plan.isCustom ? (
                      <span
                        style={{
                          fontSize: 34,
                          fontWeight: 900,
                          color: "#F0F0F5",
                          letterSpacing: "-0.03em",
                        }}
                      >
                        {plan.price}
                      </span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                        <span
                          style={{
                            fontSize: 14,
                            color: "#7C7C96",
                            fontWeight: 500,
                          }}
                        >
                          ₹
                        </span>
                        <span
                          style={{
                            fontSize: 38,
                            fontWeight: 900,
                            color: "#F0F0F5",
                            letterSpacing: "-0.03em",
                            lineHeight: 1,
                          }}
                        >
                          {plan.price}
                        </span>
                        <span style={{ fontSize: 12, color: "#55556A", marginLeft: 4 }}>
                          / {t("billing.perMonthShort")}
                        </span>
                      </div>
                    )}
                    {plan.savings && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          color: plan.color,
                        }}
                      >
                        {plan.savings}
                      </div>
                    )}
                  </div>

                  {/* AI Credits box */}
                  <div
                    style={{
                      marginBottom: 20,
                      padding: 12,
                      borderRadius: 12,
                      background: `linear-gradient(135deg, rgba(${plan.rgb},0.04) 0%, rgba(${plan.rgb},0.01) 100%)`,
                      border: `1px solid rgba(${plan.rgb},0.08)`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: "#5C5C78",
                        marginBottom: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                      }}
                    >
                      {t("billing.aiCredits")}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {plan.credits.map((c, i) => {
                        const valueColor =
                          c.value === "0"
                            ? "#3A3A50"
                            : c.value === "\u221E"
                            ? "#10B981"
                            : plan.color;
                        const displayValue =
                          c.value === "0"
                            ? "\u2014"
                            : c.value === "\u221E"
                            ? "\u221E"
                            : `${c.value}/${t("billing.perMonthShort")}`;
                        return (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              fontSize: 12,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#9898B0" }}>
                              {c.icon}
                              <span>{c.label}</span>
                            </div>
                            <span style={{ fontWeight: 800, color: valueColor }}>{displayValue}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Features */}
                  <ul
                    style={{
                      listStyle: "none",
                      margin: "0 0 24px 0",
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {plan.features.map((f, i) => (
                      <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12 }}>
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
                            background: `rgba(${plan.rgb},0.12)`,
                          }}
                        >
                          <Check size={10} strokeWidth={3} style={{ color: plan.color }} />
                        </div>
                        <span style={{ color: "#C0C0D0", lineHeight: 1.45 }}>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA at bottom */}
                  <div style={{ marginTop: "auto" }}>
                    {plan.ctaIsLink ? (
                      <Link
                        href={plan.ctaHref}
                        style={ctaStyle(plan.color, plan.rgb, plan.highlighted)}
                        onClick={() => plan.ctaTrack && trackViewContent({ content_name: plan.ctaTrack })}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = ctaHoverShadow(
                            plan.rgb,
                            plan.highlighted,
                          );
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = ctaStyle(
                            plan.color,
                            plan.rgb,
                            plan.highlighted,
                          ).boxShadow as string;
                        }}
                        onFocus={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = ctaHoverShadow(
                            plan.rgb,
                            plan.highlighted,
                          );
                        }}
                        onBlur={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = ctaStyle(
                            plan.color,
                            plan.rgb,
                            plan.highlighted,
                          ).boxShadow as string;
                        }}
                      >
                        {plan.ctaIconPosition === "left" && plan.ctaIcon}
                        {plan.cta}
                        {plan.ctaIconPosition === "right" && plan.ctaIcon}
                      </Link>
                    ) : (
                      <a
                        href={plan.ctaHref}
                        style={ctaStyle(plan.color, plan.rgb, plan.highlighted)}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = ctaHoverShadow(
                            plan.rgb,
                            plan.highlighted,
                          );
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = ctaStyle(
                            plan.color,
                            plan.rgb,
                            plan.highlighted,
                          ).boxShadow as string;
                        }}
                        onFocus={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = ctaHoverShadow(
                            plan.rgb,
                            plan.highlighted,
                          );
                        }}
                        onBlur={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = ctaStyle(
                            plan.color,
                            plan.rgb,
                            plan.highlighted,
                          ).boxShadow as string;
                        }}
                      >
                        {plan.ctaIconPosition === "left" && plan.ctaIcon}
                        {plan.cta}
                        {plan.ctaIconPosition === "right" && plan.ctaIcon}
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
