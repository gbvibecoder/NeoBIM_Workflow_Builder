"use client";

import { create } from "zustand";
import type {
  SupportConversation,
  SupportMessage,
  ChatResponse,
} from "@/types/support";

// ─── Poll interval lives outside store (not reactive state) ─────────────────
let _pollIntervalId: ReturnType<typeof setInterval> | null = null;

// ─── State ──────────────────────────────────────────────────────────────────

interface SupportState {
  isOpen: boolean;
  isMinimized: boolean;
  activeConversationId: string | null;
  conversations: SupportConversation[];
  messages: Record<string, SupportMessage[]>;
  isLoading: boolean;
  isSending: boolean;
  suggestions: string[];
  unreadCount: number;
  pageContext: string;
  inputDraft: string;
  error: string | null;
  chatView: "ai" | "live-chat" | null;

  // Actions
  setChatView: (view: "ai" | "live-chat" | null) => void;
  toggle: () => void;
  open: () => void;
  close: () => void;
  minimize: () => void;
  setPageContext: (page: string) => void;
  setInputDraft: (draft: string) => void;
  setActiveConversation: (id: string | null) => void;
  loadConversations: () => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  startNewConversation: () => void;
  escalate: (reason?: string) => Promise<void>;
  rateConversation: (rating: number, note?: string) => Promise<void>;
  closeConversation: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  clearAll: () => void;
  openConversation: (id: string) => void;
  clearError: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stopPollTimer() {
  if (_pollIntervalId) {
    clearInterval(_pollIntervalId);
    _pollIntervalId = null;
  }
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useSupportStore = create<SupportState>()((set, get) => ({
  isOpen: false,
  isMinimized: false,
  activeConversationId: null,
  conversations: [],
  messages: {},
  isLoading: false,
  isSending: false,
  suggestions: [],
  unreadCount: 0,
  pageContext: "dashboard",
  inputDraft: "",
  error: null,
  chatView: null,

  setChatView: (view) => set({ chatView: view }),

  toggle: () => {
    const { isOpen, isMinimized } = get();
    if (isMinimized) {
      set({ isMinimized: false, isOpen: true });
    } else {
      set({ isOpen: !isOpen, isMinimized: false });
    }
  },

  open: () => set({ isOpen: true, isMinimized: false }),

  close: () => {
    stopPollTimer();
    set({ isOpen: false, isMinimized: false });
  },

  minimize: () => set({ isMinimized: true, isOpen: false }),

  clearError: () => set({ error: null }),

  setPageContext: (page: string) => set({ pageContext: page }),

  setInputDraft: (draft: string) => set({ inputDraft: draft }),

  setActiveConversation: (id: string | null) => {
    set({ activeConversationId: id, suggestions: [] });
    if (id) {
      get().loadMessages(id);
      get().startPolling();
    } else {
      stopPollTimer();
    }
  },

  loadConversations: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/support/conversations?limit=50");
      if (!res.ok) {
        set({ isLoading: false });
        return;
      }
      const data = await res.json();
      const convs: SupportConversation[] = data.conversations ?? [];
      const unread = convs.filter(
        (c) => c.status === "ADMIN_REPLIED",
      ).length;
      // Single batched set call
      set({ conversations: convs, unreadCount: unread, isLoading: false });
    } catch (err) {
      console.error("[support] loadConversations failed:", err);
      set({ isLoading: false });
    }
  },

  loadMessages: async (conversationId: string) => {
    try {
      const res = await fetch(`/api/support/conversations/${conversationId}`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs: SupportMessage[] = data.messages ?? [];
      set((state) => {
        const updatedConvs = data.status
          ? state.conversations.map((c) =>
              c.id === conversationId ? { ...c, status: data.status } : c,
            )
          : state.conversations;
        return {
          messages: { ...state.messages, [conversationId]: msgs },
          suggestions: [],
          conversations: updatedConvs,
        };
      });
    } catch (err) {
      console.error("[support] loadMessages failed:", err);
    }
  },

  sendMessage: async (content: string) => {
    const { activeConversationId, pageContext } = get();

    // Optimistic update: add user message + set sending state in ONE set call
    const tempId = `temp-${Date.now()}`;
    const convId = activeConversationId || "";
    const optimisticMsg: SupportMessage = {
      id: tempId,
      conversationId: convId,
      role: "USER",
      content,
      metadata: {},
      isInternal: false,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      isSending: true,
      inputDraft: "",
      messages: {
        ...state.messages,
        [convId]: [...(state.messages[convId] ?? []), optimisticMsg],
      },
    }));

    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          conversationId: activeConversationId || undefined,
          pageContext,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const errorMsg: SupportMessage = {
          id: `err-${Date.now()}`,
          conversationId: convId,
          role: "SYSTEM",
          content: err?.error?.message || "Failed to send message. Please try again.",
          metadata: {},
          isInternal: false,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          isSending: false,
          messages: {
            ...state.messages,
            [convId]: [...(state.messages[convId] ?? []), errorMsg],
          },
        }));
        return;
      }

      const data: ChatResponse = await res.json();
      const realConvId = data.conversationId;

      // Replace optimistic message + add AI response in ONE set call
      set((state) => {
        const existing = state.messages[convId] ?? [];
        const withoutTemp = existing.filter((m) => m.id !== tempId);

        const userMsg: SupportMessage = {
          ...optimisticMsg,
          id: `usr-${Date.now()}`,
          conversationId: realConvId,
        };

        let updatedMessages: Record<string, SupportMessage[]>;
        if (realConvId === convId) {
          updatedMessages = {
            ...state.messages,
            [realConvId]: [...withoutTemp, userMsg, data.message],
          };
        } else {
          const realMsgs = state.messages[realConvId] ?? [];
          updatedMessages = {
            ...state.messages,
            [convId]: withoutTemp,
            [realConvId]: [...realMsgs, userMsg, data.message],
          };
        }

        return {
          messages: updatedMessages,
          suggestions: data.suggestions ?? [],
          activeConversationId: realConvId,
          isSending: false,
        };
      });

      // Refresh conversation list (non-blocking)
      get().loadConversations();
    } catch {
      const errorMsg: SupportMessage = {
        id: `err-${Date.now()}`,
        conversationId: convId,
        role: "SYSTEM",
        content: "Network error. Please check your connection and try again.",
        metadata: {},
        isInternal: false,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({
        isSending: false,
        messages: {
          ...state.messages,
          [convId]: [...(state.messages[convId] ?? []), errorMsg],
        },
      }));
    }
  },

  startNewConversation: () => {
    stopPollTimer();
    set({
      activeConversationId: null,
      suggestions: [],
      inputDraft: "",
    });
  },

  escalate: async (reason?: string) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    try {
      const res = await fetch(
        `/api/support/conversations/${activeConversationId}/escalate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!res.ok) return;

      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === activeConversationId
            ? { ...c, status: "ESCALATED" as const }
            : c,
        ),
      }));

      get().loadMessages(activeConversationId);
      get().startPolling();
    } catch (err) {
      console.error("[support] escalate failed:", err);
      set({ error: "Failed to escalate. Please try again." });
    }
  },

  rateConversation: async (rating: number, note?: string) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    try {
      await fetch(
        `/api/support/conversations/${activeConversationId}/rate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating, note }),
        },
      );

      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === activeConversationId
            ? { ...c, satisfaction: rating }
            : c,
        ),
      }));
    } catch (err) {
      console.error("[support] rateConversation failed:", err);
    }
  },

  closeConversation: async () => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    try {
      await fetch(
        `/api/support/conversations/${activeConversationId}/close`,
        { method: "POST" },
      );

      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === activeConversationId
            ? { ...c, status: "CLOSED" as const }
            : c,
        ),
      }));
      stopPollTimer();
    } catch (err) {
      console.error("[support] closeConversation failed:", err);
    }
  },

  startPolling: () => {
    stopPollTimer();
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    _pollIntervalId = setInterval(() => {
      const state = get();
      const conv = state.conversations.find(
        (c) => c.id === state.activeConversationId,
      );
      if (
        conv &&
        (conv.status === "ESCALATED" || conv.status === "ADMIN_REPLIED")
      ) {
        state.loadMessages(state.activeConversationId!);
        state.loadConversations();
      }
    }, 30000);
  },

  stopPolling: () => {
    stopPollTimer();
  },

  clearAll: () => {
    stopPollTimer();
    set({
      isOpen: false,
      isMinimized: false,
      activeConversationId: null,
      conversations: [],
      messages: {},
      isLoading: false,
      isSending: false,
      suggestions: [],
      unreadCount: 0,
      inputDraft: "",
      error: null,
    });
  },

  openConversation: (id: string) => {
    set({ isOpen: true, isMinimized: false, activeConversationId: id });
    get().loadMessages(id);
    get().startPolling();
  },
}));
