/* ─── IFC Viewer Constants — Phase Z.IFC.1 Light Render Studio ─────────────
   Rewritten 2026-05-18. The UI object now binds to render-studio-tokens
   (`var(--rs-*)`) so the viewer chrome aligns with the dashboard /
   billing / settings light surfaces. The 3D scene background stays as
   a literal hex (Three.js can't read CSS variables).                    */

/* Category colors for "color by category" mode — preserved as-is, the
   viewport engine reads these literally. */
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

/* UI styling constants — Light Render Studio palette.
   All values are CSS `var(--rs-*)` references so theme tweaks propagate
   from `src/features/dashboard/components/render-studio-tokens.css`. */
export const UI = {
  bg: {
    page: "var(--rs-bone)",          // outer page background
    paper: "var(--rs-paper)",        // panel surfaces / toolbar
    cream: "var(--rs-cream)",        // inset surfaces (search input, segmented track)
    trace: "var(--rs-trace)",        // slight warm variant of paper for sidebar
    canvas: "var(--rs-paper)",       // viewport stays light
    base: "var(--rs-bone)",          // back-compat alias (kept so legacy imports compile)
    card: "var(--rs-paper)",         // back-compat alias for cards
    elevated: "var(--rs-paper)",     // back-compat alias for dropdowns / popovers
    hover: "var(--rs-cream)",        // back-compat alias for hover states
    toolbar: "var(--rs-paper)",      // back-compat alias for toolbar
  },
  text: {
    primary: "var(--rs-ink)",
    soft: "var(--rs-ink-soft)",
    secondary: "var(--rs-text)",
    tertiary: "var(--rs-text-mute)",
    faint: "var(--rs-text-faint)",
    disabled: "var(--rs-text-faint)",
  },
  border: {
    subtle: "var(--rs-rule)",
    default: "var(--rs-rule-strong)",
    strong: "var(--rs-rule-stronger)",
    focus: "rgba(26,77,92,0.4)",
  },
  accent: {
    blueprint: "var(--rs-blueprint)",
    blueprint2: "var(--rs-blueprint-2)",
    blueprintSoft: "var(--rs-blueprint-soft)",
    blueprintLine: "var(--rs-blueprint-line)",
    burnt: "var(--rs-burnt)",
    burntSoft: "var(--rs-burnt-soft)",
    sage: "var(--rs-sage)",
    sageSoft: "var(--rs-sage-soft)",
    ember: "var(--rs-ember)",
    amber: "var(--rs-amber-mark)",
    amberSoft: "var(--rs-amber-soft)",
    red: "var(--rs-status-error)",
    redSoft: "var(--rs-status-error-soft)",
    /* Back-compat aliases — primary "blue" reads as blueprint teal, "cyan"
       reads as blueprint-2 (lighter teal). Legacy callers compile unchanged. */
    blue: "var(--rs-blueprint)",
    cyan: "var(--rs-blueprint-2)",
    green: "var(--rs-sage)",
    copper: "var(--rs-burnt)",
  },
  radius: {
    sm: 5,
    md: 6,
    lg: 8,
    xl: 10,
  },
  shadow: {
    card: "0 2px 4px rgba(14,18,24,0.05), 0 8px 24px rgba(14,18,24,0.08)",
    paper: "0 1px 2px rgba(14,18,24,0.04), 0 4px 12px rgba(14,18,24,0.06)",
    floating:
      "0 4px 16px rgba(14,18,24,0.08), 0 24px 64px rgba(14,18,24,0.12)",
    /* Back-compat alias — `panel` was used for dropdown menus + the side
       panel shadow. Maps to `floating`. `glow` is now a paper-toned focus
       ring instead of a blue-cyan halo. */
    panel:
      "0 4px 16px rgba(14,18,24,0.08), 0 24px 64px rgba(14,18,24,0.12)",
    glow:
      "0 0 0 1px rgba(26,77,92,0.25), 0 4px 16px rgba(26,77,92,0.18)",
  },
  transition: "all 150ms ease",
  font: {
    display: 'Fraunces, Georgia, serif',
    body: 'Geist, -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
  },
} as const;

/* 3D scene defaults — viewport engine reads these literally so they stay
   as raw hex / numbers (no CSS variable indirection possible here). The
   background is the off-white "vellum" feel.                            */
export const SCENE = {
  background: 0xf6f4ee,         // matches --rs-bone
  backgroundTop: 0xfbf9f4,      // matches --rs-trace
  backgroundBottom: 0xf6f4ee,
  gridSize: 200,
  gridDivisions: 40,
  gridColor1: 0xb8b8c2,         // soft mid-grey grid major
  gridColor2: 0xd8d8e0,         // fainter minor lines
  highlightColor: 0x1a4d5c,     // blueprint teal selection halo
  highlightEmissive: 0x1a4d5c,
  selectionOpacity: 0.9,
  cameraNear: 0.1,
  cameraFar: 5000,
  cameraFov: 50,
  orbitDamping: 0.08,
  maxPixelRatio: 2,
} as const;

/* Keyboard shortcuts — preserved verbatim. */
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
