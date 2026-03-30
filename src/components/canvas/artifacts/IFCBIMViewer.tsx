"use client";

/**
 * Embedded IFC BIM Viewer for artifact cards.
 *
 * Wraps the existing Viewport component from src/components/ifc-viewer/
 * to render IFC files inline with a mini toolbar for view controls.
 */

import React, { useRef, useState, useCallback, useEffect } from "react";
import { Viewport } from "@/components/ifc-viewer/Viewport";
import type {
  ViewportHandle,
  IFCElementData,
  SpatialNode,
  IFCModelInfo,
  MeasurementData,
  ViewModeType,
} from "@/types/ifc-viewer";
import {
  Box,
  Eye,
  Grid3X3,
  Maximize2,
  Minimize2,
  RotateCcw,
  Loader2,
  AlertCircle,
  Scissors,
} from "lucide-react";

interface IFCBIMViewerProps {
  downloadUrl: string;
  ifcContent?: string;
  height?: number;
}

export default function IFCBIMViewer({
  downloadUrl,
  ifcContent,
  height = 400,
}: IFCBIMViewerProps) {
  const viewportRef = useRef<ViewportHandle | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("Loading IFC...");
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewModeType>("shaded");
  const [expanded, setExpanded] = useState(false);
  const [modelInfo, setModelInfo] = useState<IFCModelInfo | null>(null);
  const [sectionActive, setSectionActive] = useState(false);

  // Load IFC data once viewport is ready
  const loadTriggered = useRef(false);

  const loadIFC = useCallback(async () => {
    if (loadTriggered.current || !viewportRef.current) return;
    loadTriggered.current = true;

    try {
      let buffer: ArrayBuffer;

      if (ifcContent && !ifcContent.startsWith("data:")) {
        // Raw IFC text content
        buffer = new TextEncoder().encode(ifcContent).buffer;
      } else if (downloadUrl.startsWith("data:")) {
        // Base64 data URI
        const b64 = downloadUrl.split(",")[1];
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        buffer = bytes.buffer;
      } else {
        // Fetch from R2 URL
        const resp = await fetch(downloadUrl);
        if (!resp.ok) throw new Error(`Failed to fetch IFC: ${resp.status}`);
        buffer = await resp.arrayBuffer();
      }

      await viewportRef.current.loadFile(buffer, "model.ifc");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load IFC model");
      setLoading(false);
    }
  }, [downloadUrl, ifcContent]);

  // Trigger load after a small delay to ensure viewport is mounted
  useEffect(() => {
    const timer = setTimeout(loadIFC, 300);
    return () => clearTimeout(timer);
  }, [loadIFC]);

  const handleProgress = useCallback((p: number, msg: string) => {
    setProgress(p);
    setProgressMsg(msg);
  }, []);

  const handleLoadComplete = useCallback(() => {
    setLoading(false);
    viewportRef.current?.fitToView();
  }, []);

  const handleError = useCallback((msg: string) => {
    setError(msg);
    setLoading(false);
  }, []);

  const toggleViewMode = useCallback(() => {
    const modes: ViewModeType[] = ["shaded", "wireframe", "xray"];
    const next = modes[(modes.indexOf(viewMode) + 1) % modes.length];
    setViewMode(next);
    viewportRef.current?.setViewMode(next);
  }, [viewMode]);

  const resetCamera = useCallback(() => {
    viewportRef.current?.fitToView();
  }, []);

  const toggleSection = useCallback(() => {
    const next = !sectionActive;
    setSectionActive(next);
    viewportRef.current?.toggleSectionPlane("y");
  }, [sectionActive]);

  const viewerHeight = expanded ? "80vh" : height;

  const viewModeIcon =
    viewMode === "shaded" ? <Box size={13} /> :
    viewMode === "wireframe" ? <Grid3X3 size={13} /> :
    <Eye size={13} />;

  const viewModeLabel =
    viewMode === "shaded" ? "Shaded" :
    viewMode === "wireframe" ? "Wire" : "X-Ray";

  return (
    <div style={{ padding: "0 12px 8px 14px" }}>
      {/* Viewer container */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: typeof viewerHeight === "number" ? viewerHeight : undefined,
          minHeight: typeof viewerHeight === "string" ? viewerHeight : undefined,
          borderRadius: 8,
          overflow: "hidden",
          background: "#0A0A12",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Viewport */}
        <Viewport
          ref={viewportRef}
          onSelect={() => {}}
          onSpatialTree={() => {}}
          onModelInfo={setModelInfo}
          onProgress={handleProgress}
          onLoadComplete={handleLoadComplete}
          onError={handleError}
          onMeasurement={() => {}}
        />

        {/* Loading overlay */}
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(10,10,18,0.85)",
              zIndex: 10,
            }}
          >
            <Loader2
              size={28}
              style={{ color: "#00F5FF", animation: "spin 1s linear infinite" }}
            />
            <div style={{ fontSize: 11, color: "#8888AA", marginTop: 10 }}>
              {progressMsg}
            </div>
            {progress > 0 && (
              <div
                style={{
                  width: 120,
                  height: 3,
                  background: "rgba(255,255,255,0.08)",
                  borderRadius: 2,
                  marginTop: 8,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                    height: "100%",
                    background: "#00F5FF",
                    borderRadius: 2,
                    transition: "width 0.3s",
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(10,10,18,0.9)",
              zIndex: 10,
            }}
          >
            <AlertCircle size={24} style={{ color: "#FF4466" }} />
            <div style={{ fontSize: 11, color: "#FF4466", marginTop: 8, maxWidth: 200, textAlign: "center" }}>
              {error}
            </div>
          </div>
        )}

        {/* Model info badge */}
        {!loading && modelInfo && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              padding: "3px 8px",
              borderRadius: 4,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(8px)",
              fontSize: 9,
              color: "#8888AA",
              zIndex: 5,
            }}
          >
            {modelInfo.schema} · {modelInfo.elementCount} elements
          </div>
        )}
      </div>

      {/* Mini toolbar */}
      {!error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 6,
            flexWrap: "wrap",
          }}
        >
          {/* View mode toggle */}
          <MiniButton onClick={toggleViewMode} active={viewMode !== "shaded"}>
            {viewModeIcon}
            <span>{viewModeLabel}</span>
          </MiniButton>

          {/* Section cut */}
          <MiniButton onClick={toggleSection} active={sectionActive}>
            <Scissors size={12} />
            <span>Section</span>
          </MiniButton>

          {/* Reset camera */}
          <MiniButton onClick={resetCamera}>
            <RotateCcw size={12} />
            <span>Reset</span>
          </MiniButton>

          {/* Expand/collapse */}
          <MiniButton onClick={() => setExpanded(!expanded)} style={{ marginLeft: "auto" }}>
            {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            <span>{expanded ? "Collapse" : "Expand"}</span>
          </MiniButton>
        </div>
      )}

      {/* Spin animation keyframes */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── Mini toolbar button ───────────────────────────────────────── */

function MiniButton({
  children,
  onClick,
  active = false,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 7px",
        borderRadius: 4,
        background: active ? "rgba(0,245,255,0.12)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${active ? "rgba(0,245,255,0.3)" : "rgba(255,255,255,0.06)"}`,
        fontSize: 9,
        fontWeight: 500,
        color: active ? "#00F5FF" : "#8888AA",
        cursor: "pointer",
        transition: "all 0.15s ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
