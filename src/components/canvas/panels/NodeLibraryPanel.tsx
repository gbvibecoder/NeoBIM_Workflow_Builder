"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, X, GripVertical, ChevronDown, ChevronLeft, ChevronRight, Plus, Clock, Tag,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { toast } from "sonner";
import { useReactFlow } from "@xyflow/react";
import { NODE_CATALOGUE, NODES_BY_CATEGORY, CATEGORY_CONFIG } from "@/constants/node-catalogue";
import type { NodeCatalogueItem, NodeCategory, WorkflowNode, WorkflowNodeData } from "@/types/nodes";
import { useWorkflowStore } from "@/stores/workflow-store";
import { generateId } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

function getIcon(name: string, size = 13): React.ReactNode {
  const icons = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ size?: number; strokeWidth?: number }>
  >;
  const Icon = icons[name];
  if (Icon) return <Icon size={size} strokeWidth={1.5} />;
  return <LucideIcons.Box size={size} strokeWidth={1.5} />;
}

// ─── Live vs Preview badge ───────────────────────────────────────────────────
const LIVE_NODE_IDS = new Set(["TR-003", "GN-003", "TR-008", "EX-002"]);

// ─── Filter chips ─────────────────────────────────────────────────────────────

const FILTER_VALUES: ("all" | NodeCategory)[] = ["all", "input", "transform", "generate", "export"];

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function NodeTooltip({ node, anchorY, panelWidth }: { node: NodeCatalogueItem; anchorY: number; panelWidth: number }) {
  const { t } = useLocale();
  const cfg = CATEGORY_CONFIG[node.category];
  const rgb = hexToRgb(cfg.color);

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{ duration: 0.15 }}
      style={{
        position: "fixed",
        left: panelWidth + 16,
        top: Math.max(8, Math.min(anchorY - 64, window.innerHeight - 260)),
        width: 240,
        background: "rgba(14, 14, 22, 0.97)",
        border: `1px solid rgba(${rgb}, 0.25)`,
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.65)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      {/* Name + dot */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#F0F0F5" }}>{node.name}</span>
      </div>

      {/* Description */}
      <p style={{ fontSize: 11, color: "#8888A0", lineHeight: 1.5, marginBottom: 8 }}>
        {node.description}
      </p>

      {/* Meta */}
      <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5C5C78" }}>
          <Clock size={9} />
          {node.executionTime ?? "—"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5C5C78" }}>
          <Tag size={9} />
          {node.id}
        </span>
      </div>

      {/* I/O */}
      {(node.inputs.length > 0 || node.outputs.length > 0) && (
        <div style={{
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", gap: 16, marginBottom: 8,
        }}>
          {node.inputs.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#3A3A50", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>
                {t('canvas.in')}
              </div>
              {node.inputs.map(p => (
                <div key={p.id} style={{ fontSize: 10, color: "#5C5C78" }}>{p.label}</div>
              ))}
            </div>
          )}
          {node.outputs.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#3A3A50", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>
                {t('canvas.out')}
              </div>
              {node.outputs.map(p => (
                <div key={p.id} style={{ fontSize: 10, color: "#5C5C78" }}>{p.label}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {node.tags.slice(0, 4).map(tag => (
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
    </motion.div>
  );
}

// ─── Node Item ────────────────────────────────────────────────────────────────

interface NodeItemProps {
  node: NodeCatalogueItem;
  onDragStart: (e: React.DragEvent, nodeId: string) => void;
  onAddToCenter: (node: NodeCatalogueItem) => void;
  onTooltipShow: (node: NodeCatalogueItem, y: number) => void;
  onTooltipHide: () => void;
  searchQuery?: string;
}

function NodeItem({
  node, onDragStart, onAddToCenter, onTooltipShow, onTooltipHide, searchQuery,
}: NodeItemProps) {
  const { t } = useLocale();
  const [isHovered, setIsHovered] = useState(false);
  const cfg = CATEGORY_CONFIG[node.category];
  const rgb = hexToRgb(cfg.color);

  const highlightText = (text: string): React.ReactNode => {
    const q = searchQuery?.trim();
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{
          background: `rgba(${rgb}, 0.2)`, color: cfg.color,
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
      onMouseEnter={e => { setIsHovered(true); onTooltipShow(node, e.clientY); }}
      onMouseLeave={() => { setIsHovered(false); onTooltipHide(); }}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        cursor: "grab",
        borderRadius: 8,
        overflow: "hidden",
        userSelect: "none",
        transition: "all 150ms ease",
        transform: "scale(1)",
      }}
      onMouseDown={e => { (e.currentTarget as HTMLElement).style.transform = "scale(0.98)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
    >
      {/* Hover bg slides in from left */}
      <motion.div
        animate={{ scaleX: isHovered ? 1 : 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(${rgb}, 0.05)`,
          transformOrigin: "left center",
          borderRadius: 6,
          pointerEvents: "none",
        }}
      />

      {/* Grip */}
      <GripVertical
        size={10}
        strokeWidth={1.5}
        style={{ color: isHovered ? "#3A3A50" : "rgba(255,255,255,0.06)", flexShrink: 0, position: "relative" }}
      />

      {/* Icon circle */}
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: `${cfg.color}12`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: cfg.color, flexShrink: 0, position: "relative",
      }}>
        {getIcon(node.icon, 14)}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <span style={{
            fontSize: 13, fontWeight: 500, color: "#e0e0ea",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            lineHeight: 1.2, flex: 1,
            transition: "color 150ms ease",
          }}>
            {highlightText(node.name)}
          </span>
          {LIVE_NODE_IDS.has(node.id) ? (
            <span style={{
              fontSize: 8, fontWeight: 700, color: "#10B981",
              padding: "1px 4px", borderRadius: 3,
              background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)",
              flexShrink: 0,
            }}>{t('canvas.live')}</span>
          ) : (
            <span style={{
              fontSize: 8, fontWeight: 600, color: "#4a4a68",
              padding: "2px 6px", borderRadius: 4,
              background: "rgba(255,255,255,0.06)",
              flexShrink: 0, letterSpacing: "0.08em",
            }}>{t('canvas.preview')}</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: "#3a3a50", fontFamily: "monospace", marginTop: 2 }}>
          {node.id} · {node.executionTime ?? "—"}
        </div>
      </div>

      {/* '+' add button */}
      <AnimatePresence>
        {isHovered && (
          <motion.button
            key="plus"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.1 }}
            onClick={e => { e.stopPropagation(); onAddToCenter(node); }}
            title={t('canvas.addToCenter')}
            style={{
              width: 20, height: 20, borderRadius: 5, padding: 0,
              background: `rgba(${rgb}, 0.15)`,
              border: `1px solid rgba(${rgb}, 0.3)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: cfg.color, cursor: "pointer", flexShrink: 0, position: "relative",
            }}
          >
            <Plus size={10} strokeWidth={2.5} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Category Section ─────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: NodeCategory;
  nodes: NodeCatalogueItem[];
  isOpen: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent, nodeId: string) => void;
  onAddToCenter: (node: NodeCatalogueItem) => void;
  onTooltipShow: (node: NodeCatalogueItem, y: number) => void;
  onTooltipHide: () => void;
}

function CategorySection({
  category, nodes, isOpen, onToggle,
  onDragStart, onAddToCenter, onTooltipShow, onTooltipHide,
}: CategorySectionProps) {
  const cfg = CATEGORY_CONFIG[category];
  const rgb = hexToRgb(cfg.color);

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header */}
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "6px 12px",
          background: "transparent", border: "none", cursor: "pointer",
        }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: cfg.color, flexShrink: 0,
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700, color: cfg.color,
          textTransform: "uppercase" as const, letterSpacing: "0.15em", flex: 1,
          textAlign: "left",
        }}>
          {cfg.label}
        </span>
        <span style={{
          padding: "1px 7px", borderRadius: 20,
          background: `rgba(${rgb}, 0.1)`,
          fontSize: 10, fontWeight: 600, color: cfg.color,
        }}>
          {nodes.length}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 0 : -90 }}
          transition={{ duration: 0.2 }}
          style={{ display: "flex", color: `rgba(${rgb}, 0.5)` }}
        >
          <ChevronDown size={12} strokeWidth={2} />
        </motion.div>
      </button>

      {/* Separator */}
      <div style={{
        height: 1, background: `${cfg.color}15`,
        marginLeft: 12, marginRight: 12,
      }} />

      {/* Nodes */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "4px 8px 4px" }}>
              {nodes.map(node => (
                <NodeItem
                  key={node.id}
                  node={node}
                  onDragStart={onDragStart}
                  onAddToCenter={onAddToCenter}
                  onTooltipShow={onTooltipShow}
                  onTooltipHide={onTooltipHide}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 280;

export function NodeLibraryPanel() {
  const { t } = useLocale();

  const FILTER_LABELS: Record<"all" | NodeCategory, string> = {
    all: t('canvas.all'),
    input: t('canvas.input'),
    transform: t('canvas.ai'),
    generate: t('canvas.geometry'),
    export: t('canvas.export'),
  };

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [search, setSearch] = useState("");
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const [activeFilter, setActiveFilter] = useState<"all" | NodeCategory>("all");
  const [openCategories, setOpenCategories] = useState<Record<NodeCategory, boolean>>({
    input: true, transform: false, generate: false, export: false,
  });
  const [tooltip, setTooltip] = useState<{ node: NodeCatalogueItem; y: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { screenToFlowPosition } = useReactFlow();
  const { addNode } = useWorkflowStore();

  const handleAddToCenter = useCallback((item: NodeCatalogueItem) => {
    const pw = isCollapsed ? 48 : 280;
    const th = 52;
    const cx = pw + (window.innerWidth - pw) / 2;
    const cy = th + (window.innerHeight - th) / 2;
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
  }, [isCollapsed, screenToFlowPosition, addNode]);

  const handleDragStart = useCallback((e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.setData("application/reactflow-nodeid", nodeId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleTooltipShow = useCallback((node: NodeCatalogueItem, y: number) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setTooltip({ node, y }), 500);
  }, []);

  const handleTooltipHide = useCallback(() => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeStartWidth.current + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const toggleCategory = useCallback((cat: NodeCategory) => {
    setOpenCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  const isFiltering = search.trim() !== "" || activeFilter !== "all";

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

  return (
    <motion.div
      initial={{ x: -300, opacity: 0 }}
      animate={{ x: 0, opacity: 1, width: isCollapsed ? 48 : panelWidth }}
      exit={{ x: -300, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{
        height: "100%",
        background: "rgba(6,6,12,0.95)",
        backdropFilter: "blur(32px) saturate(1.3)",
        WebkitBackdropFilter: "blur(32px) saturate(1.3)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Resize handle */}
      {!isCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: "absolute", top: 0, right: 0, bottom: 0,
            width: 6,
            cursor: "ew-resize",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: isResizing ? 1 : 0,
            background: "rgba(79, 138, 255, 0.1)",
            borderRight: isResizing ? "2px solid rgba(79, 138, 255, 0.4)" : "none",
            transition: "opacity 0.15s ease, background 0.15s ease",
            zIndex: 100,
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={e => { if (!isResizing) e.currentTarget.style.opacity = "0"; }}
        >
          <div style={{
            width: 3, height: 40, borderRadius: 2,
            background: "rgba(79, 138, 255, 0.3)",
            display: isResizing ? "block" : "none",
          }} />
        </div>
      )}

      {isCollapsed ? (
        // ── Icon-only strip ───────────────────────────────────────────────────
        <div style={{
          width: 48, height: "100%",
          display: "flex", flexDirection: "column",
          alignItems: "center", paddingTop: 12, gap: 8,
        }}>
          {(["input", "transform", "generate", "export"] as NodeCategory[]).map(cat => {
            const cfg = CATEGORY_CONFIG[cat];
            const firstNode = NODES_BY_CATEGORY[cat][0];
            return (
              <div
                key={cat}
                title={cfg.label}
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: `rgba(${hexToRgb(cfg.color)}, 0.1)`,
                  border: `1px solid rgba(${hexToRgb(cfg.color)}, 0.2)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: cfg.color,
                }}
              >
                {getIcon(firstNode?.icon ?? "Box", 13)}
              </div>
            );
          })}
          <button
            onClick={() => setIsCollapsed(false)}
            title={t('canvas.expandLibrary')}
            style={{
              marginTop: "auto", marginBottom: 12,
              width: 28, height: 28, borderRadius: 6,
              background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#5C5C78", cursor: "pointer",
            }}
          >
            <ChevronRight size={12} />
          </button>
        </div>
      ) : (
        // ── Full panel ────────────────────────────────────────────────────────
        <>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 10px 12px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5" }}>{t('canvas.nodeLibrary')}</div>
              <div style={{ fontSize: 10, color: "#3A3A50", marginTop: 2 }}>
                {NODE_CATALOGUE.length} nodes · {t('canvas.dragToCanvas')}
              </div>
            </div>
            <button
              onClick={() => setIsCollapsed(true)}
              title={t('canvas.collapsePanel')}
              style={{
                width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                background: "transparent", border: "1px solid rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#5C5C78", cursor: "pointer",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "#1A1A2A";
                e.currentTarget.style.color = "#F0F0F5";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#5C5C78";
              }}
            >
              <ChevronLeft size={12} />
            </button>
          </div>

          {/* Search */}
          <div style={{ padding: "10px 10px 0", flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <Search size={12} style={{
                position: "absolute", left: 9, top: "50%",
                transform: "translateY(-50%)", color: "#5C5C78", pointerEvents: "none",
              }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('canvas.searchNodes')}
                style={{
                  width: "100%", height: 36,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 8, paddingLeft: 28, paddingRight: search ? 28 : 12,
                  fontSize: 13, color: "#e8e8f0", outline: "none",
                  boxSizing: "border-box",
                  transition: "all 150ms ease",
                }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(79,138,255,0.30)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "transparent", border: "none",
                    color: "#5C5C78", cursor: "pointer",
                    display: "flex", alignItems: "center", padding: 0,
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* Filter chips */}
          <div style={{
            display: "flex", gap: 4, padding: "8px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
          }}>
            {FILTER_VALUES.map(value => {
              const active = activeFilter === value;
              const c = value === "all"
                ? "#4F8AFF"
                : CATEGORY_CONFIG[value as NodeCategory].color;
              const rgb = hexToRgb(c);
              return (
                <button
                  key={value}
                  onClick={() => setActiveFilter(value)}
                  style={{
                    padding: "4px 12px", borderRadius: 9999, whiteSpace: "nowrap", cursor: "pointer",
                    background: active ? `rgba(${rgb}, 0.15)` : "transparent",
                    border: active ? `1px solid rgba(${rgb}, 0.2)` : "1px solid transparent",
                    fontSize: 12, fontWeight: 500,
                    color: active ? c : "#5C5C78",
                    transition: "all 150ms ease",
                  }}
                >
                  {FILTER_LABELS[value]}
                </button>
              );
            })}
          </div>

          {/* Node list */}
          <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
            {isFiltering ? (
              displayNodes.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center" }}>
                  <p style={{ fontSize: 12, color: "#5C5C78" }}>{t('canvas.noNodes')}</p>
                  <p style={{ fontSize: 11, color: "#3A3A50", marginTop: 4 }}>{t('canvas.tryDifferent')}</p>
                </div>
              ) : (
                <div style={{ padding: "0 8px 8px" }}>
                  {displayNodes.map(node => (
                    <NodeItem
                      key={node.id}
                      node={node}
                      onDragStart={handleDragStart}
                      onAddToCenter={handleAddToCenter}
                      onTooltipShow={handleTooltipShow}
                      onTooltipHide={handleTooltipHide}
                      searchQuery={search}
                    />
                  ))}
                </div>
              )
            ) : (
              (["input", "transform", "generate", "export"] as NodeCategory[]).map(cat => (
                <CategorySection
                  key={cat}
                  category={cat}
                  nodes={NODES_BY_CATEGORY[cat]}
                  isOpen={openCategories[cat]}
                  onToggle={() => toggleCategory(cat)}
                  onDragStart={handleDragStart}
                  onAddToCenter={handleAddToCenter}
                  onTooltipShow={handleTooltipShow}
                  onTooltipHide={handleTooltipHide}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* Floating tooltip — fixed positioned, renders outside scroll container */}
      <AnimatePresence>
        {tooltip && <NodeTooltip node={tooltip.node} anchorY={tooltip.y} panelWidth={panelWidth} />}
      </AnimatePresence>
    </motion.div>
  );
}
