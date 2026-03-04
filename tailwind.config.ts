import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Background hierarchy
        "bg-base": "#07070D",
        "bg-primary": "#07070D",
        "bg-canvas": "#0B0B13",
        "bg-secondary": "#0B0B13",
        "bg-card": "#12121E",
        "bg-elevated": "#1A1A2A",
        "bg-hover": "#1F1F32",

        // Border hierarchy
        "border-subtle": "rgba(255, 255, 255, 0.06)",
        "border-default": "rgba(255, 255, 255, 0.10)",
        "border-focus": "rgba(79, 138, 255, 0.4)",

        // Text hierarchy
        "text-primary": "#F0F0F5",
        "text-secondary": "#9898B0",
        "text-tertiary": "#5C5C78",
        "text-disabled": "#3A3A50",

        // Node category colors
        "node-input": "#3B82F6",
        "node-input-bg": "rgba(59, 130, 246, 0.06)",
        "node-input-glow": "rgba(59, 130, 246, 0.12)",
        "node-transform": "#8B5CF6",
        "node-transform-bg": "rgba(139, 92, 246, 0.06)",
        "node-transform-glow": "rgba(139, 92, 246, 0.12)",
        "node-generate": "#10B981",
        "node-generate-bg": "rgba(16, 185, 129, 0.06)",
        "node-generate-glow": "rgba(16, 185, 129, 0.12)",
        "node-export": "#F59E0B",
        "node-export-bg": "rgba(245, 158, 11, 0.06)",
        "node-export-glow": "rgba(245, 158, 11, 0.12)",

        // Status colors
        "status-idle": "#5C5C78",
        "status-running": "#3B82F6",
        "status-success": "#34D399",
        "status-error": "#F87171",
        "status-warning": "#FBBF24",

        // Accent
        "accent-primary": "#4F8AFF",
        "accent-hover": "#6B9FFF",
        "accent-glow": "rgba(79, 138, 255, 0.15)",
      },
      fontFamily: {
        display: ["var(--font-dm-sans)", "DM Sans", "sans-serif"],
        body: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "JetBrains Mono", "Fira Code", "monospace"],
      },
      backgroundImage: {
        "canvas-grid":
          "radial-gradient(circle, rgba(255, 255, 255, 0.04) 1px, transparent 1px)",
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      backgroundSize: {
        "canvas-grid": "24px 24px",
      },
      animation: {
        "pulse-node": "pulse-node 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "slide-up": "slide-up 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "data-flow": "data-flow 1.5s linear infinite",
        "spin-slow": "spin 3s linear infinite",
        shimmer: "shimmer 1.5s infinite",
      },
      keyframes: {
        "pulse-node": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.7", transform: "scale(1.02)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "data-flow": {
          "0%": { "stroke-dashoffset": "24" },
          "100%": { "stroke-dashoffset": "0" },
        },
        shimmer: {
          "0%": { "background-position": "-200% 0" },
          "100%": { "background-position": "200% 0" },
        },
      },
      boxShadow: {
        sm: "0 2px 8px rgba(0, 0, 0, 0.15)",
        md: "0 4px 24px rgba(0, 0, 0, 0.25)",
        lg: "0 16px 48px rgba(0, 0, 0, 0.35)",
        "node-idle":
          "0 4px 24px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.03)",
        "node-hover":
          "0 4px 24px rgba(0, 0, 0, 0.3), 0 0 24px rgba(79, 138, 255, 0.08)",
        "node-selected":
          "0 0 0 2px rgba(79, 138, 255, 0.15), 0 4px 24px rgba(0, 0, 0, 0.3)",
        "node-running": "0 0 20px rgba(59, 130, 246, 0.3)",
        "node-success": "0 0 20px rgba(52, 211, 153, 0.2)",
        "node-error": "0 0 20px rgba(248, 113, 113, 0.2)",
        panel:
          "0 0 0 1px rgba(255, 255, 255, 0.06), 0 20px 60px rgba(0, 0, 0, 0.5)",
        elevated:
          "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06)",
        glow: "0 0 0 1px rgba(79, 138, 255, 0.3), 0 4px 20px rgba(79, 138, 255, 0.25)",
        "glow-hover":
          "0 0 0 1px rgba(79, 138, 255, 0.5), 0 8px 30px rgba(79, 138, 255, 0.35)",
      },
      borderRadius: {
        node: "12px",
        card: "14px",
        panel: "14px",
      },
    },
  },
  plugins: [],
};

export default config;
