"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSupportStore } from "@/stores/support-store";
import { ChatHeader } from "./ChatHeader";
import ConversationListView from "./ConversationListView";
import { MessageThread } from "./MessageThread";
import { ChatInput } from "./ChatInput";
import { SuggestedReplies } from "./SuggestedReplies";
import EscalationBanner from "./EscalationBanner";
import SatisfactionRating from "./SatisfactionRating";
import WelcomeScreen from "./WelcomeScreen";
import LiveChatView from "./LiveChatView";
import { useLiveChatStore } from "@/stores/live-chat-store";
import type { SupportMessage } from "@/types/support";

type ViewMode = "welcome" | "list" | "chat" | "rating" | "live-chat";

const viewInitial = { opacity: 0, x: 20 };
const viewAnimate = { opacity: 1, x: 0 };
const viewExit = { opacity: 0, x: -20 };
const viewTransitionConfig = { duration: 0.2, ease: "easeInOut" as const };

// Empty array constant — avoids creating new reference each render
const EMPTY_MESSAGES: SupportMessage[] = [];

export function ChatWindow() {
  const activeConversationId = useSupportStore((s) => s.activeConversationId);
  const hasConversations = useSupportStore((s) => s.conversations.length > 0);
  const isSending = useSupportStore((s) => s.isSending);
  const isLoading = useSupportStore((s) => s.isLoading);
  const suggestions = useSupportStore((s) => s.suggestions);
  const loadConversations = useSupportStore((s) => s.loadConversations);
  const chatView = useSupportStore((s) => s.chatView);
  const setChatView = useSupportStore((s) => s.setChatView);
  const closeLiveChat = useLiveChatStore((s) => s.closeLiveChat);

  // Select only the primitive fields we need — avoids returning a new object reference
  const activeConvStatus = useSupportStore((s) => {
    if (!s.activeConversationId) return null;
    return s.conversations.find((c) => c.id === s.activeConversationId)?.status ?? null;
  });
  const activeConvSatisfaction = useSupportStore((s) => {
    if (!s.activeConversationId) return null;
    return s.conversations.find((c) => c.id === s.activeConversationId)?.satisfaction ?? null;
  });

  // Stable selector: only re-renders when messages for the active conversation change
  const activeMessages = useSupportStore((s) => {
    const id = s.activeConversationId;
    if (id) return s.messages[id] ?? EMPTY_MESSAGES;
    return s.messages[""] ?? EMPTY_MESSAGES;
  });

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // View override: "welcome" forces welcome screen, "list" forces list, null = auto
  const [viewOverride, setViewOverride] = useState<"list" | "welcome" | null>(null);

  // Reset override when entering a conversation or sending
  useEffect(() => {
    if (activeConversationId || isSending) {
      setViewOverride(null);
    }
  }, [activeConversationId, isSending]);

  // Derive current view
  const currentView: ViewMode = (() => {
    if (chatView === "live-chat") return "live-chat";
    if (activeConversationId) {
      if (activeConvStatus === "RESOLVED" && activeConvSatisfaction === null) {
        return "rating";
      }
      return "chat";
    }
    if (isSending || activeMessages.length > 0) {
      return "chat";
    }
    if (hasConversations) {
      return "list";
    }
    return "welcome";
  })();

  // chatView === "live-chat" must win over viewOverride so that clicking the
  // "Live Chat with Us" card from the list-→welcome override path still routes
  // into the live-chat view instead of getting stuck on "welcome".
  const resolvedView: ViewMode =
    chatView === "live-chat" ? "live-chat" : (viewOverride ?? currentView);

  // Whether we're in the chat view (either with an active conversation or pending send)
  const inChatView = resolvedView === "chat";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        maxHeight: "calc(100vh - 48px)",
        borderRadius: 16,
        backgroundColor: "#111120",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow:
          "0 24px 48px rgba(0, 0, 0, 0.5), 0 8px 16px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
      className="sm:!w-[420px] sm:!h-[600px] sm:!max-h-[calc(100vh-48px)]"
    >
      {/* Header */}
      <ChatHeader
        status={activeConvStatus}
        showBack={inChatView || resolvedView === "rating" || resolvedView === "live-chat"}
        onBack={() => {
          if (resolvedView === "live-chat") {
            closeLiveChat();
            setChatView(null);
            setViewOverride("welcome");
          } else {
            setViewOverride("list");
          }
        }}
      />

      {/* Content area */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", minHeight: 0 }}>
        <AnimatePresence mode="wait">
          {resolvedView === "welcome" && (
            <motion.div
              key="welcome"
              initial={viewInitial}
              animate={viewAnimate}
              exit={viewExit}
              transition={viewTransitionConfig}
              style={{ height: "100%", overflow: "auto" }}
            >
              <WelcomeScreen />
            </motion.div>
          )}

          {resolvedView === "list" && (
            <motion.div
              key="list"
              initial={viewInitial}
              animate={viewAnimate}
              exit={viewExit}
              transition={viewTransitionConfig}
              style={{ height: "100%", overflow: "auto" }}
            >
              <ConversationListView onNewConversation={() => setViewOverride("welcome")} />
            </motion.div>
          )}

          {resolvedView === "chat" && (
            <motion.div
              key="chat"
              initial={viewInitial}
              animate={viewAnimate}
              exit={viewExit}
              transition={viewTransitionConfig}
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              {/* Escalation banner */}
              {activeConversationId && <EscalationBanner />}

              {/* Message thread */}
              <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                <MessageThread messages={activeMessages} showTyping={isSending} />
              </div>

              {/* Suggested replies */}
              {suggestions.length > 0 && !isSending && <SuggestedReplies />}

              {/* Chat input */}
              {activeConvStatus !== "CLOSED" &&
                activeConvStatus !== "RESOLVED" && (
                  <ChatInput conversationStatus={activeConvStatus ?? undefined} />
                )}
            </motion.div>
          )}

          {resolvedView === "live-chat" && (
            <motion.div
              key="live-chat"
              initial={viewInitial}
              animate={viewAnimate}
              exit={viewExit}
              transition={viewTransitionConfig}
              style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}
            >
              <LiveChatView />
            </motion.div>
          )}

          {resolvedView === "rating" && activeConversationId && (
            <motion.div
              key="rating"
              initial={viewInitial}
              animate={viewAnimate}
              exit={viewExit}
              transition={viewTransitionConfig}
              style={{ height: "100%", overflow: "auto" }}
            >
              <SatisfactionRating
                onClose={() => {
                  setViewOverride("list");
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading overlay */}
        {isLoading && !hasConversations && !isSending && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(17, 17, 32, 0.8)",
            }}
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "2px solid rgba(99, 102, 241, 0.3)",
                borderTopColor: "#6366f1",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
