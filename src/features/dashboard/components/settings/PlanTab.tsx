"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Crown, ArrowRight, Calendar } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { PLAN_EXEC_LIMITS } from "@/constants/limits";
import s from "./settings.module.css";

const PLAN_META: Record<string, { videos: number; threeD: number; renders: number }> = {
  FREE: { videos: 0, threeD: 0, renders: 0 },
  MINI: { videos: 1, threeD: 2, renders: 5 },
  STARTER: { videos: 2, threeD: 5, renders: 15 },
  PRO: { videos: 5, threeD: 10, renders: 30 },
  TEAM_ADMIN: { videos: -1, threeD: -1, renders: -1 },
  PLATFORM_ADMIN: { videos: -1, threeD: -1, renders: -1 },
};

export function PlanTab() {
  const { t } = useLocale();
  const router = useRouter();
  const { data: session } = useSession();

  const userRole = (session?.user as { role?: string } | undefined)?.role || "FREE";
  const stripeEnd = (session?.user as { stripeCurrentPeriodEnd?: string } | undefined)?.stripeCurrentPeriodEnd;

  const planLabel =
    userRole === "FREE" ? "Free" :
    userRole === "MINI" ? "Mini" :
    userRole === "STARTER" ? "Starter" :
    userRole === "PRO" ? "Pro" :
    userRole === "TEAM_ADMIN" ? "Team" :
    userRole === "PLATFORM_ADMIN" ? "Admin" : userRole;

  const execLimit = PLAN_EXEC_LIMITS[userRole] ?? 3;
  const meta = PLAN_META[userRole] ?? PLAN_META.FREE;
  const isUnlimited = execLimit === -1;
  const isFree = userRole === "FREE";

  const renewalDate = stripeEnd
    ? new Date(stripeEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div>
      <div className={s.planCard}>
        <div className={s.planCardStrip}>
          <span className={s.planCardStripNum}>FB-S03 &middot; {t("settings.planCurrentSubscription")}</span>
        </div>
        <div className={s.planCardBody}>
          <div className={s.planCardInfo}>
            {!isFree && (
              <div className={s.planCardTag}>
                <Crown size={10} />
                {t("settings.planActive")}
              </div>
            )}
            <h2 className={s.planCardName}>
              <em>{planLabel}</em> {t("settings.planNameSuffix")}
            </h2>
            <p className={s.planCardDesc}>
              {isFree
                ? t("settings.freeRunsPerMonth")
                : isUnlimited
                  ? t("settings.unlimitedRuns")
                  : `${execLimit} ${t("settings.planMetaExecutions")}`}
            </p>
            <div className={s.planCardMeta}>
              <span className={s.planCardMetaPill}>
                <strong>{isUnlimited ? "\u221E" : execLimit}</strong> {t("settings.planMetaExecutions")}
              </span>
              {meta.videos > 0 && (
                <span className={s.planCardMetaPill}>
                  <strong>{meta.videos === -1 ? "\u221E" : meta.videos}</strong> {t("settings.planMetaVideos")}
                </span>
              )}
              {meta.threeD > 0 && (
                <span className={s.planCardMetaPill}>
                  <strong>{meta.threeD === -1 ? "\u221E" : meta.threeD}</strong> {t("settings.planMeta3d")}
                </span>
              )}
              {meta.renders > 0 && (
                <span className={s.planCardMetaPill}>
                  <strong>{meta.renders === -1 ? "\u221E" : meta.renders}</strong> {t("settings.planMetaRenders")}
                </span>
              )}
            </div>
          </div>
          <div className={s.planCardAction}>
            <button
              className={s.btnPrimary}
              onClick={() => router.push("/dashboard/billing")}
            >
              {isFree ? t("settings.planUpgradeOrChange") : t("settings.planManageBilling")}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Renewal info */}
      {!isFree && (
        <div className={s.planRenewal}>
          <div className={s.planRenewalIcon}>
            <Calendar size={16} />
          </div>
          <div className={s.planRenewalInfo}>
            <div className={s.planRenewalLabel}>{t("settings.planRenews")}</div>
            <div className={s.planRenewalValue}>
              {renewalDate ?? "Active subscription"}
            </div>
          </div>
          <a href="/dashboard/billing" className={s.planRenewalLink}>
            {t("settings.planUpgradeOrChange")}
          </a>
        </div>
      )}
    </div>
  );
}
