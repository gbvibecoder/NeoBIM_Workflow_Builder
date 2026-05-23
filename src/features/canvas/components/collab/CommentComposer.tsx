"use client";

/**
 * Z.CANVAS.SCHEMA Phase 8 + Z.CANVAS.COLLAB-COMPLETE Gap 4.
 * Comment composer with @mention autocomplete.
 */

import React, { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import {
  useCanvasComments,
  selectCreateComment,
  selectSetComposerPosition,
} from "@/features/canvas/stores/canvas-comments-store";
import { MentionPopover, type MentionUser } from "@/features/canvas/components/collab/MentionPopover";

interface CommentComposerProps {
  workflowId: string;
  position: { x: number; y: number };
  collaborators?: MentionUser[];
}

export const CommentComposer = memo(function CommentComposer({ workflowId, position, collaborators = [] }: CommentComposerProps) {
  const { theme } = useCanvasTheme();
  const tk = useCanvasToken();
  const createComment = useCanvasComments(selectCreateComment);
  const setComposerPosition = useCanvasComments(selectSetComposerPosition);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mention state
  const [mentionState, setMentionState] = useState<{
    triggerIndex: number;
    query: string;
    activeIndex: number;
  } | null>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const handlePost = useCallback(() => {
    if (!text.trim()) return;
    createComment(workflowId, position, text.trim(), mentions.length > 0 ? mentions : undefined);
    setText("");
    setMentions([]);
  }, [text, mentions, workflowId, position, createComment]);

  const handleCancel = useCallback(() => {
    setComposerPosition(null);
    setText("");
    setMentions([]);
  }, [setComposerPosition]);

  const filteredUsers = useMemo(
    () =>
      mentionState
        ? collaborators.filter((u) => {
            const q = mentionState.query.toLowerCase();
            return (u.name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
          })
        : [],
    [mentionState, collaborators],
  );

  const insertMention = useCallback((user: MentionUser) => {
    if (!mentionState) return;
    const before = text.slice(0, mentionState.triggerIndex);
    const after = text.slice(mentionState.triggerIndex + mentionState.query.length + 1);
    const displayName = user.name || user.email.split("@")[0];
    setText(before + `@${displayName} ` + after);
    setMentions((prev) => [...prev, user.id]);
    setMentionState(null);
  }, [mentionState, text]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    const caretPos = e.target.selectionStart ?? val.length;
    const before = val.slice(0, caretPos);
    const atMatch = before.match(/@(\w*)$/);
    if (atMatch && collaborators.length > 0) {
      setMentionState({
        triggerIndex: caretPos - atMatch[1].length - 1,
        query: atMatch[1],
        activeIndex: 0,
      });
    } else {
      setMentionState(null);
    }
  }, [collaborators.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();

    // Mention navigation
    if (mentionState && filteredUsers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionState((s) => s ? { ...s, activeIndex: (s.activeIndex + 1) % filteredUsers.length } : s);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionState((s) => s ? { ...s, activeIndex: (s.activeIndex - 1 + filteredUsers.length) % filteredUsers.length } : s);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredUsers[mentionState.activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        setMentionState(null);
        return;
      }
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePost();
    }
    if (e.key === "Escape") {
      handleCancel();
    }
  }, [handlePost, handleCancel, mentionState, filteredUsers, insertMention]);

  return (
          <div
        style={{
          position: "absolute",
          left: position.x,
          top: position.y,
          width: 220,
          background: tk.stickyBg,
          border: `1px solid ${tk.stickyBorder}`,
          borderRadius: 6,
          boxShadow: tk.shadowLg,
          padding: "10px 12px",
          transform: "rotate(-1.5deg)",
          zIndex: 40,
        }}
      >
        {/* Textarea with relative positioning for popover */}
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            className="nodrag nowheel nopan"
            role="combobox"
            aria-expanded={!!mentionState}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Add a comment\u2026"
            rows={3}
            style={{
              width: "100%",
              resize: "none",
              boxSizing: "border-box",
              padding: "6px 8px",
              background: "rgba(255,255,255,0.4)",
              border: "1px solid rgba(180,83,9,0.15)",
              borderRadius: 4,
              color: tk.stickyText,
              fontSize: 13,
              fontStyle: "italic",
              lineHeight: 1.4,
              outline: "none",
              fontFamily: "inherit",
            }}
          />

          {/* Mention popover */}
          {mentionState && collaborators.length > 0 && (
            <MentionPopover
              users={collaborators}
              query={mentionState.query}
              activeIndex={mentionState.activeIndex}
              onSelect={insertMention}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
          <button
            onClick={handleCancel}
            style={{
              padding: "4px 10px", borderRadius: 4, border: 0,
              background: "rgba(0,0,0,0.06)",
              color: tk.stickyTextMeta,
              fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handlePost}
            disabled={!text.trim()}
            style={{
              padding: "4px 12px", borderRadius: 4, border: 0,
              background: text.trim() ? "#B45309" : "rgba(0,0,0,0.08)",
              color: text.trim() ? "#FFFFFF" : tk.stickyTextMeta,
              fontSize: 11, fontWeight: 600, cursor: text.trim() ? "pointer" : "default",
            }}
          >
            Post
          </button>
        </div>
      </div>
  );
});
