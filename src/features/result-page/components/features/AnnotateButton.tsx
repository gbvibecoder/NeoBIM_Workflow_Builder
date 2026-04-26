"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StickyNote, X, Check } from "lucide-react";
import { toast } from "sonner";

interface AnnotateButtonProps {
  executionId: string;
  /** Called when the note is saved/cleared so the parent can re-read. */
  onChange?: (note: string) => void;
}

const STORAGE_KEY = (id: string) => `result-page:note:${id}`;

/** Read a saved note for a given execution. Safe on SSR. */
export function readSavedNote(executionId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY(executionId)) ?? "";
  } catch {
    return "";
  }
}

/**
 * Phase 3 functional addition · "Annotate this run."
 *
 * Lets the user write a quick note about the run — useful when you
 * revisit an old result and want to remember why you saved it.
 *
 * Stored in localStorage keyed by executionId. Limitation: doesn't sync
 * across browsers/devices. To make it sync, we'd need a `userNote` field
 * on Execution.metadata + an allowlist update on PATCH /api/executions/
 * [id]/metadata — flagged in the Phase 3 PRODUCT QUESTIONS section.
 */
export function AnnotateButton({ executionId, onChange }: AnnotateButtonProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate on mount
  useEffect(() => {
    setNote(readSavedNote(executionId));
  }, [executionId]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Autofocus on open
  useEffect(() => {
    if (open) taRef.current?.focus();
  }, [open]);

  const handleSave = () => {
    try {
      if (note.trim()) {
        window.localStorage.setItem(STORAGE_KEY(executionId), note.trim());
      } else {
        window.localStorage.removeItem(STORAGE_KEY(executionId));
      }
      toast.success(note.trim() ? "Note saved." : "Note cleared.");
      onChange?.(note.trim());
      setOpen(false);
    } catch {
      toast.error("Couldn't save the note. Local storage is disabled or full.");
    }
  };

  const hasNote = note.trim().length > 0;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={hasNote ? "Edit note" : "Add note"}
        title={hasNote ? "Edit note" : "Add note"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          borderRadius: 9999,
          background: hasNote ? "#FEF3C7" : "#F8FAFC",
          border: hasNote ? "1px solid rgba(217,119,6,0.32)" : "1px solid rgba(0,0,0,0.06)",
          color: hasNote ? "#B45309" : "#475569",
          cursor: "pointer",
          flexShrink: 0,
          transition: "all 0.18s",
          position: "relative",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = hasNote ? "#FDE68A" : "#F1F5F9";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = hasNote ? "#FEF3C7" : "#F8FAFC";
        }}
      >
        <StickyNote size={15} aria-hidden="true" />
        {hasNote ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 7,
              right: 9,
              width: 6,
              height: 6,
              borderRadius: 9999,
              background: "#D97706",
              boxShadow: "0 0 0 2px #FEF3C7",
            }}
          />
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              zIndex: 50,
              width: "min(92vw, 360px)",
              background: "#FFFFFF",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 14,
              boxShadow: "0 12px 32px rgba(15,23,42,0.10)",
              padding: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#94A3B8",
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                }}
              >
                Note · this run
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 9999,
                  background: "transparent",
                  border: "none",
                  color: "#64748B",
                  cursor: "pointer",
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <textarea
              ref={taRef}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Why this run matters — the prompt that worked, the client preference, the thing to remember…"
              rows={4}
              maxLength={400}
              style={{
                width: "100%",
                resize: "vertical",
                minHeight: 84,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "#FAFAF8",
                fontSize: 13,
                color: "#0F172A",
                fontFamily: "inherit",
                lineHeight: 1.55,
                outline: "none",
              }}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>
                {note.length} / 400 · saved on this device
              </span>
              <button
                type="button"
                onClick={handleSave}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 14px",
                  borderRadius: 9,
                  background: "#0D9488",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(13,148,136,0.18)",
                }}
              >
                <Check size={13} aria-hidden="true" />
                Save · ⌘ Enter
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
