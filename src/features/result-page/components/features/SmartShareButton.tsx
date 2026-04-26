"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, Check, Link as LinkIcon, Calculator, PenTool, Box } from "lucide-react";
import { toast } from "sonner";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface SmartShareButtonProps {
  data: ResultPageData;
}

interface ShareOption {
  id: string;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  pathSuffix: string;
}

/**
 * Phase 3 functional addition · "Send the result, not the wrapper."
 *
 * Replaces the plain "Copy link" with a small dropdown that lets the user
 * copy a URL that *deep-links into the dedicated visualizer* relevant to
 * this run. The receiver lands on the BOQ Visualizer (or Floor Plan Editor
 * or IFC Viewer) directly — no wrapper click needed.
 */
export function SmartShareButton({ data }: SmartShareButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Click-outside
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const wrapperPath = `/dashboard/results/${data.executionId}`;

  const options: ShareOption[] = [
    {
      id: "wrapper",
      label: "This page",
      sublabel: "The result wrapper — context plus deep links",
      icon: <LinkIcon size={14} aria-hidden="true" />,
      pathSuffix: "",
    },
  ];

  if (data.boqSummary) {
    options.push({
      id: "boq",
      label: "BOQ Visualizer",
      sublabel: "Recipient lands on the cost estimate directly",
      icon: <Calculator size={14} aria-hidden="true" />,
      pathSuffix: "/boq",
    });
  }
  if (
    data.model3dData?.kind === "floor-plan-interactive" ||
    data.model3dData?.kind === "floor-plan-editor"
  ) {
    options.push({
      id: "editor",
      label: "Floor Plan Editor",
      sublabel: "Opens the editable CAD project in a new tab",
      icon: <PenTool size={14} aria-hidden="true" />,
      pathSuffix: "?open=editor",
    });
  }
  if (data.fileDownloads.some(f => f.name.toLowerCase().endsWith(".ifc"))) {
    options.push({
      id: "ifc",
      label: "IFC Viewer",
      sublabel: "Hands the model straight to the BIM viewer",
      icon: <Box size={14} aria-hidden="true" />,
      pathSuffix: "?open=ifc",
    });
  }

  const buildLink = (opt: ShareOption): string => {
    if (!opt.pathSuffix) return `${origin}${wrapperPath}`;
    if (opt.pathSuffix.startsWith("?")) {
      return `${origin}${wrapperPath}${opt.pathSuffix}`;
    }
    return `${origin}${wrapperPath}${opt.pathSuffix}`;
  };

  const handleCopy = (opt: ShareOption) => {
    const url = buildLink(opt);
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopiedId(opt.id);
        toast.success(`Link copied · ${opt.label}`);
        setTimeout(() => setCopiedId(null), 2000);
        setTimeout(() => setOpen(false), 600);
      })
      .catch(() => {
        toast.error("Couldn't copy. Try again, or use ⌘C on the URL.");
      });
  };

  // Single-option fallback (rare): just a plain "copy link" button
  if (options.length === 1) {
    return (
      <button
        type="button"
        onClick={() => handleCopy(options[0])}
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
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "#0F766E";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "#0D9488";
        }}
      >
        {copiedId ? <Check size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}
        <span className="result-hide-narrow">{copiedId ? "Copied" : "Share"}</span>
      </button>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
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
          transition: "background 0.18s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "#0F766E";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "#0D9488";
        }}
      >
        <Share2 size={14} aria-hidden="true" />
        <span className="result-hide-narrow">Share</span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              zIndex: 50,
              width: "min(92vw, 320px)",
              background: "#FFFFFF",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 14,
              boxShadow: "0 12px 32px rgba(15,23,42,0.10)",
              padding: 6,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                fontSize: 10,
                fontWeight: 600,
                color: "#94A3B8",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                padding: "8px 10px 6px",
              }}
            >
              Send link to · choose surface
            </div>
            {options.map(opt => {
              const isCopied = copiedId === opt.id;
              return (
                <button
                  key={opt.id}
                  role="menuitem"
                  type="button"
                  onClick={() => handleCopy(opt)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "10px 10px",
                    borderRadius: 10,
                    background: "transparent",
                    border: "none",
                    color: "#0F172A",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "#F8FAFC";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "#F0FDFA",
                      color: "#0D9488",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {isCopied ? <Check size={14} aria-hidden="true" /> : opt.icon}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{opt.label}</span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "#64748B",
                        marginTop: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {opt.sublabel}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                      fontSize: 10,
                      color: "#94A3B8",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {isCopied ? "COPIED" : "COPY"}
                  </span>
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
