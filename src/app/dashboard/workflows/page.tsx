"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Workflow, ArrowRight, Trash2, ExternalLink, Clock, Sparkles, Box, Image as ImageIcon, Search, FileText, Layers, Zap, FolderOpen } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { api, type WorkflowSummary } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { toast } from "sonner";

// ─── Workflow type detection for color coding ────────────────────────────────
function getWorkflowType(name: string): { color: string; gradient: string; icon: React.ReactNode; label: string } {
  const n = name.toLowerCase();
  if (n.includes("pdf") || n.includes("report") || n.includes("document")) {
    return { color: "#F59E0B", gradient: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", icon: <FileText size={14} color="#fff" />, label: "PDF" };
  }
  if (n.includes("floor plan") || n.includes("2d") || n.includes("floorplan")) {
    return { color: "#10B981", gradient: "linear-gradient(135deg, #10B981 0%, #059669 100%)", icon: <Layers size={14} color="#fff" />, label: "Floor Plan" };
  }
  if (n.includes("render") || n.includes("concept") || n.includes("image")) {
    return { color: "#8B5CF6", gradient: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)", icon: <ImageIcon size={14} color="#fff" />, label: "Render" };
  }
  if (n.includes("full pipeline") || n.includes("complete")) {
    return { color: "#EC4899", gradient: "linear-gradient(135deg, #EC4899 0%, #DB2777 100%)", icon: <Sparkles size={14} color="#fff" />, label: "Pipeline" };
  }
  if (n.includes("3d") || n.includes("massing") || n.includes("model")) {
    return { color: "#06B6D4", gradient: "linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)", icon: <Box size={14} color="#fff" />, label: "3D" };
  }
  // Default — Text Prompt / generic
  return { color: "#00F5FF", gradient: "linear-gradient(135deg, #00F5FF 0%, #0EA5E9 100%)", icon: <Zap size={14} color="#fff" />, label: "Workflow" };
}

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const { workflows } = await api.workflows.list();
      setWorkflows(workflows);
    } catch {
      // User not authenticated or server error — silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.workflows.delete(id);
      setWorkflows(prev => prev.filter(w => w.id !== id));
      toast.success("Workflow deleted");
    } catch {
      toast.error("Failed to delete workflow");
    }
  }

  const filteredWorkflows = workflows.filter(wf =>
    wf.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ position: "relative" }}>
      {/* Ambient background glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
        background: `
          radial-gradient(ellipse 60% 40% at 20% 10%, rgba(0,245,255,0.04) 0%, transparent 70%),
          radial-gradient(ellipse 50% 50% at 80% 80%, rgba(139,92,246,0.03) 0%, transparent 70%),
          radial-gradient(ellipse 40% 30% at 50% 50%, rgba(79,138,255,0.02) 0%, transparent 60%)
        `,
      }} />
      {/* Subtle grid pattern */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, opacity: 0.4,
        backgroundImage: `
          linear-gradient(rgba(0,245,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,245,255,0.02) 1px, transparent 1px)
        `,
        backgroundSize: "80px 80px",
      }} />

      <Header
        title="My Workflows"
        subtitle="Your personal workflow workspace"
      />

      <main className="flex-1 overflow-y-auto p-6" style={{ position: "relative", zIndex: 1 }}>
        {loading ? (
          /* ── Loading State ────────────────────────────────────────────── */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 16 }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              style={{
                width: 40, height: 40, borderRadius: 12,
                border: "2px solid rgba(0,245,255,0.15)",
                borderTopColor: "#00F5FF",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            />
            <div style={{ fontSize: 13, color: "#5C5C78", fontWeight: 500 }}>Loading workflows…</div>
          </div>
        ) : workflows.length === 0 ? (
          /* ── Empty State ──────────────────────────────────────────────── */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div style={{
              width: 80, height: 80, borderRadius: 24,
              background: "linear-gradient(135deg, rgba(0,245,255,0.08), rgba(139,92,246,0.06))",
              border: "1px solid rgba(0,245,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 24,
              boxShadow: "0 0 40px rgba(0,245,255,0.06)",
            }}>
              <FolderOpen size={32} style={{ color: "rgba(0,245,255,0.5)" }} strokeWidth={1.2} />
            </div>
            <h3 style={{
              fontSize: 20, fontWeight: 700, color: "#F0F0F5",
              marginBottom: 8, letterSpacing: "-0.02em",
            }}>
              Try Your First Workflow
            </h3>
            <p style={{
              fontSize: 13, color: "#5C5C78", maxWidth: 420,
              lineHeight: 1.6, marginBottom: 28,
            }}>
              Start with a template below, or build your own from scratch. Each workflow runs in under 2 minutes.
            </p>
            <div className="flex items-center gap-3 mb-8">
              <Link
                href="/dashboard/workflows/new"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 22px", borderRadius: 10,
                  background: "linear-gradient(135deg, #00F5FF 0%, #0EA5E9 100%)",
                  color: "#0a0c10", fontSize: 14, fontWeight: 700,
                  textDecoration: "none",
                  boxShadow: "0 0 20px rgba(0,245,255,0.2), 0 4px 12px rgba(0,245,255,0.15)",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 30px rgba(0,245,255,0.35), 0 6px 20px rgba(0,245,255,0.2)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 20px rgba(0,245,255,0.2), 0 4px 12px rgba(0,245,255,0.15)"; e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <Plus size={15} strokeWidth={2.5} />
                New Workflow
              </Link>
              <Link
                href="/dashboard/templates"
                className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-4 py-2.5 text-sm font-medium text-[#F0F0F5] hover:border-[rgba(0,245,255,0.2)] hover:bg-[rgba(0,245,255,0.04)] transition-all"
                style={{ textDecoration: "none", backdropFilter: "blur(8px)" }}
              >
                Browse Templates
                <ArrowRight size={13} />
              </Link>
            </div>

            {/* Quick-start template suggestions */}
            <div style={{ width: "100%", maxWidth: 640 }}>
              <p style={{ fontSize: 11, color: "#5C5C78", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 12 }}>
                Popular starting points
              </p>
              <div className="workflows-page-templates" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "Brief → 3D Concept", desc: "Analyze a brief and generate 3D massing", icon: <Box size={16} className="text-[#8B5CF6]" />, color: "#8B5CF6", rgb: "139,92,246" },
                  { label: "Brief → Render", desc: "Go from project brief to AI concept render", icon: <ImageIcon size={16} className="text-[#10B981]" />, color: "#10B981", rgb: "16,185,129" },
                  { label: "Brief → Full Pipeline", desc: "Brief analysis, massing, render, and BOQ", icon: <Sparkles size={16} className="text-[#F59E0B]" />, color: "#F59E0B", rgb: "245,158,11" },
                ].map((tpl, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                  >
                    <Link
                      href="/dashboard/templates"
                      style={{
                        display: "block",
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 12,
                        padding: "16px 14px",
                        textAlign: "left",
                        textDecoration: "none",
                        transition: "all 0.2s ease",
                        backdropFilter: "blur(4px)",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = `rgba(${tpl.rgb},0.3)`; e.currentTarget.style.background = `rgba(${tpl.rgb},0.04)`; e.currentTarget.style.boxShadow = `0 0 20px rgba(${tpl.rgb},0.06)`; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.boxShadow = "none"; }}
                    >
                      <div style={{ marginBottom: 10 }}>{tpl.icon}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#E0E0EA", marginBottom: 4 }}>{tpl.label}</div>
                      <div style={{ fontSize: 10, color: "#5C5C78", lineHeight: 1.4 }}>{tpl.desc}</div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          /* ── Workflow List ────────────────────────────────────────────── */
          <div>
            {/* Header row: search + count + new button */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 24 }}
            >
              <div style={{ position: "relative", width: 300 }}>
                <Search size={14} style={{
                  position: "absolute", left: 12, top: "50%",
                  transform: "translateY(-50%)", color: "#55556A",
                  pointerEvents: "none",
                }} />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search workflows…"
                  aria-label="Search workflows"
                  style={{
                    width: "100%", paddingLeft: 36, paddingRight: 14,
                    height: 38, borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.03)", color: "#F0F0F5",
                    fontSize: 13, outline: "none",
                    boxSizing: "border-box",
                    backdropFilter: "blur(8px)",
                    transition: "all 0.2s ease",
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = "rgba(0,245,255,0.3)"; e.currentTarget.style.boxShadow = "0 0 12px rgba(0,245,255,0.06)"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{
                  fontSize: 12, color: "#5C5C78", whiteSpace: "nowrap",
                  padding: "4px 10px", borderRadius: 6,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}>
                  {filteredWorkflows.length} workflow{filteredWorkflows.length !== 1 ? "s" : ""}
                </span>
                <Link
                  href="/dashboard/workflows/new"
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 16px", borderRadius: 10,
                    background: "linear-gradient(135deg, #00F5FF 0%, #0EA5E9 100%)",
                    color: "#0a0c10", fontSize: 12, fontWeight: 700,
                    textDecoration: "none",
                    boxShadow: "0 0 16px rgba(0,245,255,0.15)",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 24px rgba(0,245,255,0.3)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 16px rgba(0,245,255,0.15)"; e.currentTarget.style.transform = "translateY(0)"; }}
                >
                  <Plus size={13} strokeWidth={2.5} />
                  New Workflow
                </Link>
              </div>
            </motion.div>

            {/* Grid */}
            <AnimatePresence mode="wait">
            {filteredWorkflows.length === 0 ? (
              <motion.div
                key="no-results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ padding: "80px 0", textAlign: "center" }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 16, margin: "0 auto 16px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Search size={22} style={{ color: "#3A3A50" }} />
                </div>
                <p style={{ fontSize: 14, color: "#5C5C78", marginBottom: 8 }}>
                  No workflows matching &ldquo;{searchQuery}&rdquo;
                </p>
                <button
                  onClick={() => setSearchQuery("")}
                  style={{
                    fontSize: 12, color: "#00F5FF", background: "none",
                    border: "none", cursor: "pointer", fontWeight: 600,
                  }}
                >
                  Clear search
                </button>
              </motion.div>
            ) : (
            <motion.div
              key="grid"
              className="workflows-grid"
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}
            >
              {filteredWorkflows.map((wf, idx) => {
                const wfType = getWorkflowType(wf.name);
                return (
                <motion.div
                  key={wf.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.03, 0.6), duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 14, padding: "18px 18px 14px", cursor: "pointer",
                    transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                    display: "flex", flexDirection: "column", gap: 14,
                    position: "relative", overflow: "hidden",
                    backdropFilter: "blur(4px)",
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.borderColor = `${wfType.color}30`;
                    el.style.background = "rgba(255,255,255,0.04)";
                    el.style.transform = "translateY(-2px)";
                    el.style.boxShadow = `0 8px 32px rgba(0,0,0,0.3), 0 0 20px ${wfType.color}08`;
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.borderColor = "rgba(255,255,255,0.06)";
                    el.style.background = "rgba(255,255,255,0.02)";
                    el.style.transform = "translateY(0)";
                    el.style.boxShadow = "none";
                  }}
                  onClick={() => router.push(`/dashboard/canvas?id=${wf.id}`)}
                >
                  {/* Top color accent line */}
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 2,
                    background: wfType.gradient, opacity: 0.6,
                  }} />

                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: wfType.gradient,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: `0 2px 8px ${wfType.color}25`,
                      }}>
                        {wfType.icon}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 14, fontWeight: 650, color: "#F0F0F5",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          letterSpacing: "-0.01em",
                        }}>
                          {wf.name}
                        </div>
                        {wf.description && (
                          <div style={{
                            fontSize: 11, color: "#5C5C78", marginTop: 2,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            lineHeight: 1.4,
                          }}>
                            {wf.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 4, flexShrink: 0, marginTop: 2 }}>
                      <button
                        onClick={e => { e.stopPropagation(); router.push(`/dashboard/canvas?id=${wf.id}`); }}
                        style={{
                          width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(255,255,255,0.06)",
                          background: "rgba(255,255,255,0.02)", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#5C5C78", transition: "all 0.15s ease",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#00F5FF"; e.currentTarget.style.borderColor = "rgba(0,245,255,0.3)"; e.currentTarget.style.background = "rgba(0,245,255,0.06)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#5C5C78"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                        title="Open in canvas"
                      >
                        <ExternalLink size={12} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(wf.id, wf.name); }}
                        style={{
                          width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(255,255,255,0.06)",
                          background: "rgba(255,255,255,0.02)", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#5C5C78", transition: "all 0.15s ease",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#EF4444"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.background = "rgba(239,68,68,0.06)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#5C5C78"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Footer: metadata row */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 600, color: wfType.color,
                      padding: "2px 7px", borderRadius: 4,
                      background: `${wfType.color}10`,
                      border: `1px solid ${wfType.color}18`,
                      letterSpacing: "0.04em", textTransform: "uppercase",
                    }}>
                      {wfType.label}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#4A4A60" }}>
                      <Clock size={9} />
                      {formatRelativeTime(new Date(wf.updatedAt))}
                    </div>
                    <span style={{ color: "rgba(255,255,255,0.06)", fontSize: 10 }}>·</span>
                    <div style={{ fontSize: 10, color: "#4A4A60" }}>
                      {wf._count.executions} run{wf._count.executions !== 1 ? "s" : ""}
                    </div>
                    {wf.isPublished && (
                      <>
                        <span style={{ color: "rgba(255,255,255,0.06)", fontSize: 10 }}>·</span>
                        <span style={{
                          fontSize: 9, fontWeight: 600, color: "#10B981",
                          padding: "2px 6px", borderRadius: 4,
                          background: "rgba(16,185,129,0.08)",
                          border: "1px solid rgba(16,185,129,0.15)",
                        }}>
                          Published
                        </span>
                      </>
                    )}
                  </div>
                </motion.div>
                );
              })}
            </motion.div>
            )}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
