"use client";

import { motion } from "framer-motion";
import type { LiveChatMessage } from "@/features/support/types/live-chat";
import s from "./admin-live-chat.module.css";

function isImageMessage(content: string): boolean {
  return (
    /^https?:\/\/.*\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(
      content.trim(),
    ) || content.trim().startsWith("https://i.ibb.co/")
  );
}

interface MessageBubbleProps {
  message: LiveChatMessage;
  position: "first" | "mid" | "last" | "only";
}

export function MessageBubble({ message: m, position }: MessageBubbleProps) {
  const isOptimistic = m.id.startsWith("temp-");
  const posClass =
    position === "only"
      ? s.bubbleOnly
      : position === "first"
        ? s.bubbleFirst
        : position === "last"
          ? s.bubbleLast
          : s.bubbleMid;

  return (
    <motion.div
      className={`${s.bubble} ${posClass || ""} ${isOptimistic ? s.bubbleOptimistic : ""}`}
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: isOptimistic ? 0.85 : 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {isImageMessage(m.content) ? (
        <a href={m.content.trim()} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={m.content.trim()}
            alt="Shared image"
            className={s.bubbleImage}
          />
        </a>
      ) : (
        m.content
      )}
    </motion.div>
  );
}
