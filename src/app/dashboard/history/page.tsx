"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, CheckCircle2, XCircle, Loader2, RefreshCw,
  ChevronDown, ChevronUp, FileText, Image, Table2,
  ExternalLink, AlertCircle, GitCompareArrows,
  ArrowRight, Activity, Share2,
} from "lucide-react";
import { shareHistoryToTwitter } from "@/lib/share";
import { Header } from "@/components/dashboard/Header";
import { PageBackground } from "@/components/dashboard/PageBackground";
import { toast } from "sonner";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

interface Artifact {
  id: string; nodeId: string; nodeLabel: string | null;
  type: string; title: string | null; data: Record<string, unknown>; createdAt: string;
}

interface Execution {
  id: string; workflowId: string; status: string;
  startedAt: string; completedAt: string | null;
  tileResults: Record<string, unknown>; errorMessage: string | null;
  workflow: { id: string; name: string }; artifacts: Artifact[];
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function relativeTime(date: string, t: (key: TranslationKey) => string) {
  const diff = Date.now() - new Date(date).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}${t('history.secondsAgo')}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${t('history.minutesAgo')}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${t('history.hoursAgo')}`;
  return new Date(date).toLocaleDateString();
}

function duration(start: string, end: string | null) {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function ArtifactIcon({ type }: { type: string }) {
  const s = { opacity: 0.7 };
  // eslint-disable-next-line jsx-a11y/alt-text
  if (type === "image") return <Image size={11} style={s} />;
  if (type === "table" || type === "kpi") return <Table2 size={11} style={s} />;
  return <FileText size={11} style={s} />;
}

const STATUS_CONFIG: Record<string, { color: string; glow: string }> = {
  SUCCESS: { color: "#34D399", glow: "0 0 12px rgba(52,211,153,0.4)" },
  PARTIAL: { color: "#F59E0B", glow: "0 0 12px rgba(245,158,11,0.4)" },
  FAILED:  { color: "#F87171", glow: "0 0 12px rgba(248,113,113,0.4)" },
  RUNNING: { color: "#4F8AFF", glow: "0 0 12px rgba(79,138,255,0.5)" },
  PENDING: { color: "#55556A", glow: "none" },
};

// ──────────────────────────────────────────────────────────────────
// Animated Counter — easeOut from 0 to value
// ──────────────────────────────────────────────────────────────────

function AnimatedNumber({ value, color }: { value: number; color: string }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 900, 1);
      setDisplay(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return (
    <span style={{
      fontFamily: "var(--font-jetbrains), monospace",
      fontSize: 38, fontWeight: 700, lineHeight: 1, color,
      letterSpacing: "-0.04em",
    }}>
      {display}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// Mini EKG line — animated SVG heartbeat for stat cards
// ──────────────────────────────────────────────────────────────────

function EKGLine({ color, delay = 0 }: { color: string; delay?: number }) {
  return (
    <svg width="100%" height="24" viewBox="0 0 120 24" preserveAspectRatio="none"
      style={{ display: "block", marginTop: 8, opacity: 0.4 }}>
      <motion.path
        d="M0 12 L20 12 L25 4 L30 20 L35 8 L40 16 L45 12 L120 12"
        fill="none" stroke={color} strokeWidth={1.2}
        strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.5, delay: delay + 0.3, ease: "easeOut" }}
      />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// Stat Card — vital sign feel
// ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, delay }: {
  label: string; value: number; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: "rgba(12,12,22,0.7)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 14, padding: "20px 22px",
      }}
    >
      {/* Top accent line */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${color}, transparent)`,
        opacity: 0.6,
      }} />
      <div style={{ fontSize: 11, color: "#55556A", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
        {label}
      </div>
      <AnimatedNumber value={value} color={color} />
      <EKGLine color={color} delay={delay} />
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Status Badge
// ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  const labels: Record<string, string> = {
    SUCCESS: t('history.completed'), PARTIAL: t('history.partial'),
    FAILED: t('history.failed'), RUNNING: t('history.running'),
    PENDING: t('history.pending'),
  };
  const icons: Record<string, React.ReactNode> = {
    SUCCESS: <CheckCircle2 size={11} />, PARTIAL: <CheckCircle2 size={11} />,
    FAILED: <XCircle size={11} />, RUNNING: <Loader2 size={11} className="animate-spin" />,
    PENDING: <Clock size={11} />,
  };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600,
      background: `${cfg.color}12`, border: `1px solid ${cfg.color}25`,
      color: cfg.color,
    }}>
      {icons[status] ?? icons.PENDING} {labels[status] ?? labels.PENDING}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// Artifact Preview
