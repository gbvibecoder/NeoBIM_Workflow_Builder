"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDown } from "lucide-react";
import type { SupportMessage } from "@/types/support";
import { MessageBubble } from "@/components/support/MessageBubble";
import { TypingIndicator } from "@/components/support/TypingIndicator";

interface MessageThreadProps {
  messages: SupportMessage[];
  showTyping?: boolean;
}

// ─── Date grouping helpers ──────────────────────────────────────────────────

function getDateKey(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const now = new Date();

  const todayKey = getDateKey(now.toISOString());
  if (dateKey === todayKey) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getDateKey(yesterday.toISOString());
  if (dateKey === yesterdayKey) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

interface DateGroup {
  dateKey: string;
  label: string;
  messages: SupportMessage[];
}

function groupMessagesByDate(messages: SupportMessage[]): DateGroup[] {
  const groups: DateGroup[] = [];
  let currentKey = "";

  for (const msg of messages) {
    const key = getDateKey(msg.createdAt);
    if (key !== currentKey) {
      currentKey = key;
      groups.push({
        dateKey: key,
        label: formatDateLabel(key),
        messages: [msg],
      });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

// ─── Scroll threshold in pixels ──────────────────────────────────────────────

const SCROLL_THRESHOLD = 80;

// ─── Component ──────────────────────────────────────────────────────────────

export function MessageThread({
  messages,
  showTyping = false,
}: MessageThreadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isNearBottomRef = useRef(true);

  // ─── Check if user is near the bottom ──────────────────────
  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < SCROLL_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    setShowScrollBtn(!nearBottom);
  }, []);

  // ─── Auto-scroll on new messages if user is at bottom ──────
  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, showTyping]);

  // ─── Scroll to bottom on initial mount ─────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, []);

  // ─── Scroll-to-bottom handler ──────────────────────────────
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const dateGroups = groupMessagesByDate(messages);

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ─── Scrollable message area ────────────────────────── */}
      <div
        ref={containerRef}
        onScroll={checkScroll}
        role="log"
        aria-live="polite"
        aria-label="Support conversation"
        style={{
          flex: 1,
          overflowY: "auto",
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        {dateGroups.map((group) => (
          <div key={group.dateKey}>
            {/* Date separator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "12px 16px 4px",
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 1,
                  backgroundColor: "rgba(107, 114, 128, 0.2)",
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: "#6B7280",
                  fontWeight: 500,
                  padding: "0 12px",
                  whiteSpace: "nowrap",
                }}
              >
                {group.label}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 1,
                  backgroundColor: "rgba(107, 114, 128, 0.2)",
                }}
              />
            </div>

            {/* Messages in this date group */}
            {group.messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        ))}

        {/* Typing indicator */}
        {showTyping && <TypingIndicator />}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* ─── Scroll-to-bottom FAB ───────────────────────────── */}
      <AnimatePresence>
        {showScrollBtn && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              width: 36,
              height: 36,
              borderRadius: "50%",
              backgroundColor: "rgba(79, 138, 255, 0.9)",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
              zIndex: 10,
            }}
          >
            <ArrowDown size={18} color="#fff" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
