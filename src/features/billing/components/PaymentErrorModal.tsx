"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Wrench, X, ArrowRight, Mail } from "lucide-react";
import { CONTACT_EMAIL } from "@/constants/contact";

export type PaymentErrorCode =
  | "PAYMENT_SERVICE_UNAVAILABLE"
  | "PLAN_UNAVAILABLE"
  | string;

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
}

function getCopy(code: string | undefined, message: string | undefined): ErrorCopy {
  if (code === "PAYMENT_SERVICE_UNAVAILABLE") {
    return {
      headline: "Payment service is temporarily unavailable",
      body:
        "Our payment partner is having trouble right now. This isn't your " +
        "fault — please try again in a moment.",
    };
  }
  if (code === "PLAN_UNAVAILABLE") {
    return {
      headline: "This plan is temporarily unavailable",
      body:
        "We're updating our plans. Please try a different plan or contact " +
        "support.",
    };
  }
  const bodyTail = message ? ` ${message.replace(/[.\s]+$/, "")}.` : "";
  return {
    headline: "Something went wrong",
    body: `We couldn't start your upgrade.${bodyTail} Please try again or contact support.`,
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
  const supportHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    `Checkout issue${planName ? ` (${planName} plan)` : ""}`,
  )}&body=${encodeURIComponent(
    `Hi BuildFlow team,\n\nI hit an issue while trying to upgrade${planName ? ` to ${planName}` : ""}.\n\nError code: ${errorCode || "(unknown)"}\nError message: ${errorMessage || "(none)"}\n\nThanks!`,
  )}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-error-headline"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
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
                  background:
                    "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.15))",
                  border: "1px solid rgba(245,158,11,0.25)",
                }}
              >
                <Wrench size={24} className="text-[#F59E0B]" />
              </div>
              <h3
                id="payment-error-headline"
                className="text-xl font-bold text-[#F0F0F5] mb-2"
              >
                {copy.headline}
              </h3>
              <p className="text-sm text-[#9898B0] leading-relaxed">{copy.body}</p>
              {planName && (
                <p className="mt-3 text-xs text-[#7C7C96]">
                  Plan: <strong className="text-[#C0C0D0]">{planName}</strong>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  onClose();
                  onRetry?.();
                }}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #F59E0B, #FBBF24)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 18px rgba(245,158,11,0.35)",
                }}
              >
                Try again
                <ArrowRight size={16} strokeWidth={2.5} />
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
