"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  MessageSquare,
  Clock,
  User,
  Send,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUpCircle,
  ChevronDown,
  Loader2,
  StickyNote,
  RefreshCw,
  Inbox,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────── */

type ConversationStatus =
  | "ACTIVE"
  | "ESCALATED"
  | "ADMIN_REPLIED"
  | "RESOLVED"
  | "CLOSED";

type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface ConversationListItem {
  id: string;
  userName: string;
  userEmail: string;
  subject: string;
  status: ConversationStatus;
  category: string;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface Message {
  id: string;
  role: "USER" | "AI" | "ADMIN";
  content: string;
  isInternalNote?: boolean;
  createdAt: string;
  senderName?: string;
}

interface ConversationDetail {
  id: string;
  user: {
    name: string;
    email: string;
    plan: string;
    image?: string;
  };
  subject: string;
  status: ConversationStatus;
  category: string;
  priority: Priority;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

/* ── Constants ────────────────────────────────────────────────────── */

const STATUS_COLORS: Record<ConversationStatus, string> = {
  ACTIVE: "#34D399",
  ESCALATED: "#FBBF24",
  ADMIN_REPLIED: "#4F8AFF",
  RESOLVED: "#6B7280",
  CLOSED: "#6B7280",
};

const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: "#6B7280",
  MEDIUM: "#3B82F6",
  HIGH: "#F59E0B",
  URGENT: "#EF4444",
};

const ROLE_COLORS: Record<string, string> = {
  USER: "#34D399",
  AI: "#A78BFA",
  ADMIN: "#4F8AFF",
};

const STATUS_OPTIONS: ConversationStatus[] = [
  "ACTIVE",
  "ESCALATED",
  "ADMIN_REPLIED",
  "RESOLVED",
  "CLOSED",
];

const PRIORITY_OPTIONS: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const CATEGORY_OPTIONS = [
  "GENERAL",
  "BILLING",
  "TECHNICAL",
  "FEATURE_REQUEST",
  "BUG_REPORT",
  "ACCOUNT",
];

/* ── Helpers ──────────────────────────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function StatusIcon({ status }: { status: ConversationStatus }) {
  const size = 14;
  const color = STATUS_COLORS[status];
  switch (status) {
    case "ACTIVE":
      return <MessageSquare size={size} color={color} />;
    case "ESCALATED":
      return <AlertTriangle size={size} color={color} />;
    case "ADMIN_REPLIED":
      return <ArrowUpCircle size={size} color={color} />;
    case "RESOLVED":
      return <CheckCircle size={size} color={color} />;
    case "CLOSED":
      return <XCircle size={size} color={color} />;
  }
}

/* ── Dropdown (reusable) ──────────────────────────────────────────── */

function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  allLabel,
}: {
  value: T | "ALL";
  options: T[];
  onChange: (v: T | "ALL") => void;
  label: string;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          color: "#E0E0F0",
          fontSize: 13,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: "#888" }}>{label}:</span>
        <span>{value === "ALL" ? allLabel || "All" : value}</span>
        <ChevronDown size={14} style={{ opacity: 0.5 }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              minWidth: 160,
              background: "#1A1A2E",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              padding: 4,
              zIndex: 50,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {allLabel !== undefined && (
              <button
                onClick={() => {
                  onChange("ALL");
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 12px",
                  background:
                    value === "ALL" ? "rgba(255,255,255,0.08)" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  color: "#E0E0F0",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                All
              </button>
            )}
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 12px",
                  background:
                    value === opt ? "rgba(255,255,255,0.08)" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  color: "#E0E0F0",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {opt}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────────── */

export default function SupportConversations() {
  /* ── List state ─────────────────────────────────────────────────── */
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    []
  );
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    ConversationStatus | "ALL"
  >("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* ── Detail state ───────────────────────────────────────────────── */
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  /* ── Reply state ────────────────────────────────────────────────── */
  const [replyText, setReplyText] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);

  /* ── Metadata edit state ────────────────────────────────────────── */
  const [editStatus, setEditStatus] = useState<ConversationStatus | "ALL">(
    "ALL"
  );
  const [editCategory, setEditCategory] = useState("GENERAL");
  const [editPriority, setEditPriority] = useState<Priority>("MEDIUM");
  const [savingMeta, setSavingMeta] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* ── Fetch conversation list ────────────────────────────────────── */
  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const res = await fetch(
        `/api/admin/support/conversations?${params.toString()}`
      );
      if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
      const data = await res.json();
      setConversations(data.conversations ?? data ?? []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setListLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  /* ── Fetch conversation detail ──────────────────────────────────── */
  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/admin/support/conversations/${id}`);
      if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
      const data: ConversationDetail = await res.json();
      setDetail(data);
      setEditStatus(data.status);
      setEditCategory(data.category);
      setEditPriority(data.priority);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      setReplyText("");
      setIsInternalNote(false);
      fetchDetail(selectedId);
    }
  }, [selectedId, fetchDetail]);

  /* ── Scroll to latest message ───────────────────────────────────── */
  useEffect(() => {
    if (detail?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [detail?.messages?.length]);

  /* ── Send reply ─────────────────────────────────────────────────── */
  const handleSendReply = async () => {
    if (!selectedId || !replyText.trim()) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/admin/support/conversations/${selectedId}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: replyText.trim(),
            isInternalNote,
          }),
        }
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setReplyText("");
      setIsInternalNote(false);
      await fetchDetail(selectedId);
      await fetchList();
    } catch {
      // Error silently handled; user can retry
    } finally {
      setSending(false);
    }
  };

  /* ── Update metadata ────────────────────────────────────────────── */
  const handleSaveMeta = async () => {
    if (!selectedId || editStatus === "ALL") return;
    setSavingMeta(true);
    try {
      const res = await fetch(
        `/api/admin/support/conversations/${selectedId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: editStatus,
            category: editCategory,
            priority: editPriority,
          }),
        }
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      await fetchDetail(selectedId);
      await fetchList();
    } catch {
      // silent
    } finally {
      setSavingMeta(false);
    }
  };

  /* ── Filtered list ──────────────────────────────────────────────── */
  const filtered = conversations;

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 120px)",
        background: "#0A0A14",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
    >
      {/* ── LEFT PANEL ─────────────────────────────────────────────── */}
      <div
        style={{
          width: "35%",
          minWidth: 340,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Filter bar */}
        <div
          style={{
            padding: "16px 16px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Dropdown<ConversationStatus>
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={(v) => setStatusFilter(v as ConversationStatus | "ALL")}
              label="Status"
              allLabel="All"
            />
            <button
              onClick={fetchList}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                color: "#888",
                cursor: "pointer",
              }}
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
            }}
          >
            <Search size={14} color="#666" />
            <input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#E0E0F0",
                fontSize: 13,
              }}
            />
          </div>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {listLoading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 40,
                color: "#666",
              }}
            >
              <Loader2
                size={20}
                style={{ animation: "spin 1s linear infinite" }}
              />
              <span style={{ marginLeft: 8, fontSize: 13 }}>Loading...</span>
            </div>
          )}

          {listError && (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "#EF4444",
                fontSize: 13,
              }}
            >
              {listError}
            </div>
          )}

          {!listLoading && !listError && filtered.length === 0 && (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#555",
                fontSize: 13,
              }}
            >
              <Filter
                size={24}
                style={{ margin: "0 auto 8px", opacity: 0.3 }}
              />
              <div>No conversations found</div>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {filtered.map((conv) => (
              <motion.button
                key={conv.id}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSelectedId(conv.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 16px",
                  background:
                    selectedId === conv.id
                      ? "rgba(79,138,255,0.1)"
                      : "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  cursor: "pointer",
                  borderLeft:
                    selectedId === conv.id
                      ? "3px solid #4F8AFF"
                      : "3px solid transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (selectedId !== conv.id)
                    e.currentTarget.style.background =
                      "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  if (selectedId !== conv.id)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Row 1: name + time */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      color: "#F0F0F5",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {conv.userName || "Unknown"}
                  </span>
                  <span
                    style={{
                      color: "#666",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Clock size={10} />
                    {timeAgo(conv.createdAt)}
                  </span>
                </div>

                {/* Row 2: email */}
                <div
                  style={{
                    color: "#888",
                    fontSize: 11,
                    marginBottom: 6,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {conv.userEmail}
                </div>

                {/* Row 3: subject */}
                <div
                  style={{
                    color: "#BBBBD0",
                    fontSize: 12,
                    marginBottom: 8,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {conv.subject}
                </div>

                {/* Row 4: badges */}
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Status badge */}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      color: STATUS_COLORS[conv.status],
                      background: `${STATUS_COLORS[conv.status]}18`,
                      border: `1px solid ${STATUS_COLORS[conv.status]}30`,
                    }}
                  >
                    <StatusIcon status={conv.status} />
                    {conv.status}
                  </span>

                  {/* Category tag */}
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      color: "#8888A0",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {conv.category}
                  </span>

                  {/* Priority indicator */}
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: PRIORITY_COLORS[conv.priority],
                      flexShrink: 0,
                    }}
                    title={`Priority: ${conv.priority}`}
                  />

                  {/* Message count */}
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: "#666",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <MessageSquare size={10} />
                    {conv.messageCount}
                  </span>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>

        {/* List footer */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            fontSize: 11,
            color: "#555",
            textAlign: "center",
          }}
        >
          {filtered.length} conversation{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* ── RIGHT PANEL ────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "#08081A",
        }}
      >
        {!selectedId && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "#444",
            }}
          >
            <Inbox size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
            <div style={{ fontSize: 15, fontWeight: 500 }}>
              Select a conversation
            </div>
            <div style={{ fontSize: 12, marginTop: 4, opacity: 0.6 }}>
              Choose from the list on the left to view details
            </div>
          </div>
        )}

        {selectedId && detailLoading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
            }}
          >
            <Loader2
              size={24}
              style={{ animation: "spin 1s linear infinite" }}
            />
            <span style={{ marginLeft: 8 }}>Loading conversation...</span>
          </div>
        )}

        {selectedId && detailError && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#EF4444",
              fontSize: 14,
            }}
          >
            {detailError}
          </div>
        )}

        {selectedId && detail && !detailLoading && !detailError && (
          <>
            {/* ── User info header ───────────────────────────────────── */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "rgba(79,138,255,0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#4F8AFF",
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  {detail.user.name?.[0]?.toUpperCase() ?? (
                    <User size={18} />
                  )}
                </div>
                <div>
                  <div
                    style={{
                      color: "#F0F0F5",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {detail.user.name}
                  </div>
                  <div style={{ color: "#888", fontSize: 12 }}>
                    {detail.user.email}
                    <span
                      style={{
                        marginLeft: 8,
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontSize: 10,
                        background: "rgba(79,138,255,0.12)",
                        color: "#4F8AFF",
                        fontWeight: 600,
                      }}
                    >
                      {detail.user.plan}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ color: "#666", fontSize: 12 }}>
                {detail.subject}
              </div>
            </div>

            {/* ── Content area: messages + metadata sidebar ──────────── */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Messages column */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                {/* Message thread */}
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: "16px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {detail.messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{
                        padding: "12px 16px",
                        borderRadius: 10,
                        background: msg.isInternalNote
                          ? "rgba(251,191,36,0.06)"
                          : "rgba(255,255,255,0.03)",
                        border: msg.isInternalNote
                          ? "1px solid rgba(251,191,36,0.2)"
                          : "1px solid rgba(255,255,255,0.05)",
                        maxWidth: "85%",
                        alignSelf:
                          msg.role === "USER" ? "flex-start" : "flex-end",
                      }}
                    >
                      {/* Message header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: ROLE_COLORS[msg.role] ?? "#888",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {msg.role}
                        </span>
                        {msg.senderName && (
                          <span style={{ fontSize: 11, color: "#888" }}>
                            {msg.senderName}
                          </span>
                        )}
                        {msg.isInternalNote && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              fontSize: 10,
                              color: "#FBBF24",
                            }}
                          >
                            <StickyNote size={10} />
                            Internal
                          </span>
                        )}
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 10,
                            color: "#555",
                          }}
                        >
                          {timeAgo(msg.createdAt)}
                        </span>
                      </div>

                      {/* Message body */}
                      <div
                        style={{
                          color: "#D0D0E8",
                          fontSize: 13,
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* ── Reply area ─────────────────────────────────────── */}
                <div
                  style={{
                    padding: "12px 20px 16px",
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(0,0,0,0.2)",
                  }}
                >
                  {/* Internal note toggle */}
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 8,
                      cursor: "pointer",
                      fontSize: 12,
                      color: isInternalNote ? "#FBBF24" : "#777",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isInternalNote}
                      onChange={(e) => setIsInternalNote(e.target.checked)}
                      style={{ accentColor: "#FBBF24" }}
                    />
                    <StickyNote size={12} />
                    Internal note (not visible to user)
                  </label>

                  <div style={{ display: "flex", gap: 8 }}>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={
                        isInternalNote
                          ? "Write an internal note..."
                          : "Type your reply..."
                      }
                      rows={3}
                      style={{
                        flex: 1,
                        padding: "10px 14px",
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${isInternalNote ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.08)"}`,
                        borderRadius: 8,
                        color: "#E0E0F0",
                        fontSize: 13,
                        resize: "vertical",
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = isInternalNote
                          ? "rgba(251,191,36,0.4)"
                          : "rgba(79,138,255,0.4)";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = isInternalNote
                          ? "rgba(251,191,36,0.2)"
                          : "rgba(255,255,255,0.08)";
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          handleSendReply();
                        }
                      }}
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={!replyText.trim() || sending}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "0 20px",
                        height: "auto",
                        background:
                          !replyText.trim() || sending
                            ? "rgba(79,138,255,0.2)"
                            : "#4F8AFF",
                        border: "none",
                        borderRadius: 8,
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor:
                          !replyText.trim() || sending
                            ? "not-allowed"
                            : "pointer",
                        transition: "background 0.15s",
                        alignSelf: "flex-end",
                        minHeight: 42,
                      }}
                    >
                      {sending ? (
                        <Loader2
                          size={14}
                          style={{ animation: "spin 1s linear infinite" }}
                        />
                      ) : (
                        <Send size={14} />
                      )}
                      Send
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Metadata sidebar ─────────────────────────────────── */}
              <div
                style={{
                  width: 220,
                  borderLeft: "1px solid rgba(255,255,255,0.06)",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  overflowY: "auto",
                  background: "rgba(0,0,0,0.15)",
                }}
              >
                <div style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>
                  METADATA
                </div>

                {/* Status */}
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#666",
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Status
                  </div>
                  <select
                    value={editStatus === "ALL" ? detail.status : editStatus}
                    onChange={(e) =>
                      setEditStatus(e.target.value as ConversationStatus)
                    }
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      color: "#E0E0F0",
                      fontSize: 12,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option
                        key={s}
                        value={s}
                        style={{ background: "#1A1A2E" }}
                      >
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Category */}
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#666",
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Category
                  </div>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      color: "#E0E0F0",
                      fontSize: 12,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option
                        key={c}
                        value={c}
                        style={{ background: "#1A1A2E" }}
                      >
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#666",
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Priority
                  </div>
                  <select
                    value={editPriority}
                    onChange={(e) =>
                      setEditPriority(e.target.value as Priority)
                    }
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      color: "#E0E0F0",
                      fontSize: 12,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option
                        key={p}
                        value={p}
                        style={{ background: "#1A1A2E" }}
                      >
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Save metadata button */}
                <button
                  onClick={handleSaveMeta}
                  disabled={savingMeta}
                  style={{
                    padding: "8px 12px",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#E0E0F0",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: savingMeta ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                  onMouseEnter={(e) => {
                    if (!savingMeta)
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      "rgba(255,255,255,0.06)";
                  }}
                >
                  {savingMeta ? (
                    <Loader2
                      size={12}
                      style={{ animation: "spin 1s linear infinite" }}
                    />
                  ) : (
                    <CheckCircle size={12} />
                  )}
                  Update Metadata
                </button>

                {/* Timestamps */}
                <div style={{ marginTop: "auto" }}>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#555",
                      marginBottom: 4,
                    }}
                  >
                    Created: {new Date(detail.createdAt).toLocaleDateString()}{" "}
                    {new Date(detail.createdAt).toLocaleTimeString()}
                  </div>
                  <div style={{ fontSize: 10, color: "#555" }}>
                    Updated: {new Date(detail.updatedAt).toLocaleDateString()}{" "}
                    {new Date(detail.updatedAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Spin keyframe (injected once) */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
