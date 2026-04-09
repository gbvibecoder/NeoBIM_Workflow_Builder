"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useScroll, useTransform, useInView } from "framer-motion";
import {
  Play, Pause, X, Volume2, VolumeX, Maximize,
  ArrowRight, ChevronDown, Clock,
} from "lucide-react";
import CommunityVideoSection from "@/features/community/components/CommunityVideoSection";

// ─── Design Tokens ───────────────────────────────────────────────────────────

const C = {
  bg:        "#07070D",
  surface:   "#0B0B13",
  card:      "#0A0A14",
  elevated:  "#111120",
  cyan:      "#00F5FF",
  blue:      "#4F8AFF",
  purple:    "#8B5CF6",
  violet:    "#6366F1",
  green:     "#10B981",
  amber:     "#F59E0B",
  teal:      "#06B6D4",
  text:      "#F0F0F5",
  muted:     "#8898AA",
  dim:       "#4A5568",
  faint:     "#2D3748",
  border:    "rgba(255,255,255,0.06)",
};

const CAT_COLORS: Record<string, string> = {
  "Concept Design": C.blue,
  "Visualization":  C.purple,
  "Data & Export":   C.amber,
  "Floor Plans":    C.teal,
  "Full Pipeline":  C.cyan,
};

const NODE_COLORS: Record<string, string> = {
  input: "#3B82F6", transform: "#8B5CF6", generate: "#10B981", export: "#F59E0B",
};

const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];

function rgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "79,138,255";
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

// ─── Workflow Video Data ─────────────────────────────────────────────────────

const R2 = "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos";

interface WFVideo {
  id: string;
  title: string;
  subtitle: string;
  desc: string;
  category: string;
  duration: string;
  nodes: { label: string; cat: "input" | "transform" | "generate" | "export" }[];
  url: string;
  featured?: boolean;
  spec: string;
  /** Seconds into the video where results/output are shown — preview loops from here */
  previewStart: number;
}

const VIDEOS: WFVideo[] = [
  {
    id: "wv-01",
    title: "Text Prompt → Concept Building",
    subtitle: "From brief to 3D in 90 seconds",
    desc: "Type a building idea in plain English and watch AI generate a full building description, massing model, and concept visualization — all in one pipeline.",
    category: "Concept Design",
    duration: "1:32",
    nodes: [
      { label: "Text Prompt", cat: "input" },
      { label: "Brief Analyzer", cat: "transform" },
      { label: "Massing Generator", cat: "generate" },
    ],
    url: `${R2}/text-to-concept-building.mp4`,
    featured: true,
    spec: "3 Nodes · AI-Powered · ~90s",
    previewStart: 105,
  },
  {
    id: "wv-02",
    title: "2D Floor Plan → Interactive 3D Model",
    subtitle: "ML-powered spatial intelligence",
    desc: "Upload a 2D floor plan image and watch our CubiCasa ML pipeline detect walls, classify rooms, and generate a fully furnished interactive 3D model.",
    category: "Floor Plans",
    duration: "2:45",
    nodes: [
      { label: "Image Upload", cat: "input" },
      { label: "Floor Plan Analyzer", cat: "transform" },
      { label: "3D Model Builder", cat: "generate" },
    ],
    url: `${R2}/floor-plan-demo.mp4`,
    featured: true,
    spec: "3 Nodes · ML Vision · ~120s",
    previewStart: 0,
  },
  {
    id: "wv-03",
    title: "2D Floor Plan → 3D Video Renderings",
    subtitle: "Cinematic architecture walkthrough",
    desc: "Transform a 2D floor plan into stunning 3D video renderings — exterior pull-in, building orbit, interior walkthrough, all automated with Kling AI.",
    category: "Visualization",
    duration: "1:58",
    nodes: [
      { label: "Image Upload", cat: "input" },
      { label: "Floor Plan Analyzer", cat: "transform" },
      { label: "Render Generator", cat: "generate" },
      { label: "Video Generator", cat: "generate" },
    ],
    url: `${R2}/floorplan-to-3d-video.mp4`,
    spec: "4 Nodes · Kling AI · ~180s",
    previewStart: 65,
  },
  {
    id: "wv-04",
    title: "IFC Exporter",
    subtitle: "Industry-standard BIM delivery",
    desc: "Generate and export IFC files from your building concepts — proper entity classification, spatial hierarchy, and property sets for seamless BIM coordination.",
    category: "Data & Export",
    duration: "1:20",
    nodes: [
      { label: "Building Data", cat: "input" },
      { label: "IFC Compiler", cat: "transform" },
      { label: "IFC Export", cat: "export" },
    ],
    url: `${R2}/ifc-exporter.mp4`,
    spec: "3 Nodes · IFC4 · ~30s",
    previewStart: 120,
  },
  {
    id: "wv-05",
    title: "PDF Brief → 3D Rendered Video",
    subtitle: "Document to cinematic in one pipeline",
    desc: "Upload a project brief PDF and watch BuildFlow parse it, generate 3D massing, produce photorealistic renders, and deliver a cinematic video walkthrough.",
    category: "Full Pipeline",
    duration: "3:15",
    nodes: [
      { label: "PDF Upload", cat: "input" },
      { label: "Brief Parser", cat: "transform" },
      { label: "Brief Analyzer", cat: "transform" },
      { label: "Massing Generator", cat: "generate" },
      { label: "Render Generator", cat: "generate" },
      { label: "Video Generator", cat: "generate" },
    ],
    url: `${R2}/pdf-brief-to-3d-video.mp4`,
    featured: true,
    spec: "6 Nodes · End-to-End · ~300s",
    previewStart: 150,
  },
  {
    id: "wv-06",
    title: "Text Prompt → IFC",
    subtitle: "Natural language to BIM data",
    desc: "Describe a building in plain English and get a complete IFC file — AI handles program analysis, massing generation, and IFC compilation automatically.",
    category: "Data & Export",
    duration: "1:45",
    nodes: [
      { label: "Text Prompt", cat: "input" },
      { label: "Brief Analyzer", cat: "transform" },
      { label: "Massing Generator", cat: "generate" },
      { label: "IFC Export", cat: "export" },
    ],
    url: `${R2}/text-to-ifc.mp4`,
    spec: "4 Nodes · AI + IFC4 · ~60s",
    previewStart: 125,
  },
  {
    id: "wv-07",
    title: "Platform Introduction",
    subtitle: "The complete BuildFlow overview",
    desc: "A comprehensive walkthrough of the BuildFlow platform — the workflow canvas, AI-powered nodes, real-time execution, and how it fits into your AEC design process.",
    category: "Full Pipeline",
    duration: "4:30",
    nodes: [
      { label: "Text Prompt", cat: "input" },
      { label: "Brief Analyzer", cat: "transform" },
      { label: "Massing Generator", cat: "generate" },
      { label: "Render Generator", cat: "generate" },
      { label: "Video Generator", cat: "generate" },
      { label: "PDF Report", cat: "export" },
      { label: "IFC Export", cat: "export" },
    ],
    url: `${R2}/introduction.mp4`,
    spec: "7 Nodes · Full Platform · ~270s",
    previewStart: 200,
  },
];

