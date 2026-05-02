/**
 * DARK ARCHIVE — Original dark-themed feedback page from Z.4.x.
 *
 * Preserved for potential revival. To restore:
 * 1. Rename page.tsx → page.light-archive.tsx
 * 2. Rename page.dark-archive.tsx → page.tsx
 * 3. Remove /dashboard/feedback from isLightSurface in layout.tsx
 *
 * Last active: 2026-05-02
 */

// @ts-nocheck — archived, not compiled as a route
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from "framer-motion";
import { toast } from "sonner";
import { useLocale } from "@/hooks/useLocale";
import {
  Bug,
  Lightbulb,
  Compass,
  X,
  Send,
  Loader2,
  CheckCircle2,
  ImagePlus,
  Clock,
  ChevronDown,
  AlertTriangle,
  Sparkles,
  Building2,
  Layers,
  FileText,
  Box,
  Ruler,
  Zap,
  Globe,
  Cpu,
  PenTool,
  Hammer,
  ArrowRight,
  Rocket,
  MessageSquare,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

type FeedbackType = "BUG" | "FEATURE" | "SUGGESTION";

interface FeedbackItem {
  id: string;
  type: FeedbackType;
  title: string;
  description: string;
  category: string | null;
  screenshotUrl: string | null;
  status: string;
  createdAt: string;
}

// ─── Animated Isometric Building Scene ──────────────────────────────

function IsometricScene() {
  return (
    <svg viewBox="0 0 400 320" fill="none" style={{ width: "100%", height: "100%", opacity: 0.85 }}>
      {/* Ground plane grid */}
      <g opacity="0.15">
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={`gv${i}`} x1={80 + i * 24} y1={240} x2={200 + i * 24} y2={180} stroke="#4F8AFF" strokeWidth="0.5" />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={`gh${i}`} x1={80 + i * 20} y1={240 - i * 8} x2={360 + -i * 4} y2={180 + i * 6} stroke="#4F8AFF" strokeWidth="0.5" />
        ))}
      </g>

      {/* Main tower - left */}
      <g>
        <motion.g
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Front face */}
          <path d="M120 90 L120 240 L200 210 L200 60 Z" fill="url(#towerGrad1)" stroke="#4F8AFF" strokeWidth="0.8" />
          {/* Right face */}
          <path d="M200 60 L200 210 L250 230 L250 80 Z" fill="url(#towerGrad2)" stroke="#4F8AFF" strokeWidth="0.8" />
          {/* Top */}
          <path d="M120 90 L170 70 L250 80 L200 60 Z" fill="#1B4FFF" fillOpacity="0.15" stroke="#4F8AFF" strokeWidth="0.8" />

          {/* Windows - front face */}
          {[110, 135, 160, 185].map((y, i) => (
            <g key={`fw${i}`}>
              <rect x="132" y={y} width="14" height="10" rx="1" fill="#4F8AFF" fillOpacity={0.15 - i * 0.02}>
                <animate attributeName="fill-opacity" values={`${0.15 - i * 0.02};${0.3 - i * 0.02};${0.15 - i * 0.02}`} dur={`${3 + i * 0.5}s`} repeatCount="indefinite" />
              </rect>
              <rect x="155" y={y} width="14" height="10" rx="1" fill="#4F8AFF" fillOpacity={0.12 - i * 0.02}>
                <animate attributeName="fill-opacity" values={`${0.12 - i * 0.02};${0.25 - i * 0.02};${0.12 - i * 0.02}`} dur={`${4 + i * 0.3}s`} repeatCount="indefinite" />
              </rect>
              <rect x="178" y={y - 5} width="14" height="10" rx="1" fill="#4F8AFF" fillOpacity={0.1 - i * 0.01}>
                <animate attributeName="fill-opacity" values={`${0.1 - i * 0.01};${0.22 - i * 0.01};${0.1 - i * 0.01}`} dur={`${3.5 + i * 0.4}s`} repeatCount="indefinite" />
              </rect>
            </g>
          ))}

          {/* Windows - right face */}
          {[100, 125, 150, 175].map((y, i) => (
            <g key={`rw${i}`}>
              <rect x="210" y={y} width="12" height="9" rx="1" fill="#00F5FF" fillOpacity={0.08 + i * 0.01} transform={`skewY(12)`}>
                <animate attributeName="fill-opacity" values={`${0.08 + i * 0.01};${0.2 + i * 0.01};${0.08 + i * 0.01}`} dur={`${3.2 + i * 0.6}s`} repeatCount="indefinite" />
              </rect>
              <rect x="230" y={y} width="12" height="9" rx="1" fill="#00F5FF" fillOpacity={0.06 + i * 0.01} transform={`skewY(12)`}>
                <animate attributeName="fill-opacity" values={`${0.06 + i * 0.01};${0.18 + i * 0.01};${0.06 + i * 0.01}`} dur={`${2.8 + i * 0.5}s`} repeatCount="indefinite" />
              </rect>
            </g>
          ))}
        </motion.g>
      </g>

      {/* Shorter building - right */}
      <motion.g
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1.2, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <path d="M260 150 L260 250 L320 270 L320 170 Z" fill="url(#towerGrad3)" stroke="#B87333" strokeWidth="0.6" />
        <path d="M320 170 L320 270 L355 255 L355 155 Z" fill="#B87333" fillOpacity="0.06" stroke="#B87333" strokeWidth="0.6" />
        <path d="M260 150 L295 140 L355 155 L320 170 Z" fill="#FFBF00" fillOpacity="0.08" stroke="#B87333" strokeWidth="0.6" />
        {/* Windows */}
        {[170, 195, 220].map((y, i) => (
          <g key={`bw${i}`}>
            <rect x="270" y={y} width="10" height="8" rx="1" fill="#FFBF00" fillOpacity={0.12}>
              <animate attributeName="fill-opacity" values="0.12;0.25;0.12" dur={`${3 + i}s`} repeatCount="indefinite" />
            </rect>
            <rect x="290" y={y} width="10" height="8" rx="1" fill="#FFBF00" fillOpacity={0.08}>
              <animate attributeName="fill-opacity" values="0.08;0.2;0.08" dur={`${3.5 + i}s`} repeatCount="indefinite" />
            </rect>
          </g>
        ))}
      </motion.g>

      {/* Small structure - far right */}
      <motion.g
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <path d="M340 210 L340 260 L370 272 L370 222 Z" fill="#10B981" fillOpacity="0.08" stroke="#10B981" strokeWidth="0.6" />
        <path d="M370 222 L370 272 L390 264 L390 214 Z" fill="#10B981" fillOpacity="0.04" stroke="#10B981" strokeWidth="0.6" />
        <path d="M340 210 L360 202 L390 214 L370 222 Z" fill="#10B981" fillOpacity="0.1" stroke="#10B981" strokeWidth="0.6" />
      </motion.g>

      {/* Construction crane */}
      <motion.g
        initial={{ opacity: 0, rotate: -5, x: -10 }}
        animate={{ opacity: 1, rotate: 0, x: 0 }}
        transition={{ duration: 1.5, delay: 0.8 }}
      >
        <line x1="100" y1="20" x2="100" y2="90" stroke="#FFBF00" strokeWidth="1.5" opacity="0.4" />
        <line x1="60" y1="20" x2="140" y2="20" stroke="#FFBF00" strokeWidth="1.5" opacity="0.4" />
        <line x1="100" y1="20" x2="60" y2="32" stroke="#FFBF00" strokeWidth="0.5" opacity="0.25" />
        <line x1="100" y1="20" x2="140" y2="32" stroke="#FFBF00" strokeWidth="0.5" opacity="0.25" />
        {/* Hanging cable */}
        <line x1="75" y1="20" x2="75" y2="50" stroke="#FFBF00" strokeWidth="0.5" opacity="0.3" strokeDasharray="3 2">
          <animate attributeName="y2" values="50;55;50" dur="4s" repeatCount="indefinite" />
        </line>
        <rect x="71" y="48" width="8" height="6" fill="#FFBF00" fillOpacity="0.15" stroke="#FFBF00" strokeWidth="0.5" opacity="0.3">
          <animate attributeName="y" values="48;53;48" dur="4s" repeatCount="indefinite" />
        </rect>
      </motion.g>

      {/* Flying particles / data points */}
      {[
        { cx: 150, cy: 50, r: 2, dur: "6s", color: "#4F8AFF" },
        { cx: 280, cy: 100, r: 1.5, dur: "8s", color: "#00F5FF" },
        { cx: 350, cy: 150, r: 1, dur: "5s", color: "#FFBF00" },
        { cx: 180, cy: 130, r: 1.5, dur: "7s", color: "#10B981" },
        { cx: 90, cy: 70, r: 1, dur: "9s", color: "#8B5CF6" },
      ].map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.color} opacity="0.5">
          <animate attributeName="cy" values={`${p.cy};${p.cy - 15};${p.cy}`} dur={p.dur} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0.9;0.5" dur={p.dur} repeatCount="indefinite" />
        </circle>
      ))}

      {/* Dimension annotation */}
      <g opacity="0.2">
        <line x1="120" y1="250" x2="250" y2="250" stroke="#4F8AFF" strokeWidth="0.5" />
        <line x1="120" y1="246" x2="120" y2="254" stroke="#4F8AFF" strokeWidth="0.5" />
        <line x1="250" y1="246" x2="250" y2="254" stroke="#4F8AFF" strokeWidth="0.5" />
        <text x="185" y="260" fill="#4F8AFF" fontSize="7" fontFamily="monospace" textAnchor="middle">32.5m</text>
      </g>

      {/* Gradients */}
      <defs>
        <linearGradient id="towerGrad1" x1="120" y1="90" x2="200" y2="240" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1B4FFF" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#1B4FFF" stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id="towerGrad2" x1="200" y1="60" x2="250" y2="230" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00F5FF" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#00F5FF" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="towerGrad3" x1="260" y1="150" x2="320" y2="270" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFBF00" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#B87333" stopOpacity="0.03" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Pipeline Connector ─────────────────────────────────────────────

