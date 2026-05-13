"use client";

import { memo } from "react";
import { Sun, Moon } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";

/**
 * Phase Z.CANVAS.1A — Canvas theme toggle button.
 * Supports both floating (bottom-left, default) and inline (toolbar) modes.
 * Scoped to canvas page only.
 */
export const ThemeToggle = memo(function ThemeToggle({ inline = false }: { inline?: boolean }) {
  const theme = useCanvasTheme((s) => s.theme);
  const tk = useCanvasToken();
  const toggleTheme = useCanvasTheme((s) => s.toggleTheme);
  const prefersReduced = useReducedMotion();

  const isLight = theme === "light";
  const Icon = isLight ? Sun : Moon;
  const label = isLight ? "Switch to dark theme" : "Switch to light theme";

  const btn = (
    <button
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      style={{
        width: inline ? 44 : 36,
        height: inline ? 44 : 36,
        borderRadius: inline ? 8 : 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        border: inline ? "none" : `1px solid ${tk.line2}`,
        background: "transparent",
        color: tk.text2,
        boxShadow: inline ? "none" : tk.shadowSm,
        transition: prefersReduced
          ? "none"
          : inline
            ? "background 150ms ease"
            : "background 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease",
      }}
      onMouseEnter={(e) => {
        if (inline) {
          e.currentTarget.style.background = tk.hoverBg;
        } else {
          e.currentTarget.style.transform = "scale(1.06)";
          e.currentTarget.style.boxShadow = tk.shadowMd;
        }
      }}
      onMouseLeave={(e) => {
        if (inline) {
          e.currentTarget.style.background = "transparent";
        } else {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = tk.shadowSm;
        }
      }}
    >
      <Icon size={inline ? 14 : 16} strokeWidth={2} />
    </button>
  );

  if (inline) return btn;

  return (
    <div className={`canvas-theme-${theme}`} style={{ position: "absolute", bottom: 16, left: 16, zIndex: 20 }}>
      {btn}
    </div>
  );
});
