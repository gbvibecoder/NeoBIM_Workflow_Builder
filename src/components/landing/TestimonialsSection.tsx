"use client";

import { motion } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { fadeUp, smoothEase } from "@/components/landing/landing-helpers";

export function TestimonialsSection() {
  const { t } = useLocale();

  const testimonials = [
    { name: "Arjun Mehta", role: t('landing.testimonial1Role'), company: "DesignStudio Mumbai", quote: t('landing.testimonial1Quote'), color: "#4F8AFF" },
    { name: "Sarah Chen", role: t('landing.testimonial2Role'), company: "Foster+Lam Architects", quote: t('landing.testimonial2Quote'), color: "#10B981" },
    { name: "Marcus Weber", role: t('landing.testimonial3Role'), company: "BauDigital GmbH", quote: t('landing.testimonial3Quote'), color: "#8B5CF6" },
    { name: "Priya Sharma", role: t('landing.testimonial4Role'), company: "GreenBuild Consulting", quote: t('landing.testimonial4Quote'), color: "#F59E0B" },
    { name: "James Okafor", role: t('landing.testimonial5Role'), company: "UrbanEdge Design", quote: t('landing.testimonial5Quote'), color: "#00F5FF" },
  ];

  return (
    <section className="landing-section" style={{
      padding: "100px max(16px, min(48px, 4vw))", position: "relative", overflow: "hidden",
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
          style={{ textAlign: "center", marginBottom: 64 }}
        >
          <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block" }}>
            {t('landing.testimonialSection')}
          </span>
          <div className="accent-line" />
          <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.1, marginBottom: 12 }}>
            {t('landing.trustedBy')}<span style={{ background: "linear-gradient(135deg, #10B981, #4F8AFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.aecTeams')}</span>
          </h2>
          <p style={{ fontSize: 15, color: "#7C7C96", maxWidth: 500, margin: "0 auto" }}>
            {t('landing.testimonialDesc')}
          </p>
        </motion.div>

        <div className="testimonial-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {testimonials.map((item, i) => (
            <motion.div
              key={item.name}
              className="node-card"
              style={{ '--node-port-color': item.color } as React.CSSProperties}
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={fadeUp}
              transition={{ duration: 0.5, delay: i * 0.08, ease: smoothEase }}
            >
              <div style={{
                padding: "5px 14px", borderRadius: "16px 16px 0 0",
                background: `linear-gradient(135deg, ${item.color}15, ${item.color}05)`,
                borderBottom: `1px solid ${item.color}12`,
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 8, fontWeight: 700, textTransform: "uppercase" as const,
                letterSpacing: "1.5px", color: item.color,
              }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: item.color, boxShadow: `0 0 6px ${item.color}` }} />
                {t('landing.testimonialBadge')}
              </div>
              <div style={{ padding: "20px 20px 16px" }}>
                <p style={{ fontSize: 13.5, color: "#C0C0D0", lineHeight: 1.7, marginBottom: 16, fontStyle: "italic" }}>
                  &ldquo;{item.quote}&rdquo;
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: `linear-gradient(135deg, ${item.color}30, ${item.color}10)`,
                    border: `1px solid ${item.color}20`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700, color: item.color,
                  }}>
                    {item.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5" }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: "#5C5C78" }}>{item.role}, {item.company}</div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