function PipelineConnector({ color = "#4F8AFF" }: { color?: string }) {
  return (
    <div className="fb-pipeline-connector">
      <svg width="100%" height="40" viewBox="0 0 200 40" preserveAspectRatio="none">
        <line x1="100" y1="0" x2="100" y2="40" stroke={color} strokeWidth="2" strokeDasharray="6 4" opacity="0.2">
          <animate attributeName="stroke-dashoffset" values="0;-20" dur="2s" repeatCount="indefinite" />
        </line>
        <circle cx="100" cy="20" r="3" fill={color} opacity="0.3">
          <animate attributeName="r" values="2;4;2" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.2;0.5;0.2" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

// ─── Constants ──────────────────────────────────────────────────────

const FEEDBACK_TYPES = [
  {
    id: "BUG" as FeedbackType,
    icon: Bug,
    color: "#F87171",
    accent: "#EF4444",
    gradient: "linear-gradient(135deg, #F87171, #DC2626)",
    bgGrad: "radial-gradient(ellipse at 30% 20%, rgba(248,113,113,0.12), transparent 60%)",
    label: "Bug Report",
    labelDe: "Fehlermeldung",
    tagline: "Crack in the foundation?",
    taglineDe: "Riss im Fundament?",
    description: "Report issues so we can patch the blueprint.",
    descDe: "Melden Sie Probleme, damit wir den Plan reparieren.",
    nodeId: "FB-001",
  },
  {
    id: "FEATURE" as FeedbackType,
    icon: Lightbulb,
    color: "#FBBF24",
    accent: "#F59E0B",
    gradient: "linear-gradient(135deg, #FBBF24, #D97706)",
    bgGrad: "radial-gradient(ellipse at 30% 20%, rgba(251,191,36,0.12), transparent 60%)",
    label: "Feature Request",
    labelDe: "Funktionswunsch",
    tagline: "Design the next floor.",
    taglineDe: "Entwerfen Sie das naechste Stockwerk.",
    description: "What tool should we add to your AEC toolkit?",
    descDe: "Welches Werkzeug fehlt in Ihrem AEC-Toolkit?",
    nodeId: "FB-002",
  },
  {
    id: "SUGGESTION" as FeedbackType,
    icon: Compass,
    color: "#34D399",
    accent: "#10B981",
    gradient: "linear-gradient(135deg, #34D399, #059669)",
    bgGrad: "radial-gradient(ellipse at 30% 20%, rgba(52,211,153,0.12), transparent 60%)",
    label: "AEC Vision",
    labelDe: "AEC-Vision",
    tagline: "Architect the future.",
    taglineDe: "Gestalten Sie die Zukunft.",
    description: "Share your vision for the AEC industry's digital future.",
    descDe: "Teilen Sie Ihre Vision fuer die digitale Zukunft der AEC-Branche.",
    nodeId: "FB-003",
  },
];

const AEC_CATEGORIES = [
  { label: "BIM / IFC", icon: Layers, color: "#4F8AFF" },
  { label: "3D Modeling", icon: Box, color: "#8B5CF6" },
  { label: "Floor Plans", icon: PenTool, color: "#00F5FF" },
  { label: "Cost / BOQ", icon: FileText, color: "#F59E0B" },
  { label: "Rendering", icon: Sparkles, color: "#EC4899" },
  { label: "PDF / Docs", icon: FileText, color: "#10B981" },
  { label: "Collaboration", icon: Globe, color: "#6366F1" },
  { label: "Revit / Rhino", icon: Cpu, color: "#F97316" },
  { label: "Site Analysis", icon: Ruler, color: "#14B8A6" },
  { label: "Sustainability", icon: Zap, color: "#22C55E" },
  { label: "Structural", icon: Hammer, color: "#A855F7" },
  { label: "MEP Systems", icon: Building2, color: "#3B82F6" },
];

const STATUS_MAP: Record<string, { bg: string; text: string; label: string }> = {
  NEW: { bg: "rgba(79,138,255,0.1)", text: "#4F8AFF", label: "New" },
  REVIEWING: { bg: "rgba(245,158,11,0.1)", text: "#F59E0B", label: "Reviewing" },
  PLANNED: { bg: "rgba(139,92,246,0.1)", text: "#8B5CF6", label: "Planned" },
  IN_PROGRESS: { bg: "rgba(0,245,255,0.1)", text: "#00F5FF", label: "In Progress" },
  DONE: { bg: "rgba(16,185,129,0.1)", text: "#10B981", label: "Done" },
  DECLINED: { bg: "rgba(239,68,68,0.1)", text: "#EF4444", label: "Declined" },
};

// ─── Node Card (workflow-style) ─────────────────────────────────────

function FeedbackNodeCard({
  ft,
  isSelected,
  onClick,
  index,
}: {
  ft: (typeof FEEDBACK_TYPES)[number];
  isSelected: boolean;
  onClick: () => void;
  index: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.15 + index * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileTap={{ scale: 0.97 }}
      className="fb-node-card"
      style={{
        position: "relative",
        textAlign: "left",
        cursor: "pointer",
        borderRadius: 18,
        border: `1.5px solid ${isSelected ? `${ft.color}60` : hovered ? `${ft.color}30` : "rgba(255,255,255,0.06)"}`,
        background: isSelected ? `${ft.color}06` : "rgba(12,14,18,0.85)",
        backdropFilter: "blur(16px)",
        overflow: "hidden",
        transition: "all 0.4s cubic-bezier(0.25,0.4,0.25,1)",
        transform: hovered && !isSelected ? "translateY(-6px)" : "none",
        boxShadow: isSelected
          ? `0 0 40px ${ft.color}12, 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 ${ft.color}15`
          : hovered
            ? "0 12px 36px rgba(0,0,0,0.3)"
            : "0 2px 12px rgba(0,0,0,0.15)",
      }}
    >
      {/* Node header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderBottom: `1px solid ${isSelected ? `${ft.color}15` : "rgba(255,255,255,0.04)"}`,
          background: isSelected
            ? `linear-gradient(135deg, ${ft.color}10, transparent)`
            : "rgba(255,255,255,0.015)",
          fontSize: 10,
          fontFamily: "var(--font-jetbrains), monospace",
          fontWeight: 600,
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: isSelected ? ft.color : "#5C5C78",
        }}
      >
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: isSelected ? ft.color : "#3A3A50",
            boxShadow: isSelected ? `0 0 8px ${ft.color}` : "none",
            transition: "all 0.3s",
          }}
        />
        <span>{ft.nodeId}</span>
        <span style={{ marginLeft: "auto", fontSize: 9, opacity: 0.6 }}>
          {isSelected ? "ACTIVE" : "IDLE"}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 20px 22px", position: "relative" }}>
        {/* Background glow */}
        <div style={{ position: "absolute", inset: 0, background: ft.bgGrad, pointerEvents: "none", opacity: isSelected ? 1 : 0, transition: "opacity 0.4s" }} />

        {/* Icon */}
        <motion.div
          animate={{ scale: isSelected ? 1 : 1, boxShadow: isSelected ? `0 0 20px ${ft.color}25` : "0 0 0 transparent" }}
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: `linear-gradient(145deg, ${ft.color}18, ${ft.color}06)`,
            border: `1px solid ${ft.color}30`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
            position: "relative",
            zIndex: 1,
            transition: "box-shadow 0.4s",
          }}
        >
          <ft.icon size={24} color={ft.color} strokeWidth={isSelected ? 2.3 : 1.8} />
        </motion.div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: ft.color,
            marginBottom: 6,
            letterSpacing: "0.5px",
            fontFamily: "var(--font-jetbrains), monospace",
            opacity: 0.8,
            position: "relative",
            zIndex: 1,
          }}
        >
          {ft.tagline}
        </div>

        {/* Label */}
        <div
          style={{
            fontSize: 17,
            fontWeight: 800,
            color: isSelected ? "#F0F2FF" : "#E0E4F0",
            marginBottom: 6,
            letterSpacing: "-0.02em",
            position: "relative",
            zIndex: 1,
          }}
        >
          {ft.label}
        </div>

        {/* Description */}
        <div style={{ fontSize: 12.5, color: "#7C7C96", lineHeight: 1.55, position: "relative", zIndex: 1 }}>
          {ft.description}
        </div>
      </div>

      {/* Connection port - bottom */}
      <div
        style={{
          position: "absolute",
          bottom: -6,
          left: "50%",
          transform: "translateX(-50%)",
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: isSelected ? ft.color : "#1E2A38",
          border: `2px solid ${isSelected ? ft.color : "#2A3648"}`,
          boxShadow: isSelected ? `0 0 12px ${ft.color}80` : "none",
          transition: "all 0.3s",
          zIndex: 2,
        }}
      />

      {/* Selected check */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 90 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            style={{
              position: "absolute",
              top: 42,
              right: 16,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: ft.gradient,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 16px ${ft.color}50`,
            }}
          >
            <CheckCircle2 size={14} color="#fff" strokeWidth={2.5} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shimmer on hover */}
      {hovered && !isSelected && (
        <motion.div
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: "200%", opacity: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "40%",
            height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)",
            pointerEvents: "none",
          }}
        />
      )}
    </motion.button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function FeedbackPage() {
  const { locale } = useLocale();
  const isDE = locale === "de";

  const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const [history, setHistory] = useState<FeedbackItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mouse-follow glow
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 50, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 50, damping: 20 });
  const glowOpacity = useTransform(springY, [0, 500], [0.08, 0.02]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }, [mouseX, mouseY]);

  useEffect(() => {
    fetch("/api/feedback")
      .then((r) => r.json())
      .then((data) => {
        if (data.feedbacks) setHistory(data.feedbacks);
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [submitted]);

  const handleScreenshot = useCallback((file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("Screenshot must be under 5MB"); return; }
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    setScreenshot(file);
    const reader = new FileReader();
    reader.onload = () => setScreenshotPreview(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) handleScreenshot(file);
        break;
      }
    }
  }, [handleScreenshot]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !title.trim() || !description.trim()) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("type", selectedType);
      formData.append("title", title.trim());
      formData.append("description", description.trim());
      if (category) formData.append("category", category);
      if (screenshot) formData.append("screenshot", screenshot);
      formData.append("pageUrl", window.location.href);
      const res = await fetch("/api/feedback", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to submit"); return; }
      setSubmitted(true);
      toast.success(isDE ? "Feedback gesendet!" : "Feedback submitted!", { icon: <CheckCircle2 size={18} /> });
    } catch { toast.error(isDE ? "Fehler beim Senden" : "Failed to submit"); }
    finally { setSending(false); }
  };

  const resetForm = () => {
    setSelectedType(null); setTitle(""); setDescription(""); setCategory("");
    setScreenshot(null); setScreenshotPreview(null); setSubmitted(false);
  };

  const selectedTypeInfo = FEEDBACK_TYPES.find((ft) => ft.id === selectedType);
  const accentColor = selectedTypeInfo?.color || "#4F8AFF";

  const inputStyle = (field: string, isTextarea = false) => ({
    width: "100%",
    padding: "14px 18px",
    height: isTextarea ? 180 : 50,
    borderRadius: 14,
    border: `1px solid ${focusedField === field ? `${accentColor}50` : "rgba(255,255,255,0.06)"}`,
    background: "rgba(6,8,12,0.8)",
    color: "#F0F0F5",
    fontSize: 14,
    outline: "none",
    transition: "all 0.3s cubic-bezier(0.25,0.4,0.25,1)",
    boxShadow: focusedField === field ? `0 0 0 3px ${accentColor}10, 0 4px 20px ${accentColor}06` : "none",
    resize: "none" as const,
    fontFamily: "inherit",
  });

  return (
    <div className="flex flex-col h-screen overflow-hidden relative" onMouseMove={handleMouseMove}>
      {/* ── Multi-Layer Background ───────────────────────── */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
        {/* Blueprint grid */}
        <div className="blueprint-grid" style={{ position: "absolute", inset: 0 }} />

        {/* Mouse-following glow */}
        <motion.div
          style={{
            position: "absolute",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accentColor}15, transparent 70%)`,
            x: springX,
            y: springY,
            translateX: "-50%",
            translateY: "-50%",
            opacity: glowOpacity,
            filter: "blur(60px)",
          }}
        />

        {/* Ambient orbs */}
        <div className="orb-drift-1" style={{ position: "absolute", top: "0%", right: "0%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.05) 0%, transparent 70%)", filter: "blur(60px)" }} />
        <div className="orb-drift-2" style={{ position: "absolute", bottom: "5%", left: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(184,115,51,0.04) 0%, transparent 70%)", filter: "blur(50px)" }} />

        {/* Scan beam */}
        <div className="scan-beam" style={{ position: "absolute", top: "30%", left: 0, right: 0 }} />
      </div>

      <main className="flex-1 overflow-y-auto relative z-1">
        <div className="fb-container">
          {/* ── Hero: Isometric City + CTA ────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="fb-hero"
          >
            {/* Left content */}
            <div className="fb-hero-content">
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3, duration: 0.6 }}
              >
                <div className="fb-hero-badge">
                  <span className="fb-hero-dot" />
                  <span>{isDE ? "BETA-PROGRAMM" : "BETA PROGRAM"}</span>
                  <span className="fb-hero-badge-v">v2.0</span>
                </div>

                <h1 className="fb-hero-title">
                  {isDE ? (
                    <>Entwerfen Sie die<br /><span style={{ background: "linear-gradient(135deg, #4F8AFF, #00F5FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Zukunft von AEC</span></>
                  ) : (
                    <>Architect the<br /><span style={{ background: "linear-gradient(135deg, #4F8AFF, #00F5FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Future of AEC</span></>
                  )}
                </h1>

                <p className="fb-hero-desc">
                  {isDE
                    ? "Jedes Feedback ist ein Baustein. Bug-Fixes, Feature-Ideen, Branchenvisionen — Sie formen BuildFlow."
                    : "Every piece of feedback is a building block. Bug fixes, feature ideas, industry visions — you shape BuildFlow."}
                </p>

                {/* Stats */}
                <div className="fb-hero-stats">
                  {[
                    { n: "IFC", label: isDE ? "Parsing" : "Parsing", icon: Layers },
                    { n: "3D", label: isDE ? "Modelle" : "Models", icon: Box },
                    { n: "AI", label: isDE ? "Rendering" : "Renders", icon: Sparkles },
                    { n: "BOQ", label: isDE ? "Reports" : "Reports", icon: FileText },
                  ].map((s, i) => (
                    <motion.div
                      key={s.n}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }}
                      className="fb-stat-chip"
                    >
                      <s.icon size={12} strokeWidth={2} />
                      <span className="fb-stat-n">{s.n}</span>
                      <span className="fb-stat-label">{s.label}</span>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* Right: Isometric scene */}
            <div className="fb-hero-scene">
              <IsometricScene />
            </div>
          </motion.div>

          {/* ── Node Cards ────────────────────────────────── */}
          <div className="fb-section">
            <div className="fb-section-label">
              <ArrowRight size={14} color="#4F8AFF" />
              <span>{isDE ? "WAS MOECHTEN SIE TEILEN?" : "WHAT WOULD YOU LIKE TO SHARE?"}</span>
            </div>

            <AnimatePresence mode="wait">
              {submitted ? (
                /* ── Success ─────────────────── */
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="fb-success"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 12 }}
                    className="fb-success-icon"
                  >
                    <Rocket size={36} color="#10B981" />
                  </motion.div>
                  <h2 className="fb-success-title">{isDE ? "Einreichung erfolgreich!" : "Submitted Successfully!"}</h2>
                  <p className="fb-success-desc">
                    {isDE
                      ? "Ihr Feedback wurde in unsere Pipeline aufgenommen. Unser Team prueft jede Einreichung."
                      : "Your feedback has entered our pipeline. Our team reviews every single submission."}
                  </p>
                  <motion.button onClick={resetForm} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="fb-success-btn">
                    <MessageSquare size={16} />
                    {isDE ? "Weiteres Feedback" : "Submit More Feedback"}
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div key="form">
                  <div className="fb-node-grid">
                    {FEEDBACK_TYPES.map((ft, i) => (
                      <FeedbackNodeCard
                        key={ft.id}
                        ft={ft}
                        isSelected={selectedType === ft.id}
                        onClick={() => setSelectedType(ft.id)}
                        index={i}
                      />
                    ))}
                  </div>

                  {/* ── Form ─────────────────────── */}
                  <AnimatePresence>
                    {selectedType && selectedTypeInfo && (
                      <>
                        <PipelineConnector color={selectedTypeInfo.color} />

                        <motion.form
                          onSubmit={handleSubmit}
                          initial={{ opacity: 0, y: 24, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -12, scale: 0.98 }}
                          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                          className="fb-form-card"
                          style={{ borderColor: `${selectedTypeInfo.color}18` }}
                        >
                          {/* Form header */}
                          <div className="fb-form-header" style={{ borderBottomColor: `${selectedTypeInfo.color}12` }}>
                            <div className="fb-form-dot" style={{ background: selectedTypeInfo.color, boxShadow: `0 0 10px ${selectedTypeInfo.color}` }} />
                            <span style={{ color: selectedTypeInfo.color }}>{isDE ? "DESIGN BRIEF" : "DESIGN BRIEF"}</span>
                            <span className="fb-form-header-type">{selectedTypeInfo.nodeId}</span>
                          </div>

                          <div className="fb-form-body">
                            {/* Title */}
                            <div className="fb-field">
                              <label className="fb-label">{isDE ? "Titel" : "Title"} <span style={{ color: selectedTypeInfo.color }}>*</span></label>
                              <input
                                type="text"
                                placeholder={
                                  selectedType === "BUG" ? (isDE ? "z.B. Canvas friert ein bei 50+ Nodes" : "e.g. Canvas freezes with 50+ nodes")
                                    : selectedType === "FEATURE" ? (isDE ? "z.B. Revit-Export mit Parametern" : "e.g. Revit export with parametric mapping")
                                      : (isDE ? "z.B. Automatische BOQ aus IFC" : "e.g. Automated BOQ from IFC models")
                                }
                                required maxLength={200} value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                onFocus={() => setFocusedField("title")} onBlur={() => setFocusedField(null)}
                                style={inputStyle("title")}
                              />
                              <span className="fb-counter" style={{ color: title.length > 180 ? "#F59E0B" : undefined }}>{title.length}/200</span>
                            </div>

                            {/* Description */}
                            <div className="fb-field">
                              <label className="fb-label">{isDE ? "Beschreibung" : "Description"} <span style={{ color: selectedTypeInfo.color }}>*</span></label>
                              <textarea
                                placeholder={
                                  selectedType === "BUG" ? (isDE ? "Schritte zum Reproduzieren:\n1. ...\n2. ...\n\nErwartet vs. tatsaechlich:" : "Steps to reproduce:\n1. ...\n2. ...\n\nExpected vs actual:")
                                    : selectedType === "FEATURE" ? (isDE ? "Gewuenschte Funktion:\n\nAktueller Workflow:\n\nErwarteter Nutzen:" : "Feature description:\n\nCurrent workflow:\n\nExpected benefit:")
                                      : (isDE ? "AEC-Problem:\n\nAktuelle Loesung:\n\nIhre Vision:" : "AEC problem:\n\nCurrent solution:\n\nYour vision:")
                                }
                                required maxLength={5000} value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                onFocus={() => setFocusedField("desc")} onBlur={() => setFocusedField(null)}
                                style={inputStyle("desc", true)}
                              />
                              <span className="fb-counter" style={{ color: description.length > 4800 ? "#F59E0B" : undefined }}>{description.length}/5000</span>
                            </div>

                            {/* Categories */}
                            <div className="fb-field">
                              <label className="fb-label">{isDE ? "AEC-Bereich" : "AEC Domain"} <span className="fb-optional">{isDE ? "optional" : "optional"}</span></label>
                              <div className="fb-cats">
                                {AEC_CATEGORIES.map((cat) => {
                                  const isActive = category === cat.label;
                                  const CatIcon = cat.icon;
                                  return (
                                    <motion.button
                                      key={cat.label} type="button"
                                      onClick={() => setCategory(isActive ? "" : cat.label)}
                                      whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.95 }}
                                      className={`fb-cat-tag ${isActive ? "fb-cat-active" : ""}`}
                                      style={{
                                        borderColor: isActive ? `${cat.color}40` : undefined,
                                        background: isActive ? `${cat.color}12` : undefined,
                                        color: isActive ? cat.color : undefined,
                                        boxShadow: isActive ? `0 0 12px ${cat.color}12` : undefined,
                                      }}
                                    >
                                      <CatIcon size={12} strokeWidth={2} />
                                      {cat.label}
                                    </motion.button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Screenshot */}
                            <div className="fb-field">
                              <label className="fb-label">{isDE ? "Screenshot" : "Screenshot"} <span className="fb-optional">{isDE ? "optional" : "optional"}</span></label>
                              {screenshotPreview ? (
                                <div style={{ position: "relative", display: "inline-block" }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={screenshotPreview} alt="Preview" className="fb-screenshot-preview" style={{ borderColor: `${accentColor}20` }} />
                                  <button type="button" onClick={() => { setScreenshot(null); setScreenshotPreview(null); }} className="fb-screenshot-remove"><X size={14} /></button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => fileInputRef.current?.click()} className="fb-upload-zone" style={{ borderColor: `${accentColor}15` }}>
                                  <div className="fb-upload-icon" style={{ background: `${accentColor}08`, borderColor: `${accentColor}15` }}>
                                    <ImagePlus size={22} strokeWidth={1.5} color={accentColor} />
                                  </div>
                                  <span className="fb-upload-text">{isDE ? "Klicken oder Ctrl+V" : "Click or Ctrl+V"}</span>
                                  <span className="fb-upload-hint">PNG, JPG, WebP — max 5MB</span>
                                </button>
                              )}
                              <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleScreenshot(f); }} style={{ display: "none" }} />
                            </div>

                            {/* Submit */}
                            <motion.button
                              type="submit"
                              disabled={sending || !title.trim() || !description.trim()}
                              whileHover={{ scale: sending ? 1 : 1.01 }} whileTap={{ scale: sending ? 1 : 0.98 }}
                              className="fb-submit-btn"
                              style={{
                                background: selectedTypeInfo.gradient,
                                boxShadow: `0 4px 24px ${selectedTypeInfo.color}25`,
                                opacity: sending || !title.trim() || !description.trim() ? 0.4 : 1,
                                cursor: sending || !title.trim() || !description.trim() ? "not-allowed" : "pointer",
                              }}
                            >
                              {sending ? (
                                <><Loader2 size={18} className="fb-spin" /> {isDE ? "Wird gesendet..." : "Submitting..."}</>
                              ) : (
                                <><Send size={18} /> {isDE ? "Feedback senden" : "Submit Feedback"}</>
                              )}
                            </motion.button>
                          </div>
                        </motion.form>
                      </>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Submissions ───────────────────────────────── */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="fb-section">
            <button onClick={() => setShowHistory(!showHistory)} className="fb-history-toggle">
              <div className="fb-history-icon"><Clock size={14} color="#4F8AFF" /></div>
              <span className="fb-history-label">{isDE ? "Meine Einreichungen" : "My Submissions"}</span>
              {history.length > 0 && <span className="fb-history-badge">{history.length}</span>}
              <ChevronDown size={14} color="#5C5C78" style={{ marginLeft: "auto", transition: "transform 0.3s", transform: showHistory ? "rotate(180deg)" : "none" }} />
            </button>

            <AnimatePresence>
              {showHistory && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35 }} style={{ overflow: "hidden" }}>
                  {loadingHistory ? (
                    <div className="fb-loading"><Loader2 size={20} className="fb-spin" color="#4F8AFF" /><span>{isDE ? "Laden..." : "Loading..."}</span></div>
                  ) : history.length === 0 ? (
                    <div className="fb-empty">{isDE ? "Noch keine Einreichungen" : "No submissions yet"}</div>
                  ) : (
                    <div className="fb-history-list">
                      {history.map((item, i) => {
                        const ti = FEEDBACK_TYPES.find((ft) => ft.id === item.type);
                        const si = STATUS_MAP[item.status] || STATUS_MAP.NEW;
                        const TI = ti?.icon || AlertTriangle;
                        return (
                          <motion.div key={item.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="fb-history-item" style={{ borderLeftColor: ti?.color || "#4F8AFF" }}>
                            <div className="fb-history-item-icon" style={{ background: `${ti?.color || "#666"}10`, borderColor: `${ti?.color || "#666"}20` }}>
                              <TI size={14} color={ti?.color || "#666"} />
                            </div>
                            <div className="fb-history-item-body">
                              <div className="fb-history-item-row">
                                <span className="fb-history-item-title">{item.title}</span>
                                <span className="fb-history-status" style={{ background: si.bg, color: si.text }}>{si.label}</span>
                                {item.category && <span className="fb-history-cat">{item.category}</span>}
                              </div>
                              <p className="fb-history-item-desc">{item.description}</p>
                              <span className="fb-history-item-date">
                                {new Date(item.createdAt).toLocaleDateString(isDE ? "de-DE" : "en-US", { year: "numeric", month: "short", day: "numeric" })}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </main>

      <style>{`
        /* ── Layout ──────────────────────────────────── */
        .fb-container { max-width: 1000px; margin: 0 auto; padding: 12px 24px 100px; }
        .fb-section { margin-top: 32px; }
        .fb-section-label {
          display: flex; align-items: center; gap: 10px; margin-bottom: 18px;
          font: 700 10.5px/1 var(--font-jetbrains), monospace;
          color: #5C5C78; text-transform: uppercase; letter-spacing: 2.5px;
        }
        .fb-section-label::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(79,138,255,0.15), transparent); }

        /* ── Hero ────────────────────────────────────── */
        .fb-hero {
          display: grid; grid-template-columns: 1fr 1fr; gap: 0;
          border-radius: 22px; overflow: hidden; position: relative;
          border: 1px solid rgba(79,138,255,0.1);
          background: linear-gradient(135deg, rgba(12,14,18,0.95), rgba(6,8,12,0.9));
          backdrop-filter: blur(20px);
          min-height: 260px;
        }
        .fb-hero-content { padding: 36px 36px 36px 40px; display: flex; align-items: center; position: relative; z-index: 1; }
        .fb-hero-scene { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .fb-hero-badge {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 5px 14px; border-radius: 20px;
          background: rgba(79,138,255,0.08); border: 1px solid rgba(79,138,255,0.15);
          font: 700 10px/1 var(--font-jetbrains), monospace;
          color: #4F8AFF; letter-spacing: 1.5px; text-transform: uppercase;
          margin-bottom: 20px;
        }
        .fb-hero-dot { width: 6px; height: 6px; border-radius: 50%; background: #4F8AFF; box-shadow: 0 0 8px #4F8AFF; animation: breathe 3s ease-in-out infinite; }
        .fb-hero-badge-v { padding: 2px 6px; border-radius: 6px; background: rgba(79,138,255,0.15); font-size: 9px; }
        .fb-hero-title { font-size: clamp(1.5rem, 3vw, 2.2rem); font-weight: 900; letter-spacing: -0.04em; line-height: 1.15; color: #F0F2FF; margin-bottom: 14px; }
        .fb-hero-desc { font-size: 14px; color: #7C7C96; line-height: 1.65; max-width: 380px; margin-bottom: 20px; }
        .fb-hero-stats { display: flex; gap: 8px; flex-wrap: wrap; }
        .fb-stat-chip {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 11px; border-radius: 8px;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
          font-size: 11px; color: #7C7C96;
        }
        .fb-stat-n { font-weight: 800; color: #B0B8D0; font-family: var(--font-jetbrains), monospace; }
        .fb-stat-label { font-size: 10px; }

        /* ── Node Grid ───────────────────────────────── */
        .fb-node-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .fb-node-card { width: 100%; }

        /* ── Pipeline Connector ──────────────────────── */
        .fb-pipeline-connector { display: flex; justify-content: center; height: 40px; }

        /* ── Form Card ───────────────────────────────── */
        .fb-form-card {
          border-radius: 20px; border: 1.5px solid rgba(255,255,255,0.06);
          background: rgba(12,14,18,0.9); backdrop-filter: blur(16px);
          overflow: hidden;
        }
        .fb-form-header {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          background: rgba(255,255,255,0.015);
          font: 700 10px/1 var(--font-jetbrains), monospace;
          color: #5C5C78; letter-spacing: 1.5px; text-transform: uppercase;
        }
        .fb-form-dot { width: 7px; height: 7px; border-radius: 50%; }
        .fb-form-header-type { margin-left: auto; font-size: 9px; opacity: 0.5; }
        .fb-form-body { padding: 24px 24px 28px; }
        .fb-field { margin-bottom: 20px; }
        .fb-label { display: block; font-size: 13px; font-weight: 600; color: #B0B0C8; margin-bottom: 8px; }
        .fb-optional { font-weight: 400; color: #3A3A50; font-size: 11px; margin-left: 4px; }
        .fb-counter { display: block; text-align: right; font: 500 10px/1 var(--font-jetbrains), monospace; color: #2A2A40; margin-top: 4px; }

        /* ── Category Tags ───────────────────────────── */
        .fb-cats { display: flex; flex-wrap: wrap; gap: 8px; }
        .fb-cat-tag {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 7px 14px; border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02);
          color: #7C7C96; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
        }

        /* ── Upload Zone ─────────────────────────────── */
        .fb-upload-zone {
          width: 100%; padding: 28px; border-radius: 14px;
          border: 2px dashed rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.01);
          cursor: pointer; display: flex; flex-direction: column;
          align-items: center; gap: 10px; transition: all 0.3s;
        }
        .fb-upload-zone:hover { border-color: rgba(79,138,255,0.15); background: rgba(79,138,255,0.02); }
        .fb-upload-icon {
          width: 48px; height: 48px; border-radius: 14px;
          border: 1px solid; display: flex; align-items: center; justify-content: center;
        }
        .fb-upload-text { font-size: 13px; color: #7C7C96; font-weight: 500; }
        .fb-upload-hint { font-size: 11px; color: #3A3A50; }
        .fb-screenshot-preview { max-width: 100%; max-height: 220px; border-radius: 14px; border: 1px solid; }
        .fb-screenshot-remove {
          position: absolute; top: 10px; right: 10px;
          width: 30px; height: 30px; border-radius: 50%;
          background: rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.15);
          color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer;
        }

        /* ── Submit Button ───────────────────────────── */
        .fb-submit-btn {
          width: 100%; padding: 16px; border: none; border-radius: 14px;
          font-size: 15px; font-weight: 700; color: white; letter-spacing: 0.3px;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          transition: opacity 0.3s;
        }

        /* ── History ─────────────────────────────────── */
        .fb-history-toggle {
          display: flex; align-items: center; gap: 12px; width: 100%;
          padding: 14px 18px; border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.02);
          cursor: pointer; transition: all 0.2s;
        }
        .fb-history-toggle:hover { border-color: rgba(79,138,255,0.12); background: rgba(79,138,255,0.02); }
        .fb-history-icon { width: 32px; height: 32px; border-radius: 10px; background: rgba(79,138,255,0.08); border: 1px solid rgba(79,138,255,0.12); display: flex; align-items: center; justify-content: center; }
        .fb-history-label { font-size: 13px; font-weight: 600; color: #B0B0C8; }
        .fb-history-badge { font: 700 11px/1 var(--font-jetbrains), monospace; padding: 3px 10px; border-radius: 12px; background: rgba(79,138,255,0.1); color: #4F8AFF; }
        .fb-history-list { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
        .fb-history-item {
          padding: 16px 20px; border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.05); border-left: 3px solid;
          background: rgba(12,14,18,0.6); display: flex; align-items: flex-start; gap: 14px;
        }
        .fb-history-item-icon { width: 34px; height: 34px; border-radius: 9px; border: 1px solid; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .fb-history-item-body { flex: 1; min-width: 0; }
        .fb-history-item-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
        .fb-history-item-title { font-size: 14px; font-weight: 600; color: #E0E4F0; }
        .fb-history-status { font: 700 9px/1 var(--font-jetbrains), monospace; padding: 3px 9px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .fb-history-cat { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: rgba(255,255,255,0.03); color: #7C7C96; border: 1px solid rgba(255,255,255,0.04); }
        .fb-history-item-desc { font-size: 12.5px; color: #5C5C78; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .fb-history-item-date { font: 500 10px/1 var(--font-jetbrains), monospace; color: #2A2A40; margin-top: 8px; display: block; }
        .fb-loading { padding: 40px 0; text-align: center; color: #7C7C96; display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 13px; }
        .fb-empty { padding: 48px; text-align: center; color: #3A3A50; font-size: 14px; border-radius: 14px; border: 1px dashed rgba(255,255,255,0.04); margin-top: 12px; }

        /* ── Success ─────────────────────────────────── */
        .fb-success {
          text-align: center; padding: 72px 32px; border-radius: 20px;
          border: 1px solid rgba(16,185,129,0.15);
          background: linear-gradient(180deg, rgba(16,185,129,0.04), rgba(6,8,12,0.9));
          position: relative;
        }
        .fb-success-icon {
          width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 28px;
          background: radial-gradient(circle, rgba(16,185,129,0.15), rgba(16,185,129,0.03));
          border: 2px solid rgba(16,185,129,0.2);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 60px rgba(16,185,129,0.12);
        }
        .fb-success-title { font-size: 26px; font-weight: 800; color: #F0F2FF; margin-bottom: 12px; letter-spacing: -0.02em; }
        .fb-success-desc { font-size: 14px; color: #7C7C96; line-height: 1.7; max-width: 440px; margin: 0 auto 32px; }
        .fb-success-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 14px 28px; border-radius: 14px;
          border: 1px solid rgba(16,185,129,0.25); background: rgba(16,185,129,0.08);
          color: #34D399; font-size: 14px; font-weight: 700; cursor: pointer;
          transition: all 0.3s;
        }
        .fb-success-btn:hover { background: rgba(16,185,129,0.15); }

        /* ── Utilities ───────────────────────────────── */
        .fb-spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* ── Responsive ──────────────────────────────── */
        @media (max-width: 900px) {
          .fb-hero { grid-template-columns: 1fr; min-height: auto; }
          .fb-hero-scene { height: 200px; }
          .fb-hero-content { padding: 28px 24px; }
        }
        @media (max-width: 768px) {
          .fb-container { padding: 8px 16px 80px; }
          .fb-node-grid { grid-template-columns: 1fr !important; gap: 12px; }
          .fb-hero { grid-template-columns: 1fr; }
          .fb-hero-scene { height: 180px; }
          .fb-hero-content { padding: 24px 20px; }
          .fb-hero-title { font-size: 1.4rem; }
          .fb-hero-desc { font-size: 13px; }
          .fb-hero-stats { gap: 6px; }
          .fb-stat-chip { padding: 4px 8px; font-size: 10px; }
          .fb-form-body { padding: 18px 16px 22px; }
          .fb-cats { gap: 6px; }
          .fb-cat-tag { padding: 5px 10px; font-size: 11px; }
          .fb-history-item { padding: 14px 14px; gap: 10px; }
          .fb-success { padding: 48px 20px; }
          .fb-section-label { font-size: 9.5px; letter-spacing: 2px; }
        }
        @media (max-width: 480px) {
          .fb-hero-stats { display: grid; grid-template-columns: 1fr 1fr; }
          .fb-hero-title { font-size: 1.25rem; }
          .fb-hero-content { padding: 20px 16px; }
          .fb-hero-scene { height: 150px; }
          .fb-submit-btn { font-size: 14px; padding: 14px; }
          .fb-pipeline-connector { height: 30px; }
        }
      `}</style>
    </div>
  );
}
