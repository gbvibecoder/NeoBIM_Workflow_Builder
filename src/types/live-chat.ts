// ─── Live Chat (human-to-human) shared types ────────────────────────────────

export type LiveChatStatus = "WAITING" | "ACTIVE" | "CLOSED";
export type LiveChatRole = "USER" | "ADMIN";

export interface LiveChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: LiveChatRole;
  senderName: string | null;
  content: string;
  createdAt: string;
}

export interface LiveChatConversation {
  id: string;
  userId: string;
  status: LiveChatStatus;
  lastMessageAt: string;
  lastAdminReplyAt: string | null;
  repliedByAdminId: string | null;
  repliedByName: string | null;
  closedByAdminId: string | null;
  closedAt: string | null;
  pageContext: string | null;
  userPlan: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

// Admin-side: enriched with user info + last-message preview
export interface AdminLiveChatConversation extends LiveChatConversation {
  userName: string | null;
  userEmail: string;
  lastMessage: {
    content: string;
    senderRole: LiveChatRole;
    senderName: string | null;
    createdAt: string;
  } | null;
}

// ─── Pusher event payload shapes ────────────────────────────────────────────

export interface PusherNewMessageEvent {
  conversationId: string;
  conversation: AdminLiveChatConversation | null; // present when conversation is brand-new
  message: LiveChatMessage;
}

export interface PusherReplyEvent {
  conversationId: string;
  message: LiveChatMessage;
}

export interface PusherStatusEvent {
  conversationId: string;
  status: LiveChatStatus;
  repliedByName?: string | null;
  closedByAdminId?: string | null;
  updatedAt: string;
}

export interface PusherTypingEvent {
  senderId: string;
  senderRole: LiveChatRole;
}
