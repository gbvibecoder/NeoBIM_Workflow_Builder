"use client";

import { useEffect, useRef } from "react";
import type { LiveChatMessage } from "@/features/support/types/live-chat";
import { groupConsecutiveMessages } from "@/features/support/lib/group-messages";
import { DateDivider } from "./DateDivider";
import { MessageGroupView } from "./MessageGroup";
import s from "./admin-live-chat.module.css";

interface MessageListProps {
  messages: LiveChatMessage[];
  isLoading: boolean;
}

type Item =
  | { type: "divider"; date: Date; key: string }
  | {
      type: "group";
      group: ReturnType<typeof groupConsecutiveMessages>[number];
      key: string;
    };

export function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const groups = groupConsecutiveMessages(messages);

  const items: Item[] = [];
  let lastDay = "";

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const d = new Date(g.messages[0].createdAt);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dayKey !== lastDay) {
      items.push({ type: "divider", date: d, key: `div-${dayKey}` });
      lastDay = dayKey;
    }
    items.push({ type: "group", group: g, key: `grp-${gi}` });
  }

  return (
    <div className={s.messages}>
      {isLoading && messages.length === 0 && (
        <div className={s.emptyMessages}>Loading messages…</div>
      )}
      {!isLoading && messages.length === 0 && (
        <div className={s.emptyMessages}>No messages yet</div>
      )}
      {items.map((item) =>
        item.type === "divider" ? (
          <DateDivider key={item.key} date={item.date} />
        ) : (
          <MessageGroupView key={item.key} group={item.group} />
        ),
      )}
      <div ref={bottomRef} />
    </div>
  );
}
