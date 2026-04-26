"use client";

interface NorthArrowProps {
  size?: number;
  color?: string;
  /** Background ring color (slim outer ring). */
  ringColor?: string;
}

/**
 * Compass rose with a single N pointer. Visually quoting the north arrows
 * architects place on every plan drawing. Used when a result page involves
 * a floor plan — pulled into the header so the page reads as "from a
 * drawing-set."
 */
export function NorthArrow({ size = 28, color = "#0D9488", ringColor = "rgba(13,148,136,0.20)" }: NorthArrowProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx={16} cy={16} r={14.5} fill="#FFFFFF" stroke={ringColor} strokeWidth={1} />
      {/* N pointer (filled triangle north of center) */}
      <polygon points="16,4 19.5,16 16,13 12.5,16" fill={color} />
      {/* S pointer (line, lower-key) */}
      <polygon points="16,28 13,17 16,19 19,17" fill={`${color}55`} />
      {/* Tick marks at E/W */}
      <line x1={2.5} y1={16} x2={5.5} y2={16} stroke={color} strokeWidth={0.8} opacity={0.5} />
      <line x1={26.5} y1={16} x2={29.5} y2={16} stroke={color} strokeWidth={0.8} opacity={0.5} />
      {/* N letter */}
      <text
        x={16}
        y={9.5}
        fontFamily="var(--font-jetbrains), ui-monospace, monospace"
        fontSize="6"
        fontWeight="700"
        textAnchor="middle"
        fill="#FFFFFF"
      >
        N
      </text>
    </svg>
  );
}
