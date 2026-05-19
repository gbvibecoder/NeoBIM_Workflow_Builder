"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Viewport } from "@/features/ifc/components/Viewport";
import { UploadZone } from "@/features/ifc/components/UploadZone";
import { Toolbar } from "@/features/ifc/components/Toolbar";
import { ModelTree } from "@/features/ifc/components/ModelTree";
/* PropertiesPanel — kept on disk but unmounted in Phase Z.IFC.2; the
   Inspect tab was retired. Z.IFC.3 may bring it back as a right-click
   popover. Import preserved as a no-op so the file stays tree-shaken
   out cleanly. */
// import { PropertiesPanel } from "@/features/ifc/components/PropertiesPanel";
import { EditPanel } from "@/features/ifc/components/EditPanel";
import { IntegrationBanner } from "@/features/ifc/components/IntegrationBanner";
import { ContextMenu, type ContextMenuData } from "@/features/ifc/components/ContextMenu";
import { ViewCube } from "@/features/ifc/components/ViewCube";
import { UI, SHORTCUTS } from "@/features/ifc/components/constants";
import { Sparkles, PanelRightClose, PanelRightOpen } from "lucide-react";
import { IFCEnhancerPanel, type EnhanceSuccess } from "@/features/ifc/components/IFCEnhancerPanel";
import { IFCEnhancePanel, type IFCEnhancePanelHandle } from "@/features/ifc/components/IFCEnhancePanel";
import { ViewerSkeleton } from "@/features/ifc/components/ViewerSkeleton";

/**
 * Sidebar tab identifiers — Phase Z.IFC.2 (2026-05-19): collapsed to 2.
 * `tree` shows the spatial-hierarchy panel; `edit` shows the unified
 * EditPanel which merges the prior "Enhance" + "Editor" panels into one
 * scrollable surface. The previous `properties` tab was retired — element
 * inspection will return in Z.IFC.3 as a right-click popover (PropertiesPanel
 * file is kept on disk for that revival).
 */
type SidebarTab = "tree" | "edit";
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

/* `autoEnhance` prop is intentionally accepted-and-ignored (2026-05-18: raw IFC
   by default, auto-apply removed). Page-level callers still pass it; keeping
   the signature stable avoids breaking the public contract. */
