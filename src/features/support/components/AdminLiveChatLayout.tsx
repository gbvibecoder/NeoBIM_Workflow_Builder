"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useAdminLiveChatStore } from "@/features/support/stores/admin-live-chat-store";
import { usePusherAdminLiveChat } from "@/features/support/hooks/usePusherAdminLiveChat";
import type { LiveChatMessage } from "@/features/support/types/live-chat";
import { LiveChatThemeProvider } from "./admin-live-chat/ThemeContext";
import { TopBar } from "./admin-live-chat/TopBar";
import { ConversationList } from "./admin-live-chat/ConversationList";
import { ThreadEmpty } from "./admin-live-chat/ThreadEmpty";
import { ThreadHead } from "./admin-live-chat/ThreadHead";
import { MessageList } from "./admin-live-chat/MessageList";
import { Composer } from "./admin-live-chat/Composer";
import type { FilterKey } from "./admin-live-chat/FilterChips";
import s from "./admin-live-chat/admin-live-chat.module.css";

// Stable empty array — prevents infinite re-render from Zustand selectors
// returning a new [] literal each time.
const EMPTY_MSGS: LiveChatMessage[] = [];

export default function AdminLiveChatLayout() {
  return (
    <LiveChatThemeProvider>
      <AdminLiveChatInner />
    </LiveChatThemeProvider>
  );
}

function AdminLiveChatInner() {
  const { data: session } = useSession();

  // ── Store selectors ─────────────────────────────────────────
  const conversations = useAdminLiveChatStore((st) => st.conversations);
  const selectedId = useAdminLiveChatStore((st) => st.selectedConversationId);
  const isLoadingList = useAdminLiveChatStore((st) => st.isLoadingList);
  const isSending = useAdminLiveChatStore((st) => st.isSending);
  const messages = useAdminLiveChatStore((st) => st.messages);
  const readCounts = useAdminLiveChatStore((st) => st.readCounts);
  const fetchConversations = useAdminLiveChatStore(
    (st) => st.fetchConversations,
  );
  const selectConversation = useAdminLiveChatStore(
    (st) => st.selectConversation,
  );
  const sendReply = useAdminLiveChatStore((st) => st.sendReply);
  const closeConversation = useAdminLiveChatStore(
    (st) => st.closeConversation,
  );
  const startPolling = useAdminLiveChatStore((st) => st.startPolling);
  const stopPolling = useAdminLiveChatStore((st) => st.stopPolling);
  const setMyUserId = useAdminLiveChatStore((st) => st.setMyUserId);
  const refreshSelectedMessages = useAdminLiveChatStore(
    (st) => st.refreshSelectedMessages,
  );
  const markAllAsRead = useAdminLiveChatStore((st) => st.markAllAsRead);

  // ── Local UI state ──────────────────────────────────────────
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Pusher — MUST stay at top level ─────────────────────────
  usePusherAdminLiveChat();

  // ── Mount: set user id ──────────────────────────────────────
  useEffect(() => {
    if (session?.user?.id) setMyUserId(session.user.id);
  }, [session?.user?.id, setMyUserId]);

  // ── Mount: initial fetch ────────────────────────────────────
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // ── Polling fallback + visibility-based instant refetch ─────
  // Guarantees the admin sees new messages within ~5s even if
  // Pusher is unavailable, and catches up immediately when the
  // tab comes back to focus.
  useEffect(() => {
    startPolling();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchConversations();
        refreshSelectedMessages();
      }
    };
    const onFocus = () => {
      fetchConversations();
      refreshSelectedMessages();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [startPolling, stopPolling, fetchConversations, refreshSelectedMessages]);

  // ── Derived counts ──────────────────────────────────────────
  const counts = useMemo(() => {
    const unreadList = conversations.filter(
      (c) => c.messageCount - (readCounts[c.id] ?? 0) > 0,
    );
    return {
      all: conversations.length,
      unread: unreadList.length,
      WAITING: conversations.filter((c) => c.status === "WAITING").length,
      ACTIVE: conversations.filter((c) => c.status === "ACTIVE").length,
      CLOSED: conversations.filter((c) => c.status === "CLOSED").length,
    };
  }, [conversations, readCounts]);

  const totalUnread = useMemo(
    () =>
      conversations.reduce(
        (sum, c) =>
          sum + Math.max(0, c.messageCount - (readCounts[c.id] ?? 0)),
        0,
      ),
    [conversations, readCounts],
  );

  const selectedConv =
    conversations.find((c) => c.id === selectedId) ?? null;
  const selectedMessages = selectedId
    ? (messages[selectedId] ?? EMPTY_MSGS)
    : EMPTY_MSGS;

  // ── Handlers ────────────────────────────────────────────────
  const handleClose = () => {
    if (!selectedId) return;
    if (
      window.confirm(
        "Close this conversation? The user will be notified.",
      )
    ) {
      closeConversation(selectedId);
    }
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className={s.layout}>
      <TopBar
        conversationCount={counts.all}
        totalUnread={totalUnread}
        pusherConnected={true}
        activeFilter={filter}
        onFilterChange={setFilter}
        counts={counts}
        onMarkAllRead={markAllAsRead}
      />
      <div className={s.main}>
        <ConversationList
          conversations={conversations}
          readCounts={readCounts}
          selectedId={selectedId}
          onSelect={selectConversation}
          filter={filter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isLoading={isLoadingList}
        />
        {selectedConv ? (
          <section className={s.thread} key={selectedConv.id}>
            <ThreadHead
              conversation={selectedConv}
              onClose={handleClose}
            />
            <MessageList messages={selectedMessages} isLoading={false} />
            <Composer
              onSend={async (content) => {
                if (selectedId) await sendReply(selectedId, content);
              }}
              isSending={isSending}
            />
          </section>
        ) : (
          <ThreadEmpty />
        )}
      </div>
    </div>
  );
}
