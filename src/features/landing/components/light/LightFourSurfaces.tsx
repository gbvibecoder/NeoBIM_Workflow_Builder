"use client";

import Link from "next/link";
import { Layers, Building2, FileText, Palette, ArrowRight } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ScrollReveal } from "./ScrollReveal";
import { trackCTAClick } from "./LightTrackingEvents";
import { FloorPlanIllustration } from "./illustrations/FloorPlanIllustration";
import { IFCViewerIllustration } from "./illustrations/IFCViewerIllustration";
import { BriefRendersIllustration } from "./illustrations/BriefRendersIllustration";
import { RenderStudioIllustration } from "./illustrations/RenderStudioIllustration";
import type { TranslationKey } from "@/lib/i18n";

interface TileConfig {
  num: string;
  nameKey: TranslationKey;
  nameEmKey: TranslationKey;
  taglineKey: TranslationKey;
  descKey: TranslationKey;
  ctaKey: TranslationKey;
  href: string;
  trackLabel: string;
  icon: typeof Layers;
  preview: (props: { className?: string }) => React.JSX.Element;
  accentColor: string;
  iconBg: string;
  previewBg: string;
}

const TILES: TileConfig[] = [
  {
    num: "FB-P01",
    nameKey: "light.fourSurfaces.card1Title",
    nameEmKey: "light.fourSurfaces.card1TitleEm",
    taglineKey: "light.fourSurfaces.card1Subtitle",
    descKey: "light.fourSurfaces.card1Body",
    ctaKey: "light.fourSurfaces.card1Cta",
    href: "/register?tool=floor-plan&utm_source=light&utm_content=four-surfaces",
    trackLabel: "OPEN_EDITOR",
    icon: Layers,
    preview: FloorPlanIllustration,
    accentColor: "#3D5C40",
    iconBg: "rgba(61, 92, 64, 0.08)",
    previewBg: "linear-gradient(135deg, #F0EFEA, #E5E2D8)",
  },
  {
    num: "FB-P02",
    nameKey: "light.fourSurfaces.card2Title",
    nameEmKey: "light.fourSurfaces.card2TitleEm",
    taglineKey: "light.fourSurfaces.card2Subtitle",
    descKey: "light.fourSurfaces.card2Body",
    ctaKey: "light.fourSurfaces.card2Cta",
    href: "/register?tool=ifc-viewer&utm_source=light&utm_content=four-surfaces",
    trackLabel: "UPLOAD_IFC",
    icon: Building2,
    preview: IFCViewerIllustration,
    accentColor: "#B8762D",
    iconBg: "rgba(184, 118, 45, 0.08)",
    previewBg: "linear-gradient(135deg, #FBF5EA, #F0E6D0)",
  },
  {
    num: "FB-P03",
    nameKey: "light.fourSurfaces.card3Title",
    nameEmKey: "light.fourSurfaces.card3TitleEm",
    taglineKey: "light.fourSurfaces.card3Subtitle",
    descKey: "light.fourSurfaces.card3Body",
    ctaKey: "light.fourSurfaces.card3Cta",
    href: "/register?tool=brief-renders&utm_source=light&utm_content=four-surfaces",
    trackLabel: "UPLOAD_BRIEF",
    icon: FileText,
    preview: BriefRendersIllustration,
    accentColor: "#6B4566",
    iconBg: "rgba(107, 69, 102, 0.08)",
    previewBg: "linear-gradient(135deg, #F5EEF4, #EBE0E8)",
  },
  {
    num: "FB-P04",
    nameKey: "light.fourSurfaces.card4Title",
    nameEmKey: "light.fourSurfaces.card4TitleEm",
    taglineKey: "light.fourSurfaces.card4Subtitle",
    descKey: "light.fourSurfaces.card4Body",
    ctaKey: "light.fourSurfaces.card4Cta",
    href: "/register?tool=render-studio&utm_source=light&utm_content=four-surfaces",
    trackLabel: "START_RENDER",
    icon: Palette,
    preview: RenderStudioIllustration,
    accentColor: "#C26A3B",
    iconBg: "rgba(194, 106, 59, 0.08)",
    previewBg: "linear-gradient(180deg, #1A1F2E, #0E1218)",
  },
];