// ─── Isometric Building SVG (unique per category) ────────────────────────────

function IsoScene({ category, color, animate: shouldAnimate }: { category: string; color: string; animate: boolean }) {
  const r = rgb(color);
  const o = shouldAnimate ? 1 : 0.4;

  // Concept Design: Isometric building with floors rising
  if (category === "Concept Design") {
    return (
      <svg viewBox="0 0 200 160" style={{ width: "100%", height: "100%" }}>
        <defs>
          <linearGradient id={`bld-${category}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        {/* Grid floor */}
        {[0,1,2,3,4,5,6].map(i => (
          <line key={`g${i}`} x1={60 + i * 12} y1={130} x2={90 + i * 12} y2={145} stroke={color} strokeWidth={0.3} opacity={0.15} />
        ))}
        {/* Building floors */}
        {[0,1,2,3,4,5,6].map(i => (
          <g key={i} opacity={o}>
            {/* Front face */}
            <rect x={80} y={120 - i * 14} width={40} height={12} fill={`url(#bld-${category})`} stroke={color} strokeWidth={0.5} rx={1}>
              {shouldAnimate && <animate attributeName="opacity" values="0;1" dur="0.4s" begin={`${i * 0.12}s`} fill="freeze" />}
            </rect>
            {/* Side face */}
            <polygon points={`120,${120 - i * 14} 140,${112 - i * 14} 140,${124 - i * 14} 120,${132 - i * 14}`} fill={`rgba(${r}, 0.1)`} stroke={color} strokeWidth={0.3}>
              {shouldAnimate && <animate attributeName="opacity" values="0;1" dur="0.4s" begin={`${i * 0.12}s`} fill="freeze" />}
            </polygon>
            {/* Top face */}
            <polygon points={`80,${120 - i * 14} 100,${112 - i * 14} 140,${112 - i * 14} 120,${120 - i * 14}`} fill={`rgba(${r}, 0.15)`} stroke={color} strokeWidth={0.3}>
              {shouldAnimate && <animate attributeName="opacity" values="0;1" dur="0.4s" begin={`${i * 0.12}s`} fill="freeze" />}
            </polygon>
            {/* Windows */}
            {[0,1,2].map(w => (
              <rect key={w} x={84 + w * 12} y={122 - i * 14} width={6} height={6} fill={color} opacity={0.15} rx={0.5} />
            ))}
          </g>
        ))}
        {/* Crane arm */}
        <line x1={70} y1={30} x2={70} y2={130} stroke={color} strokeWidth={0.5} opacity={0.12} />
        <line x1={40} y1={30} x2={100} y2={30} stroke={color} strokeWidth={0.5} opacity={0.12} />
        <line x1={70} y1={30} x2={85} y2={50} stroke={color} strokeWidth={0.3} opacity={0.1} strokeDasharray="2 2" />
      </svg>
    );
  }

  // Floor Plans: 2D plan view
  if (category === "Floor Plans") {
    return (
      <svg viewBox="0 0 200 160" style={{ width: "100%", height: "100%" }}>
        {/* Room outlines */}
        <rect x={40} y={30} width={120} height={100} fill="none" stroke={color} strokeWidth={1} opacity={0.2} />
        <line x1={40} y1={70} x2={100} y2={70} stroke={color} strokeWidth={0.8} opacity={0.15} />
        <line x1={100} y1={30} x2={100} y2={100} stroke={color} strokeWidth={0.8} opacity={0.15} />
        <line x1={100} y1={100} x2={160} y2={100} stroke={color} strokeWidth={0.8} opacity={0.15} />
        {/* Door arcs */}
        <path d={`M 100 70 A 12 12 0 0 1 112 70`} fill="none" stroke={color} strokeWidth={0.5} opacity={0.3} />
        <path d={`M 100 100 A 10 10 0 0 0 110 100`} fill="none" stroke={color} strokeWidth={0.5} opacity={0.3} />
        {/* Room labels */}
        <text x={60} y={55} fill={color} fontSize={6} opacity={0.3} fontFamily="monospace">LIVING</text>
        <text x={55} y={95} fill={color} fontSize={6} opacity={0.3} fontFamily="monospace">KITCHEN</text>
        <text x={115} y={55} fill={color} fontSize={6} opacity={0.3} fontFamily="monospace">BED 1</text>
        <text x={115} y={118} fill={color} fontSize={6} opacity={0.3} fontFamily="monospace">BATH</text>
        {/* Dimension lines */}
        <line x1={40} y1={140} x2={160} y2={140} stroke={color} strokeWidth={0.3} opacity={0.2} />
        <line x1={40} y1={137} x2={40} y2={143} stroke={color} strokeWidth={0.5} opacity={0.3} />
        <line x1={160} y1={137} x2={160} y2={143} stroke={color} strokeWidth={0.5} opacity={0.3} />
        <text x={90} y={148} fill={color} fontSize={5} opacity={0.25} fontFamily="monospace">12.0m</text>
        {/* Room fill on animate */}
        {shouldAnimate && (
          <>
            <rect x={41} y={31} width={58} height={38} fill={color} opacity={0.04}>
              <animate attributeName="opacity" values="0;0.06;0.04" dur="2s" repeatCount="indefinite" />
            </rect>
            <rect x={101} y={31} width={58} height={68} fill={color} opacity={0.03}>
              <animate attributeName="opacity" values="0;0.05;0.03" dur="2.5s" repeatCount="indefinite" />
            </rect>
          </>
        )}
        {/* North arrow */}
        <g transform="translate(170, 25)" opacity={0.2}>
          <line x1={0} y1={12} x2={0} y2={0} stroke={color} strokeWidth={0.8} />
          <polygon points="0,0 -3,5 3,5" fill={color} />
          <text x={-2} y={-3} fill={color} fontSize={5} fontFamily="monospace">N</text>
        </g>
      </svg>
    );
  }

  // Visualization: Camera path around building
  if (category === "Visualization") {
    return (
      <svg viewBox="0 0 200 160" style={{ width: "100%", height: "100%" }}>
        {/* Building silhouette */}
        <rect x={75} y={50} width={50} height={70} fill={`rgba(${r}, 0.05)`} stroke={color} strokeWidth={0.5} opacity={0.2} rx={1} />
        <rect x={80} y={40} width={40} height={10} fill={`rgba(${r}, 0.03)`} stroke={color} strokeWidth={0.3} opacity={0.15} />
        {/* Camera orbit path */}
        <ellipse cx={100} cy={90} rx={70} ry={35} fill="none" stroke={color} strokeWidth={0.5} opacity={0.12} strokeDasharray="4 4" />
        {/* Camera icon moving on path */}
        <g>
          <circle r={4} fill={color} opacity={0.4}>
            <animateMotion dur="6s" repeatCount="indefinite" path="M100,90 m-70,0 a70,35 0 1,0 140,0 a70,35 0 1,0 -140,0" />
          </circle>
          <circle r={8} fill={color} opacity={0.08}>
            <animateMotion dur="6s" repeatCount="indefinite" path="M100,90 m-70,0 a70,35 0 1,0 140,0 a70,35 0 1,0 -140,0" />
          </circle>
        </g>
        {/* Light rays from camera */}
        <line x1={100} y1={90} x2={100} y2={65} stroke={color} strokeWidth={0.3} opacity={0.06} />
        {/* Film frames */}
        {[0,1,2,3].map(i => (
          <rect key={i} x={30 + i * 40} y={140} width={20} height={12} rx={1} fill="none" stroke={color} strokeWidth={0.3} opacity={0.1} />
        ))}
      </svg>
    );
  }

  // Data & Export: IFC/Data tree
  if (category === "Data & Export") {
    return (
      <svg viewBox="0 0 200 160" style={{ width: "100%", height: "100%" }}>
        {/* Tree hierarchy */}
        <g opacity={0.25}>
          {/* Root */}
          <rect x={85} y={20} width={30} height={14} rx={2} fill={`rgba(${r}, 0.1)`} stroke={color} strokeWidth={0.5} />
          <text x={92} y={30} fill={color} fontSize={5} fontFamily="monospace">IFC</text>
          {/* Level 1 */}
          <line x1={100} y1={34} x2={100} y2={45} stroke={color} strokeWidth={0.3} />
          <line x1={60} y1={45} x2={140} y2={45} stroke={color} strokeWidth={0.3} />
          {[60, 100, 140].map((x, i) => (
            <g key={i}>
              <line x1={x} y1={45} x2={x} y2={55} stroke={color} strokeWidth={0.3} />
              <rect x={x - 15} y={55} width={30} height={12} rx={2} fill={`rgba(${r}, 0.06)`} stroke={color} strokeWidth={0.4} />
              <text x={x - 10} y={63} fill={color} fontSize={4} fontFamily="monospace">{["SITE", "BLDG", "STRY"][i]}</text>
            </g>
          ))}
          {/* Level 2 branches */}
          {[45, 75, 125, 155].map((x, i) => (
            <g key={`l2-${i}`}>
              <line x1={[60, 60, 140, 140][i]} y1={67} x2={x} y2={80} stroke={color} strokeWidth={0.2} />
              <rect x={x - 12} y={80} width={24} height={10} rx={1} fill={`rgba(${r}, 0.04)`} stroke={color} strokeWidth={0.3} />
              <text x={x - 8} y={87} fill={color} fontSize={3.5} fontFamily="monospace">{["WALL", "SLAB", "BEAM", "COL."][i]}</text>
            </g>
          ))}
          {/* Data flow particles */}
          {shouldAnimate && [0, 1, 2].map(i => (
            <circle key={`p${i}`} r={1.5} fill={color} opacity={0.5}>
              <animateMotion dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" begin={`${i * 0.5}s`} path="M100,34 L100,45 L60,45 L60,55" />
              <animate attributeName="opacity" values="0;0.6;0" dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" begin={`${i * 0.5}s`} />
            </circle>
          ))}
        </g>
        {/* Brackets */}
        <text x={25} y={90} fill={color} fontSize={40} opacity={0.04} fontFamily="monospace">{"{"}</text>
        <text x={160} y={90} fill={color} fontSize={40} opacity={0.04} fontFamily="monospace">{"}"}</text>
      </svg>
    );
  }

  // Full Pipeline: Connected workflow nodes
  return (
    <svg viewBox="0 0 200 160" style={{ width: "100%", height: "100%" }}>
      {/* Pipeline nodes */}
      {[
        { x: 20, y: 80, c: "#3B82F6", l: "IN" },
        { x: 55, y: 50, c: "#8B5CF6", l: "TR" },
        { x: 55, y: 110, c: "#8B5CF6", l: "TR" },
        { x: 100, y: 80, c: "#10B981", l: "GN" },
        { x: 145, y: 50, c: "#10B981", l: "GN" },
        { x: 145, y: 110, c: "#F59E0B", l: "EX" },
        { x: 180, y: 80, c: "#F59E0B", l: "EX" },
      ].map((n, i) => (
        <g key={i} opacity={0.3}>
          <circle cx={n.x} cy={n.y} r={12} fill={`rgba(${rgb(n.c)}, 0.08)`} stroke={n.c} strokeWidth={0.5} />
          <circle cx={n.x} cy={n.y} r={3} fill={n.c} opacity={0.5}>
            {shouldAnimate && <animate attributeName="opacity" values="0.3;0.8;0.3" dur={`${1.5 + i * 0.2}s`} repeatCount="indefinite" />}
          </circle>
          <text x={n.x - 5} y={n.y + 22} fill={n.c} fontSize={4} fontFamily="monospace" opacity={0.5}>{n.l}</text>
        </g>
      ))}
      {/* Connections */}
      {[
        "M20,80 Q37,65 55,50", "M20,80 Q37,95 55,110",
        "M55,50 Q77,65 100,80", "M55,110 Q77,95 100,80",
        "M100,80 Q122,65 145,50", "M100,80 Q122,95 145,110",
        "M145,50 Q162,65 180,80", "M145,110 Q162,95 180,80",
      ].map((d, i) => (
        <path key={i} d={d} fill="none" stroke={[C.blue, C.blue, C.purple, C.purple, C.green, C.green, C.amber, C.amber][i]}
          strokeWidth={0.5} opacity={0.12} strokeDasharray="3 4" className="wire-animate" />
      ))}
    </svg>
  );
}

