/**
 * DetailedLogsSection — comprehensive admin debug surface.
 *
 * Sits at the bottom of the Brief→Renders page and renders EVERYTHING
 * the polled job state knows: identifiers, brief metadata, full
 * extracted spec, every assembled prompt verbatim, per-shot lifecycle
 * with timestamps, raw stageLog JSON, cost breakdown.
 *
 * Why this exists vs. the compact JobLogsPanel above:
 *   • JobLogsPanel is a glanceable status strip — fits in the
 *     viewport, ~250 px tall, designed to be always visible.
 *   • DetailedLogsSection is the deep-dive surface — verbose, dense,
 *     scrollable. Hidden until admins explicitly request it via the
 *     "View Logs" button at the top of the page.
 *
 * Admin-only. Caller (`BriefRenderShell`) passes `visible` based on
 * `isPlatformAdmin(email)` OR the user's DB role being PLATFORM_ADMIN
 * / TEAM_ADMIN. Returns null when not visible.
 *
 * Re-renders on every poll tick (5–15 s adaptive cadence owned by
 * `useBriefRenderJob`), so what you see is at most one tick stale.
 */

"use client";

import { forwardRef, useState } from "react";

import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";
import type {
  ApartmentSpec,
  BriefSpec,
  ShotResult,
  ShotSpec,
  BriefStageLogEntry,
} from "@/features/brief-renders/services/brief-pipeline/types";

export interface DetailedLogsSectionProps {
  job: BriefRenderJobView;
  visible: boolean;
  onClose?: () => void;
}

