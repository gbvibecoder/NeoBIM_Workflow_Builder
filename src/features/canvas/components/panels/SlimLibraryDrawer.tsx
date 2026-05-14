"use client";

/**
 * SlimLibraryDrawer — Z.CANVAS.SLIM-LIBRARY
 * 320px flyout drawer that opens to the LEFT of the SlimLibraryStrip.
 * Shows filtered node list by category, or all nodes with section headers.
 * Closes on Esc or click outside (but not when clicking the strip).
 * Preserves drag-to-canvas payload identical to old NodeLibrarySidebar.
 */

import React, { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import {
  useUIStore,
  selectSlimDrawerOpen,
  selectSlimDrawerCategory,
  selectCloseSlimDrawer,
} from "@/shared/stores/ui-store";
import type { SlimCategory } from "@/shared/stores/ui-store";
import { NODE_CATALOGUE, LIVE_NODES } from "@/features/workflows/constants/node-catalogue";
import type { NodeCatalogueItem } from "@/types/nodes";

// ─── Helpers (from NodeLibrarySidebar) ──────────────────────────────────────

function getIcon(name: string, size = 16): React.ReactNode {
  const icons = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ size?: number; strokeWidth?: number }>
  >;
  const Icon = icons[name];
  if (Icon) return <Icon size={size} strokeWidth={1.5} />;
  return <LucideIcons.Box size={size} strokeWidth={1.5} />;
}

function getCategoryColors(category: string, tk: ReturnType<typeof useCanvasToken>) {
  switch (category) {
    case "input":    return { solid: tk.catInput, soft: tk.catInputSoft };
    case "transform": return { solid: tk.catTransform, soft: tk.catTransformSoft };
    case "generate": return { solid: tk.catGenerate, soft: tk.catGenerateSoft };
    case "export":   return { solid: tk.catExport, soft: tk.catExportSoft };
    default:         return { solid: tk.text2, soft: tk.surface2 };
  }
}

// ─── Category metadata ──────────────────────────────────────────────────────

interface CategoryMeta {
  label: string;
  title: string;
  subtitle: string;
  catKey: string;
  solidColor: string;
}

function getCategoryMeta(category: SlimCategory, tk: ReturnType<typeof useCanvasToken>): CategoryMeta {
  switch (category) {
    case "input":
      return { label: "Design Inputs", title: "Source data", subtitle: "Upload files or enter values to feed your workflow.", catKey: "input", solidColor: tk.catInput };
    case "transform":
      return { label: "AI Transforms", title: "AI processing", subtitle: "Extract, analyze, and transform your data with AI.", catKey: "transform", solidColor: tk.catTransform };
    case "generate":
      return { label: "Geometry & Generation", title: "Create outputs", subtitle: "Generate new geometry, renders, and 3D content.", catKey: "generate", solidColor: tk.catGenerate };
    case "export":
      return { label: "Exports & Reports", title: "Deliverables", subtitle: "Generate downloadable files and final outputs.", catKey: "export", solidColor: tk.catExport };
    case "all":
    default:
      return { label: "All Nodes", title: "Complete library", subtitle: `${NODE_CATALOGUE.length} nodes — drag any to canvas to begin.`, catKey: "all", solidColor: tk.text1 };
  }
}

// ─── Node row ───────────────────────────────────────────────────────────────

