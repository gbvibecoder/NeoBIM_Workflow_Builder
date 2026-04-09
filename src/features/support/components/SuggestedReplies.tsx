"use client";

import { motion } from "framer-motion";
import { useSupportStore } from "@/stores/support-store";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const chipVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

const TALK_TO_TEAM = "Talk to our team";

interface SuggestedRepliesProps {
  /** Pass suggestions directly, or omit to read from store. */
  suggestions?: string[];
}

export function SuggestedReplies({ suggestions: suggestionsProp }: SuggestedRepliesProps) {
  const storeSuggestions = useSupportStore((s) => s.suggestions);
  const sendMessage = useSupportStore((s) => s.sendMessage);
  const isSending = useSupportStore((s) => s.isSending);

  const suggestions = suggestionsProp ?? storeSuggestions;

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      style={{
        display: "flex",
        gap: 8,
        padding: "6px 16px 8px",
        overflowX: "auto",
        overflowY: "hidden",
        scrollbarWidth: "none",
        flexShrink: 0,
      }}
    >
      {suggestions.map((text) => {
        const isTalkToTeam =
          text.toLowerCase() === TALK_TO_TEAM.toLowerCase();

        return (
          <motion.button
            key={text}
            variants={chipVariants}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => {
              if (!isSending) {
                sendMessage(text);
              }
            }}
            disabled={isSending}
            style={{
              flexShrink: 0,
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.4,
              cursor: isSending ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              border: isTalkToTeam
                ? "1px solid rgba(79, 138, 255, 0.5)"
                : "1px solid rgba(107, 114, 128, 0.2)",
              backgroundColor: isTalkToTeam
                ? "transparent"
                : "rgba(79, 138, 255, 0.1)",
              color: isTalkToTeam ? "#4F8AFF" : "#D1D5DB",
              transition: "background-color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isSending) {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.backgroundColor = isTalkToTeam
                  ? "rgba(79, 138, 255, 0.1)"
                  : "rgba(79, 138, 255, 0.2)";
              }
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.backgroundColor = isTalkToTeam
                ? "transparent"
                : "rgba(79, 138, 255, 0.1)";
            }}
          >
            {text}
          </motion.button>
        );
      })}
    </motion.div>
  );
}
