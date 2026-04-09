"use client";

import { useRef, useCallback, KeyboardEvent, useEffect } from "react";
import { Send } from "lucide-react";
import { useSupportStore } from "@/features/support/stores/support-store";

const MAX_CHARS = 3000;
const CHAR_WARN_THRESHOLD = 2500;
const MAX_ROWS = 4;
const LINE_HEIGHT = 22;
const PADDING_Y = 20; // top + bottom padding inside textarea

interface ChatInputProps {
  conversationStatus?: string;
}

export function ChatInput({ conversationStatus }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const inputDraft = useSupportStore((s) => s.inputDraft);
  const setInputDraft = useSupportStore((s) => s.setInputDraft);
  const isSending = useSupportStore((s) => s.isSending);
  const sendMessage = useSupportStore((s) => s.sendMessage);

  const isDisabled =
    conversationStatus === "RESOLVED" || conversationStatus === "CLOSED";
  const isEmpty = inputDraft.trim().length === 0;
  const charCount = inputDraft.length;
  const showCharCount = charCount >= CHAR_WARN_THRESHOLD;
  const isOverLimit = charCount > MAX_CHARS;

  // ─── Auto-resize textarea ──────────────────────────────────
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = LINE_HEIGHT * MAX_ROWS + PADDING_Y;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY =
      el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [inputDraft, resizeTextarea]);

  // ─── Send handler ──────────────────────────────────────────
  const handleSend = useCallback(() => {
    const trimmed = inputDraft.trim();
    if (!trimmed || isSending || isDisabled || isOverLimit) return;
    sendMessage(trimmed);
  }, [inputDraft, isSending, isDisabled, isOverLimit, sendMessage]);

  // ─── Key handler ───────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ─── Change handler ────────────────────────────────────────
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= MAX_CHARS + 100) {
        setInputDraft(value);
      }
    },
    [setInputDraft],
  );

  // ─── Disabled state ────────────────────────────────────────
  if (isDisabled) {
    return (
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid rgba(107, 114, 128, 0.15)",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: "#6B7280",
            fontStyle: "italic",
          }}
        >
          This conversation has been{" "}
          {conversationStatus === "RESOLVED" ? "resolved" : "closed"}.
          Start a new conversation to continue.
        </span>
      </div>
    );
  }

  const sendButtonDisabled = isEmpty || isSending || isOverLimit;

  return (
    <div
      style={{
        borderTop: "1px solid rgba(107, 114, 128, 0.15)",
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        {/* ─── Textarea ───────────────────────────────────── */}
        <label htmlFor="support-chat-input" className="sr-only">
          Type your message
        </label>
        <textarea
          id="support-chat-input"
          aria-label="Type your message"
          ref={textareaRef}
          value={inputDraft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          disabled={isSending}
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            border: "1px solid rgba(107, 114, 128, 0.25)",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 14,
            lineHeight: `${LINE_HEIGHT}px`,
            color: "#F0F0F0",
            backgroundColor: "rgba(26, 26, 46, 0.6)",
            outline: "none",
            fontFamily: "inherit",
            overflowY: "hidden",
            maxHeight: LINE_HEIGHT * MAX_ROWS + PADDING_Y,
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "rgba(79, 138, 255, 0.5)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "rgba(107, 114, 128, 0.25)";
          }}
        />

        {/* ─── Send button ────────────────────────────────── */}
        <button
          onClick={handleSend}
          disabled={sendButtonDisabled}
          aria-label="Send message"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            border: "none",
            cursor: sendButtonDisabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: sendButtonDisabled
              ? "rgba(79, 138, 255, 0.2)"
              : "rgba(79, 138, 255, 0.85)",
            transition: "background-color 0.15s, transform 0.1s",
            flexShrink: 0,
          }}
          onMouseDown={(e) => {
            if (!sendButtonDisabled) {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(0.93)";
            }
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform =
              "scale(1)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform =
              "scale(1)";
          }}
        >
          <Send
            size={18}
            color={sendButtonDisabled ? "#4B5563" : "#FFFFFF"}
          />
        </button>
      </div>

      {/* ─── Character count ──────────────────────────────── */}
      {showCharCount && (
        <div
          style={{
            textAlign: "right",
            fontSize: 11,
            color: isOverLimit ? "#EF4444" : "#6B7280",
            paddingRight: 52,
          }}
        >
          {charCount}/{MAX_CHARS}
        </div>
      )}
    </div>
  );
}
