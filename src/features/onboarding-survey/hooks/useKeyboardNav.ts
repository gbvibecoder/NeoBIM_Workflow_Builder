"use client";

import { useEffect } from "react";

interface KeyboardNavHandlers {
  onPrev?: () => void;
  onNext?: () => void;
  onConfirm?: () => void;
  onSkip?: () => void;
  onNumber?: (n: number) => void; // 1-9
  enabled?: boolean;
}

export function useKeyboardNav({ onPrev, onNext, onConfirm, onSkip, onNumber, enabled = true }: KeyboardNavHandlers) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore while typing in an input / textarea / contenteditable
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (target?.isContentEditable ?? false);
      if (isEditing) return;

      if (e.key === "ArrowLeft" && onPrev) { e.preventDefault(); onPrev(); return; }
      if (e.key === "ArrowRight" && onNext) { e.preventDefault(); onNext(); return; }
      if (e.key === "Enter" && onConfirm) { e.preventDefault(); onConfirm(); return; }
      if (e.key === "Escape" && onSkip) { e.preventDefault(); onSkip(); return; }

      if (onNumber && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        onNumber(Number(e.key));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onPrev, onNext, onConfirm, onSkip, onNumber, enabled]);
}
