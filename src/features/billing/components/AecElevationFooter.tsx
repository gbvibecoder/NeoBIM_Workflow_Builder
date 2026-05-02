"use client";

import s from "./billing.module.css";

/**
 * Architectural elevation drawing for the AEC footer section.
 * Shows all 4 plan tiers as a continuous elevation with
 * measurement lines and labels. Pure SVG, decorative only.
 */
export function AecElevationFooter() {
  return (
    <div className={s.elevation} aria-hidden="true">
      <svg viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax meet" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Ground line */}
        <line x1="40" y1="170" x2="1160" y2="170" stroke="rgba(14,18,24,0.2)" strokeWidth="1.2" />

        {/* Measurement ticks */}
        {[100, 200, 400, 600, 800, 1000, 1100].map(x => (
          <line key={x} x1={x} y1="166" x2={x} y2="174" stroke="rgba(14,18,24,0.15)" strokeWidth="0.8" />
        ))}

        {/* Tree left */}
        <line x1="55" y1="140" x2="55" y2="170" stroke="rgba(61,92,64,0.5)" strokeWidth="1" />
        <ellipse cx="55" cy="132" rx="12" ry="14" fill="rgba(61,92,64,0.15)" stroke="rgba(61,92,64,0.5)" strokeWidth="0.6" />

        {/* Mini — small house elevation */}
        <g>
          <rect x="100" y="130" width="120" height="40" rx="1" fill="rgba(184,118,45,0.12)" stroke="rgba(184,118,45,0.7)" strokeWidth="1.2" />
          <polygon points="95,130 160,100 225,130" fill="rgba(184,118,45,0.1)" stroke="rgba(184,118,45,0.7)" strokeWidth="1.2" />
          <rect x="135" y="140" width="14" height="16" rx="1" fill="rgba(229,168,120,0.5)" stroke="rgba(184,118,45,0.35)" strokeWidth="0.5" />
          <rect x="160" y="140" width="14" height="16" rx="1" fill="rgba(229,168,120,0.45)" stroke="rgba(184,118,45,0.35)" strokeWidth="0.5" />
          <rect x="145" y="152" width="12" height="18" rx="1" fill="rgba(229,168,120,0.35)" stroke="rgba(184,118,45,0.4)" strokeWidth="0.5" />
          {/* Height dim */}
          <line x1="85" y1="100" x2="85" y2="170" stroke="rgba(184,118,45,0.1)" strokeWidth="0.4" />
          <text x="160" y="192" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="rgba(14,18,24,0.45)" letterSpacing="0.18em" fontWeight="500">MINI · ₹99</text>
        </g>

        {/* Starter — townhouse elevation */}
        <g>
          <rect x="310" y="100" width="130" height="70" rx="1" fill="rgba(61,92,64,0.12)" stroke="rgba(61,92,64,0.7)" strokeWidth="1.2" />
          <line x1="310" y1="130" x2="440" y2="130" stroke="rgba(61,92,64,0.15)" strokeWidth="0.5" />
          {[325, 350, 375, 400, 420].map(x => [108, 138].map(y => (
            <rect key={`s-${x}-${y}`} x={x} y={y} width="8" height="10" rx="0.5" fill="rgba(229,168,120,0.4)" stroke="rgba(61,92,64,0.25)" strokeWidth="0.4" />
          )))}
          <rect x="365" y="152" width="14" height="18" rx="1" fill="rgba(229,168,120,0.3)" stroke="rgba(61,92,64,0.35)" strokeWidth="0.5" />
          <text x="375" y="192" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="rgba(14,18,24,0.45)" letterSpacing="0.18em" fontWeight="500">STARTER · ₹799</text>
        </g>

        {/* Pro — mid-rise elevation */}
        <g>
          <rect x="540" y="60" width="150" height="110" rx="1" fill="rgba(26,77,92,0.13)" stroke="rgba(26,77,92,0.75)" strokeWidth="1.3" />
          {[85, 110, 135].map(y => (
            <line key={y} x1="540" y1={y} x2="690" y2={y} stroke="rgba(26,77,92,0.12)" strokeWidth="0.5" />
          ))}
          {[555, 575, 595, 615, 635, 655, 675].map(x => [68, 93, 118, 143].map(y => (
            <rect key={`p-${x}-${y}`} x={x} y={y} width="7" height="9" rx="0.5" fill="rgba(229,168,120,0.55)" stroke="rgba(26,77,92,0.2)" strokeWidth="0.3" />
          )))}
          <text x="615" y="192" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="rgba(14,18,24,0.45)" letterSpacing="0.18em" fontWeight="500">PRO · ₹1,999</text>
        </g>

        {/* Team — tower elevation */}
        <g>
          <rect x="790" y="30" width="150" height="140" rx="1" fill="rgba(107,69,102,0.13)" stroke="rgba(107,69,102,0.75)" strokeWidth="1.3" />
          {[55, 80, 105, 130, 148].map(y => (
            <line key={y} x1="790" y1={y} x2="940" y2={y} stroke="rgba(107,69,102,0.1)" strokeWidth="0.4" />
          ))}
          {[805, 825, 845, 865, 885, 905, 925].map(x => [38, 60, 85, 110, 135, 152].map(y => (
            <rect key={`t-${x}-${y}`} x={x} y={y} width="6" height="8" rx="0.4" fill="rgba(229,168,120,0.5)" stroke="rgba(107,69,102,0.15)" strokeWidth="0.25" />
          )))}
          {/* Spire + light bulb */}
          <line x1="865" y1="12" x2="865" y2="30" stroke="rgba(107,69,102,0.8)" strokeWidth="1.5" />
          <circle cx="865" cy="10" r="2.5" fill="rgba(229,168,120,0.9)" stroke="rgba(107,69,102,0.5)" strokeWidth="0.5" />
          <text x="865" y="192" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="rgba(14,18,24,0.45)" letterSpacing="0.18em" fontWeight="500">TEAM · ₹4,999</text>
        </g>

        {/* Tree right */}
        <line x1="1020" y1="145" x2="1020" y2="170" stroke="rgba(61,92,64,0.5)" strokeWidth="1" />
        <ellipse cx="1020" cy="138" rx="10" ry="12" fill="rgba(61,92,64,0.15)" stroke="rgba(61,92,64,0.5)" strokeWidth="0.6" />

        {/* Overall dimension line */}
        <line x1="80" y1="207" x2="960" y2="207" stroke="rgba(14,18,24,0.08)" strokeWidth="0.5" />
        <line x1="80" y1="204" x2="80" y2="210" stroke="rgba(14,18,24,0.12)" strokeWidth="0.5" />
        <line x1="960" y1="204" x2="960" y2="210" stroke="rgba(14,18,24,0.12)" strokeWidth="0.5" />
      </svg>
    </div>
  );
}
