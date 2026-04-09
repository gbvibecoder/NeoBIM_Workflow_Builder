"use client";

import React from "react";
import { motion } from "framer-motion";
import { LayoutGrid, Zap, Play } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { hexToRgb, fadeUp, stagger, smoothEase } from "@/components/landing/landing-helpers";

export function HowItWorksSection() {
  const { t } = useLocale();

  const steps = [
    { num: "01", title: t('landing.dragDrop'), desc: t('landing.dragDropDesc'), icon: <LayoutGrid size={28} />, color: "#3B82F6" },
    { num: "02", title: t('landing.connect'), desc: t('landing.connectDesc'), icon: <Zap size={28} />, color: "#8B5CF6" },
    { num: "03", title: t('landing.run'), desc: t('landing.runDesc'), icon: <Play size={28} />, color: "#10B981" },
  ];

  return (
    <section id="how-it-works" className="landing-section" style={{ padding: "120px 48px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div className="blueprint-grid" style={{ opacity: 0.2 }} />
        <svg style={{ position: "absolute", top: "50%", left: 0, width: "100%", height: "200px", transform: "translateY(-50%)" }} viewBox="0 0 1440 200" fill="none" preserveAspectRatio="none">
          <path d="M0 100 L1440 100" stroke="rgba(79,138,255,0.05)" strokeWidth="60" strokeLinecap="round" />
          <path d="M0 100 L1440 100" stroke="rgba(79,138,255,0.08)" strokeWidth="2" fill="none" className="wire-animate" />
          <path d="M0 100 L1440 100" stroke="rgba(139,92,246,0.06)" strokeWidth="1" fill="none" className="wire-animate" style={{ animationDelay: "1s" }} />
          <circle r="5" fill="#4F8AFF" opacity="0.8">
            <animateMotion dur="4s" repeatCount="indefinite" path="M0 100 L1440 100" />
            <animate attributeName="opacity" values="0;0.8;0.8;0" dur="4s" repeatCount="indefinite" />
          </circle>
          <circle r="3" fill="#8B5CF6" opacity="0.6">
            <animateMotion dur="4s" repeatCount="indefinite" begin="1.3s" path="M0 100 L1440 100" />
            <animate attributeName="opacity" values="0;0.6;0.6;0" dur="4s" begin="1.3s" repeatCount="indefinite" />
          </circle>
          <circle r="4" fill="#10B981" opacity="0.7">
            <animateMotion dur="4s" repeatCount="indefinite" begin="2.6s" path="M0 100 L1440 100" />
            <animate attributeName="opacity" values="0;0.7;0.7;0" dur="4s" begin="2.6s" repeatCount="indefinite" />
          </circle>
        </svg>
        <div className="orb-drift-1" style={{ position: "absolute", bottom: "5%", right: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)", filter: "blur(20px)" }} />
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
          style={{ textAlign: "center", marginBottom: 80 }}
        >
          <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block", color: "rgba(245,158,11,0.5)" }}>
            {t('landing.howItWorks')}
          </span>
          <div className="accent-line" style={{ background: "linear-gradient(90deg, #F59E0B, #EF4444)" }} />
          <h2 style={{ fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.05 }}>
            {t('landing.threeSteps')}<br />
            <span style={{ background: "linear-gradient(135deg, #F59E0B, #EF4444)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.launch')}</span>
          </h2>
        </motion.div>

        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
          variants={stagger}
          className="landing-steps"
          style={{ display: "flex", alignItems: "center", gap: 0 }}
        >
          {steps.map((step, i) => {
            const rgb = hexToRgb(step.color);
            return (
              <React.Fragment key={step.num}>
                <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: i * 0.15, ease: smoothEase }}
                  className="node-card"
                  style={{ flex: 1, '--node-port-color': step.color } as React.CSSProperties}
                >
                  <div className="node-header" style={{
                    background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.04))`,
                    borderBottom: `1px solid rgba(${rgb}, 0.12)`,
                    borderRadius: "16px 16px 0 0",
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: step.color, boxShadow: `0 0 8px ${step.color}` }} />
                    <span style={{ color: step.color }}>{t('landing.step')} {step.num}</span>
                  </div>
                  <div style={{ padding: "32px 24px", textAlign: "center" }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: 16, margin: "0 auto 20px",
                      background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.05))`,
                      border: `1px solid rgba(${rgb}, 0.2)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: step.color,
                      boxShadow: `0 0 30px rgba(${rgb}, 0.1)`,
                    }}>
                      {step.icon}
                    </div>
                    <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 10, letterSpacing: "-0.02em" }}>{step.title}</h3>
                    <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.7 }}>{step.desc}</p>
                  </div>
                </motion.div>
                {i < 2 && (
                  <div className="landing-step-connector" style={{ width: 60, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="60" height="40" viewBox="0 0 60 40" fill="none">
                      <path d="M0 20 L60 20" stroke={`rgba(${hexToRgb(i === 0 ? "#8B5CF6" : "#10B981")}, 0.3)`} strokeWidth="2" className="wire-animate" />
                      <circle r="5" fill={i === 0 ? "#8B5CF6" : "#10B981"}>
                        <animateMotion dur="1.5s" repeatCount="indefinite" path="M0 20 L60 20" />
                        <animate attributeName="opacity" values="0;1;1;0" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                    </svg>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
