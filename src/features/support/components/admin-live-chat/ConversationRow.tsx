"use client";

import type { AdminLiveChatConversation } from "@/features/support/types/live-chat";
import { relTime } from "@/features/support/lib/rel-time";
import { Avatar } from "./Avatar";
import s from "./admin-live-chat.module.css";

interface ConversationRowProps {
  conversation: AdminLiveChatConversation;
  isActive: boolean;
  unreadCount: number;
  onClick: () => void;
}

export function ConversationRow({
  conversation: c,
  isActive,
  unreadCount,
  onClick,
}: ConversationRowProps) {
  const isUnread = unreadCount > 0;
  return (
    <button
      className={s.convRow}
      data-active={isActive}
      data-unread={isUnread}
      onClick={onClick}
    >
      <div className={s.convAvatar}>
        <Avatar
          name={c.userName}
          email={c.userEmail}
          userId={c.userId}
          size={44}
        />
      </div>
      <div className={s.convBody}>
        <div className={s.convRowTop}>
          <span className={s.convName}>
            {c.userName || c.userEmail}
          </span>
          <span className={s.convTime}>{relTime(c.lastMessageAt)}</span>
        </div>
        <div className={s.convRowBottom}>
          <span className={s.convPreview}>
            {c.lastMessage ? (
              <>
                {c.lastMessage.senderRole === "ADMIN" && (
                  <span className={s.convPreviewPrefix}>You: </span>
                )}
                {c.lastMessage.content}
              </>
            ) : (
              "No messages yet"
            )}
          </span>
          {isUnread ? (
            <span className={s.convUnread}>{unreadCount}</span>
          ) : (
            <span className={s.convStatus} data-status={c.status}>
              {c.status}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
