"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Save, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2,
  Share2, Sparkles, MousePointer2, Layers, Layers3, ChevronDown,
  Loader2, CheckCircle2, Pencil,
} from "lucide-react";
import type { CreationMode } from "@/types/workflow";
import { useWorkflowStore, isUntitledWorkflow } from "@/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import {
  shareWorkflowToTwitter,
  shareWorkflowToLinkedIn,
  copyShareLink,
} from "@/lib/share";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CanvasToolbarProps {
  workflowName: string;
  creationMode: CreationMode;
  isExecuting: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isNodeLibraryOpen: boolean;
  onRun: () => void;
  onStop: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onShare: () => void;
  onModeChange: (mode: CreationMode) => void;
  onPromptMode: () => void;
  onToggleLibrary: () => void;
  onNameChange?: (name: string) => void;
}

// ─── Mode config ──────────────────────────────────────────────────────────────

const MODE_ICONS: Record<CreationMode, React.ReactNode> = {
  manual: <MousePointer2 size={12} />,
  prompt: <Sparkles size={12} />,
  hybrid: <Layers size={12} />,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Sep() {
  return (
    <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.04)", margin: "0 6px", flexShrink: 0 }} />
  );
}

interface TBBtnProps {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
}

function TBBtn({ onClick, icon, title, disabled }: TBBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        width: 32, height: 32, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none",
        color: "#5C5C78", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all 150ms ease",
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "#F0F0F5";
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "#5C5C78";
      }}
    >
      {icon}
    </button>
  );
}

// ─── Pulse animation keyframes ────────────────────────────────────────────────
const pulseKeyframes = `
@keyframes runButtonPulse {
  0%, 100% {
    box-shadow: 0 2px 12px rgba(79, 138, 255, 0.25);
  }
  50% {
    box-shadow: 0 2px 20px rgba(79, 138, 255, 0.45);
  }
}
`;

// ─── Main toolbar ─────────────────────────────────────────────────────────────

