"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight, Zap, Sparkles, Users, LayoutGrid,
  PlayCircle, FileText, Box, Download, Play,
} from "lucide-react";
import { MiniWorkflowDiagram } from "@/components/shared/MiniWorkflowDiagram";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

const CATEGORY_COLORS: Record<string, string> = {
  input: "#3B82F6", transform: "#8B5CF6", generate: "#10B981", export: "#F59E0B",
};

// Framer Motion helpers
const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};
const stagger = { visible: { transition: { staggerChildren: 0.1 } } };
const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

// ─── Sticky Nav ───────────────────────────────────────────────────────────────

function StickyNav() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(window.scrollY > 180);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <motion.nav
      initial={{ y: -64 }}
      animate={{ y: visible ? 0 : -64 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9000,
        height: 56, display: "flex", alignItems: "center",
        padding: "0 40px",
        background: "rgba(7,7,13,0.88)",
        backdropFilter: "blur(16px) saturate(1.2)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <Link href="/" style={{
        display: "flex", alignItems: "center", gap: 8,
        textDecoration: "none", marginRight: "auto",
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Zap size={12} color="white" fill="white" />
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F5" }}>
          Neo<span style={{ color: "#4F8AFF" }}>BIM</span>
        </span>
      </Link>

      {["Features", "Workflows", "Community"].map(l => (
        <a key={l} href={`#${l.toLowerCase()}`} style={{
          fontSize: 13, color: "#9898B0", textDecoration: "none",
          margin: "0 16px", transition: "color 0.15s",
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#F0F0F5"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
        >
          {l}
        </a>
      ))}

      <div style={{ display: "flex", gap: 8, marginLeft: 24 }}>
        <Link href="/login" style={{
          padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
          color: "#9898B0", border: "1px solid rgba(255,255,255,0.10)", background: "transparent",
          textDecoration: "none",
        }}>
          Sign In
        </Link>
        <Link href="/dashboard" style={{
          padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
          color: "white", background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
          textDecoration: "none",
          boxShadow: "0 2px 8px rgba(79,138,255,0.3)",
        }}>
          Get Started Free
        </Link>
      </div>
    </motion.nav>
  );
}

// ─── Hero Animation ───────────────────────────────────────────────────────────

const HERO_NODES = [
  { label: "PDF Upload",  category: "input",     icon: <FileText size={12} /> },
  { label: "Doc Parser",  category: "transform", icon: <Sparkles size={12} /> },
  { label: "Massing Gen", category: "generate",  icon: <Box size={12} /> },
  { label: "Image Gen",   category: "generate",  icon: <Play size={12} /> },
  { label: "IFC Export",  category: "export",    icon: <Download size={12} /> },
];

function HeroEdge({ delay = 0 }: { delay?: number }) {
  return (
    <div style={{
      width: 28, height: 2, flexShrink: 0,
      background: "rgba(79,138,255,0.2)",
      position: "relative", overflow: "visible",
    }}>
      <motion.div
        animate={{ x: ["-100%", "300%"] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "linear", delay, repeatDelay: 0.6 }}
        style={{
          position: "absolute", top: "50%",
          transform: "translateY(-50%)",
          width: 7, height: 7, borderRadius: "50%",
          background: "#4F8AFF",
          boxShadow: "0 0 10px rgba(79,138,255,0.9)",
        }}
      />
    </div>
  );
}

function HeroNodeCard({ label, category, icon, delay }: { label: string; category: string; icon: React.ReactNode; delay: number }) {
  const color = CATEGORY_COLORS[category] ?? "#4F8AFF";
  const rgb   = hexToRgb(color);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: "easeOut" }}
      style={{
        width: 106, borderRadius: 10, overflow: "hidden",
        background: "rgba(18,18,30,0.9)",
        backdropFilter: "blur(8px)",
        border: `1px solid rgba(${rgb}, 0.2)`,
        boxShadow: `0 4px 16px rgba(0,0,0,0.3), 0 0 16px rgba(${rgb}, 0.06)`,
        borderLeft: `3px solid ${color}`,
        flexShrink: 0,
      }}
    >
      <div style={{ padding: "7px 9px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
          <span style={{ color, display: "flex" }}>{icon}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#F0F0F5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
          </span>
        </div>
        <div style={{
          height: 3, borderRadius: 2,
          background: "rgba(255,255,255,0.04)", overflow: "hidden",
        }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ delay: delay + 0.5, duration: 0.6, ease: "easeOut" }}
            style={{ height: "100%", borderRadius: 2, background: color }}
          />
        </div>
      </div>
    </motion.div>
  );
}

