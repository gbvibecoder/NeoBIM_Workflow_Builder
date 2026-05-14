"use client";

/**
 * Z.CANVAS.SCHEMA Phase 7 — Comment thread modal.
 * Shows full comment + replies + add reply input.
 */

import React, { memo, useState, useCallback, useRef, useEffect } from "react";
import { X, Check, RotateCcw } from "lucide-react";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import type { CanvasComment } from "@/features/canvas/stores/canvas-comments-store";
import {
  useCanvasComments,
  selectResolveComment,
  selectAddReply,
  selectSetActiveComment,
  selectDeleteComment,
} from "@/features/canvas/stores/canvas-comments-store";
import { MentionPopover, type MentionUser } from "@/features/canvas/components/collab/MentionPopover";

function initials(name: string | null, email: string): string {
  const src = name || email;
  return src.split(/[\s@]/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface CommentThreadProps {
  comment: CanvasComment;
  collaborators?: MentionUser[];
}

export const CommentThread = memo(function CommentThread({ comment, collaborators = [] }: CommentThreadProps) {
  const { theme } = useCanvasTheme();
  const tk = useCanvasToken();
  const resolveComment = useCanvasComments(selectResolveComment);
  const addReply = useCanvasComments(selectAddReply);
  const setActiveComment = useCanvasComments(selectSetActiveComment);
  const deleteComment = useCanvasComments(selectDeleteComment);
  const [replyText, setReplyText] = useState("");
  const [replyMentions, setReplyMentions] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isResolved = !!comment.resolvedAt;

  // Mention autocomplete state
  const [mentionState, setMentionState] = useState<{
    triggerIndex: number;
    query: string;
    activeIndex: number;
  } | null>(null);

  const filteredUsers = mentionState
    ? collaborators.filter((u) => {
        const q = mentionState.query.toLowerCase();
        return (u.name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      })
    : [];

  const insertMention = useCallback((user: MentionUser) => {
    if (!mentionState) return;
    const before = replyText.slice(0, mentionState.triggerIndex);
    const after = replyText.slice(mentionState.triggerIndex + mentionState.query.length + 1);
    const displayName = user.name || user.email.split("@")[0];
    setReplyText(before + `@${displayName} ` + after);
    setReplyMentions((prev) => [...prev, user.id]);
    setMentionState(null);
  }, [mentionState, replyText]);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const handleReply = useCallback(() => {
    if (!replyText.trim()) return;
    addReply(comment.id, replyText.trim(), replyMentions.length > 0 ? replyMentions : undefined);
    setReplyText("");
    setReplyMentions([]);
  }, [replyText, replyMentions, addReply, comment.id]);

  const handleReplyChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setReplyText(val);
    const caretPos = e.target.selectionStart ?? val.length;
    const before = val.slice(0, caretPos);
    const atMatch = before.match(/@(\w*)$/);
    if (atMatch && collaborators.length > 0) {
      setMentionState({ triggerIndex: caretPos - atMatch[1].length - 1, query: atMatch[1], activeIndex: 0 });
    } else {
      setMentionState(null);
    }
  }, [collaborators.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    // Mention navigation
    if (mentionState && filteredUsers.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionState((s) => s ? { ...s, activeIndex: (s.activeIndex + 1) % filteredUsers.length } : s); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionState((s) => s ? { ...s, activeIndex: (s.activeIndex - 1 + filteredUsers.length) % filteredUsers.length } : s); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredUsers[mentionState.activeIndex]); return; }
      if (e.key === "Escape") { setMentionState(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleReply();
    }
    if (e.key === "Escape") {
      setActiveComment(null);
    }
  }, [handleReply, setActiveComment, mentionState, filteredUsers, insertMention]);

  return (
    <>
          {/* Backdrop */}
      <div
        onClick={() => setActiveComment(null)}
        style={{ position: "fixed", inset: 0, zIndex: 49 }}
      />

      {/* Thread modal */}
      <div
        style={{
          position: "absolute",
          left: comment.positionX + 216,
          top: comment.positionY,
          width: 360,
          maxHeight: 480,
          background: tk.threadBg,
          border: `1px solid ${tk.threadBorder}`,
          borderRadius: 14,
          boxShadow: tk.threadShadow,
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "linear-gradient(135deg, #C7D2FE, #A5B4FC)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 600, color: "#3730A3",
          }}>
            {initials(comment.author.name, comment.author.email)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: tk.text1 }}>
              {comment.author.name || comment.author.email.split("@")[0]}
            </div>
            <div style={{ fontSize: 10, color: tk.text3, fontFamily: "var(--font-jetbrains), monospace" }}>
              {relativeTime(comment.createdAt)}
            </div>
          </div>
          <button
            onClick={() => resolveComment(comment.id)}
            title={isResolved ? "Re-open" : "Resolve"}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "4px 10px", borderRadius: 6, border: 0,
              background: isResolved ? tk.hoverBg : "rgba(5,150,105,0.10)",
              color: isResolved ? tk.text3 : "#059669",
              fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}
          >
            {isResolved ? <RotateCcw size={12} /> : <Check size={12} />}
            {isResolved ? "Re-open" : "Resolve"}
          </button>
          <button
            onClick={() => setActiveComment(null)}
            style={{
              width: 24, height: 24, borderRadius: 6, border: 0,
              background: "transparent", color: tk.text3,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Root comment body */}
        <div style={{ padding: "0 16px 12px", fontSize: 14, lineHeight: 1.5, color: tk.text1 }}>
          {comment.body}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: tk.threadDivider, margin: "0 16px" }} />

        {/* Replies */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
          {(comment.replies ?? []).map((reply) => (
            <div key={reply.id} style={{ display: "flex", gap: 8, padding: "8px 0" }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%",
                background: "linear-gradient(135deg, #C7D2FE, #A5B4FC)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8, fontWeight: 600, color: "#3730A3", flexShrink: 0,
              }}>
                {initials(reply.author.name, reply.author.email)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: tk.text1 }}>
                    {reply.author.name || reply.author.email.split("@")[0]}
                  </span>
                  <span style={{ fontSize: 10, color: tk.text3, fontFamily: "var(--font-jetbrains), monospace" }}>
                    {relativeTime(reply.createdAt)}
                  </span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.4, color: tk.text2, marginTop: 2 }}>
                  {reply.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Reply input */}
        <div style={{
          padding: "10px 16px 14px",
          borderTop: `1px solid ${tk.threadDivider}`,
          display: "flex", gap: 8, alignItems: "flex-end",
          position: "relative",
        }}>
          {/* Mention popover */}
          {mentionState && collaborators.length > 0 && (
            <MentionPopover
              users={collaborators}
              query={mentionState.query}
              activeIndex={mentionState.activeIndex}
              onSelect={insertMention}
            />
          )}
          <textarea
            ref={textareaRef}
            className="nodrag nowheel nopan"
            role="combobox"
            aria-expanded={!!mentionState}
            value={replyText}
            onChange={handleReplyChange}
            onKeyDown={handleKeyDown}
            placeholder="Add a reply\u2026"
            rows={1}
            style={{
              flex: 1, resize: "none",
              padding: "8px 10px", borderRadius: 8,
              background: tk.threadInputBg,
              border: `1px solid ${tk.threadInputBorder}`,
              color: tk.text1,
              fontSize: 13, lineHeight: 1.4,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleReply}
            disabled={!replyText.trim()}
            style={{
              padding: "6px 14px", borderRadius: 8, border: 0,
              background: replyText.trim() ? "#2563EB" : tk.hoverBg,
              color: replyText.trim() ? "#FFFFFF" : tk.text3,
              fontSize: 12, fontWeight: 600, cursor: replyText.trim() ? "pointer" : "default",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
});
