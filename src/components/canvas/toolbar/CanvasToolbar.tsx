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
    <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)", margin: "0 8px", flexShrink: 0 }} />
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
        width: 44, height: 44, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none",
        color: "rgba(255,255,255,0.55)", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition: "all 150ms ease",
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "rgba(255,255,255,0.9)";
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(255,255,255,0.55)";
      }}
      onFocus={e => {
        if (!disabled) {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "rgba(255,255,255,0.9)";
        }
      }}
      onBlur={e => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(255,255,255,0.55)";
      }}
    >
      {icon}
    </button>
  );
}

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

  const commitName = useCallback(() => {
    setIsEditingName(false);
    const trimmed = nameValue.trim() || workflowName;
    if (trimmed !== workflowName) onNameChange?.(trimmed);
  }, [nameValue, workflowName, onNameChange]);

  const currentMode = MODE_CONFIG[creationMode];

  const { nodes } = useWorkflowStore();
  const isWorkflowReady = nodes.length > 0 && !isExecuting;

  // Save button state
  const canSave = isDirty || isUntitled;
  const saveDisabled = (!canSave && !savedFlash) || isSaving;

  return (
    <>
      {/* Desktop toolbar - floating pill at top */}
      <div
        className="hidden md:flex"
        style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
          zIndex: 1000,
          height: 44,
          alignItems: "center",
          padding: "0 6px",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          background: "rgba(10, 12, 16, 0.88)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.03) inset",
          gap: 2,
        }}
      >
        {/* ── Left group: Library + Mode + Undo/Redo ──────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>

          {/* Library toggle */}
          <button
            onClick={onToggleLibrary}
            title={t('canvas.toggleNodeLibrary')}
            aria-label={t('canvas.toggleNodeLibrary')}
            aria-pressed={isNodeLibraryOpen}
            style={{
              width: 44, height: 44, borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: isNodeLibraryOpen ? "rgba(0,245,255,0.10)" : "transparent",
              border: isNodeLibraryOpen ? "1px solid rgba(0,245,255,0.25)" : "1px solid transparent",
              color: isNodeLibraryOpen ? "#00F5FF" : "rgba(255,255,255,0.55)",
              cursor: "pointer", transition: "all 0.15s ease",
            }}
            onMouseEnter={e => {
              if (!isNodeLibraryOpen) {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.color = "rgba(255,255,255,0.9)";
              }
            }}
            onMouseLeave={e => {
              if (!isNodeLibraryOpen) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "rgba(255,255,255,0.55)";
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
                height: 30, padding: "0 10px", borderRadius: 7,
                background: showModeMenu ? "rgba(255,255,255,0.06)" : "transparent",
                border: showModeMenu ? "1px solid rgba(255,255,255,0.1)" : "1px solid transparent",
                color: "#F0F0F5", cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={e => { if (!showModeMenu) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ color: "#00F5FF", display: "flex" }}>{currentMode.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{currentMode.label}</span>
              <ChevronDown size={9} style={{ color: "rgba(255,255,255,0.35)" }} />
            </button>

            <AnimatePresence>
              {showModeMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0,
                    width: 200, borderRadius: 12, overflow: "hidden",
                    background: "rgba(12,13,16,0.98)", border: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.5)", zIndex: 50,
                  }}
                >
                  <div style={{ padding: 4 }}>
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
                            padding: "8px 10px", borderRadius: 8,
                            background: active ? "rgba(0,245,255,0.06)" : "transparent",
                            border: "none", cursor: "pointer", textAlign: "left",
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                          onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ color: active ? "#00F5FF" : "rgba(255,255,255,0.35)", marginTop: 1, display: "flex" }}>
                            {cfg.icon}
                          </span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: active ? "#00F5FF" : "#F0F0F5" }}>
                              {cfg.label}
                            </div>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                              {cfg.description}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Sep />

          {/* Undo / Redo */}
          <TBBtn onClick={onUndo} icon={<Undo2 size={14} />} title={`${t('canvas.undo')} (⌘Z)`} />
          <TBBtn onClick={onRedo} icon={<Redo2 size={14} />} title={`${t('canvas.redo')} (⌘⇧Z)`} />
        </div>

        <Sep />

        {/* ── Center — inline-editable name ───────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
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
                background: "transparent",
                borderTop: "none", borderLeft: "none", borderRight: "none",
                borderBottom: "1px solid rgba(0,245,255,0.4)",
                color: "#F0F0F5", fontSize: 12, fontWeight: 500,
                outline: "none", textAlign: "center",
                minWidth: 80, maxWidth: 200, padding: "2px 4px",
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
                display: "flex", alignItems: "center", gap: 5,
                background: "transparent", border: "none", cursor: "text",
                padding: "4px 8px", borderRadius: 6,
                maxWidth: 200, transition: "background 0.1s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.5)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 160,
              }}>
                {workflowName}
              </span>
              <Pencil size={9} style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }} />
              {isDirty && (
                <div
                  title={t('canvas.unsavedChanges')}
                  style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFBF00", flexShrink: 0 }}
                />
              )}
            </button>
          )}
        </div>

        <Sep />

        {/* ── Right group: Zoom + AI + Share + Save + Run ─────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>

          {/* Zoom controls */}
          <TBBtn onClick={onZoomOut} icon={<ZoomOut size={14} />} title={t('canvas.zoomOut')} />
          <TBBtn onClick={onZoomIn} icon={<ZoomIn size={14} />} title={t('canvas.zoomIn')} />
          <TBBtn onClick={onFitView} icon={<Maximize2 size={14} />} title={t('canvas.fitToScreen')} />

          <Sep />

          {/* AI Prompt */}
          <button
            onClick={onPromptMode}
            title={t('canvas.ai')}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              height: 30, padding: "0 12px", borderRadius: 7,
              background: "rgba(0,245,255,0.06)",
              border: "1px solid rgba(0,245,255,0.15)",
              color: "#00F5FF", fontSize: 12, fontWeight: 500,
              cursor: "pointer", transition: "all 150ms ease",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(0,245,255,0.12)";
              e.currentTarget.style.borderColor = "rgba(0,245,255,0.3)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(0,245,255,0.06)";
              e.currentTarget.style.borderColor = "rgba(0,245,255,0.15)";
            }}
          >
            <Sparkles size={11} />
            {t('canvas.ai')}
          </button>

          {/* Share dropdown */}
          <div style={{ position: "relative" }} ref={shareMenuRef}>
            <TBBtn
              onClick={() => setShowShareMenu(v => !v)}
              icon={<Share2 size={14} />}
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
                    position: "absolute", top: "calc(100% + 6px)", right: 0,
                    width: 180, borderRadius: 12, overflow: "hidden",
                    background: "rgba(12,13,16,0.98)", border: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.5)", zIndex: 50,
                  }}
                >
                  <div style={{ padding: 4 }}>
                    {[
                      { label: t('canvas.shareOnX'), action: () => shareWorkflowToTwitter(workflowName) },
                      { label: t('canvas.copyLink'), action: () => copyShareLink() },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={() => { item.action(); setShowShareMenu(false); }}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 8,
                          padding: "8px 10px", borderRadius: 8, background: "transparent",
                          border: "none", cursor: "pointer", textAlign: "left",
                          fontSize: 12, fontWeight: 500, color: "#F0F0F5",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saveDisabled}
            title={isUntitled ? t('canvas.nameToSave') : `${t('canvas.save')} (⌘S)`}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              height: 30, padding: "0 12px", borderRadius: 7,
              background: savedFlash
                ? "rgba(16,185,129,0.10)"
                : canSave
                  ? "rgba(255,255,255,0.04)"
                  : "transparent",
              border: savedFlash
                ? "1px solid rgba(16,185,129,0.3)"
                : canSave
                  ? "1px solid rgba(255,255,255,0.1)"
                  : "1px solid transparent",
              color: savedFlash
                ? "#34D399"
                : canSave
                  ? "rgba(255,255,255,0.85)"
                  : "rgba(255,255,255,0.25)",
              fontSize: 12, fontWeight: 500,
              cursor: saveDisabled ? "default" : "pointer",
              transition: "all 150ms ease",
              opacity: saveDisabled && !isSaving ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (!saveDisabled) {
                e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                e.currentTarget.style.color = "#fff";
              }
            }}
            onMouseLeave={e => {
              if (!saveDisabled) {
                e.currentTarget.style.background = canSave ? "rgba(255,255,255,0.04)" : "transparent";
                e.currentTarget.style.color = canSave ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)";
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
                height: 32, padding: "0 16px", borderRadius: 8,
                background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)",
                color: "#EF4444", fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all 0.15s ease",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "rgba(239,68,68,0.2)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "rgba(239,68,68,0.12)";
              }}
            >
              <Square size={12} fill="currentColor" />
              {t('canvas.stop')}
            </button>
          ) : (
            <div style={{ display: "flex", position: "relative" }} ref={runMenuRef}>
              <button
                onClick={onRun}
                title={`${t('canvas.runWorkflow')} (⌘↵)`}
                disabled={!isWorkflowReady}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: 32, paddingLeft: 14, paddingRight: 10,
                  borderRadius: "8px 0 0 8px",
                  background: isWorkflowReady
                    ? "rgba(0,245,255,0.08)"
                    : "transparent",
                  borderTop: isWorkflowReady
                    ? "1px solid rgba(0,245,255,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderBottom: isWorkflowReady
                    ? "1px solid rgba(0,245,255,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderLeft: isWorkflowReady
                    ? "1px solid rgba(0,245,255,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderRight: "none",
                  color: isWorkflowReady ? "#00F5FF" : "rgba(255,255,255,0.25)",
                  fontSize: 11, fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                  cursor: isWorkflowReady ? "pointer" : "not-allowed",
                  transition: "all 180ms ease",
                  opacity: isWorkflowReady ? 1 : 0.5,
                }}
                onMouseEnter={e => {
                  if (isWorkflowReady) {
                    e.currentTarget.style.background = "rgba(0,245,255,0.15)";
                  }
                }}
                onMouseLeave={e => {
                  if (isWorkflowReady) {
                    e.currentTarget.style.background = "rgba(0,245,255,0.08)";
                  }
                }}
              >
                <Play size={13} fill="currentColor" />
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
                  width: 28, height: 32, padding: 0,
                  borderRadius: "0 8px 8px 0",
                  background: isWorkflowReady ? "rgba(0,245,255,0.08)" : "transparent",
                  borderTop: isWorkflowReady
                    ? "1px solid rgba(0,245,255,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderRight: isWorkflowReady
                    ? "1px solid rgba(0,245,255,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderBottom: isWorkflowReady
                    ? "1px solid rgba(0,245,255,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderLeft: isWorkflowReady
                    ? "1px solid rgba(0,245,255,0.15)"
                    : "1px solid rgba(255,255,255,0.05)",
                  color: isWorkflowReady ? "#00F5FF" : "rgba(255,255,255,0.25)",
                  cursor: isWorkflowReady ? "pointer" : "not-allowed",
                  transition: "all 180ms ease",
                  opacity: isWorkflowReady ? 1 : 0.5,
                }}
                onMouseEnter={e => { if (isWorkflowReady) e.currentTarget.style.background = "rgba(0,245,255,0.15)"; }}
                onMouseLeave={e => { if (isWorkflowReady) e.currentTarget.style.background = "rgba(0,245,255,0.08)"; }}
              >
                <ChevronDown size={11} />
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
                      position: "absolute", top: "calc(100% + 6px)", right: 0,
                      width: 200, borderRadius: 12, overflow: "hidden",
                      background: "rgba(12,13,16,0.98)", border: "1px solid rgba(255,255,255,0.08)",
                      boxShadow: "0 12px 40px rgba(0,0,0,0.5)", zIndex: 50,
                    }}
                  >
                    <div style={{ padding: 4 }}>
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
                            padding: "8px 10px", borderRadius: 8, background: "transparent",
                            border: "none", cursor: "pointer", textAlign: "left",
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 500, color: "#F0F0F5" }}>{item.label}</span>
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{item.sub}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Mobile sticky bottom bar */}
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
          background: "rgba(7, 8, 9, 0.95)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.3)",
        }}
      >
        {/* Full-width Run button for mobile */}
        {isExecuting ? (
          <button
            onClick={onStop}
            style={{
              width: "100%",
              height: 52,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.35)",
              color: "#EF4444",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
          >
            <Square size={16} fill="currentColor" />
            {t('canvas.stopExecution')}
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={!isWorkflowReady}
            style={{
              width: "100%",
              height: 52,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: isWorkflowReady
                ? "rgba(0,245,255,0.08)"
                : "transparent",
              border: isWorkflowReady
                ? "1px solid rgba(0,245,255,0.3)"
                : "1px solid rgba(255,255,255,0.08)",
              color: isWorkflowReady ? "#00F5FF" : "rgba(255,255,255,0.25)",
              fontSize: 15,
              fontWeight: 600,
              cursor: isWorkflowReady ? "pointer" : "not-allowed",
              opacity: isWorkflowReady ? 1 : 0.5,
              transition: "all 0.15s ease",
            }}
          >
            <Play size={18} fill="currentColor" />
            {t('canvas.runWorkflow')}
          </button>
        )}

        {/* Mobile utility bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 10,
          paddingTop: 10,
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
              background: isNodeLibraryOpen ? "rgba(0,245,255,0.10)" : "transparent",
              border: `1px solid ${isNodeLibraryOpen ? "rgba(0,245,255,0.25)" : "rgba(255,255,255,0.08)"}`,
              color: isNodeLibraryOpen ? "#00F5FF" : "rgba(255,255,255,0.7)",
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
            disabled={saveDisabled}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 8,
              background: "transparent",
              border: savedFlash
                ? "1px solid rgba(16,185,129,0.3)"
                : canSave
                  ? "1px solid rgba(255,255,255,0.1)"
                  : "1px solid transparent",
              color: savedFlash ? "#34D399" : canSave ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)",
              fontSize: 12,
              fontWeight: 500,
              cursor: saveDisabled ? "default" : "pointer",
              opacity: saveDisabled && !isSaving ? 0.5 : 1,
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
              background: "rgba(0,245,255,0.06)",
              border: "1px solid rgba(0,245,255,0.15)",
              color: "#00F5FF",
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
