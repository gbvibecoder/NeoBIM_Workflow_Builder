"use client";

import { useEffect, useMemo, useRef, useState, KeyboardEvent } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Send, Circle, X, MessageSquare } from "lucide-react";
import { useAdminLiveChatStore } from "@/features/support/stores/admin-live-chat-store";
import { usePusherAdminLiveChat } from "@/features/support/hooks/usePusherAdminLiveChat";
import type {
  AdminLiveChatConversation,
  LiveChatMessage,
  LiveChatStatus,
} from "@/features/support/types/live-chat";

// Stable empty array — selectors must NEVER return a new `[]` literal each
// render or useSyncExternalStore loops infinitely (getServerSnapshot caching).
const EMPTY_MESSAGES: LiveChatMessage[] = [];

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name: string | null, email: string): string {
  const src = name || email;
  const parts = src.split(/[\s@]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

function avatarColor(seed: string): string {
  const colors = [
    "#4F8AFF", "#22c55e", "#FBBF24", "#EC4899",
    "#8B5CF6", "#06B6D4", "#F97316", "#10B981",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

function StatusDot({ status }: { status: LiveChatStatus }) {
  const map: Record<LiveChatStatus, { color: string; label: string }> = {
    WAITING: { color: "#F87171", label: "New" },
    ACTIVE: { color: "#22c55e", label: "Replied" },
    CLOSED: { color: "#6B7280", label: "Closed" },
  };
  const m = map[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: m.color,
      }}
    >
      <Circle size={7} fill={m.color} stroke="none" />
      {m.label}
    </span>
  );
}

function ConversationRow({
  conv,
  selected,
  onClick,
}: {
  conv: AdminLiveChatConversation;
  selected: boolean;
  onClick: () => void;
}) {
  const color = avatarColor(conv.userId);
  const isWaiting = conv.status === "WAITING";
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 14px",
        background: selected ? "rgba(79,138,255,0.12)" : "transparent",
        border: "none",
        borderLeft: selected
          ? "3px solid #4F8AFF"
          : "3px solid transparent",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.03)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: color,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {initials(conv.userName, conv.userEmail)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: isWaiting ? 700 : 600,
              color: "#F0F0F0",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: 1,
            }}
          >
            {conv.userName || conv.userEmail}
          </span>
          <span style={{ fontSize: 10, color: "#6B7280", flexShrink: 0 }}>
            {relTime(conv.lastMessageAt)}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#9898B0",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {conv.lastMessage
            ? `${conv.lastMessage.senderRole === "ADMIN" ? "You: " : ""}${conv.lastMessage.content}`
            : "No messages yet"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <StatusDot status={conv.status} />
          {conv.userPlan && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.5px",
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(99,102,241,0.15)",
                color: "#a5b4fc",
              }}
            >
              {conv.userPlan}
            </span>
          )}
          {conv.repliedByName && conv.status === "ACTIVE" && (
            <span style={{ fontSize: 10, color: "#6B7280" }}>
              · {conv.repliedByName}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px 8px",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "1.2px",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        <span>{title}</span>
        <span
          style={{
            background: `${accent}22`,
            color: accent,
            padding: "1px 7px",
            borderRadius: 10,
            fontSize: 10,
          }}
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function ChatPane({ conversation }: { conversation: AdminLiveChatConversation | null }) {
  const messages = useAdminLiveChatStore((s) =>
    conversation ? (s.messages[conversation.id] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const isSending = useAdminLiveChatStore((s) => s.isSending);
  const sendReply = useAdminLiveChatStore((s) => s.sendReply);
  const closeConversation = useAdminLiveChatStore((s) => s.closeConversation);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Note: draft is reset by remounting ChatPane via `key={selected?.id}` in the
  // parent — no effect needed for that.

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!conversation) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          color: "#6B7280",
          padding: 40,
          textAlign: "center",
          background: "#111520",
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.018) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 24,
            background: "linear-gradient(135deg, rgba(79,138,255,0.12), rgba(99,102,241,0.08))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(79,138,255,0.12)",
            boxShadow: "0 8px 32px rgba(79,138,255,0.1)",
          }}
        >
          <MessageSquare size={36} color="#4F8AFF" />
        </div>
        <div>
          <p style={{ fontSize: 18, fontWeight: 700, color: "#e2e5f0", margin: "0 0 6px", letterSpacing: "-0.01em" }}>
            Select a conversation
          </p>
          <p style={{ fontSize: 13, color: "#5a5d72", margin: 0, lineHeight: 1.5 }}>
            Choose a thread from the left panel to start replying.<br />
            New messages from users will appear automatically.
          </p>
        </div>
      </div>
    );
  }

  const isClosed = conversation.status === "CLOSED";
  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || isSending || isClosed) return;
    sendReply(conversation.id, trimmed);
    setDraft("");
  };
  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group consecutive messages from the same sender so we don't repeat the
  // name + only show the timestamp on the last bubble of the group.
  type Group = { senderRole: "USER" | "ADMIN"; senderName: string | null; items: LiveChatMessage[] };
  const groups: Group[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.senderRole === m.senderRole && last.senderName === m.senderName) {
      last.items.push(m);
    } else {
      groups.push({ senderRole: m.senderRole, senderName: m.senderName, items: [m] });
    }
  }

  const userColor = avatarColor(conversation.userId);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "#111520",
        position: "relative",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        style={{
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: "linear-gradient(180deg, #181d2e 0%, #141824 100%)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.03), 0 4px 16px rgba(0,0,0,0.2)",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${userColor}, ${userColor}aa)`,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              fontWeight: 700,
              boxShadow: `0 4px 14px ${userColor}55, 0 0 0 2px rgba(255,255,255,0.04)`,
            }}
          >
            {initials(conversation.userName, conversation.userEmail)}
          </div>
          {/* Active dot */}
          <span
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#22c55e",
              border: "2px solid #181d2e",
              boxShadow: "0 0 6px rgba(34,197,94,0.6)",
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#F5F6FA",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {conversation.userName || conversation.userEmail}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#7a7d92",
              display: "flex",
              gap: 8,
              marginTop: 2,
              alignItems: "center",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {conversation.userEmail}
            </span>
            {conversation.userPlan && (
              <>
                <span>·</span>
                <span
                  style={{
                    background: "rgba(99,102,241,0.15)",
                    color: "#a5b4fc",
                    padding: "1px 6px",
                    borderRadius: 4,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.5px",
                  }}
                >
                  {conversation.userPlan}
                </span>
              </>
            )}
            {conversation.pageContext && (
              <>
                <span>·</span>
                <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: 10 }}>
                  {conversation.pageContext}
                </span>
              </>
            )}
          </div>
        </div>
        <StatusDot status={conversation.status} />
        {!isClosed && (
          <button
            onClick={() => closeConversation(conversation.id)}
            title="Close conversation"
            style={{
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.22)",
              color: "#F87171",
              padding: "7px 13px",
              borderRadius: 9,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(248,113,113,0.16)";
              e.currentTarget.style.borderColor = "rgba(248,113,113,0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(248,113,113,0.08)";
              e.currentTarget.style.borderColor = "rgba(248,113,113,0.22)";
            }}
          >
            <X size={13} /> Close
          </button>
        )}
      </div>

      {/* ── Messages ────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
          padding: "20px 0 8px",
          // WhatsApp-style subtle wallpaper doodle pattern
          backgroundColor: "#111520",
          backgroundImage: `
            radial-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            radial-gradient(rgba(79,138,255,0.015) 1px, transparent 1px)`,
          backgroundSize: "24px 24px, 40px 40px",
          backgroundPosition: "0 0, 12px 12px",
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "#6B7280",
              fontSize: 13,
              padding: 40,
              fontStyle: "italic",
            }}
          >
            No messages yet — say hi 👋
          </div>
        ) : (
          groups.map((group, gi) => {
            const mine = group.senderRole === "ADMIN";
            const lastInGroup = group.items[group.items.length - 1];
            return (
              <div key={gi} style={{ padding: "0 24px", marginBottom: 14 }}>
                {!mine && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9aa0bd",
                      marginBottom: 4,
                      paddingLeft: 4,
                      fontWeight: 600,
                    }}
                  >
                    {group.senderName || "User"}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: mine ? "flex-end" : "flex-start",
                    gap: 3,
                  }}
                >
                  {group.items.map((m, idx) => {
                    const isFirst = idx === 0;
                    const isLast = idx === group.items.length - 1;
                    const isOptimistic = m.id.startsWith("temp-");
                    return (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 4, scale: 0.98 }}
                        animate={{ opacity: isOptimistic ? 0.85 : 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        style={{
                          maxWidth: "68%",
                          background: mine
                            ? "linear-gradient(135deg, #4F8AFF, #6366f1)"
                            : "rgba(26,31,48,0.95)",
                          color: mine ? "#ffffff" : "#e9edef",
                          padding: "9px 14px",
                          fontSize: 14,
                          lineHeight: 1.45,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          // Bubble corners — sharper on the speaker side at first message
                          borderRadius: 16,
                          borderTopRightRadius: mine && isFirst ? 6 : 16,
                          borderTopLeftRadius: !mine && isFirst ? 6 : 16,
                          borderBottomRightRadius: mine && isLast ? 6 : 16,
                          borderBottomLeftRadius: !mine && isLast ? 6 : 16,
                          boxShadow: mine
                            ? "0 4px 14px rgba(79,138,255,0.2), 0 1px 0 rgba(255,255,255,0.08) inset"
                            : "0 2px 8px rgba(0,0,0,0.2), 0 1px 0 rgba(255,255,255,0.03) inset",
                          border: mine ? "none" : "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        {m.content}
                      </motion.div>
                    );
                  })}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#5a5d72",
                    marginTop: 4,
                    textAlign: mine ? "right" : "left",
                    paddingInline: 4,
                  }}
                  title={new Date(lastInGroup.createdAt).toLocaleString()}
                >
                  {relTime(lastInGroup.createdAt)}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ───────────────────────────────────────────────── */}
      {isClosed ? (
        <div
          style={{
            padding: "20px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            textAlign: "center",
            fontSize: 13,
            color: "#6B7280",
            fontStyle: "italic",
            background: "#141824",
          }}
        >
          🔒 This conversation has been closed.
        </div>
      ) : (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "14px 18px 16px",
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            background: "linear-gradient(180deg, #141824 0%, #181d2e 100%)",
            position: "relative",
            zIndex: 2,
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 3100))}
            onKeyDown={handleKey}
            placeholder="Type your reply…  (Enter to send, Shift+Enter for newline)"
            rows={1}
            disabled={isSending}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(79,138,255,0.45)";
              e.currentTarget.style.boxShadow = "0 0 0 4px rgba(79,138,255,0.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(107,114,128,0.22)";
              e.currentTarget.style.boxShadow = "none";
            }}
            style={{
              flex: 1,
              resize: "none",
              border: "1px solid rgba(107,114,128,0.22)",
              borderRadius: 14,
              padding: "13px 16px",
              fontSize: 14,
              lineHeight: "22px",
              color: "#F5F6FA",
              background: "rgba(18,20,32,0.9)",
              transition: "border-color 0.15s, box-shadow 0.15s",
              outline: "none",
              fontFamily: "inherit",
              maxHeight: 140,
            }}
          />
          <motion.button
            onClick={handleSend}
            disabled={!draft.trim() || isSending}
            whileHover={!draft.trim() || isSending ? undefined : { scale: 1.04 }}
            whileTap={!draft.trim() || isSending ? undefined : { scale: 0.96 }}
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              border: "none",
              cursor: !draft.trim() || isSending ? "not-allowed" : "pointer",
              background:
                !draft.trim() || isSending
                  ? "rgba(79,138,255,0.18)"
                  : "linear-gradient(135deg, #4F8AFF, #6366f1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow:
                !draft.trim() || isSending
                  ? "none"
                  : "0 6px 20px rgba(79,138,255,0.35), 0 0 0 1px rgba(255,255,255,0.06) inset",
              flexShrink: 0,
              transition: "background 0.15s, box-shadow 0.15s",
            }}
          >
            <Send size={18} color="#fff" />
          </motion.button>
        </div>
      )}
    </div>
  );
}

export default function AdminLiveChatLayout() {
  const { data: session } = useSession();
  const conversations = useAdminLiveChatStore((s) => s.conversations);
  const selectedId = useAdminLiveChatStore((s) => s.selectedConversationId);
  const isLoadingList = useAdminLiveChatStore((s) => s.isLoadingList);
  const fetchConversations = useAdminLiveChatStore((s) => s.fetchConversations);
  const selectConversation = useAdminLiveChatStore((s) => s.selectConversation);
  const setMyUserId = useAdminLiveChatStore((s) => s.setMyUserId);
  const startPolling = useAdminLiveChatStore((s) => s.startPolling);
  const stopPolling = useAdminLiveChatStore((s) => s.stopPolling);
  const refreshSelectedMessages = useAdminLiveChatStore((s) => s.refreshSelectedMessages);

  usePusherAdminLiveChat();

  useEffect(() => {
    if (session?.user?.id) setMyUserId(session.user.id);
  }, [session?.user?.id, setMyUserId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Polling fallback + visibility-based instant refetch — guarantees the
  // admin sees new messages within ~5s even if Pusher is unavailable, and
  // catches up immediately when the tab comes back to focus.
  useEffect(() => {
    startPolling();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchConversations();
        refreshSelectedMessages();
      }
    };
    const onFocus = () => {
      fetchConversations();
      refreshSelectedMessages();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [startPolling, stopPolling, fetchConversations, refreshSelectedMessages]);

  const { waiting, active, closed } = useMemo(() => {
    const w: AdminLiveChatConversation[] = [];
    const a: AdminLiveChatConversation[] = [];
    const c: AdminLiveChatConversation[] = [];
    for (const conv of conversations) {
      if (conv.status === "WAITING") w.push(conv);
      else if (conv.status === "ACTIVE") a.push(conv);
      else c.push(conv);
    }
    // Waiting: oldest first (FIFO support queue)
    w.sort((x, y) => new Date(x.lastMessageAt).getTime() - new Date(y.lastMessageAt).getTime());
    return { waiting: w, active: a, closed: c };
  }, [conversations]);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#111520",
        color: "#e9edef",
        minHeight: 0,
      }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        style={{
          width: 360,
          flexShrink: 0,
          borderRight: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          flexDirection: "column",
          background: "#0d1017",
          minHeight: 0,
        }}
      >
        {/* Sidebar header */}
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "linear-gradient(180deg, #141824 0%, #0d1017 100%)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, rgba(79,138,255,0.2), rgba(99,102,241,0.12))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(79,138,255,0.15)",
            }}
          >
            <MessageSquare size={17} color="#4F8AFF" />
          </div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, flex: 1, letterSpacing: "-0.01em" }}>
            Live Chat
          </h2>
          {waiting.length > 0 && (
            <span
              style={{
                background: "linear-gradient(135deg, #ef4444, #dc2626)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 12,
                boxShadow: "0 2px 8px rgba(239,68,68,0.35)",
              }}
            >
              {waiting.length} new
            </span>
          )}
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {isLoadingList && conversations.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "#6B7280", fontSize: 13 }}>
              Loading conversations…
            </div>
          )}
          {!isLoadingList && conversations.length === 0 && (
            <div style={{ padding: 32, textAlign: "center" }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: "rgba(107,114,128,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 12px",
                }}
              >
                <MessageSquare size={24} color="#6B7280" />
              </div>
              <p style={{ color: "#6B7280", fontSize: 13, margin: 0 }}>
                No conversations yet
              </p>
              <p style={{ color: "#4a4d5e", fontSize: 11, margin: "4px 0 0" }}>
                Messages from users will appear here
              </p>
            </div>
          )}

          <Section title="New" count={waiting.length} accent="#F87171">
            {waiting.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                selected={c.id === selectedId}
                onClick={() => selectConversation(c.id)}
              />
            ))}
          </Section>

          <Section title="Replied" count={active.length} accent="#22c55e">
            {active.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                selected={c.id === selectedId}
                onClick={() => selectConversation(c.id)}
              />
            ))}
          </Section>

          <Section title="Closed" count={closed.length} accent="#6B7280">
            {closed.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                selected={c.id === selectedId}
                onClick={() => selectConversation(c.id)}
              />
            ))}
          </Section>
        </div>
      </aside>

      {/* ── Chat pane — fills all remaining space ───────────────── */}
      <ChatPane key={selected?.id || "empty"} conversation={selected} />
    </div>
  );
}
