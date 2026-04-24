"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { motion, useScroll, useTransform, useInView, useMotionValue, useSpring, animate } from "framer-motion";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Clock, Building2, Layers, FileSpreadsheet,
  Cpu, FileText, Box, Palette, PenTool, Mail, Image as ImageIcon,
  Zap, ChevronDown, BarChart3, AlertTriangle, CheckCircle2,
  Timer, Quote, Hash, Calendar,
} from "lucide-react";

// ─── Constants ──────────────────────────────────────────────────────────────

const smoothEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const COLORS = {
  bg: "#07070D",
  card: "#0C0E14",
  elevated: "#12141C",
  blue: "#4F8AFF",
  purple: "#8B5CF6",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#EF4444",
  cyan: "#06B6D4",
  textPrimary: "#F0F0F5",
  textSecondary: "#9898B0",
  textTertiary: "#5C5C78",
  border: "rgba(255,255,255,0.06)",
};

// ─── Table of Contents sections ─────────────────────────────────────────────

const TOC_SECTIONS = [
  { id: "dirty-secret", label: "The Dirty Secret" },
  { id: "eleven-tools", label: "11 Tools" },
  { id: "where-hours-go", label: "Where Hours Go" },
  { id: "the-fix", label: "The Fix" },
  { id: "in-practice", label: "In Practice" },
  { id: "beyond-time", label: "Beyond Time" },
  { id: "bigger-picture", label: "Bigger Picture" },
  { id: "my-firm", label: "What I'd Tell My Firm" },
];

// ─── Isometric Building (self-constructing in hero) ─────────────────────────

function IsometricBuilding() {
  return (
    <div style={{
      position: "absolute", right: "8%", bottom: "12%",
      width: 220, height: 320, pointerEvents: "none",
      opacity: 0.35,
    }}
    className="blog-iso-building"
    >
      <svg viewBox="0 0 220 320" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Foundation */}
        <motion.path
          d="M110 290 L200 240 L200 250 L110 300 L20 250 L20 240 Z"
          fill={`${COLORS.blue}15`}
          stroke={`${COLORS.blue}40`}
          strokeWidth={0.5}
          initial={{ opacity: 0, pathLength: 0 }}
          animate={{ opacity: 1, pathLength: 1 }}
          transition={{ delay: 0.8, duration: 0.6 }}
        />
        {/* Floors building up */}
        {Array.from({ length: 8 }).map((_, i) => {
          const y = 250 - i * 28;
          const floorDelay = 1.0 + i * 0.15;
          return (
            <React.Fragment key={i}>
              {/* Left face */}
              <motion.path
                d={`M20 ${y} L110 ${y - 50} L110 ${y - 22} L20 ${y + 28} Z`}
                fill={`${i % 2 === 0 ? COLORS.blue : COLORS.purple}08`}
                stroke={`${i % 2 === 0 ? COLORS.blue : COLORS.purple}30`}
                strokeWidth={0.5}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: floorDelay, duration: 0.4, ease: smoothEase }}
              />
              {/* Right face */}
              <motion.path
                d={`M200 ${y} L110 ${y - 50} L110 ${y - 22} L200 ${y + 28} Z`}
                fill={`${i % 2 === 0 ? COLORS.purple : COLORS.blue}06`}
                stroke={`${i % 2 === 0 ? COLORS.purple : COLORS.blue}25`}
                strokeWidth={0.5}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: floorDelay + 0.05, duration: 0.4, ease: smoothEase }}
              />
              {/* Windows on left */}
              {[0.3, 0.5, 0.7].map((wx, wi) => (
                <motion.rect
                  key={`wl-${i}-${wi}`}
                  x={20 + (110 - 20) * wx - 4}
                  y={y - 50 * wx + 8}
                  width={6} height={10}
                  fill={`${COLORS.amber}${Math.random() > 0.5 ? "30" : "12"}`}
                  rx={1}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: floorDelay + 0.3 + wi * 0.05, duration: 0.3 }}
                />
              ))}
            </React.Fragment>
          );
        })}
        {/* Roof */}
        <motion.path
          d="M110 26 L200 76 L110 46 L20 76 Z"
          fill={`${COLORS.green}10`}
          stroke={`${COLORS.green}35`}
          strokeWidth={0.5}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.5, duration: 0.5, ease: smoothEase }}
        />
        {/* Crane line */}
        <motion.line
          x1={160} y1={10} x2={160} y2={80}
          stroke={`${COLORS.amber}25`}
          strokeWidth={1}
          strokeDasharray="3 3"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 2.0, duration: 1.0 }}
        />
        <motion.line
          x1={130} y1={10} x2={190} y2={10}
          stroke={`${COLORS.amber}25`}
          strokeWidth={1}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 2.0, duration: 0.8 }}
        />
      </svg>
    </div>
  );
}

// ─── Blueprint Section Divider ──────────────────────────────────────────────

function BlueprintDivider({ color = COLORS.blue }: { color?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} style={{ margin: "64px 0 56px", position: "relative", height: 32 }}>
      <svg width="100%" height="32" style={{ overflow: "visible" }}>
        {/* Main dimension line */}
        <motion.line
          x1="0" y1="16" x2="100%" y2="16"
          stroke={`${color}20`}
          strokeWidth={0.5}
          initial={{ pathLength: 0 }}
          animate={inView ? { pathLength: 1 } : {}}
          transition={{ duration: 1.2, ease: smoothEase }}
        />
        {/* Left tick */}
        <motion.line
          x1="0" y1="8" x2="0" y2="24"
          stroke={`${color}35`}
          strokeWidth={0.5}
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.3, duration: 0.3 }}
        />
        {/* Right tick */}
        <motion.line
          x1="100%" y1="8" x2="100%" y2="24"
          stroke={`${color}35`}
          strokeWidth={0.5}
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.8, duration: 0.3 }}
        />
        {/* Center diamond */}
        <motion.path
          d="M 50% 10 L 53% 16 L 50% 22 L 47% 16 Z"
          fill={`${color}15`}
          stroke={`${color}35`}
          strokeWidth={0.5}
          initial={{ opacity: 0, scale: 0 }}
          animate={inView ? { opacity: 1, scale: 1 } : {}}
          transition={{ delay: 0.6, duration: 0.4 }}
          style={{ transformOrigin: "50% 16px" }}
        />
        {/* Dimension marks */}
        {[0.25, 0.5, 0.75].map((pos, i) => (
          <motion.line
            key={i}
            x1={`${pos * 100}%`} y1="12"
            x2={`${pos * 100}%`} y2="20"
            stroke={`${color}25`}
            strokeWidth={0.5}
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ delay: 0.4 + i * 0.1, duration: 0.3 }}
          />
        ))}
      </svg>
    </div>
  );
}

