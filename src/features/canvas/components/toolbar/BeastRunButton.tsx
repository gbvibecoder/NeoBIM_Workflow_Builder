"use client";

/**
 * BeastRunButton — Z.CANVAS.BEAST-RUN
 *
 * Premium 4-state Run button:
 *   READY → STARTING → RUNNING → COMPLETE → (dirty) → READY
 *
 * - READY: Green gradient, pulsing glow, "▶ RUN WORKFLOW"
 * - STARTING: Green gradient, spinner, "STARTING…"
 * - RUNNING: Amber gradient, shimmer bar, "■ STOP RUN"
 * - COMPLETE: Emerald gradient, checkmark, "✓ COMPLETED"
 */

import { memo, useEffect, useRef, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Play, Square, Check, Loader2, ChevronDown } from "lucide-react";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import { useLocale } from "@/hooks/useLocale";

type BeastState = "ready" | "starting" | "running" | "complete";

interface BeastRunButtonProps {
  isExecuting: boolean;
  isStartingRun: boolean;
  isWorkflowReady: boolean;
  workflowLocked: boolean;
  isDirty: boolean;
  onRun: () => void;
  onStop: () => void;
}

export const BeastRunButton = memo(function BeastRunButton({
  isExecuting,
  isStartingRun,
  isWorkflowReady,
  workflowLocked,
  isDirty,
  onRun,
  onStop,
}: BeastRunButtonProps) {
  const tk = useCanvasToken();
  const { t } = useLocale();
  const prefersReduced = useReducedMotion();

  // ── Dropdown state ──────────────────────────────────────────
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [showMenu]);

  // ── Complete state tracking ─────────────────────────────────
  const [showComplete, setShowComplete] = useState(false);
  const wasExecutingRef = useRef(false);

  useEffect(() => {
    if (isExecuting) {
      wasExecutingRef.current = true;
    } else if (wasExecutingRef.current) {
      wasExecutingRef.current = false;
      setShowComplete(true);
    }
  }, [isExecuting]);

  // Reset to READY when canvas is dirtied after completion
  useEffect(() => {
    if (showComplete && isDirty) setShowComplete(false);
  }, [showComplete, isDirty]);

  // ── Derive state ────────────────────────────────────────────
  const state: BeastState = useMemo(() => {
    if (isExecuting) return "running";
    if (isStartingRun) return "starting";
    if (showComplete && !isDirty) return "complete";
    return "ready";
  }, [isExecuting, isStartingRun, showComplete, isDirty]);

  const disabled = !isWorkflowReady && state === "ready";

  // ── Click handler ───────────────────────────────────────────
  const handleClick = useCallback(() => {
    if (state === "running") {
      onStop();
    } else if (state === "ready" || state === "complete") {
      setShowComplete(false);
      onRun();
    }
  }, [state, onRun, onStop]);

  // ── State styles ────────────────────────────────────────────
  const styles = useMemo(() => {
    switch (state) {
      case "running":
        return { bg: tk.beastRunningBg, shadow: tk.beastRunningShadow };
      case "complete":
        return { bg: tk.beastCompleteBg, shadow: tk.beastCompleteShadow };
      default: // ready + starting
        return { bg: tk.beastReadyBg, shadow: tk.beastReadyShadow };
    }
  }, [state, tk]);

  // ── Content per state ───────────────────────────────────────
  const content = useMemo(() => {
    switch (state) {
      case "starting":
        return { icon: <Loader2 size={13} style={{ animation: "spin 0.9s linear infinite" }} />, label: "Starting…" };
      case "running":
        return { icon: <Square size={11} fill="currentColor" />, label: t("canvas.stop") };
      case "complete":
        return { icon: <Check size={13} strokeWidth={3} />, label: "Completed" };
      default:
        return { icon: <Play size={12} fill="currentColor" />, label: t("canvas.runWorkflow") };
    }
  }, [state, t]);

  const ariaLabel = state === "running"
    ? `${t("canvas.stopExecution")} (Esc)`
    : workflowLocked
      ? "This workflow has already been executed"
      : `${t("canvas.runWorkflow")} (⌘↵)`;

  return (
    <div style={{ position: "relative", display: "inline-flex" }} ref={menuRef}>
      {/* Pulsing glow — READY state only */}
      {state === "ready" && isWorkflowReady && !prefersReduced && (
        <motion.div
          aria-hidden
          animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute", inset: -4, borderRadius: 16,
            background: `radial-gradient(ellipse at center, ${tk.beastReadyGlow}, transparent 70%)`,
            zIndex: -1, pointerEvents: "none",
          }}
        />
      )}

      {/* Main button */}
      <motion.button
        onClick={handleClick}
        disabled={disabled}
        title={ariaLabel}
        aria-label={ariaLabel}
        whileHover={!disabled && state !== "running" ? { y: -1 } : {}}
        whileTap={!disabled ? { scale: 0.97 } : {}}
        style={{
          position: "relative",
          background: disabled ? "transparent" : styles.bg,
          color: disabled ? tk.text4 : "#FFFFFF",
          height: 36,
          paddingLeft: 14, paddingRight: 12,
          borderRadius: "10px 0 0 10px",
          border: disabled ? `1px solid ${tk.line1}` : "none",
          borderRight: "none",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex", alignItems: "center", gap: 8,
          boxShadow: disabled ? "none" : `0 1px 0 rgba(255,255,255,0.20) inset, 0 4px 14px ${styles.shadow}`,
          opacity: disabled ? 0.5 : 1,
          overflow: "hidden",
          transition: "background 250ms ease, box-shadow 250ms ease, opacity 250ms ease",
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {content.icon}
            {content.label}
          </motion.span>
        </AnimatePresence>

        {/* Running shimmer bar */}
        {state === "running" && (
          <motion.div
            aria-hidden
            initial={{ x: "-100%" }}
            animate={{ x: "300%" }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute", bottom: 0, left: 0,
              width: "30%", height: 2,
              background: "rgba(255,255,255,0.5)",
              borderRadius: "0 0 10px 10px",
            }}
          />
        )}
      </motion.button>

      {/* Chevron dropdown */}
      <button
        onClick={() => setShowMenu((v) => !v)}
        aria-label={t("canvas.moreRunOptions")}
        aria-expanded={showMenu}
        aria-haspopup="menu"
        disabled={disabled}
        style={{
          height: 36, width: 28,
          borderRadius: "0 10px 10px 0",
          background: disabled ? "transparent" : styles.bg,
          color: disabled ? tk.text4 : "#FFFFFF",
          border: disabled ? `1px solid ${tk.line1}` : "none",
          borderLeft: disabled ? `1px solid ${tk.line1}` : "1px solid rgba(255,255,255,0.20)",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: disabled ? "none" : `0 1px 0 rgba(255,255,255,0.20) inset, 0 4px 14px ${styles.shadow}`,
          opacity: disabled ? 0.5 : 1,
          transition: "background 250ms ease, opacity 250ms ease",
          padding: 0,
        }}
      >
        <ChevronDown size={11} />
      </button>

      {/* Dropdown menu */}
      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0,
              width: 200, borderRadius: 12, overflow: "hidden",
              background: tk.dropdownBg, border: `1px solid ${tk.dropdownBorder}`,
              boxShadow: tk.dropdownShadow, zIndex: 50,
            }}
          >
            <div style={{ padding: 4 }}>
              {[
                { label: t("canvas.runAllNodes"), sub: t("canvas.executeFullWorkflow") },
                { label: t("canvas.runFromSelection"), sub: t("canvas.startFromSelected") },
                { label: t("canvas.stepThrough"), sub: t("canvas.executeOneNode") },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => { onRun(); setShowMenu(false); }}
                  style={{
                    width: "100%", display: "flex", flexDirection: "column", gap: 1,
                    padding: "8px 10px", borderRadius: 8, background: "transparent",
                    border: "none", cursor: "pointer", textAlign: "left",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = tk.hoverBg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 12, fontWeight: 500, color: tk.text1 }}>{item.label}</span>
                  <span style={{ fontSize: 10, color: tk.text3 }}>{item.sub}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { from {transform:rotate(0deg)} to {transform:rotate(360deg)} }`}</style>
    </div>
  );
});
