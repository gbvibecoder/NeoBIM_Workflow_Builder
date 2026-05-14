"use client";

import React, { useState, useMemo } from "react";
import { Package, ChevronRight, Search, X } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { NODE_CATALOGUE, LIVE_NODES } from "@/features/workflows/constants/node-catalogue";
import type { NodeCatalogueItem, NodeCategory } from "@/types/nodes";
import { useUIStore } from "@/shared/stores/ui-store";
import { useLocale } from "@/hooks/useLocale";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken, useIsLight } from "@/features/canvas/lib/canvas-tokens";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIcon(name: string, size = 16): React.ReactNode {
  const icons = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ size?: number; strokeWidth?: number }>
  >;
  const Icon = icons[name];
  if (Icon) return <Icon size={size} strokeWidth={1.5} />;
  return <LucideIcons.Box size={size} strokeWidth={1.5} />;
}

function getCategoryColors(
  category: string,
  tk: ReturnType<typeof useCanvasToken>,
) {
  switch (category) {
    case "input":
      return { solid: tk.catInput, soft: tk.catInputSoft };
    case "transform":
      return { solid: tk.catTransform, soft: tk.catTransformSoft };
    case "generate":
      return { solid: tk.catGenerate, soft: tk.catGenerateSoft };
    case "export":
      return { solid: tk.catExport, soft: tk.catExportSoft };
    default:
      return { solid: tk.text2, soft: tk.surface2 };
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

type FilterValue = "all" | NodeCategory;

const FILTER_TABS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "input", label: "Input" },
  { value: "transform", label: "AI" },
  { value: "generate", label: "Geo" },
  { value: "export", label: "Out" },
];

const SECTION_LABELS: [NodeCategory, string][] = [
  ["input", "Design Inputs"],
  ["transform", "AI Transforms"],
  ["generate", "Geometry & Generation"],
  ["export", "Exports & Reports"],
];

// ─── Badge ────────────────────────────────────────────────────────────────────

function LibBadge({
  variant,
  children,
}: {
  variant: "live" | "demo" | "vip";
  children: React.ReactNode;
}) {
  const tk = useCanvasToken();
  const colors = {
    live: { bg: tk.badgeLiveBg, text: tk.badgeLiveText },
    demo: { bg: tk.badgeDemoBg, text: tk.badgeDemoText },
    vip: { bg: tk.badgeVipBg, text: tk.badgeVipText },
  };
  const c = colors[variant];
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 4,
        letterSpacing: "0.06em",
        textTransform: "uppercase" as const,
        flexShrink: 0,
        background: c.bg,
        color: c.text,
      }}
    >
      {children}
    </span>
  );
}

// ─── Node row ─────────────────────────────────────────────────────────────────

