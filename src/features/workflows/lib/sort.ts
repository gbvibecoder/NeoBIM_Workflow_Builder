import type { WorkflowSummary } from "@/lib/api";

export type SortKey = "recent" | "most-run" | "az" | "oldest";

export const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "recent", label: "Recent" },
  { key: "most-run", label: "Most run" },
  { key: "az", label: "A\u2013Z" },
  { key: "oldest", label: "Oldest" },
];

export function sortWorkflows(
  workflows: WorkflowSummary[],
  key: SortKey
): WorkflowSummary[] {
  const copy = [...workflows];
  switch (key) {
    case "recent":
      return copy.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    case "most-run":
      return copy.sort((a, b) => b._count.executions - a._count.executions);
    case "az":
      return copy.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
    case "oldest":
      return copy.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }
}
