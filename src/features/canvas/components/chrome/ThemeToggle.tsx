"use client";

import { memo } from "react";
import { Sun, Moon } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";

/**
 * Phase Z.CANVAS.1A — Canvas theme toggle button.
 * Fixed bottom-left corner, 16px inset, above ReactFlow controls.
 * Scoped to canvas page only.
 */
export const ThemeToggle = memo(function ThemeToggle() {
  const theme = useCanvasTheme((s) => s.theme);
  const toggleTheme = useCanvasTheme((s) => s.toggleTheme);
  const prefersReduced = useReducedMotion();

  const isLight = theme === "light";
  const Icon = isLight ? Sun : Moon;
  const label = isLight ? "Switch to dark theme" : "Switch to light theme";

  return (
    <div className={`canvas-theme-${theme}`} style={{ position: "absolute", bottom: 16, left: 16, zIndex: 20 }}>
      <button
        onClick={toggleTheme}
        aria-label={label}
        title={label}
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          border: "1px solid var(--canvas-line-2)",
          background: "var(--canvas-surface-1)",
          color: "var(--canvas-text-2)",
          boxShadow: "var(--canvas-shadow-sm)",
          transition: prefersReduced
            ? "none"
            : "background 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.06)";
          e.currentTarget.style.boxShadow = "var(--canvas-shadow-md)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "var(--canvas-shadow-sm)";
        }}
      >
        <Icon size={16} strokeWidth={2} />
      </button>
    </div>
  );
});
