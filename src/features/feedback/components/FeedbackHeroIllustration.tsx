"use client";

import { motion } from "framer-motion";

/**
 * Light-themed isometric building illustration for the feedback hero.
 * Three buildings (blueprint tower, burnt mid-rise, sage small),
 * crane, floating dots, dimension annotation.
 */
export function FeedbackHeroIllustration() {
  return (
    <svg viewBox="0 0 400 320" fill="none" style={{ width: "100%", height: "100%", opacity: 0.75 }}>
      {/* Ground plane grid */}
      <g opacity="0.12">
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={`gv${i}`} x1={80 + i * 24} y1={240} x2={200 + i * 24} y2={180} stroke="var(--rs-blueprint)" strokeWidth="0.5" />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={`gh${i}`} x1={80 + i * 20} y1={240 - i * 8} x2={360 + -i * 4} y2={180 + i * 6} stroke="var(--rs-blueprint)" strokeWidth="0.5" />
        ))}
      </g>

      {/* Main tower — blueprint teal */}
      <motion.g
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <path d="M120 90 L120 240 L200 210 L200 60 Z" fill="url(#fbTower1)" stroke="var(--rs-blueprint)" strokeWidth="0.8" />
        <path d="M200 60 L200 210 L250 230 L250 80 Z" fill="url(#fbTower2)" stroke="var(--rs-blueprint)" strokeWidth="0.8" />
        <path d="M120 90 L170 70 L250 80 L200 60 Z" fill="var(--rs-blueprint)" fillOpacity="0.06" stroke="var(--rs-blueprint)" strokeWidth="0.8" />
        {/* Windows — front face */}
        {[110, 135, 160, 185].map((y, i) => (
          <g key={`fw${i}`}>
            <rect x="132" y={y} width="14" height="10" rx="1" fill="var(--rs-blueprint)" fillOpacity={0.06 + i * 0.01} />
            <rect x="155" y={y} width="14" height="10" rx="1" fill="var(--rs-blueprint)" fillOpacity={0.05 + i * 0.01} />
            <rect x="178" y={y - 5} width="14" height="10" rx="1" fill="var(--rs-blueprint)" fillOpacity={0.04 + i * 0.01} />
          </g>
        ))}
        {/* Windows — right face */}
        {[100, 125, 150, 175].map((y, i) => (
          <g key={`rw${i}`}>
            <rect x="210" y={y} width="12" height="9" rx="1" fill="var(--rs-blueprint-2)" fillOpacity={0.06} transform="skewY(12)" />
            <rect x="230" y={y} width="12" height="9" rx="1" fill="var(--rs-blueprint-2)" fillOpacity={0.04} transform="skewY(12)" />
          </g>
        ))}
      </motion.g>

      {/* Mid-rise — burnt */}
      <motion.g
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1.2, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <path d="M260 150 L260 250 L320 270 L320 170 Z" fill="url(#fbTower3)" stroke="var(--rs-burnt)" strokeWidth="0.6" />
        <path d="M320 170 L320 270 L355 255 L355 155 Z" fill="var(--rs-burnt)" fillOpacity="0.04" stroke="var(--rs-burnt)" strokeWidth="0.6" />
        <path d="M260 150 L295 140 L355 155 L320 170 Z" fill="var(--rs-ember)" fillOpacity="0.06" stroke="var(--rs-burnt)" strokeWidth="0.6" />
        {[170, 195, 220].map((y, i) => (
          <g key={`bw${i}`}>
            <rect x="270" y={y} width="10" height="8" rx="1" fill="var(--rs-ember)" fillOpacity={0.08} />
            <rect x="290" y={y} width="10" height="8" rx="1" fill="var(--rs-ember)" fillOpacity={0.06} />
          </g>
        ))}
      </motion.g>

      {/* Small structure — sage */}
      <motion.g
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <path d="M340 210 L340 260 L370 272 L370 222 Z" fill="var(--rs-sage)" fillOpacity="0.06" stroke="var(--rs-sage)" strokeWidth="0.6" />
        <path d="M370 222 L370 272 L390 264 L390 214 Z" fill="var(--rs-sage)" fillOpacity="0.03" stroke="var(--rs-sage)" strokeWidth="0.6" />
        <path d="M340 210 L360 202 L390 214 L370 222 Z" fill="var(--rs-sage)" fillOpacity="0.08" stroke="var(--rs-sage)" strokeWidth="0.6" />
      </motion.g>

      {/* Construction crane — burnt */}
      <motion.g
        initial={{ opacity: 0, rotate: -5, x: -10 }}
        animate={{ opacity: 1, rotate: 0, x: 0 }}
        transition={{ duration: 1.5, delay: 0.8 }}
      >
        <line x1="100" y1="20" x2="100" y2="90" stroke="var(--rs-burnt)" strokeWidth="1.5" opacity="0.3" />
        <line x1="60" y1="20" x2="140" y2="20" stroke="var(--rs-burnt)" strokeWidth="1.5" opacity="0.3" />
        <line x1="100" y1="20" x2="60" y2="32" stroke="var(--rs-burnt)" strokeWidth="0.5" opacity="0.2" />
        <line x1="100" y1="20" x2="140" y2="32" stroke="var(--rs-burnt)" strokeWidth="0.5" opacity="0.2" />
        <line x1="75" y1="20" x2="75" y2="50" stroke="var(--rs-burnt)" strokeWidth="0.5" opacity="0.2" strokeDasharray="3 2" />
        <rect x="71" y="48" width="8" height="6" fill="var(--rs-burnt)" fillOpacity="0.1" stroke="var(--rs-burnt)" strokeWidth="0.5" opacity="0.2" />
      </motion.g>

      {/* Floating dots */}
      {[
        { cx: 150, cy: 50, r: 2, color: "var(--rs-blueprint)" },
        { cx: 280, cy: 100, r: 1.5, color: "var(--rs-blueprint-2)" },
        { cx: 350, cy: 150, r: 1, color: "var(--rs-burnt)" },
        { cx: 180, cy: 130, r: 1.5, color: "var(--rs-sage)" },
        { cx: 90, cy: 70, r: 1, color: "#8B5CF6" },
      ].map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.color} opacity="0.35" />
      ))}

      {/* Dimension annotation */}
      <g opacity="0.18">
        <line x1="120" y1="250" x2="250" y2="250" stroke="var(--rs-blueprint)" strokeWidth="0.5" />
        <line x1="120" y1="246" x2="120" y2="254" stroke="var(--rs-blueprint)" strokeWidth="0.5" />
        <line x1="250" y1="246" x2="250" y2="254" stroke="var(--rs-blueprint)" strokeWidth="0.5" />
        <text x="185" y="260" fill="var(--rs-blueprint)" fontSize="7" fontFamily="monospace" textAnchor="middle">32.5m</text>
      </g>

      {/* Gradients */}
      <defs>
        <linearGradient id="fbTower1" x1="120" y1="90" x2="200" y2="240" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--rs-blueprint)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--rs-blueprint)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="fbTower2" x1="200" y1="60" x2="250" y2="230" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--rs-blueprint-2)" stopOpacity="0.06" />
          <stop offset="100%" stopColor="var(--rs-blueprint-2)" stopOpacity="0.01" />
        </linearGradient>
        <linearGradient id="fbTower3" x1="260" y1="150" x2="320" y2="270" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--rs-ember)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--rs-burnt)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
    </svg>
  );
}
