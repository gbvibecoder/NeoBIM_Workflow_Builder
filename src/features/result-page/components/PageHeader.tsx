"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { NorthArrow } from "@/features/result-page/components/aec/NorthArrow";
import { MonoLabel } from "@/features/result-page/components/aec/MonoLabel";
import { WorkflowTypeBadge } from "@/features/result-page/components/aec/WorkflowTypeBadge";
import { AnnotateButton } from "@/features/result-page/components/features/AnnotateButton";
import { SmartShareButton } from "@/features/result-page/components/features/SmartShareButton";
import { QualityFingerprint } from "@/features/result-page/components/features/QualityFingerprint";
import type { ResultLifecycle, ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface PageHeaderProps {
  data: ResultPageData;
  /** Initial saved note (read once on mount in the parent). */
  initialNote: string;
  /** Whether the workflow involves a floor plan — drives the NorthArrow render. */
  showNorthArrow: boolean;
  onNoteChange?: (note: string) => void;
}

/**
 * Phase 3 page header.
 *
 * Visual moves vs Phase 2:
 *  - Date renders in monospace ("technical metadata" feel).
 *  - Optional NorthArrow icon when the workflow involves a floor plan.
 *  - QualityFingerprint compact widget (STEPS · DURATION · ARTIFACTS).
 *  - SmartShareButton (deep-link share dropdown).
 *  - AnnotateButton (per-execution note).
 *  - User's saved note renders as an italic line under the title once written.
 */
export function PageHeader({ data, initialNote, showNorthArrow, onNoteChange }: PageHeaderProps) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote);
  const { projectTitle, workflowId, executionId, lifecycle, successNodes, totalNodes, executionMeta } = data;
  const startedAt = executionMeta.executedAt;

  const handleRunAgain = useCallback(() => {
    if (!workflowId) {
      toast.error("This run isn't tied to an editable workflow.");
      return;
    }
    try {
      sessionStorage.setItem("prefill-from-execution", executionId);
    } catch {
      // unavailable
    }
    router.push(`/dashboard/canvas?id=${workflowId}`);
  }, [workflowId, executionId, router]);

  const handleNoteChange = useCallback(
    (next: string) => {
      setNote(next);
      onNoteChange?.(next);
    },
    [onNoteChange],
  );

  const backHref = workflowId ? `/dashboard/canvas?id=${workflowId}` : "/dashboard/canvas";
  const dateLabel = startedAt
    ? formatDateMono(new Date(startedAt))
    : null;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
        borderBottom: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px clamp(16px, 3vw, 28px)",
          gap: 16,
        }}
      >
        {/* Left: back + title + meta */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
          <Link
            href={backHref}
            aria-label="Back to canvas"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: 9999,
              background: "#F8FAFC",
              border: "1px solid rgba(0,0,0,0.06)",
              color: "#475569",
              flexShrink: 0,
              textDecoration: "none",
              transition: "all 0.18s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "#F1F5F9";
              e.currentTarget.style.borderColor = "rgba(0,0,0,0.10)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "#F8FAFC";
              e.currentTarget.style.borderColor = "rgba(0,0,0,0.06)";
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </Link>

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {showNorthArrow ? <NorthArrow size={18} /> : <Building2 size={14} color="#0D9488" aria-hidden="true" />}
              <h1
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  color: "#0F172A",
                  letterSpacing: "-0.01em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFeatureSettings: "'ss01', 'cv01'",
                }}
              >
                {projectTitle}
              </h1>
              <WorkflowTypeBadge data={data} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <StatusPill lifecycle={lifecycle} successNodes={successNodes} totalNodes={totalNodes} />
              {dateLabel ? <MonoLabel size={11} color="#94A3B8">{dateLabel}</MonoLabel> : null}
              <QualityFingerprint data={data} />
            </div>
            {note ? (
              <p
                style={{
                  margin: 0,
                  marginTop: 4,
                  fontSize: 12,
                  fontStyle: "italic",
                  color: "#64748B",
                  maxWidth: 640,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-source-serif), Georgia, 'Times New Roman', serif",
                }}
                title={note}
              >
                &ldquo;{note}&rdquo;
              </p>
            ) : null}
          </div>
        </div>

        {/* Right: actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <AnnotateButton executionId={executionId} onChange={handleNoteChange} />
          {workflowId ? (
            <button
              type="button"
              onClick={handleRunAgain}
              title="Run this workflow again with the same inputs"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 10,
                background: "#FFFFFF",
                border: "1px solid rgba(13,148,136,0.32)",
                color: "#0D9488",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(13,148,136,0.05)",
                transition: "all 0.18s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "#F0FDFA";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "#FFFFFF";
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span className="result-hide-narrow">Run Again</span>
            </button>
          ) : null}
          <SmartShareButton data={data} />
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .result-hide-narrow { display: none; }
        }
      `}</style>
    </header>
  );
}

function formatDateMono(d: Date): string {
  const day = d.toLocaleString("en-IN", { day: "2-digit" });
  const month = d.toLocaleString("en-IN", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} · ${hh}:${mm}`;
}

function StatusPill({
  lifecycle,
  successNodes,
  totalNodes,
}: {
  lifecycle: ResultLifecycle;
  successNodes: number;
  totalNodes: number;
}) {
  if (lifecycle === "loading") {
    return (
      <Pill bg="#F0FDFA" color="#0D9488" border="rgba(13,148,136,0.20)">
        <Loader2 size={11} className="result-pill-spin" aria-hidden="true" />
        Reading the trail
      </Pill>
    );
  }
  if (lifecycle === "running") {
    return (
      <Pill bg="#F0FDFA" color="#0D9488" border="rgba(13,148,136,0.20)">
        <Loader2 size={11} className="result-pill-spin" aria-hidden="true" />
        Running · {successNodes}/{totalNodes || "?"}
      </Pill>
    );
  }
  if (lifecycle === "partial") {
    return (
      <Pill bg="#FEF3C7" color="#B45309" border="rgba(217,119,6,0.22)">
        <AlertTriangle size={11} aria-hidden="true" />
        {successNodes}/{totalNodes} steps · see below
      </Pill>
    );
  }
  if (lifecycle === "failed") {
    return (
      <Pill bg="#FEE2E2" color="#B91C1C" border="rgba(220,38,38,0.20)">
        <XCircle size={11} aria-hidden="true" />
        Did not complete
      </Pill>
    );
  }
  if (lifecycle === "not-found" || lifecycle === "forbidden") {
    return (
      <Pill bg="#F1F5F9" color="#64748B" border="rgba(0,0,0,0.06)">
        Unavailable
      </Pill>
    );
  }
  return (
    <Pill bg="#ECFDF5" color="#047857" border="rgba(5,150,105,0.20)">
      <CheckCircle2 size={11} aria-hidden="true" />
      Complete
    </Pill>
  );
}

function Pill({
  children,
  bg,
  color,
  border,
}: {
  children: React.ReactNode;
  bg: string;
  color: string;
  border: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color,
        border: `1px solid ${border}`,
      }}
    >
      {children}
      <style>{`
        .result-pill-spin {
          animation: result-pill-spin 0.9s linear infinite;
        }
        @keyframes result-pill-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </span>
  );
}
