"use client";

import Link from "next/link";
import { Play, ArrowRight } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ScrollReveal } from "./ScrollReveal";
import { trackCTAClick } from "./LightTrackingEvents";
import { BOQCalculatorIllustration } from "./illustrations/BOQCalculatorIllustration";
import { RenovationVisualizerIllustration } from "./illustrations/RenovationVisualizerIllustration";
import { PDFWalkthroughIllustration } from "./illustrations/PDFWalkthroughIllustration";
import type { TranslationKey } from "@/lib/i18n";

interface WorkflowConfig {
  num: string;
  tagKey: TranslationKey;
  nameKey: TranslationKey;
  nameEmKey: TranslationKey;
  descKey: TranslationKey;
  meta: string[];
  badgeKey: TranslationKey;
  badgeType: "top" | "hot" | "pro";
  href: string;
  trackLabel: string;
  preview: (props: { className?: string }) => React.JSX.Element;
}

const BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  top: { bg: "rgba(26, 77, 92, 0.08)", color: "#1A4D5C" },
  hot: { bg: "rgba(194, 106, 59, 0.08)", color: "#C26A3B" },
  pro: { bg: "rgba(107, 69, 102, 0.08)", color: "#6B4566" },
};

const WORKFLOWS: WorkflowConfig[] = [
  {
    num: "FB-W01",
    tagKey: "light.prebuilt.card1Tag",
    nameKey: "light.prebuilt.card1Title",
    nameEmKey: "light.prebuilt.card1TitleEm",
    descKey: "light.prebuilt.card1Body",
    meta: ["4 nodes", "~45s", "XLSX"],
    badgeKey: "light.prebuilt.badgeTop",
    badgeType: "top",
    href: "/register?template=boq-calculator&utm_source=light&utm_content=prebuilt-workflows",
    trackLabel: "RUN_WORKFLOW",
    preview: BOQCalculatorIllustration,
  },
  {
    num: "FB-W02",
    tagKey: "light.prebuilt.card2Tag",
    nameKey: "light.prebuilt.card2Title",
    nameEmKey: "light.prebuilt.card2TitleEm",
    descKey: "light.prebuilt.card2Body",
    meta: ["3 nodes", "~60s", "MP4"],
    badgeKey: "light.prebuilt.badgeHot",
    badgeType: "hot",
    href: "/register?template=renovation-visualizer&utm_source=light&utm_content=prebuilt-workflows",
    trackLabel: "RUN_WORKFLOW",
    preview: RenovationVisualizerIllustration,
  },
  {
    num: "FB-W03",
    tagKey: "light.prebuilt.card3Tag",
    nameKey: "light.prebuilt.card3Title",
    nameEmKey: "light.prebuilt.card3TitleEm",
    descKey: "light.prebuilt.card3Body",
    meta: ["5 nodes", "~3m", "MP4 + IFC"],
    badgeKey: "light.prebuilt.badgePro",
    badgeType: "pro",
    href: "/register?template=pdf-walkthrough&utm_source=light&utm_content=prebuilt-workflows",
    trackLabel: "RUN_WORKFLOW",
    preview: PDFWalkthroughIllustration,
  },
];

