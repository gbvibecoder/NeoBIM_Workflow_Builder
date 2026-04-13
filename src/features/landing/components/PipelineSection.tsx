"use client";

import React, { useRef, useState, useEffect, useMemo } from "react";
import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

// ─── Animation Presets ──────────────────────────────────────────────────────

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

// ─── Workflow Data ──────────────────────────────────────────────────────────

interface PipelineWorkflow {
  id: number;
  title: string;
  description: string;
  progress: number;
  floors: number;      // how many floors to show built
  totalFloors: number;
  status: "in-development" | "research" | "planned";
  statusLabel: string;
  targetDate: string;
  color: string;
  secondaryColor: string;
  nodeId: string;
}

function getFutureDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const day = date.getDate();
  const month = date.toLocaleString('en', { month: 'short' }).toUpperCase();
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function getWorkflows(t: (key: TranslationKey) => string): PipelineWorkflow[] {
  return [
    {
      id: 1,
      title: t('landing.pipeline1Title'),
      description: t('landing.pipeline1Desc'),
      progress: 70,
      floors: 7,
      totalFloors: 10,
      status: "in-development",
      statusLabel: t('landing.pipelineStatusDev'),
      targetDate: getFutureDate(2),
      color: "#4F8AFF",
      secondaryColor: "#6366F1",
      nodeId: "WF-01",
    },
    {
      id: 2,
      title: t('landing.pipeline2Title'),
      description: t('landing.pipeline2Desc'),
      progress: 30,
      floors: 3,
      totalFloors: 10,
      status: "research",
      statusLabel: t('landing.pipelineStatusResearch'),
      targetDate: getFutureDate(4),
      color: "#8B5CF6",
      secondaryColor: "#A78BFA",
      nodeId: "WF-02",
    },
    {
      id: 3,
      title: t('landing.pipeline3Title'),
      description: t('landing.pipeline3Desc'),
      progress: 10,
      floors: 1,
      totalFloors: 10,
      status: "planned",
      statusLabel: t('landing.pipelineStatusPlanned'),
      targetDate: getFutureDate(6),
      color: "#10B981",
      secondaryColor: "#34D399",
      nodeId: "WF-03",
    },
  ];
}

// ─── Animated Counter ───────────────────────────────────────────────────────

function AnimatedPercent({ value, color }: { value: number; color: string }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (inView) {
      const controls = animate(count, value, { duration: 2, ease: smoothEase });
      const unsub = rounded.on("change", (v) => setDisplay(v));
      return () => { controls.stop(); unsub(); };
    }
  }, [inView, value, count, rounded]);

  return (
    <span ref={ref} style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: 28, fontWeight: 800, color, letterSpacing: "-0.02em" }}>
      {display}
      <span style={{ fontSize: 16, opacity: 0.6 }}>%</span>
    </span>
  );
}

// ─── Mini Architectural Scene: Text → Building ──────────────────────────────

