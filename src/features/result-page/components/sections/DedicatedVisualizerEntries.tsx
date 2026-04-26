"use client";

import Link from "next/link";
import { ArrowRight, Calculator, PenTool, Box, Film, Image as ImageIcon } from "lucide-react";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { SectionHeader } from "@/features/result-page/components/sections/SectionHeader";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface DedicatedVisualizerEntriesProps {
  data: ResultPageData;
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
}

/**
 * Hero-grade CTAs to dedicated visualizers. Only renders entries the
 * workflow's artifacts justify — no empty placeholders.
 */
export function DedicatedVisualizerEntries({ data }: DedicatedVisualizerEntriesProps) {
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
      title: "Open in IFC Viewer",
      subtitle: "Inspect every BIM element · web-ifc WASM",
      icon: <Box size={20} />,
      iconColor: "#D97706",
      iconBg: "#FEF3C7",
      href: `/dashboard/ifc-viewer?executionId=${data.executionId}`,
      external: true,
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

  return (
    <ScrollReveal>
      <section style={{ padding: "0 clamp(12px, 3vw, 24px)" }}>
        <SectionHeader
          icon={<ArrowRight size={16} />}
          label="Open in"
          title="Dedicated workspaces"
          subtitle="Hand off to the right surface for deeper editing or analysis."
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {entries.map(entry => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
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
