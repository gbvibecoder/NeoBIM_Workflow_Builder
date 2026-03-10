"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, X, Plus, Clock, Tag,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { toast } from "sonner";
import { useReactFlow } from "@xyflow/react";
import { NODE_CATALOGUE, CATEGORY_CONFIG, LIVE_NODES } from "@/constants/node-catalogue";
import type { NodeCatalogueItem, NodeCategory, WorkflowNode, WorkflowNodeData } from "@/types/nodes";
import { useWorkflowStore } from "@/stores/workflow-store";
import { generateId } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { useUIStore } from "@/stores/ui-store";

import { hexToRgb } from "@/lib/ui-constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIcon(name: string, size = 13): React.ReactNode {
  const icons = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ size?: number; strokeWidth?: number }>
  >;
  const Icon = icons[name];
  if (Icon) return <Icon size={size} strokeWidth={1.5} />;
  return <LucideIcons.Box size={size} strokeWidth={1.5} />;
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

const FILTER_VALUES: ("all" | NodeCategory)[] = ["all", "input", "transform", "generate", "export"];

// ─── Palette Node Item ──────────────────────────────────────────────────────

interface PaletteItemProps {
  node: NodeCatalogueItem;
  onSelect: (node: NodeCatalogueItem) => void;
  onDragStart: (e: React.DragEvent, nodeId: string) => void;
  isHighlighted: boolean;
  searchQuery?: string;
}

