import { create } from "zustand";

// ─── Canvas Theme Store ──────────────────────────────────────────────
// Phase Z.CANVAS.1A — dual-theme infrastructure for the canvas page.
// Scoped to /dashboard/canvas ONLY. Does not affect any other page.
//
// Z.CANVAS.RESCUE — toggle theme class on <html> element so all
// descendants inherit CSS custom properties defined in canvas-theme.css.
// The display:contents wrapper pattern from 1B-i-FIX was not reliably
// propagating custom properties to inline style var() references across
// the Tailwind v4 + Lightning CSS build chain. Applying the class to
// document.documentElement guarantees universal inheritance regardless
// of portals, React Flow viewport transforms, or display:contents.
//
// Safety: var(--canvas-*) tokens are ONLY consumed by canvas components
// (verified via grep). Non-canvas pages are unaffected.

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

/** Apply canvas theme to <html> — both class (for CSS selectors) and data attribute (for FOUC script). */
function applyThemeToDocument(theme: CanvasTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("canvas-theme-light", theme === "light");
  document.documentElement.classList.toggle("canvas-theme-dark", theme === "dark");
  document.documentElement.setAttribute("data-canvas-theme", theme);
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
    applyThemeToDocument(theme);
    set({ theme });
  },
  toggleTheme: () => {
    set((state) => {
      const next: CanvasTheme = state.theme === "light" ? "dark" : "light";
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, next);
      }
      applyThemeToDocument(next);
      return { theme: next };
    });
  },
}));

// ─── Apply theme to <html> on initial store creation (client-side) ──
if (typeof window !== "undefined") {
  const initial = readStoredTheme();
  applyThemeToDocument(initial);

  // Also subscribe to future changes (redundant with setTheme/toggleTheme
  // calls, but acts as safety net for any external state mutations)
  useCanvasTheme.subscribe((state) => {
    applyThemeToDocument(state.theme);
  });
}
