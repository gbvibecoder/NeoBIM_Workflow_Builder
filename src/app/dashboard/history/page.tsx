"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, CheckCircle2, XCircle, Loader2, RefreshCw,
  ChevronDown, ChevronUp, FileText, Image, Table2,
  Zap, Filter, ExternalLink, AlertCircle, GitCompareArrows, Share2,
} from "lucide-react";
import { shareHistoryToTwitter } from "@/lib/share";
import { Header } from "@/components/dashboard/Header";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Artifact {
  id: string;
  nodeId: string;
  nodeLabel: string | null;
  type: string;
  title: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

interface Execution {
  id: string;
  workflowId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  tileResults: Record<string, unknown>;
  errorMessage: string | null;
  workflow: { id: string; name: string };
  artifacts: Artifact[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(date).toLocaleDateString();
}

function duration(start: string, end: string | null) {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function ArtifactIcon({ type }: { type: string }) {
  const style = { opacity: 0.7 };
  // eslint-disable-next-line jsx-a11y/alt-text
  if (type === "image") return <Image size={11} style={style} />;
  if (type === "table" || type === "kpi") return <Table2 size={11} style={style} />;
  return <FileText size={11} style={style} />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    SUCCESS: { icon: <CheckCircle2 size={12} />, color: "#10B981", label: "Completed" },
    PARTIAL: { icon: <CheckCircle2 size={12} />, color: "#F59E0B", label: "Partial" },
    FAILED:  { icon: <XCircle size={12} />,      color: "#EF4444", label: "Failed"    },
    RUNNING: { icon: <Loader2 size={12} className="animate-spin" />, color: "#4F8AFF", label: "Running" },
    PENDING: { icon: <Clock size={12} />,         color: "#55556A", label: "Pending"   },
  };
  const s = map[status] ?? map.PENDING;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 7px", borderRadius: 20,
      background: `${s.color}15`, border: `1px solid ${s.color}30`,
      fontSize: 10, fontWeight: 600, color: s.color,
    }}>
      {s.icon} {s.label}
    </span>
  );
}

// ─── Artifact Preview ────────────────────────────────────────────────────────

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const d = artifact.data;
  let preview = "";

  if (artifact.type === "text") {
    const text = (d.text ?? d.description ?? d.content ?? "") as string;
    preview = String(text).slice(0, 60) + (String(text).length > 60 ? "…" : "");
  } else if (artifact.type === "kpi") {
    const kpis = d.kpis as Array<{ label: string; value: string | number }> | undefined;
    if (kpis?.[0]) preview = `${kpis[0].label}: ${kpis[0].value}`;
  } else if (artifact.type === "image") {
    preview = "Concept render";
  } else if (artifact.type === "table") {
    preview = `Table: ${artifact.title ?? "data"}`;
  } else if (artifact.type === "file") {
    preview = d.fileName as string ?? "File";
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "3px 8px", borderRadius: 6,
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)",
      fontSize: 10, color: "#8888A0", maxWidth: 180, overflow: "hidden",
    }}>
      <ArtifactIcon type={artifact.type} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {preview || artifact.title || artifact.type}
      </span>
    </div>
  );
}

// ─── Execution Detail Modal ──────────────────────────────────────────────────

interface DetailModalProps {
  execution: Execution;
  onClose: () => void;
  onRerun: () => void;
}