export function CanvasToolbar({
  workflowName,
  creationMode,
  isExecuting,
  isDirty,
  isSaving,
  isNodeLibraryOpen,
  onRun,
  onStop,
  onSave,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  onShare,
  onModeChange,
  onPromptMode,
  onToggleLibrary,
  onNameChange,
}: CanvasToolbarProps) {
  const { t } = useLocale();

  const MODE_CONFIG: Record<CreationMode, { label: string; icon: React.ReactNode; description: string }> = {
    manual: { label: t('canvas.manual'),    icon: MODE_ICONS.manual, description: t('canvas.manualDesc')    },
    prompt: { label: t('canvas.aiPrompt'),  icon: MODE_ICONS.prompt, description: t('canvas.aiPromptDesc')  },
    hybrid: { label: t('canvas.hybrid'),    icon: MODE_ICONS.hybrid, description: t('canvas.hybridDesc')    },
  };

  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showRunMenu, setShowRunMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(workflowName);
  const [savedFlash, setSavedFlash] = useState(false);

  const modeMenuRef = useRef<HTMLDivElement>(null);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const { openSaveModal } = useWorkflowStore();
  const isUntitled = isUntitledWorkflow(workflowName);

  const handleSave = useCallback(() => {
    if (isUntitled) {
      openSaveModal();
      return;
    }
    onSave();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }, [onSave, isUntitled, openSaveModal]);

  // Keep keyboard handler up-to-date without re-registering the listener
  const kbRef = useRef<(e: KeyboardEvent) => void>(null!);
  useEffect(() => {
    kbRef.current = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "s") { e.preventDefault(); if (!isSaving) handleSave(); }
      if (meta && e.key === "z" && !e.shiftKey) { e.preventDefault(); onUndo(); }
      if (meta && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); onRedo(); }
      if (meta && e.key === "Enter") { e.preventDefault(); if (!isExecuting) onRun(); }
      if (e.key === "Escape" && isExecuting) onStop();
    };
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => kbRef.current(e);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []); // intentionally empty — ref pattern keeps it fresh

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) setShowModeMenu(false);
      if (runMenuRef.current && !runMenuRef.current.contains(e.target as Node)) setShowRunMenu(false);
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) setShowShareMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Inject pulse animation styles
  useEffect(() => {
    const styleId = "run-button-pulse-animation";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = pulseKeyframes;
      document.head.appendChild(style);
    }
  }, []);

  const commitName = useCallback(() => {
    setIsEditingName(false);
    const trimmed = nameValue.trim() || workflowName;
    if (trimmed !== workflowName) onNameChange?.(trimmed);
  }, [nameValue, workflowName, onNameChange]);

  const currentMode = MODE_CONFIG[creationMode];

  // Check if workflow is ready to run (has nodes)
  // In real implementation, you'd check from Zustand store
  const { nodes } = useWorkflowStore();
  const isWorkflowReady = nodes.length > 0 && !isExecuting;

  return (
    <>
      {/* Desktop toolbar - floating pill at top */}
      <div
        className="flex"
        style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
          zIndex: 1000,
          height: 48,
          alignItems: "center", justifyContent: "space-between",
          padding: "0 14px",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          background: "rgba(8,8,15,0.88)",
          backdropFilter: "blur(40px) saturate(1.4)",
          WebkitBackdropFilter: "blur(40px) saturate(1.4)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.03) inset",
          gap: 4,
        }}
      >
        {/* ── Left group ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>

          {/* Library toggle */}
          <button
            onClick={onToggleLibrary}
            title={t('canvas.toggleNodeLibrary')}
            aria-label={t('canvas.toggleNodeLibrary')}
            aria-pressed={isNodeLibraryOpen}
            style={{
              width: 30, height: 30, borderRadius: 7,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: isNodeLibraryOpen ? "rgba(79,138,255,0.12)" : "transparent",
              border: `1px solid ${isNodeLibraryOpen ? "rgba(79,138,255,0.3)" : "transparent"}`,
              color: isNodeLibraryOpen ? "#4F8AFF" : "#55556A",
              cursor: "pointer", transition: "all 0.15s ease",
            }}
            onMouseEnter={e => {
              if (!isNodeLibraryOpen) {
                e.currentTarget.style.background = "#1A1A26";
                e.currentTarget.style.color = "#F0F0F5";
              }
            }}
            onMouseLeave={e => {
              if (!isNodeLibraryOpen) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#55556A";
              }
            }}
          >
            <Layers3 size={14} />
          </button>

          <Sep />

          {/* Mode selector */}
          <div style={{ position: "relative" }} ref={modeMenuRef}>
            <button
              onClick={() => setShowModeMenu(v => !v)}
              aria-label={`${t('canvas.creationMode')}: ${currentMode.label}`}
              aria-expanded={showModeMenu}
              aria-haspopup="menu"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                height: 30, padding: "0 9px", borderRadius: 7,
                background: showModeMenu ? "#1A1A26" : "transparent",
                border: `1px solid ${showModeMenu ? "#3A3A4E" : "transparent"}`,
                color: "#F0F0F5", cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#1A1A26"; }}
              onMouseLeave={e => { if (!showModeMenu) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ color: "#4F8AFF", display: "flex" }}>{currentMode.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{currentMode.label}</span>
              <ChevronDown size={9} style={{ color: "#55556A" }} />
            </button>

            <AnimatePresence>
              {showModeMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0,
                    width: 188, borderRadius: 10, overflow: "hidden",
                    background: "#12121A", border: "1px solid #2A2A3E",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 50,
                  }}
                >
                  {(Object.entries(MODE_CONFIG) as [CreationMode, typeof MODE_CONFIG[CreationMode]][]).map(([value, cfg]) => {
                    const active = creationMode === value;
                    return (
                      <button
                        key={value}
                        onClick={() => {
                          onModeChange(value);
                          setShowModeMenu(false);
                          if (value === "prompt") onPromptMode();
                        }}
                        style={{
                          width: "100%", display: "flex", alignItems: "flex-start", gap: 10,
                          padding: "9px 12px",
                          background: active ? "#1A1A26" : "transparent",
                          border: "none", cursor: "pointer", textAlign: "left",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#161620"; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{ color: active ? "#4F8AFF" : "#55556A", marginTop: 1, display: "flex" }}>
                          {cfg.icon}
                        </span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: active ? "#4F8AFF" : "#F0F0F5" }}>
                            {cfg.label}
                          </div>
                          <div style={{ fontSize: 10, color: "#55556A", marginTop: 1 }}>
                            {cfg.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Sep />

          {/* Undo / Redo */}
          <TBBtn onClick={onUndo} icon={<Undo2 size={13} />} title={`${t('canvas.undo')} (⌘Z)`} />
          <TBBtn onClick={onRedo} icon={<Redo2 size={13} />} title={`${t('canvas.redo')} (⌘⇧Z)`} />
        </div>

        <Sep />

        {/* ── Center — inline-editable name ───────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {isEditingName ? (
            <input
              ref={nameInputRef}
              value={nameValue}
              onChange={e => setNameValue(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); commitName(); }
                if (e.key === "Escape") { setNameValue(workflowName); setIsEditingName(false); }
              }}
              maxLength={80}
              autoFocus
              style={{
                background: "transparent", border: "none",
                borderBottom: "1px solid #4F8AFF",
                color: "#F0F0F5", fontSize: 12, fontWeight: 500,
                outline: "none", textAlign: "center",
                minWidth: 80, maxWidth: 180, padding: "1px 2px",
              }}
            />
          ) : (
            <button
              onClick={() => {
                setNameValue(workflowName);
                setIsEditingName(true);
                setTimeout(() => nameInputRef.current?.select(), 0);
              }}
              title={t('canvas.clickToRename')}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "transparent", border: "none", cursor: "text",
                padding: "3px 6px", borderRadius: 5,
                maxWidth: 180, transition: "background 0.1s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                fontSize: 12, fontWeight: 500, color: "#8888A0",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 140,
              }}>
                {workflowName}
              </span>
              <Pencil size={9} style={{ color: "#3A3A4E", flexShrink: 0 }} />
              {isDirty && (
                <div
                  title={t('canvas.unsavedChanges')}
                  style={{ width: 5, height: 5, borderRadius: "50%", background: "#F59E0B", flexShrink: 0 }}
                />
              )}
            </button>
          )}
        </div>

        <Sep />

        {/* ── Right group ─────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>

          {/* Zoom */}
          <TBBtn onClick={onZoomOut} icon={<ZoomOut size={13} />} title={t('canvas.zoomOut')} />
          <TBBtn onClick={onZoomIn} icon={<ZoomIn size={13} />} title={t('canvas.zoomIn')} />
          <TBBtn onClick={onFitView} icon={<Maximize2 size={13} />} title={t('canvas.fitToScreen')} />

          <Sep />

          {/* AI Prompt */}
          <button
            onClick={onPromptMode}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              height: 36, padding: "0 16px", borderRadius: 8,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#F0F0F5", fontSize: 14, fontWeight: 500,
              cursor: "pointer", transition: "all 150ms ease",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            }}
          >
            <Sparkles size={11} />
            {t('canvas.ai')}
          </button>

          {/* Share dropdown */}
          <div style={{ position: "relative" }} ref={shareMenuRef}>
            <TBBtn
              onClick={() => setShowShareMenu(v => !v)}
              icon={<Share2 size={13} />}
              title={t('canvas.share')}
            />
            <AnimatePresence>
              {showShareMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: "absolute", top: "calc(100% + 4px)", right: 0,
                    width: 180, borderRadius: 10, overflow: "hidden",
                    background: "#12121A", border: "1px solid #2A2A3E",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 50,
                  }}
                >
                  {[
                    { label: "Share on X", action: () => shareWorkflowToTwitter(workflowName) },
                    { label: "Share on LinkedIn", action: () => shareWorkflowToLinkedIn() },
                    { label: "Copy Link", action: () => copyShareLink() },
                  ].map(item => (
                    <button
                      key={item.label}
                      onClick={() => { item.action(); setShowShareMenu(false); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        padding: "9px 12px", background: "transparent",
                        border: "none", cursor: "pointer", textAlign: "left",
                        fontSize: 12, fontWeight: 500, color: "#F0F0F5",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#1A1A26"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {item.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={(!isDirty && !savedFlash && !isUntitled) || isSaving}
            title={isUntitled ? t('canvas.nameToSave') : `${t('canvas.save')} (⌘S)`}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              height: 36, padding: "0 16px", borderRadius: 8,
              background: "transparent",
              border: savedFlash
                ? "1px solid rgba(16,185,129,0.4)"
                : isUntitled && isDirty
                  ? "1px solid rgba(245,158,11,0.4)"
                  : isDirty ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
              color: savedFlash ? "#10B981" : isUntitled && isDirty ? "#F59E0B" : isDirty ? "#9898B0" : "#3A3A4E",
              fontSize: 13, fontWeight: 500,
              cursor: isDirty || savedFlash || isUntitled ? "pointer" : "default",
              transition: "all 150ms ease",
              opacity: !isDirty && !savedFlash && !isSaving && !isUntitled ? 0.5 : 1,
              boxShadow: isUntitled && isDirty ? "0 0 12px rgba(245,158,11,0.15)" : "none",
            }}
            onMouseEnter={e => {
              if (isDirty && !savedFlash) {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.color = "#F0F0F5";
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "transparent";
              if (!savedFlash) {
                e.currentTarget.style.color = isDirty ? "#9898B0" : "#3A3A4E";
              }
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isSaving ? (
                <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  style={{ display: "flex" }}>
                  <Loader2 size={12} className="animate-spin" />
                </motion.span>
              ) : savedFlash ? (
                <motion.span key="saved" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }} style={{ display: "flex" }}>
                  <CheckCircle2 size={12} />
                </motion.span>
              ) : (
                <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  style={{ display: "flex" }}>
                  <Save size={12} />
                </motion.span>
              )}
            </AnimatePresence>
            {isSaving ? `${t('canvas.saving')}…` : savedFlash ? t('canvas.saved') : t('canvas.save')}
          </button>

          <Sep />

          {/* Run / Stop */}
          {isExecuting ? (
            <button
              onClick={onStop}
              title={`${t('canvas.stopExecution')} (Esc)`}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                height: 36, padding: "0 20px", borderRadius: 10,
                background: "#EF4444", border: "none",
                color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: "pointer", transition: "background 0.15s ease",
                boxShadow: "0 2px 16px rgba(239, 68, 68, 0.3)",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#DC2626"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#EF4444"; }}
            >
              <Square size={14} fill="white" />
              {t('canvas.stop')}
            </button>
          ) : (
            <div style={{ display: "flex", position: "relative" }} ref={runMenuRef}>
              <button
                onClick={onRun}
                title={`${t('canvas.runWorkflow')} (⌘↵)`}
                disabled={!isWorkflowReady}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  height: 36, paddingLeft: 20, paddingRight: 16,
                  borderRadius: "12px 0 0 12px",
                  background: isWorkflowReady
                    ? "linear-gradient(135deg, #4F8AFF 0%, #6366F1 50%, #4F8AFF 100%)"
                    : "#2A2A3E",
                  backgroundSize: "200% 200%",
                  border: "none",
                  color: "#fff", fontSize: 14, fontWeight: 600,
                  cursor: isWorkflowReady ? "pointer" : "not-allowed",
                  transition: "all 200ms ease",
                  boxShadow: isWorkflowReady
                    ? "0 0 25px rgba(79,138,255,0.3), inset 0 1px 0 rgba(255,255,255,0.15)"
                    : "none",
                  opacity: isWorkflowReady ? 1 : 0.5,
                  animation: isWorkflowReady ? "gradient-shift 3s ease infinite" : "none",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={e => {
                  if (isWorkflowReady) {
                    e.currentTarget.style.filter = "brightness(1.1)";
                    e.currentTarget.style.boxShadow = "0 0 35px rgba(79,138,255,0.5), inset 0 1px 0 rgba(255,255,255,0.2)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.filter = "brightness(1)";
                  e.currentTarget.style.boxShadow = isWorkflowReady
                    ? "0 0 25px rgba(79,138,255,0.3), inset 0 1px 0 rgba(255,255,255,0.15)"
                    : "none";
                }}
              >
                <Play size={14} fill="white" />
                {t('canvas.runWorkflow')}
              </button>

              <button
                onClick={() => setShowRunMenu(v => !v)}
                aria-label={t('canvas.moreRunOptions')}
                aria-expanded={showRunMenu}
                aria-haspopup="menu"
                disabled={!isWorkflowReady}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 30, height: 36, padding: 0,
                  borderRadius: "0 12px 12px 0",
                  background: isWorkflowReady ? "rgba(79,138,255,0.85)" : "#25253A",
                  border: "none",
                  borderLeft: "1px solid rgba(255,255,255,0.12)",
                  color: "rgba(255,255,255,0.75)",
                  cursor: isWorkflowReady ? "pointer" : "not-allowed",
                  transition: "background 0.15s ease",
                  opacity: isWorkflowReady ? 1 : 0.6,
                }}
                onMouseEnter={e => { if (isWorkflowReady) e.currentTarget.style.background = "#3472EB"; }}
                onMouseLeave={e => { if (isWorkflowReady) e.currentTarget.style.background = "#3D7AFF"; }}
              >
                <ChevronDown size={12} />
              </button>

              {/* Run dropdown */}
              <AnimatePresence>
                {showRunMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.12 }}
                    style={{
                      position: "absolute", top: "calc(100% + 4px)", right: 0,
                      width: 190, borderRadius: 10, overflow: "hidden",
                      background: "#12121A", border: "1px solid #2A2A3E",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 50,
                    }}
                  >
                    {[
                      { label: t('canvas.runAllNodes'),       sub: t('canvas.executeFullWorkflow')  },
                      { label: t('canvas.runFromSelection'),  sub: t('canvas.startFromSelected')    },
                      { label: t('canvas.stepThrough'),       sub: t('canvas.executeOneNode')       },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={() => { onRun(); setShowRunMenu(false); }}
                        style={{
                          width: "100%", display: "flex", flexDirection: "column", gap: 1,
                          padding: "8px 12px", background: "transparent",
                          border: "none", cursor: "pointer", textAlign: "left",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#1A1A26"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#F0F0F5" }}>{item.label}</span>
                        <span style={{ fontSize: 10, color: "#55556A" }}>{item.sub}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Mobile sticky bottom bar - ALWAYS VISIBLE */}
      <motion.div
        className="md:hidden"
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          padding: "12px 16px",
          background: "rgba(7, 7, 13, 0.95)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.3)",
        }}
      >
        {/* Full-width Run button for mobile */}
        {isExecuting ? (
          <button
            onClick={onStop}
            style={{
              width: "100%",
              height: 60,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "#EF4444",
              border: "none",
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s ease",
              boxShadow: "0 0 24px rgba(239, 68, 68, 0.4)",
            }}
          >
            <Square size={16} fill="white" />
            {t('canvas.stopExecution')}
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={!isWorkflowReady}
            style={{
              width: "100%",
              height: 60,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: isWorkflowReady
                ? "#4F8AFF"
                : "#3A3A50",
              border: "none",
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: isWorkflowReady ? "pointer" : "not-allowed",
              
              opacity: isWorkflowReady ? 1 : 0.6,
              transition: "all 0.15s ease",
            }}
          >
            {isExecuting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {t('canvas.running')}
              </>
            ) : (
              <>
                <Play size={18} fill="white" />
                {t('canvas.runWorkflow')}
              </>
            )}
          </button>
        )}

        {/* Mobile utility bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}>
          <button
            onClick={onToggleLibrary}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 8,
              background: isNodeLibraryOpen ? "rgba(79,138,255,0.12)" : "transparent",
              border: `1px solid ${isNodeLibraryOpen ? "rgba(79,138,255,0.3)" : "rgba(255,255,255,0.08)"}`,
              color: isNodeLibraryOpen ? "#4F8AFF" : "#F0F0F5",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <Layers3 size={14} />
            {t('canvas.nodes')}
          </button>

          <button
            onClick={handleSave}
            disabled={(!isDirty && !savedFlash && !isUntitled) || isSaving}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 8,
              background: "transparent",
              border: savedFlash
                ? "1px solid rgba(16,185,129,0.4)"
                : isUntitled && isDirty
                  ? "1px solid rgba(245,158,11,0.4)"
                  : isDirty ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
              color: savedFlash ? "#10B981" : isUntitled && isDirty ? "#F59E0B" : isDirty ? "#F0F0F5" : "#3A3A4E",
              fontSize: 12,
              fontWeight: 500,
              cursor: isDirty || savedFlash || isUntitled ? "pointer" : "default",
              opacity: !isDirty && !savedFlash && !isSaving && !isUntitled ? 0.5 : 1,
            }}
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : savedFlash ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {isSaving ? t('canvas.saving') : savedFlash ? t('canvas.saved') : t('canvas.save')}
          </button>

          <button
            onClick={onPromptMode}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 8,
              background: "rgba(139,92,246,0.08)",
              border: "1px solid rgba(139,92,246,0.2)",
              color: "#8B5CF6",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <Sparkles size={14} />
            {t('canvas.ai')}
          </button>
        </div>
      </motion.div>
    </>
  );
}