// ─── Compass Rose ────────────────────────────────────────────────────────────

function CompassRose({ color }: { color: string }) {
  return (
    <svg width={28} height={28} viewBox="0 0 28 28">
      <circle cx={14} cy={14} r={12} fill="none" stroke={color} strokeWidth={0.5} opacity={0.2} />
      <line x1={14} y1={3} x2={14} y2={25} stroke={color} strokeWidth={0.3} opacity={0.15} />
      <line x1={3} y1={14} x2={25} y2={14} stroke={color} strokeWidth={0.3} opacity={0.15} />
      <polygon points="14,3 12,8 16,8" fill={color} opacity={0.3} />
      <text x={12} y={1} fill={color} fontSize={4} fontFamily="monospace" opacity={0.4}>N</text>
    </svg>
  );
}

// ─── Corner Registration Marks ───────────────────────────────────────────────

function CornerMarks({ color }: { color: string }) {
  const o = 0.2;
  return (
    <>
      <svg style={{ position: "absolute", top: -1, left: -1, pointerEvents: "none" }} width={14} height={14}>
        <path d="M0 14 L0 0 L14 0" stroke={color} strokeWidth={1.5} fill="none" opacity={o} />
      </svg>
      <svg style={{ position: "absolute", top: -1, right: -1, pointerEvents: "none" }} width={14} height={14}>
        <path d="M0 0 L14 0 L14 14" stroke={color} strokeWidth={1.5} fill="none" opacity={o} />
      </svg>
      <svg style={{ position: "absolute", bottom: -1, left: -1, pointerEvents: "none" }} width={14} height={14}>
        <path d="M0 0 L0 14 L14 14" stroke={color} strokeWidth={1.5} fill="none" opacity={o} />
      </svg>
      <svg style={{ position: "absolute", bottom: -1, right: -1, pointerEvents: "none" }} width={14} height={14}>
        <path d="M14 0 L14 14 L0 14" stroke={color} strokeWidth={1.5} fill="none" opacity={o} />
      </svg>
    </>
  );
}