const SHOT_STATUS_COLOR: Record<ShotResult["status"], string> = {
  pending: "#9CA3AF",
  running: "#22D3EE",
  success: "#34D399",
  failed: "#F87171",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${m}m ${s}s`;
}

export const DetailedLogsSection = forwardRef<
  HTMLElement,
  DetailedLogsSectionProps
>(function DetailedLogsSection({ job, visible, onClose }, ref) {
  if (!visible) return null;

  const spec = job.specResult as BriefSpec | null;
  const shots = (job.shots as ShotResult[] | null) ?? [];
  const stageLog = Array.isArray(job.stageLog)
    ? (job.stageLog as BriefStageLogEntry[])
    : [];

  return (
    <section
      ref={ref}
      id="detailed-pipeline-logs"
      data-testid="detailed-logs-section"
      style={{
        background: "#0a0c10",
        border: "1px solid rgba(184,115,51,0.18)",
        borderRadius: 12,
        fontFamily:
          "var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        color: "#D1D5DB",
        padding: 0,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "rgba(184,115,51,0.06)",
          borderBottom: "1px solid rgba(184,115,51,0.18)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontSize: 11,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "#F0F2F8",
              fontWeight: 600,
            }}
          >
            Detailed Pipeline Logs · Admin
          </span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>
            Full state snapshot — refreshes on every polling tick (≤ 15 s).
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            data-testid="detailed-logs-close"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "rgba(255,255,255,0.7)",
              padding: "4px 10px",
              fontFamily: "inherit",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Hide
          </button>
        )}
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        <Card title="Job overview">
          <KvGrid>
            <Kv k="jobId" v={job.id} mono />
            <Kv k="requestId" v={job.requestId} mono />
            <Kv k="status" v={job.status} />
            <Kv k="currentStage" v={job.currentStage ?? "—"} />
            <Kv k="progress" v={`${Math.round(job.progress)} %`} />
            <Kv k="userApproval" v={job.userApproval ?? "—"} />
            <Kv k="costUsd" v={`$${job.costUsd.toFixed(3)}`} />
            <Kv k="createdAt" v={formatTime(job.createdAt)} />
            <Kv k="startedAt" v={formatTime(job.startedAt)} />
            <Kv k="updatedAt" v={formatTime(job.updatedAt)} />
            <Kv k="completedAt" v={formatTime(job.completedAt)} />
            <Kv
              k="errorMessage"
              v={job.errorMessage ?? "—"}
              tone={job.errorMessage ? "error" : undefined}
            />
          </KvGrid>
        </Card>

        <Card title="Brief input">
          <KvGrid>
            <Kv k="briefUrl" v={job.briefUrl} mono breakAll />
          </KvGrid>
        </Card>

        {spec && <SpecCard spec={spec} />}

        <Card
          title={`Generated prompts (${shots.length} ${shots.length === 1 ? "image" : "images"} to render)`}
        >
          {shots.length === 0 ? (
            <Empty>No prompts generated yet — Stage 2 hasn&apos;t completed.</Empty>
          ) : (
            <PromptList shots={shots} spec={spec} />
          )}
        </Card>

        <Card title={`Per-shot lifecycle (${shots.length})`}>
          {shots.length === 0 ? (
            <Empty>Shots array is empty.</Empty>
          ) : (
            <ShotLifecycleTable shots={shots} spec={spec} />
          )}
        </Card>

        <Card title={`Raw stageLog (${stageLog.length} entries)`}>
          {stageLog.length === 0 ? (
            <Empty>
              No stages logged yet. If this stays empty, check that the worker
              dispatched (server log:{" "}
              <code style={{ color: "#FBBF24" }}>POST /api/brief-renders/worker</code>).
            </Empty>
          ) : (
            <StageLogRaw entries={stageLog} />
          )}
        </Card>

        <Card title="Cost breakdown">
          <CostBreakdown stageLog={stageLog} totalCostUsd={job.costUsd} />
        </Card>
      </div>
    </section>
  );
});

// ─── Layout primitives ────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "transparent",
          border: "none",
          color: "#F0F2F8",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 11,
          letterSpacing: "1px",
          textTransform: "uppercase",
        }}
      >
        <span>{title}</span>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>
          {collapsed ? "▸ expand" : "▾ collapse"}
        </span>
      </button>
      {!collapsed && <div style={{ padding: "0 16px 14px 16px" }}>{children}</div>}
    </div>
  );
}

function KvGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(110px, max-content) 1fr",
        columnGap: 16,
        rowGap: 6,
      }}
    >
      {children}
    </div>
  );
}

function Kv({
  k,
  v,
  mono,
  breakAll,
  tone,
}: {
  k: string;
  v: string;
  mono?: boolean;
  breakAll?: boolean;
  tone?: "error";
}) {
  return (
    <>
      <span
        style={{
          color: "rgba(255,255,255,0.4)",
          fontSize: 10,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
        }}
      >
        {k}
      </span>
      <span
        style={{
          color: tone === "error" ? "#FCA5A5" : "#F0F2F8",
          fontFamily: mono
            ? "var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace"
            : "inherit",
          fontSize: 12,
          wordBreak: breakAll ? "break-all" : undefined,
        }}
      >
        {v}
      </span>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 10,
        background: "rgba(255,255,255,0.02)",
        borderRadius: 6,
        color: "rgba(255,255,255,0.45)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

// ─── Spec card ────────────────────────────────────────────────────────

function SpecCard({ spec }: { spec: BriefSpec }) {
  return (
    <Card title="Extracted spec (BriefSpec)">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <KvGrid>
          <Kv k="projectTitle" v={spec.projectTitle ?? "—"} />
          <Kv k="projectLocation" v={spec.projectLocation ?? "—"} />
          <Kv k="projectType" v={spec.projectType ?? "—"} />
          <Kv k="apartments" v={String(spec.apartments.length)} />
          <Kv
            k="referenceImages"
            v={String(spec.referenceImageUrls?.length ?? 0)}
          />
        </KvGrid>

        <details>
          <summary style={{ cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
            Baseline (visualStyle, materialPalette, …)
          </summary>
          <KvGrid>
            <Kv k="visualStyle" v={spec.baseline.visualStyle ?? "—"} />
            <Kv
              k="materialPalette"
              v={spec.baseline.materialPalette ?? "—"}
            />
            <Kv
              k="lightingBaseline"
              v={spec.baseline.lightingBaseline ?? "—"}
            />
            <Kv k="cameraBaseline" v={spec.baseline.cameraBaseline ?? "—"} />
            <Kv k="qualityTarget" v={spec.baseline.qualityTarget ?? "—"} />
            <Kv
              k="additionalNotes"
              v={spec.baseline.additionalNotes ?? "—"}
            />
          </KvGrid>
        </details>

        <ApartmentsTable apartments={spec.apartments} />
      </div>
    </Card>
  );
}

function ApartmentsTable({ apartments }: { apartments: ApartmentSpec[] }) {
  if (apartments.length === 0) return <Empty>No apartments.</Empty>;
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 6,
        }}
      >
        Apartments
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto auto auto auto auto",
          gap: 8,
          fontSize: 11,
        }}
      >
        <Th>label</Th>
        <Th>labelDe</Th>
        <Th>area m²</Th>
        <Th>beds</Th>
        <Th>baths</Th>
        <Th>shots</Th>
        {apartments.map((a, i) => (
          <ApartmentRow key={i} a={a} />
        ))}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        color: "rgba(255,255,255,0.35)",
        fontSize: 10,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function ApartmentRow({ a }: { a: ApartmentSpec }) {
  const cells = [
    a.label ?? "—",
    a.labelDe ?? "—",
    a.totalAreaSqm !== null && a.totalAreaSqm !== undefined
      ? String(a.totalAreaSqm)
      : "—",
    a.bedrooms !== null && a.bedrooms !== undefined ? String(a.bedrooms) : "—",
    a.bathrooms !== null && a.bathrooms !== undefined
      ? String(a.bathrooms)
      : "—",
    String(a.shots.length),
  ];
  return (
    <>
      {cells.map((c, i) => (
        <span key={i} style={{ color: "#F0F2F8" }}>
          {c}
        </span>
      ))}
    </>
  );
}

// ─── Prompt list ──────────────────────────────────────────────────────

function PromptList({
  shots,
  spec,
}: {
  shots: ShotResult[];
  spec: BriefSpec | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {shots.map((s) => (
        <PromptRow key={s.shotIndex} shot={s} spec={spec} />
      ))}
    </div>
  );
}

function PromptRow({
  shot,
  spec,
}: {
  shot: ShotResult;
  spec: BriefSpec | null;
}) {
  const [open, setOpen] = useState(false);
  const apt =
    spec?.apartments[shot.apartmentIndex ?? 0] ?? null;
  const shotSpec: ShotSpec | null =
    apt?.shots[shot.shotIndexInApartment] ?? null;
  const tone = SHOT_STATUS_COLOR[shot.status];
  const labelEn = shotSpec?.roomNameEn ?? "—";
  const labelDe = shotSpec?.roomNameDe ?? null;
  const aptLabel = apt?.label ?? `Apt ${(shot.apartmentIndex ?? 0) + 1}`;
  const isHero = shotSpec?.isHero === true;
  const preview = shot.prompt
    ? shot.prompt.length > 220
      ? shot.prompt.slice(0, 220) + "…"
      : shot.prompt
    : "(no prompt)";
  return (
    <div
      data-testid={`prompt-row-${shot.shotIndex}`}
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 6,
        padding: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <span style={{ color: tone, fontWeight: 700 }}>
          #{shot.shotIndex + 1}
        </span>
        <span style={{ color: "#F0F2F8", fontWeight: 600 }}>
          {aptLabel} · {labelEn}
        </span>
        {labelDe && (
          <span style={{ color: "rgba(255,255,255,0.5)" }}>/ {labelDe}</span>
        )}
        {isHero && (
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 3,
              background: "rgba(52,211,153,0.15)",
              color: "#34D399",
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            HERO
          </span>
        )}
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>
          {shot.aspectRatio} · {shot.prompt.length} chars · {shot.status}
        </span>
      </div>

      <div
        style={{
          color: "rgba(255,255,255,0.7)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: "rgba(0,0,0,0.25)",
          padding: 8,
          borderRadius: 4,
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        {open ? shot.prompt : preview}
      </div>

      {shot.prompt.length > 220 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            marginTop: 4,
            background: "transparent",
            border: "none",
            color: "#22D3EE",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 10,
            padding: 0,
          }}
        >
          {open ? "Collapse" : "Expand full prompt"}
        </button>
      )}
    </div>
  );
}

// ─── Per-shot lifecycle table ─────────────────────────────────────────

function ShotLifecycleTable({
  shots,
  spec,
}: {
  shots: ShotResult[];
  spec: BriefSpec | null;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "30px 60px minmax(120px, 1fr) 90px 120px 120px 70px 1fr",
        gap: 6,
        fontSize: 11,
        alignItems: "baseline",
      }}
    >
      <Th>#</Th>
      <Th>shot</Th>
      <Th>label</Th>
      <Th>status</Th>
      <Th>started</Th>
      <Th>completed</Th>
      <Th>cost</Th>
      <Th>image / error</Th>
      {shots.map((s) => (
        <ShotLifecycleRow key={s.shotIndex} shot={s} spec={spec} />
      ))}
    </div>
  );
}

function ShotLifecycleRow({
  shot,
  spec,
}: {
  shot: ShotResult;
  spec: BriefSpec | null;
}) {
  const tone = SHOT_STATUS_COLOR[shot.status];
  const apt = spec?.apartments[shot.apartmentIndex ?? 0] ?? null;
  const shotSpec = apt?.shots[shot.shotIndexInApartment] ?? null;
  const label = `${apt?.label ?? "?"} · ${shotSpec?.roomNameEn ?? "—"}`;
  return (
    <>
      <span style={{ color: tone, fontWeight: 700 }}>
        {shot.status === "success"
          ? "✓"
          : shot.status === "failed"
            ? "✗"
            : shot.status === "running"
              ? "▸"
              : "·"}
      </span>
      <span style={{ color: "rgba(255,255,255,0.7)" }}>
        S{(shot.apartmentIndex ?? 0) + 1}.{shot.shotIndexInApartment + 1}
      </span>
      <span style={{ color: "#F0F2F8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ color: tone }}>{shot.status}</span>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>
        {shot.startedAt ? formatTime(shot.startedAt) : "—"}
      </span>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>
        {shot.completedAt ? formatTime(shot.completedAt) : "—"}
      </span>
      <span style={{ color: tone, fontVariantNumeric: "tabular-nums" }}>
        {shot.costUsd !== null && shot.costUsd > 0
          ? `$${shot.costUsd.toFixed(3)}`
          : "—"}
      </span>
      <span
        style={{
          color: shot.errorMessage ? "#FCA5A5" : "rgba(255,255,255,0.55)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={shot.imageUrl ?? shot.errorMessage ?? ""}
      >
        {shot.errorMessage
          ? `error: ${shot.errorMessage}`
          : shot.imageUrl
            ? shot.imageUrl
            : "—"}
      </span>
    </>
  );
}

// ─── Raw stage log ────────────────────────────────────────────────────

function StageLogRaw({ entries }: { entries: BriefStageLogEntry[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map((e, i) => (
        <details
          key={`${e.stage}-${i}`}
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 6,
            padding: 8,
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              color: "#F0F2F8",
              fontSize: 11,
            }}
          >
            S{e.stage} · {e.name} · {e.status} ·{" "}
            {formatDuration(e.durationMs)} ·{" "}
            {e.costUsd ? `$${e.costUsd.toFixed(3)}` : "$0"}
          </summary>
          <pre
            style={{
              margin: "8px 0 0 0",
              fontSize: 10,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.7)",
              background: "rgba(0,0,0,0.3)",
              padding: 8,
              borderRadius: 4,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(e, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}

// ─── Cost breakdown ───────────────────────────────────────────────────

function CostBreakdown({
  stageLog,
  totalCostUsd,
}: {
  stageLog: BriefStageLogEntry[];
  totalCostUsd: number;
}) {
  const perStage = stageLog.reduce<Record<number, number>>((acc, e) => {
    acc[e.stage] = (acc[e.stage] ?? 0) + (e.costUsd ?? 0);
    return acc;
  }, {});
  const stages = Object.keys(perStage).map(Number).sort();
  return (
    <KvGrid>
      {stages.map((s) => (
        <Kv key={s} k={`stage ${s}`} v={`$${perStage[s].toFixed(3)}`} />
      ))}
      <Kv k="job total (so far)" v={`$${totalCostUsd.toFixed(3)}`} />
    </KvGrid>
  );
}
