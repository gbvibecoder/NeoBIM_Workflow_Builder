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

  return (
    <section className={s.hero}>
      {/* Drafting strip header */}
      <div className={s.heroStrip}>
        <div className={s.heroStripLeft}>
          <span className={s.heroStripNum}>FB-D00</span>
          <span className={s.heroStripGreeting}>
            {t("dashboard.v2.heroStripDay")} · {day}
          </span>
        </div>
        <div className={s.heroStripRight}>
          <span className={s.heroStripGreeting}>{time} IST</span>
          <span className={s.heroStripPlan}>{planTier}</span>
        </div>
      </div>

      <div className={s.heroGrid}>
        {/* Left column */}
        <div className={s.heroLeft}>
          <div className={s.heroGreeting}>
            {t("dashboard.v2.heroGreetingPrefix")} · {firstName}
          </div>
          <h1 className={s.heroTitle}>
            {t("dashboard.v2.heroTitlePart1")}{" "}
            <em className={s.heroTitleEm}>{t("dashboard.v2.heroTitleEm1")}</em>
            {t("dashboard.v2.heroTitleSeparator")}{" "}
            <em className={s.heroTitleEm}>{t("dashboard.v2.heroTitleEm2")}</em>.
          </h1>
          <p className={s.heroSub}>
            {t("dashboard.v2.heroSub")}
          </p>

          {/* Nodes canvas — decorative brand statement */}
          <NodesCanvas />

          {/* CTA buttons */}
          <div className={s.heroCtaRow} style={{ marginTop: 24 }}>
            {lastWorkflowId ? (
              <Link href={`/dashboard/canvas?id=${lastWorkflowId}`} className={`${s.heroBtn} ${s.heroBtnPrimary}`}>
                <ArrowRight size={14} />
                {t("dashboard.v2.continueLastWorkflow")}
              </Link>
            ) : (
              <Link href="/dashboard/canvas?new=1" className={`${s.heroBtn} ${s.heroBtnPrimary}`}>
                <Plus size={14} />
                {t("dashboard.v2.newBlankWorkflow")}
              </Link>
            )}
            <Link href="/dashboard/canvas?new=1" className={s.heroBtn}>
              {t("dashboard.v2.newBlankWorkflow")}
            </Link>
            <Link href="/dashboard/templates" className={s.heroBtn}>
              <Sparkles size={14} />
              {t("dashboard.v2.browseTemplates")}
            </Link>
          </div>
        </div>

        {/* Right column — stats card */}
        <WorkspaceStatsCard stats={stats} loading={loading} />
      </div>
    </section>
  );
}
