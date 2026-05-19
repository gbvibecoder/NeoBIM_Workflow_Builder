import Link from "next/link";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { NodesCanvas } from "./NodesCanvas";
import { WorkspaceStatsCard } from "./WorkspaceStatsCard";
import s from "./dashboard.module.css";

interface DashboardHeroProps {
  firstName: string;
  planTier: string;
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
  lastWorkflowId: string | null;
}

function formatDayTime(): { day: string; time: string } {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "long" });
  const time = now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return { day, time };
}

export function DashboardHero({ firstName, planTier, stats, loading, lastWorkflowId }: DashboardHeroProps) {
  const { t } = useLocale();
  const { day, time } = formatDayTime();
  const hasLast = lastWorkflowId !== null;
  const runningCount = stats ? Math.min(3, Math.max(0, Math.floor(stats.executionCount / 200))) : 0;

  return (
    <section className={s.heroV3}>
      {/* TOP STRIP */}
      <div className={s.heroV3Strip}>
        <div className={s.heroV3StripL}>
          <span className={s.heroV3StripNum}>FB-D00</span>
          <span className={s.heroV3StripBrand}>Buildflow</span>
          <span className={s.heroV3StripMute}>
            · {t("dashboard.v2.heroStripDay")} · {day} · {time} IST
          </span>
        </div>
        <div className={s.heroV3StripR}>
          {!loading && stats ? (
            <span className={s.heroV3StripRunning}>
              <span className={s.heroV3StripPulse} />
              {runningCount} running
            </span>
          ) : null}
          <span className={s.heroV3StripPlan}>{planTier}</span>
        </div>
      </div>

      {/* PRETITLE ROW */}
      <div className={s.heroV3PretitleRow}>
        <div className={s.heroV3PretitleL}>
          <div className={s.heroV3Eyebrow}>{t("dashboard.v2.heroEyebrow")}</div>
          <div className={s.heroV3Greeting}>
            {t("dashboard.v2.heroGreetingPrefix")},{" "}
            <strong className={s.heroV3GreetingName}>{firstName}</strong>.
          </div>
        </div>
        <div className={s.heroV3DragHint}>{t("dashboard.v2.heroDragHint")}</div>
      </div>

      {/* STATEMENT */}
      <h1 className={s.heroV3Statement}>
        {t("dashboard.v2.heroStatementPart1")}{" "}
        <em className={s.heroV3StatementEm}>{t("dashboard.v2.heroStatementEm1")}</em>{" "}
        <span className={s.heroV3StatementArrow} aria-hidden="true">→</span>{" "}
        {t("dashboard.v2.heroStatementSep")}{" "}
        <em className={s.heroV3StatementEm}>{t("dashboard.v2.heroStatementEm2")}</em>.
      </h1>

      {/* TRANSFORMATION VISUAL */}
      <NodesCanvas />

      {/* ACTIONS ROW */}
      <div className={s.heroV3Actions}>
        <p className={s.heroV3Pitch}>{t("dashboard.v2.heroSub")}</p>
        <div className={s.heroV3CtaRow}>
          {hasLast ? (
            <>
              <Link
                href={`/dashboard/canvas?id=${lastWorkflowId}`}
                className={`${s.heroV3Btn} ${s.heroV3BtnPrimary}`}
              >
                <ArrowRight size={14} />
                {t("dashboard.v2.continueLastWorkflow")}
              </Link>
              <Link href="/dashboard/canvas?new=1" className={s.heroV3Btn}>
                <Plus size={14} />
                {t("dashboard.v2.newBlankWorkflow")}
              </Link>
              <Link href="/dashboard/templates" className={s.heroV3Btn}>
                <Sparkles size={14} />
                {t("dashboard.v2.browseTemplates")}
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/dashboard/canvas?new=1"
                className={`${s.heroV3Btn} ${s.heroV3BtnPrimary}`}
              >
                <Plus size={14} />
                {t("dashboard.v2.newBlankWorkflow")}
              </Link>
              <Link href="/dashboard/templates" className={s.heroV3Btn}>
                <Sparkles size={14} />
                {t("dashboard.v2.browseTemplates")}
              </Link>
            </>
          )}
        </div>
      </div>

      {/* INLINE STATS STRIP */}
      <WorkspaceStatsCard stats={stats} loading={loading} />
    </section>
  );
}
