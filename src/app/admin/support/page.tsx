"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, ChevronDown, ChevronLeft, ChevronRight,
  Bug, Lightbulb, Sparkles, X, ExternalLink, Image as ImageIcon,
  Loader2, Inbox, Clock, CheckCircle2, Download, MessagesSquare, BarChart3, Reply,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import dynamic from "next/dynamic";

const SupportConversations = dynamic(() => import("@/features/admin/components/SupportConversations"), { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>Loading conversations…</div> });
const SupportAnalytics = dynamic(() => import("@/features/admin/components/SupportAnalytics"), { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>Loading analytics…</div> });
const SupportQuickReplies = dynamic(() => import("@/features/admin/components/SupportQuickReplies"), { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>Loading quick replies…</div> });

// ─── Types ──────────────────────────────────────────────────────────────
type FeedbackType = "BUG" | "FEATURE" | "SUGGESTION";
type FeedbackStatus = "NEW" | "REVIEWING" | "PLANNED" | "IN_PROGRESS" | "DONE" | "DECLINED";

interface FeedbackUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface FeedbackItem {
  id: string;
  title: string;
  description: string;
  type: FeedbackType;
  status: FeedbackStatus;
  category: string | null;
  screenshotUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  user: FeedbackUser;
}

interface FeedbackResponse {
  items: FeedbackItem[];
  total: number;
  page: number;
  totalPages: number;
  statusCounts: Record<string, number>;
}

// ─── Constants ──────────────────────────────────────────────────────────
const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  NEW: "#00F5FF",
  REVIEWING: "#4F8AFF",
  PLANNED: "#8B5CF6",
  IN_PROGRESS: "#FFBF00",
  DONE: "#34D399",
  DECLINED: "#6B7280",
};

const TYPE_COLORS: Record<FeedbackType, string> = {
  BUG: "#F87171",
  FEATURE: "#4F8AFF",
  SUGGESTION: "#FBBF24",
};

const TYPE_ICONS: Record<FeedbackType, React.ReactNode> = {
  BUG: <Bug size={11} />,
  FEATURE: <Lightbulb size={11} />,
  SUGGESTION: <Sparkles size={11} />,
};

const STATUS_KEYS: FeedbackStatus[] = ["NEW", "REVIEWING", "PLANNED", "IN_PROGRESS", "DONE", "DECLINED"];

// ─── Helpers ────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }) + " " + d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function getUserInitials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

