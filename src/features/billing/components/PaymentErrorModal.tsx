"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wrench, X, ArrowRight, Mail, RefreshCw } from "lucide-react";
import { CONTACT_EMAIL } from "@/constants/contact";

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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(14,18,24,0.4)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
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
            style={{
              position: "relative",
              width: "100%",
              maxWidth: "440px",
              borderRadius: "20px",
              background: "#fff",
              border: "1px solid rgba(14,18,24,0.07)",
              padding: "32px",
              boxShadow: "0 24px 48px rgba(14,18,24,0.12), 0 0 0 1px rgba(14,18,24,0.04)",
            }}
          >
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                position: "absolute",
                top: "16px",
                right: "16px",
                padding: "4px",
                borderRadius: "8px",
                background: "none",
                border: "none",
                color: "#9AA1B0",
                cursor: "pointer",
              }}
            >
              <X size={18} />
            </button>

            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <div
                style={{
                  width: "52px",
                  height: "52px",
                  borderRadius: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px",
                  background: "rgba(184,118,45,0.08)",
                  border: "1px solid rgba(184,118,45,0.15)",
                  color: "#B8762D",
                }}
              >
                <Wrench size={24} />
              </div>
              <h3
                id="payment-error-headline"
                style={{
                  fontFamily: "var(--font-display, Georgia, serif)",
                  fontSize: "20px",
                  fontWeight: 600,
                  color: "#0E1218",
                  marginBottom: "6px",
                }}
              >
                {copy.headline}
              </h3>
              <p
                id="payment-error-body"
                style={{
                  fontSize: "13px",
                  color: "#5A6478",
                  lineHeight: "1.6",
                }}
              >
                {copy.body}
              </p>
              {planName && (
                <p style={{ marginTop: "12px", fontSize: "12px", color: "#9AA1B0" }}>
                  Plan: <strong style={{ color: "#2A3142" }}>{planName}</strong>
                </p>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                onClick={handlePrimary}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#fff",
                  background: "linear-gradient(135deg, #B8762D, #D89139)",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 14px rgba(184,118,45,0.22)",
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
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#5A6478",
                  background: "#F6F4EE",
                  border: "1px solid rgba(14,18,24,0.07)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  textDecoration: "none",
                }}
              >
                <Mail size={14} />
                Contact support
              </a>
            </div>

            {errorCode && (
              <p style={{
                marginTop: "16px",
                textAlign: "center",
                fontSize: "10px",
                color: "#B7BCC8",
                fontFamily: "var(--font-jetbrains, monospace)",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}>
                ref: {errorCode}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
