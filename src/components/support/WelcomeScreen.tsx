"use client";

import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Workflow,
  FileText,
  CreditCard,
  AlertTriangle,
  Box,
  Bug,
  MessageSquare,
} from "lucide-react";
import { useSupportStore } from "@/stores/support-store";
import { useLiveChatStore } from "@/stores/live-chat-store";

// ─── Topics ─────────────────────────────────────────────────────────────────

const TOPICS = [
  { label: "How do I create a workflow?", icon: Workflow },
  { label: "Help with IFC files", icon: FileText },
  { label: "Billing & pricing", icon: CreditCard },
  { label: "My execution failed", icon: AlertTriangle },
  { label: "3D model generation", icon: Box },
  { label: "Report a bug", icon: Bug },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning!";
  if (hour < 18) return "Good afternoon!";
  return "Good evening!";
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function WelcomeScreen() {
  const sendMessage = useSupportStore((s) => s.sendMessage);
  const setChatView = useSupportStore((s) => s.setChatView);
  const adminOnline = useLiveChatStore((s) => s.adminOnline);
  const greeting = useMemo(getGreeting, []);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "24px 20px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Animated gradient background */}
      <motion.div
        animate={prefersReducedMotion ? undefined : {
          background: [
            "radial-gradient(ellipse at 30% 20%, rgba(79,138,255,0.06) 0%, transparent 60%)",
            "radial-gradient(ellipse at 70% 60%, rgba(99,102,241,0.06) 0%, transparent 60%)",
            "radial-gradient(ellipse at 40% 80%, rgba(79,138,255,0.06) 0%, transparent 60%)",
            "radial-gradient(ellipse at 30% 20%, rgba(79,138,255,0.06) 0%, transparent 60%)",
          ],
        }}
        transition={prefersReducedMotion ? undefined : {
          duration: 12,
          repeat: Infinity,
          ease: "linear",
        }}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      />

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          width: "100%",
          maxWidth: 360,
        }}
      >
        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{ textAlign: "center" }}
        >
          <p
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "rgba(255,255,255,0.92)",
              margin: "0 0 6px",
              letterSpacing: "-0.01em",
            }}
          >
            {greeting}
          </p>
          <p
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.45)",
              margin: 0,
            }}
          >
            How can I help you today?
          </p>
        </motion.div>

        {/* Topic Buttons - 2 column grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            width: "100%",
          }}
        >
          {TOPICS.map((topic, i) => {
            const Icon = topic.icon;

            return (
              <motion.button
                key={topic.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  delay: 0.15 + i * 0.05,
                }}
                whileHover={{
                  scale: 1.03,
                  borderColor: "rgba(79,138,255,0.3)",
                  backgroundColor: "rgba(79,138,255,0.06)",
                }}
                whileTap={{ scale: 0.97 }}
                onClick={() => sendMessage(topic.label)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "14px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color 0.2s, background 0.2s",
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: "rgba(79,138,255,0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={15} color="#4F8AFF" />
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.7)",
                    lineHeight: 1.35,
                  }}
                >
                  {topic.label}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* Live Chat with Us — full-width card */}
        <motion.button
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.5 }}
          whileHover={{
            scale: 1.015,
            borderColor: "rgba(34,197,94,0.35)",
            backgroundColor: "rgba(34,197,94,0.07)",
          }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setChatView("live-chat")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            padding: "14px 14px",
            borderRadius: 12,
            border: "1px solid rgba(34,197,94,0.22)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(34,197,94,0.03) 100%)",
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.2s",
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "rgba(34,197,94,0.18)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <MessageSquare size={18} color="#22c55e" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#F0F0F0",
                margin: 0,
                lineHeight: 1.3,
              }}
            >
              Live Chat with Us
            </p>
            <p
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.5)",
                margin: "2px 0 0",
              }}
            >
              Talk to our support team directly
            </p>
          </div>
          {adminOnline && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 8px #22c55e",
                flexShrink: 0,
              }}
              aria-label="Support online"
            />
          )}
        </motion.button>
      </div>
    </div>
  );
}
