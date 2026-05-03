import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import s from "./dashboard.module.css";

export function SuggestWorkflowBanner() {
  const { t } = useLocale();

  return (
    <div className={s.suggest}>
      <div className={s.suggestText}>
        <div className={s.suggestTag}>{t("dashboard.v2.suggestTag")}</div>
        <h3 className={s.suggestTitle}>
          {t("dashboard.v2.suggestTitle")} <em>{t("dashboard.v2.suggestTitleEm")}</em>{t("dashboard.v2.suggestTitleSuffix")}
        </h3>
      </div>
      <Link href="/dashboard/feedback?category=workflow_suggestion" className={s.suggestBtn}>
        {t("dashboard.v2.suggestCta")} <ArrowRight size={14} />
      </Link>
    </div>
  );
}
