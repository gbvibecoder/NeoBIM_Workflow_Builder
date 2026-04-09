"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, X, Send } from "lucide-react";
import { useSupportStore } from "@/stores/support-store";
import { toast } from "sonner";

export default function EscalationBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const escalate = useSupportStore((s) => s.escalate);

  // Stable selector — no external closure vars, returns only primitives
  const isEligible = useSupportStore((s) => {
    if (!s.activeConversationId) return false;
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    if (!conv || conv.status !== "ACTIVE") return false;
    const msgs = s.messages[s.activeConversationId];
    return (msgs?.length ?? 0) >= 5;
  });

  const shouldShow = !dismissed && isEligible;

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      await escalate(reason.trim() || undefined);
      toast.success("Your question has been sent to our team");
      setDismissed(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: 16, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: 16, height: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          style={{
            padding: "0 16px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(251, 191, 36, 0.06), rgba(79, 138, 255, 0.06))",
              border: "1px solid rgba(251, 191, 36, 0.15)",
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            {!showReasonInput ? (
              /* ─── Initial CTA ─── */
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <button
                  onClick={() => setShowReasonInput(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                    }}
                  >
                    Not finding what you need?
                  </span>
                  <ArrowRight
                    size={12}
                    style={{ color: "#FBBF24", flexShrink: 0 }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#FBBF24",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Talk to our team
                  </span>
                </button>

                <button
                  onClick={() => setDismissed(true)}
                  aria-label="Dismiss"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(255,255,255,0.3)",
                    flexShrink: 0,
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              /* ─── Reason Input ─── */
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                <p
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.55)",
                    margin: "0 0 8px",
                  }}
                >
                  Briefly describe what you need help with{" "}
                  <span style={{ color: "rgba(255,255,255,0.3)" }}>
                    (optional)
                  </span>
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <input
                    id="escalation-reason"
                    aria-label="Describe what you need help with"
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isSubmitting) handleConfirm();
                    }}
                    placeholder="e.g. My workflow keeps failing..."
                    autoFocus
                    style={{
                      flex: 1,
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(0,0,0,0.2)",
                      color: "rgba(255,255,255,0.9)",
                      outline: "none",
                    }}
                  />
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleConfirm}
                    disabled={isSubmitting}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: "#FBBF24",
                      color: "#000",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                      opacity: isSubmitting ? 0.6 : 1,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    <Send size={12} />
                    {isSubmitting ? "Sending..." : "Send"}
                  </motion.button>
                  <button
                    onClick={() => {
                      setShowReasonInput(false);
                      setReason("");
                    }}
                    aria-label="Cancel"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgba(255,255,255,0.3)",
                      flexShrink: 0,
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
