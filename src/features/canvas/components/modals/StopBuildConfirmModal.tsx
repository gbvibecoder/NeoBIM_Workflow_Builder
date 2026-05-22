"use client";

/**
 * StopBuildConfirmModal — confirmation dialog for STOP.
 *
 * Phase (STOP UX, 2026-05-22): the STOP button on the canvas used to
 * fire cancel + show a "halting…" toast and leave the user staring at
 * a "running" canvas for ≤30 s until the agent loop wound down. The
 * server cancel itself is already PROVEN working (see
 * `CANCEL_FIX_2026-05-22.md`); this modal is the UX layer that:
 *   1. Prevents a misclick from nuking a long-running build.
 *   2. On confirm, lets the parent fire the cancel POST AND reset the
 *      canvas optimistically so the user lands on a blank canvas
 *      instantly while the worker dies in the background.
 *
 * Pattern + a11y mirrors `SaveWorkflowModal` (framer-motion enter/exit,
 * Escape-to-close, Tab focus-trap) so the codebase stays consistent.
 */

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

interface StopBuildConfirmModalProps {
  isOpen: boolean;
  /** Called on "Stop build". Parent does cancel + reset; we just close. */
  onConfirm: () => void;
  /** Called on backdrop / X / Escape / "Keep running". */
  onClose: () => void;
  /** Number of in-flight v3 runs that will be cancelled — surfaced in
   *  the body copy so the user knows the scope. */
  pendingRunCount: number;
}

export function StopBuildConfirmModal({
  isOpen,
  onConfirm,
  onClose,
  pendingRunCount,
}: StopBuildConfirmModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the destructive button when the modal opens. Keyboard
  // users who hit Enter immediately will confirm — which is the intent
  // for the user who already clicked STOP.
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => confirmBtnRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Escape closes + Tab focus-trap. Identical contract to SaveWorkflowModal.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const buildsCopy =
    pendingRunCount === 0
      ? "This will halt the current execution. The template stays — every node resets to idle and the brief is emptied."
      : pendingRunCount === 1
        ? "1 active AI build will be cancelled. The template stays — every node resets to idle and the brief is emptied."
        : `${pendingRunCount} active AI builds will be cancelled. The template stays — every node resets to idle and the brief is emptied.`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="stop-confirm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          data-testid="stop-confirm-backdrop"
          role="presentation"
        >
          <motion.div
            ref={modalRef}
            key="stop-confirm-card"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="stop-confirm-title"
            aria-describedby="stop-confirm-body"
            style={{
              background: "#FFFFFF",
              borderRadius: 14,
              boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
              maxWidth: 460,
              width: "100%",
              padding: 24,
              position: "relative",
            }}
            data-testid="stop-confirm-modal"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                background: "transparent",
                border: "none",
                padding: 6,
                cursor: "pointer",
                borderRadius: 8,
                color: "#6B7280",
              }}
              data-testid="stop-confirm-close"
            >
              <X size={18} />
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "#FEF2F2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#DC2626",
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={20} />
              </div>
              <h2
                id="stop-confirm-title"
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  color: "#111827",
                }}
              >
                Stop this build?
              </h2>
            </div>

            <p
              id="stop-confirm-body"
              style={{
                margin: "0 0 22px 0",
                color: "#374151",
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              Progress will be discarded. {buildsCopy} You can immediately
              type a new brief and run again.
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #E5E7EB",
                  background: "#FFFFFF",
                  color: "#374151",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
                data-testid="stop-confirm-cancel"
              >
                Keep running
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={onConfirm}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #DC2626",
                  background: "#DC2626",
                  color: "#FFFFFF",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                data-testid="stop-confirm-confirm"
              >
                Stop build
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
