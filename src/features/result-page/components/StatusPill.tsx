"use client";

import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Loader2, XCircle } from "lucide-react";
import type { ResultLifecycle } from "@/features/result-page/hooks/useResultPageData";

interface StatusPillProps {
  lifecycle: ResultLifecycle;
  successNodes: number;
  totalNodes: number;
}

export function StatusPill({ lifecycle, successNodes, totalNodes }: StatusPillProps) {
  if (lifecycle === "loading") {
    return (
      <Pill bg="rgba(0,245,255,0.08)" border="rgba(0,245,255,0.25)" color="#00F5FF" iconColor="#00F5FF">
        <Loader2 size={11} className="result-pill-spin" />
        Loading…
      </Pill>
    );
  }
  if (lifecycle === "running") {
    return (
      <Pill bg="rgba(0,245,255,0.08)" border="rgba(0,245,255,0.25)" color="#00F5FF" iconColor="#00F5FF">
        <Loader2 size={11} className="result-pill-spin" />
        Running · {successNodes}/{totalNodes || "?"} nodes
      </Pill>
    );
  }
  if (lifecycle === "partial") {
    return (
      <Pill bg="rgba(253,203,110,0.08)" border="rgba(253,203,110,0.30)" color="#FDCB6E" iconColor="#FDCB6E">
        <AlertTriangle size={11} />
        Partial · {successNodes}/{totalNodes} nodes succeeded
      </Pill>
    );
  }
  if (lifecycle === "failed") {
    return (
      <Pill bg="rgba(239,68,68,0.10)" border="rgba(239,68,68,0.35)" color="#EF4444" iconColor="#EF4444">
        <XCircle size={11} />
        Failed
      </Pill>
    );
  }
  if (lifecycle === "not-found" || lifecycle === "forbidden") {
    return (
      <Pill bg="rgba(144,144,168,0.08)" border="rgba(144,144,168,0.25)" color="#9090A8" iconColor="#9090A8">
        <AlertTriangle size={11} />
        Unavailable
      </Pill>
    );
  }
  return (
    <motion.div
      initial={{ scale: 0.92 }}
      animate={{ scale: [1, 1.06, 1] }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{ display: "inline-flex" }}
    >
      <Pill bg="rgba(16,185,129,0.10)" border="rgba(16,185,129,0.35)" color="#10B981" iconColor="#10B981">
        <CheckCircle2 size={11} />
        Complete
      </Pill>
    </motion.div>
  );
}

function Pill({
  children,
  bg,
  border,
  color,
}: {
  children: React.ReactNode;
  bg: string;
  border: string;
  color: string;
  iconColor: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.01em",
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
