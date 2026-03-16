"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Header } from "@/components/dashboard/Header";
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

// ─── Constants ──────────────────────────────────────────────────────

const FEEDBACK_TYPES = [
  {
    id: "BUG" as FeedbackType,
    icon: Bug,
    color: "#F87171",
    glow: "rgba(248,113,113,0.15)",
    gradient: "linear-gradient(135deg, #F87171 0%, #EF4444 100%)",
    label: "Bug Report",
    labelDe: "Fehlermeldung",
    description: "Something broke? Let us know and we'll fix it fast.",
    descDe: "Etwas kaputt? Sagen Sie uns Bescheid und wir beheben es schnell.",
    svgIcon: "crack",
  },
  {
    id: "FEATURE" as FeedbackType,
    icon: Lightbulb,
    color: "#FBBF24",
    glow: "rgba(251,191,36,0.15)",
    gradient: "linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)",
    label: "Feature Request",
    labelDe: "Funktionswunsch",
    description: "What tool should we build next for your workflow?",
    descDe: "Welches Tool sollen wir als Naechstes fuer Ihren Workflow bauen?",
    svgIcon: "blueprint",
  },
  {
    id: "SUGGESTION" as FeedbackType,
    icon: Compass,
    color: "#34D399",
    glow: "rgba(52,211,153,0.15)",
    gradient: "linear-gradient(135deg, #34D399 0%, #10B981 100%)",
    label: "AEC Industry Insight",
    labelDe: "AEC-Brancheneinblick",
    description: "Share what the architecture & construction world needs.",
    descDe: "Teilen Sie mit, was die Architektur- und Bauwelt braucht.",
    svgIcon: "building",
  },
];

const AEC_CATEGORIES = [
  { label: "BIM / IFC", icon: Layers, color: "#4F8AFF" },
  { label: "3D Modeling", icon: Box, color: "#8B5CF6" },
  { label: "Floor Plans", icon: PenTool, color: "#00F5FF" },
  { label: "Cost Estimation", icon: FileText, color: "#F59E0B" },
  { label: "Rendering", icon: Sparkles, color: "#EC4899" },
  { label: "PDF Processing", icon: FileText, color: "#10B981" },
  { label: "Collaboration", icon: Globe, color: "#6366F1" },
  { label: "Revit / Rhino", icon: Cpu, color: "#F97316" },
  { label: "Site Analysis", icon: Ruler, color: "#14B8A6" },
  { label: "Sustainability", icon: Zap, color: "#22C55E" },
  { label: "Structural", icon: Hammer, color: "#A855F7" },
  { label: "MEP Systems", icon: Building2, color: "#3B82F6" },
];

const STATUS_MAP: Record<string, { bg: string; text: string; label: string; glow: string }> = {
  NEW: { bg: "rgba(79,138,255,0.08)", text: "#4F8AFF", label: "New", glow: "0 0 8px rgba(79,138,255,0.3)" },
  REVIEWING: { bg: "rgba(245,158,11,0.08)", text: "#F59E0B", label: "Reviewing", glow: "0 0 8px rgba(245,158,11,0.3)" },
  PLANNED: { bg: "rgba(139,92,246,0.08)", text: "#8B5CF6", label: "Planned", glow: "0 0 8px rgba(139,92,246,0.3)" },
  IN_PROGRESS: { bg: "rgba(0,245,255,0.08)", text: "#00F5FF", label: "In Progress", glow: "0 0 8px rgba(0,245,255,0.3)" },
  DONE: { bg: "rgba(16,185,129,0.08)", text: "#10B981", label: "Done", glow: "0 0 8px rgba(16,185,129,0.3)" },
  DECLINED: { bg: "rgba(239,68,68,0.08)", text: "#EF4444", label: "Declined", glow: "0 0 8px rgba(239,68,68,0.3)" },
};

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

// ─── SVG Illustrations ──────────────────────────────────────────────

function BlueprintBuildingSVG({ color, size = 80 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" style={{ opacity: 0.9 }}>
      {/* Building body */}
      <rect x="15" y="20" width="50" height="55" rx="2" stroke={color} strokeWidth="1.5" strokeDasharray="4 2" fill={`${color}08`} />
      {/* Floors */}
      <line x1="15" y1="35" x2="65" y2="35" stroke={color} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" />
      <line x1="15" y1="50" x2="65" y2="50" stroke={color} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" />
      <line x1="15" y1="62" x2="65" y2="62" stroke={color} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" />
      {/* Windows */}
      <rect x="22" y="24" width="8" height="8" rx="1" stroke={color} strokeWidth="1" fill={`${color}15`} />
      <rect x="36" y="24" width="8" height="8" rx="1" stroke={color} strokeWidth="1" fill={`${color}15`} />
      <rect x="50" y="24" width="8" height="8" rx="1" stroke={color} strokeWidth="1" fill={`${color}15`} />
      <rect x="22" y="39" width="8" height="8" rx="1" stroke={color} strokeWidth="1" fill={`${color}10`} />
      <rect x="36" y="39" width="8" height="8" rx="1" stroke={color} strokeWidth="1" fill={`${color}10`} />
      <rect x="50" y="39" width="8" height="8" rx="1" stroke={color} strokeWidth="1" fill={`${color}10`} />
      <rect x="22" y="53" width="8" height="6" rx="1" stroke={color} strokeWidth="1" fill={`${color}08`} />
      <rect x="50" y="53" width="8" height="6" rx="1" stroke={color} strokeWidth="1" fill={`${color}08`} />
      {/* Door */}
      <rect x="34" y="65" width="12" height="10" rx="1" stroke={color} strokeWidth="1.5" fill={`${color}12`} />
      {/* Roof accent */}
      <line x1="10" y1="20" x2="70" y2="20" stroke={color} strokeWidth="2" opacity="0.8" />
      {/* Dimension lines */}
      <line x1="10" y1="78" x2="70" y2="78" stroke={color} strokeWidth="0.5" opacity="0.3" />
      <line x1="10" y1="76" x2="10" y2="80" stroke={color} strokeWidth="0.5" opacity="0.3" />
      <line x1="70" y1="76" x2="70" y2="80" stroke={color} strokeWidth="0.5" opacity="0.3" />
      {/* Crane */}
      <line x1="68" y1="5" x2="68" y2="20" stroke={color} strokeWidth="1" opacity="0.4" />
      <line x1="55" y1="5" x2="75" y2="5" stroke={color} strokeWidth="1" opacity="0.4" />
      <line x1="58" y1="5" x2="58" y2="12" stroke={color} strokeWidth="0.5" strokeDasharray="2 2" opacity="0.3" />
    </svg>
  );
}

