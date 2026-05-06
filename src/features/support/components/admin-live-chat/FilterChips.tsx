"use client";

import s from "./admin-live-chat.module.css";

export type FilterKey = "all" | "unread" | "WAITING" | "ACTIVE" | "CLOSED";

const CHIPS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "WAITING", label: "Waiting" },
  { key: "ACTIVE", label: "Active" },
  { key: "CLOSED", label: "Closed" },
];

interface FilterChipsProps {
  activeFilter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  counts: Record<FilterKey, number>;
}

export function FilterChips({
  activeFilter,
  onFilterChange,
  counts,
}: FilterChipsProps) {
  return (
    <div className={s.topbarFilters}>
      {CHIPS.map(({ key, label }) => (
        <button
          key={key}
          className={s.filterChip}
          data-active={activeFilter === key}
          onClick={() => onFilterChange(key)}
        >
          {label}
          <span className={s.filterChipCount}>{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}
