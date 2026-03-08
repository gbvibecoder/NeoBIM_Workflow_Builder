"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Zap, Users, Workflow, TrendingUp, Box, Play, FileCode, Sparkles } from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";

const smoothEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "#07070D",
        overflow: "hidden",
      }}
    >
      {/* Left Sidebar — Workflow Pipeline Visual */}
      <div
        style={{
          flex: "0 0 48%",
          background: "linear-gradient(180deg, #0B0B15 0%, #09091A 50%, #07070D 100%)",
          borderRight: "1px solid rgba(79,138,255,0.06)",
          padding: "48px 48px 40px",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
        }}
        className="auth-sidebar"
      >
        {/* Background: Blueprint grid + animated pipeline */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div className="blueprint-grid" style={{ opacity: 0.2 }} />

          {/* Animated workflow pipeline SVG */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 700 900" fill="none" preserveAspectRatio="xMidYMid slice">
            {/* Main vertical pipeline */}
            <path d="M350 0 L350 900" stroke="rgba(79,138,255,0.04)" strokeWidth="60" strokeLinecap="round" />
            <path d="M350 0 L350 900" stroke="rgba(79,138,255,0.08)" strokeWidth="1.5" fill="none" className="wire-animate" />

            {/* Branch lines to left */}
            <path d="M350 200 Q250 200 150 250" stroke="rgba(59,130,246,0.1)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "0.5s" }} />
            <path d="M350 400 Q250 400 120 430" stroke="rgba(139,92,246,0.1)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "1s" }} />
            <path d="M350 580 Q250 580 160 620" stroke="rgba(16,185,129,0.1)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "1.5s" }} />

            {/* Branch lines to right */}
            <path d="M350 300 Q450 300 550 270" stroke="rgba(245,158,11,0.08)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "0.8s" }} />
            <path d="M350 500 Q450 500 560 480" stroke="rgba(79,138,255,0.08)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "1.3s" }} />

            {/* Junction nodes on main pipeline */}
            {[200, 400, 580].map((y, i) => (
              <g key={y}>
                <circle cx="350" cy={y} r="4" fill={["#3B82F6", "#8B5CF6", "#10B981"][i]} opacity="0.6">
                  <animate attributeName="r" values="3;6;3" dur="2s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
                </circle>
              </g>
            ))}

            {/* Data flow particles */}
            <circle r="3" fill="#4F8AFF">
              <animateMotion dur="6s" repeatCount="indefinite" path="M350 0 L350 900" />
              <animate attributeName="opacity" values="0;0.8;0.8;0" dur="6s" repeatCount="indefinite" />
            </circle>
            <circle r="2.5" fill="#8B5CF6">
              <animateMotion dur="6s" repeatCount="indefinite" begin="2s" path="M350 0 L350 900" />
              <animate attributeName="opacity" values="0;0.6;0.6;0" dur="6s" begin="2s" repeatCount="indefinite" />
            </circle>
            <circle r="3" fill="#10B981">
              <animateMotion dur="6s" repeatCount="indefinite" begin="4s" path="M350 0 L350 900" />
              <animate attributeName="opacity" values="0;0.7;0.7;0" dur="6s" begin="4s" repeatCount="indefinite" />
            </circle>

            {/* Dimension annotations */}
            <line x1="50" y1="180" x2="50" y2="620" stroke="rgba(79,138,255,0.1)" strokeWidth="0.5" />
            <line x1="45" y1="180" x2="55" y2="180" stroke="rgba(79,138,255,0.1)" strokeWidth="0.5" />
            <line x1="45" y1="620" x2="55" y2="620" stroke="rgba(79,138,255,0.1)" strokeWidth="0.5" />
            <text x="42" y="405" className="dimension-label" textAnchor="middle" transform="rotate(-90, 42, 405)">WORKFLOW PIPELINE</text>
          </svg>

          {/* Atmospheric orbs */}
          <div className="orb-drift-1" style={{ position: "absolute", top: "10%", left: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)", filter: "blur(80px)" }} />
          <div className="orb-drift-2" style={{ position: "absolute", bottom: "10%", right: "5%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)", filter: "blur(60px)" }} />
        </div>

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: smoothEase }}
          style={{ position: "relative", zIndex: 1 }}
        >
          <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", marginBottom: 48 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, overflow: "hidden",
              boxShadow: "0 4px 16px rgba(79,138,255,0.2)",
              flexShrink: 0,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/buildflow_logo.png" alt="BuildFlow" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span style={{ fontSize: 19, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.4px" }}>
              Build<span style={{ color: "#4F8AFF" }}>Flow</span>
            </span>
          </Link>
        </motion.div>

        {/* Main content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: smoothEase }}
          style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", zIndex: 1 }}
        >
          <span className="blueprint-annotation" style={{ marginBottom: 12, display: "block" }}>
            AEC WORKFLOW AUTOMATION
          </span>
          <h1 style={{
            fontSize: 36, fontWeight: 900, color: "#F0F0F5",
            lineHeight: 1.1, marginBottom: 18, letterSpacing: "-0.04em",
          }}>
            From brief to building
            <br />
            <span style={{
              background: "linear-gradient(135deg, #4F8AFF, #8B5CF6, #C084FC)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              in minutes
            </span>
          </h1>
          <p style={{
            fontSize: 15, color: "#7C7C96", lineHeight: 1.7,
            marginBottom: 36, maxWidth: 400, letterSpacing: "-0.005em",
          }}>
            Join thousands of AEC professionals automating workflows with AI-powered visual pipelines.
          </p>

          {/* Stats as mini node cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 32 }}>
            {[
              { icon: <Zap size={16} />, value: "31", label: "AEC Node Types", color: "#4F8AFF", type: "INPUT" },
              { icon: <Workflow size={16} />, value: String(PREBUILT_WORKFLOWS.length), label: "Ready-Made Templates", color: "#10B981", type: "WORKFLOW" },
              { icon: <TrendingUp size={16} />, value: "Free", label: "To Start", color: "#F59E0B", type: "CONFIG" },
              { icon: <Users size={16} />, value: "2-3 min", label: "Avg Generation", color: "#8B5CF6", type: "GENERATE" },
            ].map((stat, i) => {
              const rgb = hexToRgb(stat.color);
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 + i * 0.08, ease: smoothEase }}
                  className="node-card"
                  style={{ '--node-port-color': stat.color } as React.CSSProperties}
                >
                  {/* Mini node header */}
                  <div style={{
                    padding: "5px 12px", borderRadius: "16px 16px 0 0",
                    background: `linear-gradient(135deg, rgba(${rgb}, 0.1), rgba(${rgb}, 0.03))`,
                    borderBottom: `1px solid rgba(${rgb}, 0.08)`,
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: 8, fontWeight: 700, textTransform: "uppercase" as const,
                    letterSpacing: "1.5px", color: stat.color,
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: stat.color, boxShadow: `0 0 6px ${stat.color}` }} />
                    {stat.type}
                  </div>
                  <div style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ color: stat.color, display: "flex", alignItems: "center", opacity: 0.85 }}>
                        {stat.icon}
                      </div>
                      <span style={{ fontSize: 20, fontWeight: 700, color: "#F0F0F5", letterSpacing: "-0.02em" }}>
                        {stat.value}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#5C5C78", letterSpacing: "-0.005em" }}>{stat.label}</div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Workflow preview as a connected pipeline */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5, ease: smoothEase }}
            className="node-card"
            style={{ '--node-port-color': '#4F8AFF' } as React.CSSProperties}
          >
            <div style={{
              padding: "6px 14px", borderRadius: "16px 16px 0 0",
              background: "linear-gradient(135deg, rgba(79,138,255,0.1), rgba(79,138,255,0.03))",
              borderBottom: "1px solid rgba(79,138,255,0.08)",
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 8, fontWeight: 700, textTransform: "uppercase" as const,
              letterSpacing: "1.5px", color: "#4F8AFF",
            }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 6px #10B981" }} />
              SAMPLE PIPELINE
            </div>
            <div style={{ padding: "16px 18px" }}>
              {/* Mini inline workflow: Brief → Massing → Render → Export */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                {[
                  { icon: <Sparkles size={12} />, label: "Brief", color: "#3B82F6" },
                  { icon: <Box size={12} />, label: "3D Mass", color: "#8B5CF6" },
                  { icon: <Play size={12} />, label: "Render", color: "#10B981" },
                  { icon: <FileCode size={12} />, label: "Export", color: "#F59E0B" },
                ].map((node, i, arr) => (
                  <div key={node.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "4px 10px", borderRadius: 8,
                      background: `rgba(${hexToRgb(node.color)}, 0.08)`,
                      border: `1px solid rgba(${hexToRgb(node.color)}, 0.15)`,
                    }}>
                      <div style={{ color: node.color, display: "flex" }}>{node.icon}</div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#D0D0E0" }}>{node.label}</span>
                    </div>
                    {i < arr.length - 1 && (
                      <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                        <path d="M0 5 L20 5" stroke="rgba(79,138,255,0.2)" strokeWidth="1.5" className="wire-animate" />
                        <circle r="2" fill="#4F8AFF" opacity="0.6">
                          <animateMotion dur="1.5s" repeatCount="indefinite" begin={`${i * 0.3}s`} path="M0 5 L20 5" />
                        </circle>
                      </svg>
                    )}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 13, color: "#9898B0", lineHeight: 1.6, marginBottom: 10 }}>
                From PDF brief to 3D massing, concept renders, and BOQ exports — all in one visual pipeline.
              </p>
              <div style={{ fontSize: 10, color: "#5C5C78", fontFamily: "monospace", letterSpacing: "0.5px" }}>
                Built for architects, engineers, and BIM managers
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          style={{
            fontSize: 11, color: "#4A4A64", marginTop: 32,
            letterSpacing: "-0.005em", position: "relative", zIndex: 1,
            fontFamily: "monospace",
          }}
        >
          No credit card required &middot; Free tier forever
        </motion.div>
      </div>

      {/* Right Form Area */}
      <div
        className="auth-form-area"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px",
          position: "relative",
          background: "#07070D",
          minHeight: "100vh",
        }}
      >
        {/* Background effects for form side */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          {/* Subtle isometric grid */}
          <div className="isometric-grid" style={{ opacity: 0.15 }} />

          {/* Converging wires pointing to center */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 600 900" fill="none" preserveAspectRatio="xMidYMid slice">
            <path d="M600 100 Q400 200 300 450" stroke="rgba(79,138,255,0.04)" strokeWidth="1" className="wire-animate" />
            <path d="M600 800 Q400 700 300 450" stroke="rgba(139,92,246,0.04)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "1s" }} />
            <path d="M0 200 Q150 300 300 450" stroke="rgba(16,185,129,0.03)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "0.5s" }} />
            <circle cx="300" cy="450" r="3" fill="rgba(79,138,255,0.15)">
              <animate attributeName="r" values="2;5;2" dur="3s" repeatCount="indefinite" />
            </circle>
          </svg>

          {/* Glow behind form */}
          <div style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "70%", height: "50%",
            background: "radial-gradient(ellipse, rgba(79,138,255,0.04) 0%, transparent 70%)",
          }} />
        </div>
        <div style={{ width: "100%", maxWidth: 420, position: "relative", zIndex: 1 }}>{children}</div>
      </div>
    </div>
  );
}
