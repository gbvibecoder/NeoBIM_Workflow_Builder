"use client";

import { useMemo, useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface ElementCategoryCascadeProps {
  data: ResultPageData;
  cap?: number;
}

const CATEGORY_DEFS: ReadonlyArray<{ label: string; color: string; matches: ReadonlyArray<string> }> = [
  { label: "Walls", color: "#475569", matches: ["wall"] },
  { label: "Slabs", color: "#0EA5E9", matches: ["slab", "floor", "deck"] },
  { label: "Doors", color: "#B45309", matches: ["door"] },
  { label: "Windows", color: "#7C3AED", matches: ["window"] },
  { label: "Columns", color: "#0D9488", matches: ["column", "pillar"] },
  { label: "Beams", color: "#059669", matches: ["beam"] },
  { label: "MEP", color: "#A855F7", matches: ["pipe", "duct", "conduit", "mep"] },
];

interface ElementBucket {
  label: string;
  count: number;
  color: string;
}

/** Extract element-category counts from the IFC artifact's table data. */
function extractCategories(data: ResultPageData): ElementBucket[] {
  const ifcTable = data.tableData.find(t => {
    const lbl = t.label?.toLowerCase() ?? "";
    return lbl.includes("extracted quant") || lbl.includes("ifc") || lbl.includes("element");
  });
  const buckets = new Map<string, ElementBucket>();
  for (const def of CATEGORY_DEFS) buckets.set(def.label, { label: def.label, count: 0, color: def.color });

  if (ifcTable) {
    const headers = ifcTable.headers.map(h => h.toLowerCase());
    const catIdx = headers.findIndex(h => h.includes("categor") || h.includes("type") || h.includes("class"));
    const elemIdx = headers.findIndex(h => h.includes("element"));
    const idx = catIdx >= 0 ? catIdx : elemIdx >= 0 ? elemIdx : 0;
    for (const row of ifcTable.rows) {
      const txt = String(row[idx] ?? "").toLowerCase();
      if (!txt) continue;
      for (const def of CATEGORY_DEFS) {
        if (def.matches.some(m => txt.includes(m))) {
          const b = buckets.get(def.label);
          if (b) b.count += 1;
          break;
        }
      }
    }
  }

  // Fallback: derive from KPI metrics that mention element-y labels
  const total = Array.from(buckets.values()).reduce((s, b) => s + b.count, 0);
  if (total === 0) {
    for (const m of data.kpiMetrics) {
      const lbl = m.label.toLowerCase();
      const v = typeof m.value === "number" ? m.value : parseFloat(String(m.value).replace(/[, ]/g, ""));
      if (!Number.isFinite(v) || v <= 0) continue;
      for (const def of CATEGORY_DEFS) {
        if (def.matches.some(mm => lbl.includes(mm))) {
          const b = buckets.get(def.label);
          if (b) b.count += v;
          break;
        }
      }
    }
  }

  return Array.from(buckets.values()).filter(b => b.count > 0).sort((a, b) => b.count - a.count);
}

export function ElementCategoryCascade({ data, cap = 6 }: ElementCategoryCascadeProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const buckets = useMemo(() => extractCategories(data).slice(0, cap), [data, cap]);

  if (buckets.length === 0) return null;

  const STEP = 0.22;
  const baseDelay = 0.2;

  return (
    <div
      ref={ref}
      role="presentation"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 0,
        marginTop: 14,
        marginBottom: 6,
      }}
    >
      {buckets.map((bucket, i) => {
        const chipDelay = baseDelay + i * STEP;
        return (
          <span key={`${bucket.label}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
            {i > 0 ? (
              <motion.span
                aria-hidden="true"
                initial={reduce || !inView ? { width: 16 } : { width: 0 }}
                animate={inView ? { width: 16 } : undefined}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { delay: chipDelay - 0.05, duration: 0.16, ease: "easeOut" }
                }
                style={{
                  display: "inline-block",
                  height: 1,
                  background: bucket.color,
                  opacity: 0.45,
                  margin: "0 4px",
                }}
              />
            ) : null}
            <motion.span
              initial={
                reduce || !inView
                  ? { opacity: 1, scale: 1, y: 0 }
                  : { opacity: 0, scale: 0.88, y: 5 }
              }
              animate={inView ? { opacity: 1, scale: 1, y: 0 } : undefined}
              transition={
                reduce
                  ? { duration: 0 }
                  : {
                      delay: chipDelay,
                      duration: 0.4,
                      ease: [0.34, 1.56, 0.64, 1] as const,
                    }
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "5px 12px",
                borderRadius: 9999,
                background: "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.06)",
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                fontSize: 11,
                fontWeight: 600,
                color: "#0F172A",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              <span aria-hidden="true" style={{ position: "relative", display: "inline-flex", width: 7, height: 7 }}>
                <motion.span
                  initial={reduce || !inView ? { scale: 1 } : { scale: 0.4 }}
                  animate={inView ? (reduce ? { scale: 1 } : { scale: [0.4, 1.55, 1] }) : undefined}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          delay: chipDelay + 0.05,
                          duration: 0.45,
                          times: [0, 0.45, 1],
                          ease: "easeOut" as const,
                        }
                  }
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: 7,
                    height: 7,
                    borderRadius: 9999,
                    background: bucket.color,
                  }}
                />
                {!reduce ? (
                  <motion.span
                    aria-hidden="true"
                    initial={{ scale: 0, opacity: 0.5 }}
                    animate={inView ? { scale: 2.4, opacity: 0 } : undefined}
                    transition={{ delay: chipDelay + 0.05, duration: 0.45, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: 7,
                      height: 7,
                      borderRadius: 9999,
                      background: bucket.color,
                      pointerEvents: "none",
                    }}
                  />
                ) : null}
              </span>
              <span>{bucket.label}</span>
              <span style={{ color: "#94A3B8", fontWeight: 500, marginLeft: 2 }}>
                {bucket.count}
              </span>
            </motion.span>
          </span>
        );
      })}
    </div>
  );
}

export { extractCategories as __extractIfcCategories };
