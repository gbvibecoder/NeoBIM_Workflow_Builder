"use client";

import React, { useState, useMemo } from "react";
import { Package, ChevronRight, Search, X, GripVertical } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { NODE_CATALOGUE, CATEGORY_CONFIG, LIVE_NODES } from "@/features/workflows/constants/node-catalogue";
import type { NodeCatalogueItem, NodeCategory } from "@/types/nodes";
import { useUIStore } from "@/shared/stores/ui-store";
import { useLocale } from "@/hooks/useLocale";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "0, 245, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

function getIcon(name: string, size = 12): React.ReactNode {
  const icons = LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>>;
  const Icon = icons[name];
  if (Icon) return <Icon size={size} strokeWidth={1.5} />;
  return <LucideIcons.Box size={size} strokeWidth={1.5} />;
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

type FilterValue = "all" | NodeCategory;

const FILTER_TABS: { value: FilterValue; label: string }[] = [
  { value: "all",       label: "ALL"   },
  { value: "input",     label: "INPUT" },
  { value: "transform", label: "AI"    },
  { value: "generate",  label: "GEO"   },
  { value: "export",    label: "OUT"   },
];

// ─── Main component ───────────────────────────────────────────────────────────

interface NodeLibrarySidebarProps {
  /** When true, the library content is always shown (no toggle header). Used in RightNodePanel. */
  alwaysOpen?: boolean;
}

export function NodeLibrarySidebar({ alwaysOpen = false }: NodeLibrarySidebarProps) {
  const { t } = useLocale();
  const canvasTheme = useCanvasTheme((s) => s.theme);
  const isNodeLibraryOpen = useUIStore(s => s.isNodeLibraryOpen);
  const toggleNodeLibrary = useUIStore(s => s.toggleNodeLibrary);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterValue>("all");

  const displayNodes = useMemo(() => {
    let result = NODE_CATALOGUE as NodeCatalogueItem[];
    if (activeFilter !== "all") {
      result = result.filter((n) => n.category === activeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.description.toLowerCase().includes(q) ||
          n.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [search, activeFilter]);

  // Click-to-add removed — nodes should only be added via drag-and-drop

  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.setData("application/reactflow-nodeid", nodeId);
    e.dataTransfer.effectAllowed = "move";
  };

  const showContent = alwaysOpen || isNodeLibraryOpen;

  return (
    <div className={`canvas-theme-${canvasTheme}`} style={{ padding: "0 8px", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: alwaysOpen ? "100%" : "auto" }}>

      {/* ── Header (hidden in alwaysOpen / right-panel mode) ──────────── */}
      {!alwaysOpen && (
        <button
          onClick={toggleNodeLibrary}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 10,
            background: isNodeLibraryOpen ? "var(--canvas-lib-active-bg)" : "transparent",
            border: `1px solid ${isNodeLibraryOpen ? "var(--canvas-lib-active-border)" : "transparent"}`,
            cursor: "pointer",
            transition: "all 180ms ease",
          }}
        >
          <Package
            size={15}
            style={{
              color: isNodeLibraryOpen ? "var(--canvas-lib-active-text)" : "var(--canvas-lib-icon-muted)",
              flexShrink: 0,
              transition: "color 180ms ease",
            }}
          />
          <span
            style={{
              flex: 1,
              textAlign: "left",
              fontSize: 12.5,
              fontWeight: 550,
              color: isNodeLibraryOpen ? "var(--canvas-lib-text-primary)" : "var(--canvas-lib-text-secondary)",
              fontFamily: "var(--font-dm-sans), sans-serif",
              letterSpacing: "0.2px",
              whiteSpace: "nowrap",
            }}
          >
            {t('canvas.nodeLibrary')}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.5px",
              color: "var(--canvas-lib-count-text)",
              fontFamily: "var(--font-jetbrains), monospace",
              padding: "1px 5px",
              borderRadius: 4,
              background: "var(--canvas-lib-count-bg)",
              border: "1px solid var(--canvas-lib-count-border)",
              flexShrink: 0,
            }}
          >
            {NODE_CATALOGUE.length}
          </span>
          <ChevronRight
            size={13}
            style={{
              color: "var(--canvas-lib-icon-chevron)",
              transform: isNodeLibraryOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 200ms ease",
              flexShrink: 0,
            }}
          />
        </button>
      )}

      {/* ── Expanded content ──────────────────────────────────────────── */}
      {showContent && (
        <div style={{ marginTop: alwaysOpen ? 0 : 6, display: "flex", flexDirection: "column", flex: alwaysOpen ? 1 : "none", minHeight: 0 }}>

          {/* Search */}
          <div style={{ position: "relative", marginBottom: 6 }}>
            <Search
              size={11}
              style={{
                position: "absolute",
                left: 9,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--canvas-lib-icon-muted)",
                pointerEvents: "none",
              }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('canvas.searchNodes')}
              style={{
                width: "100%",
                padding: "7px 28px 7px 27px",
                background: "var(--canvas-lib-search-bg)",
                border: "1px solid var(--canvas-lib-search-border)",
                borderRadius: 8,
                color: "var(--canvas-lib-search-text)",
                fontSize: 11.5,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "var(--font-dm-sans), sans-serif",
                transition: "border-color 150ms ease",
              }}
              onFocus={(e) => { e.target.style.borderColor = "var(--canvas-lib-search-focus)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--canvas-lib-search-border)"; }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: 7,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--canvas-lib-icon-muted)",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* Category filter tabs */}
          <div style={{ display: "flex", gap: 3, marginBottom: 8, flexWrap: "wrap" }}>
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveFilter(tab.value)}
                style={{
                  padding: "3px 7px",
                  borderRadius: 5,
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: "0.5px",
                  cursor: "pointer",
                  border: "1px solid",
                  fontFamily: "var(--font-jetbrains), monospace",
                  background:
                    activeFilter === tab.value ? "var(--canvas-lib-filter-active-bg)" : "var(--canvas-lib-filter-idle-bg)",
                  borderColor:
                    activeFilter === tab.value ? "var(--canvas-lib-filter-active-border)" : "var(--canvas-lib-filter-idle-border)",
                  color:
                    activeFilter === tab.value ? "var(--canvas-lib-filter-active-text)" : "var(--canvas-lib-filter-idle-text)",
                  transition: "all 150ms ease",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Node count */}
          <div style={{
            fontSize: 9.5,
            color: "var(--canvas-lib-text-dim)",
            fontFamily: "var(--font-jetbrains), monospace",
            marginBottom: 4,
            paddingLeft: 2,
          }}>
            {displayNodes.length} {t('canvas.nodes')}
            {activeFilter !== "all" || search ? ` ${t('canvas.shown')}` : ` ${t('canvas.total')}`}
          </div>

          {/* Scrollable node list */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              paddingRight: 2,
            }}
          >
            {displayNodes.length === 0 ? (
              <div style={{
                padding: "20px 8px",
                textAlign: "center",
                color: "var(--canvas-lib-text-dim)",
                fontSize: 11,
                fontFamily: "var(--font-dm-sans), sans-serif",
              }}>
                {t('canvas.noNodes')}
              </div>
            ) : (
              displayNodes.map((node) => (
                <NodeItem
                  key={node.id}
                  node={node}
                  onDragStart={handleDragStart}
                />
              ))
            )}
          </div>

          {/* Hint */}
          <div style={{
            marginTop: 6,
            padding: "5px 8px",
            fontSize: 9.5,
            color: "var(--canvas-lib-text-hint)",
            fontFamily: "var(--font-jetbrains), monospace",
            borderTop: "1px solid var(--canvas-lib-hint-border)",
            textAlign: "center",
            letterSpacing: "0.3px",
          }}>
            {t('canvas.dragToCanvasLabel')}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Node item ────────────────────────────────────────────────────────────────

interface NodeItemProps {
  node: NodeCatalogueItem;
  onDragStart: (e: React.DragEvent, nodeId: string) => void;
}

function NodeItem({ node, onDragStart }: NodeItemProps) {
  const [hovered, setHovered] = useState(false);
  const cfg = CATEGORY_CONFIG[node.category];
  const rgb = hexToRgb(cfg.color);
  const isLive = LIVE_NODES.has(node.id);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, node.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${node.name} — ${node.description}\nDrag to canvas to add`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 8px",
        borderRadius: 8,
        cursor: "grab",
        userSelect: "none",
        background: hovered ? `rgba(${rgb}, 0.07)` : "transparent",
        border: `1px solid ${hovered ? `rgba(${rgb}, 0.18)` : "transparent"}`,
        transition: "all 120ms ease",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          flexShrink: 0,
          background: `rgba(${rgb}, 0.15)`,
          border: `1px solid rgba(${rgb}, 0.3)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: cfg.color,
          boxShadow: hovered ? `0 0 8px rgba(${rgb}, 0.2)` : "none",
          transition: "box-shadow 120ms ease",
        }}
      >
        {getIcon(node.icon, 12)}
      </div>

      {/* Name + description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: hovered ? "var(--canvas-lib-node-name-hover)" : "var(--canvas-lib-node-name)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
            wordBreak: "break-word" as const,
            lineHeight: 1.3,
            transition: "color 120ms ease",
          }}
        >
          {node.name}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--canvas-lib-text-meta)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
            wordBreak: "break-word" as const,
            lineHeight: 1.3,
            marginTop: 1,
          }}
        >
          {node.description}
        </div>
      </div>

      {/* Live badge */}
      {isLive && (
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            padding: "1px 4px",
            borderRadius: 4,
            background: "var(--canvas-lib-badge-bg)",
            color: "var(--canvas-lib-badge-text)",
            border: "1px solid var(--canvas-lib-badge-border)",
            letterSpacing: "0.5px",
            flexShrink: 0,
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          LIVE
        </span>
      )}

      {/* Drag handle hint */}
      {hovered && (
        <GripVertical size={11} style={{ color: "var(--canvas-lib-grip)", flexShrink: 0 }} />
      )}
    </div>
  );
}
