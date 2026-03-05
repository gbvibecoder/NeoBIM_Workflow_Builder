"use client";

import type { Metadata } from "next";
import Link from "next/link";
import { motion } from "framer-motion";
import { Zap, Users, Workflow, TrendingUp } from "lucide-react";

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
      {/* ── Left Sidebar (Social Proof) ─────────────────────────── */}
      <div
        style={{
          flex: "0 0 45%",
          background: "radial-gradient(ellipse 80% 60% at 30% 40%, rgba(79, 138, 255, 0.12), transparent), #0B0B13",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          padding: "60px",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
        }}
        className="auth-sidebar"
      >
        {/* Atmospheric glow */}
        <div
          style={{
            position: "absolute",
            top: "20%",
            left: "10%",
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(79, 138, 255, 0.15), transparent 70%)",
            filter: "blur(60px)",
            pointerEvents: "none",
          }}
        />

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
              marginBottom: 60,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 20px rgba(79,138,255,0.3)",
              }}
            >
              <Zap size={18} color="white" fill="white" />
            </div>
            <span
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: "#F0F0F5",
                letterSpacing: "-0.3px",
              }}
            >
              Neo<span style={{ color: "#4F8AFF" }}>BIM</span>
            </span>
          </Link>
        </motion.div>

        {/* Main content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          style={{ flex: 1, display: "flex", flexDirection: "column" }}
        >
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#F0F0F5",
              lineHeight: 1.2,
              marginBottom: 20,
              letterSpacing: "-0.02em",
            }}
          >
            From brief to building<br />in minutes
          </h1>

          <p
            style={{
              fontSize: 17,
              color: "#9898B0",
              lineHeight: 1.6,
              marginBottom: 44,
              maxWidth: 440,
            }}
          >
            Join thousands of AEC professionals automating workflows with AI-powered visual pipelines.
          </p>

          {/* Stats grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 16,
              marginBottom: 48,
            }}
          >
            {[
              { icon: <Users size={20} />, value: "2,400+", label: "Professionals" },
              { icon: <Workflow size={20} />, value: "28,000+", label: "Workflows Created" },
              { icon: <TrendingUp size={20} />, value: "99.9%", label: "Uptime" },
              { icon: <Zap size={20} />, value: "<30s", label: "Avg Generation" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 + i * 0.08 }}
                style={{
                  background: "rgba(18,18,30,0.6)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  padding: "16px 18px",
                  backdropFilter: "blur(8px)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      color: "#4F8AFF",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {stat.icon}
                  </div>
                  <span
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "#F0F0F5",
                    }}
                  >
                    {stat.value}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#7878A0" }}>{stat.label}</div>
              </motion.div>
            ))}
          </div>

          {/* Testimonial */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            style={{
              background: "rgba(18,18,30,0.5)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderLeft: "3px solid #4F8AFF",
              borderRadius: 12,
              padding: "20px 24px",
              backdropFilter: "blur(8px)",
            }}
          >
            <p
              style={{
                fontSize: 15,
                color: "#D0D0E0",
                lineHeight: 1.6,
                marginBottom: 14,
                fontStyle: "italic",
              }}
            >
              "NeoBIM reduced our concept design phase from 2 weeks to 4 hours.
              The ROI was immediate."
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #8B5CF6, #4F8AFF)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "white",
                }}
              >
                SC
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#F0F0F5" }}>
                  Sarah Chen
                </div>
                <div style={{ fontSize: 12, color: "#7878A0" }}>
                  Design Director, Foster+Partners
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Footer note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          style={{
            fontSize: 12,
            color: "#5C5C78",
            marginTop: 40,
          }}
        >
          No credit card required • Free tier forever
        </motion.div>
      </div>

      {/* ── Right Form Area ─────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px",
          background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(79, 138, 255, 0.03), transparent), #07070D",
        }}
      >
        <div style={{ width: "100%", maxWidth: 440 }}>{children}</div>
      </div>

      {/* ── Mobile responsive styles ──────────────────────────────  */}
      <style jsx global>{`
        @media (max-width: 968px) {
          .auth-sidebar {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
