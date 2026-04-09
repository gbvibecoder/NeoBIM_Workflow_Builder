"use client";

import { motion } from "framer-motion";
import { Plus, MessageSquare, Clock, ChevronRight } from "lucide-react";
import { useSupportStore } from "@/stores/support-store";
import type { SupportStatus } from "@/types/support";

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<SupportStatus, { label: string; color: string }> = {
  ACTIVE: { label: "Active", color: "#34D399" },
  ESCALATED: { label: "Escalated", color: "#FBBF24" },
  ADMIN_REPLIED: { label: "Replied", color: "#4F8AFF" },
  RESOLVED: { label: "Resolved", color: "#6B7280" },
  CLOSED: { label: "Closed", color: "#6B7280" },
};

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek}w ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ConversationListViewProps {
  onNewConversation?: () => void;
}

export default function ConversationListView({ onNewConversation }: ConversationListViewProps) {
  const conversations = useSupportStore((s) => s.conversations);
  const setActiveConversation = useSupportStore((s) => s.setActiveConversation);
  const startNewConversation = useSupportStore((s) => s.startNewConversation);
  const activeConversationId = useSupportStore((s) => s.activeConversationId);

  const handleNew = () => {
    startNewConversation();
    onNewConversation?.();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* New Conversation Button */}
      <div style={{ padding: "12px 16px 8px" }}>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleNew}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 10,
            border: "none",
            background: "#4F8AFF",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.01em",
          }}
        >
          <Plus size={16} strokeWidth={2.5} />
          New Conversation
        </motion.button>
      </div>

      {/* Conversation List */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 8px 8px",
        }}
      >
        {conversations.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "rgba(79, 138, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MessageSquare size={22} color="#4F8AFF" />
            </div>
            <p
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: 13,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              No conversations yet.
              <br />
              Ask me anything about BuildFlow!
            </p>
          </motion.div>
        ) : (
          conversations.map((conv, i) => {
            const badge = STATUS_BADGE[conv.status];
            const isSelected = conv.id === activeConversationId;

            return (
              <motion.button
                key={conv.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.03 }}
                onClick={() => setActiveConversation(conv.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "10px 12px",
                  marginBottom: 2,
                  borderRadius: 8,
                  border: "1px solid",
                  borderColor: isSelected
                    ? "rgba(79, 138, 255, 0.35)"
                    : "rgba(255,255,255,0.06)",
                  background: isSelected
                    ? "rgba(79, 138, 255, 0.08)"
                    : "rgba(255,255,255,0.02)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s, border-color 0.15s",
                }}
                whileHover={{
                  backgroundColor: isSelected
                    ? "rgba(79, 138, 255, 0.12)"
                    : "rgba(255,255,255,0.05)",
                }}
              >
                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "rgba(255,255,255,0.9)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {conv.subject || "New conversation"}
                    </span>

                    {/* Status badge */}
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: badge.color,
                        background: `${badge.color}18`,
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        color: "rgba(255,255,255,0.35)",
                      }}
                    >
                      <Clock size={10} />
                      {relativeTime(conv.lastMessageAt)}
                    </span>

                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        color: "rgba(255,255,255,0.35)",
                      }}
                    >
                      <MessageSquare size={10} />
                      {conv.messageCount}
                    </span>
                  </div>
                </div>

                <ChevronRight
                  size={14}
                  style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0 }}
                />
              </motion.button>
            );
          })
        )}
      </div>
    </div>
  );
}
