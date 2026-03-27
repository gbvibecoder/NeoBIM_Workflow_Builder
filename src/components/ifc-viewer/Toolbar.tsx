"use client";

import React, { useState, useCallback } from "react";
import {
  FolderOpen, Home, Scissors, Ruler, Grid3x3,
  Camera, Maximize, Box, Eye, EyeOff, Palette,
  RotateCcw, ChevronDown, Download, Keyboard,
  Layers, Scan, PanelBottomOpen, X, Waypoints,
} from "lucide-react";
import { UI, SHORTCUTS } from "./constants";
import type {
  ViewModeType,
  ColorByType,
  SectionAxis,
  PresetView,
  IFCModelInfo,
  ViewportHandle,
} from "@/types/ifc-viewer";

interface ToolbarProps {
  viewportRef: React.RefObject<ViewportHandle | null>;
  modelInfo: IFCModelInfo | null;
  onOpenFile: () => void;
  onUnload: () => void;
  bottomPanelOpen: boolean;
  onToggleBottomPanel: () => void;
  showShortcuts: boolean;
  onToggleShortcuts: () => void;
  measureUnit: "m" | "ft";
  onToggleUnit: () => void;
}

/* ─── Shared button style ─────────────────── */
const btnBase: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: UI.radius.sm,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "transparent",
  color: UI.text.secondary,
  cursor: "pointer",
  transition: UI.transition,
  position: "relative",
};

const btnHover: React.CSSProperties = {
  background: "rgba(99,130,255,0.12)",
  borderColor: "rgba(99,130,255,0.2)",
  color: UI.text.primary,
  boxShadow: "0 0 8px rgba(99,130,255,0.08)",
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 24,
  background: UI.border.subtle,
  margin: "0 4px",
  flexShrink: 0,
};

/* ─── ToolBtn Component ───────────────────── */
function ToolBtn({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
  disabled,
  dropdown,
  showLabel,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  dropdown?: React.ReactNode;
  showLabel?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [showDrop, setShowDrop] = useState(false);

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => { setHover(true); if (dropdown) setShowDrop(true); }}
      onMouseLeave={() => { setHover(false); setShowDrop(false); }}
    >
      <button
        onClick={() => {
          if (dropdown) setShowDrop((p) => !p);
          else onClick();
        }}
        disabled={disabled}
        title={`${label}${shortcut ? ` (${shortcut})` : ""}`}
        style={{
          ...btnBase,
          ...(showLabel ? { width: "auto", padding: "0 10px", gap: 5 } : {}),
          ...(hover || active ? btnHover : {}),
          ...(active ? { color: UI.accent.blue, borderColor: "rgba(79,138,255,0.25)", background: "rgba(79,138,255,0.1)", boxShadow: "0 0 12px rgba(79,138,255,0.15)" } : {}),
          opacity: disabled ? 0.35 : 1,
        }}
      >
        <Icon size={showLabel ? 15 : 18} />
        {showLabel && (
          <span style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>{label}</span>
        )}
        {dropdown && (
          <ChevronDown size={10} style={{ ...(showLabel ? { marginLeft: 2 } : { position: "absolute" as const, right: 2, bottom: 4 }), opacity: 0.5 }} />
        )}
      </button>
      {dropdown && showDrop && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            paddingTop: 4,
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: UI.bg.elevated,
              border: `1px solid ${UI.border.default}`,
              borderRadius: UI.radius.md,
              padding: 4,
              minWidth: 140,
              boxShadow: UI.shadow.panel,
            }}
          >
            {dropdown}
          </div>
        </div>
      )}
    </div>
  );
}

function DropItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "block",
        width: "100%",
        padding: "6px 12px",
        borderRadius: 4,
        border: "none",
        background: h ? "rgba(99,130,255,0.08)" : "transparent",
        color: active ? UI.accent.blue : UI.text.secondary,
        fontSize: 13,
        textAlign: "left",
        cursor: "pointer",
        transition: UI.transition,
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

