"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { useLocale } from "@/hooks";
import {
  Shield,
  Lock,
  Eye,
  Server,
  FileText,
  UserCheck,
  Globe,
  RefreshCw,
  ArrowLeft,
  Building2,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

export default function PrivacyPage() {
  const { t } = useLocale();

  const sections = [
    { id: "01", icon: Eye, color: "#4F8AFF", title: t('privacy.section01Title'), content: [t('privacy.section01P1'), t('privacy.section01P2'), t('privacy.section01P3')] },
    { id: "02", icon: Server, color: "#8B5CF6", title: t('privacy.section02Title'), content: [t('privacy.section02P1'), t('privacy.section02P2'), t('privacy.section02P3')] },
    { id: "03", icon: Lock, color: "#10B981", title: t('privacy.section03Title'), content: [t('privacy.section03P1'), t('privacy.section03P2'), t('privacy.section03P3')] },
    { id: "04", icon: FileText, color: "#F59E0B", title: t('privacy.section04Title'), content: [t('privacy.section04P1'), t('privacy.section04P2'), t('privacy.section04P3')] },
    { id: "05", icon: UserCheck, color: "#4F8AFF", title: t('privacy.section05Title'), content: [t('privacy.section05P1'), t('privacy.section05P2'), t('privacy.section05P3')] },
    { id: "06", icon: Globe, color: "#8B5CF6", title: t('privacy.section06Title'), content: [t('privacy.section06P1'), t('privacy.section06P2')] },
    { id: "07", icon: RefreshCw, color: "#10B981", title: t('privacy.section07Title'), content: [t('privacy.section07P1'), t('privacy.section07P2'), t('privacy.section07P3')] },
  ];
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.97]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#07070D",
        color: "#F0F0F5",
        overflowX: "hidden",
      }}
    >
      {/* ── Navbar ─────────────────────────────────────────── */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 max(16px, min(48px, 4vw))",
          height: 64,
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <img
              src="/buildflow_logo.png"
              alt="BuildFlow"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#F0F0F5",
              letterSpacing: "-0.3px",
            }}
          >
            Build<span style={{ color: "#4F8AFF" }}>Flow</span>
          </span>
        </Link>
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#9898B0",
            textDecoration: "none",
            transition: "color 0.2s",
          }}
        >
          <ArrowLeft size={14} />
          {t('privacy.backToHome')}
        </Link>
      </nav>

      {/* ── Hero ───────────────────────────────────────────── */}
      <motion.section
        ref={heroRef}
        style={{
          paddingTop: 140,
          paddingBottom: 60,
          position: "relative",
          overflow: "hidden",
          opacity: heroOpacity,
          scale: heroScale,
        }}
      >
        {/* Background effects */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div className="blueprint-grid" />
          <div
            className="orb-drift-1"
            style={{
              position: "absolute",
              top: "-10%",
              left: "5%",
              width: 600,
              height: 600,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(79,138,255,0.1) 0%, transparent 70%)",
              filter: "blur(40px)",
            }}
          />
          <div
            className="orb-drift-2"
            style={{
              position: "absolute",
              top: "10%",
              right: "5%",
              width: 500,
              height: 500,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)",
              filter: "blur(40px)",
            }}
          />
        </div>

        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
            padding: "0 48px",
            position: "relative",
            zIndex: 1,
            textAlign: "center",
          }}
        >
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.6, ease: smoothEase }}
          >
            <span
              className="blueprint-annotation"
              style={{ marginBottom: 16, display: "block" }}
            >
              {t('privacy.heroAnnotation')}
            </span>
            <div className="accent-line" />

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 72,
                height: 72,
                borderRadius: 20,
                background:
                  "linear-gradient(135deg, rgba(79,138,255,0.15), rgba(139,92,246,0.1))",
                border: "1px solid rgba(79,138,255,0.15)",
                marginBottom: 28,
              }}
            >
              <Shield size={32} strokeWidth={1.5} color="#4F8AFF" />
            </div>

            <h1
              style={{
                fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)",
                fontWeight: 900,
                letterSpacing: "-0.04em",
                lineHeight: 1.1,
                marginBottom: 20,
              }}
            >
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #4F8AFF, #8B5CF6, #C084FC)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {t('privacy.title')}
              </span>
            </h1>
            <p
              style={{
                fontSize: 16,
                color: "#9898B0",
                lineHeight: 1.7,
                maxWidth: 560,
                margin: "0 auto",
              }}
            >
              {t('privacy.heroDesc')}
            </p>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease: smoothEase }}
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 24,
              marginTop: 36,
              flexWrap: "wrap",
            }}
          >
            {[
              { label: t('privacy.badgeTls'), icon: Lock },
              { label: t('privacy.badgeGdpr'), icon: Shield },
              { label: t('privacy.badgeAec'), icon: Building2 },
            ].map((badge) => (
              <div
                key={badge.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: 10,
                  background: "rgba(79,138,255,0.06)",
                  border: "1px solid rgba(79,138,255,0.1)",
                }}
              >
                <badge.icon size={14} color="#4F8AFF" />
                <span
                  style={{ fontSize: 12, color: "#9898B0", fontWeight: 500 }}
                >
                  {badge.label}
                </span>
              </div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* ── Content Sections ───────────────────────────────── */}
      <main style={{ padding: "0 48px 80px", maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {sections.map((section, i) => (
            <motion.div
              key={section.id}
              className="node-card"
              style={
                {
                  "--node-port-color": section.color,
                } as React.CSSProperties
              }
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-40px" }}
              variants={fadeUp}
              transition={{
                duration: 0.5,
                delay: i * 0.05,
                ease: smoothEase,
              }}
            >
              <div
                className="node-header"
                style={{
                  background: `linear-gradient(135deg, ${section.color}18, ${section.color}08)`,
                  borderBottom: `1px solid ${section.color}14`,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: section.color,
                    boxShadow: `0 0 8px ${section.color}`,
                  }}
                />
                <span style={{ color: section.color }}>
                  {t('privacy.sectionLabel')} {section.id}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 8,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: `${section.color}20`,
                    color: section.color,
                    fontWeight: 600,
                  }}
                >
                  <section.icon
                    size={10}
                    style={{
                      display: "inline",
                      verticalAlign: "middle",
                      marginRight: 4,
                    }}
                  />
                  {section.title.toUpperCase().slice(0, 16)}
                </span>
              </div>
              <div style={{ padding: "24px 28px" }}>
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: "#F0F0F5",
                    marginBottom: 16,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {section.title}
                </h2>
                {section.content.map((paragraph, j) => (
                  <p
                    key={j}
                    style={{
                      fontSize: 14,
                      color: "#9898B0",
                      lineHeight: 1.8,
                      marginBottom: j < section.content.length - 1 ? 14 : 0,
                    }}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── Effective Date ─────────────────────────────── */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          transition={{ duration: 0.5, ease: smoothEase }}
          style={{
            marginTop: 48,
            textAlign: "center",
            padding: "28px 32px",
            borderRadius: 16,
            background: "rgba(18,18,30,0.5)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <p style={{ fontSize: 13, color: "#7C7C96", lineHeight: 1.7 }}>
            {t('privacy.effectiveDate')} <strong style={{ color: "#9898B0" }}>{t('privacy.effectiveDateValue')}</strong>.
            {' '}{t('privacy.effectiveDatePost')}{" "}
            <a
              href="mailto:privacy@buildflow.app"
              style={{ color: "#4F8AFF", textDecoration: "none" }}
            >
              privacy@buildflow.app
            </a>
          </p>
        </motion.div>
      </main>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer
        className="landing-footer-wrapper"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.04)",
          padding: "32px 48px",
          background: "rgba(7,7,13,0.9)",
        }}
      >
        <div
          className="landing-footer"
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <img
                src="/buildflow_logo.png"
                alt="BuildFlow"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
            <span
              style={{ fontSize: 13, color: "#5C5C78", fontWeight: 600 }}
            >
              {t('contact.footerCopyright')}
            </span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            {[
              { label: t('contact.footerPrivacy'), href: "/privacy" },
              { label: t('contact.footerTerms'), href: "/terms" },
              { label: t('contact.footerContact'), href: "/contact" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  fontSize: 12,
                  color: "#5C5C78",
                  textDecoration: "none",
                  transition: "color 0.15s",
                }}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <span style={{ fontSize: 11, color: "#3A3A50" }}>
            {t('contact.footerBeta')}
          </span>
        </div>
      </footer>

      {/* ── Mobile overrides ─────────────────────────────── */}
      <style>{`
        @media (max-width: 768px) {
          main { padding-left: 16px !important; padding-right: 16px !important; }
          section { padding-left: 16px !important; padding-right: 16px !important; }
          .landing-footer { flex-direction: column !important; gap: 16px !important; text-align: center !important; }
          .landing-footer-wrapper { padding: 24px 16px !important; }
        }
      `}</style>
    </div>
  );
}