export function LightFourSurfaces() {
  const { t } = useLocale();

  return (
    <section
      id="four-surfaces"
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
          {t("light.fourSurfaces.label")}
        </p>
        <h2
          style={{
            fontSize: "clamp(1.8rem, 3.5vw, 2.5rem)", fontWeight: 400,
            lineHeight: 1.15, letterSpacing: "-0.02em",
            color: "var(--light-ink)", fontFamily: "var(--font-instrument), serif",
            margin: "0 0 12px",
          }}
        >
          {t("light.fourSurfaces.headlinePart1")}
          <em style={{ fontStyle: "italic" }}>{t("light.fourSurfaces.headlineEm1")}</em>
          {t("light.fourSurfaces.headlinePart2")}
          <em style={{ fontStyle: "italic" }}>{t("light.fourSurfaces.headlineEm2")}</em>.
        </h2>
        <p
          style={{
            fontSize: 16, fontWeight: 400, lineHeight: 1.6,
            color: "var(--light-soft)", fontFamily: "var(--font-dm-sans), sans-serif",
            maxWidth: 520, margin: 0,
          }}
        >
          {t("light.fourSurfaces.subhead")}
        </p>
      </ScrollReveal>

      {/* 4-column grid */}
      <ScrollReveal stagger className="light-four-surfaces-grid" style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16, alignItems: "stretch",
      }}>
        {TILES.map((tile) => {
          const Icon = tile.icon;
          const Preview = tile.preview;
          return (
            <Link
              key={tile.num}
              href={tile.href}
              onClick={() => trackCTAClick(tile.trackLabel, `four_surfaces_${tile.num.toLowerCase()}`)}
              className="light-surface-card"
              style={{
                display: "flex", flexDirection: "column",
                background: "var(--light-bg)", border: "1px solid var(--light-border)",
                borderRadius: 14, overflow: "hidden", textDecoration: "none",
                transition: "border-color 200ms, transform 200ms, box-shadow 200ms",
                position: "relative",
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
              {/* Strip header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "5px 14px", borderBottom: "1px solid var(--light-border)",
                background: "rgba(26, 77, 92, 0.012)",
              }}>
                <span style={{
                  fontFamily: "var(--font-jetbrains), monospace", fontSize: 8,
                  fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "var(--light-soft)",
                }}>{tile.num}</span>
                <span style={{
                  fontFamily: "var(--font-jetbrains), monospace", fontSize: 8,
                  letterSpacing: "0.1em", color: "#1A4D5C",
                }}>&#10003;</span>
              </div>

              {/* Illustration */}
              <div style={{
                height: 140, display: "flex", alignItems: "center",
                justifyContent: "center", overflow: "hidden", background: tile.previewBg,
              }}>
                <Preview />
              </div>

              {/* Body */}
              <div style={{ padding: "18px 18px 20px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {/* Icon chip */}
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: tile.iconBg, color: tile.accentColor,
                }}>
                  <Icon size={18} />
                </div>

                {/* Title */}
                <p style={{
                  fontFamily: "var(--font-instrument), serif", fontSize: 18,
                  fontWeight: 400, color: "var(--light-ink)", margin: 0, lineHeight: 1.25,
                }}>
                  {t(tile.nameKey)}
                  <em style={{ fontStyle: "italic", color: tile.accentColor }}>
                    {t(tile.nameEmKey)}
                  </em>
                </p>

                {/* Tagline */}
                <p style={{
                  fontFamily: "var(--font-jetbrains), monospace", fontSize: 10,
                  fontWeight: 500, letterSpacing: "0.06em", color: "var(--light-soft)", margin: 0,
                }}>
                  {t(tile.taglineKey)}
                </p>

                {/* Description */}
                <p style={{
                  fontFamily: "var(--font-dm-sans), sans-serif", fontSize: 13,
                  lineHeight: 1.55, color: "var(--light-soft)", margin: 0, flex: 1,
                }}>
                  {t(tile.descKey)}
                </p>

                {/* CTA */}
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontFamily: "var(--font-jetbrains), monospace", fontSize: 10.5,
                  fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: tile.accentColor,
                }}>
                  {t(tile.ctaKey)} <ArrowRight size={13} />
                </span>
              </div>
            </Link>
          );
        })}
      </ScrollReveal>

      <style>{`
        @media (max-width: 1024px) {
          .light-four-surfaces-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          .light-four-surfaces-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