export function Toolbar({
  viewportRef,
  modelInfo,
  onOpenFile,
  onUnload,
  bottomPanelOpen,
  onToggleBottomPanel,
  showShortcuts,
  onToggleShortcuts,
  measureUnit,
  onToggleUnit,
}: ToolbarProps) {
  const [viewMode, setViewMode] = useState<ViewModeType>("shaded");
  const [colorBy, setColorBy] = useState<ColorByType>("default");
  const [measuring, setMeasuring] = useState(false);
  const [ortho, setOrtho] = useState(false);

  const v = viewportRef.current;
  const hasModel = modelInfo !== null;

  const doSetViewMode = useCallback((m: ViewModeType) => {
    setViewMode(m);
    v?.setViewMode(m);
  }, [v]);

  const doSetColorBy = useCallback((c: ColorByType) => {
    setColorBy(c);
    v?.setColorBy(c);
  }, [v]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 12px",
          background: UI.bg.toolbar,
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          flexWrap: "wrap",
          minHeight: 48,
          position: "relative",
          zIndex: 30,
        }}
      >
        {/* File */}
        <ToolBtn icon={FolderOpen} label="Open" onClick={onOpenFile} showLabel />

        {hasModel && (
          <>
            <div style={dividerStyle} />

            {/* Navigation */}
            <ToolBtn icon={Home} label="Fit All" shortcut="F" onClick={() => v?.fitToView()} showLabel />
            <ToolBtn icon={Maximize} label="Fit" shortcut="V" onClick={() => v?.fitToSelection()} />

            <ToolBtn
              icon={Box}
              label="Views"
              showLabel
              onClick={() => {}}
              dropdown={
                <>
                  {(["front", "back", "left", "right", "top", "bottom", "iso"] as PresetView[]).map((view) => (
                    <DropItem key={view} label={view.charAt(0).toUpperCase() + view.slice(1)} onClick={() => v?.setPresetView(view)} />
                  ))}
                </>
              }
            />

            <div style={dividerStyle} />

            {/* Tools */}
            <ToolBtn
              icon={Scissors}
              label="Section"
              shortcut="S"
              showLabel
              onClick={() => v?.toggleSectionPlane("x")}
              dropdown={
                <>
                  {(["x", "y", "z"] as SectionAxis[]).map((axis) => (
                    <DropItem key={axis} label={`Section ${axis.toUpperCase()}`} onClick={() => v?.toggleSectionPlane(axis)} />
                  ))}
                </>
              }
            />
            <ToolBtn
              icon={Ruler}
              label={measuring ? "Stop" : "Measure"}
              shortcut="M"
              active={measuring}
              showLabel
              onClick={() => {
                if (measuring) {
                  v?.cancelMeasurement();
                  setMeasuring(false);
                } else {
                  v?.startMeasurement();
                  setMeasuring(true);
                }
              }}
            />
            {/* Unit toggle (m/ft) */}
            <button
              onClick={onToggleUnit}
              title={`Switch to ${measureUnit === "m" ? "feet/inches" : "meters"}`}
              style={{
                ...btnBase,
                width: "auto",
                padding: "0 8px",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-jetbrains)",
                color: UI.text.secondary,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = UI.text.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = UI.text.secondary; }}
            >
              {measureUnit}
            </button>

            <div style={dividerStyle} />

            {/* Visual */}
            <ToolBtn
              icon={Eye}
              label="Style"
              showLabel
              onClick={() => {}}
              dropdown={
                <>
                  <DropItem label="Shaded" active={viewMode === "shaded"} onClick={() => doSetViewMode("shaded")} />
                  <DropItem label="Wireframe" active={viewMode === "wireframe"} onClick={() => doSetViewMode("wireframe")} />
                  <DropItem label="X-Ray" active={viewMode === "xray"} onClick={() => doSetViewMode("xray")} />
                </>
              }
            />
            <ToolBtn
              icon={Palette}
              label="Color By"
              onClick={() => {}}
              dropdown={
                <>
                  <DropItem label="Default" active={colorBy === "default"} onClick={() => doSetColorBy("default")} />
                  <DropItem label="By Storey" active={colorBy === "storey"} onClick={() => doSetColorBy("storey")} />
                  <DropItem label="By Category" active={colorBy === "category"} onClick={() => doSetColorBy("category")} />
                </>
              }
            />
            <ToolBtn icon={Grid3x3} label="Toggle Grid" onClick={() => v?.toggleGrid()} />
            <ToolBtn icon={Layers} label="Toggle Edges" onClick={() => v?.toggleEdges()} />
            <ToolBtn
              icon={Waypoints}
              label={ortho ? "Perspective" : "Orthographic"}
              active={ortho}
              onClick={() => {
                const next = !ortho;
                setOrtho(next);
                v?.setProjection(next ? "orthographic" : "perspective");
              }}
            />

            <div style={dividerStyle} />

            {/* Selection actions */}
            <ToolBtn icon={EyeOff} label="Hide Selected" shortcut="H" onClick={() => v?.hideSelected()} />
            <ToolBtn icon={Scan} label="Isolate Selected" shortcut="I" onClick={() => v?.isolateSelected()} />
            <ToolBtn icon={RotateCcw} label="Show All" shortcut="A" onClick={() => v?.showAll()} />

            <div style={dividerStyle} />

            {/* Export */}
            <ToolBtn icon={Camera} label="Screenshot" shortcut="P" onClick={() => v?.takeScreenshot()} />
            <ToolBtn
              icon={Download}
              label="Export CSV"
              onClick={() => {
                const csv = v?.getCSVData();
                if (!csv) return;
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `ifc-elements-${Date.now()}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            />
          </>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right side */}
        {hasModel && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              color: UI.text.tertiary,
              fontSize: 11,
              fontFamily: "var(--font-jetbrains)",
              padding: "4px 12px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              letterSpacing: "0.3px",
            }}>
              {modelInfo.schema} · {modelInfo.elementCount} elements · {(modelInfo.fileSize / (1024 * 1024)).toFixed(1)} MB
            </span>
            <ToolBtn
              icon={PanelBottomOpen}
              label="Toggle Panels"
              active={bottomPanelOpen}
              onClick={onToggleBottomPanel}
            />
            <ToolBtn icon={Keyboard} label="Shortcuts" shortcut="?" onClick={onToggleShortcuts} />
            <ToolBtn
              icon={X}
              label="Close Model"
              onClick={onUnload}
            />
          </div>
        )}
      </div>

      {/* Shortcuts modal */}
      {showShortcuts && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            zIndex: 9990,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={onToggleShortcuts}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              borderRadius: UI.radius.lg,
              background: UI.bg.card,
              border: `1px solid ${UI.border.default}`,
              padding: 24,
              boxShadow: UI.shadow.panel,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ color: UI.text.primary, fontSize: 16, fontWeight: 600 }}>Keyboard Shortcuts</h3>
              <button
                onClick={onToggleShortcuts}
                style={{ background: "none", border: "none", color: UI.text.tertiary, cursor: "pointer" }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.values(SHORTCUTS).map((s) => (
                <div key={s.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: UI.text.secondary, fontSize: 13 }}>{s.description}</span>
                  <kbd
                    style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.04)",
                      border: `1px solid ${UI.border.subtle}`,
                      color: UI.text.primary,
                      fontSize: 12,
                      fontFamily: "var(--font-jetbrains)",
                    }}
                  >
                    {s.label}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
