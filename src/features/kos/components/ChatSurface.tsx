"use client";

/**
 * Kalzen customer chat surface.
 *
 * Consumes the existing SSE endpoint `POST /api/kos/customer/chat`.
 * Owns the full client transcript, the streaming reader (so it can
 * cancel on unmount or via the Stop button), scroll behaviour, the
 * escalation banner, and per-message inline error recovery. The bot
 * brain, retrieval, citations and persistence all live server-side —
 * this component is purely the face.
 *
 * Brand: inherits the per-tenant CSS vars `--kos-primary` (deep green)
 * and `--kos-secondary` (gold) injected by the `(kos)` layout, with the
 * Kalzen fallbacks used across the BD console (#0a3d2e / #c9a55a).
 *
 * Performance: streamed text is flushed to React state at most once per
 * animation frame (~60fps) rather than per token, and message rows are
 * `memo`'d so unchanged turns don't re-render on each stream tick.
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useKosCustomer } from "./CustomerSessionProvider";
import { BotMessage } from "./BotMessage";
import { KosSseDecoder } from "@/features/kos/lib/kos-sse";
import type { KosBotEvent, UIMessage } from "@/features/kos/types/chat";
import {
  useChatAttachments,
  type AttachmentState,
} from "@/features/kos/hooks/useChatAttachments";
import {
  ArtifactBubble,
  type ArtifactBubbleState,
} from "./ArtifactBubble";
import { useDrawingArtifactHydration } from "@/features/kos/hooks/useDrawingArtifactHydration";
import { useConversationMessages } from "@/features/kos/hooks/useConversationMessages";

const GOLD = "var(--kos-secondary, #c9a55a)";
const GREEN = "var(--kos-primary, #0a3d2e)";
const MAX_CHARS = 2000;
const SHOW_COUNTER_AT = 1500;
const WARN_CHARS = 1900;
const NEAR_BOTTOM_PX = 100;
const SCROLL_THROTTLE_MS = 100;
const CHAT_ENDPOINT = "/api/kos/customer/chat";
const SESSION_START_ENDPOINT = "/api/kos/customer/session/start";

const SUGGESTED_PROMPTS = [
  "What makes Kalzen different from Mivan?",
  "Is Kalzen BMTPC approved?",
  "What is the warranty period?",
];

const WELCOME_COPY =
  "Hi! I'm the Kalzen assistant. Ask me about our precast formwork products, " +
  "certifications, comparisons, or specifications. For project-specific quotes, " +
  "I can connect you with our team.";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Namespaced keyframes + a small responsive sheet. Inline `animation`
 * can't reference Tailwind's utility keyframes, and inline styles can't
 * hold media queries — so the responsive bits live here as classes.
 */
const KOS_STYLES = `
@keyframes kos-spin { to { transform: rotate(360deg); } }
@keyframes kos-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes kos-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.15; } }
.kos-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.kos-cust-bubble { max-width: 72%; }
.kos-bot-bubble { max-width: 85%; }
.kos-send:not(:disabled):hover { filter: brightness(1.07); }
.kos-ghost:hover { background: rgba(201,165,90,0.12) !important; }
.kos-chip:hover { background: rgba(201,165,90,0.16) !important; }
@media (max-width: 600px) {
  .kos-cust-bubble { max-width: 90%; }
  .kos-bot-bubble { max-width: 90%; }
}
@media (max-width: 520px) {
  .kos-header { flex-direction: column; align-items: stretch; gap: 10px; }
  .kos-th-btn { align-self: flex-end; }
  .kos-send-label { display: none; }
}
/* ── 5I PR 1 attachment + drop-zone keyframes ────────────────── */
@keyframes kos-attach-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.kos-attach-bubble {
  animation: kos-attach-fade-in 0.18s ease-out;
}
@keyframes kos-drop-pulse {
  0%, 100% { border-color: rgba(201,165,90,1); }
  50%      { border-color: rgba(201,165,90,0.5); }
}
.kos-drop-overlay {
  animation: kos-drop-pulse 1.4s infinite ease-in-out;
}
@keyframes kos-progress-stripe {
  from { background-position: 0 0; }
  to   { background-position: 40px 0; }
}
.kos-progress-bar { position: relative; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }
.kos-progress-bar > .fill {
  position: absolute; inset: 0 auto 0 0;
  background: linear-gradient(90deg, rgba(201,165,90,1), rgba(201,165,90,1) 50%, rgba(255,255,255,0.18) 50%, rgba(201,165,90,1));
  background-size: 40px 6px;
  animation: kos-progress-stripe 0.8s linear infinite;
  transition: width 0.18s ease-out;
}
.kos-paperclip:not(:disabled):hover { background: rgba(201,165,90,0.12) !important; }
.kos-attach-action:hover { background: rgba(201,165,90,0.16) !important; }
@media (pointer: coarse) {
  .kos-drop-overlay { display: none; }
}
`;

function KosStyles() {
  return <style>{KOS_STYLES}</style>;
}

