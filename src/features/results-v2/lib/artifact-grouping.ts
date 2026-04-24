import type { ExecutionResult, PanelDescriptor, ResultDownload } from "@/features/results-v2/types";

export interface RibbonEntry {
  id: string;
  label: string;
  iconName: "Film" | "Box" | "LayoutGrid" | "Table2" | "FileText" | "Image" | "BarChart3";
  targetPanel: PanelDescriptor["id"];
}

/**
 * Build the sticky artifact ribbon from a normalized result. The ribbon is
 * always led by the terminal artifact (video / 3d / floor plan / etc.),
 * with supporting artifacts appended behind it.
 */
export function buildRibbon(result: ExecutionResult): RibbonEntry[] {
  const entries: RibbonEntry[] = [];

  if (result.video) {
    entries.push({ id: "video", label: "Video", iconName: "Film", targetPanel: "assets" });
  }
  if (result.model3d) {
    entries.push({ id: "model3d", label: "3D Model", iconName: "Box", targetPanel: "assets" });
  }
  if (result.floorPlan) {
    entries.push({ id: "floorPlan", label: "Floor Plan", iconName: "LayoutGrid", targetPanel: "assets" });
  }
  if (result.tables.some(t => t.isBoq)) {
    entries.push({ id: "boq", label: "BOQ", iconName: "Table2", targetPanel: "assets" });
  } else if (result.tables.length > 0) {
    entries.push({ id: "tables", label: "Tables", iconName: "Table2", targetPanel: "assets" });
  }
  if (result.images.length > 0) {
    entries.push({ id: "renders", label: "Renders", iconName: "Image", targetPanel: "assets" });
  }
  if (result.metrics.length > 0) {
    entries.push({ id: "metrics", label: "Metrics", iconName: "BarChart3", targetPanel: "overview" });
  }
  if (hasPdf(result.downloads)) {
    entries.push({ id: "pdf", label: "PDF", iconName: "FileText", targetPanel: "downloads" });
  }

  return entries;
}

function hasPdf(downloads: ResultDownload[]): boolean {
  return downloads.some(d => d.name.toLowerCase().endsWith(".pdf"));
}

export function groupDownloads(result: ExecutionResult): Record<ResultDownload["kind"], ResultDownload[]> {
  const groups: Record<ResultDownload["kind"], ResultDownload[]> = {
    video: [],
    model3d: [],
    document: [],
    drawing: [],
    data: [],
    other: [],
  };
  for (const d of result.downloads) {
    groups[d.kind].push(d);
  }
  return groups;
}
