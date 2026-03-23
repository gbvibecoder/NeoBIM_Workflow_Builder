"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Save, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

interface SaveWorkflowModalProps {
  isOpen: boolean;
  existingNames: string[];
  onSave: (name: string) => void;
  onClose: () => void;
}

const MIN_LENGTH = 3;
const MAX_LENGTH = 60;

export function SaveWorkflowModal({
  isOpen,
  existingNames,
  onSave,
  onClose,
}: SaveWorkflowModalProps) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const isValid = trimmed.length >= MIN_LENGTH;
  const isDuplicate = existingNames.some(
    (n) => n.toLowerCase() === trimmed.toLowerCase()
  );

  // Reset & auto-focus when modal opens
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on open
      setName("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const modalRef = useRef<HTMLDivElement>(null);

  // Escape to close + focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
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

  const handleSubmit = useCallback(() => {
    if (!isValid) return;
    onSave(trimmed);
  }, [isValid, trimmed, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (val.length <= MAX_LENGTH) setName(val);
    },
    []
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="save-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        >
          <motion.div
            ref={modalRef}
            key="save-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-modal-title"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              margin: "0 16px",
              background: "rgba(7,8,9,0.92)",
              border: "1px solid rgba(184,115,51,0.15)",
              borderRadius: 4,
              padding: "24px",
              boxShadow:
                "0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 4,
                    background: "rgba(0,245,255,0.1)",
                    border: "1px solid rgba(0,245,255,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Save size={16} style={{ color: "#00F5FF" }} />
                </div>
                <div>
                  <h3
                    id="save-modal-title"
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      color: "#F0F0F5",
                      margin: 0,
                      lineHeight: 1.3,
                    }}
                  >
                    {t('save.nameYourWorkflow')}
                  </h3>
                  <p
                    style={{
                      fontSize: 13,
                      color: "#9898B0",
                      margin: 0,
                      marginTop: 2,
                    }}
                  >
                    {t('save.requiredBeforeSaving')}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#5C5C78",
                  cursor: "pointer",
                  transition: "all 0.1s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#F0F0F5";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#5C5C78";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Input */}
            <input
              ref={inputRef}
              value={name}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={t('save.namePlaceholder')}
              style={{
                width: "100%",
                background: "rgba(10,12,14,0.7)",
                border: `1px solid ${
                  name.length > 0 && !isValid
                    ? "rgba(239,68,68,0.4)"
                    : "rgba(255,255,255,0.1)"
                }`,
                borderRadius: 4,
                padding: "12px 16px",
                fontSize: 14,
                color: "#F0F0F5",
                outline: "none",
                transition: "border-color 0.15s ease",
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(0,245,255,0.4)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor =
                  name.length > 0 && !isValid
                    ? "rgba(239,68,68,0.4)"
                    : "rgba(255,255,255,0.1)";
              }}
            />

            {/* Hints row */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginTop: 8,
                minHeight: 20,
              }}
            >
              <div style={{ flex: 1 }}>
                {isDuplicate ? (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#F59E0B",
                      lineHeight: 1.4,
                    }}
                  >
                    {t('save.duplicateName')}
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#5C5C78",
                      lineHeight: 1.4,
                    }}
                  >
                    {t('save.nameHint')}
                  </span>
                )}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color:
                    trimmed.length > 0 && trimmed.length < MIN_LENGTH
                      ? "#EF4444"
                      : "#5C5C78",
                  fontVariantNumeric: "tabular-nums",
                  marginLeft: 12,
                  flexShrink: 0,
                }}
              >
                {trimmed.length}/{MAX_LENGTH}
              </span>
            </div>

            {/* Buttons */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 20,
              }}
            >
              <button
                onClick={onClose}
                style={{
                  height: 40,
                  padding: "0 20px",
                  borderRadius: 4,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#9898B0",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                  e.currentTarget.style.color = "#F0F0F5";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                  e.currentTarget.style.color = "#9898B0";
                }}
              >
                {t('save.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!isValid}
                style={{
                  height: 40,
                  padding: "0 24px",
                  borderRadius: 4,
                  background: isValid
                    ? "linear-gradient(135deg, #00F5FF 0%, #B87333 100%)"
                    : "#2A2A3E",
                  border: "none",
                  color: isValid ? "#fff" : "#5C5C78",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isValid ? "pointer" : "not-allowed",
                  opacity: isValid ? 1 : 0.6,
                  transition: "all 0.15s ease",
                  boxShadow: isValid
                    ? "0 4px 16px rgba(0,245,255,0.25)"
                    : "none",
                }}
                onMouseEnter={(e) => {
                  if (isValid) {
                    e.currentTarget.style.filter = "brightness(1.1)";
                    e.currentTarget.style.boxShadow =
                      "0 4px 24px rgba(0,245,255,0.4)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = "brightness(1)";
                  if (isValid) {
                    e.currentTarget.style.boxShadow =
                      "0 4px 16px rgba(0,245,255,0.25)";
                  }
                }}
              >
                {t('save.saveWorkflow')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
