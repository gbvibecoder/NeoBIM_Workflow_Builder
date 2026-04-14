"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { TeamSizeOption } from "@/features/onboarding-survey/types/survey";

interface TeamIllustrationProps {
  variant: TeamSizeOption["illustrationKey"];
  colorRgb: string;
}

/**
 * Architectural-sketch-style SVG scenes. Each variant cross-fades + slight
 * scale/blur, never hard-cuts. The palette is driven by the hovered option's
 * colorRgb so the illustration feels connected to the active pill.
 */
export function TeamIllustration({ variant, colorRgb }: TeamIllustrationProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 520,
        aspectRatio: "4/3",
      }}
    >
      <AnimatePresence mode="wait">
        <motion.svg
          key={variant}
          initial={{ opacity: 0, scale: 0.94, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          viewBox="0 0 400 300"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        >
          {variant === "solo" && <SoloScene rgb={colorRgb} />}
          {variant === "squad" && <SquadScene rgb={colorRgb} />}
          {variant === "company" && <CompanyScene rgb={colorRgb} />}
          {variant === "academic" && <AcademicScene rgb={colorRgb} />}
          {variant === "exploring" && <ExploringScene rgb={colorRgb} />}
        </motion.svg>
      </AnimatePresence>
    </div>
  );
}

// ── Shared style helpers ─────────────────────────────────────────────────
const stroke = (rgb: string, alpha = 0.55) => `rgba(${rgb}, ${alpha})`;
const fill = (rgb: string, alpha = 0.12) => `rgba(${rgb}, ${alpha})`;

