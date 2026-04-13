"use client";

import { useEffect } from "react";
import { getPusherClient } from "@/lib/pusher-client";
import { useLiveChatStore } from "@/features/support/stores/live-chat-store";
import type { Members } from "pusher-js";

/**
 * User-side Pusher subscriptions: receive admin replies, conversation closed
 * events, and watch admin online presence.
 *
 * IMPORTANT: this hook must be mounted at the *widget* level (always-on for
 * the entire dashboard session), NOT inside LiveChatView — otherwise the user
 * loses real-time updates the moment they close the widget or navigate away
 * from the live-chat view, which makes admin replies appear only on refresh.
 */
export function usePusherLiveChat(userId: string | undefined | null) {
  useEffect(() => {
    if (!userId) return;
    const pusher = getPusherClient();
    if (!pusher) return;

    const store = useLiveChatStore.getState();
    const userChannelName = `private-livechat-user-${userId}`;
    const userChannel = pusher.subscribe(userChannelName);

    userChannel.bind("pusher:subscription_succeeded", () => {
      console.log("[live-chat] subscribed to", userChannelName);
    });
    userChannel.bind("pusher:subscription_error", (err: unknown) => {
      console.error("[live-chat] subscription error on", userChannelName, err);
    });
    userChannel.bind("message:reply", (data: unknown) => {
      console.log("[live-chat] received message:reply", data);
      store._receiveAdminReply(data as Parameters<typeof store._receiveAdminReply>[0]);
    });
    userChannel.bind("conversation:closed", store._receiveConversationClosed);

    const presence = pusher.subscribe("presence-livechat-admin");
    presence.bind("pusher:subscription_succeeded", (members: Members) => {
      store._setAdminOnline(members.count > 0);
    });
    presence.bind("pusher:member_added", () => store._setAdminOnline(true));
    presence.bind("pusher:member_removed", () => {
      const count = (presence as unknown as { members?: { count: number } }).members?.count ?? 0;
      store._setAdminOnline(count > 0);
    });

    return () => {
      userChannel.unbind_all();
      pusher.unsubscribe(userChannelName);
      presence.unbind_all();
      pusher.unsubscribe("presence-livechat-admin");
    };
  }, [userId]);
}
