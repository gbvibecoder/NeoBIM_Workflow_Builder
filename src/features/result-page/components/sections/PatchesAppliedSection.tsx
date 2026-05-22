"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, Wrench } from "lucide-react";

import { MonoLabel } from "@/features/result-page/components/aec/MonoLabel";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface Props { data: ResultPageData }

export function isPatchesAppliedEligible(data: ResultPageData): boolean {
  return (data.patchesApplied?.length ?? 0) > 0;
}

export function PatchesAppliedSection({ data }: Props) {
  const [expanded, setExpanded] = useState(false);
  const reduce = useReducedMotion();
  const items = data.patchesApplied ?? [];

  return (
    <section data-testid="patches-applied-section">
      <button type="button" onClick={() => setExpanded(!expanded)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "#FFFFFF", border: "1px solid rgba(15,23,42,0.08)", borderRadius: expanded ? "12px 12px 0 0" : 12, cursor: "pointer" }} data-testid="patches-applied-toggle">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MonoLabel>Patches Applied</MonoLabel>
          <span style={{ fontSize: 12, color: "#64748B", fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}>{items.length}</span>
        </div>
        <ChevronDown size={16} style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms", color: "#64748B" }} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={reduce ? { opacity: 1 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
            <div style={{ background: "#FFFFFF", border: "1px solid rgba(15,23,42,0.08)", borderTop: "none", borderRadius: "0 0 12px 12px", padding: "12px 20px 20px", display: "flex", flexDirection: "column", gap: 8 }} data-testid="patches-applied-items">
              {items.map((patch, i) => (
                <div key={`patch-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderRadius: 8, background: "#F8FAFC" }}>
                  <Wrench size={14} style={{ color: "#2563EB", flexShrink: 0, marginTop: 2 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", gap: 6, fontSize: 11, fontWeight: 600, color: "#2563EB", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}>
                      {patch.patch_type} <span style={{ color: "#94A3B8", fontWeight: 400 }}>{patch.item_id}</span>
                    </div>
                    <span style={{ fontSize: 13, color: "#334155" }}>{patch.rationale}</span>
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
