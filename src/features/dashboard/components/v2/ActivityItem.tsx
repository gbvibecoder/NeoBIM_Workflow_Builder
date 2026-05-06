import { FileText, Zap, Newspaper } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import s from "./dashboard.module.css";

export interface ActivityItemData {
  id: string;
  type: "output" | "changelog" | "run";
  title: string;
  source: string;
  time: string;
  status: "done" | "new";
}

interface ActivityItemProps {
  item: ActivityItemData;
}

export function ActivityItem({ item }: ActivityItemProps) {
  const { t } = useLocale();

  return (
    <div className={s.activityItem}>
      <div className={s.activityItemIcon} data-type={item.type}>
        {item.type === "output" && <FileText size={14} />}
        {item.type === "changelog" && <Newspaper size={14} />}
        {item.type === "run" && <Zap size={14} />}
      </div>
      <div className={s.activityItemInfo}>
        <div className={s.activityItemTitle}>{item.title}</div>
        <div className={s.activityItemSource}>{item.source}</div>
      </div>
      <span className={s.activityItemStatus} data-status={item.status}>
        {item.status === "done" ? t("dashboard.v2.activityStatusDone") : t("dashboard.v2.activityStatusNew")}
      </span>
      <span className={s.activityItemTime}>{item.time}</span>
    </div>
  );
}
