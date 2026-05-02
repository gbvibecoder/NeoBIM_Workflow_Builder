"use client";

import s from "./billing.module.css";

/**
 * Animated isometric cityscape SVG for the billing hero.
 * 4 buildings representing the 4 plan tiers, staggering in on load.
 * Pure CSS animation — no JS runtime. Decorative only.
 */
export function CityscapeHero() {
  return (
    <div className={s.cityscape} aria-hidden="true">
      <svg viewBox="0 0 1100 280" preserveAspectRatio="xMidYMax meet" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cityscapeGradAmber" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(184,118,45,0.18)" />
            <stop offset="100%" stopColor="rgba(184,118,45,0.04)" />
          </linearGradient>
          <linearGradient id="cityscapeGradSage" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(61,92,64,0.18)" />
            <stop offset="100%" stopColor="rgba(61,92,64,0.04)" />
          </linearGradient>
          <linearGradient id="cityscapeGradBlueprint" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(26,77,92,0.18)" />
            <stop offset="100%" stopColor="rgba(26,77,92,0.04)" />
          </linearGradient>
          <linearGradient id="cityscapeGradPlum" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(107,69,102,0.20)" />
            <stop offset="100%" stopColor="rgba(107,69,102,0.04)" />
          </linearGradient>
        </defs>

        {/* Ground line + measurement ticks */}
        <line x1="50" y1="270" x2="1050" y2="270" stroke="rgba(184,118,45,0.2)" strokeWidth="1" />
        {[150, 300, 500, 550, 700, 850].map(x => (
          <line key={x} x1={x} y1="266" x2={x} y2="274" stroke="rgba(184,118,45,0.15)" strokeWidth="0.8" />
        ))}

        {/* Building 1 — Mini: Small house */}
        <g className={s.buildingMini}>
          <rect x="120" y="210" width="80" height="60" rx="2" fill="url(#cityscapeGradAmber)" stroke="rgba(184,118,45,0.6)" strokeWidth="1.2" />
          <polygon points="115,210 160,180 205,210" fill="url(#cityscapeGradAmber)" stroke="rgba(184,118,45,0.6)" strokeWidth="1.2" />
          {/* Windows — warm amber */}
          <rect x="140" y="225" width="14" height="16" rx="1" fill="rgba(229,168,120,0.5)" stroke="rgba(184,118,45,0.3)" strokeWidth="0.5" />
          <rect x="165" y="225" width="14" height="16" rx="1" fill="rgba(229,168,120,0.45)" stroke="rgba(184,118,45,0.3)" strokeWidth="0.5" />
          {/* Door */}
          <rect x="150" y="250" width="14" height="20" rx="1.5" fill="rgba(229,168,120,0.35)" stroke="rgba(184,118,45,0.4)" strokeWidth="0.6" />
          {/* Dimension */}
          <line x1="115" y1="278" x2="205" y2="278" stroke="rgba(184,118,45,0.12)" strokeWidth="0.6" strokeDasharray="3,2" />
          <text x="160" y="278" textAnchor="middle" fontSize="7" fill="rgba(184,118,45,0.35)" fontFamily="monospace">12.0m</text>
        </g>

        {/* Building 2 — Starter: Townhouse */}
        <g className={s.buildingStarter}>
          <rect x="310" y="170" width="90" height="100" rx="2" fill="url(#cityscapeGradSage)" stroke="rgba(61,92,64,0.6)" strokeWidth="1.2" />
          <line x1="310" y1="200" x2="400" y2="200" stroke="rgba(61,92,64,0.15)" strokeWidth="0.5" />
          <line x1="310" y1="230" x2="400" y2="230" stroke="rgba(61,92,64,0.15)" strokeWidth="0.5" />
          {/* Windows — warm amber lit */}
          {[325, 350, 375].map(x => [178, 208, 238].map(y => (
            <rect key={`${x}-${y}`} x={x} y={y} width="10" height="12" rx="1" fill="rgba(229,168,120,0.4)" stroke="rgba(61,92,64,0.25)" strokeWidth="0.5" />
          )))}
          {/* Door */}
          <rect x="345" y="254" width="16" height="16" rx="1.5" fill="rgba(229,168,120,0.3)" stroke="rgba(61,92,64,0.35)" strokeWidth="0.6" />
          {/* Height line */}
          <line x1="408" y1="170" x2="408" y2="270" stroke="rgba(61,92,64,0.12)" strokeWidth="0.5" />
          <text x="416" y="220" fontSize="7" fill="rgba(61,92,64,0.35)" fontFamily="monospace" transform="rotate(-90,416,220)">24.0m</text>
        </g>

        {/* Building 3 — Pro: Mid-rise office */}
        <g className={s.buildingPro}>
          <rect x="520" y="110" width="110" height="160" rx="2" fill="url(#cityscapeGradBlueprint)" stroke="rgba(26,77,92,0.7)" strokeWidth="1.3" />
          {[140, 170, 200, 230, 250].map(y => (
            <line key={y} x1="520" y1={y} x2="630" y2={y} stroke="rgba(26,77,92,0.12)" strokeWidth="0.5" />
          ))}
          {/* Window grid — warm amber lit */}
          {[535, 555, 575, 595, 615].map(x => [118, 148, 178, 208, 238].map(y => (
            <rect key={`${x}-${y}`} x={x} y={y} width="8" height="10" rx="0.8" fill="rgba(229,168,120,0.55)" stroke="rgba(26,77,92,0.2)" strokeWidth="0.4" />
          )))}
          {/* Roof detail */}
          <rect x="555" y="104" width="30" height="8" rx="1" fill="rgba(26,77,92,0.08)" stroke="rgba(26,77,92,0.25)" strokeWidth="0.5" />
        </g>

        {/* Crane over Pro building */}
        <g className={s.crane} stroke="rgba(229,168,120,0.65)" strokeWidth="1.2" fill="none" strokeLinecap="round">
          <line x1="575" y1="50" x2="575" y2="110" />
          <line x1="530" y1="55" x2="620" y2="55" />
          <line x1="530" y1="55" x2="540" y2="75" />
          <line x1="610" y1="55" x2="610" y2="85" strokeDasharray="2,2" strokeWidth="0.6" />
          <rect x="607" y="83" width="6" height="5" rx="0.5" strokeWidth="0.5" />
        </g>

        {/* Building 4 — Team: Skyscraper */}
        <g className={s.buildingTeam}>
          <rect x="760" y="60" width="100" height="210" rx="2" fill="url(#cityscapeGradPlum)" stroke="rgba(107,69,102,0.7)" strokeWidth="1.3" />
          {[85, 110, 135, 160, 185, 210, 235, 250].map(y => (
            <line key={y} x1="760" y1={y} x2="860" y2={y} stroke="rgba(107,69,102,0.1)" strokeWidth="0.5" />
          ))}
          {/* Window grid — warm amber lit */}
          {[772, 790, 808, 826, 844].map(x => [68, 93, 118, 143, 168, 193, 218, 240, 256].map(y => (
            <rect key={`${x}-${y}`} x={x} y={y} width="7" height="9" rx="0.6" fill="rgba(229,168,120,0.5)" stroke="rgba(107,69,102,0.15)" strokeWidth="0.35" />
          )))}
          {/* Spire */}
          <line x1="810" y1="30" x2="810" y2="60" stroke="rgba(107,69,102,0.8)" strokeWidth="1.5" />
          <circle cx="810" cy="28" r="2.5" fill="rgba(229,168,120,0.9)" stroke="rgba(107,69,102,0.5)" strokeWidth="0.5" />
          {/* Height line */}
          <line x1="868" y1="30" x2="868" y2="270" stroke="rgba(107,69,102,0.1)" strokeWidth="0.5" />
          <text x="876" y="150" fontSize="7" fill="rgba(107,69,102,0.3)" fontFamily="monospace" transform="rotate(-90,876,150)">48.0m</text>
        </g>

        {/* Sun */}
        <circle cx="950" cy="60" r="20" fill="none" stroke="rgba(184,118,45,0.12)" strokeWidth="0.6" />
        <circle cx="950" cy="60" r="14" fill="none" stroke="rgba(184,118,45,0.08)" strokeWidth="0.4" />

        {/* Birds */}
        <g stroke="rgba(26,77,92,0.12)" strokeWidth="0.7" fill="none">
          <path d="M 470 70 Q 475 65 480 70 Q 485 65 490 70" />
          <path d="M 440 50 Q 444 46 448 50 Q 452 46 456 50" />
          <path d="M 680 45 Q 684 41 688 45 Q 692 41 696 45" />
        </g>
      </svg>
    </div>
  );
}
