import { formatDayDivider } from "@/features/support/lib/format-day";
import s from "./admin-live-chat.module.css";

interface DateDividerProps {
  date: Date;
}

export function DateDivider({ date }: DateDividerProps) {
  return (
    <div className={s.msgDivider}>
      <span className={s.msgDividerLabel}>{formatDayDivider(date)}</span>
    </div>
  );
}
