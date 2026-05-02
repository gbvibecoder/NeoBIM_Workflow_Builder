import type { WorkflowSummary } from "@/lib/api";

export type WorkflowCategoryKey =
  | "floorplan"
  | "3d"
  | "render"
  | "pdf"
  | "pipeline"
  | "custom";

export interface WorkflowCategoryMeta {
  key: WorkflowCategoryKey;
  label: string;
  shortLabel: string;
  /** Inline color for accents (can't use CSS vars in JS) */
  color: string;
  colorTint: string;
  gradientFrom: string;
  gradientTo: string;
}

export const CATEGORY_META: Record<WorkflowCategoryKey, WorkflowCategoryMeta> = {
  floorplan: {
    key: "floorplan",
    label: "Floor Plan",
    shortLabel: "Floor Plans",
    color: "#4A6B4D",         // rs-sage
    colorTint: "rgba(74, 107, 77, 0.08)",
    gradientFrom: "#4A6B4D",
    gradientTo: "#6B8F6E",
  },
  "3d": {
    key: "3d",
    label: "3D Model",
    shortLabel: "3D Models",
    color: "#1A4D5C",         // rs-blueprint
    colorTint: "rgba(26, 77, 92, 0.08)",
    gradientFrom: "#1A4D5C",
    gradientTo: "#2C7B8F",
  },
  render: {
    key: "render",
    label: "Render",
    shortLabel: "Renders",
    color: "#C26A3B",         // rs-burnt
    colorTint: "rgba(194, 106, 59, 0.08)",
    gradientFrom: "#E5A878",
    gradientTo: "#C26A3B",
  },
  pdf: {
    key: "pdf",
    label: "PDF Report",
    shortLabel: "PDF Reports",
    color: "#C26A3B",         // rs-burnt
    colorTint: "rgba(194, 106, 59, 0.08)",
    gradientFrom: "#C26A3B",
    gradientTo: "#A0522D",
  },
  pipeline: {
    key: "pipeline",
    label: "Pipeline",
    shortLabel: "Pipeline",
    color: "#7C5C8A",         // plum
    colorTint: "rgba(124, 92, 138, 0.08)",
    gradientFrom: "#7C5C8A",
    gradientTo: "#C26A3B",
  },
  custom: {
    key: "custom",
    label: "Custom",
    shortLabel: "Custom",
    color: "#5A6478",         // rs-text
    colorTint: "rgba(90, 100, 120, 0.08)",
    gradientFrom: "#5A6478",
    gradientTo: "#7A8498",
  },
};

/**
 * Resolve workflow category. Priority:
 * 1. Persisted Workflow.category (if it matches a known key)
 * 2. Heuristic fallback from name (preserves prior behavior)
 */
export function resolveCategory(workflow: {
  category: string | null;
  name: string;
}): WorkflowCategoryMeta {
  if (workflow.category) {
    const key = workflow.category.toLowerCase() as WorkflowCategoryKey;
    if (key in CATEGORY_META) return CATEGORY_META[key];
  }

  const n = workflow.name.toLowerCase();
  if (n.includes("pdf") || n.includes("report") || n.includes("document"))
    return CATEGORY_META.pdf;
  if (n.includes("floor plan") || n.includes("floorplan") || n.includes("2d"))
    return CATEGORY_META.floorplan;
  if (n.includes("render") || n.includes("concept") || n.includes("image"))
    return CATEGORY_META.render;
  if (n.includes("full pipeline") || n.includes("complete"))
    return CATEGORY_META.pipeline;
  if (n.includes("3d") || n.includes("massing") || n.includes("model"))
    return CATEGORY_META["3d"];
  return CATEGORY_META.custom;
}

const CATEGORY_ORDER: WorkflowCategoryKey[] = [
  "floorplan", "3d", "render", "pdf", "pipeline", "custom",
];

export function groupByCategory<T extends { category: string | null; name: string }>(
  workflows: T[]
): Array<{ meta: WorkflowCategoryMeta; items: T[] }> {
  const buckets = new Map<WorkflowCategoryKey, T[]>();
  for (const wf of workflows) {
    const meta = resolveCategory(wf);
    if (!buckets.has(meta.key)) buckets.set(meta.key, []);
    buckets.get(meta.key)!.push(wf);
  }

  return CATEGORY_ORDER
    .filter(key => buckets.has(key))
    .map(key => ({ meta: CATEGORY_META[key], items: buckets.get(key)! }));
}