function HeroAnimation() {
  return (
    <motion.div
      animate={{ y: [0, -5, 0] }}
      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
      style={{
        borderRadius: 16, overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 80px rgba(79,138,255,0.06)",
        background: "rgba(11,11,19,0.8)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Toolbar mockup */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "8px 14px",
        display: "flex", alignItems: "center", gap: 7,
        background: "#07070D",
      }}>
        {["#EF4444", "#F59E0B", "#10B981"].map(c => (
          <div key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c, opacity: 0.6 }} />
        ))}
        <span style={{ marginLeft: 8, fontSize: 10, color: "#3A3A50", fontWeight: 500 }}>NeoBIM Canvas</span>
        <div style={{
          marginLeft: "auto", padding: "3px 10px", borderRadius: 6,
          background: "rgba(79,138,255,0.1)", border: "1px solid rgba(79,138,255,0.2)",
          fontSize: 9, color: "#4F8AFF", fontWeight: 600,
        }}>
          ▶ Run
        </div>
      </div>

      {/* Canvas area */}
      <div style={{
        padding: "28px 20px 20px",
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
        backgroundColor: "#0B0B13",
        minHeight: 180,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {HERO_NODES.map((n, i) => (
            <React.Fragment key={i}>
              <HeroNodeCard {...n} delay={i * 0.18} />
              {i < HERO_NODES.length - 1 && <HeroEdge delay={i * 0.4} />}
            </React.Fragment>
          ))}
        </div>

        {/* Artifact card peek */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.8, duration: 0.4 }}
          style={{ marginTop: 14, marginLeft: 128, width: 200 }}
        >
          <div style={{
            background: "rgba(7,7,13,0.9)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderLeft: "3px solid #34D399",
            borderRadius: 8, padding: "5px 10px",
            display: "flex", alignItems: "center", gap: 8,
            backdropFilter: "blur(8px)",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#34D399" }} />
            <span style={{ fontSize: 10, color: "#34D399", fontWeight: 600 }}>Massing Model</span>
            <span style={{ fontSize: 9, color: "#5C5C78", marginLeft: "auto" }}>✓ Done</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ─── Social proof avatars ─────────────────────────────────────────────────────

const AVATARS = [
  { name: "SC", color: "#3B82F6" },
  { name: "MR", color: "#8B5CF6" },
  { name: "PP", color: "#10B981" },
  { name: "JO", color: "#F59E0B" },
  { name: "AT", color: "#EF4444" },
];

function AvatarRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex" }}>
        {AVATARS.map((a, i) => (
          <div key={i} style={{
            width: 28, height: 28, borderRadius: "50%",
            background: `rgba(${hexToRgb(a.color)}, 0.2)`,
            border: `2px solid #07070D`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 700, color: a.color,
            marginLeft: i > 0 ? -8 : 0,
          }}>
            {a.name}
          </div>
        ))}
      </div>
      <span style={{ fontSize: 12, color: "#9898B0" }}>
        Join <strong style={{ color: "#F0F0F5" }}>2,400+</strong> AEC professionals
      </span>
    </div>
  );
}

// ─── Features Section ─────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <LayoutGrid size={22} />,
    color: "#3B82F6",
    title: "Visual Workflow Builder",
    description: "Drag and drop 31 purpose-built AEC nodes onto an infinite canvas. Connect them to create powerful pipelines — no code required.",
    bullets: ["Drag-and-drop canvas", "31 AEC-specific nodes", "Real-time execution"],
  },
  {
    icon: <Sparkles size={22} />,
    color: "#8B5CF6",
    title: "AI-Powered Generation",
    description: "Describe your workflow in plain English. Our AI understands AEC processes and builds the complete pipeline for you.",
    bullets: ["Natural language input", "Instant workflow generation", "Iterative refinement"],
  },
  {
    icon: <Users size={22} />,
    color: "#10B981",
    title: "Community Marketplace",
    description: "Share your workflows with the global AEC community. Clone, customize, and build on proven pipelines from peers.",
    bullets: ["Share and discover", "One-click cloning", "Ratings and reviews"],
  },
];