function PaletteItem({ node, onSelect, onDragStart, isHighlighted, searchQuery }: PaletteItemProps) {
  const cfg = CATEGORY_CONFIG[node.category];
  const rgb = hexToRgb(cfg.color);
  const [hovered, setHovered] = useState(false);

  const highlightText = (text: string): React.ReactNode => {
    const q = searchQuery?.trim();
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{
          background: `rgba(${rgb}, 0.25)`, color: cfg.color,
          borderRadius: 2, padding: "0 1px",
        }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, node.id)}
      onClick={() => onSelect(node)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        cursor: "pointer",
        borderRadius: 10,
        background: isHighlighted
          ? `rgba(${rgb}, 0.1)`
          : hovered
            ? "rgba(255,255,255,0.03)"
            : "transparent",
        border: isHighlighted
          ? `1px solid rgba(${rgb}, 0.2)`
          : "1px solid transparent",
        transition: "all 120ms ease",
        userSelect: "none",
      }}
    >
      {/* Icon */}
      <div style={{
        width: 30, height: 30, borderRadius: 8,
        background: `rgba(${rgb}, 0.1)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: cfg.color, flexShrink: 0,
      }}>
        {getIcon(node.icon, 14)}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <span style={{
            fontSize: 13, fontWeight: 500, color: "#e8e8f0",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, lineHeight: 1.2,
            fontFamily: "'Playfair Display', serif", fontStyle: "italic",
          }}>
            {highlightText(node.name)}
          </span>
          {LIVE_NODES.has(node.id) ? (
            <span style={{
              fontSize: 7, fontWeight: 700, color: "#00F5FF",
              padding: "1px 4px", borderRadius: 3,
              background: "rgba(0,245,255,0.1)", border: "1px solid rgba(0,245,255,0.2)",
              flexShrink: 0,
            }}>LIVE</span>
          ) : (
            <span style={{
              fontSize: 7, fontWeight: 700, color: "#B87333",
              padding: "1px 4px", borderRadius: 3,
              background: "rgba(184,115,51,0.08)", border: "1px solid rgba(184,115,51,0.15)",
              flexShrink: 0,
            }}>MOCK</span>
          )}
        </div>
        <div style={{
          fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1,
          fontFamily: "'Space Mono', monospace",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {node.description.slice(0, 60)}{node.description.length > 60 ? "..." : ""}
        </div>
      </div>

      {/* Category dot */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: cfg.color, flexShrink: 0, opacity: 0.6,
      }} />
    </div>
  );
}

// ─── Detail Tooltip (shows on hover in the palette) ──────────────────────────

function PaletteNodeDetail({ node }: { node: NodeCatalogueItem }) {
  const { t } = useLocale();
  const cfg = CATEGORY_CONFIG[node.category];
  const rgb = hexToRgb(cfg.color);

  return (
    <div style={{
      padding: "12px 14px",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(0,0,0,0.2)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.color }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#F0F0F5" }}>{node.name}</span>
      </div>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 8, fontFamily: "'Space Mono', monospace" }}>
        {node.description}
      </p>
      <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5C5C78" }}>
          <Clock size={9} /> {node.executionTime ?? "—"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5C5C78" }}>
          <Tag size={9} /> {node.id}
        </span>
      </div>
      {(node.inputs.length > 0 || node.outputs.length > 0) && (
        <div style={{
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", gap: 16,
        }}>
          {node.inputs.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "rgba(184,115,51,0.4)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>
                {t('canvas.in')}
              </div>
              {node.inputs.map(p => (
                <div key={p.id} style={{ fontSize: 10, color: "#5C5C78" }}>{p.label}</div>
              ))}
            </div>
          )}
          {node.outputs.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "rgba(184,115,51,0.4)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>
                {t('canvas.out')}
              </div>
              {node.outputs.map(p => (
                <div key={p.id} style={{ fontSize: 10, color: "#5C5C78" }}>{p.label}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {node.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 8 }}>
          {node.tags.slice(0, 5).map(tag => (
            <span key={tag} style={{
              padding: "1px 6px", borderRadius: 4,
              background: `rgba(${rgb}, 0.08)`,
              border: `1px solid rgba(${rgb}, 0.18)`,
              fontSize: 9, color: cfg.color,
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Command Palette ─────────────────────────────────────────────────────

export function NodeLibraryPanel() {
  const { t } = useLocale();

  const FILTER_LABELS: Record<"all" | NodeCategory, string> = {
    all: t('canvas.all'),
    input: t('canvas.input'),
    transform: t('canvas.ai'),
    generate: t('canvas.geometry'),
    export: t('canvas.export'),
  };

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | NodeCategory>("all");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedNode, setSelectedNode] = useState<NodeCatalogueItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { screenToFlowPosition } = useReactFlow();
  const { addNode } = useWorkflowStore();
  const { toggleNodeLibrary } = useUIStore();

  const handleAddNode = useCallback((item: NodeCatalogueItem) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const position = screenToFlowPosition({ x: cx, y: cy });
    const newNode: WorkflowNode = {
      id: `${item.id}-${generateId()}`,
      type: "workflowNode",
      position,
      data: {
        catalogueId: item.id,
        label: item.name,
        category: item.category,
        status: "idle",
        inputs: item.inputs,
        outputs: item.outputs,
        icon: item.icon,
        executionTime: item.executionTime,
      } satisfies WorkflowNodeData,
    };
    addNode(newNode);
    toast.success(`Added: ${item.name}`, { duration: 2000 });
    toggleNodeLibrary(); // close palette
  }, [screenToFlowPosition, addNode, toggleNodeLibrary]);

  const handleDragStart = useCallback((e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.setData("application/reactflow-nodeid", nodeId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const displayNodes = useMemo(() => {
    let nodes = NODE_CATALOGUE;
    if (activeFilter !== "all") nodes = nodes.filter(n => n.category === activeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      nodes = nodes.filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        n.tags.some(t => t.includes(q)) ||
        n.id.toLowerCase().includes(q)
      );
    }
    return nodes;
  }, [search, activeFilter]);

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(0);
    setSelectedNode(null);
  }, [search, activeFilter]);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        toggleNodeLibrary();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex(i => Math.min(i + 1, displayNodes.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && displayNodes.length > 0) {
        e.preventDefault();
        handleAddNode(displayNodes[highlightedIndex]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [displayNodes, highlightedIndex, handleAddNode, toggleNodeLibrary]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.children;
    const item = items[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlightedIndex]);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={toggleNodeLibrary}
        style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      />

      {/* Palette */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        style={{
          position: "fixed",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 520,
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "70vh",
          zIndex: 9999,
          background: "rgba(7, 8, 9, 0.92)",
          border: "1px solid rgba(184,115,51,0.2)",
          borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(184,115,51,0.08), 0 0 60px rgba(184,115,51,0.05)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Search input */}
        <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{
              position: "absolute", left: 14, top: "50%",
              transform: "translateY(-50%)", color: "rgba(184,115,51,0.5)", pointerEvents: "none",
            }} />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search nodes or type a command..."
              style={{
                width: "100%", height: 46,
                background: "transparent",
                borderTop: "none", borderLeft: "none", borderRight: "none",
                borderBottom: "1px solid rgba(184,115,51,0.2)",
                borderRadius: 0,
                paddingLeft: 40, paddingRight: search ? 36 : 14,
                fontSize: 13, color: "#e8e8f0",
                outline: "none", boxSizing: "border-box",
                fontWeight: 400,
                transition: "border-color 150ms ease",
                fontFamily: "'Space Mono', monospace",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(0,245,255,0.35)"; }}
              onBlur={e => { e.currentTarget.style.borderBottom = "1px solid rgba(184,115,51,0.2)"; }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  background: "rgba(184,115,51,0.1)", border: "none",
                  width: 20, height: 20, borderRadius: 5,
                  color: "#5C5C78", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Filter chips */}
        <div style={{
          display: "flex", gap: 4, padding: "10px 16px 8px",
          borderBottom: "1px solid rgba(184,115,51,0.1)", flexShrink: 0,
        }}>
          {FILTER_VALUES.map(value => {
            const active = activeFilter === value;
            const c = value === "all" ? "#B87333" : CATEGORY_CONFIG[value as NodeCategory].color;
            const rgb = hexToRgb(c);
            return (
              <button
                key={value}
                onClick={() => setActiveFilter(value)}
                style={{
                  padding: "5px 14px", borderRadius: 9999, whiteSpace: "nowrap", cursor: "pointer",
                  background: active ? `rgba(${rgb}, 0.12)` : "transparent",
                  border: active ? `1px solid rgba(${rgb}, 0.2)` : "1px solid transparent",
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  color: active ? c : "#5C5C78",
                  transition: "all 120ms ease",
                  fontFamily: "'Space Mono', monospace",
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.05em",
                }}
              >
                {FILTER_LABELS[value]}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <span style={{
            fontSize: 10, color: "rgba(184,115,51,0.4)", alignSelf: "center",
            fontFamily: "'Space Mono', monospace",
          }}>
            {displayNodes.length} nodes
          </span>
        </div>

        {/* Node list */}
        <div
          ref={listRef}
          style={{
            flex: 1, overflowY: "auto", padding: "6px 8px",
            maxHeight: 360,
          }}
        >
          {displayNodes.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#5C5C78" }}>{t('canvas.noNodes')}</p>
              <p style={{ fontSize: 11, color: "#3A3A50", marginTop: 4 }}>{t('canvas.tryDifferent')}</p>
            </div>
          ) : (
            displayNodes.map((node, i) => (
              <PaletteItem
                key={node.id}
                node={node}
                onSelect={handleAddNode}
                onDragStart={handleDragStart}
                isHighlighted={i === highlightedIndex}
                searchQuery={search}
              />
            ))
          )}
        </div>

        {/* Selected node detail */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: "hidden" }}
            >
              <PaletteNodeDetail node={selectedNode} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer hint */}
        <div style={{
          padding: "8px 16px",
          borderTop: "1px solid rgba(184,115,51,0.1)",
          display: "flex", gap: 16,
          fontSize: 10, color: "rgba(184,115,51,0.4)",
          flexShrink: 0,
        }}>
          <span><kbd style={{ background: "rgba(184,115,51,0.1)", padding: "1px 5px", borderRadius: 3, fontSize: 9 }}>↑↓</kbd> navigate</span>
          <span><kbd style={{ background: "rgba(184,115,51,0.1)", padding: "1px 5px", borderRadius: 3, fontSize: 9 }}>↵</kbd> add node</span>
          <span><kbd style={{ background: "rgba(184,115,51,0.1)", padding: "1px 5px", borderRadius: 3, fontSize: 9 }}>esc</kbd> close</span>
          <span style={{ marginLeft: "auto" }}>drag to canvas</span>
        </div>
      </motion.div>
    </>
  );
}