// ─── Live Preview Video Card ─────────────────────────────────────────────────

function VideoCard({
  video, onPlay, span,
}: {
  video: WFVideo;
  onPlay: (v: WFVideo) => void;
  span: "hero" | "wide" | "normal";
}) {
  const color = CAT_COLORS[video.category] || C.blue;
  const r = rgb(color);
  const [hovered, setHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inView = useInView(cardRef, { once: false, margin: "-10%" });

  // Set preview start time once metadata is loaded
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => { v.currentTime = video.previewStart; };
    v.addEventListener("loadedmetadata", onLoaded);
    // If already loaded (cached), set immediately
    if (v.readyState >= 1) v.currentTime = video.previewStart;
    return () => v.removeEventListener("loadedmetadata", onLoaded);
  }, [video.previewStart]);

  // Loop back to previewStart instead of beginning
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => { v.currentTime = video.previewStart; v.play().catch(() => {}); };
    v.addEventListener("ended", onEnded);
    return () => v.removeEventListener("ended", onEnded);
  }, [video.previewStart]);

  // Auto-play when in view, pause when out
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (inView) {
      if (v.currentTime < video.previewStart) v.currentTime = video.previewStart;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [inView, video.previewStart]);

  const isHero = span === "hero";
  const isWide = span === "wide" || isHero;

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 60 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onPlay(video)}
      className={`wf-card wf-card-${span}`}
      style={{
        position: "relative",
        background: C.card,
        borderRadius: 3,
        overflow: "hidden",
        cursor: "pointer",
        border: `1px solid ${hovered ? `rgba(${r}, 0.2)` : C.border}`,
        boxShadow: hovered
          ? `0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgba(${r}, 0.05)`
          : `0 4px 24px rgba(0,0,0,0.3)`,
        transition: "border-color 0.4s, box-shadow 0.4s, transform 0.5s",
        transform: hovered ? "translateY(-6px) scale(1.005)" : "translateY(0) scale(1)",
      }}
    >
      <CornerMarks color={color} />

      {/* ── Video Viewport ── */}
      <div className="wf-video-viewport" style={{
        position: "relative",
        aspectRatio: isHero ? "21/9" : isWide ? "2/1" : "16/10",
        overflow: "hidden",
        background: "#000",
      }}>
        {/* Live video preview */}
        <video
          ref={videoRef}
          src={video.url}
          muted
          playsInline
          preload="metadata"
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover",
            opacity: hovered ? 0.7 : 0.35,
            transition: "opacity 0.5s ease, filter 0.5s ease",
            filter: hovered ? "brightness(1.1) saturate(1.1)" : "brightness(0.8) saturate(0.7)",
          }}
        />

        {/* Isometric SVG scene overlay (fades on hover) */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 2,
          opacity: hovered ? 0 : 0.6,
          transition: "opacity 0.5s ease",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: isHero ? "10% 30%" : "10% 15%",
        }}>
          <IsoScene category={video.category} color={color} animate={inView} />
        </div>

        {/* Blueprint grid overlay */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none",
          backgroundImage: `
            linear-gradient(rgba(${r}, ${hovered ? 0.01 : 0.025}) 1px, transparent 1px),
            linear-gradient(90deg, rgba(${r}, ${hovered ? 0.01 : 0.025}) 1px, transparent 1px)
          `,
          backgroundSize: "24px 24px",
          transition: "opacity 0.4s",
        }} />

        {/* Cross-hair center mark */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 3, pointerEvents: "none",
          opacity: hovered ? 0 : 0.1,
          transition: "opacity 0.3s",
        }}>
          <svg width={60} height={60} viewBox="0 0 60 60">
            <line x1={30} y1={0} x2={30} y2={25} stroke={color} strokeWidth={0.5} />
            <line x1={30} y1={35} x2={30} y2={60} stroke={color} strokeWidth={0.5} />
            <line x1={0} y1={30} x2={25} y2={30} stroke={color} strokeWidth={0.5} />
            <line x1={35} y1={30} x2={60} y2={30} stroke={color} strokeWidth={0.5} />
            <circle cx={30} cy={30} r={10} fill="none" stroke={color} strokeWidth={0.5} />
          </svg>
        </div>

        {/* Compass rose (top right) */}
        <div style={{
          position: "absolute", top: 10, right: 10, zIndex: 4,
          opacity: hovered ? 0 : 0.5,
          transition: "opacity 0.3s",
        }}>
          <CompassRose color={color} />
        </div>

        {/* Category & duration badges */}
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 5,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <div style={{
            padding: "3px 10px", borderRadius: 3,
            background: `rgba(0,0,0,0.5)`,
            backdropFilter: "blur(12px)",
            border: `1px solid rgba(${r}, 0.2)`,
            fontSize: 9, fontWeight: 700, color,
            fontFamily: "var(--font-jetbrains), monospace",
            letterSpacing: "1px", textTransform: "uppercase",
          }}>
            {video.category}
          </div>
          {video.featured && (
            <div style={{
              padding: "3px 7px", borderRadius: 3,
              background: "linear-gradient(135deg, #F59E0B, #F97316)",
              fontSize: 7, fontWeight: 800, color: "#000",
              letterSpacing: "1px",
            }}>
              FEATURED
            </div>
          )}
        </div>

        {/* Duration badge bottom-right */}
        <div style={{
          position: "absolute", bottom: 10, right: 10, zIndex: 5,
          padding: "3px 8px", borderRadius: 3,
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", gap: 4,
          fontSize: 10, fontWeight: 600, color: C.text,
          fontFamily: "var(--font-jetbrains), monospace",
        }}>
          <Clock size={9} />
          {video.duration}
        </div>

        {/* Dimension annotation (hover) */}
        <div style={{
          position: "absolute", bottom: 10, left: 10, right: 80, zIndex: 5,
          display: "flex", alignItems: "center", gap: 0,
          opacity: hovered ? 0.6 : 0,
          transition: "opacity 0.3s",
        }}>
          <div style={{ width: 1, height: 6, background: `rgba(${r}, 0.4)` }} />
          <div style={{ flex: 1, height: 1, background: `rgba(${r}, 0.2)` }} />
          <span style={{
            fontSize: 7, color, padding: "0 6px",
            fontFamily: "var(--font-jetbrains), monospace",
            whiteSpace: "nowrap",
          }}>
            {video.spec}
          </span>
          <div style={{ flex: 1, height: 1, background: `rgba(${r}, 0.2)` }} />
          <div style={{ width: 1, height: 6, background: `rgba(${r}, 0.4)` }} />
        </div>

        {/* Play button */}
        <motion.div
          animate={{
            scale: hovered ? 1.15 : 0.9,
            opacity: hovered ? 1 : 0,
          }}
          transition={{ duration: 0.3 }}
          style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 6,
            width: isHero ? 80 : 56, height: isHero ? 80 : 56,
            borderRadius: "50%",
            background: `rgba(${r}, 0.15)`,
            backdropFilter: "blur(20px)",
            border: `2px solid rgba(${r}, 0.35)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 50px rgba(${r}, 0.3)`,
          }}
        >
          <Play size={isHero ? 32 : 22} fill={color} color={color} style={{ marginLeft: 3 }} />
        </motion.div>

        {/* Scan beam (hover) */}
        {hovered && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none",
            overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", left: 0, right: 0, height: 1,
              background: `linear-gradient(90deg, transparent, rgba(${r}, 0.5), transparent)`,
              animation: "scan-beam 4s linear infinite",
            }} />
          </div>
        )}

        {/* Bottom gradient to content */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: isHero ? 140 : 80,
          background: `linear-gradient(transparent, ${C.card})`,
          zIndex: 3,
        }} />
      </div>

      {/* ── Content Area ── */}
      <div className="wf-card-content" style={{ padding: isHero ? "20px 24px 8px" : "14px 16px 6px" }}>
        <h3 style={{
          fontSize: isHero ? 24 : isWide ? 18 : 15,
          fontWeight: 700, color: C.text, margin: 0, marginBottom: 3,
          letterSpacing: "-0.02em",
          fontFamily: "var(--font-syne), sans-serif",
        }}>
          {video.title}
        </h3>
        <p style={{
          fontSize: isHero ? 14 : 11,
          color, fontWeight: 600, margin: 0, marginBottom: 8,
        }}>
          {video.subtitle}
        </p>
        <p style={{
          fontSize: isHero ? 13 : 11, color: C.muted, lineHeight: 1.6, margin: 0, marginBottom: 12,
          display: "-webkit-box", WebkitLineClamp: isHero ? 3 : 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {video.desc}
        </p>

        {/* Node pipeline */}
        <div style={{
          display: "flex", alignItems: "center", gap: 0, overflow: "auto",
          scrollbarWidth: "none", paddingBottom: 4,
        }}>
          {video.nodes.map((node, i) => {
            const nc = NODE_COLORS[node.cat];
            return (
              <div key={i} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && (
                  <div style={{
                    width: 16, height: 1,
                    background: `linear-gradient(90deg, ${NODE_COLORS[video.nodes[i-1].cat]}, ${nc})`,
                    opacity: 0.3,
                  }} />
                )}
                <div style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 7px", borderRadius: 4,
                  background: `rgba(${rgb(nc)}, 0.06)`,
                  border: `1px solid rgba(${rgb(nc)}, 0.12)`,
                }}>
                  <div style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: nc, boxShadow: `0 0 6px ${nc}`,
                  }} />
                  <span style={{
                    fontSize: 8, fontWeight: 600, color: nc,
                    fontFamily: "var(--font-jetbrains), monospace",
                    textTransform: "uppercase", letterSpacing: "0.3px",
                    whiteSpace: "nowrap",
                  }}>
                    {node.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Title Block Footer ── */}
      <div className="wf-card-footer" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderTop: `1px solid rgba(${r}, 0.08)`,
        padding: "5px 12px",
        fontSize: 8, fontFamily: "var(--font-jetbrains), monospace", color: C.dim,
      }}>
        <div style={{ display: "flex", gap: 12 }}>
          <span>DWG: <span style={{ color }}>BF-{video.id.toUpperCase()}</span></span>
          <span className="wf-meta-extra">REV: A</span>
          <span className="wf-meta-extra">SCALE: NTS</span>
        </div>
        <span style={{ color: C.muted }}>{video.duration}</span>
      </div>

      {/* Bottom accent */}
      <div style={{
        height: 2,
        background: `linear-gradient(90deg, transparent 10%, ${color} 50%, transparent 90%)`,
        opacity: hovered ? 0.5 : 0.06,
        transition: "opacity 0.4s",
      }} />
    </motion.div>
  );
}

