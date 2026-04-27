"use client";

/**
 * ExecutionDiagnosticsPanel — universal "Behind the Scenes" surface.
 *
 * Mounts as a floating button bottom-right of any results page. When opened,
 * slides up a 60vh dark terminal panel showing the full ExecutionTrace:
 * timeline, selected-node detail, attempts, API calls, data flows, and a
 * searchable log. Reads from useExecutionStore.currentTrace so it works
 * BOTH during a live run and post-hoc on hydrated results pages.
 */

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Search,
  Terminal,
  X,
  XCircle,
  ArrowRight,
  Clock,
  Cpu,
  Database,
  Sparkles,
  PauseCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  useExecutionStore,
  selectCurrentTrace,
} from "@/features/execution/stores/execution-store";
import type {
  ExecutionTrace,
  NodeTrace,
  NodeStatus,
  LogLevel,
} from "@/lib/execution-diagnostics";

// ─── Theme tokens (matches ModelQualityCard / canvas terminal palette) ──────

const COLORS = {
  bg: "#070809",
  panel: "rgba(255,255,255,0.03)",
  panelStrong: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.12)",
  text: "#F0F0F5",
  textDim: "#9CA3AF",
  textMuted: "#5C5C78",
  green: "#22C55E",
  yellow: "#F59E0B",
  red: "#EF4444",
  blue: "#60A5FA",
  cyan: "#00F5FF",
  purple: "#A78BFA",
} as const;

const STATUS_META: Record<NodeStatus, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
  pending:  { color: COLORS.textMuted, bg: "rgba(92,92,120,0.10)", icon: Clock,         label: "pending" },
  running:  { color: COLORS.cyan,      bg: "rgba(0,245,255,0.10)", icon: Activity,      label: "running" },
  success:  { color: COLORS.green,     bg: "rgba(34,197,94,0.10)", icon: CheckCircle2,  label: "success" },
  warning:  { color: COLORS.yellow,    bg: "rgba(245,158,11,0.10)", icon: AlertTriangle, label: "warning" },
  error:    { color: COLORS.red,       bg: "rgba(239,68,68,0.10)", icon: XCircle,       label: "error" },
  skipped:  { color: COLORS.textMuted, bg: "rgba(92,92,120,0.10)", icon: PauseCircle,   label: "skipped" },
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug:   COLORS.textMuted,
  info:    COLORS.blue,
  warn:    COLORS.yellow,
  error:   COLORS.red,
  success: COLORS.green,
};

const MONO = "var(--font-jetbrains), ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace";

// ─── Utility ────────────────────────────────────────────────────────────────

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function durationColor(ms: number | undefined): string {
  if (ms === undefined) return COLORS.textMuted;
  if (ms < 2000) return COLORS.green;
  if (ms < 10_000) return COLORS.yellow;
  return COLORS.red;
}