function SceneTextToBuilding({ color, progress }: { color: string; progress: number }) {
  const rgb = hexToRgb(color);
  const builtFloors = Math.round((progress / 100) * 7);

  return (
    <svg width="100%" height="180" viewBox="0 0 320 180" fill="none" style={{ display: "block" }}>
      {/* Grid background */}
      <defs>
        <pattern id="grid-1" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="0.5" fill={`rgba(${rgb}, 0.15)`} />
        </pattern>
        <linearGradient id="beam-1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="50%" stopColor={color} stopOpacity="0.6" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#grid-1)" />

      {/* Text block (left side) */}
      <g opacity="0.7">
        <rect x="20" y="40" width="80" height="100" rx="4" stroke={`rgba(${rgb}, 0.3)`} strokeWidth="1" fill={`rgba(${rgb}, 0.03)`} />
        {/* Text lines */}
        {[0,1,2,3,4,5,6].map((i) => (
          <rect key={i} x="28" y={52 + i * 12} width={40 + (i % 3) * 10} height="2" rx="1" fill={`rgba(${rgb}, ${0.15 + (i < 3 ? 0.15 : 0)})`}>
            <animate attributeName="opacity" values="0.3;0.8;0.3" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
          </rect>
        ))}
        {/* Cursor blink */}
        <rect x="28" y={52 + 7 * 12} width="2" height="8" fill={color}>
          <animate attributeName="opacity" values="1;0;1" dur="1.2s" repeatCount="indefinite" />
        </rect>
      </g>

      {/* Animated data flow arrow */}
      <g>
        <line x1="115" y1="90" x2="155" y2="90" stroke={`rgba(${rgb}, 0.15)`} strokeWidth="1" strokeDasharray="3 3" />
        {/* Flowing particles */}
        <circle r="2" fill={color}>
          <animateMotion dur="1.5s" repeatCount="indefinite" path="M115,90 L155,90" />
          <animate attributeName="opacity" values="0;1;1;0" dur="1.5s" repeatCount="indefinite" />
        </circle>
        <circle r="2" fill={color}>
          <animateMotion dur="1.5s" repeatCount="indefinite" begin="0.5s" path="M115,90 L155,90" />
          <animate attributeName="opacity" values="0;1;1;0" dur="1.5s" begin="0.5s" repeatCount="indefinite" />
        </circle>
        <circle r="2" fill={color}>
          <animateMotion dur="1.5s" repeatCount="indefinite" begin="1s" path="M115,90 L155,90" />
          <animate attributeName="opacity" values="0;1;1;0" dur="1.5s" begin="1s" repeatCount="indefinite" />
        </circle>
        {/* Arrow head */}
        <polygon points="152,86 160,90 152,94" fill={`rgba(${rgb}, 0.4)`}>
          <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite" />
        </polygon>
      </g>

      {/* Isometric Building (right side) — floors build up */}
      <g transform="translate(220, 140)">
        {/* Ground plane */}
        <polygon points="-40,0 0,-20 40,0 0,20" stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.5" fill={`rgba(${rgb}, 0.02)`} />

        {/* Built floors */}
        {Array.from({ length: builtFloors }).map((_, i) => {
          const y = -i * 12;
          const opacity = 0.15 + (i / builtFloors) * 0.35;
          return (
            <g key={i}>
              {/* Left face */}
              <polygon
                points={`-40,${y} 0,${y - 20} 0,${y - 20 - 12} -40,${y - 12}`}
                stroke={`rgba(${rgb}, ${opacity + 0.15})`}
                strokeWidth="0.8"
                fill={`rgba(${rgb}, ${opacity * 0.3})`}
              >
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin={`${i * 0.15}s`} fill="freeze" />
              </polygon>
              {/* Right face */}
              <polygon
                points={`0,${y - 20} 40,${y} 40,${y - 12} 0,${y - 20 - 12}`}
                stroke={`rgba(${rgb}, ${opacity + 0.1})`}
                strokeWidth="0.8"
                fill={`rgba(${rgb}, ${opacity * 0.2})`}
              >
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin={`${i * 0.15}s`} fill="freeze" />
              </polygon>
              {/* Top face (only on top floor) */}
              {i === builtFloors - 1 && (
                <polygon
                  points={`-40,${y - 12} 0,${y - 20 - 12} 40,${y - 12} 0,${y - 12 + 8}`}
                  stroke={`rgba(${rgb}, ${opacity + 0.2})`}
                  strokeWidth="0.8"
                  fill={`rgba(${rgb}, ${opacity * 0.4})`}
                />
              )}
              {/* Window on left face */}
              {i > 0 && i < builtFloors && (
                <rect
                  x={-28}
                  y={y - 10}
                  width="6"
                  height="4"
                  transform={`skewY(-27)`}
                  fill={`rgba(${rgb}, ${opacity * 0.5})`}
                  opacity="0.6"
                />
              )}
            </g>
          );
        })}

        {/* Ghost floors (unbuilt) */}
        {Array.from({ length: 10 - builtFloors }).map((_, i) => {
          const floorIdx = builtFloors + i;
          const y = -floorIdx * 12;
          return (
            <g key={`ghost-${i}`} opacity="0.15">
              <polygon
                points={`-40,${y} 0,${y - 20} 0,${y - 20 - 12} -40,${y - 12}`}
                stroke={`rgba(${rgb}, 0.2)`}
                strokeWidth="0.5"
                strokeDasharray="2 3"
                fill="none"
              />
              <polygon
                points={`0,${y - 20} 40,${y} 40,${y - 12} 0,${y - 20 - 12}`}
                stroke={`rgba(${rgb}, 0.15)`}
                strokeWidth="0.5"
                strokeDasharray="2 3"
                fill="none"
              />
            </g>
          );
        })}

        {/* Crane on top (if in development) */}
        {builtFloors >= 3 && (
          <g opacity="0.4">
            <line x1="0" y1={-builtFloors * 12 - 20} x2="0" y2={-builtFloors * 12 - 55} stroke={`rgba(${rgb}, 0.5)`} strokeWidth="1" />
            <line x1="0" y1={-builtFloors * 12 - 55} x2="-30" y2={-builtFloors * 12 - 55} stroke={`rgba(${rgb}, 0.4)`} strokeWidth="0.8" />
            <line x1="-25" y1={-builtFloors * 12 - 55} x2="-25" y2={-builtFloors * 12 - 45} stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.5" strokeDasharray="2 2">
              <animate attributeName="y2" values={`${-builtFloors * 12 - 45};${-builtFloors * 12 - 35};${-builtFloors * 12 - 45}`} dur="3s" repeatCount="indefinite" />
            </line>
          </g>
        )}

        {/* Height dimension annotation */}
        <g opacity="0.5">
          <line x1="52" y1="0" x2="52" y2={-builtFloors * 12 - 20} stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.5" />
          <line x1="48" y1="0" x2="56" y2="0" stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.5" />
          <line x1="48" y1={-builtFloors * 12 - 20} x2="56" y2={-builtFloors * 12 - 20} stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.5" />
          <text x="58" y={(-builtFloors * 12 - 20) / 2} fill={`rgba(${rgb}, 0.5)`} fontSize="7" fontFamily="monospace">{builtFloors * 3}m</text>
        </g>
      </g>

      {/* Scanning beam */}
      <rect x="0" y="0" width="320" height="2" fill="url(#beam-1)" opacity="0.3">
        <animate attributeName="y" values="0;180;0" dur="4s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

// ─── Mini Architectural Scene: Building → IFC ───────────────────────────────

function SceneBuildingToIfc({ color, progress }: { color: string; progress: number }) {
  const rgb = hexToRgb(color);
  const dataRows = Math.round((progress / 100) * 8);

  return (
    <svg width="100%" height="180" viewBox="0 0 320 180" fill="none" style={{ display: "block" }}>
      <defs>
        <pattern id="grid-2" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="0.5" fill={`rgba(${rgb}, 0.12)`} />
        </pattern>
        <linearGradient id="beam-2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="50%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#grid-2)" />

      {/* Wireframe Building (left) */}
      <g transform="translate(65, 130)">
        {/* Ground */}
        <polygon points="-35,0 0,-18 35,0 0,18" stroke={`rgba(${rgb}, 0.25)`} strokeWidth="0.5" fill={`rgba(${rgb}, 0.02)`} />
        {/* Building body */}
        {[0,1,2,3,4].map((i) => {
          const y = -i * 16;
          return (
            <g key={i}>
              <polygon points={`-35,${y} 0,${y - 18} 0,${y - 34} -35,${y - 16}`} stroke={`rgba(${rgb}, 0.35)`} strokeWidth="0.8" fill={`rgba(${rgb}, 0.04)`} />
              <polygon points={`0,${y - 18} 35,${y} 35,${y - 16} 0,${y - 34}`} stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.8" fill={`rgba(${rgb}, 0.03)`} />
            </g>
          );
        })}
        {/* Top */}
        <polygon points="-35,-80 0,-98 35,-80 0,-62" stroke={`rgba(${rgb}, 0.4)`} strokeWidth="0.8" fill={`rgba(${rgb}, 0.06)`} />
        {/* Pulsing decompose lines */}
        <g>
          <line x1="35" y1="0" x2="55" y2="-10" stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.5" strokeDasharray="2 3">
            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite" />
          </line>
          <line x1="35" y1="-32" x2="55" y2="-40" stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.5" strokeDasharray="2 3">
            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" begin="0.3s" repeatCount="indefinite" />
          </line>
          <line x1="35" y1="-64" x2="55" y2="-70" stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.5" strokeDasharray="2 3">
            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" begin="0.6s" repeatCount="indefinite" />
          </line>
        </g>
      </g>

      {/* Transformation flow */}
      <g>
        <path d="M120 85 C140 85, 150 85, 170 85" stroke={`rgba(${rgb}, 0.15)`} strokeWidth="1" strokeDasharray="4 3" />
        {[0,1,2].map((i) => (
          <circle key={i} r="1.5" fill={color}>
            <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.6}s`} path="M120,85 C140,85 150,85 170,85" />
            <animate attributeName="opacity" values="0;1;1;0" dur="2s" begin={`${i * 0.6}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </g>

      {/* IFC Structure (right) — tree/hierarchy */}
      <g transform="translate(185, 30)">
        {/* IFC File header */}
        <rect x="0" y="0" width="110" height="24" rx="4" stroke={color} strokeWidth="1.2" fill={`rgba(${rgb}, 0.08)`} />
        <text x="10" y="16" fill={color} fontSize="10" fontWeight="700" fontFamily="monospace">IFC 4.3</text>
        <circle cx="96" cy="12" r="4" stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.8" fill={`rgba(${rgb}, 0.1)`}>
          <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
        </circle>

        {/* Hierarchy tree */}
        <line x1="12" y1="24" x2="12" y2={28 + Math.min(dataRows, 8) * 15} stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.8" />
        {[
          "IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey",
          "IfcWallStandardCase", "IfcSlab", "IfcWindow", "IfcDoor"
        ].map((name, i) => {
          const active = i < dataRows;
          const indent = i < 4 ? i * 6 : 24;
          return (
            <g key={name} opacity={active ? 1 : 0.2}>
              <line x1="12" y1={36 + i * 15} x2={20 + indent} y2={36 + i * 15} stroke={`rgba(${rgb}, ${active ? 0.3 : 0.1})`} strokeWidth="0.5" />
              <circle cx={22 + indent} cy={36 + i * 15} r="2" fill={active ? color : `rgba(${rgb}, 0.15)`}>
                {active && <animate attributeName="opacity" values="0.5;1;0.5" dur={`${2 + i * 0.2}s`} repeatCount="indefinite" />}
              </circle>
              <text x={28 + indent} y={39 + i * 15} fill={active ? `rgba(${rgb}, 0.7)` : `rgba(${rgb}, 0.15)`} fontSize="7" fontFamily="monospace">
                {name}
              </text>
            </g>
          );
        })}
      </g>

      {/* Scanning beam */}
      <rect x="0" y="0" width="320" height="1.5" fill="url(#beam-2)" opacity="0.25">
        <animate attributeName="y" values="0;180;0" dur="5s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

// ─── Mini Architectural Scene: 2D Plan → 3D Render ──────────────────────────

function SceneFloorPlanTo3d({ color }: { color: string }) {
  const { t } = useLocale();
  const rgb = hexToRgb(color);

  return (
    <svg width="100%" height="180" viewBox="0 0 320 180" fill="none" style={{ display: "block" }}>
      <defs>
        <pattern id="grid-3" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="0.5" fill={`rgba(${rgb}, 0.12)`} />
        </pattern>
        <linearGradient id="extrude-grad" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.08" />
          <stop offset="100%" stopColor={color} stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#grid-3)" />

      {/* 2D Floor Plan (left) */}
      <g transform="translate(20, 30)">
        {/* Plan boundary */}
        <rect x="0" y="0" width="90" height="80" stroke={`rgba(${rgb}, 0.5)`} strokeWidth="1.2" fill={`rgba(${rgb}, 0.03)`} />
        {/* Room partitions */}
        <line x1="0" y1="40" x2="55" y2="40" stroke={`rgba(${rgb}, 0.35)`} strokeWidth="0.8" />
        <line x1="55" y1="0" x2="55" y2="80" stroke={`rgba(${rgb}, 0.35)`} strokeWidth="0.8" />
        <line x1="55" y1="50" x2="90" y2="50" stroke={`rgba(${rgb}, 0.25)`} strokeWidth="0.6" />
        {/* Door arcs */}
        <path d="M35 40 A8 8 0 0 1 35 32" stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.6" fill="none" />
        <path d="M55 22 A6 6 0 0 0 61 22" stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.6" fill="none" />
        {/* Room labels */}
        <text x="22" y="24" fill={`rgba(${rgb}, 0.5)`} fontSize="7" fontFamily="monospace" textAnchor="middle">{t('landing.roomLiving')}</text>
        <text x="22" y="62" fill={`rgba(${rgb}, 0.5)`} fontSize="7" fontFamily="monospace" textAnchor="middle">{t('landing.roomBed')}</text>
        <text x="72" y="30" fill={`rgba(${rgb}, 0.5)`} fontSize="7" fontFamily="monospace" textAnchor="middle">{t('landing.roomKitchen')}</text>
        <text x="72" y="70" fill={`rgba(${rgb}, 0.4)`} fontSize="6" fontFamily="monospace" textAnchor="middle">{t('landing.roomBath')}</text>
        {/* Dimension line */}
        <line x1="0" y1="90" x2="90" y2="90" stroke={`rgba(${rgb}, 0.25)`} strokeWidth="0.5" />
        <line x1="0" y1="87" x2="0" y2="93" stroke={`rgba(${rgb}, 0.25)`} strokeWidth="0.5" />
        <line x1="90" y1="87" x2="90" y2="93" stroke={`rgba(${rgb}, 0.25)`} strokeWidth="0.5" />
        <text x="45" y="100" fill={`rgba(${rgb}, 0.35)`} fontSize="6" fontFamily="monospace" textAnchor="middle">12.0m</text>

        {/* Pulse overlay */}
        <rect x="0" y="0" width="90" height="80" fill="none" stroke={color} strokeWidth="1" opacity="0">
          <animate attributeName="opacity" values="0;0.3;0" dur="3s" repeatCount="indefinite" />
        </rect>
      </g>

      {/* Extrusion arrows (rising) */}
      <g transform="translate(128, 45)">
        {[0,1,2].map((i) => (
          <g key={i}>
            <line x1={i * 12} y1="50" x2={i * 12} y2="10" stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.8" strokeDasharray="2 3" />
            <polygon points={`${i * 12 - 3},14 ${i * 12},6 ${i * 12 + 3},14`} fill={`rgba(${rgb}, 0.3)`}>
              <animate attributeName="opacity" values="0.2;0.6;0.2" dur="1.5s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </polygon>
            {/* Rising particle */}
            <circle cx={i * 12} r="1.5" fill={color}>
              <animate attributeName="cy" values="50;10" dur="1.5s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;1;0" dur="1.5s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
            </circle>
          </g>
        ))}
      </g>

      {/* 3D Perspective View (right) */}
      <g transform="translate(180, 20)">
        {/* Back wall */}
        <rect x="10" y="10" width="100" height="70" fill="url(#extrude-grad)" stroke={`rgba(${rgb}, 0.4)`} strokeWidth="1" />
        {/* Left wall (perspective) */}
        <polygon points="10,10 0,25 0,110 10,80" fill={`rgba(${rgb}, 0.06)`} stroke={`rgba(${rgb}, 0.35)`} strokeWidth="0.8" />
        {/* Floor */}
        <polygon points="0,110 10,80 110,80 120,110" fill={`rgba(${rgb}, 0.04)`} stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.5" />
        {/* Ceiling */}
        <polygon points="0,25 10,10 110,10 120,25" fill={`rgba(${rgb}, 0.05)`} stroke={`rgba(${rgb}, 0.25)`} strokeWidth="0.5" />
        {/* Right edge */}
        <line x1="110" y1="10" x2="120" y2="25" stroke={`rgba(${rgb}, 0.35)`} strokeWidth="0.8" />
        <line x1="110" y1="80" x2="120" y2="110" stroke={`rgba(${rgb}, 0.3)`} strokeWidth="0.8" />
        <line x1="120" y1="25" x2="120" y2="110" stroke={`rgba(${rgb}, 0.4)`} strokeWidth="1" />
        {/* Window on back wall */}
        <rect x="30" y="22" width="30" height="24" rx="1" stroke={`rgba(${rgb}, 0.4)`} strokeWidth="0.8" fill={`rgba(${rgb}, 0.1)`}>
          <animate attributeName="fill-opacity" values="0.05;0.15;0.05" dur="3s" repeatCount="indefinite" />
        </rect>
        <line x1="45" y1="22" x2="45" y2="46" stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.5" />
        <line x1="30" y1="34" x2="60" y2="34" stroke={`rgba(${rgb}, 0.2)`} strokeWidth="0.5" />
        {/* Window 2 */}
        <rect x="70" y="22" width="24" height="24" rx="1" stroke={`rgba(${rgb}, 0.35)`} strokeWidth="0.8" fill={`rgba(${rgb}, 0.08)`}>
          <animate attributeName="fill-opacity" values="0.05;0.12;0.05" dur="3s" begin="0.5s" repeatCount="indefinite" />
        </rect>
        {/* Floor material lines */}
        {[0,1,2,3].map((i) => (
          <line key={i} x1={10 + i * 25} y1={80 - i * 0} x2={20 + i * 25} y2={110 - i * 7} stroke={`rgba(${rgb}, 0.1)`} strokeWidth="0.5" />
        ))}
        {/* "Materials" shimmer */}
        <rect x="10" y="10" width="100" height="70" fill="none">
          <animate attributeName="opacity" values="0;0.1;0" dur="4s" repeatCount="indefinite" />
        </rect>

        {/* Lighting ray */}
        <line x1="120" y1="15" x2="50" y2="75" stroke={`rgba(${rgb}, 0.08)`} strokeWidth="12" />
      </g>
    </svg>
  );
}

const SCENES = [SceneTextToBuilding, SceneBuildingToIfc, SceneFloorPlanTo3d];

// ─── Large Animated Pipeline SVG (Desktop) ──────────────────────────────────

function PipelineSVG() {
  return (
    <svg
      className="pipeline-svg-desktop"
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}
      viewBox="0 0 1200 650"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
    >
      <defs>
        <linearGradient id="pipe-grad-1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#4F8AFF" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="pipe-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#10B981" stopOpacity="0.4" />
        </linearGradient>
        <filter id="glow-pipe">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Connection path 1→2 */}
      <path
        d="M380 325 C420 325, 420 325, 440 325 C460 325, 460 325, 460 325 L470 325 C490 325, 510 325, 520 325"
        stroke="rgba(79,138,255,0.08)"
        strokeWidth="40"
        strokeLinecap="round"
      />
      <path
        d="M385 325 L515 325"
        stroke="url(#pipe-grad-1)"
        strokeWidth="2"
        strokeDasharray="8 6"
        className="pipeline-flow-1"
      />
      {/* Flow particles 1→2 */}
      {[0, 0.4, 0.8].map((delay) => (
        <circle key={`p1-${delay}`} r="4" fill="#4F8AFF" filter="url(#glow-pipe)">
          <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${delay}s`} path="M385,325 L515,325" />
          <animate attributeName="opacity" values="0;0.8;0.8;0" dur="2.5s" begin={`${delay}s`} repeatCount="indefinite" />
          <animate attributeName="r" values="2;4;2" dur="2.5s" begin={`${delay}s`} repeatCount="indefinite" />
        </circle>
      ))}

      {/* Connection path 2→3 */}
      <path
        d="M780 325 C820 325, 820 325, 840 325 C860 325, 860 325, 860 325 L900 325"
        stroke="rgba(139,92,246,0.06)"
        strokeWidth="40"
        strokeLinecap="round"
      />
      <path
        d="M785 325 L895 325"
        stroke="url(#pipe-grad-2)"
        strokeWidth="2"
        strokeDasharray="8 6"
        className="pipeline-flow-2"
      />
      {/* Flow particles 2→3 */}
      {[0.2, 0.6, 1.0].map((delay) => (
        <circle key={`p2-${delay}`} r="4" fill="#8B5CF6" filter="url(#glow-pipe)">
          <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${delay}s`} path="M785,325 L895,325" />
          <animate attributeName="opacity" values="0;0.8;0.8;0" dur="2.5s" begin={`${delay}s`} repeatCount="indefinite" />
          <animate attributeName="r" values="2;4;2" dur="2.5s" begin={`${delay}s`} repeatCount="indefinite" />
        </circle>
      ))}

      {/* Junction nodes */}
      {[
        { x: 385, color: "#4F8AFF" },
        { x: 515, color: "#8B5CF6" },
        { x: 785, color: "#8B5CF6" },
        { x: 895, color: "#10B981" },
      ].map((node, i) => (
        <g key={i}>
          <circle cx={node.x} cy={325} r="6" fill={node.color} opacity="0.15">
            <animate attributeName="r" values="4;8;4" dur="2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.1;0.25;0.1" dur="2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
          </circle>
          <circle cx={node.x} cy={325} r="3" fill={node.color} opacity="0.6" />
        </g>
      ))}
    </svg>
  );
}

// ─── Workflow Card (redesigned) ─────────────────────────────────────────────

function WorkflowCard({
  workflow,
  index,
  isFlagship,
}: {
  workflow: PipelineWorkflow;
  index: number;
  isFlagship?: boolean;
}) {
  const { t } = useLocale();
  const rgb = hexToRgb(workflow.color);
  const [isHovered, setIsHovered] = useState(false);
  const Scene = SCENES[index];
  const cardRef = useRef<HTMLElement>(null);
  const inView = useInView(cardRef, { once: true, margin: "-40px" });

  return (
    <motion.article
      ref={cardRef}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: smoothEase, delay: index * 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: "rgba(12,12,22,0.92)",
        backdropFilter: "blur(24px)",
        border: `1px solid rgba(${rgb}, ${isHovered ? 0.5 : isFlagship ? 0.3 : 0.15})`,
        borderRadius: 20,
        overflow: "hidden",
        position: "relative",
        transition: "border-color 0.4s, box-shadow 0.4s, transform 0.4s",
        boxShadow: isHovered
          ? `0 12px 48px rgba(0,0,0,0.5), 0 0 40px rgba(${rgb}, 0.15), inset 0 1px 0 rgba(${rgb}, 0.1)`
          : isFlagship
            ? `0 8px 32px rgba(0,0,0,0.4), 0 0 24px rgba(${rgb}, 0.08), inset 0 1px 0 rgba(${rgb}, 0.06)`
            : `0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)`,
        transform: isHovered ? "translateY(-8px) scale(1.01)" : "translateY(0) scale(1)",
        flex: 1,
        minWidth: 0,
      }}
    >
      {/* Top glow bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "10%",
          right: "10%",
          height: 1,
          background: `linear-gradient(90deg, transparent, rgba(${rgb}, ${isHovered ? 0.8 : 0.4}), transparent)`,
          transition: "all 0.4s",
        }}
      />

      {/* Blueprint grid overlay on scene area */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 230, pointerEvents: "none", opacity: 0.04 }}>
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "linear-gradient(rgba(79,138,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(79,138,255,0.15) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }} />
      </div>

      {/* Status & Date header */}
      <div
        className="pipeline-card-header"
        style={{
          padding: "14px 20px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Status dot with ring pulse */}
          <div style={{ position: "relative", width: 14, height: 14 }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: `2px solid rgba(${rgb}, 0.3)`,
                animation: workflow.status === "in-development"
                  ? "ping-ring 2s cubic-bezier(0, 0, 0.2, 1) infinite"
                  : "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 3,
                left: 3,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: workflow.color,
                boxShadow: `0 0 ${workflow.status === "in-development" ? 12 : 6}px ${workflow.color}`,
              }}
            />
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "1.5px", color: workflow.color,
          }}>
            {workflow.statusLabel}
          </span>
          {isFlagship && (
            <span style={{
              fontSize: 8, fontWeight: 800, padding: "2px 6px",
              borderRadius: 4, background: `rgba(${rgb}, 0.15)`,
              color: workflow.color, letterSpacing: "1px",
              border: `1px solid rgba(${rgb}, 0.2)`,
            }}>
              {t('landing.flagship')}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 9, fontWeight: 600, padding: "3px 10px",
            borderRadius: 20, background: `rgba(${rgb}, 0.08)`,
            color: `rgba(${rgb}, 0.9)`, border: `1px solid rgba(${rgb}, 0.12)`,
            fontFamily: "var(--font-jetbrains), monospace", letterSpacing: "1px",
          }}>
            {workflow.targetDate}
          </span>
        </div>
      </div>

      {/* Mini Architectural Scene */}
      <div className="pipeline-card-scene" style={{ padding: "8px 12px 0", position: "relative", zIndex: 1 }}>
        <div style={{
          borderRadius: 12, overflow: "hidden",
          border: `1px solid rgba(${rgb}, 0.08)`,
          background: `rgba(${rgb}, 0.02)`,
        }}>
          <Scene color={workflow.color} progress={workflow.progress} />
        </div>
      </div>

      {/* Content */}
      <div className="pipeline-card-content" style={{ padding: "16px 20px 20px", position: "relative", zIndex: 2 }}>
        {/* Node ID + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{
            fontFamily: "var(--font-jetbrains), monospace", fontSize: 9, fontWeight: 700,
            color: `rgba(${rgb}, 0.5)`, padding: "2px 6px", borderRadius: 4,
            background: `rgba(${rgb}, 0.06)`, border: `1px solid rgba(${rgb}, 0.08)`,
          }}>
            {workflow.nodeId}
          </span>
        </div>
        <h3 style={{
          fontSize: 19, fontWeight: 800, color: "#F0F0F5", margin: "0 0 8px",
          lineHeight: 1.2, letterSpacing: "-0.02em",
        }}>
          {workflow.title}
        </h3>
        <p style={{
          fontSize: 13, color: "#9898B0", lineHeight: 1.55, margin: "0 0 16px",
        }}>
          {workflow.description}
        </p>

        {/* Progress Section */}
        <div className="pipeline-card-progress" style={{
          padding: "14px 16px", borderRadius: 12,
          background: `rgba(${rgb}, 0.04)`,
          border: `1px solid rgba(${rgb}, 0.08)`,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#5C5C78", textTransform: "uppercase", letterSpacing: "1px" }}>
              {t('landing.progress')}
            </span>
            <AnimatedPercent value={workflow.progress} color={workflow.color} />
          </div>

          {/* Segmented progress bar (10 segments = 10 floors) */}
          <div style={{ display: "flex", gap: 3 }}>
            {Array.from({ length: workflow.totalFloors }).map((_, i) => {
              const filled = i < workflow.floors;
              return (
                <motion.div
                  key={i}
                  initial={{ scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: 0.5 + i * 0.06, ease: smoothEase }}
                  style={{
                    flex: 1, height: 6, borderRadius: 3,
                    background: filled
                      ? `linear-gradient(90deg, ${workflow.color}, ${workflow.secondaryColor})`
                      : `rgba(${rgb}, 0.06)`,
                    boxShadow: filled ? `0 0 8px rgba(${rgb}, 0.25)` : "none",
                    transformOrigin: "bottom",
                    transition: "box-shadow 0.3s",
                  }}
                />
              );
            })}
          </div>

          {/* Floor counter */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 600, color: `rgba(${rgb}, 0.5)`,
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {workflow.floors}/{workflow.totalFloors} {t('landing.milestones')}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 600, color: "#3A3A50",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {workflow.status === "in-development" ? t('landing.targetingBeta') : workflow.status === "research" ? t('landing.prototyping') : t('landing.scoping')}
            </span>
          </div>
        </div>
      </div>

      {/* Hover radial glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        opacity: isHovered ? 1 : 0, transition: "opacity 0.4s",
        background: `radial-gradient(ellipse at 50% 20%, rgba(${rgb}, 0.06) 0%, transparent 60%)`,
      }} />

      {/* Corner accent lines */}
      <svg style={{ position: "absolute", top: 0, right: 0, width: 40, height: 40, pointerEvents: "none" }} viewBox="0 0 40 40">
        <line x1="40" y1="0" x2="40" y2="20" stroke={`rgba(${rgb}, ${isHovered ? 0.4 : 0.15})`} strokeWidth="1" style={{ transition: "stroke 0.3s" }} />
        <line x1="20" y1="0" x2="40" y2="0" stroke={`rgba(${rgb}, ${isHovered ? 0.4 : 0.15})`} strokeWidth="1" style={{ transition: "stroke 0.3s" }} />
      </svg>
      <svg style={{ position: "absolute", bottom: 0, left: 0, width: 40, height: 40, pointerEvents: "none" }} viewBox="0 0 40 40">
        <line x1="0" y1="20" x2="0" y2="40" stroke={`rgba(${rgb}, ${isHovered ? 0.4 : 0.15})`} strokeWidth="1" style={{ transition: "stroke 0.3s" }} />
        <line x1="0" y1="40" x2="20" y2="40" stroke={`rgba(${rgb}, ${isHovered ? 0.4 : 0.15})`} strokeWidth="1" style={{ transition: "stroke 0.3s" }} />
      </svg>
    </motion.article>
  );
}

// ─── Atmospheric Background ─────────────────────────────────────────────────

function AtmosphericBackground() {
  const { t } = useLocale();
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {/* Dot grid — structural pattern */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.5,
        backgroundImage: "radial-gradient(circle, rgba(79,138,255,0.04) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      {/* Blueprint major grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "linear-gradient(rgba(79,138,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(79,138,255,0.035) 1px, transparent 1px)",
        backgroundSize: "160px 160px",
        maskImage: "radial-gradient(ellipse 90% 80% at 50% 50%, black 20%, transparent 70%)",
        WebkitMaskImage: "radial-gradient(ellipse 90% 80% at 50% 50%, black 20%, transparent 70%)",
      }} />

      {/* Architectural SVG overlay */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 1440 800" fill="none" preserveAspectRatio="xMidYMid slice">
        {/* City skyline silhouette (very faint) */}
        <g opacity="0.035">
          <path d="M0 700 L0 500 L40 500 L40 420 L60 420 L60 380 L80 360 L100 380 L100 420 L130 420 L130 480 L160 480 L160 500 L200 500 L200 700" stroke="#4F8AFF" strokeWidth="1.5" fill="none" />
          <path d="M250 700 L250 450 L270 450 L270 350 L290 340 L310 350 L310 450 L340 450 L340 520 L380 520 L380 700" stroke="#4F8AFF" strokeWidth="1" fill="none" />
          <path d="M1060 700 L1060 420 L1090 420 L1090 300 L1110 280 L1130 300 L1130 420 L1170 420 L1170 500 L1200 500 L1200 700" stroke="#8B5CF6" strokeWidth="1" fill="none" />
          <path d="M1260 700 L1260 480 L1300 480 L1300 380 L1320 360 L1340 380 L1340 480 L1380 480 L1380 540 L1440 540 L1440 700" stroke="#8B5CF6" strokeWidth="1.5" fill="none" />
        </g>

        {/* Horizontal construction datum lines */}
        <line x1="0" y1="400" x2="1440" y2="400" stroke="rgba(79,138,255,0.04)" strokeWidth="1" strokeDasharray="20 10" />
        <line x1="0" y1="200" x2="1440" y2="200" stroke="rgba(139,92,246,0.03)" strokeWidth="0.5" strokeDasharray="12 16" />

        {/* Structural grid axis markers */}
        {["A", "B", "C", "D", "E", "F"].map((label, i) => (
          <g key={label} opacity="0.06">
            <circle cx={120 + i * 240} cy="40" r="12" stroke="#4F8AFF" strokeWidth="0.8" fill="none" />
            <text x={120 + i * 240} y="44" fill="#4F8AFF" fontSize="10" fontWeight="700" fontFamily="monospace" textAnchor="middle">{label}</text>
            <line x1={120 + i * 240} y1="52" x2={120 + i * 240} y2="800" stroke="#4F8AFF" strokeWidth="0.4" strokeDasharray="4 12" />
          </g>
        ))}

        {/* Dimension annotation */}
        <g opacity="0.05">
          <line x1="120" y1="760" x2="1320" y2="760" stroke="#4F8AFF" strokeWidth="0.8" />
          <line x1="120" y1="754" x2="120" y2="766" stroke="#4F8AFF" strokeWidth="0.8" />
          <line x1="1320" y1="754" x2="1320" y2="766" stroke="#4F8AFF" strokeWidth="0.8" />
          <text x="720" y="780" fill="#4F8AFF" fontSize="9" fontFamily="monospace" textAnchor="middle">{t('landing.pipelineSpan')}</text>
        </g>

        {/* Animated scan line */}
        <line x1="0" y1="0" x2="1440" y2="0" stroke="rgba(79,138,255,0.15)" strokeWidth="1">
          <animate attributeName="y1" values="0;800;0" dur="8s" repeatCount="indefinite" />
          <animate attributeName="y2" values="0;800;0" dur="8s" repeatCount="indefinite" />
        </line>
      </svg>

      {/* Gradient orbs */}
      <div className="orb-drift-1" style={{
        position: "absolute", top: "5%", left: "15%", width: 500, height: 500, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 65%)", filter: "blur(40px)",
      }} />
      <div className="orb-drift-2" style={{
        position: "absolute", bottom: "10%", right: "10%", width: 450, height: 450, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 65%)", filter: "blur(35px)",
      }} />
      <div className="orb-drift-3" style={{
        position: "absolute", top: "40%", left: "50%", width: 400, height: 400, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(16,185,129,0.05) 0%, transparent 65%)", filter: "blur(30px)",
        transform: "translateX(-50%)",
      }} />
    </div>
  );
}

