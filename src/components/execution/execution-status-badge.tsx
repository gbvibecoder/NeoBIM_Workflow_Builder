/**
 * `<ExecutionStatusBadge>` — pure presentational component that renders
 * a colored pill + label for a BriefToIfcV3Run status. Used in the v3
 * results page header and the diagnostic surfaces.
 *
 * Pure on purpose: no hooks, no fetches, no global state — easy to
 * test by mounting with each of the five status values.
 */

"use client";

import type { CSSProperties } from "react";

export type BriefToIfcV3StatusForBadge =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

interface BadgeStyle {
  bg: string;
  fg: string;
  label: string;
  /** ARIA-live region role: terminal states are `status`, RUNNING is
   *  `progressbar` so screen readers announce changes correctly. */
  role: "status" | "progressbar";
}

const STYLE_BY_STATUS: Record<BriefToIfcV3StatusForBadge, BadgeStyle> = {
  PENDING:   { bg: "#E5E7EB", fg: "#374151", label: "Queued",     role: "status"      },
  RUNNING:   { bg: "#DBEAFE", fg: "#1E40AF", label: "Running",    role: "progressbar" },
  COMPLETED: { bg: "#D1FAE5", fg: "#065F46", label: "Completed",  role: "status"      },
  FAILED:    { bg: "#FEE2E2", fg: "#991B1B", label: "Failed",     role: "status"      },
  CANCELLED: { bg: "#F3F4F6", fg: "#4B5563", label: "Cancelled",  role: "status"      },
};

export function ExecutionStatusBadge({
  status,
  size = "md",
  style,
}: {
  status: BriefToIfcV3StatusForBadge;
  size?: "sm" | "md";
  style?: CSSProperties;
}) {
  const s = STYLE_BY_STATUS[status];
  const padding = size === "sm" ? "2px 8px" : "4px 12px";
  const fontSize = size === "sm" ? 11 : 12;
  return (
    <span
      role={s.role}
      aria-label={`Execution status: ${s.label}`}
      data-testid={`execution-status-badge-${status}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding,
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize,
        fontWeight: 600,
        letterSpacing: "0.02em",
        fontFamily: "system-ui, -apple-system, sans-serif",
        ...style,
      }}
    >
      {status === "RUNNING" && (
        <span
          aria-hidden="true"
          style={{
            width: 6, height: 6, borderRadius: "50%",
            background: s.fg,
            animation: "execution-status-pulse 1.2s ease-in-out infinite",
          }}
        />
      )}
      {s.label}
      <style jsx>{`
        @keyframes execution-status-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </span>
  );
}
