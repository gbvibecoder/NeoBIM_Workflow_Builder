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
`;

function KosStyles() {
  return <style>{KOS_STYLES}</style>;
}

export default function ChatSurface({ tenantName }: { tenantName: string }) {
  const { customer, isLoading, error: sessionError, retry } = useKosCustomer();

  const [messages, setMessages] = useState<UIMessage[]>([]);
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

  // rAF-throttled streamed-text accumulator.
  const streamTextRef = useRef("");
  const streamingBotIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const lastScrollRef = useRef(0);
  const scrollTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  // ── The streaming send ───────────────────────────────────────────────
  const runStream = useCallback(
    async (message: string, botId: string, retried = false): Promise<void> => {
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
          }),
          signal: controller.signal,
        });

        // Session expired mid-conversation → re-bootstrap + retry once.
        if (res.status === 401 && !retried) {
          const ok = await reBootstrapSession();
          if (ok) {
            return runStream(message, botId, true);
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
      const text = raw.trim();
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

      const customerMsg: UIMessage = {
        id: genId(),
        role: "customer",
        content: text,
        timestamp: Date.now(),
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

      void runStream(text, botId);
    },
    [runStream, scrollToBottom, cancelRaf],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    void readerRef.current?.cancel().catch(() => {});
  }, []);

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
  const sendDisabled = input.trim().length === 0;

  return (
    <div
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
          <EmptyState tenantName={tenantName} onPick={fillInput} />
        ) : (
          <>
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const gapTop = i === 0 ? 0 : prev.role === m.role ? 16 : 24;
              return (
                <MessageRow
                  key={m.id}
                  message={m}
                  gapTop={gapTop}
                  toolActivity={m.isStreaming ? toolActivity : null}
                  onRetry={handleRetry}
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
        {inputError && (
          <div
            role="alert"
            style={{ fontSize: 12, color: "#fca5a5", marginBottom: 8 }}
          >
            {inputError}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
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
}: {
  message: UIMessage;
  gapTop: number;
  toolActivity: string | null;
  onRetry: () => void;
}) {
  const isCustomer = message.role === "customer";
  return (
    <div style={{ marginTop: gapTop }}>
      {isCustomer ? (
        <CustomerBubble text={message.content} />
      ) : (
        <BotBubble message={message} toolActivity={toolActivity} onRetry={onRetry} />
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