// ─── Section Title ──────────────────────────────────────────────────────────

function SectionTitle() {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useLocale();
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: smoothEase }}
      style={{ textAlign: "center", marginBottom: 80, position: "relative" }}
    >
      {/* Decorative top element — under-construction line */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24, gap: 16, alignItems: "center" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={inView ? { width: 60 } : {}}
          transition={{ duration: 1, ease: smoothEase, delay: 0.3 }}
          style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(79,138,255,0.5))" }}
        />
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 16px", borderRadius: 20,
          background: "rgba(79,138,255,0.06)", border: "1px solid rgba(79,138,255,0.12)",
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%", background: "#4F8AFF",
            boxShadow: "0 0 8px rgba(79,138,255,0.5)",
            animation: "glow-pulse 2s ease-in-out infinite",
          }} />
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "2.5px", color: "#4F8AFF",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            {t('landing.thePipeline')}
          </span>
        </div>
        <motion.div
          initial={{ width: 0 }}
          animate={inView ? { width: 60 } : {}}
          transition={{ duration: 1, ease: smoothEase, delay: 0.3 }}
          style={{ height: 1, background: "linear-gradient(90deg, rgba(79,138,255,0.5), transparent)" }}
        />
      </div>

      {/* Main heading */}
      <h2 style={{
        fontSize: "clamp(2.2rem, 4.5vw, 3.8rem)", fontWeight: 900,
        letterSpacing: "-0.04em", lineHeight: 1.05, margin: "0 0 20px",
      }}>
        <span style={{ color: "#F0F0F5" }}>{t('landing.whatWereBuilding')}{" "}</span>
        <span style={{
          background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 40%, #C084FC 80%, #10B981 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        }}>
          {t('landing.buildingNext')}
        </span>
      </h2>

      {/* Subtitle */}
      <p style={{
        fontSize: "clamp(0.875rem, 2.5vw, 1.0625rem)", color: "#9898B0", lineHeight: 1.7, maxWidth: "min(600px, 100%)",
        margin: "0 auto", letterSpacing: "-0.005em",
      }}>
        {t('landing.pipelineSubtitle')}
      </p>

      {/* Decorative dimension annotation below subtitle */}
      <div style={{
        display: "flex", justifyContent: "center", alignItems: "center",
        gap: 12, marginTop: 20, opacity: 0.3,
      }}>
        <div style={{ width: 40, height: 1, background: "rgba(79,138,255,0.3)" }} />
        <span style={{
          fontSize: 8, fontWeight: 600, color: "#5C5C78", letterSpacing: "2px",
          fontFamily: "var(--font-jetbrains), monospace", textTransform: "uppercase",
        }}>
          {t('landing.inputProcessOutput')}
        </span>
        <div style={{ width: 40, height: 1, background: "rgba(16,185,129,0.3)" }} />
      </div>
    </motion.div>
  );
}

