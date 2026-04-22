"use client";

import { Upload, Layers, Presentation } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import { ScrollReveal } from "./ScrollReveal";

const STEPS = [
  { num: "01", icon: Upload, titleKey: "light.step1Title" as TranslationKey, descKey: "light.step1Desc" as TranslationKey },
  { num: "02", icon: Layers, titleKey: "light.step2Title" as TranslationKey, descKey: "light.step2Desc" as TranslationKey },
  { num: "03", icon: Presentation, titleKey: "light.step3Title" as TranslationKey, descKey: "light.step3Desc" as TranslationKey },
];

export function LightWhatItDoes() {
  const { t } = useLocale();

  return (
    <section
      id="what-it-does"
      style={{
        padding: "128px 24px",
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
          {t("light.howLabel")}
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
          {t("light.howTitle")}
        </h2>
      </ScrollReveal>

      {/* 3-column grid */}
      <ScrollReveal
        stagger
        className="light-steps-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 24,
        }}
      >
        {STEPS.map((step) => (
          <div
            key={step.num}
            className="light-step-card"
            style={{
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
            {/* Step number */}
            <p
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.12em",
                color: "var(--light-ink)",
                fontFamily: "var(--font-jetbrains), monospace",
                margin: "0 0 16px",
              }}
            >
              {step.num}
            </p>

            {/* Icon */}
            <step.icon
              size={28}
              strokeWidth={1.5}
              style={{ color: "var(--light-ink)", marginBottom: 16 }}
            />

            {/* Title */}
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
              {t(step.titleKey)}
            </h3>

            {/* Description */}
            <p
              style={{
                fontSize: 15,
                fontWeight: 400,
                lineHeight: 1.6,
                color: "var(--light-soft)",
                fontFamily: "var(--font-dm-sans), sans-serif",
                margin: 0,
              }}
            >
              {t(step.descKey)}
            </p>
          </div>
        ))}
      </ScrollReveal>

      <style>{`
        @media (max-width: 768px) {
          #what-it-does {
            padding: 80px 24px !important;
          }
          #what-it-does > div:first-child {
            margin-bottom: 40px !important;
          }
          .light-steps-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
        }
        @media (max-width: 480px) {
          #what-it-does {
            padding: 64px 16px !important;
          }
        }
      `}</style>
    </section>
  );
}
