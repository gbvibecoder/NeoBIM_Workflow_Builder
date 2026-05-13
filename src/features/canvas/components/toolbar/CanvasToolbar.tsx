"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Save, Undo2, Redo2,
  Share2, Sparkles, MousePointer2, Layers, Layers3, ChevronDown,
  Loader2, CheckCircle2, Pencil,
} from "lucide-react";
import type { CreationMode } from "@/types/workflow";
import { ProjectDatePill } from "@/features/canvas/components/toolbar/ProjectDatePill";
import {
  useWorkflowStore,
  isUntitledWorkflow,
  selectOpenSaveModal,
  selectNodes as selectWfNodes,
} from "@/features/workflows/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import { ThemeToggle } from "@/features/canvas/components/chrome/ThemeToggle";
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
  /**
   * True while the pre-run async waterfall (eligibility check + auto-save)
   * is in flight — BEFORE `isExecuting` flips to true inside runWorkflow.
   * The Run button's existing ternary only reacts to `isExecuting`, which
   * leaves a 2–5s window where the button looks clickable but doing nothing
   * visible. This flag closes that gap: the button immediately disables +
   * shows "Starting…" on click, then the regular Stop button takes over
   * when execution actually begins.
   */
  isStartingRun?: boolean;
  /**
   * True when the loaded workflow has already been executed once
   * (Execution row in {SUCCESS, PARTIAL, RUNNING, PENDING}). Per the
   * 1:1 spec, each saved workflow can be run exactly once. The Run
   * button surfaces the lock as a disabled visual state with tooltip;
   * the server-side gate is still authoritative.
   */
  workflowLocked?: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isNodeLibraryOpen: boolean;
  onRun: () => void;
  onStop: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
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
  const tk = useCanvasToken();
  return (
    <div style={{ width: 1, height: 20, background: tk.line1, margin: "0 8px", flexShrink: 0 }} />
  );
}

interface TBBtnProps {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
}