// ── Solo: single figure at desk, cozy lamp glow ──────────────────────────
function SoloScene({ rgb }: { rgb: string }) {
  return (
    <g>
      {/* Floor line */}
      <line x1="30" y1="245" x2="370" y2="245" stroke={stroke(rgb, 0.3)} strokeWidth="1" strokeDasharray="3 3" />
      {/* Desk */}
      <rect x="120" y="200" width="160" height="8" rx="2" fill={stroke(rgb, 0.5)} />
      <rect x="140" y="208" width="6" height="36" fill={stroke(rgb, 0.4)} />
      <rect x="254" y="208" width="6" height="36" fill={stroke(rgb, 0.4)} />
      {/* Monitor */}
      <rect x="170" y="140" width="80" height="55" rx="3" fill={fill(rgb)} stroke={stroke(rgb)} strokeWidth="1.5" />
      <rect x="195" y="195" width="30" height="5" fill={stroke(rgb, 0.5)} />
      {/* Screen glow */}
      <motion.rect
        x="174" y="144" width="72" height="47" rx="2"
        fill={fill(rgb, 0.3)}
        animate={{ opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Chair */}
      <rect x="180" y="210" width="60" height="8" rx="2" fill={stroke(rgb, 0.35)} />
      <rect x="205" y="218" width="10" height="30" fill={stroke(rgb, 0.35)} />
      {/* Person — head + torso */}
      <circle cx="210" cy="175" r="14" fill={fill(rgb, 0.4)} stroke={stroke(rgb)} strokeWidth="1.5" />
      <path d="M 195 200 Q 210 188 225 200 L 225 218 L 195 218 Z" fill={fill(rgb, 0.3)} stroke={stroke(rgb)} strokeWidth="1.5" />
      {/* Lamp */}
      <line x1="110" y1="155" x2="110" y2="200" stroke={stroke(rgb, 0.5)} strokeWidth="1.5" />
      <path d="M 100 145 L 130 145 L 125 165 L 105 165 Z" fill={stroke(rgb, 0.6)} />
      <circle cx="115" cy="170" r="28" fill={fill(rgb, 0.08)} />
      {/* Coffee mug */}
      <rect x="260" y="190" width="12" height="10" rx="1" fill={stroke(rgb, 0.5)} />
      <motion.path d="M 263 188 Q 263 180 266 183 Q 269 186 269 190" stroke={stroke(rgb, 0.4)} strokeWidth="1" fill="none"
        animate={{ opacity: [0.3, 0.7, 0.3], y: [0, -3, 0] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Caption */}
      <text x="200" y="275" textAnchor="middle" fill={stroke(rgb, 0.5)} fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="2">
        SOLO · 01 DESK
      </text>
    </g>
  );
}

// ── Squad: 3 figures huddled around a screen ─────────────────────────────
function SquadScene({ rgb }: { rgb: string }) {
  return (
    <g>
      <line x1="30" y1="245" x2="370" y2="245" stroke={stroke(rgb, 0.3)} strokeWidth="1" strokeDasharray="3 3" />
      {/* Large table */}
      <ellipse cx="200" cy="215" rx="140" ry="22" fill={fill(rgb, 0.1)} stroke={stroke(rgb, 0.4)} strokeWidth="1.5" />
      {/* Shared monitor */}
      <rect x="160" y="150" width="80" height="55" rx="3" fill={fill(rgb, 0.2)} stroke={stroke(rgb, 0.6)} strokeWidth="1.5" />
      <motion.rect
        x="164" y="154" width="72" height="47" rx="2"
        fill={fill(rgb, 0.35)}
        animate={{ opacity: [0.4, 0.8, 0.4] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* 3 figures around table */}
      {[{ x: 95, y: 185 }, { x: 200, y: 135 }, { x: 305, y: 185 }].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="13" fill={fill(rgb, 0.4)} stroke={stroke(rgb)} strokeWidth="1.5" />
          <path d={`M ${p.x - 15} ${p.y + 25} Q ${p.x} ${p.y + 12} ${p.x + 15} ${p.y + 25} L ${p.x + 15} ${p.y + 40} L ${p.x - 15} ${p.y + 40} Z`}
            fill={fill(rgb, 0.3)} stroke={stroke(rgb)} strokeWidth="1.5" />
        </g>
      ))}
      {/* Idea bubbles / connection lines between figures + screen */}
      {[{ x1: 108, y1: 170, x2: 165, y2: 178 }, { x1: 200, y1: 148, x2: 200, y2: 160 }, { x1: 292, y1: 170, x2: 235, y2: 178 }].map((l, i) => (
        <motion.line
          key={i}
          x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke={stroke(rgb, 0.4)}
          strokeWidth="1"
          strokeDasharray="3 3"
          animate={{ strokeDashoffset: [0, -12] }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear", delay: i * 0.3 }}
        />
      ))}
      <text x="200" y="275" textAnchor="middle" fill={stroke(rgb, 0.5)} fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="2">
        SQUAD · 03 CHAIRS
      </text>
    </g>
  );
}

// ── Company: grid of desks, bustling ─────────────────────────────────────
function CompanyScene({ rgb }: { rgb: string }) {
  const desks: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      desks.push({ x: 65 + c * 72, y: 115 + r * 42 });
    }
  }
  return (
    <g>
      <line x1="30" y1="245" x2="370" y2="245" stroke={stroke(rgb, 0.3)} strokeWidth="1" strokeDasharray="3 3" />
      {/* Floor plan outline */}
      <rect x="40" y="75" width="320" height="175" rx="6" fill="none" stroke={stroke(rgb, 0.3)} strokeWidth="1" strokeDasharray="4 3" />
      {/* Desk grid with tiny monitors */}
      {desks.map((d, i) => (
        <g key={i}>
          <rect x={d.x} y={d.y} width="48" height="20" rx="2" fill={fill(rgb, 0.15)} stroke={stroke(rgb, 0.45)} strokeWidth="1" />
          <motion.rect
            x={d.x + 18}
            y={d.y + 4}
            width="12"
            height="9"
            rx="1"
            fill={fill(rgb, 0.5)}
            animate={{ opacity: [0.3, 0.9, 0.3] }}
            transition={{ duration: 2.2 + (i % 3) * 0.3, repeat: Infinity, ease: "easeInOut", delay: i * 0.08 }}
          />
          <circle cx={d.x + 24} cy={d.y - 3} r="4" fill={fill(rgb, 0.4)} stroke={stroke(rgb)} strokeWidth="0.8" />
        </g>
      ))}
      <text x="200" y="275" textAnchor="middle" fill={stroke(rgb, 0.5)} fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="2">
        COMPANY · 12 DESKS
      </text>
    </g>
  );
}

