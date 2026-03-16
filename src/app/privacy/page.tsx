"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
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

const sections = [
  {
    id: "01",
    icon: Eye,
    color: "#4F8AFF",
    title: "Information We Collect",
    content: [
      "When you create a BuildFlow account, we collect your name, email address, and authentication credentials. For Google OAuth sign-ins, we receive your public profile information as authorized by you.",
      "As you use our platform, we collect workflow data, BIM model metadata, and execution logs to provide and improve our services. We process IFC file headers and structural data — your actual building models are never stored permanently on our servers.",
      "We automatically collect usage analytics including page views, feature interactions, and performance metrics to optimize the platform experience for AEC professionals.",
    ],
  },
  {
    id: "02",
    icon: Server,
    color: "#8B5CF6",
    title: "How We Use Your Data",
    content: [
      "Your workflow configurations and execution results are used solely to deliver the BuildFlow service. We leverage aggregated, anonymized usage patterns to improve our AI-powered node recommendations and workflow templates.",
      "BIM data processed through our pipeline (IFC parsing, floor plan analysis, 3D generation) is handled in-memory and transmitted via encrypted channels. Processed artifacts are stored in your account and can be deleted at any time.",
      "We never sell your data to third parties. We may share anonymized, aggregate statistics about AEC workflow patterns to contribute to industry research.",
    ],
  },
  {
    id: "03",
    icon: Lock,
    color: "#10B981",
    title: "Data Security",
    content: [
      "All data is encrypted in transit using TLS 1.3 and at rest using AES-256 encryption. Our infrastructure is hosted on enterprise-grade cloud platforms with SOC 2 Type II compliance.",
      "Authentication credentials are hashed using bcrypt with 12 rounds of salting. Session tokens are cryptographically signed and rotated regularly. We enforce Content Security Policy (CSP) headers and sanitize all user inputs.",
      "Access to production systems is restricted to authorized personnel with multi-factor authentication. We conduct regular security audits and penetration testing to maintain the highest standards of data protection.",
    ],
  },
  {
    id: "04",
    icon: FileText,
    color: "#F59E0B",
    title: "Cookies & Tracking",
    content: [
      "We use essential cookies for authentication session management and user preferences (such as language selection). These are strictly necessary for the platform to function.",
      "Analytics cookies help us understand how AEC professionals interact with our workflow builder. You can opt out of non-essential tracking through your account settings without affecting core functionality.",
      "We do not use third-party advertising cookies or cross-site tracking pixels. Your browsing activity within BuildFlow stays within BuildFlow.",
    ],
  },
  {
    id: "05",
    icon: UserCheck,
    color: "#4F8AFF",
    title: "Your Rights & Controls",
    content: [
      "You have the right to access, export, correct, or delete your personal data at any time. Use the Settings panel in your dashboard to manage your data, or contact us directly for assistance.",
      "You can request a complete export of your workflows, execution history, and artifacts in standard formats (JSON, CSV). Account deletion is permanent and irreversible — all associated data is purged within 30 days.",
      "For users in the European Economic Area, we comply with GDPR requirements including data portability, the right to be forgotten, and lawful basis for processing.",
    ],
  },
  {
    id: "06",
    icon: Globe,
    color: "#8B5CF6",
    title: "International Data Transfers",
    content: [
      "BuildFlow operates globally to serve AEC teams worldwide. Your data may be processed in data centers located in the United States and European Union, with appropriate safeguards in place.",
      "We rely on Standard Contractual Clauses (SCCs) and adequacy decisions for international data transfers, ensuring your data receives equivalent protection regardless of where it is processed.",
    ],
  },
  {
    id: "07",
    icon: RefreshCw,
    color: "#10B981",
    title: "Updates to This Policy",
    content: [
      "We may update this Privacy Policy to reflect changes in our practices or applicable regulations. Material changes will be communicated via email and an in-app notification at least 30 days before taking effect.",
      "Your continued use of BuildFlow after changes become effective constitutes acceptance of the revised policy. We encourage you to review this page periodically.",
      "Last updated: March 2026. For questions about this policy, contact us at privacy@buildflow.app.",
    ],
  },
];

export default function PrivacyPage() {
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
      <div className="noise-texture" />

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
          Back to Home
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
              DATA PROTECTION & COMPLIANCE
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
                Privacy Policy
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
              How BuildFlow protects your data, respects your privacy, and keeps
              your AEC workflows secure. Built with the same precision we bring
              to building information modeling.
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
              { label: "TLS 1.3 Encrypted", icon: Lock },
              { label: "GDPR Compliant", icon: Shield },
              { label: "AEC-Grade Security", icon: Building2 },
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
                  SECTION {section.id}
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
            This Privacy Policy is effective as of <strong style={{ color: "#9898B0" }}>March 1, 2026</strong>.
            If you have any questions, reach out to us at{" "}
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
              &copy; 2026 BuildFlow
            </span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            {[
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
              { label: "Contact", href: "/contact" },
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
            Beta Product &middot; Built for the AEC community
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
