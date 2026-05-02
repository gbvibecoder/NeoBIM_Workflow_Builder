import { CheckSquare, Square, Trash2, X } from "lucide-react";
import s from "./page.module.css";

interface Props {
  selectedCount: number;
  totalFilteredCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onConfirmDelete: () => void;
  onCancel: () => void;
}

export function BulkSelectToolbar({
  selectedCount, totalFilteredCount,
  onSelectAll, onDeselectAll,
  onConfirmDelete, onCancel,
}: Props) {
  const allSelected = selectedCount >= totalFilteredCount && totalFilteredCount > 0;

  return (
    <div className={s.bulkBar}>
      <span className={s.bulkBarCount}>
        {selectedCount > 0 ? `${selectedCount} selected` : "Select workflows"}
      </span>

      <button
        className={s.bulkBtn}
        onClick={allSelected ? onDeselectAll : onSelectAll}
      >
        {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
        {allSelected ? "Deselect all" : "Select all"}
      </button>

      <div className={s.bulkBarSpacer} />

      <button
        className={s.bulkBtnDanger}
        onClick={onConfirmDelete}
        disabled={selectedCount === 0}
      >
        <Trash2 size={12} />
        {selectedCount > 0 ? `Delete ${selectedCount}` : "Delete"}
      </button>

      <button className={s.bulkBtnCancel} onClick={onCancel}>
        <X size={14} />
      </button>
    </div>
  );
}
