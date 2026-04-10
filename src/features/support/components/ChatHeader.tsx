"use client";

import { motion } from "framer-motion";
import { Bot, ChevronLeft, Minus, X } from "lucide-react";
import { useSupportStore } from "@/features/support/stores/support-store";
import type { SupportStatus } from "@/types/support";

interface ChatHeaderProps {
  status: SupportStatus | null;
  showBack: boolean;
  onBack?: () => void;
}

const statusConfig = {
  ACTIVE: { color: "#22c55e", label: "AI assistant active" },
  ESCALATED: { color: "#f59e0b", label: "Waiting for team" },
  ADMIN_REPLIED: { color: "#3b82f6", label: "Team replied" },
  RESOLVED: { color: "#a78bfa", label: "Resolved" },
  CLOSED: { color: "#6b7280", label: "Closed" },
} as const;

const headerButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  width: 36,
  height: 36,
  padding: 0,
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "rgba(255, 255, 255, 0.6)",
  transition: "color 0.15s, background 0.15s",
};

export function ChatHeader({
  status: statusProp,
  showBack,
  onBack,
}: ChatHeaderProps) {
  const minimize = useSupportStore((s) => s.minimize);
  const close = useSupportStore((s) => s.close);
  const startNewConversation = useSupportStore((s) => s.startNewConversation);

  const status = statusProp ?? "ACTIVE";
  const config = statusConfig[status];
  const isEscalated = status === "ESCALATED";

  const handleBack = () => {
    startNewConversation();
    onBack?.();
  };

  return (
    <div
      className="pt-[max(12px,env(safe-area-inset-top))] sm:pt-3"
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        flexShrink: 0,
      }}
    >
      {/* Main header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Back button */}
        {showBack && onBack && (
          <motion.button
            onClick={handleBack}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.9 }}
            style={{
              ...headerButtonStyle,
              background: "rgba(255, 255, 255, 0.08)",
              color: "#ffffff",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
            aria-label="Back to conversations"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.14)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
          >
            <ChevronLeft size={18} />
          </motion.button>
        )}

        {/* Bot icon + title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Bot size={18} color="#ffffff" />
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#ffffff",
                lineHeight: 1.3,
              }}
            >
              BuildFlow Support
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "rgba(255, 255, 255, 0.5)",
                lineHeight: 1.3,
              }}
            >
              {/* Status dot */}
              <motion.span
                animate={
                  status === "ACTIVE"
                    ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }
                    : {}
                }
                transition={
                  status === "ACTIVE"
                    ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
                    : {}
                }
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  backgroundColor: config.color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <span>{config.label}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <motion.button
            onClick={minimize}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            style={headerButtonStyle}
            aria-label="Minimize chat"
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ffffff";
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "rgba(255,255,255,0.6)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Minus size={16} />
          </motion.button>

          <motion.button
            onClick={close}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            style={headerButtonStyle}
            aria-label="Close chat"
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ffffff";
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "rgba(255,255,255,0.6)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <X size={16} />
          </motion.button>
        </div>
      </div>

      {/* Escalation sub-banner */}
      {isEscalated && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            marginTop: 8,
            padding: "6px 10px",
            borderRadius: 8,
            backgroundColor: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.2)",
            fontSize: 11,
            color: "#f59e0b",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              backgroundColor: "#f59e0b",
              flexShrink: 0,
            }}
          />
          Your message is with our team
        </motion.div>
      )}
    </div>
  );
}