// ── Academic: lecture hall rows ─────────────────────────────────────────
function AcademicScene({ rgb }: { rgb: string }) {
  return (
    <g>
      <line x1="30" y1="245" x2="370" y2="245" stroke={stroke(rgb, 0.3)} strokeWidth="1" strokeDasharray="3 3" />
      {/* Blackboard */}
      <rect x="110" y="60" width="180" height="80" rx="3" fill={fill(rgb, 0.1)} stroke={stroke(rgb, 0.55)} strokeWidth="1.5" />
      <motion.line
        x1="130" y1="95" x2="270" y2="95"
        stroke={stroke(rgb, 0.7)} strokeWidth="1.5"
        animate={{ pathLength: [0, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <line x1="130" y1="110" x2="230" y2="110" stroke={stroke(rgb, 0.5)} strokeWidth="1" />
      <line x1="130" y1="122" x2="200" y2="122" stroke={stroke(rgb, 0.5)} strokeWidth="1" />
      {/* Lecturer */}
      <circle cx="300" cy="165" r="10" fill={fill(rgb, 0.4)} stroke={stroke(rgb)} strokeWidth="1.5" />
      <path d="M 290 183 Q 300 175 310 183 L 310 205 L 290 205 Z" fill={fill(rgb, 0.3)} stroke={stroke(rgb)} strokeWidth="1.5" />
      {/* Seats — 3 rows */}
      {[0, 1, 2].map((row) => (
        <g key={row}>
          {[0, 1, 2, 3, 4].map((col) => {
            const cx = 70 + col * 32 + row * 6;
            const cy = 170 + row * 22;
            return (
              <g key={col}>
                <circle cx={cx} cy={cy} r="6" fill={fill(rgb, 0.35)} stroke={stroke(rgb, 0.6)} strokeWidth="1" />
                <rect x={cx - 8} y={cy + 6} width="16" height="10" rx="1.5" fill={fill(rgb, 0.25)} stroke={stroke(rgb, 0.45)} strokeWidth="0.8" />
              </g>
            );
          })}
        </g>
      ))}
      <text x="200" y="275" textAnchor="middle" fill={stroke(rgb, 0.5)} fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="2">
        ACADEMIC · LECTURE HALL
      </text>
    </g>
  );
}

// ── Exploring: person with binoculars looking at horizon ─────────────────
function ExploringScene({ rgb }: { rgb: string }) {
  return (
    <g>
      {/* Horizon */}
      <line x1="30" y1="200" x2="370" y2="200" stroke={stroke(rgb, 0.4)} strokeWidth="1" strokeDasharray="5 3" />
      {/* Mountains silhouette */}
      <path d="M 30 200 L 90 140 L 140 170 L 200 120 L 260 160 L 320 130 L 370 200" fill={fill(rgb, 0.15)} stroke={stroke(rgb, 0.35)} strokeWidth="1" />
      {/* Sun */}
      <motion.circle cx="300" cy="110" r="18" fill={fill(rgb, 0.4)} stroke={stroke(rgb, 0.6)} strokeWidth="1"
        animate={{ opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Person silhouette */}
      <circle cx="110" cy="165" r="12" fill={fill(rgb, 0.5)} stroke={stroke(rgb)} strokeWidth="1.5" />
      {/* Binoculars */}
      <rect x="96" y="160" width="28" height="10" rx="2" fill={fill(rgb, 0.7)} stroke={stroke(rgb)} strokeWidth="1.5" />
      <circle cx="101" cy="165" r="4" fill="rgba(0,0,0,0.5)" />
      <circle cx="119" cy="165" r="4" fill="rgba(0,0,0,0.5)" />
      {/* Body */}
      <path d="M 95 188 Q 110 175 125 188 L 125 218 L 95 218 Z" fill={fill(rgb, 0.35)} stroke={stroke(rgb)} strokeWidth="1.5" />
      {/* Legs */}
      <rect x="100" y="218" width="6" height="25" fill={fill(rgb, 0.4)} stroke={stroke(rgb)} strokeWidth="1" />
      <rect x="114" y="218" width="6" height="25" fill={fill(rgb, 0.4)} stroke={stroke(rgb)} strokeWidth="1" />
      {/* Sight lines from binoculars to horizon */}
      <motion.path
        d="M 124 165 Q 200 155 290 125"
        stroke={stroke(rgb, 0.6)} strokeWidth="1" strokeDasharray="2 3" fill="none"
        animate={{ strokeDashoffset: [0, -10] }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
      <text x="200" y="275" textAnchor="middle" fill={stroke(rgb, 0.5)} fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="2">
        EXPLORING · HORIZON
      </text>
    </g>
  );
}