function relativeTs(ts: number, base: number): string {
  const delta = Math.max(0, ts - base);
  const ms = delta % 1000;
  const s = Math.floor(delta / 1000) % 60;
  const m = Math.floor(delta / 60_000);
  return `+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// ─── Floating launcher button (collapsed state) ─────────────────────────────

function LauncherButton({
  trace,
  onOpen,
}: { trace: ExecutionTrace; onOpen: () => void }) {
  const errors = trace.nodes.filter(n => n.status === "error").length;
  const warns = trace.nodes.filter(n => n.status === "warning").length;
  const hasIssue = errors + warns > 0;

  return (
    <button
      onClick={onOpen}
      title="Open execution diagnostics"
      style={{
        position: "fixed",
        right: 76,
        bottom: 16,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        background: "rgba(5,5,8,0.92)",
        border: `1px solid ${hasIssue ? "rgba(245,158,11,0.5)" : COLORS.border}`,
        borderRadius: 999,
        backdropFilter: "blur(24px) saturate(1.3)",
        WebkitBackdropFilter: "blur(24px) saturate(1.3)",
        boxShadow: hasIssue
          ? "0 8px 32px rgba(245,158,11,0.18), 0 0 0 1px rgba(245,158,11,0.15) inset"
          : "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset",
        cursor: "pointer",
        color: COLORS.text,
        fontFamily: MONO,
        fontSize: 12,
        animation: errors > 0 ? "diagPulse 1.6s ease-in-out infinite" : "none",
      }}
    >
      <Terminal size={14} color={COLORS.cyan} />
      <span style={{ fontWeight: 600, color: COLORS.text }}>Behind the Scenes</span>
      <span style={{ color: COLORS.textMuted, fontSize: 11 }}>·</span>
      <span style={{ color: COLORS.textDim, fontSize: 11 }}>
        {trace.nodes.length} {trace.nodes.length === 1 ? "node" : "nodes"} · {formatDuration(trace.totalDurationMs)}
      </span>
      {hasIssue ? (
        <span style={{ color: COLORS.yellow, fontSize: 11, fontWeight: 600 }}>
          · {errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : `${warns} warning${warns === 1 ? "" : "s"}`}
        </span>
      ) : null}
      <style jsx>{`
        @keyframes diagPulse {
          0%, 100% { box-shadow: 0 8px 32px rgba(239,68,68,0.18), 0 0 0 1px rgba(239,68,68,0.18) inset; }
          50%      { box-shadow: 0 8px 36px rgba(239,68,68,0.32), 0 0 0 1px rgba(239,68,68,0.30) inset; }
        }
      `}</style>
    </button>
  );
}

// ─── Timeline (horizontal node blocks) ──────────────────────────────────────

function NodeTimeline({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: NodeTrace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{
      display: "flex",
      gap: 6,
      overflowX: "auto",
      padding: "8px 4px 4px",
      scrollbarWidth: "thin",
    }}>
      {nodes.map((n, i) => {
        const meta = STATUS_META[n.status];
        const Icon = meta.icon;
        const isSelected = n.nodeId === selectedId;
        return (
          <div key={n.nodeId} style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => onSelect(n.nodeId)}
              style={{
                background: isSelected ? meta.bg : "rgba(255,255,255,0.02)",
                border: `1px solid ${isSelected ? meta.color : COLORS.border}`,
                borderRadius: 8,
                padding: "8px 10px",
                cursor: "pointer",
                color: COLORS.text,
                textAlign: "left",
                minWidth: 130,
                maxWidth: 200,
                transition: "transform 0.12s ease, border-color 0.15s ease",
                transform: isSelected ? "translateY(-1px)" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Icon size={11} color={meta.color} />
                <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: MONO }}>{n.nodeTypeId}</span>
                {n.isMock ? <span style={{ fontSize: 9, color: COLORS.purple, fontFamily: MONO }}>MOCK</span> : null}
                {n.isCacheHit ? <span style={{ fontSize: 9, color: COLORS.cyan, fontFamily: MONO }}>CACHE</span> : null}
                {n.fellBackToMock ? <span style={{ fontSize: 9, color: COLORS.yellow, fontFamily: MONO }}>FALLBACK</span> : null}
              </div>
              <div style={{
                fontSize: 11,
                fontWeight: 600,
                color: COLORS.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>{n.nodeName}</div>
              <div style={{
                fontSize: 10,
                fontFamily: MONO,
                color: durationColor(n.durationMs),
                marginTop: 2,
              }}>
                {formatDuration(n.durationMs)}
              </div>
            </button>
            {i < nodes.length - 1 ? (
              <ArrowRight size={12} color={COLORS.textMuted} style={{ flexShrink: 0 }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── Selected node detail ───────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11,
      color: COLORS.textMuted,
      fontFamily: MONO,
      letterSpacing: 0.5,
      marginBottom: 6,
      textTransform: "uppercase",
    }}>
      {children}
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12, fontFamily: MONO }}>
      <span style={{ color: COLORS.textDim }}>{label}</span>
      <span style={{ color: color ?? COLORS.text, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ─── IFC Parser Deep Dive ──────────────────────────────────────────────────
// Renders the file metadata, geometry/material breakdowns, smart warnings,
// sample elements with fallback chains, and parser timings. Surfaced when
// any parsing-stage diagnostics are populated on the selected node.

function bytesLabel(b: number | undefined): string {
  if (!b || !Number.isFinite(b)) return "?";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function IFCParserDeepDive({ parsing }: { parsing: Record<string, unknown> }) {
  const fm = parsing.fileMetadata as Record<string, unknown> | undefined;
  const samples = (parsing.elementSamples as Array<Record<string, unknown>> | undefined) ?? [];
  const timings = parsing.parserTimings as Record<string, number> | undefined;
  const smartWarnings = (parsing.smartWarnings as string[] | undefined) ?? [];
  const smartFixes = (parsing.smartFixes as string[] | undefined) ?? [];
  const gtb = (parsing.geometryTypeBreakdown as Record<string, number> | undefined) ?? {};
  const mtb = (parsing.materialTypeBreakdown as Record<string, number> | undefined) ?? {};
  const qsb = (parsing.quantitySourceBreakdown as Record<string, number> | undefined) ?? {};
  const elementsFound = (parsing.elementsFound as number | undefined) ?? 0;
  const zero = (parsing.elementsWithZeroQuantity as number | undefined) ?? 0;

  return (
    <div style={{
      background: "rgba(0,245,255,0.04)",
      border: "1px solid rgba(0,245,255,0.18)",
      borderRadius: 10,
      padding: 14,
      marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Cpu size={14} color={COLORS.cyan} />
        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.cyan, fontFamily: MONO, letterSpacing: 0.5, textTransform: "uppercase" }}>
          IFC Parser Deep Dive
        </span>
      </div>

      {/* File metadata header line */}
      {fm ? (
        <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontFamily: MONO, color: COLORS.text, marginBottom: 4 }}>
            <strong style={{ color: COLORS.cyan }}>FILE:</strong> {String(fm.fileName ?? "?")} ({bytesLabel(fm.fileSizeBytes as number)})
          </div>
          <div style={{ fontSize: 11, fontFamily: MONO, color: COLORS.textDim, lineHeight: 1.7 }}>
            <span><strong>Schema:</strong> {String(fm.ifcSchema ?? "?")}</span>
            {" · "}
            <span><strong>Author:</strong> {String(fm.authoringApplication ?? "Unknown")}{fm.authoringApplicationVersion ? ` ${fm.authoringApplicationVersion}` : ""}</span>
            <br />
            <span><strong>Entities:</strong> {(fm.totalEntityCount as number ?? 0).toLocaleString()}</span>
            {" | "}
            <span><strong>Products:</strong> {fm.totalProductCount as number ?? 0}</span>
            {" | "}
            <span><strong>PropertySets:</strong> {fm.propertySetCount as number ?? 0}</span>
            {fm.hasIfcSpaces ? <span> · <strong>Spaces:</strong> ✓</span> : null}
          </div>
        </div>
      ) : null}

      {/* Quantities pipeline */}
      <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Quantities Pipeline
        </div>
        <PipelineRow
          label="Qto_* Base Quantities"
          value={(fm?.qtoBaseSetCount as number) ?? 0}
          ok={((fm?.qtoBaseSetCount as number) ?? 0) > 0}
          note={((fm?.qtoBaseSetCount as number) ?? 0) === 0 ? "NONE FOUND — primary quantity source unavailable" : `${(fm?.qtoBaseSetCount as number) ?? 0} sets found`}
        />
        <PipelineRow
          label="Custom Property Quants"
          value={(fm?.customQuantitySetCount as number) ?? 0}
          ok={((fm?.customQuantitySetCount as number) ?? 0) > 0}
          note={`${(fm?.customQuantitySetCount as number) ?? 0} usable`}
        />
        <PipelineRow
          label="Geometry Computation"
          value={`${qsb.geometryCalculated ?? 0} of ${elementsFound}`}
          ok={(qsb.geometryCalculated ?? 0) > 0}
          note={(qsb.geometryCalculated ?? 0) === 0 && elementsFound > 0 ? "All geometry computation failed" : ""}
        />
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${COLORS.border}` }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, marginBottom: 4 }}>GEOMETRY TYPES:</div>
          {gtb.extrudedAreaSolid ? <GeomRow name="IfcExtrudedAreaSolid" count={gtb.extrudedAreaSolid} ok /> : null}
          {gtb.mappedItem ? <GeomRow name="IfcMappedItem" count={gtb.mappedItem} ok note="(via mapping source)" /> : null}
          {gtb.boundingBox ? <GeomRow name="IfcBoundingBox" count={gtb.boundingBox} ok /> : null}
          {gtb.facetedBrep ? <GeomRow name="IfcFacetedBrep" count={gtb.facetedBrep} note="(not supported by WASM)" /> : null}
          {gtb.booleanResult ? <GeomRow name="IfcBooleanResult" count={gtb.booleanResult} note="(not supported by WASM)" /> : null}
          {gtb.failed ? <GeomRow name="No representation" count={gtb.failed} note="(no shape items found)" /> : null}
          {gtb.other ? <GeomRow name="Other" count={gtb.other} /> : null}
          {!Object.values(gtb).some(v => v > 0) ? <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, padding: "4px 0" }}>No geometry strategy fired (all elements relied on Qto sets or have no shape).</div> : null}
        </div>
      </div>

      {/* Materials breakdown */}
      <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Materials</div>
        <div style={{ fontSize: 11, fontFamily: MONO, color: COLORS.textDim, lineHeight: 1.7 }}>
          {mtb.ifcMaterial ? <span style={{ color: COLORS.green }}>IfcMaterial: {mtb.ifcMaterial} ✓ </span> : null}
          {mtb.layerSet ? <span style={{ color: COLORS.green }}> | LayerSet: {mtb.layerSet} ✓ </span> : null}
          {mtb.constituentSet ? <span style={{ color: COLORS.green }}> | ConstituentSet: {mtb.constituentSet} ✓ </span> : null}
          {mtb.profileSet ? <span style={{ color: COLORS.green }}> | ProfileSet: {mtb.profileSet} ✓ </span> : null}
          {mtb.materialList ? <span style={{ color: COLORS.green }}> | MaterialList: {mtb.materialList} ✓ </span> : null}
          {mtb.none ? <span style={{ color: COLORS.yellow }}> | None: {mtb.none} ⚠ </span> : null}
        </div>
      </div>

      {/* Smart warnings + fixes */}
      {smartWarnings.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          {smartWarnings.map((w, i) => (
            <div key={`sw${i}`} style={{
              background: w.startsWith("⚠ CRITICAL") ? "rgba(239,68,68,0.10)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${w.startsWith("⚠ CRITICAL") ? "rgba(239,68,68,0.35)" : "rgba(245,158,11,0.30)"}`,
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 11,
              fontFamily: MONO,
              color: w.startsWith("⚠ CRITICAL") ? COLORS.red : COLORS.yellow,
              marginBottom: 6,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}>
              {w}
            </div>
          ))}
          {smartFixes.map((f, i) => (
            <div key={`sf${i}`} style={{
              background: "rgba(34,197,94,0.06)",
              border: "1px solid rgba(34,197,94,0.25)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 11,
              fontFamily: MONO,
              color: COLORS.green,
              marginBottom: 6,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}>
              {f}
            </div>
          ))}
        </div>
      ) : null}

      {/* Sample elements */}
      {samples.length > 0 ? (
        <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Sample Elements (first {samples.length} of {elementsFound})
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {samples.map((s, i) => {
              const isZero = s.hasZeroQuantity === true;
              return (
                <div key={i} style={{ fontSize: 11, fontFamily: MONO, padding: "3px 0", color: isZero ? COLORS.yellow : COLORS.textDim, lineHeight: 1.5 }}>
                  <span style={{ color: COLORS.textMuted }}>#{String(s.expressId)}</span>{" "}
                  <span style={{ color: COLORS.text }}>{String(s.ifcType)}</span>
                  <span style={{ color: COLORS.textMuted }}> {String(s.storey)}:</span>{" "}
                  <span>{s.geometryType ? String(s.geometryType) : "no geom"}</span>
                  <span style={{ color: COLORS.textMuted }}> →</span>{" "}
                  <span>area={Number(s.grossArea ?? 0).toFixed(2)}m² vol={Number(s.volume ?? 0).toFixed(2)}m³</span>{" "}
                  <span style={{ color: isZero ? COLORS.red : COLORS.green, fontWeight: 600 }}>{isZero ? "✗" : "✓"}</span>
                  {s.failureReason ? (
                    <div style={{ paddingLeft: 14, color: COLORS.textMuted, fontSize: 10, marginTop: 1 }}>
                      → {String(s.failureReason)}
                    </div>
                  ) : null}
                  {Array.isArray(s.fallbackChain) && (s.fallbackChain as unknown[]).length > 0 ? (
                    <div style={{ paddingLeft: 14, color: COLORS.textMuted, fontSize: 10, marginTop: 1 }}>
                      chain: {(s.fallbackChain as string[]).join(" → ")}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Parser timing */}
      {timings ? (
        <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Parser Timing</div>
          <div style={{ fontSize: 11, fontFamily: MONO, color: COLORS.textDim, lineHeight: 1.7 }}>
            {timings.wasmInitMs ? <span>WASM Init: <span style={{ color: COLORS.text }}>{timings.wasmInitMs}ms</span> | </span> : null}
            {timings.modelLoadMs ? <span>Model Load: <span style={{ color: COLORS.text }}>{timings.modelLoadMs}ms</span> | </span> : null}
            {timings.metadataScanMs ? <span>Metadata: <span style={{ color: COLORS.text }}>{timings.metadataScanMs}ms</span> | </span> : null}
            {timings.materialResolveMs ? <span>Materials: <span style={{ color: COLORS.text }}>{timings.materialResolveMs}ms</span> | </span> : null}
            {timings.propertyExtractMs ? <span>Properties: <span style={{ color: COLORS.text }}>{timings.propertyExtractMs}ms</span> | </span> : null}
            {timings.elementProcessMs ? <span>Elements: <span style={{ color: COLORS.text }}>{timings.elementProcessMs}ms</span> | </span> : null}
            {timings.aggregationMs ? <span>Aggregate: <span style={{ color: COLORS.text }}>{timings.aggregationMs}ms</span> | </span> : null}
            {timings.totalMs ? <span><strong>Total: <span style={{ color: COLORS.green }}>{timings.totalMs}ms</span></strong></span> : null}
          </div>
        </div>
      ) : null}

      {/* Aggregate footer */}
      {elementsFound > 0 ? (
        <div style={{ fontSize: 11, fontFamily: MONO, color: COLORS.textMuted, marginTop: 8, textAlign: "center" }}>
          {elementsFound} elements processed · {zero} with zero quantities · {samples.length} samples shown
        </div>
      ) : null}
    </div>
  );
}

function PipelineRow({ label, value, ok, note }: { label: string; value: number | string; ok: boolean; note?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 11, fontFamily: MONO }}>
      <span style={{ color: COLORS.textDim }}>{label}:</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: ok ? COLORS.green : COLORS.red, fontWeight: 600 }}>{value}</span>
        <span style={{ color: ok ? COLORS.green : COLORS.red }}>{ok ? "✓" : "✗"}</span>
        {note ? <span style={{ color: COLORS.textMuted, fontSize: 10 }}>{note}</span> : null}
      </span>
    </div>
  );
}

function GeomRow({ name, count, ok, note }: { name: string; count: number; ok?: boolean; note?: string }) {
  return (
    <div style={{ fontSize: 11, fontFamily: MONO, padding: "2px 0", color: COLORS.textDim }}>
      <span>  {name}:</span>{" "}
      <span style={{ color: ok ? COLORS.green : COLORS.red, fontWeight: 600 }}>{count}</span>{" "}
      <span style={{ color: ok ? COLORS.green : COLORS.red }}>{ok ? "✓" : "✗"}</span>
      {note ? <span style={{ color: COLORS.textMuted, marginLeft: 4 }}>{note}</span> : null}
    </div>
  );
}

// ─── Market Intelligence Deep Dive ──────────────────────────────────────────

function MarketIntelligenceDeepDive({ market }: { market: Record<string, unknown> }) {
  const ms = market.primaryCallMs as number | undefined;
  const cacheHit = market.cacheHit;
  const fallbackUsed = market.fallbackCallUsed;
  const retryUsed = market.retryUsed;
  const searches = (market.webSearchesPerformed as number | undefined) ?? 0;
  const status = String(market.status ?? "?");
  const fallbackChain = market.fallbackChainUsed;
  return (
    <div style={{
      background: "rgba(167,139,250,0.04)",
      border: "1px solid rgba(167,139,250,0.18)",
      borderRadius: 10,
      padding: 14,
      marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Sparkles size={14} color={COLORS.purple} />
        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.purple, fontFamily: MONO, letterSpacing: 0.5, textTransform: "uppercase" }}>
          Market Intelligence Deep Dive
        </span>
      </div>

      <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Pricing Pipeline
        </div>
        <div style={{ fontSize: 11, fontFamily: MONO, color: COLORS.textDim, lineHeight: 1.8 }}>
          <span><strong style={{ color: COLORS.text }}>Cache:</strong> </span>
          <span style={{ color: cacheHit ? COLORS.cyan : COLORS.textMuted }}>{cacheHit ? "HIT" : "MISS"}</span>
          {" → "}
          <span style={{ color: COLORS.text }}>{String(market.toolChoiceUsed ?? "Claude Haiku + web_search")}</span>
          {" → "}
          <span style={{ color: status === "success" ? COLORS.green : status === "partial" ? COLORS.yellow : COLORS.red, fontWeight: 600 }}>
            {status.toUpperCase()}
          </span>
          <br />
          <span><strong>Duration:</strong> <span style={{ color: COLORS.text }}>{ms ? `${(ms / 1000).toFixed(1)}s` : "—"}</span> (timeout: 45s)</span>
          {" | "}
          <span><strong>Searches:</strong> <span style={{ color: COLORS.text }}>{searches}</span></span>
          <br />
          <span><strong>Retry:</strong> <span style={{ color: retryUsed ? COLORS.yellow : COLORS.textMuted }}>{retryUsed ? "yes" : "not needed"}</span></span>
          {" | "}
          <span><strong>Fallback (no-search):</strong> <span style={{ color: fallbackUsed ? COLORS.yellow : COLORS.textMuted }}>{fallbackUsed ? "used" : "not needed"}</span></span>
          {" | "}
          <span><strong>Fallback chain (DB cache):</strong> <span style={{ color: fallbackChain ? COLORS.yellow : COLORS.textMuted }}>{fallbackChain ? "used" : "not needed"}</span></span>
        </div>
      </div>

      <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10 }}>
        <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Prices Fetched
        </div>
        {market.steelPrice ? (
          <div style={{ fontSize: 11, fontFamily: MONO, padding: "3px 0", color: COLORS.textDim }}>
            <strong style={{ color: COLORS.text }}>Steel:</strong> ₹{(market.steelPrice as number).toLocaleString()}/t
            {market.steelSource ? <span style={{ color: COLORS.textMuted }}> [{String(market.steelSource).slice(0, 80)}]</span> : null}
          </div>
        ) : null}
        {market.cementPrice ? (
          <div style={{ fontSize: 11, fontFamily: MONO, padding: "3px 0", color: COLORS.textDim }}>
            <strong style={{ color: COLORS.text }}>Cement:</strong> ₹{market.cementPrice as number}/bag
            {market.cementSource ? <span style={{ color: COLORS.textMuted }}> [{String(market.cementSource).slice(0, 80)}]</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NodeDetail({ node, baseTs }: { node: NodeTrace; baseTs: number }) {
  const meta = STATUS_META[node.status];
  const Icon = meta.icon;
  const stats = node.stats as Record<string, unknown>;

  // Pull headline stats if present (most BOQ nodes set these)
  const totalCost = stats.totalCost as number | undefined;
  const aaceClass = stats.aaceClass as string | undefined;

  // ── Pre-compute parser/cost breakdowns from any stowed pipeline diagnostics ──
  const pipelineDiag = stats.pipelineDiagnostics as Record<string, unknown> | undefined;
  const parserDiag = stats.parserDiagnostics as Record<string, unknown> | undefined;
  const marketDiag = stats.marketDiagnostics as Record<string, unknown> | undefined;
  const parserStages = (pipelineDiag?.stages ?? parserDiag?.stages) as Record<string, unknown> | undefined;
  const parsing = parserStages?.parsing as Record<string, unknown> | undefined;
  const market = (parserStages?.marketIntelligence ?? (marketDiag?.stages as Record<string, unknown> | undefined)?.marketIntelligence) as Record<string, unknown> | undefined;
  const cost = parserStages?.costMapping as Record<string, unknown> | undefined;

  return (
    <div style={{
      background: COLORS.panel,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 10,
      padding: 16,
      marginTop: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Icon size={16} color={meta.color} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.nodeName} <span style={{ color: COLORS.textMuted, fontFamily: MONO, fontWeight: 400 }}>({node.nodeTypeId})</span>
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, marginTop: 2 }}>
              node {node.nodeId.slice(0, 8)} · started {node.startedAt ? new Date(node.startedAt).toLocaleTimeString() : "—"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{
            background: meta.bg,
            border: `1px solid ${meta.color}40`,
            color: meta.color,
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: MONO,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}>{meta.label}</span>
          <span style={{
            color: durationColor(node.durationMs),
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 700,
          }}>{formatDuration(node.durationMs)}</span>
        </div>
      </div>

      {/* Summary */}
      {node.summary ? (
        <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 12, lineHeight: 1.5 }}>
          {node.summary}
        </div>
      ) : null}

      {/* Badges row */}
      {(node.isMock || node.isCacheHit || node.fellBackToMock) ? (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {node.isMock ? (
            <span style={{ fontSize: 10, color: COLORS.purple, background: "rgba(167,139,250,0.10)", border: "1px solid rgba(167,139,250,0.3)", padding: "2px 8px", borderRadius: 4, fontFamily: MONO }}>
              MOCK DATA — not a real API call
            </span>
          ) : null}
          {node.isCacheHit ? (
            <span style={{ fontSize: 10, color: COLORS.cyan, background: "rgba(0,245,255,0.10)", border: "1px solid rgba(0,245,255,0.3)", padding: "2px 8px", borderRadius: 4, fontFamily: MONO }}>
              CACHE HIT — reused previous result
            </span>
          ) : null}
          {node.fellBackToMock ? (
            <span style={{ fontSize: 10, color: COLORS.yellow, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.3)", padding: "2px 8px", borderRadius: 4, fontFamily: MONO }}>
              FALLBACK — real handler failed
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ── Deep-dive sections (only shown when rich data is present) ── */}
      {parsing?.fileMetadata || (parsing?.elementSamples && (parsing.elementSamples as unknown[]).length > 0) ? (
        <IFCParserDeepDive parsing={parsing as Record<string, unknown>} />
      ) : null}
      {market && (market.steelPrice || market.cementPrice || market.primaryCallMs) ? (
        <MarketIntelligenceDeepDive market={market as Record<string, unknown>} />
      ) : null}

      {/* Two-column grid: attempts & API calls / stats & data flow */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          {/* Attempts */}
          <SectionTitle>Attempts ({node.attempts.length})</SectionTitle>
          <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 8, marginBottom: 12 }}>
            {node.attempts.length === 0 ? (
              <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO }}>No attempts recorded</div>
            ) : node.attempts.map((a, i) => {
              const stColor = a.status === "success" ? COLORS.green : a.status === "skipped" ? COLORS.textMuted : a.status === "timeout" ? COLORS.yellow : COLORS.red;
              const sym = a.status === "success" ? "✓" : a.status === "skipped" ? "⊘" : a.status === "timeout" ? "⏱" : "✗";
              return (
                <div key={i} style={{ fontSize: 11, fontFamily: MONO, padding: "3px 0", color: COLORS.textDim }}>
                  <span style={{ color: COLORS.textMuted }}>{a.attemptNumber}.</span>{" "}
                  <span style={{ color: COLORS.text }}>{a.action}</span>{" "}
                  <span style={{ color: stColor, fontWeight: 600 }}>{sym} {a.status}</span>{" "}
                  <span style={{ color: durationColor(a.durationMs) }}>{formatDuration(a.durationMs)}</span>
                  {a.detail ? (
                    <div style={{ paddingLeft: 16, color: COLORS.textMuted, marginTop: 2 }}>{a.detail}</div>
                  ) : null}
                  {a.fallbackUsed ? (
                    <div style={{ paddingLeft: 16, color: COLORS.yellow, marginTop: 2 }}>↳ fallback: {a.fallbackUsed}</div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* API calls */}
          <SectionTitle>API Calls ({node.apiCalls.length})</SectionTitle>
          <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 8, marginBottom: 12 }}>
            {node.apiCalls.length === 0 ? (
              <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO }}>No API calls recorded</div>
            ) : node.apiCalls.map((c, i) => (
              <div key={i} style={{ fontSize: 11, fontFamily: MONO, padding: "3px 0" }}>
                <span style={{ color: COLORS.cyan }}>{c.service}</span>
                {c.endpoint ? <span style={{ color: COLORS.textDim }}>.{c.endpoint}</span> : null}
                {" "}
                <span style={{ color: c.status === "success" ? COLORS.green : COLORS.red }}>{c.status === "success" ? "✓" : "✗"}</span>
                {" "}
                <span style={{ color: durationColor(c.durationMs) }}>{formatDuration(c.durationMs)}</span>
                {c.cached ? <span style={{ color: COLORS.cyan, marginLeft: 6 }}>· cached</span> : null}
                {c.requestSummary ? <div style={{ paddingLeft: 12, color: COLORS.textMuted, marginTop: 2 }}>→ {c.requestSummary}</div> : null}
                {c.responseSummary ? <div style={{ paddingLeft: 12, color: COLORS.textDim, marginTop: 2 }}>← {c.responseSummary}</div> : null}
                {c.error ? <div style={{ paddingLeft: 12, color: COLORS.red, marginTop: 2 }}>error: {c.error}</div> : null}
              </div>
            ))}
          </div>
        </div>

        <div>
          {/* Stats — always show input/output, plus deep stats if available */}
          <SectionTitle>Data Flow</SectionTitle>
          <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontFamily: MONO, color: COLORS.textDim, padding: "2px 0" }}>
              <span style={{ color: COLORS.cyan }}>→ Received:</span> {node.inputSummary || "—"}
            </div>
            <div style={{ fontSize: 11, fontFamily: MONO, color: COLORS.textDim, padding: "2px 0" }}>
              <span style={{ color: COLORS.green }}>← Produced:</span> {node.outputSummary || "—"}
            </div>
          </div>

          <SectionTitle>Stats</SectionTitle>
          <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10, marginBottom: 12 }}>
            {totalCost !== undefined ? <StatRow label="Total cost" value={`₹${totalCost.toLocaleString()}`} /> : null}
            {aaceClass ? <StatRow label="AACE class" value={aaceClass} /> : null}

            {/* Parser-stage breakdown (TR-007 / pre-parse) */}
            {parsing ? (
              <>
                <StatRow label="Parser" value={String(parsing.parserUsed ?? "—")} />
                <StatRow label="Elements" value={`${parsing.elementsFound ?? 0} found / ${parsing.elementsWithArea ?? 0} with area`} />
                <StatRow
                  label="Zero quantity"
                  value={String(parsing.elementsWithZeroQuantity ?? 0)}
                  color={(parsing.elementsWithZeroQuantity as number ?? 0) > 0 ? COLORS.red : undefined}
                />
                {parsing.geometryTypeBreakdown ? (() => {
                  const g = parsing.geometryTypeBreakdown as Record<string, number>;
                  const items: string[] = [];
                  if (g.extrudedAreaSolid) items.push(`${g.extrudedAreaSolid} Extrusion ✓`);
                  if (g.booleanResult) items.push(`${g.booleanResult} Boolean ✗`);
                  if (g.facetedBrep) items.push(`${g.facetedBrep} FacetedBrep ✗`);
                  return items.length ? <StatRow label="Geometry" value={items.join(", ")} /> : null;
                })() : null}
              </>
            ) : null}

            {/* Market-stage breakdown (TR-015) */}
            {market ? (
              <>
                <StatRow label="Market status" value={String(market.status ?? "—")} />
                {market.steelPrice ? <StatRow label="Steel" value={`₹${(market.steelPrice as number).toLocaleString()}/t`} /> : null}
                {market.cementPrice ? <StatRow label="Cement" value={`₹${market.cementPrice}/bag`} /> : null}
                {market.primaryCallMs ? <StatRow label="Primary call" value={formatDuration(market.primaryCallMs as number)} /> : null}
              </>
            ) : null}

            {/* Cost-mapping breakdown (TR-008) */}
            {cost ? (
              <>
                <StatRow label="BOQ lines" value={String(cost.totalLineItems ?? 0)} />
                <StatRow label="IS 1200 mapped" value={String(cost.is1200Mapped ?? 0)} />
                <StatRow label="Provisional" value={String(cost.provisionalItems ?? 0)} />
              </>
            ) : null}

            {!parsing && !market && !cost && totalCost === undefined ? (
              <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO }}>No structured stats published</div>
            ) : null}
          </div>

          {/* Performance breakdown */}
          <SectionTitle>Performance</SectionTitle>
          <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 10 }}>
            <StatRow label="Total" value={formatDuration(node.performance.totalTime)} color={durationColor(node.performance.totalTime)} />
            {node.performance.parseTime ? <StatRow label="Parse" value={formatDuration(node.performance.parseTime)} /> : null}
            {node.performance.apiCallTime ? <StatRow label="API" value={formatDuration(node.performance.apiCallTime)} /> : null}
            {node.performance.computeTime ? <StatRow label="Compute" value={formatDuration(node.performance.computeTime)} /> : null}
            {node.performance.cacheCheckTime ? <StatRow label="Cache" value={formatDuration(node.performance.cacheCheckTime)} /> : null}
          </div>
        </div>
      </div>

      {/* Log */}
      <div style={{ marginTop: 12 }}>
        <SectionTitle>Log ({node.log.length} entries)</SectionTitle>
        <div style={{
          background: COLORS.bg,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          padding: 8,
          maxHeight: 200,
          overflowY: "auto",
          fontFamily: MONO,
          fontSize: 11,
        }}>
          {node.log.length === 0 ? (
            <div style={{ color: COLORS.textMuted }}>No log entries</div>
          ) : node.log.map((e, i) => (
            <div key={i} style={{ padding: "2px 0", color: COLORS.textDim, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: COLORS.textMuted }}>{relativeTs(e.timestamp, baseTs)}</span>{" "}
              <span style={{ color: LEVEL_COLOR[e.level], fontWeight: 600 }}>[{e.level.toUpperCase()}]</span>{" "}
              <span style={{ color: COLORS.text }}>{e.message}</span>
              {e.data ? <span style={{ color: COLORS.textMuted }}>{" "}{JSON.stringify(e.data)}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Workflow log (search across all nodes) ─────────────────────────────────

function WorkflowLog({ trace, baseTs }: { trace: ExecutionTrace; baseTs: number }) {
  const [filter, setFilter] = useState("");
  const allEntries = useMemo(() => {
    const rows: Array<{ nodeName: string; nodeTypeId: string; timestamp: number; level: LogLevel; message: string; data?: Record<string, unknown> }> = [];
    for (const n of trace.nodes) {
      for (const e of n.log) {
        rows.push({ nodeName: n.nodeName, nodeTypeId: n.nodeTypeId, ...e });
      }
    }
    rows.sort((a, b) => a.timestamp - b.timestamp);
    return rows;
  }, [trace]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter(e =>
      e.message.toLowerCase().includes(q) ||
      e.nodeTypeId.toLowerCase().includes(q) ||
      e.nodeName.toLowerCase().includes(q) ||
      e.level.toLowerCase().includes(q),
    );
  }, [allEntries, filter]);

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Terminal size={12} color={COLORS.textMuted} />
        <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, letterSpacing: 0.5, textTransform: "uppercase" }}>
          Workflow log ({allEntries.length} entries)
        </span>
        <div style={{ flex: 1 }} />
        <Search size={11} color={COLORS.textMuted} />
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="filter…"
          style={{
            background: COLORS.bg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            padding: "4px 8px",
            color: COLORS.text,
            fontSize: 11,
            fontFamily: MONO,
            outline: "none",
            width: 180,
          }}
        />
      </div>
      <div style={{
        background: COLORS.bg,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 6,
        padding: 8,
        maxHeight: 240,
        overflowY: "auto",
        fontFamily: MONO,
        fontSize: 11,
      }}>
        {filtered.length === 0 ? (
          <div style={{ color: COLORS.textMuted }}>No entries match.</div>
        ) : filtered.map((e, i) => (
          <div key={i} style={{ padding: "2px 0", color: COLORS.textDim, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <span style={{ color: COLORS.textMuted }}>{relativeTs(e.timestamp, baseTs)}</span>{" "}
            <span style={{ color: COLORS.cyan }}>[{e.nodeTypeId}]</span>{" "}
            <span style={{ color: LEVEL_COLOR[e.level], fontWeight: 600 }}>[{e.level.toUpperCase()}]</span>{" "}
            <span style={{ color: COLORS.text }}>{e.message}</span>
            {e.data ? <span style={{ color: COLORS.textMuted }}>{" "}{JSON.stringify(e.data)}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Data flow visualization ────────────────────────────────────────────────

function DataFlowList({ trace }: { trace: ExecutionTrace }) {
  const nodeNameById = useMemo(() => {
    const m = new Map<string, { name: string; typeId: string }>();
    for (const n of trace.nodes) m.set(n.nodeId, { name: n.nodeName, typeId: n.nodeTypeId });
    return m;
  }, [trace]);

  if (trace.dataFlows.length === 0) {
    return null;
  }
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginTop: 12 }}>
      <SectionTitle>Edges ({trace.dataFlows.length} data flows)</SectionTitle>
      <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 8 }}>
        {trace.dataFlows.map((f, i) => {
          const from = nodeNameById.get(f.fromNodeId);
          const to = nodeNameById.get(f.toNodeId);
          return (
            <div key={i} style={{ fontSize: 11, fontFamily: MONO, padding: "3px 0", color: COLORS.textDim }}>
              <span style={{ color: COLORS.text }}>{from?.name ?? f.fromNodeId.slice(0, 6)}</span>
              <span style={{ color: COLORS.textMuted }}> ({from?.typeId ?? "?"}) </span>
              <ArrowRight size={10} style={{ display: "inline", verticalAlign: "middle" }} color={COLORS.textMuted} />
              <span style={{ color: COLORS.text }}> {to?.name ?? f.toNodeId.slice(0, 6)}</span>
              <span style={{ color: COLORS.textMuted }}> ({to?.typeId ?? "?"})</span>
              <span style={{ color: COLORS.cyan, marginLeft: 8 }}>{f.dataType}</span>
              {f.recordCount !== undefined ? <span style={{ color: COLORS.textDim, marginLeft: 6 }}>· {f.recordCount} records</span> : null}
              {f.dataSizeEstimate ? <span style={{ color: COLORS.textMuted, marginLeft: 6 }}>· {f.dataSizeEstimate}</span> : null}
              {f.warnings && f.warnings.length > 0 ? (
                <span style={{ color: COLORS.yellow, marginLeft: 6 }}>· ⚠ {f.warnings[0]}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top status bar ─────────────────────────────────────────────────────────

function TopBar({ trace, onCopy, onExport, onClose }: { trace: ExecutionTrace; onCopy: () => void; onExport: () => void; onClose: () => void }) {
  const counts = useMemo(() => {
    const c = { success: 0, warning: 0, error: 0, skipped: 0, running: 0, pending: 0 };
    for (const n of trace.nodes) c[n.status]++;
    return c;
  }, [trace]);
  const total = trace.totalDurationMs ?? trace.nodes.reduce((s, n) => s + (n.durationMs ?? 0), 0);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 16px",
      borderBottom: `1px solid ${COLORS.border}`,
      flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Sparkles size={14} color={COLORS.cyan} />
        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {trace.workflowName}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: MONO }}>
          · {trace.executionId.slice(0, 12)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Clock size={11} color={COLORS.textMuted} />
        <span style={{ fontSize: 11, fontFamily: MONO, color: durationColor(total) }}>
          {formatDuration(total)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {counts.success > 0 ? <span style={{ fontSize: 11, color: COLORS.green, fontFamily: MONO }}>✓ {counts.success}</span> : null}
        {counts.warning > 0 ? <span style={{ fontSize: 11, color: COLORS.yellow, fontFamily: MONO }}>⚠ {counts.warning}</span> : null}
        {counts.error > 0 ? <span style={{ fontSize: 11, color: COLORS.red, fontFamily: MONO }}>✗ {counts.error}</span> : null}
        {counts.running > 0 ? <span style={{ fontSize: 11, color: COLORS.cyan, fontFamily: MONO }}>● {counts.running} running</span> : null}
      </div>

      <div style={{ flex: 1 }} />

      <button
        onClick={onCopy}
        title="Copy diagnostics JSON to clipboard"
        style={{
          background: "transparent",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          padding: "5px 10px",
          color: COLORS.textDim,
          fontSize: 11,
          fontFamily: MONO,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Copy size={11} /> Copy
      </button>
      <button
        onClick={onExport}
        title="Download diagnostics as JSON file"
        style={{
          background: "transparent",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          padding: "5px 10px",
          color: COLORS.textDim,
          fontSize: 11,
          fontFamily: MONO,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Download size={11} /> Export
      </button>
      <button
        onClick={onClose}
        title="Close diagnostics"
        style={{
          background: "transparent",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          padding: 5,
          color: COLORS.textDim,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ─── Workflow-level warnings/errors banner ─────────────────────────────────

function WorkflowBanners({ trace }: { trace: ExecutionTrace }) {
  if (trace.warnings.length === 0 && trace.errors.length === 0) return null;
  return (
    <div style={{ padding: "8px 16px 0" }}>
      {trace.errors.map((e, i) => (
        <div key={`e${i}`} style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 11,
          color: COLORS.red,
          fontFamily: MONO,
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          <XCircle size={11} /> {e}
        </div>
      ))}
      {trace.warnings.map((w, i) => (
        <div key={`w${i}`} style={{
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 11,
          color: COLORS.yellow,
          fontFamily: MONO,
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          <AlertTriangle size={11} /> {w}
        </div>
      ))}
    </div>
  );
}

// ─── Root component ─────────────────────────────────────────────────────────

interface ExecutionDiagnosticsPanelProps {
  /** Optional override; if omitted, reads from the execution store. */
  trace?: ExecutionTrace | null;
}

export function ExecutionDiagnosticsPanel({ trace: propTrace }: ExecutionDiagnosticsPanelProps = {}) {
  const storeTrace = useExecutionStore(selectCurrentTrace);
  const trace = propTrace ?? storeTrace;
  const [open, setOpen] = useState(false);
  // Explicit user selection. Null means "auto" — the effective selected node
  // is computed below, defaulting to error / running / first available node.
  const [explicitSelectedId, setExplicitSelectedId] = useState<string | null>(null);
  const effectiveSelectedId = useMemo(() => {
    if (!trace || trace.nodes.length === 0) return null;
    if (explicitSelectedId && trace.nodes.some(n => n.nodeId === explicitSelectedId)) return explicitSelectedId;
    const erroring = trace.nodes.find(n => n.status === "error");
    const running = trace.nodes.find(n => n.status === "running");
    return (erroring ?? running ?? trace.nodes[0]).nodeId;
  }, [trace, explicitSelectedId]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const baseTs = useMemo(() => {
    if (!trace) return 0;
    const ts = new Date(trace.startedAt).getTime();
    if (Number.isFinite(ts)) return ts;
    return trace.nodes[0]?.log[0]?.timestamp ?? 0;
  }, [trace]);

  const handleCopy = useCallback(async () => {
    if (!trace) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      toast.success("Diagnostics copied to clipboard");
    } catch {
      toast.error("Copy failed — your browser blocked clipboard access");
    }
  }, [trace]);

  const handleExport = useCallback(() => {
    if (!trace) return;
    const blob = new Blob([JSON.stringify(trace, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diagnostics_${trace.executionId.slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [trace]);

  // Body-scroll lock when expanded
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!trace || trace.nodes.length === 0) return null;

  if (!open) return <LauncherButton trace={trace} onOpen={() => setOpen(true)} />;

  const selectedNode = trace.nodes.find(n => n.nodeId === effectiveSelectedId) ?? trace.nodes[0];

  return (
    <div
      role="dialog"
      aria-label="Execution diagnostics"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "stretch",
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div style={{
        width: "100%",
        maxHeight: "75vh",
        background: COLORS.bg,
        borderTop: `1px solid ${COLORS.borderStrong}`,
        boxShadow: "0 -16px 48px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "diagSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
      }}>
        <TopBar trace={trace} onCopy={handleCopy} onExport={handleExport} onClose={() => setOpen(false)} />

        <div style={{ padding: "12px 16px 0" }}>
          <NodeTimeline nodes={trace.nodes} selectedId={selectedNode.nodeId} onSelect={setExplicitSelectedId} />
        </div>

        <WorkflowBanners trace={trace} />

        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 24px" }}>
          <NodeDetail node={selectedNode} baseTs={baseTs} />
          <DataFlowList trace={trace} />
          <WorkflowLog trace={trace} baseTs={baseTs} />

          <div style={{ marginTop: 16, padding: 12, fontSize: 11, color: COLORS.textMuted, fontFamily: MONO, textAlign: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Database size={11} /> diagnostics persisted to Execution.metadata · <Cpu size={11} /> {trace.nodes.length} nodes
            </span>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes diagSlideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
