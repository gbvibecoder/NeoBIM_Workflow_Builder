"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FlaskConical,
  Play,
  CheckCircle2,
  XCircle,
  SkipForward,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Clock,
  Zap,
  BarChart3,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/dashboard/Header";
import type {
  TestSummaryReport,
  NodeTestResult,
} from "@/tests/run-input-node-tests";

// ─── Status helpers ─────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  PASS: { color: "#10B981", bg: "rgba(16,185,129,0.08)", icon: CheckCircle2, label: "PASS" },
  FAIL: { color: "#EF4444", bg: "rgba(239,68,68,0.08)", icon: XCircle, label: "FAIL" },
  SKIP: { color: "#F59E0B", bg: "rgba(245,158,11,0.08)", icon: SkipForward, label: "SKIP" },
  ERROR: { color: "#EF4444", bg: "rgba(239,68,68,0.08)", icon: AlertTriangle, label: "ERROR" },
} as const;

function StatusBadge({ status }: { status: keyof typeof STATUS_CONFIG }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        background: cfg.bg,
        color: cfg.color,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <Icon size={12} />
      {cfg.label}
    </span>
  );
}

// ─── Node Summary Card ──────────────────────────────────────────────────────

function NodeSummaryCard({
  result,
  index,
}: {
  result: NodeTestResult;
  index: number;
}) {
  const cfg = STATUS_CONFIG[result.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      style={{
        background: "#12121E",
        border: `1px solid ${cfg.color}20`,
        borderRadius: 12,
        padding: 16,
        minWidth: 160,
        flex: "1 1 160px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span
          style={{
            padding: "2px 7px",
            borderRadius: 5,
            background: "rgba(79,138,255,0.1)",
            color: "#4F8AFF",
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {result.nodeId}
        </span>
        <StatusBadge status={result.status} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", marginBottom: 6 }}>
        {result.nodeName}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "#5C5C78" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <Clock size={10} />
          {result.executionTimeMs}ms
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <Zap size={10} />
          {result.artifactsGenerated} artifact{result.artifactsGenerated !== 1 ? "s" : ""}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Expandable Result Row ──────────────────────────────────────────────────

function ResultRow({ result }: { result: NodeTestResult }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[result.status];

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    toast.success("Test data copied to clipboard");
  }, [result]);

  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      {/* Row header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "80px 1fr 140px 80px 80px 80px 40px",
          alignItems: "center",
          padding: "10px 16px",
          background: expanded ? "rgba(255,255,255,0.02)" : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => {
          if (!expanded)
            e.currentTarget.style.background = "rgba(255,255,255,0.02)";
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = "transparent";
        }}
      >
        <span
          style={{
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(79,138,255,0.08)",
            color: "#4F8AFF",
            fontSize: 10,
            fontWeight: 700,
            justifySelf: "start",
          }}
        >
          {result.nodeId}
        </span>
        <span style={{ fontSize: 12, color: "#F0F0F5", fontWeight: 500 }}>
          {result.nodeName}
          <span style={{ color: "#5C5C78", fontWeight: 400, marginLeft: 8 }}>
            {result.testCase.length > 40
              ? result.testCase.substring(0, 40) + "..."
              : result.testCase}
          </span>
        </span>
        <StatusBadge status={result.status} />
        <span style={{ fontSize: 11, color: "#5C5C78" }}>
          {result.executionTimeMs}ms
        </span>
        <span style={{ fontSize: 11, color: "#5C5C78" }}>
          {result.artifactsGenerated}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          style={{
            background: "none",
            border: "none",
            color: "#3A3A50",
            cursor: "pointer",
            padding: 4,
          }}
          title="Copy test data"
        >
          <Copy size={12} />
        </button>
        <span style={{ color: "#3A3A50", display: "flex" }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                padding: "12px 16px 16px",
                background: "rgba(0,0,0,0.2)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* Validation checks */}
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9898B0",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Validation Checks
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {result.validationChecks.map((vc, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                      }}
                    >
                      {vc.passed ? (
                        <CheckCircle2 size={12} style={{ color: "#10B981", flexShrink: 0 }} />
                      ) : (
                        <XCircle size={12} style={{ color: "#EF4444", flexShrink: 0 }} />
                      )}
                      <span style={{ color: vc.passed ? "#9898B0" : "#EF4444" }}>
                        {vc.checkName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Warnings */}
              {result.warningMessages.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#F59E0B",
                      marginBottom: 4,
                    }}
                  >
                    Warnings
                  </div>
                  {result.warningMessages.map((w, i) => (
                    <div
                      key={i}
                      style={{ fontSize: 11, color: "#F59E0B", opacity: 0.8 }}
                    >
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Error */}
              {result.errorMessage && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "rgba(239,68,68,0.06)",
                    border: "1px solid rgba(239,68,68,0.15)",
                    fontSize: 11,
                    color: "#EF4444",
                  }}
                >
                  {result.errorMessage}
                </div>
              )}

              {/* Input / Output JSON */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#5C5C78",
                      marginBottom: 4,
                      textTransform: "uppercase",
                    }}
                  >
                    Input
                  </div>
                  <pre
                    style={{
                      fontSize: 10,
                      color: "#9898B0",
                      background: "rgba(0,0,0,0.3)",
                      padding: 8,
                      borderRadius: 6,
                      overflow: "auto",
                      maxHeight: 150,
                      margin: 0,
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    {JSON.stringify(result.inputProvided, null, 2)}
                  </pre>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#5C5C78",
                      marginBottom: 4,
                      textTransform: "uppercase",
                    }}
                  >
                    Output
                  </div>
                  <pre
                    style={{
                      fontSize: 10,
                      color: "#9898B0",
                      background: "rgba(0,0,0,0.3)",
                      padding: 8,
                      borderRadius: 6,
                      overflow: "auto",
                      maxHeight: 150,
                      margin: 0,
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    {JSON.stringify(result.outputReceived, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Pass/Fail Chart (simple SVG — no recharts dependency) ──────────────────

function PassFailChart({
  passed,
  failed,
  skipped,
}: {
  passed: number;
  failed: number;
  skipped: number;
}) {
  const total = passed + failed + skipped;
  if (total === 0) return null;

  const passAngle = (passed / total) * 360;
  const failAngle = (failed / total) * 360;
  // skipped fills the rest

  function polarToCartesian(angle: number) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: 50 + 40 * Math.cos(rad), y: 50 + 40 * Math.sin(rad) };
  }

  function arcPath(startAngle: number, endAngle: number) {
    const start = polarToCartesian(startAngle);
    const end = polarToCartesian(endAngle);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M 50 50 L ${start.x} ${start.y} A 40 40 0 ${large} 1 ${end.x} ${end.y} Z`;
  }

  const segments: Array<{ start: number; end: number; color: string }> = [];
  let cursor = 0;
  if (passed > 0) {
    segments.push({ start: cursor, end: cursor + passAngle, color: "#10B981" });
    cursor += passAngle;
  }
  if (failed > 0) {
    segments.push({ start: cursor, end: cursor + failAngle, color: "#EF4444" });
    cursor += failAngle;
  }
  if (skipped > 0) {
    segments.push({ start: cursor, end: cursor + (360 - passAngle - failAngle), color: "#F59E0B" });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={80} height={80} viewBox="0 0 100 100">
        {segments.map((seg, i) => {
          const span = seg.end - seg.start;
          if (span <= 0) return null;
          if (span >= 360) {
            return <circle key={i} cx={50} cy={50} r={40} fill={seg.color} />;
          }
          return <path key={i} d={arcPath(seg.start, seg.end)} fill={seg.color} />;
        })}
        <circle cx={50} cy={50} r={22} fill="#12121E" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#10B981" }} />
          <span style={{ color: "#9898B0" }}>Pass ({passed})</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#EF4444" }} />
          <span style={{ color: "#9898B0" }}>Fail ({failed})</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#F59E0B" }} />
          <span style={{ color: "#9898B0" }}>Skip ({skipped})</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function TestResultsPage() {
  const [report, setReport] = useState<TestSummaryReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runTests = useCallback(async () => {
    setIsRunning(true);
    toast.info("Running input node test suite...");
    try {
      const { runAllInputNodeTests } = await import("@/tests/run-input-node-tests");
      const result = await runAllInputNodeTests();
      setReport(result);
      if (result.failed === 0 && result.errors === 0) {
        toast.success(`All tests passed! (${result.passed} pass, ${result.skipped} skip)`);
      } else {
        toast.error(`${result.failed + result.errors} test(s) failed`);
      }
    } catch (err) {
      toast.error("Test runner crashed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setIsRunning(false);
    }
  }, []);

  const overallStatus: "ALL_PASS" | "PARTIAL" | "FAILED" = !report
    ? "PARTIAL"
    : report.failed === 0 && report.errors === 0
      ? "ALL_PASS"
      : report.passed > 0
        ? "PARTIAL"
        : "FAILED";

  const overallColors = {
    ALL_PASS: { bg: "rgba(16,185,129,0.08)", color: "#10B981", label: "ALL PASS" },
    PARTIAL: { bg: "rgba(245,158,11,0.08)", color: "#F59E0B", label: "PARTIAL" },
    FAILED: { bg: "rgba(239,68,68,0.08)", color: "#EF4444", label: "FAILED" },
  };

  // Deduplicate: one card per unique nodeId
  const uniqueNodeResults: NodeTestResult[] = [];
  if (report) {
    const seen = new Set<string>();
    for (const r of report.results) {
      if (!seen.has(r.nodeId)) {
        seen.add(r.nodeId);
        uniqueNodeResults.push(r);
      }
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Input Node Test Suite" subtitle="NeoBIM AEC Workflow — Node Validation Report" />

      <main className="flex-1 overflow-y-auto p-6" style={{ maxWidth: 1200 }}>
        {/* ── Header Controls ──────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "rgba(79,138,255,0.08)",
                border: "1px solid rgba(79,138,255,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FlaskConical size={18} style={{ color: "#4F8AFF" }} />
            </div>
            {report && (
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: overallColors[overallStatus].bg,
                  color: overallColors[overallStatus].color,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {overallColors[overallStatus].label}
              </span>
            )}
            {report && (
              <span style={{ fontSize: 11, color: "#5C5C78" }}>
                Last run: {new Date(report.timestamp).toLocaleString()}
              </span>
            )}
          </div>

          <button
            onClick={runTests}
            disabled={isRunning}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "10px 20px",
              borderRadius: 10,
              background: isRunning ? "#2A2A3E" : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              border: "none",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: isRunning ? "not-allowed" : "pointer",
              boxShadow: isRunning ? "none" : "0 4px 16px rgba(79,138,255,0.25)",
              transition: "all 0.15s ease",
            }}
          >
            {isRunning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Running Tests...
              </>
            ) : (
              <>
                <Play size={14} fill="white" />
                Run All Tests
              </>
            )}
          </button>
        </div>

        {/* ── No results state ─────────────────────────────────────────── */}
        {!report && !isRunning && (
          <div
            style={{
              textAlign: "center",
              padding: "60px 0",
              color: "#5C5C78",
              fontSize: 14,
            }}
          >
            <FlaskConical
              size={40}
              style={{ color: "#3A3A50", marginBottom: 12, display: "inline-block" }}
            />
            <div style={{ fontWeight: 500, color: "#9898B0", marginBottom: 4 }}>
              No test results yet
            </div>
            <div style={{ fontSize: 12 }}>
              Click &quot;Run All Tests&quot; to validate all 7 input nodes
            </div>
          </div>
        )}

        {/* ── Results ──────────────────────────────────────────────────── */}
        {report && (
          <>
            {/* Summary Cards */}
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 24,
              }}
            >
              {uniqueNodeResults.map((r, i) => (
                <NodeSummaryCard key={r.nodeId} result={r} index={i} />
              ))}
            </div>

            {/* Chart + Stats Row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: 24,
                marginBottom: 24,
                padding: 20,
                background: "#12121E",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
              }}
            >
              <PassFailChart
                passed={report.passed}
                failed={report.failed}
                skipped={report.skipped}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 16,
                  alignContent: "center",
                }}
              >
                {[
                  { label: "Total Tests", value: report.totalTests, color: "#F0F0F5" },
                  { label: "Pass Rate", value: `${report.passRate}%`, color: "#10B981" },
                  { label: "Total Time", value: `${report.totalExecutionTimeMs}ms`, color: "#4F8AFF" },
                  { label: "Slowest", value: `${report.slowestNode.name} (${report.slowestNode.timeMs}ms)`, color: "#F59E0B" },
                  { label: "Fastest", value: `${report.fastestNode.name} (${report.fastestNode.timeMs}ms)`, color: "#10B981" },
                ].map((stat) => (
                  <div key={stat.label}>
                    <div style={{ fontSize: 10, color: "#5C5C78", textTransform: "uppercase", marginBottom: 2 }}>
                      {stat.label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: stat.color }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Results Table */}
            <div
              style={{
                background: "#12121E",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 24,
              }}
            >
              {/* Table header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr 140px 80px 80px 80px 40px",
                  padding: "10px 16px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#5C5C78",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                <span>Node</span>
                <span>Test Case</span>
                <span>Status</span>
                <span>Time</span>
                <span>Artifacts</span>
                <span>Copy</span>
                <span></span>
              </div>

              {/* Rows */}
              {report.results.map((r, i) => (
                <ResultRow key={`${r.nodeId}-${r.testCase}-${i}`} result={r} />
              ))}
            </div>

            {/* Recommendations for failed nodes */}
            {report.failed > 0 && (
              <div
                style={{
                  padding: 16,
                  background: "rgba(239,68,68,0.04)",
                  border: "1px solid rgba(239,68,68,0.15)",
                  borderRadius: 12,
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <AlertTriangle size={14} style={{ color: "#EF4444" }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#EF4444" }}>
                    Recommendations
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#9898B0", lineHeight: 1.6 }}>
                  {report.results
                    .filter((r) => r.status === "FAIL" || r.status === "ERROR")
                    .map((r) => (
                      <div key={`rec-${r.nodeId}-${r.testCase}`} style={{ marginBottom: 4 }}>
                        <strong style={{ color: "#F0F0F5" }}>{r.nodeName}</strong>:{" "}
                        {r.errorMessage ?? "Check validation failures above"}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Footer Summary */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 24,
                padding: "16px 0",
                fontSize: 11,
                color: "#5C5C78",
                flexWrap: "wrap",
              }}
            >
              <span>
                <BarChart3 size={12} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
                {report.totalTests} tests
              </span>
              <span style={{ color: "#10B981" }}>{report.passed} passed</span>
              <span style={{ color: "#EF4444" }}>{report.failed} failed</span>
              <span style={{ color: "#F59E0B" }}>{report.skipped} skipped</span>
              <span>{report.totalExecutionTimeMs}ms total</span>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
