"use client";

import { create } from "zustand";
import type {
  LiveChatMessage,
  LiveChatStatus,
  PusherReplyEvent,
} from "@/features/support/types/live-chat";

// ─── Polling fallback (the WhatsApp safety net) ─────────────────────────────
// Pusher delivers events in <1s when it works. But it can silently fail for
// many reasons in production: missing env vars, ad-blockers killing the WS,
// browser tab throttling, corporate firewalls blocking WebSockets, Pusher
// subscription rejects, etc. To guarantee that messages always arrive within
// a few seconds — like WhatsApp / Instagram / Telegram — we run a 4s polling
// fallback while the user is on the live-chat view. The fetch is a cheap
// no-op when Pusher is healthy (no new ids → merge produces zero new state).
const POLL_INTERVAL_MS = 4000;
let _pollTimerId: ReturnType<typeof setInterval> | null = null;

function _stopPollTimer() {
  if (_pollTimerId) {
    clearInterval(_pollTimerId);
    _pollTimerId = null;
  }
}

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

  // safety-net polling
  refreshMessages: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;

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
    _stopPollTimer();
    set({
      isActive: false,
      adminTyping: false,
      inputDraft: "",
      error: null,
    });
  },

  // ── Safety-net polling: refresh + interval control ───────────────────────
  refreshMessages: async () => {
    const { conversationId } = get();
    if (!conversationId) return;
    try {
      const res = await fetch(`/api/live-chat/conversations/${conversationId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      const incoming: LiveChatMessage[] = data.messages || [];
      const incomingStatus: LiveChatStatus | undefined = data.status;
      set((s) => {
        // Preserve any optimistic temp messages that haven't been replaced yet.
        const tempMessages = s.messages.filter((m) => m.id.startsWith("temp-"));
        // Server messages + any in-flight temps (they'll get replaced by the
        // next poll cycle once the server has assigned them real ids).
        const mergedById = new Map<string, LiveChatMessage>();
        for (const m of incoming) mergedById.set(m.id, m);
        for (const m of tempMessages) mergedById.set(m.id, m);
        // Quick equality check — same length AND every id matches → no diff.
        const sameLength = mergedById.size === s.messages.length;
        const sameIds =
          sameLength && s.messages.every((m) => mergedById.has(m.id));
        const statusChanged =
          incomingStatus && incomingStatus !== s.conversationStatus;
        if (sameIds && !statusChanged) return s;
        const merged = [...mergedById.values()].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        const next: Partial<LiveChatState> = { messages: merged };
        if (statusChanged) next.conversationStatus = incomingStatus;
        return next;
      });
    } catch (e) {
      // Polling failures are silent — Pusher may still deliver, and the next
      // tick will retry. Don't surface errors for background fetches.
      console.warn("[live-chat] refreshMessages failed:", e);
    }
  },

  startPolling: () => {
    _stopPollTimer();
    _pollTimerId = setInterval(() => {
      const state = get();
      if (!state.isActive || !state.conversationId) return;
      // Skip polling while a send is in flight to avoid clobbering the
      // optimistic message replacement.
      if (state.isSending) return;
      state.refreshMessages();
    }, POLL_INTERVAL_MS);
  },

  stopPolling: () => {
    _stopPollTimer();
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