// ─── Floating AEC Symbols (parallax depth) ──────────────────────────────────

const AEC_SYMBOLS = [
  // Beams, columns, walls — architectural notation marks
  { svg: "M0 8 L16 8 M0 4 L0 12 M16 4 L16 12", label: "DIM", x: "5%", y: "20%", size: 18, color: COLORS.blue, speed: 0.3 },
  { svg: "M2 2 L14 2 L14 14 L2 14 Z M5 14 L5 2 M11 14 L11 2", label: "GRID", x: "92%", y: "35%", size: 16, color: COLORS.purple, speed: 0.5 },
  { svg: "M8 0 L8 16 M0 8 L16 8 M3 3 L13 13 M13 3 L3 13", label: "+", x: "88%", y: "60%", size: 14, color: COLORS.green, speed: 0.2 },
  { svg: "M2 14 L8 2 L14 14 Z", label: "A", x: "7%", y: "55%", size: 16, color: COLORS.amber, speed: 0.4 },
  { svg: "M0 12 L4 4 L8 12 L12 4 L16 12", label: "W", x: "95%", y: "80%", size: 14, color: COLORS.cyan, speed: 0.35 },
  { svg: "M4 0 L4 16 L12 16 L12 0", label: "COL", x: "3%", y: "80%", size: 15, color: COLORS.blue, speed: 0.45 },
];

function FloatingAECSymbols() {
  const { scrollYProgress } = useScroll();

  return (
    <div className="pointer-events-none fixed inset-0 z-[1] hidden lg:block" aria-hidden>
      {AEC_SYMBOLS.map((sym, i) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const y = useTransform(scrollYProgress, [0, 1], [0, sym.speed * -300]);
        return (
          <motion.div
            key={i}
            style={{
              position: "absolute",
              left: sym.x,
              top: sym.y,
              y,
              opacity: 0.12,
            }}
          >
            <svg width={sym.size} height={sym.size} viewBox="0 0 16 16">
              <path d={sym.svg} fill="none" stroke={sym.color} strokeWidth={1} strokeLinecap="round" />
            </svg>
            <div style={{
              fontSize: 7, color: sym.color, textAlign: "center",
              marginTop: 2, fontFamily: "var(--font-jetbrains, monospace)",
              letterSpacing: "0.08em", opacity: 0.7,
            }}>
              {sym.label}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Sticky Table of Contents ───────────────────────────────────────────────

function TableOfContents() {
  const [activeSection, setActiveSection] = useState<string>("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    for (const section of TOC_SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const handleClick = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <motion.nav
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 1.5, duration: 0.6 }}
      className="blog-toc"
      style={{
        position: "fixed",
        left: 24,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {TOC_SECTIONS.map((section) => {
        const isActive = activeSection === section.id;
        return (
          <button
            key={section.id}
            onClick={() => handleClick(section.id)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: 8,
              background: isActive ? `${COLORS.blue}12` : "transparent",
              border: "none", cursor: "pointer",
              transition: "all 0.2s",
              textAlign: "left",
            }}
          >
            <div style={{
              width: 3, height: isActive ? 18 : 8, borderRadius: 2,
              background: isActive ? COLORS.blue : `${COLORS.textTertiary}40`,
              transition: "all 0.3s ease",
            }} />
            <span style={{
              fontSize: 10, fontWeight: isActive ? 600 : 400,
              color: isActive ? COLORS.blue : COLORS.textTertiary,
              letterSpacing: "0.02em",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
              maxWidth: isActive ? 120 : 0,
              overflow: "hidden",
              opacity: isActive ? 1 : 0,
            }}>
              {section.label}
            </span>
          </button>
        );
      })}
    </motion.nav>
  );
}

// ─── Architectural Grid Number (section label) ──────────────────────────────

function SectionLabel({ number, text }: { number: string; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -20 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.5, ease: smoothEase }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        marginBottom: 16,
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        border: `1px solid ${COLORS.blue}25`,
        background: `${COLORS.blue}08`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, color: COLORS.blue,
        fontFamily: "var(--font-jetbrains, monospace)",
      }}>
        {number}
      </div>
      <span style={{
        fontSize: 10, color: COLORS.textTertiary,
        letterSpacing: "0.12em", textTransform: "uppercase",
        fontFamily: "var(--font-jetbrains, monospace)",
      }}>
        {text}
      </span>
    </motion.div>
  );
}

// ─── The 11 tools from the article ─────────────────────────────────────────

const CHAOS_TOOLS = [
  { name: "Word", icon: FileText, color: "#2B579A" },
  { name: "PDF Reader", icon: FileText, color: "#FF3E3E" },
  { name: "SketchUp", icon: Box, color: "#005F9E" },
  { name: "Rhino", icon: Layers, color: "#801956" },
  { name: "Render Engine", icon: Palette, color: "#FF6B2B" },
  { name: "Excel (Areas)", icon: FileSpreadsheet, color: "#217346" },
  { name: "Excel (Costs)", icon: FileSpreadsheet, color: "#217346" },
  { name: "AutoCAD", icon: PenTool, color: "#C41E3A" },
  { name: "Revit", icon: Building2, color: "#1D4E89" },
  { name: "PDF Annotator", icon: FileText, color: "#FF9500" },
  { name: "Email Client", icon: Mail, color: "#0078D4" },
];

const BUILDFLOW_NODES = [
  { name: "Text Brief", color: COLORS.blue, category: "input" },
  { name: "AI Analysis", color: COLORS.purple, category: "transform" },
  { name: "3D Massing", color: COLORS.green, category: "generate" },
  { name: "Render", color: COLORS.green, category: "generate" },
  { name: "BOQ Export", color: COLORS.amber, category: "export" },
];

// ─── Animated counter ───────────────────────────────────────────────────────

function AnimatedStat({ value, suffix = "", prefix = "", duration = 2 }: {
  value: number; suffix?: string; prefix?: string; duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  const motionVal = useMotionValue(0);

  useEffect(() => {
    if (!inView) return;
    const ctrl = animate(motionVal, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        if (ref.current) {
          ref.current.textContent = `${prefix}${Math.round(v)}${suffix}`;
        }
      },
    });
    return () => ctrl.stop();
  }, [inView, value, suffix, prefix, duration, motionVal]);

  return <span ref={ref}>{prefix}0{suffix}</span>;
}

