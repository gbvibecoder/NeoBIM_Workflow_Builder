"use client";

import { useLocale } from "@/hooks/useLocale";
import { ScrollReveal } from "./ScrollReveal";
import type { TranslationKey } from "@/lib/i18n";

const CARDS: {
  quoteKey: TranslationKey;
  initialsKey: TranslationKey;
  nameKey: TranslationKey;
  roleKey: TranslationKey;
  companyKey: TranslationKey;
}[] = [
  {
    quoteKey: "light.testimonials.card1Quote",
    initialsKey: "light.testimonials.card1Initials",
    nameKey: "light.testimonials.card1Name",
    roleKey: "light.testimonials.card1Role",
    companyKey: "light.testimonials.card1Company",
  },
  {
    quoteKey: "light.testimonials.card2Quote",
    initialsKey: "light.testimonials.card2Initials",
    nameKey: "light.testimonials.card2Name",
    roleKey: "light.testimonials.card2Role",
    companyKey: "light.testimonials.card2Company",
  },
  {
    quoteKey: "light.testimonials.card3Quote",
    initialsKey: "light.testimonials.card3Initials",
    nameKey: "light.testimonials.card3Name",
    roleKey: "light.testimonials.card3Role",
    companyKey: "light.testimonials.card3Company",
  },
];

export function LightTestimonials() {
  const { t } = useLocale();

  return (
    <section
      aria-label="Testimonials"
      style={{
        padding: "var(--light-section-pad) 24px",
        maxWidth: 1080,
        margin: "0 auto",
      }}
    >
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
          {t("light.testimonials.label")}
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
          {t("light.testimonials.headline")}
          <em style={{ fontStyle: "italic" }}>
            {t("light.testimonials.headlineEm")}
          </em>
        </h2>
      </ScrollReveal>

      {/* 3-card grid — card anatomy matches LightWhatItDoes exactly */}
      <ScrollReveal
        stagger
        className="light-testimonials-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 24,
          alignItems: "stretch",
        }}
      >
        {CARDS.map((card, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              background: "var(--light-bg)",
              border: "1px solid var(--light-border)",
              borderRadius: 10,
              padding: "32px 28px",
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
            {/* Quote glyph — decorative */}
            <span
              aria-hidden="true"
              style={{
                fontSize: 48,
                fontWeight: 400,
                fontStyle: "italic",
                color: "var(--light-soft)",
                opacity: 0.4,
                fontFamily: "var(--font-instrument), serif",
                lineHeight: 1,
                marginBottom: 8,
                userSelect: "none",
              }}
            >
              {"\u201C"}
            </span>

            {/* Quote body */}
            <p
              style={{
                fontSize: 17,
                fontWeight: 400,
                lineHeight: 1.5,
                color: "var(--light-ink)",
                fontFamily: "var(--font-dm-sans), sans-serif",
                margin: "0 0 24px",
                flex: 1,
              }}
            >
              {t(card.quoteKey)}
            </p>

            {/* Attribution row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Avatar circle with initials */}
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "var(--light-surface)",
                  border: "1px solid var(--light-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 400,
                    fontStyle: "italic",
                    color: "var(--light-soft)",
                    fontFamily: "var(--font-instrument), serif",
                  }}
                >
                  {t(card.initialsKey)}
                </span>
              </div>

              {/* Name + role/company */}
              <div>
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--light-ink)",
                    fontFamily: "var(--font-dm-sans), sans-serif",
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {t(card.nameKey)}
                </p>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: "var(--light-soft)",
                    fontFamily: "var(--font-dm-sans), sans-serif",
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {t(card.roleKey)}, {t(card.companyKey)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </ScrollReveal>

      <style>{`
        @media (max-width: 1024px) {
          .light-testimonials-grid {
            grid-template-columns: 1fr !important;
            max-width: 540px !important;
            margin: 0 auto !important;
          }
        }
      `}</style>
    </section>
  );
}
