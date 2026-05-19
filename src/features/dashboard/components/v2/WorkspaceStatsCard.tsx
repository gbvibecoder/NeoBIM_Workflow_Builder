import { useLocale } from "@/hooks/useLocale";
import s from "./dashboard.module.css";

interface WorkspaceStatsCardProps {
  stats: {
    workflowCount: number;
    executionCount: number;
    outputsCount: number;
    level: number;
    planLabel: string;
    used: number;
    effectiveLimit: number;
  } | null;
  loading: boolean;
}

export function WorkspaceStatsCard({ stats, loading }: WorkspaceStatsCardProps) {
  const { t } = useLocale();
  const isLoading = loading || !stats;

  return (
    <div className={s.heroV3InlineStats}>
      <div className={s.heroV3InlineStat}>
        <div className={s.heroV3InlineStatLabel}>
          {t("dashboard.v2.statWorkflows")}
        </div>
        <div className={s.heroV3InlineStatVal}>
          {isLoading ? (
            <span className={s.skeleton} style={{ display: "inline-block", width: 32, height: 16 }} />
          ) : (
            stats.workflowCount
          )}
        </div>
      </div>

      <div className={s.heroV3InlineStat}>
        <div className={s.heroV3InlineStatLabel}>
          {t("dashboard.v2.statExecutions")}
        </div>
        <div className={s.heroV3InlineStatVal}>
          {isLoading ? (
            <span className={s.skeleton} style={{ display: "inline-block", width: 32, height: 16 }} />
          ) : (
            stats.executionCount
          )}
        </div>
      </div>

      <div className={s.heroV3InlineStat}>
        <div className={s.heroV3InlineStatLabel}>
          {t("dashboard.v2.statXpLevel")}
        </div>
        <div className={s.heroV3InlineStatVal}>
          {isLoading ? (
            <span className={s.skeleton} style={{ display: "inline-block", width: 32, height: 16 }} />
          ) : (
            <>L{stats.level}</>
          )}
        </div>
      </div>
    </div>
  );
}
