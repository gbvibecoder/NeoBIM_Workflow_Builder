"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import {
  shareExecutionToTwitter,
} from "@/lib/share";

// Inline SVG icons to avoid heavy lucide imports for brand marks
function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

interface ExecutionCompleteModalProps {
  workflowName: string;
  nodeCount: number;
  artifactCount: number;
  durationText: string;
  onViewResults: () => void;
}

export function ExecutionCompleteModal({
  workflowName,
  nodeCount,
  artifactCount,
  durationText,
  onViewResults,
}: ExecutionCompleteModalProps) {
  const { showExecutionCompleteModal, setShowExecutionCompleteModal } = useUIStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (showExecutionCompleteModal) {
      timerRef.current = setTimeout(() => setShowExecutionCompleteModal(false), 8000);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
  }, [showExecutionCompleteModal, setShowExecutionCompleteModal]);

  const close = () => setShowExecutionCompleteModal(false);

  const handleViewResults = () => {
    close();
    onViewResults();
  };

  return (
    <AnimatePresence>
      {showExecutionCompleteModal && (
        <motion.div
          key="exec-complete-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            background: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#12121E",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 20,
              padding: "36px 32px 28px",
              maxWidth: 420,
              width: "100%",
              textAlign: "center",
              boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
            }}
          >
            {/* Success icon with pulse */}
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 20,
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.20)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
                animation: "celebratePulse 2s ease-in-out infinite",
              }}
            >
              <CheckCircle2 size={32} style={{ color: "#34D399" }} />
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#F0F0F5", marginBottom: 6 }}>
              Workflow Complete!
            </h2>
            <p style={{ fontSize: 13, color: "#8888A0", marginBottom: 16 }}>
              Your concept was generated in {durationText}
            </p>

            {/* Summary pills */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 24 }}>
              <span style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: "rgba(79,138,255,0.10)", border: "1px solid rgba(79,138,255,0.20)",
                color: "#4F8AFF",
              }}>
                {nodeCount} steps executed
              </span>
              <span style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.20)",
                color: "#10B981",
              }}>
                {artifactCount} outputs
              </span>
            </div>

            {/* Primary action */}
            <button
              onClick={handleViewResults}
              style={{
                width: "100%",
                padding: "11px 0",
                borderRadius: 12,
                background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                border: "none",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                marginBottom: 10,
                transition: "filter 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = "brightness(1)"; }}
            >
              View Results
            </button>

            {/* Share row */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => shareExecutionToTwitter(workflowName, nodeCount)}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "9px 0",
                  borderRadius: 10,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#9898B0",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.color = "#F0F0F5";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#9898B0";
                }}
              >
                <XIcon /> Share on X
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Pulse animation for success icon */}
      <style jsx global>{`
        @keyframes celebratePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.2); }
          50% { box-shadow: 0 0 0 12px rgba(16,185,129,0); }
        }
      `}</style>
    </AnimatePresence>
  );
}
