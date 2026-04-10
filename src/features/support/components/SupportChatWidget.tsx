"use client";

import { useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { useSupportStore } from "@/features/support/stores/support-store";
import { usePusherLiveChat } from "@/features/support/hooks/usePusherLiveChat";
import { ChatBubbleButton } from "@/features/support/components/ChatBubbleButton";
import { ChatWindow } from "@/features/support/components/ChatWindow";

/** Tailwind `sm` breakpoint — below this we treat viewport as mobile */
const MOBILE_BREAKPOINT = 640;

export function SupportChatWidget() {
  const { data: session } = useSession();
  // Always-on Pusher subscription so admin replies arrive in real time even
  // when the widget is closed/minimized or on a different view.
  usePusherLiveChat(session?.user?.id);

  const isOpen = useSupportStore((s) => s.isOpen);
  const isMinimized = useSupportStore((s) => s.isMinimized);
  const toggle = useSupportStore((s) => s.toggle);
  const open = useSupportStore((s) => s.open);
  const close = useSupportStore((s) => s.close);
  const setPageContext = useSupportStore((s) => s.setPageContext);
  const openConversation = useSupportStore((s) => s.openConversation);
  const loadConversations = useSupportStore((s) => s.loadConversations);

  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  // Update page context from pathname + close chat on mobile route change
  useEffect(() => {
    if (pathname) {
      setPageContext(pathname);
    }
    // Close the full-screen chat on mobile when the user navigates (e.g. via
    // the sidebar). Skip the initial mount so opening the chat page doesn't
    // immediately dismiss it.
    if (
      prevPathnameRef.current !== pathname &&
      typeof window !== "undefined" &&
      window.innerWidth < MOBILE_BREAKPOINT
    ) {
      close();
    }
    prevPathnameRef.current = pathname;
  }, [pathname, setPageContext, close]);

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

  // Hide the entire widget on the admin live-chat page — the admin inbox has
  // its own full-screen UI and the floating bubble/window would overlap the input.
  const onAdminLiveChat = pathname === "/dashboard/admin/live-chat";
  const showBubble = !isOpen && !onAdminLiveChat;
  const showWindow = isOpen && !isMinimized && !onAdminLiveChat;

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

      {/* Chat window — full-screen on mobile, fixed bottom-right on desktop */}
      <AnimatePresence>
        {showWindow && (
          <motion.div
            key="window"
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            className="fixed inset-0 z-50 sm:inset-auto sm:bottom-6 sm:right-6"
            style={{ transformOrigin: "bottom right" }}
          >
            <ChatWindow />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
