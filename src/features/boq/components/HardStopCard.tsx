"use client";

import { AlertTriangle, RefreshCw, HelpCircle } from "lucide-react";

interface HardStopCardProps {
  reason: string;
  onRetry?: () => void;
}

export function HardStopCard({ reason, onRetry }: HardStopCardProps) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#FAFAF8",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          textAlign: "center",
          padding: 40,
          borderRadius: 16,
          background: "#FFFFFF",
          border: "1px solid rgba(220,38,38,0.15)",
          boxShadow: "0 4px 24px rgba(220,38,38,0.06)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "rgba(220,38,38,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <AlertTriangle size={28} color="#DC2626" />
        </div>

        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#111827",
            margin: "0 0 8px",
          }}
        >
          Estimate unavailable
        </h2>

        <p
          style={{
            fontSize: 13,
            color: "#6B7280",
            lineHeight: 1.6,
            margin: "0 0 8px",
          }}
        >
          We can&apos;t give you a reliable cost estimate right now.
        </p>

        <p
          style={{
            fontSize: 12,
            color: "#991B1B",
            lineHeight: 1.5,
            margin: "0 0 24px",
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(220,38,38,0.04)",
            borderLeft: "3px solid #DC2626",
            textAlign: "left",
          }}
        >
          {reason}
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 20px",
                borderRadius: 10,
                background: "#0D9488",
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={14} />
              Retry
            </button>
          )}
          <a
            href="mailto:support@trybuildflow.in"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 20px",
              borderRadius: 10,
              background: "#F3F4F6",
              color: "#374151",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            <HelpCircle size={14} />
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