// ─── Reading progress bar ───────────────────────────────────────────────────

function ReadingProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <motion.div
      style={{
        scaleX,
        transformOrigin: "left",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: `linear-gradient(90deg, ${COLORS.blue}, ${COLORS.purple}, ${COLORS.green})`,
        zIndex: 100,
      }}
    />
  );
}

// ─── Scroll-reveal wrapper ──────────────────────────────────────────────────

function Reveal({ children, delay = 0, className = "" }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: smoothEase }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Pull quote component ───────────────────────────────────────────────────

function PullQuote({ children, color = COLORS.blue }: {
  children: React.ReactNode; color?: string;
}) {
  const ref = useRef<HTMLQuoteElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.blockquote
      ref={ref}
      initial={{ opacity: 0, x: -30, scale: 0.97 }}
      animate={inView ? { opacity: 1, x: 0, scale: 1 } : {}}
      transition={{ duration: 0.8, ease: smoothEase }}
      style={{
        borderLeft: `3px solid ${color}`,
        padding: "24px 32px",
        margin: "48px 0",
        background: `linear-gradient(135deg, ${color}08, transparent)`,
        borderRadius: "0 16px 16px 0",
        position: "relative",
      }}
    >
      <Quote
        size={28}
        style={{
          position: "absolute", top: 16, right: 20,
          color, opacity: 0.15,
        }}
      />
      <p style={{
        fontSize: 20, lineHeight: 1.7, fontWeight: 500,
        color: COLORS.textPrimary, fontStyle: "italic",
      }}>
        {children}
      </p>
    </motion.blockquote>
  );
}

// ─── Stat card ──────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, value, suffix, prefix, label, color, delay }: {
  icon: React.ElementType; value: number; suffix?: string;
  prefix?: string; label: string; color: string; delay: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{ duration: 0.6, delay, ease: smoothEase }}
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: "28px 24px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* glow */}
      <div style={{
        position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)",
        width: 120, height: 120, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}15, transparent 70%)`,
        pointerEvents: "none",
      }} />
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: `${color}12`, border: `1px solid ${color}20`,
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 16px",
      }}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {React.createElement(Icon as any, { size: 20, style: { color } })}
      </div>
      <div style={{
        fontSize: 36, fontWeight: 800, letterSpacing: "-1.5px",
        background: `linear-gradient(135deg, ${color}, ${COLORS.textPrimary})`,
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        backgroundClip: "text", marginBottom: 6,
      }}>
        <AnimatedStat value={value} suffix={suffix} prefix={prefix} />
      </div>
      <div style={{ fontSize: 13, color: COLORS.textTertiary, fontWeight: 500 }}>
        {label}
      </div>
    </motion.div>
  );
}

// ─── Tool chaos visualization ───────────────────────────────────────────────

function ToolChaos() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div ref={ref} style={{ margin: "48px 0", position: "relative" }}>
      {/* Title */}
      <Reveal>
        <div style={{
          textAlign: "center", marginBottom: 32,
          fontSize: 13, color: COLORS.textTertiary,
          fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          <AlertTriangle size={14} style={{ display: "inline", marginRight: 6, color: COLORS.amber }} />
          The 11-tool reality of a single residential project
        </div>
      </Reveal>

      {/* Chaotic grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 12,
        maxWidth: 700,
        margin: "0 auto",
      }}>
        {CHAOS_TOOLS.map((tool, i) => {
          const Icon = tool.icon;
          return (
            <motion.div
              key={tool.name}
              initial={{ opacity: 0, scale: 0.5, rotate: (Math.random() - 0.5) * 20 }}
              animate={inView ? {
                opacity: 1, scale: 1,
                rotate: [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * -3, 0],
              } : {}}
              transition={{
                duration: 0.5,
                delay: i * 0.06,
                rotate: { duration: 2, repeat: Infinity, repeatType: "reverse" },
              }}
              style={{
                background: COLORS.card,
                border: `1px solid ${tool.color}25`,
                borderRadius: 12,
                padding: "16px 12px",
                textAlign: "center",
                position: "relative",
              }}
            >
              <Icon size={22} style={{ color: tool.color, margin: "0 auto 8px" }} />
              <div style={{ fontSize: 11, color: COLORS.textSecondary, fontWeight: 500 }}>
                {tool.name}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Chaotic connection lines (SVG overlay) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 0.3 } : {}}
        transition={{ delay: 0.8, duration: 1 }}
        style={{
          position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden",
        }}
      >
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
          {/* Scattered dashed lines to represent messy data flow */}
          {[
            "M 15% 25% Q 50% 10% 85% 30%",
            "M 10% 50% Q 30% 80% 60% 45%",
            "M 40% 20% Q 70% 60% 90% 40%",
            "M 20% 70% Q 50% 90% 80% 65%",
            "M 5% 35% Q 45% 50% 75% 25%",
          ].map((d, i) => (
            <motion.path
              key={i}
              d={d}
              fill="none"
              stroke={COLORS.red}
              strokeWidth={1}
              strokeDasharray="6 8"
              initial={{ pathLength: 0 }}
              animate={inView ? { pathLength: 1 } : {}}
              transition={{ delay: 1 + i * 0.15, duration: 1.5, ease: "easeInOut" }}
            />
          ))}
        </svg>
      </motion.div>

      {/* Label */}
      <Reveal delay={0.8}>
        <div style={{
          textAlign: "center", marginTop: 20,
          fontSize: 12, color: COLORS.red, fontWeight: 500,
          opacity: 0.7,
        }}>
          Data flows via the most ancient integration protocol: a human being manually retyping things
        </div>
      </Reveal>
    </div>
  );
}

// ─── Pipeline comparison (Before → After) ───────────────────────────────────

function PipelineComparison() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div ref={ref} style={{ margin: "56px 0" }}>
      <Reveal>
        <div style={{
          textAlign: "center", marginBottom: 32,
          fontSize: 13, color: COLORS.textTertiary,
          fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          <Zap size={14} style={{ display: "inline", marginRight: 6, color: COLORS.green }} />
          The BuildFlow approach
        </div>
      </Reveal>

      <div style={{
        display: "flex", flexDirection: "column", gap: 20,
        maxWidth: 600, margin: "0 auto",
      }}>
        {BUILDFLOW_NODES.map((node, i) => (
          <React.Fragment key={node.name}>
            <motion.div
              initial={{ opacity: 0, x: i % 2 === 0 ? -40 : 40 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: i * 0.12, duration: 0.6, ease: smoothEase }}
              style={{
                display: "flex", alignItems: "center", gap: 16,
                background: COLORS.card,
                border: `1px solid ${node.color}20`,
                borderRadius: 14,
                padding: "18px 24px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* left accent */}
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                background: node.color,
              }} />
              {/* node icon */}
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: `${node.color}15`,
                border: `1px solid ${node.color}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <Cpu size={18} style={{ color: node.color }} />
              </div>
              <div>
                <div style={{
                  fontSize: 14, fontWeight: 700, color: COLORS.textPrimary,
                  marginBottom: 2,
                }}>
                  {node.name}
                </div>
                <div style={{
                  fontSize: 11, color: node.color, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  {node.category}
                </div>
              </div>
              {/* flowing data indicator */}
              <motion.div
                initial={{ width: 0 }}
                animate={inView ? { width: "100%" } : {}}
                transition={{ delay: 0.5 + i * 0.15, duration: 1.2, ease: smoothEase }}
                style={{
                  position: "absolute", bottom: 0, left: 0, height: 2,
                  background: `linear-gradient(90deg, ${node.color}, transparent)`,
                }}
              />
            </motion.div>
            {/* connector arrow */}
            {i < BUILDFLOW_NODES.length - 1 && (
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={inView ? { opacity: 0.4, scale: 1 } : {}}
                transition={{ delay: 0.3 + i * 0.12, duration: 0.4 }}
                style={{ textAlign: "center", color: COLORS.textTertiary }}
              >
                <ChevronDown size={20} />
              </motion.div>
            )}
          </React.Fragment>
        ))}
      </div>

      <Reveal delay={0.6}>
        <div style={{
          textAlign: "center", marginTop: 24,
          fontSize: 12, color: COLORS.green, fontWeight: 500,
        }}>
          Data flows programmatically. No copy-paste. No transcription errors.
        </div>
      </Reveal>
    </div>
  );
}

