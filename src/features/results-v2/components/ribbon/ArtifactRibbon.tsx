"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, Box, Film, FileText, Image as ImageIcon, LayoutGrid, Table2 } from "lucide-react";
import { NEUTRAL } from "@/features/results-v2/constants";
import type { AccentGradient, PanelDescriptor } from "@/features/results-v2/types";
import type { RibbonEntry } from "@/features/results-v2/lib/artifact-grouping";

interface ArtifactRibbonProps {
  entries: RibbonEntry[];
  accent: AccentGradient;
  activeId: string | null;
  onSelect: (entry: RibbonEntry) => void;
  activePanel: PanelDescriptor["id"];
  /** Optional preview images keyed by ribbon entry id. */
  previews?: Record<string, string | undefined>;
}

const ICONS = {
  Film,
  Box,
  LayoutGrid,
  Table2,
  FileText,
  Image: ImageIcon,
  BarChart3,
} as const;

/**
 * Sticky artifact ribbon.
 *
 * Phase D upgrades:
 *   - Active chip: 4px upward lift + 32px accent-20 glow + inner top-edge highlight.
 *   - Hover: 120×80 thumbnail tooltip above the chip (when a preview is provided).
 *   - Scroll past hero: a soft drop-shadow fades in under the ribbon.
 *   - Mobile: scroll-snap type x mandatory + snap-align start on each chip.
 */
export function ArtifactRibbon({ entries, accent, activeId, onSelect, previews }: ArtifactRibbonProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    const threshold = 96;
    const onScroll = () => {
      const passed = window.scrollY > threshold;
      setScrolledPast(prev => (prev === passed ? prev : passed));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (entries.length === 0) return null;

  return (
    <nav
      aria-label="Generated artifacts"
      style={{
        position: "sticky",
        top: 56,
        zIndex: 30,
        background: "rgba(7,8,9,0.85)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderBottom: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        boxShadow: scrolledPast
          ? "0 10px 28px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04) inset"
          : "none",
        transition: "box-shadow 260ms ease-out",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "14px clamp(16px, 4vw, 32px)",
          overflowX: "auto",
          scrollbarWidth: "none",
          scrollSnapType: "x mandatory",
        }}
        className="results-v2-ribbon-scroll"
      >
        {entries.map(entry => {
          const Icon = ICONS[entry.iconName];
          const isActive = entry.id === activeId;
          const isHovered = hoverId === entry.id;
          const preview = previews?.[entry.id];
          return (
            <div
              key={entry.id}
              style={{ position: "relative", flexShrink: 0, scrollSnapAlign: "start" }}
              onMouseEnter={() => setHoverId(entry.id)}
              onMouseLeave={() => setHoverId(cur => (cur === entry.id ? null : cur))}
              onFocus={() => setHoverId(entry.id)}
              onBlur={() => setHoverId(cur => (cur === entry.id ? null : cur))}
            >
              <motion.button
                type="button"
                onClick={() => onSelect(entry)}
                whileTap={{ scale: 0.96 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                aria-pressed={isActive}
                aria-label={`Jump to ${entry.label}`}
                animate={{
                  y: isActive ? -4 : 0,
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                  color: isActive ? NEUTRAL.TEXT_PRIMARY : NEUTRAL.TEXT_SECONDARY,
                  background: isActive
                    ? `linear-gradient(180deg, ${accent.start}33 0%, ${accent.start}15 100%)`
                    : "rgba(255,255,255,0.04)",
                  border: `1px solid ${isActive ? accent.start : NEUTRAL.BORDER_SUBTLE}`,
                  boxShadow: isActive
                    ? `0 0 32px ${accent.start}3a, inset 0 1px 0 ${accent.start}88`
                    : "none",
                  cursor: "pointer",
                  transition:
                    "color 160ms ease-out, background 160ms ease-out, border-color 160ms ease-out, box-shadow 160ms ease-out",
                  fontFamily: "inherit",
                }}
              >
                <Icon size={14} aria-hidden />
                {entry.label}
              </motion.button>

              <AnimatePresence>
                {isHovered && preview ? (
                  <motion.div
                    role="tooltip"
                    initial={{ opacity: 0, y: 4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 10px)",
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 128,
                      height: 84,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: `1px solid ${accent.start}55`,
                      background: NEUTRAL.BG_BASE,
                      boxShadow: `0 12px 32px rgba(0,0,0,0.55), 0 0 24px ${accent.start}33`,
                      pointerEvents: "none",
                    }}
                  >
                    <Image
                      src={preview}
                      alt=""
                      fill
                      sizes="128px"
                      unoptimized
                      style={{ objectFit: "cover" }}
                    />
                    {/* Tail */}
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: "50%",
                        bottom: -5,
                        transform: "translateX(-50%) rotate(45deg)",
                        width: 8,
                        height: 8,
                        background: NEUTRAL.BG_BASE,
                        borderRight: `1px solid ${accent.start}55`,
                        borderBottom: `1px solid ${accent.start}55`,
                      }}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      <style>{`
        .results-v2-ribbon-scroll::-webkit-scrollbar { display: none; }
      `}</style>
    </nav>
  );
}
