"use client";

import { Search } from "lucide-react";
import s from "./admin-live-chat.module.css";

interface ConversationSearchProps {
  value: string;
  onChange: (v: string) => void;
}

export function ConversationSearch({
  value,
  onChange,
}: ConversationSearchProps) {
  return (
    <div className={s.convlistSearch}>
      <div className={s.searchInputWrap}>
        <Search
          size={14}
          style={{ color: "var(--lc-text-mute)", flexShrink: 0 }}
        />
        <input
          className={s.searchInput}
          type="text"
          placeholder="Search name, email, message…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
