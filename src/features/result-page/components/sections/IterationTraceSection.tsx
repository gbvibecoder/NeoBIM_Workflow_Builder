"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, Trophy } from "lucide-react";

import { MonoLabel } from "@/features/result-page/components/aec/MonoLabel";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface Props { data: ResultPageData }

export function isIterationTraceEligible(data: ResultPageData): boolean {
  return (data.iterationTrace?.length ?? 0) > 1;
}

export function IterationTraceSection({ data }: Props) {
  const [expanded, setExpanded] = useState(false);
  const reduce = useReducedMotion();
  const items = data.iterationTrace ?? [];
  const best = data.bestIteration ?? 1;

  return (
    <section data-testid="iteration-trace-section">
      <button type="button" onClick={() => setExpanded(!expanded)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "#FFFFFF", border: "1px solid rgba(15,23,42,0.08)", borderRadius: expanded ? "12px 12px 0 0" : 12, cursor: "pointer" }} data-testid="iteration-trace-toggle">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MonoLabel>Build Iterations</MonoLabel>
          <span style={{ fontSize: 12, color: "#64748B", fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}>{items.length} run{items.length === 1 ? "" : "s"}</span>
        </div>
        <ChevronDown size={16} style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms", color: "#64748B" }} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={reduce ? { opacity: 1 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
            <div style={{ background: "#FFFFFF", border: "1px solid rgba(15,23,42,0.08)", borderTop: "none", borderRadius: "0 0 12px 12px", padding: "12px 20px 20px", display: "flex", flexDirection: "column", gap: 8 }} data-testid="iteration-trace-items">
              {items.map((it, i) => (
                <div key={`iter-${i}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, background: it.iteration === best ? "#F0FDF4" : "#F8FAFC", border: it.iteration === best ? "1px solid #86EFAC" : "1px solid transparent" }}>
                  {it.iteration === best && <Trophy size={14} style={{ color: "#16A34A", flexShrink: 0 }} />}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A", fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}>Iteration {it.iteration}</span>
                      {it.iteration === best && <span data-testid="best-badge" style={{ fontSize: 10, fontWeight: 700, color: "#16A34A", background: "#DCFCE7", padding: "1px 6px", borderRadius: 4, letterSpacing: "0.05em" }}>BEST</span>}
                    </div>
                    <span style={{ fontSize: 12, color: "#64748B", fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}>
                      Quality: {it.qualityScore} | Parts: {((it.partsCoverage ?? 0) * 100).toFixed(0)}% | Entities: {it.entityCount} | {((it.elapsedMs ?? 0) / 1000).toFixed(1)}s
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