export default function IFCViewerPage({ restoreFromCache = false }: { autoEnhance?: boolean; restoreFromCache?: boolean }) {
  /* State */
  const [modelInfo, setModelInfo] = useState<IFCModelInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMessage, setLoadMessage] = useState("");
  const [selectedElement, setSelectedElement] = useState<IFCElementData | null>(null);
  const [spatialTree, setSpatialTree] = useState<SpatialNode[]>([]);
  /* Phase Z.IFC.1 follow-up (2026-05-19): sidebar starts CLOSED by default.
     User opens it explicitly via the CollapsedRail icon column on the right,
     the `[` keyboard shortcut, OR by picking an element in the viewport
     (auto-opens to Inspect — see handleSelect). Canvas-first UX: the 3D
     model gets full horizontal width on first load. */
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<SidebarTab>("edit");
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuData | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [measureUnit, setMeasureUnit] = useState<"m" | "ft">("m");
  const [cameraCSS, setCameraCSS] = useState("rotateX(0deg) rotateY(0deg)");
  const [panelWidth, setPanelWidth] = useState(360);
  const [currentFile, setCurrentFile] = useState<{ name: string; buffer: ArrayBuffer } | null>(null);

  const viewportRef = useRef<ViewportHandle | null>(null);
  const enhancePanelRef = useRef<IFCEnhancePanelHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizingRef = useRef(false);
  const [boqLaunching, setBoqLaunching] = useState(false);
  const bp = useBreakpoint();
  const router = useRouter();

  /* Hydrate persisted panel width once on mount (Phase Z.IFC.1 opportunity
     #8 — keep the user's chosen width across reloads). */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("buildflow.ifc-viewer.panelWidth");
      if (!raw) return;
      const v = parseInt(raw, 10);
      if (Number.isFinite(v) && v >= 320 && v <= 800) {
        setPanelWidth(v);
      }
    } catch {
      /* sandboxed / disabled localStorage — fall back to default 360 */
    }
  }, []);

  /* Panel resize handler */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      e.preventDefault();
      const newWidth = window.innerWidth - e.clientX;
      /* Cap max at 70% of window width so the panel can never fully swallow
         the viewport on narrow laptop windows. Min 240 keeps forms readable. */
      const cap = Math.min(640, Math.floor(window.innerWidth * 0.7));
      /* Phase Z.IFC.2 (2026-05-19): min raised 240 → 320 so the merged
         EditPanel's ApplyHero buttons + PresetGrid 5-column don't crush. */
      setPanelWidth(Math.max(320, Math.min(cap, newWidth)));
    };
    const onMouseUp = () => {
      if (resizingRef.current) {
        try {
          window.localStorage.setItem(
            "buildflow.ifc-viewer.panelWidth",
            String(panelWidth),
          );
        } catch {
          /* ignore */
        }
      }
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
  }, [panelWidth]);

  const hasModel = modelInfo !== null;

  /* Directly hand an already-read buffer to the 3D viewer. Used both by the
     normal upload flow (after FileReader finishes) and by the refresh-time
     cache restore (no FileReader needed — we persisted the bytes). */
  const loadBufferIntoViewer = useCallback(
    async (buffer: ArrayBuffer, filename: string, opts?: { cache?: boolean }) => {
      /* Reset any active Tier 1 enhancement BEFORE the worker re-parses. Once
         the new parse swaps meshMap, the engine's stored originalMaterials
         would point to garbage meshes (memory leak + silent Reset failure). */
      await enhancePanelRef.current?.resetIfApplied();

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
      /* Skip cache restore unless explicitly requested (e.g. execution
         hydration pre-populates IndexedDB before mounting this component).
         Normal navigation should always land on the upload screen. */
      if (!restoreFromCache) {
        console.info("[ifc-restore] restoreFromCache=false — showing upload zone");
        setLoading(false);
        return;
      }

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
  }, [loadBufferIntoViewer, restoreFromCache]);

  const handleProgress = useCallback((progress: number, message: string) => {
    setLoadProgress(progress);
    setLoadMessage(message);
  }, []);

  const handleLoadComplete = useCallback(() => {
    setLoading(false);
    setBottomTab("edit");

    /* Raw IFC by default (2026-05-18): no auto-apply on load. The user
       clicks Apply Enhancement when they want the visual skin.
       Sidebar-closed-by-default (2026-05-19): no auto-open on load either —
       the 3D model gets full width; user opens the panel via the right-edge
       icon column, `[` shortcut, or by picking an element. */
  }, []);

  const handleError = useCallback((message: string) => {
    setError(message);
    setLoading(false);
  }, []);

  const handleSelect = useCallback((element: IFCElementData | null) => {
    setSelectedElement(element);
    /* Phase Z.IFC.2 (2026-05-19): Inspect tab retired. Selection still
       highlights the element in the 3D viewport (the Viewport engine
       handles outline/glow); the sidebar no longer auto-opens nor
       switches tabs on selection. Z.IFC.3 will surface element details
       via a right-click popover. */
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

  /* Calculate BOQ — launch the wf-09 "IFC Model → BOQ Cost Estimate" prebuilt
     workflow with the currently-loaded IFC pre-attached. The IFC bytes are
     already persisted to IndexedDB by loadBufferIntoViewer → saveLastIFCFile,
     and the canvas's FileUploadInput auto-attach effect picks them up when it
     sees ?autoAttachIFC=1 on the URL. Same handoff pattern as IntegrationBanner,
     just promoted to a permanent header CTA. No R2 upload needed. */
  const handleCalculateBOQ = useCallback(() => {
    if (!currentFile || boqLaunching) return;
    setBoqLaunching(true);
    router.push("/dashboard/canvas?template=wf-09&autoAttachIFC=1");
  }, [currentFile, boqLaunching, router]);

  const handleApplyEnhancement = useCallback(
    async (res: EnhanceSuccess) => {
      /* Reset Tier 1 enhancement before the Editor-driven reload — same
         contract as loadBufferIntoViewer. */
      await enhancePanelRef.current?.resetIfApplied();

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
        background: UI.bg.page,
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${UI.border.subtle}`,
        boxShadow: UI.shadow.card,
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc"
        style={{ display: "none" }}
        onChange={handleFileInput}
      />

      {/* Back button + Toolbar — only show once a model is loaded */}
      {/* Toolbar (Phase Z.IFC.1 — Light Render Studio). Owns its own
          Upload New + file identity, so the previous "Back to Upload"
          wrapper button is gone. handleUnload is still invoked when the
          user picks a new file (handleFileSelected wipes prior state).
          Toolbar renders whether or not a model is loaded; the inner
          middle tool strip only appears when hasModel. */}
      <Toolbar
        viewportRef={viewportRef}
        modelInfo={modelInfo}
        onOpenFile={handleOpenFile}
        onUnload={handleUnload}
        showShortcuts={showShortcuts}
        onToggleShortcuts={() => setShowShortcuts((p) => !p)}
        measureUnit={measureUnit}
        onToggleUnit={handleToggleUnit}
        onCalculateBOQ={handleCalculateBOQ}
        canCalculateBOQ={currentFile !== null}
        boqLaunching={boqLaunching}
      />

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

          {/* Skeleton overlay during WASM + IFC parse */}
          <ViewerSkeleton
            visible={loading && !hasModel}
            progress={loadProgress}
            message={loadMessage}
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
              borderLeft: `2px solid var(--rs-blueprint-line)`,
              background: UI.bg.trace,
              boxShadow: "-2px 0 12px rgba(14,18,24,0.06), inset 2px 0 0 var(--rs-blueprint-soft)",
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
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rs-blueprint-line)"; }}
                onMouseLeave={(e) => { if (!resizingRef.current) e.currentTarget.style.background = "transparent"; }}
              />
            )}

            {bottomPanelOpen ? (
              <>
                {/* Panel header with tabs — Phase Z.IFC.1 light theme */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    borderBottom: `1px solid ${UI.border.subtle}`,
                    background: UI.bg.paper,
                    flexShrink: 0,
                  }}
                >
                  {(["edit", "tree"] as const).map((tab) => {
                    const active = bottomTab === tab;
                    const label = tab === "edit" ? "Edit" : "Tree";
                    const isEdit = tab === "edit";
                    return (
                      <button
                        key={tab}
                        onClick={() => setBottomTab(tab)}
                        style={{
                          flex: 1,
                          padding: "10px 0",
                          background: active ? UI.bg.trace : "transparent",
                          borderWidth: 0,
                          borderBottomWidth: 2,
                          borderBottomStyle: "solid",
                          borderBottomColor: active ? "var(--rs-blueprint)" : "transparent",
                          color: active ? UI.text.primary : UI.text.tertiary,
                          fontSize: 10.5,
                          fontWeight: active ? 700 : 600,
                          cursor: "pointer",
                          textTransform: "uppercase",
                          letterSpacing: 0.6,
                          transition: UI.transition,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 5,
                          fontFamily: UI.font.mono,
                        }}
                      >
                        {isEdit && (
                          <Sparkles
                            size={11}
                            strokeWidth={2.2}
                            color={active ? "var(--rs-blueprint)" : UI.text.tertiary}
                          />
                        )}
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
                      e.currentTarget.style.background = "var(--rs-cream)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = UI.text.secondary;
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <PanelRightClose size={16} strokeWidth={2} />
                  </button>
                </div>

                {/* Panel content — Phase Z.IFC.2 (2026-05-19): two tabs
                    only, Tree + the unified EditPanel. EditPanel stays
                    MOUNTED while a model is loaded (just display:none on
                    tab switch) so its inner IFCEnhancePanel engine refs
                    survive — these hold pre-apply material snapshots. */}
                <div style={{ flex: 1, overflow: "hidden" }}>
                  {bottomTab === "tree" && (
                    <ModelTree
                      tree={spatialTree}
                      selectedID={selectedElement?.expressID ?? null}
                      viewportRef={viewportRef}
                    />
                  )}
                  {hasModel && (
                    <div
                      style={{
                        display: bottomTab === "edit" ? "flex" : "none",
                        flexDirection: "column",
                        height: "100%",
                      }}
                    >
                      <EditPanel
                        ref={enhancePanelRef}
                        viewportRef={viewportRef}
                        hasModel={hasModel}
                        sourceFile={currentFile}
                        onApplyToViewer={handleApplyEnhancement}
                      />
                    </div>
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

      {/* Bottom status bar — Phase Z.IFC.1 Light Render Studio.
          SCHEMA · ELEMENTS · SIZE · DETECTED chips + italic Fraunces filename
          on the right. Sits below the viewport flex row; sidebar absolute
          positioning never overlaps it. */}
      {hasModel && modelInfo && (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 16px",
            height: 32,
            background: UI.bg.paper,
            borderTop: `1px solid ${UI.border.subtle}`,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <StatusChip label="Schema" value={modelInfo.schema} />
          <StatusChip label="Elements" value={String(modelInfo.elementCount)} />
          <StatusChip
            label="Size"
            value={`${(modelInfo.fileSize / (1024 * 1024)).toFixed(1)} MB`}
          />
          <StatusChip
            label="Detected"
            value="Residential"
            accent="sage"
          />
          <span style={{ flex: 1 }} />
          {currentFile && (
            <span
              style={{
                fontSize: 12,
                fontStyle: "italic",
                fontFamily: UI.font.display,
                color: UI.text.secondary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "40%",
              }}
              title={currentFile.name}
            >
              {currentFile.name}
            </span>
          )}
        </div>
      )}

    </div>
  );
}

/* ─── Small status chip used by the bottom bar ──────────────────────────── */
function StatusChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "blueprint" | "sage";
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        fontFamily: UI.font.mono,
        letterSpacing: 0.6,
      }}
    >
      <span
        style={{
          color: UI.text.tertiary,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color:
            accent === "sage"
              ? UI.accent.sage
              : accent === "blueprint"
                ? UI.accent.blueprint
                : UI.text.primary,
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </span>
  );
}

/* ─── CollapsedRail — Phase Z.IFC.2 (2026-05-19) ─────────────────────────
   Now matches Canvas/SlimLibraryStrip style (56px wide pill, paper bg,
   40×40 buttons with 16px icon + 7px mono uppercase label, thin dividers).
   Two tabs only after the Inspect retirement: Edit and Tree.            */

interface CollapsedRailProps {
  activeTab: SidebarTab;
  onPickTab: (tab: SidebarTab) => void;
  onExpand: () => void;
}

interface StripBtnProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  variant?: "neutral" | "expand";
}

function StripBtn({ icon, label, active, onClick, variant = "neutral" }: StripBtnProps) {
  const [hover, setHover] = React.useState(false);
  const showActive = active || variant === "expand";
  const activeBg = variant === "expand" ? "var(--rs-blueprint)" : "var(--rs-blueprint-soft)";
  const activeColor = variant === "expand" ? "#FFFFFF" : UI.accent.blueprint;
  const idleColor = variant === "expand" ? UI.accent.blueprint : UI.text.secondary;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        border: "none",
        background: showActive ? activeBg : hover ? UI.bg.cream : "transparent",
        color: showActive ? activeColor : hover ? UI.text.primary : idleColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        position: "relative",
        transition: UI.transition,
        padding: 0,
      }}
    >
      {icon}
      <span
        style={{
          fontFamily: UI.font.mono,
          fontSize: 7,
          letterSpacing: "0.10em",
          marginTop: 2,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {label}
      </span>
    </button>
  );
}

function CollapsedRail({ activeTab, onPickTab, onExpand }: CollapsedRailProps) {
  const divider = (
    <div
      aria-hidden
      style={{ width: "70%", height: 1, background: UI.border.subtle, margin: "6px auto" }}
    />
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: 8,
        gap: 4,
        height: "100%",
        background: UI.bg.paper,
        border: `1px solid ${UI.border.subtle}`,
        borderRadius: 14,
        boxShadow: UI.shadow.paper,
        margin: 6,
      }}
    >
      {/* Expand pill */}
      <StripBtn
        icon={<PanelRightOpen size={16} strokeWidth={2} />}
        label="OPEN"
        active
        variant="expand"
        onClick={onExpand}
      />

      {divider}

      {/* Tab icons — clicking any expands panel AND switches to that tab */}
      <StripBtn
        icon={<Sparkles size={16} strokeWidth={2} />}
        label="EDIT"
        active={activeTab === "edit"}
        onClick={() => onPickTab("edit")}
      />
      <StripBtn
        icon={<TreeIcon />}
        label="TREE"
        active={activeTab === "tree"}
        onClick={() => onPickTab("tree")}
      />
    </div>
  );
}

/* Small tree-glyph SVG — leaner than the previous 🗂 emoji and matches
   the Canvas rail's strokeWidth=2 icon family. */
function TreeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="9" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="6" height="6" rx="1" />
      <path d="M6 9v6a1 1 0 0 0 1 1h8" />
      <path d="M6 9v3a1 1 0 0 0 1 1h8" />
    </svg>
  );
}
