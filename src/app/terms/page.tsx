"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import {
  Scale,
  FileCheck,
  AlertTriangle,
  Gavel,
  ShieldCheck,
  Layers,
  CreditCard,
  Ban,
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
    icon: FileCheck,
    color: "#4F8AFF",
    title: "Acceptance of Terms",
    content: [
      "By accessing or using BuildFlow, you agree to be bound by these Terms of Service and our Privacy Policy. If you are using BuildFlow on behalf of an organization, you represent that you have the authority to bind that organization to these terms.",
      "BuildFlow is a workflow automation platform designed for Architecture, Engineering, and Construction (AEC) professionals. These terms govern your use of all features including the visual workflow builder, BIM file processing, AI-powered analysis, 3D model generation, and report export capabilities.",
      "We reserve the right to modify these terms at any time. Material changes will be communicated via email and in-app notification at least 14 days before taking effect. Your continued use constitutes acceptance of modified terms.",
    ],
  },
  {
    id: "02",
    icon: Layers,
    color: "#8B5CF6",
    title: "Service Description & Use",
    content: [
      "BuildFlow provides a drag-and-drop workflow builder for BIM data processing. You may create workflows using our node catalogue (input, transform, generate, and export nodes), execute them against your data, and access the generated artifacts.",
      "You agree to use BuildFlow only for lawful purposes related to architecture, engineering, construction, and related professional activities. You shall not attempt to reverse-engineer, decompile, or extract source code from the platform.",
      "Generated outputs (reports, 3D models, floor plans, analysis results) are provided as professional aids and should not be used as sole basis for structural, safety, or regulatory compliance decisions without independent professional verification.",
    ],
  },
  {
    id: "03",
    icon: CreditCard,
    color: "#10B981",
    title: "Subscriptions & Billing",
    content: [
      "BuildFlow offers Free and Pro subscription tiers. Free accounts include limited workflow executions per day. Pro accounts unlock higher rate limits, premium AI models, and advanced export capabilities.",
      "Pro subscriptions are billed monthly or annually through Stripe. You may cancel at any time — access continues until the end of your billing period. Refunds are handled on a case-by-case basis for annual plans within the first 14 days.",
      "We reserve the right to adjust pricing with 30 days notice. Existing subscribers will be grandfathered at their current rate for the remainder of their billing cycle. Rate limits and usage quotas are enforced as described in your plan details.",
    ],
  },
  {
    id: "04",
    icon: ShieldCheck,
    color: "#F59E0B",
    title: "Intellectual Property",
    content: [
      "You retain all rights to the BIM data, IFC files, and other content you upload to BuildFlow. We claim no ownership over your input data or the artifacts generated from your workflows.",
      "The BuildFlow platform, including its workflow engine, node catalogue, AI pipelines, user interface, documentation, and branding, is the intellectual property of BuildFlow and protected by applicable copyright and trademark laws.",
      "Community-published workflows are shared under the license specified by their creator at the time of publication. By publishing a workflow to the community marketplace, you grant other users a non-exclusive license to use and modify it as specified.",
    ],
  },
  {
    id: "05",
    icon: Ban,
    color: "#EF4444",
    title: "Prohibited Activities",
    content: [
      "You may not use BuildFlow to process data you do not have rights to, distribute malware, perform unauthorized penetration testing against our systems, or engage in any activity that disrupts the platform for other users.",
      "Automated scraping, excessive API calls beyond your rate limits, creating multiple free accounts to circumvent usage restrictions, and sharing account credentials are strictly prohibited.",
      "Violations may result in immediate account suspension or termination. We reserve the right to report illegal activities to relevant authorities and cooperate with law enforcement investigations.",
    ],
  },
  {
    id: "06",
    icon: AlertTriangle,
    color: "#F59E0B",
    title: "Disclaimers & Limitations",
    content: [
      "BuildFlow is provided \"as is\" without warranties of any kind, express or implied. We do not guarantee uninterrupted service, error-free operation, or that the platform will meet all your specific requirements.",
      "AI-generated analysis, floor plan interpretations, and 3D model outputs are computational approximations. They should not replace professional judgment in structural engineering, regulatory compliance, or safety-critical decisions.",
      "To the maximum extent permitted by law, BuildFlow's total liability for any claims arising from your use of the service shall not exceed the amount you paid for the service in the 12 months preceding the claim.",
    ],
  },
  {
    id: "07",
    icon: Gavel,
    color: "#8B5CF6",
    title: "Governing Law & Disputes",
    content: [
      "These terms are governed by the laws of the Federal Republic of Germany. Any disputes shall be resolved in the courts of Berlin, Germany, unless mandatory consumer protection laws of your jurisdiction require otherwise.",
      "Before initiating legal proceedings, you agree to attempt good-faith resolution through direct communication. Contact us at legal@buildflow.app for dispute resolution.",
      "If any provision of these terms is found to be unenforceable, the remaining provisions shall continue in full force and effect. Our failure to enforce any right does not constitute a waiver of that right.",
    ],
  },
];

export default function TermsPage() {
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
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div className="blueprint-grid" />
          <div
            className="orb-drift-1"
            style={{
              position: "absolute",
              top: "-10%",
              right: "10%",
              width: 600,
              height: 600,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)",
              filter: "blur(40px)",
            }}
          />
          <div
            className="orb-drift-2"
            style={{
              position: "absolute",
              bottom: "0%",
              left: "5%",
              width: 500,
              height: 500,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)",
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
              LEGAL FRAMEWORK & GOVERNANCE
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
                  "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(79,138,255,0.1))",
                border: "1px solid rgba(139,92,246,0.15)",
                marginBottom: 28,
              }}
            >
              <Scale size={32} strokeWidth={1.5} color="#8B5CF6" />
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
                    "linear-gradient(135deg, #8B5CF6, #4F8AFF, #6366F1)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Terms of Service
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
              The foundation for how we work together. Clear, fair terms
              designed for AEC professionals who build the world around us.
            </p>
          </motion.div>

          {/* Key terms badges */}
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
              { label: "Your Data, Your Rights", icon: ShieldCheck },
              { label: "Fair Billing", icon: CreditCard },
              { label: "AEC-Focused", icon: Building2 },
            ].map((badge) => (
              <div
                key={badge.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: 10,
                  background: "rgba(139,92,246,0.06)",
                  border: "1px solid rgba(139,92,246,0.1)",
                }}
              >
                <badge.icon size={14} color="#8B5CF6" />
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
                  ARTICLE {section.id}
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
            These Terms of Service are effective as of{" "}
            <strong style={{ color: "#9898B0" }}>March 1, 2026</strong>. For
            questions, contact{" "}
            <a
              href="mailto:legal@buildflow.app"
              style={{ color: "#8B5CF6", textDecoration: "none" }}
            >
              legal@buildflow.app
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
                alt=""
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
