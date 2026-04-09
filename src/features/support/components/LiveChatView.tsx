"use client";

import { useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Send, MessageSquare } from "lucide-react";
import { useLiveChatStore } from "@/features/support/stores/live-chat-store";
import { useSupportStore } from "@/features/support/stores/support-store";
import { TypingIndicator } from "./TypingIndicator";
import type { LiveChatMessage } from "@/features/support/types/live-chat";

const MAX_CHARS = 3000;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function MessageBubble({ msg, mine }: { msg: LiveChatMessage; mine: boolean }) {
  const isSystem = msg.senderId === "system";
  if (isSystem) {
    return (
      <div style={{ padding: "8px 16px", textAlign: "center" }}>
        <span style={{ fontSize: 12, color: "#6B7280", fontStyle: "italic" }}>
          {msg.content}
        </span>
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        display: "flex",
        justifyContent: mine ? "flex-end" : "flex-start",
        padding: "4px 16px",
      }}
    >
      <div style={{ maxWidth: "78%" }}>
        {!mine && msg.senderName && (
          <div
            style={{
              fontSize: 11,
              color: "#22c55e",
              fontWeight: 600,
              marginBottom: 2,
              paddingLeft: 4,
            }}
          >
            {msg.senderName}
          </div>
        )}
        <div
          style={{
            background: mine ? "rgba(79,138,255,0.85)" : "#1A1A2E",
            color: mine ? "#fff" : "#F0F0F0",
            padding: "10px 14px",
            borderRadius: 14,
            borderTopRightRadius: mine ? 4 : 14,
            borderTopLeftRadius: mine ? 14 : 4,
            fontSize: 14,
            lineHeight: 1.45,
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {msg.content}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#6B7280",
            marginTop: 2,
            textAlign: mine ? "right" : "left",
            paddingInline: 4,
          }}
        >
          {formatTime(msg.createdAt)}
        </div>
      </div>
    </motion.div>
  );
}

export default function LiveChatView() {
  const isActive = useLiveChatStore((s) => s.isActive);
  const conversationStatus = useLiveChatStore((s) => s.conversationStatus);
  const messages = useLiveChatStore((s) => s.messages);
  const isSending = useLiveChatStore((s) => s.isSending);
  const isLoadingHistory = useLiveChatStore((s) => s.isLoadingHistory);
  const adminOnline = useLiveChatStore((s) => s.adminOnline);
  const adminTyping = useLiveChatStore((s) => s.adminTyping);
  const inputDraft = useLiveChatStore((s) => s.inputDraft);
  const setInputDraft = useLiveChatStore((s) => s.setInputDraft);
  const openLiveChat = useLiveChatStore((s) => s.openLiveChat);
  const sendMessage = useLiveChatStore((s) => s.sendMessage);
  const pageContext = useSupportStore((s) => s.pageContext);

  // Open on mount. Pusher subscription is mounted globally in
  // SupportChatWidget so admin replies arrive even when this view is unmounted.
  useEffect(() => {
    if (!isActive) openLiveChat();
  }, [isActive, openLiveChat]);

  // Auto-scroll
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, adminTyping]);

  const isClosed = conversationStatus === "CLOSED";

  const handleSend = useCallback(() => {
    const trimmed = inputDraft.trim();
    if (!trimmed || isSending || isClosed) return;
    sendMessage(trimmed, pageContext);
  }, [inputDraft, isSending, isClosed, sendMessage, pageContext]);

  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Sub-header: presence */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <MessageSquare size={14} color="#22c55e" />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F0" }}>
          Live Chat with our team
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: adminOnline ? "#22c55e" : "#6B7280",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: adminOnline ? "#22c55e" : "#6B7280",
              boxShadow: adminOnline ? "0 0 8px #22c55e" : "none",
            }}
          />
          {adminOnline ? "Support online" : "Support away"}
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", minHeight: 0 }}>
        {isLoadingHistory ? (
          <div style={{ padding: 24, textAlign: "center", color: "#6B7280", fontSize: 13 }}>
            Loading conversation…
          </div>
        ) : messages.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "rgba(34,197,94,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <MessageSquare size={26} color="#22c55e" />
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#F0F0F0", margin: "0 0 6px" }}>
              Talk to our support team
            </p>
            <p style={{ fontSize: 13, color: "#9898B0", margin: 0, lineHeight: 1.5 }}>
              Send a message and a team member will reply as soon as they&apos;re available.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              mine={m.senderRole === "USER"}
            />
          ))
        )}

        {conversationStatus === "WAITING" && messages.length > 0 && !isSending && (
          <div
            style={{
              padding: "12px 16px",
              margin: "8px 16px",
              borderRadius: 12,
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.18)",
              fontSize: 12,
              color: "#FBBF24",
              textAlign: "center",
            }}
          >
            Waiting for a team member to reply…
          </div>
        )}

        {adminTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {isClosed ? (
        <div
          style={{
            padding: "14px 16px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            textAlign: "center",
            fontSize: 13,
            color: "#6B7280",
            fontStyle: "italic",
          }}
        >
          This conversation has been closed.
        </div>
      ) : (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "8px 12px",
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          <textarea
            aria-label="Type your message"
            value={inputDraft}
            onChange={(e) => {
              if (e.target.value.length <= MAX_CHARS + 100) setInputDraft(e.target.value);
            }}
            onKeyDown={handleKey}
            placeholder="Type your message…"
            disabled={isSending}
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              border: "1px solid rgba(107,114,128,0.25)",
              borderRadius: 12,
              padding: "10px 14px",
              fontSize: 14,
              lineHeight: "22px",
              color: "#F0F0F0",
              backgroundColor: "rgba(26,26,46,0.6)",
              outline: "none",
              fontFamily: "inherit",
              maxHeight: 110,
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputDraft.trim() || isSending}
            aria-label="Send message"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: "none",
              cursor: !inputDraft.trim() || isSending ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                !inputDraft.trim() || isSending
                  ? "rgba(34,197,94,0.2)"
                  : "rgba(34,197,94,0.85)",
              flexShrink: 0,
            }}
          >
            <Send size={18} color="#fff" />
          </button>
        </div>
      )}
    </div>
  );
}
