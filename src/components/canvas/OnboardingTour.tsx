"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const STORAGE_KEY = "buildflow_onboarded";

const STEPS = [
  {
    title: "Your node library",
    body: "30+ design nodes organized by category — Input, Transform, Generate, and Export. Drag any node onto the canvas to start building.",
    hint: "← Drag nodes from here",
  },
  {
    title: "Or use AI",
    body: "Click the ✨ AI button in the toolbar to describe your workflow in plain English. Try: \"Generate concept images from a text description.\"",
    hint: "↑ AI Prompt button",
  },
  {
    title: "Input nodes are special",
    body: "Blue input nodes have text fields and file uploaders built right in. Type your brief, upload a PDF or IFC file — this is where YOUR data enters the workflow.",
    hint: "Look for blue nodes with INPUT badge",
  },
  {
    title: "Click Run to execute",
    body: "Once your workflow is connected and inputs are filled, click the Run button. Watch each node light up and produce real results — descriptions, images, cost estimates, and files.",
    hint: "↑ Run button in toolbar",
  },
];

export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem(STORAGE_KEY)) {
      // Small delay so canvas renders first
      const t = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, "1");
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else dismiss();
  };

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Dark overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0, zIndex: 100,
              background: "rgba(0,0,0,0.55)",
              pointerEvents: "none",
            }}
          />

          {/* Tooltip card */}
          <motion.div
            key={step}
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            style={{
              position: "fixed",
              bottom: 80, left: "50%", transform: "translateX(-50%)",
              zIndex: 101, width: 340,
              background: "rgba(7,8,9,0.92)", border: "1px solid rgba(184,115,51,0.15)",
              borderRadius: 4, padding: "18px 20px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
              pointerEvents: "all",
            }}
          >
            {/* Close */}
            <button
              onClick={dismiss}
              style={{
                position: "absolute", top: 12, right: 12,
                background: "none", border: "none", cursor: "pointer",
                color: "#3A3A4E", padding: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#3A3A4E"; }}
            >
              <X size={13} />
            </button>

            {/* Step number */}
            <div style={{ fontSize: 10, color: "#00F5FF", fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>
              STEP {step + 1} OF {STEPS.length}
            </div>

            {/* Title */}
            <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F5", marginBottom: 8 }}>
              {STEPS[step].title}
            </div>

            {/* Body */}
            <div style={{ fontSize: 12, color: "#8888A0", lineHeight: 1.6, marginBottom: 14 }}>
              {STEPS[step].body}
            </div>

            {/* Hint */}
            <div style={{
              fontSize: 10, color: "#00F5FF", padding: "5px 8px",
              background: "rgba(0,245,255,0.07)", borderRadius: 6,
              border: "1px solid rgba(0,245,255,0.15)", marginBottom: 16,
            }}>
              {STEPS[step].hint}
            </div>

            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              {/* Dots */}
              <div style={{ display: "flex", gap: 5 }}>
                {STEPS.map((_, i) => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: i === step ? "#00F5FF" : "#1E1E2E",
                    transition: "background 0.2s",
                  }} />
                ))}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={dismiss}
                  style={{
                    fontSize: 11, color: "#55556A", background: "none",
                    border: "none", cursor: "pointer", padding: "4px 8px",
                  }}
                >
                  Skip tour
                </button>
                <button
                  onClick={next}
                  style={{
                    padding: "6px 14px", borderRadius: 7, border: "none",
                    background: "#00F5FF", color: "#fff",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {step < STEPS.length - 1 ? "Next →" : "Let's build →"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Export for settings page to restart the tour
export function restartOnboardingTour() {
  if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
}
