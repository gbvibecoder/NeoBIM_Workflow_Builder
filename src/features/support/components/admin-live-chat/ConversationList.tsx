"use client";

import { useMemo } from "react";
import { MessageSquare } from "lucide-react";
import type { AdminLiveChatConversation } from "@/features/support/types/live-chat";
import type { FilterKey } from "./FilterChips";
import { ConversationSearch } from "./ConversationSearch";
import { ConversationRow } from "./ConversationRow";
import s from "./admin-live-chat.module.css";

interface ConversationListProps {
  conversations: AdminLiveChatConversation[];
  readCounts: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: FilterKey;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  isLoading: boolean;
}

export function ConversationList({
  conversations,
  readCounts,
  selectedId,
  onSelect,
  filter,
  searchQuery,
  onSearchChange,
  isLoading,
}: ConversationListProps) {
  const filtered = useMemo(() => {
    let list = conversations;

    if (filter === "unread") {
      list = list.filter(
        (c) => c.messageCount - (readCounts[c.id] ?? 0) > 0,
      );
    } else if (filter !== "all") {
      list = list.filter((c) => c.status === filter);
    }

    const q = searchQuery.toLowerCase().trim();
    if (q) {
      list = list.filter((c) => {
        const name = (c.userName || "").toLowerCase();
        const email = c.userEmail.toLowerCase();
        const msg = (c.lastMessage?.content || "").toLowerCase();
        return name.includes(q) || email.includes(q) || msg.includes(q);
      });
    }

    return list;
  }, [conversations, readCounts, filter, searchQuery]);

  return (
    <div className={s.convlist}>
      <ConversationSearch value={searchQuery} onChange={onSearchChange} />
      <div className={s.convlistScroll}>
        {isLoading && conversations.length === 0 && (
          <div className={s.emptyList}>Loading conversations…</div>
        )}
        {!isLoading && conversations.length === 0 && (
          <div className={s.emptyList}>
            <div className={s.emptyListIcon}>
              <MessageSquare
                size={24}
                style={{ color: "var(--lc-text-mute)" }}
              />
            </div>
            <p className={s.emptyListTitle}>No conversations yet</p>
            <p className={s.emptyListSub}>
              Messages from users will appear here
            </p>
          </div>
        )}
        {!isLoading &&
          conversations.length > 0 &&
          filtered.length === 0 && (
            <div className={s.emptyList}>No matching conversations</div>
          )}
        {filtered.map((c) => (
          <ConversationRow
            key={c.id}
            conversation={c}
            isActive={c.id === selectedId}
            unreadCount={Math.max(
              0,
              c.messageCount - (readCounts[c.id] ?? 0),
            )}
            onClick={() => onSelect(c.id)}
          />
        ))}
      </div>
    </div>
  );
}
