"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Save, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2,
  Share2, Sparkles, MousePointer2, Layers, Layers3, ChevronDown,
  Loader2, CheckCircle2, Pencil,
} from "lucide-react";
import type { CreationMode } from "@/types/workflow";

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

const MODE_CONFIG: Record<CreationMode, { label: string; icon: React.ReactNode; description: string }> = {
  manual: { label: "Manual",    icon: <MousePointer2 size={12} />, description: "Drag-and-drop nodes"      },
  prompt: { label: "AI Prompt", icon: <Sparkles size={12} />,      description: "Describe your workflow"  },
  hybrid: { label: "Hybrid",    icon: <Layers size={12} />,        description: "AI + manual editing"     },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Sep() {
  return (
    <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)", margin: "0 4px", flexShrink: 0 }} />
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
        width: 30, height: 30, borderRadius: 7,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none",
        color: "#5C5C78", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.1s ease, color 0.1s ease",
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = "#1A1A26";
          e.currentTarget.style.color = "#F0F0F5";
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "#55556A";
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
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showRunMenu, setShowRunMenu] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(workflowName);
  const [savedFlash, setSavedFlash] = useState(false);

  const modeMenuRef = useRef<HTMLDivElement>(null);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(() => {
    onSave();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }, [onSave]);

  // Keep keyboard handler up-to-date without re-registering the listener
  const kbRef = useRef<(e: KeyboardEvent) => void>(null!);
  useEffect(() => {
    kbRef.current = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "s") { e.preventDefault(); if (isDirty && !isSaving) handleSave(); }
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

  return (
    <div
      style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
        height: 52,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 10px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(7, 7, 13, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* ── Left group ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>

        {/* Library toggle */}
        <button
          onClick={onToggleLibrary}
          title="Toggle node library"
          aria-label="Toggle node library"
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
            aria-label={`Creation mode: ${currentMode.label}`}
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
        <TBBtn onClick={onUndo} icon={<Undo2 size={13} />} title="Undo (⌘Z)" />
        <TBBtn onClick={onRedo} icon={<Redo2 size={13} />} title="Redo (⌘⇧Z)" />
      </div>

      {/* ── Center — inline-editable name ───────────────────────────────── */}
      <div
        style={{
          position: "absolute", left: "50%", transform: "translateX(-50%)",
          display: "flex", alignItems: "center", gap: 5,
          maxWidth: 300, minWidth: 80,
        }}
      >
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
              color: "#F0F0F5", fontSize: 13, fontWeight: 500,
              outline: "none", textAlign: "center",
              minWidth: 100, maxWidth: 260, padding: "1px 2px",
            }}
          />
        ) : (
          <button
            onClick={() => {
              setNameValue(workflowName);
              setIsEditingName(true);
              setTimeout(() => nameInputRef.current?.select(), 0);
            }}
            title="Click to rename"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "transparent", border: "none", cursor: "text",
              padding: "3px 6px", borderRadius: 5,
              maxWidth: 280, transition: "background 0.1s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#1A1A26"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{
              fontSize: 13, fontWeight: 500, color: "#F0F0F5",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {workflowName}
            </span>
            <Pencil size={10} style={{ color: "#3A3A4E", flexShrink: 0 }} />
            {isDirty && (
              <div
                title="Unsaved changes"
                style={{ width: 5, height: 5, borderRadius: "50%", background: "#F59E0B", flexShrink: 0 }}
              />
            )}
          </button>
        )}
      </div>

      {/* ── Right group ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>

        {/* Zoom */}
        <TBBtn onClick={onZoomOut} icon={<ZoomOut size={13} />} title="Zoom out" />
        <TBBtn onClick={onZoomIn} icon={<ZoomIn size={13} />} title="Zoom in" />
        <TBBtn onClick={onFitView} icon={<Maximize2 size={13} />} title="Fit to screen" />

        <Sep />

        {/* AI Prompt */}
        <button
          onClick={onPromptMode}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            height: 28, padding: "0 9px", borderRadius: 7,
            background: "rgba(139,92,246,0.06)",
            border: "1px solid rgba(139,92,246,0.2)",
            color: "#8B5CF6", fontSize: 12, fontWeight: 500,
            cursor: "pointer", transition: "all 0.15s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(139,92,246,0.12)";
            e.currentTarget.style.borderColor = "rgba(139,92,246,0.4)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(139,92,246,0.06)";
            e.currentTarget.style.borderColor = "rgba(139,92,246,0.2)";
          }}
        >
          <Sparkles size={11} />
          AI
        </button>

        {/* Share */}
        <TBBtn onClick={onShare} icon={<Share2 size={13} />} title="Share" />

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={(!isDirty && !savedFlash) || isSaving}
          title="Save (⌘S)"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            height: 28, padding: "0 9px", borderRadius: 7,
            background: "transparent",
            border: savedFlash
              ? "1px solid rgba(16,185,129,0.4)"
              : isDirty ? "1px solid #2A2A3E" : "1px solid transparent",
            color: savedFlash ? "#10B981" : isDirty ? "#F0F0F5" : "#3A3A4E",
            fontSize: 12, fontWeight: 500,
            cursor: isDirty || savedFlash ? "pointer" : "default",
            transition: "all 0.2s ease",
            opacity: !isDirty && !savedFlash && !isSaving ? 0.5 : 1,
          }}
          onMouseEnter={e => {
            if (isDirty && !savedFlash) {
              e.currentTarget.style.borderColor = "#4F8AFF";
              e.currentTarget.style.color = "#4F8AFF";
            }
          }}
          onMouseLeave={e => {
            if (!savedFlash) {
              e.currentTarget.style.borderColor = isDirty ? "#2A2A3E" : "transparent";
              e.currentTarget.style.color = isDirty ? "#F0F0F5" : "#3A3A4E";
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
          {isSaving ? "Saving…" : savedFlash ? "Saved" : "Save"}
        </button>

        <Sep />

        {/* Run / Stop */}
        {isExecuting ? (
          <button
            onClick={onStop}
            title="Stop execution (Esc)"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              height: 32, padding: "0 14px", borderRadius: 8,
              background: "#EF4444", border: "none",
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: "pointer", transition: "background 0.15s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#DC2626"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#EF4444"; }}
          >
            <Square size={11} fill="white" />
            Stop
          </button>
        ) : (
          <div style={{ display: "flex", position: "relative" }} ref={runMenuRef}>
            {/* Run */}
            <button
              onClick={onRun}
              title="Run workflow (⌘↵)"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                height: 32, paddingLeft: 14, paddingRight: 10,
                borderRadius: "8px 0 0 8px",
                background: "linear-gradient(135deg, #4F8AFF, #6366F1)", border: "none",
                color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: "pointer", transition: "all 0.15s ease",
                boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 2px 12px rgba(79,138,255,0.25)",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.filter = "brightness(1.1)";
                e.currentTarget.style.boxShadow = "0 0 0 1px rgba(79,138,255,0.5), 0 4px 20px rgba(79,138,255,0.35)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.filter = "brightness(1)";
                e.currentTarget.style.boxShadow = "0 0 0 1px rgba(79,138,255,0.3), 0 2px 12px rgba(79,138,255,0.25)";
              }}
            >
              <Play size={12} fill="white" />
              Run
            </button>

            {/* Chevron */}
            <button
              onClick={() => setShowRunMenu(v => !v)}
              aria-label="More run options"
              aria-expanded={showRunMenu}
              aria-haspopup="menu"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 32, padding: 0,
                borderRadius: "0 8px 8px 0",
                background: "#3D7AFF", border: "none",
                borderLeft: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.75)", cursor: "pointer",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#3472EB"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#3D7AFF"; }}
            >
              <ChevronDown size={10} />
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
                    { label: "Run All Nodes",       sub: "Execute the full workflow"  },
                    { label: "Run from Selection",  sub: "Start from selected node"   },
                    { label: "Step Through",        sub: "Execute one node at a time" },
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
  );
}
