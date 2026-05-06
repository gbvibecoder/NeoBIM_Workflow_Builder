"use client";

import { create } from "zustand";
import type {
  AdminLiveChatConversation,
  LiveChatMessage,
  LiveChatStatus,
  PusherNewMessageEvent,
  PusherReplyEvent,
  PusherStatusEvent,
} from "@/features/support/types/live-chat";

// Polling fallback for the admin inbox — same WhatsApp-style safety net as
// the user side. Guarantees the admin sees new conversations + new messages
// within ~5s even if Pusher is unavailable.
const ADMIN_POLL_INTERVAL_MS = 5000;
let _adminPollTimerId: ReturnType<typeof setInterval> | null = null;

function _stopAdminPollTimer() {
  if (_adminPollTimerId) {
    clearInterval(_adminPollTimerId);
    _adminPollTimerId = null;
  }
}

interface AdminLiveChatState {
  conversations: AdminLiveChatConversation[];
  selectedConversationId: string | null;
  messages: Record<string, LiveChatMessage[]>;
  isLoadingList: boolean;
  isLoadingMessages: boolean;
  isSending: boolean;
  myUserId: string | null;
  // Tracks the messageCount the admin last "saw" when they clicked each conv.
  // Unread = conv.messageCount - (readCounts[convId] ?? 0).
  readCounts: Record<string, number>;

  setMyUserId: (id: string) => void;
  getUnreadCount: (convId: string) => number;
  markAllAsRead: () => void;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  sendReply: (conversationId: string, content: string) => Promise<void>;
  closeConversation: (id: string) => Promise<void>;
  refreshSelectedMessages: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;

  _receiveNewMessage: (data: PusherNewMessageEvent) => void;
  _receiveReply: (data: PusherReplyEvent) => void;
  _receiveStatusChange: (data: PusherStatusEvent) => void;
}

function sortByLastMessage(a: AdminLiveChatConversation, b: AdminLiveChatConversation) {
  return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
}

// ── Persist readCounts to localStorage so they survive page refresh ─────────
const READ_COUNTS_KEY = "livechat-admin-read-counts";