function NodeRow({
  node,
  onDragStart,
}: {
  node: NodeCatalogueItem;
  onDragStart: (e: React.DragEvent, nodeId: string) => void;
}) {
  const tk = useCanvasToken();
  const [hovered, setHovered] = useState(false);
  const isLive = LIVE_NODES.has(node.id);
  const { solid: catSolid, soft: catSoft } = getCategoryColors(
    node.category,
    tk,
  );

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
        gap: 12,
        padding: "10px 10px",
        borderRadius: 8,
        cursor: "grab",
        transition: "background 120ms, transform 120ms, box-shadow 120ms",
        marginBottom: 2,
        userSelect: "none" as const,
        background: hovered ? tk.libBgHover : "transparent",
        transform: hovered ? "translateY(-1px)" : "none",
        boxShadow: hovered ? tk.shadowSm : "none",
      }}
    >
      {/* Icon pill 32×32 */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: catSoft,
          color: catSolid,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {getIcon(node.icon, 16)}
      </div>

      {/* Title + description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "Geist, sans-serif",
            fontSize: 12.5,
            fontWeight: 600,
            color: tk.text1,
            lineHeight: 1.3,
            whiteSpace: "nowrap" as const,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {node.name}
        </div>
        <div
          style={{
            fontFamily: "Geist, sans-serif",
            fontSize: 10.5,
            color: tk.text3,
            marginTop: 2,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
          }}
        >
          {node.description}
        </div>
      </div>

      {/* Right-side badge */}
      {isLive ? (
        <LibBadge variant="live">Live</LibBadge>
      ) : (
        <LibBadge variant="demo">Demo</LibBadge>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface NodeLibrarySidebarProps {
  /** When true, the library content is always shown (no toggle header). Used in RightNodePanel. */
  alwaysOpen?: boolean;
}

export function NodeLibrarySidebar({
  alwaysOpen = false,
}: NodeLibrarySidebarProps) {
  const { t } = useLocale();
  const canvasTheme = useCanvasTheme((s) => s.theme);
  const tk = useCanvasToken();
  const isLight = useIsLight();
  const isNodeLibraryOpen = useUIStore((s) => s.isNodeLibraryOpen);
  const toggleNodeLibrary = useUIStore((s) => s.toggleNodeLibrary);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterValue>("all");
  const [focusedSearch, setFocusedSearch] = useState(false);

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
          n.tags?.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [search, activeFilter]);

  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.setData("application/reactflow-nodeid", nodeId);
    e.dataTransfer.effectAllowed = "move";
  };

  const showContent = alwaysOpen || isNodeLibraryOpen;
  const showSections = activeFilter === "all" && !search.trim();

  return (
    <div
      className={`canvas-theme-${canvasTheme}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: alwaysOpen ? "100%" : "auto",
      }}
    >
      {/* ── Header (hidden in alwaysOpen / right-panel mode) ─────── */}
      {!alwaysOpen && (
        <div style={{ padding: "0 8px" }}>
          <button
            onClick={toggleNodeLibrary}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 10,
              background: isNodeLibraryOpen
                ? tk.libActiveBg
                : "transparent",
              border: `1px solid ${isNodeLibraryOpen ? tk.libActiveBorder : "transparent"}`,
              cursor: "pointer",
              transition: "all 180ms ease",
            }}
          >
            <Package
              size={15}
              style={{
                color: isNodeLibraryOpen
                  ? tk.libActiveText
                  : tk.libIconMuted,
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
                color: isNodeLibraryOpen
                  ? tk.libTextPrimary
                  : tk.libTextSecondary,
                fontFamily: "var(--font-dm-sans), sans-serif",
                letterSpacing: "0.2px",
                whiteSpace: "nowrap",
              }}
            >
              {t("canvas.nodeLibrary")}
            </span>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.5px",
                color: tk.libCountText,
                fontFamily: "var(--font-jetbrains), monospace",
                padding: "1px 5px",
                borderRadius: 4,
                background: tk.libCountBg,
                border: `1px solid ${tk.libCountBorder}`,
                flexShrink: 0,
              }}
            >
              {NODE_CATALOGUE.length}
            </span>
            <ChevronRight
              size={13}
              style={{
                color: tk.libIconChevron,
                transform: isNodeLibraryOpen
                  ? "rotate(90deg)"
                  : "rotate(0deg)",
                transition: "transform 200ms ease",
                flexShrink: 0,
              }}
            />
          </button>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────── */}
      {showContent && (
        <div
          style={{
            marginTop: alwaysOpen ? 0 : 6,
            display: "flex",
            flexDirection: "column",
            flex: alwaysOpen ? 1 : "none",
            minHeight: 0,
          }}
        >
          {/* ── Search ────────────────────────────────────────────── */}
          <div
            style={{
              padding: 12,
              borderBottom: `1px solid ${tk.line1}`,
              flexShrink: 0,
            }}
          >
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: tk.text3,
                  pointerEvents: "none",
                }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("canvas.searchNodes")}
                onFocus={() => setFocusedSearch(true)}
                onBlur={() => setFocusedSearch(false)}
                style={{
                  width: "100%",
                  background: tk.libSearchBg,
                  border: `1px solid ${focusedSearch ? tk.lineFocus : tk.line1}`,
                  borderRadius: 8,
                  padding: "10px 36px 10px 36px",
                  fontFamily: "Geist, sans-serif",
                  fontSize: 13,
                  color: tk.text1,
                  outline: "none",
                  boxSizing: "border-box" as const,
                  transition:
                    "border-color 150ms ease, box-shadow 150ms ease",
                  boxShadow: focusedSearch
                    ? `0 0 0 3px ${isLight ? "rgba(37,99,235,0.10)" : "rgba(0,245,255,0.10)"}`
                    : "none",
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: tk.text3,
                    padding: 2,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* ── Tab pills ─────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 4,
              padding: "10px 12px 10px",
              borderBottom: `1px solid ${tk.line1}`,
              flexShrink: 0,
            }}
          >
            {FILTER_TABS.map((tab) => {
              const active = activeFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveFilter(tab.value)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 6,
                    background: active
                      ? tk.libTabActiveBg
                      : "transparent",
                    border: `1px solid ${active ? tk.libTabActiveBorder : "transparent"}`,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    fontWeight: 600,
                    color: active ? tk.libTabActiveText : tk.text3,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase" as const,
                    cursor: "pointer",
                    transition: "background 120ms",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── Scrollable list ────────────────────────────────────── */}
          <div
            style={{
              flex: 1,
              overflowY: "auto" as const,
              padding: 8,
              minHeight: 0,
            }}
          >
            {/* Count indicator */}
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: tk.text3,
                padding: "6px 10px",
                textTransform: "uppercase" as const,
                letterSpacing: "0.06em",
              }}
            >
              {displayNodes.length} {t("canvas.nodes")}{" "}
              {showSections ? t("canvas.total") : t("canvas.shown")}
            </div>

            {/* Content */}
            {displayNodes.length === 0 ? (
              /* ── Empty state ────────────────────────────────────── */
              <div
                style={{
                  padding: "40px 20px",
                  textAlign: "center" as const,
                  color: tk.text3,
                }}
              >
                <div style={{ marginBottom: 12 }}>
                  <Search size={32} style={{ opacity: 0.4 }} />
                </div>
                <div
                  style={{
                    fontFamily: "Geist, sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    color: tk.text2,
                    marginBottom: 4,
                  }}
                >
                  No nodes found
                </div>
                <div
                  style={{
                    fontFamily: "Geist, sans-serif",
                    fontSize: 11,
                    color: tk.text3,
                  }}
                >
                  Try different keywords or check filters
                </div>
              </div>
            ) : showSections ? (
              /* ── Grouped by category ─────────────────────────────── */
              SECTION_LABELS.map(([cat, label]) => {
                const catNodes = displayNodes.filter(
                  (n) => n.category === cat,
                );
                if (catNodes.length === 0) return null;
                return (
                  <React.Fragment key={cat}>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10,
                        fontWeight: 700,
                        color: tk.text3,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase" as const,
                        padding: "10px 10px 6px",
                      }}
                    >
                      {label}
                    </div>
                    {catNodes.map((node) => (
                      <NodeRow
                        key={node.id}
                        node={node}
                        onDragStart={handleDragStart}
                      />
                    ))}
                  </React.Fragment>
                );
              })
            ) : (
              /* ── Flat list ───────────────────────────────────────── */
              displayNodes.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  onDragStart={handleDragStart}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
