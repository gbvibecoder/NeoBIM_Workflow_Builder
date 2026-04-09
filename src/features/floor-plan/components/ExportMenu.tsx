"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import { exportFloorToDxf, downloadDxf } from "@/features/floor-plan/lib/export-dxf";
import { exportFloorToPdf } from "@/features/floor-plan/lib/export-pdf";
import { exportFloorToSvg, downloadSvg } from "@/features/floor-plan/lib/export-svg";
import type { DxfExportOptions } from "@/features/floor-plan/lib/export-dxf";
import type { PdfExportOptions, PaperSize, PdfScale } from "@/features/floor-plan/lib/export-pdf";
import type { SvgExportOptions } from "@/features/floor-plan/lib/export-svg";
import type { PngDpi, PngExportOptions } from "@/features/floor-plan/lib/export-png";
import type { DisplayUnit } from "@/features/floor-plan/lib/unit-conversion";
import type { FloorPlanProject, Floor } from "@/types/floor-plan-cad";

type ExportFormat = "dxf" | "pdf" | "svg" | "png";

interface FormatOption {
  id: ExportFormat;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

const FORMATS: FormatOption[] = [
  {
    id: "pdf",
    label: "PDF",
    desc: "Print-ready vector PDF with title block",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 5H11M5 8H11M5 11H9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "dxf",
    label: "DXF",
    desc: "AutoCAD-compatible DXF R14 with layers",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 5L11 11M11 5L5 11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "svg",
    label: "SVG",
    desc: "Editable vector (Figma/Illustrator)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 8C5 5 8 3 8 3C8 3 11 5 11 8C11 11 8 13 8 13C8 13 5 11 5 8Z" stroke="currentColor" strokeWidth="1" />
      </svg>
    ),
  },
  {
    id: "png",
    label: "PNG",
    desc: "Raster image (presentations/web)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="5.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1" />
        <path d="M2 11L5 8L8 10L11 7L14 10" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function ExportMenu() {
  const exportMenuOpen = useFloorPlanStore((s) => s.exportMenuOpen);
  const setExportMenuOpen = useFloorPlanStore((s) => s.setExportMenuOpen);
  const project = useFloorPlanStore((s) => s.project);
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const displayUnit = (project?.settings.display_unit ?? "m") as DisplayUnit;

  const [selectedFormat, setSelectedFormat] = useState<ExportFormat | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
        setSelectedFormat(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen, setExportMenuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedFormat) setSelectedFormat(null);
        else setExportMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [exportMenuOpen, selectedFormat, setExportMenuOpen]);

  if (!exportMenuOpen) return null;

  return (
    <div ref={menuRef} className="absolute right-0 top-full mt-1 z-50">
      {exportError && (
        <div className="mb-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow-sm">
          <div className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
            Export failed: {exportError}
          </div>
          <button
            onClick={() => setExportError(null)}
            className="mt-1 text-[10px] font-medium text-red-600 underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {!selectedFormat ? (
        <FormatList
          onSelect={(fmt) => { setExportError(null); setSelectedFormat(fmt); }}
          onClose={() => setExportMenuOpen(false)}
        />
      ) : (
        <SettingsPanel
          format={selectedFormat}
          project={project}
          floor={floor}
          displayUnit={displayUnit}
          exporting={exporting}
          setExporting={setExporting}
          onExportError={(msg) => setExportError(msg)}
          onBack={() => setSelectedFormat(null)}
          onClose={() => {
            setExportMenuOpen(false);
            setSelectedFormat(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Format selection list
// ============================================================

function FormatList({
  onSelect,
  onClose,
}: {
  onSelect: (f: ExportFormat) => void;
  onClose: () => void;
}) {
  return (
    <div className="w-[260px] rounded-lg border border-gray-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Export As</span>
        <button onClick={onClose} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M4 4L10 10M10 4L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="py-1">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            onClick={() => onSelect(f.id)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
          >
            <span className="flex-shrink-0 text-gray-500">{f.icon}</span>
            <div>
              <div className="text-sm font-medium text-gray-800">{f.label}</div>
              <div className="text-[11px] text-gray-500 leading-tight">{f.desc}</div>
            </div>
            <svg className="ml-auto flex-shrink-0 text-gray-300" width="12" height="12" viewBox="0 0 12 12">
              <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Settings panels per format
// ============================================================

function SettingsPanel({
  format,
  project,
  floor,
  displayUnit,
  exporting,
  setExporting,
  onExportError,
  onBack,
  onClose,
}: {
  format: ExportFormat;
  project: ReturnType<typeof useFloorPlanStore.getState>["project"];
  floor: ReturnType<ReturnType<typeof useFloorPlanStore.getState>["getActiveFloor"]>;
  displayUnit: DisplayUnit;
  exporting: boolean;
  setExporting: (v: boolean) => void;
  onExportError?: (msg: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  switch (format) {
    case "pdf":
      return <PdfSettings project={project} floor={floor} displayUnit={displayUnit} exporting={exporting} setExporting={setExporting} onExportError={onExportError} onBack={onBack} onClose={onClose} />;
    case "dxf":
      return <DxfSettings floor={floor} displayUnit={displayUnit} project={project} exporting={exporting} setExporting={setExporting} onExportError={onExportError} onBack={onBack} onClose={onClose} />;
    case "svg":
      return <SvgSettings floor={floor} displayUnit={displayUnit} project={project} exporting={exporting} setExporting={setExporting} onExportError={onExportError} onBack={onBack} onClose={onClose} />;
    case "png":
      return <PngSettings exporting={exporting} setExporting={setExporting} onExportError={onExportError} onBack={onBack} onClose={onClose} project={project} />;
    default:
      return null;
  }
}

// ============================================================
// PDF Settings
// ============================================================

function PdfSettings({
  project,
  floor,
  displayUnit,
  exporting,
  setExporting,
  onExportError,
  onBack,
  onClose,
}: {
  project: FloorPlanProject | null;
  floor: Floor | null;
  displayUnit: DisplayUnit;
  exporting: boolean;
  setExporting: (v: boolean) => void;
  onExportError?: (msg: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [paperSize, setPaperSize] = useState<PaperSize>("A3");
  const [scale, setScale] = useState<PdfScale>("auto");
  const [titleBlock, setTitleBlock] = useState(true);
  const [roomFills, setRoomFills] = useState(true);
  const [dimensions, setDimensions] = useState(true);

  const handleExport = useCallback(async () => {
    if (!project || !floor) return;
    setExporting(true);
    try {
      const options: PdfExportOptions = {
        paperSize,
        scale,
        includeTitleBlock: titleBlock,
        includeRoomFills: roomFills,
        includeDimensions: dimensions,
        displayUnit,
      };
      await exportFloorToPdf(project, floor, options);
      onClose();
    } catch (err) {
      console.error("PDF export failed:", err);
      onExportError?.(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setExporting(false);
    }
  }, [project, floor, paperSize, scale, titleBlock, roomFills, dimensions, displayUnit, setExporting, onClose]);

  return (
    <SettingsShell title="PDF Settings" onBack={onBack} onClose={onClose} exporting={exporting} onExport={handleExport}>
      <SettingsRow label="Paper Size">
        <select value={paperSize} onChange={(e) => setPaperSize(e.target.value as PaperSize)} className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
          <option value="A4">A4 (297 × 210)</option>
          <option value="A3">A3 (420 × 297)</option>
          <option value="A1">A1 (841 × 594)</option>
        </select>
      </SettingsRow>
      <SettingsRow label="Scale">
        <select value={scale} onChange={(e) => setScale(e.target.value as PdfScale)} className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
          <option value="auto">Auto fit</option>
          <option value="1:50">1:50</option>
          <option value="1:100">1:100</option>
          <option value="1:200">1:200</option>
        </select>
      </SettingsRow>
      <SettingsToggle label="Title block" checked={titleBlock} onChange={setTitleBlock} />
      <SettingsToggle label="Room fills" checked={roomFills} onChange={setRoomFills} />
      <SettingsToggle label="Dimensions" checked={dimensions} onChange={setDimensions} />
    </SettingsShell>
  );
}

// ============================================================
// DXF Settings
// ============================================================

function DxfSettings({
  floor,
  displayUnit,
  project,
  exporting,
  setExporting,
  onExportError,
  onBack,
  onClose,
}: {
  floor: Floor | null;
  displayUnit: DisplayUnit;
  project: FloorPlanProject | null;
  exporting: boolean;
  setExporting: (v: boolean) => void;
  onExportError?: (msg: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [includeDimensions, setIncludeDimensions] = useState(true);
  const [includeRoomLabels, setIncludeRoomLabels] = useState(true);
  const [includeGrid, setIncludeGrid] = useState(false);

  const handleExport = useCallback(() => {
    if (!floor || !project) return;
    setExporting(true);
    try {
      const options: DxfExportOptions = {
        includeDimensions,
        includeRoomLabels,
        includeGrid,
        displayUnit,
      };
      const dxfContent = exportFloorToDxf(floor, project.name, options);
      const filename = `${project.name.replace(/[^a-zA-Z0-9]/g, "_")}_floor_plan.dxf`;
      downloadDxf(dxfContent, filename);
      onClose();
    } catch (err) {
      console.error("DXF export failed:", err);
      onExportError?.(err instanceof Error ? err.message : "DXF generation failed");
    } finally {
      setExporting(false);
    }
  }, [floor, project, includeDimensions, includeRoomLabels, includeGrid, displayUnit, setExporting, onClose]);

  return (
    <SettingsShell title="DXF Settings" onBack={onBack} onClose={onClose} exporting={exporting} onExport={handleExport}>
      <SettingsToggle label="Dimensions" checked={includeDimensions} onChange={setIncludeDimensions} />
      <SettingsToggle label="Room labels" checked={includeRoomLabels} onChange={setIncludeRoomLabels} />
      <SettingsToggle label="Grid" checked={includeGrid} onChange={setIncludeGrid} />
      <div className="px-3 py-1.5">
        <p className="text-[10px] text-gray-400">DXF R14 format — compatible with AutoCAD, BricsCAD, LibreCAD</p>
      </div>
    </SettingsShell>
  );
}

// ============================================================
// SVG Settings
// ============================================================

function SvgSettings({
  floor,
  displayUnit,
  project,
  exporting,
  setExporting,
  onExportError,
  onBack,
  onClose,
}: {
  floor: Floor | null;
  displayUnit: DisplayUnit;
  project: FloorPlanProject | null;
  exporting: boolean;
  setExporting: (v: boolean) => void;
  onExportError?: (msg: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [includeRoomFills, setIncludeRoomFills] = useState(true);
  const [includeDimensions, setIncludeDimensions] = useState(true);
  const [includeGrid, setIncludeGrid] = useState(false);

  const handleExport = useCallback(() => {
    if (!floor || !project) return;
    setExporting(true);
    try {
      const options: SvgExportOptions = {
        includeRoomFills,
        includeDimensions,
        includeGrid,
        displayUnit,
      };
      const svgContent = exportFloorToSvg(floor, project.name, options);
      const filename = `${project.name.replace(/[^a-zA-Z0-9]/g, "_")}_floor_plan.svg`;
      downloadSvg(svgContent, filename);
      onClose();
    } catch (err) {
      console.error("SVG export failed:", err);
      onExportError?.(err instanceof Error ? err.message : "SVG generation failed");
    } finally {
      setExporting(false);
    }
  }, [floor, project, includeRoomFills, includeDimensions, includeGrid, displayUnit, setExporting, onClose]);

  return (
    <SettingsShell title="SVG Settings" onBack={onBack} onClose={onClose} exporting={exporting} onExport={handleExport}>
      <SettingsToggle label="Room fills" checked={includeRoomFills} onChange={setIncludeRoomFills} />
      <SettingsToggle label="Dimensions" checked={includeDimensions} onChange={setIncludeDimensions} />
      <SettingsToggle label="Grid" checked={includeGrid} onChange={setIncludeGrid} />
      <div className="px-3 py-1.5">
        <p className="text-[10px] text-gray-400">Clean semantic SVG — all text editable in Figma/Illustrator</p>
      </div>
    </SettingsShell>
  );
}

// ============================================================
// PNG Settings
// ============================================================

function PngSettings({
  exporting,
  setExporting,
  onExportError,
  onBack,
  onClose,
  project,
}: {
  exporting: boolean;
  setExporting: (v: boolean) => void;
  onExportError?: (msg: string) => void;
  onBack: () => void;
  onClose: () => void;
  project: FloorPlanProject | null;
}) {
  const [dpi, setDpi] = useState<PngDpi>(150);
  const [transparent, setTransparent] = useState(false);

  const handleExport = useCallback(async () => {
    // PNG export needs the Konva stage reference — dispatch a custom event
    setExporting(true);
    try {
      const filename = `${(project?.name ?? "floor_plan").replace(/[^a-zA-Z0-9]/g, "_")}_floor_plan.png`;
      const detail: PngExportOptions & { filename: string } = { dpi, transparentBackground: transparent, filename };
      window.dispatchEvent(new CustomEvent("floor-plan-export-png", { detail }));
      // Small delay for the export to process
      await new Promise((r) => setTimeout(r, 500));
      onClose();
    } catch (err) {
      console.error("PNG export failed:", err);
      onExportError?.(err instanceof Error ? err.message : "PNG generation failed");
    } finally {
      setExporting(false);
    }
  }, [dpi, transparent, project, setExporting, onClose]);

  return (
    <SettingsShell title="PNG Settings" onBack={onBack} onClose={onClose} exporting={exporting} onExport={handleExport}>
      <SettingsRow label="Resolution">
        <select value={dpi} onChange={(e) => setDpi(Number(e.target.value) as PngDpi)} className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
          <option value={72}>72 DPI (screen)</option>
          <option value={150}>150 DPI (standard)</option>
          <option value={300}>300 DPI (print)</option>
        </select>
      </SettingsRow>
      <SettingsToggle label="Transparent background" checked={transparent} onChange={setTransparent} />
    </SettingsShell>
  );
}

// ============================================================
// Shared UI primitives
// ============================================================

function SettingsShell({
  title,
  onBack,
  onClose,
  exporting,
  onExport,
  children,
}: {
  title: string;
  onBack: () => void;
  onClose: () => void;
  exporting: boolean;
  onExport: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="w-[260px] rounded-lg border border-gray-200 bg-white shadow-xl">
      <div className="flex items-center border-b border-gray-100 px-2 py-2 gap-1">
        <button onClick={onBack} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M8 3L4 7L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className="text-xs font-semibold text-gray-700 flex-1">{title}</span>
        <button onClick={onClose} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M4 4L10 10M10 4L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="py-1">{children}</div>
      <div className="border-t border-gray-100 p-2">
        <button
          onClick={onExport}
          disabled={exporting}
          className="w-full rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? "Exporting..." : "Export"}
        </button>
      </div>
    </div>
  );
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-xs text-gray-600">{label}</span>
      {children}
    </div>
  );
}

function SettingsToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-xs text-gray-600">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          checked ? "bg-gray-800" : "bg-gray-200"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white transform transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
