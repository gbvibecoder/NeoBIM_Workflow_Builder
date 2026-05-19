"use client";

/**
 * AI Brief modal — Studio Sketchbook
 * Phase Z.CANVAS.AI-BRIEF
 *
 * Replaces the dark cyberpunk "AI Workflow Generator" panel with a paper-
 * warm letter sheet that visually belongs to the same Studio Sketchbook
 * design system as the canvas empty state (commit a5759d0a).
 *
 * Locked contracts (see PHASE_AI_BRIEF_MODAL_REDESIGN_REPORT for full list):
 *  C1  Named export `PromptInput` (NOT default, NOT memo) — preserved per
 *      original line 102 of the prior implementation.
 *  C2  Prop signature `{ onClose?: () => void }` unchanged — mount call at
 *      WorkflowCanvas.tsx:976 passes only `onClose`.
 *  C3  Submit handler runs the same pipeline as before: matchTemplate →
 *      buildFromTemplate → resetCanvas → sequential addNode/addEdge with
 *      identical 170ms / 90ms cadence → patch first IN-001 node with the
 *      prompt → toast.success → awardXP("ai-prompt-used"). The only behavior
 *      change is that the modal now closes IMMEDIATELY on submit and the
 *      canvas populates underneath — the prototype has no progress UI.
 *  C4  The six quick-start preset prompt strings are preserved byte-for-byte
 *      in the PRESET_PROMPTS constant below.
 *  C5  framer-motion entry/exit animation — outer motion.div lives inside
 *      the parent's <AnimatePresence> at WorkflowCanvas.tsx:974, so exit
 *      transition plays on close.
 *  C6  prefers-reduced-motion honored via useReducedMotion() (here) AND
 *      via @media (prefers-reduced-motion: reduce) in the CSS module.
 *  C7  No `any`, no @ts-ignore, no eslint-disable.
 *  C8  ESC closes, ⌘/Ctrl+⏎ submits (when textarea non-empty), backdrop
 *      click closes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  useWorkflowStore,
  selectAddNode,
  selectAddEdge,
  selectResetCanvas,
  selectUpdateNode,
} from "@/features/workflows/stores/workflow-store";
import { useUIStore } from "@/shared/stores/ui-store";
import { PREBUILT_WORKFLOWS } from "@/features/workflows/constants/prebuilt-workflows";
import { generateId } from "@/lib/utils";
import { awardXP } from "@/lib/award-xp";
import { useLocale } from "@/hooks/useLocale";
import type { WorkflowTemplate } from "@/types/workflow";
import type { WorkflowNode, WorkflowEdge, NodeStatus } from "@/types/nodes";
import s from "./PromptInput.module.css";

// ─── Preset prompt strings — LC4: preserved byte-identical to prior impl ──

const PRESET_PROMPTS = {
  preset1: "I have a PDF project brief and want to generate a 3D massing model",
  preset2: "Upload an IFC model, extract quantities, and export a bill of quantities",
  preset3: "Generate 3 massing variants from a text description with metrics comparison",
  preset4: "Analyze a reference image and create a concept building matching its style",
  preset5: "Create a full pipeline from PDF brief to IFC export and compliance report",
  preset6: "Check my IFC model for zoning compliance and generate a PDF report",
} as const;

type PresetId = keyof typeof PRESET_PROMPTS;

// `as const` preserves the `nameKey` literals so they satisfy the
// TranslationKey union expected by useLocale's `t(...)`.
const PRESETS = [
  { id: "preset1", nameKey: "ai.brief.preset1" },
  { id: "preset2", nameKey: "ai.brief.preset2" },
  { id: "preset3", nameKey: "ai.brief.preset3" },
  { id: "preset4", nameKey: "ai.brief.preset4" },
  { id: "preset5", nameKey: "ai.brief.preset5" },
  { id: "preset6", nameKey: "ai.brief.preset6" },
] as const;

// ─── Template matching + building — preserved verbatim from prior impl ────

function buildFromTemplate(template: WorkflowTemplate): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
} {
  const nodes: WorkflowNode[] = template.tileGraph.nodes.map((n) => ({
    ...n,
    id: `${n.id}-${generateId()}`,
    data: { ...n.data, status: "idle" as NodeStatus },
  }));

  const idMap = new Map<string, string>();
  template.tileGraph.nodes.forEach((orig, i) => idMap.set(orig.id, nodes[i].id));

  const edges: WorkflowEdge[] = template.tileGraph.edges.map((e) => ({
    ...e,
    id: `${e.id}-${generateId()}`,
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
  }));

  return { nodes, edges };
}

function matchTemplate(text: string): WorkflowTemplate {
  const q = text.toLowerCase();
  if (q.includes("pdf") && (q.includes("mass") || q.includes("brief") || q.includes("ifc") || q.includes("concept"))) return PREBUILT_WORKFLOWS.find((w) => w.id === "wf-08") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("ifc") && (q.includes("quantity") || q.includes("boq"))) return PREBUILT_WORKFLOWS.find((w) => w.id === "wf-09") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("variant") || q.includes("options"))                    return PREBUILT_WORKFLOWS.find((w) => w.id === "wf-04") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("image") && q.includes("concept"))                      return PREBUILT_WORKFLOWS.find((w) => w.id === "wf-03") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("compliance") || q.includes("zoning"))                  return PREBUILT_WORKFLOWS.find((w) => w.id === "wf-04") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("full") || q.includes("pipeline"))                      return PREBUILT_WORKFLOWS.find((w) => w.id === "wf-08") ?? PREBUILT_WORKFLOWS[0];
  return PREBUILT_WORKFLOWS.find((w) => w.id === "wf-03") ?? PREBUILT_WORKFLOWS[0];
}

// ─── Inline decorative SVGs ────────────────────────────────────────────────

function Paperclip() {
  return (
    <svg className={s.paperclip} viewBox="0 0 22 50" aria-hidden focusable="false">
      <path d="M 8 4 Q 4 4 4 8 L 4 38 Q 4 44 10 44 Q 16 44 16 38 L 16 12 Q 16 8 12 8 Q 8 8 8 12 L 8 34" />
    </svg>
  );
}

function SketchFrame() {
  return (
    <div className={s.frame} aria-hidden>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        <path className={s.outer} d="M 1 2 L 99 1 L 98 99 L 2 98 Z" />
        <path className={s.inner} d="M 4 5 L 96 4 L 95 96 L 5 95 Z" />
      </svg>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden focusable="false">
      <path d="M 2 2 L 10 10 M 10 2 L 2 10" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

interface PromptInputProps {
  onClose?: () => void;
}

export function PromptInput({ onClose }: PromptInputProps) {
  const { t } = useLocale();
  const prefersReducedMotion = useReducedMotion();
  const [prompt, setPrompt] = useState("");
  const [activePreset, setActivePreset] = useState<PresetId | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addNode = useWorkflowStore(selectAddNode);
  const addEdge = useWorkflowStore(selectAddEdge);
  const resetCanvas = useWorkflowStore(selectResetCanvas);
  const updateNode = useWorkflowStore(selectUpdateNode);
  const setPromptModeActive = useUIStore((st) => st.setPromptModeActive);

  // ── Locale-aware date stamp (NOV 19 / 2026) ────────────────────────────
  const dateParts = useMemo(() => {
    const userLocale =
      typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    const now = new Date();
    return {
      month: new Intl.DateTimeFormat(userLocale, { month: "short" })
        .format(now)
        .toUpperCase(),
      day: String(now.getDate()).padStart(2, "0"),
      year: String(now.getFullYear()),
    };
  }, []);

  // ── Close ──────────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    setPromptModeActive(false);
    onClose?.();
  }, [onClose, setPromptModeActive]);

  // ── Submit — LC3: same pipeline as prior impl ──────────────────────────
  const handleSubmit = useCallback(async () => {
    const promptText = prompt.trim();
    if (!promptText) return;

    // Close modal immediately; canvas will populate visibly underneath.
    setPromptModeActive(false);
    onClose?.();

    // Brief pause so the modal's exit animation can play before the canvas
    // starts mutating (avoids a flash of mid-state behind the unmounting modal).
    await new Promise((r) => setTimeout(r, 200));

    const template = matchTemplate(promptText);
    const { nodes, edges } = buildFromTemplate(template);

    resetCanvas();
    for (const node of nodes) {
      await new Promise((r) => setTimeout(r, 170));
      addNode(node);
    }
    for (const edge of edges) {
      await new Promise((r) => setTimeout(r, 90));
      addEdge(edge);
    }

    // Patch the user's prompt into the first text-input node (catalogueId IN-001)
    const firstInputNode = nodes.find((n) => {
      const catId = (n.data as Record<string, unknown>).catalogueId as string;
      return catId === "IN-001";
    });
    if (firstInputNode) {
      updateNode(firstInputNode.id, {
        data: { ...firstInputNode.data, inputValue: promptText },
      });
    }

    toast.success(`Generated: "${template.name}"`, {
      description: `${nodes.length} nodes placed and connected`,
      duration: 4000,
    });
    awardXP("ai-prompt-used");
  }, [prompt, resetCanvas, addNode, addEdge, updateNode, setPromptModeActive, onClose]);

  // ── Keyboard: ESC closes, ⌘/Ctrl+⏎ submits ─────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSubmit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleClose, handleSubmit]);

  // ── Auto-focus on mount ────────────────────────────────────────────────
  useEffect(() => {
    const t1 = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(t1);
  }, []);

  // ── Quick-start chip click — fill textarea, mark active ────────────────
  const handleChipClick = useCallback((id: PresetId) => {
    const text = PRESET_PROMPTS[id];
    setPrompt(text);
    setActivePreset(id);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // ── Kbd hint: split prefix glyphs from i18n string ─────────────────────
  // Translation prefixes the string with "⌘⏎ " — we render the keys as
  // styled <kbd>s and the remaining words as plain text.
  const kbdHintRaw = t("ai.brief.kbdHint");
  const kbdHintText = kbdHintRaw.replace(/^[⌘⏎\s]+/, "");

  // ── Animation gates ────────────────────────────────────────────────────
  const backdropAnim = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.35 } };

  const briefAnim = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, scale: 0.92, y: 40, rotate: 2 },
        animate: { opacity: 1, scale: 1,   y: 0,  rotate: -0.5 },
        exit:    { opacity: 0, scale: 0.94, y: 24, rotate: 1 },
        transition: { duration: 0.55, ease: [0.16, 0.84, 0.3, 1] as const },
      };

  const submitDisabled = prompt.trim().length === 0;

  return (
    <motion.div
      className={s.backdrop}
      {...backdropAnim}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <motion.div
        className={s.brief}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-brief-title"
        aria-roledescription={t("ai.brief.brief")}
        onClick={(e) => e.stopPropagation()}
        {...briefAnim}
      >
        <SketchFrame />
        <Paperclip />

        {/* ── Header ── */}
        <header className={s.head}>
          <div className={s.headL}>
            <span className={s.fromDesk}>{t("ai.brief.fromDesk")}</span>
            <h2 className={s.hTitle} id="ai-brief-title">
              {t("ai.brief.title")}
            </h2>
          </div>
          <div className={s.hR}>
            <div className={s.dateStamp} aria-label={t("ai.brief.dateLabel")}>
              {dateParts.month} {dateParts.day}
              <small>{dateParts.year}</small>
            </div>
            <button
              type="button"
              className={s.closeBtn}
              onClick={handleClose}
              aria-label={t("ai.brief.closeLabel")}
            >
              <CloseGlyph />
            </button>
          </div>
        </header>

        {/* ── Body ── */}
        <div className={s.body}>
          <span className={s.lead}>{t("ai.brief.lead")}</span>
          <div className={`${s.taWrap} ${prompt.length > 0 ? s.filled : ""}`}>
            <span className={s.draftWatermark} aria-hidden>
              {t("ai.brief.draftWatermark")}
            </span>
            <textarea
              ref={textareaRef}
              className={s.textarea}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (activePreset) setActivePreset(null);
              }}
              placeholder={t("ai.brief.placeholder")}
              rows={5}
            />
          </div>
        </div>

        {/* ── Quick-start chips ── */}
        <div className={s.qs}>
          <span className={s.qsLabel}>{t("ai.brief.qsLabel")}</span>
          <div className={s.qsRow} role="list">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="listitem"
                className={`${s.chip} ${activePreset === p.id ? s.active : ""}`}
                onClick={() => handleChipClick(p.id)}
              >
                {t(p.nameKey)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <footer className={s.foot}>
          <span className={s.kbdHint}>
            <kbd>⌘</kbd>
            <kbd>⏎</kbd>
            <span>{kbdHintText}</span>
          </span>
          <button
            type="button"
            className={s.stamp}
            onClick={() => void handleSubmit()}
            disabled={submitDisabled}
            aria-label={t("ai.brief.submit")}
          >
            {t("ai.brief.submit")}
            <span className={s.arrow} aria-hidden>→</span>
          </button>
        </footer>

        <span className={s.pageMarker} aria-hidden>
          {t("ai.brief.pageMarker")}
        </span>
      </motion.div>
    </motion.div>
  );
}
