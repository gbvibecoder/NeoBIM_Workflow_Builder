"use client";

import { useState, useMemo } from "react";
import { Clock, ChevronDown } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { DASHBOARD_CHANGELOG } from "@/constants/dashboard-changelog";
import { SectionHead } from "./SectionHead";
import { ActivityItem } from "./ActivityItem";
import type { ActivityItemData } from "./ActivityItem";
import s from "./dashboard.module.css";

interface ActivityFeedProps {
  recentOutputs: Array<{
    id: string;
    type: string;
    createdAt: string;
    workflowName: string;
  }>;
  recentActivity: Array<{
    id: string;
    status: string;
    createdAt: string;
    workflowName: string;
  }>;
  loading: boolean;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

export function ActivityFeed({ recentOutputs, recentActivity, loading }: ActivityFeedProps) {
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);

  const mergedActivities = useMemo((): ActivityItemData[] => {
    const items: ActivityItemData[] = [];

    // Outputs → type "output"
    for (const o of recentOutputs.slice(0, 3)) {
      items.push({
        id: `out-${o.id}`,
        type: "output",
        title: `${o.type} output`,
        source: o.workflowName,
        time: formatRelativeTime(o.createdAt),
        status: "done",
      });
    }

    // Changelog → type "changelog"
    for (const c of DASHBOARD_CHANGELOG.slice(0, 3)) {
      items.push({
        id: `cl-${c.id}`,
        type: "changelog",
        title: c.title,
        source: `Product update · ${new Date(c.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        time: formatRelativeTime(c.date),
        status: "new",
      });
    }

    // Runs → type "run"
    for (const r of recentActivity.slice(0, 3)) {
      items.push({
        id: `run-${r.id}`,
        type: "run",
        title: r.status === "SUCCESS" || r.status === "PARTIAL" ? "Completed run" : r.status === "FAILED" ? "Failed run" : "Running",
        source: r.workflowName,
        time: formatRelativeTime(r.createdAt),
        status: "done",
      });
    }

    // Sort by recency (approximate — all relative times are computed from the same base)
    return items.slice(0, 9);
  }, [recentOutputs, recentActivity]);

  const outputCount = Math.min(recentOutputs.length, 3);
  const changelogCount = Math.min(DASHBOARD_CHANGELOG.length, 3);
  const runCount = Math.min(recentActivity.length, 3);
  const totalCount = outputCount + changelogCount + runCount;

  return (
    <section>
      <SectionHead
        num={t("dashboard.v2.section4Num")}
        title={
          <>
            {t("dashboard.v2.section4Title")} <em>{t("dashboard.v2.section4TitleEm")}</em>.
          </>
        }
        sub={t("dashboard.v2.section4Sub")}
      />

      <div className={s.activity} data-open={isOpen}>
        <button
          type="button"
          className={s.activityHead}
          onClick={() => setIsOpen((o) => !o)}
          aria-expanded={isOpen}
        >
          <div className={s.activityHeadLeft}>
            <div className={s.activityHeadIcon}>
              <Clock size={16} />
            </div>
            <div className={s.activityHeadInfo}>
              <div className={s.activityHeadTitle}>
                {t("dashboard.v2.activityHeadCount").replace("{count}", String(totalCount))}
              </div>
              <div className={s.activityHeadSub}>
                {t("dashboard.v2.activityHeadBreakdown")
                  .replace("{outputs}", String(outputCount))
                  .replace("{updates}", String(changelogCount))
                  .replace("{runs}", String(runCount))}
              </div>
            </div>
          </div>
          <div className={s.activityHeadToggle}>
            <ChevronDown size={16} />
          </div>
        </button>

        <div className={s.activityBody}>
          <div className={s.activityList}>
            {loading ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--rs-text-mute)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
                Loading activity...
              </div>
            ) : mergedActivities.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--rs-text-mute)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
                No activity yet.
              </div>
            ) : (
              mergedActivities.map((item) => (
                <ActivityItem key={item.id} item={item} />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
