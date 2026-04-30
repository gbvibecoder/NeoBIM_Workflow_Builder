"use client";

import Link from "next/link";
import { ArrowRight, Calculator, PenTool, Box, Film, Image as ImageIcon } from "lucide-react";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { SectionHeader } from "@/features/result-page/components/sections/SectionHeader";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface DedicatedVisualizerEntriesProps {
  data: ResultPageData;
  /** Phase 4.1 Fix 3 — orchestrator-allocated section number, derived from rendered sections (no skips). */
  index: number;
}

/** Phase 4.1 Fix 3 eligibility predicate — used by the orchestrator to allocate indices. */
export function isDedicatedVisualizerEntriesEligible(data: ResultPageData): boolean {
  if (data.boqSummary) return true;
  if (data.model3dData?.kind === "floor-plan-interactive") return true;
  if (data.model3dData?.kind === "floor-plan-editor" && data.model3dData.geometry) return true;
  if (data.fileDownloads.some(f => f.name.toLowerCase().endsWith(".ifc"))) return true;
  if (data.videoData?.videoUrl && data.videoData.downloadUrl) return true;
  if (data.allImageUrls.length >= 3) return true;
  return false;
}

interface Entry {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  href: string;
  external?: boolean;
  onClick?: () => void;
  /** Hero treatment for the primary, attention-grabbing CTA on this section. */
  featured?: boolean;
}

/**
 * Hero-grade CTAs to dedicated visualizers. Only renders entries the
 * workflow's artifacts justify — no empty placeholders.
 */
export function DedicatedVisualizerEntries({ data, index }: DedicatedVisualizerEntriesProps) {
  const entries: Entry[] = [];

  if (data.boqSummary) {
    entries.push({
      id: "boq",
      title: "Open BOQ Visualizer",
      subtitle: "Sliders, charts, full table, downloads",
      icon: <Calculator size={20} />,
      iconColor: "#0D9488",
      iconBg: "#F0FDFA",
      href: `/dashboard/results/${data.executionId}/boq`,
    });
  }

  if (data.model3dData?.kind === "floor-plan-interactive") {
    entries.push({
      id: "floor-plan",
      title: "Open Floor Plan Editor",
      subtitle: "CAD editor with Vastu & BOQ analysis",
      icon: <PenTool size={20} />,
      iconColor: "#0D9488",
      iconBg: "#F0FDFA",
      href: "/dashboard/floor-plan?source=pipeline",
      external: true,
      onClick: () => {
        if (data.model3dData?.kind === "floor-plan-interactive") {
          try {
            sessionStorage.setItem("floorPlanProject", JSON.stringify(data.model3dData.floorPlanProject));
          } catch {
            // unavailable
          }
        }
      },
    });
  } else if (data.model3dData?.kind === "floor-plan-editor" && data.model3dData.geometry) {
    entries.push({
      id: "floor-plan",
      title: "Open Floor Plan Editor",
      subtitle: "Edit walls, doors, rooms · regenerate IFC + BOQ",
      icon: <PenTool size={20} />,
      iconColor: "#0D9488",
      iconBg: "#F0FDFA",
      href: "/dashboard/floor-plan?source=pipeline",
      external: true,
      onClick: () => {
        if (data.model3dData?.kind === "floor-plan-editor" && data.model3dData.geometry) {
          try {
            sessionStorage.setItem("fp-editor-geometry", JSON.stringify(data.model3dData.geometry));
          } catch {
            // unavailable
          }
        }
      },
    });
  }

  const ifcFile = data.fileDownloads.find(f => f.name.toLowerCase().endsWith(".ifc"));
  if (ifcFile) {
    entries.push({
      id: "ifc",
      title: "Walk Through in 3D",
      subtitle: "Inspect every BIM element · web-ifc WASM",
      icon: <Box size={26} strokeWidth={2.2} />,
      iconColor: "#D97706",
      iconBg: "#FEF3C7",
      href: `/dashboard/ifc-viewer?executionId=${data.executionId}`,
      external: true,
      featured: true,
    });
  }

  if (data.videoData?.videoUrl && data.videoData.downloadUrl) {
    entries.push({
      id: "video",
      title: "Watch in theater mode",
      subtitle: `${data.videoData.durationSeconds}s · MP4 · ${data.videoData.shotCount} shots`,
      icon: <Film size={20} />,
      iconColor: "#7C3AED",
      iconBg: "#F5F3FF",
      href: data.videoData.downloadUrl,
      external: true,
    });
  }

  if (data.allImageUrls.length >= 3) {
    entries.push({
      id: "gallery",
      title: "Browse render gallery",
      subtitle: `${data.allImageUrls.length} concept renders ready`,
      icon: <ImageIcon size={20} />,
      iconColor: "#0D9488",
      iconBg: "#F0FDFA",
      href: "#generated-assets",
    });
  }

  if (entries.length === 0) return null;

  // Hoist the featured entry so it gets a dedicated, full-width hero row above the grid.
  const featured = entries.find(e => e.featured);
  const rest = entries.filter(e => !e.featured);

  return (
    <ScrollReveal>
      <FeaturedEntryStyles />
      <section style={{ padding: "0 clamp(12px, 3vw, 24px)" }}>
        <SectionHeader
          index={index}
          icon={<ArrowRight size={16} />}
          label="Deep links"
          title="Hand off to the right surface"
          subtitle="The result was made here. The work happens over there."
        />
        {featured ? (
          <div style={{ marginBottom: 14 }}>
            <FeaturedEntryCard entry={featured} />
          </div>
        ) : null}
        {rest.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 14,
            }}
          >
            {rest.map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        ) : null}
      </section>
    </ScrollReveal>
  );
}

