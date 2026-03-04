"use client";

import { useMemo } from "react";
import { Check, ArrowRight } from "lucide-react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useExecutionStore } from "@/stores/execution-store";

// Detect if any input node has data
function hasInputData(nodes: ReturnType<typeof useWorkflowStore.getState>["nodes"]) {
  return nodes.some(n => {
    const cat = n.data.category;
    const val = n.data.inputValue as string | undefined;
    return cat === "input" && val && val.trim().length > 0;
  });
}

type StepStatus = "future" | "active" | "complete";

interface Step {
  num: number;
  label: string;
  sublabel: string;
  status: StepStatus;
}

export function StepIndicator() {
  const nodes = useWorkflowStore(s => s.nodes);
  const edges = useWorkflowStore(s => s.edges);
  const isExecuting = useExecutionStore(s => s.isExecuting);
  const currentExecution = useExecutionStore(s => s.currentExecution);
  const progress = useExecutionStore(s => s.executionProgress);

  const steps: Step[] = useMemo(() => {
    const hasNodes = nodes.length >= 2;
    const hasEdges = edges.length >= 1;
    const step1Complete = hasNodes && hasEdges;
    const step2Complete = step1Complete && hasInputData(nodes);
    const step3Complete = !!currentExecution && currentExecution.status !== "running";

    return [
      {
        num: 1,
        label: "Build your workflow",
        sublabel: step1Complete ? "Ready" : "Drag nodes & connect them",
        status: step1Complete ? "complete" : "active",
      },
      {
        num: 2,
        label: "Add your data",
        sublabel: step2Complete ? "Ready" : "Fill in input nodes",
        status: step1Complete
          ? step2Complete ? "complete" : "active"
          : "future",
      },
      {
        num: 3,
        label: isExecuting ? `Running… ${progress}%` : step3Complete ? "Complete ✓" : "Run",
        sublabel: step3Complete && !isExecuting
          ? `${Array.from(useExecutionStore.getState().artifacts.values()).length} artifacts`
          : "Click Run to execute",
        status: step2Complete
          ? step3Complete ? "complete" : "active"
          : "future",
      },
    ];
  }, [nodes, edges, isExecuting, currentExecution, progress]);

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: 40, borderBottom: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(18,18,30,0.7)", backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      gap: 0, zIndex: 10, position: "relative",
    }}>
      {steps.map((step, i) => (
        <div key={step.num} style={{ display: "flex", alignItems: "center" }}>
          {/* Step */}
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "0 14px",
            opacity: step.status === "future" ? 0.4 : 1,
          }}>
            {/* Number / check circle */}
            <div style={{
              width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: step.status === "complete"
                ? "#10B981"
                : step.status === "active"
                  ? "#4F8AFF"
                  : "rgba(255,255,255,0.08)",
              border: step.status === "future" ? "1px solid rgba(255,255,255,0.12)" : "none",
              fontSize: 9, fontWeight: 700, color: "#fff",
              transition: "background 0.3s",
            }}>
              {step.status === "complete"
                ? <Check size={10} strokeWidth={3} />
                : step.num
              }
            </div>

            {/* Label */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: step.status === "active" ? 600 : 400,
                color: step.status === "active"
                  ? "#F0F0F5"
                  : step.status === "complete"
                    ? "#10B981"
                    : "#5C5C78",
                whiteSpace: "nowrap",
                animation: step.status === "active" && step.num === 3
                  ? "stepPulse 2s ease-in-out infinite"
                  : "none",
              }}>
                {step.label}
              </div>
              <div style={{ fontSize: 9, color: "#3A3A50", whiteSpace: "nowrap" }}>
                {step.sublabel}
              </div>
            </div>
          </div>

          {/* Arrow connector */}
          {i < steps.length - 1 && (
            <ArrowRight size={11} style={{ color: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
          )}
        </div>
      ))}

      <style>{`
        @keyframes stepPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes pulseInputBorder {
          0%, 100% { border-color: rgba(79,138,255,0.3); }
          50% { border-color: rgba(79,138,255,0.7); }
        }
      `}</style>
    </div>
  );
}
