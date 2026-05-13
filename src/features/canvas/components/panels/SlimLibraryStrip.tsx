"use client";

/**
 * SlimLibraryStrip — Z.CANVAS.SLIM-LIBRARY
 * 56px wide vertical icon strip on right edge of canvas.
 * Categories: Search, Input, AI/Transform, Generate, Export, All.
 * Search button dispatches Cmd+K to open existing QuickSearch palette.
 * Other buttons toggle the SlimLibraryDrawer via UI store.
 */

import { memo, useCallback } from "react";
import {
  Search,
  Type,
  Sparkles,
  Box,
  Download,
  LayoutGrid,
} from "lucide-react";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import {
  useUIStore,
  selectSlimDrawerOpen,
  selectSlimDrawerCategory,
  selectToggleSlimDrawer,
} from "@/shared/stores/ui-store";
import type { SlimCategory } from "@/shared/stores/ui-store";

// ─── Strip button ──────────────────────────────────────────────────────────

interface StripBtnProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  activeColor: string;
  activeBg: string;
  onClick: () => void;
}

function StripBtn({ icon, label, active, activeColor, activeBg, onClick }: StripBtnProps) {
  const tk = useCanvasToken();
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        border: "none",
        background: active ? activeBg : "transparent",
        color: active ? activeColor : tk.text2,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        position: "relative",
        transition: "background 120ms ease, color 120ms ease",
        padding: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = tk.slimBtnHover;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 7,
          letterSpacing: "0.10em",
          marginTop: 2,
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    </button>
  );
}

// ─── Strip ──────────────────────────────────────────────────────────────────

export const SlimLibraryStrip = memo(function SlimLibraryStrip() {
  const tk = useCanvasToken();
  const open = useUIStore(selectSlimDrawerOpen);
  const category = useUIStore(selectSlimDrawerCategory);
  const toggle = useUIStore(selectToggleSlimDrawer);

  const handleCategory = useCallback(
    (cat: SlimCategory) => toggle(cat),
    [toggle]
  );

  // Dispatch synthetic Cmd+K to trigger existing QuickSearch keyboard listener
  const handleSearch = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    );
  }, []);

  const isActive = (cat: SlimCategory) => open && category === cat;

  const divider = (
    <div style={{ width: "70%", height: 1, background: tk.slimDividerBg, margin: "6px auto" }} />
  );

  return (
    <div
      data-slim-strip
      style={{
        position: "absolute",
        top: 80,
        right: 16,
        bottom: 16,
        width: 56,
        background: tk.slimStripBg,
        border: `1px solid ${tk.slimStripBorder}`,
        borderRadius: 14,
        boxShadow: tk.shadowSm,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: 8,
        gap: 4,
        zIndex: 9,
      }}
    >
      {/* Search — opens Cmd+K palette */}
      <StripBtn
        icon={<Search size={16} />}
        label="FIND"
        active={false}
        activeColor={tk.catInput}
        activeBg={tk.catInputSoft}
        onClick={handleSearch}
      />

      {divider}

      {/* INPUT */}
      <StripBtn
        icon={<Type size={16} />}
        label="IN"
        active={isActive("input")}
        activeColor={tk.catInput}
        activeBg={tk.catInputSoft}
        onClick={() => handleCategory("input")}
      />

      {/* TRANSFORM / AI */}
      <StripBtn
        icon={<Sparkles size={16} />}
        label="AI"
        active={isActive("transform")}
        activeColor={tk.catTransform}
        activeBg={tk.catTransformSoft}
        onClick={() => handleCategory("transform")}
      />

      {/* GENERATE */}
      <StripBtn
        icon={<Box size={16} />}
        label="GEN"
        active={isActive("generate")}
        activeColor={tk.catGenerate}
        activeBg={tk.catGenerateSoft}
        onClick={() => handleCategory("generate")}
      />

      {/* EXPORT */}
      <StripBtn
        icon={<Download size={16} />}
        label="OUT"
        active={isActive("export")}
        activeColor={tk.catExport}
        activeBg={tk.catExportSoft}
        onClick={() => handleCategory("export")}
      />

      {/* Spacer */}
      <div style={{ flex: 1, minHeight: 8 }} />

      {divider}

      {/* ALL */}
      <StripBtn
        icon={<LayoutGrid size={16} />}
        label="ALL"
        active={isActive("all")}
        activeColor={tk.text1}
        activeBg={tk.surface2}
        onClick={() => handleCategory("all")}
      />
    </div>
  );
});
