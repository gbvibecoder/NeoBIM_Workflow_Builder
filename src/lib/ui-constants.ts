import type { NodeCategory } from "@/types/nodes";

// ─── Canonical category colors (canvas/node theme) ───────────────────────────
// Source of truth: CATEGORY_CONFIG in constants/node-catalogue.ts
// Use these for canvas nodes, artifacts, execution UI, and anywhere
// node categories are colour-coded.

export const CATEGORY_COLORS: Record<NodeCategory, string> = {
  input:     "#00F5FF",
  transform: "#B87333",
  generate:  "#FFBF00",
  export:    "#4FC3F7",
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Convert hex colour to comma-separated RGB string for use in rgba(). */
export function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

