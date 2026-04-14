// ─── BOQ Visualizer Design Tokens ────────────────────────────────────────────
// Light, warm, premium theme for the BOQ page.
// Inspired by Stripe Dashboard + Apple product pages.

export const boqTheme = {
  colors: {
    // Page
    background: "#FAFAF8",
    surface: "#FFFFFF",
    surfaceAlt: "#F5F5F3",
    surfaceHover: "#F0EFED",

    // Borders
    border: "rgba(0,0,0,0.06)",
    borderHover: "rgba(0,0,0,0.12)",
    borderStrong: "rgba(0,0,0,0.15)",

    // Text
    text: {
      primary: "#1A1A1A",
      secondary: "#4B5563",
      tertiary: "#9CA3AF",
      muted: "#D1D5DB",
    },

    // Accent
    accent: {
      primary: "#0D9488",    // teal-600
      hover: "#0F766E",      // teal-700
      light: "#CCFBF1",      // teal-100
      ultralight: "#F0FDFA", // teal-50
      text: "#115E59",       // teal-800
    },

    // Copper accent (for labour / secondary)
    copper: {
      primary: "#B45309",
      light: "#FEF3C7",
      text: "#92400E",
    },

    // Confidence colors
    confidence: {
      high:   { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0", dot: "#10B981" },
      medium: { bg: "#FFFBEB", text: "#D97706", border: "#FDE68A", dot: "#F59E0B" },
      low:    { bg: "#FEF2F2", text: "#DC2626", border: "#FECACA", dot: "#EF4444" },
    },

    // Chart palette (soft, warm)
    chart: {
      material: "#0D9488",  // teal
      labor: "#D97706",     // amber
      equipment: "#7C3AED", // violet
      structural: "#0D9488",
      finishes: "#D97706",
      mep: "#2563EB",
      foundation: "#7C3AED",
      external: "#059669",
    },

    // Status
    success: "#059669",
    warning: "#D97706",
    error: "#DC2626",
    info: "#2563EB",
  },

  shadows: {
    xs: "0 1px 2px rgba(0,0,0,0.03)",
    sm: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
    md: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
    lg: "0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -4px rgba(0,0,0,0.03)",
    xl: "0 20px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.03)",
  },

  radius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "20px",
    full: "9999px",
  },

  fonts: {
    heading: "var(--font-dm-serif, 'DM Serif Display', serif)",
    body: "var(--font-dm-sans, 'DM Sans', sans-serif)",
    mono: "var(--font-jetbrains, 'JetBrains Mono', monospace)",
  },
} as const;

// Shorthand helpers
export const t = boqTheme;
