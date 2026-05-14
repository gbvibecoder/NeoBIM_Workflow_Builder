"use client";

/**
 * Z.CANVAS.SCHEMA Phase 6 — Sticky comment note on canvas.
 * Yellow note aesthetic (same in both themes — intentional cross-theme choice).
 */

import { memo } from "react";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import type { CanvasComment } from "@/features/canvas/stores/canvas-comments-store";

function initials(name: string | null, email: string): string {
  const src = name || email;
  return src.split(/[\s@]/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

interface StickyNoteProps {
  comment: CanvasComment;
  isActive: boolean;
  onClick: () => void;
}

export const StickyNote = memo(function StickyNote({ comment, isActive, onClick }: StickyNoteProps) {
  const { theme } = useCanvasTheme();
  const tk = useCanvasToken();
  const isResolved = !!comment.resolvedAt;
  const truncated = comment.body.length > 80 ? comment.body.slice(0, 80) + "\u2026" : comment.body;

  return (
          <div
        onClick={onClick}
        style={{
          position: "absolute",
          left: comment.positionX,
          top: comment.positionY,
          width: 200,
          background: tk.stickyBg,
          border: `1px solid ${tk.stickyBorder}`,
          borderRadius: 6,
          boxShadow: tk.shadowMd,
          padding: "10px 12px",
          transform: "rotate(-1.5deg)",
          cursor: "pointer",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
          zIndex: isActive ? 30 : 10,
          opacity: isResolved ? 0.6 : 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "rotate(-1.5deg) scale(1.02)";
          e.currentTarget.style.boxShadow = tk.shadowLg;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "rotate(-1.5deg) scale(1)";
          e.currentTarget.style.boxShadow = tk.shadowMd;
        }}
      >
        {/* Resolved overlay */}
        {isResolved && (
          <div style={{
            position: "absolute", inset: 0, borderRadius: 6,
            background: tk.stickyResolved,
            pointerEvents: "none",
          }} />
        )}

        {/* Header: avatar + name + time */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <div style={{
            width: 18, height: 18, borderRadius: "50%",
            background: "linear-gradient(135deg, #C7D2FE, #A5B4FC)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 600, color: "#3730A3",
            flexShrink: 0,
          }}>
            {initials(comment.author.name, comment.author.email)}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 500,
            color: tk.stickyTextMeta,
            flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {comment.author.name || comment.author.email.split("@")[0]}
          </span>
          <span style={{
            fontSize: 9, color: tk.stickyTextMeta,
            fontFamily: "var(--font-jetbrains), monospace",
            flexShrink: 0,
          }}>
            {relativeTime(comment.createdAt)}
          </span>
        </div>

        {/* Body */}
        <div style={{
          fontSize: 13, fontStyle: "italic", lineHeight: 1.4,
          color: tk.stickyText,
          textDecoration: isResolved ? "line-through" : "none",
        }}>
          {truncated}
        </div>

        {/* Reply count */}
        {comment.replies && comment.replies.length > 0 && (
          <div style={{
            marginTop: 6, fontSize: 10, fontWeight: 600,
            color: tk.stickyTextMeta,
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
          </div>
        )}
      </div>
  );
});
