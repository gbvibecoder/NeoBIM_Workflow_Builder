"use client";

import { useLocale } from "@/hooks/useLocale";
import s from "./settings.module.css";

interface SettingsHeroProps {
  userName: string;
  plan: string;
}

export function SettingsHero({ userName, plan }: SettingsHeroProps) {
  const { t } = useLocale();

  const planLabel =
    plan === "FREE" ? "Free" :
    plan === "MINI" ? "Mini" :
    plan === "STARTER" ? "Starter" :
    plan === "PRO" ? "Pro" :
    plan === "TEAM_ADMIN" ? "Team" :
    plan === "PLATFORM_ADMIN" ? "Admin" : plan;

  return (
    <div className={s.hero}>
      {/* Drafting strip */}
      <div className={s.heroStrip}>
        <div className={s.heroStripLeft}>
          <span className={s.heroStripNum}>FB-S00</span>
          <span>{t("settings.title")} &middot; {planLabel}</span>
        </div>
        <div className={s.heroStripRight}>
          <span className={s.heroStripTick}>A</span>
        </div>
      </div>

      {/* Hero body */}
      <div className={s.heroBody}>
        <div className={s.heroText}>
          <div className={s.heroEyebrow}>{t("settings.title")}</div>
          <h1 className={s.heroTitle}>
            {t("settings.heroTitlePart1")} <em>{t("settings.heroTitleStudio")}</em> {t("settings.heroTitleSuffix")}
          </h1>
          <p className={s.heroSub}>{t("settings.heroSub")}</p>
        </div>
        <div className={s.heroMeta}>
          <div className={s.heroMetaPill}>
            <span className={s.heroMetaDot} />
            {t("settings.heroSignedInPrefix")}
          </div>
        </div>
      </div>
    </div>
  );
}
