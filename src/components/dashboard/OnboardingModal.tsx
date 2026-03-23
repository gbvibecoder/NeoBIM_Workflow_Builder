"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Workflow, Layout, ArrowRight, X } from "lucide-react";

const STORAGE_KEY = "buildflow_dashboard_onboarded";

const STEPS = [
  {
    icon: Sparkles,
    color: "#4F8AFF",
    title: "Welcome to BuildFlow",
    desc: "Your no-code platform for automating AEC workflows — from briefs to renders, BOQs to 3D models.",
    detail: "Drag nodes onto a canvas, connect them, and hit Run.",
  },
  {
    icon: Workflow,
    color: "#10B981",
    title: "Start with a template",
    desc: "Choose from ready-made workflows to generate massing models, concept renders, or cost reports in minutes.",
    detail: "Templates are pre-configured — just upload your brief or IFC file.",
  },
  {
    icon: Layout,
    color: "#8B5CF6",
    title: "Build your own workflow",
    desc: "Combine 30+ AI-powered nodes to create custom pipelines tailored to your project needs.",
    detail: "Open the canvas, drag nodes from the library, connect inputs to outputs, and run.",
  },
];

export function OnboardingModal() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem(STORAGE_KEY)) {
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }, []);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      dismiss();
      router.push("/dashboard/templates");
    }
  }, [step, dismiss, router]);

  if (!visible) return null;

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: "fixed", inset: 0, zIndex: 500,
            background: "rgba(7,7,13,0.85)", backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{
              width: "100%", maxWidth: 460,
              background: "#111120", borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.06)",
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(79,138,255,0.05)",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "14px 20px",
              background: `linear-gradient(135deg, ${current.color}12, ${current.color}05)`,
              borderBottom: `1px solid ${current.color}15`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: current.color, boxShadow: `0 0 8px ${current.color}` }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: current.color, textTransform: "uppercase", letterSpacing: "1.5px" }}>
                  Step {step + 1} of {STEPS.length}
                </span>
              </div>
              <button
                onClick={dismiss}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#5C5C78", display: "flex", padding: 4,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                style={{ padding: "32px 28px 24px" }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: `${current.color}12`,
                  border: `1px solid ${current.color}20`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 20, color: current.color,
                }}>
                  <Icon size={26} strokeWidth={1.5} />
                </div>

                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#F0F0F5", marginBottom: 8, letterSpacing: "-0.02em" }}>
                  {current.title}
                </h2>
                <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.65, marginBottom: 12 }}>
                  {current.desc}
                </p>
                <div style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                  fontSize: 12.5, color: "#7C7C96", lineHeight: 1.5,
                }}>
                  {current.detail}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Footer */}
            <div style={{
              padding: "16px 28px 24px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              {/* Step dots */}
              <div style={{ display: "flex", gap: 6 }}>
                {STEPS.map((_, i) => (
                  <div key={i} style={{
                    width: i === step ? 20 : 6, height: 6, borderRadius: 3,
                    background: i === step ? current.color : "rgba(255,255,255,0.08)",
                    transition: "all 0.3s ease",
                  }} />
                ))}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={dismiss}
                  style={{
                    padding: "9px 16px", borderRadius: 10,
                    background: "transparent", border: "1px solid rgba(255,255,255,0.06)",
                    color: "#7C7C96", fontSize: 13, fontWeight: 500, cursor: "pointer",
                  }}
                >
                  Skip
                </button>
                <button
                  onClick={handleNext}
                  style={{
                    padding: "9px 20px", borderRadius: 10,
                    background: `linear-gradient(135deg, ${current.color}, ${current.color}CC)`,
                    border: "none", color: "#fff", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                    boxShadow: `0 0 16px ${current.color}30`,
                  }}
                >
                  {step < STEPS.length - 1 ? "Next" : "Explore Templates"}
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