export function LightPrebuiltWorkflows() {
  const { t } = useLocale();

  return (
    <section
      id="prebuilt"
      style={{ padding: "var(--light-section-pad) 24px", maxWidth: 1200, margin: "0 auto" }}
    >
      {/* Section header */}
      <ScrollReveal style={{ marginBottom: 48 }}>
        <p
          style={{
            fontSize: 11, fontWeight: 500, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "var(--light-soft)",
            fontFamily: "var(--font-jetbrains), monospace", margin: "0 0 16px",
          }}
        >
          {t("light.prebuilt.label")}
        </p>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h2
              style={{
                fontSize: "clamp(1.8rem, 3.5vw, 2.5rem)", fontWeight: 400,
                lineHeight: 1.15, letterSpacing: "-0.02em",
                color: "var(--light-ink)", fontFamily: "var(--font-instrument), serif",
                margin: "0 0 12px",
              }}
            >
              {t("light.prebuilt.headlinePart1")}
              <em style={{ fontStyle: "italic" }}>{t("light.prebuilt.headlineEm1")}</em>
              {t("light.prebuilt.headlinePart2")}
              <em style={{ fontStyle: "italic" }}>{t("light.prebuilt.headlineEm2")}</em>.
            </h2>
            <p
              style={{
                fontSize: 16, fontWeight: 400, lineHeight: 1.6,
                color: "var(--light-soft)", fontFamily: "var(--font-dm-sans), sans-serif",
                maxWidth: 520, margin: 0,
              }}
            >
              {t("light.prebuilt.subhead")}
            </p>
          </div>
          <Link
            href="/register?utm_source=light&utm_content=explore-all-workflows"
            onClick={() => trackCTAClick("EXPLORE_ALL", "prebuilt_header")}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontFamily: "var(--font-jetbrains), monospace", fontSize: 10.5,
              fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--light-accent)", textDecoration: "none",
              whiteSpace: "nowrap", marginTop: 8,
            }}
          >
            {t("light.prebuilt.exploreAll")} <ArrowRight size={13} />
          </Link>
        </div>
      </ScrollReveal>

      {/* 3-column grid */}
      <ScrollReveal stagger className="light-prebuilt-grid" style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: 20, alignItems: "stretch",
      }}>
        {WORKFLOWS.map((wf) => {
          const Preview = wf.preview;
          const badge = BADGE_STYLES[wf.badgeType];
          return (
            <div
              key={wf.num}
              className="light-workflow-card"
              style={{
                display: "flex", flexDirection: "column",
                background: "var(--light-bg)", border: "1px solid var(--light-border)",
                borderRadius: 14, overflow: "hidden",
                transition: "border-color 200ms, transform 200ms, box-shadow 200ms",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = "var(--light-border-strong)";
                el.style.transform = "translateY(-4px)";
                el.style.boxShadow = "0 12px 32px -12px rgba(26,31,46,0.12)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = "var(--light-border)";
                el.style.transform = "translateY(0)";
                el.style.boxShadow = "none";
              }}
            >
              {/* Strip */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "5px 14px", borderBottom: "1px solid var(--light-border)",
                background: "rgba(26, 77, 92, 0.012)",
              }}>
                <span style={{
                  fontFamily: "var(--font-jetbrains), monospace", fontSize: 8,
                  fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "var(--light-soft)",
                }}>{wf.num}</span>
                <span style={{
                  fontFamily: "var(--font-jetbrains), monospace", fontSize: 8,
                  fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "2px 8px", borderRadius: 4,
                  background: badge.bg, color: badge.color,
                }}>{t(wf.badgeKey)}</span>
              </div>

              {/* Illustration */}
              <div style={{
                height: 180, display: "flex", alignItems: "center",
                justifyContent: "center", overflow: "hidden",
                background: "linear-gradient(135deg, #F0EFEA, #E5E2D8)",
              }}>
                <Preview />
              </div>

              {/* Body */}
              <div style={{ padding: "18px 18px 20px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {/* Category tag */}
                <span style={{
                  display: "inline-flex", alignSelf: "flex-start",
                  padding: "3px 10px", borderRadius: 6,
                  background: "rgba(26, 77, 92, 0.05)",
                  fontFamily: "var(--font-jetbrains), monospace", fontSize: 9,
                  fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
                  color: "#1A4D5C",
                }}>{t(wf.tagKey)}</span>

                {/* Title */}
                <p style={{
                  fontFamily: "var(--font-instrument), serif", fontSize: 18,
                  fontWeight: 400, color: "var(--light-ink)", margin: 0, lineHeight: 1.25,
                }}>
                  {t(wf.nameKey)}
                  <em style={{ fontStyle: "italic" }}>{t(wf.nameEmKey)}</em>
                </p>

                {/* Description */}
                <p style={{
                  fontFamily: "var(--font-dm-sans), sans-serif", fontSize: 13,
                  lineHeight: 1.55, color: "var(--light-soft)", margin: 0, flex: 1,
                }}>
                  {t(wf.descKey)}
                </p>

                {/* Meta pills */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {wf.meta.map((m) => (
                    <span key={m} style={{
                      fontFamily: "var(--font-jetbrains), monospace", fontSize: 9,
                      fontWeight: 500, letterSpacing: "0.04em",
                      padding: "3px 8px", borderRadius: 4,
                      background: "var(--light-surface)", color: "var(--light-soft)",
                    }}>{m}</span>
                  ))}
                </div>

                {/* Run CTA */}
                <Link
                  href={wf.href}
                  onClick={(e) => {
                    e.stopPropagation();
                    trackCTAClick(wf.trackLabel, `prebuilt_${wf.num.toLowerCase()}`);
                  }}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 6, width: "100%", height: 40, borderRadius: 8,
                    background: "var(--light-accent)", color: "#fff",
                    fontSize: 14, fontWeight: 500, textDecoration: "none",
                    fontFamily: "var(--font-dm-sans), sans-serif",
                    marginTop: 4,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#3A5640"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--light-accent)"; }}
                >
                  <Play size={12} /> {t("light.prebuilt.runCta")}
                </Link>
              </div>
            </div>
          );
        })}
      </ScrollReveal>

      <style>{`
        @media (max-width: 1024px) {
          .light-prebuilt-grid {
            grid-template-columns: 1fr !important;
            max-width: 480px !important;
            margin: 0 auto !important;
          }
        }
      `}</style>
    </section>
  );
}