function FloorPlanSVG({ color, size = 80 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" style={{ opacity: 0.9 }}>
      {/* Outer walls */}
      <rect x="8" y="8" width="64" height="64" rx="1" stroke={color} strokeWidth="2" fill={`${color}05`} />
      {/* Interior walls */}
      <line x1="40" y1="8" x2="40" y2="50" stroke={color} strokeWidth="1.5" />
      <line x1="8" y1="40" x2="40" y2="40" stroke={color} strokeWidth="1.5" />
      <line x1="40" y1="50" x2="72" y2="50" stroke={color} strokeWidth="1.5" />
      {/* Doors (arcs) */}
      <path d="M 36 40 A 4 4 0 0 1 40 44" stroke={color} strokeWidth="0.8" fill="none" opacity="0.6" />
      <path d="M 40 46 A 4 4 0 0 0 44 50" stroke={color} strokeWidth="0.8" fill="none" opacity="0.6" />
      {/* Room labels */}
      <text x="20" y="28" fill={color} fontSize="6" fontFamily="monospace" opacity="0.5" textAnchor="middle">LIVING</text>
      <text x="56" y="32" fill={color} fontSize="6" fontFamily="monospace" opacity="0.5" textAnchor="middle">BED</text>
      <text x="20" y="58" fill={color} fontSize="5" fontFamily="monospace" opacity="0.5" textAnchor="middle">KITCHEN</text>
      <text x="56" y="64" fill={color} fontSize="5" fontFamily="monospace" opacity="0.5" textAnchor="middle">BATH</text>
      {/* Dimensions */}
      <line x1="8" y1="76" x2="72" y2="76" stroke={color} strokeWidth="0.5" opacity="0.3" />
      <text x="40" y="79" fill={color} fontSize="4" fontFamily="monospace" opacity="0.3" textAnchor="middle">12.00m</text>
      {/* Furniture hints */}
      <rect x="14" y="14" width="12" height="8" rx="2" stroke={color} strokeWidth="0.5" opacity="0.3" strokeDasharray="2 1" />
      <circle cx="58" cy="58" r="4" stroke={color} strokeWidth="0.5" opacity="0.3" strokeDasharray="2 1" />
    </svg>
  );
}

function StructuralGridSVG({ color, size = 80 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" style={{ opacity: 0.9 }}>
      {/* Grid lines */}
      {[16, 36, 56].map((x) => (
        <line key={`v${x}`} x1={x} y1="5" x2={x} y2="75" stroke={color} strokeWidth="0.8" strokeDasharray="6 3" opacity="0.4" />
      ))}
      {[16, 36, 56].map((y) => (
        <line key={`h${y}`} x1="5" y1={y} x2="75" y2={y} stroke={color} strokeWidth="0.8" strokeDasharray="6 3" opacity="0.4" />
      ))}
      {/* Grid nodes */}
      {[16, 36, 56].map((x) =>
        [16, 36, 56].map((y) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="3" fill={`${color}20`} stroke={color} strokeWidth="1" />
            <circle cx={x} cy={y} r="1" fill={color} opacity="0.8" />
          </g>
        )),
      )}
      {/* Grid labels */}
      <text x="16" y="10" fill={color} fontSize="5" fontFamily="monospace" opacity="0.5" textAnchor="middle">A</text>
      <text x="36" y="10" fill={color} fontSize="5" fontFamily="monospace" opacity="0.5" textAnchor="middle">B</text>
      <text x="56" y="10" fill={color} fontSize="5" fontFamily="monospace" opacity="0.5" textAnchor="middle">C</text>
      <text x="8" y="18" fill={color} fontSize="5" fontFamily="monospace" opacity="0.5" textAnchor="middle">1</text>
      <text x="8" y="38" fill={color} fontSize="5" fontFamily="monospace" opacity="0.5" textAnchor="middle">2</text>
      <text x="8" y="58" fill={color} fontSize="5" fontFamily="monospace" opacity="0.5" textAnchor="middle">3</text>
      {/* Beams between nodes */}
      {[16, 36].map((x) =>
        [16, 36].map((y) => (
          <g key={`beam-${x}-${y}`}>
            <rect x={x + 3} y={y - 1} width={17} height={2} fill={`${color}12`} stroke={color} strokeWidth="0.3" rx="0.5" />
            <rect x={x - 1} y={y + 3} width={2} height={17} fill={`${color}12`} stroke={color} strokeWidth="0.3" rx="0.5" />
          </g>
        )),
      )}
      {/* Load arrow */}
      <line x1="36" y1="62" x2="36" y2="72" stroke={color} strokeWidth="1" opacity="0.5" />
      <polygon points="33,72 36,76 39,72" fill={color} opacity="0.5" />
      <text x="36" y="80" fill={color} fontSize="4" fontFamily="monospace" opacity="0.4" textAnchor="middle">LOAD</text>
    </svg>
  );
}

