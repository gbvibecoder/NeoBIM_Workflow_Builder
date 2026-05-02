"use client";

import { useEffect } from "react";
import { getPusherClient } from "@/lib/pusher-client";
import { useAdminLiveChatStore } from "@/features/support/stores/admin-live-chat-store";

/**
 * Admin-side: subscribe to private-livechat-admin and route Pusher events
 * into the admin store. Refetches the conversation list on (re)connect to
 * catch up on any events missed during a disconnect.
 */
export function usePusherAdminLiveChat() {
  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher) return;

    const store = useAdminLiveChatStore.getState();
    const channel = pusher.subscribe("private-livechat-admin");

    channel.bind("pusher:subscription_succeeded", () => {
      store.fetchConversations();
    });
    channel.bind("pusher:subscription_error", (err: unknown) => {
      console.error("[admin-live-chat] subscription error:", err);
    });
    channel.bind("message:new", (data: unknown) => {
      store._receiveNewMessage(data as Parameters<typeof store._receiveNewMessage>[0]);
    });
    channel.bind("message:reply", (data: unknown) => {
      store._receiveReply(data as Parameters<typeof store._receiveReply>[0]);
    });
    channel.bind("status:changed", store._receiveStatusChange);

    return () => {
      channel.unbind_all();
      pusher.unsubscribe("private-livechat-admin");
    };
  }, []);
}