export default function ChatSurface({ tenantName }: { tenantName: string }) {
  const { customer, isLoading, error: sessionError, retry } = useKosCustomer();

  const [messages, setMessages] = useState<UIMessage[]>([]);
  // 5I PR 3 — live drawing-progress state keyed by drawingId. SSE
  // events upsert into this map; ArtifactBubble re-renders from props.
  // 5I PR 4 — additionally hydrated with real download URLs via the
  // useDrawingArtifactHydration hook (below). SSE state takes priority
  // over hydration — see hook implementation for the merge rules.
  const [drawingArtifacts, setDrawingArtifacts] = useState<
    Record<string, ArtifactBubbleState>
  >({});
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const [escalationDismissed, setEscalationDismissed] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  // ── Refs the streaming loop reads/writes synchronously ───────────────
  const conversationIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const lastSentRef = useRef<string | null>(null);

  // ── 5I PR 4b2 — reload-hydration ─────────────────────────────────────
  // Read the customer's locator pointer (PR 4b1) and fetch past messages
  // so a refresh restores the transcript + ArtifactBubbles + downloads.
  const hydrationConversationId = customer?.currentConversationId ?? null;
  const historical = useConversationMessages(hydrationConversationId);
  // Ensures the merge-not-replace seed runs at most once per mount,
  // so SSE messages added after the first seed cannot be clobbered by
  // a delayed re-render of the hook's result.
  const seededRef = useRef(false);

  // rAF-throttled streamed-text accumulator.
  const streamTextRef = useRef("");
  const streamingBotIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const lastScrollRef = useRef(0);
  const scrollTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ── 5I PR 1 attachments — paperclip + drop zone ──────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  // ── Scroll management ────────────────────────────────────────────────
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    isNearBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  const maybeAutoScroll = useCallback(() => {
    if (!isNearBottomRef.current) return;
    const now = Date.now();
    const doScroll = () => {
      lastScrollRef.current = Date.now();
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    if (now - lastScrollRef.current > SCROLL_THROTTLE_MS) {
      doScroll();
    } else if (scrollTimerRef.current == null) {
      scrollTimerRef.current = window.setTimeout(() => {
        scrollTimerRef.current = null;
        doScroll();
      }, SCROLL_THROTTLE_MS);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < NEAR_BOTTOM_PX;
    isNearBottomRef.current = near;
    setShowScrollButton(!near && el.scrollHeight > el.clientHeight + 40);
  }, []);

  // ── rAF-throttled flush of streamed text into the active bot message ──
  const cancelRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const applyStreamText = useCallback(() => {
    const id = streamingBotIdRef.current;
    if (!id) return;
    const text = streamTextRef.current;
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: text } : m)),
    );
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyStreamText();
      maybeAutoScroll();
    });
  }, [applyStreamText, maybeAutoScroll]);

  // ── Cleanup on unmount: cancel any in-flight stream + timers ─────────
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void readerRef.current?.cancel().catch(() => {});
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (scrollTimerRef.current != null) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  // ── 5I PR 4b2 — seed local messages from historical fetch (once) ─────
  // CRITICAL: this merge-not-replace path runs at most once per mount.
  // If a customer's SSE stream pushed new messages while the fetch was
  // in flight (race: typing + Send during the loading state), the local
  // state already holds them — historical entries get prepended with
  // de-dup by id, never overwriting the local list. seededRef latches
  // the moment the fetch resolves (success OR empty) so subsequent
  // re-renders from the hook (e.g. the result memo changing identity)
  // cannot trigger a second merge.
  useEffect(() => {
    if (seededRef.current) return;
    if (historical.loading) return;
    seededRef.current = true;
    if (historical.messages.length === 0) return;
    setMessages((currentLocal) => {
      const localIds = new Set(currentLocal.map((m) => m.id));
      const merged = historical.messages.filter((m) => !localIds.has(m.id));
      return [...merged, ...currentLocal];
    });
    if (hydrationConversationId && !conversationIdRef.current) {
      conversationIdRef.current = hydrationConversationId;
    }
  }, [historical.loading, historical.messages, hydrationConversationId]);

  const markBotError = useCallback(
    (botId: string, code: string, errorText?: string) => {
      cancelRaf();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? {
                ...m,
                isStreaming: false,
                isError: true,
                errorCode: code,
                errorText: errorText ?? "Connection interrupted. Try again?",
                content: m.content || streamTextRef.current,
              }
            : m,
        ),
      );
    },
    [cancelRaf],
  );

  // ── Per-event reducer ────────────────────────────────────────────────
  const applyEvent = useCallback(
    (event: KosBotEvent, botId: string) => {
      switch (event.type) {
        case "text_delta": {
          // React bails out when the value is unchanged, so an
          // unconditional null set is cheap and avoids reading
          // `toolActivity` (which would churn this callback).
          setToolActivity(null);
          streamTextRef.current += event.text;
          scheduleFlush();
          break;
        }
        case "tool_call_start": {
          setToolActivity(
            event.tool === "retrieve_documents"
              ? "Searching Kalzen documents…"
              : `Running ${event.tool}…`,
          );
          break;
        }
        case "tool_call_result": {
          setToolActivity(null);
          break;
        }
        case "citations": {
          const { citations } = event;
          setMessages((prev) =>
            prev.map((m) => (m.id === botId ? { ...m, citations } : m)),
          );
          break;
        }
        case "escalation": {
          setEscalated(true);
          setEscalationDismissed(false);
          break;
        }
        case "done": {
          cancelRaf();
          conversationIdRef.current =
            event.conversationId || conversationIdRef.current;
          const finalText = streamTextRef.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botId
                ? {
                    ...m,
                    id: event.messageId || m.id,
                    isStreaming: false,
                    content: finalText || m.content,
                  }
                : m,
            ),
          );
          break;
        }
        case "error": {
          setToolActivity(null);
          markBotError(botId, event.code, event.message);
          break;
        }
        // ─── 5I PR 3 — drawing progress events ────────────────────
        case "drawing_status": {
          const { drawingId } = event;
          setDrawingArtifacts((prev) => {
            const cur = prev[drawingId];
            if (!cur) {
              // SSE event arrived for a drawing we don't have a bubble
              // for (e.g., bot processing a stale ref). Quietly add it
              // — the bubble will appear underneath whatever message
              // can claim it, or just float orphaned. Safer than
              // dropping the event and leaving the UI confused.
              return {
                ...prev,
                [drawingId]: {
                  drawingId,
                  filename: drawingId, // fallback — no display name yet
                  status: event.status,
                  message: event.message,
                  errorCode: event.errorCode,
                  errorMessage: event.errorMessage,
                  summary: event.summary,
                },
              };
            }
            return {
              ...prev,
              [drawingId]: {
                ...cur,
                status: event.status,
                message: event.message ?? cur.message,
                errorCode: event.errorCode ?? cur.errorCode,
                errorMessage: event.errorMessage ?? cur.errorMessage,
                summary: event.summary ?? cur.summary,
              },
            };
          });
          break;
        }
        case "artifact_ready": {
          const { drawingId, kind } = event;
          setDrawingArtifacts((prev) => {
            const cur = prev[drawingId] ?? {
              drawingId,
              filename: drawingId,
              status: "PROCESSING_PARSE" as const,
            };
            return {
              ...prev,
              [drawingId]: {
                ...cur,
                [kind]: { s3Key: event.s3Key, summary: event.summary },
              },
            };
          });
          break;
        }
        case "artifact_failed": {
          const { drawingId, kind } = event;
          setDrawingArtifacts((prev) => {
            const cur = prev[drawingId] ?? {
              drawingId,
              filename: drawingId,
              status: "PROCESSING_PARSE" as const,
            };
            const errKey = kind === "boq" ? "boqError" : "formworkError";
            return {
              ...prev,
              [drawingId]: {
                ...cur,
                [errKey]: {
                  errorCode: event.errorCode,
                  errorMessage: event.errorMessage,
                },
              },
            };
          });
          break;
        }
        case "classification_needed": {
          const { drawingId } = event;
          setDrawingArtifacts((prev) => {
            const cur = prev[drawingId] ?? {
              drawingId,
              filename: drawingId,
              status: "NEEDS_CLASSIFICATION" as const,
            };
            return {
              ...prev,
              [drawingId]: {
                ...cur,
                status: "NEEDS_CLASSIFICATION",
                message: event.message,
              },
            };
          });
          break;
        }
      }
    },
    [scheduleFlush, cancelRaf, markBotError],
  );

  // ── Re-bootstrap helper for 401 recovery ─────────────────────────────
  const reBootstrapSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(SESSION_START_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // ── 5I PR 1 — drawing attachments (paperclip + drop zone) ────────────
  // Pass the current conversationId at render time. The hook captures
  // the value via useCallback deps — each render with a new
  // conversationId rebuilds the upload closures. reBootstrapSession's
  // Promise<boolean> return is assignable to Promise<unknown> per the
  // hook's signature (the boolean is discarded).
  const attachments = useChatAttachments({
    conversationId: conversationIdRef.current,
    reBootstrapSession,
  });

  // 5I PR 4 — Hydrate drawing artifacts with real download URLs by
  // fetching the per-drawing summary endpoint whenever a customer
  // message carries `attachmentRefs`. Idempotent (de-duped by id);
  // SSE-fresh state is preserved (status === COMPLETE not regressed).
  useDrawingArtifactHydration(messages, setDrawingArtifacts);

  // ── The streaming send ───────────────────────────────────────────────
  const runStream = useCallback(
    async (
      message: string,
      botId: string,
      attachmentRefs: string[] | undefined,
      retried = false,
    ): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationIdRef.current,
            message,
            // 5I PR 3 — forward drawing refs to the server so the bot
            // tools can process them. Server validates ownership.
            ...(attachmentRefs && attachmentRefs.length > 0
              ? { attachmentRefs }
              : {}),
          }),
          signal: controller.signal,
        });

        // Session expired mid-conversation → re-bootstrap + retry once.
        if (res.status === 401 && !retried) {
          const ok = await reBootstrapSession();
          if (ok) {
            return runStream(message, botId, attachmentRefs, true);
          }
          markBotError(
            botId,
            "KOS_CHAT_001",
            "Your session expired. Try again?",
          );
          return;
        }

        if (!res.ok || !res.body) {
          let code = `HTTP_${res.status}`;
          let msg = `Request failed (HTTP ${res.status}).`;
          try {
            const j = await res.json();
            code = j?.error?.code ?? code;
            msg = j?.error?.message ?? msg;
          } catch {
            /* non-JSON error body */
          }
          if (res.status === 400) {
            setInputError(msg);
            markBotError(botId, code, "That message couldn't be sent.");
          } else {
            markBotError(botId, code, "Something went wrong. Try again?");
          }
          return;
        }

        const reader = res.body.getReader();
        readerRef.current = reader;
        const decoder = new KosSseDecoder();

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            for (const event of decoder.decode(value)) {
              applyEvent(event, botId);
            }
          }
        }
        for (const event of decoder.flush()) {
          applyEvent(event, botId);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // Cancelled by Stop / navigating away / re-sending — keep
          // whatever streamed so far, just stop.
          cancelRaf();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botId && m.isStreaming
                ? {
                    ...m,
                    isStreaming: false,
                    content:
                      streamTextRef.current || m.content || "Message stopped.",
                  }
                : m,
            ),
          );
        } else {
          const detail = err instanceof Error ? err.message : String(err);
          console.warn("[kos-chat] stream error:", detail);
          markBotError(botId, "NET_001", "Connection interrupted. Try again?");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        readerRef.current = null;
        setIsStreaming(false);
        isStreamingRef.current = false;
        setToolActivity(null);
        // Return focus to the composer once the turn settles.
        textareaRef.current?.focus();
      }
    },
    [applyEvent, reBootstrapSession, markBotError, cancelRaf],
  );

  const sendMessage = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      // 5I PR 1 — if the customer has only attached a drawing and
      // typed no text, ship a friendly placeholder so the existing
      // chat route's empty-message validator stays happy. PR 2 will
      // wire attachmentRefs into the POST body and the bot tool will
      // surface the drawing directly — at which point this default
      // becomes irrelevant.
      const hasUploadedAttachment = attachments.pendingAttachments.length > 0;
      const text =
        trimmed.length > 0
          ? trimmed
          : hasUploadedAttachment
            ? "I've shared a drawing — please take a look."
            : "";
      if (text.length < 1) {
        setInputError("Type a message before sending.");
        return;
      }
      if (text.length > MAX_CHARS) {
        setInputError(
          `Message is ${text.length} characters; the limit is ${MAX_CHARS}.`,
        );
        return;
      }

      // Defensive: the UI shows Stop (not Send) while streaming, but if a
      // second send slips through, abort the previous stream first.
      if (isStreamingRef.current) {
        abortRef.current?.abort();
      }

      setInputError(null);

      // 5I PR 3 — capture attachment metadata BEFORE clearing.
      // drainPending returns the uploaded drawingIds (failed/in-flight
      // attachments are left in place by drainPending).
      const refs = attachments.drainPending();
      const pendingNow = attachments.pendingAttachments;
      const attachmentDisplay = refs.map((r) => {
        const matched = pendingNow.find((a) => a.drawingId === r.drawingId);
        return {
          drawingId: r.drawingId,
          filename:
            matched?.originalFilename ?? matched?.filename ?? r.drawingId,
        };
      });
      const attachmentRefs = refs.map((r) => r.drawingId);

      const customerMsg: UIMessage = {
        id: genId(),
        role: "customer",
        content: text,
        timestamp: Date.now(),
        ...(attachmentRefs.length > 0 ? { attachmentRefs, attachmentDisplay } : {}),
      };
      const botId = genId();
      const botMsg: UIMessage = {
        id: botId,
        role: "bot",
        content: "",
        isStreaming: true,
        timestamp: Date.now(),
      };

      // Reset the streamed-text accumulator for this turn.
      cancelRaf();
      streamTextRef.current = "";
      streamingBotIdRef.current = botId;

      // 5I PR 3 — seed initial ArtifactBubble state for each attachment
      // so the bubble shows "Parsing…" immediately, before any SSE
      // event arrives. Filename comes from the attachment state.
      if (attachmentRefs.length > 0) {
        setDrawingArtifacts((prev) => {
          const next = { ...prev };
          for (const r of attachmentDisplay) {
            next[r.drawingId] = {
              drawingId: r.drawingId,
              filename: r.filename,
              status: "PROCESSING_PARSE",
            };
          }
          return next;
        });
      }

      setMessages((prev) => [...prev, customerMsg, botMsg]);
      setInput("");
      setShowSuggestions(false);
      lastSentRef.current = text;
      setIsStreaming(true);
      isStreamingRef.current = true;

      // We just sent — pin to bottom.
      isNearBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom(true));

      if (textareaRef.current) textareaRef.current.style.height = "auto";

      void runStream(text, botId, attachmentRefs.length > 0 ? attachmentRefs : undefined);

      // 5I PR 1+3 — clear any remaining attachments (failed / cancelled)
      // from the composer. The pending refs we sent are already drained
      // by drainPending() above; this clear() catches edge cases.
      attachments.clear();
    },
    [runStream, scrollToBottom, cancelRaf, attachments],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    void readerRef.current?.cancel().catch(() => {});
  }, []);

  // 5I PR 3 — stub download handler. PR 4 replaces with a real fetch
  // against /api/kos/customer/drawings/[id]/{boq,formwork}/download.
  // Kept simple + dependency-free: no toast lib, no network call.
  const handleDownloadStub = useCallback(
    (kind: "boq" | "formwork", drawingId: string) => {
      const label = kind === "boq" ? "Bill of Quantities" : "Formwork Quantities";
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        // eslint-disable-next-line no-alert
        window.alert(
          `${label} download is coming in the next update. Your file is ready and will be downloadable soon.`,
        );
      }
      // Local console trace — visible in DevTools, no network.
      console.warn(
        `[kos] artifact_download_stub_clicked drawingId=${drawingId} kind=${kind}`,
      );
    },
    [],
  );

  const handleRetry = useCallback(() => {
    if (lastSentRef.current) sendMessage(lastSentRef.current);
  }, [sendMessage]);

  const handleTalkToHuman = useCallback(() => {
    if (isStreaming) return;
    sendMessage("I'd like to talk to a human.");
  }, [isStreaming, sendMessage]);

  const fillInput = useCallback((prompt: string) => {
    setInput(prompt);
    setInputError(null);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    }
  }, []);

  // ── Textarea key handling + autoresize ───────────────────────────────
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && input.trim()) sendMessage(input);
    }
  };

  const onComposerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (inputError) setInputError(null);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`; // cap ~6 rows
  };

  // ── Gating on session bootstrap ──────────────────────────────────────
  if (isLoading) {
    return <CenteredNotice label="Connecting to Kalzen…" spinner />;
  }
  if (sessionError || !customer) {
    return (
      <CenteredNotice
        label={sessionError ?? "Could not start a chat session."}
        onRetry={retry}
      />
    );
  }

  const charCount = input.length;
  // 5I PR 1 — Send is enabled when EITHER text OR at least one
  // successfully uploaded attachment is present, and nothing is mid-
  // upload. Future PR 2 will gate this further on attachmentRefs the
  // bot can consume; for PR 1 the attachment is purely decorative
  // (no bot tool yet), so we keep the simpler "text OR attachment" rule.
  const sendDisabled =
    (input.trim().length === 0 &&
      attachments.pendingAttachments.length === 0) ||
    attachments.hasInFlight;

  return (
    <div
      onDragEnter={(e) => {
        // Only react to file drags, not in-DOM text/element drags.
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        dragCounterRef.current++;
        setDragActive(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) setDragActive(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        dragCounterRef.current = 0;
        setDragActive(false);
        const f = e.dataTransfer?.files?.[0];
        if (f) void attachments.addFile(f);
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "calc(100dvh - 200px)",
        minHeight: 480,
        width: "100%",
        background: "rgba(10,10,10,0.55)",
        border: "1px solid rgba(201,165,90,0.18)",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
      }}
    >
      <KosStyles />

      {/* 5I PR 1 — drop-zone overlay (only when actively dragging a file). */}
      {dragActive && (
        <div
          className="kos-drop-overlay"
          role="region"
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            background: "rgba(10, 61, 46, 0.85)",
            border: "2px dashed var(--kos-secondary, #c9a55a)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--kos-secondary, #c9a55a)",
            fontSize: 18,
            fontWeight: 600,
            pointerEvents: "none",
          }}
        >
          Drop your drawing here
        </div>
      )}

      {/* Header */}
      <header
        className="kos-header"
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <KalzenAvatar size={36} />
          <div
            style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}
          >
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              {tenantName} Assistant
            </span>
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              Answers from Kalzen&apos;s document library
            </span>
          </div>
        </div>
        <button
          type="button"
          className="kos-th-btn kos-ghost"
          onClick={handleTalkToHuman}
          disabled={isStreaming}
          aria-label="Talk to a human team member"
          style={{
            padding: "6px 11px",
            borderRadius: 8,
            border: `1px solid rgba(201,165,90,0.45)`,
            background: "transparent",
            color: GOLD,
            fontSize: 11.5,
            fontWeight: 600,
            cursor: isStreaming ? "not-allowed" : "pointer",
            opacity: isStreaming ? 0.45 : 1,
            whiteSpace: "nowrap",
            transition: "background 120ms ease",
          }}
        >
          Talk to a human
        </button>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        aria-live="polite"
        aria-atomic="false"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "18px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Escalation banner — inline at the top of the transcript,
            scrolls with content, dismissable for the session. */}
        {escalated && !escalationDismissed && (
          <EscalationBanner onDismiss={() => setEscalationDismissed(true)} />
        )}

        {messages.length === 0 ? (
          historical.loading ? (
            // 5I PR 4b2 — initial hydration in flight. Don't show welcome
            // copy yet, because if there IS history it'd flicker.
            <div
              data-testid="kos-hydration-loading"
              style={{
                padding: "32px 20px",
                textAlign: "center",
                color: "rgba(255,255,255,0.55)",
                fontSize: 13,
                letterSpacing: 0.2,
              }}
            >
              Loading conversation history…
            </div>
          ) : (
            <EmptyState tenantName={tenantName} onPick={fillInput} />
          )
        ) : (
          <>
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const gapTop = i === 0 ? 0 : prev.role === m.role ? 16 : 24;
              // 5I PR 3 — extract this message's artifact bubble states
              // by drawingId so the row gets a stable per-message slice.
              const artifactStates =
                m.attachmentRefs && m.attachmentRefs.length > 0
                  ? m.attachmentRefs.map(
                      (id) =>
                        drawingArtifacts[id] ?? {
                          drawingId: id,
                          filename:
                            m.attachmentDisplay?.find((d) => d.drawingId === id)
                              ?.filename ?? id,
                          status: "PROCESSING_PARSE" as const,
                        },
                    )
                  : null;
              return (
                <MessageRow
                  key={m.id}
                  message={m}
                  gapTop={gapTop}
                  toolActivity={m.isStreaming ? toolActivity : null}
                  onRetry={handleRetry}
                  artifactStates={artifactStates}
                  onDownloadStub={handleDownloadStub}
                />
              );
            })}

            {/* Bring back the suggested prompts on demand. */}
            <SuggestionsDock
              open={showSuggestions}
              onToggle={() => setShowSuggestions((s) => !s)}
              onPick={fillInput}
            />
          </>
        )}
      </div>

      {/* Scroll-to-bottom */}
      {showScrollButton && (
        <button
          type="button"
          aria-label="Scroll to latest message"
          onClick={() => scrollToBottom(true)}
          style={{
            position: "absolute",
            right: 24,
            bottom: 96,
            width: 38,
            height: 38,
            borderRadius: "50%",
            border: "1px solid rgba(201,165,90,0.4)",
            background: "#111",
            color: GOLD,
            cursor: "pointer",
            boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ↓
        </button>
      )}

      {/* Composer */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "12px 14px",
          background: "rgba(0,0,0,0.25)",
        }}
      >
        {/* 5I PR 1 — attachment bubbles (above input). */}
        {attachments.attachments.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 10,
            }}
          >
            {attachments.attachments.map((att) => (
              <AttachmentBubble
                key={att.localId}
                attachment={att}
                onCancel={() => attachments.cancel(att.localId)}
                onRetry={() => {
                  void attachments.retry(att.localId);
                }}
              />
            ))}
          </div>
        )}

        {inputError && (
          <div
            role="alert"
            style={{ fontSize: 12, color: "#fca5a5", marginBottom: 8 }}
          >
            {inputError}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          {/* 5I PR 1 — paperclip button + hidden file input. */}
          <button
            type="button"
            className="kos-paperclip"
            aria-label="Attach drawing"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || attachments.hasInFlight}
            style={{
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: 12,
              border: `1px solid rgba(201,165,90,0.45)`,
              background: "transparent",
              color: GOLD,
              cursor:
                isStreaming || attachments.hasInFlight
                  ? "not-allowed"
                  : "pointer",
              opacity: isStreaming || attachments.hasInFlight ? 0.45 : 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 120ms ease, opacity 120ms ease",
            }}
          >
            <PaperclipIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attachments.addFile(f);
              // Reset so re-selecting the same file fires onChange again.
              e.target.value = "";
            }}
            aria-hidden="true"
          />

          <div style={{ flex: 1, position: "relative" }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={onComposerChange}
              onKeyDown={onComposerKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              disabled={isStreaming}
              rows={1}
              maxLength={MAX_CHARS}
              placeholder={
                isStreaming
                  ? "Kalzen is replying…"
                  : "Ask about Kalzen products, certifications, or specifications..."
              }
              aria-label="Message Kalzen assistant"
              style={{
                width: "100%",
                resize: "none",
                minHeight: 44,
                maxHeight: 168,
                padding:
                  charCount > SHOW_COUNTER_AT
                    ? "11px 12px 22px"
                    : "11px 12px",
                borderRadius: 12,
                border: `1px solid ${
                  inputFocused ? GOLD : "rgba(255,255,255,0.12)"
                }`,
                boxShadow: inputFocused
                  ? "0 0 0 3px rgba(201,165,90,0.15)"
                  : "none",
                background: isStreaming
                  ? "rgba(255,255,255,0.04)"
                  : "rgba(0,0,0,0.4)",
                color: isStreaming ? "rgba(255,255,255,0.5)" : "#fafafa",
                fontSize: 14,
                lineHeight: 1.5,
                outline: "none",
                cursor: isStreaming ? "not-allowed" : "text",
                fontFamily: "var(--font-ui), system-ui, sans-serif",
                boxSizing: "border-box",
                transition: "border-color 120ms ease, box-shadow 120ms ease",
              }}
            />
            {charCount > SHOW_COUNTER_AT && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  right: 10,
                  bottom: 6,
                  fontSize: 10.5,
                  fontFamily: "var(--font-jetbrains), monospace",
                  color: charCount >= WARN_CHARS ? "#fca5a5" : "rgba(255,255,255,0.45)",
                }}
              >
                {charCount} / {MAX_CHARS}
              </span>
            )}
          </div>

          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              aria-label="Stop generating"
              style={{
                flexShrink: 0,
                height: 44,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "0 16px",
                borderRadius: 12,
                border: `1px solid rgba(201,165,90,0.5)`,
                background: "rgba(201,165,90,0.08)",
                color: GOLD,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <StopIcon />
              <span className="kos-send-label">Stop</span>
            </button>
          ) : (
            <button
              type="button"
              className="kos-send"
              onClick={() => sendMessage(input)}
              disabled={sendDisabled}
              aria-label="Send message"
              style={{
                flexShrink: 0,
                height: 44,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "0 18px",
                borderRadius: 12,
                border: "none",
                background: sendDisabled ? "rgba(255,255,255,0.08)" : GOLD,
                color: sendDisabled ? "rgba(255,255,255,0.35)" : GREEN,
                fontSize: 14,
                fontWeight: 700,
                cursor: sendDisabled ? "not-allowed" : "pointer",
                transition: "background 120ms ease, color 120ms ease",
              }}
            >
              <PaperPlaneIcon />
              <span className="kos-send-label">Send</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────── */

function PaperPlaneIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <path
        d="M22 2L11 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 2l-7 20-4-9-9-4 20-7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/* ── Presentational sub-components ─────────────────────────────────────── */

function KalzenAvatar({
  size = 36,
  streaming = false,
}: {
  size?: number;
  streaming?: boolean;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 32% 28%, rgba(201,165,90,0.35), rgba(12,18,14,0.95))",
        border: "1px solid rgba(201,165,90,0.55)",
        boxShadow: "inset 0 0 8px rgba(201,165,90,0.18)",
        color: GOLD,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: Math.round(size * 0.42),
        fontFamily: "var(--font-jetbrains), monospace",
        flexShrink: 0,
      }}
    >
      K
      {streaming && (
        <span
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: GOLD,
            border: "2px solid #0c0c0c",
            animation: "kos-pulse 1s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 90) return "1 minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function RelativeTime({
  timestamp,
  align,
}: {
  timestamp: number;
  align: "left" | "right";
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div
      style={{
        fontSize: 10.5,
        opacity: 0.42,
        marginTop: 4,
        textAlign: align,
        color: "#fafafa",
        fontFamily: "var(--font-ui), system-ui, sans-serif",
      }}
    >
      {formatRelativeTime(timestamp)}
    </div>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  gapTop,
  toolActivity,
  onRetry,
  artifactStates,
  onDownloadStub,
}: {
  message: UIMessage;
  gapTop: number;
  toolActivity: string | null;
  onRetry: () => void;
  // 5I PR 3 — per-customer-message artifact-bubble states. null for
  // messages with no attachments (most messages).
  artifactStates?: ArtifactBubbleState[] | null;
  onDownloadStub?: (kind: "boq" | "formwork", drawingId: string) => void;
}) {
  const isCustomer = message.role === "customer";
  return (
    <div style={{ marginTop: gapTop }}>
      {isCustomer ? (
        <CustomerBubble text={message.content} />
      ) : (
        <BotBubble message={message} toolActivity={toolActivity} onRetry={onRetry} />
      )}
      {/* 5I PR 3 — inline ArtifactBubble(s) below customer messages
          that carried drawing attachmentRefs. */}
      {isCustomer && artifactStates && artifactStates.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 8,
            // Visually parented to the customer bubble (right-aligned column).
            alignItems: "flex-end",
          }}
        >
          {artifactStates.map((state) => (
            <div
              key={state.drawingId}
              style={{ width: "min(420px, 92%)" }}
            >
              <ArtifactBubble state={state} onDownloadStub={onDownloadStub} />
            </div>
          ))}
        </div>
      )}
      <div
        style={{
          paddingLeft: isCustomer ? 0 : 46,
          paddingRight: isCustomer ? 4 : 0,
        }}
      >
        <RelativeTime
          timestamp={message.timestamp}
          align={isCustomer ? "right" : "left"}
        />
      </div>
    </div>
  );
});

function CustomerBubble({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        className="kos-cust-bubble"
        style={{
          padding: "11px 16px",
          borderRadius: "16px 16px 4px 16px",
          background: GOLD,
          color: GREEN,
          fontSize: 14.5,
          lineHeight: 1.5,
          fontWeight: 500,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function BotBubble({
  message,
  toolActivity,
  onRetry,
}: {
  message: UIMessage;
  toolActivity: string | null;
  onRetry: () => void;
}) {
  const showSearching = message.isStreaming && !message.content && toolActivity;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <KalzenAvatar size={36} streaming={message.isStreaming} />
      <div
        className="kos-bot-bubble"
        style={{
          minWidth: 0,
          padding: "12px 14px",
          borderRadius: "4px 16px 16px 16px",
          background: message.isError
            ? "rgba(220,38,38,0.08)"
            : "rgba(255,255,255,0.04)",
          border: message.isError
            ? "1px solid rgba(220,38,38,0.25)"
            : "1px solid rgba(255,255,255,0.06)",
          boxShadow: message.isError ? "none" : "0 2px 8px rgba(0,0,0,0.18)",
          color: "#f0f0f0",
          width: "fit-content",
        }}
      >
        {message.content ? (
          <BotMessage content={message.content} citations={message.citations} />
        ) : showSearching ? (
          <span style={{ fontSize: 13, opacity: 0.7, fontStyle: "italic" }}>
            {toolActivity}
          </span>
        ) : message.isError ? null : (
          <TypingDots />
        )}

        {/* Streaming cursor */}
        {message.isStreaming && message.content && (
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 6,
              height: 14,
              marginLeft: 2,
              borderRadius: 1,
              background: GOLD,
              verticalAlign: "text-bottom",
              animation: "kos-blink 1s steps(2, start) infinite",
            }}
          />
        )}

        {/* Inline error + retry, at the failed message's location */}
        {message.isError && (
          <div
            role="alert"
            style={{
              marginTop: message.content ? 10 : 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 12.5, color: "#fca5a5" }}>
              {message.errorText ?? "Connection interrupted. Try again?"}
            </span>
            <button
              type="button"
              onClick={onRetry}
              aria-label="Retry sending the last message"
              style={{
                padding: "4px 12px",
                borderRadius: 7,
                border: "1px solid rgba(252,165,165,0.5)",
                background: "transparent",
                color: "#fca5a5",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, padding: "2px 0" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: GOLD,
            opacity: 0.5,
            animation: "kos-pulse 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}

function SuggestionChips({
  onPick,
  centered,
}: {
  onPick: (prompt: string) => void;
  centered?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        justifyContent: centered ? "center" : "flex-start",
        maxWidth: 520,
      }}
    >
      {SUGGESTED_PROMPTS.map((p) => (
        <button
          key={p}
          type="button"
          className="kos-chip"
          onClick={() => onPick(p)}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid rgba(201,165,90,0.3)",
            background: "rgba(201,165,90,0.06)",
            color: "#f0f0f0",
            fontSize: 13,
            cursor: "pointer",
            textAlign: "left",
            transition: "background 120ms ease",
          }}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function EmptyState({
  tenantName,
  onPick,
}: {
  tenantName: string;
  onPick: (prompt: string) => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 18,
        padding: "24px 12px",
      }}
    >
      <KalzenAvatar size={52} />
      <div>
        <h2 style={{ fontSize: 21, fontWeight: 800, margin: "0 0 8px" }}>
          Welcome to {tenantName}
        </h2>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            opacity: 0.72,
            maxWidth: 460,
            margin: "0 auto",
          }}
        >
          {WELCOME_COPY}
        </p>
      </div>
      <SuggestionChips onPick={onPick} centered />
    </div>
  );
}

function SuggestionsDock({
  open,
  onToggle,
  onPick,
}: {
  open: boolean;
  onToggle: () => void;
  onPick: (prompt: string) => void;
}) {
  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid rgba(201,165,90,0.25)",
          background: "transparent",
          color: GOLD,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <span aria-hidden>💡</span>
        {open ? "Hide suggestions" : "Suggestions"}
      </button>
      {open && <SuggestionChips onPick={onPick} />}
    </div>
  );
}

function EscalationBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16,
        padding: "10px 12px",
        borderRadius: 10,
        fontSize: 13,
        background: "rgba(201,165,90,0.1)",
        border: "1px solid rgba(201,165,90,0.35)",
        color: "#f0e6cf",
      }}
    >
      <span style={{ flex: 1 }}>
        A Kalzen team member will reach out shortly. You can keep chatting in the
        meantime.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

function CenteredNotice({
  label,
  spinner,
  onRetry,
}: {
  label: string;
  spinner?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        minHeight: 360,
        textAlign: "center",
      }}
    >
      <KosStyles />
      {spinner && (
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "3px solid rgba(201,165,90,0.25)",
            borderTopColor: GOLD,
            animation: "kos-spin 0.8s linear infinite",
          }}
        />
      )}
      <p style={{ fontSize: 14, opacity: 0.8, maxWidth: 420, margin: 0 }}>
        {label}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: "9px 16px",
            borderRadius: 10,
            border: "none",
            background: GOLD,
            color: GREEN,
            fontSize: 13.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/* ── 5I PR 1 — attachment UI ───────────────────────────────────────────── */

function PaperclipIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentBubble({
  attachment,
  onCancel,
  onRetry,
}: {
  attachment: AttachmentState;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const isFailed = attachment.phase === "failed";
  const isUploaded = attachment.phase === "uploaded";
  const isUploading = attachment.phase === "uploading";

  return (
    <div
      className="kos-attach-bubble"
      role="group"
      aria-label={`Attachment ${attachment.originalFilename}, ${attachment.phase}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 11px",
        borderRadius: 10,
        border: `1px solid ${
          isFailed
            ? "rgba(252,165,165,0.4)"
            : isUploaded
              ? "rgba(201,165,90,0.45)"
              : "rgba(255,255,255,0.12)"
        }`,
        background: isFailed
          ? "rgba(220,38,38,0.08)"
          : "rgba(255,255,255,0.03)",
        fontSize: 13,
      }}
    >
      {/* Status icon */}
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: isFailed
            ? "rgba(220,38,38,0.16)"
            : "rgba(201,165,90,0.14)",
          color: isFailed ? "#fca5a5" : GOLD,
          fontWeight: 700,
          fontSize: 11,
          fontFamily: "var(--font-jetbrains), monospace",
        }}
      >
        {isFailed
          ? "!"
          : isUploaded
            ? "✓"
            : attachment.sourceFormat?.toUpperCase().slice(0, 3) ?? "DOC"}
      </span>

      {/* Filename + size / progress / error */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            color: "#f0f0f0",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 200,
            }}
            title={attachment.originalFilename}
          >
            {attachment.originalFilename}
          </span>
          <span style={{ fontSize: 11, opacity: 0.55, flexShrink: 0 }}>
            {formatBytes(attachment.sizeBytes)}
          </span>
        </div>
        {isUploading && (
          <div
            className="kos-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={attachment.progress ?? 0}
            aria-label={`Upload progress for ${attachment.originalFilename}`}
            style={{ marginTop: 6 }}
          >
            <div
              className="fill"
              style={{ width: `${Math.min(100, attachment.progress ?? 0)}%` }}
            />
          </div>
        )}
        {isFailed && attachment.errorText && (
          <div
            role="alert"
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: "#fca5a5",
              lineHeight: 1.4,
            }}
          >
            {attachment.errorText}
            {attachment.errorCode ? (
              <span
                style={{
                  marginLeft: 6,
                  opacity: 0.55,
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 10.5,
                }}
              >
                ({attachment.errorCode})
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
        {isFailed && attachment.canRetry && (
          <button
            type="button"
            className="kos-attach-action"
            onClick={onRetry}
            aria-label="Retry upload"
            style={{
              padding: "5px 10px",
              borderRadius: 7,
              border: "1px solid rgba(201,165,90,0.45)",
              background: "transparent",
              color: GOLD,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 120ms ease",
            }}
          >
            Retry
          </button>
        )}
        <button
          type="button"
          className="kos-attach-action"
          onClick={onCancel}
          aria-label={
            isUploaded
              ? "Remove attachment"
              : isUploading
                ? "Cancel upload"
                : "Remove"
          }
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "transparent",
            color: "#cccccc",
            fontSize: 14,
            lineHeight: 1,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
