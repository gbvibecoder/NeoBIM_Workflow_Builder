"use client";

/* ─── Toolbar — Phase Z.IFC.1 Light Render Studio ──────────────────────────
   Restructured 2026-05-18. The previous 17-button single-strip is replaced
   by four grouped pill clusters (Camera / Section / Style / Visibility+Export)
   plus a left "Upload New + file identity" region and a right "Help + BOQ"
   CTA region. Every viewportRef.current.* call is preserved — only the
   visual composition changes. */

import React, { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  FolderOpen, Home, Scissors, Ruler, Grid3x3,
  Camera, Maximize, Box, Eye, EyeOff, Palette,
  RotateCcw, Download,
  Layers, Scan, X, Waypoints,
  Calculator, Loader2,
  HelpCircle,
} from "lucide-react";
import { UI, SHORTCUTS } from "@/features/ifc/components/constants";
import { ToolGroup, ToolButton } from "@/features/ifc/components/primitives";
import { useLocale } from "@/hooks/useLocale";
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
  /** Back-compat — IFCViewerPage no longer wires this from the X button
      (X was removed), but the Upload-New button in the header still uses it. */
  onUnload?: () => void;
  showShortcuts: boolean;
  onToggleShortcuts: () => void;
  measureUnit: "m" | "ft";
  onToggleUnit: () => void;
  /** Primary CTA — launches BOQ workflow with the currently-loaded IFC. */
  onCalculateBOQ: () => void;
  canCalculateBOQ: boolean;
  boqLaunching: boolean;
}

/* ─── Dropdown popover ────────────────────────────────────────────────── */
function Dropdown({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 100,
        background: UI.bg.paper,
        border: `1px solid ${UI.border.subtle}`,
        borderRadius: UI.radius.md,
        padding: 4,
        minWidth: 160,
        boxShadow: UI.shadow.floating,
      }}
    >
      {children}
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
      type="button"
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "block",
        width: "100%",
        padding: "7px 12px",
        borderRadius: UI.radius.sm,
        border: "none",
        background: h ? UI.bg.cream : "transparent",
        color: active ? UI.accent.blueprint : UI.text.primary,
        fontSize: 12,
        textAlign: "left",
        cursor: "pointer",
        transition: UI.transition,
        fontWeight: active ? 600 : 500,
        fontFamily: UI.font.body,
      }}
    >
      {label}
    </button>
  );
}

/* ─── Upload New button ───────────────────────────────────────────────── */
function UploadNewButton({ onClick }: { onClick: () => void }) {
  const t = useLocale((s) => s.t);
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Open a different IFC file"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: "0 12px",
        background: hover ? "var(--rs-blueprint-soft)" : UI.bg.paper,
        border: `1px solid ${hover ? "var(--rs-blueprint-line)" : UI.border.subtle}`,
        borderRadius: UI.radius.md,
        color: hover ? UI.accent.blueprint : UI.text.primary,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
        transition: UI.transition,
        fontFamily: UI.font.body,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <FolderOpen size={13} strokeWidth={2.2} />
      {t("ifcViewer.uploadNew")}
    </button>
  );
}

/* FileIdentity removed Phase Z.IFC.2 follow-up 2026-05-19 — duplicate of
   the bottom status bar's filename + schema chips. */

