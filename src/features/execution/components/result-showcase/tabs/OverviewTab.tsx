"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import DOMPurify from "dompurify";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Minus,
  Maximize2,
  Download,
  X,
  Box,
  Film,
  FileText,
  Image as ImageIcon,
  Table2,
  Code2,
  Layers,
  Clock,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ExternalLink,
  BarChart3,
  File,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useLocale } from "@/hooks/useLocale";
import { COLORS } from "@/features/execution/components/result-showcase/constants";

const FloorPlanViewer = dynamic(
  () => import("@/features/floor-plan/components/FloorPlanViewer").then(m => ({ default: m.FloorPlanViewer })),
  { ssr: false, loading: () => <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888", fontSize: 13 }}>Loading Floor Plan Editor...</div> }
);
import { HeroSection } from "@/features/execution/components/result-showcase/sections/HeroSection";
import { KpiStrip } from "@/features/execution/components/result-showcase/sections/KpiStrip";
import { PipelineViz } from "@/features/execution/components/result-showcase/sections/PipelineViz";
import { AnimatedNumber } from "@/features/execution/components/result-showcase/sections/AnimatedNumber";
import { useHeroDetection } from "@/features/execution/components/result-showcase/useHeroDetection";
import type { ShowcaseData } from "@/features/execution/components/result-showcase/useShowcaseData";
import type { TabId } from "@/features/execution/components/result-showcase/constants";
import type { HeroType, InsightMetric, FloorPlanMeta, RoomInfo } from "@/features/execution/components/result-showcase/useHeroDetection";

// ─── Props ───────────────────────────────────────────────────────────────────

interface OverviewTabProps {
  data: ShowcaseData;
  onExpandVideo: () => void;
  onNavigateTab: (tab: TabId) => void;
  onRetryVideo?: () => void;
}

// ─── Ease constant ───────────────────────────────────────────────────────────
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ─── Main Component ──────────────────────────────────────────────────────────

export function OverviewTab({
  data,
  onExpandVideo,
  onNavigateTab,
  onRetryVideo,
}: OverviewTabProps) {
  const { t } = useLocale();
  const hero = useHeroDetection(data);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* ── Responsive Styles ── */}
      <style>{`
        @media (max-width: 768px) {
          .fp-hero-layout {
            flex-direction: column !important;
            min-height: 40vh !important;
            max-height: none !important;
          }
          .fp-room-sidebar {
            width: 100% !important;
            max-height: 220px !important;
            border-radius: 12px !important;
          }
          .fp-svg-viewer {
            border-radius: 12px !important;
          }
          .fp-bottom-right {
            flex-direction: column !important;
            gap: 4px !important;
          }
          .fp-bottom-right button {
            font-size: 10px !important;
            padding: 6px 10px !important;
          }
          .insight-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .supporting-grid {
            grid-template-columns: 1fr !important;
          }
          .model3d-hero {
            min-height: 240px !important;
          }
          .model3d-specs {
            gap: 16px !important;
            flex-wrap: wrap !important;
            justify-content: center !important;
          }
          .compact-banner {
            flex-wrap: wrap !important;
            gap: 8px !important;
          }
          .compact-banner-right {
            margin-left: 0 !important;
            width: 100% !important;
            justify-content: flex-start !important;
            padding-left: 26px !important;
          }
          .image-overlay-controls {
            flex-direction: column !important;
            align-items: flex-start !important;
            padding: 24px 12px 12px !important;
          }
          .image-overlay-controls > span {
            font-size: 11px !important;
          }
          .image-overlay-btns {
            width: 100% !important;
          }
          .image-overlay-btns a,
          .image-overlay-btns button {
            flex: 1 !important;
            justify-content: center !important;
          }
          .lightbox-overlay {
            padding: 16px !important;
          }
          .table-hero-header {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 8px !important;
          }
        }
        @media (max-width: 480px) {
          .fp-hero-layout {
            min-height: 35vh !important;
          }
          .insight-grid {
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
          }
          .insight-card {
            padding: 12px 14px !important;
          }
          .insight-value {
            font-size: 22px !important;
          }
        }
      `}</style>

      {/* ═══ HERO: Primary Result ═══ */}
      {hero.type === "floor-plan-interactive" && data.model3dData?.kind === "floor-plan-interactive" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 4px 24px rgba(0,0,0,0.25)" }}
        >
          {/* Header bar with stats + Open Full Editor button */}
          <div style={{
            display: "flex", alignItems: "center", gap: 16,
            padding: "10px 16px",
            background: "rgba(15,15,20,0.95)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            fontSize: 11, color: "#9ca3af", flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, color: "#e5e7eb", fontSize: 13 }}>{data.model3dData.label}</span>
            <span>{data.model3dData.summary.totalRooms} rooms</span>
            <span>{data.model3dData.summary.totalArea_sqm} m²</span>
            <span>{data.model3dData.summary.totalWalls} walls</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: COLORS.CYAN, fontWeight: 500 }}>
                {data.model3dData.summary.buildingType} · {data.model3dData.summary.floorCount} floor{data.model3dData.summary.floorCount > 1 ? "s" : ""}
              </span>
              <button
                onClick={() => {
                  try {
                    sessionStorage.setItem("floorPlanProject", JSON.stringify(data.model3dData?.kind === "floor-plan-interactive" ? data.model3dData.floorPlanProject : null));
                    window.open("/dashboard/floor-plan?source=pipeline", "_blank");
                  } catch { /* sessionStorage may fail */ }
                }}
                style={{
                  background: COLORS.CYAN, color: "#000", border: "none",
                  padding: "5px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                }}
              >
                Open Full Editor <ExternalLink size={11} />
              </button>
            </span>
          </div>
          {/* Interactive CAD editor */}
          <div style={{ height: "calc(100vh - 280px)", minHeight: 550, background: "#0a0a0f" }}>
            <FloorPlanViewer initialProject={data.model3dData.floorPlanProject} />
          </div>
        </motion.div>
      )}

      {hero.type === "floor-plan" && data.svgContent && (
        <FloorPlanHero
          svgContent={data.svgContent}
          meta={hero.floorPlanMeta}
          onNavigateTab={onNavigateTab}
          has3DEditor={!!data.model3dData}
        />
      )}

      {hero.type === "video" && (
        <VideoHero
          data={data}
          onExpandVideo={onExpandVideo}
          onRetryVideo={onRetryVideo}
        />
      )}

      {hero.type === "3d-model" && data.model3dData && (
        <Model3DHero
          model3dData={data.model3dData}
          onNavigateTab={onNavigateTab}
        />
      )}

      {hero.type === "image" && (
        <ImageHero imageUrls={data.allImageUrls} />
      )}

      {hero.type === "table" && (
        <TableHero tableData={data.tableData} />
      )}

      {hero.type === "text" && <TextHero textContent={data.textContent} />}

      {/* ═══ INSIGHT STRIP: Meaningful metrics ═══ */}
      {data.kpiMetrics.length > 0 ? (
        <KpiStrip metrics={data.kpiMetrics} maxItems={8} />
      ) : hero.insights.length > 0 ? (
        <InsightStripSection insights={hero.insights} />
      ) : null}

      {/* ═══ COMPACT EXECUTION BANNER ═══ */}
      <CompactBanner data={data} />

      {/* ═══ BOQ VISUALIZER CTA ═══ */}
      {data.boqSummary && <BOQVisualizerCTA boq={data.boqSummary} />}

      {/* ═══ TECH STACK — compact inline chips ═══ */}
      <TechChips data={data} />

      {/* ═══ SUPPORTING RESULTS ═══ */}
      <SupportingCards
        data={data}
        heroType={hero.type}
        onNavigateTab={onNavigateTab}
      />

      {/* ═══ PIPELINE VISUALIZATION ═══ */}
      {data.pipelineSteps.length > 1 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <SectionLabel title={t("showcase.pipelineTitle")} />
          <PipelineViz steps={data.pipelineSteps} />
        </motion.div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── FLOOR PLAN HERO ─────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function FloorPlanHero({
  svgContent,
  meta,
  onNavigateTab,
  has3DEditor,
}: {
  svgContent: string;
  meta: FloorPlanMeta | null;
  onNavigateTab: (tab: TabId) => void;
  has3DEditor?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const sanitizedSvg = useMemo(
    () =>
      typeof window !== "undefined"
        ? DOMPurify.sanitize(svgContent, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : "",
    [svgContent],
  );

  // Make SVG responsive after render
  useEffect(() => {
    if (!svgContainerRef.current) return;
    const svgEl = svgContainerRef.current.querySelector("svg");
    if (svgEl) {
      svgEl.style.width = "100%";
      svgEl.style.height = "auto";
      svgEl.style.maxHeight = "100%";
      svgEl.style.display = "block";
    }
  }, [sanitizedSvg]);

  // Non-passive wheel handler for zoom
  useEffect(() => {
    const el = svgContainerRef.current?.parentElement;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((prev) => Math.min(Math.max(prev + delta, 0.4), 5));
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: panOffset.x,
        panY: panOffset.y,
      };
    },
    [panOffset],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      setPanOffset({
        x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.x),
        y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.y),
      });
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleDownloadSvg = useCallback(() => {
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "floor_plan.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [svgContent]);

  // Touch support for mobile zoom/pan
  const touchRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    dist?: number;
  } | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        touchRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          panX: panOffset.x,
          panY: panOffset.y,
        };
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        touchRef.current = {
          x: 0,
          y: 0,
          panX: panOffset.x,
          panY: panOffset.y,
          dist,
        };
      }
    },
    [panOffset],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current) return;
      e.preventDefault();
      if (e.touches.length === 1) {
        setPanOffset({
          x:
            touchRef.current.panX +
            (e.touches[0].clientX - touchRef.current.x),
          y:
            touchRef.current.panY +
            (e.touches[0].clientY - touchRef.current.y),
        });
      } else if (e.touches.length === 2 && touchRef.current.dist) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        const scale = dist / touchRef.current.dist;
        setZoom((prev) => Math.min(Math.max(prev * scale, 0.4), 5));
        touchRef.current.dist = dist;
      }
    },
    [],
  );

  const handleTouchEnd = useCallback(() => {
    touchRef.current = null;
  }, []);

  const hasRoomSidebar = meta && meta.rooms.length > 0;

  return (
    <motion.div
      className="fp-hero-layout"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      style={{
        display: "flex",
        gap: 16,
        minHeight: "55vh",
        maxHeight: "75vh",
      }}
    >
      {/* ── SVG Viewer ── */}
      <div
        className="fp-svg-viewer"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          flex: 1,
          background: "#FFFFFF",
          borderRadius: 16,
          overflow: "hidden",
          position: "relative",
          cursor: isDragging ? "grabbing" : "grab",
          boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.06)",
          userSelect: "none",
        }}
      >
        <div
          ref={svgContainerRef}
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.2s ease-out",
            padding: 24,
            minHeight: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
        />

        {/* Zoom Controls — bottom left */}
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            display: "flex",
            gap: 2,
            background: "rgba(0,0,0,0.72)",
            borderRadius: 10,
            padding: 4,
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          <ZoomBtn
            onClick={() => setZoom((z) => Math.min(z + 0.25, 5))}
            title="Zoom in"
          >
            <Plus size={14} />
          </ZoomBtn>
          <ZoomBtn
            onClick={() => setZoom((z) => Math.max(z - 0.25, 0.4))}
            title="Zoom out"
          >
            <Minus size={14} />
          </ZoomBtn>
          <div
            style={{
              width: 1,
              background: "rgba(255,255,255,0.15)",
              margin: "4px 2px",
            }}
          />
          <ZoomBtn onClick={resetView} title="Fit to view">
            <Maximize2 size={13} />
          </ZoomBtn>
        </div>

        {/* Right Controls — bottom right */}
        <div
          className="fp-bottom-right"
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            display: "flex",
            gap: 6,
          }}
        >
          <button
            onClick={handleDownloadSvg}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "7px 14px",
              borderRadius: 8,
              background: "rgba(0,0,0,0.72)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              backdropFilter: "blur(12px)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0,0,0,0.85)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0,0,0,0.72)";
            }}
          >
            <Download size={12} />
            Download SVG
          </button>
          {has3DEditor && (
            <button
              onClick={() => onNavigateTab("model")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "7px 14px",
                borderRadius: 8,
                background: `rgba(0,245,255,0.12)`,
                border: `1px solid rgba(0,245,255,0.25)`,
                color: COLORS.CYAN,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                backdropFilter: "blur(12px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,245,255,0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,245,255,0.12)";
              }}
            >
              <Box size={12} />
              Open 3D Editor
            </button>
          )}
        </div>

        {/* Zoom Level Badge */}
        <AnimatePresence>
          {zoom !== 1 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                padding: "4px 10px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.65)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                backdropFilter: "blur(8px)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(zoom * 100)}%
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Room Details Sidebar ── */}
      {hasRoomSidebar && (
        <RoomSidebar
          rooms={meta.rooms}
          totalArea={meta.totalArea}
          floors={meta.floors}
        />
      )}
    </motion.div>
  );
}

