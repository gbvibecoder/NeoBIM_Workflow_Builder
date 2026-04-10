"use client";

import { useEffect, useRef, useCallback, useState, KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Send, MessageSquare, ImagePlus, Loader2 } from "lucide-react";
import { useLiveChatStore } from "@/features/support/stores/live-chat-store";
import { useSupportStore } from "@/features/support/stores/support-store";
import { TypingIndicator } from "./TypingIndicator";
import type { LiveChatMessage } from "@/features/support/types/live-chat";

const MAX_CHARS = 3000;

// ─── Image helpers ──────────────────────────────────────────────────────────

/** Detect if message content is an image URL (from imgbb upload) */
function isImageMessage(content: string): boolean {
  return /^https?:\/\/.*\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(content.trim())
    || content.trim().startsWith("https://i.ibb.co/");
}

/** Compress an image file client-side using Canvas. Returns base64 string. */
function compressImage(file: File, maxDim = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height / width) * maxDim);
            width = maxDim;
          } else {
            width = Math.round((width / height) * maxDim);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function MessageBubble({ msg, mine }: { msg: LiveChatMessage; mine: boolean }) {
  const isSystem = msg.senderId === "system";
  if (isSystem) {
    return (
      <div style={{ padding: "8px 16px", textAlign: "center" }}>
        <span style={{ fontSize: 12, color: "#6B7280", fontStyle: "italic" }}>
          {msg.content}
        </span>
      </div>
    );
  }
  const isImg = isImageMessage(msg.content);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        display: "flex",
        justifyContent: mine ? "flex-end" : "flex-start",
        padding: "4px 16px",
      }}
    >
      <div style={{ maxWidth: "78%" }}>
        {!mine && msg.senderName && (
          <div
            style={{
              fontSize: 11,
              color: "#22c55e",
              fontWeight: 600,
              marginBottom: 2,
              paddingLeft: 4,
            }}
          >
            {msg.senderName}
          </div>
        )}
        {isImg ? (
          <a href={msg.content.trim()} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={msg.content.trim()}
              alt="Shared image"
              style={{
                maxWidth: "100%",
                maxHeight: 240,
                borderRadius: 12,
                display: "block",
                cursor: "pointer",
                border: mine
                  ? "2px solid rgba(79,138,255,0.4)"
                  : "2px solid rgba(255,255,255,0.08)",
              }}
            />
          </a>
        ) : (
        <div
          style={{
            background: mine ? "rgba(79,138,255,0.85)" : "#1A1A2E",
            color: mine ? "#fff" : "#F0F0F0",
            padding: "10px 14px",
            borderRadius: 14,
            borderTopRightRadius: mine ? 4 : 14,
            borderTopLeftRadius: mine ? 14 : 4,
            fontSize: 14,
            lineHeight: 1.45,
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {msg.content}
        </div>
        )}
        <div
          style={{
            fontSize: 10,
            color: "#6B7280",
            marginTop: 2,
            textAlign: mine ? "right" : "left",
            paddingInline: 4,
          }}
        >
          {formatTime(msg.createdAt)}
        </div>
      </div>
    </motion.div>
  );
}

