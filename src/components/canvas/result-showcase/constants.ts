// ─── Design Tokens ──────────────────────────────────────────────────────────

export const COLORS = {
  CYAN: "#00F5FF",
  COPPER: "#B87333",
  AMBER: "#FFBF00",
  EMERALD: "#10B981",
  VIOLET: "#8B5CF6",
  RED: "#EF4444",
  TEXT_PRIMARY: "#F0F0F5",
  TEXT_SECONDARY: "#8888A0",
  TEXT_MUTED: "#5C5C78",
  BG_BASE: "#070809",
  GLASS_BG: "rgba(255,255,255,0.03)",
  GLASS_BORDER: "rgba(255,255,255,0.06)",
} as const;

// ─── Tab Definitions ────────────────────────────────────────────────────────

export type TabId = "overview" | "media" | "data" | "model" | "export";

export interface TabDef {
  id: TabId;
  label: string;
  icon: string; // lucide icon name for reference
}

export const TAB_DEFS: TabDef[] = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard" },
  { id: "media", label: "Media", icon: "Film" },
  { id: "data", label: "Data & Analysis", icon: "BarChart3" },
  { id: "model", label: "3D Model", icon: "Box" },
  { id: "export", label: "Export", icon: "Download" },
];

// ─── Category Colors (mirrors ui-constants for local use) ───────────────────

export const CATEGORY_COLORS: Record<string, string> = {
  input: "#00F5FF",
  transform: "#B87333",
  generate: "#FFBF00",
  export: "#4FC3F7",
};