// ── Zoom Button ──

function ZoomBtn({
  onClick,
  children,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        background: "transparent",
        border: "none",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

// ── Room Sidebar ──

function RoomSidebar({
  rooms,
  totalArea,
  floors,
}: {
  rooms: RoomInfo[];
  totalArea: number;
  floors: number;
}) {
  return (
    <motion.div
      className="fp-room-sidebar"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3, duration: 0.4, ease: EASE_OUT }}
      style={{
        width: 240,
        flexShrink: 0,
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${COLORS.GLASS_BORDER}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px 10px",
          borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: COLORS.TEXT_MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Room Details
        </div>
      </div>

      {/* Room List */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 12px",
        }}
      >
        {rooms.map((room, i) => {
          const color = getRoomColor(room.name);
          return (
            <motion.div
              key={`${room.name}-${i}`}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.025, duration: 0.3 }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "7px 8px",
                borderRadius: 6,
                marginBottom: 2,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: color,
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${color}40`,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: COLORS.TEXT_SECONDARY,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {room.name}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: COLORS.TEXT_PRIMARY,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                {room.area} m²
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Footer Totals */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: `1px solid ${COLORS.GLASS_BORDER}`,
          background: "rgba(0,245,255,0.02)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: COLORS.TEXT_MUTED,
              fontWeight: 600,
            }}
          >
            Total
          </span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: COLORS.TEXT_PRIMARY,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.round(totalArea)} m²
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            color: COLORS.TEXT_MUTED,
          }}
        >
          {rooms.length} rooms · {floors} {floors === 1 ? "floor" : "floors"}
        </div>
      </div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── VIDEO HERO ──────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function VideoHero({
  data,
  onExpandVideo,
  onRetryVideo,
}: {
  data: ShowcaseData;
  onExpandVideo: () => void;
  onRetryVideo?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      <HeroSection
        videoData={data.videoData}
        heroImageUrl={data.heroImageUrl}
        onExpandVideo={onExpandVideo}
        onRetryVideo={onRetryVideo}
      />
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── 3D MODEL HERO ───────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function Model3DHero({
  model3dData,
  onNavigateTab,
}: {
  model3dData: NonNullable<ShowcaseData["model3dData"]>;
  onNavigateTab: (tab: TabId) => void;
}) {
  const { t } = useLocale();
  const isProcedural = model3dData.kind === "procedural";

  return (
    <motion.div
      className="model3d-hero"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      onClick={() => onNavigateTab("model")}
      style={{
        position: "relative",
        minHeight: 320,
        borderRadius: 16,
        overflow: "hidden",
        cursor: "pointer",
        background: "linear-gradient(145deg, #0D0E12 0%, #141520 50%, #0D0E12 100%)",
        border: `1px solid ${COLORS.GLASS_BORDER}`,
        boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 24,
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${COLORS.AMBER}40`;
        e.currentTarget.style.boxShadow = `0 8px 60px ${COLORS.AMBER}12`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = COLORS.GLASS_BORDER;
        e.currentTarget.style.boxShadow = "0 8px 40px rgba(0,0,0,0.4)";
      }}
    >
      {/* Animated grid background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(${COLORS.AMBER}08 1px, transparent 1px),
            linear-gradient(90deg, ${COLORS.AMBER}08 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
          opacity: 0.5,
        }}
      />

      {/* Icon */}
      <motion.div
        animate={{ rotateY: [0, 360] }}
        transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: `${COLORS.AMBER}12`,
          border: `1px solid ${COLORS.AMBER}25`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLORS.AMBER,
          position: "relative",
          zIndex: 1,
        }}
      >
        <Box size={36} />
      </motion.div>

      {/* Title */}
      <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: COLORS.TEXT_PRIMARY,
            marginBottom: 6,
          }}
        >
          {isProcedural
            ? `${(model3dData as { buildingType: string }).buildingType} — ${(model3dData as { floors: number }).floors} Floors`
            : t("showcase.explore3dModel")}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            justifyContent: "center",
            color: COLORS.CYAN,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {t("showcase.explore3dModel")}
          <ArrowRight size={14} />
        </div>
      </div>

      {/* Specs strip */}
      {isProcedural && (
        <div
          className="model3d-specs"
          style={{
            display: "flex",
            gap: 24,
            position: "relative",
            zIndex: 1,
          }}
        >
          {[
            {
              label: t("showcase.specHeight"),
              value: `${(model3dData as { height: number }).height}m`,
            },
            {
              label: t("showcase.specFootprint"),
              value: `${(model3dData as { footprint: number }).footprint} m²`,
            },
            {
              label: t("showcase.specGfa"),
              value: `${(model3dData as { gfa: number }).gfa} m²`,
            },
          ].map((spec) => (
            <div key={spec.label} style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: COLORS.TEXT_PRIMARY,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {spec.value}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: COLORS.TEXT_MUTED,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 600,
                }}
              >
                {spec.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── IMAGE HERO ──────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function ImageHero({ imageUrls }: { imageUrls: string[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Clamp activeIndex if imageUrls shrinks
  const clampedIndex = Math.min(activeIndex, Math.max(imageUrls.length - 1, 0));
  const mainUrl = imageUrls[clampedIndex] ?? imageUrls[0];

  // Add ESC key handler for lightbox
  useEffect(() => {
    if (!lightboxUrl) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxUrl]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {/* Main Image */}
        <div
          style={{
            borderRadius: 16,
            overflow: "hidden",
            position: "relative",
            boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.06)",
            cursor: "zoom-in",
          }}
          onClick={() => setLightboxUrl(mainUrl)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mainUrl}
            alt={`Concept Render ${clampedIndex + 1}`}
            style={{
              width: "100%",
              height: "auto",
              minHeight: 300,
              maxHeight: "60vh",
              objectFit: "cover",
              display: "block",
              transition: "transform 0.4s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.02)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          />

          {/* Overlay controls */}
          <div
            className="image-overlay-controls"
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              padding: "40px 20px 16px",
              background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(255,255,255,0.9)",
              }}
            >
              Concept Render{" "}
              {imageUrls.length > 1 ? `${clampedIndex + 1}` : ""}
            </span>
            <div className="image-overlay-btns" style={{ display: "flex", gap: 6 }}>
              <a
                href={mainUrl}
                download={`render_${clampedIndex + 1}.png`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 14px",
                  borderRadius: 6,
                  background: "rgba(0,0,0,0.5)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  textDecoration: "none",
                  cursor: "pointer",
                }}
              >
                <Download size={12} />
                Download
              </a>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxUrl(mainUrl);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 14px",
                  borderRadius: 6,
                  background: "rgba(0,245,255,0.15)",
                  border: "1px solid rgba(0,245,255,0.3)",
                  color: COLORS.CYAN,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <ExternalLink size={12} />
                Fullscreen
              </button>
            </div>
          </div>
        </div>

        {/* Thumbnail strip */}
        {imageUrls.length > 1 && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {imageUrls.map((url, i) => (
              <motion.button
                key={url}
                whileTap={{ scale: 0.95 }}
                onClick={() => setActiveIndex(i)}
                style={{
                  width: 64,
                  height: 44,
                  borderRadius: 8,
                  overflow: "hidden",
                  border:
                    i === clampedIndex
                      ? `2px solid ${COLORS.CYAN}`
                      : "2px solid rgba(255,255,255,0.08)",
                  padding: 0,
                  cursor: "pointer",
                  opacity: i === clampedIndex ? 1 : 0.5,
                  transition: "all 0.2s ease",
                  background: "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Thumb ${i + 1}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </motion.button>
            ))}
          </div>
        )}
      </motion.div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxUrl && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxUrl(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 200,
              background: "rgba(0,0,0,0.94)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "zoom-out",
              padding: "clamp(16px, 4vw, 40px)",
            }}
          >
            <button
              onClick={() => setLightboxUrl(null)}
              style={{
                position: "absolute",
                top: 20,
                right: 20,
                background: "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: 8,
                padding: 8,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <X size={20} />
            </button>
            <motion.img
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              src={lightboxUrl}
              alt="Full view"
              style={{
                maxWidth: "92vw",
                maxHeight: "88vh",
                objectFit: "contain",
                borderRadius: 8,
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── TABLE HERO ──────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function TableHero({ tableData }: { tableData: ShowcaseData["tableData"] }) {
  if (tableData.length === 0) return null;
  const table = tableData[0];
  const previewRows = table.rows.slice(0, 8);

  // Compute grand total
  let grandTotal: number | null = null;
  if (table.rows.length > 0) {
    const lastColIdx = table.headers.length - 1;
    const vals = table.rows.map((r) => {
      const v = r[lastColIdx];
      return typeof v === "number" ? v : parseFloat(String(v).replace(/[,$]/g, ""));
    });
    if (vals.every((v) => !isNaN(v))) {
      grandTotal = vals.reduce((a, b) => a + b, 0);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      style={{
        borderRadius: 16,
        overflow: "hidden",
        border: `1px solid ${COLORS.GLASS_BORDER}`,
        boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
      }}
    >
      {/* Header */}
      <div
        className="table-hero-header"
        style={{
          padding: "14px 20px",
          background: "rgba(0,245,255,0.03)",
          borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Table2 size={16} style={{ color: COLORS.CYAN }} />
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: COLORS.TEXT_PRIMARY,
            }}
          >
            {table.label ?? "Data Table"}
          </span>
          <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED }}>
            {table.rows.length} rows × {table.headers.length} cols
          </span>
        </div>
        {grandTotal !== null && (
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: COLORS.CYAN,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {grandTotal.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </div>
        )}
      </div>

      {/* Table Preview */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 11,
            color: COLORS.TEXT_SECONDARY,
          }}
        >
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "10px 14px",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "#B0B0C5",
                    borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    background: "rgba(7,8,9,0.95)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  background:
                    ri % 2 === 0
                      ? "transparent"
                      : "rgba(255,255,255,0.01)",
                }}
              >
                {(row as (string | number)[]).map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "8px 14px",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.rows.length > 8 && (
        <div
          style={{
            padding: "10px 20px",
            textAlign: "center",
            borderTop: `1px solid ${COLORS.GLASS_BORDER}`,
            fontSize: 11,
            color: COLORS.CYAN,
            fontWeight: 600,
          }}
        >
          +{table.rows.length - 8} more rows — view in Data tab
        </div>
      )}
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── TEXT HERO ────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function TextHero({ textContent }: { textContent: string }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const lines = textContent.split("\n");
  const preview = lines.slice(0, 8).join("\n");
  const hasMore = lines.length > 8;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      style={{
        background: COLORS.GLASS_BG,
        border: `1px solid ${COLORS.GLASS_BORDER}`,
        borderRadius: 16,
        padding: "24px 28px",
        position: "relative",
        overflow: "hidden",
        minHeight: 200,
      }}
    >
      <CornerMarks />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <FileText size={16} style={{ color: COLORS.CYAN }} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: COLORS.TEXT_PRIMARY,
          }}
        >
          {t("showcase.projectBrief")}
        </span>
      </div>

      <div
        style={{
          fontSize: 13,
          color: COLORS.TEXT_SECONDARY,
          lineHeight: 1.8,
          whiteSpace: "pre-wrap",
        }}
      >
        {expanded ? textContent : preview}
        {hasMore && (
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "none",
              border: "none",
              color: COLORS.CYAN,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              marginLeft: 8,
            }}
          >
            {expanded
              ? t("showcase.showLess")
              : `${t("showcase.showMoreLines")} (+${lines.length - 8} ${t("showcase.lines")})`}
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── INSIGHT STRIP (for derived metrics, when no KPIs from pipeline) ─────
// ═════════════════════════════════════════════════════════════════════════════

function InsightStripSection({ insights }: { insights: InsightMetric[] }) {
  if (insights.length === 0) return null;

  const cols = Math.min(insights.length, 4);

  return (
    <motion.div
      className="insight-grid"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 10,
      }}
    >
      {insights.map((m, i) => {
        const numericValue =
          typeof m.value === "number" ? m.value : parseFloat(String(m.value));
        const isNumeric = !isNaN(numericValue);

        return (
          <motion.div
            className="insight-card"
            key={`${m.label}-${i}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.06 }}
            style={{
              background: COLORS.GLASS_BG,
              border: `1px solid ${COLORS.GLASS_BORDER}`,
              borderRadius: 12,
              padding: "16px 18px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Top glow line */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "15%",
                right: "15%",
                height: 1,
                background: `linear-gradient(90deg, transparent, ${COLORS.CYAN}33, transparent)`,
              }}
            />

            <div
              className="insight-value"
              style={{
                fontSize: !isNumeric && String(m.value).length > 12 ? 16 : 28,
                fontWeight: !isNumeric && String(m.value).length > 12 ? 700 : 800,
                color: COLORS.TEXT_PRIMARY,
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
                marginBottom: 6,
                letterSpacing: "-0.02em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {isNumeric ? (
                <AnimatedNumber
                  value={numericValue}
                  duration={1200 + i * 200}
                  decimals={numericValue % 1 !== 0 ? 1 : 0}
                />
              ) : (
                m.value
              )}
              {m.unit && (
                <span
                  style={{
                    fontSize: 12,
                    color: COLORS.TEXT_MUTED,
                    marginLeft: 4,
                    fontWeight: 400,
                  }}
                >
                  {m.unit}
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: 10,
                color: COLORS.TEXT_MUTED,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              {m.label}
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── BOQ VISUALIZER CTA ──────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function BOQVisualizerCTA({ boq }: { boq: NonNullable<ShowcaseData["boqSummary"]> }) {
  const costLabel = boq.totalCost >= 10000000
    ? `${boq.currencySymbol}${(boq.totalCost / 10000000).toFixed(1)} Cr`
    : boq.totalCost >= 100000
    ? `${boq.currencySymbol}${(boq.totalCost / 100000).toFixed(1)} L`
    : boq.totalCost > 0
    ? `${boq.currencySymbol}${boq.totalCost.toLocaleString("en-IN")}`
    : "";
  const subtitle = [costLabel, boq.gfa ? `${boq.gfa.toLocaleString("en-IN")}m²` : "", boq.region].filter(Boolean).join(" · ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link href={`/dashboard/results/${boq.executionId}/boq`} style={{ textDecoration: "none" }}>
        <div
          style={{
            padding: "14px 20px",
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(0,245,255,0.10), rgba(0,245,255,0.04))",
            border: "1px solid rgba(0,245,255,0.25)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            transition: "all 0.25s ease",
            boxShadow: "0 0 20px rgba(0,245,255,0.08)",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "rgba(0,245,255,0.5)";
            e.currentTarget.style.boxShadow = "0 0 32px rgba(0,245,255,0.18), 0 4px 20px rgba(0,245,255,0.1)";
            e.currentTarget.style.background = "linear-gradient(135deg, rgba(0,245,255,0.14), rgba(0,245,255,0.06))";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "rgba(0,245,255,0.25)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(0,245,255,0.08)";
            e.currentTarget.style.background = "linear-gradient(135deg, rgba(0,245,255,0.10), rgba(0,245,255,0.04))";
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "rgba(0,245,255,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <Sparkles size={18} color="#00F5FF" />
            </div>
            <div>
              <div style={{
                fontSize: 13, fontWeight: 700, color: "#00F5FF",
                display: "flex", alignItems: "center", gap: 6,
                letterSpacing: "0.01em",
              }}>
                Open BOQ Visualizer
                <ArrowRight size={14} style={{ opacity: 0.8 }} />
              </div>
              {subtitle && (
                <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginTop: 2 }}>
                  {subtitle}
                </div>
              )}
            </div>
          </div>

          <div style={{
            fontSize: 9, fontWeight: 600,
            padding: "3px 8px", borderRadius: 6,
            background: "rgba(0,245,255,0.1)",
            color: "#00F5FF",
            letterSpacing: "0.05em",
            textTransform: "uppercase" as const,
            flexShrink: 0,
          }}>
            INTERACTIVE
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── COMPACT EXECUTION BANNER ────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function CompactBanner({ data }: { data: ShowcaseData }) {
  const { t } = useLocale();

  return (
    <motion.div
      className="compact-banner"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.4 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 16px",
        background: `linear-gradient(135deg, ${COLORS.EMERALD}05, ${COLORS.CYAN}03)`,
        border: `1px solid ${COLORS.EMERALD}15`,
        borderRadius: 10,
      }}
    >
      <CheckCircle size={14} style={{ color: COLORS.EMERALD, flexShrink: 0 }} />
      <span
        style={{
          fontSize: 11,
          color: COLORS.TEXT_SECONDARY,
          fontWeight: 500,
        }}
      >
        {t("showcase.executionComplete")}
        {data.executionMeta.executedAt && !isNaN(new Date(data.executionMeta.executedAt).getTime()) && (
          <>
            {" · "}
            {new Date(data.executionMeta.executedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            {new Date(data.executionMeta.executedAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </>
        )}
      </span>

      <div className="compact-banner-right" style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
        {data.executionMeta.durationMs != null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              color: COLORS.TEXT_MUTED,
            }}
          >
            <Clock size={10} />
            {data.executionMeta.durationMs < 1000
              ? `${data.executionMeta.durationMs}ms`
              : `${(data.executionMeta.durationMs / 1000).toFixed(1)}s`}
          </div>
        )}
        <div
          style={{
            fontSize: 10,
            color: COLORS.TEXT_MUTED,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {data.successNodes}/{data.totalNodes} {t("showcase.nodes")}
        </div>
      </div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── TECH STACK CHIPS ────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

const TECH_MAP: Array<{ keywords: string[]; name: string; color: string }> = [
  { keywords: ["brief", "analyzer", "understanding", "parser", "extractor"], name: "GPT-4o", color: "#8B5CF6" },
  { keywords: ["massing"], name: "3D AI Studio", color: "#FFBF00" },
  { keywords: ["concept render", "dall"], name: "DALL-E 3", color: "#10B981" },
  { keywords: ["video", "walkthrough"], name: "Kling 3.0", color: "#00F5FF" },
  { keywords: ["3d recon", "hi-fi"], name: "Meshy v4", color: "#F59E0B" },
  { keywords: ["floor plan gen"], name: "GPT-4o + SVG", color: "#14B8A6" },
  { keywords: ["interactive 3d", "3d viewer"], name: "Three.js", color: "#00F5FF" },
  { keywords: ["quantity", "boq"], name: "web-ifc", color: "#F59E0B" },
  { keywords: ["ifc export"], name: "IFC4", color: "#3B82F6" },
  { keywords: ["site", "gis", "location"], name: "Google Maps", color: "#4FC3F7" },
];

function TechChips({ data }: { data: ShowcaseData }) {
  const techs = new Map<string, string>(); // name → color
  for (const step of data.pipelineSteps) {
    const label = step.label.toLowerCase();
    for (const t of TECH_MAP) {
      if (t.keywords.some(kw => label.includes(kw))) {
        techs.set(t.name, t.color);
      }
    }
  }

  // Always show Kling 3.0 branding for video workflows

  if (techs.size === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.45 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span style={{
        fontSize: 10, fontWeight: 600, color: COLORS.TEXT_MUTED,
        textTransform: "uppercase", letterSpacing: "0.06em",
        marginRight: 4,
      }}>
        Powered by
      </span>
      {[...techs.entries()].map(([name, color]) => (
        <span
          key={name}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", borderRadius: 6,
            background: `${color}08`, border: `1px solid ${color}20`,
            fontSize: 10, fontWeight: 600, color,
            letterSpacing: "0.02em",
          }}
        >
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: color, boxShadow: `0 0 6px ${color}50`,
          }} />
          {name}
        </span>
      ))}
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── SUPPORTING RESULTS CARDS ────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

const ARTIFACT_ICONS: Record<string, React.ReactNode> = {
  text: <FileText size={16} />,
  image: <ImageIcon size={16} />,
  video: <Film size={16} />,
  "3d": <Box size={16} />,
  html: <Box size={16} />,
  kpi: <BarChart3 size={16} />,
  table: <Table2 size={16} />,
  json: <Code2 size={16} />,
  svg: <Layers size={16} />,
  file: <File size={16} />,
};

const ARTIFACT_COLORS: Record<string, string> = {
  text: "#8B5CF6",
  image: "#10B981",
  video: "#00F5FF",
  "3d": "#FFBF00",
  html: "#00F5FF",
  kpi: "#F59E0B",
  table: "#6366F1",
  json: "#EC4899",
  svg: "#14B8A6",
  file: "#64748B",
};

const TAB_FOR_TYPE: Record<string, TabId> = {
  text: "data",
  image: "media",
  video: "media",
  svg: "media",
  kpi: "data",
  table: "data",
  json: "data",
  "3d": "model",
  html: "model",
  file: "export",
};

// Map hero type to its artifact type so we can skip it in supporting cards
const HERO_ARTIFACT_TYPES: Record<HeroType, string[]> = {
  "floor-plan": ["svg"],
  "floor-plan-interactive": ["json", "svg"],
  video: ["video"],
  "3d-model": ["3d", "html"],
  image: ["image"],
  table: ["table"],
  text: ["text"],
  generic: [],
};

function SupportingCards({
  data,
  heroType,
  onNavigateTab,
}: {
  data: ShowcaseData;
  heroType: HeroType;
  onNavigateTab: (tab: TabId) => void;
}) {
  const { t } = useLocale();

  // Build list of supporting items (skip the hero artifact type)
  const heroTypes = HERO_ARTIFACT_TYPES[heroType];
  const items = data.pipelineSteps
    .filter(
      (s) => s.artifactType && !heroTypes.includes(s.artifactType),
    )
    .map((s) => ({
      type: s.artifactType!,
      label: s.label,
      category: s.category,
      targetTab: (TAB_FOR_TYPE[s.artifactType!] ?? "export") as TabId,
    }));

  // Deduplicate by type (show unique types only)
  const seen = new Set<string>();
  const uniqueItems = items.filter((item) => {
    const key = `${item.type}-${item.targetTab}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueItems.length === 0) return null;

  // Always add export card at the end
  const hasExportCard = uniqueItems.some((i) => i.targetTab === "export");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45 }}
    >
      <SectionLabel title="Also Generated" />
      <div
        className="supporting-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 10,
        }}
      >
        {uniqueItems.map((item, i) => {
          const color = ARTIFACT_COLORS[item.type] ?? COLORS.TEXT_MUTED;
          const icon = ARTIFACT_ICONS[item.type] ?? <File size={16} />;
          const typeLabel =
            item.type === "text"
              ? t("showcase.typeDocument")
              : item.type === "image"
                ? t("showcase.typeRender")
                : item.type === "json"
                  ? t("showcase.typeStructuredData")
                  : item.type === "kpi"
                    ? t("showcase.typeMetrics")
                    : item.type === "table"
                      ? t("showcase.typeDataTable")
                      : item.type === "svg"
                        ? t("showcase.typeFloorPlan")
                        : item.type === "3d" || item.type === "html"
                          ? t("showcase.type3dModel")
                          : item.type === "video"
                            ? t("showcase.typeWalkthrough")
                            : item.type === "file"
                              ? t("showcase.typeExportFile")
                              : item.type;

          return (
            <motion.button
              key={`${item.type}-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.04 }}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onNavigateTab(item.targetTab)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderRadius: 12,
                background: COLORS.GLASS_BG,
                border: `1px solid ${COLORS.GLASS_BORDER}`,
                cursor: "pointer",
                transition: "border-color 0.2s, box-shadow 0.2s",
                textAlign: "left",
                position: "relative",
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = `${color}40`;
                e.currentTarget.style.boxShadow = `0 4px 20px ${color}10`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = COLORS.GLASS_BORDER;
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {/* Top accent */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: `linear-gradient(90deg, ${color}60, transparent)`,
                }}
              />

              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: `${color}12`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color,
                  flexShrink: 0,
                }}
              >
                {icon}
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: COLORS.TEXT_PRIMARY,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {typeLabel}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: COLORS.TEXT_MUTED,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.label}
                </div>
              </div>

              <ArrowRight
                size={14}
                style={{
                  color: COLORS.TEXT_MUTED,
                  opacity: 0.4,
                  flexShrink: 0,
                }}
              />
            </motion.button>
          );
        })}

        {/* Export card */}
        {!hasExportCard && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + uniqueItems.length * 0.04 }}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigateTab("export")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 16px",
              borderRadius: 12,
              background: COLORS.GLASS_BG,
              border: `1px solid ${COLORS.GLASS_BORDER}`,
              cursor: "pointer",
              transition: "border-color 0.2s, box-shadow 0.2s",
              textAlign: "left",
              position: "relative",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = `${COLORS.AMBER}40`;
              e.currentTarget.style.boxShadow = `0 4px 20px ${COLORS.AMBER}10`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = COLORS.GLASS_BORDER;
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                background: `linear-gradient(90deg, ${COLORS.AMBER}60, transparent)`,
              }}
            />
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `${COLORS.AMBER}12`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: COLORS.AMBER,
                flexShrink: 0,
              }}
            >
              <Download size={16} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: COLORS.TEXT_PRIMARY,
                }}
              >
                {t("showcase.downloadCenter")}
              </div>
              <div style={{ fontSize: 10, color: COLORS.TEXT_MUTED }}>
                {t("showcase.pdfVideoFiles")}
              </div>
            </div>
            <ArrowRight
              size={14}
              style={{
                color: COLORS.TEXT_MUTED,
                opacity: 0.4,
                flexShrink: 0,
              }}
            />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── HELPERS ─────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function SectionLabel({ title }: { title: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: COLORS.TEXT_MUTED,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {title}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, ${COLORS.GLASS_BORDER}, transparent)`,
        }}
      />
    </div>
  );
}

function CornerMarks() {
  const markStyle = (
    top: boolean,
    left: boolean,
  ): React.CSSProperties => ({
    position: "absolute",
    [top ? "top" : "bottom"]: 6,
    [left ? "left" : "right"]: 6,
    width: 12,
    height: 12,
    borderColor: `${COLORS.CYAN}20`,
    borderStyle: "solid",
    borderWidth: 0,
    ...(top && left ? { borderTopWidth: 1, borderLeftWidth: 1 } : {}),
    ...(top && !left ? { borderTopWidth: 1, borderRightWidth: 1 } : {}),
    ...(!top && left
      ? { borderBottomWidth: 1, borderLeftWidth: 1 }
      : {}),
    ...(!top && !left
      ? { borderBottomWidth: 1, borderRightWidth: 1 }
      : {}),
  });

  return (
    <>
      <div style={markStyle(true, true)} />
      <div style={markStyle(true, false)} />
      <div style={markStyle(false, true)} />
      <div style={markStyle(false, false)} />
    </>
  );
}

function getRoomColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("bedroom") || n.includes("bed")) return "#6366F1";
  if (n.includes("kitchen")) return "#F59E0B";
  if (n.includes("bathroom") || n.includes("bath")) return "#14B8A6";
  if (n.includes("living")) return "#10B981";
  if (n.includes("wc") || n.includes("toilet")) return "#64748B";
  if (n.includes("stair")) return "#8B5CF6";
  if (n.includes("balcony") || n.includes("terrace")) return "#06B6D4";
  if (n.includes("hall") || n.includes("corridor")) return "#A1A1AA";
  if (n.includes("dining")) return "#E11D48";
  if (n.includes("office") || n.includes("study")) return "#2563EB";
  if (n.includes("laundry")) return "#7C3AED";
  if (n.includes("storage") || n.includes("closet")) return "#78716C";
  return "#00F5FF";
}