function EntryCard({ entry }: { entry: Entry }) {
  const inner = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "18px 20px",
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        cursor: "pointer",
        transition: "all 0.2s ease",
        textDecoration: "none",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.07)";
        e.currentTarget.style.borderColor = "rgba(13,148,136,0.20)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
        e.currentTarget.style.borderColor = "rgba(0,0,0,0.06)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: 12,
          background: entry.iconBg,
          color: entry.iconColor,
          flexShrink: 0,
        }}
      >
        {entry.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 2,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{entry.title}</span>
          <ArrowRight size={14} aria-hidden="true" style={{ color: entry.iconColor }} />
        </div>
        <span
          style={{
            fontSize: 12,
            color: "#6B7280",
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.subtitle}
        </span>
      </div>
    </div>
  );

  if (entry.external) {
    return (
      <a
        href={entry.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={entry.onClick}
        style={{ textDecoration: "none" }}
      >
        {inner}
      </a>
    );
  }
  if (entry.href.startsWith("#")) {
    return (
      <a href={entry.href} onClick={entry.onClick} style={{ textDecoration: "none" }}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={entry.href} onClick={entry.onClick} style={{ textDecoration: "none" }}>
      {inner}
    </Link>
  );
}

/**
 * Featured/hero treatment for the primary CTA in this section (currently the IFC
 * walk-through). Dark gradient surface, glowing amber icon halo, animated shimmer
 * sweep, pulsing live-dot, and a solid amber CTA pill that nudges on hover —
 * everything tuned to make a single card unmistakably the next click.
 */
function FeaturedEntryCard({ entry }: { entry: Entry }) {
  const inner = (
    <div
      className="walk3d-card"
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "22px clamp(20px, 3vw, 28px)",
        background:
          "linear-gradient(135deg, #FFFFFF 0%, #FFFBEB 55%, #FEF3C7 100%)",
        border: "1.5px solid rgba(245,158,11,0.40)",
        borderRadius: 20,
        boxShadow:
          "0 14px 32px -10px rgba(217,119,6,0.20), 0 4px 12px -4px rgba(15,23,42,0.06), 0 0 0 4px rgba(245,158,11,0.06)",
        cursor: "pointer",
        transition: "transform 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s ease, border-color 0.35s ease",
        textDecoration: "none",
      }}
    >
      {/* Animated diagonal shimmer sweep */}
      <span aria-hidden="true" className="walk3d-shimmer" />

      {/* Soft amber radial glow behind the icon */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -40,
          top: "50%",
          transform: "translateY(-50%)",
          width: 220,
          height: 220,
          background:
            "radial-gradient(circle at center, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0) 65%)",
          pointerEvents: "none",
        }}
      />

      {/* Icon block with pulsing ring */}
      <span
        aria-hidden="true"
        className="walk3d-icon"
        style={{
          position: "relative",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 60,
          height: 60,
          borderRadius: 18,
          background: "linear-gradient(135deg, #FDE68A 0%, #F59E0B 100%)",
          color: "#7C2D12",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.45) inset, 0 10px 22px -6px rgba(245,158,11,0.45)",
        }}
      >
        {entry.icon}
        <span aria-hidden="true" className="walk3d-pulse-ring" />
      </span>

      {/* Title block */}
      <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#B45309",
              padding: "4px 9px",
              borderRadius: 999,
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.35)",
            }}
          >
            <span
              aria-hidden="true"
              className="walk3d-live-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#10B981",
              }}
            />
            Interactive 3D · Ready
          </span>
        </div>
        <div
          style={{
            fontSize: "clamp(17px, 1.6vw, 19px)",
            fontWeight: 700,
            color: "#0F172A",
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
          }}
        >
          {entry.title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#64748B",
            marginTop: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.subtitle}
        </div>
      </div>

      {/* CTA pill — solid amber, nudges right on hover */}
      <span
        className="walk3d-cta"
        style={{
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 18px",
          borderRadius: 12,
          background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
          color: "#FFFFFF",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.01em",
          boxShadow:
            "0 6px 16px -4px rgba(217,119,6,0.45), 0 0 0 1px rgba(255,255,255,0.20) inset",
          transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1), box-shadow 0.25s ease",
          whiteSpace: "nowrap",
        }}
      >
        Open viewer
        <ArrowRight size={16} aria-hidden="true" className="walk3d-arrow" />
      </span>
    </div>
  );

  if (entry.external) {
    return (
      <a
        href={entry.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={entry.onClick}
        style={{ textDecoration: "none", display: "block" }}
      >
        {inner}
      </a>
    );
  }
  if (entry.href.startsWith("#")) {
    return (
      <a href={entry.href} onClick={entry.onClick} style={{ textDecoration: "none", display: "block" }}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={entry.href} onClick={entry.onClick} style={{ textDecoration: "none", display: "block" }}>
      {inner}
    </Link>
  );
}

/**
 * Keyframes + hover rules for the featured Walk Through in 3D card.
 * Kept inside this file so the component is self-contained — the rules are
 * scoped under `.walk3d-card` so they can't leak into other surfaces.
 */
function FeaturedEntryStyles() {
  return (
    <style>{`
      .walk3d-card:hover {
        transform: translateY(-3px);
        border-color: rgba(217,119,6,0.65) !important;
        box-shadow:
          0 22px 44px -10px rgba(217,119,6,0.30),
          0 8px 20px -6px rgba(15,23,42,0.08),
          0 0 0 4px rgba(245,158,11,0.10) !important;
      }
      .walk3d-card:hover .walk3d-cta {
        transform: translateX(3px);
        box-shadow:
          0 10px 22px -4px rgba(217,119,6,0.55),
          0 0 0 1px rgba(255,255,255,0.25) inset;
      }
      .walk3d-card:hover .walk3d-arrow {
        animation: walk3d-arrow-bob 0.9s ease-in-out infinite;
      }

      .walk3d-shimmer {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          120deg,
          transparent 30%,
          rgba(255,255,255,0.35) 48%,
          rgba(255,255,255,0.55) 50%,
          rgba(255,255,255,0.35) 52%,
          transparent 70%
        );
        background-size: 220% 100%;
        background-position: 200% 0;
        animation: walk3d-shimmer-sweep 4.2s ease-in-out infinite;
        pointer-events: none;
        mix-blend-mode: overlay;
      }

      .walk3d-icon {
        animation: walk3d-icon-float 4.2s ease-in-out infinite;
      }
      .walk3d-pulse-ring {
        position: absolute;
        inset: -6px;
        border-radius: 22px;
        border: 2px solid rgba(245,158,11,0.55);
        animation: walk3d-pulse 2.2s ease-out infinite;
        pointer-events: none;
      }

      .walk3d-live-dot {
        box-shadow: 0 0 0 0 rgba(52,211,153,0.6);
        animation: walk3d-dot-pulse 1.8s ease-out infinite;
      }

      @keyframes walk3d-shimmer-sweep {
        0%   { background-position: 200% 0; }
        60%  { background-position: -100% 0; }
        100% { background-position: -100% 0; }
      }
      @keyframes walk3d-icon-float {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-3px); }
      }
      @keyframes walk3d-pulse {
        0%   { transform: scale(0.92); opacity: 0.85; }
        80%  { transform: scale(1.18); opacity: 0; }
        100% { transform: scale(1.18); opacity: 0; }
      }
      @keyframes walk3d-dot-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(52,211,153,0.55); }
        70%  { box-shadow: 0 0 0 6px rgba(52,211,153,0); }
        100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
      }
      @keyframes walk3d-arrow-bob {
        0%, 100% { transform: translateX(0); }
        50%      { transform: translateX(3px); }
      }

      @media (prefers-reduced-motion: reduce) {
        .walk3d-shimmer,
        .walk3d-icon,
        .walk3d-pulse-ring,
        .walk3d-live-dot,
        .walk3d-card:hover .walk3d-arrow {
          animation: none !important;
        }
      }
    `}</style>
  );
}
