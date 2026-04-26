"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Share2,
  Check,
  Building2,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { ResultLifecycle } from "@/features/result-page/hooks/useResultPageData";

interface PageHeaderProps {
  projectTitle: string;
  workflowId: string | null;
  executionId: string;
  lifecycle: ResultLifecycle;
  successNodes: number;
  totalNodes: number;
  startedAt: string | null;
}

/**
 * Sticky white header in BOQ-visualizer aesthetic. No dark glass, no jargon.
 * Status pill is gentle: green Complete, amber "X/Y steps · view details"
 * for partial, never the alarming red pill from Phase 1.
 */
export function PageHeader({
  projectTitle,
  workflowId,
  executionId,
  lifecycle,
  successNodes,
  totalNodes,
  startedAt,
}: PageHeaderProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const handleRunAgain = useCallback(() => {
    if (!workflowId) {
      toast.error("This run isn't tied to an editable workflow.");
      return;
    }
    try {
      sessionStorage.setItem("prefill-from-execution", executionId);
    } catch {
      // sessionStorage may be unavailable
    }
    router.push(`/dashboard/canvas?id=${workflowId}`);
  }, [workflowId, executionId, router]);

  const handleShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Permission denied — fall through silently
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
    toast.success("Link copied", { description: "Share this result with your team." });
  }, []);

  const backHref = workflowId ? `/dashboard/canvas?id=${workflowId}` : "/dashboard/canvas";
  const dateLabel = startedAt
    ? new Date(startedAt).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 24px",
        background: "#FFFFFF",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        gap: 16,
      }}
    >
      {/* Left: back + project info */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0, flex: 1 }}>
        <Link
          href={backHref}
          aria-label="Back to canvas"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 9999,
            background: "#F9FAFB",
            border: "1px solid rgba(0,0,0,0.06)",
            color: "#4B5563",
            flexShrink: 0,
            textDecoration: "none",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "#F3F4F6";
            e.currentTarget.style.borderColor = "rgba(0,0,0,0.10)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "#F9FAFB";
            e.currentTarget.style.borderColor = "rgba(0,0,0,0.06)";
          }}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </Link>

        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Building2 size={14} color="#0D9488" aria-hidden="true" />
            <h1
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#111827",
                letterSpacing: "-0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {projectTitle}
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
            <StatusPill lifecycle={lifecycle} successNodes={successNodes} totalNodes={totalNodes} />
            {dateLabel ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#6B7280" }}>
                <Calendar size={11} aria-hidden="true" />
                {dateLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Right: actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {workflowId ? (
          <button
            type="button"
            onClick={handleRunAgain}
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
              transition: "all 0.2s",
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
        <button
          type="button"
          onClick={handleShare}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 10,
            background: "#0D9488",
            border: "none",
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "#0F766E";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "#0D9488";
          }}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}
          <span className="result-hide-narrow">{copied ? "Copied" : "Share"}</span>
        </button>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .result-hide-narrow { display: none; }
        }
      `}</style>
    </header>
  );
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
        Loading
      </Pill>
    );
  }
  if (lifecycle === "running") {
    return (
      <Pill bg="#F0FDFA" color="#0D9488" border="rgba(13,148,136,0.20)">
        <Loader2 size={11} className="result-pill-spin" aria-hidden="true" />
        Running · {successNodes}/{totalNodes || "?"} steps
      </Pill>
    );
  }
  if (lifecycle === "partial") {
    // Gentle amber per P6 — not the alarming red pill.
    return (
      <Pill bg="#FEF3C7" color="#D97706" border="rgba(217,119,6,0.22)">
        <AlertTriangle size={11} aria-hidden="true" />
        {successNodes}/{totalNodes} steps · view details below
      </Pill>
    );
  }
  if (lifecycle === "failed") {
    // Calm red — this is the only place red appears, and only for full failures.
    return (
      <Pill bg="#FEE2E2" color="#DC2626" border="rgba(220,38,38,0.20)">
        <XCircle size={11} aria-hidden="true" />
        Did not complete
      </Pill>
    );
  }
  if (lifecycle === "not-found" || lifecycle === "forbidden") {
    return (
      <Pill bg="#F3F4F6" color="#6B7280" border="rgba(0,0,0,0.06)">
        Unavailable
      </Pill>
    );
  }
  return (
    <Pill bg="#ECFDF5" color="#059669" border="rgba(5,150,105,0.20)">
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