export default function LiveChatView() {
  const isActive = useLiveChatStore((s) => s.isActive);
  const conversationStatus = useLiveChatStore((s) => s.conversationStatus);
  const messages = useLiveChatStore((s) => s.messages);
  const isSending = useLiveChatStore((s) => s.isSending);
  const isLoadingHistory = useLiveChatStore((s) => s.isLoadingHistory);
  const adminOnline = useLiveChatStore((s) => s.adminOnline);
  const adminTyping = useLiveChatStore((s) => s.adminTyping);
  const inputDraft = useLiveChatStore((s) => s.inputDraft);
  const setInputDraft = useLiveChatStore((s) => s.setInputDraft);
  const openLiveChat = useLiveChatStore((s) => s.openLiveChat);
  const sendMessage = useLiveChatStore((s) => s.sendMessage);
  const startPolling = useLiveChatStore((s) => s.startPolling);
  const stopPolling = useLiveChatStore((s) => s.stopPolling);
  const refreshMessages = useLiveChatStore((s) => s.refreshMessages);
  const pageContext = useSupportStore((s) => s.pageContext);

  // Image upload state: preview first, then upload+send on confirm
  const [isUploading, setIsUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ dataUrl: string; base64: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImagePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    e.target.value = "";
    try {
      const dataUrl = await compressImage(file);
      setImagePreview({ dataUrl, base64: dataUrl });
    } catch (err) {
      console.error("[live-chat] image compress failed:", err);
    }
  }, []);

  const handleSendImage = useCallback(async () => {
    if (!imagePreview || isUploading) return;
    setIsUploading(true);
    try {
      const res = await fetch("/api/live-chat/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imagePreview.base64 }),
      });
      if (!res.ok) {
        setIsUploading(false);
        return;
      }
      const data = await res.json();
      if (data.url) {
        sendMessage(data.url, pageContext);
      }
    } catch (err) {
      console.error("[live-chat] image upload failed:", err);
    }
    setImagePreview(null);
    setIsUploading(false);
  }, [imagePreview, isUploading, sendMessage, pageContext]);

  const cancelImagePreview = useCallback(() => setImagePreview(null), []);

  // Open on mount. Pusher subscription is mounted globally in
  // SupportChatWidget so admin replies arrive even when this view is unmounted.
  useEffect(() => {
    if (!isActive) openLiveChat();
  }, [isActive, openLiveChat]);

  // Polling fallback — guarantees messages always arrive within ~4s even if
  // Pusher is misconfigured, blocked, or the WebSocket dropped silently.
  // Plus immediate refetch when the tab becomes visible or window regains
  // focus (browsers throttle background tabs and pause WebSockets).
  useEffect(() => {
    startPolling();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshMessages();
    };
    const onFocus = () => refreshMessages();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [startPolling, stopPolling, refreshMessages]);

  // Auto-scroll
  const bottomRef = useRef<HTMLDivElement>(null);
  // Instant scroll to bottom on first load (no animation — user shouldn't see it scroll)
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (!isLoadingHistory && messages.length > 0 && !hasScrolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
      hasScrolledRef.current = true;
    }
  }, [isLoadingHistory, messages.length]);
  // Smooth scroll on new messages after initial load
  useEffect(() => {
    if (hasScrolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, adminTyping]);

  const isClosed = conversationStatus === "CLOSED";

  const handleSend = useCallback(() => {
    const trimmed = inputDraft.trim();
    if (!trimmed || isSending || isClosed) return;
    sendMessage(trimmed, pageContext);
  }, [inputDraft, isSending, isClosed, sendMessage, pageContext]);

  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Sub-header: presence */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <MessageSquare size={14} color="#22c55e" />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F0" }}>
          Live Chat with our team
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", minHeight: 0 }}>
        {isLoadingHistory ? (
          <div style={{ padding: 24, textAlign: "center", color: "#6B7280", fontSize: 13 }}>
            Loading conversation…
          </div>
        ) : messages.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "rgba(34,197,94,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <MessageSquare size={26} color="#22c55e" />
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#F0F0F0", margin: "0 0 6px" }}>
              Talk to our support team
            </p>
            <p style={{ fontSize: 13, color: "#9898B0", margin: 0, lineHeight: 1.5 }}>
              Send a message and a team member will reply as soon as they&apos;re available.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              mine={m.senderRole === "USER"}
            />
          ))
        )}

        {adminTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Reassurance banner — pinned above the input, outside scroll area */}
      {messages.length > 0 &&
        messages[messages.length - 1]?.senderRole === "USER" &&
        !isSending && (
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid rgba(79,138,255,0.1)",
            background: "linear-gradient(135deg, rgba(79,138,255,0.06), rgba(99,102,241,0.03))",
            fontSize: 12,
            color: "#9898B0",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Our team will reply shortly. Feel free to share more details.
        </div>
      )}

      {/* Input */}
      {isClosed ? (
        <div
          className="pb-[max(14px,env(safe-area-inset-bottom))] sm:pb-3.5"
          style={{
            padding: "14px 16px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            textAlign: "center",
            fontSize: 13,
            color: "#6B7280",
            fontStyle: "italic",
          }}
        >
          This conversation has been closed.
        </div>
      ) : (
        <div
          className="pb-[max(8px,env(safe-area-inset-bottom))] sm:pb-2"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "8px 12px",
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            position: "relative",
          }}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleImagePick}
          />

          {/* Image preview card (WhatsApp-style: shows before sending) */}
          {imagePreview && (
            <div
              style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                right: 0,
                padding: "12px",
                background: "rgba(17,17,32,0.95)",
                borderTop: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "flex-end",
                gap: 10,
              }}
            >
              <div style={{ position: "relative", flex: 1 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview.dataUrl}
                  alt="Preview"
                  style={{
                    maxWidth: "100%",
                    maxHeight: 180,
                    borderRadius: 10,
                    display: "block",
                    border: "2px solid rgba(79,138,255,0.3)",
                  }}
                />
                {/* Cancel button */}
                <button
                  onClick={cancelImagePreview}
                  style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    border: "none",
                    background: "#ef4444",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  x
                </button>
              </div>
              {/* Send image button */}
              <button
                onClick={handleSendImage}
                disabled={isUploading}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  border: "none",
                  cursor: isUploading ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isUploading ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.85)",
                  flexShrink: 0,
                }}
              >
                {isUploading ? (
                  <Loader2 size={18} color="#fff" style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <Send size={18} color="#fff" />
                )}
              </button>
            </div>
          )}

          {/* Image pick button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isSending || !!imagePreview}
            aria-label="Attach image"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: "none",
              cursor: isUploading || imagePreview ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.06)",
              flexShrink: 0,
              transition: "background 0.15s",
            }}
          >
            <ImagePlus size={18} color="#9898B0" />
          </button>
          <textarea
            aria-label="Type your message"
            value={inputDraft}
            onChange={(e) => {
              if (e.target.value.length <= MAX_CHARS + 100) setInputDraft(e.target.value);
            }}
            onKeyDown={handleKey}
            placeholder="Type your message…"
            disabled={isSending || !!imagePreview}
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              border: "1px solid rgba(107,114,128,0.25)",
              borderRadius: 12,
              padding: "10px 14px",
              fontSize: 14,
              lineHeight: "22px",
              color: "#F0F0F0",
              backgroundColor: "rgba(26,26,46,0.6)",
              outline: "none",
              fontFamily: "inherit",
              maxHeight: 110,
            }}
          />
          <button
            onClick={imagePreview ? handleSendImage : handleSend}
            disabled={imagePreview ? isUploading : (!inputDraft.trim() || isSending)}
            aria-label="Send"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: "none",
              cursor: (imagePreview ? isUploading : (!inputDraft.trim() || isSending)) ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: (imagePreview ? isUploading : (!inputDraft.trim() || isSending))
                ? "rgba(34,197,94,0.2)"
                : "rgba(34,197,94,0.85)",
              flexShrink: 0,
            }}
          >
            <Send size={18} color="#fff" />
          </button>
        </div>
      )}
    </div>
  );
}
