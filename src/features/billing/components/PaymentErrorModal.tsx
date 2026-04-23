"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wrench, X, ArrowRight, Mail, RefreshCw } from "lucide-react";
import { CONTACT_EMAIL } from "@/constants/contact";
import { colors } from "@/constants/design-tokens";

/**
 * Codes the modal renders specific copy for. Anything else falls through to
 * the generic "Something went wrong" state with the server's message inlined.
 *
 *   PAYMENT_SERVICE_UNAVAILABLE  pre-modal: server 5xx, network outage, script never loaded
 *   PLAN_UNAVAILABLE             pre-modal: server 422, plan_id rejected by Razorpay
 *   PAYMENT_FAILED               in-modal:  Razorpay's payment.failed / payment.error event
 *   AUTHENTICATION_ERROR         pre-modal: server 401 (session expired)
 *   UNKNOWN / any other          generic    server message inlined when present
 */
export type PaymentErrorCode =
  | "PAYMENT_SERVICE_UNAVAILABLE"
  | "PLAN_UNAVAILABLE"
  | "PAYMENT_FAILED"
  | "AUTHENTICATION_ERROR"
  | "UNKNOWN";

interface PaymentErrorModalProps {
  open: boolean;
  onClose: () => void;
  errorCode?: string;
  errorMessage?: string;
  planName?: string;
  onRetry?: () => void;
}

interface ErrorCopy {
  headline: string;
  body: string;
  primaryLabel: string;
  primaryAction: "retry" | "refresh";
}

function getCopy(code: string | undefined, message: string | undefined): ErrorCopy {
  if (code === "PAYMENT_SERVICE_UNAVAILABLE") {
    return {
      headline: "Payment service is temporarily unavailable",
      body:
        "Our payment partner is having trouble right now. This isn't your " +
        "fault — please try again in a moment.",
      primaryLabel: "Try again",
      primaryAction: "retry",
    };
  }
  if (code === "PLAN_UNAVAILABLE") {
    return {
      headline: "This plan is temporarily unavailable",
      body:
        "We're updating our plans. Please try a different plan or contact " +
        "support.",
      primaryLabel: "Try again",
      primaryAction: "retry",
    };
  }
  if (code === "PAYMENT_FAILED") {
    return {
      headline: "Payment didn't go through",
      body:
        "Your bank declined or cancelled the payment. Try again, or use a " +
        "different payment method.",
      primaryLabel: "Try again",
      primaryAction: "retry",
    };
  }
  if (code === "AUTHENTICATION_ERROR") {
    return {
      headline: "We couldn't verify your account",
      body: "Please refresh the page and sign in again.",
      primaryLabel: "Refresh",
      primaryAction: "refresh",
    };
  }
  // Default — UNKNOWN or any unmapped code. Inline server message if present.
  const bodyTail = message ? ` ${message.replace(/[.\s]+$/, "")}.` : "";
  return {
    headline: "Something went wrong",
    body: `We couldn't start your upgrade.${bodyTail} Please try again or contact support.`,
    primaryLabel: "Try again",
    primaryAction: "retry",
  };
}

export function PaymentErrorModal({
  open,
  onClose,
  errorCode,
  errorMessage,
  planName,
  onRetry,
}: PaymentErrorModalProps) {
  const copy = getCopy(errorCode, errorMessage);
  const dialogRef = useRef<HTMLDivElement>(null);

  // a11y — Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // a11y — focus trap + initial focus. Capture focus on open so screen-reader
  // users (and keyboard users) cannot Tab into the page behind the modal.
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const root = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    // Focus the first focusable on open.
    const items = focusable();
    items[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      // Restore focus to the element that opened the modal.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const supportHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    `Checkout issue${planName ? ` (${planName} plan)` : ""}`,
  )}&body=${encodeURIComponent(
    `Hi BuildFlow team,\n\nI hit an issue while trying to upgrade${planName ? ` to ${planName}` : ""}.\n\nError code: ${errorCode || "(unknown)"}\nError message: ${errorMessage || "(none)"}\n\nThanks!`,
  )}`;

  const handlePrimary = () => {
    if (copy.primaryAction === "refresh") {
      window.location.reload();
      return;
    }
    onClose();
    onRetry?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-error-headline"
            aria-describedby="payment-error-body"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#111120] p-8 shadow-2xl"
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 p-1 rounded-lg text-[#7C7C96] hover:text-[#F0F0F5] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
            >
              <X size={18} />
            </button>

            <div className="text-center mb-6">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{
                  background: `linear-gradient(135deg, ${colors.warning}26, ${colors.warning}1A)`,
                  border: `1px solid ${colors.warning}40`,
                }}
              >
                <Wrench size={24} style={{ color: colors.warning }} />
              </div>
              <h3
                id="payment-error-headline"
                className="text-xl font-bold text-[#F0F0F5] mb-2"
              >
                {copy.headline}
              </h3>
              <p
                id="payment-error-body"
                className="text-sm text-[#9898B0] leading-relaxed"
              >
                {copy.body}
              </p>
              {planName && (
                <p className="mt-3 text-xs text-[#7C7C96]">
                  Plan: <strong className="text-[#C0C0D0]">{planName}</strong>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={handlePrimary}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all flex items-center justify-center gap-2"
                style={{
                  background: `linear-gradient(135deg, ${colors.warning}, #FBBF24)`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 18px ${colors.warning}59`,
                }}
              >
                {copy.primaryAction === "refresh" ? (
                  <RefreshCw size={16} strokeWidth={2.5} />
                ) : null}
                {copy.primaryLabel}
                {copy.primaryAction === "retry" ? (
                  <ArrowRight size={16} strokeWidth={2.5} />
                ) : null}
              </button>
              <a
                href={supportHref}
                onClick={onClose}
                className="w-full py-3 rounded-xl text-sm font-semibold text-[#9898B0] bg-[#16162A] hover:bg-[#1E1E34] border border-[rgba(255,255,255,0.06)] transition-colors flex items-center justify-center gap-2"
              >
                <Mail size={14} />
                Contact support
              </a>
            </div>

            {errorCode && (
              <p className="mt-4 text-center text-[10px] text-[#55556A] font-mono uppercase tracking-wider">
                ref: {errorCode}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
