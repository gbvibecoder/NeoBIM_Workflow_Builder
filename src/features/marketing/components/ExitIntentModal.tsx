"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { X, Mail, CheckCircle2, ArrowRight } from "lucide-react";

interface ExitIntentModalProps {
  isLoggedIn?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_KEY = "exit_intent_shown";

export function ExitIntentModal({
  isLoggedIn = false,
}: ExitIntentModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [emailError, setEmailError] = useState("");
  const hasTriggeredRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const maxScrollPercentRef = useRef(0);

  const showModal = useCallback(() => {
    if (hasTriggeredRef.current) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname !== "/") return;
    if (sessionStorage.getItem(SESSION_KEY)) return;

    hasTriggeredRef.current = true;
    sessionStorage.setItem(SESSION_KEY, "true");
    setIsOpen(true);
    window.gtag?.("event", "exit_intent_shown");
  }, []);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    window.gtag?.("event", "exit_intent_dismissed");
  }, []);

  // Desktop: mouse leaves viewport from top
  useEffect(() => {
    if (isLoggedIn) return;

    const handleMouseLeave = (e: MouseEvent) => {
      if (e.clientY < 0) {
        showModal();
      }
    };

    document.addEventListener("mouseleave", handleMouseLeave);
    return () => document.removeEventListener("mouseleave", handleMouseLeave);
  }, [isLoggedIn, showModal]);

  // Mobile: scroll 60% down then scroll back up
  useEffect(() => {
    if (isLoggedIn) return;

    const isTouchDevice =
      typeof window !== "undefined" &&
      ("ontouchstart" in window || navigator.maxTouchPoints > 0);

    if (!isTouchDevice) return;

    const handleScroll = () => {
      const scrollY = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = docHeight > 0 ? scrollY / docHeight : 0;

      if (scrollPercent > maxScrollPercentRef.current) {
        maxScrollPercentRef.current = scrollPercent;
      }

      const isScrollingUp = scrollY < lastScrollYRef.current;

      if (maxScrollPercentRef.current >= 0.6 && isScrollingUp) {
        showModal();
      }

      lastScrollYRef.current = scrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isLoggedIn, showModal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError("");

    if (!EMAIL_REGEX.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "exit_intent" }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Something went wrong.");
      }

      setIsSuccess(true);
      window.gtag?.("event", "exit_intent_email_submitted");

      setTimeout(() => {
        setIsOpen(false);
      }, 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to subscribe.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, dismiss]);

  if (isLoggedIn) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
          onClick={dismiss}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-2xl p-8"
            style={{
              background: "rgba(12, 13, 16, 0.98)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              boxShadow:
                "0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 80px rgba(99, 102, 241, 0.08)",
            }}
          >
            {/* Dismiss button */}
            <button
              onClick={dismiss}
              aria-label="Close modal"
              className="absolute top-4 right-4 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
            >
              <X className="h-5 w-5" />
            </button>

            {isSuccess ? (
              /* Success state */
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-4 text-center"
              >
                <CheckCircle2 className="mb-4 h-12 w-12 text-emerald-400" />
                <h3 className="text-xl font-semibold text-white">
                  Check your inbox!
                </h3>
                <p className="mt-2 text-sm text-white/50">
                  Your free guide is on its way.
                </p>
              </motion.div>
            ) : (
              /* Form state */
              <>
                <div className="mb-6 pr-6">
                  <h2 className="text-xl font-semibold leading-snug text-white sm:text-2xl">
                    Wait — don&apos;t miss what BuildFlow can do for your
                    projects
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-white/50">
                    Get a free guide:{" "}
                    <span className="text-white/70">
                      5 BIM workflows that save architects 10+ hours/week
                    </span>
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <div
                      className="flex items-center gap-2 rounded-xl px-4 py-3 transition-colors focus-within:border-indigo-500/40"
                      style={{
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                      }}
                    >
                      <Mail className="h-4 w-4 shrink-0 text-white/30" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (emailError) setEmailError("");
                        }}
                        placeholder="your@email.com"
                        aria-label="Email address"
                        className="w-full bg-transparent text-sm text-white placeholder:text-white/25 focus:outline-none"
                      />
                    </div>
                    {emailError && (
                      <p className="mt-1.5 text-xs text-red-400">
                        {emailError}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <>
                        Send Me the Guide
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>

                <p className="mt-4 text-center text-xs text-white/30">
                  No spam. Unsubscribe anytime.
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