// ─── Workflow template card ─────────────────────────────────────────────────

function WorkflowCard({ title, description, nodes, time, color, delay }: {
  title: string; description: string; nodes: number;
  time: string; color: string; delay: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ delay, duration: 0.6, ease: smoothEase }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: 24,
        position: "relative",
        overflow: "hidden",
        cursor: "default",
      }}
    >
      {/* top accent */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
      }} />
      <div style={{
        fontSize: 15, fontWeight: 700, color: COLORS.textPrimary,
        marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{
        fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {description}
      </div>
      <div style={{
        display: "flex", gap: 16, fontSize: 11, color: COLORS.textTertiary,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Layers size={12} style={{ color }} /> {nodes} nodes
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Timer size={12} style={{ color }} /> {time}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Time comparison bar ────────────────────────────────────────────────────

function TimeCompare({ label, traditional, buildflow, color }: {
  label: string; traditional: string; buildflow: string; color: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: smoothEase }}
      style={{ marginBottom: 28 }}
    >
      <div style={{
        fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
        marginBottom: 10,
      }}>
        {label}
      </div>
      {/* Traditional */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{
          fontSize: 10, color: COLORS.textTertiary, width: 70,
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          Traditional
        </div>
        <div style={{ flex: 1, height: 6, background: `${COLORS.red}15`, borderRadius: 3, overflow: "hidden" }}>
          <motion.div
            initial={{ width: 0 }}
            animate={inView ? { width: "100%" } : {}}
            transition={{ duration: 1.2, ease: smoothEase }}
            style={{ height: "100%", background: COLORS.red, borderRadius: 3, opacity: 0.7 }}
          />
        </div>
        <div style={{ fontSize: 12, color: COLORS.red, fontWeight: 600, width: 60 }}>
          {traditional}
        </div>
      </div>
      {/* BuildFlow */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          fontSize: 10, color: COLORS.textTertiary, width: 70,
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          BuildFlow
        </div>
        <div style={{ flex: 1, height: 6, background: `${color}15`, borderRadius: 3, overflow: "hidden" }}>
          <motion.div
            initial={{ width: 0 }}
            animate={inView ? { width: "12%" } : {}}
            transition={{ duration: 0.8, delay: 0.3, ease: smoothEase }}
            style={{ height: "100%", background: color, borderRadius: 3 }}
          />
        </div>
        <div style={{ fontSize: 12, color, fontWeight: 600, width: 60 }}>
          {buildflow}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Floating particles background ──────────────────────────────────────────

function BlogParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    interface P { x: number; y: number; vx: number; vy: number; size: number; opacity: number; color: string; }
    const colors = [COLORS.blue, COLORS.purple, COLORS.green, COLORS.amber];
    const particles: P[] = Array.from({ length: 40 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      size: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.3 + 0.05,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color + Math.round(p.opacity * 255).toString(16).padStart(2, "0");
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" aria-hidden />;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN BLOG PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function BlogArticle() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.12], [1, 0.96]);

  // Estimated reading time
  const readTime = "12 min read";

  return (
    <>
      <title>The $13 Trillion Industry Still Running on Copy-Paste | BuildFlow Blog</title>
      <meta name="description" content="Why AEC's real bottleneck isn't design talent — it's the invisible chaos between tools." />

      <div style={{ background: COLORS.bg, color: COLORS.textPrimary, minHeight: "100vh" }}>
        <ReadingProgress />
        <BlogParticles />
        <FloatingAECSymbols />
        <TableOfContents />

        {/* Blueprint grid */}
        <div
          className="pointer-events-none fixed inset-0 z-0"
          aria-hidden
          style={{
            backgroundImage: `linear-gradient(rgba(79,138,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(79,138,255,0.02) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        {/* ════════════ HERO SECTION ════════════ */}
        <motion.section
          ref={heroRef}
          style={{ opacity: heroOpacity, scale: heroScale }}
          className="relative z-10"
        >
          <div style={{
            minHeight: "85vh",
            display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "center",
            padding: "80px 24px 60px",
            position: "relative",
            textAlign: "center",
          }}>
            {/* Radial glow */}
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(79,138,255,0.06) 0%, transparent 70%)",
            }} />

            {/* Back link */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              style={{ position: "absolute", top: 32, left: 32 }}
            >
              <Link
                href="/"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 13, color: COLORS.textTertiary,
                  textDecoration: "none", transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.textPrimary)}
                onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.textTertiary)}
              >
                <ArrowLeft size={16} /> Back to Home
              </Link>
            </motion.div>

            {/* Blog badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "6px 16px", borderRadius: 20,
                background: `${COLORS.blue}10`,
                border: `1px solid ${COLORS.blue}25`,
                marginBottom: 32,
              }}
            >
              <FileText size={12} style={{ color: COLORS.blue }} />
              <span style={{ fontSize: 11, color: COLORS.blue, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                Industry Analysis
              </span>
              <span style={{ width: 1, height: 12, background: `${COLORS.blue}30` }} />
              <span style={{ fontSize: 11, color: COLORS.textTertiary }}>
                {readTime}
              </span>
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.8, ease: smoothEase }}
              style={{
                fontSize: "clamp(32px, 6vw, 64px)",
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-2.5px",
                maxWidth: 900,
                marginBottom: 8,
              }}
            >
              <span>The </span>
              <span style={{
                background: `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.purple})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}>
                $13 Trillion
              </span>
              <span> Industry</span>
              <br />
              <span>Still Running on </span>
              <span style={{
                background: `linear-gradient(135deg, ${COLORS.amber}, ${COLORS.red})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}>
                Copy-Paste
              </span>
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              style={{
                fontSize: "clamp(16px, 2.2vw, 22px)",
                color: COLORS.textSecondary,
                maxWidth: 650,
                lineHeight: 1.6,
                marginBottom: 40,
                marginTop: 20,
              }}
            >
              Why AEC&apos;s real bottleneck isn&apos;t design talent — it&apos;s the invisible chaos between tools.
            </motion.p>

            {/* Author info */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65, duration: 0.5 }}
              style={{
                display: "flex", alignItems: "center", gap: 16,
                padding: "12px 20px", borderRadius: 14,
                background: `rgba(255,255,255,0.03)`,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.purple})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 700,
              }}>
                BF
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>
                  BuildFlow Team
                </div>
                <div style={{ fontSize: 11, color: COLORS.textTertiary }}>
                  March 2026
                </div>
              </div>
            </motion.div>

            {/* Isometric building animation */}
            <IsometricBuilding />

            {/* Scroll indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.5 }}
              style={{
                position: "absolute", bottom: 40,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 11, color: COLORS.textTertiary, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Scroll to read
              </span>
              <motion.div
                animate={{ y: [0, 6, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <ChevronDown size={16} style={{ color: COLORS.textTertiary }} />
              </motion.div>
            </motion.div>
          </div>
        </motion.section>

        {/* ════════════ ARTICLE BODY ════════════ */}
        <article className="relative z-10" style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "40px 24px 120px",
          fontSize: 17,
          lineHeight: 1.85,
          color: COLORS.textSecondary,
        }}>
          {/* ── OPENING ── */}
          <Reveal>
            <p style={{ fontSize: 19, color: COLORS.textPrimary, lineHeight: 1.8 }}>
              I&apos;ve watched a senior architect spend <strong style={{ color: COLORS.amber }}>45 minutes</strong> reformatting
              a BOQ spreadsheet that should have been auto-generated from the model she&apos;d already built.
              Forty-five minutes. Not designing. Not thinking about load paths or daylighting or the client&apos;s brief.
              Just copying cells from one tool into another, double-checking unit conversions, and praying nothing
              got lost in translation.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <p>
              She&apos;s not bad at her job. She&apos;s one of the sharpest designers I know. And that&apos;s exactly the problem.
            </p>
          </Reveal>

          {/* ── SECTION: DIRTY SECRET ── */}
          <BlueprintDivider color={COLORS.blue} />
          <div id="dirty-secret" style={{ scrollMarginTop: 80 }} />
          <Reveal>
            <SectionLabel number="01" text="Industry Reality" />
            <h2 style={{
              fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
              letterSpacing: "-1px", marginBottom: 24,
              lineHeight: 1.2,
            }}>
              The Dirty Secret Nobody Talks About at AEC Conferences
            </h2>
          </Reveal>

          <Reveal>
            <p>
              The architecture, engineering, and construction industry is worth roughly <strong style={{ color: COLORS.blue }}>$13 trillion
              globally</strong>. It employs hundreds of millions of people. It shapes every city skyline, every hospital corridor, every bridge
              you drive across.
            </p>
          </Reveal>

          <Reveal>
            <p>
              And yet — and I say this as someone who&apos;s spent years in this space — the average schematic design workflow
              is held together with duct tape.
            </p>
          </Reveal>

          <PullQuote color={COLORS.red}>
            Not literal duct tape. Worse. It&apos;s held together with exported CSVs, manually re-keyed data,
            screenshot-annotated PDFs, and a rotating cast of disconnected software tools that each speak
            a slightly different language.
          </PullQuote>

          <Reveal>
            <p>
              Here&apos;s what a typical early-stage design process actually looks like at most firms:
            </p>
          </Reveal>

          <Reveal>
            <p>
              You get a brief. Maybe it&apos;s a PDF. Maybe it&apos;s a rambling email with an attached site plan from 2019.
              You open one tool to sketch out the massing. Another tool for the floor plans. A third tool for renders —
              because the client won&apos;t approve anything without a pretty picture. Then you hop into a spreadsheet
              for area calculations. Another spreadsheet for cost estimation. Maybe you export an IFC and it&apos;s missing
              half the metadata because the export settings were wrong and nobody caught it until the QS called three
              days later asking where the slab data went.
            </p>
          </Reveal>

          <PullQuote color={COLORS.amber}>
            Each tool works fine in isolation. But the gaps between them? That&apos;s where data dies. That&apos;s where
            hours disappear. That&apos;s where a $200/hour architect becomes a $200/hour data entry clerk.
          </PullQuote>

          {/* ── STATS SECTION ── */}
          <div style={{ margin: "64px 0" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 16,
            }}>
              <StatCard icon={BarChart3} value={13} suffix="T" prefix="$" label="Global AEC Industry" color={COLORS.blue} delay={0} />
              <StatCard icon={Clock} value={45} suffix=" min" label="Wasted on one BOQ" color={COLORS.amber} delay={0.1} />
              <StatCard icon={Layers} value={11} label="Tools for one project" color={COLORS.purple} delay={0.2} />
              <StatCard icon={AlertTriangle} value={80} suffix="%" label="Projects over budget" color={COLORS.red} delay={0.3} />
            </div>
          </div>

          {/* ── SECTION: 11 TOOLS ── */}
          <BlueprintDivider color={COLORS.purple} />
          <div id="eleven-tools" style={{ scrollMarginTop: 80 }} />
          <Reveal>
            <SectionLabel number="02" text="Tool Fragmentation" />
            <h2 style={{
              fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
              letterSpacing: "-1px", marginBottom: 24,
              lineHeight: 1.2,
            }}>
              I Counted the Tools Once. I Stopped at Eleven.
            </h2>
          </Reveal>

          <Reveal>
            <p>
              For a single residential project — nothing fancy, a mid-rise apartment scheme — I mapped out every piece
              of software the team touched between receiving the brief and submitting the Stage 2 package:
            </p>
          </Reveal>

          {/* Interactive tool chaos visualization */}
          <ToolChaos />

          <Reveal>
            <p>
              Eleven tools. And the data flowed between them via the most ancient integration protocol known to
              mankind: a human being manually retyping things.
            </p>
          </Reveal>

          <Reveal>
            <p>
              Nobody designed this workflow. It just… accumulated. Every firm has its own version of it, and
              every architect silently accepts it as the cost of doing business.
            </p>
          </Reveal>

          <PullQuote color={COLORS.purple}>
            But it isn&apos;t the cost of doing business. It&apos;s the cost of not having the right infrastructure.
          </PullQuote>

          {/* ── SECTION: WHERE HOURS GO ── */}
          <BlueprintDivider color={COLORS.red} />
          <div id="where-hours-go" style={{ scrollMarginTop: 80 }} />
          <Reveal>
            <SectionLabel number="03" text="Time Analysis" />
            <h2 style={{
              fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
              letterSpacing: "-1px", marginBottom: 24,
              lineHeight: 1.2,
            }}>
              Where the Hours Actually Go
            </h2>
          </Reveal>

          <Reveal>
            <p>
              McKinsey published research showing that large construction projects typically run <strong style={{ color: COLORS.red }}>80%
              over budget</strong> and <strong style={{ color: COLORS.red }}>20 months behind schedule</strong>. The Economist has
              covered the productivity gap in construction multiple times — it&apos;s one of the least digitised major
              industries on the planet.
            </p>
          </Reveal>

          <Reveal>
            <p>
              But let&apos;s forget the macro numbers for a second and talk about what happens inside a 15-person architecture
              studio on a Tuesday afternoon.
            </p>
          </Reveal>

          {/* Time comparison bars */}
          <div style={{
            margin: "48px 0",
            padding: 28,
            background: COLORS.card,
            borderRadius: 16,
            border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: COLORS.textPrimary,
              marginBottom: 24, textTransform: "uppercase", letterSpacing: "0.06em",
            }}>
              Time comparison: Traditional vs BuildFlow
            </div>
            <TimeCompare
              label="Cost Estimation Loop"
              traditional="2 days"
              buildflow="2 min"
              color={COLORS.green}
            />
            <TimeCompare
              label="Concept Visualization (3 options)"
              traditional="18+ hrs"
              buildflow="~5 min"
              color={COLORS.blue}
            />
            <TimeCompare
              label="IFC Export & Validation"
              traditional="4-6 hrs"
              buildflow="90 sec"
              color={COLORS.purple}
            />
            <TimeCompare
              label="Video Walkthrough Production"
              traditional="2-3 days"
              buildflow="~5 min"
              color={COLORS.amber}
            />
          </div>

          <Reveal>
            <p>
              <strong style={{ color: COLORS.textPrimary }}>The cost estimation loop.</strong> An architect finishes
              a massing study. The QS needs quantities. So the architect exports. The QS imports — or more likely, rebuilds
              the quantities manually because the export was missing context. They plug numbers into a rate sheet. Two days
              later, the estimate comes back. The architect changes the massing. The QS starts over.
            </p>
          </Reveal>

          <Reveal>
            <p>
              <strong style={{ color: COLORS.textPrimary }}>The render bottleneck.</strong> A client meeting is Thursday.
              The design partner wants three concept options visualised. Each one needs to be modelled, textured, lit, and
              rendered. That&apos;s a minimum of 6–8 hours per option if you&apos;re using a traditional rendering pipeline.
              So the team works late on Wednesday. Again.
            </p>
          </Reveal>

          <Reveal>
            <p>
              <strong style={{ color: COLORS.textPrimary }}>The IFC black hole.</strong> The structural engineer needs
              an IFC. The architect exports one from Revit. The engineer opens it in Tekla. Half the walls are classified
              wrong. The property sets are empty. Someone has to go back and fix the mappings. This happens on almost
              every project, and it&apos;s been happening for fifteen years.
            </p>
          </Reveal>

          <PullQuote color={COLORS.blue}>
            These aren&apos;t edge cases. This is the standard workflow in most firms I&apos;ve worked with. The talent
            is extraordinary. The tools are individually powerful. But the connective tissue between them is
            practically non-existent.
          </PullQuote>

          {/* ── SECTION: THE FIX ── */}
          <BlueprintDivider color={COLORS.green} />
          <div id="the-fix" style={{ scrollMarginTop: 80 }} />
          <Reveal>
            <SectionLabel number="04" text="The Solution" />
            <h2 style={{
              fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
              letterSpacing: "-1px", marginBottom: 24,
              lineHeight: 1.2,
            }}>
              So What Would It Look Like If You Actually Fixed This?
            </h2>
          </Reveal>

          <Reveal>
            <p>
              I&apos;ve been thinking about this question for a long time. And recently I came across something that
              made me stop and pay attention.
            </p>
          </Reveal>

          <Reveal>
            <p>
              It&apos;s called <strong style={{ color: COLORS.blue }}>BuildFlow</strong>, and the simplest way to describe
              it is: a workflow engine built specifically for AEC.
            </p>
          </Reveal>

          <Reveal>
            <p>
              Not a new CAD tool. Not another rendering app. Not a project management platform pretending to understand
              architecture. It&apos;s a pipeline builder — you connect nodes together to create automated design workflows,
              and the AI handles the translation between stages.
            </p>
          </Reveal>

          <Reveal>
            <p>
              Think of it like this: instead of opening seven different tools and manually transferring data between them,
              you build a pipeline once. Text brief goes in one end. 3D massing, renders, floor plans, IFC files, cost
              estimates come out the other end. The data flows through the pipeline without you having to touch it.
            </p>
          </Reveal>

          {/* Pipeline visualization */}
          <PipelineComparison />

          <Reveal>
            <p>
              I&apos;ll admit I was skeptical at first. I&apos;ve seen plenty of &quot;AI for architecture&quot; pitches
              that amount to a chatbot generating floor plans that violate basic building regulations.
              BuildFlow is different because it doesn&apos;t try to replace the architect&apos;s judgment — it eliminates
              the busywork between decisions.
            </p>
          </Reveal>

          {/* ── SECTION: IN PRACTICE ── */}
          <BlueprintDivider color={COLORS.amber} />
          <div id="in-practice" style={{ scrollMarginTop: 80 }} />
          <Reveal>
            <SectionLabel number="05" text="Workflow Templates" />
            <h2 style={{
              fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
              letterSpacing: "-1px", marginBottom: 24,
              lineHeight: 1.2,
            }}>
              What This Actually Looks Like in Practice
            </h2>
          </Reveal>

          <Reveal>
            <p style={{ marginBottom: 32 }}>
              Let me walk through a few of their workflow templates, because the specifics matter.
            </p>
          </Reveal>

          {/* Workflow cards grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            margin: "32px 0 48px",
          }}>
            <WorkflowCard
              title="Text Prompt → Concept Building"
              description="Type a building description in plain English. The pipeline analyses the brief, generates a 3D massing model, and produces concept visualisations."
              nodes={3} time="~90 sec"
              color={COLORS.blue} delay={0}
            />
            <WorkflowCard
              title="IFC → Quantity Takeoff → BOQ"
              description="Upload a photo of a building, the system extracts IFC quantities, maps costs, and generates a downloadable BOQ spreadsheet."
              nodes={4} time="< 2 min"
              color={COLORS.green} delay={0.1}
            />
            <WorkflowCard
              title="2D Floor Plan → Interactive 3D"
              description="Upload a flat floor plan image — even a scan or a sketch — and the pipeline detects walls, classifies rooms, and builds a navigable 3D model."
              nodes={4} time="~2 min"
              color={COLORS.purple} delay={0.2}
            />
            <WorkflowCard
              title="PDF Brief → 3D Video Walkthrough"
              description="Upload a project brief as PDF. The system parses it, generates massing, renders it photorealistically, and produces a cinematic video walkthrough."
              nodes={6} time="~5 min"
              color={COLORS.amber} delay={0.3}
            />
            <WorkflowCard
              title="Text Prompt → IFC Export"
              description="Describe a building in plain English, and get a proper IFC4 file with entity classification, spatial hierarchy, and property sets."
              nodes={3} time="~90 sec"
              color={COLORS.cyan} delay={0.4}
            />
          </div>

          {/* ── SECTION: BEYOND TIME ── */}
          <BlueprintDivider color={COLORS.cyan} />
          <div id="beyond-time" style={{ scrollMarginTop: 80 }} />
          <Reveal>
            <SectionLabel number="06" text="Design Quality" />
            <h2 style={{
              fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
              letterSpacing: "-1px", marginBottom: 24,
              lineHeight: 1.2,
            }}>
              Why This Matters Beyond Saving Time
            </h2>
          </Reveal>

          <Reveal>
            <p>
              I know what some people are thinking. &quot;Sounds like a shortcut. Where&apos;s the design quality?&quot;
            </p>
          </Reveal>

          <Reveal>
            <p>
              Fair question. Here&apos;s my take.
            </p>
          </Reveal>

          <Reveal>
            <p>
              BuildFlow isn&apos;t generating final construction documents. It&apos;s operating in the schematic design
              phase — RIBA Stages 0 through 2, if you&apos;re in the UK, or SD/DD if you&apos;re in the US. This is the phase
              where you&apos;re exploring options, testing feasibility, communicating ideas to clients, and iterating quickly.
            </p>
          </Reveal>

          <PullQuote color={COLORS.green}>
            The quality problem in schematic design was never about the design itself. Architects are brilliant at design.
            The quality problem is that they don&apos;t have enough time to explore alternatives because they&apos;re spending
            too much time on production tasks.
          </PullQuote>

          <Reveal>
            <p>
              When it takes a full day to produce one concept option, you only show the client two. When it takes 90 seconds,
              you show them ten. That&apos;s not lower quality — it&apos;s <strong style={{ color: COLORS.green }}>radically better
              design exploration</strong>.
            </p>
          </Reveal>

          <Reveal>
            <p>
              And the data integrity issue is real. Every time a human manually transfers a number from one tool to another,
              there&apos;s a chance of error. BuildFlow&apos;s pipeline approach means the data flows through nodes
              programmatically. The massing dimensions that inform the cost estimate are the same dimensions the system
              used to generate the 3D model. No copy-paste. No transcription errors. No &quot;wait, did we use gross or
              net area?&quot;
            </p>
          </Reveal>

          {/* ── SECTION: BIGGER PICTURE ── */}
          <BlueprintDivider color={COLORS.purple} />
          <div id="bigger-picture" style={{ scrollMarginTop: 80 }} />
          <Reveal>
            <SectionLabel number="07" text="Industry Transformation" />
            <h2 style={{
              fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
              letterSpacing: "-1px", marginBottom: 24,
              lineHeight: 1.2,
            }}>
              The Bigger Picture
            </h2>
          </Reveal>

          <Reveal>
            <p>
              The AEC industry has a productivity problem that&apos;s been documented for decades. Every other major industry
              has undergone significant digital transformation. Manufacturing has automated assembly lines. Finance has
              algorithmic trading. Healthcare has electronic records and diagnostic AI. Construction? We&apos;ve got BIM,
              which is powerful but only addresses part of the workflow. The gaps between tools remain.
            </p>
          </Reveal>

          <Reveal>
            <p>
              What BuildFlow is building — a node-based, AI-powered workflow engine for the entire AEC pipeline — feels like
              the <strong style={{ color: COLORS.purple }}>missing layer</strong>. Not replacing Revit or Rhino or ArchiCAD.
              Complementing them. Automating the boring connective tasks so that the people using those tools can focus on
              what they were actually trained to do.
            </p>
          </Reveal>

          <Reveal>
            <p>
              They currently have 13 workflow templates covering concept design, visualisation, BIM export, cost estimation,
              and 3D modelling. They&apos;ve got 30+ AI nodes, and the community can request and vote on new workflows.
              The pricing starts at free — three executions to try the platform — and goes up to ₹1,999/month for the
              pro tier with 100 executions and priority support.
            </p>
          </Reveal>

          <Reveal>
            <p>
              Is it perfect? No. It&apos;s in beta. Some nodes are still in preview. The community hub is still growing. But
              the approach is right. The architecture of the platform — pun intended — is sound.
            </p>
          </Reveal>

          {/* ── SECTION: WHAT I'D TELL MY FIRM ── */}
          <BlueprintDivider color={COLORS.blue} />
          <div id="my-firm" style={{ scrollMarginTop: 80 }} />
          <Reveal>
            <SectionLabel number="08" text="Action Plan" />
            <h2 style={{
              fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
              letterSpacing: "-1px", marginBottom: 24,
              lineHeight: 1.2,
            }}>
              What I&apos;d Tell My Firm
            </h2>
          </Reveal>

          <Reveal>
            <p>
              If I were running a practice right now, here&apos;s what I&apos;d do:
            </p>
          </Reveal>

          <Reveal>
            <p>
              I&apos;d take one upcoming project — something in early schematic design — and run it through BuildFlow&apos;s
              &quot;Text → Floor Plan + Render&quot; branching workflow alongside the traditional process. Same brief, same
              timeline. Then I&apos;d compare: how many concept options did each approach produce? How long did each take?
              How accurate were the area calculations?
            </p>
          </Reveal>

          <Reveal>
            <p>
              I suspect the results would be uncomfortable. Not because BuildFlow would produce better designs — that&apos;s
              still the architect&apos;s job — but because it would expose how much time the traditional approach wastes on
              tasks that have nothing to do with design.
            </p>
          </Reveal>

          <PullQuote color={COLORS.blue}>
            The AEC industry doesn&apos;t have a talent problem. It has a workflow problem. And for the first time
            in a while, I&apos;m looking at something that might actually solve it.
          </PullQuote>

          {/* ── CTA SECTION ── */}
          <Reveal>
            <div style={{
              margin: "80px 0 40px",
              padding: 48,
              borderRadius: 24,
              background: `linear-gradient(135deg, ${COLORS.blue}08, ${COLORS.purple}08)`,
              border: `1px solid ${COLORS.blue}15`,
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
            }}>
              {/* Glow */}
              <div style={{
                position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)",
                width: 300, height: 200, borderRadius: "50%",
                background: `radial-gradient(circle, ${COLORS.blue}10, transparent 70%)`,
                pointerEvents: "none",
              }} />

              <div style={{
                fontSize: 28, fontWeight: 800, color: COLORS.textPrimary,
                letterSpacing: "-1px", marginBottom: 12, position: "relative",
              }}>
                Ready to fix your workflow?
              </div>
              <p style={{
                fontSize: 15, color: COLORS.textSecondary, marginBottom: 32,
                maxWidth: 400, margin: "0 auto 32px",
              }}>
                Free to start. No credit card required. Build your first pipeline in under 2 minutes.
              </p>

              <div style={{
                display: "flex", gap: 14, justifyContent: "center",
                flexWrap: "wrap",
              }}>
                <Link
                  href="/register"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "14px 32px", borderRadius: 14,
                    background: `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.purple})`,
                    color: "#fff", fontSize: 14, fontWeight: 700,
                    textDecoration: "none",
                    boxShadow: `0 4px 28px ${COLORS.blue}40`,
                    transition: "transform 0.2s, box-shadow 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = `0 8px 40px ${COLORS.blue}50`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = `0 4px 28px ${COLORS.blue}40`;
                  }}
                >
                  Try BuildFlow Free <ArrowRight size={16} />
                </Link>
                <Link
                  href="/book-demo"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "14px 28px", borderRadius: 14,
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${COLORS.border}`,
                    color: COLORS.textSecondary, fontSize: 14, fontWeight: 600,
                    textDecoration: "none",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = `${COLORS.blue}40`;
                    e.currentTarget.style.color = COLORS.textPrimary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = COLORS.border;
                    e.currentTarget.style.color = COLORS.textSecondary;
                  }}
                >
                  <Calendar size={16} /> Book a Demo
                </Link>
              </div>
            </div>
          </Reveal>

          {/* ── FOOTER NOTE ── */}
          <Reveal>
            <div style={{
              textAlign: "center", padding: "40px 0",
              borderTop: `1px solid ${COLORS.border}`,
              marginTop: 40,
            }}>
              <div style={{ fontSize: 13, color: COLORS.textTertiary, marginBottom: 8 }}>
                Enjoyed this article? Share it with your team.
              </div>
              <Link
                href="/blog"
                style={{
                  fontSize: 13, color: COLORS.blue,
                  textDecoration: "none", fontWeight: 600,
                }}
              >
                ← More articles coming soon
              </Link>
            </div>
          </Reveal>
        </article>

        {/* Bottom fade */}
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-0 h-32"
          aria-hidden
          style={{
            background: `linear-gradient(to top, ${COLORS.bg} 0%, transparent 100%)`,
          }}
        />
      </div>

      {/* ── Responsive styles ── */}
      <style>{`
        /* TOC hidden below 1280px */
        @media (max-width: 1280px) {
          .blog-toc { display: none !important; }
        }
        /* Isometric building hidden on small screens */
        @media (max-width: 768px) {
          .blog-iso-building { display: none !important; }
        }
        @media (max-width: 640px) {
          article { padding-left: 16px !important; padding-right: 16px !important; }
          article p { font-size: 15px !important; }
          article h2 { font-size: 22px !important; }
          blockquote { padding: 16px 20px !important; margin: 32px 0 !important; }
          blockquote p { font-size: 16px !important; }
        }
      `}</style>
    </>
  );
}