const COMPANIES = ["Foster+Partners", "Arup", "SOM", "BIG", "Zaha Hadid Architects", "HOK"];

// ─── Showcase workflows ───────────────────────────────────────────────────────

const SHOWCASE = [
  { id: "wf-01", badge: null },
  { id: "wf-10", badge: "MOST POPULAR" },
  { id: "wf-09", badge: null },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#07070D", color: "#F0F0F5", overflowX: "hidden" }}>
      <StickyNav />

      {/* ── Static top nav ───────────────────────────────────────── */}
      <header>
      <nav style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center",
        padding: "0 48px", height: 60,
        background: "rgba(7,7,13,0.6)",
        backdropFilter: "blur(12px)",
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", marginRight: "auto" }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 12px rgba(79,138,255,0.3)",
          }}>
            <Zap size={15} color="white" fill="white" />
          </div>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.3px" }}>
            Neo<span style={{ color: "#4F8AFF" }}>BIM</span>
          </span>
        </Link>

        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/login" style={{
            padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            color: "#9898B0", border: "1px solid rgba(255,255,255,0.10)", background: "transparent",
            textDecoration: "none",
          }}>
            Sign In
          </Link>
          <Link href="/dashboard" style={{
            padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            color: "white", background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            textDecoration: "none",
            boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 2px 10px rgba(79,138,255,0.3)",
          }}>
            Get Started Free
          </Link>
        </div>
      </nav>
      </header>

      <main>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section style={{
        minHeight: "calc(100vh - 60px)",
        display: "flex", alignItems: "center",
        maxWidth: 1200, margin: "0 auto",
        padding: "60px 48px",
        gap: 48, position: "relative",
      }}>
        {/* Atmospheric gradient mesh background */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(79, 138, 255, 0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 50%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)",
          }} />
        </div>

        {/* Left text */}
        <motion.div
          initial={{ opacity: 0, x: -32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: smoothEase }}
          style={{ flex: "0 0 52%", minWidth: 0 }}
        >
          <p style={{
            fontSize: 11, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "3px", marginBottom: 20,
            background: "linear-gradient(90deg, #4F8AFF, #8B5CF6)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>
            No-code workflow builder for AEC
          </p>

          <h1 style={{
            fontSize: 56, fontWeight: 800, lineHeight: 1.05,
            color: "#F0F0F5", marginBottom: 20,
            letterSpacing: "-0.03em",
            textShadow: "0 0 80px rgba(79, 138, 255, 0.15)",
          }}>
            Design buildings with<br />
            <span style={{
              background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              AI-powered workflows
            </span>
          </h1>

          <p style={{
            fontSize: 18, color: "#9898B0", lineHeight: 1.7,
            maxWidth: 540, marginBottom: 32,
          }}>
            Drag, connect, and run visual pipelines that turn briefs into 3D models,
            renders, and BIM exports. Built for architects and engineers.
          </p>

          <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
            <Link href="/dashboard" style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "14px 32px", borderRadius: 10,
              background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              color: "white", fontSize: 16, fontWeight: 600,
              textDecoration: "none",
              boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 4px 20px rgba(79,138,255,0.25)",
              transition: "all 150ms ease",
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(79,138,255,0.5), 0 8px 30px rgba(79,138,255,0.35)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.filter = "brightness(1)";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(79,138,255,0.3), 0 4px 20px rgba(79,138,255,0.25)";
              }}
            >
              Start Building — Free
              <ArrowRight size={16} />
            </Link>
            <Link href="/dashboard/templates" style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "14px 24px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)", background: "transparent",
              color: "#F0F0F5", fontSize: 14, fontWeight: 600,
              textDecoration: "none",
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.20)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
              }}
            >
              <PlayCircle size={15} style={{ color: "#4F8AFF" }} />
              See How It Works
            </Link>
          </div>

          <AvatarRow />
        </motion.div>

        {/* Right: Hero animation */}
        <motion.div
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: smoothEase, delay: 0.15 }}
          style={{ flex: 1, minWidth: 0 }}
        >
          <HeroAnimation />
        </motion.div>
      </section>

      {/* ── Logo strip ────────────────────────────────────────────── */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "20px 48px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 0,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 32,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 16,
          }}>
            <div style={{ height: 1, width: 40, background: "rgba(255,255,255,0.06)" }} />
            <span style={{ fontSize: 11, color: "#5C5C78", whiteSpace: "nowrap", fontWeight: 500 }}>
              Trusted by teams at
            </span>
            <div style={{ height: 1, width: 40, background: "rgba(255,255,255,0.06)" }} />
          </div>
          <div style={{
            display: "flex", gap: 36, flexWrap: "wrap", justifyContent: "center",
            maskImage: "linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)",
          }}>
            {COMPANIES.map(c => (
              <span key={c} style={{
                fontSize: 13, fontWeight: 600, color: "#5C5C78",
                letterSpacing: "0.5px",
                transition: "color 0.15s",
                cursor: "default",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Features ──────────────────────────────────────────────── */}
      <section id="features" style={{ padding: "88px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
          style={{ textAlign: "center", marginBottom: 52 }}
        >
          <h2 style={{ fontSize: 32, fontWeight: 700, color: "#F0F0F5", marginBottom: 12, letterSpacing: "-0.01em" }}>
            Everything you need to automate AEC workflows
          </h2>
          <p style={{ fontSize: 16, color: "#9898B0", maxWidth: 520, margin: "0 auto", lineHeight: 1.6 }}>
            Purpose-built for architects, engineers, and construction professionals.
          </p>
        </motion.div>

        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
          variants={stagger}
          style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}
        >
          {FEATURES.map(f => {
            const rgb = hexToRgb(f.color);
            return (
              <motion.div key={f.title} variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                background: "#12121E", borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.06)", padding: 32,
                transition: "border-color 0.15s, transform 0.2s, box-shadow 0.2s",
                cursor: "default",
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 20px 40px rgba(0, 0, 0, 0.3)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 56, height: 56, borderRadius: 14, marginBottom: 20,
                  background: `rgba(${rgb}, 0.08)`,
                  border: `1px solid rgba(${rgb}, 0.12)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: f.color,
                }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#F0F0F5", marginBottom: 10 }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.6, marginBottom: 16 }}>
                  {f.description}
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {f.bullets.map(b => (
                    <li key={b} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      fontSize: 13, color: "#9898B0", marginBottom: 8,
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: f.color, flexShrink: 0,
                      }} />
                      {b}
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      {/* ── Workflow showcase ──────────────────────────────────────── */}
      <section id="workflows" style={{
        padding: "88px 48px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "radial-gradient(ellipse at 50% 0%, rgba(79,138,255,0.06) 0%, transparent 60%)",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
            style={{ textAlign: "center", marginBottom: 52 }}
          >
            <h2 style={{ fontSize: 32, fontWeight: 700, color: "#F0F0F5", marginBottom: 12, letterSpacing: "-0.01em" }}>
              From brief to building in minutes
            </h2>
            <p style={{ fontSize: 16, color: "#9898B0" }}>
              See how NeoBIM workflows transform AEC processes
            </p>
          </motion.div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
            variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
            style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}
          >
            {SHOWCASE.map(({ id, badge }) => {
              const wf = PREBUILT_WORKFLOWS.find(w => w.id === id);
              if (!wf) return null;
              const nodes = wf.tileGraph.nodes.map(n => ({
                label: n.data.label, category: n.data.category as string,
              }));
              return (
                <motion.div key={id} variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                  background: "#12121E", borderRadius: 16,
                  border: badge ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(255,255,255,0.06)",
                  overflow: "hidden",
                  transition: "border-color 0.15s, transform 0.2s, box-shadow 0.2s",
                }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "0 16px 40px rgba(0,0,0,0.3)";
                    if (!badge) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                    if (!badge) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
                  }}
                >
                  {/* Diagram */}
                  <div style={{
                    height: 120,
                    background: "#0B0B13",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    position: "relative",
                  }}>
                    {badge && (
                      <div style={{
                        position: "absolute", top: 8, right: 8,
                        fontSize: 9, padding: "2px 8px", borderRadius: 20,
                        background: "linear-gradient(135deg, #F59E0B, #EF4444)",
                        color: "white", fontWeight: 700, letterSpacing: "0.5px",
                      }}>
                        {badge}
                      </div>
                    )}
                    <MiniWorkflowDiagram nodes={nodes} size="md" animated />
                  </div>
                  {/* Content */}
                  <div style={{ padding: "16px 20px" }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "#F0F0F5", marginBottom: 6 }}>
                      {wf.name}
                    </h3>
                    <p style={{ fontSize: 12, color: "#5C5C78", lineHeight: 1.5, marginBottom: 12 }}>
                      {wf.tileGraph.nodes.length} nodes · {wf.estimatedRunTime}
                    </p>
                    <Link href="/dashboard/templates" style={{
                      fontSize: 12, fontWeight: 600, color: "#4F8AFF",
                      textDecoration: "none",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                      onMouseEnter={e => {
                        const arrow = e.currentTarget.querySelector("span");
                        if (arrow) arrow.style.transform = "translateX(4px)";
                      }}
                      onMouseLeave={e => {
                        const arrow = e.currentTarget.querySelector("span");
                        if (arrow) arrow.style.transform = "translateX(0)";
                      }}
                    >
                      Try this workflow <span style={{ transition: "transform 0.15s ease", display: "inline-block" }}>→</span>
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────── */}
      <section id="community" style={{ padding: "88px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
          style={{ textAlign: "center", marginBottom: 52 }}
        >
          <h2 style={{ fontSize: 32, fontWeight: 700, color: "#F0F0F5", marginBottom: 12, letterSpacing: "-0.01em" }}>
            Three ways to build
          </h2>
        </motion.div>

        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
          variants={stagger}
          style={{
            display: "grid", gridTemplateColumns: "1fr 40px 1fr 40px 1fr", gap: 0,
            alignItems: "center",
          }}
        >
          {[
            { num: "1", title: "Drag & Drop", desc: "Browse 31 nodes and drag them onto the canvas", icon: <LayoutGrid size={22} />, color: "#3B82F6" },
            { num: "2", title: "Connect",    desc: "Link nodes together to define your data flow",   icon: <Zap size={22} />,          color: "#8B5CF6" },
            { num: "3", title: "Run",        desc: "Execute and see results appear in real time",    icon: <Play size={22} />,         color: "#10B981" },
          ].map((step, i) => {
            const rgb = hexToRgb(step.color);
            return (
              <React.Fragment key={step.num}>
                <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                  background: "#12121E", borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.06)", padding: "28px 24px",
                  textAlign: "center", position: "relative", overflow: "hidden",
                  transition: "border-color 0.15s, transform 0.2s, box-shadow 0.2s",
                }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
                    (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
                    (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                  }}
                >
                  {/* Big number bg */}
                  <div style={{
                    position: "absolute", top: 8, right: 12,
                    fontSize: 64, fontWeight: 900, color: step.color,
                    opacity: 0.07, lineHeight: 1, userSelect: "none",
                  }}>
                    {step.num}
                  </div>
                  <div style={{
                    width: 52, height: 52, borderRadius: 14, margin: "0 auto 16px",
                    background: `rgba(${rgb}, 0.08)`,
                    border: `1px solid rgba(${rgb}, 0.12)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: step.color,
                  }}>
                    {step.icon}
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: "#F0F0F5", marginBottom: 8 }}>
                    {step.title}
                  </h3>
                  <p style={{ fontSize: 13, color: "#9898B0", lineHeight: 1.6 }}>
                    {step.desc}
                  </p>
                </motion.div>

                {i < 2 && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#3A3A50",
                  }}>
                    <svg width="20" height="12" viewBox="0 0 20 12" fill="none">
                      <line x1="0" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
                      <path d="M14 2 L19 6 L14 10" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="3 3" />
                    </svg>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </motion.div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <section style={{
        padding: "88px 48px",
        background: "radial-gradient(ellipse 60% 50% at 50% 100%, rgba(79, 138, 255, 0.08), transparent), #0B0B13",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        textAlign: "center",
      }}>
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
          style={{ maxWidth: 600, margin: "0 auto" }}
        >
          <h2 style={{ fontSize: 36, fontWeight: 700, color: "#F0F0F5", marginBottom: 14, letterSpacing: "-0.01em" }}>
            Ready to transform your<br />AEC workflow?
          </h2>
          <p style={{ fontSize: 16, color: "#9898B0", marginBottom: 32, lineHeight: 1.6 }}>
            Free to start. No credit card required.
          </p>
          <Link href="/dashboard" style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            padding: "14px 36px", borderRadius: 12,
            background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "white", fontSize: 16, fontWeight: 600,
            textDecoration: "none",
            boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 4px 24px rgba(79,138,255,0.25)",
            marginBottom: 16,
            transition: "all 150ms ease",
          }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(79,138,255,0.5), 0 8px 30px rgba(79,138,255,0.35)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.filter = "brightness(1)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(79,138,255,0.3), 0 4px 24px rgba(79,138,255,0.25)";
            }}
          >
            Create Your First Workflow
            <ArrowRight size={17} />
          </Link>
          <div>
            <Link href="/dashboard/community" style={{
              fontSize: 13, color: "#4F8AFF", textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}
              onMouseEnter={e => {
                const arrow = e.currentTarget.querySelector("span");
                if (arrow) arrow.style.transform = "translateX(4px)";
              }}
              onMouseLeave={e => {
                const arrow = e.currentTarget.querySelector("span");
                if (arrow) arrow.style.transform = "translateX(0)";
              }}
            >
              Or explore community workflows <span style={{ transition: "transform 0.15s ease", display: "inline-block" }}>→</span>
            </Link>
          </div>
        </motion.div>
      </section>

      </main>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "20px 48px",
        display: "flex", alignItems: "center",
        maxWidth: "100%",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{
            width: 20, height: 20, borderRadius: 5,
            background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Zap size={10} color="white" fill="white" />
          </div>
          <span style={{ fontSize: 12, color: "#5C5C78", fontWeight: 600 }}>
            © 2026 NeoBIM
          </span>
        </div>
        <div style={{ margin: "0 auto", display: "flex", gap: 20 }}>
          {["Privacy", "Terms", "Contact"].map(l => (
            <a key={l} href="#" style={{ fontSize: 11, color: "#5C5C78", textDecoration: "none" }}>
              {l}
            </a>
          ))}
        </div>
        <span style={{ fontSize: 11, color: "#3A3A50" }}>
          Built for the AEC community
        </span>
      </footer>
    </div>
  );
}
