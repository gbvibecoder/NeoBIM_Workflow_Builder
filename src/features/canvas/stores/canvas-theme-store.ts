import { create } from "zustand";

// ─── Canvas Theme Store ──────────────────────────────────────────────
// Phase Z.CANVAS.1A — dual-theme infrastructure for the canvas page.
// Scoped to /dashboard/canvas ONLY. Does not affect any other page.

export type CanvasTheme = "light" | "dark";

const STORAGE_KEY = "bf:canvas:theme";

/** SSR-safe read from localStorage. Falls back to "light". */
function readStoredTheme(): CanvasTheme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

interface CanvasThemeState {
  theme: CanvasTheme;
  setTheme: (theme: CanvasTheme) => void;
  toggleTheme: () => void;
}

export const useCanvasTheme = create<CanvasThemeState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, theme);
    }
    set({ theme });
  },
  toggleTheme: () => {
    set((state) => {
      const next: CanvasTheme = state.theme === "light" ? "dark" : "light";
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, next);
      }
      return { theme: next };
    });
  },
}));