/* ─── Help icon button ────────────────────────────────────────────────── */
function HelpButton({ onClick }: { onClick: () => void }) {
  const t = useLocale((s) => s.t);
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${t("ifcViewer.help")} (?)`}
      aria-label={t("ifcViewer.help")}
      style={{
        width: 32,
        height: 32,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: hover ? UI.bg.cream : "transparent",
        border: `1px solid ${UI.border.subtle}`,
        borderRadius: UI.radius.md,
        color: UI.text.secondary,
        cursor: "pointer",
        transition: UI.transition,
        flexShrink: 0,
      }}
    >
      <HelpCircle size={14} strokeWidth={2.2} />
    </button>
  );
}

/* ─── BOQ primary CTA ─────────────────────────────────────────────────── */
function BOQButton({
  disabled,
  loading,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const t = useLocale((s) => s.t);
  const [hover, setHover] = useState(false);
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      onClick={() => !isDisabled && onClick()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={isDisabled}
      title={disabled ? "Upload an IFC first" : "Run the BOQ cost-estimation workflow with this IFC"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: "0 14px",
        background: isDisabled
          ? "var(--rs-blueprint-soft)"
          : hover
            ? "linear-gradient(135deg, var(--rs-blueprint-2) 0%, var(--rs-blueprint) 100%)"
            : "linear-gradient(135deg, var(--rs-blueprint) 0%, var(--rs-blueprint-2) 100%)",
        border: isDisabled ? `1px solid var(--rs-blueprint-line)` : "none",
        color: isDisabled ? UI.text.tertiary : "#FFFFFF",
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: 0.3,
        textTransform: "uppercase",
        borderRadius: UI.radius.md,
        cursor: isDisabled ? "not-allowed" : "pointer",
        transition: UI.transition,
        fontFamily: UI.font.body,
        whiteSpace: "nowrap",
        flexShrink: 0,
        boxShadow: isDisabled
          ? "none"
          : "0 2px 6px rgba(26,77,92,0.22), inset 0 1px 0 rgba(255,255,255,0.18)",
      }}
    >
      {loading ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <Calculator size={13} strokeWidth={2.4} />
      )}
      {t("ifcViewer.calculateBOQ")}
    </button>
  );
}

/* ─── Unit toggle (m / ft) ────────────────────────────────────────────── */
function UnitToggle({ value, onChange }: { value: "m" | "ft"; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      title={`Switch to ${value === "m" ? "feet" : "meters"}`}
      style={{
        height: 24,
        padding: "0 8px",
        margin: "0 2px",
        borderRadius: UI.radius.sm,
        border: `1px solid ${UI.border.subtle}`,
        background: UI.bg.cream,
        color: UI.text.primary,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        fontFamily: UI.font.mono,
        cursor: "pointer",
        transition: UI.transition,
        textTransform: "uppercase",
      }}
    >
      {value}
    </button>
  );
}

/* ─── Toolbar component ───────────────────────────────────────────────── */
export function Toolbar({
  viewportRef,
  modelInfo,
  onOpenFile,
  showShortcuts,
  onToggleShortcuts,
  measureUnit,
  onToggleUnit,
  onCalculateBOQ,
  canCalculateBOQ,
  boqLaunching,
}: ToolbarProps) {
  const t = useLocale((s) => s.t);
  const [viewMode, setViewMode] = useState<ViewModeType>("shaded");
  const [colorBy, setColorBy] = useState<ColorByType>("default");
  const [measuring, setMeasuring] = useState(false);
  const [ortho, setOrtho] = useState(false);

  /* Each dropdown gets its own boolean. Click-to-open with click-outside
     dismissal handled inside Dropdown. */
  const [openMenu, setOpenMenu] = useState<"views" | "section" | "style" | "color" | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const v = viewportRef.current;
  const hasModel = modelInfo !== null;

  const doSetViewMode = useCallback(
    (m: ViewModeType) => {
      setViewMode(m);
      v?.setViewMode(m);
      closeMenu();
    },
    [v, closeMenu],
  );

  const doSetColorBy = useCallback(
    (c: ColorByType) => {
      setColorBy(c);
      v?.setColorBy(c);
      closeMenu();
    },
    [v, closeMenu],
  );

  const downloadCSV = useCallback(() => {
    const csv = v?.getCSVData();
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ifc-elements-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [v]);

  return (
    <>
      <div
        style={{
          /* Phase Z.IFC.2 follow-up 2026-05-19: dropped the outer paper bg,
             border-bottom, and multi-color drafting strip. Toolbar is now
             chromeless — the tool group pills (which already carry their
             own paper bg + border + shadow) float over the 3D canvas grid,
             matching the Canvas SlimLibraryStrip pattern.

             pointer-events: none on the root + auto on each interactive
             child (UploadNew, scrollable tools, Help+BOQ group) lets
             mouse-drag pan/orbit pass through the empty space between
             pills directly to the Viewport canvas below. */
          /* Toolbar content-sized so the parent floating wrapper can
             `justifyContent: center` it for symmetric L/R visual margins
             (Phase Z.IFC.2 follow-up 2026-05-19). */
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: 0,
          height: 40,
          width: "fit-content",
          maxWidth: "100%",
          background: "transparent",
          pointerEvents: "none",
        }}
      >
        {/* LEFT — Upload New only (Phase Z.IFC.2 follow-up 2026-05-19:
            FileIdentity removed — the filename + schema are already shown
            in the bottom status bar, so this was duplicate info eating
            horizontal space and pushing Calculate BOQ into the avatar). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            pointerEvents: "auto",
          }}
        >
          <UploadNewButton onClick={onOpenFile} />
        </div>

        {/* MIDDLE — 4 tool groups (only when a model is loaded) */}
        {hasModel && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: "0 1 auto",
              minWidth: 0,
              overflowX: "auto",
              overflowY: "hidden",
              scrollbarWidth: "thin",
              padding: "0 2px",
              pointerEvents: "auto",
            }}
          >
            {/* Camera group */}
            <ToolGroup label="Camera">
              <ToolButton
                icon={<Home size={14} strokeWidth={2.2} />}
                label={t("ifcViewer.tool.fitAll")}
                shortcut="F"
                onClick={() => v?.fitToView()}
              />
              <ToolButton
                icon={<Maximize size={14} strokeWidth={2.2} />}
                label={t("ifcViewer.tool.fit")}
                shortcut="V"
                onClick={() => v?.fitToSelection()}
              />
              <ToolButton
                icon={<Box size={14} strokeWidth={2.2} />}
                label={t("ifcViewer.tool.views")}
                hasDropdown
                active={openMenu === "views"}
                onClick={() => setOpenMenu(openMenu === "views" ? null : "views")}
              >
                <Dropdown open={openMenu === "views"} onClose={closeMenu}>
                  {(["front", "back", "left", "right", "top", "bottom", "iso"] as PresetView[]).map((view) => (
                    <DropItem
                      key={view}
                      label={t(`ifcViewer.view.${view}` as const)}
                      onClick={() => {
                        v?.setPresetView(view);
                        closeMenu();
                      }}
                    />
                  ))}
                </Dropdown>
              </ToolButton>
              <ToolButton
                icon={<Waypoints size={14} strokeWidth={2.2} />}
                label={ortho ? t("ifcViewer.tool.persp") : t("ifcViewer.tool.ortho")}
                active={ortho}
                onClick={() => {
                  const next = !ortho;
                  setOrtho(next);
                  v?.setProjection(next ? "orthographic" : "perspective");
                }}
              />
            </ToolGroup>

            {/* Section + Measure group */}
            <ToolGroup label="Section + Measure">
              <ToolButton
                icon={<Scissors size={14} strokeWidth={2.2} />}
                label={t("ifcViewer.tool.section")}
                shortcut="S"
                hasDropdown
                active={openMenu === "section"}
                onClick={() => setOpenMenu(openMenu === "section" ? null : "section")}
              >
                <Dropdown open={openMenu === "section"} onClose={closeMenu}>
                  {(["x", "y", "z"] as SectionAxis[]).map((axis) => (
                    <DropItem
                      key={axis}
                      label={t(`ifcViewer.section.${axis}` as const)}
                      onClick={() => {
                        v?.toggleSectionPlane(axis);
                        closeMenu();
                      }}
                    />
                  ))}
                </Dropdown>
              </ToolButton>
              <ToolButton
                icon={<Ruler size={14} strokeWidth={2.2} />}
                label={measuring ? t("ifcViewer.tool.stop") : t("ifcViewer.tool.measure")}
                shortcut="M"
                active={measuring}
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
              <UnitToggle value={measureUnit} onChange={onToggleUnit} />
            </ToolGroup>

            {/* Style group */}
            <ToolGroup label="Style">
              <ToolButton
                icon={<Eye size={14} strokeWidth={2.2} />}
                label={t("ifcViewer.tool.style")}
                hasDropdown
                active={openMenu === "style"}
                onClick={() => setOpenMenu(openMenu === "style" ? null : "style")}
              >
                <Dropdown open={openMenu === "style"} onClose={closeMenu}>
                  <DropItem label={t("ifcViewer.style.shaded")} active={viewMode === "shaded"} onClick={() => doSetViewMode("shaded")} />
                  <DropItem label={t("ifcViewer.style.wireframe")} active={viewMode === "wireframe"} onClick={() => doSetViewMode("wireframe")} />
                  <DropItem label={t("ifcViewer.style.xray")} active={viewMode === "xray"} onClick={() => doSetViewMode("xray")} />
                </Dropdown>
              </ToolButton>
              <ToolButton
                icon={<Palette size={14} strokeWidth={2.2} />}
                label={t("ifcViewer.tool.color")}
                hasDropdown
                active={openMenu === "color"}
                onClick={() => setOpenMenu(openMenu === "color" ? null : "color")}
              >
                <Dropdown open={openMenu === "color"} onClose={closeMenu}>
                  <DropItem label={t("ifcViewer.color.default")} active={colorBy === "default"} onClick={() => doSetColorBy("default")} />
                  <DropItem label={t("ifcViewer.color.storey")} active={colorBy === "storey"} onClick={() => doSetColorBy("storey")} />
                  <DropItem label={t("ifcViewer.color.category")} active={colorBy === "category"} onClick={() => doSetColorBy("category")} />
                </Dropdown>
              </ToolButton>
              <ToolButton
                icon={<Grid3x3 size={14} strokeWidth={2.2} />}
                title={t("ifcViewer.tool.toggleGrid")}
                onClick={() => v?.toggleGrid()}
              />
              <ToolButton
                icon={<Layers size={14} strokeWidth={2.2} />}
                title={t("ifcViewer.tool.toggleEdges")}
                onClick={() => v?.toggleEdges()}
              />
            </ToolGroup>

            {/* Visibility + Export group */}
            <ToolGroup label="Visibility + Export">
              <ToolButton
                icon={<EyeOff size={14} strokeWidth={2.2} />}
                title={t("ifcViewer.tool.hide")}
                shortcut="H"
                onClick={() => v?.hideSelected()}
              />
              <ToolButton
                icon={<Scan size={14} strokeWidth={2.2} />}
                title={t("ifcViewer.tool.isolate")}
                shortcut="I"
                onClick={() => v?.isolateSelected()}
              />
              <ToolButton
                icon={<RotateCcw size={14} strokeWidth={2.2} />}
                title={t("ifcViewer.tool.showAll")}
                shortcut="A"
                onClick={() => v?.showAll()}
              />
              <ToolButton
                icon={<Camera size={14} strokeWidth={2.2} />}
                title={t("ifcViewer.tool.screenshot")}
                shortcut="P"
                onClick={() => v?.takeScreenshot()}
              />
              <ToolButton
                icon={<Download size={14} strokeWidth={2.2} />}
                title={t("ifcViewer.tool.exportCSV")}
                onClick={downloadCSV}
              />
            </ToolGroup>
          </div>
        )}

        {/* Help + BOQ — sit flush against the last tool group (Download).
            Phase Z.IFC.2 follow-up 2026-05-19: the prior `flex:1` spacer
            pushed BOQ to the right edge under the dashboard avatar; this
            new layout lets the buttons flow naturally left-to-right so
            the whole toolbar reads as one continuous family, and the
            empty right zone naturally accommodates the floating avatar
            (no margin hacks needed). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
            pointerEvents: "auto",
          }}
        >
          <HelpButton onClick={onToggleShortcuts} />
          {hasModel && (
            <BOQButton
              disabled={!canCalculateBOQ}
              loading={boqLaunching}
              onClick={onCalculateBOQ}
            />
          )}
        </div>

        {/* Spacer removed Phase Z.IFC.2 follow-up 2026-05-19 — the
            outer floating wrapper now uses `justifyContent: center` to
            center this content, and the Toolbar root is `width:
            fit-content`. Spacer would force the toolbar back to filling
            its parent and break centering. */}
      </div>

      {/* Shortcuts modal */}
      {showShortcuts && (
        <div
          onClick={onToggleShortcuts}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(14,18,24,0.35)",
            backdropFilter: "blur(4px)",
            zIndex: 9990,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 400,
              borderRadius: UI.radius.lg,
              background: UI.bg.paper,
              border: `1px solid ${UI.border.subtle}`,
              padding: 24,
              boxShadow: UI.shadow.floating,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3
                style={{
                  color: UI.text.primary,
                  fontSize: 18,
                  fontWeight: 500,
                  margin: 0,
                  fontFamily: UI.font.display,
                  fontStyle: "italic",
                }}
              >
                Keyboard shortcuts
              </h3>
              <button
                type="button"
                onClick={onToggleShortcuts}
                style={{
                  background: "none",
                  border: "none",
                  color: UI.text.tertiary,
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.values(SHORTCUTS).map((s) => (
                <div
                  key={s.key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 0",
                    borderBottom: `1px dashed ${UI.border.subtle}`,
                  }}
                >
                  <span style={{ color: UI.text.secondary, fontSize: 13, fontFamily: UI.font.body }}>
                    {s.description}
                  </span>
                  <kbd
                    style={{
                      padding: "3px 10px",
                      borderRadius: UI.radius.sm,
                      background: UI.bg.cream,
                      border: `1px solid ${UI.border.subtle}`,
                      color: UI.text.primary,
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: UI.font.mono,
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