function loadReadCounts(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(READ_COUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveReadCounts(counts: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(READ_COUNTS_KEY, JSON.stringify(counts));
  } catch {
    // localStorage full or blocked — degrade silently
  }
}

export const useAdminLiveChatStore = create<AdminLiveChatState>()((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  messages: {},
  isLoadingList: false,
  isLoadingMessages: false,
  isSending: false,
  myUserId: null,
  readCounts: loadReadCounts(),

  setMyUserId: (id) => set({ myUserId: id }),

  getUnreadCount: (convId) => {
    const { conversations, readCounts } = get();
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return 0;
    const lastRead = readCounts[convId] ?? 0;
    return Math.max(0, conv.messageCount - lastRead);
  },

  markAllAsRead: () => {
    const { conversations, readCounts } = get();
    const updated: Record<string, number> = { ...readCounts };
    for (const c of conversations) {
      updated[c.id] = c.messageCount;
    }
    saveReadCounts(updated);
    set({ readCounts: updated });
  },

  fetchConversations: async () => {
    set({ isLoadingList: true });
    try {
      const res = await fetch("/api/live-chat/conversations");
      if (!res.ok) {
        set({ isLoadingList: false });
        return;
      }
      const data = await res.json();
      const convs: AdminLiveChatConversation[] = (data.conversations || []).sort(sortByLastMessage);
      // Auto-mark the currently-selected conversation as read so the badge
      // doesn't flicker back after a poll refresh while the admin has the
      // chat open (WhatsApp: if I'm looking at a chat, incoming = read).
      const selId = get().selectedConversationId;
      const updatedReadCounts = { ...get().readCounts };
      if (selId) {
        const selConv = convs.find((c) => c.id === selId);
        if (selConv) updatedReadCounts[selId] = selConv.messageCount;
      }
      saveReadCounts(updatedReadCounts);
      set({
        conversations: convs,
        isLoadingList: false,
        readCounts: updatedReadCounts,
      });
    } catch (e) {
      console.error("[admin-live-chat] fetchConversations failed:", e);
      set({ isLoadingList: false });
    }
  },

  selectConversation: async (id) => {
    // Mark as read: snapshot the current messageCount so unread goes to 0
    const conv = get().conversations.find((c) => c.id === id);
    const updatedReadCounts = { ...get().readCounts };
    if (conv) updatedReadCounts[id] = conv.messageCount;
    saveReadCounts(updatedReadCounts);
    set({ selectedConversationId: id, isLoadingMessages: true, readCounts: updatedReadCounts });
    try {
      const res = await fetch(`/api/live-chat/conversations/${id}/messages`);
      if (!res.ok) {
        set({ isLoadingMessages: false });
        return;
      }
      const data = await res.json();
      set((s) => ({
        messages: { ...s.messages, [id]: data.messages || [] },
        isLoadingMessages: false,
      }));
    } catch (e) {
      console.error("[admin-live-chat] selectConversation failed:", e);
      set({ isLoadingMessages: false });
    }
  },

  sendReply: async (conversationId, content) => {
    const trimmed = content.trim();
    if (!trimmed || get().isSending) return;

    // Optimistic insert — admin sees their reply instantly, no network wait.
    const tempId = `temp-${Date.now()}`;
    const myId = get().myUserId || "self";
    const nowIso = new Date().toISOString();
    const optimistic: LiveChatMessage = {
      id: tempId,
      conversationId,
      senderId: myId,
      senderRole: "ADMIN",
      senderName: "You",
      content: trimmed,
      createdAt: nowIso,
    };

    set((s) => {
      const existing = s.messages[conversationId] || [];
      return {
        isSending: true,
        messages: { ...s.messages, [conversationId]: [...existing, optimistic] },
        conversations: s.conversations
          .map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  status: c.status === "WAITING" ? ("ACTIVE" as LiveChatStatus) : c.status,
                  lastMessageAt: nowIso,
                  lastMessage: {
                    content: trimmed,
                    senderRole: "ADMIN" as const,
                    senderName: "You",
                    createdAt: nowIso,
                  },
                }
              : c,
          )
          .sort(sortByLastMessage),
      };
    });

    try {
      const res = await fetch("/api/live-chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content: trimmed }),
      });
      if (!res.ok) {
        // Roll back optimistic message
        set((s) => ({
          isSending: false,
          messages: {
            ...s.messages,
            [conversationId]: (s.messages[conversationId] || []).filter(
              (m) => m.id !== tempId,
            ),
          },
        }));
        return;
      }
      const data = await res.json();
      const msg: LiveChatMessage = data.message;
      // Replace temp with the persisted message; update list preview with real id/time.
      set((s) => {
        const existing = s.messages[conversationId] || [];
        const replaced = existing.map((m) => (m.id === tempId ? msg : m));
        return {
          isSending: false,
          messages: { ...s.messages, [conversationId]: replaced },
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  repliedByName: c.repliedByName || msg.senderName,
                  lastMessageAt: msg.createdAt,
                  lastMessage: {
                    content: msg.content,
                    senderRole: "ADMIN" as const,
                    senderName: msg.senderName,
                    createdAt: msg.createdAt,
                  },
                }
              : c,
          ),
        };
      });
    } catch (e) {
      console.error("[admin-live-chat] sendReply failed:", e);
      set((s) => ({
        isSending: false,
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] || []).filter(
            (m) => m.id !== tempId,
          ),
        },
      }));
    }
  },

  closeConversation: async (id) => {
    try {
      await fetch(`/api/live-chat/conversations/${id}/close`, { method: "POST" });
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, status: "CLOSED" as LiveChatStatus } : c,
        ),
      }));
    } catch (e) {
      console.error("[admin-live-chat] closeConversation failed:", e);
    }
  },

  // ── Safety-net polling ────────────────────────────────────────────────
  refreshSelectedMessages: async () => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      const res = await fetch(
        `/api/live-chat/conversations/${selectedConversationId}/messages`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const incoming: LiveChatMessage[] = data.messages || [];
      set((s) => {
        const existing = s.messages[selectedConversationId] || [];
        const tempMessages = existing.filter((m) => m.id.startsWith("temp-"));
        const byId = new Map<string, LiveChatMessage>();
        for (const m of incoming) byId.set(m.id, m);
        for (const m of tempMessages) byId.set(m.id, m);
        const sameLength = byId.size === existing.length;
        const sameIds = sameLength && existing.every((m) => byId.has(m.id));
        if (sameIds) return s;
        const merged = [...byId.values()].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        return {
          messages: { ...s.messages, [selectedConversationId]: merged },
        };
      });
    } catch (e) {
      console.warn("[admin-live-chat] refreshSelectedMessages failed:", e);
    }
  },

  startPolling: () => {
    _stopAdminPollTimer();
    _adminPollTimerId = setInterval(() => {
      const state = get();
      if (state.isSending) return;
      // Always refresh the conversation list (cheap, captures new convs)
      state.fetchConversations();
      // Also refresh the selected thread's messages
      if (state.selectedConversationId) {
        state.refreshSelectedMessages();
      }
    }, ADMIN_POLL_INTERVAL_MS);
  },

  stopPolling: () => {
    _stopAdminPollTimer();
  },

  _receiveNewMessage: (data) => {
    set((s) => {
      const existingMessages = s.messages[data.conversationId] || [];
      const dedup = existingMessages.some((m) => m.id === data.message.id)
        ? existingMessages
        : [...existingMessages, data.message];

      let conversations = s.conversations;
      const idx = conversations.findIndex((c) => c.id === data.conversationId);
      if (idx === -1) {
        if (data.conversation) {
          conversations = [data.conversation, ...conversations];
        }
      } else {
        const updated = {
          ...conversations[idx],
          lastMessageAt: data.message.createdAt,
          messageCount: conversations[idx].messageCount + 1,
          lastMessage: {
            content: data.message.content,
            senderRole: data.message.senderRole,
            senderName: data.message.senderName,
            createdAt: data.message.createdAt,
          },
        };
        conversations = [updated, ...conversations.filter((_, i) => i !== idx)];
      }
      conversations = [...conversations].sort(sortByLastMessage);

      // If admin is currently viewing this conversation, auto-mark as read
      const readCounts = { ...s.readCounts };
      if (s.selectedConversationId === data.conversationId) {
        const conv = conversations.find((c) => c.id === data.conversationId);
        if (conv) readCounts[data.conversationId] = conv.messageCount;
        saveReadCounts(readCounts);
      }

      return {
        conversations,
        messages: { ...s.messages, [data.conversationId]: dedup },
        readCounts,
      };
    });
  },

  _receiveReply: (data) => {
    const myId = get().myUserId;
    if (myId && data.message.senderId === myId) return; // already in state
    set((s) => {
      const existing = s.messages[data.conversationId] || [];
      if (existing.some((m) => m.id === data.message.id)) return s;
      return {
        messages: {
          ...s.messages,
          [data.conversationId]: [...existing, data.message],
        },
        conversations: s.conversations.map((c) =>
          c.id === data.conversationId
            ? {
                ...c,
                lastMessageAt: data.message.createdAt,
                lastMessage: {
                  content: data.message.content,
                  senderRole: data.message.senderRole,
                  senderName: data.message.senderName,
                  createdAt: data.message.createdAt,
                },
              }
            : c,
        ),
      };
    });
  },

  _receiveStatusChange: (data) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === data.conversationId
          ? {
              ...c,
              status: data.status,
              repliedByName: data.repliedByName ?? c.repliedByName,
              closedByAdminId: data.closedByAdminId ?? c.closedByAdminId,
            }
          : c,
      ),
    }));
  },
}));
