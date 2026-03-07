"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import { WorkflowCanvas } from "@/components/canvas/WorkflowCanvas";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useUIStore } from "@/stores/ui-store";
import { useExecutionStore } from "@/stores/execution-store";
import { PREBUILT_WORKFLOWS_MAP } from "@/constants/prebuilt-workflows";
import { useLocale } from "@/hooks/useLocale";

const DEMO_PROMPT =
  "7-story mixed-use building in Berlin. Ground floor retail, modern apartments above. Nordic minimalist style with timber accents and green rooftop.";

export default function DemoPage() {
  const loadFromTemplate = useWorkflowStore((s) => s.loadFromTemplate);
  const nodes = useWorkflowStore((s) => s.nodes);
  const setDemoMode = useUIStore((s) => s.setDemoMode);
  const clearArtifacts = useExecutionStore((s) => s.clearArtifacts);
  const initialized = useRef(false);
  // Load WF-01 template and enable demo mode on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    setDemoMode(true);
    clearArtifacts();

    const template = PREBUILT_WORKFLOWS_MAP.get("wf-01");
    if (template) {
      loadFromTemplate(template);
    }

    return () => {
      setDemoMode(false);
    };
  }, [loadFromTemplate, setDemoMode, clearArtifacts]);

  // Pre-fill the prompt on the first input node once nodes are loaded
  useEffect(() => {
    if (nodes.length > 0) {
      const inputNode = nodes.find(
        (n) => n.data.catalogueId === "IN-001"
      );
      if (inputNode && !inputNode.data.inputValue) {
        useWorkflowStore.getState().updateNode(inputNode.id, {
          data: { ...inputNode.data, inputValue: DEMO_PROMPT },
        });
      }
    }
  }, [nodes]);

  const artifactCount = useExecutionStore((s) => s.artifacts.size);
  const hasRun = artifactCount > 0;

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#07070D",
      }}
    >
      {/* Demo Banner */}
      <DemoBanner hasRun={hasRun} />

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <WorkflowCanvas />
      </div>
    </div>
  );
}

// ─── Demo Banner ────────────────────────────────────────────────────────────

function DemoBanner({ hasRun }: { hasRun: boolean }) {
  const { t } = useLocale();
  return (
    <motion.div
      initial={{ y: -60 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 24px",
        background:
          "linear-gradient(90deg, rgba(79,138,255,0.08) 0%, rgba(139,92,246,0.05) 50%, rgba(79,138,255,0.04) 100%)",
        borderBottom: "1px solid rgba(79,138,255,0.15)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        zIndex: 100,
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          textDecoration: "none",
          marginRight: 8,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "linear-gradient(135deg, #4F8AFF, #6366F1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" style={{ width: 14, height: 14, filter: "brightness(0) invert(1)" }} />
        </div>
        <span
          style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F5" }}
        >
          BuildFlow
        </span>
      </Link>

      {/* Demo label */}
      <span
        style={{
          padding: "2px 8px",
          borderRadius: 4,
          background: "rgba(245,158,11,0.15)",
          border: "1px solid rgba(245,158,11,0.3)",
          fontSize: 10,
          fontWeight: 700,
          color: "#F59E0B",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {t('demo.liveDemo')}
      </span>

      <span
        style={{
          fontSize: 12,
          color: "#7C7C96",
          flex: 1,
          letterSpacing: "-0.005em",
        }}
      >
        {hasRun
          ? t('demo.complete')
          : t('demo.subtitle')}
      </span>

      {/* CTA */}
      <AnimatePresence mode="wait">
        {hasRun ? (
          <motion.div
            key="signup-cta"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{ display: "flex", gap: 8 }}
          >
            <Link
              href="/dashboard"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 16px",
                borderRadius: 8,
                background:
                  "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                color: "white",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
                boxShadow:
                  "0 2px 10px rgba(79,138,255,0.25), inset 0 1px 0 rgba(255,255,255,0.1)",
              }}
            >
              {t('demo.createFreeAccount')}
              <ArrowRight size={12} />
            </Link>
          </motion.div>
        ) : (
          <motion.div
            key="run-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 12px",
                borderRadius: 6,
                background: "rgba(16,185,129,0.1)",
                border: "1px solid rgba(16,185,129,0.2)",
                fontSize: 11,
                fontWeight: 600,
                color: "#10B981",
              }}
            >
              <Play size={10} fill="#10B981" />
              {t('demo.hitRun')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