// ─── Component ──────────────────────────────────────────────────────

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
  const [hoveredType, setHoveredType] = useState<FeedbackType | null>(null);

  const [history, setHistory] = useState<FeedbackItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Screenshot must be under 5MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    setScreenshot(file);
    const reader = new FileReader();
    reader.onload = () => setScreenshotPreview(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) handleScreenshot(file);
          break;
        }
      }
    },
    [handleScreenshot],
  );

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

      if (!res.ok) {
        toast.error(data.error || "Failed to submit feedback");
        return;
      }

      setSubmitted(true);
      toast.success(isDE ? "Feedback gesendet!" : "Feedback submitted!", {
        icon: <CheckCircle2 size={18} />,
      });
    } catch {
      toast.error(isDE ? "Fehler beim Senden" : "Failed to submit");
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setSelectedType(null);
    setTitle("");
    setDescription("");
    setCategory("");
    setScreenshot(null);
    setScreenshotPreview(null);
    setSubmitted(false);
  };

  const selectedTypeInfo = FEEDBACK_TYPES.find((ft) => ft.id === selectedType);

  const inputStyle = (field: string, isTextarea = false) => ({
    width: "100%",
    padding: "14px 18px",
    height: isTextarea ? 180 : 50,
    borderRadius: 14,
    border: `1px solid ${
      focusedField === field
        ? `${selectedTypeInfo?.color || "#4F8AFF"}50`
        : "rgba(255,255,255,0.06)"
    }`,
    background: "rgba(6,8,12,0.7)",
    color: "#F0F0F5",
    fontSize: 14,
    outline: "none",
    transition: "all 0.3s cubic-bezier(0.25,0.4,0.25,1)",
    boxShadow:
      focusedField === field
        ? `0 0 0 3px ${selectedTypeInfo?.color || "#4F8AFF"}12, 0 0 20px ${selectedTypeInfo?.color || "#4F8AFF"}08`
        : "none",
    resize: "none" as const,
    fontFamily: "inherit",
    letterSpacing: "0.2px",
  });

  return (
    <div className="flex flex-col h-screen overflow-hidden relative">
      {/* ── Architectural Background ─────────────────────── */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
        {/* Blueprint grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `
              linear-gradient(rgba(79,138,255,0.04) 1px, transparent 1px),
              linear-gradient(90deg, rgba(79,138,255,0.04) 1px, transparent 1px),
              linear-gradient(rgba(79,138,255,0.015) 1px, transparent 1px),
              linear-gradient(90deg, rgba(79,138,255,0.015) 1px, transparent 1px)
            `,
            backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px",
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 10%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 10%, transparent 70%)",
          }}
        />

        {/* Floating orbs */}
        <div
          className="orb-drift-1"
          style={{
            position: "absolute",
            top: "5%",
            right: "10%",
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(79,138,255,0.06) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="orb-drift-2"
          style={{
            position: "absolute",
            bottom: "10%",
            left: "5%",
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(16,185,129,0.05) 0%, transparent 70%)",
            filter: "blur(50px)",
          }}
        />
        <div
          className="orb-drift-3"
          style={{
            position: "absolute",
            top: "40%",
            left: "30%",
            width: 300,
            height: 300,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,92,246,0.04) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />

        {/* Scanning beam */}
        <div className="scan-beam" style={{ position: "absolute", top: "25%", left: 0, right: 0 }} />
      </div>

      <Header
        title={isDE ? "Beta-Feedback" : "Beta Feedback"}
        subtitle={
          isDE
            ? "Gestalten Sie die Zukunft der AEC-Automatisierung mit"
            : "Help shape the future of AEC automation"
        }
      />

      <main className="flex-1 overflow-y-auto relative z-1">
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "16px 24px 100px" }}>
          {/* ── Hero Banner ───────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: smoothEase }}
            style={{
              position: "relative",
              padding: "32px 36px",
              borderRadius: 20,
              border: "1px solid rgba(79,138,255,0.12)",
              background: "linear-gradient(135deg, rgba(79,138,255,0.04) 0%, rgba(139,92,246,0.03) 50%, rgba(16,185,129,0.03) 100%)",
              marginBottom: 32,
              overflow: "hidden",
            }}
          >
            {/* Decorative architectural lines */}
            <svg
              style={{ position: "absolute", top: 0, right: 0, width: 300, height: "100%", opacity: 0.08 }}
              viewBox="0 0 300 160"
              fill="none"
              preserveAspectRatio="xMaxYMid slice"
            >
              <line x1="50" y1="0" x2="50" y2="160" stroke="#4F8AFF" strokeWidth="0.5" strokeDasharray="8 4" />
              <line x1="120" y1="0" x2="120" y2="160" stroke="#4F8AFF" strokeWidth="0.5" strokeDasharray="8 4" />
              <line x1="190" y1="0" x2="190" y2="160" stroke="#4F8AFF" strokeWidth="0.5" strokeDasharray="8 4" />
              <line x1="260" y1="0" x2="260" y2="160" stroke="#4F8AFF" strokeWidth="0.5" strokeDasharray="8 4" />
              <line x1="0" y1="40" x2="300" y2="40" stroke="#8B5CF6" strokeWidth="0.5" strokeDasharray="8 4" />
              <line x1="0" y1="80" x2="300" y2="80" stroke="#8B5CF6" strokeWidth="0.5" strokeDasharray="8 4" />
              <line x1="0" y1="120" x2="300" y2="120" stroke="#8B5CF6" strokeWidth="0.5" strokeDasharray="8 4" />
              {/* Nodes at intersections */}
              {[50, 120, 190, 260].map((x) =>
                [40, 80, 120].map((y) => (
                  <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="#4F8AFF" opacity="0.4" />
                )),
              )}
            </svg>

            <div style={{ position: "relative", zIndex: 1 }}>
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  borderRadius: 20,
                  background: "rgba(79,138,255,0.1)",
                  border: "1px solid rgba(79,138,255,0.15)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#4F8AFF",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-jetbrains), monospace",
                  marginBottom: 16,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4F8AFF", boxShadow: "0 0 8px #4F8AFF", animation: "breathe 3s ease-in-out infinite" }} />
                {isDE ? "BETA-PROGRAMM AKTIV" : "BETA PROGRAM ACTIVE"}
              </motion.div>

              <h2
                style={{
                  fontSize: "clamp(1.3rem, 2.5vw, 1.7rem)",
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.2,
                  marginBottom: 8,
                  color: "#F0F2FF",
                }}
              >
                {isDE ? "Bauen Sie BuildFlow mit uns." : "Build BuildFlow with us."}
              </h2>
              <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.6, maxWidth: 520 }}>
                {isDE
                  ? "Ihr Feedback formt die naechste Generation von AEC-Werkzeugen. Von IFC-Parsing bis KI-Rendering — jede Idee zaehlt."
                  : "Your feedback shapes the next generation of AEC tools. From IFC parsing to AI rendering — every idea counts."}
              </p>
            </div>
          </motion.div>

          {/* ── Success State ────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.5, ease: smoothEase }}
                style={{
                  textAlign: "center",
                  padding: "72px 32px",
                  borderRadius: 20,
                  border: "1px solid rgba(16,185,129,0.15)",
                  background: "linear-gradient(180deg, rgba(16,185,129,0.04) 0%, rgba(6,8,12,0.8) 100%)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* Success building SVG */}
                <div style={{ position: "absolute", top: 20, right: 40, opacity: 0.1 }}>
                  <BlueprintBuildingSVG color="#10B981" size={120} />
                </div>

                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.05) 100%)",
                    border: "2px solid rgba(16,185,129,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 28px",
                    boxShadow: "0 0 40px rgba(16,185,129,0.15), 0 0 80px rgba(16,185,129,0.05)",
                  }}
                >
                  <CheckCircle2 size={36} color="#10B981" />
                </motion.div>
                <h2 style={{ fontSize: 28, fontWeight: 800, color: "#F0F0F5", marginBottom: 12, letterSpacing: "-0.02em" }}>
                  {isDE ? "Vielen Dank!" : "Thank You!"}
                </h2>
                <p style={{ fontSize: 15, color: "#9898B0", lineHeight: 1.7, maxWidth: 480, margin: "0 auto 36px" }}>
                  {isDE
                    ? "Ihr Feedback wurde erfolgreich gesendet. Jede Einreichung wird von unserem Team geprüft."
                    : "Your feedback has been submitted. Every submission is reviewed by our team to shape BuildFlow's roadmap."}
                </p>
                <motion.button
                  onClick={resetForm}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    padding: "14px 32px",
                    borderRadius: 14,
                    border: "1px solid rgba(16,185,129,0.25)",
                    background: "rgba(16,185,129,0.08)",
                    color: "#34D399",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.3s",
                    letterSpacing: "0.3px",
                  }}
                >
                  {isDE ? "Weiteres Feedback senden" : "Submit More Feedback"}
                </motion.button>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {/* ── Feedback Type Cards ─────────────────────── */}
                <div style={{ marginBottom: 32 }}>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ width: 20, height: 1, background: "linear-gradient(90deg, transparent, rgba(79,138,255,0.3))" }} />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#5C5C78",
                        textTransform: "uppercase",
                        letterSpacing: "2px",
                        fontFamily: "var(--font-jetbrains), monospace",
                      }}
                    >
                      {isDE ? "FEEDBACK-TYP WAEHLEN" : "SELECT FEEDBACK TYPE"}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(79,138,255,0.3), transparent)" }} />
                  </motion.div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                    {FEEDBACK_TYPES.map((ft, idx) => {
                      const isSelected = selectedType === ft.id;
                      const isHovered = hoveredType === ft.id;
                      const SVGComponent = idx === 0 ? StructuralGridSVG : idx === 1 ? FloorPlanSVG : BlueprintBuildingSVG;

                      return (
                        <motion.button
                          key={ft.id}
                          onClick={() => setSelectedType(ft.id)}
                          onMouseEnter={() => setHoveredType(ft.id)}
                          onMouseLeave={() => setHoveredType(null)}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.35 + idx * 0.1, duration: 0.5, ease: smoothEase }}
                          whileTap={{ scale: 0.97 }}
                          style={{
                            position: "relative",
                            padding: "28px 24px 24px",
                            borderRadius: 18,
                            border: `1.5px solid ${isSelected ? `${ft.color}50` : isHovered ? `${ft.color}25` : "rgba(255,255,255,0.06)"}`,
                            background: isSelected
                              ? `linear-gradient(180deg, ${ft.color}10 0%, rgba(6,8,12,0.9) 100%)`
                              : "rgba(12,12,20,0.6)",
                            backdropFilter: "blur(12px)",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "all 0.4s cubic-bezier(0.25,0.4,0.25,1)",
                            overflow: "hidden",
                            transform: isHovered && !isSelected ? "translateY(-4px)" : "none",
                            boxShadow: isSelected
                              ? `0 0 30px ${ft.color}15, 0 8px 32px rgba(0,0,0,0.3)`
                              : isHovered
                                ? `0 8px 24px rgba(0,0,0,0.25)`
                                : "0 2px 8px rgba(0,0,0,0.1)",
                          }}
                        >
                          {/* Glow effect on select */}
                          {isSelected && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              style={{
                                position: "absolute",
                                top: -1,
                                left: "10%",
                                right: "10%",
                                height: 2,
                                background: ft.gradient,
                                borderRadius: "0 0 4px 4px",
                                boxShadow: `0 0 20px ${ft.color}60`,
                              }}
                            />
                          )}

                          {/* Background SVG illustration */}
                          <div
                            style={{
                              position: "absolute",
                              bottom: -5,
                              right: -5,
                              opacity: isSelected ? 0.15 : isHovered ? 0.08 : 0.04,
                              transition: "opacity 0.4s ease",
                              transform: "rotate(-5deg)",
                            }}
                          >
                            <SVGComponent color={ft.color} size={100} />
                          </div>

                          {/* Icon */}
                          <motion.div
                            animate={{
                              scale: isSelected ? 1.1 : 1,
                              boxShadow: isSelected ? `0 0 24px ${ft.color}30` : "none",
                            }}
                            transition={{ duration: 0.3 }}
                            style={{
                              width: 48,
                              height: 48,
                              borderRadius: 14,
                              background: `linear-gradient(135deg, ${ft.color}18, ${ft.color}08)`,
                              border: `1px solid ${ft.color}25`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginBottom: 18,
                              position: "relative",
                              zIndex: 1,
                            }}
                          >
                            <ft.icon size={22} color={ft.color} strokeWidth={isSelected ? 2.5 : 2} />
                          </motion.div>

                          {/* Text */}
                          <div style={{ position: "relative", zIndex: 1 }}>
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 700,
                                color: isSelected ? ft.color : "#E8ECF8",
                                marginBottom: 6,
                                transition: "color 0.3s",
                                letterSpacing: "-0.01em",
                              }}
                            >
                              {isDE ? ft.labelDe : ft.label}
                            </div>
                            <div style={{ fontSize: 12.5, color: "#7C7C96", lineHeight: 1.5 }}>
                              {isDE ? ft.descDe : ft.description}
                            </div>
                          </div>

                          {/* Selection indicator */}
                          {isSelected && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              style={{
                                position: "absolute",
                                top: 14,
                                right: 14,
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                background: ft.gradient,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: `0 0 12px ${ft.color}40`,
                              }}
                            >
                              <CheckCircle2 size={14} color="#fff" strokeWidth={2.5} />
                            </motion.div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Details Form ────────────────────────────── */}
                <AnimatePresence>
                  {selectedType && selectedTypeInfo && (
                    <motion.form
                      onSubmit={handleSubmit}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.4, ease: smoothEase }}
                    >
                      <div
                        style={{
                          padding: "28px 28px 24px",
                          borderRadius: 20,
                          border: `1px solid ${selectedTypeInfo.color}15`,
                          background: "linear-gradient(180deg, rgba(12,12,20,0.8) 0%, rgba(6,8,12,0.9) 100%)",
                          backdropFilter: "blur(12px)",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        {/* Subtle corner decoration */}
                        <div
                          style={{
                            position: "absolute",
                            top: 0,
                            right: 0,
                            width: 120,
                            height: 120,
                            background: `radial-gradient(circle at 100% 0%, ${selectedTypeInfo.color}06, transparent 70%)`,
                            pointerEvents: "none",
                          }}
                        />

                        {/* Section header */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                          <div
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: selectedTypeInfo.color,
                              boxShadow: `0 0 12px ${selectedTypeInfo.color}`,
                              animation: "breathe 2.5s ease-in-out infinite",
                            }}
                          />
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: selectedTypeInfo.color,
                              textTransform: "uppercase",
                              letterSpacing: "2px",
                              fontFamily: "var(--font-jetbrains), monospace",
                            }}
                          >
                            {isDE ? "DETAILS EINGEBEN" : "ENTER DETAILS"}
                          </span>
                          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${selectedTypeInfo.color}20, transparent)` }} />
                        </div>

                        {/* Title */}
                        <div style={{ marginBottom: 18 }}>
                          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#B0B0C8", marginBottom: 7 }}>
                            {isDE ? "Titel" : "Title"} <span style={{ color: selectedTypeInfo.color }}>*</span>
                          </label>
                          <input
                            type="text"
                            placeholder={
                              selectedType === "BUG"
                                ? isDE
                                  ? "z.B. Canvas friert ein beim Zoomen mit 50+ Nodes"
                                  : "e.g. Canvas freezes when zooming with 50+ nodes"
                                : selectedType === "FEATURE"
                                  ? isDE
                                    ? "z.B. Revit-Export-Node mit Parametern"
                                    : "e.g. Revit export node with parametric mapping"
                                  : isDE
                                    ? "z.B. Automatische BOQ-Generierung aus IFC"
                                    : "e.g. Automated BOQ generation from IFC models"
                            }
                            required
                            maxLength={200}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onFocus={() => setFocusedField("title")}
                            onBlur={() => setFocusedField(null)}
                            style={inputStyle("title")}
                          />
                          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: title.length > 180 ? "#F59E0B" : "#3A3A50", fontFamily: "var(--font-jetbrains), monospace" }}>
                              {title.length}/200
                            </span>
                          </div>
                        </div>

                        {/* Description */}
                        <div style={{ marginBottom: 18 }}>
                          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#B0B0C8", marginBottom: 7 }}>
                            {isDE ? "Beschreibung" : "Description"} <span style={{ color: selectedTypeInfo.color }}>*</span>
                          </label>
                          <textarea
                            placeholder={
                              selectedType === "BUG"
                                ? isDE
                                  ? "Schritte zum Reproduzieren:\n1. ...\n2. ...\n\nErwartetes Verhalten:\n\nTatsaechliches Verhalten:"
                                  : "Steps to reproduce:\n1. ...\n2. ...\n\nExpected behavior:\n\nActual behavior:"
                                : selectedType === "FEATURE"
                                  ? isDE
                                    ? "Beschreiben Sie die gewuenschte Funktion:\n\nAktueller Workflow:\n\nWie wuerde diese Funktion helfen?"
                                    : "Describe the feature:\n\nCurrent workflow:\n\nHow would this improve your process?"
                                  : isDE
                                    ? "Welches Problem loest dies fuer die AEC-Branche?\n\nAktuelle Methoden:\n\nIhre Vision:"
                                    : "What problem does this solve for AEC?\n\nCurrent methods:\n\nYour vision:"
                            }
                            required
                            maxLength={5000}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            onFocus={() => setFocusedField("description")}
                            onBlur={() => setFocusedField(null)}
                            style={inputStyle("description", true)}
                          />
                          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: description.length > 4800 ? "#F59E0B" : "#3A3A50", fontFamily: "var(--font-jetbrains), monospace" }}>
                              {description.length}/5000
                            </span>
                          </div>
                        </div>

                        {/* AEC Category Tags */}
                        <div style={{ marginBottom: 22 }}>
                          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#B0B0C8", marginBottom: 10 }}>
                            {isDE ? "AEC-Kategorie (optional)" : "AEC Category (optional)"}
                          </label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {AEC_CATEGORIES.map((cat) => {
                              const isActive = category === cat.label;
                              const CatIcon = cat.icon;
                              return (
                                <motion.button
                                  key={cat.label}
                                  type="button"
                                  onClick={() => setCategory(isActive ? "" : cat.label)}
                                  whileHover={{ scale: 1.04, y: -1 }}
                                  whileTap={{ scale: 0.96 }}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "7px 14px",
                                    borderRadius: 20,
                                    border: `1px solid ${isActive ? `${cat.color}40` : "rgba(255,255,255,0.06)"}`,
                                    background: isActive ? `${cat.color}12` : "rgba(255,255,255,0.02)",
                                    color: isActive ? cat.color : "#7C7C96",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    transition: "all 0.2s",
                                    boxShadow: isActive ? `0 0 12px ${cat.color}15` : "none",
                                  }}
                                >
                                  <CatIcon size={12} strokeWidth={2} />
                                  {cat.label}
                                </motion.button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Screenshot Upload */}
                        <div style={{ marginBottom: 28 }}>
                          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#B0B0C8", marginBottom: 10 }}>
                            {isDE ? "Screenshot (optional)" : "Screenshot (optional)"}
                          </label>

                          {screenshotPreview ? (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              style={{ position: "relative", display: "inline-block" }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={screenshotPreview}
                                alt="Screenshot preview"
                                style={{
                                  maxWidth: "100%",
                                  maxHeight: 220,
                                  borderRadius: 14,
                                  border: `1px solid ${selectedTypeInfo.color}20`,
                                  boxShadow: `0 4px 20px rgba(0,0,0,0.3)`,
                                }}
                              />
                              <motion.button
                                type="button"
                                onClick={() => {
                                  setScreenshot(null);
                                  setScreenshotPreview(null);
                                }}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                style={{
                                  position: "absolute",
                                  top: 10,
                                  right: 10,
                                  width: 30,
                                  height: 30,
                                  borderRadius: "50%",
                                  background: "rgba(0,0,0,0.8)",
                                  border: "1px solid rgba(255,255,255,0.15)",
                                  color: "#fff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  backdropFilter: "blur(8px)",
                                }}
                              >
                                <X size={14} />
                              </motion.button>
                            </motion.div>
                          ) : (
                            <motion.button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              whileHover={{ borderColor: `${selectedTypeInfo.color}30`, background: `${selectedTypeInfo.color}04` }}
                              style={{
                                width: "100%",
                                padding: "32px 24px",
                                borderRadius: 14,
                                border: "2px dashed rgba(255,255,255,0.06)",
                                background: "rgba(255,255,255,0.01)",
                                color: "#7C7C96",
                                cursor: "pointer",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 10,
                                transition: "all 0.3s",
                                position: "relative",
                                overflow: "hidden",
                              }}
                            >
                              {/* Corner marks */}
                              {[
                                { top: 8, left: 8 },
                                { top: 8, right: 8 },
                                { bottom: 8, left: 8 },
                                { bottom: 8, right: 8 },
                              ].map((pos, i) => (
                                <div
                                  key={i}
                                  style={{
                                    position: "absolute",
                                    ...pos,
                                    width: 12,
                                    height: 12,
                                    borderTop: i < 2 ? `2px solid ${selectedTypeInfo.color}25` : "none",
                                    borderBottom: i >= 2 ? `2px solid ${selectedTypeInfo.color}25` : "none",
                                    borderLeft: i % 2 === 0 ? `2px solid ${selectedTypeInfo.color}25` : "none",
                                    borderRight: i % 2 === 1 ? `2px solid ${selectedTypeInfo.color}25` : "none",
                                  } as React.CSSProperties}
                                />
                              ))}
                              <div
                                style={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: 12,
                                  background: `${selectedTypeInfo.color}08`,
                                  border: `1px solid ${selectedTypeInfo.color}15`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <ImagePlus size={20} strokeWidth={1.5} color={selectedTypeInfo.color} />
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>
                                {isDE ? "Bild hochladen oder einfuegen" : "Upload or paste screenshot"}{" "}
                                <span style={{ color: "#5C5C78" }}>(Ctrl+V)</span>
                              </span>
                              <span style={{ fontSize: 11, color: "#3A3A50" }}>PNG, JPG, WebP — max 5MB</span>
                            </motion.button>
                          )}
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleScreenshot(file);
                            }}
                            style={{ display: "none" }}
                          />
                        </div>

                        {/* Submit Button */}
                        <motion.button
                          type="submit"
                          disabled={sending || !title.trim() || !description.trim()}
                          whileHover={{ scale: 1.01, boxShadow: `0 4px 30px ${selectedTypeInfo.color}25` }}
                          whileTap={{ scale: 0.98 }}
                          style={{
                            width: "100%",
                            padding: "16px 24px",
                            borderRadius: 14,
                            border: "none",
                            fontSize: 15,
                            fontWeight: 700,
                            color: "white",
                            background: selectedTypeInfo.gradient,
                            boxShadow: `0 2px 20px ${selectedTypeInfo.color}30`,
                            cursor: sending || !title.trim() || !description.trim() ? "not-allowed" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 10,
                            opacity: sending || !title.trim() || !description.trim() ? 0.4 : 1,
                            transition: "opacity 0.3s",
                            letterSpacing: "0.3px",
                            position: "relative",
                            overflow: "hidden",
                          }}
                        >
                          {/* Shimmer sweep on hover */}
                          <div
                            style={{
                              position: "absolute",
                              top: 0,
                              left: "-100%",
                              width: "200%",
                              height: "100%",
                              background: "linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.1) 50%, transparent 70%)",
                              animation: sending ? "none" : "shimmer-sweep 3s ease-in-out infinite",
                              pointerEvents: "none",
                            }}
                          />
                          {sending ? (
                            <>
                              <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                              {isDE ? "Wird gesendet..." : "Submitting..."}
                            </>
                          ) : (
                            <>
                              <Send size={18} />
                              {isDE ? "Feedback senden" : "Submit Feedback"}
                            </>
                          )}
                        </motion.button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Submission History ────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            style={{ marginTop: 40 }}
          >
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "14px 18px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.05)",
                background: "rgba(255,255,255,0.02)",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "rgba(79,138,255,0.08)",
                  border: "1px solid rgba(79,138,255,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Clock size={14} color="#4F8AFF" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#B0B0C8", letterSpacing: "0.3px" }}>
                {isDE ? "Meine Einreichungen" : "My Submissions"}
              </span>
              {history.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    borderRadius: 12,
                    background: "rgba(79,138,255,0.1)",
                    color: "#4F8AFF",
                    fontWeight: 700,
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}
                >
                  {history.length}
                </span>
              )}
              <ChevronDown
                size={14}
                color="#5C5C78"
                style={{
                  marginLeft: "auto",
                  transition: "transform 0.3s cubic-bezier(0.25,0.4,0.25,1)",
                  transform: showHistory ? "rotate(180deg)" : "rotate(0deg)",
                }}
              />
            </button>

            <AnimatePresence>
              {showHistory && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, ease: smoothEase }}
                  style={{ overflow: "hidden" }}
                >
                  {loadingHistory ? (
                    <div style={{ padding: "40px 0", textAlign: "center", color: "#7C7C96" }}>
                      <Loader2 size={22} style={{ animation: "spin 1s linear infinite", margin: "0 auto 10px", display: "block" }} color="#4F8AFF" />
                      <span style={{ fontSize: 13 }}>{isDE ? "Laden..." : "Loading..."}</span>
                    </div>
                  ) : history.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      style={{
                        padding: "48px 24px",
                        textAlign: "center",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.04)",
                        background: "rgba(255,255,255,0.01)",
                        marginTop: 12,
                      }}
                    >
                      <div style={{ opacity: 0.3, marginBottom: 12 }}>
                        <FloorPlanSVG color="#5C5C78" size={60} />
                      </div>
                      <span style={{ fontSize: 14, color: "#5C5C78" }}>
                        {isDE ? "Noch kein Feedback eingereicht" : "No feedback submitted yet"}
                      </span>
                    </motion.div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                      {history.map((item, i) => {
                        const typeInfo = FEEDBACK_TYPES.find((ft) => ft.id === item.type);
                        const statusInfo = STATUS_MAP[item.status] || STATUS_MAP.NEW;
                        const TypeIcon = typeInfo?.icon || AlertTriangle;

                        return (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.06, duration: 0.35 }}
                            style={{
                              padding: "18px 22px",
                              borderRadius: 14,
                              border: `1px solid ${typeInfo?.color || "#666"}12`,
                              background: "rgba(12,12,20,0.6)",
                              backdropFilter: "blur(8px)",
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 16,
                              transition: "border-color 0.2s",
                            }}
                          >
                            <div
                              style={{
                                width: 38,
                                height: 38,
                                borderRadius: 10,
                                background: `${typeInfo?.color || "#666"}10`,
                                border: `1px solid ${typeInfo?.color || "#666"}20`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <TypeIcon size={16} color={typeInfo?.color || "#666"} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: "#E8ECF8" }}>{item.title}</span>
                                <span
                                  style={{
                                    fontSize: 9,
                                    padding: "3px 9px",
                                    borderRadius: 10,
                                    background: statusInfo.bg,
                                    color: statusInfo.text,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.8px",
                                    fontFamily: "var(--font-jetbrains), monospace",
                                    boxShadow: statusInfo.glow,
                                  }}
                                >
                                  {statusInfo.label}
                                </span>
                                {item.category && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      padding: "2px 8px",
                                      borderRadius: 10,
                                      background: "rgba(255,255,255,0.03)",
                                      color: "#7C7C96",
                                      fontWeight: 500,
                                      border: "1px solid rgba(255,255,255,0.04)",
                                    }}
                                  >
                                    {item.category}
                                  </span>
                                )}
                              </div>
                              <p
                                style={{
                                  fontSize: 12.5,
                                  color: "#7C7C96",
                                  lineHeight: 1.5,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                }}
                              >
                                {item.description}
                              </p>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "#3A3A50",
                                  marginTop: 8,
                                  fontFamily: "var(--font-jetbrains), monospace",
                                }}
                              >
                                {new Date(item.createdAt).toLocaleDateString(isDE ? "de-DE" : "en-US", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </div>
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

          {/* ── What We're Looking For ───────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.5 }}
            style={{ marginTop: 40 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <div style={{ width: 20, height: 1, background: "linear-gradient(90deg, transparent, rgba(255,191,0,0.3))" }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#5C5C78",
                  textTransform: "uppercase",
                  letterSpacing: "2px",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {isDE ? "WAS UNS INTERESSIERT" : "WHAT WE'RE LOOKING FOR"}
              </span>
              <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(255,191,0,0.3), transparent)" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
              {[
                {
                  icon: Building2,
                  color: "#4F8AFF",
                  gradient: "linear-gradient(135deg, rgba(79,138,255,0.08), rgba(79,138,255,0.02))",
                  title: isDE ? "AEC-Workflows" : "AEC Workflows",
                  desc: isDE
                    ? "IFC-Parsing, BOQ-Generierung, Planpruefung, BIM-Koordination — welche Prozesse sollen automatisiert werden?"
                    : "IFC parsing, BOQ generation, plan review, BIM coordination — which processes need automation?",
                  SVG: BlueprintBuildingSVG,
                },
                {
                  icon: Sparkles,
                  color: "#FBBF24",
                  gradient: "linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02))",
                  title: isDE ? "KI-Potenzial" : "AI Potential",
                  desc: isDE
                    ? "KI-gestuetzte Renderings, automatische Grundrisse, Kostenschaetzung — wo hilft KI am meisten?"
                    : "AI-powered renders, auto floor plans, cost estimation — where would AI help most?",
                  SVG: FloorPlanSVG,
                },
                {
                  icon: AlertTriangle,
                  color: "#F87171",
                  gradient: "linear-gradient(135deg, rgba(248,113,113,0.08), rgba(248,113,113,0.02))",
                  title: isDE ? "Branchenluecken" : "Industry Gaps",
                  desc: isDE
                    ? "Was fehlt im AEC-Tech-Stack? Revit-Limitierungen, Interoperabilitaet, Collaboration-Probleme?"
                    : "What's missing in the AEC tech stack? Revit limitations, interoperability, collaboration gaps?",
                  SVG: StructuralGridSVG,
                },
              ].map((card, i) => (
                <motion.div
                  key={card.title}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 + i * 0.1, duration: 0.4 }}
                  whileHover={{ y: -4, borderColor: `${card.color}20` }}
                  style={{
                    padding: "24px",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.05)",
                    background: card.gradient,
                    backdropFilter: "blur(8px)",
                    position: "relative",
                    overflow: "hidden",
                    transition: "all 0.3s",
                    cursor: "default",
                  }}
                >
                  <div style={{ position: "absolute", bottom: -10, right: -10, opacity: 0.06 }}>
                    <card.SVG color={card.color} size={90} />
                  </div>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: `${card.color}12`,
                      border: `1px solid ${card.color}18`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 14,
                      position: "relative",
                      zIndex: 1,
                    }}
                  >
                    <card.icon size={18} color={card.color} />
                  </div>
                  <h4 style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF8", marginBottom: 6, position: "relative", zIndex: 1 }}>
                    {card.title}
                  </h4>
                  <p style={{ fontSize: 12.5, color: "#7C7C96", lineHeight: 1.6, position: "relative", zIndex: 1 }}>{card.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </main>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes shimmer-sweep {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(50%); }
        }
        @media (max-width: 768px) {
          .feedback-type-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
