"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Viewport } from "@/features/ifc/components/Viewport";
import { UploadZone } from "@/features/ifc/components/UploadZone";
import { Toolbar } from "@/features/ifc/components/Toolbar";
import { ModelTree } from "@/features/ifc/components/ModelTree";
import { PropertiesPanel } from "@/features/ifc/components/PropertiesPanel";
import { IntegrationBanner } from "@/features/ifc/components/IntegrationBanner";
import { ContextMenu, type ContextMenuData } from "@/features/ifc/components/ContextMenu";
import { ViewCube } from "@/features/ifc/components/ViewCube";
import { UI, SHORTCUTS } from "@/features/ifc/components/constants";
import type {
  ViewportHandle,
  IFCElementData,
  SpatialNode,
  IFCModelInfo,
  MeasurementData,
} from "@/types/ifc-viewer";

/* Responsive breakpoint hook */
function useBreakpoint() {
  const [bp, setBp] = useState<"desktop" | "tablet" | "mobile">("desktop");
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setBp(w <= 768 ? "mobile" : w <= 1024 ? "tablet" : "desktop");
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return bp;
}

export default function IFCViewerPage() {
  /* State */
  const [modelInfo, setModelInfo] = useState<IFCModelInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMessage, setLoadMessage] = useState("");
  const [selectedElement, setSelectedElement] = useState<IFCElementData | null>(null);
  const [spatialTree, setSpatialTree] = useState<SpatialNode[]>([]);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<"tree" | "properties">("tree");
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuData | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [measureUnit, setMeasureUnit] = useState<"m" | "ft">("m");
  const [cameraCSS, setCameraCSS] = useState("rotateX(0deg) rotateY(0deg)");
  const [panelWidth, setPanelWidth] = useState(300);

  const viewportRef = useRef<ViewportHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizingRef = useRef(false);
  const bp = useBreakpoint();

  /* Panel resize handler */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      e.preventDefault();
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(220, Math.min(500, newWidth)));
    };
    const onMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const hasModel = modelInfo !== null;

  /* Callbacks */
  const handleFileSelected = useCallback(async (file: File) => {
    setLoading(true);
    setLoadProgress(0);
    setLoadMessage("Reading file...");
    setError(null);

    try {
      /* Read file with progress tracking */
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setLoadProgress(Math.min(pct * 0.05, 5)); // 0-5% for reading
            setLoadMessage(`Reading file... ${pct}%`);
          }
        };
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsArrayBuffer(file);
      });
      await viewportRef.current?.loadFile(buffer, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
      setLoading(false);
    }
  }, []);

  const handleProgress = useCallback((progress: number, message: string) => {
    setLoadProgress(progress);
    setLoadMessage(message);
  }, []);

  const handleLoadComplete = useCallback(() => {
    setLoading(false);
    setBottomPanelOpen(true);
  }, []);

  const handleError = useCallback((message: string) => {
    setError(message);
    setLoading(false);
  }, []);

  const handleSelect = useCallback((element: IFCElementData | null) => {
    setSelectedElement(element);
    if (element) {
      setBottomTab("properties");
      setBottomPanelOpen(true);
    }
  }, []);

  const handleSpatialTree = useCallback((tree: SpatialNode[]) => {
    setSpatialTree(tree);
  }, []);

  const handleModelInfo = useCallback((info: IFCModelInfo) => {
    setModelInfo(info);
    /* Start view cube camera sync */
    viewportRef.current?.onCameraChange(setCameraCSS);
  }, []);

  const handleMeasurement = useCallback((_m: MeasurementData) => {
    /* Could show in a measurements panel */
  }, []);

  const handleContextMenu = useCallback((data: ContextMenuData | null) => {
    setContextMenu(data);
  }, []);

  const handleToggleUnit = useCallback(() => {
    setMeasureUnit((prev) => {
      const next = prev === "m" ? "ft" : "m";
      viewportRef.current?.setMeasureUnit(next);
      return next;
    });
  }, []);

  const handleOpenFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleUnload = useCallback(() => {
    viewportRef.current?.unloadModel();
    setModelInfo(null);
    setSelectedElement(null);
    setSpatialTree([]);
    setBottomPanelOpen(false);
    setError(null);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelected(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFileSelected]
  );

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      /* Global shortcuts (work with or without model) */
      if (e.key === "?") {
        setShowShortcuts((p) => !p);
        return;
      }
      if (e.key === "[") {
        setBottomPanelOpen((p) => !p);
        return;
      }

      /* Model-only shortcuts */
      if (!hasModel) return;
      const v = viewportRef.current;
      if (!v) return;

      switch (e.key.toLowerCase()) {
        case SHORTCUTS.fitToView.key:
          v.fitToView();
          break;
        case SHORTCUTS.fitToSelection.key:
          v.fitToSelection();
          break;
        case SHORTCUTS.hideSelected.key:
          v.hideSelected();
          break;
        case SHORTCUTS.isolateSelected.key:
          v.isolateSelected();
          break;
        case SHORTCUTS.showAll.key:
          v.showAll();
          break;
        case SHORTCUTS.toggleSection.key:
          v.toggleSectionPlane("y");
          break;
        case SHORTCUTS.measure.key:
          v.startMeasurement();
          break;
        case SHORTCUTS.wireframe.key:
          v.setViewMode("wireframe");
          break;
        case SHORTCUTS.xray.key:
          v.setViewMode("xray");
          break;
        case SHORTCUTS.screenshot.key:
          v.takeScreenshot();
          break;
        case "escape":
          v.cancelMeasurement();
          v.showAll();
          setContextMenu(null);
          setShowShortcuts(false);
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasModel]);

  /* ────────────────────────────────────────── */
  /* Render                                     */
  /* ────────────────────────────────────────── */

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: UI.bg.base,
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc"
        style={{ display: "none" }}
        onChange={handleFileInput}
      />

      {/* Toolbar — only show once a model is loaded; the empty state has its own Browse Files CTA */}
      {hasModel && (
        <Toolbar
          viewportRef={viewportRef}
          modelInfo={modelInfo}
          onOpenFile={handleOpenFile}
          onUnload={handleUnload}
          bottomPanelOpen={bottomPanelOpen}
          onToggleBottomPanel={() => setBottomPanelOpen((p) => !p)}
          showShortcuts={showShortcuts}
          onToggleShortcuts={() => setShowShortcuts((p) => !p)}
          measureUnit={measureUnit}
          onToggleUnit={handleToggleUnit}
        />
      )}

      {/* Integration banner — full-width bar between toolbar and viewport */}
      {hasModel && <IntegrationBanner visible={hasModel} />}

      {/* Main content area — row layout for right panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden", position: "relative" }}>
        {/* 3D Viewport area */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <Viewport
            ref={viewportRef}
            onSelect={handleSelect}
            onSpatialTree={handleSpatialTree}
            onModelInfo={handleModelInfo}
            onProgress={handleProgress}
            onLoadComplete={handleLoadComplete}
            onError={handleError}
            onMeasurement={handleMeasurement}
            onContextMenu={handleContextMenu}
          />

          {/* Upload zone overlay */}
          {!hasModel && (
            <UploadZone
              onFileSelected={handleFileSelected}
              onError={handleError}
              loading={loading}
              loadProgress={loadProgress}
              loadMessage={loadMessage}
            />
          )}

          {/* Error overlay */}
          {error && !loading && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: "50%",
                transform: "translateX(-50%)",
                padding: "10px 20px",
                borderRadius: UI.radius.md,
                background: "rgba(248,113,113,0.1)",
                border: "1px solid rgba(248,113,113,0.2)",
                color: UI.accent.red,
                fontSize: 13,
                zIndex: 20,
                maxWidth: "80%",
                textAlign: "center",
              }}
            >
              {error}
              <button
                onClick={() => setError(null)}
                style={{
                  marginLeft: 12,
                  background: "none",
                  border: "none",
                  color: UI.accent.red,
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: 12,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* View cube */}
          {hasModel && <ViewCube viewportRef={viewportRef} cameraMatrixCSS={cameraCSS} />}

          {/* Context menu */}
          {contextMenu && (
            <ContextMenu
              data={contextMenu}
              onHide={() => {
                viewportRef.current?.hideSelected();
                setContextMenu(null);
              }}
              onIsolate={() => {
                viewportRef.current?.isolateSelected();
                setContextMenu(null);
              }}
              onSelectSimilar={() => {
                viewportRef.current?.selectByType(contextMenu.expressID);
                setContextMenu(null);
              }}
              onShowAll={() => {
                viewportRef.current?.showAll();
                setContextMenu(null);
              }}
              onFitToElement={() => {
                viewportRef.current?.fitToSelection();
                setContextMenu(null);
              }}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>

        {/* ── Right panel (desktop/tablet) ── */}
        {hasModel && bottomPanelOpen && bp !== "mobile" && (
          <div
            style={{
              width: bp === "tablet" ? 260 : panelWidth,
              flexShrink: 0,
              borderLeft: "1px solid rgba(255,255,255,0.04)",
              background: "rgba(18,18,30,0.92)",
              backdropFilter: "blur(12px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* Resize handle */}
            {bp === "desktop" && (
              <div
                onMouseDown={() => {
                  resizingRef.current = true;
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
                style={{
                  position: "absolute",
                  left: -2,
                  top: 0,
                  bottom: 0,
                  width: 5,
                  cursor: "col-resize",
                  zIndex: 10,
                  background: "transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(79,138,255,0.3)"; }}
                onMouseLeave={(e) => { if (!resizingRef.current) e.currentTarget.style.background = "transparent"; }}
              />
            )}

            {/* Panel header with tabs */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                background: UI.bg.base,
                flexShrink: 0,
              }}
            >
              {(["tree", "properties"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: bottomTab === tab ? "transparent" : "transparent",
                    borderWidth: 0,
                    borderBottomWidth: 2,
                    borderBottomStyle: "solid",
                    borderBottomColor: bottomTab === tab ? UI.accent.blue : "transparent",
                    color: bottomTab === tab ? UI.accent.blue : UI.text.tertiary,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    transition: "color 0.15s",
                  }}
                >
                  {tab === "tree" ? "Model Tree" : "Properties"}
                </button>
              ))}
              {/* Collapse button */}
              <button
                onClick={() => setBottomPanelOpen(false)}
                title="Collapse panel ([ key)"
                style={{
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "none",
                  border: "none",
                  color: UI.text.tertiary,
                  cursor: "pointer",
                  fontSize: 14,
                  flexShrink: 0,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = UI.text.primary; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = UI.text.tertiary; }}
              >
                &#x203A;
              </button>
            </div>

            {/* Panel content */}
            <div style={{ flex: 1, overflow: "hidden" }}>
              {bottomTab === "tree" && (
                <ModelTree
                  tree={spatialTree}
                  selectedID={selectedElement?.expressID ?? null}
                  viewportRef={viewportRef}
                />
              )}
              {bottomTab === "properties" && <PropertiesPanel element={selectedElement} />}
            </div>
          </div>
        )}

        {/* Collapsed panel toggle (desktop/tablet) */}
        {hasModel && !bottomPanelOpen && bp !== "mobile" && (
          <button
            onClick={() => setBottomPanelOpen(true)}
            title="Open panel ([ key)"
            style={{
              width: 24,
              flexShrink: 0,
              background: UI.bg.base,
              borderWidth: 0,
              borderLeftWidth: 1,
              borderLeftStyle: "solid",
              borderLeftColor: "rgba(255,255,255,0.04)",
              color: UI.text.tertiary,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              transition: "background 0.15s, color 0.15s",
              writingMode: "vertical-lr",
              letterSpacing: "1px",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = UI.bg.hover; e.currentTarget.style.color = UI.text.secondary; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = UI.bg.base; e.currentTarget.style.color = UI.text.tertiary; }}
          >
            &#x2039;
          </button>
        )}

        {/* ── Mobile: bottom sheet ── */}
        {hasModel && bottomPanelOpen && bp === "mobile" && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "60vh",
              zIndex: 30,
              borderRadius: `${UI.radius.lg}px ${UI.radius.lg}px 0 0`,
              boxShadow: "0 -4px 20px rgba(0,0,0,0.4)",
              background: "rgba(18,18,30,0.95)",
              backdropFilter: "blur(12px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Drag indicator */}
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
              <div style={{ width: 32, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)" }} />
            </div>
            {/* Tab header */}
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }}>
              {(["tree", "properties"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: "transparent",
                    borderWidth: 0,
                    borderBottomWidth: 2,
                    borderBottomStyle: "solid",
                    borderBottomColor: bottomTab === tab ? UI.accent.blue : "transparent",
                    color: bottomTab === tab ? UI.accent.blue : UI.text.tertiary,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {tab === "tree" ? "Model Tree" : "Properties"}
                </button>
              ))}
              <button
                onClick={() => setBottomPanelOpen(false)}
                style={{
                  width: 40,
                  background: "none",
                  border: "none",
                  color: UI.text.tertiary,
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                &#x2715;
              </button>
            </div>
            {/* Panel content */}
            <div style={{ flex: 1, overflow: "hidden" }}>
              {bottomTab === "tree" && (
                <ModelTree tree={spatialTree} selectedID={selectedElement?.expressID ?? null} viewportRef={viewportRef} />
              )}
              {bottomTab === "properties" && <PropertiesPanel element={selectedElement} />}
            </div>
          </div>
        )}

        {/* Mobile: FAB to open panel */}
        {hasModel && bp === "mobile" && !bottomPanelOpen && (
          <button
            onClick={() => setBottomPanelOpen(true)}
            style={{
              position: "absolute",
              bottom: 16,
              right: 16,
              width: 48,
              height: 48,
              borderRadius: 24,
              background: UI.accent.blue,
              color: UI.text.primary,
              border: "none",
              fontSize: 18,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(79,138,255,0.4)",
              zIndex: 25,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            &#9776;
          </button>
        )}
      </div>
    </div>
  );
}
