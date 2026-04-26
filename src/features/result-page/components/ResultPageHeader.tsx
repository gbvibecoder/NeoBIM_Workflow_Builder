"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ArrowLeft, RefreshCw, Share2, Check } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/features/result-page/components/StatusPill";
import type { ResultLifecycle } from "@/features/result-page/hooks/useResultPageData";

interface ResultPageHeaderProps {
  projectTitle: string;
  workflowId: string | null;
  executionId: string;
  lifecycle: ResultLifecycle;
  successNodes: number;
  totalNodes: number;
}

export function ResultPageHeader({
  projectTitle,
  workflowId,
  executionId,
  lifecycle,
  successNodes,
  totalNodes,
}: ResultPageHeaderProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const handleRunAgain = useCallback(() => {
    if (!workflowId) {
      toast.error("This run isn't tied to a workflow we can re-open.");
      return;
    }
    // TODO: Phase 2 — canvas prefill from sessionStorage
    try {
      sessionStorage.setItem("prefill-from-execution", executionId);
    } catch {
      // sessionStorage may be unavailable; canvas will just open the workflow without prefill
    }
    router.push(`/dashboard/canvas?id=${workflowId}`);
  }, [workflowId, executionId, router]);

  const handleShare = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard may be denied — fall through
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
    toast.success("Link copied");
  }, []);

  const backHref = workflowId ? `/dashboard/canvas?id=${workflowId}` : "/dashboard/canvas";

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px clamp(12px, 3vw, 28px)",
        background: "rgba(7,8,9,0.85)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
        minHeight: 56,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
        <Link
          href={backHref}
          aria-label="Back to canvas"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(245,245,250,0.92)",
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <ArrowLeft size={13} aria-hidden="true" />
          <span className="hide-on-narrow">Back to Canvas</span>
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "#F5F5FA",
              letterSpacing: "-0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {projectTitle}
          </h1>
          <StatusPill lifecycle={lifecycle} successNodes={successNodes} totalNodes={totalNodes} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {workflowId ? (
          <button
            type="button"
            onClick={handleRunAgain}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: 8,
              background: "rgba(0,245,255,0.10)",
              border: "1px solid rgba(0,245,255,0.32)",
              color: "#00F5FF",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={13} aria-hidden="true" />
            <span className="hide-on-narrow">Run Again</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleShare}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(245,245,250,0.85)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Share2 size={13} aria-hidden="true" />}
          <span className="hide-on-narrow">{copied ? "Copied" : "Share"}</span>
        </button>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .hide-on-narrow { display: none; }
        }
      `}</style>
    </header>
  );
}
