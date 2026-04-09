"use client";

import { motion } from "framer-motion";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { COLORS, CATEGORY_COLORS } from "@/components/canvas/result-showcase/constants";
import type { PipelineStep } from "@/components/canvas/result-showcase/useShowcaseData";

interface PipelineVizProps {
  steps: PipelineStep[];
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 size={10} style={{ color: COLORS.EMERALD }} />,
  error: <XCircle size={10} style={{ color: "#EF4444" }} />,
  running: <Loader2 size={10} className="animate-spin" style={{ color: COLORS.CYAN }} />,
};

export function PipelineViz({ steps }: PipelineVizProps) {
  const { t } = useLocale();
  if (steps.length === 0) return null;

  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{
        fontSize: 9,
        fontWeight: 600,
        color: COLORS.TEXT_MUTED,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: 10,
      }}>
        {t('showcase.pipelineTitle')}
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        overflowX: "auto",
        paddingBottom: 4,
      }}>
        {steps.map((step, i) => {
          const catColor = CATEGORY_COLORS[step.category] ?? COLORS.TEXT_MUTED;

          return (
            <motion.div
              key={step.nodeId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i }}
              style={{ display: "flex", alignItems: "center" }}
            >
              {/* Node dot + label */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 56,
                }}
              >
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: `${catColor}18`,
                  border: `1.5px solid ${catColor}50`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {STATUS_ICON[step.status] ?? (
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: COLORS.TEXT_MUTED,
                    }} />
                  )}
                </div>
                <span style={{
                  fontSize: 8,
                  color: COLORS.TEXT_MUTED,
                  textAlign: "center",
                  lineHeight: 1.2,
                  maxWidth: 64,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {i < steps.length - 1 && (
                <div style={{
                  width: 20,
                  height: 1.5,
                  background: step.status === "success"
                    ? `linear-gradient(90deg, ${catColor}60, ${CATEGORY_COLORS[steps[i + 1]?.category] ?? COLORS.TEXT_MUTED}60)`
                    : `${COLORS.TEXT_MUTED}30`,
                  marginTop: -16,
                  flexShrink: 0,
                }} />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
