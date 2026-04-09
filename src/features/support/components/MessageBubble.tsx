"use client";

import { useState } from "react";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import { Bot, Shield } from "lucide-react";
import type { SupportMessage } from "@/types/support";

interface MessageBubbleProps {
  message: SupportMessage;
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function renderSimpleMarkdown(content: string): string {
  let html = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:rgba(79,138,255,0.15);padding:1px 5px;border-radius:4px;font-size:0.9em;font-family:monospace">$1</code>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/^[\-\*]\s+(.+)$/gm, (_, item) => {
    return `<li style="margin-left:16px;list-style:disc;margin-bottom:2px">${item}</li>`;
  });
  html = html.replace(
    /(<li[^>]*>[\s\S]*?<\/li>\n?)+/g,
    (match) => `<ul style="margin:4px 0;padding-left:8px">${match}</ul>`,
  );
  html = html.replace(/\n/g, "<br/>");

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["strong", "em", "code", "br", "ul", "li", "ol"],
    ALLOWED_ATTR: ["style"],
  });
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [isHovered, setIsHovered] = useState(false);

  const { role, content, metadata, createdAt } = message;

  // ─── SYSTEM message: centered, no bubble ───────────────────────
  if (role === "SYSTEM") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          textAlign: "center",
          padding: "8px 16px",
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "#6B7280",
            fontStyle: "italic",
          }}
        >
          {content}
        </span>
      </motion.div>
    );
  }

  const isUser = role === "USER";
  const isAdmin = role === "ADMIN";
  const isAI = role === "AI";

  const slideDirection = isUser ? 30 : -30;

  const bubbleStyle: React.CSSProperties = {
    maxWidth: "82%",
    padding: "10px 14px",
    borderRadius: 16,
    fontSize: 14,
    lineHeight: 1.55,
    color: "#F0F0F0",
    wordBreak: "break-word" as const,
    position: "relative",
    ...(isUser
      ? {
          backgroundColor: "rgba(79, 138, 255, 0.2)",
          borderBottomRightRadius: 4,
        }
      : isAdmin
        ? {
            backgroundColor: "#1A1A2E",
            border: "1px solid rgba(79, 138, 255, 0.125)",
            borderBottomLeftRadius: 4,
          }
        : {
            backgroundColor: "#1A1A2E",
            borderBottomLeftRadius: 4,
          }),
  };

  const avatarStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: isAdmin ? "rgba(79, 138, 255, 0.2)" : "rgba(79, 138, 255, 0.15)",
  };

  const labelText = isAdmin ? "Support Team" : "BuildFlow AI";
  const AvatarIcon = isAdmin ? Shield : Bot;

  const showLowConfidence =
    isAI && metadata?.confidence === "LOW";

  return (
    <motion.div
      initial={{ opacity: 0, x: slideDirection }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        padding: "2px 16px",
        position: "relative",
      }}
    >
      {/* ─── Label + Avatar for AI / ADMIN ──────────────────── */}
      {!isUser && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <div style={avatarStyle}>
            <AvatarIcon size={14} color="#4F8AFF" />
          </div>
          <span style={{ fontSize: 11, color: "#6B7280", fontWeight: 500 }}>
            {labelText}
          </span>
        </div>
      )}

      {/* ─── Bubble ─────────────────────────────────────────── */}
      <div style={bubbleStyle}>
        <div
          dangerouslySetInnerHTML={{
            __html: renderSimpleMarkdown(content),
          }}
        />

        {showLowConfidence && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "#6B7280",
              fontStyle: "italic",
            }}
          >
            (AI-generated — may not be fully accurate)
          </div>
        )}
      </div>

      {/* ─── Timestamp on hover ─────────────────────────────── */}
      <motion.div
        initial={false}
        animate={{
          opacity: isHovered ? 1 : 0,
          height: isHovered ? 18 : 0,
        }}
        transition={{ duration: 0.15 }}
        style={{
          overflow: "hidden",
          marginTop: 2,
          fontSize: 11,
          color: "#4B5563",
          paddingLeft: isUser ? 0 : 34,
          textAlign: isUser ? "right" : "left",
        }}
      >
        {formatRelativeTime(createdAt)}
      </motion.div>
    </motion.div>
  );
}
