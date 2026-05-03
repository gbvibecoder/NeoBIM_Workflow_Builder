import { useLocale } from "@/hooks/useLocale";
import { SectionHead } from "./SectionHead";
import { WorkflowCard } from "./WorkflowCard";
import s from "./dashboard.module.css";

export function FeaturedWorkflowsSection() {
  const { t } = useLocale();

  return (
    <section>
      <SectionHead
        num={t("dashboard.v2.section2Num")}
        title={
          <>
            {t("dashboard.v2.section2TitlePart1")} <em>{t("dashboard.v2.section2TitleEm1")}</em>
            {t("dashboard.v2.section2TitlePart2")} <em>{t("dashboard.v2.section2TitleEm2")}</em>.
          </>
        }
        sub={t("dashboard.v2.section2Sub")}
        link={{ label: t("dashboard.v2.section2Link"), href: "/dashboard/templates" }}
      />
      <div className={s.workflows}>
        <WorkflowCard workflowId="boq" />
        <WorkflowCard workflowId="renovation" />
        <WorkflowCard workflowId="pdf-walkthrough" />
      </div>
    </section>
  );
}
