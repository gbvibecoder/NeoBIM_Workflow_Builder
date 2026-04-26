"use client";

interface SectionIndexProps {
  /** Section number — rendered as `01 ·`, `02 ·` etc. */
  index: number;
  /** Visual variant. Default = inline; vertical = small left-rail label. */
  variant?: "inline" | "vertical";
  /** Accent color */
  color?: string;
}

/**
 * Small numbered marker that mirrors how a set of construction drawings
 * is paginated. Rendered in monospace with a leading zero.
 *
 * Used next to every section header on the result page.
 */
export function SectionIndex({ index, variant = "inline", color = "#94A3B8" }: SectionIndexProps) {
  const padded = String(index).padStart(2, "0");
  if (variant === "vertical") {
    return (
      <span
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontSize: 11,
          fontWeight: 500,
          color,
          letterSpacing: "0.10em",
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
        }}
      >
        {padded} · SECTION
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
        fontSize: 12,
        fontWeight: 500,
        color,
        letterSpacing: "0.08em",
      }}
    >
      <span style={{ color }}>{padded}</span>
      <span style={{ color: `${color}aa` }}>·</span>
    </span>
  );
}