// ─── Section Marker (A——A) ───────────────────────────────────────────────────

function SectionMarker({ label, color }: { label: string; color: string }) {
  return (
    <div className="wf-section-marker" style={{
      display: "flex", alignItems: "center", gap: 16, width: "100%", padding: "0 24px",
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: "50%",
        border: `1.5px solid rgba(${rgb(color)}, 0.35)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700, color,
        fontFamily: "var(--font-jetbrains), monospace",
        flexShrink: 0,
      }}>{label}</div>
      <div style={{
        flex: 1, height: 1,
        background: `linear-gradient(90deg, rgba(${rgb(color)}, 0.25), rgba(${rgb(color)}, 0.05))`,
      }} />
      <div style={{
        width: 24, height: 24, borderRadius: "50%",
        border: `1.5px solid rgba(${rgb(color)}, 0.35)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700, color,
        fontFamily: "var(--font-jetbrains), monospace",
        flexShrink: 0,
      }}>{label}</div>
    </div>
  );
}

// ─── Fullscreen Video Modal ──────────────────────────────────────────────────

function VideoModal({ video, onClose }: { video: WFVideo; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showUI, setShowUI] = useState(true);
  const hideRef = useRef<ReturnType<typeof setTimeout>>(null);
  const color = CAT_COLORS[video.category] || C.blue;
  const r = rgb(color);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }, []);

  const onMove = useCallback(() => {
    setShowUI(true);
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => { if (playing) setShowUI(false); }, 3000);
  }, [playing]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose, toggle]);

  const seek = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    v.currentTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * v.duration;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onMouseMove={onMove}
      onTouchStart={onMove}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.94)",
        backdropFilter: "blur(32px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
      }}
    >
      <motion.button
        className="wf-modal-close"
        animate={{ opacity: showUI ? 1 : 0 }}
        onClick={onClose}
        style={{
          position: "absolute", top: 20, right: 20, zIndex: 10,
          width: 44, height: 44, borderRadius: 10,
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: C.text,
        }}
      >
        <X size={18} />
      </motion.button>

      <motion.div
        className="wf-modal-title"
        animate={{ opacity: showUI ? 1 : 0 }}
        style={{
          position: "absolute", top: 20, left: 24, zIndex: 10,
          display: "flex", alignItems: "center", gap: 12,
        }}
      >
        <div style={{
          padding: "3px 10px", borderRadius: 4,
          background: `rgba(${r}, 0.12)`, border: `1px solid rgba(${r}, 0.25)`,
          fontSize: 9, fontWeight: 700, color, letterSpacing: "1px", textTransform: "uppercase",
          fontFamily: "var(--font-jetbrains), monospace",
        }}>
          {video.category}
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text, fontFamily: "var(--font-syne), sans-serif" }}>
          {video.title}
        </span>
      </motion.div>

      <motion.div
        className="wf-modal-container"
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.5, ease }}
        style={{
          width: "88vw", maxWidth: 1100,
          borderRadius: 4, overflow: "hidden",
          border: `1px solid rgba(${r}, 0.12)`,
          boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 80px rgba(${r}, 0.05)`,
          position: "relative",
        }}
      >
        <CornerMarks color={color} />
        <video
          ref={videoRef} src={video.url} muted={muted} playsInline onClick={toggle}
          onTimeUpdate={() => { const v = videoRef.current; if (v && v.duration) setProgress((v.currentTime / v.duration) * 100); }}
          onEnded={() => setPlaying(false)}
          style={{ width: "100%", maxHeight: "78vh", display: "block", background: "#000", cursor: "pointer", objectFit: "contain" }}
        />
        <AnimatePresence>
          {!playing && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={toggle}
              style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(0,0,0,0.25)", cursor: "pointer",
              }}
            >
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: `rgba(${r}, 0.15)`, backdropFilter: "blur(16px)",
                border: `2px solid rgba(${r}, 0.35)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `0 0 50px rgba(${r}, 0.3)`,
              }}>
                <Play size={30} fill={color} color={color} style={{ marginLeft: 3 }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          className="wf-modal-controls"
          animate={{ opacity: showUI ? 1 : 0 }}
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
            padding: "28px 16px 10px",
          }}
        >
          <div onClick={seek} onTouchStart={seek} style={{
            height: 6, borderRadius: 3, cursor: "pointer",
            background: "rgba(255,255,255,0.12)", marginBottom: 10,
          }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${color}, ${C.cyan})`,
              transition: "width 0.1s linear",
            }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={toggle} style={{ background: "none", border: "none", cursor: "pointer", color: C.text, display: "flex", padding: 4 }}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={() => { if (videoRef.current) { videoRef.current.muted = !muted; setMuted(!muted); } }}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.text, display: "flex", padding: 4 }}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <span style={{ fontSize: 10, color: C.dim, fontFamily: "var(--font-jetbrains), monospace" }}>{video.duration}</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => videoRef.current?.requestFullscreen?.()} style={{ background: "none", border: "none", cursor: "pointer", color: C.text, display: "flex", padding: 4 }}>
              <Maximize size={16} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ─── Hero Background ─────────────────────────────────────────────────────────

function HeroBG() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div className="blueprint-grid" style={{ opacity: 0.4 }} />
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <linearGradient id="hw-h" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={C.cyan} stopOpacity={0} />
            <stop offset="50%" stopColor={C.cyan} stopOpacity={0.1} />
            <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[180, 320, 460].map((y, i) => (
          <line key={i} x1="0" y1={y} x2="100%" y2={y} stroke="url(#hw-h)" strokeWidth={0.5} />
        ))}
        {["20%", "40%", "60%", "80%"].map((x, i) => (
          <line key={`v${i}`} x1={x} y1="0" x2={x} y2="100%" stroke={C.purple} strokeWidth={0.3} opacity={0.04} />
        ))}
        {[
          { cx: "15%", cy: "30%", c: C.blue }, { cx: "85%", cy: "25%", c: C.purple },
          { cx: "30%", cy: "70%", c: C.green }, { cx: "70%", cy: "75%", c: C.amber },
          { cx: "50%", cy: "50%", c: C.cyan },
        ].map((n, i) => (
          <circle key={i} cx={n.cx} cy={n.cy} r={3} fill={n.c} opacity={0.12}>
            <animate attributeName="opacity" values="0.06;0.2;0.06" dur={`${3 + i}s`} repeatCount="indefinite" />
            <animate attributeName="r" values="2;4;2" dur={`${3 + i}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </svg>
      <div style={{ position: "absolute", top: "5%", left: "10%", width: 600, height: 600, background: `radial-gradient(circle, rgba(${rgb(C.blue)}, 0.05), transparent 70%)`, borderRadius: "50%", filter: "blur(80px)" }} />
      <div style={{ position: "absolute", bottom: "10%", right: "5%", width: 500, height: 500, background: `radial-gradient(circle, rgba(${rgb(C.purple)}, 0.04), transparent 70%)`, borderRadius: "50%", filter: "blur(80px)" }} />
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 60% at 50% 45%, transparent, ${C.bg})` }} />
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function WorkflowShowcasePage() {
  const [activeVideo, setActiveVideo] = useState<WFVideo | null>(null);
  const [filter, setFilter] = useState("All");
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 0.7], [0, -60]);

  const cats = ["All", ...Array.from(new Set(VIDEOS.map(v => v.category)))];
  const filtered = filter === "All" ? VIDEOS : VIDEOS.filter(v => v.category === filter);
  const heroVideo = VIDEOS.find(v => v.id === "wv-07")!;

  // Assign card spans based on position
  const getSpan = (index: number, isFiltered: boolean): "hero" | "wide" | "normal" => {
    if (!isFiltered) return "normal";
    if (index === 0) return "hero";
    if (index === 3 || index === 6) return "wide";
    return "normal";
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, overflowX: "hidden" }}>

      {/* ── Navbar ── */}
      <header>
        <nav style={{
          display: "flex", alignItems: "center",
          padding: "0 max(16px, min(48px, 4vw))", height: 56,
          background: "rgba(7,7,13,0.8)",
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9000,
          backdropFilter: "blur(20px) saturate(1.2)",
          borderBottom: `1px solid ${C.border}`,
        }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", marginRight: "auto" }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, overflow: "hidden", boxShadow: "0 2px 10px rgba(79,138,255,0.2)", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/buildflow_logo.png" alt="BuildFlow" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: "-0.3px" }}>
              Build<span style={{ color: C.blue }}>Flow</span>
            </span>
          </Link>
          <div className="wf-nav-links" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Link href="/" className="wf-nav-text" style={{ fontSize: 12, color: C.muted, textDecoration: "none", fontWeight: 500, padding: "6px 14px", borderRadius: 6 }}>Home</Link>
            <Link href="/demo" className="wf-nav-text" style={{ fontSize: 12, color: C.muted, textDecoration: "none", fontWeight: 500, padding: "6px 14px", borderRadius: 6 }}>Demo</Link>
            <Link href="/dashboard" style={{ padding: "7px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "white", background: "linear-gradient(135deg, #4F8AFF, #6366F1)", textDecoration: "none", boxShadow: "0 2px 10px rgba(79,138,255,0.25)" }}>
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <motion.section
          ref={heroRef}
          style={{
            minHeight: "100vh", position: "relative",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            overflow: "hidden", opacity: heroOpacity, y: heroY,
          }}
        >
          <HeroBG />
          <div style={{
            position: "absolute", inset: 0, zIndex: 1, opacity: 0.06, overflow: "hidden",
          }}>
            <video src={heroVideo.url} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(3px) saturate(0.3)" }} />
          </div>
          <div className="wf-hero-content" style={{ position: "relative", zIndex: 10, textAlign: "center", maxWidth: 900, padding: "80px 24px 0" }}>
            <motion.div initial={{ opacity: 0, width: "0%" }} animate={{ opacity: 1, width: "100%" }} transition={{ duration: 1.2, delay: 0.2, ease }} style={{ marginBottom: 40, overflow: "hidden" }}>
              <SectionMarker label="A" color={C.cyan} />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4, ease }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "4px", color: C.dim, textTransform: "uppercase", fontFamily: "var(--font-jetbrains), monospace", marginBottom: 16 }}>
                BUILDFLOW WORKFLOW SHOWCASE
              </div>
              <h1 style={{ fontSize: "clamp(2.4rem, 6vw, 4.5rem)", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.05, margin: 0, fontFamily: "var(--font-syne), sans-serif" }}>
                <span style={{ color: C.text }}>Architect the</span><br />
                <span style={{ background: `linear-gradient(135deg, ${C.cyan} 0%, ${C.blue} 40%, ${C.purple} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", display: "inline-block" }}>
                  Impossible
                </span>
              </h1>
            </motion.div>
            <motion.div className="wf-hero-stats" initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ duration: 0.8, delay: 0.8, ease }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, margin: "20px 0 24px" }}>
              <div style={{ width: 60, height: 1, background: `rgba(${rgb(C.cyan)}, 0.2)` }} />
              <span style={{ fontSize: 11, color: C.muted, fontFamily: "var(--font-jetbrains), monospace", letterSpacing: "2px" }}>
                7 WORKFLOWS · 24+ AI NODES · REAL-TIME
              </span>
              <div style={{ width: 60, height: 1, background: `rgba(${rgb(C.cyan)}, 0.2)` }} />
            </motion.div>
            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 1, ease }} style={{ fontSize: "clamp(0.95rem, 1.5vw, 1.1rem)", color: C.muted, lineHeight: 1.7, margin: "0 auto 40px", maxWidth: 560 }}>
              Watch every pipeline in action — from a single text prompt to full 3D walkthroughs, IFC exports, and cinematic renders. This is AEC design, reimagined.
            </motion.p>
            <motion.div className="wf-hero-btns" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 1.2, ease }} style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 60 }}>
              <button onClick={() => setActiveVideo(heroVideo)} style={{ padding: "12px 28px", borderRadius: 8, fontSize: 14, fontWeight: 700, color: "#000", border: "none", cursor: "pointer", background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`, boxShadow: `0 4px 24px rgba(${rgb(C.cyan)}, 0.3)`, display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-dm-sans), sans-serif" }}>
                <Play size={16} fill="#000" /> Watch Introduction
              </button>
              <a href="#gallery" style={{ padding: "12px 28px", borderRadius: 8, fontSize: 14, fontWeight: 600, color: C.text, textDecoration: "none", background: "rgba(255,255,255,0.04)", border: `1px solid rgba(255,255,255,0.08)`, display: "flex", alignItems: "center", gap: 8 }}>
                Browse All <ChevronDown size={14} />
              </a>
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 1.5 }}>
              <SectionMarker label="A" color={C.cyan} />
            </motion.div>
          </div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} transition={{ delay: 2 }} style={{ position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: C.dim, letterSpacing: "3px", fontFamily: "var(--font-jetbrains), monospace" }}>SCROLL</span>
            <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
              <ChevronDown size={14} color={C.dim} />
            </motion.div>
          </motion.div>
        </motion.section>

        {/* ── Filter ── */}
        <section id="gallery" style={{
          position: "sticky", top: 56, zIndex: 100,
          background: "rgba(7,7,13,0.92)", backdropFilter: "blur(16px) saturate(1.2)",
          borderBottom: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`,
        }}>
          <div className="wf-filter-scroll" style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: 6, overflowX: "auto" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.dim, letterSpacing: "2px", marginRight: 8, flexShrink: 0, fontFamily: "var(--font-jetbrains), monospace" }}>FILTER</span>
            {cats.map(cat => {
              const active = cat === filter;
              const cc = cat === "All" ? C.cyan : (CAT_COLORS[cat] || C.blue);
              const cr = rgb(cc);
              return (
                <button key={cat} onClick={() => setFilter(cat)} style={{
                  padding: "5px 12px", borderRadius: 4, cursor: "pointer",
                  fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
                  fontFamily: "var(--font-jetbrains), monospace",
                  letterSpacing: "0.5px", textTransform: "uppercase",
                  border: `1px solid ${active ? `rgba(${cr}, 0.3)` : "transparent"}`,
                  background: active ? `rgba(${cr}, 0.08)` : "transparent",
                  color: active ? cc : C.dim, transition: "all 0.2s",
                }}>
                  {cat}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Gallery: Bento Layout ── */}
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px 60px" }}>
          <div className="wf-bento">
            <AnimatePresence mode="popLayout">
              {filtered.map((video, i) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  onPlay={setActiveVideo}
                  span={getSpan(i, filter === "All")}
                />
              ))}
            </AnimatePresence>
          </div>
        </section>

        {/* ── Community Showcase ── */}
        <CommunityVideoSection />

        {/* ── CTA ── */}
        <section className="wf-cta" style={{ position: "relative", overflow: "hidden", padding: "80px 24px 100px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 60% 50% at 50% 100%, rgba(${rgb(C.cyan)}, 0.04), transparent)` }} />
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease }}
            style={{ position: "relative", zIndex: 1, maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
            <SectionMarker label="B" color={C.green} />
            <h2 style={{ fontSize: "clamp(1.5rem, 3vw, 2.2rem)", fontWeight: 800, letterSpacing: "-0.03em", margin: "28px 0 12px", fontFamily: "var(--font-syne), sans-serif" }}>
              Build Your Own{" "}
              <span style={{ background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Pipeline</span>
            </h2>
            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 28 }}>
              Start with any workflow or design from scratch. No coding — just drag, connect, and run.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
              <Link href="/demo" style={{ padding: "11px 24px", borderRadius: 8, fontSize: 14, fontWeight: 700, color: "#000", background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`, textDecoration: "none", boxShadow: `0 4px 20px rgba(${rgb(C.cyan)}, 0.25)`, display: "flex", alignItems: "center", gap: 8 }}>
                <Play size={14} fill="#000" /> Try Live Demo
              </Link>
              <Link href="/dashboard" style={{ padding: "11px 24px", borderRadius: 8, fontSize: 14, fontWeight: 600, color: C.text, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
                Start Building <ArrowRight size={14} />
              </Link>
            </div>
            <div style={{ marginTop: 28 }}><SectionMarker label="B" color={C.green} /></div>
          </motion.div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="wf-footer" style={{ borderTop: `1px solid ${C.border}`, padding: "24px 48px", background: "rgba(7,7,13,0.95)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/buildflow_logo.png" alt="BuildFlow" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span style={{ fontSize: 11, color: C.dim, fontWeight: 600 }}>&copy; 2026 BuildFlow</span>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            {[{ l: "Privacy", h: "/privacy" }, { l: "Terms", h: "/terms" }, { l: "Contact", h: "/contact" }].map(x => (
              <Link key={x.h} href={x.h} style={{ fontSize: 11, color: C.dim, textDecoration: "none" }}>{x.l}</Link>
            ))}
          </div>
        </div>
      </footer>

      {/* ── Modal ── */}
      <AnimatePresence>
        {activeVideo && <VideoModal video={activeVideo} onClose={() => setActiveVideo(null)} />}
      </AnimatePresence>

      {/* ── Styles ── */}
      <style>{`
        /* ── Base Grid ── */
        .wf-bento {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        .wf-card-hero { grid-column: 1 / -1 !important; }
        .wf-card-wide { grid-column: span 2 !important; }

        /* ── Scrollbar hide for filter ── */
        .wf-filter-scroll {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .wf-filter-scroll::-webkit-scrollbar { display: none; }

        @keyframes flowParticle {
          0%   { left: 0; opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }

        /* ── Tablet (769–1024px) ── */
        @media (max-width: 1024px) {
          .wf-bento { grid-template-columns: repeat(2, 1fr); }
          .wf-card-hero { grid-column: 1 / -1 !important; }
          .wf-card-wide { grid-column: span 2 !important; }

          .wf-card-hero .wf-video-viewport {
            aspect-ratio: 16/9 !important;
          }
          .wf-hero-content { padding: 72px 20px 0 !important; }
          .wf-cta { padding: 60px 20px 72px !important; }
          .wf-footer { padding: 20px 24px !important; }
        }

        /* ── Small Tablet (641–768px) ── */
        @media (max-width: 768px) {
          .wf-card-wide { grid-column: span 1 !important; }
          .wf-modal-container {
            width: 94vw !important;
            max-width: none !important;
          }
          .wf-modal-title > span {
            font-size: 12px !important;
            max-width: 45vw;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }

        /* ── Mobile (≤640px) ── */
        @media (max-width: 640px) {
          /* Grid → single column */
          .wf-bento {
            grid-template-columns: 1fr !important;
            gap: 14px !important;
          }
          .wf-card-hero,
          .wf-card-wide {
            grid-column: span 1 !important;
          }

          /* All video viewports get taller aspect ratio on mobile */
          .wf-video-viewport {
            aspect-ratio: 16/10 !important;
          }

          /* Navbar: hide text links, keep Get Started */
          .wf-nav-text { display: none !important; }
          .wf-nav-links { gap: 4px !important; }

          /* Hero */
          .wf-hero-content {
            padding: 64px 16px 0 !important;
          }
          .wf-hero-btns {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            padding: 0 8px;
          }
          .wf-hero-btns a,
          .wf-hero-btns button {
            justify-content: center !important;
            padding: 14px 20px !important;
            font-size: 14px !important;
            width: 100%;
            box-sizing: border-box;
          }
          .wf-hero-stats {
            flex-wrap: wrap !important;
            justify-content: center !important;
            gap: 6px !important;
          }
          .wf-hero-stats span {
            font-size: 9px !important;
            letter-spacing: 1.5px !important;
          }

          /* Section markers */
          .wf-section-marker {
            padding: 0 12px !important;
            gap: 10px !important;
          }

          /* Filter bar */
          .wf-filter-scroll {
            padding: 10px 12px !important;
            gap: 4px !important;
          }

          /* Card content */
          .wf-card-content {
            padding: 12px 14px 6px !important;
          }

          /* Card footer */
          .wf-card-footer {
            padding: 5px 10px !important;
          }
          .wf-card-footer > div {
            gap: 8px !important;
          }

          /* CTA */
          .wf-cta {
            padding: 48px 16px 56px !important;
          }

          /* Footer */
          .wf-footer {
            padding: 16px 16px !important;
          }

          /* Modal - full mobile treatment */
          .wf-modal-container {
            width: 96vw !important;
            max-width: none !important;
            border-radius: 6px !important;
          }
          .wf-modal-close {
            top: 12px !important;
            right: 12px !important;
            width: 40px !important;
            height: 40px !important;
          }
          .wf-modal-title {
            left: 12px !important;
            right: 56px !important;
            gap: 8px !important;
            top: 12px !important;
          }
          .wf-modal-title > span {
            font-size: 11px !important;
            max-width: 50vw;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .wf-modal-title > div {
            font-size: 7px !important;
            padding: 2px 6px !important;
          }
          .wf-modal-controls {
            padding: 16px 10px 8px !important;
          }
          .wf-modal-controls button {
            padding: 10px !important;
            min-width: 44px;
            min-height: 44px;
          }
        }

        /* ── Extra Small (≤380px) ── */
        @media (max-width: 380px) {
          .wf-meta-extra { display: none !important; }
          .wf-card-content h3 {
            font-size: 14px !important;
          }
          .wf-hero-stats > div:first-child,
          .wf-hero-stats > div:last-child {
            display: none !important;
          }
          .wf-modal-title > span { display: none !important; }
        }
      `}</style>
    </div>
  );
}
