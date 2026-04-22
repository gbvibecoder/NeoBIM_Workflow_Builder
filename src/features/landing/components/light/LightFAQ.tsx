"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ScrollReveal } from "./ScrollReveal";
import type { TranslationKey } from "@/lib/i18n";

const FAQ_ITEMS: { qKey: TranslationKey; aKey: TranslationKey }[] = [
  { qKey: "landing.faq1Q", aKey: "landing.faq1A" },
  { qKey: "landing.faq2Q", aKey: "landing.faq2A" },
  { qKey: "landing.faq3Q", aKey: "landing.faq3A" },
  { qKey: "landing.faq4Q", aKey: "landing.faq4A" },
  { qKey: "landing.faq5Q", aKey: "landing.faq5A" },
  { qKey: "landing.faq6Q", aKey: "landing.faq6A" },
];

export function LightFAQ() {
  const { t } = useLocale();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section
      id="faq"
      style={{
        padding: "128px 24px",
        background: "var(--light-bg)",
      }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
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
            {t("light.faqLabel")}
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
            {t("light.faqTitle")}
          </h2>
        </ScrollReveal>

        {/* FAQ list */}
        <ScrollReveal stagger>
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = openIndex === i;
            const isLast = i === FAQ_ITEMS.length - 1;

            return (
              <details
                key={i}
                open={isOpen}
                style={{
                  borderBottom: isLast
                    ? "none"
                    : "1px solid var(--light-border)",
                }}
                onToggle={(e) => {
                  const el = e.currentTarget as HTMLDetailsElement;
                  setOpenIndex(el.open ? i : null);
                }}
              >
                <summary
                  style={{
                    padding: "24px 0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    gap: 16,
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 500,
                      lineHeight: 1.4,
                      color: "var(--light-ink)",
                      fontFamily: "var(--font-dm-sans), sans-serif",
                    }}
                  >
                    {t(item.qKey)}
                  </span>
                  <Plus
                    size={20}
                    style={{
                      color: "var(--light-soft)",
                      flexShrink: 0,
                      transition: "transform 200ms ease-out",
                      transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
                    }}
                  />
                </summary>
                <div className="light-faq-answer" style={{ padding: "0 0 24px" }}>
                  <p
                    style={{
                      fontSize: 15,
                      fontWeight: 400,
                      lineHeight: 1.7,
                      color: "var(--light-soft)",
                      fontFamily: "var(--font-dm-sans), sans-serif",
                      margin: 0,
                    }}
                  >
                    {t(item.aKey)}
                  </p>
                </div>
              </details>
            );
          })}
        </ScrollReveal>
      </div>

      <style>{`
        @media (max-width: 768px) {
          #faq {
            padding: 80px 24px !important;
          }
        }
        @media (max-width: 480px) {
          #faq {
            padding: 64px 16px !important;
          }
        }
      `}</style>
    </section>
  );
}
