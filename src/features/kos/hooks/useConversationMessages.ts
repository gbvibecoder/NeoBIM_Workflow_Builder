"use client";

/**
 * 5I PR 4b2 — useConversationMessages
 *
 * Fetches the past `KosMessage` rows for a conversation and maps them
 * to `UIMessage` shapes for direct merge into ChatSurface's existing
 * `messages` state. The merge itself happens in ChatSurface (a
 * seeded-once useEffect that prepends history without clobbering any
 * SSE messages that arrived during the fetch).
 *
 * Behaviour:
 *  - `conversationId` is null/undefined → immediate idle return; no
 *    fetch fires (covers the "fresh anonymous customer, no prior
 *    activity" case)
 *  - `conversationId` change OR initial mount with a value → fetch
 *  - Re-render with the SAME conversationId → no refetch
 *    (`lastFetchedIdRef` gate)
 *  - AbortController cancels in-flight fetch on unmount + on
 *    conversationId change mid-flight
 *  - 404 from the endpoint = "no history" (set messages=[], error=null).
 *    This is the graceful path for a stale `currentConversationId`
 *    pointing to a deleted conversation: ChatSurface falls back to
 *    the welcome state with no error UI.
 *  - Non-404 errors set `error` so ChatSurface can surface them.
 *  - Network throw (offline, DNS fail) sets a generic error.
 */

import { useEffect, useRef, useState } from "react";

import type { UIMessage } from "@/features/kos/types/chat";
import type { KosConversationMessagesResponse } from "@/features/kos/types/conversation-message";

export interface UseConversationMessagesResult {
  messages: UIMessage[];
  loading: boolean;
  error: string | null;
}

export function useConversationMessages(
  conversationId: string | null | undefined,
): UseConversationMessagesResult {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(conversationId != null);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (lastFetchedIdRef.current === conversationId) {
      // Same conversation already fetched this mount — no-op.
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/kos/customer/conversations/${encodeURIComponent(conversationId)}/messages`,
          { credentials: "include", signal: controller.signal },
        );
        if (controller.signal.aborted) return;

        if (!res.ok) {
          if (res.status === 404) {
            // Stale currentConversationId or simply a conversation
            // the customer no longer owns. Treat as empty history.
            setMessages([]);
            setError(null);
          } else {
            const body = await res
              .json()
              .catch(() => ({} as Record<string, unknown>));
            const msg =
              typeof body.message === "string"
                ? body.message
                : `Failed to load conversation history (HTTP ${res.status}).`;
            setError(msg);
            setMessages([]);
          }
          lastFetchedIdRef.current = conversationId;
          setLoading(false);
          return;
        }

        const data = (await res.json()) as KosConversationMessagesResponse;
        if (controller.signal.aborted) return;

        const uiMessages: UIMessage[] = data.messages.map(
          (m) =>
            ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
              attachmentRefs: m.attachmentRefs,
              citations: m.citations ?? undefined,
            }) as UIMessage,
        );

        lastFetchedIdRef.current = conversationId;
        setMessages(uiMessages);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        // AbortError from a racing controller.abort() may still arrive
        // here even with the aborted guard above; check by name too.
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (isAbort) return;
        // eslint-disable-next-line no-console
        console.warn("[kos] useConversationMessages fetch failed", err);
        setError(
          err instanceof Error && err.message
            ? `Failed to load conversation history: ${err.message}`
            : "Failed to load conversation history.",
        );
        setMessages([]);
        setLoading(false);
        lastFetchedIdRef.current = conversationId;
      }
    })();

    return () => {
      controller.abort();
    };
  }, [conversationId]);

  return { messages, loading, error };
}
