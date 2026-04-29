/**
 * SpecReviewGate — minimal AWAITING_APPROVAL UI primitive.
 *
 * Shows the parsed `BriefSpec` + assembled prompts for the user to
 * review before Phase 4's image gen kicks off. Two actions: approve
 * (triggers Phase 4) and cancel.
 *
 * Phase 3 ships a read-only display. Editing prompts inline is a
 * Phase 6 feature.
 *
 * Renders nothing (returns `null`) when:
 *   • The polled job is still loading.
 *   • Status is anything other than `AWAITING_APPROVAL`.
 * Phase 6's full dashboard page wraps this gate inside its own
 * status-aware shell that swaps in different views per status.
 */

"use client";

import { useState } from "react";

import {
  useBriefRenderJob,
  type BriefRenderJobView,
} from "@/features/brief-renders/hooks/useBriefRenderJob";
import type {
  ApartmentSpec,
  BriefSpec,
  ShotResult,
  ShotSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";

export interface SpecReviewGateProps {
  jobId: string;
}

const PROMPT_PREVIEW_CHARS = 200;

export function SpecReviewGate({ jobId }: SpecReviewGateProps) {
  const { job, isLoading } = useBriefRenderJob({ jobId, enabled: true });
  const [busy, setBusy] = useState<"approve" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedShot, setExpandedShot] = useState<number | null>(null);

  if (isLoading || !job) return null;
  if (job.status !== "AWAITING_APPROVAL") return null;

  const spec = job.specResult as BriefSpec | null;
  const shots = (job.shots as ShotResult[] | null) ?? [];

  if (!spec) return null;

  async function handleApprove() {
    setBusy("approve");
    setActionError(null);
    try {
      const res = await fetch(`/api/brief-renders/${jobId}/approve`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setActionError(`Approve failed (${res.status})${txt ? `: ${txt.slice(0, 200)}` : ""}`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    setBusy("cancel");
    setActionError(null);
    try {
      const res = await fetch(`/api/brief-renders/${jobId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setActionError(`Cancel failed (${res.status})${txt ? `: ${txt.slice(0, 200)}` : ""}`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-zinc-900 text-zinc-100 p-6 rounded-lg space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Review brief specification</h2>
        <p className="text-sm text-zinc-400">
          Approve to start image generation. Every field below was
          extracted directly from your brief — empty fields mean the
          source was silent.
        </p>
      </header>

      <ProjectMetaTable spec={spec} />
      <ApartmentTable spec={spec} />
      <ShotTable
        spec={spec}
        shots={shots}
        expandedShot={expandedShot}
        onToggleExpand={setExpandedShot}
      />
      <CostSummary job={job} />

      {actionError && (
        <div
          role="alert"
          className="bg-red-950 border border-red-700 text-red-100 px-4 py-2 rounded text-sm"
        >
          {actionError}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleApprove}
          disabled={busy !== null}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:cursor-not-allowed px-4 py-2 rounded font-medium"
        >
          {busy === "approve" ? "Approving…" : "Approve & Generate"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy !== null}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:cursor-not-allowed px-4 py-2 rounded font-medium"
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </section>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function dashIfNull<T>(value: T | null | undefined): T | "—" {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.trim().length === 0) return "—";
  return value;
}

function ProjectMetaTable({ spec }: { spec: BriefSpec }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">Project</h3>
      <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-zinc-500">Title</dt>
        <dd>{dashIfNull(spec.projectTitle)}</dd>
        <dt className="text-zinc-500">Location</dt>
        <dd>{dashIfNull(spec.projectLocation)}</dd>
        <dt className="text-zinc-500">Type</dt>
        <dd>{dashIfNull(spec.projectType)}</dd>
      </dl>
    </div>
  );
}

function ApartmentTable({ spec }: { spec: BriefSpec }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Apartments ({spec.apartments.length})
      </h3>
      <table className="w-full text-sm border-separate border-spacing-y-1">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="px-2 py-1 font-medium">Label</th>
            <th className="px-2 py-1 font-medium">DE</th>
            <th className="px-2 py-1 font-medium">Total m²</th>
            <th className="px-2 py-1 font-medium">Beds</th>
            <th className="px-2 py-1 font-medium">Baths</th>
            <th className="px-2 py-1 font-medium">Shots</th>
          </tr>
        </thead>
        <tbody>
          {spec.apartments.map((apt: ApartmentSpec, idx: number) => (
            <tr key={idx} className="bg-zinc-800/40">
              <td className="px-2 py-1">{dashIfNull(apt.label)}</td>
              <td className="px-2 py-1">{dashIfNull(apt.labelDe)}</td>
              <td className="px-2 py-1">{dashIfNull(apt.totalAreaSqm)}</td>
              <td className="px-2 py-1">{dashIfNull(apt.bedrooms)}</td>
              <td className="px-2 py-1">{dashIfNull(apt.bathrooms)}</td>
              <td className="px-2 py-1">{apt.shots.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ShotTableProps {
  spec: BriefSpec;
  shots: ShotResult[];
  expandedShot: number | null;
  onToggleExpand: (idx: number | null) => void;
}

function ShotTable({ spec, shots, expandedShot, onToggleExpand }: ShotTableProps) {
  // Pair each ShotResult back to its source ShotSpec so we can render
  // the bilingual room name + source-level metadata next to the prompt.
  const sourceShots: Array<{
    shotResult: ShotResult;
    shotSpec: ShotSpec | null;
    apartmentLabel: string | null;
  }> = shots.map((shotResult) => {
    const apt =
      shotResult.apartmentIndex !== null && shotResult.apartmentIndex !== undefined
        ? spec.apartments[shotResult.apartmentIndex] ?? null
        : null;
    const shotSpec =
      apt && shotResult.shotIndexInApartment >= 0
        ? apt.shots[shotResult.shotIndexInApartment] ?? null
        : null;
    return {
      shotResult,
      shotSpec,
      apartmentLabel: apt?.label ?? null,
    };
  });

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Shots ({shots.length})
      </h3>
      <div className="space-y-1">
        {sourceShots.map(({ shotResult, shotSpec, apartmentLabel }) => {
          const isExpanded = expandedShot === shotResult.shotIndex;
          const preview =
            shotResult.prompt.length > PROMPT_PREVIEW_CHARS
              ? shotResult.prompt.slice(0, PROMPT_PREVIEW_CHARS) + "…"
              : shotResult.prompt;
          return (
            <div
              key={shotResult.shotIndex}
              className="bg-zinc-800/40 rounded px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-baseline gap-2 text-zinc-300">
                <span className="font-mono text-xs text-zinc-500">
                  #{shotResult.shotIndex}
                </span>
                <span className="text-zinc-400">
                  {dashIfNull(apartmentLabel)} ·
                </span>
                <span>{dashIfNull(shotSpec?.roomNameEn ?? null)}</span>
                {shotSpec?.roomNameDe && (
                  <span className="text-zinc-500">
                    / {shotSpec.roomNameDe}
                  </span>
                )}
                <span className="text-zinc-500 text-xs">
                  · {shotResult.aspectRatio}
                </span>
                {shotSpec?.isHero && (
                  <span className="bg-emerald-700/60 px-2 py-0.5 rounded text-xs">
                    HERO
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-400 mt-1 font-mono whitespace-pre-wrap">
                {isExpanded ? shotResult.prompt : preview}
              </div>
              {shotResult.prompt.length > PROMPT_PREVIEW_CHARS && (
                <button
                  type="button"
                  className="text-xs text-cyan-400 hover:text-cyan-300 mt-1"
                  onClick={() =>
                    onToggleExpand(isExpanded ? null : shotResult.shotIndex)
                  }
                >
                  {isExpanded ? "Collapse" : "Expand prompt"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostSummary({ job }: { job: BriefRenderJobView }) {
  return (
    <div className="text-sm text-zinc-400">
      Spec extraction cost so far:{" "}
      <span className="text-zinc-200 font-mono">
        ${job.costUsd.toFixed(3)}
      </span>
    </div>
  );
}
