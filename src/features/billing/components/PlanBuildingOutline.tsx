"use client";

import s from "./billing.module.css";

export type PlanTier = "mini" | "starter" | "pro" | "team";

/**
 * Faint building outline SVG rendered in the bottom-right corner
 * of each plan card. 4 variants matching the tier's building type.
 * Uses currentColor so it inherits the plan card's --accent via CSS.
 */
export function PlanBuildingOutline({ tier }: { tier: PlanTier }) {
  const common = { className: s.planBuilding, "aria-hidden": true as const };

  switch (tier) {
    case "mini":
      return (
        <svg {...common} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Small house */}
          <rect x="15" y="40" width="50" height="38" rx="1" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.6" />
          <polygon points="10,40 40,18 70,40" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.6" fill="none" />
          <rect x="30" y="52" width="12" height="14" rx="1" stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.4" fill="none" />
          <rect x="48" y="54" width="8" height="8" rx="0.5" stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.4" fill="none" />
        </svg>
      );

    case "starter":
      return (
        <svg {...common} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Townhouse */}
          <rect x="12" y="22" width="56" height="56" rx="1" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.6" />
          <line x1="12" y1="42" x2="68" y2="42" stroke="currentColor" strokeOpacity="0.05" strokeWidth="0.4" />
          <line x1="12" y1="58" x2="68" y2="58" stroke="currentColor" strokeOpacity="0.05" strokeWidth="0.4" />
          {[22, 38, 54].map(x => [28, 48, 64].map(y => (
            <rect key={`${x}-${y}`} x={x} y={y} width="7" height="8" rx="0.5" stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.35" fill="none" />
          )))}
        </svg>
      );

    case "pro":
      return (
        <svg {...common} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Mid-rise office */}
          <rect x="10" y="10" width="60" height="68" rx="1" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.6" />
          {[24, 38, 52, 62].map(y => (
            <line key={y} x1="10" y1={y} x2="70" y2={y} stroke="currentColor" strokeOpacity="0.04" strokeWidth="0.4" />
          ))}
          {[18, 32, 46, 58].map(x => [14, 28, 42, 56, 66].map(y => (
            <rect key={`${x}-${y}`} x={x} y={y} width="6" height="7" rx="0.4" stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.3" fill="none" />
          )))}
          <rect x="30" y="4" width="18" height="8" rx="0.5" stroke="currentColor" strokeOpacity="0.05" strokeWidth="0.3" fill="none" />
        </svg>
      );

    case "team":
      return (
        <svg {...common} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Skyscraper */}
          <rect x="14" y="5" width="52" height="73" rx="1" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.6" />
          {[16, 27, 38, 49, 56, 65].map(y => (
            <line key={y} x1="14" y1={y} x2="66" y2={y} stroke="currentColor" strokeOpacity="0.04" strokeWidth="0.35" />
          ))}
          {[22, 34, 46, 56].map(x => [9, 20, 31, 42, 53, 60, 69].map(y => (
            <rect key={`${x}-${y}`} x={x} y={y} width="5" height="6" rx="0.3" stroke="currentColor" strokeOpacity="0.05" strokeWidth="0.25" fill="none" />
          )))}
          <line x1="40" y1="0" x2="40" y2="5" stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.4" />
        </svg>
      );
  }
}
