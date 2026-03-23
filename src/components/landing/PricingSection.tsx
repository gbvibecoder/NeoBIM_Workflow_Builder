"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { trackViewContent } from "@/lib/meta-pixel";
import { fadeUp, smoothEase } from "./landing-helpers";

export function PricingSection() {
  const { t, tArray } = useLocale();

  return (
    <section id="pricing" className="landing-section" style={{
      padding: "120px 48px", position: "relative", overflow: "hidden",
      background: "linear-gradient(180deg, #07070D 0%, #0A0A14 50%, #07070D 100%)",
    }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div className="isometric-grid" style={{ opacity: 0.25 }} />
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 1440 800" fill="none" preserveAspectRatio="xMidYMid slice">
          <path d="M200 400 Q720 300 1240 400" stroke="rgba(79,138,255,0.06)" strokeWidth="80" strokeLinecap="round" fill="none" />
          <path d="M200 400 Q720 300 1240 400" stroke="rgba(79,138,255,0.1)" strokeWidth="1.5" fill="none" className="wire-animate" />
          <line x1="300" y1="700" x2="500" y2="700" stroke="rgba(79,138,255,0.1)" strokeWidth="0.5" />
          <text x="400" y="720" className="dimension-label" textAnchor="middle">{t('landing.svgStarter')}</text>
          <line x1="600" y1="700" x2="840" y2="700" stroke="rgba(79,138,255,0.15)" strokeWidth="0.5" />
          <text x="720" y="720" className="dimension-label" textAnchor="middle">{t('landing.svgProfessional')}</text>
          <line x1="940" y1="700" x2="1140" y2="700" stroke="rgba(139,92,246,0.1)" strokeWidth="0.5" />
          <text x="1040" y="720" className="dimension-label" textAnchor="middle">{t('landing.svgEnterprise')}</text>
        </svg>
        <div className="orb-drift-2" style={{ position: "absolute", top: "5%", left: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)", filter: "blur(25px)" }} />
        <div className="orb-drift-3" style={{ position: "absolute", bottom: "10%", right: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)", filter: "blur(20px)" }} />
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
          style={{ textAlign: "center", marginBottom: 80 }}
        >
          <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block" }}>
            {t('landing.pricingSection')}
          </span>
          <div className="accent-line" />
          <h2 style={{ fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 16 }}>
            {t('landing.simpleTransparent')}<span style={{ background: "linear-gradient(135deg, #4F8AFF, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.transparent')}</span>{t('landing.pricingTitle')}
          </h2>
          <p style={{ fontSize: 16, color: "#7C7C96", marginBottom: 12 }}>{t('landing.choosePlan')}</p>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 20px", borderRadius: 100, background: "rgba(79,138,255,0.04)", border: "1px solid rgba(79,138,255,0.1)" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4F8AFF", boxShadow: "0 0 6px rgba(79,138,255,0.5)" }} />
            <span style={{ fontSize: 13, color: "#9898B0" }}>{t('billing.freeTierNote')}</span>
          </div>
        </motion.div>

        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
          variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
          className="landing-grid-4"
          style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, alignItems: "start" }}
        >
          {/* MINI */}
          <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} className="node-card" style={{ '--node-port-color': '#F59E0B' } as React.CSSProperties}>
            <div className="node-header" style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.03))", borderBottom: "1px solid rgba(245,158,11,0.12)", borderRadius: "16px 16px 0 0" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#F59E0B", boxShadow: "0 0 8px #F59E0B" }} />
              <span style={{ color: "#F59E0B" }}>MINI</span>
            </div>
            <div style={{ padding: "20px 16px" }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "#F0F0F5", marginBottom: 4 }}>{t('landing.miniTitle')}</h3>
              <p style={{ fontSize: 11, color: "#7878A0", marginBottom: 16 }}>{t('landing.miniDesc')}</p>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.03em" }}>{t('landing.miniPrice')}</span>
                <span style={{ fontSize: 12, color: "#5C5C78", marginLeft: 4 }}>{t('landing.perMonth')}</span>
              </div>
              <div style={{ marginBottom: 16, padding: "6px 10px", borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                <span style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700 }}>{t('landing.miniHighlight')}</span>
              </div>
              <Link href="/dashboard" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 16px", borderRadius: 12, background: "linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)", color: "white", fontSize: 12, fontWeight: 700, textDecoration: "none", marginBottom: 20, boxShadow: "0 4px 16px rgba(245,158,11,0.25)", transition: "all 0.2s" }}
                onClick={() => trackViewContent({ content_name: "pricing_cta_mini" })}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 24px rgba(245,158,11,0.35)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(245,158,11,0.25)"; }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 24px rgba(245,158,11,0.35)"; }}
                onBlur={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(245,158,11,0.25)"; }}
              >{t('landing.getStartedFree')}</Link>
              <div style={{ borderTop: "1px solid rgba(245,158,11,0.08)", paddingTop: 14 }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: "#5C5C78", marginBottom: 10, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>{t('landing.miniIncludes')}</div>
                {tArray('landing.miniFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 3, height: 3, borderRadius: "50%", background: "#F59E0B" }} /></div><span style={{ fontSize: 11, color: "#9898B0" }}>{f}</span></div>))}
              </div>
            </div>
          </motion.div>

          {/* STARTER */}
          <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} className="node-card" style={{ '--node-port-color': '#10B981' } as React.CSSProperties}>
            <div className="node-header" style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.03))", borderBottom: "1px solid rgba(16,185,129,0.12)", borderRadius: "16px 16px 0 0" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981" }} />
              <span style={{ color: "#10B981" }}>STARTER</span>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.starterTitle')}</h3>
              <p style={{ fontSize: 12, color: "#7878A0", marginBottom: 20 }}>{t('landing.starterDesc')}</p>
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 40, fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.03em" }}>{t('landing.starterPrice')}</span>
                <span style={{ fontSize: 14, color: "#5C5C78", marginLeft: 6 }}>{t('landing.perMonth')}</span>
              </div>
              <div style={{ marginBottom: 20, padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
                <span style={{ fontSize: 11, color: "#10B981", fontWeight: 700 }}>{t('landing.starterHighlight')}</span>
              </div>
              <Link href="/dashboard" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 20px", borderRadius: 12, background: "linear-gradient(135deg, #10B981 0%, #34D399 100%)", color: "white", fontSize: 13, fontWeight: 700, textDecoration: "none", marginBottom: 24, boxShadow: "0 4px 16px rgba(16,185,129,0.25)", transition: "all 0.2s" }}
                onClick={() => trackViewContent({ content_name: "pricing_cta_starter" })}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 24px rgba(16,185,129,0.35)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(16,185,129,0.25)"; }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 24px rgba(16,185,129,0.35)"; }}
                onBlur={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(16,185,129,0.25)"; }}
              >{t('landing.startNow')}</Link>
              <div style={{ borderTop: "1px solid rgba(16,185,129,0.08)", paddingTop: 16 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5C5C78", marginBottom: 12, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>{t('landing.starterIncludes')}</div>
                {tArray('landing.starterFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 3, height: 3, borderRadius: "50%", background: "#10B981" }} /></div><span style={{ fontSize: 12, color: "#B0B0C8" }}>{f}</span></div>))}
              </div>
            </div>
          </motion.div>

          {/* PRO */}
          <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} className="node-card" style={{ '--node-port-color': '#4F8AFF', border: "1.5px solid rgba(79,138,255,0.2)", boxShadow: "0 0 60px rgba(79,138,255,0.06)", transform: "scale(1.02)" } as React.CSSProperties}>
            <div className="node-header" style={{ background: "linear-gradient(135deg, rgba(79,138,255,0.15), rgba(99,102,241,0.08))", borderBottom: "1px solid rgba(79,138,255,0.15)", borderRadius: "15px 15px 0 0" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4F8AFF", boxShadow: "0 0 8px #4F8AFF" }} />
              <span style={{ color: "#4F8AFF" }}>PRO</span>
              <span style={{ marginLeft: "auto", fontSize: 8, padding: "2px 8px", borderRadius: 10, background: "linear-gradient(135deg, #4F8AFF, #6366F1)", color: "white", fontWeight: 700 }}>{t('landing.mostPopular')}</span>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.proTitle')}</h3>
              <p style={{ fontSize: 12, color: "#7878A0", marginBottom: 20 }}>{t('landing.proDesc')}</p>
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 40, fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.03em" }}>{t('landing.proPrice')}</span>
                <span style={{ fontSize: 14, color: "#5C5C78", marginLeft: 6 }}>{t('landing.perMonth')}</span>
              </div>
              <div style={{ marginBottom: 20, padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
                <span style={{ fontSize: 11, color: "#10B981", fontWeight: 700 }}>{t('landing.proHighlight')}</span>
              </div>
              <Link href="/dashboard" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 20px", borderRadius: 12, background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)", color: "white", fontSize: 13, fontWeight: 700, textDecoration: "none", marginBottom: 24, boxShadow: "0 4px 20px rgba(79,138,255,0.3)", transition: "all 0.2s" }}
                onClick={() => trackViewContent({ content_name: "pricing_cta_pro" })}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 30px rgba(79,138,255,0.4)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(79,138,255,0.3)"; }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 30px rgba(79,138,255,0.4)"; }}
                onBlur={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(79,138,255,0.3)"; }}
              >{t('landing.startNow')}</Link>
              <div style={{ borderTop: "1px solid rgba(79,138,255,0.1)", paddingTop: 16 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5C5C78", marginBottom: 12, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>{t('landing.proIncludes')}</div>
                {tArray('landing.proFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: "rgba(79,138,255,0.1)", border: "1px solid rgba(79,138,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 3, height: 3, borderRadius: "50%", background: "#4F8AFF" }} /></div><span style={{ fontSize: 12, color: "#D0D0E0" }}>{f}</span></div>))}
              </div>
            </div>
          </motion.div>

          {/* ENTERPRISE */}
          <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} className="node-card" style={{ '--node-port-color': '#8B5CF6' } as React.CSSProperties}>
            <div className="node-header" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(139,92,246,0.03))", borderBottom: "1px solid rgba(139,92,246,0.1)", borderRadius: "16px 16px 0 0" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8B5CF6", boxShadow: "0 0 8px #8B5CF6" }} />
              <span style={{ color: "#8B5CF6" }}>ENTERPRISE</span>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.enterprise')}</h3>
              <p style={{ fontSize: 12, color: "#7878A0", marginBottom: 20 }}>{t('landing.enterpriseDesc')}</p>
              <div style={{ marginBottom: 24 }}>
                <span style={{ fontSize: 32, fontWeight: 900, color: "#F0F0F5" }}>{t('landing.custom')}</span>
              </div>
              <a href="mailto:sales@buildflow.com" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 20px", borderRadius: 12, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.05)", color: "#F0F0F5", fontSize: 13, fontWeight: 700, textDecoration: "none", marginBottom: 24, transition: "all 0.2s" }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(139,92,246,0.1)"; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(139,92,246,0.05)"; }}
                onFocus={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(139,92,246,0.1)"; }}
                onBlur={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(139,92,246,0.05)"; }}
              >{t('landing.contactSales')}</a>
              <div style={{ borderTop: "1px solid rgba(139,92,246,0.08)", paddingTop: 16 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5C5C78", marginBottom: 12, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>{t('landing.enterpriseIncludes')}</div>
                {tArray('landing.enterpriseFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 3, height: 3, borderRadius: "50%", background: "#8B5CF6" }} /></div><span style={{ fontSize: 12, color: "#9898B0" }}>{f}</span></div>))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
