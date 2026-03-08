"use client";

import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sparkles, X, Loader2 } from "lucide-react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useUIStore } from "@/stores/ui-store";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { generateId } from "@/lib/utils";
import { toast } from "sonner";
import type { WorkflowTemplate } from "@/types/workflow";
import type { WorkflowNode, WorkflowEdge, NodeStatus } from "@/types/nodes";
import { awardXP } from "@/lib/award-xp";

// ─── Config ───────────────────────────────────────────────────────────────────

const CHIPS = [
  { label: "PDF → Massing",    color: "#00F5FF", prompt: "I have a PDF project brief and want to generate a 3D massing model" },
  { label: "IFC → BOQ",        color: "#B87333", prompt: "Upload an IFC model, extract quantities, and export a bill of quantities" },
  { label: "3 Variants",       color: "#FFBF00", prompt: "Generate 3 massing variants from a text description with metrics comparison" },
  { label: "Image → Concept",  color: "#4FC3F7", prompt: "Analyze a reference image and create a concept building matching its style" },
  { label: "Full Pipeline",    color: "#06B6D4", prompt: "Create a full pipeline from PDF brief to IFC export and compliance report" },
  { label: "Compliance",       color: "#EF4444", prompt: "Check my IFC model for zoning compliance and generate a PDF report" },
];

const CATEGORY_COLOR: Record<string, string> = {
  input: "#00F5FF", transform: "#B87333", generate: "#FFBF00", export: "#4FC3F7",
};

const STEPS = ["thinking", "placing", "connecting"] as const;
type GenerationStep = typeof STEPS[number];

const STEP_LABELS: Record<GenerationStep, string> = {
  thinking:   "Analyzing prompt…",
  placing:    "Placing nodes…",
  connecting: "Connecting edges…",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFromTemplate(template: WorkflowTemplate): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
} {
  const nodes: WorkflowNode[] = template.tileGraph.nodes.map(n => ({
    ...n,
    id: `${n.id}-${generateId()}`,
    data: { ...n.data, status: "idle" as NodeStatus },
  }));

  const idMap = new Map<string, string>();
  template.tileGraph.nodes.forEach((orig, i) => idMap.set(orig.id, nodes[i].id));

  const edges: WorkflowEdge[] = template.tileGraph.edges.map(e => ({
    ...e,
    id: `${e.id}-${generateId()}`,
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
  }));

  return { nodes, edges };
}

function matchTemplate(text: string): WorkflowTemplate {
  const q = text.toLowerCase();
  if (q.includes("pdf") && q.includes("ifc"))                            return PREBUILT_WORKFLOWS.find(w => w.id === "wf-10") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("pdf") && (q.includes("mass") || q.includes("brief"))) return PREBUILT_WORKFLOWS.find(w => w.id === "wf-02") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("ifc") && (q.includes("quantity") || q.includes("boq"))) return PREBUILT_WORKFLOWS.find(w => w.id === "wf-09") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("variant") || q.includes("options"))                    return PREBUILT_WORKFLOWS.find(w => w.id === "wf-04") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("image") && q.includes("concept"))                      return PREBUILT_WORKFLOWS.find(w => w.id === "wf-03") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("compliance") || q.includes("zoning"))                  return PREBUILT_WORKFLOWS.find(w => w.id === "wf-05") ?? PREBUILT_WORKFLOWS[0];
  if (q.includes("full") || q.includes("pipeline"))                      return PREBUILT_WORKFLOWS.find(w => w.id === "wf-10") ?? PREBUILT_WORKFLOWS[0];
  return PREBUILT_WORKFLOWS.find(w => w.id === "wf-01") ?? PREBUILT_WORKFLOWS[0];
}

// ─── Shimmer node pill (used during preview phase) ────────────────────────────

