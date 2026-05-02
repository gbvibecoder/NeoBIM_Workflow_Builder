import { Search, Grid3x3, LayoutGrid, List } from "lucide-react";
import { SORT_OPTIONS, type SortKey } from "@/features/workflows/lib/sort";
import { CATEGORY_META, type WorkflowCategoryKey } from "@/features/workflows/lib/categorize";
import s from "./page.module.css";

export type ViewMode = "gallery" | "compact" | "list";

export type StatusKey = "all" | "success" | "failed" | "running" | "partial" | "never";

const FILTER_ORDER: Array<WorkflowCategoryKey> = [
  "floorplan", "3d", "render", "pdf", "pipeline", "custom",
];

interface StatusCounts {
  success: number;
  failed: number;
  running: number;
  partial: number;
  never: number;
}

interface Props {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeFilter: WorkflowCategoryKey | "all";
  onFilterChange: (f: WorkflowCategoryKey | "all") => void;
  sortKey: SortKey;
  onSortChange: (k: SortKey) => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  categoryCounts: Record<string, number>;
  totalCount: number;
  statusFilter: StatusKey;
  onStatusChange: (s: StatusKey) => void;
  statusCounts: StatusCounts;
  onEnterSelectMode: () => void;
  selectMode: boolean;
}

const STATUS_CHIPS: Array<{ key: StatusKey; label: string; color: string }> = [
  { key: "all", label: "All status", color: "" },
  { key: "success", label: "Successful", color: "#4A6B4D" },
  { key: "failed", label: "Failed", color: "#dc3545" },
  { key: "running", label: "Running", color: "#1A4D5C" },
  { key: "partial", label: "Partial", color: "#C26A3B" },
  { key: "never", label: "Never run", color: "#9AA1B0" },
];

export function WorkflowsToolbar({
  searchQuery, onSearchChange,
  activeFilter, onFilterChange,
  sortKey, onSortChange,
  viewMode, onViewModeChange,
  categoryCounts, totalCount,
  statusFilter, onStatusChange,
  statusCounts,
  onEnterSelectMode, selectMode,
}: Props) {
  return (
    <>
      {/* Status filter row */}
      <div className={s.statusChips}>
        {STATUS_CHIPS.map(chip => {
          const count = chip.key === "all" ? totalCount : statusCounts[chip.key as keyof StatusCounts];
          if (chip.key !== "all" && count === 0) return null;
          return (
            <button
              key={chip.key}
              className={s.statusChip}
              data-active={statusFilter === chip.key ? "true" : undefined}
              onClick={() => onStatusChange(chip.key)}
            >
              {chip.color && <span className={s.statusChipDot} style={{ background: chip.color }} />}
              {chip.label}
              {chip.key !== "all" && <span className={s.statusChipCount}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Main toolbar */}
      <div className={s.toolbar}>
        <div className={s.search}>
          <Search size={14} className={s.searchIcon} />
          <input
            className={s.searchInput}
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search workflows..."
            aria-label="Search workflows"
          />
        </div>

        <div className={s.filterGroup}>
          <button
            className={activeFilter === "all" ? s.filterChipActive : s.filterChip}
            onClick={() => onFilterChange("all")}
          >
            All
            <span className={s.filterChipCount}>{totalCount}</span>
          </button>
          {FILTER_ORDER.map(key => {
            const count = categoryCounts[key] ?? 0;
            if (count === 0) return null;
            const meta = CATEGORY_META[key];
            return (
              <button
                key={key}
                className={activeFilter === key ? s.filterChipActive : s.filterChip}
                onClick={() => onFilterChange(key)}
              >
                <span className={s.filterChipDot} style={{ background: meta.color }} />
                {meta.shortLabel}
                <span className={s.filterChipCount}>{count}</span>
              </button>
            );
          })}
        </div>

        <select
          className={s.sortSelect}
          value={sortKey}
          onChange={e => onSortChange(e.target.value as SortKey)}
          aria-label="Sort workflows"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>

        <div className={s.viewToggle}>
          <button className={viewMode === "gallery" ? s.viewToggleBtnActive : s.viewToggleBtn} onClick={() => onViewModeChange("gallery")} title="Gallery view">
            <LayoutGrid size={14} />
          </button>
          <button className={viewMode === "compact" ? s.viewToggleBtnActive : s.viewToggleBtn} onClick={() => onViewModeChange("compact")} title="Compact view">
            <Grid3x3 size={14} />
          </button>
          <button className={viewMode === "list" ? s.viewToggleBtnActive : s.viewToggleBtn} onClick={() => onViewModeChange("list")} title="List view">
            <List size={14} />
          </button>
        </div>

        {!selectMode && (
          <button className={s.selectBtn} onClick={onEnterSelectMode}>
            Select
          </button>
        )}
      </div>
    </>
  );
}
