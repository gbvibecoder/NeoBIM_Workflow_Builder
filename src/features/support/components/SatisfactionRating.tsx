"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star } from "lucide-react";
import { useSupportStore } from "@/features/support/stores/support-store";

interface SatisfactionRatingProps {
  onClose: () => void;
}

export default function SatisfactionRating({ onClose }: SatisfactionRatingProps) {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const rateConversation = useSupportStore((s) => s.rateConversation);

  const displayRating = hoveredStar || rating;

  const handleStarKeyDown = useCallback(
    (e: React.KeyboardEvent, star: number) => {
      if (e.key === "ArrowRight" && star < 5) {
        e.preventDefault();
        setRating(star + 1);
      } else if (e.key === "ArrowLeft" && star > 1) {
        e.preventDefault();
        setRating(star - 1);
      }
    },
    [],
  );

  async function handleSubmit() {
    if (rating === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await rateConversation(rating, note.trim() || undefined);
      setSubmitted(true);
      setTimeout(() => onClose(), 1500);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "32px 24px",
        gap: 8,
      }}
    >
      <AnimatePresence mode="wait">
        {submitted ? (
          /* ─── Thank You State ─── */
          <motion.div
            key="thanks"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                background: "rgba(52, 211, 153, 0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}
            >
              <Star size={28} fill="#FBBF24" color="#FBBF24" />
            </motion.div>
            <p
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "rgba(255,255,255,0.9)",
                margin: 0,
              }}
            >
              Thank you!
            </p>
            <p
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.45)",
                margin: 0,
              }}
            >
              Your feedback helps us improve.
            </p>
          </motion.div>
        ) : (
          /* ─── Rating Form ─── */
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
              width: "100%",
              maxWidth: 320,
            }}
          >
            {/* Title */}
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.9)",
                  margin: "0 0 4px",
                }}
              >
                How was your experience?
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.4)",
                  margin: 0,
                }}
              >
                Rate your support conversation
              </p>
            </div>

            {/* Stars */}
            <div
              role="radiogroup"
              aria-label="Rating"
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "center",
              }}
            >
              {[1, 2, 3, 4, 5].map((star) => {
                const isFilled = star <= displayRating;

                return (
                  <motion.button
                    key={star}
                    initial={{ opacity: 0, scale: 0, rotate: -30 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 17,
                      delay: star * 0.08,
                    }}
                    whileHover={{ scale: 1.2 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoveredStar(star)}
                    onMouseLeave={() => setHoveredStar(0)}
                    onKeyDown={(e) => handleStarKeyDown(e, star)}
                    role="radio"
                    aria-checked={rating === star}
                    aria-label={`${star} star${star > 1 ? "s" : ""}`}
                    tabIndex={0}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Star
                      size={32}
                      fill={isFilled ? "#FBBF24" : "transparent"}
                      color={isFilled ? "#FBBF24" : "rgba(255,255,255,0.2)"}
                      strokeWidth={1.5}
                      style={{
                        transition: "color 0.15s, fill 0.15s",
                      }}
                    />
                  </motion.button>
                );
              })}
            </div>

            {/* Optional Feedback */}
            <div style={{ width: "100%" }}>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Any additional feedback? (optional)"
                rows={3}
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.03)",
                  color: "rgba(255,255,255,0.85)",
                  resize: "none",
                  outline: "none",
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(79, 138, 255, 0.4)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                }}
              />
            </div>

            {/* Actions */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                width: "100%",
              }}
            >
              <motion.button
                whileHover={{ scale: rating > 0 ? 1.02 : 1 }}
                whileTap={{ scale: rating > 0 ? 0.98 : 1 }}
                onClick={handleSubmit}
                disabled={rating === 0 || isSubmitting}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "none",
                  background:
                    rating > 0 ? "#4F8AFF" : "rgba(255,255,255,0.06)",
                  color:
                    rating > 0
                      ? "#fff"
                      : "rgba(255,255,255,0.25)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: rating > 0 && !isSubmitting ? "pointer" : "not-allowed",
                  transition: "background 0.2s, color 0.2s",
                  opacity: isSubmitting ? 0.6 : 1,
                }}
              >
                {isSubmitting ? "Submitting..." : "Submit Rating"}
              </motion.button>

              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.35)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                Skip
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