function NodePill({ label, color, delay }: { label: string; color: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.75, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 420, damping: 28 }}
      style={{
        padding: "4px 10px", borderRadius: 6,
        background: `${color}14`,
        border: `1px solid ${color}30`,
        fontSize: 11, fontWeight: 500, color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PromptInputProps {
  onClose?: () => void;
}

export function PromptInput({ onClose }: PromptInputProps) {
  const prefersReduced = useReducedMotion();
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [step, setStep] = useState<GenerationStep | null>(null);
  const [previewNodes, setPreviewNodes] = useState<{ label: string; color: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { addNode, addEdge, resetCanvas, updateNode } = useWorkflowStore();
  const { setPromptModeActive } = useUIStore();

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);

    // Phase 1 — Thinking
    setStep("thinking");
    await new Promise(r => setTimeout(r, 1000));

    const template = matchTemplate(prompt);
    const { nodes, edges } = buildFromTemplate(template);

    setPreviewNodes(nodes.map(n => ({
      label: n.data.label,
      color: CATEGORY_COLOR[n.data.category] ?? "#00F5FF",
    })));

    // Phase 2 — Placing
    setStep("placing");
    resetCanvas();
    for (const node of nodes) {
      await new Promise(r => setTimeout(r, 170));
      addNode(node);
    }

    // Phase 3 — Connecting
    setStep("connecting");
    for (const edge of edges) {
      await new Promise(r => setTimeout(r, 90));
      addEdge(edge);
    }
    await new Promise(r => setTimeout(r, 200));

    // Pass the user's prompt to the first input node (Text Prompt)
    const firstInputNode = nodes.find(n => {
      const catId = (n.data as Record<string, unknown>).catalogueId as string;
      return catId === "IN-001";
    });
    if (firstInputNode) {
      updateNode(firstInputNode.id, {
        data: { ...firstInputNode.data, inputValue: prompt.trim() },
      });
    }

    toast.success(`Generated: "${template.name}"`, {
      description: `${nodes.length} nodes placed and connected`,
      duration: 4000,
    });

    // Award XP for AI prompt usage (fire-and-forget)
    awardXP("ai-prompt-used");

    setIsGenerating(false);
    setStep(null);
    setPreviewNodes([]);
    setPromptModeActive(false);
    onClose?.();
  }, [prompt, isGenerating, resetCanvas, addNode, addEdge, setPromptModeActive, onClose]);

  const canClose = !isGenerating;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(10, 10, 15, 0.82)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={e => { if (e.target === e.currentTarget && canClose) onClose?.(); }}
    >
      <motion.div
        initial={{ y: -28, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -20, opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        style={{
          position: "relative",
          width: "100%", maxWidth: 580,
          margin: "0 16px",
          background: "#070809",
          border: "1px solid rgba(184,115,51,0.15)",
          borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px rgba(184,115,51,0.08)",
        }}
      >
        {/* Top accent line */}
        <div style={{
          height: 2,
          background: "linear-gradient(90deg, #00F5FF 0%, #B87333 50%, #00F5FF 100%)",
        }} />

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 18px 14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: "rgba(184,115,51,0.12)",
              border: "1px solid rgba(184,115,51,0.22)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <motion.div
                animate={{ rotate: (isGenerating && !prefersReduced) ? [0, 20, -20, 0] : 0 }}
                transition={{ duration: 1.4, repeat: (isGenerating && !prefersReduced) ? Infinity : 0, ease: "easeInOut" }}
                style={{ display: "flex" }}
              >
                <Sparkles size={16} style={{ color: "#B87333" }} />
              </motion.div>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#F0F0F5" }}>
                AI Workflow Generator
              </div>
              <div style={{ fontSize: 10, color: "#55556A", marginTop: 1 }}>
                Describe your workflow in natural language
              </div>
            </div>
          </div>

          <AnimatePresence>
            {canClose && (
              <motion.button
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={onClose}
                style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: "transparent", border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#55556A", cursor: "pointer",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#1A1A26"; e.currentTarget.style.color = "#F0F0F5"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#55556A"; }}
              >
                <X size={14} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Body */}
        <AnimatePresence mode="wait">
          {isGenerating ? (
            // ── Generating view ───────────────────────────────────────────
            <motion.div
              key="generating"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              style={{ padding: "0 18px 22px" }}
            >
              {/* Step label */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  style={{ display: "flex" }}
                >
                  <Loader2 size={13} style={{ color: "#B87333" }} />
                </motion.div>
                <span style={{ fontSize: 12, color: "#8888A0" }}>
                  {step ? STEP_LABELS[step] : ""}
                </span>
              </div>

              {/* Node preview area */}
              <div style={{
                background: "rgba(10,12,14,0.7)", borderRadius: 4, padding: "14px 14px",
                border: "1px solid #1E1E2E", minHeight: 88,
                display: "flex", alignItems: "center",
              }}>
                {step === "thinking" ? (
                  // Shimmer skeleton
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                    {[0, 0.15, 0.28].map((delay, i) => (
                      <motion.div
                        key={i}
                        animate={{ opacity: [0.25, 0.6, 0.25] }}
                        transition={{ duration: 1.3, delay, repeat: Infinity }}
                        style={{
                          height: 26, borderRadius: 6,
                          background: "linear-gradient(90deg, #1E1E2E 0%, #2A2A3E 50%, #1E1E2E 100%)",
                          width: i === 0 ? "75%" : i === 1 ? "55%" : "65%",
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  // Actual node pills appearing staggered
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {previewNodes.map((n, i) => (
                      <NodePill key={i} label={n.label} color={n.color} delay={i * 0.1} />
                    ))}
                  </div>
                )}
              </div>

              {/* Step progress dots */}
              <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 16 }}>
                {STEPS.map((s, i) => {
                  const currentIdx = step ? STEPS.indexOf(step) : -1;
                  const isDone   = i < currentIdx;
                  const isActive = i === currentIdx;
                  return (
                    <motion.div
                      key={s}
                      animate={{ width: isActive ? 18 : 5 }}
                      transition={{ duration: 0.25 }}
                      style={{
                        height: 5, borderRadius: 20,
                        background: isDone ? "#B87333" : isActive ? "#B87333" : "#2A2A3E",
                        opacity: isDone ? 0.5 : 1,
                      }}
                    />
                  );
                })}
              </div>
            </motion.div>

          ) : (
            // ── Input view ────────────────────────────────────────────────
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {/* Textarea */}
              <div style={{ padding: "0 18px 12px" }}>
                <div style={{ position: "relative" }}>
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
                    placeholder='Describe your workflow… e.g. "I have a PDF project brief and want to generate 3 massing variants with concept renders"'
                    rows={4}
                    autoFocus
                    style={{
                      width: "100%", borderRadius: 4,
                      border: "1px solid #2A2A3E",
                      background: "#0A0A0F",
                      padding: "12px 14px", paddingBottom: 30,
                      fontSize: 13, color: "#F0F0F5", lineHeight: 1.65,
                      resize: "none", outline: "none",
                      boxSizing: "border-box",
                      transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                    }}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = "rgba(184,115,51,0.5)";
                      e.currentTarget.style.boxShadow = "0 0 0 2px rgba(184,115,51,0.08)";
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = "#2A2A3E";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                  <div style={{
                    position: "absolute", bottom: 9, right: 10,
                    fontSize: 9, color: "#2A2A3E", pointerEvents: "none",
                  }}>
                    ⌘↵ to generate
                  </div>
                </div>
              </div>

              {/* Quick-start chips */}
              <div style={{ padding: "0 18px 14px" }}>
                <div style={{
                  fontSize: 9, fontWeight: 600, color: "#3A3A4E",
                  textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 8,
                }}>
                  Quick start
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {CHIPS.map(chip => (
                    <button
                      key={chip.label}
                      onClick={() => { setPrompt(chip.prompt); setTimeout(() => textareaRef.current?.focus(), 0); }}
                      style={{
                        padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                        background: `${chip.color}10`,
                        border: `1px solid ${chip.color}22`,
                        fontSize: 11, fontWeight: 500, color: chip.color,
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = `${chip.color}20`;
                        e.currentTarget.style.borderColor = `${chip.color}45`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = `${chip.color}10`;
                        e.currentTarget.style.borderColor = `${chip.color}22`;
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Generate button */}
              <div style={{ padding: "0 18px 18px" }}>
                <button
                  onClick={handleSubmit}
                  disabled={!prompt.trim()}
                  style={{
                    width: "100%", padding: "11px 0",
                    borderRadius: 4, border: "none",
                    background: prompt.trim()
                      ? "linear-gradient(135deg, #00F5FF 0%, #B87333 100%)"
                      : "#1A1A26",
                    color: prompt.trim() ? "#fff" : "#3A3A4E",
                    fontSize: 13, fontWeight: 600,
                    cursor: prompt.trim() ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    transition: "opacity 0.15s ease, box-shadow 0.15s ease",
                    boxShadow: prompt.trim() ? "0 4px 20px rgba(0,245,255,0.25)" : "none",
                  }}
                  onMouseEnter={e => { if (prompt.trim()) e.currentTarget.style.opacity = "0.88"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                >
                  <Sparkles size={14} />
                  Generate Workflow
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
