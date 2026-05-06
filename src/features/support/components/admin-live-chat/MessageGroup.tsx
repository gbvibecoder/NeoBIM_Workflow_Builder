"use client";

import type { MessageGroup as MG } from "@/features/support/lib/group-messages";
import { relTime } from "@/features/support/lib/rel-time";
import { MessageBubble } from "./MessageBubble";
import s from "./admin-live-chat.module.css";

interface MessageGroupProps {
  group: MG;
}

export function MessageGroupView({ group }: MessageGroupProps) {
  const last = group.messages[group.messages.length - 1];
  return (
    <div className={s.msgGroup} data-side={group.side}>
      <div className={s.msgGroupMeta}>
        <span className={s.msgGroupName}>
          {group.side === "admin" ? "You" : group.senderName || "User"}
        </span>
      </div>
      <div className={s.msgGroupBubbles}>
        {group.messages.map((m, idx) => {
          const len = group.messages.length;
          const position: "first" | "mid" | "last" | "only" =
            len === 1
              ? "only"
              : idx === 0
                ? "first"
                : idx === len - 1
                  ? "last"
                  : "mid";
          return (
            <MessageBubble key={m.id} message={m} position={position} />
          );
        })}
      </div>
      <div
        className={s.msgGroupTime}
        title={new Date(last.createdAt).toLocaleString()}
      >
        {relTime(last.createdAt)}
      </div>
    </div>
  );
}
