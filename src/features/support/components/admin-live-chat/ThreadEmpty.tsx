"use client";

import { MessageSquare } from "lucide-react";
import s from "./admin-live-chat.module.css";

export function ThreadEmpty() {
  return (
    <div className={s.threadEmpty}>
      <div className={s.threadEmptyIcon}>
        <MessageSquare size={36} style={{ color: "var(--lc-accent)" }} />
      </div>
      <div>
        <p className={s.threadEmptyTitle}>Select a conversation</p>
        <p className={s.threadEmptyDesc}>
          Choose a thread from the left panel to start replying.
          <br />
          New messages from users will appear automatically.
        </p>
      </div>
    </div>
  );
}
