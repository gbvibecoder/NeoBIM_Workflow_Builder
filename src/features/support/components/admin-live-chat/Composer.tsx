"use client";

import { useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import s from "./admin-live-chat.module.css";

interface ComposerProps {
  onSend: (content: string) => Promise<void>;
  isSending: boolean;
  maxLength?: number;
}

export function Composer({
  onSend,
  isSending,
  maxLength = 3000,
}: ComposerProps) {
  const [draft, setDraft] = useState("");

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setDraft("");
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = draft.trim().length > 0 && !isSending;

  return (
    <div className={s.composer}>
      <div className={s.composerHint}>
        <span>Enter to send · Shift+Enter for newline</span>
        <span>
          {draft.length}/{maxLength}
        </span>
      </div>
      <div className={s.composerRow}>
        <textarea
          className={s.composerTextarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, maxLength + 100))}
          onKeyDown={handleKey}
          placeholder="Type your reply…"
          rows={1}
          disabled={isSending}
        />
        <button
          className={s.composerSend}
          onClick={handleSend}
          disabled={!canSend}
          title="Send message"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