// ──────────────────────────────────────────────────────────────────

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const { t } = useLocale();
  const d = artifact.data;
  let preview = "";
  if (artifact.type === "text") {
    const text = (d.text ?? d.description ?? d.content ?? "") as string;
    preview = String(text).slice(0, 50) + (String(text).length > 50 ? "..." : "");
  } else if (artifact.type === "kpi") {
    const kpis = d.kpis as Array<{ label: string; value: string | number }> | undefined;
    if (kpis?.[0]) preview = `${kpis[0].label}: ${kpis[0].value}`;
  } else if (artifact.type === "image") { preview = t('history.conceptRender'); }
  else if (artifact.type === "table") { preview = `${t('history.tablePrefix')}: ${artifact.title ?? t('history.data')}`; }
  else if (artifact.type === "file") { preview = d.fileName as string ?? t('history.file'); }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "3px 8px", borderRadius: 6,
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)",
      fontSize: 10, color: "#6B6B80", maxWidth: 170, overflow: "hidden",
    }}>
      <ArtifactIcon type={artifact.type} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {preview || artifact.title || artifact.type}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Detail Modal
// ──────────────────────────────────────────────────────────────────

function DetailModal({ execution, onClose, onRerun }: {
  execution: Execution; onClose: () => void; onRerun: () => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState<string | null>(null);
  const grouped = execution.artifacts.reduce<Record<string, Artifact[]>>((acc, a) => {
    const k = a.nodeLabel ?? a.nodeId;
    (acc[k] ??= []).push(a);
    return acc;
  }, {});

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        style={{
          width: "100%", maxWidth: 640, maxHeight: "82vh", overflow: "hidden",
          display: "flex", flexDirection: "column",
          background: "rgba(12,12,22,0.95)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16, boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
          backdropFilter: "blur(24px)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F5" }}>{execution.workflow.name}</div>
            <div style={{ fontSize: 11, color: "#44445A", marginTop: 3, display: "flex", gap: 12 }}>
              <span>{new Date(execution.startedAt).toLocaleString()}</span>
              {duration(execution.startedAt, execution.completedAt) && (
                <span>{t('history.duration')}: {duration(execution.startedAt, execution.completedAt)}</span>
              )}
              <span>{execution.artifacts.length} {t('history.artifacts')}</span>
            </div>
          </div>
          <StatusBadge status={execution.status} />
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "18px 24px" }}>
          {Object.keys(grouped).length === 0 ? (
            <div style={{ textAlign: "center", color: "#44445A", fontSize: 13, padding: 32 }}>{t('history.noArtifacts')}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(grouped).map(([label, arts]) => (
                <div key={label} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.04)", padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#A0A0B0", marginBottom: 8 }}>{label}</div>
                  {arts.map(a => (
                    <div key={a.id}>
                      <button onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                        style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
                        <ArtifactIcon type={a.type} />
                        <span style={{ fontSize: 11, color: "#7B7B90" }}>{a.title ?? a.type}</span>
                        {expanded === a.id ? <ChevronUp size={10} style={{ marginLeft: "auto", color: "#44445A" }} /> : <ChevronDown size={10} style={{ marginLeft: "auto", color: "#44445A" }} />}
                      </button>
                      {expanded === a.id && (
                        <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.4)", fontSize: 11, color: "#B0B0C0", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto" }}>
                          {a.type === "image"
                            ? // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.data.url as string} alt="artifact" style={{ maxWidth: "100%", borderRadius: 4 }} />
                            : JSON.stringify(a.data, null, 2)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "#6B6B80", fontSize: 12, cursor: "pointer" }}>{t('history.close')}</button>
          <button onClick={onRerun} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #1B4FFF, #0EA5E9)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: "0 4px 20px rgba(27,79,255,0.35)" }}>
            <RefreshCw size={11} /> {t('history.rerunWithInputs')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Execution Row — timeline node style
// ──────────────────────────────────────────────────────────────────

function ExecutionRow({ execution, onRerun, onViewDetails, compareSelected, onToggleCompare, index }: {
  execution: Execution; onRerun: (e: Execution) => void; onViewDetails: (e: Execution) => void;
  compareSelected?: boolean; onToggleCompare?: (id: string) => void; index: number;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const dur = duration(execution.startedAt, execution.completedAt);
  const cfg = STATUS_CONFIG[execution.status] ?? STATUS_CONFIG.PENDING;

  const inputSummary = (() => {
    const tr = execution.tileResults as Record<string, unknown>;
    if (tr?.inputSummary) return tr.inputSummary as string;
    const ta = execution.artifacts.find(a => a.type === "text");
    if (ta) return String(ta.data.text ?? ta.data.description ?? "").slice(0, 80);
    return null;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      style={{ display: "flex", gap: 16, position: "relative" }}
    >
      {/* Timeline spine — dot + vertical line */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20, flexShrink: 0, paddingTop: 20 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: cfg.color, boxShadow: cfg.glow,
          border: `2px solid ${cfg.color}40`,
          ...(execution.status === "RUNNING" ? { animation: "dp-pulse 2s ease-in-out infinite" } : {}),
        }} />
        <div style={{ width: 1, flex: 1, background: `linear-gradient(to bottom, ${cfg.color}30, transparent)`, marginTop: 4 }} />
      </div>

      {/* Card */}
      <div
        className="dp-exec-row"
        style={{ flex: 1, marginBottom: 4, cursor: "pointer" }}
        onClick={() => onViewDetails(execution)}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          {onToggleCompare && (
            <button onClick={e => { e.stopPropagation(); onToggleCompare(execution.id); }}
              title={t('history.selectForComparison')}
              style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                border: compareSelected ? "2px solid #4F8AFF" : "1.5px solid rgba(255,255,255,0.1)",
                background: compareSelected ? "#4F8AFF" : "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s",
              }}>
              {compareSelected && <CheckCircle2 size={10} style={{ color: "#fff" }} />}
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span onClick={e => { e.stopPropagation(); router.push(`/dashboard/canvas?id=${execution.workflowId}`); }}
                style={{ fontSize: 14, fontWeight: 600, color: "#F0F0F5", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 150ms" }}
                onMouseEnter={e => { e.currentTarget.style.color = "#4F8AFF"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#F0F0F5"; }}>
                {execution.workflow.name}
              </span>
              <StatusBadge status={execution.status} />
              {execution.artifacts.length > 0 && (
                <span style={{ padding: "2px 6px", borderRadius: 8, fontSize: 9, fontWeight: 700, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)", color: "#10B981", fontFamily: "var(--font-jetbrains), monospace" }}>
                  {execution.artifacts.length} artifacts
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#44445A" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Clock size={9} /> {relativeTime(execution.startedAt, t)}</span>
              {dur && <span style={{ fontFamily: "var(--font-jetbrains), monospace" }}>{dur}</span>}
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: 9, color: "#2A2A3A" }}>{execution.id.slice(0, 8)}</span>
            </div>
            {inputSummary && (
              <div style={{ marginTop: 5, fontSize: 11, color: "#44445A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic" }}>
                &ldquo;{inputSummary}&rdquo;
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <button onClick={e => { e.stopPropagation(); router.push(`/dashboard/canvas?id=${execution.workflowId}`); }}
              style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "#44445A", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, transition: "all 150ms" }}
              onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#44445A"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
              <ExternalLink size={9} /> {t('history.openWf')}
            </button>
            <button onClick={e => { e.stopPropagation(); onRerun(execution); }}
              style={{ padding: "5px 10px", borderRadius: 6, background: "rgba(79,138,255,0.08)", border: "1px solid rgba(79,138,255,0.2)", color: "#4F8AFF", fontSize: 10, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, transition: "all 150ms" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(79,138,255,0.16)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(79,138,255,0.08)"; }}>
              <RefreshCw size={9} /> {t('history.rerun')}
            </button>
            {execution.status === "SUCCESS" && (
              <button onClick={e => { e.stopPropagation(); shareHistoryToTwitter(execution.workflow.name, execution.artifacts.length, dur ?? "—"); }}
                title="Share on X"
                style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "#44445A", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, transition: "all 150ms" }}
                onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#44445A"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
                <Share2 size={9} /> Share
              </button>
            )}
          </div>
        </div>
        {execution.artifacts.length > 0 && (
          <div style={{ display: "flex", gap: 5, marginTop: 10, flexWrap: "wrap", paddingLeft: onToggleCompare ? 30 : 0 }}>
            {execution.artifacts.slice(0, 4).map(a => <ArtifactPreview key={a.id} artifact={a} />)}
            {execution.artifacts.length > 4 && <span style={{ fontSize: 10, color: "#2A2A3A", alignSelf: "center" }}>+{execution.artifacts.length - 4} {t('history.more')}</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Empty State — animated blueprint schematic
// ──────────────────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useLocale();
  const router = useRouter();
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.6 }}
      style={{
        textAlign: "center", padding: "80px 32px",
        background: "rgba(12,12,22,0.5)",
        border: "1px solid rgba(255,255,255,0.04)",
        borderRadius: 20, position: "relative", overflow: "hidden",
      }}
    >
      {/* Animated schematic — building wireframe dissolving into nodes */}
      <svg width="320" height="120" viewBox="0 0 320 120" style={{ margin: "0 auto 32px", display: "block" }}>
        {/* Building outline — drawn on */}
        <motion.path
          d="M80 100 L80 40 L160 20 L240 40 L240 100"
          fill="none" stroke="#1B4FFF" strokeWidth={1}
          strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.25 }}
          transition={{ duration: 2, ease: "easeInOut" }}
        />
        {/* Floor lines */}
        {[60, 80].map((y, i) => (
          <motion.line key={y} x1="80" y1={y} x2="240" y2={y}
            stroke="#1B4FFF" strokeWidth={0.5} strokeDasharray="4 4"
            initial={{ opacity: 0 }} animate={{ opacity: 0.15 }}
            transition={{ delay: 1.5 + i * 0.3, duration: 0.8 }} />
        ))}
        {/* Nodes — appearing at structural points */}
        {[
          { cx: 80, cy: 100, color: "#1B4FFF", delay: 2.0 },
          { cx: 160, cy: 20, color: "#8B5CF6", delay: 2.2 },
          { cx: 240, cy: 100, color: "#10B981", delay: 2.4 },
          { cx: 80, cy: 40, color: "#F59E0B", delay: 2.6 },
          { cx: 240, cy: 40, color: "#1B4FFF", delay: 2.8 },
        ].map((n, i) => (
          <g key={i}>
            <motion.circle cx={n.cx} cy={n.cy} r={12}
              fill="none" stroke={n.color} strokeWidth={0.8}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 0.2 }}
              transition={{ delay: n.delay, duration: 0.5, type: "spring" }}
              style={{ transformOrigin: `${n.cx}px ${n.cy}px` }} />
            <motion.circle cx={n.cx} cy={n.cy} r={3}
              fill={n.color}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 0.6 }}
              transition={{ delay: n.delay + 0.15, duration: 0.3 }}
              style={{ transformOrigin: `${n.cx}px ${n.cy}px` }} />
          </g>
        ))}
        {/* Data flow lines between nodes */}
        {[
          { d: "M93 100 L148 25", delay: 3.0, color: "#1B4FFF" },
          { d: "M172 25 L227 100", delay: 3.2, color: "#8B5CF6" },
          { d: "M93 42 L227 42", delay: 3.4, color: "#10B981" },
        ].map((l, i) => (
          <motion.path key={i} d={l.d}
            fill="none" stroke={l.color} strokeWidth={0.8}
            strokeDasharray="3 5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.2 }}
            transition={{ delay: l.delay, duration: 1 }} />
        ))}
      </svg>

      <div style={{ fontSize: 10, letterSpacing: 4, color: "rgba(255,255,255,0.15)", textTransform: "uppercase", marginBottom: 10, fontFamily: "var(--font-jetbrains), monospace" }}>
        NO MISSIONS LOGGED
      </div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.3)", maxWidth: 340, margin: "0 auto 24px", lineHeight: 1.7 }}>
        {t('history.noExecutionsDesc')}
      </div>
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => router.push('/dashboard/canvas')}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "12px 24px", borderRadius: 12,
          border: "1px solid rgba(79,138,255,0.3)",
          background: "rgba(79,138,255,0.06)",
          color: "#4F8AFF", fontSize: 13, fontWeight: 600,
          cursor: "pointer", transition: "all 200ms ease",
        }}
      >
        <ArrowRight size={14} /> Launch First Workflow
      </motion.button>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());

  const toggleCompare = useCallback((id: string) => {
    setCompareIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      else toast.info(t('toast.maxCompare'));
      return next;
    });
  }, [t]);

  const loadExecutions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`/api/executions?${params}`, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(tid);
      if (res.ok) { const { executions } = await res.json() as { executions: Execution[] }; setExecutions(executions); setError(null); }
      else throw new Error(`API returned ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError' ? t('history.timeout') : t('history.loadFailed');
      setError(msg); toast.error(msg); setExecutions([]);
    } finally { setLoading(false); }
  }, [statusFilter, t]);

  useEffect(() => { loadExecutions(); }, [loadExecutions]);

  const handleRerun = useCallback((execution: Execution) => {
    router.push(`/dashboard/canvas?id=${execution.workflowId}&rerun=${execution.id}`);
    toast.success(t('toast.openingWithInputs'));
  }, [router, t]);

  const todayCount = executions.filter(e => new Date(e.startedAt).toDateString() === new Date().toDateString()).length;

  const filters: Array<{ key: string; label: string; color: string }> = [
    { key: "ALL", label: t('history.all'), color: "#4F8AFF" },
    { key: "SUCCESS", label: t('history.success'), color: "#34D399" },
    { key: "FAILED", label: t('history.failedFilter'), color: "#F87171" },
    { key: "RUNNING", label: t('history.runningFilter'), color: "#A78BFA" },
  ];

  return (
    <div className="dp-page-bg" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <PageBackground />
      <Header title={t('history.title')} subtitle={t('history.subtitle')} />

      <main style={{ flex: 1, overflowY: "auto", padding: "28px 36px", position: "relative", zIndex: 1 }}>
        {/* Stat cards */}
        <div style={{ display: "flex", gap: 14, marginBottom: 28 }}>
          <StatCard label={t('history.totalRuns')} value={executions.length} color="#4F8AFF" delay={0.05} />
          <StatCard label={t('history.today')} value={todayCount} color="#A78BFA" delay={0.1} />
          <StatCard label={t('history.successful')} value={executions.filter(e => e.status === "SUCCESS").length} color="#34D399" delay={0.15} />
          <StatCard label={t('history.failed')} value={executions.filter(e => e.status === "FAILED").length} color="#F87171" delay={0.2} />
        </div>

        {/* Filter bar */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.35 }}
          style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}
        >
          <div className="dp-filter-group">
            {filters.map(f => (
              <button key={f.key} className="dp-filter-btn"
                data-active={statusFilter === f.key ? "true" : "false"}
                data-color={f.key === "ALL" ? "blue" : f.key === "SUCCESS" ? "green" : f.key === "FAILED" ? "red" : "purple"}
                onClick={() => setStatusFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>

          {compareIds.size === 2 && (
            <motion.button initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              onClick={() => { const [l, r] = Array.from(compareIds); router.push(`/dashboard/compare?left=${l}&right=${r}`); }}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #1B4FFF, #0EA5E9)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 20px rgba(27,79,255,0.35)" }}>
              <GitCompareArrows size={13} /> {t('history.compareSelected')}
            </motion.button>
          )}

          <button onClick={loadExecutions}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", color: "#44445A", fontSize: 12, cursor: "pointer", transition: "all 150ms" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#44445A"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
            <RefreshCw size={11} /> {t('history.refresh')}
          </button>
        </motion.div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ textAlign: "center", padding: 80 }}>
              <Activity size={28} style={{ margin: "0 auto 12px", color: "#4F8AFF", animation: "dp-pulse 1.5s ease-in-out infinite" }} />
              <div style={{ fontSize: 13, color: "#44445A" }}>{t('history.loadingHistory')}</div>
            </motion.div>
          ) : error ? (
            <motion.div key="error" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ textAlign: "center", padding: "56px 32px", background: "rgba(12,12,22,0.5)", borderRadius: 16, border: "1px solid rgba(248,113,113,0.12)" }}>
              <AlertCircle size={32} style={{ margin: "0 auto 12px", color: "#F87171" }} />
              <div style={{ fontSize: 16, fontWeight: 600, color: "#F87171", marginBottom: 6 }}>{error}</div>
              <div style={{ fontSize: 12, color: "#44445A", marginBottom: 20 }}>{t('history.checkConnection')}</div>
              <button onClick={loadExecutions} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #1B4FFF, #0EA5E9)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <RefreshCw size={13} /> {t('history.retry')}
              </button>
            </motion.div>
          ) : executions.length === 0 ? (
            <EmptyState key="empty" />
          ) : (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column" }}>
              {executions.map((ex, i) => (
                <ExecutionRow key={ex.id} execution={ex} onRerun={handleRerun}
                  onViewDetails={setSelectedExecution}
                  compareSelected={compareIds.has(ex.id)}
                  onToggleCompare={toggleCompare} index={i} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {selectedExecution && (
          <DetailModal execution={selectedExecution}
            onClose={() => setSelectedExecution(null)}
            onRerun={() => { handleRerun(selectedExecution); setSelectedExecution(null); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
