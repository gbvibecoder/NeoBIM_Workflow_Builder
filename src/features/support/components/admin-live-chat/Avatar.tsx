"use client";

import { initials, avatarColorIndex } from "@/features/support/lib/avatar";
import s from "./admin-live-chat.module.css";

const AV = [s.avC0, s.avC1, s.avC2, s.avC3, s.avC4, s.avC5, s.avC6, s.avC7];

interface AvatarProps {
  name: string | null;
  email: string;
  userId: string;
  size?: number;
  withPresence?: boolean;
}

export function Avatar({
  name,
  email,
  userId,
  size = 44,
  withPresence,
}: AvatarProps) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div
        className={`${s.avatar} ${AV[avatarColorIndex(userId)]}`}
        style={{ width: size, height: size, fontSize: size * 0.32 }}
      >
        {initials(name, email)}
      </div>
      {withPresence && <span className={s.avatarPresence} />}
    </div>
  );
}
