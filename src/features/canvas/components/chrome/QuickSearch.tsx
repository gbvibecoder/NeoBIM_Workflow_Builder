"use client";

/**
 * Z.CANVAS.2B Phase 4 — Canvas Quick Search (⌘K).
 * Fuzzy search across 42 nodes + AI commands.
 * Intercepts ⌘K with capture phase to override global CommandPalette.
 */

import React, { memo, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, X } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { VISIBLE_NODE_CATALOGUE, CATEGORY_CONFIG } from "@/features/workflows/constants/node-catalogue";
import type { NodeCatalogueItem } from "@/types/nodes";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import { useWorkflowStore, selectAddNode } from "@/features/workflows/stores/workflow-store";
import { generateId } from "@/lib/utils";

// ─── AI Commands ────────────────────────────────────────────────────────────

const AI_COMMANDS = [
  "Generate a floor plan from this brief",
  "Add cost estimation",
  "Explain this workflow",
  "Generate concept images",
  "Optimize for sustainability",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  // Initial-letter match: "bp" matches "Brief Parser"
  const words = t.split(/\s+/);
  const initials = words.map((w) => w[0]).join("");
  if (initials.includes(q)) return true;
  return false;
}

function getIcon(name: string, size = 14): React.ReactNode {
  const icons = LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>>;
  const Icon = icons[name];
  if (Icon) return <Icon size={size} strokeWidth={1.5} />;
  return <LucideIcons.Box size={size} strokeWidth={1.5} />;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ResultItem {
  type: "node" | "ai";
  id: string;
  label: string;
  meta: string;
  icon?: string;
  category?: string;
  catalogueItem?: NodeCatalogueItem;
}

// ─── QuickSearch ────────────────────────────────────────────────────────────

interface QuickSearchProps {
  onAICommand?: (command: string) => void;
}

export const QuickSearch = memo(function QuickSearch({ onAICommand }: QuickSearchProps) {
  const { theme } = useCanvasTheme();
  const tk = useCanvasToken();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useWorkflowStore(selectAddNode);

  // ⌘K / Ctrl+K — capture phase intercept
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
        setQuery("");
        setActive(0);
      }
    };
    document.addEventListener("keydown", handler, true); // capture phase
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  // Auto-focus input when open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Build results
  const results = useMemo<ResultItem[]>(() => {
    const items: ResultItem[] = [];
    const q = query.trim();

    // Nodes
    const matchedNodes = q
      ? VISIBLE_NODE_CATALOGUE.filter(
          (n) =>
            fuzzyMatch(q, n.name) ||
            fuzzyMatch(q, n.id) ||
            fuzzyMatch(q, n.category) ||
            n.tags.some((t) => fuzzyMatch(q, t))
        )
      : VISIBLE_NODE_CATALOGUE.slice(0, 8);

    matchedNodes.forEach((n) => {
      items.push({
        type: "node",
        id: n.id,
        label: n.name,
        meta: `${n.id} · ${n.category}`,
        icon: n.icon,
        category: n.category,
        catalogueItem: n,
      });
    });

    // AI commands
    const matchedAI = q
      ? AI_COMMANDS.filter((c) => fuzzyMatch(q, c))
      : AI_COMMANDS;

    matchedAI.forEach((c, i) => {
      items.push({
        type: "ai",
        id: `ai-${i}`,
        label: c,
        meta: "AI command",
      });
    });

    return items;
  }, [query]);

  // Reset active on results change
  useEffect(() => setActive(0), [results.length]);

  // Keyboard navigation
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((v) => (v + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((v) => (v - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = results[active];
        if (!item) return;
        if (item.type === "node" && item.catalogueItem) {
          // Drop node at canvas center
          const center = screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          const cat = item.catalogueItem;
          addNode({
            id: generateId(),
            type: "workflowNode",
            position: center,
            data: {
              label: cat.name,
              category: cat.category,
              icon: cat.icon,
              catalogueId: cat.id,
              status: "idle",
              inputs: cat.inputs,
              outputs: cat.outputs,
              executionTime: cat.executionTime,
            },
          });
        } else if (item.type === "ai" && onAICommand) {
          onAICommand(item.label);
        }
        setOpen(false);
        setQuery("");
      } else if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    },
    [results, active, screenToFlowPosition, addNode, onAICommand]
  );

  if (!open) return null;

  const catConfig = CATEGORY_CONFIG as Record<string, { color: string; bgColor: string }>;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={() => { setOpen(false); setQuery(""); }}
        style={{
          position: "fixed",
          inset: 0,
          background: tk.qsOverlay,
          zIndex: 100,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "15vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: 540,
          zIndex: 101,
          background: tk.qsModalBg,
          border: `1px solid ${tk.qsModalBorder}`,
          borderRadius: 14,
          boxShadow: tk.qsModalShadow,
          overflow: "hidden",
        }}
      >
        {/* Input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 20px",
            borderBottom: `1px solid ${tk.line1}`,
          }}
        >
          <Search size={18} style={{ color: tk.text3, flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search nodes, AI commands…"
            style={{
              flex: 1,
              border: 0,
              outline: "none",
              background: "transparent",
              fontSize: 18,
              color: tk.qsInputText,
              fontFamily: "inherit",
            }}
          />
          <div
            style={{
              padding: "3px 7px",
              borderRadius: 3,
              background: tk.qsKbdBg,
              border: `1px solid ${tk.qsKbdBorder}`,
              color: tk.qsKbdText,
              fontSize: 10,
              fontFamily: "var(--font-jetbrains), monospace",
              userSelect: "none",
            }}
          >
            ESC
          </div>
        </div>

        {/* Results list */}
        <div style={{ padding: 8, maxHeight: 340, overflowY: "auto" }}>
          {/* Nodes section */}
          {results.filter((r) => r.type === "node").length > 0 && (
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase" as const,
                color: tk.qsSectionLabel,
                padding: "10px 12px 6px",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              NODES · {results.filter((r) => r.type === "node").length}
            </div>
          )}

          {results.map((item, i) => {
            if (item.type === "node" && i > 0 && results[i - 1]?.type !== "node") return null;
            if (item.type === "ai" && i > 0 && results[i - 1]?.type === "node") {
              // AI section header
              return (
                <React.Fragment key={`ai-hdr-${i}`}>
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase" as const,
                      color: tk.qsSectionLabel,
                      padding: "10px 12px 6px",
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}
                  >
                    AI COMMANDS
                  </div>
                  <ResultRow item={item} isActive={i === active} catConfig={catConfig} getIcon={getIcon} />
                </React.Fragment>
              );
            }
            return (
              <ResultRow key={item.id} item={item} isActive={i === active} catConfig={catConfig} getIcon={getIcon} />
            );
          })}

          {results.length === 0 && (
            <div style={{ padding: "20px 12px", textAlign: "center", color: tk.text3, fontSize: 13 }}>
              No results
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "10px 16px",
            borderTop: `1px solid ${tk.qsFootBorder}`,
            background: tk.qsFootBg,
          }}
        >
          {["↑↓ navigate", "↵ select", "esc dismiss"].map((hint) => (
            <span key={hint} style={{ fontSize: 11, color: tk.text3 }}>
              {hint}
            </span>
          ))}
        </div>
      </div>
    </>
  );
});