function TBBtn({ onClick, icon, title, disabled }: TBBtnProps) {
  const tk = useCanvasToken();
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
        color: tk.text1, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition: "all 150ms ease",
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = tk.hoverBg;
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent";
      }}
      onFocus={e => {
        if (!disabled) {
          e.currentTarget.style.background = tk.hoverBg;
        }
      }}
      onBlur={e => {
        e.currentTarget.style.background = "transparent";
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
  isStartingRun = false,
  workflowLocked = false,
  isDirty,
  isSaving,
  isNodeLibraryOpen,
  onRun,
  onStop,
  onSave,
  onUndo,
  onRedo,
  onShare,
  onModeChange,
  onPromptMode,
  onToggleLibrary,
  onNameChange,
}: CanvasToolbarProps) {
  const { t } = useLocale();
  const canvasTheme = useCanvasTheme((s) => s.theme);
  const tk = useCanvasToken();

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

  const openSaveModal = useWorkflowStore(selectOpenSaveModal);
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
      if (meta && e.key === "Enter") { e.preventDefault(); if (!isExecuting && !isStartingRun) onRun(); }
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
    // Use capture phase — ReactFlow's pane stops propagation on mousedown,
    // so a bubble-phase document listener would never fire for canvas clicks.
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, []);

  const commitName = useCallback(() => {
    setIsEditingName(false);
    const trimmed = nameValue.trim() || workflowName;
    if (trimmed !== workflowName) onNameChange?.(trimmed);
  }, [nameValue, workflowName, onNameChange]);

  const currentMode = MODE_CONFIG[creationMode];

  const nodes = useWorkflowStore(selectWfNodes);
  // `isStartingRun` folds into this so every styling branch already tied to
  // isWorkflowReady (disabled state, borders, cursor, hover) flips immediately
  // on click — no need to thread a second flag through every style prop.
  // `workflowLocked` (1:1 spec — workflow already executed once) also forces
  // the disabled state so the user sees the lock proactively, not after click.
  const isWorkflowReady = nodes.length > 0 && !isExecuting && !isStartingRun && !workflowLocked;

  // Save button state
  const canSave = isDirty || isUntitled;
  const saveDisabled = (!canSave && !savedFlash) || isSaving;

  const desktopBar = (
      <div
        className="hidden md:flex"
        style={{
          position: "absolute" as const,
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          height: 56,
          alignItems: "center",
          padding: "0 10px",
          border: `1px solid ${tk.line2}`,
          borderRadius: 14,
          background: tk.surface1,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: tk.shadowMd,
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
              background: isNodeLibraryOpen ? tk.accentBgActive : "transparent",
              border: isNodeLibraryOpen ? `1px solid ${tk.accentBorder}` : "1px solid transparent",
              color: isNodeLibraryOpen ? tk.accent : tk.text1,
              cursor: "pointer", transition: "all 0.15s ease",
            }}
            onMouseEnter={e => {
              if (!isNodeLibraryOpen) {
                e.currentTarget.style.background = tk.hoverBg;
              }
            }}
            onMouseLeave={e => {
              if (!isNodeLibraryOpen) {
                e.currentTarget.style.background = "transparent";
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
                background: showModeMenu ? tk.hoverBg : "transparent",
                border: showModeMenu ? `1px solid ${tk.line2}` : "1px solid transparent",
                color: tk.text1, cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = tk.hoverBg; }}
              onMouseLeave={e => { if (!showModeMenu) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ color: tk.accent, display: "flex" }}>{currentMode.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{currentMode.label}</span>
              <ChevronDown size={9} style={{ color: tk.text3 }} />
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
                    background: tk.dropdownBg, border: `1px solid ${tk.dropdownBorder}`,
                    boxShadow: tk.dropdownShadow, zIndex: 50,
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
                            background: active ? tk.accentBg : "transparent",
                            border: "none", cursor: "pointer", textAlign: "left",
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={e => { if (!active) e.currentTarget.style.background = tk.hoverBg; }}
                          onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ color: active ? tk.accent : tk.text3, marginTop: 1, display: "flex" }}>
                            {cfg.icon}
                          </span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: active ? tk.accent : tk.text1 }}>
                              {cfg.label}
                            </div>
                            <div style={{ fontSize: 10, color: tk.text3, marginTop: 1 }}>
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
                borderBottom: `1px solid ${tk.nameFocusBorder}`,
                color: tk.text1, fontSize: 12, fontWeight: 500,
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
              onMouseEnter={e => { e.currentTarget.style.background = tk.hoverBg; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                fontSize: 12, fontWeight: 500, color: tk.text2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 160,
              }}>
                {workflowName}
              </span>
              <Pencil size={9} style={{ color: tk.text4, flexShrink: 0 }} />
              {isSaving ? (
                <div title={`${t('canvas.saving')}…`} style={{ display: "flex", flexShrink: 0 }}>
                  <Loader2 size={10} className="animate-spin" style={{ color: tk.text3 }} />
                </div>
              ) : savedFlash ? (
                <div
                  title={t('canvas.saved')}
                  style={{ width: 5, height: 5, borderRadius: "50%", background: tk.saveFlashText, flexShrink: 0 }}
                />
              ) : isDirty ? (
                <div
                  title={t('canvas.unsavedChanges')}
                  style={{ width: 5, height: 5, borderRadius: "50%", background: tk.dirtyDot, flexShrink: 0 }}
                />
              ) : null}
            </button>
          )}
        </div>

        <Sep />

        {/* ── Right group: AI + Theme + Share + Save + Run ──────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>

          {/* Project Date — construction start date for BOQ escalation */}
          <ProjectDatePill />

          <Sep />

          {/* AI Studio */}
          <button
            onClick={onPromptMode}
            title={t('canvas.ai')}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              height: 30, padding: "0 12px", borderRadius: 7,
              background: tk.aiBg,
              border: `1px solid ${tk.aiBorder}`,
              color: tk.aiText, fontSize: 12, fontWeight: 500,
              cursor: "pointer", transition: "all 150ms ease",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = tk.aiBgHover;
              e.currentTarget.style.borderColor = tk.aiBorderHover;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = tk.aiBg;
              e.currentTarget.style.borderColor = tk.aiBorder;
            }}
          >
            <Sparkles size={11} />
            {t('canvas.ai')}
          </button>

          {/* Theme toggle */}
          <ThemeToggle inline />

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
                    background: tk.dropdownBg, border: `1px solid ${tk.dropdownBorder}`,
                    boxShadow: tk.dropdownShadow, zIndex: 50,
                  }}
                >
                  <div style={{ padding: 4 }}>
                    {[
                      { label: t('canvas.shareOnX'), action: () => { shareWorkflowToTwitter(workflowName); window.gtag?.("event", "workflow_shared", { platform: "twitter" }); } },
                      { label: "Share on LinkedIn", action: () => { shareWorkflowToLinkedIn(); window.gtag?.("event", "workflow_shared", { platform: "linkedin" }); } },
                      { label: t('canvas.copyLink'), action: () => { copyShareLink(); window.gtag?.("event", "workflow_shared", { platform: "copy" }); } },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={() => { item.action(); setShowShareMenu(false); }}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 8,
                          padding: "8px 10px", borderRadius: 8, background: "transparent",
                          border: "none", cursor: "pointer", textAlign: "left",
                          fontSize: 12, fontWeight: 500, color: tk.text1,
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = tk.hoverBg; }}
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
                ? tk.saveFlashBg
                : canSave
                  ? tk.hoverBg
                  : "transparent",
              border: savedFlash
                ? `1px solid ${tk.saveFlashBorder}`
                : canSave
                  ? `1px solid ${tk.line2}`
                  : "1px solid transparent",
              color: savedFlash
                ? tk.saveFlashText
                : canSave
                  ? tk.text1
                  : tk.text4,
              fontSize: 12, fontWeight: 500,
              cursor: saveDisabled ? "default" : "pointer",
              transition: "all 150ms ease",
              opacity: saveDisabled && !isSaving ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (!saveDisabled) {
                e.currentTarget.style.background = tk.hoverBgStrong;
              }
            }}
            onMouseLeave={e => {
              if (!saveDisabled) {
                e.currentTarget.style.background = canSave ? tk.hoverBg : "transparent";
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
                background: tk.stopBg, border: `1px solid ${tk.stopBorder}`,
                color: tk.stopText, fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all 0.15s ease",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = tk.stopBgHover;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = tk.stopBg;
              }}
            >
              <Square size={12} fill="currentColor" />
              {t('canvas.stop')}
            </button>
          ) : (
            <div style={{ display: "flex", position: "relative" }} ref={runMenuRef}>
              <button
                onClick={onRun}
                title={
                  workflowLocked
                    ? "This workflow has already been executed — open a new workflow to run again"
                    : `${t('canvas.runWorkflow')} (⌘↵)`
                }
                disabled={!isWorkflowReady}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: 32, paddingLeft: 14, paddingRight: 10,
                  borderRadius: "8px 0 0 8px",
                  background: isWorkflowReady
                    ? tk.runBg
                    : "transparent",
                  borderTop: isWorkflowReady
                    ? `1px solid ${tk.runBorder}`
                    : `1px solid ${tk.line1}`,
                  borderBottom: isWorkflowReady
                    ? `1px solid ${tk.runBorder}`
                    : `1px solid ${tk.line1}`,
                  borderLeft: isWorkflowReady
                    ? `1px solid ${tk.runBorder}`
                    : `1px solid ${tk.line1}`,
                  borderRight: "none",
                  color: isWorkflowReady ? tk.runText : tk.text4,
                  fontSize: 11, fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                  cursor: isWorkflowReady ? "pointer" : "not-allowed",
                  transition: "all 180ms ease",
                  opacity: isWorkflowReady ? 1 : 0.5,
                }}
                onMouseEnter={e => {
                  if (isWorkflowReady) {
                    e.currentTarget.style.background = tk.runBgHover;
                  }
                }}
                onMouseLeave={e => {
                  if (isWorkflowReady) {
                    e.currentTarget.style.background = tk.runBg;
                  }
                }}
              >
                {isStartingRun ? (
                  <>
                    <Loader2 size={13} style={{ animation: "spin 0.9s linear infinite" }} />
                    {/* Plain literal — no i18n key yet; t() returns the key
                        verbatim when the key is missing, which would render
                        "canvas.starting" to the user. Add the key to i18n.ts
                        in a follow-up to localize. */}
                    Starting…
                    <style>{`@keyframes spin { from {transform:rotate(0deg)} to {transform:rotate(360deg)} }`}</style>
                  </>
                ) : (
                  <>
                    <Play size={13} fill="currentColor" />
                    {t('canvas.runWorkflow')}
                  </>
                )}
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
                  background: isWorkflowReady ? tk.runBg : "transparent",
                  borderTop: isWorkflowReady
                    ? `1px solid ${tk.runBorder}`
                    : `1px solid ${tk.line1}`,
                  borderRight: isWorkflowReady
                    ? `1px solid ${tk.runBorder}`
                    : `1px solid ${tk.line1}`,
                  borderBottom: isWorkflowReady
                    ? `1px solid ${tk.runBorder}`
                    : `1px solid ${tk.line1}`,
                  borderLeft: isWorkflowReady
                    ? `1px solid ${tk.runBorderSplit}`
                    : `1px solid ${tk.line1}`,
                  color: isWorkflowReady ? tk.runText : tk.text4,
                  cursor: isWorkflowReady ? "pointer" : "not-allowed",
                  transition: "all 180ms ease",
                  opacity: isWorkflowReady ? 1 : 0.5,
                }}
                onMouseEnter={e => { if (isWorkflowReady) e.currentTarget.style.background = tk.runBgHover; }}
                onMouseLeave={e => { if (isWorkflowReady) e.currentTarget.style.background = tk.runBg; }}
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
                      background: tk.dropdownBg, border: `1px solid ${tk.dropdownBorder}`,
                      boxShadow: tk.dropdownShadow, zIndex: 50,
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
                          onMouseEnter={e => { e.currentTarget.style.background = tk.hoverBg; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 500, color: tk.text1 }}>{item.label}</span>
                          <span style={{ fontSize: 10, color: tk.text3 }}>{item.sub}</span>
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
  );

  return (
    <div className={`canvas-theme-${canvasTheme}`} style={{ display: "contents" }}>
      {desktopBar}

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
          background: tk.surface2,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: `1px solid ${tk.line1}`,
          boxShadow: tk.shadowMd,
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
              background: tk.stopBg,
              border: `1px solid ${tk.stopBorder}`,
              color: tk.stopText,
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
                ? tk.runBg
                : "transparent",
              border: isWorkflowReady
                ? `1px solid ${tk.runBorder}`
                : `1px solid ${tk.line1}`,
              color: isWorkflowReady ? tk.runText : tk.text4,
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
          borderTop: `1px solid ${tk.line1}`,
        }}>
          <button
            onClick={onToggleLibrary}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 8,
              background: isNodeLibraryOpen ? tk.accentBgActive : "transparent",
              border: `1px solid ${isNodeLibraryOpen ? tk.accentBorder : tk.line1}`,
              color: isNodeLibraryOpen ? tk.accent : tk.text1,
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
                ? `1px solid ${tk.saveFlashBorder}`
                : canSave
                  ? `1px solid ${tk.line2}`
                  : "1px solid transparent",
              color: savedFlash ? tk.saveFlashText : canSave ? tk.text1 : tk.text4,
              fontSize: 12,
              fontWeight: 500,
              cursor: saveDisabled ? "default" : "pointer",
              opacity: saveDisabled && !isSaving ? 0.5 : 1,
            }}
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : savedFlash ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {isSaving ? t('canvas.saving') : savedFlash ? t('canvas.saved') : t('canvas.save')}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onClick={onUndo}
              aria-label={t('canvas.undo')}
              style={{
                width: 36, height: 36, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent",
                border: `1px solid ${tk.line1}`,
                color: tk.text1,
                cursor: "pointer",
              }}
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={onRedo}
              aria-label={t('canvas.redo')}
              style={{
                width: 36, height: 36, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent",
                border: `1px solid ${tk.line1}`,
                color: tk.text1,
                cursor: "pointer",
              }}
            >
              <Redo2 size={14} />
            </button>
          </div>

          <button
            onClick={onPromptMode}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 8,
              background: tk.aiBg,
              border: `1px solid ${tk.aiBorder}`,
              color: tk.aiText,
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
    </div>
  );
}