function DetailModal({ execution, onClose, onRerun }: DetailModalProps) {
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null);

  const groupedByNode = execution.artifacts.reduce<Record<string, Artifact[]>>((acc, a) => {
    const key = a.nodeLabel ?? a.nodeId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 360, damping: 30 }}
        style={{
          background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid #1E1E2E",
          borderRadius: 14, width: "100%", maxWidth: 600,
          maxHeight: "80vh", overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid #1E1E2E",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F5", letterSpacing: "-0.01em" }}>
              {execution.workflow.name}
            </div>
            <div style={{ fontSize: 11, color: "#55556A", marginTop: 2, display: "flex", gap: 12 }}>
              <span>{new Date(execution.startedAt).toLocaleString()}</span>
              {duration(execution.startedAt, execution.completedAt) && (
                <span>Duration: {duration(execution.startedAt, execution.completedAt)}</span>
              )}
              <span>{execution.artifacts.length} artifacts</span>
            </div>
          </div>
          <StatusBadge status={execution.status} />
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px" }}>
          {Object.keys(groupedByNode).length === 0 ? (
            <div style={{ textAlign: "center", color: "#55556A", fontSize: 13, padding: 32 }}>
              No artifacts recorded for this execution.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {Object.entries(groupedByNode).map(([nodeLabel, artifacts]) => (
                <div key={nodeLabel} style={{
                  background: "rgba(255,255,255,0.02)", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.05)", padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#C0C0D0", marginBottom: 8, letterSpacing: "-0.01em" }}>
                    {nodeLabel}
                  </div>
                  {artifacts.map(a => (
                    <div key={a.id}>
                      <button
                        onClick={() => setExpandedArtifact(expandedArtifact === a.id ? null : a.id)}
                        style={{
                          width: "100%", textAlign: "left", background: "none",
                          border: "none", cursor: "pointer", padding: "4px 0",
                          display: "flex", alignItems: "center", gap: 6,
                        }}
                      >
                        <ArtifactIcon type={a.type} />
                        <span style={{ fontSize: 11, color: "#8888A0" }}>
                          {a.title ?? a.type}
                        </span>
                        {expandedArtifact === a.id
                          ? <ChevronUp size={10} style={{ marginLeft: "auto", color: "#55556A" }} />
                          : <ChevronDown size={10} style={{ marginLeft: "auto", color: "#55556A" }} />
                        }
                      </button>
                      {expandedArtifact === a.id && (
                        <div style={{
                          marginTop: 6, padding: "8px 10px", borderRadius: 6,
                          background: "rgba(0,0,0,0.3)", fontSize: 11, color: "#C0C0D0",
                          lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                          maxHeight: 200, overflowY: "auto",
                        }}>
                          {a.type === "image"
                            ? // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.data.url as string} alt="artifact" style={{ maxWidth: "100%", borderRadius: 4 }} />
                            : JSON.stringify(a.data, null, 2)
                          }
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: "1px solid #1E1E2E",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} style={{
            padding: "7px 14px", borderRadius: 7, border: "1px solid #1E1E2E",
            background: "transparent", color: "#8888A0", fontSize: 12, cursor: "pointer",
          }}>
            Close
          </button>
          <button onClick={onRerun} style={{
            padding: "7px 14px", borderRadius: 7, border: "none",
            background: "#4F8AFF", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <RefreshCw size={11} /> Re-run with same inputs
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Execution Row ───────────────────────────────────────────────────────────

interface ExecutionRowProps {
  execution: Execution;
  onRerun: (execution: Execution) => void;
  onViewDetails: (execution: Execution) => void;
  compareSelected?: boolean;
  onToggleCompare?: (id: string) => void;
}

function ExecutionRow({ execution, onRerun, onViewDetails, compareSelected, onToggleCompare }: ExecutionRowProps) {
  const router = useRouter();
  const dur = duration(execution.startedAt, execution.completedAt);

  const inputSummary = (() => {
    const tr = execution.tileResults as Record<string, unknown>;
    if (tr?.inputSummary) return tr.inputSummary as string;
    // Try to find a text artifact
    const textArtifact = execution.artifacts.find(a => a.type === "text");
    if (textArtifact) {
      const text = textArtifact.data.text ?? textArtifact.data.description ?? "";
      return String(text).slice(0, 80);
    }
    return null;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid #1E1E2E", borderRadius: 10,
        padding: "14px 16px", transition: "border-color 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#2A2A3E"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; }}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        {/* Compare checkbox */}
        {onToggleCompare && (
          <button
            onClick={() => onToggleCompare(execution.id)}
            title="Select for comparison"
            style={{
              width: 20, height: 20, borderRadius: 4, flexShrink: 0, marginTop: 2,
              border: compareSelected ? "2px solid #4F8AFF" : "2px solid #2A2A3E",
              background: compareSelected ? "#4F8AFF" : "transparent",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.12s",
            }}
          >
            {compareSelected && (
              <CheckCircle2 size={12} style={{ color: "#fff" }} />
            )}
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span
              onClick={() => router.push(`/dashboard/canvas?id=${execution.workflowId}`)}
              style={{
                fontSize: 13, fontWeight: 600, color: "#F0F0F5", letterSpacing: "-0.01em",
                cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#4F8AFF"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#F0F0F5"; }}
            >
              {execution.workflow.name}
            </span>
            <StatusBadge status={execution.status} />
            {execution.artifacts.length > 0 && (
              <span style={{
                padding: "2px 6px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
                color: "#10B981",
              }}>
                {execution.artifacts.length} artifacts
              </span>
            )}
          </div>

          {/* Meta row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10, color: "#55556A" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <Clock size={9} /> {relativeTime(execution.startedAt)}
            </span>
            {dur && <span>Duration: {dur}</span>}
          </div>

          {/* Input summary */}
          {inputSummary && (
            <div style={{
              marginTop: 6, fontSize: 11, color: "#55556A",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              &ldquo;{inputSummary}&rdquo;
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => router.push(`/dashboard/canvas?id=${execution.workflowId}`)}
            title="Open workflow"
            style={{
              padding: "5px 8px", borderRadius: 6, border: "1px solid #1E1E2E",
              background: "transparent", color: "#55556A", fontSize: 10, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
              transition: "all 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2A2A3E"; (e.currentTarget as HTMLElement).style.color = "#8888A0"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "#55556A"; }}
          >
            <ExternalLink size={10} /> Open WF
          </button>
          <button
            onClick={() => onViewDetails(execution)}
            style={{
              padding: "5px 10px", borderRadius: 6, border: "1px solid #2A2A3E",
              background: "transparent", color: "#8888A0", fontSize: 10, cursor: "pointer",
              transition: "all 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            Details
          </button>
          <button
            onClick={() => onRerun(execution)}
            style={{
              padding: "5px 10px", borderRadius: 6,
              background: "rgba(79,138,255,0.1)", border: "1px solid rgba(79,138,255,0.2)",
              color: "#4F8AFF", fontSize: 10, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
              transition: "all 0.1s",
            } as React.CSSProperties}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.18)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.1)"; }}
          >
            <RefreshCw size={10} /> Rerun
          </button>
          {execution.status === "SUCCESS" && (
            <button
              onClick={() => shareHistoryToTwitter(
                execution.workflow.name,
                execution.artifacts.length,
                dur ?? "—",
              )}
              title="Share on X"
              style={{
                padding: "5px 8px", borderRadius: 6, border: "1px solid #1E1E2E",
                background: "transparent", color: "#55556A", fontSize: 10, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
                transition: "all 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2A2A3E"; (e.currentTarget as HTMLElement).style.color = "#8888A0"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "#55556A"; }}
            >
              <Share2 size={10} /> Share
            </button>
          )}
        </div>
      </div>

      {/* Artifact preview strip */}
      {execution.artifacts.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {execution.artifacts.slice(0, 5).map(a => (
            <ArtifactPreview key={a.id} artifact={a} />
          ))}
          {execution.artifacts.length > 5 && (
            <span style={{ fontSize: 10, color: "#3A3A4E", alignSelf: "center" }}>
              +{execution.artifacts.length - 5} more
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
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
      if (next.has(id)) { next.delete(id); }
      else if (next.size < 2) { next.add(id); }
      else { toast.info("Select at most 2 executions to compare"); }
      return next;
    });
  }, []);

  const loadExecutions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      
      // Add timeout to prevent infinite loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch(`/api/executions?${params}`, { 
        signal: controller.signal,
        cache: 'no-store' 
      });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const { executions } = await res.json() as { executions: Execution[] };
        setExecutions(executions);
        setError(null);
      } else {
        throw new Error(`API returned ${res.status}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error && err.name === 'AbortError' 
        ? "Request timed out. Please try again."
        : "Failed to load execution history";
      setError(errorMsg);
      toast.error(errorMsg);
      setExecutions([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadExecutions(); }, [loadExecutions]);

  const handleRerun = useCallback((execution: Execution) => {
    router.push(`/dashboard/canvas?id=${execution.workflowId}&rerun=${execution.id}`);
    toast.success("Opening workflow with previous inputs…");
  }, [router]);

  const todayCount = executions.filter(e => {
    const d = new Date(e.startedAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Execution History"
        subtitle="Every workflow run with full results. Re-run anything with one click."
      />

      <main className="flex-1 overflow-y-auto p-6">
        {/* Stats bar */}
        <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Total Runs",  value: executions.length, color: "#4F8AFF" },
            { label: "Today",       value: todayCount,         color: "#10B981" },
            { label: "Successful",  value: executions.filter(e => e.status === "SUCCESS").length, color: "#8B5CF6" },
            { label: "Failed",      value: executions.filter(e => e.status === "FAILED").length,  color: "#EF4444" },
          ].map(s => (
            <div key={s.label} style={{
              flex: 1, padding: "12px 16px", borderRadius: 10,
              background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid #1E1E2E",
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#55556A", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Filter size={12} style={{ color: "#55556A" }} />
          <span style={{ fontSize: 11, color: "#55556A" }}>Filter:</span>
          {["ALL", "SUCCESS", "FAILED", "RUNNING"].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "4px 10px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                border: statusFilter === s ? "1px solid #4F8AFF" : "1px solid #1E1E2E",
                background: statusFilter === s ? "rgba(79,138,255,0.12)" : "transparent",
                color: statusFilter === s ? "#4F8AFF" : "#55556A",
                transition: "all 0.1s",
              }}
            >
              {s}
            </button>
          ))}
          {compareIds.size === 2 && (
            <button
              onClick={() => {
                const [left, right] = Array.from(compareIds);
                router.push(`/dashboard/compare?left=${left}&right=${right}`);
              }}
              style={{
                marginLeft: "auto", display: "flex", alignItems: "center", gap: 4,
                padding: "5px 12px", borderRadius: 6, border: "none",
                background: "#4F8AFF", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              <GitCompareArrows size={12} /> Compare Selected
            </button>
          )}
          <button
            onClick={loadExecutions}
            style={{
              marginLeft: compareIds.size === 2 ? undefined : "auto",
              display: "flex", alignItems: "center", gap: 4,
              padding: "4px 10px", borderRadius: 6, border: "1px solid #1E1E2E",
              background: "transparent", color: "#55556A", fontSize: 11, cursor: "pointer",
            }}
          >
            <RefreshCw size={10} /> Refresh
          </button>
        </div>

        {/* List / Error / Loading / Empty */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 64, color: "#55556A", fontSize: 13 }}>
            <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 12px" }} />
            Loading history…
          </div>
        ) : error ? (
          <div style={{
            textAlign: "center", padding: 64,
            background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", borderRadius: 12, border: "1px solid rgba(239,68,68,0.2)",
          }}>
            <AlertCircle size={32} style={{ margin: "0 auto 12px", color: "#EF4444" }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: "#EF4444", marginBottom: 6, letterSpacing: "-0.01em" }}>
              {error}
            </div>
            <div style={{ fontSize: 12, color: "#55556A", marginBottom: 16 }}>
              Check your connection and try again
            </div>
            <button
              onClick={loadExecutions}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: "#4F8AFF", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : executions.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 64, color: "#55556A",
            background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", borderRadius: 12, border: "1px solid #1E1E2E",
          }}>
            <Zap size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: "#8888A0", marginBottom: 6, letterSpacing: "-0.01em" }}>
              No executions yet
            </div>
            <div style={{ fontSize: 12 }}>
              Run a workflow to see history here.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {executions.map(execution => (
              <ExecutionRow
                key={execution.id}
                execution={execution}
                onRerun={handleRerun}
                onViewDetails={setSelectedExecution}
                compareSelected={compareIds.has(execution.id)}
                onToggleCompare={toggleCompare}
              />
            ))}
          </div>
        )}
      </main>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedExecution && (
          <DetailModal
            execution={selectedExecution}
            onClose={() => setSelectedExecution(null)}
            onRerun={() => { handleRerun(selectedExecution); setSelectedExecution(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
