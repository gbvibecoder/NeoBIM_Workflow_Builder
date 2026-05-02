import type { LiveChatMessage } from "@/features/support/types/live-chat";

export interface MessageGroup {
  side: "user" | "admin";
  senderName: string | null;
  messages: LiveChatMessage[];
  timestamp: Date;
}

export function groupConsecutiveMessages(
  messages: LiveChatMessage[],
): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: MessageGroup | null = null;

  for (const msg of messages) {
    const side = msg.senderRole === "ADMIN" ? "admin" : "user";
    if (
      current &&
      current.side === side &&
      current.senderName === (msg.senderName ?? null)
    ) {
      current.messages.push(msg);
    } else {
      current = {
        side,
        senderName: msg.senderName ?? null,
        messages: [msg],
        timestamp: new Date(msg.createdAt),
      };
      groups.push(current);
    }
  }
  return groups;
}