const NodeRow = memo(function NodeRow({ node, tk }: { node: NodeCatalogueItem; tk: ReturnType<typeof useCanvasToken> }) {
  const [hovered, setHovered] = useState(false);
  const isLive = LIVE_NODES.has(node.id);
  const { solid, soft } = getCategoryColors(node.category, tk);

  // EXACT same drag payload as NodeLibrarySidebar.tsx line 235
  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("application/reactflow-nodeid", node.id);
    e.dataTransfer.effectAllowed = "move";
  }, [node.id]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${node.name} — ${node.description}\nDrag to canvas to add`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 10,
        borderRadius: 8,
        cursor: "grab",
        marginBottom: 2,
        userSelect: "none",
        background: hovered ? tk.libBgHover : "transparent",
        transform: hovered ? "translateY(-1px)" : "none",
        boxShadow: hovered ? tk.shadowSm : "none",
        transition: "background 120ms, transform 120ms, box-shadow 120ms",
      }}
    >
      {/* Icon pill */}
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: soft, color: solid,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {getIcon(node.icon, 16)}
      </div>

      {/* Title + description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "Geist, sans-serif", fontSize: 12.5, fontWeight: 600,
          color: tk.text1, lineHeight: 1.3,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {node.name}
        </div>
        <div style={{
          fontFamily: "Geist, sans-serif", fontSize: 10.5, color: tk.text3,
          marginTop: 2, lineHeight: 1.4,
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const, overflow: "hidden",
        }}>
          {node.description}
        </div>
      </div>

      {/* Badge */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
        letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0,
        background: isLive ? tk.badgeLiveBg : tk.badgeDemoBg,
        color: isLive ? tk.badgeLiveText : tk.badgeDemoText,
      }}>
        {isLive ? "Live" : "Demo"}
      </span>
    </div>
  );
});

// ─── Section header ─────────────────────────────────────────────────────────

function SectionHeader({ label, tk }: { label: string; tk: ReturnType<typeof useCanvasToken> }) {
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10, fontWeight: 700, color: tk.text3,
      letterSpacing: "0.10em", textTransform: "uppercase",
      padding: "12px 4px 6px",
    }}>
      {label}
    </div>
  );
}

// ─── Section labels ─────────────────────────────────────────────────────────

const SECTION_LABELS: [string, string][] = [
  ["input", "Design Inputs"],
  ["transform", "AI Transforms"],
  ["generate", "Geometry & Generation"],
  ["export", "Exports & Reports"],
];

// ─── Drawer ─────────────────────────────────────────────────────────────────

export const SlimLibraryDrawer = memo(function SlimLibraryDrawer() {
  const tk = useCanvasToken();
  const open = useUIStore(selectSlimDrawerOpen);
  const category = useUIStore(selectSlimDrawerCategory);
  const close = useUIStore(selectCloseSlimDrawer);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  // Reset search when category changes
  useEffect(() => { setSearch(""); }, [category]);

  // Esc closes drawer
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Click outside closes drawer (but not if clicking the strip)
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-slim-strip]") || drawerRef.current?.contains(target)) return;
      close();
    };
    const id = setTimeout(() => document.addEventListener("mousedown", onClick, true), 0);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", onClick, true); };
  }, [open, close]);

  // Filter nodes
  const filteredNodes = useMemo(() => {
    let nodes = NODE_CATALOGUE as NodeCatalogueItem[];
    if (category && category !== "all") {
      nodes = nodes.filter((n) => n.category === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      nodes = nodes.filter((n) =>
        n.name.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        n.tags?.some((tag: string) => tag.toLowerCase().includes(q))
      );
    }
    return nodes;
  }, [category, search]);

  const showSections = category === "all" && !search.trim();
  const meta = category ? getCategoryMeta(category, tk) : null;

  return (
    <AnimatePresence>
      {open && meta && (
        <motion.div
          ref={drawerRef}
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position: "absolute",
            top: 80,
            right: 88,
            bottom: 68,
            width: 320,
            background: tk.drawerBg,
            border: `1px solid ${tk.slimStripBorder}`,
            borderRadius: 14,
            boxShadow: tk.shadowMd,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 8,
          }}
        >
          {/* Header */}
          <div style={{ padding: 16, borderBottom: `1px solid ${tk.drawerHeaderBorder}`, position: "relative", flexShrink: 0 }}>
            <button
              onClick={close}
              aria-label="Close drawer"
              title="Close (Esc)"
              style={{
                position: "absolute", top: 14, right: 14,
                width: 28, height: 28, borderRadius: 6, border: "none",
                background: "transparent", color: tk.text3, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = tk.hoverBg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <X size={14} />
            </button>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, fontWeight: 700, color: meta.solidColor,
              letterSpacing: "0.10em", textTransform: "uppercase",
            }}>
              {meta.label}
            </div>
            <div style={{
              fontFamily: "'Instrument Serif', serif", fontStyle: "italic",
              fontSize: 24, color: tk.text1, marginTop: 2, lineHeight: 1.1,
            }}>
              {meta.title}
            </div>
            <div style={{
              fontFamily: "Geist, sans-serif",
              fontSize: 12, color: tk.text3, marginTop: 6, lineHeight: 1.4,
            }}>
              {meta.subtitle}
            </div>
          </div>

          {/* Search */}
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${tk.line1}`, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{
                position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                color: tk.text3, pointerEvents: "none",
              }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter nodes..."
                style={{
                  width: "100%", background: tk.libSearchBg,
                  border: `1px solid ${tk.line1}`, borderRadius: 8,
                  padding: "8px 10px 8px 32px",
                  fontFamily: "Geist, sans-serif", fontSize: 12, color: tk.text1,
                  outline: "none", boxSizing: "border-box",
                  transition: "border-color 150ms ease",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = tk.lineFocus; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = tk.line1; }}
              />
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: 8, minHeight: 0 }}>
            {filteredNodes.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: tk.text3 }}>
                <Search size={28} style={{ opacity: 0.3, margin: "0 auto 10px", display: "block" }} />
                <div style={{ fontFamily: "Geist, sans-serif", fontSize: 13, fontWeight: 600, color: tk.text2, marginBottom: 4 }}>
                  No nodes found
                </div>
                <div style={{ fontFamily: "Geist, sans-serif", fontSize: 11, color: tk.text3 }}>
                  Try different keywords
                </div>
              </div>
            ) : showSections ? (
              SECTION_LABELS.map(([cat, label]) => {
                const catNodes = filteredNodes.filter((n) => n.category === cat);
                if (catNodes.length === 0) return null;
                return (
                  <React.Fragment key={cat}>
                    <SectionHeader label={label} tk={tk} />
                    {catNodes.map((n) => <NodeRow key={n.id} node={n} tk={tk} />)}
                  </React.Fragment>
                );
              })
            ) : (
              filteredNodes.map((n) => <NodeRow key={n.id} node={n} tk={tk} />)
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
