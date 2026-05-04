"use client";

import Link from "next/link";
import { FileSpreadsheet, Building2, LayoutGrid, Image } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ScrollReveal } from "./ScrollReveal";
import { trackUseCaseClick } from "./LightTrackingEvents";
import type { TranslationKey } from "@/lib/i18n";

const CARDS: {
  icon: typeof FileSpreadsheet;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  href: string;
  slug: string;
}[] = [
  {
    icon: FileSpreadsheet,
    titleKey: "light.usecases.card1Title",
    bodyKey: "light.usecases.card1Body",
    href: "/register?usecase=ifc-boq",
    slug: "ifc-boq",
  },
  {
    icon: Building2,
    titleKey: "light.usecases.card2Title",
    bodyKey: "light.usecases.card2Body",
    href: "/register?usecase=brief-massing",
    slug: "brief-massing",
  },
  {
    icon: LayoutGrid,
    titleKey: "light.usecases.card3Title",
    bodyKey: "light.usecases.card3Body",
    href: "/register?usecase=floor-plan",
    slug: "floor-plan",
  },
  {
    icon: Image,
    titleKey: "light.usecases.card4Title",
    bodyKey: "light.usecases.card4Body",
    href: "/register?usecase=renders",
    slug: "renders",
  },
];

export function LightUseCases() {
  const { t } = useLocale();

  return (
    <section
      id="use-cases"
      style={{
        padding: "var(--light-section-pad) 24px",
        maxWidth: 1080,
        margin: "0 auto",
      }}
    >
      {/* Section header — matches LightWhatItDoes exactly */}
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
          {t("light.usecases.label")}
        </p>
        <h2
          style={{
            fontSize: "clamp(1.8rem, 3.5vw, 2.5rem)",
            fontWeight: 400,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--light-ink)",
            fontFamily: "var(--font-instrument), serif",
            margin: 0,
          }}
        >
          {t("light.usecases.headline")}
        </h2>
      </ScrollReveal>

      {/* 4-card grid — card anatomy matches LightWhatItDoes exactly */}
      <ScrollReveal
        stagger
        className="light-usecases-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
          alignItems: "stretch",
        }}
      >
        {CARDS.map((card) => (
          <Link
            key={card.slug}
            href={card.href}
            onClick={() => trackUseCaseClick(card.slug)}
            className="light-usecase-card"
            style={{
              display: "flex",
              flexDirection: "column",
              /* Card anatomy — identical to LightWhatItDoes 3-step cards */
              background: "var(--light-bg)",
              border: "1px solid var(--light-border)",
              borderRadius: 10,
              padding: "32px 24px",
              textDecoration: "none",
              transition:
                "border-color 200ms ease-out, transform 200ms ease-out, box-shadow 200ms ease-out",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--light-border-strong)";
              el.style.transform = "translateY(-2px)";
              el.style.boxShadow =
                "0 2px 4px rgba(26,31,46,0.06), 0 8px 24px rgba(26,31,46,0.08)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--light-border)";
              el.style.transform = "translateY(0)";
              el.style.boxShadow = "none";
            }}
          >
            {/* Icon — line-art lucide, ink color, matches WhatItDoes icons */}
            <card.icon
              size={28}
              strokeWidth={1.5}
              style={{ color: "var(--light-ink)", marginBottom: 16 }}
            />

            {/* Title — DM Sans 600, 20px, matches WhatItDoes h3 */}
            <h3
              style={{
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.3,
                color: "var(--light-ink)",
                fontFamily: "var(--font-dm-sans), sans-serif",
                margin: "0 0 12px",
              }}
            >
              {t(card.titleKey)}
            </h3>

            {/* Body — 15px, matches WhatItDoes description */}
            <p
              style={{
                fontSize: 15,
                fontWeight: 400,
                lineHeight: 1.6,
                color: "var(--light-soft)",
                fontFamily: "var(--font-dm-sans), sans-serif",
                margin: 0,
                flex: 1,
              }}
            >
              {t(card.bodyKey)}
            </p>
          </Link>
        ))}
      </ScrollReveal>

      <style>{`
        @media (max-width: 1024px) {
          .light-usecases-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          .light-usecases-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
          #use-cases {
            padding: var(--light-section-pad) 24px !important;
          }
        }
        @media (max-width: 480px) {
          #use-cases {
            padding: var(--light-section-pad) 16px !important;
          }
        }
      `}</style>
    </section>
  );
}
