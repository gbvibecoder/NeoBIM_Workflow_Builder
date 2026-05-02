"use client";

import { MessageSquare } from "lucide-react";
import { FilterChips, type FilterKey } from "./FilterChips";
import { ThemeToggle } from "./ThemeToggle";
import s from "./admin-live-chat.module.css";

interface TopBarProps {
  conversationCount: number;
  totalUnread: number;
  pusherConnected: boolean;
  activeFilter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  counts: Record<FilterKey, number>;
  onMarkAllRead: () => void;
}

export function TopBar({
  conversationCount,
  totalUnread,
  pusherConnected,
  activeFilter,
  onFilterChange,
  counts,
  onMarkAllRead,
}: TopBarProps) {
  return (
    <div className={s.topbar}>
      <div className={s.topbarIcon}>
        <MessageSquare size={17} style={{ color: "var(--lc-accent)" }} />
      </div>
      <h2 className={s.topbarTitle}>Live Chat</h2>
      <div className={s.topbarMeta}>
        {pusherConnected && <span className={s.topbarMetaDot} />}
        <span>{conversationCount} conversations</span>
        {totalUnread > 0 && (
          <>
            <span style={{ color: "var(--lc-text-mute)" }}>·</span>
            <span
              style={{ color: "var(--lc-success)", fontWeight: 600 }}
            >
              {totalUnread} unread
            </span>
          </>
        )}
      </div>
      <FilterChips
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        counts={counts}
      />
      <span className={s.topbarSpacer} />
      {totalUnread > 0 && (
        <button className={s.topbarAction} onClick={onMarkAllRead}>
          Mark all read
        </button>
      )}
      <ThemeToggle />
    </div>
  );
}
