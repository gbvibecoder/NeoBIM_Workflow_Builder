"use client";

import type { AdminLiveChatConversation } from "@/features/support/types/live-chat";
import { Avatar } from "./Avatar";
import s from "./admin-live-chat.module.css";

interface ThreadHeadProps {
  conversation: AdminLiveChatConversation;
  onClose: () => void;
}

export function ThreadHead({ conversation: c, onClose }: ThreadHeadProps) {
  return (
    <div className={s.threadHead}>
      <div className={s.threadHeadAvatar}>
        <Avatar
          name={c.userName}
          email={c.userEmail}
          userId={c.userId}
          size={44}
          withPresence
        />
      </div>
      <div className={s.threadHeadInfo}>
        <div className={s.threadHeadRow1}>
          <span className={s.threadHeadName}>
            {c.userName || c.userEmail}
          </span>
          {c.userPlan && (
            <span className={s.threadHeadPlan}>{c.userPlan}</span>
          )}
        </div>
        <div className={s.threadHeadRow2}>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.userEmail}
          </span>
          {c.pageContext && (
            <>
              <span>·</span>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains, monospace)",
                  fontSize: 10,
                }}
              >
                {c.pageContext}
              </span>
            </>
          )}
        </div>
      </div>
      <div className={s.threadHeadActions}>
        {c.status !== "CLOSED" && (
          <button
            className={s.threadHeadBtn}
            data-variant="close"
            onClick={onClose}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
