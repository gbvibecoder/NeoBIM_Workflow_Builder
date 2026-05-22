"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, MapPin } from "lucide-react";

import { MonoLabel } from "@/features/result-page/components/aec/MonoLabel";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface DesignRationaleSectionProps {
  data: ResultPageData;
}

export function isDesignRationaleEligible(data: ResultPageData): boolean {
  return data.designRationale.length > 0;
}

export function DesignRationaleSection({ data }: DesignRationaleSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const reduce = useReducedMotion();
  const items = data.designRationale;

  return (
    <section data-testid="design-rationale-section">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          background: "#FFFFFF",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: expanded ? "12px 12px 0 0" : 12,
          cursor: "pointer",
          transition: "border-radius 200ms ease",
        }}
        data-testid="design-rationale-toggle"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MonoLabel>Design Decisions</MonoLabel>
          <span
            style={{
              fontSize: 12,
              color: "#64748B",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            }}
          >
            {items.length} placement{items.length === 1 ? "" : "s"}
          </span>
        </div>
        <ChevronDown
          size={16}
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms ease",
            color: "#64748B",
          }}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={reduce ? { opacity: 1 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid rgba(15,23,42,0.08)",
                borderTop: "none",
                borderRadius: "0 0 12px 12px",
                padding: "12px 20px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
              data-testid="design-rationale-items"
            >
              {items.map((item, i) => (
                <div
                  key={`rationale-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "#F8FAFC",
                  }}
                >
                  <MapPin
                    size={14}
                    style={{ color: "#2563EB", flexShrink: 0, marginTop: 2 }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#0F172A",
                          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                        }}
                      >
                        {item.itemId}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "#94A3B8",
                          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                        }}
                      >
                        [{item.position[0].toFixed(1)}, {item.position[1].toFixed(1)}, {item.position[2].toFixed(1)}]
                      </span>
                    </div>
                    <span style={{ fontSize: 13, color: "#334155", lineHeight: 1.4 }}>
                      {item.rationale}
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
