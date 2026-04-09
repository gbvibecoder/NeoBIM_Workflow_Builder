/* ─── IFC Viewer Constants ────────────────────────────────────────────────── */

/* Category colors for "color by category" mode */
export const CATEGORY_COLORS: Record<string, string> = {
  IFCWALL: "#7CB9E8",
  IFCWALLSTANDARDCASE: "#7CB9E8",
  IFCSLAB: "#8B8B8B",
  IFCWINDOW: "#00CED1",
  IFCDOOR: "#CD853F",
  IFCCOLUMN: "#B8860B",
  IFCBEAM: "#DAA520",
  IFCSTAIR: "#9370DB",
  IFCSTAIRFLIGHT: "#9370DB",
  IFCRAILING: "#A0A0A0",
  IFCROOF: "#CD5C5C",
  IFCFOOTING: "#808080",
  IFCMEMBER: "#D2B48C",
  IFCPLATE: "#C0C0C0",
  IFCCURTAINWALL: "#87CEEB",
  IFCCOVERING: "#DEB887",
  IFCFURNISHINGELEMENT: "#8FBC8F",
  IFCFLOWSEGMENT: "#4682B4",
  IFCFLOWTERMINAL: "#5F9EA0",
  IFCFLOWFITTING: "#6495ED",
  IFCBUILDINGELEMENTPROXY: "#BC8F8F",
  IFCSPACE: "#FFD70040",
};

/* Storey color palette (cycles through for multi-storey buildings) */
export const STOREY_COLORS = [
  "#4FC3F7",
  "#81C784",
  "#FFB74D",
  "#BA68C8",
  "#FF8A65",
  "#4DD0E1",
  "#AED581",
  "#F06292",
  "#FFD54F",
  "#7986CB",
];

/* UI styling constants matching the app design system */
export const UI = {
  bg: {
    base: "#07070D",
    canvas: "#0B0B13",
    card: "#12121E",
    elevated: "#1A1A2A",
    hover: "#1F1F32",
    toolbar: "rgba(18,18,30,0.92)",
  },
  text: {
    primary: "#F0F0F5",
    secondary: "#9898B0",
    tertiary: "#5C5C78",
    disabled: "#3A3A50",
  },
  border: {
    subtle: "rgba(255,255,255,0.06)",
    default: "rgba(255,255,255,0.10)",
    focus: "rgba(79,138,255,0.4)",
  },
  accent: {
    cyan: "#00F5FF",
    copper: "#B87333",
    amber: "#FFBF00",
    blue: "#4F8AFF",
    green: "#34D399",
    red: "#F87171",
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 18,
  },
  shadow: {
    card: "0 4px 16px rgba(0,0,0,0.25)",
    panel: "0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px rgba(0,0,0,0.5)",
    glow: "0 0 0 1px rgba(79,138,255,0.3), 0 4px 20px rgba(79,138,255,0.25)",
  },
  transition: "all 0.15s ease",
} as const;

/* 3D scene defaults */
export const SCENE = {
  background: 0x0c0f18,
  backgroundTop: 0x12121e,
  backgroundBottom: 0x08080e,
  gridSize: 200,
  gridDivisions: 40,
  gridColor1: 0x2a2a4a,
  gridColor2: 0x1a1a3a,
  highlightColor: 0x4f8aff,
  highlightEmissive: 0x4466ff,
  selectionOpacity: 0.9,
  cameraNear: 0.1,
  cameraFar: 5000,
  cameraFov: 50,
  orbitDamping: 0.08,
  maxPixelRatio: 2,
} as const;

/* Keyboard shortcuts */
export const SHORTCUTS: Record<string, { key: string; label: string; description: string }> = {
  fitToView: { key: "f", label: "F", description: "Fit model to view" },
  fitToSelection: { key: "v", label: "V", description: "Fit to selection" },
  hideSelected: { key: "h", label: "H", description: "Hide selected" },
  isolateSelected: { key: "i", label: "I", description: "Isolate selected" },
  showAll: { key: "a", label: "A", description: "Show all elements" },
  toggleSection: { key: "s", label: "S", description: "Toggle section plane" },
  measure: { key: "m", label: "M", description: "Start measurement" },
  escape: { key: "Escape", label: "Esc", description: "Clear selection / Cancel" },
  wireframe: { key: "w", label: "W", description: "Toggle wireframe" },
  xray: { key: "x", label: "X", description: "Toggle X-ray mode" },
  screenshot: { key: "p", label: "P", description: "Take screenshot" },
  togglePanel: { key: "[", label: "[", description: "Toggle side panel" },
  help: { key: "?", label: "?", description: "Show shortcuts" },
};