// ─── Main Pipeline Section ──────────────────────────────────────────────────

export function PipelineSection() {
  const { t } = useLocale();
  const sectionRef = useRef<HTMLElement>(null);
  const WORKFLOWS = useMemo(() => getWorkflows(t), [t]);

  return (
    <section
      ref={sectionRef}
      id="pipeline"
      style={{
        padding: "140px 24px 120px",
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(180deg, #07070D 0%, #080A10 30%, #0A0A14 50%, #080A10 70%, #07070D 100%)",
      }}
    >
      <AtmosphericBackground />

      <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <SectionTitle />

        {/* ── Card Grid with Pipeline ─────────────────────────────── */}
        <div style={{ position: "relative" }}>
          {/* Desktop Pipeline SVG Connectors */}
          <PipelineSVG />

          {/* Desktop: Horizontal Cards */}
          <div className="pipeline-cards-desktop" style={{
            display: "flex", gap: 24, alignItems: "stretch",
            position: "relative", zIndex: 1,
          }}>
            {WORKFLOWS.map((wf, i) => (
              <WorkflowCard key={wf.id} workflow={wf} index={i} isFlagship={i === 0} />
            ))}
          </div>

          {/* Mobile: Vertical Cards */}
          <div className="pipeline-cards-mobile" style={{
            display: "none", flexDirection: "column", gap: 20,
            position: "relative", zIndex: 1,
          }}>
            {WORKFLOWS.map((wf, i) => (
              <React.Fragment key={wf.id}>
                <WorkflowCard workflow={wf} index={i} isFlagship={i === 0} />
                {i < WORKFLOWS.length - 1 && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
                    <svg width="2" height="40" viewBox="0 0 2 40">
                      <line x1="1" y1="0" x2="1" y2="40" stroke={`rgba(${hexToRgb(WORKFLOWS[i].color)}, 0.3)`} strokeWidth="2" strokeDasharray="4 4" />
                      <circle cx="1" cy="0" r="2" fill={WORKFLOWS[i].color}>
                        <animate attributeName="cy" values="0;40" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                    </svg>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── Bottom CTA / Flagship callout ───────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: smoothEase, delay: 0.4 }}
          style={{ marginTop: 56, display: "flex", justifyContent: "center" }}
        >
          <div className="pipeline-flagship-callout" style={{
            display: "inline-flex", alignItems: "center", gap: 12,
            padding: "14px 28px", borderRadius: 14,
            background: "rgba(79,138,255,0.04)",
            border: "1px solid rgba(79,138,255,0.12)",
            backdropFilter: "blur(12px)",
          }}>
            {/* Animated pulse ring */}
            <div style={{ position: "relative", width: 12, height: 12 }}>
              <div style={{
                position: "absolute", inset: -2, borderRadius: "50%",
                border: "1.5px solid rgba(79,138,255,0.3)",
                animation: "ping-ring 2s cubic-bezier(0, 0, 0.2, 1) infinite",
              }} />
              <div style={{
                width: 12, height: 12, borderRadius: "50%", background: "#4F8AFF",
                boxShadow: "0 0 12px rgba(79,138,255,0.5)",
              }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#9898B0", lineHeight: 1.4 }}>
              <span style={{ color: "#4F8AFF", fontWeight: 700 }}>{t('landing.pipeline1Title')}</span>
              {" "}{t('landing.flagshipArriving')}
            </span>
          </div>
        </motion.div>
      </div>

      {/* CSS */}
      <style>{`
        .pipeline-cards-desktop { display: flex !important; }
        .pipeline-cards-mobile { display: none !important; }
        .pipeline-svg-desktop { display: block !important; }

        @media (max-width: 768px) {
          .pipeline-cards-desktop { display: none !important; }
          .pipeline-cards-mobile { display: flex !important; }
          .pipeline-svg-desktop { display: none !important; }

          /* Reduce section padding on mobile */
          #pipeline { padding: 80px 16px 60px !important; }

          /* Tighter card internal padding */
          .pipeline-cards-mobile .pipeline-card-header { padding: 12px 14px 0 !important; }
          .pipeline-cards-mobile .pipeline-card-scene { padding: 6px 8px 0 !important; }
          .pipeline-cards-mobile .pipeline-card-content { padding: 12px 14px 16px !important; }
          .pipeline-cards-mobile .pipeline-card-progress { padding: 10px 12px !important; }

          /* Slightly smaller title on mobile */
          .pipeline-cards-mobile h3 { font-size: 17px !important; }

          /* Flagship callout wrap-friendly */
          .pipeline-flagship-callout { padding: 12px 16px !important; }
          .pipeline-flagship-callout span { font-size: 13px !important; }
        }

        @media (max-width: 380px) {
          #pipeline { padding: 64px 12px 48px !important; }
        }

        @keyframes ping-ring {
          0% { transform: scale(1); opacity: 0.6; }
          75%, 100% { transform: scale(2.2); opacity: 0; }
        }

        @keyframes pipeline-flow {
          from { stroke-dashoffset: 28; }
          to { stroke-dashoffset: 0; }
        }

        .pipeline-flow-1, .pipeline-flow-2 {
          animation: pipeline-flow 1.5s linear infinite;
        }
      `}</style>
    </section>
  );
}
