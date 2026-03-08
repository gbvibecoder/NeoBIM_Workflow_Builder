"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, ArrowDown, Minus, CheckCircle2, XCircle, Clock, FileText, Table2, Image as ImageIcon } from "lucide-react";
import { Header } from "@/components/dashboard/Header";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Artifact {
  id: string;
  nodeId: string;
  nodeLabel: string | null;
  type: string;
  title: string | null;
  data: Record<string, unknown>;
}

interface Execution {
  id: string;
  workflowId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  workflow: { id: string; name: string };
  artifacts: Artifact[];
}

interface KpiMetric {
  label: string;
  value: string | number;
  unit?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNumeric(val: string | number): number | null {
  if (typeof val === "number") return val;
  const cleaned = String(val).replace(/[,$%]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function getDiffIndicator(leftVal: string | number, rightVal: string | number) {
  const l = parseNumeric(leftVal);
  const r = parseNumeric(rightVal);
  if (l === null || r === null || l === r) return null;
  const pctDiff = Math.abs((r - l) / l) * 100;
  if (pctDiff < 10) return null; // Only show for >10% difference
  return r > l ? "up" : "down";
}

function DiffArrow({ direction }: { direction: "up" | "down" | null }) {
  if (!direction) return <Minus size={10} style={{ color: "#3A3A50" }} />;
  if (direction === "up") return <ArrowUp size={10} style={{ color: "#F59E0B" }} />;
  return <ArrowDown size={10} style={{ color: "#F59E0B" }} />;
}

function duration(start: string, end: string | null) {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ─── Side Panel ──────────────────────────────────────────────────────────────

function ExecutionSide({ execution, otherExecution }: { execution: Execution; otherExecution?: Execution }) {
  const statusColor: Record<string, string> = {
    SUCCESS: "#10B981", FAILED: "#EF4444", PARTIAL: "#F59E0B", RUNNING: "#4F8AFF",
  };
  const color = statusColor[execution.status] ?? "#5C5C78";

  // Extract KPI metrics from all artifacts
  const kpiArtifacts = execution.artifacts.filter(a =>
    a.type === "kpi" || a.type === "3d"
  );
  const textArtifacts = execution.artifacts.filter(a => a.type === "text");
  const imageArtifacts = execution.artifacts.filter(a => a.type === "image");
  const tableArtifacts = execution.artifacts.filter(a => a.type === "table");
  const fileArtifacts = execution.artifacts.filter(a => a.type === "file");

  // Get metrics from other execution for comparison
  const otherKpis = otherExecution?.artifacts.filter(a =>
    a.type === "kpi" || a.type === "3d"
  ) ?? [];

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        background: "#12121E", borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F5", marginBottom: 4 }}>
          {execution.workflow.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10, color: "#5C5C78" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "2px 6px", borderRadius: 10,
            background: `${color}15`, border: `1px solid ${color}30`,
            fontSize: 10, fontWeight: 600, color,
          }}>
            {execution.status === "SUCCESS" ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
            {execution.status}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <Clock size={9} /> {duration(execution.startedAt, execution.completedAt)}
          </span>
          <span>{new Date(execution.startedAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* KPIs */}
      {kpiArtifacts.map(artifact => {
        const metrics = (artifact.data?.metrics ?? artifact.data?.kpis) as KpiMetric[] | undefined;
        if (!metrics?.length) return null;

        // Find matching metrics from other side
        const otherMetrics = otherKpis.flatMap(a =>
          ((a.data?.metrics ?? a.data?.kpis) as KpiMetric[] | undefined) ?? []
        );

        return (
          <div key={artifact.id} style={{
            background: "#12121E", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "14px 16px", marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8888A0", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Table2 size={11} /> {artifact.nodeLabel ?? "Metrics"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {metrics.map((m, i) => {
                const otherM = otherMetrics.find(om => om.label === m.label);
                const diff = otherM ? getDiffIndicator(m.value, otherM.value) : null;
                return (
                  <div key={i} style={{
                    padding: "8px 10px", borderRadius: 7,
                    background: diff ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.02)",
                    border: diff ? "1px solid rgba(245,158,11,0.15)" : "1px solid rgba(255,255,255,0.04)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F5" }}>
                        {m.value}
                      </span>
                      {m.unit && <span style={{ fontSize: 9, color: "#5C5C78" }}>{m.unit}</span>}
                      {diff && <DiffArrow direction={diff} />}
                    </div>
                    <div style={{ fontSize: 9, color: "#5C5C78", marginTop: 2, textTransform: "uppercase" as const }}>
                      {m.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Text artifacts */}
      {textArtifacts.map(artifact => {
        const content = String(artifact.data?.content ?? artifact.data?.text ?? artifact.data?.description ?? "");
        return (
          <div key={artifact.id} style={{
            background: "#12121E", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "14px 16px", marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8888A0", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <FileText size={11} /> {artifact.nodeLabel ?? "Description"}
            </div>
            <div style={{
              fontSize: 11, color: "#8888A0", lineHeight: 1.6,
              maxHeight: 150, overflow: "hidden",
              WebkitMaskImage: content.length > 300 ? "linear-gradient(180deg, #000 80%, transparent)" : undefined,
            }}>
              {content.slice(0, 500)}
            </div>
          </div>
        );
      })}

      {/* Images */}
      {imageArtifacts.map(artifact => (
        <div key={artifact.id} style={{
          background: "#12121E", borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden", marginBottom: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#8888A0", padding: "10px 16px", display: "flex", alignItems: "center", gap: 6 }}>
            <ImageIcon size={11} /> {artifact.nodeLabel ?? "Render"}
          </div>
          {typeof artifact.data?.url === "string" && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={artifact.data.url}
              alt={artifact.nodeLabel ?? "artifact"}
              style={{ width: "100%", height: 180, objectFit: "cover" }}
            />
          )}
        </div>
      ))}

      {/* Tables */}
      {tableArtifacts.map(artifact => {
        const headers = (artifact.data?.headers as string[]) ?? [];
        const rows = (artifact.data?.rows as string[][]) ?? [];
        const summary = artifact.data?.summary as { grandTotal?: number } | undefined;
        return (
          <div key={artifact.id} style={{
            background: "#12121E", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "14px 16px", marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8888A0", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Table2 size={11} /> {artifact.nodeLabel ?? "Table"}
            </div>
            <div style={{ fontSize: 10, color: "#5C5C78" }}>
              {rows.length} rows, {headers.length} columns
            </div>
            {summary?.grandTotal != null && (
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: "#10B981" }}>
                Total: ${summary.grandTotal.toLocaleString()}
              </div>
            )}
          </div>
        );
      })}

      {/* Files */}
      {fileArtifacts.map(artifact => (
        <div key={artifact.id} style={{
          background: "#12121E", borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.06)",
          padding: "14px 16px", marginBottom: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#8888A0", display: "flex", alignItems: "center", gap: 6 }}>
            <FileText size={11} /> {String(artifact.data?.name ?? artifact.data?.fileName ?? "File")}
          </div>
        </div>
      ))}

      {execution.artifacts.length === 0 && (
        <div style={{
          padding: 32, textAlign: "center", color: "#3A3A50", fontSize: 12,
          background: "#12121E", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
        }}>
          No artifacts recorded
        </div>
      )}
    </div>
  );
}

// ─── Compare Content (with searchParams) ────────────────────────────────────

function CompareContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const leftId = searchParams.get("left");
  const rightId = searchParams.get("right");

  const [leftExec, setLeftExec] = useState<Execution | null>(null);
  const [rightExec, setRightExec] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExecutions = useCallback(async () => {
    if (!leftId || !rightId) {
      setError("Two execution IDs are required");
      setLoading(false);
      return;
    }

    try {
      const [left, right] = await Promise.all([
        fetch(`/api/executions/${leftId}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/executions/${rightId}`).then(r => r.ok ? r.json() : null),
      ]);
      if (!left || !right) {
        setError("Could not load one or both executions");
      } else {
        setLeftExec((left as { execution: Execution }).execution ?? left as Execution);
        setRightExec((right as { execution: Execution }).execution ?? right as Execution);
      }
    } catch {
      setError("Failed to load executions");
    } finally {
      setLoading(false);
    }
  }, [leftId, rightId]);

  useEffect(() => { loadExecutions(); }, [loadExecutions]);

  if (loading) {
    return <div style={{ padding: 48, textAlign: "center", color: "#5C5C78" }}>Loading comparison...</div>;
  }

  if (error || !leftExec || !rightExec) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#EF4444", marginBottom: 8 }}>
          {error ?? "Unable to load executions"}
        </div>
        <button
          onClick={() => router.push("/dashboard/history")}
          style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: "#4F8AFF", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          Back to History
        </button>
      </div>
    );
  }

  return (
    <div className="compare-layout" style={{ display: "flex", gap: 16, padding: "0 24px 24px" }}>
      <ExecutionSide execution={leftExec} otherExecution={rightExec} />
      {/* Divider */}
      <div className="compare-divider" style={{
        width: 1, background: "rgba(255,255,255,0.06)",
        alignSelf: "stretch", flexShrink: 0,
      }} />
      <ExecutionSide execution={rightExec} otherExecution={leftExec} />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const router = useRouter();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Compare Executions"
        subtitle="Side-by-side comparison of two workflow runs"
      />

      <div style={{ padding: "12px 24px 0" }}>
        <button
          onClick={() => router.push("/dashboard/history")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)",
            background: "transparent", color: "#5C5C78", fontSize: 11, cursor: "pointer",
            marginBottom: 16,
          }}
        >
          <ArrowLeft size={11} /> Back to History
        </button>
      </div>

      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<div style={{ padding: 48, textAlign: "center", color: "#5C5C78" }}>Loading...</div>}>
          <CompareContent />
        </Suspense>
      </main>
    </div>
  );
}
