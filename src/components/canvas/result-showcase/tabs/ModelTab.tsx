"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useLocale } from "@/hooks/useLocale";
import { COLORS } from "../constants";
import type { ShowcaseData, ProceduralModelData, GlbModelData, HtmlIframeModelData, FloorPlanInteractiveData } from "../useShowcaseData";
import type { FloorPlanGeometry, FloorPlanRoom } from "@/features/floor-plan/types/floor-plan";

const ArchitecturalViewer = dynamic(
  () => import("../../artifacts/architectural-viewer/ArchitecturalViewer"),
  { ssr: false }
);

const Building3DViewer = dynamic(
  () => import("../../artifacts/Building3DViewer"),
  { ssr: false }
);

const BIMViewer = dynamic(
  () => import("../../artifacts/BIMViewer"),
  { ssr: false }
);

const FloorPlanEditor = dynamic(
  () => import("../../artifacts/FloorPlanEditor").then(m => ({ default: m.FloorPlanEditor })),
  { ssr: false }
);

const FloorPlanViewer = dynamic(
  () => import("@/features/floor-plan/components/FloorPlanViewer").then(m => ({ default: m.FloorPlanViewer })),
  { ssr: false, loading: () => <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888", fontSize: 13 }}>Loading Floor Plan Editor...</div> }
);

interface ModelTabProps {
  data: ShowcaseData;
}

// Room type color map
const TYPE_COLORS: Record<string, string> = {
  living: "#4F8AFF", dining: "#6B9FFF", kitchen: "#10B981",
  bedroom: "#8B5CF6", bathroom: "#38BDF8", veranda: "#34D399",
  balcony: "#34D399", hallway: "#F59E0B", entrance: "#FBBF24",
  staircase: "#FB923C", utility: "#6B7280", storage: "#9CA3AF",
  closet: "#6B7280", office: "#8B5CF6", passage: "#F59E0B",
  studio: "#8B5CF6", patio: "#34D399", other: "#94A3B8",
};

// Room type emoji icons
const TYPE_ICONS: Record<string, string> = {
  living: "\u{1F6CB}", dining: "\u{1F37D}", kitchen: "\u{1F373}",
  bedroom: "\u{1F6CF}", bathroom: "\u{1F6BF}", veranda: "\u{1F33F}",
  balcony: "\u{1F33F}", hallway: "\u{1F6AA}", entrance: "\u{1F6AA}",
  staircase: "\u{1F4F6}", utility: "\u{1F527}", storage: "\u{1F4E6}",
  closet: "\u{1F4E6}", office: "\u{1F4BB}", passage: "\u{1F6AA}",
  studio: "\u{1F3A8}", patio: "\u{1F33F}", other: "\u{1F4D0}",
};

export function ModelTab({ data }: ModelTabProps) {
  const { t } = useLocale();
  const model = data.model3dData;
  const [viewMode, setViewMode] = useState<"editor" | "3d">("editor");
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Sanitize SVG content to prevent XSS
  const sanitizedSvg = useMemo(() =>
    typeof window !== "undefined" && data.svgContent
      ? DOMPurify.sanitize(data.svgContent, { USE_PROFILES: { svg: true, svgFilters: true } })
      : ""
  , [data.svgContent]);

  const handleGenerate3D = useCallback(async (geometry: FloorPlanGeometry) => {
    const { buildFloorPlan3D } = await import("@/services/threejs-builder");
    const modelBase = typeof window !== "undefined" ? window.location.origin : "";
    setGeneratedHtml(buildFloorPlan3D(geometry, undefined, modelBase));
    setViewMode("3d");
  }, []);

  // Extract room/building data
  const geometry: FloorPlanGeometry | undefined =
    model?.kind === "floor-plan-editor" ? model.geometry :
    model?.kind === "html-iframe" ? model.geometry :
    undefined;

  const rooms = geometry?.rooms ?? [];
  const walls = geometry?.walls ?? [];
  const bw = geometry?.footprint?.width ?? 0;
  const bd = geometry?.footprint?.depth ?? 0;
  const totalArea = rooms.reduce((sum, r) => sum + (r.area ?? (r.width * r.depth)), 0);
  const roomCount = (model && "roomCount" in model ? model.roomCount : undefined) ?? rooms.length;
  const wallCount = (model && "wallCount" in model ? model.wallCount : undefined) ?? walls.length;
  const aiRenderUrl = (model && "aiRenderUrl" in model ? model.aiRenderUrl : undefined) as string | undefined;
  // Debug: log AI render URL status
  if (model) {
  }

  if (!model && !data.svgContent) {
    return (
      <div style={{
        height: "100%", minHeight: 400,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: COLORS.TEXT_MUTED, fontSize: 13,
        background: "#08080F", borderRadius: 16,
      }}>
        {t('showcase.no3dModel')}
      </div>
    );
  }

  // GN-012 Floor Plan Interactive Editor mode (full CAD editor)
  if (model?.kind === "floor-plan-interactive") {
    const fpProject = model.floorPlanProject;
    const s = model.summary;
    return (
      <div style={{
        height: "100%", minHeight: 600,
        display: "flex", flexDirection: "column",
        background: "#fff", borderRadius: 16,
        overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
      }}>
        {/* Stats bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          padding: "8px 16px",
          borderBottom: "1px solid #e5e7eb",
          background: "#f9fafb",
          fontSize: 11, color: "#6b7280", flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, color: "#111827" }}>{model.label}</span>
          <span>{s.totalRooms} rooms</span>
          <span>{s.totalArea_sqm} m²</span>
          <span>{s.totalWalls} walls</span>
          <span>{s.totalDoors} doors</span>
          <span>{s.totalWindows} windows</span>
          <span style={{ marginLeft: "auto", color: "#3b82f6", fontWeight: 500 }}>
            {s.buildingType} · {s.floorCount} floor{s.floorCount > 1 ? "s" : ""}
          </span>
        </div>
        {/* Full interactive editor */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {fpProject ? (
            <FloorPlanViewer
              initialProject={fpProject}
            />
          ) : (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", color: "#9ca3af", fontSize: 13,
            }}>
              Floor plan project data not available in mock mode.
              <br />Run with a real upstream node to see the interactive editor.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Floor Plan Editor mode (GN-011 with geometry + source image)
  if (model?.kind === "floor-plan-editor") {
    return (
      <FloorPlanLayout
        rooms={rooms} bw={bw} bd={bd} totalArea={totalArea}
        roomCount={roomCount} wallCount={wallCount}
        iframeRef={iframeRef}
        aiRenderUrl={aiRenderUrl}
        geometry={geometry}
        extra={[{ label: "Mode", value: viewMode === "editor" ? "2D Editor" : "Interactive 3D" }]}
      >
        {viewMode === "editor" ? (
          <FloorPlanEditor
            geometry={model.geometry}
            sourceImageUrl={model.sourceImageUrl}
            onGenerate3D={handleGenerate3D}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <button
              onClick={() => setViewMode("editor")}
              style={{
                position: "absolute", top: 12, left: 12, zIndex: 30,
                background: "rgba(8,8,15,0.85)",
                border: "1px solid rgba(79,138,255,0.3)",
                color: "#E0E0E0", fontSize: 12, fontWeight: 500,
                padding: "8px 16px", borderRadius: 8, cursor: "pointer",
                backdropFilter: "blur(8px)",
              }}
            >
              Back to Editor
            </button>
            <HtmlIframeViewer
              model={{
                kind: "html-iframe", url: "",
                content: generatedHtml ?? model.content,
                label: "Generated 3D Floor Plan",
              }}
              iframeRef={iframeRef}
            />
          </div>
        )}
      </FloorPlanLayout>
    );
  }

  // Floor plan HTML viewer (has rooms data)
  const isFloorPlan = model?.kind === "html-iframe" && (rooms.length > 0 || roomCount > 0);

  if (isFloorPlan && model?.kind === "html-iframe") {
    return (
      <FloorPlanLayout
        rooms={rooms} bw={bw} bd={bd} totalArea={totalArea}
        roomCount={roomCount} wallCount={wallCount}
        iframeRef={iframeRef}
        aiRenderUrl={aiRenderUrl}
        geometry={geometry}
      >
        <HtmlIframeViewer model={model} iframeRef={iframeRef} />
      </FloorPlanLayout>
    );
  }

  // Non-floor-plan models (procedural, glb, svg)
  return (
    <div className="model-tab-container" style={{
      display: "flex", gap: 0, height: "100%", minHeight: 500,
      background: "#08080F", borderRadius: 16,
      overflow: "hidden", border: "1px solid rgba(255,255,255,0.04)",
      boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    }}>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {model?.kind === "procedural" && <ProceduralViewer model={model} />}
        {model?.kind === "glb" && <GlbViewer model={model} />}
        {model?.kind === "html-iframe" && <HtmlIframeViewer model={model} />}
        {!model && data.svgContent && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: 24,
            height: "100%", overflow: "auto",
          }}>
            <div dangerouslySetInnerHTML={{ __html: sanitizedSvg }} style={{ width: "100%", height: "100%" }} />
          </div>
        )}
      </div>

      {/* Legacy sidebar for non-floor-plan models */}
      {model && (
        <motion.div
          className="model-tab-sidebar"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          style={{
            width: 260, flexShrink: 0,
            padding: "20px 20px 20px 24px",
            borderLeft: `1px solid ${COLORS.GLASS_BORDER}`,
            overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 16,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
            {t('showcase.buildingSpecs')}
          </div>
          {model.kind === "procedural" && (
            <SpecGrid specs={[
              { label: t('showcase.specBuildingType'), value: model.buildingType },
              { label: t('showcase.specFloors'), value: String(model.floors) },
              { label: t('showcase.specHeight'), value: `${model.height}m` },
              { label: t('showcase.specFootprint'), value: `${model.footprint} m\u00B2` },
              { label: t('showcase.specGfa'), value: `${model.gfa.toLocaleString()} m\u00B2` },
              { label: t('showcase.specRenderer'), value: t('showcase.procedural') },
            ]} />
          )}
          {model.kind === "glb" && (
            <SpecGrid specs={[
              { label: t('showcase.specFormat'), value: t('showcase.glbFormat') },
              ...(model.polycount ? [{ label: t('showcase.specPolycount'), value: model.polycount.toLocaleString() }] : []),
              ...(model.topology ? [{ label: t('showcase.specTopology'), value: model.topology }] : []),
              { label: t('showcase.specRenderer'), value: t('showcase.threejs') },
            ]} />
          )}
        </motion.div>
      )}
    </div>
  );
}

// ─── Floor Plan Layout — Single UI Layer ─────────────────────────────────────

interface FloorPlanLayoutProps {
  children: React.ReactNode;
  rooms: FloorPlanRoom[];
  bw: number;
  bd: number;
  totalArea: number;
  roomCount: number;
  wallCount: number;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  extra?: Array<{ label: string; value: string }>;
  aiRenderUrl?: string;
  geometry?: FloorPlanGeometry;
}

function FloorPlanLayout({
  children, rooms, bw, bd, totalArea, roomCount, wallCount,
  iframeRef, extra, aiRenderUrl, geometry,
}: FloorPlanLayoutProps) {
  const { t } = useLocale();
  const [activeView, setActiveView] = useState("top");
  const [showLabels, setShowLabels] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  // Default to AI Render when available
  const [showAiRender, setShowAiRender] = useState(!!aiRenderUrl);
  const [isWalking, setIsWalking] = useState(false);
  const iframeReadyRef = useRef(false);

  // ── sendCommand: direct contentWindow.buildflowControls calls ──
  function sendCommand(cmd: string, payload?: Record<string, unknown>) {
    const iframe = iframeRef.current ?? document.querySelector('iframe');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe?.contentWindow as any;
    const ctrl = win?.buildflowControls;

    if (ctrl) {
      // Direct call — most reliable, bypasses postMessage entirely
      switch (cmd) {
        case "setTopView": ctrl.topView(); break;
        case "setPerspective": ctrl.perspective(); break;
        case "toggleLabels": ctrl.toggleLabels(); break;
        case "reset": ctrl.reset(); break;
        case "walk": ctrl.walk(); break;
        case "exitWalk": ctrl.exitWalk(); break;
        case "focusRoom": ctrl.focusRoom(payload?.x, payload?.z, payload?.size); break;
      }
      return;
    }

    // Fallback: postMessage (in case buildflowControls isn't exposed yet)
    try {
      win?.postMessage({ type: cmd, ...payload }, '*');
    } catch { /* cross-origin or unavailable */ }

    // Retry via direct call after a short delay if iframe wasn't ready
    if (!iframeReadyRef.current) {
      const retry = () => {
        const el = iframeRef.current ?? document.querySelector('iframe');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = (el?.contentWindow as any);
        const c = w?.buildflowControls;
        if (c) {
          switch (cmd) {
            case "setTopView": c.topView(); break;
            case "setPerspective": c.perspective(); break;
            case "toggleLabels": c.toggleLabels(); break;
            case "reset": c.reset(); break;
            case "walk": c.walk(); break;
            case "exitWalk": c.exitWalk(); break;
            case "focusRoom": c.focusRoom(payload?.x, payload?.z, payload?.size); break;
          }
        } else {
          try { w?.postMessage({ type: cmd, ...payload }, '*'); } catch { /* */ }
        }
      };
      setTimeout(retry, 500);
      setTimeout(retry, 1500);
    }
  }

  // Auto-switch to AI Render when URL becomes available
  useEffect(() => {
    if (aiRenderUrl && !showAiRender) {
      setShowAiRender(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRenderUrl]);

  // Listen for ready handshake from iframe
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (ev.data?.type === 'buildflow-ready') {
        iframeReadyRef.current = true;
      }
      if (ev.data?.type === 'walkModeChanged') {
        setIsWalking(!!ev.data.walking);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="model-tab-container" style={{
      display: "flex",
      height: "calc(100vh - 140px)",
      background: "#08080F",
      borderRadius: 16,
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.04)",
      boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    }}>
      {/* ═══ MAIN CANVAS AREA ═══ */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Layer 1: Three.js iframe fills this entirely */}
        <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "#0A0A14", opacity: showAiRender ? 0 : 1, transition: "opacity 0.4s ease" }}>
          {children}
        </div>

        {/* Layer 1b: AI Render overlay */}
        {aiRenderUrl && showAiRender && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 2, background: "#0A0A14",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={aiRenderUrl}
              alt="AI Photorealistic Render"
              style={{
                width: "100%", height: "100%",
                objectFit: "contain",
              }}
            />
            {/* Caption */}
            <div style={{
              position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)",
              padding: "8px 20px", borderRadius: 10,
              fontSize: 12, color: "#D8B4FE", fontWeight: 500,
              border: "1px solid rgba(139,92,246,0.3)",
              pointerEvents: "none",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 14 }}>&#x2728;</span>
              AI Photorealistic Visualization
              <span style={{ color: "#8B5CF6", fontSize: 10, opacity: 0.7 }}>DALL-E 3 HD</span>
            </div>
          </div>
        )}

        {/* Layer 2: UI overlay — pointer-events: none so clicks pass through
            to the iframe for orbit/pan/zoom. Only child elements with
            pointer-events: auto capture clicks (buttons, stats, etc). */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          pointerEvents: "none",
        }}>
          {/* ── TOP LEFT: Quick Stats ── */}
          <div style={{
            position: "absolute", top: 14, left: 14,
            pointerEvents: "auto",
            display: "flex", gap: 1,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}>
            {[
              { value: String(roomCount || rooms.length), label: "ROOMS", color: "#4F8AFF" },
              { value: totalArea > 0 ? `${totalArea.toFixed(0)}m\u00B2` : "\u2014", label: "AREA", color: "#10B981" },
              { value: bw > 0 ? `${bw.toFixed(0)}\u00D7${bd.toFixed(0)}m` : "\u2014", label: "SIZE", color: "#8B5CF6" },
            ].map((s, i) => (
              <div key={i} style={{
                padding: "10px 18px",
                textAlign: "center",
                borderRight: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none",
              }}>
                <div style={{
                  fontSize: 18, fontWeight: 700, color: s.color,
                  fontFamily: "Inter, system-ui, sans-serif", lineHeight: 1,
                }}>
                  {s.value}
                </div>
                <div style={{
                  fontSize: 9, color: "#555570", marginTop: 4,
                  textTransform: "uppercase", letterSpacing: "0.1em",
                  fontFamily: "Inter, system-ui, sans-serif",
                }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* ── BOTTOM CENTER: Main Toolbar ── */}
          <div style={{
            position: "absolute", bottom: 20, left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "auto",
            display: "flex", alignItems: "center", gap: 3,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderRadius: 14, padding: "5px 6px",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}>
            {([
              ...(aiRenderUrl ? [{ id: "airender", label: "AI Render", active: showAiRender, disabled: false }] : []),
              { id: "orbit", label: "Orbit", active: activeView === "perspective" && !showAiRender && !isWalking, disabled: false },
              { id: "top", label: "Top", active: activeView === "top" && !showAiRender && !isWalking, disabled: false },
              { id: "walk", label: "Walk", active: isWalking, disabled: false },
              { id: "labels", label: "Labels", active: showLabels, disabled: false },
              { id: "reset", label: "Reset", active: false, disabled: false },
              ...(!aiRenderUrl ? [{ id: "airender", label: "AI Render...", active: false, disabled: true }] : []),
            ] as Array<{ id: string; label: string; active: boolean; disabled: boolean }>).map(btn => (
              <button
                key={btn.id}
                disabled={btn.disabled}
                onClick={() => {
                  if (btn.disabled) return;
                  if (btn.id === "airender") {
                    setShowAiRender(v => !v);
                  } else if (btn.id === "orbit") {
                    setShowAiRender(false);
                    setIsWalking(false);
                    setActiveView("perspective");
                    sendCommand("exitWalk");
                    sendCommand("setPerspective");
                  } else if (btn.id === "top") {
                    setShowAiRender(false);
                    setIsWalking(false);
                    setActiveView("top");
                    sendCommand("exitWalk");
                    sendCommand("setTopView");
                  } else if (btn.id === "walk") {
                    setShowAiRender(false);
                    if (isWalking) {
                      setIsWalking(false);
                      sendCommand("exitWalk");
                      setActiveView("perspective");
                      sendCommand("setPerspective");
                    } else {
                      setIsWalking(true);
                      sendCommand("walk");
                    }
                  } else if (btn.id === "labels") {
                    setShowLabels(v => !v);
                    sendCommand("toggleLabels");
                  } else if (btn.id === "reset") {
                    setShowAiRender(false);
                    setActiveView("perspective");
                    sendCommand("reset");
                  }
                }}
                style={{
                  background: btn.disabled
                    ? "rgba(255,255,255,0.02)"
                    : btn.id === "airender"
                      ? (btn.active ? "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(236,72,153,0.3))" : "rgba(139,92,246,0.08)")
                      : btn.id === "walk"
                        ? (btn.active ? "rgba(16,185,129,0.25)" : "rgba(16,185,129,0.08)")
                        : (btn.active ? "rgba(79,138,255,0.25)" : "rgba(255,255,255,0.04)"),
                  border: btn.disabled
                    ? "1px solid rgba(255,255,255,0.04)"
                    : btn.id === "airender"
                      ? (btn.active ? "1px solid rgba(139,92,246,0.6)" : "1px solid rgba(139,92,246,0.2)")
                      : btn.id === "walk"
                        ? (btn.active ? "1px solid rgba(16,185,129,0.6)" : "1px solid rgba(16,185,129,0.2)")
                        : (btn.active ? "1px solid rgba(79,138,255,0.5)" : "1px solid rgba(255,255,255,0.06)"),
                  borderRadius: 10, padding: "8px 18px",
                  color: btn.disabled
                    ? "#3A3A4A"
                    : btn.id === "airender"
                      ? (btn.active ? "#D8B4FE" : "#A78BFA")
                      : btn.id === "walk"
                        ? (btn.active ? "#6EE7B7" : "#10B981")
                        : (btn.active ? "#6CB4FF" : "#7A7A90"),
                  fontSize: 12, fontWeight: btn.active ? 600 : 500,
                  cursor: btn.disabled ? "not-allowed" : "pointer",
                  opacity: btn.disabled ? 0.5 : 1,
                  transition: "all 0.15s ease",
                  fontFamily: "Inter, system-ui, sans-serif",
                  letterSpacing: "0.01em",
                  pointerEvents: "auto",
                }}
                onMouseEnter={e => {
                  if (!btn.active && !btn.disabled) {
                    e.currentTarget.style.color = "#C0C0D0";
                    e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                  }
                }}
                onMouseLeave={e => {
                  if (!btn.active && !btn.disabled) {
                    e.currentTarget.style.color = "#7A7A90";
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                  }
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* ── BOTTOM LEFT: Controls Hint ── */}
          <div style={{
            position: "absolute", bottom: 24, left: 16,
            fontSize: 10, color: "#2A2A40", letterSpacing: "0.02em",
            fontFamily: "JetBrains Mono, monospace",
          }}>
            Left drag: Orbit &middot; Right drag: Pan &middot; Scroll: Zoom &middot; Click: Focus room
          </div>
        </div>
      </div>

      {/* ═══ SIDEBAR: ROOM EXPLORER ═══ */}
      <motion.div
        className="model-tab-sidebar"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: 260,
          background: "#0B0B16",
          borderLeft: "1px solid rgba(255,255,255,0.04)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div style={{
          padding: "18px 18px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 12, fontWeight: 600, color: "#E8E8F0",
            fontFamily: "Inter, system-ui, sans-serif",
            letterSpacing: "0.02em",
          }}>
            ROOM EXPLORER
          </span>
          <span style={{
            fontSize: 11, color: "#4F8AFF", fontWeight: 600,
            fontFamily: "Inter, system-ui, sans-serif",
            background: "rgba(79,138,255,0.08)",
            padding: "3px 8px", borderRadius: 6,
          }}>
            {rooms.length || roomCount}
          </span>
        </div>

        {/* Room List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
          {rooms.length > 0 ? rooms.map((room, i) => {
            const color = TYPE_COLORS[room.type] || "#94A3B8";
            const icon = TYPE_ICONS[room.type] || "\u{1F4D0}";
            const area = (room.area ?? (room.width * room.depth)).toFixed(1);
            const isSelected = selectedRoom === room.name;

            return (
              <div
                key={i}
                onClick={() => {
                  setSelectedRoom(room.name);
                  const rx = (room.x ?? 0) + (room.width ?? 0) / 2;
                  const rz = (room.y ?? 0) + (room.depth ?? 0) / 2;
                  const size = Math.max(room.width ?? 3, room.depth ?? 3);
                  sendCommand("focusRoom", { x: rx, z: rz, size });
                }}
                style={{
                  padding: "12px 18px",
                  cursor: "pointer",
                  borderLeft: `3px solid ${isSelected ? color : "transparent"}`,
                  background: isSelected ? "rgba(79,138,255,0.06)" : "transparent",
                  transition: "all 0.15s ease",
                  display: "flex", alignItems: "center", gap: 12,
                }}
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Room icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: `${color}10`,
                  border: `1px solid ${color}20`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontSize: 16,
                }}>
                  {icon}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 500, color: "#E0E0F0",
                    fontFamily: "Inter, system-ui, sans-serif",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {room.name}
                  </div>
                  <div style={{
                    display: "flex", gap: 8, alignItems: "center", marginTop: 3,
                  }}>
                    <span style={{
                      fontSize: 11, color: "#4A4A60",
                      fontFamily: "JetBrains Mono, Inter, monospace",
                    }}>
                      {room.width?.toFixed(1)}&times;{room.depth?.toFixed(1)}m
                    </span>
                    <span style={{ fontSize: 11, color: "#333345" }}>&bull;</span>
                    <span style={{
                      fontSize: 11, color, fontWeight: 500,
                      fontFamily: "JetBrains Mono, Inter, monospace",
                    }}>
                      {area}m&sup2;
                    </span>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div style={{
              padding: "20px 18px", color: "#5C5C78", fontSize: 12,
              fontFamily: "Inter, system-ui, sans-serif", textAlign: "center",
            }}>
              {roomCount} rooms detected
            </div>
          )}
        </div>

        {/* Building Specs */}
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.04)",
          padding: 18, background: "rgba(0,0,0,0.15)", flexShrink: 0,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: "#333345",
            textTransform: "uppercase", letterSpacing: "0.12em",
            marginBottom: 12, fontFamily: "Inter, system-ui, sans-serif",
          }}>
            Building Specs
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "Width", value: bw > 0 ? `${bw.toFixed(1)}m` : "\u2014", color: "#8B5CF6" },
              { label: "Depth", value: bd > 0 ? `${bd.toFixed(1)}m` : "\u2014", color: "#8B5CF6" },
              { label: "Area", value: totalArea > 0 ? `${totalArea.toFixed(0)}m\u00B2` : "\u2014", color: "#10B981" },
              { label: "Walls", value: String(wallCount), color: "#F59E0B" },
              ...(extra ?? []).map(e => ({ label: e.label, value: e.value, color: "#94A3B8" })),
            ].map((item, i) => (
              <div key={i}>
                <div style={{
                  fontSize: 9, color: "#333345",
                  textTransform: "uppercase", letterSpacing: "0.1em",
                  fontFamily: "Inter, system-ui, sans-serif",
                }}>
                  {item.label}
                </div>
                <div style={{
                  fontSize: 15, color: item.color, fontWeight: 700,
                  fontFamily: "Inter, system-ui, sans-serif", marginTop: 2,
                }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Open in Floor Plan Editor CTA */}
        {geometry && (
          <div style={{
            padding: "12px 18px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            flexShrink: 0,
          }}>
            <button
              onClick={() => {
                // Store geometry in sessionStorage for the floor plan page to pick up
                try {
                  sessionStorage.setItem("fp-editor-geometry", JSON.stringify(geometry));
                  sessionStorage.setItem("fp-editor-prompt", "");
                } catch { /* ignore quota errors */ }
                window.open("/dashboard/floor-plan?source=pipeline", "_blank");
              }}
              style={{
                width: "100%",
                background: "linear-gradient(135deg, rgba(79,138,255,0.15), rgba(139,92,246,0.15))",
                border: "1px solid rgba(79,138,255,0.3)",
                borderRadius: 10, padding: "10px 16px",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "linear-gradient(135deg, rgba(79,138,255,0.25), rgba(139,92,246,0.25))";
                e.currentTarget.style.borderColor = "rgba(79,138,255,0.5)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "linear-gradient(135deg, rgba(79,138,255,0.15), rgba(139,92,246,0.15))";
                e.currentTarget.style.borderColor = "rgba(79,138,255,0.3)";
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F8AFF" strokeWidth="1.5">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: "#C0D4FF",
                  fontFamily: "Inter, system-ui, sans-serif",
                }}>
                  Open in Floor Plan Editor
                </div>
                <div style={{
                  fontSize: 10, color: "#4A4A60",
                  fontFamily: "Inter, system-ui, sans-serif",
                  marginTop: 2,
                }}>
                  CAD editor with Vastu &amp; BOQ analysis
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4A4A60" strokeWidth="1.5">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="15 3 21 3 21 9" stroke="#4A4A60" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="10" y1="14" x2="21" y2="3" stroke="#4A4A60" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: "12px 18px",
          borderTop: "1px solid rgba(255,255,255,0.03)",
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#10B981",
            boxShadow: "0 0 8px rgba(16,185,129,0.4)",
          }} />
          <span style={{
            fontSize: 10, color: "#2A2A40",
            fontFamily: "Inter, system-ui, sans-serif",
          }}>
            {t('showcase.buildflowEngineFooter')}
          </span>
        </div>
      </motion.div>

    </div>
  );
}

// ─── Sub-viewers ─────────────────────────────────────────────────────────────

function ProceduralViewer({ model }: { model: ProceduralModelData }) {
  const styleData = model.style;
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ArchitecturalViewer
        floors={model.floors}
        height={model.height}
        footprint={model.footprint}
        gfa={model.gfa}
        buildingType={model.buildingType}
        style={styleData ? {
          glassHeavy: !!styleData.glassHeavy,
          hasRiver: !!styleData.hasRiver,
          hasLake: !!styleData.hasLake,
          isModern: !!styleData.isModern,
          isTower: !!styleData.isTower,
          exteriorMaterial: (styleData.exteriorMaterial as string) ?? "mixed",
          environment: (styleData.environment as string) ?? "suburban",
          usage: (styleData.usage as string) ?? "mixed",
          promptText: (styleData.promptText as string) ?? "",
          typology: (styleData.typology as string) ?? "generic",
          facadePattern: (styleData.facadePattern as string) ?? "none",
          floorHeightOverride: styleData.floorHeightOverride ? Number(styleData.floorHeightOverride) : undefined,
          maxFloorCap: Number(styleData.maxFloorCap ?? 30),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any : undefined}
      />
    </div>
  );
}

function GlbViewer({ model }: { model: GlbModelData }) {
  const viewerHeight = typeof window !== "undefined" ? window.innerHeight - 180 : 600;

  // Always use BIMViewer for ALL GLB models — it provides ultra-realistic rendering
  // (SSAO, bloom, HDRI sky, 6-light setup, PBR materials) regardless of whether
  // BIM metadata is available. When metadataUrl is absent, BIM-specific features
  // (discipline coloring, element selection) are simply hidden.
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <BIMViewer
        glbUrl={model.glbUrl}
        metadataUrl={model.metadataUrl}
        ifcUrl={model.ifcUrl}
        height={viewerHeight}
      />
    </div>
  );
}

// PostMessage handler + buildflowControls global — injected into old HTML that lacks it
const PM_HANDLER = `<script>
if(!window.__bfMsg){window.__bfMsg=1;
window.addEventListener("message",function(ev){
if(!ev.data||!ev.data.type)return;
var t=ev.data.type;
if(t==="setTopView"&&typeof setMode==="function")setMode("top");
else if(t==="setPerspective"&&typeof setMode==="function")setMode("orbit");
else if(t==="setFrontView"){
if(typeof controls!=="undefined"&&typeof camera!=="undefined"&&typeof animTo==="function"){
controls.enabled=false;
var WH2=typeof WH!=="undefined"?WH:2.8,CX2=typeof CX!=="undefined"?CX:5,CZ2=typeof CZ!=="undefined"?CZ:5,BD2=typeof BD!=="undefined"?BD:10,MXD2=typeof MXD!=="undefined"?MXD:10;
animTo(new THREE.Vector3(CX2,WH2*.5,BD2+MXD2*.7),new THREE.Vector3(CX2,WH2*.4,CZ2),800);
}}
else if(t==="toggleLabels"&&typeof toggleLabels==="function")toggleLabels();
else if(t==="reset"&&typeof resetCam==="function")resetCam();
else if(t==="screenshot"){
if(typeof renderer!=="undefined"){renderer.render(scene,camera);
var a=document.createElement("a");a.download="buildflow-3d.png";
a.href=renderer.domElement.toDataURL("image/png");a.click();}}
else if(t==="focusRoom"){
var fx=ev.data.x!=null?ev.data.x:CX2,fz=ev.data.z!=null?ev.data.z:CZ2,fs=ev.data.size||ev.data.distance||5;
if(typeof controls!=="undefined"&&typeof animTo==="function"){
var fd=Math.max(fs,3)*1.2+2;
controls.enabled=true;if(typeof mode!=="undefined")mode="orbit";
animTo(new THREE.Vector3(fx+fd*.6,fd*.8,fz+fd*.6),new THREE.Vector3(fx,.5,fz),800);
}}
});
window.buildflowControls={
topView:function(){if(typeof setMode==="function")setMode("top")},
perspective:function(){if(typeof setMode==="function")setMode("orbit")},
toggleLabels:function(){if(typeof toggleLabels==="function")toggleLabels()},
reset:function(){if(typeof resetCam==="function")resetCam()},
focusRoom:function(x,z,s){
if(typeof controls!=="undefined"&&typeof animTo==="function"){
var fd2=Math.max(s||5,3)*1.2+2;controls.enabled=true;
if(typeof mode!=="undefined")mode="orbit";
animTo(new THREE.Vector3(x+fd2*.6,fd2*.8,z+fd2*.6),new THREE.Vector3(x,.5,z),800);
}},
screenshot:function(){
if(typeof renderer!=="undefined"){renderer.render(scene,camera);
var a2=document.createElement("a");a2.download="buildflow-3d.png";
a2.href=renderer.domElement.toDataURL("image/png");a2.click();}}
};
}
<\/script>`;

function injectMessageHandler(html: string): string {
  if (html.includes("__bfMsg") || (html.includes('addEventListener("message"') && html.includes("focusRoom"))) {
    return html; // already has our handler
  }
  // Inject before </body> or at end
  if (html.includes("</body>")) {
    return html.replace("</body>", PM_HANDLER + "</body>");
  }
  return html + PM_HANDLER;
}

function HtmlIframeViewer({
  model,
  iframeRef,
}: {
  model: HtmlIframeModelData;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}) {
  // Prepare HTML content with message handler injected
  const htmlContent = useMemo(() => {
    if (model.content) {
      return injectMessageHandler(model.content);
    }
    return null;
  }, [model.content]);

  // Use blob URL for inline content — more reliable for CDN script loading
  // and allows direct contentWindow.buildflowControls access (same origin)
  const blobUrl = useMemo(() => {
    if (!htmlContent) return null;
    const blob = new Blob([htmlContent], { type: "text/html" });
    return URL.createObjectURL(blob);
  }, [htmlContent]);

  // Clean up blob URL on unmount or when content changes
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const hasUrl = !blobUrl && model.url && model.url.startsWith("http");

  if (!blobUrl && !hasUrl) {
    return (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#07070D", color: COLORS.TEXT_MUTED, fontSize: 13,
      }}>
        No 3D viewer content available
      </div>
    );
  }

  return (
    <div style={{
      width: "100%", height: "100%", position: "relative",
      overflow: "hidden",
    }}>
      <iframe
        ref={(el) => {
          // Forward ref to parent — safe because iframeRef is from useRef()
          if (iframeRef && 'current' in iframeRef) {
            // eslint-disable-next-line react-hooks/immutability, @typescript-eslint/no-explicit-any
            (iframeRef as any).current = el;
          }
        }}
        src={blobUrl ?? model.url}
        title={model.label}
        style={{
          width: "100%", height: "100%",
          border: "none",
          background: "#0A0A14",
          pointerEvents: "auto",
        }}
        allow="fullscreen"
        sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock"
      />
    </div>
  );
}

function SpecGrid({ specs }: { specs: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {specs.map(spec => (
        <div key={spec.label}>
          <div style={{
            fontSize: 9, fontWeight: 500, color: COLORS.TEXT_MUTED,
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2,
          }}>
            {spec.label}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.TEXT_PRIMARY }}>
            {spec.value}
          </div>
        </div>
      ))}
    </div>
  );
}
