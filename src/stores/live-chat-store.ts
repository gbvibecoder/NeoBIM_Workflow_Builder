"use client";

import { create } from "zustand";
import type {
  LiveChatMessage,
  LiveChatStatus,
  PusherReplyEvent,
} from "@/types/live-chat";

interface LiveChatState {
  isActive: boolean;
  conversationId: string | null;
  conversationStatus: LiveChatStatus | null;
  messages: LiveChatMessage[];
  isSending: boolean;
  isLoadingHistory: boolean;
  adminOnline: boolean;
  adminTyping: boolean;
  inputDraft: string;
  error: string | null;

  // actions
  openLiveChat: () => Promise<void>;
  closeLiveChat: () => void;
  setInputDraft: (v: string) => void;
  sendMessage: (content: string, pageContext: string) => Promise<void>;

  // pusher handlers (private)
  _receiveAdminReply: (data: PusherReplyEvent) => void;
  _receiveConversationClosed: () => void;
  _setAdminOnline: (online: boolean) => void;
  _setAdminTyping: (typing: boolean) => void;
}

export const useLiveChatStore = create<LiveChatState>()((set, get) => ({
  isActive: false,
  conversationId: null,
  conversationStatus: null,
  messages: [],
  isSending: false,
  isLoadingHistory: false,
  adminOnline: false,
  adminTyping: false,
  inputDraft: "",
  error: null,

  openLiveChat: async () => {
    set({ isActive: true, isLoadingHistory: true, error: null });
    try {
      const res = await fetch("/api/live-chat/conversations?own=true");
      if (!res.ok) {
        set({ isLoadingHistory: false });
        return;
      }
      const data = await res.json();
      const open = (data.conversations || []).find(
        (c: { status: LiveChatStatus }) =>
          c.status === "WAITING" || c.status === "ACTIVE",
      );
      if (!open) {
        set({
          conversationId: null,
          conversationStatus: null,
          messages: [],
          isLoadingHistory: false,
        });
        return;
      }
      const msgRes = await fetch(`/api/live-chat/conversations/${open.id}/messages`);
      const msgData = msgRes.ok ? await msgRes.json() : { messages: [] };
      set({
        conversationId: open.id,
        conversationStatus: open.status,
        messages: msgData.messages || [],
        isLoadingHistory: false,
      });
    } catch (e) {
      console.error("[live-chat] openLiveChat failed:", e);
      set({ isLoadingHistory: false, error: "Failed to load conversation." });
    }
  },

  closeLiveChat: () => {
    set({
      isActive: false,
      adminTyping: false,
      inputDraft: "",
      error: null,
    });
  },

  setInputDraft: (v) => set({ inputDraft: v }),

  sendMessage: async (content, pageContext) => {
    const { conversationId, isSending } = get();
    if (isSending || !content.trim()) return;

    const tempId = `temp-${Date.now()}`;
    const optimistic: LiveChatMessage = {
      id: tempId,
      conversationId: conversationId || "",
      senderId: "self",
      senderRole: "USER",
      senderName: "You",
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      isSending: true,
      inputDraft: "",
      messages: [...s.messages, optimistic],
    }));

    try {
      const res = await fetch("/api/live-chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content: content.trim(), pageContext }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errorMsg: LiveChatMessage = {
          id: `err-${Date.now()}`,
          conversationId: conversationId || "",
          senderId: "system",
          senderRole: "ADMIN",
          senderName: "System",
          content:
            errBody?.error?.message ||
            "Failed to send message. Please try again.",
          createdAt: new Date().toISOString(),
        };
        set((s) => ({
          isSending: false,
          messages: [...s.messages.filter((m) => m.id !== tempId), errorMsg],
          error: errBody?.error?.message || "Send failed",
        }));
        return;
      }
      const data = await res.json();
      set((s) => ({
        isSending: false,
        conversationId: data.conversationId,
        conversationStatus: s.conversationStatus ?? "WAITING",
        messages: s.messages.map((m) =>
          m.id === tempId ? (data.message as LiveChatMessage) : m,
        ),
      }));
    } catch (e) {
      console.error("[live-chat] sendMessage failed:", e);
      set((s) => ({
        isSending: false,
        messages: s.messages.filter((m) => m.id !== tempId),
        error: "Network error.",
      }));
    }
  },

  _receiveAdminReply: (data) => {
    const { conversationId, messages } = get();
    if (!conversationId || data.conversationId !== conversationId) return;
    if (messages.some((m) => m.id === data.message.id)) return;
    set((s) => ({
      messages: [...s.messages, data.message],
      conversationStatus: "ACTIVE",
      adminTyping: false,
    }));
  },

  _receiveConversationClosed: () => {
    set({ conversationStatus: "CLOSED", adminTyping: false });
  },

  _setAdminOnline: (online) => set({ adminOnline: online }),
  _setAdminTyping: (typing) => set({ adminTyping: typing }),
}));