// ─── Result Row ─────────────────────────────────────────────────────────────

function ResultRow({
  item,
  isActive,
  catConfig,
  getIcon: getIconFn,
}: {
  item: ResultItem;
  isActive: boolean;
  catConfig: Record<string, { color: string; bgColor: string }>;
  getIcon: (name: string, size?: number) => React.ReactNode;
}) {
  const tk = useCanvasToken();
  const cc = item.category ? catConfig[item.category] : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 12px",
        borderRadius: 6,
        cursor: "pointer",
        background: isActive ? tk.qsRowActive : "transparent",
        transition: "background 0.1s ease",
      }}
    >
      {/* Icon pill */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: cc?.bgColor ?? tk.hoverBg,
          color: cc?.color ?? tk.text2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {item.icon ? getIconFn(item.icon, 14) : <LucideIcons.Sparkles size={14} strokeWidth={1.5} />}
      </div>

      {/* Name */}
      <span style={{ fontSize: 14, fontWeight: 500, color: tk.text1, flex: 1 }}>
        {item.label}
      </span>

      {/* Meta */}
      <span
        style={{
          fontSize: 10,
          color: tk.text3,
          fontFamily: "var(--font-jetbrains), monospace",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
      >
        {item.meta}
      </span>
    </div>
  );
}
