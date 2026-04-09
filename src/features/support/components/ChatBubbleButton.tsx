"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { useSupportStore } from "@/stores/support-store";

interface ChatBubbleButtonProps {
  onClick: () => void;
}

export function ChatBubbleButton({ onClick }: ChatBubbleButtonProps) {
  const unreadCount = useSupportStore((s) => s.unreadCount);
  const hasEscalated = useSupportStore(
    (s) => s.conversations.some((c) => c.status === "ESCALATED"),
  );
  const [hasPulsed, setHasPulsed] = useState(false);

  // Stop pulse animation after 3 cycles (~3 seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasPulsed(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      style={{
        position: "relative",
        width: 56,
        height: 56,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
        boxShadow: hasEscalated
          ? "0 0 0 3px rgba(245, 158, 11, 0.5), 0 8px 24px rgba(99, 102, 241, 0.4)"
          : "0 8px 24px rgba(99, 102, 241, 0.4)",
        outline: "none",
      }}
      aria-label="Open support chat"
    >
      {/* Pulse ring animation - 3 cycles on first render */}
      {!hasPulsed && (
        <motion.span
          style={{
            position: "absolute",
            inset: -4,
            borderRadius: "50%",
            border: "2px solid rgba(99, 102, 241, 0.6)",
            pointerEvents: "none",
          }}
          animate={{
            scale: [1, 1.4],
            opacity: [0.8, 0],
          }}
          transition={{
            duration: 1,
            repeat: 2,
            repeatType: "loop",
            ease: "easeOut",
          }}
        />
      )}

      {/* Escalation amber glow ring */}
      {hasEscalated && (
        <motion.span
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: "50%",
            border: "2px solid rgba(245, 158, 11, 0.7)",
            pointerEvents: "none",
          }}
          animate={{
            boxShadow: [
              "0 0 4px rgba(245, 158, 11, 0.3)",
              "0 0 12px rgba(245, 158, 11, 0.6)",
              "0 0 4px rgba(245, 158, 11, 0.3)",
            ],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      )}

      <MessageCircle size={24} color="#ffffff" strokeWidth={2} />

      {/* Unread count badge */}
      {unreadCount > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 20 }}
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: "#ef4444",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 5px",
            border: "2px solid #111120",
            lineHeight: 1,
          }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </motion.span>
      )}
    </motion.button>
  );
}
