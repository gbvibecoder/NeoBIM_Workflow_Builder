"use client";

import { motion } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { fadeUp, smoothEase } from "./landing-helpers";

export function FAQSection() {
  const { t } = useLocale();

  const faqs = [
    { q: t('landing.faq1Q'), a: t('landing.faq1A') },
    { q: t('landing.faq2Q'), a: t('landing.faq2A') },
    { q: t('landing.faq3Q'), a: t('landing.faq3A') },
    { q: t('landing.faq4Q'), a: t('landing.faq4A') },
    { q: t('landing.faq5Q'), a: t('landing.faq5A') },
    { q: t('landing.faq6Q'), a: t('landing.faq6A') },
  ];

  return (
    <section id="faq" className="landing-section" style={{
      padding: "80px max(16px, min(48px, 4vw))",
      borderTop: "1px solid rgba(255,255,255,0.04)",
      background: "linear-gradient(180deg, rgba(7,7,13,0.95) 0%, #07070D 100%)",
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
          variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
          style={{ textAlign: "center", marginBottom: 48 }}
        >
          <span className="blueprint-annotation" style={{ marginBottom: 12, display: "block" }}>
            {t('landing.faqSection')}
          </span>
          <div className="accent-line" />
          <h2 style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.5rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            {t('landing.faqTitle')}
          </h2>
        </motion.div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {faqs.map((faq, i) => (
            <motion.details
              key={i}
              className="node-card"
              style={{ '--node-port-color': '#4F8AFF', cursor: "pointer" } as React.CSSProperties}
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-20px" }}
              variants={fadeUp}
              transition={{ duration: 0.4, delay: i * 0.05, ease: smoothEase }}
            >
              <summary style={{
                padding: "16px 20px", fontSize: 14, fontWeight: 600, color: "#E0E0F0",
                listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between",
                lineHeight: 1.5,
              }}>
                {faq.q}
                <span style={{ color: "#4F8AFF", fontSize: 18, fontWeight: 300, flexShrink: 0, marginLeft: 12 }}>+</span>
              </summary>
              <div style={{ padding: "0 20px 16px", fontSize: 13, color: "#7C7C96", lineHeight: 1.7 }}>
                {faq.a}
              </div>
            </motion.details>
          ))}
        </div>
      </div>

      {/* JSON-LD FAQPage Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": faqs.map(faq => ({
              "@type": "Question",
              "name": faq.q,
              "acceptedAnswer": { "@type": "Answer", "text": faq.a },
            })),
          }),
        }}
      />
    </section>
  );
}
