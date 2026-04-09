"use client";

import { create } from "zustand";
import type {
  AdminLiveChatConversation,
  LiveChatMessage,
  LiveChatStatus,
  PusherNewMessageEvent,
  PusherReplyEvent,
  PusherStatusEvent,
} from "@/types/live-chat";

interface AdminLiveChatState {
  conversations: AdminLiveChatConversation[];
  selectedConversationId: string | null;
  messages: Record<string, LiveChatMessage[]>;
  isLoadingList: boolean;
  isLoadingMessages: boolean;
  isSending: boolean;
  myUserId: string | null;

  setMyUserId: (id: string) => void;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  sendReply: (conversationId: string, content: string) => Promise<void>;
  closeConversation: (id: string) => Promise<void>;

  _receiveNewMessage: (data: PusherNewMessageEvent) => void;
  _receiveReply: (data: PusherReplyEvent) => void;
  _receiveStatusChange: (data: PusherStatusEvent) => void;
}

function sortByLastMessage(a: AdminLiveChatConversation, b: AdminLiveChatConversation) {
  return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
}

export const useAdminLiveChatStore = create<AdminLiveChatState>()((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  messages: {},
  isLoadingList: false,
  isLoadingMessages: false,
  isSending: false,
  myUserId: null,

  setMyUserId: (id) => set({ myUserId: id }),

  fetchConversations: async () => {
    set({ isLoadingList: true });
    try {
      const res = await fetch("/api/live-chat/conversations");
      if (!res.ok) {
        set({ isLoadingList: false });
        return;
      }
      const data = await res.json();
      set({
        conversations: (data.conversations || []).sort(sortByLastMessage),
        isLoadingList: false,
      });
    } catch (e) {
      console.error("[admin-live-chat] fetchConversations failed:", e);
      set({ isLoadingList: false });
    }
  },

  selectConversation: async (id) => {
    set({ selectedConversationId: id, isLoadingMessages: true });
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

      return {
        conversations,
        messages: { ...s.messages, [data.conversationId]: dedup },
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