// ─── Loading Skeleton ───────────────────────────────────────────────────
function ListSkeleton() {
  return (
    <div style={{ padding: 0 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div
              className="skeleton-pulse"
              style={{
                width: `${50 + (i * 7) % 30}%`,
                height: 14,
                borderRadius: 6,
                background: "rgba(255,255,255,0.04)",
              }}
            />
            <div
              className="skeleton-pulse"
              style={{
                width: 50,
                height: 10,
                borderRadius: 4,
                background: "rgba(255,255,255,0.03)",
              }}
            />
          </div>
          <div
            className="skeleton-pulse"
            style={{
              width: 80,
              height: 10,
              borderRadius: 4,
              background: "rgba(255,255,255,0.03)",
              marginBottom: 10,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <div className="skeleton-pulse" style={{ width: 56, height: 20, borderRadius: 6, background: "rgba(255,255,255,0.03)" }} />
            <div className="skeleton-pulse" style={{ width: 56, height: 20, borderRadius: 6, background: "rgba(255,255,255,0.03)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Type Badge ─────────────────────────────────────────────────────────
function TypeBadge({ type, label }: { type: FeedbackType; label: string }) {
  const color = TYPE_COLORS[type];
  const icon = TYPE_ICONS[type];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        background: `${color}14`,
        border: `1px solid ${color}22`,
      }}
    >
      <span style={{ color, display: "flex" }}>{icon}</span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          fontFamily: "var(--font-jetbrains), monospace",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────
function StatusBadge({ status, label }: { status: FeedbackStatus; label: string }) {
  const color = STATUS_COLORS[status];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 6,
        background: `${color}14`,
        border: `1px solid ${color}22`,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}66`,
        }}
      />
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color,
          fontFamily: "var(--font-jetbrains), monospace",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Feedback List Item ─────────────────────────────────────────────────
function FeedbackListItem({
  item,
  isActive,
  onClick,
  index,
  typeLabel,
  statusLabel,
  anonymousLabel,
}: {
  item: FeedbackItem;
  isActive: boolean;
  onClick: () => void;
  index: number;
  typeLabel: string;
  statusLabel: string;
  anonymousLabel: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.08 + index * 0.025, duration: 0.35, ease: smoothEase }}
      onClick={onClick}
      className="feedback-list-item"
      style={{
        padding: "14px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        cursor: "pointer",
        background: isActive ? "rgba(0,245,255,0.04)" : "transparent",
        borderLeft: isActive ? "2px solid #00F5FF" : "2px solid transparent",
        transition: "background 0.2s, border-left 0.2s",
      }}
      whileHover={{
        background: isActive ? "rgba(0,245,255,0.06)" : "rgba(255,255,255,0.02)",
      }}
    >
      {/* Row 1: Type badge + Time */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <TypeBadge type={item.type} label={typeLabel} />
        <span
          style={{
            fontSize: 9,
            color: "#5C5C78",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          {timeAgo(item.createdAt)}
        </span>
      </div>

      {/* Row 2: Title */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#F0F0F5",
          lineHeight: 1.4,
          marginBottom: 6,
          fontFamily: "var(--font-dm-sans), sans-serif",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {item.title}
      </div>

      {/* Row 3: User + Status */}
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
            fontSize: 11,
            color: "#9898B0",
            fontFamily: "var(--font-dm-sans), sans-serif",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.user.name || anonymousLabel}
        </span>
        <StatusBadge status={item.status} label={statusLabel} />
      </div>
    </motion.div>
  );
}

// ─── Status Dropdown ────────────────────────────────────────────────────
function StatusDropdown({
  currentStatus,
  onChangeStatus,
  isUpdating,
  statusLabels,
}: {
  currentStatus: FeedbackStatus;
  onChangeStatus: (s: FeedbackStatus) => void;
  isUpdating: boolean;
  statusLabels: Record<string, string>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const color = STATUS_COLORS[currentStatus];
  const label = statusLabels[currentStatus] || currentStatus;

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isUpdating}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 14px",
          borderRadius: 10,
          background: `${color}14`,
          border: `1px solid ${color}22`,
          color,
          cursor: isUpdating ? "wait" : "pointer",
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "var(--font-jetbrains), monospace",
          opacity: isUpdating ? 0.6 : 1,
          transition: "opacity 0.2s",
        }}
      >
        {isUpdating ? (
          <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
        ) : (
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: color,
              boxShadow: `0 0 6px ${color}66`,
            }}
          />
        )}
        <span>{label}</span>
        <ChevronDown
          size={12}
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.15, ease: smoothEase }}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              background: "rgba(10,12,14,0.97)",
              backdropFilter: "blur(24px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: 4,
              minWidth: 170,
              zIndex: 100,
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            }}
          >
            {STATUS_KEYS.map((s) => {
              const sc = STATUS_COLORS[s];
              const isActive = s === currentStatus;
              return (
                <button
                  key={s}
                  onClick={() => {
                    onChangeStatus(s);
                    setIsOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: sc,
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: "var(--font-jetbrains), monospace",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(255,255,255,0.05)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = isActive
                      ? "rgba(255,255,255,0.04)"
                      : "transparent")
                  }
                >
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: sc,
                      boxShadow: `0 0 6px ${sc}44`,
                    }}
                  />
                  <span>{statusLabels[s] || s}</span>
                  {isActive && (
                    <CheckCircle2 size={10} style={{ marginLeft: "auto", opacity: 0.7 }} />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────────────
function FeedbackDetail({
  item,
  onClose,
  onStatusChange,
  isOverlay,
  isUpdating,
  statusLabels,
  typeLabels,
  labels,
}: {
  item: FeedbackItem;
  onClose: () => void;
  onStatusChange: (id: string, status: FeedbackStatus) => void;
  isOverlay: boolean;
  isUpdating: boolean;
  statusLabels: Record<string, string>;
  typeLabels: Record<string, string>;
  labels: {
    status: string;
    description: string;
    screenshot: string;
    category: string;
    anonymous: string;
  };
}) {
  const content = (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, x: isOverlay ? 0 : 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: isOverlay ? 0 : 20 }}
      transition={{ duration: 0.3, ease: smoothEase }}
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: isOverlay ? "rgba(10,12,14,0.98)" : "transparent",
        borderRadius: isOverlay ? 16 : 0,
        border: isOverlay ? "1px solid rgba(255,255,255,0.06)" : "none",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      >
        {/* Top row: close button */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ flex: 1, marginRight: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <TypeBadge type={item.type} label={typeLabels[item.type] || item.type} />
              {item.category && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: "#9898B0",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    fontFamily: "var(--font-jetbrains), monospace",
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {item.category}
                </span>
              )}
            </div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#F0F0F5",
                margin: 0,
                lineHeight: 1.35,
                fontFamily: "var(--font-syne), sans-serif",
                letterSpacing: "-0.01em",
              }}
            >
              {item.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "#5C5C78",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s, color 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.color = "#F0F0F5";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              e.currentTarget.style.color = "#5C5C78";
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* User info */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          {item.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.user.image}
              alt=""
              width={36}
              height={36}
              style={{
                borderRadius: 10,
                background: "rgba(255,255,255,0.05)",
                flexShrink: 0,
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(0,245,255,0.1)",
                border: "1px solid rgba(0,245,255,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 700,
                color: "#00F5FF",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              {getUserInitials(item.user.name)}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#F0F0F5",
                fontFamily: "var(--font-dm-sans), sans-serif",
              }}
            >
              {item.user.name || labels.anonymous}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#5C5C78",
                fontFamily: "var(--font-jetbrains), monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.user.email || "No email"}
            </div>
          </div>
        </div>

        {/* Status row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "#5C5C78",
                textTransform: "uppercase",
                letterSpacing: "1px",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              {labels.status}
            </span>
          </div>
          <StatusDropdown
            currentStatus={item.status}
            onChangeStatus={(s) => onStatusChange(item.id, s)}
            isUpdating={isUpdating}
            statusLabels={statusLabels}
          />
        </div>
      </div>

      {/* Body: scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px",
        }}
      >
        {/* Description */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "#5C5C78",
              textTransform: "uppercase",
              letterSpacing: "1px",
              fontFamily: "var(--font-jetbrains), monospace",
              marginBottom: 8,
            }}
          >
            {labels.description}
          </div>
          <p
            style={{
              fontSize: 13,
              color: "#9898B0",
              lineHeight: 1.7,
              margin: 0,
              fontFamily: "var(--font-dm-sans), sans-serif",
              whiteSpace: "pre-wrap",
            }}
          >
            {item.description || "No description provided."}
          </p>
        </div>

        {/* Screenshot */}
        {item.screenshotUrl && (
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "#5C5C78",
                textTransform: "uppercase",
                letterSpacing: "1px",
                fontFamily: "var(--font-jetbrains), monospace",
                marginBottom: 8,
              }}
            >
              {labels.screenshot}
            </div>
            <a
              href={item.screenshotUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 10,
                background: "rgba(0,245,255,0.06)",
                border: "1px solid rgba(0,245,255,0.12)",
                color: "#00F5FF",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-jetbrains), monospace",
                textDecoration: "none",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(0,245,255,0.1)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "rgba(0,245,255,0.06)")
              }
            >
              <ImageIcon size={12} />
              View Screenshot
              <ExternalLink size={10} style={{ opacity: 0.6 }} />
            </a>
          </div>
        )}

        {/* Metadata */}
        {item.metadata && Object.keys(item.metadata).length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "#5C5C78",
                textTransform: "uppercase",
                letterSpacing: "1px",
                fontFamily: "var(--font-jetbrains), monospace",
                marginBottom: 8,
              }}
            >
              Metadata
            </div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 11,
                color: "#9898B0",
                lineHeight: 1.6,
                overflowX: "auto",
              }}
            >
              {Object.entries(item.metadata).map(([key, val]) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    gap: 8,
                    padding: "4px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.02)",
                  }}
                >
                  <span style={{ color: "#5C5C78", minWidth: 100, flexShrink: 0 }}>{key}</span>
                  <span style={{ color: "#F0F0F5", wordBreak: "break-all" }}>
                    {typeof val === "object" ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div>
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "#5C5C78",
              textTransform: "uppercase",
              letterSpacing: "1px",
              fontFamily: "var(--font-jetbrains), monospace",
              marginBottom: 8,
            }}
          >
            Timeline
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Clock size={11} style={{ color: "#5C5C78" }} />
              <span
                style={{
                  fontSize: 11,
                  color: "#5C5C78",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                Created
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "#9898B0",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {formatDate(item.createdAt)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "#5C5C78",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                ({timeAgo(item.createdAt)})
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Clock size={11} style={{ color: "#5C5C78" }} />
              <span
                style={{
                  fontSize: 11,
                  color: "#5C5C78",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                Updated
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "#9898B0",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {formatDate(item.updatedAt)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "#5C5C78",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                ({timeAgo(item.updatedAt)})
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  if (isOverlay) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.25, ease: smoothEase }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(90vw, 700px)",
            maxWidth: 700,
            height: "min(85vh, 700px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {content}
        </motion.div>
      </motion.div>
    );
  }

  return content;
}

// ─── Page ───────────────────────────────────────────────────────────────
// ─── Tab Wrapper ────────────────────────────────────────────────────────────

const SUPPORT_TABS = [
  { key: "feedback", label: "Feedback", icon: MessageSquare },
  { key: "conversations", label: "Conversations", icon: MessagesSquare },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "quickReplies", label: "Quick Replies", icon: Reply },
] as const;

type SupportTab = (typeof SUPPORT_TABS)[number]["key"];

export default function AdminSupportPage() {
  const [activeTab, setActiveTab] = useState<SupportTab>("feedback");

  return (
    <div className="admin-support-page" style={{ padding: "24px 20px 32px" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 0 }}>
        {SUPPORT_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 16px",
                fontSize: 13, fontWeight: isActive ? 600 : 500,
                color: isActive ? "#F0F0F5" : "#6B7280",
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid #4F8AFF" : "2px solid transparent",
                cursor: "pointer",
                transition: "all 0.2s",
                marginBottom: -1,
              }}
            >
              <Icon size={14} style={{ opacity: isActive ? 1 : 0.5 }} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "feedback" && <FeedbackTab />}
      {activeTab === "conversations" && <SupportConversations />}
      {activeTab === "analytics" && <SupportAnalytics />}
      {activeTab === "quickReplies" && <SupportQuickReplies />}
    </div>
  );
}

// ─── Feedback Tab (original admin support content) ──────────────────────────

function FeedbackTab() {
  const { t } = useLocale();
  const [data, setData] = useState<FeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "ALL">("ALL");
  const [typeFilter, setTypeFilter] = useState<FeedbackType | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const limit = 20;

  // ── i18n label maps ──
  const STATUS_LABELS: Record<string, string> = {
    ALL: t('admin.support.all'),
    NEW: t('admin.support.new'),
    REVIEWING: t('admin.support.reviewing'),
    PLANNED: t('admin.support.planned'),
    IN_PROGRESS: t('admin.support.inProgress'),
    DONE: t('admin.support.done'),
    DECLINED: t('admin.support.declined'),
  };

  const TYPE_LABELS: Record<string, string> = {
    ALL: t('admin.support.all'),
    BUG: t('admin.support.bug'),
    FEATURE: t('admin.support.feature'),
    SUGGESTION: t('admin.support.suggestion'),
  };

  const STATUS_TABS: { key: FeedbackStatus | "ALL"; label: string }[] = [
    { key: "ALL", label: STATUS_LABELS.ALL },
    ...STATUS_KEYS.map((k) => ({ key: k, label: STATUS_LABELS[k] })),
  ];

  const TYPE_TABS: { key: FeedbackType | "ALL"; label: string }[] = [
    { key: "ALL", label: TYPE_LABELS.ALL },
    { key: "BUG", label: TYPE_LABELS.BUG },
    { key: "FEATURE", label: TYPE_LABELS.FEATURE },
    { key: "SUGGESTION", label: TYPE_LABELS.SUGGESTION },
  ];

  async function downloadExport(type: string) {
    if (exportingType) return;
    setExportingType(type);
    try {
      const res = await fetch(`/api/admin/export?type=${type}`);
      if (!res.ok) throw new Error(`Export failed`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`Failed to export ${type}:`, err);
    } finally {
      setExportingType(null);
    }
  }

  useEffect(() => {
    const checkWidth = () => setIsMobile(window.innerWidth < 1024);
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  // ── Fetch feedback ──
  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      params.set("page", String(page));
      params.set("limit", String(limit));

      const res = await fetch(`/api/admin/feedback?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
      const json: FeedbackResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, page]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter]);

  // ── Status change ──
  const handleStatusChange = useCallback(
    async (id: string, newStatus: FeedbackStatus) => {
      setUpdatingId(id);
      try {
        const res = await fetch(`/api/admin/feedback/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error("Failed to update status");
        await fetchFeedback();
      } catch {
        // Silently fail, could add toast here
      } finally {
        setUpdatingId(null);
      }
    },
    [fetchFeedback],
  );

  const selectedItem = data?.items.find((i) => i.id === selectedId) ?? null;
  const totalCount = data?.total ?? 0;
  const statusCounts = data?.statusCounts ?? {};

  return (
    <div className="admin-support-page" style={{ padding: "24px 28px 48px", maxWidth: 1440, margin: "0 auto" }}>
      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: smoothEase }}
        className="support-header"
        style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <MessageSquare size={14} style={{ color: "#00F5FF", opacity: 0.7 }} />
            <span
              style={{
                fontSize: 9,
                color: "#00F5FF",
                fontWeight: 600,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              Feedback Management
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "#F0F0F5",
                margin: 0,
                fontFamily: "var(--font-syne), sans-serif",
                letterSpacing: "-0.02em",
              }}
            >
              {t('admin.support.title')}
            </h1>
            {!loading && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{
                  fontSize: 13,
                  color: "#5C5C78",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {totalCount} total
              </motion.span>
            )}
          </div>
        </div>
        <div className="support-export-btn" style={{ flexShrink: 0, marginTop: 4 }}>
          <button
            onClick={() => downloadExport("feedback")}
            disabled={!!exportingType}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(0,245,255,0.2)",
              background: "rgba(0,245,255,0.06)",
              color: "#00F5FF",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "var(--font-jetbrains), monospace",
              cursor: exportingType ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "background 0.2s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (!exportingType) (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,245,255,0.12)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,245,255,0.06)";
            }}
          >
            {exportingType === "feedback" ? (
              <span
                style={{
                  width: 13,
                  height: 13,
                  border: "2px solid rgba(0,245,255,0.3)",
                  borderTopColor: "#00F5FF",
                  borderRadius: "50%",
                  animation: "csvSpinner 0.6s linear infinite",
                  display: "inline-block",
                }}
              />
            ) : (
              <Download size={13} />
            )}
            {t('admin.support.exportFeedback')} CSV
          </button>
        </div>
      </motion.div>

      {/* ── Status Filter Tabs ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4, ease: smoothEase }}
        style={{ marginBottom: 12 }}
      >
        <div
          className="feedback-status-tabs support-filters"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            overflowX: "auto",
            paddingBottom: 4,
            flexWrap: "wrap",
          }}
        >
          {STATUS_TABS.map((tab) => {
            const isActive = statusFilter === tab.key;
            const tabColor =
              tab.key === "ALL"
                ? "#F0F0F5"
                : STATUS_COLORS[tab.key as FeedbackStatus] ?? "#F0F0F5";
            const count =
              tab.key === "ALL"
                ? totalCount
                : statusCounts[tab.key] ?? 0;

            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key as FeedbackStatus | "ALL")}
                className="support-filter-btn"
                style={{
                  padding: "7px 14px",
                  borderRadius: 10,
                  background: isActive ? `${tabColor}16` : "transparent",
                  border: isActive
                    ? `1px solid ${tabColor}28`
                    : "1px solid transparent",
                  color: isActive ? tabColor : "#5C5C78",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                  whiteSpace: "nowrap",
                  transition: "background 0.15s, border-color 0.15s, color 0.15s",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                {tab.label}
                <span
                  style={{
                    fontSize: 9,
                    opacity: 0.7,
                    padding: "1px 5px",
                    borderRadius: 4,
                    background: isActive
                      ? `${tabColor}18`
                      : "rgba(255,255,255,0.04)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* ── Type Filter Tabs ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4, ease: smoothEase }}
        style={{ marginBottom: 16 }}
      >
        <div
          className="support-filters"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "#5C5C78",
              textTransform: "uppercase",
              letterSpacing: "1px",
              fontFamily: "var(--font-jetbrains), monospace",
              marginRight: 6,
            }}
          >
            {t('admin.support.type')}
          </span>
          {TYPE_TABS.map((tab) => {
            const isActive = typeFilter === tab.key;
            const tabColor =
              tab.key === "ALL"
                ? "#9898B0"
                : TYPE_COLORS[tab.key as FeedbackType] ?? "#9898B0";

            return (
              <button
                key={tab.key}
                onClick={() => setTypeFilter(tab.key as FeedbackType | "ALL")}
                className="support-filter-btn"
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  background: isActive ? `${tabColor}14` : "transparent",
                  border: isActive
                    ? `1px solid ${tabColor}22`
                    : "1px solid transparent",
                  color: isActive ? tabColor : "#5C5C78",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                  whiteSpace: "nowrap",
                  transition: "background 0.15s, border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* ── Error State ── */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            padding: "14px 18px",
            borderRadius: 14,
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.15)",
            color: "#F87171",
            fontSize: 13,
            fontFamily: "var(--font-dm-sans), sans-serif",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Bug size={16} />
          <span>Failed to load feedback: {error}</span>
          <button
            onClick={fetchFeedback}
            style={{
              marginLeft: "auto",
              padding: "5px 12px",
              borderRadius: 8,
              background: "rgba(248,113,113,0.12)",
              border: "1px solid rgba(248,113,113,0.2)",
              color: "#F87171",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            Retry
          </button>
        </motion.div>
      )}

      {/* ── Main Split Layout ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.45, ease: smoothEase }}
        className="feedback-main-layout"
        style={{
          display: "flex",
          gap: 0,
          background: "rgba(18,18,30,0.6)",
          backdropFilter: "blur(16px) saturate(1.3)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14,
          overflow: "hidden",
          height: "calc(100vh - 340px)",
          minHeight: 500,
        }}
      >
        {/* Left: List (40%) */}
        <div
          className="feedback-list-panel"
          style={{
            width: isMobile ? "100%" : "40%",
            borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.04)",
            overflowY: "auto",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {loading ? (
            <ListSkeleton />
          ) : !data || data.items.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "80px 24px",
                color: "#5C5C78",
                flex: 1,
              }}
            >
              <Inbox size={40} style={{ marginBottom: 16, opacity: 0.25 }} />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#9898B0",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  marginBottom: 4,
                  textAlign: "center",
                }}
              >
                {t('admin.support.noFeedback')}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "#5C5C78",
                  fontFamily: "var(--font-jetbrains), monospace",
                  textAlign: "center",
                }}
              >
                {t('admin.support.subtitle')}
              </span>
            </div>
          ) : (
            <>
              <div style={{ flex: 1 }}>
                {data.items.map((item, i) => (
                  <FeedbackListItem
                    key={item.id}
                    item={item}
                    isActive={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                    index={i}
                    typeLabel={TYPE_LABELS[item.type] || item.type}
                    statusLabel={STATUS_LABELS[item.status] || item.status}
                    anonymousLabel={t('admin.support.anonymous')}
                  />
                ))}
              </div>

              {/* Pagination */}
              {data.totalPages > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "12px 16px",
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                    flexShrink: 0,
                  }}
                >
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: page <= 1 ? "#5C5C78" : "#9898B0",
                      cursor: page <= 1 ? "default" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: page <= 1 ? 0.4 : 1,
                      transition: "opacity 0.15s",
                    }}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#9898B0",
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {t('admin.page')} {page} {t('admin.of')} {data.totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                    disabled={page >= data.totalPages}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: page >= data.totalPages ? "#5C5C78" : "#9898B0",
                      cursor: page >= data.totalPages ? "default" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: page >= data.totalPages ? 0.4 : 1,
                      transition: "opacity 0.15s",
                    }}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Detail (60%) */}
        {!isMobile && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <AnimatePresence mode="wait">
              {selectedItem ? (
                <FeedbackDetail
                  key={selectedItem.id}
                  item={selectedItem}
                  onClose={() => setSelectedId(null)}
                  onStatusChange={handleStatusChange}
                  isOverlay={false}
                  isUpdating={updatingId === selectedItem.id}
                  statusLabels={STATUS_LABELS}
                  typeLabels={TYPE_LABELS}
                  labels={{
                    status: t('admin.support.status'),
                    description: t('admin.support.description'),
                    screenshot: t('admin.support.screenshot'),
                    category: t('admin.support.category'),
                    anonymous: t('admin.support.anonymous'),
                  }}
                />
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "#5C5C78",
                  }}
                >
                  <MessageSquare
                    size={40}
                    style={{ marginBottom: 16, opacity: 0.15 }}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      fontFamily: "var(--font-dm-sans), sans-serif",
                      color: "#9898B0",
                    }}
                  >
                    {t('admin.support.feedbackDetails')}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      marginTop: 4,
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}
                  >
                    {data?.items.length ?? 0} item{(data?.items.length ?? 0) !== 1 ? "s" : ""} showing
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      {/* ── Mobile Overlay ── */}
      {isMobile && (
        <AnimatePresence>
          {selectedItem && (
            <FeedbackDetail
              key={selectedItem.id}
              item={selectedItem}
              onClose={() => setSelectedId(null)}
              onStatusChange={handleStatusChange}
              isOverlay={true}
              isUpdating={updatingId === selectedItem.id}
              statusLabels={STATUS_LABELS}
              typeLabels={TYPE_LABELS}
              labels={{
                status: t('admin.support.status'),
                description: t('admin.support.description'),
                screenshot: t('admin.support.screenshot'),
                category: t('admin.support.category'),
                anonymous: t('admin.support.anonymous'),
              }}
            />
          )}
        </AnimatePresence>
      )}

      <style>{`
        @keyframes csvSpinner {
          to { transform: rotate(360deg); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.15; }
        }
        .skeleton-pulse {
          animation: skeleton-pulse 1.5s ease-in-out infinite;
        }
        @media (max-width: 1024px) {
          .feedback-list-panel { width: 100% !important; border-right: none !important; }
          .feedback-main-layout { height: calc(100vh - 380px) !important; }
        }
        @media (max-width: 768px) {
          .admin-support-page { padding: 16px 14px 32px !important; }
          .feedback-status-tabs { flex-wrap: wrap; }
          .feedback-main-layout { height: calc(100vh - 420px) !important; min-height: 400px !important; }
          .support-filter-btn { padding: 6px 10px !important; font-size: 11px !important; }
          .support-export-btn { width: 100%; }
          .support-export-btn button { width: 100%; justify-content: center; }
        }
        @media (max-width: 640px) {
          .support-export-btn { width: 100%; }
          .support-export-btn button { width: 100%; justify-content: center; }
        }
        .feedback-list-panel::-webkit-scrollbar { width: 4px; }
        .feedback-list-panel::-webkit-scrollbar-track { background: transparent; }
        .feedback-list-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 4px; }
        .feedback-list-panel::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
