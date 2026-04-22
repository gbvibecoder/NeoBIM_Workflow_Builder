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
import { Sparkles, PanelRightClose, PanelRightOpen } from "lucide-react";
import { IFCEnhancerPanel, type EnhanceSuccess } from "@/features/ifc/components/IFCEnhancerPanel";
import { IFCEnhancePanel } from "@/features/ifc/components/IFCEnhancePanel";

/**
 * Sidebar tab identifiers.
 *
 * Historically `"enhance"` referenced the IFC-text mutator panel (add floor,
 * remove floor, add room). As of Phase 1 of the new Enhance-with-AI feature
 * that panel is renamed "Editor" (`"editor"`), and `"enhance-ai"` is the new
 * 4th tab that (in later phases) applies visual-only enhancements.
 */
type SidebarTab = "tree" | "properties" | "editor" | "enhance-ai";
import {
  saveLastIFCFile,
  loadLastIFCFile,
  clearLastIFCFile,
} from "@/features/ifc/lib/ifc-cache";
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
      /* "mobile" triggers the bottom-sheet panel UX; reserve it for truly
         phone-sized widths (portrait iPhone ≈ 390–430, landscape up to ~820).
         Tablets and narrow laptop windows stay on the right-side panel. */
      setBp(w <= 480 ? "mobile" : w <= 1024 ? "tablet" : "desktop");
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
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<SidebarTab>("editor");
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuData | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [measureUnit, setMeasureUnit] = useState<"m" | "ft">("m");
  const [cameraCSS, setCameraCSS] = useState("rotateX(0deg) rotateY(0deg)");
  const [panelWidth, setPanelWidth] = useState(360);
  const [currentFile, setCurrentFile] = useState<{ name: string; buffer: ArrayBuffer } | null>(null);

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
      /* Cap max at 70% of window width so the panel can never fully swallow
         the viewport on narrow laptop windows. Min 240 keeps forms readable. */
      const cap = Math.min(640, Math.floor(window.innerWidth * 0.7));
      setPanelWidth(Math.max(240, Math.min(cap, newWidth)));
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

  /* Directly hand an already-read buffer to the 3D viewer. Used both by the
     normal upload flow (after FileReader finishes) and by the refresh-time
     cache restore (no FileReader needed — we persisted the bytes). */
  const loadBufferIntoViewer = useCallback(
    async (buffer: ArrayBuffer, filename: string, opts?: { cache?: boolean }) => {
      /* Persist BEFORE the transfer. saveLastIFCFile copies the bytes
         into a Blob synchronously (before any await), so the snapshot is
         captured in-microtask — before loadFile's postMessage detaches
         the original buffer. */
      if (opts?.cache !== false) {
        void saveLastIFCFile(buffer, filename);
      }
      /* Also keep an in-memory copy so the IFC Enhancer can read the bytes
         without a round-trip to IndexedDB. Must slice BEFORE loadFile since
         the worker transfer neuters the original ArrayBuffer. */
      setCurrentFile({ name: filename, buffer: buffer.slice(0) });
      if (!viewportRef.current?.loadFile) {
        console.warn("[ifc-restore] loadBufferIntoViewer called but viewport not ready");
        setLoading(false);
        return;
      }
      try {
        await viewportRef.current.loadFile(buffer, filename);
        console.info("[ifc-restore] loadFile dispatched to worker");
      } catch (err) {
        console.warn("[ifc-restore] loadFile threw:", err);
        setError(err instanceof Error ? err.message : "Failed to load file");
        setLoading(false);
        void clearLastIFCFile();
      }
    },
    []
  );

  /* Callbacks */
  const handleFileSelected = useCallback(
    async (file: File) => {
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
        await loadBufferIntoViewer(buffer, file.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
        setLoading(false);
        /* Clear the cached file on load failure so the next refresh doesn't
           retry the same broken file and wedge the viewer in an error state. */
        void clearLastIFCFile();
      }
    },
    [loadBufferIntoViewer]
  );

  /* On mount, rehydrate the last-opened file so a page refresh doesn't drop
     the user back to an empty upload screen.

     No restoreAttemptedRef-style guard: Next.js dev enables React Strict
     Mode (mount → cleanup → remount). A flag-based guard flipped on mount
     #1 combined with mount #1's cleanup cancelling the async IIFE would
     starve the restore of oxygen — mount #2 would early-return on the
     flag. The per-closure `cancelled` lets mount #2 re-attempt with a
     fresh closure, and `viewport.loadFile()` calls `clearModel()` first,
     so even a double-run is idempotent (just mildly wasteful). */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      /* Flip loading UI on IMMEDIATELY. The IDB open + cache read takes a
         few ms and the viewport readiness poll takes at least one tick;
         without this, the empty upload screen flashes before the restore
         kicks in — which is exactly what the user is seeing. */
      setLoading(true);
      setLoadProgress(0);
      setLoadMessage("Checking for last model...");
      setError(null);

      console.info("[ifc-restore] mount — checking cache");
      const cached = await loadLastIFCFile();
      if (cancelled) { console.info("[ifc-restore] cancelled after cache read"); return; }
      if (!cached || !cached.buffer || cached.buffer.byteLength === 0) {
        console.info("[ifc-restore] no cached file — showing upload zone");
        setLoading(false);
        return;
      }
      console.info(`[ifc-restore] cache hit: ${cached.name} (${cached.buffer.byteLength} bytes)`);

      /* Wait briefly for Viewport's mount effect to wire up the imperative
         handle (useImperativeHandle) and initialize the Three.js scene. */
      const waitForViewport = async (): Promise<boolean> => {
        for (let i = 0; i < 50; i++) { // up to ~5s
          if (cancelled) return false;
          if (viewportRef.current?.loadFile) return true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return false;
      };

      const ready = await waitForViewport();
      if (!ready || cancelled) {
        console.warn("[ifc-restore] viewport never became ready — aborting restore");
        setLoading(false);
        return;
      }
      console.info("[ifc-restore] viewport ready — dispatching to loadFile");

      setLoadMessage("Restoring last model...");
      await loadBufferIntoViewer(cached.buffer, cached.name, { cache: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [loadBufferIntoViewer]);

  const handleProgress = useCallback((progress: number, message: string) => {
    setLoadProgress(progress);
    setLoadMessage(message);
  }, []);

  const handleLoadComplete = useCallback(() => {
    setLoading(false);
    setBottomPanelOpen(true);
    /* Snap to Editor tab after a fresh load so the feature surface is the
       first thing the user sees — they just dropped a file in, now they can
       modify it. Users can manually switch to Tree/Properties/Enhance any time. */
    setBottomTab("editor");
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
    setCurrentFile(null);
    /* User explicitly closed the model — drop the cached file so the next
       refresh shows the empty upload screen again. */
    void clearLastIFCFile();
  }, []);

  const handleApplyEnhancement = useCallback(
    async (res: EnhanceSuccess) => {
      /* Snapshot the current working buffer BEFORE loading the enhanced
         file. If the enhanced IFC crashes the web-ifc parser (schema edge
         cases), we restore the previous file so the user isn't stranded
         with an empty viewer and a cleared cache. */
      const fallback = currentFile
        ? { name: currentFile.name, buffer: currentFile.buffer.slice(0) }
        : null;

      try {
        await viewportRef.current?.loadFile(res.modifiedBuffer.slice(0), res.filename);
        /* Enhanced file loaded successfully — persist it as the new current file. */
        setCurrentFile({ name: res.filename, buffer: res.modifiedBuffer.slice(0) });
        void saveLastIFCFile(res.modifiedBuffer, res.filename);
      } catch (err) {
        console.warn("[ifc-enhance] enhanced file failed to load, restoring previous:", err);
        setError(
          `The modified IFC couldn't be parsed — restoring the previous model. (${
            err instanceof Error ? err.message : "unknown error"
          })`,
        );
        if (fallback) {
          try {
            await viewportRef.current?.loadFile(fallback.buffer, fallback.name);
            setCurrentFile({ name: fallback.name, buffer: fallback.buffer.slice(0) });
          } catch (restoreErr) {
            console.error("[ifc-enhance] fallback also failed:", restoreErr);
          }
        }
      }
    },
    [currentFile],
  );

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

        {/* ── Right sidebar — ALWAYS visible when a model is loaded, on ALL
            viewport sizes. `bottomPanelOpen` only controls whether it's
            expanded (full width with tabs & content) or collapsed to a 56px
            icon rail. No breakpoint gate: on narrow windows the viewport is
            cramped but the sidebar is guaranteed visible. The bright cyan
            border-left + outer glow makes it unmistakable. */}
        {hasModel && (
          <div
            style={{
              width: bottomPanelOpen ? (bp === "tablet" || bp === "mobile" ? 260 : panelWidth) : 56,
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              borderLeft: "2px solid rgba(0,245,255,0.5)",
              background: "rgba(12,12,20,0.98)",
              backdropFilter: "blur(12px)",
              boxShadow: "-8px 0 24px rgba(0,0,0,0.5), inset 2px 0 0 rgba(0,245,255,0.12)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transition: "width 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
              zIndex: 20,
            }}
          >
            {/* Resize handle — shown whenever the panel is expanded */}
            {bottomPanelOpen && (
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

            {bottomPanelOpen ? (
              <>
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
                  {(["tree", "properties", "editor", "enhance-ai"] as const).map((tab) => {
                    const active = bottomTab === tab;
                    const label =
                      tab === "tree" ? "Tree"
                      : tab === "properties" ? "Properties"
                      : tab === "editor" ? "Editor"
                      : "Enhance";
                    /* Cyan accent is reserved for the new AI Enhance tab — signals
                       it's the flagship feature. Editor uses the standard blue. */
                    const isEnhanceAI = tab === "enhance-ai";
                    const activeColor = isEnhanceAI ? UI.accent.cyan : UI.accent.blue;
                    return (
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
                          borderBottomColor: active ? activeColor : "transparent",
                          color: active ? activeColor : UI.text.tertiary,
                          fontSize: 10.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          transition: "color 0.15s",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 5,
                        }}
                      >
                        {isEnhanceAI && <Sparkles size={11} strokeWidth={2.2} />}
                        {label}
                      </button>
                    );
                  })}
                  {/* Minimize button */}
                  <button
                    onClick={() => setBottomPanelOpen(false)}
                    title="Minimize panel ([ key)"
                    aria-label="Minimize side panel"
                    style={{
                      width: 34,
                      height: 34,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "none",
                      border: "none",
                      color: UI.text.secondary,
                      cursor: "pointer",
                      flexShrink: 0,
                      transition: "color 0.15s, background 0.15s",
                      borderRadius: 6,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = UI.text.primary;
                      e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = UI.text.secondary;
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <PanelRightClose size={16} strokeWidth={2} />
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
                  {bottomTab === "editor" && (
                    <IFCEnhancerPanel
                      sourceFile={currentFile}
                      onApplyToViewer={handleApplyEnhancement}
                    />
                  )}
                  {bottomTab === "enhance-ai" && (
                    <IFCEnhancePanel
                      viewportRef={viewportRef}
                      hasModel={hasModel}
                    />
                  )}
                </div>
              </>
            ) : (
              /* ── Collapsed rail — 48px icon sidebar ── */
              <CollapsedRail
                activeTab={bottomTab}
                onPickTab={(tab) => {
                  setBottomTab(tab);
                  setBottomPanelOpen(true);
                }}
                onExpand={() => setBottomPanelOpen(true)}
              />
            )}
          </div>
        )}

      </div>

    </div>
  );
}

/* ─── Collapsed-rail sidebar (shown when panel is minimized on desktop/tablet) ─── */

interface CollapsedRailProps {
  activeTab: SidebarTab;
  onPickTab: (tab: SidebarTab) => void;
  onExpand: () => void;
}

function CollapsedRail({ activeTab, onPickTab, onExpand }: CollapsedRailProps) {
  const items: {
    id: SidebarTab;
    label: string;
    char: string;
  }[] = [
    { id: "enhance-ai", label: "Enhance", char: "✨" },
    { id: "editor", label: "Editor", char: "✎" },
    { id: "tree", label: "Tree", char: "🗂" },
    { id: "properties", label: "Properties", char: "ⓘ" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 0",
        gap: 4,
        height: "100%",
      }}
    >
      {/* Top: expand button */}
      <button
        type="button"
        onClick={onExpand}
        title="Maximize panel ([ key)"
        aria-label="Maximize side panel"
        style={{
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,245,255,0.08)",
          border: "1px solid rgba(0,245,255,0.3)",
          color: UI.accent.cyan,
          cursor: "pointer",
          borderRadius: 8,
          marginBottom: 6,
          transition: "background 0.15s, transform 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,245,255,0.14)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(0,245,255,0.08)";
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        <PanelRightOpen size={16} strokeWidth={2} />
      </button>

      {/* Tab icons — clicking any expands panel and switches to that tab */}
      {items.map((item) => {
        const isActive = item.id === activeTab;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onPickTab(item.id)}
            title={item.label}
            aria-label={`Open ${item.label}`}
            style={{
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isActive ? "rgba(79,138,255,0.12)" : "transparent",
              border: `1px solid ${isActive ? "rgba(79,138,255,0.35)" : "transparent"}`,
              color: isActive ? UI.accent.blue : UI.text.secondary,
              cursor: "pointer",
              borderRadius: 8,
              fontSize: 15,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (isActive) return;
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              e.currentTarget.style.color = UI.text.primary;
            }}
            onMouseLeave={(e) => {
              if (isActive) return;
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = UI.text.secondary;
            }}
          >
            {item.id === "enhance-ai" ? (
              <Sparkles size={16} strokeWidth={2} />
            ) : (
              <span aria-hidden>{item.char}</span>
            )}
          </button>
        );
      })}

      {/* Vertical label at bottom */}
      <div style={{ flex: 1 }} />
      <span
        style={{
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          fontWeight: 600,
          fontSize: 9,
          color: UI.text.tertiary,
          padding: "8px 0",
        }}
      >
        Enhancer
      </span>
    </div>
  );
}
