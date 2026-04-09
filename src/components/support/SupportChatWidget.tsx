"use client";

import { useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useSupportStore } from "@/stores/support-store";
import { ChatBubbleButton } from "@/features/support/components/ChatBubbleButton";
import { ChatWindow } from "@/features/support/components/ChatWindow";

export function SupportChatWidget() {
  const isOpen = useSupportStore((s) => s.isOpen);
  const isMinimized = useSupportStore((s) => s.isMinimized);
  const toggle = useSupportStore((s) => s.toggle);
  const open = useSupportStore((s) => s.open);
  const setPageContext = useSupportStore((s) => s.setPageContext);
  const openConversation = useSupportStore((s) => s.openConversation);
  const loadConversations = useSupportStore((s) => s.loadConversations);

  const pathname = usePathname();

  // Update page context from pathname
  useEffect(() => {
    if (pathname) {
      setPageContext(pathname);
    }
  }, [pathname, setPageContext]);

  // Deep link: ?support_conversation=ID
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get("support_conversation");
    if (conversationId) {
      openConversation(conversationId);
    }
  }, [openConversation]);

  // Load conversations on mount for unread count badge
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Keyboard shortcut: Ctrl+Shift+H to toggle
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "H") {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const showBubble = !isOpen;
  const showWindow = isOpen && !isMinimized;

  return (
    <>
      {/* Bubble button — fixed bottom-right */}
      <AnimatePresence>
        {showBubble && (
          <motion.div
            key="bubble"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              zIndex: 50,
            }}
          >
            <ChatBubbleButton onClick={open} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat window — fixed bottom-right, anchored to bottom */}
      <AnimatePresence>
        {showWindow && (
          <motion.div
            key="window"
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              zIndex: 50,
              transformOrigin: "bottom right",
            }}
          >
            <ChatWindow />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
