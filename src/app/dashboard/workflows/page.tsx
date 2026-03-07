"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Workflow, ArrowRight, Trash2, ExternalLink, Clock } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { api, type WorkflowSummary } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { toast } from "sonner";

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="My Workflows"
        subtitle="Your personal workflow workspace"
      />

      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <div style={{ fontSize: 13, color: "#5C5C78" }}>Loading workflows…</div>
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-16 w-16 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#12121E] flex items-center justify-center mb-5">
              <Workflow size={28} className="text-[#3A3A50]" strokeWidth={1} />
            </div>
            <h3 className="text-base font-semibold text-[#F0F0F5] mb-2">No workflows yet</h3>
            <p className="text-sm text-[#5C5C78] max-w-sm leading-relaxed mb-6">
              Create your first workflow by building one from scratch or cloning a prebuilt template.
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/workflows/new"
                className="flex items-center gap-2 rounded-lg bg-[#4F8AFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3D7AFF] transition-all"
              >
                <Plus size={14} />
                New Workflow
              </Link>
              <Link
                href="/dashboard/templates"
                className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#12121E] px-4 py-2.5 text-sm font-medium text-[#F0F0F5] hover:border-[#3A3A50] hover:bg-[#1A1A2A] transition-all"
              >
                Browse Templates
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        ) : (
          <div>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <span style={{ fontSize: 13, color: "#5C5C78" }}>
                {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
              </span>
              <Link
                href="/dashboard/workflows/new"
                className="flex items-center gap-2 rounded-lg bg-[#4F8AFF] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3D7AFF] transition-all"
              >
                <Plus size={12} />
                New
              </Link>
            </div>

            {/* Grid */}
            <div className="workflows-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {workflows.map(wf => (
                <div
                  key={wf.id}
                  style={{
                    background: "#12121E", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 12, padding: 16, cursor: "pointer",
                    transition: "border-color 0.15s",
                    display: "flex", flexDirection: "column", gap: 10,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
                  onClick={() => router.push(`/dashboard/canvas?id=${wf.id}`)}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                        background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 100%)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Workflow size={14} color="#fff" />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#E0E0EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {wf.name}
                        </div>
                        {wf.description && (
                          <div style={{ fontSize: 11, color: "#5C5C78", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {wf.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={e => { e.stopPropagation(); router.push(`/dashboard/canvas?id=${wf.id}`); }}
                        style={{
                          width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)",
                          background: "transparent", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#5C5C78", transition: "color 0.1s, border-color 0.1s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#4F8AFF"; e.currentTarget.style.borderColor = "rgba(79,138,255,0.3)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#5C5C78"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
                        title="Open in canvas"
                      >
                        <ExternalLink size={11} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(wf.id, wf.name); }}
                        style={{
                          width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)",
                          background: "transparent", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#5C5C78", transition: "color 0.1s, border-color 0.1s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#EF4444"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#5C5C78"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#3A3A50" }}>
                      <Clock size={9} />
                      {formatRelativeTime(new Date(wf.updatedAt))}
                    </div>
                    <span style={{ color: "rgba(255,255,255,0.06)" }}>·</span>
                    <div style={{ fontSize: 10, color: "#3A3A50" }}>
                      {wf._count.executions} run{wf._count.executions !== 1 ? "s" : ""}
                    </div>
                    {wf.isPublished && (
                      <>
                        <span style={{ color: "rgba(255,255,255,0.06)" }}>·</span>
                        <div style={{ fontSize: 9, color: "#10B981", fontWeight: 600 }}>Published</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
